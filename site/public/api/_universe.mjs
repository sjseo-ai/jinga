// 검색용 전 종목 목록 — 코스피·코스닥 전 종목 + 미국 상장 전 종목
//   국내: 네이버 시가총액 순위를 100개씩 끝까지(코스피 약 2,480 · 코스닥 약 1,820종목, ETF·ETN 제외)
//   미국: 나스닥 스크리너 한 번에 약 7,100종목(업종 포함, 워런트·유닛·우선주 제외) — 나스닥·뉴욕·아멕스 상장 전부
//   각 종목에 지수 소속(S&P 500 · 나스닥 100 · 다우 30 · 코스피 · 코스닥)을 붙여 검색 결과에서 구분합니다.
// 진가 점수·적정가는 분석 대상(지수 구성·시가총액 상위)만 계산하므로, 그 밖의 종목은 검색·기본 정보·포워드 전망까지 제공합니다.
// 목록은 Blob(stocks/universe.json)에 하루 한 번 갱신해 두고 읽습니다.
import { URLS, INDEXES, GICS_KO, NASDAQ_SECTOR_KO, cleanUsName, parseNaverMarketValue } from './_market.mjs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const NASDAQ_H = { Origin: 'https://www.nasdaq.com', Referer: 'https://www.nasdaq.com/', Accept: 'application/json, text/plain, */*', 'User-Agent': UA };
const NAVER_H = { Referer: 'https://m.stock.naver.com/', Accept: 'application/json', 'User-Agent': UA };

export const UNIVERSE_PATH = 'stocks/universe.json';
export const KR_PAGE_SIZE = 100;
export const KR_MAX_PAGES = 40;          // 코스피·코스닥이 크게 늘어도 넉넉하도록
export const FRESH_MS = 24 * 3600e3;     // 이 시간이 지나면 다시 모음
export const MIN_ROWS = 3000;            // 이보다 적게 모이면 원천 고장으로 보고 예전 목록을 씀

// 스크리너에는 워런트·유닛·우선주·권리가 섞여 있어 보통주만 남김(2026-09 기준 7,141행 중 1,148행 제외)
// 미국주식예탁증서(ADR)는 소니·알리바바처럼 실제로 사고파는 종목이라 남깁니다(우선주 ADR은 Preferred 로 걸러짐)
const SKIP_US_NAME = /\b(Warrants?|Units?|Rights?|Preferred|Notes? due|Debentures?|Subordinated)\b/i;
export const isCommonUsName = name => !SKIP_US_NAME.test(String(name || ''));

const num = v => {
  const n = Number(String(v ?? '').replace(/[$,%\s]/g, ''));
  return String(v ?? '').trim() !== '' && Number.isFinite(n) ? n : null;
};

/** 나스닥 스크리너(download=true) → 검색용 미국 종목 */
export function parseScreenerAll(json) {
  const rows = json && json.data && json.data.rows;
  if (!Array.isArray(rows)) throw new Error('나스닥 스크리너 응답 형식이 예상과 다릅니다');
  const out = [];
  const seen = new Set();
  for (const r of rows) {
    const s = String(r.symbol || '').trim().toUpperCase().replace('/', '.');
    if (!s || seen.has(s) || !isCommonUsName(r.name)) continue;
    seen.add(s);
    out.push({
      s, n: cleanUsName(r.name) || s, market: 'US', idx: [],
      cap: num(r.marketCap), p: num(r.lastsale),
      sec: NASDAQ_SECTOR_KO[r.sector] || r.sector || '기타',
      sub: String(r.industry || '').trim(),           // 스크리너 업종(예: Semiconductors, Major Banks) — 테마 판정에 씀
    });
  }
  return out;
}

/** 네이버 시가총액 순위 여러 쪽 → 국내 종목(주식만, 중복 제거) */
export function krRowsFrom(pages, index) {
  const out = [];
  const seen = new Set();
  for (const json of pages) {
    for (const x of parseNaverMarketValue(json)) {
      if (!x.s || seen.has(x.s)) continue;
      seen.add(x.s);
      out.push({ s: x.s, n: x.n, market: 'KR', idx: [index], cap: x.cap ?? null, p: x.p ?? null, sec: '', sub: '' });
    }
  }
  return out;
}

/** 지수 소속·GICS 세부 업종 붙이기 — sp/ndx/dow 는 티커 Set */
export function markIndexes(rows, { sp = new Set(), ndx = new Set(), dow = new Set(), subBySymbol = new Map(), secBySymbol = new Map() } = {}) {
  return rows.map(r => {
    const idx = [];
    if (sp.has(r.s)) idx.push('SPX');
    if (ndx.has(r.s)) idx.push('NDX');
    if (dow.has(r.s)) idx.push('DJI');
    // 지수 구성종목은 GICS 분류(S&P 500 목록)가 스크리너 업종보다 정확
    return { ...r, idx, sec: secBySymbol.get(r.s) || r.sec, sub: subBySymbol.get(r.s) || r.sub };
  });
}

export const totalPages = (totalCount, pageSize = KR_PAGE_SIZE) =>
  Math.min(KR_MAX_PAGES, Math.max(1, Math.ceil((Number(totalCount) || 0) / pageSize)));

/** 목록을 원천에서 새로 모음 — 네트워크 30초 내외 */
export async function buildUniverse({ fetchImpl = (...a) => fetch(...a), marketSource = null, now = () => new Date() } = {}) {
  const getJson = async (url, headers) => {
    const r = await fetchImpl(url, { headers, signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error(`${new URL(url).hostname} HTTP ${r.status}`);
    return r.json();
  };
  const errors = [];
  const counts = {};

  // 국내 — 1쪽으로 전체 개수를 보고 나머지는 5쪽씩 나눠 한꺼번에
  const kr = [];
  for (const index of ['KOSPI', 'KOSDAQ']) {
    const pages = [];
    try {
      const first = await getJson(URLS.naver(index, 1), NAVER_H);
      pages.push(first);
      const rest = [];
      for (let p = 2; p <= totalPages(first.totalCount); p++) rest.push(p);
      for (let i = 0; i < rest.length; i += 5) {
        const got = await Promise.all(rest.slice(i, i + 5).map(p => getJson(URLS.naver(index, p), NAVER_H).catch(e => {
          errors.push(`${index} ${p}쪽: ${e.message}`);
          return null;
        })));
        pages.push(...got.filter(Boolean));
      }
    } catch (e) { errors.push(`${INDEXES[index].label}: ${e.message}`); }
    const rows = krRowsFrom(pages, index);
    counts[index] = rows.length;
    kr.push(...rows);
  }

  // 미국 — 스크리너 전체에 지수 소속 표시
  let us = [];
  try {
    const rows = parseScreenerAll(await getJson(URLS.screener, NASDAQ_H));
    const sets = { sp: new Set(), ndx: new Set(), dow: new Set(), subBySymbol: new Map(), secBySymbol: new Map() };
    const key = { SPX: 'sp', NDX: 'ndx', DJI: 'dow' };
    for (const index of ['SPX', 'NDX', 'DJI']) {
      if (!marketSource) break;
      try {
        const data = await marketSource.load(index);
        for (const it of data.items || []) {
          sets[key[index]].add(it.s);
          if (it.sub) sets.subBySymbol.set(it.s, it.sub);
          if (it.sec) sets.secBySymbol.set(it.s, it.sec);
        }
      } catch (e) { errors.push(`${INDEXES[index].label} 구성: ${e.message}`); }
    }
    us = markIndexes(rows, sets);
    counts.US = us.length;
  } catch (e) { errors.push(`미국 전 종목: ${e.message}`); }

  const rows = [...kr, ...us].filter(r => r.s && r.n);
  if (rows.length < MIN_ROWS) throw new Error(`전 종목 목록이 너무 적습니다(${rows.length}종목) — ${errors[0] || '원인 불명'}`);
  return { rows, errors, builtAt: now().toISOString(), counts: { ...counts, total: rows.length } };
}

/** 한 종목이 진가 분석(지수 구성·시가총액 상위) 대상인지 */
export const isAnalyzed = (row, analyzedKeys) => !!row && analyzedKeys.has(`${row.market}:${row.s}`);

/**
 * Blob 에 모아 둔 전 종목 목록 읽기 — 하루가 지났으면 새로 모으고, 새로 모으다 실패하면 예전 목록을 그대로 씀
 * cache: 함수 인스턴스가 살아 있는 동안 쓰는 메모리 보관함
 */
export function createUniverseStore({ store, fetchImpl, marketSource, cache = new Map(), now = () => Date.now() } = {}) {
  const fresh = u => u && u.builtAt && now() - Date.parse(u.builtAt) < FRESH_MS && (u.rows || []).length >= MIN_ROWS;

  async function load({ refresh = true } = {}) {
    const hit = cache.get('u');
    if (fresh(hit)) return hit;
    let saved = hit || null;
    if (!saved && store) saved = await store.get(UNIVERSE_PATH).catch(() => null);
    if (fresh(saved)) { cache.set('u', saved); return saved; }
    if (!refresh && saved) return saved;
    try {
      const built = await buildUniverse({ fetchImpl, marketSource });
      cache.set('u', built);
      if (store) await store.put(UNIVERSE_PATH, built).catch(() => {});
      return built;
    } catch (e) {
      if (saved) { cache.set('u', saved); return { ...saved, stale: true, error: e.message }; }
      throw e;
    }
  }
  return { load, path: UNIVERSE_PATH };
}
