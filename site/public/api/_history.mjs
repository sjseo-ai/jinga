// 과거 시세 — 매매 기록의 기간별 수익률을 셈하려면 「그날 종가」가 필요합니다.
//   · 국내 종목·지수 — 네이버 차트(api.stock.naver.com/chart/domestic/…)
//   · 미국 종목 — 나스닥 historical
//   · 해외 지수 — 네이버 차트(chart/foreign/index/.INX 등)
//   · 원/달러 — 네이버 금융 환율(하루치씩, 여러 쪽)
// 모두 공식 API 가 아니라 웹이 쓰는 조회 방식이라 형식이 바뀔 수 있고, 못 받은 종목은 그냥 빼고 셈합니다.
// 브라우저에서 직접 부르면 CORS 에 막혀 서버(이 파일)가 받아 넘깁니다. 한 번 받은 것은 1시간 보관합니다.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const NAVER_H = { 'User-Agent': UA, Referer: 'https://m.stock.naver.com/', Accept: 'application/json' };
const NASDAQ_H = { Origin: 'https://www.nasdaq.com', Referer: 'https://www.nasdaq.com/', 'User-Agent': UA, Accept: 'application/json' };

export const INDEX_CODES = { KOSPI: ['domestic', 'KOSPI'], KOSDAQ: ['domestic', 'KOSDAQ'], SPX: ['foreign', '.INX'], NDX: ['foreign', '.IXIC'], DJI: ['foreign', '.DJI'] };
export const MAX_SYMBOLS = 30;
const FX_PAGE_SIZE = 60;                  // 네이버가 한 번에 주는 최대치(61 이상이면 400)
const FX_PAGES = 8;                       // 60행 × 8 ≈ 거래일 480일(약 2년)

const ymd = d => d.toISOString().slice(0, 10);
const stamp = d => d.toISOString().slice(0, 10).replace(/-/g, '') + '0000';
// 빈 값은 0 이 아니라 「없음」입니다 — Number('') 가 0 이라 그냥 두면 종가 0원짜리 날이 생깁니다.
const numOf = v => {
  const t = String(v ?? '').replace(/[$,\s]/g, '');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** 네이버 차트 응답 → [[YYYY-MM-DD, 종가], …] */
export function parseNaverChart(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map(r => {
      const d = String(r.localDate || '');
      const c = numOf(r.closePrice);
      return d.length === 8 && c != null ? [`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`, c] : null;
    })
    .filter(Boolean)
    .sort((a, b) => a[0].localeCompare(b[0]));
}

/** 나스닥 historical 응답 → [[YYYY-MM-DD, 종가], …] (날짜는 MM/DD/YYYY) */
export function parseNasdaqHistory(json) {
  const rows = json && json.data && json.data.tradesTable && json.data.tradesTable.rows;
  return (Array.isArray(rows) ? rows : [])
    .map(r => {
      const m = String(r.date || '').match(/(\d{2})\/(\d{2})\/(\d{4})/);
      const c = numOf(r.close);
      return m && c != null ? [`${m[3]}-${m[1]}-${m[2]}`, c] : null;
    })
    .filter(Boolean)
    .sort((a, b) => a[0].localeCompare(b[0]));
}

/** 네이버 환율 응답 → [[YYYY-MM-DD, 원/달러], …] */
export function parseFx(pages) {
  const out = [];
  for (const j of pages) {
    for (const r of (j && j.result) || []) {
      const d = String(r.localTradedAt || '').slice(0, 10);
      const v = numOf(r.closePrice);
      if (/^\d{4}-\d{2}-\d{2}$/.test(d) && v != null) out.push([d, v]);
    }
  }
  const by = new Map(out.map(x => [x[0], x[1]]));
  return [...by.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

/** 두 시세열에서 거래일만 모아 정렬(포트폴리오 평가 날짜) */
export function tradingDays(seriesList, from) {
  const set = new Set();
  for (const s of seriesList) for (const [d] of s || []) if (!from || d >= from) set.add(d);
  return [...set].sort();
}

export function createHistory({ fetchImpl = (...a) => fetch(...a), cache = new Map(), now = () => Date.now(), ttlMs = 3600e3 } = {}) {
  const memo = async (key, fn) => {
    const hit = cache.get(key);
    if (hit && now() - hit.t < ttlMs) return hit.v;
    try {
      const v = await fn();
      cache.set(key, { t: now(), v });
      return v;
    } catch (e) {
      if (hit) return hit.v;                 // 원천이 잠깐 죽으면 직전 값으로
      throw e;
    }
  };
  const getJson = async (url, headers) => {
    const r = await fetchImpl(url, { headers, signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error(`${new URL(url).hostname} HTTP ${r.status}`);
    return r.json();
  };

  const krItem = (code, from, to) => memo(`kr:${code}:${from}`, async () =>
    parseNaverChart(await getJson(`https://api.stock.naver.com/chart/domestic/item/${encodeURIComponent(code)}/day?startDateTime=${stamp(from)}&endDateTime=${stamp(to)}`, NAVER_H)));

  const usItem = (sym, from, to) => memo(`us:${sym}:${ymd(from)}`, async () => {
    const days = Math.ceil((to - from) / 86400e3) + 5;
    const url = `https://api.nasdaq.com/api/quote/${encodeURIComponent(sym.replace('.', '-'))}/historical?assetclass=stocks&fromdate=${ymd(from)}&todate=${ymd(to)}&limit=${Math.min(3000, days)}`;
    return parseNasdaqHistory(await getJson(url, NASDAQ_H));
  });

  const index = (key, from, to) => memo(`idx:${key}:${ymd(from)}`, async () => {
    const spec = INDEX_CODES[key];
    if (!spec) return [];
    const [kind, code] = spec;
    return parseNaverChart(await getJson(`https://api.stock.naver.com/chart/${kind}/index/${encodeURIComponent(code)}/day?startDateTime=${stamp(from)}&endDateTime=${stamp(to)}`, NAVER_H));
  });

  const fx = () => memo('fx', async () => {
    const pages = [];
    for (let p = 1; p <= FX_PAGES; p++) {
      try {
        pages.push(await getJson(`https://m.stock.naver.com/front-api/marketIndex/prices?category=exchange&reutersCode=FX_USDKRW&page=${p}&pageSize=${FX_PAGE_SIZE}`, NAVER_H));
      } catch { break; }
    }
    return parseFx(pages);
  });

  /**
   * ids: ['KR:005930', 'US:MU'] · from: 'YYYY-MM-DD'
   * → { prices: { 'KR:005930': [[날짜, 종가], …] }, fx, benchmarks: { KOSPI: […], SPX: […] }, missing: [] }
   */
  async function load(ids = [], from) {
    const start = new Date(`${from}T00:00:00Z`);
    start.setUTCDate(start.getUTCDate() - 10);          // 시작일 앞 휴장일까지 덮으려고 조금 일찍
    const end = new Date();
    const prices = {}, missing = [];
    await Promise.all(ids.slice(0, MAX_SYMBOLS).map(async id => {
      const [market, s] = String(id).split(':');
      try {
        const rows = market === 'US' ? await usItem(s, start, end) : await krItem(s, start, end);
        if (rows.length) prices[`${market}:${s}`] = rows; else missing.push(id);
      } catch { missing.push(id); }
    }));
    const [kospi, spx, rates] = await Promise.all([
      index('KOSPI', start, end).catch(() => []),
      index('SPX', start, end).catch(() => []),
      fx().catch(() => []),
    ]);
    return { prices, fx: rates, benchmarks: { KOSPI: kospi, SPX: spx }, missing, from, to: ymd(end) };
  }

  return { load, krItem, usItem, index, fx };
}
