// 진가 주간 보고서 핵심 로직 — 보고서 조건 묶음 · 스냅샷 비교 · 지역 뉴스 · 시장 지표 · 호가 괴리 · KB 구별 집계 · 엑셀 시트
// Vercel 서버 발송 작업(api/_job.mjs)과 운영 PC 스크립트(scripts/weekly-report.mjs · build-kb-gu.mjs)가 같이 씀 — 파일 입출력 없음
// (scripts/gen 으로 기존 스크립트에서 옮겨 온 코드. 고칠 때는 이 파일을 고치세요)
import { createHash } from 'node:crypto';
import { isReliableAsk, buildSearchSheets } from '../jinga-kb.mjs';
import { SEOUL_GUS, criteriaKey, normalizeCriteria } from './_core.mjs';

export const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
export const KB_HEADERS = { 'User-Agent': UA, Referer: 'https://kbland.kr/', Accept: 'application/json' };
const MACRO_BASE = 'https://jinga-korea-macro.tjtlswns95.workers.dev';
const PYEONG = 3.3058;
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const kstDate = (d = new Date()) => new Date(d.getTime() + 9 * 3600e3).toISOString().slice(0, 10);
const fmtD = d => `${d.getMonth() + 1}/${d.getDate()}`;

/** 실패하면 1.5초·3초 쉬고 다시(최대 tries회) */
export async function withRetry(fn, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (e) { last = e; if (i < tries - 1) await sleep(1500 * (i + 1)); }
  }
  throw last;
}

export const DEFAULT_CONFIG = {
  budgetMinEok: 0,        // 예산 하한(억) — 0이면 하한 없음
  budgetEok: 13,          // 예산 상한(억)
  gus: ['강동구', '송파구', '광진구', '성동구', '동작구'],
  minArea: 59,            // 전용면적 하한(㎡)
  maxArea: 0,             // 전용면적 상한(㎡, 정수부 기준) — 0이면 상한 없음
  priceBasis: 'ask',      // 예산 판단 기준 — 'ask' KB 매물 호가 평균(매물 없으면 KB시세) | 'kb' KB 일반거래가
  minHouseholds: 300,
  maxRentPct: 30,         // 임대세대 비율 상한(%) — 0이면 제한 없음. 임대 비중이 큰 단지는 거래가 드물어 따로 가립니다
  skipSmall: true,
  concurrency: 4,
  newsPerGu: 6,
};

// ── 보고서 조건 묶음 ───────────────────────────────────────────
export const MAX_GROUPS = 60;   // 조건 종류 상한 — 넘으면 KB 요청이 과해져 나머지는 다음 주로

/** config.json·구독자 조건(억·㎡) → jinga-kb 평가 조건(만원) */
export function toKbCriteria(c) {
  const k = {
    budget: Math.round(c.budgetEok * 10000),
    budgetMin: Math.round((c.budgetMinEok || 0) * 10000),
    minArea: c.minArea || 0,
    maxArea: c.maxArea || 0,
    minHh: c.minHouseholds || 0,
    basis: c.priceBasis === 'kb' ? 'kb' : 'ask',
    maxRentPct: c.maxRentPct || 0,
  };
  if (k.budgetMin > k.budget) throw new Error('예산 하한(budgetMinEok)이 상한(budgetEok)보다 큽니다');
  if (k.maxArea && k.minArea > k.maxArea) throw new Error('면적 하한(minArea)이 상한(maxArea)보다 큽니다');
  return k;
}
const pickCriteria = c => ({ gus: SEOUL_GUS.filter(g => c.gus.includes(g)), budgetMinEok: c.budgetMinEok || 0, budgetEok: c.budgetEok, minArea: c.minArea || 0, maxArea: c.maxArea || 0, minHouseholds: c.minHouseholds || 0, priceBasis: c.priceBasis === 'kb' ? 'kb' : 'ask' });

/** 만들 보고서 목록 — 기본 조건(config.json: 조건 없는 구독자·시험 발송용) + 구독 확인된 구독자 조건별(같은 조건끼리 하나) */
export function planGroups(cfg, subscribers = []) {
  const base = pickCriteria(cfg);
  const baseKey = criteriaKey(base);
  const groups = new Map([[baseKey, { key: baseKey, criteria: base, isDefault: true, subscribers: 0 }]]);
  let skipped = 0;
  for (const s of subscribers) {
    if (s.status !== 'confirmed') continue;
    const n = s.criteria ? normalizeCriteria(s.criteria) : null;
    const c = n && n.criteria ? n.criteria : base;
    const key = criteriaKey(c);
    if (!groups.has(key)) {
      if (groups.size >= MAX_GROUPS) { skipped++; continue; }
      groups.set(key, { key, criteria: c, isDefault: false, subscribers: 0 });
    }
    groups.get(key).subscribers++;
  }
  return { groups: [...groups.values()], skipped };
}
export const groupDirName = key => createHash('sha256').update(key).digest('hex').slice(0, 10);

// ── 스냅샷 · 주간 비교 ─────────────────────────────────────────
// 파일 형식: { date, asOf, gus, complexes:{ id:{ name, gu, dong, types } }, groups:{ 조건키:{ criteria, gus, complexCount, qualifying, best5 } } }
export function snapComplexes(complexes) {
  const out = {};
  for (const c of complexes) {
    out[c.id] = {
      name: c.name, gu: c.gu, dong: c.dong,
      // [전용㎡, KB 일반가, KB 전세가, KB 하위, KB 상위, 세대수] — 만원
      types: c.types.filter(t => t.provided).map(t => [Math.round(t.excl * 100) / 100, t.price, t.jeonse, t.lo, t.hi, t.hh]),
    };
  }
  return out;
}
export const groupEntry = result => ({
  complexCount: result.complexCount,
  qualifying: result.qualifying.map(e => `${e.c.id}|${Math.round(e.t.excl)}`),
  best5: result.best5.map(e => ({ id: e.c.id, name: e.c.name, excl: e.t.excl, price: e.t.price, score: e.score.total })),
});

/** 조건 하나짜리 스냅샷(비교 단위) */
export function makeSnapshot(date, asOf, criteria, gus, complexes, result) {
  return { date, asOf, criteria, gus, complexes: snapComplexes(complexes), ...groupEntry(result) };
}

/** 여러 조건 스냅샷에서 조건 하나의 비교 단위를 꺼냄 — 그 조건 기록이 없으면 시세 비교만(편입·이탈·순위 없음) */
export function snapshotView(snap, key, gus) {
  if (!snap) return null;
  let g = snap.groups ? snap.groups[key] : null;
  if (!snap.groups && snap.criteria) {   // 2026-09-14 이전 형식 — 기본 조건 하나만 기록
    const c = snap.criteria;
    const legacy = criteriaKey({ gus: snap.gus || [], budgetMinEok: (c.budgetMin || 0) / 10000, budgetEok: c.budget / 10000, minArea: c.minArea || 0, maxArea: c.maxArea || 0, minHouseholds: c.minHh || 0, priceBasis: c.basis });
    if (legacy === key) g = snap;
  }
  return {
    date: snap.date, asOf: snap.asOf, gus,
    complexes: Object.fromEntries(Object.entries(snap.complexes).filter(([, c]) => gus.includes(c.gu))),
    complexCount: g ? g.complexCount : undefined, qualifying: g ? g.qualifying : undefined, best5: g ? g.best5 : undefined,
  };
}

function guAverages(snap) {
  const acc = {};
  for (const c of Object.values(snap.complexes)) {
    for (const t of c.types) {
      if (!(t[0] > 0) || !(t[1] > 0)) continue;
      const a = acc[c.gu] = acc[c.gu] || { sum: 0, n: 0 };
      a.sum += t[1] / (t[0] / PYEONG);   // 전용 평당 KB 일반가(만원)
      a.n++;
    }
  }
  return Object.fromEntries(Object.entries(acc).map(([g, a]) => [g, Math.round(a.sum / a.n)]));
}

export function diffSnapshots(prev, cur) {
  const curAvg = guAverages(cur);
  if (!prev) {
    return { prevDate: null, rankCompared: false, guAvg: Object.entries(curAvg).map(([gu, v]) => ({ gu, cur: v, prev: null, pct: null })),
      up: [], down: [], changed: 0, compared: 0, entered: [], exited: [], prevBest: [], prevCount: null };
  }
  const rankCompared = Array.isArray(prev.qualifying);   // 지난주에 같은 조건 보고서가 있었는지(새 조건이면 시세 변동만 비교)
  const prevAvg = guAverages(prev);
  const prevTypes = new Map();
  for (const [id, c] of Object.entries(prev.complexes)) for (const t of c.types) prevTypes.set(`${id}|${Math.round(t[0])}`, t);
  const movers = [];
  let compared = 0;
  for (const [id, c] of Object.entries(cur.complexes)) {
    for (const t of c.types) {
      const p = prevTypes.get(`${id}|${Math.round(t[0])}`);
      if (!p || !(p[1] > 0) || !(t[1] > 0)) continue;
      compared++;
      if (p[1] !== t[1]) movers.push({ id, name: c.name, gu: c.gu, excl: t[0], from: p[1], to: t[1], pct: (t[1] - p[1]) / p[1] * 100 });
    }
  }
  movers.sort((a, b) => b.pct - a.pct);
  const label = (snap, key) => {
    const [id, a] = key.split('|');
    const c = snap.complexes[id];
    return { key, name: c ? c.name : id, gu: c ? c.gu : '', excl: Number(a) };
  };
  const pq = new Set(prev.qualifying || []), cq = new Set(cur.qualifying);
  return {
    prevDate: prev.date,
    rankCompared,
    prevCount: rankCompared ? prev.complexCount ?? null : null,
    guAvg: Object.entries(curAvg).map(([gu, v]) => ({ gu, cur: v, prev: prevAvg[gu] ?? null, pct: prevAvg[gu] ? (v - prevAvg[gu]) / prevAvg[gu] * 100 : null })),
    up: movers.filter(m => m.pct > 0).slice(0, 5),
    down: movers.filter(m => m.pct < 0).slice(-5).reverse(),
    changed: movers.length,
    compared,
    entered: rankCompared ? [...cq].filter(k => !pq.has(k)).map(k => label(cur, k)) : [],
    exited: rankCompared ? [...pq].filter(k => !cq.has(k)).map(k => label(prev, k)) : [],
    prevBest: rankCompared ? prev.best5 || [] : [],
  };
}


// ── 주변환경 동향: 구글 뉴스 RSS(최근 7일) ────────────────────────
function decodeEntities(s) {
  return String(s)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

export function parseNewsRss(xml) {
  const items = [];
  for (const m of String(xml).matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const pick = tag => {
      const mm = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`).exec(m[1]);
      return mm ? decodeEntities(mm[1].replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/, '$1').trim()) : '';
    };
    const raw = pick('title');
    const idx = raw.lastIndexOf(' - ');
    const date = new Date(pick('pubDate'));
    if (!raw || isNaN(date)) continue;
    items.push({ title: idx > 0 ? raw.slice(0, idx) : raw, src: pick('source') || (idx > 0 ? raw.slice(idx + 3) : ''), link: pick('link'), date });
  }
  return items;
}

async function fetchNews(query) {
  const url = 'https://news.google.com/rss/search?' + new URLSearchParams({ q: `${query} when:7d`, hl: 'ko', gl: 'KR', ceid: 'KR:ko' });
  const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'ko-KR,ko;q=0.9' }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error('google news http ' + r.status);
  return parseNewsRss(await r.text());
}

const NEWS_QUERIES = [
  '재건축 OR 재개발 OR 정비사업 OR 리모델링',
  '지하철 OR GTX OR 역세권 OR 도로 OR 철도',
  '개발 OR 학교 OR 공원 OR 상권 OR 착공',
];
// 분류는 검색어가 아니라 "기사 제목"의 키워드로 — 제목에 해당 키워드가 없으면(상품권·행사·복지 등) 버림
export const NEWS_TOPICS = [
  ['정비사업', /재건축|재개발|정비사업|정비구역|리모델링|조합설립|관리처분|사업시행|이주|철거|모아타운|신속통합/],
  ['교통', /지하철|GTX|역세권|철도|노선|개통|연장선|경전철|트램|광역버스|도로\s?(확장|개설|신설)|IC|나들목|착공.*(역|선)/],
  // '공원·병원·학교'는 조성·신설·개교처럼 시설이 생기거나 바뀌는 말과 함께일 때만, '개발'은 회사명(○○개발) 대신 사업·계획·복합개발 등으로
  ['개발·생활환경', /개발\s?(사업|계획|구역|호재|추진|본격|방식|부담금)|복합\s?개발|현대화\s?사업|착공|준공|용적률|지구단위|도시계획|정비계획|상권\s?활성화|분양|입주|(공원|녹지|학교|병원|도서관|체육관|쉼터|복합시설)[^,.…·]{0,8}(조성|신설|개교|개원|건립|유치|착공|준공)/],
];
const POLICY_RE = /대출|DSR|LTV|주담대|공급|세제|종부세|양도세|취득세|보유세|청약|규제|분양|전세|임대|주택|토지거래|공시가격/;
const NOISE_RE = /지지율|여론조사|국정감사\s?일정|포토|\[사진\]|부고|인사\]|축제|마라톤|기부|수상|최우수상|봉사|교수|주식|담보|수취|공시\)/;
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function classifyNews(title) {
  if (NOISE_RE.test(title)) return null;
  const hit = NEWS_TOPICS.find(([, re]) => re.test(title));
  return hit ? hit[0] : null;
}

// 같은 사건을 여러 언론사가 쓴 기사는 하나만 — 제목 글자 2-gram 유사도(Jaccard) 0.45 이상이면 중복으로 봄
const bigrams = s => { const t = s.replace(/[^가-힣A-Za-z0-9]/g, ''); const g = new Set(); for (let i = 0; i < t.length - 1; i++) g.add(t.slice(i, i + 2)); return g; };
export function isSameStory(a, b) {
  const A = bigrams(a), B = bigrams(b);
  if (!A.size || !B.size) return false;
  let inter = 0;
  A.forEach(x => { if (B.has(x)) inter++; });
  return inter / (A.size + B.size - inter) >= 0.45;
}
function pushUnique(list, item) {
  if (list.some(x => isSameStory(x.title, item.title))) return false;
  list.push(item);
  return true;
}

export async function collectNews(cfg, dir) {
  const cutoff = Date.now() - 8 * 24 * 3600e3;
  const byGu = {}, errors = [];
  for (const gu of cfg.gus) {
    const short = gu.replace(/구$/, '');
    const dongs = [...new Set(dir.filter(c => c[2] === gu).map(c => c[3]).filter(d => d && d.length >= 2))];
    const place = new RegExp([gu, short.length >= 2 ? short : null, ...dongs].filter(Boolean).map(escRe).join('|'));
    const list = [];
    for (const q of NEWS_QUERIES) {
      try {
        for (const it of await fetchNews(`${gu} (${q})`)) {
          if (it.date.getTime() < cutoff || !place.test(it.title)) continue;
          const tag = classifyNews(it.title);
          if (tag) pushUnique(list, { ...it, tag });
        }
      } catch (e) { errors.push(`${gu}: ${e.message || e}`); }
      await sleep(600);
    }
    // 정비사업 → 교통 → 개발·생활환경 순으로 우선, 같은 분류 안에서는 최신순
    const order = Object.fromEntries(NEWS_TOPICS.map(([t], i) => [t, i]));
    list.sort((a, b) => order[a.tag] - order[b.tag] || b.date - a.date);
    byGu[gu] = list.slice(0, cfg.newsPerGu);
  }
  const policy = [];
  for (const q of ['부동산 정책', '주택담보대출 규제', '주택 공급 대책']) {
    try {
      for (const it of await fetchNews(q)) {
        if (it.date.getTime() < cutoff || NOISE_RE.test(it.title) || !POLICY_RE.test(it.title)) continue;
        pushUnique(policy, it);
      }
    } catch (e) { errors.push(`정책 ${q}: ${e.message || e}`); }
    await sleep(600);
  }
  policy.sort((a, b) => b.date - a.date);
  return { byGu, policy: policy.slice(0, 8), errors };
}

// ── 시장 지표: 진가 Worker(한국부동산원 주간지수·금감원 주담대) — 기준금리(ECOS)는 Worker에서 404로 막혀 제외(2026-09-15) ──
export async function fetchMacro() {
  const get = async p => {
    try {
      const r = await fetch(MACRO_BASE + p, { signal: AbortSignal.timeout(25000) });
      const j = await r.json();
      return j.ok ? { data: j.data, stale: !!j.stale } : { error: j.error || 'http ' + r.status };
    } catch (e) { return { error: String(e.message || e) }; }
  };
  const [housing, mortgage] = await Promise.all([get('/housing/weekly'), get('/rate/mortgage')]);
  return { housing, mortgage };
}

// ── 호가 vs KB시세 괴리 ──────────────────────────────────────
/** 믿을 수 있는 호가 평균(매물 2건 이상·KB 대비 +50% 이하)의 KB 대비 괴리(%) — 큰 순, 중앙값과 제외한 이상치 수
 *  only: 이 조건의 예산 근처 면적(Set) — 다른 조건 때문에 받아 둔 호가는 빼고 셈 */
export function askGapStats(complexes, only = null) {
  const rows = [];
  let excluded = 0;
  for (const c of complexes) {
    for (const t of c.types) {
      if (only && !only.has(t)) continue;
      if (!t.listing || !(t.listing.askCount > 0)) continue;
      if (!isReliableAsk(t)) { excluded++; continue; }
      rows.push({ c, t, gap: (t.listing.askAvg / t.price - 1) * 100 });
    }
  }
  rows.sort((a, b) => b.gap - a.gap);
  const s = rows.map(r => r.gap).sort((a, b) => a - b), m = s.length >> 1;
  const medGap = s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : null;
  return { rows, count: rows.length, medGap, excluded };
}

// ── KB 구·동 평당가 집계(지역 지도 kb-seoul-gu.json) ─────────────────
/** complexes: [{ gu, dong, types:[compactKbTypes] }] → { seoul, gu:{ 이름:{ count, households, avgPerPyeong, dongs:[...] } } } */
export function aggregate(complexes) {
  const gu = {};
  let sW = 0, sPW = 0, n = 0;
  for (const c of complexes) {
    const g = gu[c.gu] = gu[c.gu] || { sW: 0, sPW: 0, complexes: 0, households: 0, dongs: {} };
    const d = g.dongs[c.dong] = g.dongs[c.dong] || { sW: 0, sPW: 0, complexes: 0, households: 0 };
    let used = false;
    for (const t of c.types) {
      if (!t.provided || !(t.price > 0) || !(t.excl > 0)) continue;
      const pp = t.price / (t.excl / PYEONG), w = t.hh || 1;
      g.sW += w; g.sPW += pp * w;
      d.sW += w; d.sPW += pp * w;
      sW += w; sPW += pp * w;
      g.households += t.hh || 0;
      d.households += t.hh || 0;
      used = true;
    }
    if (used) { g.complexes++; d.complexes++; n++; }
  }
  const avg = o => (o.sW ? Math.round(o.sPW / o.sW) : null);
  const out = { seoul: { count: n, avgPerPyeong: sW ? Math.round(sPW / sW) : null }, gu: {} };
  for (const [name, g] of Object.entries(gu)) {
    if (!g.complexes) continue;
    out.gu[name] = {
      count: g.complexes, households: g.households, avgPerPyeong: avg(g),
      dongs: Object.entries(g.dongs).filter(([, d]) => d.complexes)
        .map(([dn, d]) => ({ name: dn, count: d.complexes, households: d.households, avgPerPyeong: avg(d) }))
        .sort((a, b) => b.households - a.households),
    };
  }
  return out;
}

/** 비교 기준(직전 집계) 압축본 */
export function compactForCompare(data) {
  return {
    asOf: data.asOf,
    gu: Object.fromEntries(Object.entries(data.gu).map(([n, g]) => [n, {
      avg: g.avgPerPyeong, dongs: Object.fromEntries(g.dongs.map(d => [d.name, d.avgPerPyeong])),
    }])),
  };
}

/** 직전 집계와 비교해 구·동별 변동률(%)을 붙임 */
export function attachChange(cur, base) {
  if (!base) return cur;
  const pct = (a, b) => (a && b ? Math.round((a - b) / b * 10000) / 100 : undefined);
  for (const [name, g] of Object.entries(cur.gu)) {
    const b = base.gu[name];
    if (!b) continue;
    g.pct = pct(g.avgPerPyeong, b.avg);
    g.dongs.forEach(d => { d.pct = pct(d.avgPerPyeong, b.dongs && b.dongs[d.name]); });
  }
  cur.prevAsOf = base.asOf;
  return cur;
}

// ── 엑셀 시트(가격 변동·주변환경 뉴스 시트 추가) ─────────────────────
export function buildReportSheets({ cfg, criteria, today, asOf, complexes, result, diff, news }) {
  const sheets = buildSearchSheets({ criteria, gus: cfg.gus, asOf, complexes, result, title: `진가 주간 보고서 ${today}` });
  const head = cols => cols.map(v => ({ v, s: 'HEADER' }));
  sheets.splice(1, 0, {
    name: '가격 변동', colWidths: [22, 10, 10, 12, 12, 10],
    rows: [
      [{ v: `KB시세 주간 변동 (${diff.prevDate || '비교 기준 없음'} → ${today})`, s: 'TITLE' }],
      [{ v: diff.prevDate ? `비교 가능한 ${diff.compared}개 면적 중 ${diff.changed}개 변동` : '첫 보고서 — 다음 보고서부터 변동이 기록됩니다', s: 'SUBTITLE' }],
      head(['자치구', '이번 평당가(만)', '지난 평당가(만)', '변동']),
      ...diff.guAvg.map(g => [{ v: g.gu, s: 'TEXT' }, { v: g.cur, s: 'INT' }, { v: g.prev, s: 'INT' }, { v: g.pct == null ? null : g.pct / 100, s: 'PCT' }]),
      [],
      head(['단지', '자치구', '전용(㎡)', '지난 KB(억)', '이번 KB(억)', '변동']),
      ...[...diff.up, ...diff.down].map(m => [{ v: m.name, s: 'TEXT' }, { v: m.gu, s: 'TEXT' }, { v: m.excl, s: 'NUM2' }, { v: m.from / 10000, s: 'NUM2' }, { v: m.to / 10000, s: 'NUM2' }, { v: m.pct / 100, s: 'PCT' }]),
    ],
  });
  sheets.splice(2, 0, {
    name: '주변환경 뉴스', colWidths: [10, 12, 8, 70, 16, 40],
    rows: [
      [{ v: '최근 7일 지역·정책 뉴스', s: 'TITLE' }], [{ v: 'Google 뉴스 검색 — 자치구·법정동 이름이 제목에 들어간 기사', s: 'SUBTITLE' }],
      head(['자치구', '분류', '날짜', '제목', '언론사', '링크']),
      ...Object.entries(news.byGu).flatMap(([gu, list]) => list.map(n => [{ v: gu, s: 'TEXT' }, { v: n.tag, s: 'TEXT' }, { v: fmtD(n.date), s: 'CENTER' }, { v: n.title, s: 'TEXT' }, { v: n.src, s: 'TEXT' }, { v: n.link, s: 'TEXT' }])),
      ...news.policy.map(n => [{ v: '전체', s: 'TEXT' }, { v: '정책', s: 'TEXT' }, { v: fmtD(n.date), s: 'CENTER' }, { v: n.title, s: 'TEXT' }, { v: n.src, s: 'TEXT' }, { v: n.link, s: 'TEXT' }]),
    ],
  });
  return sheets;
}
