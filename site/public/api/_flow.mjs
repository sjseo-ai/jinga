// 시장 흐름 대시보드 데이터 — GET /api/market-flow (api/market-flow.mjs)
//   KB데이터허브(data-api.kbland.kr) 주택가격동향 — 비공식 엔드포인트, 키 없음. 브라우저 CORS는 data.kbland.kr만 허용이라 서버에서 받음
//     · priceIndex          매매(01)·전세(02) 가격지수 · 주간(월간주간구분코드 02) · 기간 3년 — dataList 끝에 주간 증감률 1개가 더 붙어 옴
//     · maktTrnd            메뉴코드 01 매수우위지수 · 02 매매거래지수 · 03 전세수급지수 · 04 전세거래지수 (0~200, 100 기준)
//     · dealCntstTnantRato  매매가격 대비 전세가격 비율(월간, %)
//     · leadApt50Indx       선도아파트 50 지수(월간) · 전월·전년동월 대비 증감률
//     · HAI                 주택구매력지수(월간, 지역 × 종합·아파트·단독·연립) + KB 주담대 금리
//   네이버 금융 시장금리(m.stock.naver.com front-api) — 국고채 3·10년·CD 91일(일별, 60행씩 페이지), COFIX 신규취급액(월별)
// 원천마다 따로 받아 하나가 실패해도 나머지는 보여주고, 실패한 부분은 직전에 받은 값을 계속 씀(errors 에 사유).

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
export const KB_BASE = 'https://data-api.kbland.kr/bfmstat/weekMnthlyHuseTrnd/';
export const NAVER_BASE = 'https://m.stock.naver.com/front-api/marketIndex/prices';
const KB_HEADERS = { 'User-Agent': UA, Referer: 'https://data.kbland.kr/', Origin: 'https://data.kbland.kr', Accept: 'application/json' };
const NAVER_HEADERS = { 'User-Agent': UA, Referer: 'https://m.stock.naver.com/', Accept: 'application/json' };

export const REGIONS = ['서울', '강남11개구', '강북14개구', '수도권', '전국', '경기', '인천'];
export const TREND_MENUS = { buyer: ['01', '매수우위지수'], trade: ['02', '매매거래지수'], jeonseSupply: ['03', '전세수급지수'], jeonseTrade: ['04', '전세거래지수'] };
export const RATES = {
  KR3YT: { name: '국고채 3년', category: 'bond', code: 'KR3YT=RR', pages: 13 },
  KR10YT: { name: '국고채 10년', category: 'bond', code: 'KR10YT=RR', pages: 13 },
  CD91: { name: 'CD 91일', category: 'domesticInterest', code: 'KFIA114000', pages: 13 },
  COFIX: { name: 'COFIX 신규취급액', category: 'domesticInterest', code: 'KRCOFIXMANF', pages: 1 },
};
export const MONTHS_KEPT = 72;

const num = v => {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};
const round = (v, d = 2) => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d);
/** '20260907' → '2026-09-07', '202608' → '2026-08' */
export const kbDate = s => {
  const t = String(s ?? '');
  return t.length === 8 ? `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6)}` : t.length === 6 ? `${t.slice(0, 4)}-${t.slice(4)}` : t;
};

function kbData(json) {
  if (!json || !json.dataHeader || json.dataHeader.resultCode !== '10000' || !json.dataBody || !json.dataBody.data) {
    const msg = [].concat(json?.dataBody?.data?.message || []).join(' ');
    throw new Error(`KB 응답 오류(${json?.dataHeader?.resultCode || '형식'})${msg ? ' ' + msg : ''}`);
  }
  return json.dataBody.data;
}
const pickRegions = list => (list || []).filter(x => REGIONS.includes(x.지역명));
/** 값 배열을 날짜 수에 맞춤 — 긴 쪽(끝에 붙은 증감률)은 자르고, 짧으면 앞을 null로 채움 */
function fit(vals, n, digits) {
  const out = (vals || []).slice(0, n).map(v => round(num(v), digits));
  while (out.length < n) out.unshift(null);
  return out;
}

/** priceIndex → { dates, updated, regions: { 서울: [지수…] } } */
export function parsePriceIndex(json) {
  const d = kbData(json);
  const dates = (d.날짜리스트 || []).map(kbDate);
  const regions = {};
  for (const x of pickRegions(d.데이터리스트)) regions[x.지역명] = fit(x.dataList, dates.length, 2);
  if (!dates.length || !regions.서울) throw new Error('KB 가격지수에 서울 시계열이 없습니다');
  return { dates, updated: kbDate(d.업데이트일자), regions };
}

/** maktTrnd → { dates, updated, regions: { 서울: [값…] } } — field: 매수우위지수·매매거래지수·전세수급지수·전세거래지수 */
export function parseMarketTrend(json, field) {
  const d = kbData(json);
  const dates = (d.날짜리스트 || []).map(kbDate);
  const regions = {};
  for (const x of pickRegions(d.데이터리스트)) {
    const byDate = new Map((x.dataList || []).map(o => [kbDate(o.기준날짜), round(num(o[field]), 2)]));
    regions[x.지역명] = dates.map(dt => byDate.get(dt) ?? null);
  }
  if (!dates.length || !regions.서울) throw new Error(`KB ${field}에 서울 시계열이 없습니다`);
  return { dates, updated: kbDate(d.업데이트일자), regions };
}

/** 다른 날짜축의 값을 기준 날짜축에 맞춤(없으면 null) */
export function alignSeries(targetDates, srcDates, vals) {
  const m = new Map((srcDates || []).map((dt, i) => [dt, vals ? vals[i] : null]));
  return targetDates.map(dt => m.get(dt) ?? null);
}

/** 월간 지역별 시계열(전세가율 등) → 최근 keep개월 */
export function parseMonthlyRegions(json, keep = MONTHS_KEPT) {
  const d = kbData(json);
  const all = (d.날짜리스트 || []).map(kbDate);
  const from = Math.max(0, all.length - keep);
  const regions = {};
  for (const x of pickRegions(d.데이터리스트)) regions[x.지역명] = fit(x.dataList, all.length, 2).slice(from);
  if (!all.length || !regions.서울) throw new Error('KB 월간 시계열에 서울이 없습니다');
  return { dates: all.slice(from), updated: kbDate(d.업데이트일자), regions };
}

/** 선도아파트 50 → { dates, index, mom, yoy } */
export function parseLead50(json, keep = MONTHS_KEPT) {
  const d = kbData(json);
  const all = (d.날짜리스트 || []).map(kbDate);
  if (!all.length) throw new Error('선도아파트 50 지수가 비어 있습니다');
  const from = Math.max(0, all.length - keep);
  const cut = (a, digits) => fit(a, all.length, digits).slice(from);
  return { dates: all.slice(from), updated: kbDate(d.업데이트일자), index: cut(d.선도50지수리스트, 2), mom: cut(d.전월대비증감률리스트, 2), yoy: cut(d.전년동월대비증감률리스트, 2) };
}

/** 주택구매력지수 → { dates, loanRate: [주담대 금리], apt: { 서울: [HAI…] } } — 아파트만 */
export function parseHai(json, keep = MONTHS_KEPT) {
  const d = kbData(json);
  const all = (d.날짜리스트 || []).map(kbDate);
  if (!all.length) throw new Error('주택구매력지수가 비어 있습니다');
  const from = Math.max(0, all.length - keep);
  const dates = all.slice(from);
  const rate = new Map((d.주담보월소득리스트 || []).map(o => [kbDate(o.기준날짜), round(num(o.주택담보대출금리), 2)]));
  const apt = {};
  for (const x of pickRegions(d.주택구매력리스트)) {
    const a = (x.지역구분리스트 || []).find(k => k.매물종별구분 === '아파트');
    if (a) apt[x.지역명] = fit(a.매물종별구분리스트, all.length, 1).slice(from);
  }
  if (!apt.서울) throw new Error('주택구매력지수에 서울 아파트가 없습니다');
  return { dates, updated: kbDate(d.업데이트일자), loanRate: dates.map(dt => rate.get(dt) ?? null), apt };
}

/** 네이버 시장금리 페이지들 → [['YYYY-MM-DD', 값], …] 오름차순·날짜 중복 제거 */
export function parseNaverRates(pages) {
  const byDate = new Map();
  for (const page of pages || []) {
    for (const row of (page && page.result) || []) {
      const dt = String(row.localTradedAt || '').slice(0, 10);
      const v = num(row.closePrice);
      if (/^\d{4}-\d{2}-\d{2}$/.test(dt) && v != null && !byDate.has(dt)) byDate.set(dt, round(v, 3));
    }
  }
  return [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

async function getJson(fetchImpl, url, headers, tries = 2) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(25000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      last = e;
      if (i < tries - 1) await new Promise(r => setTimeout(r, 800));
    }
  }
  throw last;
}

async function pool(items, n, fn) {
  let next = 0;
  const out = new Array(items.length);
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const k = next++;
      try { out[k] = { ok: true, value: await fn(items[k]) }; } catch (e) { out[k] = { ok: false, error: e }; }
    }
  }));
  return out;
}

async function loadRate(fetchImpl, key) {
  const def = RATES[key];
  const pages = [];
  for (let p = 1; p <= def.pages; p++) {
    const q = new URLSearchParams({ category: def.category, reutersCode: def.code, page: String(p), pageSize: '60' });
    const page = await getJson(fetchImpl, `${NAVER_BASE}?${q}`, NAVER_HEADERS);
    pages.push(page);
    if (!page || !Array.isArray(page.result) || page.result.length < 60) break;   // 마지막 페이지
  }
  const points = parseNaverRates(pages);
  if (points.length < 2) throw new Error(`${def.name} 시계열이 비어 있습니다`);
  return { name: def.name, points };
}

// ── 연도별 지표(원천 과거 시계열로 매번 계산) ────────────────────
export const WEEKS_KEPT = 160;                                      // 화면에 보내는 주간 시계열 길이(3년 보기 + 여유)
export const ANNUAL_REGIONS = ['서울', '강남11개구', '강북14개구', '수도권', '전국'];
const yearOf = d => Number(String(d).slice(0, 4));
const pctR = (a, b) => (a > 0 && b > 0 ? Math.round((a / b - 1) * 10000) / 100 : null);
function byYear(dates, vals) {
  const m = new Map();
  (dates || []).forEach((d, i) => {
    const v = vals ? vals[i] : null;
    if (v == null || !Number.isFinite(v)) return;
    const y = yearOf(d);
    if (!m.has(y)) m.set(y, []);
    m.get(y).push(v);
  });
  return m;
}
/** 연도별 변동률(%) — 그해 마지막 값 ÷ 전년 마지막 값 − 1 (올해는 최신 값, 즉 연초~기준일) */
export function yearChanges(dates, vals, years) {
  const m = byYear(dates, vals);
  return years.map(y => { const cur = m.get(y), prev = m.get(y - 1); return cur && prev ? pctR(cur[cur.length - 1], prev[prev.length - 1]) : null; });
}
/** 연평균 — 표본이 minCount 개 미만인 해는 null */
export function yearMeans(dates, vals, years, minCount = 1) {
  const m = byYear(dates, vals);
  return years.map(y => { const a = m.get(y); return a && a.length >= minCount ? Math.round((a.reduce((s, v) => s + v, 0) / a.length) * 100) / 100 : null; });
}
/** 그해 마지막 값 */
export function yearEnds(dates, vals, years) {
  const m = byYear(dates, vals);
  return years.map(y => { const a = m.get(y); return a ? a[a.length - 1] : null; });
}
/**
 * 원천 전체 시계열(주간 10년 · 월간 전체 · 금리)로 연도별 지표 — { years, ytdYear, asOf, regions:{ 지역:{saleChg, jeonseChg, buyerAvg, jeonseSupplyAvg, ratioEnd} }, lead50Chg, rates:{ 키:{name, avg} } }
 * 첫해는 직전 연말 값이 없어 변동률을 못 구하므로 주간 매매지수 시작 다음 해부터
 */
export function buildAnnual(got, rates = {}) {
  const base = got.sale || got.jeonse;
  if (!base || !base.dates.length) return null;
  const asOf = base.dates[base.dates.length - 1];
  const years = [];
  for (let y = yearOf(base.dates[0]) + 1; y <= yearOf(asOf); y++) years.push(y);
  const series = (src, r, fn) => (src && src.regions[r] ? fn(src.dates, src.regions[r], years) : null);
  const regions = {};
  for (const r of ANNUAL_REGIONS) {
    const row = {
      saleChg: series(got.sale, r, yearChanges),
      jeonseChg: series(got.jeonse, r, yearChanges),
      buyerAvg: series(got.buyer, r, yearMeans),
      jeonseSupplyAvg: series(got.jeonseSupply, r, yearMeans),
      ratioEnd: series(got.ratio, r, yearEnds),
    };
    if (Object.values(row).some(Boolean)) regions[r] = row;
  }
  // 금리 연평균 — 받을 수 있는 기간이 연중에 시작하면 몇 달치 평균이 한 해 값처럼 보이므로(2026-09-15 실데이터: COFIX 2021년 9~12월만 1.25%)
  // 지난 해는 거의 한 해치(일별 150일 · 월별 10개월), 올해(연초~기준일)는 일별 20일 · 월별 3개월 이상일 때만
  const ytdYear = yearOf(asOf);
  const rateAvg = {};
  for (const [k, def] of Object.entries(RATES)) {
    const pts = rates[k] && rates[k].points;
    if (!pts || !pts.length) continue;
    const monthly = k === 'COFIX';
    const past = yearMeans(pts.map(p => p[0]), pts.map(p => p[1]), years, monthly ? 10 : 150);
    const cur = yearMeans(pts.map(p => p[0]), pts.map(p => p[1]), [ytdYear], monthly ? 3 : 20)[0];
    rateAvg[k] = { name: def.name, avg: years.map((y, i) => (y === ytdYear ? cur : past[i])) };
  }
  return {
    years, ytdYear: yearOf(asOf), asOf, regions,
    lead50Chg: got.lead50 ? yearChanges(got.lead50.dates, got.lead50.index, years) : null,
    rates: rateAvg,
  };
}
/** 주간 시계열을 최근 n주로 */
export function tailWeekly(w, n = WEEKS_KEPT) {
  if (!w) return null;
  const cut = Math.max(0, w.dates.length - n);
  return { ...w, dates: w.dates.slice(cut), regions: Object.fromEntries(Object.entries(w.regions).map(([r, row]) => [r, Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v ? v.slice(cut) : v]))])) };
}
/** 월간 시계열(날짜와 keys 의 배열·지역별 배열)을 최근 n개월로 */
export function tailMonthly(m, keys, n = MONTHS_KEPT) {
  if (!m) return null;
  const cut = Math.max(0, m.dates.length - n);
  const out = { ...m, dates: m.dates.slice(cut) };
  for (const k of keys) {
    const v = m[k];
    if (Array.isArray(v)) out[k] = v.slice(cut);
    else if (v && typeof v === 'object') out[k] = Object.fromEntries(Object.entries(v).map(([r, a]) => [r, a ? a.slice(cut) : a]));
  }
  return out;
}

/** 원천 전체를 받아 대시보드 형식으로 합침 */
export async function loadFlow({ fetch: fetchImpl = fetch, now = () => new Date() } = {}) {
  const kb = (ep, params) => getJson(fetchImpl, `${KB_BASE}${ep}?${new URLSearchParams(params)}`, KB_HEADERS);
  const weeklyParams = { 월간주간구분코드: '02', 기간: '10' };   // 연도별 지표용 10년치 — 화면에는 최근 WEEKS_KEPT 주만 보냄
  const kbJobs = [
    ['sale', () => kb('priceIndex', { 매매전세코드: '01', ...weeklyParams }).then(parsePriceIndex)],
    ['jeonse', () => kb('priceIndex', { 매매전세코드: '02', ...weeklyParams }).then(parsePriceIndex)],
    ...Object.entries(TREND_MENUS).map(([k, [code, field]]) => [k, () => kb('maktTrnd', { ...weeklyParams, 메뉴코드: code }).then(j => parseMarketTrend(j, field))]),
    ['ratio', () => kb('dealCntstTnantRato', {}).then(j => parseMonthlyRegions(j, Infinity))],   // 전체를 받아 연도별 계산 뒤 최근 MONTHS_KEPT 개월만 보냄
    ['lead50', () => kb('leadApt50Indx', {}).then(j => parseLead50(j, Infinity))],
    ['hai', () => kb('HAI', {}).then(j => parseHai(j, Infinity))],
  ];
  const [kbOut, rateOut] = await Promise.all([
    pool(kbJobs, 3, ([, job]) => job()),
    pool(Object.keys(RATES), 2, key => loadRate(fetchImpl, key)),
  ]);
  const errors = [];
  const got = {};
  kbJobs.forEach(([name], i) => {
    if (kbOut[i].ok) got[name] = kbOut[i].value;
    else errors.push(`KB ${name}: ${kbOut[i].error.message}`);
  });

  // 주간: 매매지수 날짜축(없으면 받아진 첫 시계열)에 나머지를 맞춤
  const weeklyKeys = ['sale', 'jeonse', ...Object.keys(TREND_MENUS)];
  const base = weeklyKeys.map(k => got[k]).find(Boolean);
  let weekly = null;
  if (base) {
    weekly = { dates: base.dates, updated: base.updated, regions: {} };
    for (const region of REGIONS) {
      const row = {};
      for (const k of weeklyKeys) row[k] = got[k] && got[k].regions[region] ? alignSeries(base.dates, got[k].dates, got[k].regions[region]) : null;
      if (Object.values(row).some(Boolean)) weekly.regions[region] = row;
    }
  }

  const rates = {};
  Object.keys(RATES).forEach((key, i) => {
    if (rateOut[i].ok) rates[key] = rateOut[i].value;
    else errors.push(`네이버 ${RATES[key].name}: ${rateOut[i].error.message}`);
  });

  const data = {
    asOf: now().toISOString(),
    weekly: tailWeekly(weekly),
    monthly: { ratio: tailMonthly(got.ratio, ['regions']), lead50: tailMonthly(got.lead50, ['index', 'mom', 'yoy']), hai: tailMonthly(got.hai, ['loanRate', 'apt']) },
    annual: buildAnnual(got, rates),
    rates,
    errors,
    sources: {
      kb: 'KB데이터허브 주간·월간 주택가격동향(data.kbland.kr, 비공식 조회)',
      rates: '네이버 금융 시장금리(국고채·CD·COFIX)',
    },
  };
  if (!weekly && !data.monthly.ratio && !data.monthly.lead50 && !data.monthly.hai && !Object.keys(rates).length) {
    throw new Error(errors[0] || '모든 원천 조회에 실패했습니다');
  }
  return data;
}

/** 이번에 못 받은 부분은 직전 값으로 채움(해당 부분 staleParts 에 표시) */
export function mergeMissing(next, prev) {
  if (!prev) return next;
  const out = { ...next, monthly: { ...next.monthly }, rates: { ...next.rates }, staleParts: [] };
  if (!out.weekly && prev.weekly) { out.weekly = prev.weekly; out.staleParts.push('weekly'); }
  if (!out.annual && prev.annual) { out.annual = prev.annual; out.staleParts.push('annual'); }
  for (const k of ['ratio', 'lead50', 'hai']) {
    if (!out.monthly[k] && prev.monthly && prev.monthly[k]) { out.monthly[k] = prev.monthly[k]; out.staleParts.push(k); }
  }
  for (const k of Object.keys(prev.rates || {})) {
    if (!out.rates[k]) { out.rates[k] = prev.rates[k]; out.staleParts.push(k); }
  }
  return out;
}

/** 함수 메모리 캐시(기본 3시간) — 동시에 들어온 요청은 한 번만 원천 조회, 전부 실패하면 직전 값을 stale 로 */
export function createFlowSource({ ttlMs = 3 * 3600 * 1000, load = loadFlow, now = Date.now } = {}) {
  let cache = null;
  let inflight = null;
  return {
    async get({ force = false } = {}) {
      if (!force && cache && now() - cache.at < ttlMs) return cache.data;
      if (!inflight) {
        inflight = load()
          .then(data => { cache = { at: now(), data: mergeMissing(data, cache && cache.data) }; return cache.data; })
          .finally(() => { inflight = null; });
      }
      try {
        return await inflight;
      } catch (e) {
        if (cache) return { ...cache.data, stale: true, error: e.message };
        throw e;
      }
    },
  };
}
