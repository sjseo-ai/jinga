// 진가 유사 종목 추천 — GET /api/stock-analysis?peers=1&q=삼성전자 (또는 &s=005930&m=KR)
//   Hobby 요금제는 서버 함수 12개까지라 종목 분석 함수(api/stock-analysis.mjs)가 이 처리를 함께 맡습니다.
//   검색한 종목과 같은 테마(업종)에서 「비슷하되 추천할 만한」 종목 TOP 5 + 주요 재무 + 포워드 전망
//   · 검색: 코스피·코스닥 전 종목 + 미국 상장 전 종목(약 8,700종목, api/_universe.mjs)
//   · 진가 점수·적정가: 코스피·코스닥 시가총액 상위 100종목 + S&P 500 + 나스닥 100
//     그 밖의 종목은 기본 정보·업종·포워드 전망까지 보여 주고, 추천은 점수가 있는 종목 중에서 고릅니다.
//   · 점수·적정가·기대 상승여력은 진가 종목 분석(api/_analysis.mjs)과 같은 산식, 시장 상황(VIX)은 기본값 사용
//   · 포워드 전망 — 미국: 나스닥 애널리스트 컨센서스 EPS·목표가 / 국내: 네이버 금융 증권사 컨센서스(다음 회계연도)
//     회사가 직접 낸 가이던스가 아니라 애널리스트 추정치입니다.
//   &suggest=1 → 검색 후보만(전 종목 목록만 읽어 빠르게)
//   &cards=1&ids=KR:005930,US:MU → 포트폴리오용 여러 종목 카드 + 원/달러 환율(최대 30종목)
import { INDEXES } from './_market.mjs';
import { analyzeIndex } from './_analysis.mjs';
import { themeOf, searchStocks, rankPeers } from './_peers.mjs';
import { createUniverseStore } from './_universe.mjs';
import { buildKrFundamentals } from './_fundamentals.mjs';

const FUND_PATH = m => `stocks/fund-${m}.json`;
const INDEX_BY_MARKET = { KR: ['KOSPI', 'KOSDAQ'], US: ['SPX', 'NDX'] };
const NASDAQ_H = {
  Origin: 'https://www.nasdaq.com', Referer: 'https://www.nasdaq.com/', Accept: 'application/json, text/plain, */*',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
};

const mem = new Map();
async function memo(key, ttlMs, fn) {
  const h = mem.get(key);
  if (h && Date.now() - h.t < ttlMs) return h.v;
  const v = await fn();
  mem.set(key, { t: Date.now(), v });
  return v;
}
const json = (body, status, cache) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': cache } });
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const pctOf = (a, b) => (num(a) != null && num(b) != null && b !== 0 ? Math.round((a / b - 1) * 10000) / 10000 : null);
const ymLabel = k => String(k || '').replace(/^(\d{4})(\d{2})$/, '$1.$2');

/** 검색용 전 종목 목록(코스피·코스닥 전 종목 + 미국 상장 전 종목) — Blob 에 하루 한 번 모아 둠 */
let universeStore = null;
const universeOf = (store, market) => {
  if (!universeStore) universeStore = createUniverseStore({ store, marketSource: market });
  return universeStore;
};
const INDEX_LABEL = { SPX: 'S&P 500', NDX: '나스닥 100', DJI: '다우 30', KOSPI: '코스피', KOSDAQ: '코스닥' };
const idxLabels = row => (row.idx || []).map(k => INDEX_LABEL[k] || k);
const brief = row => ({ s: row.s, n: row.n, market: row.market, sec: row.sec || '', idx: idxLabels(row) });

/** 분석까지 끝낸 전체 목록 — 5분 보관. subFallback: 전 종목 목록의 업종(S&P 500 에 없는 미국 종목은 GICS 세부 업종이 비어 있음) */
const fullUniverse = (store, market, subFallback = new Map()) => memo('full', 5 * 60e3, async () => {
  const rows = [];
  const missing = [];
  for (const [m, ids] of Object.entries(INDEX_BY_MARKET)) {
    const fund = await store.get(FUND_PATH(m)).catch(() => null);
    if (!fund) { missing.push(m); continue; }
    for (const index of ids) {
      const data = await market.load(index).catch(() => null);
      if (!data) continue;
      const subOf = new Map(data.items.map(it => [it.s, it.sub || '']));
      const res = analyzeIndex({ market: data, fund, regime: {} });
      for (const st of res.stocks) {
        if (rows.some(r => r.s === st.s && r.market === m)) continue;
        const row = { ...st, market: m, index, currency: INDEXES[index].currency, sub: subOf.get(st.s) || subFallback.get(`${m}:${st.s}`) || '' };
        row.theme = themeOf(row);
        rows.push(row);
      }
    }
  }
  return { rows, missing, builtAt: new Date().toISOString() };
});

/** 나스닥 애널리스트 컨센서스 EPS·목표가 — 6시간 보관 */
const usForward = symbol => memo(`usfwd:${symbol}`, 6 * 3600e3, async () => {
  const sym = encodeURIComponent(symbol.replace('.', '-'));
  const get = async path => {
    try {
      const r = await fetch(`https://api.nasdaq.com/api/analyst/${sym}/${path}`, { headers: NASDAQ_H, signal: AbortSignal.timeout(12000) });
      return (await r.json()).data || null;
    } catch { return null; }
  };
  const [fc, tp] = await Promise.all([get('earnings-forecast'), get('targetprice')]);
  const rows = ((fc && fc.yearlyForecast && fc.yearlyForecast.rows) || []).slice(0, 2).map(r => ({
    fy: r.fiscalEnd || null, eps: num(r.consensusEPSForecast), low: num(r.lowEPSForecast), high: num(r.highEPSForecast),
    analysts: num(r.noOfEstimates), up: num(r.up), down: num(r.down),
  })).filter(r => r.eps != null);
  const o = (tp && tp.consensusOverview) || null;
  if (!rows.length && !o) return null;
  return {
    basis: '애널리스트 컨센서스(나스닥) — 회사 공식 가이던스가 아닌 추정치',
    years: rows,
    epsGrowth: rows.length >= 2 ? pctOf(rows[1].eps, rows[0].eps) : null,
    target: o && num(o.priceTarget), targetLow: o && num(o.lowPriceTarget), targetHigh: o && num(o.highPriceTarget),
    buy: o && num(o.buy), hold: o && num(o.hold), sell: o && num(o.sell),
  };
});

/** 국내 포워드 — 네이버 금융 증권사 컨센서스(다음 회계연도), 재무 Blob 에 이미 들어 있음 */
function krForward(f) {
  if (!f || !f.fwdKey) return null;
  // 지주회사는 컨센서스 영업이익에 지분법 이익이 섞여 매출 대비 비율이 100%를 넘기도 함(SK스퀘어 266%) → 그런 값은 표시하지 않음
  let opm = num(f.oiFwd) != null && num(f.revFwd) ? Math.round((f.oiFwd / f.revFwd) * 1000) / 10 : null;
  if (opm != null && Math.abs(opm) > 100) opm = null;
  return {
    basis: '증권사 컨센서스(네이버 금융) — 회사 공식 가이던스가 아닌 추정치',
    fy: ymLabel(f.fwdKey), unit: '억원',
    rev: num(f.revFwd), oi: num(f.oiFwd), ni: num(f.niFwd), opm,
    revGrowth: pctOf(f.revFwd, f.rev), oiGrowth: pctOf(f.oiFwd, f.oi),
    per: num(f.cnsPer), eps: num(f.cnsEps),
  };
}

function financialsOf(row, fundKR, fundUS) {
  if (row.market === 'KR') {
    const f = fundKR && fundKR.bySymbol ? fundKR.bySymbol[row.s] : null;
    if (!f) return null;
    return {
      unit: '억원', fy: ymLabel(f.fy), rev: num(f.rev), oi: num(f.oi), ni: num(f.ni),
      opm: num(f.opm), roe: num(f.roe), debtRatio: num(f.debtRatio),
      revGrowth: pctOf(f.rev, f.rev0), niGrowth: pctOf(f.ni, f.ni0),
    };
  }
  const f = fundUS && fundUS.bySymbol ? fundUS.bySymbol[row.s] : null;
  if (!f) return null;
  const per = fundUS.periods || {};
  return {
    unit: 'USD', fy: per.fy ? `FY${per.fy}` : null, fyEnd: f.fyEnd || null,
    rev: num(f.rev), oi: num(f.oi), ni: num(f.ni), equity: num(f.equity),
    opm: num(f.oi) != null && num(f.rev) ? Math.round((f.oi / f.rev) * 1000) / 10 : null,
    roe: num(f.ni) != null && num(f.equity) ? Math.round((f.ni / f.equity) * 1000) / 10 : null,
    revGrowth: pctOf(f.rev, f.rev0), niGrowth: pctOf(f.ni, f.ni0),
  };
}

/** 원/달러 환율(네이버 금융) — 10분 보관. 포트폴리오 원화 환산에 씁니다 */
const usdKrw = () => memo('fx', 10 * 60e3, async () => {
  try {
    const r = await fetch('https://m.stock.naver.com/front-api/marketIndex/prices?category=exchange&reutersCode=FX_USDKRW&page=1&pageSize=10',
      { headers: { Referer: 'https://m.stock.naver.com/', Accept: 'application/json' }, signal: AbortSignal.timeout(10000) });
    const j = await r.json();
    const row = ((j && j.result) || [])[0];
    const v = row ? Number(String(row.closePrice).replace(/,/g, '')) : NaN;
    return Number.isFinite(v) && v > 0 ? { rate: v, at: row.localTradedAt || null, source: '네이버 금융 원/달러' } : null;
  } catch { return null; }
});

/** 미국 종목 요약(나스닥) — 분석 대상이 아닌 종목의 기본 지표. 6시간 보관 */
const usSummary = symbol => memo(`ussum:${symbol}`, 6 * 3600e3, async () => {
  try {
    const sym = encodeURIComponent(symbol.replace('.', '-'));
    const r = await fetch(`https://api.nasdaq.com/api/quote/${sym}/summary?assetclass=stocks`, { headers: NASDAQ_H, signal: AbortSignal.timeout(12000) });
    const d = ((await r.json()).data || {}).summaryData || null;
    if (!d) return null;
    const v = k => (d[k] && d[k].value && d[k].value !== 'N/A' ? String(d[k].value) : null);
    const n = k => num(Number(String(v(k) || '').replace(/[$,%\s]/g, ''))) ;
    return { exchange: v('Exchange'), sector: v('Sector'), industry: v('Industry'), per: n('PERatio'), yield: n('Yield'), target1y: n('OneYrTarget'), range52: v('FiftTwoWeekHighLow') };
  } catch { return null; }
});

/** 국내 종목 정보·연간 재무(네이버) — 분석 대상이 아닌 종목을 그 자리에서 조회. 6시간 보관 */
const krDetail = code => memo(`krdet:${code}`, 6 * 3600e3, async () => {
  try {
    const r = await buildKrFundamentals({ codes: [code] });
    return (r && r.bySymbol && r.bySymbol[code]) || null;
  } catch { return null; }
});

/** 진가 분석 대상이 아닌 종목의 카드 — 점수·적정가 없이 기본 정보·업종·재무·포워드만 */
async function lightTarget(row) {
  const out = {
    s: row.s, n: row.n, market: row.market, index: (row.idx || [])[0] || null, idxLabels: idxLabels(row),
    currency: row.market === 'KR' ? 'KRW' : 'USD', p: row.p ?? null, cap: row.cap ?? null,
    sec: row.sec || '', industry: row.sub || '', analyzed: false, metrics: {}, financials: null, forward: null,
  };
  if (row.market === 'KR') {
    const f = await krDetail(row.s);
    if (f) {
      out.industry = f.industry || '';
      out.sec = f.sector || row.sec || '';
      out.metrics = { per: num(f.per), pbr: num(f.pbr), roe: num(f.roe) != null ? f.roe / 100 : null, divYield: num(f.divYield) };
      out.financials = { unit: '억원', fy: ymLabel(f.fy), rev: num(f.rev), oi: num(f.oi), ni: num(f.ni), opm: num(f.opm), roe: num(f.roe), debtRatio: num(f.debtRatio), revGrowth: pctOf(f.rev, f.rev0), niGrowth: pctOf(f.ni, f.ni0) };
      out.forward = krForward(f);
    }
  } else {
    const [sum, fwd] = await Promise.all([usSummary(row.s), usForward(row.s)]);
    if (sum) {
      out.industry = sum.industry || out.industry;
      out.metrics = { per: sum.per, divYield: sum.yield };
      out.exchange = sum.exchange;
      out.range52 = sum.range52;
    }
    out.forward = fwd;
  }
  out.theme = themeOf({ market: row.market, industry: out.industry, sub: row.market === 'US' ? out.industry : '' });
  return out;
}

const cardOf = row => ({
  s: row.s, n: row.n, market: row.market, index: row.index, currency: row.currency, analyzed: true,
  sec: row.sec, theme: row.theme || null, industry: row.market === 'KR' ? row.industry || null : row.sub || null,
  p: row.p, cap: row.cap, score: row.score ?? null, rec: row.rec ?? null, tier: row.tier || null,
  fair: row.fair ?? null, expUpside: row.expUpside ?? null, confidence: row.confidence || null, oneOff: !!row.oneOff, clamped: !!row.clamped,
  metrics: row.metrics || null, labels: row.labels || null, peer: row.peer || null,
  reasons: row.reasons || [], why: row.why || [],
});

export async function handlePeers(request, { store, market }) {
  const u = new URL(request.url);
  const q = (u.searchParams.get('q') || '').trim();
  const symbol = (u.searchParams.get('s') || '').trim();
  const mkt = (u.searchParams.get('m') || '').trim().toUpperCase();
  try {
    const uni = await universeOf(store, market).load();
    const matchOf = (rows, limit) => (symbol
      ? rows.filter(r => r.s.toUpperCase() === symbol.toUpperCase() && (!mkt || r.market === mkt))
      : searchStocks(rows, q, limit));

    if (u.searchParams.get('suggest')) {
      return json({ ok: true, q, count: uni.rows.length, matches: matchOf(uni.rows, 10).map(brief) }, 200, 'public, max-age=60, s-maxage=300');
    }
    // 포트폴리오용 — 여러 종목 카드를 한 번에(ids=KR:005930,US:MU). 점수 산정 대상이면 분석 카드, 아니면 기본 정보 카드
    if (u.searchParams.has('cards')) {
      const ids = (u.searchParams.get('ids') || '').split(',').map(x => x.trim()).filter(Boolean).slice(0, 30);
      if (!ids.length) return json({ ok: false, error: 'ids(예: KR:005930,US:MU)가 필요합니다' }, 400, 'no-store');
      const subFb = new Map(uni.rows.filter(r => r.sub).map(r => [`${r.market}:${r.s}`, r.sub]));
      const [{ rows: scoredRows, builtAt: scoredAt }, fx, fundKR, fundUS] = await Promise.all([
        fullUniverse(store, market, subFb).catch(() => ({ rows: [], builtAt: null })),
        usdKrw(),
        store.get(FUND_PATH('KR')).catch(() => null), store.get(FUND_PATH('US')).catch(() => null),
      ]);
      const cards = await Promise.all(ids.map(async id => {
        const [m0, s0] = id.includes(':') ? id.split(':') : ['', id];
        const mk = m0.toUpperCase() === 'US' ? 'US' : m0.toUpperCase() === 'KR' ? 'KR' : '';
        const key = s0.toUpperCase();
        const hitRow = uni.rows.find(r => r.s.toUpperCase() === key && (!mk || r.market === mk));
        if (!hitRow) return { s: s0, market: mk || 'KR', error: '목록에 없는 종목' };
        const sc = scoredRows.find(r => r.s === hitRow.s && r.market === hitRow.market);
        if (!sc) return lightTarget(hitRow);
        const c = cardOf(sc);
        c.financials = financialsOf(sc, fundKR, fundUS);
        c.forward = sc.market === 'KR' ? krForward(fundKR && fundKR.bySymbol ? fundKR.bySymbol[sc.s] : null) : await usForward(sc.s);
        return c;
      }));
      return json({ ok: true, cards, fx, asOf: scoredAt, universeAt: uni.builtAt }, 200, 'public, max-age=60, s-maxage=300');
    }

    if (!q && !symbol) return json({ ok: false, error: 'q(종목명·티커) 또는 s(종목코드)&m(KR|US)가 필요합니다' }, 400, 'no-store');

    const found = matchOf(uni.rows, 8);
    if (!found.length) {
      return json({ ok: false, error: `「${q || symbol}」을(를) 찾지 못했습니다. 코스피·코스닥 전 종목과 미국 상장 전 종목(${uni.rows.length.toLocaleString('ko-KR')}종목) 안에서 찾습니다.` }, 404, 'no-store');
    }
    const hit = found[0];

    const subFallback = new Map(uni.rows.filter(r => r.sub).map(r => [`${r.market}:${r.s}`, r.sub]));
    const { rows, missing, builtAt } = await fullUniverse(store, market, subFallback);
    if (!rows.length) {
      return json({ ok: false, preparing: true, error: '종목 재무 데이터를 처음 모으는 중입니다. 주식 탭의 종목 분석을 먼저 열어 주세요(1~2분).' }, 202, 'no-store');
    }
    const [fundKR, fundUS] = await Promise.all([store.get(FUND_PATH('KR')).catch(() => null), store.get(FUND_PATH('US')).catch(() => null)]);
    const build = async row => {
      const c = cardOf(row);
      c.financials = financialsOf(row, fundKR, fundUS);
      c.forward = row.market === 'KR'
        ? krForward(fundKR && fundKR.bySymbol ? fundKR.bySymbol[row.s] : null)
        : await usForward(row.s);
      return c;
    };

    // 진가 점수가 있는 종목이면 분석 결과를, 아니면 그 자리에서 기본 정보를 모아 기준 종목으로 씁니다
    const scored = rows.find(r => r.s === hit.s && r.market === hit.market) || null;
    const target = scored || await lightTarget(hit);
    const peers = rankPeers(target, rows, { limit: 5, minOther: 2 });
    const [targetCard, peerCards] = await Promise.all([scored ? build(scored) : target, Promise.all(peers.map(build))]);

    return json({
      ok: true, q: q || symbol, asOf: builtAt, universeAt: uni.builtAt,
      matches: found.slice(1, 6).map(brief),
      target: targetCard, peers: peerCards,
      universe: { count: uni.rows.length, scored: rows.length, missing, markets: '검색 = 코스피·코스닥 전 종목 + 미국 상장 전 종목 / 점수 = 코스피·코스닥 상위 100 + S&P 500 + 나스닥 100' },
      notes: [
        targetCard.analyzed
          ? '같은 테마(국내 네이버 업종 ↔ 미국 업종)에서 먼저 고르고, 테마가 없으면 같은 섹터에서 고릅니다.'
          : '이 종목은 진가 점수·적정가 산정 대상(코스피·코스닥 상위 100 · S&P 500 · 나스닥 100)이 아니어서 기본 정보와 포워드 전망만 보여 주고, 추천 종목은 점수가 있는 같은 테마에서 골랐습니다.',
        '추천 순서 = 진가 점수 + 기대 상승여력(최대 ±10, 적정가가 현재가 2배 상한에 걸린 종목은 제외) − 적정가 신뢰도 낮음 5점 − 일회성 영향 3점. 국내·미국을 섞어 보여 주려고 다른 시장 종목을 최소 2곳 넣습니다.',
        '포워드 전망은 애널리스트 컨센서스(미국 나스닥 · 국내 네이버)이며 회사가 직접 낸 가이던스가 아닙니다. 참고용이며 투자 권유가 아닙니다.',
      ],
    }, 200, 'public, max-age=120, s-maxage=600, stale-while-revalidate=1800');
  } catch (e) {
    return json({ ok: false, error: `유사 종목을 찾지 못했습니다: ${e.message}` }, 502, 'no-store');
  }
}
