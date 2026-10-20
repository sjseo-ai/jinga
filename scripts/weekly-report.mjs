// 진가 주간 보고서 — KB시세 기반 예산 적합 단지(BEST 5)·가격 동향·시장 지표·주변환경(지역 뉴스) 동향
//   npm run report:weekly          (매주 자동 실행: scripts/weekly-report.bat 을 Windows 작업 스케줄러에 등록)
// 결과:  reports/YYYY-MM-DD/주간보고서.html · 진가_주간데이터.xlsx   — 기본 조건(reports/config.json) 보고서, reports/latest.html 은 그 사본
//        reports/YYYY-MM-DD/조건별/<조건ID>/…                      — 구독자가 사이트에서 정한 조건별 보고서(같은 조건끼리 하나)
//        site/public/r/YYYY-MM-DD/<base|조건ID>.html               — 웹 보기 사본(메일의 「웹에서 탭으로 보기」), 최근 8주만 보관
//        reports/YYYY-MM-DD/groups.json                          — 조건 → 보고서 폴더 목록(send-weekly-mail.mjs 가 읽음)
// 비교:  reports/data/YYYY-MM-DD.json 스냅샷 — 직전 스냅샷과 조건별로 비교해 가격 변동·신규 편입/이탈·순위 변화를 계산
// 시세:  같은 날 build-kb-gu.mjs 가 받은 서울 전체 KB시세(reports/cache/kb-types.json)를 재사용 — 없으면 필요한 자치구만 직접 조회
// KB·한국은행·구글 뉴스가 국내 접속에서 안정적이라 Cloudflare가 아니라 이 PC에서 돌립니다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createKbClient, runPool, evaluate, typeMatches, listingCandidates, prepareAsk } from '../site/public/jinga-kb.mjs';
import { buildXlsx } from '../site/public/xlsx-lite.mjs';
import { SEOUL_GUS, criteriaLabel } from '../site/public/api/_core.mjs';
import {
  DEFAULT_CONFIG, MAX_GROUPS, toKbCriteria, planGroups, groupDirName, snapComplexes, groupEntry, snapshotView, diffSnapshots,
  collectNews, fetchMacro, askGapStats, buildReportSheets, withRetry,
} from '../site/public/api/_weekly.mjs';
// 보고서 조건 묶음·스냅샷 비교·뉴스·지표·호가 괴리·엑셀 시트는 Vercel 서버 작업과 같이 쓰는 _weekly.mjs 에 있음(테스트·예전 경로 호환용으로 다시 내보냄)
export { DEFAULT_CONFIG, MAX_GROUPS, toKbCriteria, planGroups, groupDirName, makeSnapshot, snapshotView, diffSnapshots, parseNewsRss, NEWS_TOPICS, classifyNews, isSameStory, askGapStats } from '../site/public/api/_weekly.mjs';
import { readMailConfig, listSubscribers } from './mail-lib.mjs';
import { KB_TYPES_CACHE } from './build-kb-gu.mjs';
import { renderReportHtml } from './report-html.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPORTS = path.join(ROOT, 'reports');
const DATA_DIR = path.join(REPORTS, 'data');
const WEB_DIR = path.join(ROOT, 'site', 'public', 'r');   // 웹 보기 사본 — 주간 재배포 때 https://…/r/<날짜>/<조건ID>.html 로 올라감(시세·뉴스만, 구독자 정보 없음)
const WEB_KEEP_WEEKS = 8;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = msg => console.log(`[${new Date().toLocaleTimeString('ko-KR', { hour12: false })}] ${msg}`);
export const kstDate = (d = new Date()) => new Date(d.getTime() + 9 * 3600e3).toISOString().slice(0, 10);

export function loadConfig() {
  const f = path.join(REPORTS, 'config.json');
  if (!fs.existsSync(f)) {
    fs.mkdirSync(REPORTS, { recursive: true });
    fs.writeFileSync(f, JSON.stringify(DEFAULT_CONFIG, null, 2) + '\n');
  }
  return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(f, 'utf8')) };
}

// ── 지난 스냅샷(이 PC의 reports/data) ─────────────────────────────
function loadPrevSnapshot(today) {
  if (!fs.existsSync(DATA_DIR)) return null;
  const files = fs.readdirSync(DATA_DIR).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f) && f.slice(0, 10) < today).sort();
  return files.length ? JSON.parse(fs.readFileSync(path.join(DATA_DIR, files[files.length - 1]), 'utf8')) : null;
}

// ── 실행 ──────────────────────────────────────────────────────
function loadCachedComplexes(today, gus) {
  try {
    const c = JSON.parse(fs.readFileSync(KB_TYPES_CACHE, 'utf8'));
    if (kstDate(new Date(c.generatedAt)) !== today) return null;   // 오늘 받은 시세만
    return { asOf: c.asOf || '', complexes: c.complexes.filter(x => gus.includes(x.gu)).map(x => ({ ...x, brief: null })) };
  } catch { return null; }
}

async function loadSubscribers() {
  const mailCfg = readMailConfig();
  if (!mailCfg.adminSecret || !mailCfg.siteUrl) return [];
  try { return await listSubscribers(mailCfg); }
  catch (e) { log(`구독자 조건을 불러오지 못해 기본 조건 보고서만 만듭니다: ${e.message}`); return []; }
}

/** opts.subscribers — 구독자 목록을 직접 넣을 때(점검용). 없으면 관리 API에서 읽음 */
export async function main(opts = {}) {
  const t0 = Date.now();
  const cfg = loadConfig();
  const today = kstDate();
  try { toKbCriteria(cfg); } catch (e) { throw new Error(`config.json: ${e.message}`); }
  const conc = Math.min(cfg.concurrency || 3, 3);   // KB는 요청이 몰리면 일시 거부함

  const { groups, skipped } = planGroups(cfg, opts.subscribers ?? await loadSubscribers());
  if (skipped) log(`조건 종류가 ${MAX_GROUPS}개를 넘어 구독자 ${skipped}명은 이번 주 보고서에서 빠집니다`);
  const gus = SEOUL_GUS.filter(g => groups.some(x => x.criteria.gus.includes(g)));
  log(`보고서 ${groups.length}종(기본 조건 1 + 구독자 조건 ${groups.length - 1}) · 자치구 ${gus.join('·')}`);

  const dir = JSON.parse(fs.readFileSync(path.join(ROOT, 'site', 'public', 'kb-seoul-complexes.json'), 'utf8')).complexes;
  const kb = createKbClient({ headers: { 'User-Agent': UA, Referer: 'https://kbland.kr/', Accept: 'application/json' } });

  let complexes, asOf = '', failed = 0;
  const cached = cfg.skipSmall ? loadCachedComplexes(today, gus) : null;   // 캐시는 50세대 미만 제외본
  if (cached && cached.complexes.length) {
    ({ complexes, asOf } = cached);
    log(`KB시세 — 오늘 지역시세 집계에서 받은 ${complexes.length}개 단지 재사용(KB ${asOf || '기준일 미확인'})`);
  } else {
    const targets = dir.filter(c => gus.includes(c[2]) && !(cfg.skipSmall && c[4]));
    log(`KB시세 조회 — ${targets.length}개 단지`);
    const results = await runPool(targets, conc, async c => {
      try { await sleep(40); return { id: c[0], name: c[1], gu: c[2], dong: c[3], far: c[5] ?? null, bcr: c[6] ?? null, approved: c[11] ?? null,
        households: c[12] ?? null, rentUnits: c[13] ?? null,
        types: await withRetry(() => kb.types(c[0])), brief: null }; }
      catch (e) { failed++; throw e; }
    }, done => { if (done % 200 === 0 || done === targets.length) log(`  ${done}/${targets.length}`); });
    complexes = results.filter(Boolean);
  }
  if (!complexes.length) throw new Error('KB시세를 한 건도 받지 못했습니다(KB 조회 차단 또는 네트워크 문제)');

  // 조건마다 대상 단지·예산 근처 면적 — 매물 호가는 조건 전체에서 한 번씩만 조회
  const plans = groups.map(g => ({ ...g, crit: toKbCriteria(g.criteria), subset: complexes.filter(c => g.criteria.gus.includes(c.gu)), near: new Set() }));
  const pairs = new Map();
  for (const p of plans) for (const x of listingCandidates(p.subset, p.crit)) { p.near.add(x.t); pairs.set(x.t, x); }
  log(`매물 호가 조회 — 예산 근처 ${pairs.size}개 면적`);
  await runPool([...pairs.values()], conc, async ({ c, t }) => { try { t.listing = await withRetry(() => kb.listing(c.id, t.areaId), 2); } catch { t.listing = false; } });
  const needB = new Set();
  for (const p of plans) {
    if (p.crit.basis === 'ask') prepareAsk(p.subset);   // 매물 없음·표본 부족·이상치 면적의 추정 호가
    for (const c of p.subset) if (c.types.some(t => typeMatches(t, p.crit))) needB.add(c);
  }
  log(`후보 단지 정보 조회 — ${needB.size}곳`);
  await runPool([...needB], conc, async c => { try { c.brief = await withRetry(() => kb.brief(c.id), 2); } catch { c.brief = false; } });
  // KB 기준일 — 호가 조회 직후라 일시 거부될 수 있어 단지 3곳까지 재시도, 그래도 없으면 지역시세 집계 파일의 기준일
  for (const sample of complexes.filter(c => c.types.some(t => t.provided)).slice(0, asOf ? 0 : 3)) {
    try { asOf = await withRetry(() => kb.asOf(sample.id, sample.types.find(t => t.provided).areaId), 2); } catch { /* 다음 단지로 */ }
    if (asOf) break;
  }
  if (!asOf) { try { asOf = JSON.parse(fs.readFileSync(path.join(ROOT, 'site', 'public', 'kb-seoul-gu.json'), 'utf8')).asOf || ''; } catch { /* 기준일 없이 진행 */ } }

  log('시장 지표·지역 뉴스 수집');
  const [macro, news] = await Promise.all([fetchMacro(), collectNews({ ...cfg, gus }, dir)]);

  const prevSnap = loadPrevSnapshot(today);
  const snap = { date: today, asOf, gus, complexes: snapComplexes(complexes), groups: {} };
  const outRoot = path.join(REPORTS, today);
  const manifest = { date: today, asOf, defaultKey: null, groups: {} };
  const summary = [];
  // 조건마다 순서대로 — 추정 호가(prepareAsk)가 조건의 자치구 묶음에 따라 달라 평가·엑셀까지 한 조건씩 끝냄
  for (const p of plans) {
    const result = evaluate(p.subset, p.crit);
    const ask = askGapStats(p.subset, p.near);
    snap.groups[p.key] = { criteria: p.criteria, gus: p.criteria.gus, ...groupEntry(result) };
    const diff = diffSnapshots(snapshotView(prevSnap, p.key, p.criteria.gus), snapshotView(snap, p.key, p.criteria.gus));
    const groupNews = { byGu: Object.fromEntries(p.criteria.gus.map(g => [g, news.byGu[g] || []])), policy: news.policy, errors: news.errors };
    const outDir = p.isDefault ? outRoot : path.join(outRoot, '조건별', groupDirName(p.key));
    const webId = p.isDefault ? 'base' : groupDirName(p.key);
    writeGroupReport({ cfg: { ...cfg, gus: p.criteria.gus }, criteria: p.crit, today, asOf, complexes: p.subset, result, diff, macro, news: groupNews, t0, ask, outDir, webFile: path.join(WEB_DIR, today, `${webId}.html`) });
    if (p.isDefault) {
      manifest.defaultKey = p.key;
      fs.copyFileSync(path.join(outDir, '주간보고서.html'), path.join(REPORTS, 'latest.html'));
    }
    manifest.groups[p.key] = {
      dir: path.relative(outRoot, outDir).split(path.sep).join('/') || '.', criteria: p.criteria, label: criteriaLabel(p.criteria),
      web: `r/${today}/${webId}.html`, isDefault: p.isDefault, subscribers: p.subscribers, complexCount: result.complexCount, best1: result.best5[0] ? result.best5[0].c.name : null,
    };
    summary.push(`${p.isDefault ? '기본' : `구독자 ${p.subscribers}명`}: ${criteriaLabel(p.criteria)} → ${result.complexCount}곳 · 1위 ${result.best5[0] ? result.best5[0].c.name : '없음'}`);
  }
  // 웹 보기 사본은 최근 8주만(배포 용량)
  try {
    for (const d of fs.readdirSync(WEB_DIR).filter(x => /^\d{4}-\d{2}-\d{2}$/.test(x)).sort().slice(0, -WEB_KEEP_WEEKS)) fs.rmSync(path.join(WEB_DIR, d), { recursive: true, force: true });
  } catch { /* 아직 폴더 없음 */ }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, `${today}.json`), JSON.stringify(snap));
  fs.writeFileSync(path.join(outRoot, 'groups.json'), JSON.stringify(manifest, null, 2));

  summary.forEach(s => log(`  ${s}`));
  log(`완료 — 보고서 ${plans.length}종 · 조회 실패 ${failed}곳 · ${path.relative(ROOT, outRoot)} (${Math.round((Date.now() - t0) / 1000)}초)`);
  return { outDir: outRoot, manifest };
}

/** 조건 하나의 보고서 HTML·엑셀 */
function writeGroupReport({ cfg, criteria, today, asOf, complexes, result, diff, macro, news, t0, ask, outDir, webFile }) {
  fs.mkdirSync(outDir, { recursive: true });
  const html = renderReportHtml({ cfg, criteria, today, asOf, result, diff, macro, news, t0, ask });
  fs.writeFileSync(path.join(outDir, '주간보고서.html'), html);
  if (webFile) { fs.mkdirSync(path.dirname(webFile), { recursive: true }); fs.writeFileSync(webFile, html); }

  const sheets = buildReportSheets({ cfg, criteria, today, asOf, complexes, result, diff, news });
  fs.writeFileSync(path.join(outDir, '진가_주간데이터.xlsx'), buildXlsx(sheets));
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (invokedDirectly) {
  main().catch(e => { console.error('[주간보고서] 실패:', e); process.exit(1); });
}
