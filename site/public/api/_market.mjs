// 주요 지수 구성종목 히트맵 데이터 — 종목별 시가총액·가격·전일 대비(금액·%)·거래량·섹터 (api/market-map)
//   KOSPI · KOSDAQ  네이버 금융 시가총액 순위에서 ETF·ETN을 뺀 주식 상위 100종목 — 섹터 정보가 없어 섹터 묶음 없이 표시
//   DOW 30          위키백과 「Historical components of the DJIA」 첫 표(현재 구성 30곳) → S&P 500 목록으로 티커 매칭(실패 시 내장 목록)
//   S&P 500         GitHub datasets/s-and-p-500-companies 구성종목·GICS 섹터 + 나스닥 스크리너 시가총액·가격·등락·거래량
//   NASDAQ 100      나스닥 list-type/nasdaq100 시가총액·가격·등락 + 거래량·섹터(S&P 목록의 GICS → 없으면 나스닥 스크리너)
// 모두 비공식 조회라 원천 형식이 바뀌면 그 지수만 오류가 나고, 직전에 받은 값이 있으면 그걸 계속 씁니다.
// 미국 시세는 나스닥 제공값(지연 시세)이라 장중 실시간과 차이가 있을 수 있습니다.
// 종목 항목: { s 코드·티커, n 이름, sec 섹터, cap 시가총액, p 가격, d 전일 대비 금액(부호 있음), c 등락률(%), vol 거래량 }

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const NASDAQ_H = { Origin: 'https://www.nasdaq.com', Referer: 'https://www.nasdaq.com/', Accept: 'application/json, text/plain, */*' };
export const URLS = {
  naver: (market, page = 1) => `https://m.stock.naver.com/api/stocks/marketValue/${market}?page=${page}&pageSize=100`,
  sp500: 'https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv',
  screener: 'https://api.nasdaq.com/api/screener/stocks?tableonly=true&download=true',
  ndx: 'https://api.nasdaq.com/api/quote/list-type/nasdaq100',
  dow: 'https://en.wikipedia.org/wiki/Historical_components_of_the_Dow_Jones_Industrial_Average',
};
export const KR_TOP = 100;

// 화면 순서(미국 지수 먼저). scope 뒤에 「N종목」이 붙어 「구성종목 503종목」 「시가총액 상위 100종목」으로 표시됨
export const INDEXES = {
  SPX: { label: 'S&P 500', market: 'US', currency: 'USD', scope: '구성종목' },
  NDX: { label: 'NASDAQ 100', market: 'US', currency: 'USD', scope: '구성종목' },
  DJI: { label: 'DOW 30', market: 'US', currency: 'USD', scope: '구성종목' },
  KOSPI: { label: 'KOSPI', market: 'KR', currency: 'KRW', scope: '시가총액 상위' },
  KOSDAQ: { label: 'KOSDAQ', market: 'KR', currency: 'KRW', scope: '시가총액 상위' },
};

export const GICS_KO = {
  'Information Technology': '정보기술', 'Communication Services': '커뮤니케이션', 'Consumer Discretionary': '경기소비재',
  'Consumer Staples': '필수소비재', 'Health Care': '헬스케어', Financials: '금융', Industrials: '산업재', Energy: '에너지',
  Materials: '소재', Utilities: '유틸리티', 'Real Estate': '부동산',
};
export const NASDAQ_SECTOR_KO = {
  Technology: '정보기술', Telecommunications: '커뮤니케이션', 'Consumer Discretionary': '경기소비재', 'Consumer Staples': '필수소비재',
  'Health Care': '헬스케어', Finance: '금융', Industrials: '산업재', Energy: '에너지', 'Basic Materials': '소재', Utilities: '유틸리티',
  'Real Estate': '부동산', Miscellaneous: '기타',
};

// 위키백과 표를 못 읽거나 티커 매칭이 30곳이 안 될 때 쓰는 목록 — 2026-06-29 변경(알파벳 편입·버라이즌 편출) 반영, 2026-09-15 위키백과 확인
export const DOW_FALLBACK = ['AAPL', 'AMGN', 'AMZN', 'AXP', 'BA', 'CAT', 'CRM', 'CSCO', 'CVX', 'DIS', 'GOOGL', 'GS', 'HD', 'HON', 'IBM',
  'JNJ', 'JPM', 'KO', 'MCD', 'MMM', 'MRK', 'MSFT', 'NKE', 'NVDA', 'PG', 'SHW', 'TRV', 'UNH', 'V', 'WMT'];
// 회사 이름만으로 매칭이 안 되는 곳
const NAME_ALIAS = { internationalbusinessmachines: 'IBM' };

const num = v => {
  const n = Number(String(v ?? '').replace(/[$,%+\s]/g, ''));
  return String(v ?? '').trim() !== '' && Number.isFinite(n) ? n : null;
};
const round = (v, d) => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d);
/** 부호가 빠진 금액에 등락률 부호를 붙임(원천마다 금액 부호 표기가 달라서) */
const signed = (amount, pct) => (amount == null ? null : pct < 0 ? -Math.abs(amount) : pct > 0 ? Math.abs(amount) : 0);

// ── 원천 응답 정리 ────────────────────────────────────────────
/** 네이버 시가총액 순위 → 주식만(ETF·ETN 제외, 같은 종목은 한 번) */
export function parseNaverMarketValue(json) {
  const seen = new Set();
  return ((json && json.stocks) || []).map(s => {
    const dir = s.compareToPreviousPrice && s.compareToPreviousPrice.code;   // 1 상한 2 상승 3 보합 4 하락 5 하한
    const sign = dir === '4' || dir === '5' ? -1 : 1;
    const c = dir === '3' ? 0 : Math.abs(num(s.fluctuationsRatio) || 0) * sign;
    return {
      s: s.itemCode, n: s.stockName, sec: '', kind: s.stockEndType || 'stock',
      cap: num(s.marketValueRaw), p: num(s.closePriceRaw ?? s.closePrice),
      d: dir === '3' ? 0 : signed(num(s.compareToPreviousClosePriceRaw ?? s.compareToPreviousClosePrice), sign),
      c, vol: num(s.accumulatedTradingVolumeRaw ?? s.accumulatedTradingVolume),
      t: s.localTradedAt || null,
    };
  }).filter(x => {
    if (!x.s || !(x.cap > 0) || x.kind !== 'stock' || seen.has(x.s)) return false;
    seen.add(x.s);
    return true;
  }).map(({ kind, ...x }) => x);
}

export function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  const s = String(text).replace(/\r/g, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"' && s[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim()));
}

export function parseSp500Csv(text) {
  const [head, ...rows] = parseCsv(text);
  const col = name => head.findIndex(h => h.trim().toLowerCase() === name);
  const iSym = col('symbol'), iName = col('security'), iSec = col('gics sector'), iSub = col('gics sub-industry');
  if (iSym < 0 || iName < 0 || iSec < 0) throw new Error('S&P 500 구성종목 파일 형식이 예상과 다릅니다');
  // sub: GICS 세부 업종(예: Semiconductors) — 유사 종목 추천(api/_peers.mjs)이 국내 업종과 이어 붙이는 데 씀
  return rows.map(r => ({ symbol: r[iSym].trim().toUpperCase(), name: (r[iName] || '').trim(), sector: (r[iSec] || '').trim(), sub: iSub >= 0 ? (r[iSub] || '').trim() : '' })).filter(x => x.symbol);
}

const usSymbol = s => String(s || '').trim().toUpperCase().replace('/', '.');

export function parseScreener(json) {
  const rows = json && json.data && json.data.rows;
  if (!Array.isArray(rows)) throw new Error('나스닥 스크리너 응답 형식이 예상과 다릅니다');
  const map = new Map();
  for (const r of rows) {
    const c = num(r.pctchange);
    map.set(usSymbol(r.symbol), { name: r.name, cap: num(r.marketCap), c, d: signed(num(r.netchange), c), p: num(r.lastsale), vol: num(r.volume), sector: r.sector || '' });
  }
  return map;
}

export function parseNasdaqList(json) {
  const d = json && json.data;
  const rows = d && d.data && d.data.rows;
  if (!Array.isArray(rows)) throw new Error('나스닥 100 응답 형식이 예상과 다릅니다');
  return {
    date: d.date || null,
    rows: rows.map(r => {
      const c = num(r.percentageChange);
      return { symbol: usSymbol(r.symbol), name: r.companyName, cap: num(r.marketCap), c, d: signed(num(r.netChange), c), p: num(r.lastSalePrice) };
    }),
  };
}

const strip = s => String(s).replace(/<sup[\s\S]*?<\/sup>/g, '').replace(/<[^>]+>/g, ' ').replace(/&#160;|&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/[↑↓]/g, '').replace(/\s+/g, ' ').trim();

/** 역대 구성종목 문서의 첫 회사 이름 표(가장 최근 변경 = 현재 구성) → 회사 이름 30개
 *  표 끝의 「Dropped from Average」 뒤 칸과 ↓(편출) 표시 칸은 빼고, ↑(편입)·†(사명 변경) 표시는 지움 */
export function parseDowNames(html) {
  for (const m of String(html).matchAll(/<table[^>]*>([\s\S]*?)<\/table>/g)) {
    const raw = [...m[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map(c => c[1]);
    const cut = raw.findIndex(c => /Dropped\s+from/i.test(strip(c)));
    const cells = (cut >= 0 ? raw.slice(0, cut) : raw)
      .filter(c => !c.includes('↓'))
      .map(c => strip(c).replace(/†/g, '').replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    if (cells.length >= 28 && cells.length <= 32 && cells.every(c => /[A-Za-z]/.test(c) && c.length < 90)) return cells;
  }
  return [];
}

const normName = s => String(s).toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[↑↓]/g, ' ')
  .replace(/\b(the|inc|incorporated|company|companies|co|corp|corporation|group|holdings|plc|ltd)\b/g, ' ').replace(/[^a-z0-9]/g, '');

/** 회사 이름 → S&P 500 목록의 티커(주식이 여러 종류면 A주) */
export function mapNamesToSymbols(names, sp) {
  const prepared = sp.map(x => ({ ...x, key: normName(x.name) }));
  return names.map(name => {
    const key = normName(name);
    if (NAME_ALIAS[key]) return NAME_ALIAS[key];
    let hits = prepared.filter(x => x.key && x.key === key);
    if (!hits.length) hits = prepared.filter(x => x.key && (x.key.startsWith(key) || key.startsWith(x.key)));
    if (!hits.length) return null;
    const classA = hits.find(x => /class a/i.test(x.name));
    return (classA || hits.slice().sort((a, b) => a.name.length - b.name.length)[0]).symbol;
  });
}

// ── 조회 ─────────────────────────────────────────────────────
// 나스닥 종목명의 주식 종류·설립지 표기 제거 — "Apple Inc. Common Stock" → "Apple Inc.",
// "Accenture plc Class A Ordinary Shares (Ireland)" → "Accenture plc", "Iron Mountain Incorporated (Delaware)Common Stock REIT" → "Iron Mountain Incorporated"
export const cleanUsName = n => {
  let s = String(n || '');
  const at = s.search(/(Common Stocks?|Common Shares?|Ordinary Shares?|Capital Stock|American Depositary Shares?|Depositary Shares?|New York Registry Shares?|Subordinate Voting Shares?|\bADS\b)/i);
  if (at > 0) s = s.slice(0, at);
  // 뒤에 남은 「(The)」「(Ireland)」「Class A」「,」를 더 줄어들지 않을 때까지 떼어 냄
  for (let prev = ''; prev !== s;) {
    prev = s;
    s = s.replace(/\s*\([^)]*\)\s*$/, '').replace(/\s+Class\s+[A-C]\s*$/i, '').replace(/[\s,]+$/, '');
  }
  return s.trim();
};

export function createMarketSource({ fetchImpl = (...a) => fetch(...a), cache = new Map(), now = () => Date.now() } = {}) {
  const getText = async (url, headers = {}) => {
    const r = await fetchImpl(url, { headers: { 'User-Agent': UA, Accept: '*/*', ...headers }, signal: AbortSignal.timeout(25000) });
    if (!r.ok) throw new Error(`${new URL(url).hostname} HTTP ${r.status}`);
    return r.text();
  };
  const getJson = async (url, headers) => JSON.parse(await getText(url, headers));
  // 함수 인스턴스가 살아 있는 동안 메모리에 보관 — 원천이 잠깐 실패하면 직전 값을 씀
  const cached = async (key, ttlMs, fn) => {
    const hit = cache.get(key);
    if (hit && now() - hit.t < ttlMs) return hit.v;
    try {
      const v = await fn();
      cache.set(key, { t: now(), v });
      return v;
    } catch (e) {
      if (hit) return { ...hit.v, stale: true };
      throw e;
    }
  };

  const sp500 = () => cached('sp500', 12 * 3600e3, async () => ({ list: parseSp500Csv(await getText(URLS.sp500)) }));
  const screener = () => cached('screener', 60e3, async () => ({ map: parseScreener(await getJson(URLS.screener, NASDAQ_H)) }));
  const dowSymbols = () => cached('dow', 12 * 3600e3, async () => {
    const [{ list }, html] = await Promise.all([sp500(), getText(URLS.dow).catch(() => '')]);
    const names = parseDowNames(html);
    const symbols = names.length ? mapNamesToSymbols(names, list) : [];
    if (symbols.length >= 28 && symbols.every(Boolean)) return { symbols, from: '위키백과 현재 구성' };
    return { symbols: DOW_FALLBACK, from: '내장 목록(위키백과 표를 읽지 못함)' };
  });

  const usItems = (symbols, sectorOf, quotes, subOf = () => '') => {
    const items = [], missing = [];
    for (const s of symbols) {
      const q = quotes.get(s);
      if (!q || !(q.cap > 0)) { missing.push(s); continue; }
      items.push({ s, n: cleanUsName(q.name) || s, sec: sectorOf(s, q), sub: subOf(s) || '', cap: q.cap, p: q.p, d: q.d ?? null, c: q.c ?? 0, vol: q.vol ?? null });
    }
    return { items, missing };
  };
  const gicsOf = list => {
    const m = new Map(list.map(x => [x.symbol, x]));
    return (s, q) => (m.has(s) ? GICS_KO[m.get(s).sector] || m.get(s).sector : NASDAQ_SECTOR_KO[q && q.sector] || (q && q.sector) || '기타');
  };
  const gicsSubOf = list => { const m = new Map(list.map(x => [x.symbol, x.sub || ''])); return s => m.get(s) || ''; };

  async function load(index) {
    const meta = INDEXES[index];
    if (!meta) throw new Error('지원하지 않는 지수');
    let items, missing = [], asOf = null, source, note = '', stale = false;
    if (meta.market === 'KR') {
      // 순위표에 ETF·ETN이 섞여 있어, 두 쪽(200위)을 받아 주식만 상위 100종목
      const r = await cached(`naver:${index}`, 30e3, async () => {
        const pages = await Promise.all([1, 2].map(p => getJson(URLS.naver(index, p), { Referer: 'https://m.stock.naver.com/' })));
        return { json: { marketStatus: pages[0].marketStatus, stocks: pages.flatMap(p => p.stocks || []) } };
      });
      stale = !!r.stale;
      items = parseNaverMarketValue(r.json).slice(0, KR_TOP);
      asOf = items.map(x => x.t).filter(Boolean).sort().pop() || null;
      items.forEach(x => { delete x.t; });
      source = '네이버 금융';
      note = r.json.marketStatus === 'OPEN' ? '장중' : '장 마감 기준';
    } else if (index === 'NDX') {
      const [list, sp, sc] = await Promise.all([cached('ndx', 60e3, async () => parseNasdaqList(await getJson(URLS.ndx, NASDAQ_H))), sp500(), screener().catch(() => ({ map: new Map() }))]);
      stale = !!(list.stale || sc.stale);
      // 가격·등락은 나스닥 100 목록, 거래량·섹터는 스크리너에서
      const quotes = new Map(list.rows.map(r => { const x = sc.map.get(r.symbol) || {}; return [r.symbol, { ...r, sector: x.sector, vol: x.vol ?? null }]; }));
      ({ items, missing } = usItems(list.rows.map(r => r.symbol), gicsOf(sp.list), quotes, gicsSubOf(sp.list)));
      asOf = list.date;
      source = '나스닥(Nasdaq.com)';
    } else {
      const [sp, sc] = await Promise.all([sp500(), screener()]);
      stale = !!sc.stale;
      let symbols = sp.list.map(x => x.symbol);
      if (index === 'DJI') { const d = await dowSymbols(); symbols = d.symbols; note = `구성: ${d.from}`; }
      ({ items, missing } = usItems(symbols, gicsOf(sp.list), sc.map, gicsSubOf(sp.list)));
      source = index === 'DJI' ? '나스닥 스크리너 · 위키백과' : '나스닥 스크리너 · S&P 500 구성 목록(GitHub datasets)';
    }
    items = items.map(x => ({ ...x, cap: Math.round(x.cap), p: round(x.p, 2), d: round(x.d, 2), c: round(x.c, 2), vol: x.vol == null ? null : Math.round(x.vol) }))
      .sort((a, b) => b.cap - a.cap);
    return { index, label: meta.label, market: meta.market, currency: meta.currency, scope: meta.scope, source, note, asOf, stale, fetchedAt: new Date(now()).toISOString(), count: items.length, missing, items };
  }

  return { load };
}
