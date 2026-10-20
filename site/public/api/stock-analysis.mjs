// 진가 종목 분석 — GET /api/stock-analysis?index=SPX|NDX|DJI|KOSPI|KOSDAQ
//   시세(_market.mjs) + 재무(Blob stocks/fund-US.json · fund-KR.json, _fundamentals.mjs) + 시장 상황(VIX·지수 연초 대비, 시세 Worker)
//   → _analysis.mjs 점수·적정가·시나리오·유망 섹터/종목 TOP 3. 응답은 CDN 5분 보관.
//   재무가 없으면 모으기 시작하고 202(preparing), 20시간 지났으면 이전 값으로 답하면서 뒤에서 새로 모음.
//   GET ?index=…&rebuild=1 (관리 키 또는 관리자 로그인) — 재무를 지금 다시 모음
import { waitUntil } from '@vercel/functions';
import { blobStore } from './_blob.mjs';
import { adminAuth } from './_auth.mjs';
import { createMarketSource, INDEXES } from './_market.mjs';
import { buildUsFundamentals, buildKrFundamentals } from './_fundamentals.mjs';
import { analyzeIndex } from './_analysis.mjs';
import { handlePeers } from './_peers-api.mjs';   // ?peers=1 — 유사 종목 추천(Hobby 함수 12개 제한이라 한 함수에서 함께 처리)
import { createHistory, MAX_SYMBOLS } from './_history.mjs';   // ?history=1 — 매매 기록의 기간 수익률에 쓰는 과거 종가

const market = createMarketSource();
const history = createHistory();
const QUOTE_WORKER = 'https://jinga-yahoo-proxy.tjtlswns95.workers.dev';
const NASDAQ_H = { Origin: 'https://www.nasdaq.com', Referer: 'https://www.nasdaq.com/', Accept: 'application/json, text/plain, */*', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36' };
const FUND_PATH = m => `stocks/fund-${m}.json`;
const LOCK_PATH = m => `stocks/fund-${m}-building.json`;
const FUND_STALE_MS = 20 * 3600e3;
const LOCK_MS = 10 * 60e3;
const TREND_CODE = { SPX: 'GSPC', NDX: 'NDX', DJI: 'DJI', KOSPI: 'KS11', KOSDAQ: 'KQ11' };

const mem = new Map();
async function memo(key, ttlMs, fn, emptyTtlMs = ttlMs) {
  const h = mem.get(key);
  if (h && Date.now() - h.t < (h.v == null ? emptyTtlMs : ttlMs)) return h.v;
  const v = await fn();
  mem.set(key, { t: Date.now(), v });
  return v;
}
const json = (body, status, cache) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': cache } });

async function universe(m) {
  const ids = m === 'US' ? ['SPX', 'NDX'] : ['KOSPI', 'KOSDAQ'];
  const lists = await Promise.all(ids.map(i => market.load(i)));
  return [...new Set(lists.flatMap(l => l.items.map(x => x.s)))];
}

async function buildFundamentals(store, m) {
  const lock = await store.get(LOCK_PATH(m));
  if (lock && Date.now() - Date.parse(lock.startedAt) < LOCK_MS) return { skipped: '다른 요청이 모으는 중' };
  await store.put(LOCK_PATH(m), { startedAt: new Date().toISOString() });
  try {
    const symbols = await universe(m);
    const fund = m === 'US' ? await buildUsFundamentals({ symbols }) : await buildKrFundamentals({ codes: symbols });
    await store.put(FUND_PATH(m), fund);
    mem.set(`fund:${m}`, { t: Date.now(), v: fund });
    return { count: fund.count, requested: fund.requested, failures: fund.failures, builtAt: fund.builtAt };
  } finally {
    await store.del(LOCK_PATH(m)).catch(() => {});
  }
}

const getFund = (store, m) => memo(`fund:${m}`, 10 * 60e3, () => store.get(FUND_PATH(m)), 30e3);

/** 시장 상황 — VIX 와 지수 연초 대비(시세 Worker), 10분 보관 */
const regimeFor = index => memo(`regime:${index}`, 10 * 60e3, async () => {
  const out = { vix: null, trendPct: null, trendLabel: `${INDEXES[index].label} 연초 대비` };
  const post = (path, symbols) => fetch(`${QUOTE_WORKER}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ symbols }), signal: AbortSignal.timeout(20000),
  }).then(r => r.json());
  const [q, h] = await Promise.all([
    post('/quotes', [{ type: 'index', code: 'VIX' }]).catch(() => ({})),
    post('/history', [{ type: 'index', code: TREND_CODE[index] }]).catch(() => ({})),
  ]);
  if (q.VIX && typeof q.VIX.price === 'number') out.vix = q.VIX.price;
  const hist = h[TREND_CODE[index]];
  if (hist && typeof hist.ytdPct === 'number') out.trendPct = hist.ytdPct;
  return out;
});

/** 나스닥 애널리스트 평균 목표가 — TOP 3 참고용, 6시간 보관 */
const analystTarget = symbol => memo(`analyst:${symbol}`, 6 * 3600e3, async () => {
  try {
    const r = await fetch(`https://api.nasdaq.com/api/analyst/${encodeURIComponent(symbol.replace('.', '-'))}/targetprice`, { headers: NASDAQ_H, signal: AbortSignal.timeout(10000) });
    const o = ((await r.json()).data || {}).consensusOverview;
    return o && o.priceTarget > 0 ? { target: o.priceTarget, low: o.lowPriceTarget, high: o.highPriceTarget, buy: o.buy, hold: o.hold, sell: o.sell } : null;
  } catch { return null; }
});

export async function GET(request) {
  const u = new URL(request.url);
  if (u.searchParams.has('peers')) return handlePeers(request, { store: blobStore(), market });
  if (u.searchParams.has('history')) {
    // ?history=1&ids=KR:005930,US:MU&from=2025-01-02 — 종목 일별 종가 + 코스피·S&P 500 + 원/달러
    const ids = String(u.searchParams.get('ids') || '').split(',').map(s => s.trim()).filter(Boolean);
    const from = String(u.searchParams.get('from') || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) return json({ ok: false, error: 'from 은 YYYY-MM-DD 여야 합니다' }, 400, 'no-store');
    if (ids.length > MAX_SYMBOLS) return json({ ok: false, error: `종목은 한 번에 ${MAX_SYMBOLS}개까지입니다` }, 400, 'no-store');
    try {
      return json({ ok: true, ...(await history.load(ids, from)) }, 200, 'public, max-age=300, s-maxage=1800, stale-while-revalidate=3600');
    } catch (e) {
      return json({ ok: false, error: `과거 시세를 가져오지 못했습니다: ${e.message}` }, 502, 'no-store');
    }
  }
  const index = String(u.searchParams.get('index') || '').toUpperCase();
  if (!INDEXES[index]) return json({ ok: false, error: `index 는 ${Object.keys(INDEXES).join('·')} 중 하나여야 합니다` }, 400, 'no-store');
  const store = blobStore();
  const m = INDEXES[index].market;
  try {
    if (u.searchParams.get('rebuild')) {
      if (!(await adminAuth(request, store))) return json({ ok: false, error: 'unauthorized' }, 401, 'no-store');
      return json({ ok: true, built: await buildFundamentals(store, m) }, 200, 'no-store');
    }
    const fund = await getFund(store, m);
    if (!fund) {
      waitUntil(buildFundamentals(store, m).catch(e => console.error(`[stock-analysis] ${m} 재무 수집 실패:`, e.message)));
      return json({ ok: false, preparing: true, error: '재무 데이터를 처음 모으는 중입니다(1~2분). 잠시 뒤 자동으로 다시 불러옵니다.' }, 202, 'no-store');
    }
    if (Date.now() - Date.parse(fund.builtAt) > FUND_STALE_MS) {
      waitUntil(buildFundamentals(store, m).catch(e => console.error(`[stock-analysis] ${m} 재무 갱신 실패:`, e.message)));
    }
    const [data, regime] = await Promise.all([market.load(index), regimeFor(index)]);
    const result = analyzeIndex({ market: data, fund, regime });
    if (m === 'US') {
      await Promise.all(result.top.map(async s => {
        const a = await analystTarget(s);
        const st = result.stocks.find(x => x.s === s);
        if (st && a) st.analyst = a;
      }));
    }
    return json({ ok: true, ...result }, 200, 'public, max-age=60, s-maxage=300, stale-while-revalidate=900');
  } catch (e) {
    return json({ ok: false, index, error: `${INDEXES[index].label} 종목 분석에 실패했습니다: ${e.message}` }, 502, 'no-store');
  }
}
