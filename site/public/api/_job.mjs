// 진가 주간 보고서 서버 작업 — Vercel 함수에서 전 과정을 돌림(운영 PC 불필요)
//   plan(구독자 조건 묶기) → kb(KB시세 조회) → map(지역 지도 집계) → listing(매물 호가·단지 정보)
//   → news(지역 뉴스·시장 지표) → render(조건별 보고서 HTML·엑셀) → send(구독자별 메일) → done
// Vercel 함수 한 번은 최대 5분(Hobby)이라 단계마다 진행 위치를 저장(weekly/job.json)하고,
// 시간이 다 되면 api/weekly 가 자기 자신을 다시 불러 이어 갑니다. 중간에 끊겨도 매일 크론이 10분 넘게 멈춘 작업을 이어 줌.
// 저장 위치(비공개 Blob): weekly/work/<날짜>/…(작업 중 조각) · weekly/reports/<날짜>/<base|조건ID>.html·.xlsx·groups.json
//                        weekly/data/<날짜>.json(주간 비교 스냅샷) · weekly/kb-seoul-gu.json(지역 지도) · weekly/config.json(기본 조건)
// 시험 실행(mode 'test')은 weekly/test/ 아래에만 쓰고, 지도·스냅샷은 건드리지 않으며, 보내는 계정 본인에게만 발송.
import { createKbClient, runPool, evaluate, typeMatches, listingCandidates, prepareAsk } from '../jinga-kb.mjs';
import { buildXlsx } from '../xlsx-lite.mjs';
import { normalizeCriteria, criteriaKey, criteriaLabel, recordPath } from './_core.mjs';
import {
  DEFAULT_CONFIG, KB_HEADERS, planGroups, toKbCriteria, groupDirName, snapComplexes, groupEntry, snapshotView, diffSnapshots,
  collectNews, fetchMacro, askGapStats, aggregate, attachChange, compactForCompare, buildReportSheets, kstDate, sleep, withRetry,
} from './_weekly.mjs';
import { renderReportHtml } from './_report-html.mjs';
import { mailConfigFromEnv, canSend, createTransport, weeklyMail, confirmMail, changeMail, fromHeader } from './_mail.mjs';
import { annualPath, yearOfAsOf, updateAnnual } from './_annual.mjs';

export const JOB_PATH = 'weekly/job.json';
// 이번 주 운영 실행 기록 — job.json 은 시험 실행이 덮어쓰므로 크론은 이것으로 「이번 주에 이미 돌았나」를 판단(중복 발송 방지, 2026-09-15)
export const LAST_FULL_PATH = 'weekly/last-full.json';
export const JOB_HISTORY_PREFIX = 'weekly/jobs/';   // 끝난 작업 요약 <id>-<mode>.json
export const BUDGET_MS = 230e3;          // 한 번 실행에 쓰는 시간(최대 300초 중 저장·다음 호출 여유를 뺌)
export const STALE_MS = 10 * 60e3;       // 이보다 오래 갱신 없는 미완료 작업은 멈춘 것으로 보고 이어 감
const KEEP_WEEKS = 8;
const PENDING_TTL_MS = 7 * 24 * 3600e3;
const XLSX_NAME = '진가_주간데이터.xlsx';

/** 한국 시간 기준 이번 주 월요일 날짜(YYYY-MM-DD) */
export function weekStartId(now = new Date()) {
  const k = new Date(now.getTime() + 9 * 3600e3);
  const back = (k.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate() - back)).toISOString().slice(0, 10);
}
const kstDay = now => new Date(now.getTime() + 9 * 3600e3).getUTCDay();   // 0=일 … 1=월
export const WEEKLY_START_DAY = 1;   // 주간 운영 실행(보고서 발송)은 월요일에만 시작

export function newJob(id, mode, now = new Date()) {
  return {
    id, mode, stage: 'plan', startedAt: now.toISOString(), updatedAt: now.toISOString(), leaseUntil: null,
    invocations: 0, attempts: 0, done: false, failed: false, error: null, log: [],
  };
}

/** 작업 파일 경로 */
function pathsFor(job) {
  const base = job.mode === 'test' ? 'weekly/test' : 'weekly';
  return { work: `${base}/work/${job.id}`, reports: `${base}/reports/${job.id}`, data: 'weekly/data', map: 'weekly/kb-seoul-gu.json', config: 'weekly/config.json' };
}
const reportStartMs = id => Date.parse(`${id}T00:00:00+09:00`);
const webPath = (job, webId) => `r/${job.mode === 'test' ? 'test-' : ''}${job.id}/${webId}.html`;

function note(job, msg) {
  const t = new Date(Date.now() + 9 * 3600e3).toISOString().slice(5, 19).replace('T', ' ');
  job.log.push(`[${t}] ${msg}`);
  if (job.log.length > 80) job.log.splice(0, job.log.length - 80);
}

async function loadSubscribers(store) {
  const paths = await store.list('subs/');
  const out = [];
  await runPool(paths, 8, async p => { const r = await store.get(p); if (r) out.push(r); });
  return out;
}

// ── 작업 조각 읽기 ────────────────────────────────────────────
async function loadComplexes(store, P, job, gus = null) {
  const all = [];
  for (let i = 0; i < (job.kb ? job.kb.parts : 0); i++) {
    const part = await store.get(`${P.work}/kb-${i}.json`);
    if (part) for (const c of part) if (!gus || gus.includes(c.gu)) all.push({ ...c, brief: null });
  }
  return all;
}
function reviveNews(news) {
  for (const list of Object.values(news.byGu)) list.forEach(n => { n.date = new Date(n.date); });
  news.policy.forEach(n => { n.date = new Date(n.date); });
  return news;
}
const typeKey = (c, t) => `${c.id}:${t.areaId}`;
function applyListings(complexes, map) {
  for (const c of complexes) for (const t of c.types) { const k = typeKey(c, t); if (k in map) t.listing = map[k]; }
}
function applyBriefs(complexes, map) {
  for (const c of complexes) if (c.id in map) c.brief = map[c.id];
}
function buildPlans(job, complexes) {
  return job.plan.groups.map(g => ({ ...g, crit: toKbCriteria(g.criteria), subset: complexes.filter(c => g.criteria.gus.includes(c.gu)) }));
}

// ── 단계 ──────────────────────────────────────────────────────
// 각 단계는 끝나면 job.stage 를 다음으로 바꾸고 true, 시간이 모자라 멈추면 진행 위치만 저장하고 false
const STAGES = {
  async plan(ctx) {
    const { store, job, P } = ctx;
    const cfg = { ...DEFAULT_CONFIG, ...((await store.get(P.config)) || {}) };
    const subs = await loadSubscribers(store);
    const { groups, skipped } = planGroups(cfg, subs);
    const gus = [...new Set(groups.flatMap(g => g.criteria.gus))];
    job.plan = { gus, groups, skipped, newsPerGu: cfg.newsPerGu || 6, skipSmall: cfg.skipSmall !== false };
    note(job, `보고서 ${groups.length}종(기본 1 + 구독자 조건 ${groups.length - 1}) · 자치구 ${gus.join('·')}${skipped ? ` · 조건 종류 초과로 ${skipped}명 제외` : ''}`);
    job.stage = 'kb';
    return true;
  },

  async kb(ctx) {
    const { store, job, P, kb } = ctx;
    const dir = await ctx.dir();
    // 운영 실행은 서울 전체(지역 지도용), 시험 실행은 보고서 자치구만
    const targets = dir.filter(c => !c[4] && (job.mode !== 'test' || job.plan.gus.includes(c[2])));
    if (!job.kb) job.kb = { total: targets.length, cursor: 0, parts: 0, failed: [], retryCursor: 0, got: 0 };
    const S = job.kb;
    const buffer = [];
    const fetchOne = async c => {
      await sleep(30);
      try { return { id: c[0], name: c[1], gu: c[2], dong: c[3], far: c[5] ?? null, bcr: c[6] ?? null, approved: c[11] ?? null, types: await withRetry(() => ctx.kb.types(c[0]), 2) }; }
      catch { return null; }
    };
    while (S.cursor < S.total && ctx.left() > 45e3) {
      const slice = targets.slice(S.cursor, S.cursor + 300);
      const got = await runPool(slice, 3, fetchOne);
      slice.forEach((c, i) => { if (got[i]) buffer.push(got[i]); else S.failed.push(c[0]); });
      S.cursor += slice.length;
    }
    if (S.cursor >= S.total && S.failed.length) {   // 실패한 단지는 한 건씩 천천히 다시
      const byId = new Map(targets.map(c => [c[0], c]));
      while (S.retryCursor < S.failed.length && ctx.left() > 30e3) {
        const r = await (async c => { await sleep(200); return fetchOne(c); })(byId.get(S.failed[S.retryCursor]));
        if (r) { buffer.push(r); S.failed[S.retryCursor] = null; }
        S.retryCursor++;
      }
    }
    if (buffer.length) {
      await store.put(`${P.work}/kb-${S.parts}.json`, buffer);
      S.parts++;
      S.got += buffer.length;
    }
    const finished = S.cursor >= S.total && S.retryCursor >= S.failed.length;
    note(job, `KB시세 ${S.got.toLocaleString('ko-KR')}/${S.total.toLocaleString('ko-KR')}개 단지${finished ? ' — 완료' : ' — 이어서'}`);
    if (!finished) return false;
    S.failed = S.failed.filter(Boolean);
    if (!S.got) throw new Error('KB시세를 한 건도 받지 못했습니다(KB 조회 차단 또는 네트워크 문제)');
    void kb;
    job.stage = job.mode === 'test' ? 'listing' : 'map';
    return true;
  },

  async map(ctx) {
    const { store, job, P } = ctx;
    const complexes = await loadComplexes(store, P, job);
    await ensureAsOf(ctx, complexes);
    if (complexes.length < job.kb.total * 0.8) {
      note(job, `지역 지도 집계 건너뜀 — 조회 실패가 많음(${job.kb.total - complexes.length}곳)`);
    } else {
      let old = await store.get(P.map);
      if (!old) { try { old = await (await fetch(`${ctx.origin}/kb-seoul-gu.json`)).json(); } catch { old = null; } }   // 첫 실행: 정적 파일을 비교 기준으로
      const data = { asOf: job.asOf, generatedAt: new Date().toISOString(), source: 'KB부동산 KB시세(단지·주택형별 매매 일반거래가) 서울 50세대 이상 아파트 집계 — 비공식 조회', ...aggregate(complexes) };
      const base = old ? (old.asOf && old.asOf !== job.asOf ? compactForCompare(old) : old.previous || null) : null;
      attachChange(data, base);
      data.previous = base;
      await store.put(P.map, data);
      note(job, `지역 지도 갱신 — KB ${job.asOf || '기준일 미확인'} · ${data.seoul.count.toLocaleString('ko-KR')}개 단지`);
      // 연간 누적 기록(annual/<연도>.json) — 같은 KB 기준일은 한 번만 반영
      const year = yearOfAsOf(job.asOf);
      if (year) {
        const prevRec = await store.get(annualPath(year));
        const rec = updateAnnual(prevRec, { asOf: job.asOf, map: data, complexes });
        if (rec && rec !== prevRec) {
          await store.put(annualPath(year), rec);
          note(job, `연간 기록 ${year}년 — ${rec.weeks.length}주째 · 단지 ${Object.keys(rec.complexes).length.toLocaleString('ko-KR')}곳`);
        }
      }
    }
    job.stage = 'listing';
    return true;
  },

  async listing(ctx) {
    const { store, job, P } = ctx;
    const complexes = await loadComplexes(store, P, job, job.plan.gus);
    await ensureAsOf(ctx, complexes);
    const plans = buildPlans(job, complexes);
    const lPath = `${P.work}/listings.json`, bPath = `${P.work}/briefs.json`;
    const listings = (await store.get(lPath)) || {};
    applyListings(complexes, listings);
    const pairs = new Map();
    for (const p of plans) for (const x of listingCandidates(p.subset, p.crit)) pairs.set(typeKey(x.c, x.t), x);
    const todo = [...pairs.values()];
    let n = 0;
    while (n < todo.length && ctx.left() > 30e3) {
      const slice = todo.slice(n, n + 150);
      await runPool(slice, 3, async ({ c, t }) => {
        try { t.listing = await withRetry(() => ctx.kb.listing(c.id, t.areaId), 2); } catch { t.listing = false; }
        listings[typeKey(c, t)] = t.listing;
      });
      n += slice.length;
    }
    if (n) await store.put(lPath, listings);
    if (n < todo.length) { note(job, `매물 호가 ${Object.keys(listings).length}개 면적 — 이어서`); return false; }

    const briefs = (await store.get(bPath)) || {};
    applyBriefs(complexes, briefs);
    const need = new Set();
    for (const p of plans) {
      if (p.crit.basis === 'ask') prepareAsk(p.subset);
      for (const c of p.subset) if (!(c.id in briefs) && c.types.some(t => typeMatches(t, p.crit))) need.add(c);
    }
    const bTodo = [...need];
    let m = 0;
    while (m < bTodo.length && ctx.left() > 25e3) {
      const slice = bTodo.slice(m, m + 100);
      await runPool(slice, 3, async c => { try { c.brief = await withRetry(() => ctx.kb.brief(c.id), 2); } catch { c.brief = false; } briefs[c.id] = c.brief; });
      m += slice.length;
    }
    if (m) await store.put(bPath, briefs);
    if (m < bTodo.length) { note(job, `단지 정보 ${Object.keys(briefs).length}곳 — 이어서`); return false; }
    note(job, `매물 호가 ${Object.keys(listings).length}개 면적 · 단지 정보 ${Object.keys(briefs).length}곳 — 완료`);
    job.stage = 'news';
    return true;
  },

  async news(ctx) {
    const { store, job, P } = ctx;
    if (ctx.left() < 30e3 + job.plan.gus.length * 4e3) return false;   // 구마다 약 3초
    const dir = await ctx.dir();
    const [news, macro] = await Promise.all([collectNews({ gus: job.plan.gus, newsPerGu: job.plan.newsPerGu }, dir), fetchMacro()]);
    await store.put(`${P.work}/news.json`, { news, macro });
    note(job, `지역 뉴스 ${Object.values(news.byGu).reduce((s, l) => s + l.length, 0)}건 · 정책 ${news.policy.length}건${news.errors.length ? ` · 조회 실패 ${news.errors.length}` : ''}`);
    job.stage = 'render';
    return true;
  },

  async render(ctx) {
    const { store, job, P } = ctx;
    const complexes = await loadComplexes(store, P, job, job.plan.gus);
    const plans = buildPlans(job, complexes);
    const near = plans.map(p => new Set(listingCandidates(p.subset, p.crit).map(x => x.t)));   // 호가를 붙이기 전에 예산 근처 면적을 기억
    applyListings(complexes, (await store.get(`${P.work}/listings.json`)) || {});
    applyBriefs(complexes, (await store.get(`${P.work}/briefs.json`)) || {});
    const { news: rawNews, macro } = await store.get(`${P.work}/news.json`);
    const news = reviveNews(rawNews);
    const prevSnap = await latestSnapshotBefore(store, P, job.id);
    if (!job.render) job.render = { cursor: 0, groups: {}, manifest: { date: job.id, asOf: job.asOf, defaultKey: null, groups: {} } };
    const R = job.render;
    const curSnap = { date: job.id, asOf: job.asOf, gus: job.plan.gus, complexes: snapComplexes(complexes), groups: R.groups };
    while (R.cursor < plans.length && ctx.left() > 25e3) {
      const p = plans[R.cursor], i = R.cursor;
      const result = evaluate(p.subset, p.crit);
      const ask = askGapStats(p.subset, near[i]);
      R.groups[p.key] = { criteria: p.criteria, gus: p.criteria.gus, ...groupEntry(result) };
      const diff = diffSnapshots(snapshotView(prevSnap, p.key, p.criteria.gus), snapshotView(curSnap, p.key, p.criteria.gus));
      const groupNews = { byGu: Object.fromEntries(p.criteria.gus.map(g => [g, news.byGu[g] || []])), policy: news.policy, errors: news.errors };
      const cfg = { gus: p.criteria.gus };
      const html = renderReportHtml({ cfg, criteria: p.crit, today: job.id, asOf: job.asOf, result, diff, macro, news: groupNews, t0: Date.parse(job.startedAt), ask });
      const xlsx = buildXlsx(buildReportSheets({ cfg, criteria: p.crit, today: job.id, asOf: job.asOf, complexes: p.subset, result, diff, news: groupNews }));
      const webId = p.isDefault ? 'base' : groupDirName(p.key);
      await store.putRaw(`${P.reports}/${webId}.html`, html, 'text/html; charset=utf-8');
      await store.putRaw(`${P.reports}/${webId}.xlsx`, Buffer.from(xlsx), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      if (p.isDefault) R.manifest.defaultKey = p.key;
      R.manifest.groups[p.key] = { webId, web: webPath(job, webId), criteria: p.criteria, label: criteriaLabel(p.criteria), isDefault: p.isDefault, subscribers: p.subscribers, complexCount: result.complexCount, best1: result.best5[0] ? result.best5[0].c.name : null };
      note(job, `보고서 ${i + 1}/${plans.length} — ${p.isDefault ? '기본' : `구독자 ${p.subscribers}명`}: ${result.complexCount}곳 · 1위 ${result.best5[0] ? result.best5[0].c.name : '없음'}`);
      R.cursor++;
    }
    if (R.cursor < plans.length) return false;
    await store.put(`${P.reports}/groups.json`, R.manifest);
    if (job.mode !== 'test') await store.put(`${P.data}/${job.id}.json`, curSnap);
    job.stage = 'send';
    return true;
  },

  async send(ctx) {
    const { store, job, P } = ctx;
    const cfg = { ...mailConfigFromEnv(ctx.env) };
    if (!cfg.siteUrl) cfg.siteUrl = ctx.origin;
    if (!job.sendState) job.sendState = { sent: 0, failed: [], missing: 0 };
    const S = job.sendState;
    if (!canSend(cfg)) {
      note(job, '보내는 메일 설정(JINGA_MAIL_USER·JINGA_MAIL_PASS)이 없어 발송을 건너뜀');
      await cleanup(store, job, P);
      job.stage = 'done';
      return true;
    }
    const manifest = await store.get(`${P.reports}/groups.json`);
    const subs = await loadSubscribers(store);
    let targets;
    if (job.mode === 'test') {
      if (S.sent || S.failed.length) { job.stage = 'done'; return true; }
      const me = subs.find(s => s.email === cfg.senderUser && s.status === 'confirmed');
      targets = [{ id: '0'.repeat(32), token: 'test', email: cfg.senderUser, status: 'confirmed', criteria: me ? me.criteria : null }];
    } else {
      const since = reportStartMs(job.id);
      targets = subs.filter(s => s.status === 'confirmed' && !(s.lastWeeklySentAt && Date.parse(s.lastWeeklySentAt) >= since) && !S.failed.includes(s.id))
        .sort((a, b) => a.email.localeCompare(b.email));
    }
    const cache = new Map();
    const reportFor = async s => {
      const n = s.criteria ? normalizeCriteria(s.criteria) : null;
      const key = n && n.criteria ? criteriaKey(n.criteria) : null;
      const g = key ? manifest.groups[key] : manifest.groups[manifest.defaultKey];
      if (!g) return null;
      if (!cache.has(g.webId)) {
        cache.set(g.webId, {
          reportHtml: await store.getText(`${P.reports}/${g.webId}.html`),
          content: await store.getBytes(`${P.reports}/${g.webId}.xlsx`),
        });
      }
      const f = cache.get(g.webId);
      return { reportHtml: f.reportHtml, xlsx: f.content ? { filename: XLSX_NAME, content: Buffer.from(f.content) } : null, criteria: key ? g.criteria : null, webUrl: `${cfg.siteUrl}/${g.web}` };
    };
    let tx = null;
    for (const s of targets) {
      if (ctx.left() < 20e3) break;
      const rep = await reportFor(s);
      if (!rep || !rep.reportHtml) { S.missing++; if (job.mode !== 'test') S.failed.push(s.id); continue; }   // 보고서 생성 뒤 신청·변경한 조건 — 다음 주
      try {
        tx = tx || await createTransport(cfg);
        await tx.sendMail({ from: fromHeader(cfg), to: s.email, ...weeklyMail(cfg, s, { today: job.id, ...rep }) });
        if (job.mode !== 'test') {
          const cur = await store.get(recordPath(s.id));
          if (cur) await store.put(recordPath(s.id), { ...cur, lastWeeklySentAt: new Date().toISOString() });
        }
        S.sent++;
      } catch (e) {
        S.failed.push(s.id);
        note(job, `발송 실패(${s.email.slice(0, 2)}***): ${String(e.message || e).slice(0, 120)}`);
        if (job.mode === 'test') break;
      }
      await sleep(1000);
    }
    const remaining = job.mode === 'test' ? 0 : targets.filter(s => !S.failed.includes(s.id)).length - S.sent;
    if (job.mode !== 'test' && ctx.left() < 20e3 && remaining > 0) { note(job, `메일 ${S.sent}건 발송 — 이어서`); return false; }
    note(job, `메일 발송 ${S.sent}건${S.failed.length ? ` · 실패/보류 ${S.failed.length}건` : ''}${S.missing ? ` · 조건 보고서 없음 ${S.missing}명(다음 주)` : ''}`);
    await cleanup(store, job, P);
    job.stage = 'done';
    return true;
  },
};

async function ensureAsOf(ctx, complexes) {
  const { job } = ctx;
  if (job.asOf) return;
  for (const c of complexes.filter(x => x.types.some(t => t.provided)).slice(0, 3)) {
    try { job.asOf = await withRetry(() => ctx.kb.asOf(c.id, c.types.find(t => t.provided).areaId), 2); } catch { /* 다음 단지 */ }
    if (job.asOf) return;
  }
  job.asOf = '';
}

async function latestSnapshotBefore(store, P, id) {
  const names = (await store.list(`${P.data}/`)).map(p => p.slice(P.data.length + 1)).filter(n => /^\d{4}-\d{2}-\d{2}\.json$/.test(n) && n.slice(0, 10) < id).sort();
  return names.length ? store.get(`${P.data}/${names[names.length - 1]}`) : null;
}

/** 작업 조각 삭제 + 오래된 보고서 정리(최근 8주만) */
async function cleanup(store, job, P) {
  try {
    for (const p of await store.list(`${P.work}/`)) await store.del(p);
    const base = job.mode === 'test' ? 'weekly/test/reports/' : 'weekly/reports/';
    const all = await store.list(base);
    const dates = [...new Set(all.map(p => p.slice(base.length, base.length + 10)).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)))].sort();
    const drop = new Set(dates.slice(0, Math.max(0, dates.length - (job.mode === 'test' ? 1 : KEEP_WEEKS))));
    for (const p of all) if (drop.has(p.slice(base.length, base.length + 10))) await store.del(p);
  } catch (e) { note(job, `정리 실패(무시): ${e.message}`); }
}

// ── 실행 ──────────────────────────────────────────────────────
/** 한 번 실행 — 저장된 작업을 시간 예산 안에서 이어 감. { ran, done, failed } */
export async function runJob({ store, env = process.env, origin, now = () => Date.now() }) {
  const started = now();
  let job = await store.get(JOB_PATH);
  if (!job || job.done || job.failed) return { ran: false, reason: 'no job' };
  if (job.leaseUntil && Date.parse(job.leaseUntil) > started) return { ran: false, reason: 'running' };
  job.leaseUntil = new Date(started + 295e3).toISOString();
  job.invocations++;
  await store.put(JOB_PATH, job);
  let dirCache = null;
  const ctx = {
    store, job, env, origin, P: pathsFor(job),
    kb: createKbClient({ headers: KB_HEADERS }),
    left: () => started + BUDGET_MS - now(),
    dir: async () => (dirCache = dirCache || (await (await fetch(`${origin}/kb-seoul-complexes.json`)).json()).complexes),
  };
  try {
    while (!job.done && ctx.left() > 15e3) {
      const stage = job.stage;
      if (stage === 'done') { job.done = true; job.finishedAt = new Date().toISOString(); break; }
      const finished = await STAGES[stage](ctx);
      job.attempts = 0;
      job.error = null;
      job.updatedAt = new Date().toISOString();
      if (job.stage === 'done') { job.done = true; job.finishedAt = job.updatedAt; }
      await store.put(JOB_PATH, job);
      if (!finished) break;
    }
  } catch (e) {
    job.attempts++;
    job.error = String((e && e.message) || e).slice(0, 300);
    note(job, `${job.stage} 단계 오류(${job.attempts}/3): ${job.error}`);
    if (job.attempts >= 3) job.failed = true;
  }
  job.leaseUntil = null;
  job.updatedAt = new Date().toISOString();
  await store.put(JOB_PATH, job);
  if (job.done || job.failed) await recordFinished(store, job).catch(e => console.error('[weekly] 작업 기록 저장 실패:', e.message));
  return { ran: true, done: job.done, failed: job.failed, stage: job.stage };
}

/** 끝난 작업 요약을 이력으로 남기고, 운영 실행이면 이번 주 운영 기록을 갱신 */
async function recordFinished(store, job) {
  await store.put(`${JOB_HISTORY_PREFIX}${job.id}-${job.mode}.json`, jobSummary(job));
  if (job.mode === 'full') {
    await store.put(LAST_FULL_PATH, {
      id: job.id, startedAt: job.startedAt, finishedAt: job.finishedAt || null, done: !!job.done, failed: !!job.failed,
      error: job.error || null, sent: job.sendState ? job.sendState.sent : 0, asOf: job.asOf || null,
    });
  }
}

/** 관리자가 시작 — mode 'full'(이번 주 보고서, 구독자 발송) | 'test'(보내는 계정 본인에게만) */
export async function startJob(store, { mode = 'test', force = false, now = new Date() } = {}) {
  const cur = await store.get(JOB_PATH);
  const busy = cur && !cur.done && !cur.failed && Date.now() - Date.parse(cur.updatedAt) < STALE_MS;
  if (busy && !force) return { ok: false, error: `이미 진행 중인 작업이 있습니다(${cur.mode === 'test' ? '시험' : '운영'} ${cur.id} · ${cur.stage} 단계)` };
  // 멈춘(10분 넘게 갱신 없는) 운영 실행도 시험 실행으로 덮어쓰면 크론이 이어 갈 수 없어짐 → 끝나거나 실패할 때까지 막음
  if (mode !== 'full' && cur && cur.mode === 'full' && !cur.done && !cur.failed && !force) {
    return { ok: false, error: `끝나지 않은 운영 실행이 있습니다(${cur.id} · ${cur.stage} 단계) — 크론이 이어 가거나, 이어 가기를 누른 뒤 시험하세요` };
  }
  const id = mode === 'test' ? kstDate(now) : weekStartId(now);
  const job = newJob(id, mode === 'full' ? 'full' : 'test', now);
  note(job, `${mode === 'full' ? '운영' : '시험'} 실행 시작(관리자)`);
  await store.put(JOB_PATH, job);
  if (job.mode === 'full') await store.put(LAST_FULL_PATH, { id, startedAt: job.startedAt, done: false, failed: false });
  return { ok: true, job: jobSummary(job) };
}

/**
 * 매일 크론(08:30 한국 시간 전후)
 *  · 구독자에게는 「매주 월요일 아침 발송」으로 안내하므로 이번 주 운영 실행은 **월요일에만 시작**(2026-09-16 변경)
 *  · 화·수요일 크론은 월요일에 시작해 끝나지 않은 작업만 이어 감(10분 넘게 멈춘 경우)
 *  · 월요일 크론을 놓쳤을 때 늦게라도 보내려면 weekly/config.json 의 lateStartUntilDay(2=화, 3=수)를 켜거나 관리자 페이지에서 직접 시작
 *  · 그 밖에 구독 확인 메일 재발송·7일 지난 미확인 신청 삭제
 */
export async function cronTick(store, env = process.env, origin, now = new Date()) {
  const maintenance = await dailyMaintenance(store, env, origin, now).catch(e => ({ error: String(e.message || e) }));
  const job = await store.get(JOB_PATH);
  const lastFull = await store.get(LAST_FULL_PATH);
  const weekId = weekStartId(now);
  const day = kstDay(now);
  // job.json 은 시험 실행이 덮어쓸 수 있어, 이번 주 운영 기록(last-full)도 함께 봄 — 같은 주 두 번 발송 방지
  const hasThisWeek = !!((job && job.mode === 'full' && job.id === weekId) || (lastFull && lastFull.id === weekId));
  const busy = job && !job.done && !job.failed;
  if (busy) {
    const stale = Date.now() - Date.parse(job.updatedAt) > STALE_MS;
    return { run: stale, resumed: stale ? job.id : null, stage: job.stage, maintenance };
  }
  if (!hasThisWeek) {
    const cfg = (await store.get('weekly/config.json').catch(() => null)) || {};
    const lateUntil = Number(cfg.lateStartUntilDay) || 0;   // 0이면 월요일에만 시작
    const late = day > WEEKLY_START_DAY && day <= lateUntil;
    if (day === WEEKLY_START_DAY || late) {
      const fresh = newJob(weekId, 'full', now);
      note(fresh, late ? '주간 운영 실행 늦게 시작(크론 — 월요일을 놓침)' : '주간 운영 실행 시작(크론 · 월요일)');
      await store.put(JOB_PATH, fresh);
      await store.put(LAST_FULL_PATH, { id: weekId, startedAt: fresh.startedAt, done: false, failed: false });
      return { run: true, started: weekId, late, maintenance };
    }
    // 월요일을 놓친 채 지나가는 중 — 관리자 페이지에서 직접 시작할 수 있도록 상태에 남김
    if (day > WEEKLY_START_DAY && day <= 5) return { run: false, missedMonday: weekId, maintenance };
  }
  return { run: false, maintenance };
}

/** 구독 신청 직후 보내지 못한 확인·조건 변경 메일 다시 보내기, 7일 지난 미확인 신청 삭제 */
export async function dailyMaintenance(store, env, origin, now = new Date()) {
  const cfg = { ...mailConfigFromEnv(env) };
  if (!cfg.siteUrl) cfg.siteUrl = origin;
  const subs = await loadSubscribers(store);
  let deleted = 0, sent = 0, tx = null;
  for (const s of subs) {
    if (s.status === 'pending' && now.getTime() - Date.parse(s.createdAt) > PENDING_TTL_MS) { await store.del(recordPath(s.id)); deleted++; continue; }
    const kind = s.status === 'pending' && !s.confirmMailSentAt ? 'confirm'
      : s.status === 'confirmed' && s.pendingCriteria && !s.changeMailSentAt ? 'change' : null;
    if (!kind || !canSend(cfg)) continue;
    try {
      tx = tx || await createTransport(cfg);
      await tx.sendMail({ from: fromHeader(cfg), to: s.email, ...(kind === 'change' ? changeMail(cfg, s) : confirmMail(cfg, s)) });
      await store.put(recordPath(s.id), { ...s, [kind === 'change' ? 'changeMailSentAt' : 'confirmMailSentAt']: new Date().toISOString() });
      sent++;
    } catch { /* 다음 날 다시 */ }
  }
  return { deleted, sent };
}

export function jobSummary(job) {
  if (!job) return null;
  const { plan, render, ...rest } = job;
  return {
    ...rest,
    groups: plan ? plan.groups.length : null,
    gus: plan ? plan.gus : null,
    reports: render ? Object.values(render.manifest.groups).map(g => ({ label: g.label, web: g.web, subscribers: g.subscribers, complexCount: g.complexCount, best1: g.best1, isDefault: g.isDefault })) : null,
  };
}
