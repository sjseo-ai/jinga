/**
 * 진가(JINGA) 재테크 페이지 — 시세 프록시 (Cloudflare Worker)
 * ============================================================
 * 용도: jinga-retech.html의 QUOTE_API.base 에 이 Worker의 배포 URL을 넣으면
 *       코스피·코스닥·개별 종목(국내/해외)·S&P500·나스닥100·다우존스·VIX가
 *       "종가/참고" 표시 대신 실시간 값으로 갱신됩니다.
 *
 * 데이터 소스 (2026-09 개편)
 * -------------------------------------------------------------
 * - 국내(코스피·코스닥 지수 + 국내 개별 종목): 네이버 금융(m.stock.naver.com)을
 *   1순위로 사용합니다. 야후보다 국내 종목 커버리지·안정성이 좋습니다.
 *   실패 시(응답 형식 변경, 일시 차단 등) 자동으로 Yahoo Finance로 대체(fallback)합니다.
 * - 해외(S&P500·나스닥100·다우존스·VIX + 해외 개별 종목): Yahoo Finance만 사용합니다
 *   (네이버는 국내 시세 전용이라 해외는 커버하지 않음).
 * - 환율(USD/KRW, JPY/KRW)도 Yahoo(KRW=X, JPYKRW=X)로 실시간 조회합니다.
 * - POST /history 는 스파크라인(최근 30일 종가)·YTD 계산용 1년치 일봉을 Yahoo에서
 *   가져옵니다(1시간 캐시).
 * - Cloudflare 무료 플랜은 Worker 요청 1건당 외부 호출(subrequest) 50개 제한이 있어,
 *   프론트엔드가 심볼을 30개씩 나눠 호출합니다(한 번에 63개를 보내면 뒤쪽 13개가 누락됨).
 * - 두 소스 모두 실패하면 해당 종목/지수는 응답에서 조용히 생략되고,
 *   jinga-retech.html은 이미 "값이 없으면 건드리지 않음" 로직이라 안전하게
 *   참고(종가) 데이터로 남습니다 — 페이지가 깨지지 않습니다.
 *
 * 꼭 읽어주세요 — 두 소스 모두 "비공식" 엔드포인트입니다
 * -------------------------------------------------------------
 * 1) 네이버 금융(m.stock.naver.com/api/...)과 Yahoo Finance
 *    (query1.finance.yahoo.com/v8/finance/chart/...) 둘 다 각 회사가
 *    자사 웹/앱에서 내부적으로 쓰는 비공식 엔드포인트입니다. 공식 API 키
 *    발급도, SLA도, 지원 계약도 없습니다.
 *    - 브라우저에서 곧바로 fetch하면 CORS로 막히므로, 이 Worker가
 *      중간에서 대신 호출하고 CORS 헤더를 붙여줍니다.
 *    - 두 회사 다 예고 없이 응답 형식을 바꾸거나 차단을 강화할 수
 *      있습니다. 국내는 네이버 실패 시 야후로 자동 대체되므로 한쪽만
 *      바뀌어도 즉시 죽지는 않지만, 둘 다 바뀌면 해당 항목만 참고
 *      데이터로 조용히 되돌아갑니다.
 * 2) 상업적 대량 이용이나 재배포는 두 서비스 약관상 회색지대입니다.
 *    개인 프로젝트·소규모 트래픽 수준의 "표시용" 조회로 이해하고 쓰세요.
 * 3) 무료로 계속 쓰고 싶다면 요청 빈도를 과하게 올리지 마세요(아래
 *    CACHE_TTL_SECONDS로 어느 정도 자동 방지됩니다).
 *
 * 배포 방법 (Cloudflare 계정만 있으면 5분, 무료)
 * -------------------------------------------------------------
 * 1) https://dash.cloudflare.com → Workers & Pages → Create → "Create Worker"
 * 2) 이름은 아무거나(예: jinga-yahoo-proxy) 정하고 배포
 * 3) 생성된 Worker의 "Edit code"(Quick Edit)를 열어 기본 코드를 전부 지우고
 *    이 파일 내용을 그대로 붙여넣기 → Deploy
 * 4) 화면에 나오는 배포 URL(예: https://jinga-yahoo-proxy.<계정>.workers.dev)을
 *    복사
 * 5) jinga-retech.html에서 QUOTE_API 부분을 찾아:
 *      const QUOTE_API = {
 *        base: 'https://jinga-yahoo-proxy.<계정>.workers.dev',
 *        refreshMs: 30000   // 30초마다 자동 갱신하고 싶으면 이렇게, 수동이면 0
 *      };
 *    로 base 값만 채워 넣으면 끝 — 프론트엔드 코드는 이미 이 응답 형식에
 *    맞춰져 있어서 다른 곳은 손댈 필요가 없습니다.
 */

// 페이지의 BENCH[].code(짧은 코드) → Yahoo Finance 심볼 (해외 지수 + 국내 지수 대체용)
const SYMBOL_MAP = {
  KS11: '^KS11',  // 코스피
  KQ11: '^KQ11',  // 코스닥
  GSPC: '^GSPC',  // S&P 500
  NDX:  '^NDX',   // 나스닥 100
  DJI:  '^DJI',   // 다우존스
  VIX:  '^VIX',   // VIX(공포지수)
  USDKRW: 'KRW=X',    // 달러/원 (Yahoo 실시간 — ECB 일 1회 고시보다 빠름)
  JPYKRW: 'JPYKRW=X', // 엔/원 (1엔 기준. 페이지가 ×100 해서 100엔 기준으로 표시)
};

// 페이지의 BENCH[].code → 네이버 금융 지수 코드 (국내 지수만 존재)
const NAVER_INDEX_MAP = {
  KS11: 'KOSPI',
  KQ11: 'KOSDAQ',
};

const CACHE_TTL_SECONDS = 45;   // 두 소스 모두 공식 rate limit을 공개하지 않으므로 보수적으로 캐시
const HISTORY_TTL_SECONDS = 3600; // 1년치 일봉(스파크라인·YTD용)은 1시간 캐시 — 자주 바뀔 이유가 없음
const ALLOWED_ORIGIN = '*';     // 페이지를 특정 도메인에 고정 배포한다면 그 origin으로 좁히는 걸 권장
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function corsHeaders(extra) {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    ...extra,
  };
}

async function fetchYahooChart(yahooSymbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=1d&range=1d`;
  const res = await fetch(url, {
    headers: {
      // User-Agent 없이 호출하면 종종 차단됩니다(2026년 기준 관찰된 동작 — Yahoo가
      // 언제든 바꿀 수 있으니 이 값이 낡았다면 최신 Chrome UA로 교체하세요).
      'User-Agent': UA,
      'Accept': 'application/json',
    },
    cf: { cacheTtl: CACHE_TTL_SECONDS, cacheEverything: true },
  });
  if (!res.ok) throw new Error(`Yahoo upstream HTTP ${res.status}`);
  const data = await res.json();
  const result = data && data.chart && data.chart.result && data.chart.result[0];
  if (!result || !result.meta) throw new Error('Yahoo 응답 형식이 예상과 다릅니다 (엔드포인트가 바뀌었을 수 있음)');

  const meta = result.meta;
  const price = meta.regularMarketPrice;
  const prevClose = meta.chartPreviousClose ?? meta.previousClose;
  if (typeof price !== 'number' || typeof prevClose !== 'number') {
    throw new Error('가격 필드 누락');
  }
  const change = price - prevClose;
  const changePct = prevClose ? (change / prevClose) * 100 : 0;

  return {
    price,
    change: Number(change.toFixed(4)),
    changePct: Number(changePct.toFixed(4)),
    currency: meta.currency || null,
    marketState: meta.marketState || null,
    asOf: meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : null,
    source: 'yahoo',
  };
}

// 네이버 금융 모바일 API 공통 호출 (지수/개별 종목 둘 다 같은 "basic" 응답 형태)
async function fetchNaverBasic(path) {
  const url = `https://m.stock.naver.com/api/${path}/basic`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      'Accept': 'application/json',
      // Referer가 없으면 종종 차단됩니다 — 네이버가 자사 페이지에서만 호출되길
      // 기대하는 비공식 엔드포인트라 그렇습니다.
      'Referer': 'https://m.stock.naver.com/',
    },
    cf: { cacheTtl: CACHE_TTL_SECONDS, cacheEverything: true },
  });
  if (!res.ok) throw new Error(`Naver upstream HTTP ${res.status}`);
  return res.json();
}

// 네이버 응답(문자열·콤마 포함 숫자, 상승/하락 code 등)을 공통 스키마로 변환
function parseNaverQuote(data) {
  if (!data || data.closePrice == null || data.compareToPreviousClosePrice == null) {
    throw new Error('Naver 응답 형식이 예상과 다릅니다 (엔드포인트가 바뀌었을 수 있음)');
  }
  const price = Number(String(data.closePrice).replace(/,/g, ''));
  const changeAbs = Math.abs(Number(String(data.compareToPreviousClosePrice).replace(/,/g, '')));
  const ratioAbs = Math.abs(Number(String(data.fluctuationsRatio || '0').replace(/,/g, '')));
  if (!isFinite(price)) throw new Error('Naver 가격 파싱 실패');
  // compareToPreviousPrice.code: 1 상한가, 2 상승, 3 보합, 4 하락, 5 하한가
  const dirCode = data.compareToPreviousPrice && data.compareToPreviousPrice.code;
  const sign = (dirCode === '4' || dirCode === '5') ? -1 : 1;
  return {
    price,
    change: Number((changeAbs * sign).toFixed(4)),
    changePct: Number((ratioAbs * sign).toFixed(4)),
    currency: 'KRW',
    marketState: null,
    asOf: data.localTradedAt || new Date().toISOString(),
    source: 'naver',
  };
}

function fetchNaverIndex(navCode) {
  return fetchNaverBasic('index/' + navCode).then(parseNaverQuote);
}

function fetchNaverStock(code) {
  return fetchNaverBasic('stock/' + code).then(parseNaverQuote);
}

// 지수 하나를 조회 — 국내 지수는 네이버 우선, 실패하면 Yahoo로 자동 대체. 해외 지수는 Yahoo만.
function fetchIndexQuote(code) {
  const navCode = NAVER_INDEX_MAP[code];
  if (navCode) {
    return fetchNaverIndex(navCode).catch(function(e) {
      console.log('[jinga-yahoo-proxy] 네이버 지수 조회 실패(' + code + '), Yahoo로 대체: ' + (e.message || e));
      return fetchYahooChart(SYMBOL_MAP[code]);
    });
  }
  return fetchYahooChart(SYMBOL_MAP[code]);
}

// 종목 하나를 조회 — 국내 종목은 네이버 우선, 실패하면 Yahoo(.KS/.KQ)로 자동 대체. 해외 종목은 Yahoo만.
function fetchStockQuote(s) {
  if (s.type === 'kr') {
    return fetchNaverStock(s.code).catch(function(e) {
      console.log('[jinga-yahoo-proxy] 네이버 종목 조회 실패(' + s.code + '), Yahoo로 대체: ' + (e.message || e));
      return fetchYahooChart(s.code + (s.market === 'KOSDAQ' ? '.KQ' : '.KS'));
    });
  }
  return fetchYahooChart(s.code);
}

// ── 과거 시세(스파크라인 30일 + YTD) ─────────────────────────────────────────
// 요청 심볼을 Yahoo 심볼로 변환 (국내 종목은 .KS/.KQ, 지수·환율은 SYMBOL_MAP)
function yahooSymbolFor(s) {
  if (!s || !s.code) return null;
  if (s.type === 'index') return SYMBOL_MAP[s.code] || null;
  if (s.type === 'kr') return s.code + (s.market === 'KOSDAQ' ? '.KQ' : '.KS');
  if (s.type === 'us') return s.code;
  return null;
}

// (timestamp[], close[]) → { closes: 최근 30개, ytdPct, asOf }
// YTD 기준값은 "전년도 마지막 종가"(1y 범위 안에 있음). 없으면 범위 첫 값.
function summarizeSeries(timestamps, closes) {
  const pts = [];
  if (Array.isArray(timestamps) && Array.isArray(closes)) {
    for (let i = 0; i < timestamps.length; i++) {
      if (typeof closes[i] === 'number' && isFinite(closes[i]) && timestamps[i]) pts.push({ t: timestamps[i], c: closes[i] });
    }
  }
  if (pts.length < 2) throw new Error('히스토리 데이터 부족');
  const last = pts[pts.length - 1];
  const year = new Date(last.t * 1000).getUTCFullYear();
  let base = null;
  for (const p of pts) { if (new Date(p.t * 1000).getUTCFullYear() < year) base = p; }
  if (!base) base = pts[0];
  const ytdPct = base.c ? (last.c / base.c - 1) * 100 : null;
  return {
    closes: pts.slice(-30).map(function(p){ return Number(p.c.toFixed(4)); }),
    ytdPct: ytdPct == null ? null : Number(ytdPct.toFixed(2)),
    asOf: new Date(last.t * 1000).toISOString(),
  };
}

// 여러 심볼을 한 번에 — Yahoo spark 엔드포인트 (subrequest 절약: 20심볼당 1회 호출)
async function fetchYahooSpark(yahooSymbols) {
  const url = `https://query1.finance.yahoo.com/v8/finance/spark?symbols=${encodeURIComponent(yahooSymbols.join(','))}&range=1y&interval=1d`;
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept': 'application/json' },
    cf: { cacheTtl: HISTORY_TTL_SECONDS, cacheEverything: true },
  });
  if (!res.ok) throw new Error(`Yahoo spark HTTP ${res.status}`);
  const data = await res.json();
  const list = data && data.spark && data.spark.result;
  if (!Array.isArray(list)) throw new Error('Yahoo spark 응답 형식이 예상과 다릅니다');
  const out = {};
  for (const r of list) {
    const resp = r && r.response && r.response[0];
    if (!resp) continue;
    const q = resp.indicators && resp.indicators.quote && resp.indicators.quote[0];
    try { out[r.symbol] = summarizeSeries(resp.timestamp, q && q.close); } catch (e) { /* 개별 심볼 실패는 건너뜀 */ }
  }
  return out;
}

// spark 실패 시 심볼별 chart 엔드포인트로 대체
async function fetchYahooChartHistory(yahooSymbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=1d&range=1y`;
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept': 'application/json' },
    cf: { cacheTtl: HISTORY_TTL_SECONDS, cacheEverything: true },
  });
  if (!res.ok) throw new Error(`Yahoo chart HTTP ${res.status}`);
  const data = await res.json();
  const result = data && data.chart && data.chart.result && data.chart.result[0];
  const q = result && result.indicators && result.indicators.quote && result.indicators.quote[0];
  return summarizeSeries(result && result.timestamp, q && q.close);
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }

    // jinga-retech.html의 fetchQuotes()가 그대로 호출하는 계약:
    //   POST /quotes  { symbols: [{ type:'index'|'kr'|'us', code, market? }, ...] }
    //   → { [code]: { price, change, changePct, ... }, ... }
    // 국내(index의 KS11/KQ11, type:'kr')는 네이버 우선 + Yahoo 대체,
    // 해외(index의 나머지, type:'us')는 Yahoo만 사용합니다.
    if (request.method === 'POST') {
      let body;
      try {
        body = await request.json();
      } catch {
        return new Response(JSON.stringify({ error: 'invalid JSON body' }), {
          status: 400, headers: corsHeaders({ 'Content-Type': 'application/json' }),
        });
      }
      const symbols = Array.isArray(body?.symbols) ? body.symbols : [];
      const pathname = new URL(request.url).pathname;

      // POST /history  { symbols:[...] } → { [code]: { closes:[30개], ytdPct, asOf } }
      // 스파크라인·YTD용 1년치 일봉. Yahoo만 사용(네이버는 일봉 배치 조회 엔드포인트가 불안정).
      // ⚠️ Cloudflare 무료 플랜은 요청당 subrequest 50개 제한 — 프론트엔드가 30개씩 나눠 호출합니다.
      if (pathname === '/history') {
        const wanted = []; const seenH = {};
        symbols.forEach(function(s){ const y = yahooSymbolFor(s); if (!y || seenH[s.code]) return; seenH[s.code] = true; wanted.push({ code: s.code, yahoo: y }); });
        const hist = {};
        const batches = []; for (let i = 0; i < wanted.length; i += 20) batches.push(wanted.slice(i, i + 20));
        await Promise.all(batches.map(async function(batch){
          let got = null;
          try { got = await fetchYahooSpark(batch.map(function(w){ return w.yahoo; })); }
          catch (e) { console.log('[jinga-yahoo-proxy] spark 실패, chart로 대체: ' + (e.message || e)); }
          await Promise.all(batch.map(async function(w){
            if (got && got[w.yahoo]) { hist[w.code] = got[w.yahoo]; return; }
            try { hist[w.code] = await fetchYahooChartHistory(w.yahoo); }
            catch (e) { console.log('[jinga-yahoo-proxy] 히스토리 실패(' + w.code + '): ' + (e.message || e)); }
          }));
        }));
        return new Response(JSON.stringify(hist), {
          status: 200,
          headers: corsHeaders({ 'Content-Type': 'application/json' }),
        });
      }
      const indexCodes = symbols.filter(function(s){ return s && s.type === 'index' && SYMBOL_MAP[s.code]; }).map(function(s){ return s.code; });
      const uniqueCodes = [...new Set(indexCodes)];
      const stockSyms = symbols.filter(function(s){ return s && s.code && (s.type === 'kr' || s.type === 'us'); }).map(function(s){ return { code: s.code, type: s.type, market: s.market }; });
      const seenStock = {};
      const stockList = stockSyms.filter(function(s){ if (seenStock[s.code]) return false; seenStock[s.code] = true; return true; });

      const out = {};
      await Promise.all(uniqueCodes.map(function(code){
        return fetchIndexQuote(code).then(function(r){ out[code] = r; }).catch(function(e){ console.log('[jinga-yahoo-proxy] ' + code + ' 조회 완전 실패: ' + (e.message || e)); });
      }));
      await Promise.all(stockList.map(function(s){
        return fetchStockQuote(s).then(function(r){ out[s.code] = r; }).catch(function(e){ console.log('[jinga-yahoo-proxy] ' + s.code + ' 조회 완전 실패: ' + (e.message || e)); });
      }));

      return new Response(JSON.stringify(out), {
        status: 200,
        headers: corsHeaders({ 'Content-Type': 'application/json' }),
      });
    }

    // GET /health — 배포 확인용
    return new Response(JSON.stringify({ ok: true, service: 'jinga-yahoo-proxy', symbols: Object.keys(SYMBOL_MAP), naverIndex: Object.keys(NAVER_INDEX_MAP), endpoints: ['POST /quotes', 'POST /history'] }), {
      headers: corsHeaders({ 'Content-Type': 'application/json' }),
    });
  },
};
