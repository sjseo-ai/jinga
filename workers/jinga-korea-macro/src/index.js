/**
 * 진가(JINGA) 재테크 페이지 — 국내 거시지표 프록시 (Cloudflare Worker)
 * ============================================================
 * 담당 범위:
 *   GET /rate/base      → 한국은행 기준금리 (한국은행 ECOS OpenAPI)
 *   GET /housing/weekly → 주간 아파트 매매가격지수 · 변동률 (한국부동산원 R-ONE, 자체 Open API)
 *   GET /rate/mortgage  → 4대 은행 주택담보대출(아파트·분할상환) 공시금리 (금융감독원 "금융상품 한눈에" Open API)
 *   GET /trade/apt      → 서울 25개 자치구 아파트 매매 실거래 집계 (국토교통부, 공공데이터포털 data.go.kr)
 *
 * 주담대 금리는 은행연합회 소비자포털에 공식 API가 없어 한동안 참고 데이터였으나,
 * 2026-09 금융감독원 "금융상품 한눈에" Open API(/rate/mortgage)로 최신 공시월을 실측 연동했습니다.
 *
 * ⚠️ API 키는 절대 이 파일에 하드코딩하지 마세요.
 * Cloudflare 대시보드의 Worker → Settings → Variables and Secrets 에서
 *   ECOS_API_KEY  = 한국은행 ECOS 인증키 (https://ecos.bok.or.kr/api/ 회원가입 후 발급)
 *   REB_API_KEY   = 한국부동산원 R-ONE 자체 Open API 인증키
 *                   (https://www.reb.or.kr/r-one/portal/openapi/openApiActKeyPage.do
 *                    → "인증키 발급" 탭에서 활용용도/내용 입력 후 즉시 발급됨, 로그인 필요)
 *   FSS_API_KEY   = 금융감독원 금융상품 한눈에 Open API 인증키 (https://finlife.fss.or.kr → Open API → 인증키 신청, 즉시 발급)
 *   MOLIT_API_KEY = 공공데이터포털(data.go.kr) 인증키 — "국토교통부_아파트 매매 실거래가 자료" 활용신청 후 발급
 * 이렇게 "Secret" 타입으로 등록하면 코드에는 안 보이고 env.ECOS_API_KEY / env.REB_API_KEY 로만
 * 접근됩니다. (wrangler CLI라면: wrangler secret put ECOS_API_KEY / REB_API_KEY)
 *
 * ── 신뢰도 안내 (2026-09-02, 실제 발급받은 키로 두 엔드포인트 모두 라이브 테스트 완료) ──
 * · /rate/base: 통계표코드 722Y001(기준금리 및 여수신금리) · 항목코드 0101000(기준금리) —
 *   실제 키로 호출 성공, 2026-07-04 이후 값 2.5% 확인.
 * · /housing/weekly: 한국부동산원 R-ONE **자체** Open API
 *   (data.go.kr/odcloud 경유가 아니라 https://www.reb.or.kr/r-one/openapi/ 를 직접 호출합니다 —
 *   이전 버전의 odcloud 엔드포인트는 필드명을 확정 못해 추정 파싱이었는데, 이번에 R-ONE 포털에서
 *   실제 서비스 상세("통계 조회 조건 설정")를 확인하고 실 데이터로 검증했습니다).
 *   - STATBL_ID = T244183132827305  ("(주) 매매가격지수" — 주간 아파트 매매가격지수)
 *   - DTACYCLE_CD = WK (주기코드: 주간)
 *   - ITM_ID = 10001 (이 표의 유일한 항목: "지수")
 *   - CLS_ID(지역코드): 전국=50001, 서울=50008, 송파구=50069, 강동구=50070
 *   - "주간 변동률"은 별도 통계표가 없어 — 같은 지수 시계열의 최근 2개 값을 비교해 계산합니다
 *     (프론트엔드의 renderPulse()가 이미 하는 방식과 동일).
 *   - 응답은 WRTTIME_IDTFR_ID(예: "202635") 오름차순 정렬로 오므로, 마지막 행이 최신값입니다.
 *   - 실 테스트 결과 예시: 전국 지수 2026-08-24 기준 100.6386 (전주 100.5258 대비 +0.11%).
 */

const ALLOWED_ORIGIN = '*';
const CACHE_TTL_SECONDS = 1800; // 기준금리·주간지수는 자주 안 바뀌므로 30분 캐시
const STALE_CACHE_TTL_SECONDS = 300; // "마지막 성공값"으로 응답할 때는 5분만 캐시 → 원천이 살아나면 곧바로 교체
const LAST_GOOD_TTL_SECONDS = 60 * 60 * 24 * 14; // 마지막 성공값 보관 기간(14일)
const UA_BROWSER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// Cron 트리거(wrangler.toml [triggers]) — 방문자가 없어도 주기적으로 원천을 조회해 "마지막 성공값"을 최신으로 유지
const CRON_MACRO = '*/30 * * * *';   // 기준금리·주간지수·주담대
const CRON_TRADE = '20 */6 * * *';   // 실거래가(외부 호출 25~50회라 따로 분리 — 무료 플랜 요청당 50회 한도)

/* ── 마지막 성공값(last-good) 보관 ─────────────────────────────
   원천 API가 일시 장애·차단(예: ECOS가 Cloudflare 해외 IP에 404)이어도 페이지가 "참고 데이터"로
   되돌아가지 않도록, 성공할 때마다 결과를 저장해 두고 실패 시 그 값을 stale:true 로 돌려줍니다.
   · KV 바인딩(JINGA_KV)이 있으면 KV에 저장 — 전 세계 엣지에서 공유되고 영구 보관(권장)
   · 없으면 엣지 캐시(Cache API)에 14일 보관 — 요청이 들어온 데이터센터 단위로만 유지됨 */
const LAST_GOOD_ORIGIN = 'https://last-good.jinga.internal/';

async function saveLastGood(env, name, data) {
  const record = JSON.stringify({ savedAt: new Date().toISOString(), data });
  if (env.JINGA_KV) {
    try { await env.JINGA_KV.put('lastgood:' + name, record); } catch (e) { console.log(`[last-good] KV 저장 실패(${name}): ${e.message || e}`); }
  }
  try {
    await caches.default.put(new Request(LAST_GOOD_ORIGIN + encodeURIComponent(name)), new Response(record, {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${LAST_GOOD_TTL_SECONDS}` },
    }));
  } catch (e) { console.log(`[last-good] 캐시 저장 실패(${name}): ${e.message || e}`); }
}

async function loadLastGood(env, name) {
  if (env.JINGA_KV) {
    try { const v = await env.JINGA_KV.get('lastgood:' + name); if (v) return JSON.parse(v); } catch (e) { /* 캐시로 대체 */ }
  }
  try {
    const hit = await caches.default.match(new Request(LAST_GOOD_ORIGIN + encodeURIComponent(name)));
    if (hit) return await hit.json();
  } catch (e) { /* 없음 */ }
  return null;
}

// fn()이 성공하면 저장 후 { ok, data }, 실패하면 마지막 성공값을 { ok, stale:true, staleSince, error, data } 로
async function withLastGood(env, name, fn) {
  try {
    const data = await fn();
    await saveLastGood(env, name, data);
    return { ok: true, data };
  } catch (e) {
    const prev = await loadLastGood(env, name);
    if (prev && prev.data) return { ok: true, stale: true, staleSince: prev.savedAt, error: String(e.message || e), data: prev.data };
    throw e;
  }
}

function corsHeaders(extra) {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    ...extra,
  };
}

function ymd(d) {
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

/* ── 한국은행 ECOS: 기준금리 ─────────────────────────────────
   https://ecos.bok.or.kr/api/StatisticSearch/{인증키}/json/kr/{startIdx}/{endIdx}/722Y001/D/{시작}/{끝}/0101000
   통계표코드 722Y001 = 한국은행 기준금리 및 여수신금리, 항목코드 0101000 = 기준금리
   ⚠ startIdx~endIdx는 "행 범위"이지 날짜 범위가 아닙니다 — 응답은 날짜 오름차순이라
   endIdx를 너무 작게 잡으면(예: 10) 최신값이 아니라 조회기간 중 "가장 오래된" 값들만
   돌아옵니다. 기준금리는 자주 안 바뀌어도 조회기간(60일)에 며칠분이 잡힐 수 있으므로
   넉넉히 100으로 잡아 항상 마지막(최신) 행을 정확히 가져오도록 합니다. */
// ECOS 호출 공통 — 브라우저 UA를 붙이고 실패 시 1회 재시도.
// (2026-09-11 확인: 같은 URL이 국내에서는 200인데 Worker에서는 404 — ECOS가 해외 IP를 거르는 것으로 보임.
//  재시도로도 안 되면 withLastGood()이 마지막 성공값으로 응답합니다.)
async function fetchEcosJson(url) {
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA_BROWSER, 'Accept': 'application/json' } });
      if (!res.ok) throw new Error(`ECOS upstream HTTP ${res.status}`);
      return await res.json();
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

// 대체 경로: ECOS "100대 통계지표"(KeyStatisticList)에도 기준금리가 들어 있음
async function fetchBaseRateFromKeyStats(env) {
  const data = await fetchEcosJson(`https://ecos.bok.or.kr/api/KeyStatisticList/${env.ECOS_API_KEY}/json/kr/1/120`);
  const rows = data?.KeyStatisticList?.row;
  const row = Array.isArray(rows) ? rows.find(r => /기준금리/.test(r.KEYSTAT_NAME || '')) : null;
  if (!row) throw new Error('ECOS 100대 통계지표에 기준금리 없음');
  return {
    value: Number(row.DATA_VALUE),
    unit: row.UNIT_NAME || '%',
    asOf: row.CYCLE,
    itemName: '한국은행 기준금리',
    source: 'ECOS(한국은행) 100대 통계지표',
  };
}

async function fetchBaseRate(env) {
  if (!env.ECOS_API_KEY) throw new Error('ECOS_API_KEY 미설정');
  try {
    return await fetchBaseRateFromSearch(env);
  } catch (e) {
    console.log(`[ecos] StatisticSearch 실패, 100대 통계지표로 대체: ${e.message || e}`);
    return fetchBaseRateFromKeyStats(env);
  }
}

async function fetchBaseRateFromSearch(env) {
  const today = new Date();
  const from = new Date(today.getTime() - 1000 * 60 * 60 * 24 * 60); // 최근 60일 중 최신값
  const url = `https://ecos.bok.or.kr/api/StatisticSearch/${env.ECOS_API_KEY}/json/kr/1/100/722Y001/D/${ymd(from)}/${ymd(today)}/0101000`;
  const data = await fetchEcosJson(url);
  if (data.RESULT && data.RESULT.CODE && data.RESULT.CODE !== 'INFO-000') {
    throw new Error(`ECOS 오류: ${data.RESULT.CODE} ${data.RESULT.MESSAGE || ''}`);
  }
  const rows = data?.StatisticSearch?.row;
  if (!Array.isArray(rows) || !rows.length) throw new Error('ECOS 응답에 데이터 없음');
  const last = rows[rows.length - 1]; // 가장 최근 값 (오름차순 정렬이므로 마지막 행)
  return {
    value: Number(last.DATA_VALUE),
    unit: last.UNIT_NAME || '%',
    asOf: last.TIME, // YYYYMMDD
    itemName: last.ITEM_NAME1 || '한국은행 기준금리',
    source: 'ECOS(한국은행) 722Y001',
  };
}

/* ── 한국부동산원 R-ONE: 주간 아파트 매매가격지수 · 변동률 ─────
   R-ONE 자체 Open API (data.go.kr 경유 아님)
   https://www.reb.or.kr/r-one/openapi/SttsApiTblData.do
     ?KEY=...&Type=json&pIndex=1&pSize=1000
     &STATBL_ID=T244183132827305&DTACYCLE_CD=WK&ITM_ID=10001&CLS_ID={지역코드}
   지역코드: 전국=50001, 서울=50008, 송파구=50069, 강동구=50070 */
const HOUSING_STATBL_ID = 'T244183132827305';
const HOUSING_ITM_ID = '10001';
const HOUSING_REGIONS = {
  전국: '50001',
  서울: '50008',
  송파구: '50069',
  강동구: '50070',
};

async function fetchWeeklyIndexSeries(env, clsId) {
  const url = `https://www.reb.or.kr/r-one/openapi/SttsApiTblData.do`
    + `?KEY=${encodeURIComponent(env.REB_API_KEY)}&Type=json&pIndex=1&pSize=1000`
    + `&STATBL_ID=${HOUSING_STATBL_ID}&DTACYCLE_CD=WK&ITM_ID=${HOUSING_ITM_ID}&CLS_ID=${clsId}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`R-ONE upstream HTTP ${res.status}`);
  const data = await res.json();
  const body = Array.isArray(data?.SttsApiTblData) ? data.SttsApiTblData : null;
  const head = body?.[0]?.head;
  const resultInfo = head?.find(h => h.RESULT)?.RESULT;
  if (resultInfo && resultInfo.CODE && resultInfo.CODE !== 'INFO-000') {
    throw new Error(`R-ONE 오류: ${resultInfo.CODE} ${resultInfo.MESSAGE || ''}`);
  }
  const rows = body?.[1]?.row;
  if (!Array.isArray(rows) || !rows.length) throw new Error('R-ONE 응답에 데이터 없음');
  // WRTTIME_IDTFR_ID 기준 오름차순 정렬을 보장(응답이 이미 오름차순이지만 방어적으로 재정렬)
  rows.sort((a, b) => String(a.WRTTIME_IDTFR_ID).localeCompare(String(b.WRTTIME_IDTFR_ID)));
  return rows;
}

async function fetchWeeklyHousing(env) {
  if (!env.REB_API_KEY) throw new Error('REB_API_KEY 미설정');

  const entries = await Promise.all(
    Object.entries(HOUSING_REGIONS).map(async ([name, clsId]) => {
      const rows = await fetchWeeklyIndexSeries(env, clsId);
      const last = rows[rows.length - 1];
      const prev = rows[rows.length - 2];
      const index = Number(last.DTA_VAL);
      const prevIndex = prev ? Number(prev.DTA_VAL) : null;
      const wowChangePct = prevIndex ? Number((((index - prevIndex) / prevIndex) * 100).toFixed(4)) : null;
      // 최근 60주 히스토리(차트용, 1년치 주간 차트에 넉넉하도록) — 오래된 데이터부터
      const history = rows.slice(-60).map(r => ({ asOf: r.WRTTIME_DESC, value: Number(r.DTA_VAL) }));
      return [name, {
        index,
        wowChangePct,
        asOf: last.WRTTIME_DESC, // YYYY-MM-DD
        prevIndex,
        prevAsOf: prev ? prev.WRTTIME_DESC : null,
        history,
      }];
    })
  );

  return {
    regions: Object.fromEntries(entries),
    itemName: '아파트 매매가격지수(주간)',
    source: '한국부동산원 R-ONE(자체 Open API) — 통계표 T244183132827305',
  };
}

/* ── 금융감독원 "금융상품 한눈에": 주택담보대출 공시금리 ─────────
   https://finlife.fss.or.kr/finlifeapi/mortgageLoanProductsSearch.json?auth={키}&topFinGrpNo=020000&pageNo=N
   topFinGrpNo 020000 = 은행. 응답 result.baseList(상품) + result.optionList(금리 옵션).
   optionList: mrtg_type A=아파트/E=아파트외, rpay_type D=분할상환/S=만기일시, lend_rate_type F=고정/C=변동,
               lend_rate_min / lend_rate_max / lend_rate_avg (전월 취급 평균), dcls_month(공시월 YYYYMM)
   ※ 이 API는 "현재 공시월"만 제공(과거 월 조회 불가) → 페이지의 12개월 추이 중 최신월만 실측으로 교체됩니다. */
const MORTGAGE_BANKS = { 'KB국민': '국민', '신한': '신한', '하나': '하나', '우리': '우리' };

async function fetchMortgageRates(env) {
  if (!env.FSS_API_KEY) throw new Error('FSS_API_KEY 미설정');
  const baseList = [], optionList = [];
  let month = null;
  for (let page = 1; page <= 5; page++) {
    const url = `https://finlife.fss.or.kr/finlifeapi/mortgageLoanProductsSearch.json?auth=${encodeURIComponent(env.FSS_API_KEY)}&topFinGrpNo=020000&pageNo=${page}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`FSS upstream HTTP ${res.status}`);
    const data = await res.json();
    const r = data && data.result;
    if (!r) throw new Error('FSS 응답 형식이 예상과 다릅니다');
    if (r.err_cd && r.err_cd !== '000') throw new Error(`FSS 오류: ${r.err_cd} ${r.err_msg || ''}`);
    (r.baseList || []).forEach(b => baseList.push(b));
    (r.optionList || []).forEach(o => optionList.push(o));
    if (!month && r.baseList && r.baseList[0]) month = r.baseList[0].dcls_month;
    const maxPage = Number(r.max_page_no || 1);
    if (page >= maxPage) break;
  }
  if (!optionList.length) throw new Error('FSS 응답에 금리 옵션 없음');

  const coName = {};
  baseList.forEach(b => { coName[b.fin_co_no] = b.kor_co_nm; });
  const prdtName = {};
  baseList.forEach(b => { prdtName[b.fin_co_no + '|' + b.fin_prdt_cd] = b.fin_prdt_nm; });

  const num = v => (v === null || v === undefined || v === '') ? null : Number(v);
  const banks = {};
  for (const [label, keyword] of Object.entries(MORTGAGE_BANKS)) {
    // 아파트 · 분할상환 옵션만. 고정(혼합)금리 옵션이 있으면 그것을 우선(페이지의 "혼합형" 기준과 맞춤).
    const all = optionList.filter(o => (coName[o.fin_co_no] || '').includes(keyword) && o.mrtg_type === 'A' && o.rpay_type === 'D');
    const fixed = all.filter(o => o.lend_rate_type === 'F');
    const use = fixed.length ? fixed : all;
    if (!use.length) { banks[label] = null; continue; }
    const mins = use.map(o => num(o.lend_rate_min)).filter(v => v !== null);
    const maxs = use.map(o => num(o.lend_rate_max)).filter(v => v !== null);
    const avgs = use.map(o => num(o.lend_rate_avg)).filter(v => v !== null);
    banks[label] = {
      min: mins.length ? Math.min(...mins) : null,
      max: maxs.length ? Math.max(...maxs) : null,
      avg: avgs.length ? Number((avgs.reduce((a, b) => a + b, 0) / avgs.length).toFixed(2)) : null,
      rateType: fixed.length ? '고정(혼합)' : '변동',
      products: [...new Set(use.map(o => prdtName[o.fin_co_no + '|' + o.fin_prdt_cd]).filter(Boolean))],
    };
  }
  const present = Object.values(banks).filter(Boolean);
  if (!present.length) throw new Error('4대 은행 아파트 주담대 옵션을 찾지 못했습니다(은행명 매칭 실패)');
  const bandMin = Math.min(...present.map(b => b.min).filter(v => v !== null));
  const bandMax = Math.max(...present.map(b => b.max).filter(v => v !== null));
  return {
    month,                       // 공시월 YYYYMM
    banks,
    band: { min: bandMin, max: bandMax },
    productCount: baseList.length,
    source: '금융감독원 금융상품 한눈에 Open API (mortgageLoanProductsSearch, 은행권)',
  };
}

/* ══════════════════════════════════════════════════════════════════
   국토교통부 아파트 실거래가 (공공데이터포털 data.go.kr) — GET /trade/apt[?month=YYYYMM]
   서울 25개 자치구 × 법정동 집계. 응답은 jinga-retech.html의 window.jingaApplyTrade()가 소비.
   MOLIT_API_KEY = 공공데이터포털 인증키 (Secret). 실거래 신고가 계약 후 30일 이내라 기본 조회월은
   매월 15일 이전이면 두 달 전, 이후면 지난달. 무료 플랜 한도(요청당 외부호출 50) 안에서 25개 구 × 1페이지.
   ══════════════════════════════════════════════════════════════════ */
const TRADE_CACHE_TTL_SECONDS = 21600; // 6시간
const PYEONG = 3.3058;
// data.go.kr 키는 "Encoding"(이미 %2B·%3D 로 인코딩된 것)과 "Decoding" 두 종류가 있음 — 어느 쪽을 넣어도 동작하도록 처리
const UA_MOLIT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
// data.go.kr 인증키는 "Encoding"(이미 %2B·%3D 로 인코딩됨)과 "Decoding" 두 형태로 발급됩니다.
// 어느 쪽을 Secret에 넣어도 동작하도록, 이미 퍼센트 인코딩된 키는 그대로 쓰고 아니면 인코딩합니다.
function molitKey(env) { const k = String(env.MOLIT_API_KEY || ''); return /%[0-9A-Fa-f]{2}/.test(k) ? k : encodeURIComponent(k); }

// 서울 25개 자치구 법정동코드 앞 5자리(LAWD_CD)
const GU_CODES = {
  종로구: '11110', 중구: '11140', 용산구: '11170', 성동구: '11200', 광진구: '11215',
  동대문구: '11230', 중랑구: '11260', 성북구: '11290', 강북구: '11305', 도봉구: '11320',
  노원구: '11350', 은평구: '11380', 서대문구: '11410', 마포구: '11440', 양천구: '11470',
  강서구: '11500', 구로구: '11530', 금천구: '11545', 영등포구: '11560', 동작구: '11590',
  관악구: '11620', 서초구: '11650', 강남구: '11680', 송파구: '11710', 강동구: '11740',
};

// 기본 조회월: KST 기준, 15일 이전이면 두 달 전 / 이후면 지난달
function defaultMonth() {
  const kst = new Date(Date.now() + 9 * 3600 * 1000);
  let y = kst.getUTCFullYear(), m = kst.getUTCMonth() + 1; // 1~12 (이번 달)
  const back = kst.getUTCDate() < 15 ? 2 : 1;
  m -= back;
  while (m <= 0) { m += 12; y -= 1; }
  return `${y}${String(m).padStart(2, '0')}`;
}

// 아주 단순한 XML 태그 추출 (Workers에는 DOMParser가 없음)
function tag(xml, name) {
  const m = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return m ? m[1].trim() : null;
}

async function fetchGuPage(env, lawdCd, month, pageNo) {
  const url = `https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade`
    + `?serviceKey=${molitKey(env)}&LAWD_CD=${lawdCd}&DEAL_YMD=${month}&pageNo=${pageNo}&numOfRows=1000`;
  let res = await fetch(url, { headers: { 'User-Agent': UA_MOLIT, 'Accept': 'application/xml,text/xml,*/*' }, cf: { cacheTtl: TRADE_CACHE_TTL_SECONDS, cacheEverything: true } });
  let xml = await res.text();
  // 403(등록되지 않은 서비스키)이면 키 인코딩 형태를 반대로 바꿔 한 번 더 시도 — Encoding/Decoding 키 혼동 방지
  if (res.status === 403) {
    const raw = String(env.MOLIT_API_KEY || '');
    let alt = null;
    try { alt = /%[0-9A-Fa-f]{2}/.test(raw) ? decodeURIComponent(raw) : encodeURIComponent(encodeURIComponent(raw)); } catch (e) { alt = null; }
    if (alt) {
      const altUrl = url.replace(/serviceKey=[^&]*/, 'serviceKey=' + alt);
      const res2 = await fetch(altUrl, { headers: { 'User-Agent': UA_MOLIT, 'Accept': 'application/xml,text/xml,*/*' }, cf: { cacheTtl: TRADE_CACHE_TTL_SECONDS, cacheEverything: true } });
      if (res2.status !== 403) { res = res2; xml = await res2.text(); }
    }
  }
  if (!res.ok) throw new Error(`MOLIT upstream HTTP ${res.status}: ${(tag(xml, 'returnAuthMsg') || tag(xml, 'resultMsg') || tag(xml, 'errMsg') || xml.replace(/\s+/g, ' ').slice(0, 160))}`);
  const resultCode = tag(xml, 'resultCode');
  if (resultCode !== '000' && resultCode !== '00') {
    const msg = tag(xml, 'resultMsg') || tag(xml, 'returnAuthMsg') || tag(xml, 'errMsg') || xml.slice(0, 200);
    throw new Error(`MOLIT 오류: ${resultCode || '?'} ${msg}`);
  }
  const totalCount = Number(tag(xml, 'totalCount') || 0);
  const items = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = re.exec(xml))) {
    const it = m[1];
    if ((tag(it, 'cdealType') || '') === 'O') continue; // 해제된 거래 제외
    const amount = Number(String(tag(it, 'dealAmount') || '').replace(/[,\s]/g, ''));
    const area = Number(tag(it, 'excluUseAr'));
    const dong = tag(it, 'umdNm');
    if (!isFinite(amount) || !amount || !isFinite(area) || !area || !dong) continue;
    items.push({
      dong, amount, area, perPyeong: amount / (area / PYEONG), apt: tag(it, 'aptNm') || '',
      buildYear: Number(tag(it, 'buildYear')) || null, floor: tag(it, 'floor') || '', day: Number(tag(it, 'dealDay')) || null,
    });
  }
  return { totalCount, items };
}

async function fetchGu(env, name, lawdCd, month) {
  const first = await fetchGuPage(env, lawdCd, month, 1);
  let items = first.items;
  if (first.totalCount > 1000) {
    try { items = items.concat((await fetchGuPage(env, lawdCd, month, 2)).items); }
    catch (e) { console.log(`[trade] ${name} 2페이지 실패: ${e.message || e}`); }
  }
  return items;
}

/* ── 단지 검색: GET /trade/complexes?gu=강동구,송파구&months=3 ─────────────
   선택 자치구 × 최근 N개월(이번 달 포함) 실거래를 단지·전용면적(㎡ 반올림)별로 묶어
   가장 최근 거래가·거래일·기간 내 최저/최고·건수를 돌려줍니다. 페이지는 "최근 거래가 ≤ 예산"으로 거릅니다.
   무료 플랜 요청당 외부 호출 50회 한도 → 자치구 수 × 개월 수 ≤ 45 로 제한, 구·월당 1페이지(최대 1,000건). */
const COMPLEX_MAX_CALLS = 45;

function recentMonths(n) {
  const kst = new Date(Date.now() + 9 * 3600 * 1000);
  let y = kst.getUTCFullYear(), m = kst.getUTCMonth() + 1;
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(`${y}${String(m).padStart(2, '0')}`);
    m -= 1;
    if (m === 0) { m = 12; y -= 1; }
  }
  return out;
}

async function fetchComplexes(env, guNames, months) {
  if (!env.MOLIT_API_KEY) throw new Error('MOLIT_API_KEY 미설정');
  const errors = [];
  const pages = await Promise.all(guNames.flatMap(gu => months.map(async month => {
    try {
      return { gu, month, items: (await fetchGuPage(env, GU_CODES[gu], month, 1)).items };
    } catch (e) {
      errors.push(`${gu} ${month}: ${e.message || e}`);
      return { gu, month, items: [] };
    }
  })));

  const groups = new Map();
  for (const p of pages) {
    for (const it of p.items) {
      const key = `${p.gu}|${it.dong}|${it.apt}|${Math.round(it.area)}`;
      const date = `${p.month.slice(0, 4)}-${p.month.slice(4, 6)}-${String(it.day || 1).padStart(2, '0')}`;
      let g = groups.get(key);
      if (!g) {
        g = { gu: p.gu, dong: it.dong, apt: it.apt, buildYear: it.buildYear, count: 0, min: it.amount, max: it.amount, latest: null };
        groups.set(key, g);
      }
      g.count++;
      g.min = Math.min(g.min, it.amount);
      g.max = Math.max(g.max, it.amount);
      if (!g.latest || date > g.latest.date) g.latest = { date, amount: it.amount, area: it.area, floor: it.floor };
    }
  }
  if (!groups.size && errors.length) throw new Error('실거래 조회 실패 — ' + errors[0]);
  const complexes = [...groups.values()].sort((a, b) => b.latest.date.localeCompare(a.latest.date));
  return {
    months,                // 최신월부터, 예: ['202609','202608','202607']
    gu: guNames,
    count: complexes.length,
    complexes,             // [{ gu, dong, apt, buildYear, count, min, max, latest:{date, amount(만원), area, floor} }]
    errors,
    asOf: new Date().toISOString(),
    source: '국토교통부 아파트 매매 실거래가 자료 (공공데이터포털 data.go.kr, RTMSDataSvcAptTrade)',
  };
}

function mean(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null; }
function median(arr) {
  if (!arr.length) return null;
  const s = arr.slice().sort((a, b) => a - b), i = Math.floor(s.length / 2);
  return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2;
}

async function fetchSeoulTrades(env, month) {
  if (!env.MOLIT_API_KEY) throw new Error('MOLIT_API_KEY 미설정');
  const gu = {};
  const errors = [];
  await Promise.all(Object.entries(GU_CODES).map(async ([name, code]) => {
    try {
      const items = await fetchGu(env, name, code, month);
      const byDong = {};
      items.forEach(it => { (byDong[it.dong] = byDong[it.dong] || []).push(it); });
      const dongs = Object.entries(byDong).map(([dname, list]) => ({
        name: dname,
        count: list.length,
        avgPerPyeong: Math.round(mean(list.map(i => i.perPyeong))),
        avgAmount: Math.round(mean(list.map(i => i.amount))),
      })).sort((a, b) => b.count - a.count);
      gu[name] = {
        count: items.length,
        avgPerPyeong: items.length ? Math.round(mean(items.map(i => i.perPyeong))) : null,
        medianPerPyeong: items.length ? Math.round(median(items.map(i => i.perPyeong))) : null,
        dongs,
      };
    } catch (e) {
      errors.push(`${name}: ${e.message || e}`);
      gu[name] = null;
    }
  }));
  const ok = Object.values(gu).filter(Boolean);
  if (!ok.length) throw new Error('모든 자치구 조회 실패 — ' + (errors[0] || '원인 불명'));
  const allPer = ok.flatMap(g => g.dongs.flatMap(d => Array(d.count).fill(d.avgPerPyeong)));
  return {
    month,
    asOf: new Date().toISOString(),
    seoul: { count: ok.reduce((s, g) => s + g.count, 0), avgPerPyeong: Math.round(mean(allPer)) },
    gu,
    errors,
    source: '국토교통부 아파트 매매 실거래가 자료 (공공데이터포털 data.go.kr, RTMSDataSvcAptTrade)',
  };
}

const MACRO_ENDPOINTS = {
  '/rate/base': { name: 'base', fetch: fetchBaseRate },
  '/housing/weekly': { name: 'housing', fetch: fetchWeeklyHousing },
  '/rate/mortgage': { name: 'mortgage', fetch: fetchMortgageRates },
};

// 실패(502)에는 Cache-Control을 붙이지 않음 — 브라우저가 실패 응답을 30분간 재사용하던 문제 방지
function jsonResponse(body, status, maxAgeSeconds) {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders(status === 200
      ? { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${maxAgeSeconds}` }
      : { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }),
  });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }
    const url = new URL(request.url);
    // 진단용: /trade/probe — 국토부 키가 어떤 응답을 받는지 확인(키 값은 노출하지 않고 길이만 표시). 연동 확인 후 제거 가능.
    if (url.pathname === '/trade/probe') { const raw = String(env.MOLIT_API_KEY || ''); const variants = { raw: raw, encoded: encodeURIComponent(raw), decodedThenEncoded: (function(){ try { return encodeURIComponent(decodeURIComponent(raw)); } catch (e) { return raw; } })() }; const outp = { keyLen: raw.length, hasPercentEscape: /%[0-9A-Fa-f]{2}/.test(raw), hasPlusOrSlash: /[+/=]/.test(raw), results: [] }; for (const [label, kv] of Object.entries(variants)) { try { const rr = await fetch('https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade?serviceKey=' + kv + '&LAWD_CD=11680&DEAL_YMD=202607&pageNo=1&numOfRows=3', { headers: { 'User-Agent': UA_MOLIT } }); const tx = await rr.text(); outp.results.push({ label, status: rr.status, ok: tx.indexOf('<resultCode>00') >= 0, msg: (tag(tx, 'returnAuthMsg') || tag(tx, 'resultMsg') || tx.replace(/\s+/g, ' ').slice(0, 120)) }); } catch (e) { outp.results.push({ label, error: String(e.message || e) }); } } return new Response(JSON.stringify(outp), { headers: corsHeaders({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }) }); }

    if (url.pathname === '/trade/complexes') {
      const months = recentMonths(Math.min(3, Math.max(1, Number(url.searchParams.get('months')) || 3)));
      const guNames = [...new Set((url.searchParams.get('gu') || '').split(',').map(s => s.trim()).filter(g => GU_CODES[g]))].sort();
      if (!guNames.length) return jsonResponse({ ok: false, error: 'gu 파라미터에 서울 자치구 이름을 1개 이상 넣으세요(쉼표 구분)' }, 400, 0);
      if (guNames.length * months.length > COMPLEX_MAX_CALLS) {
        return jsonResponse({ ok: false, error: `최근 ${months.length}개월 기준 한 번에 자치구 ${Math.floor(COMPLEX_MAX_CALLS / months.length)}개까지 조회할 수 있습니다` }, 400, 0);
      }
      const ckey = new Request(`${url.origin}/trade/complexes?gu=${encodeURIComponent(guNames.join(','))}&months=${months.join(',')}`);
      const chit = await caches.default.match(ckey);
      if (chit) return chit;
      let cbody, cstatus = 200;
      try { cbody = await withLastGood(env, `complexes:${months.join(',')}:${guNames.join(',')}`, () => fetchComplexes(env, guNames, months)); }
      catch (e) { cstatus = 502; cbody = { ok: false, error: String(e.message || e) }; }
      const cres = jsonResponse(cbody, cstatus, cbody.stale ? STALE_CACHE_TTL_SECONDS : TRADE_CACHE_TTL_SECONDS);
      if (cstatus === 200) await caches.default.put(ckey, cres.clone());
      return cres;
    }

    // /trade/apt 는 월 단위로 캐시 키를 정규화(쿼리 유무와 무관하게 같은 달이면 같은 캐시)
    if (url.pathname === '/trade/apt') {
      const month = /^\d{6}$/.test(url.searchParams.get('month') || '') ? url.searchParams.get('month') : defaultMonth();
      const tcache = caches.default;
      const tkey = new Request(`${url.origin}/trade/apt?month=${month}`, { method: 'GET' });
      const hit = await tcache.match(tkey);
      if (hit) return hit;
      let tbody, tstatus = 200;
      try { tbody = await withLastGood(env, 'trade:' + month, () => fetchSeoulTrades(env, month)); }
      catch (e) { tstatus = 502; tbody = { ok: false, error: String(e.message || e) }; }
      const tres = jsonResponse(tbody, tstatus, tbody.stale ? STALE_CACHE_TTL_SECONDS : TRADE_CACHE_TTL_SECONDS);
      if (tstatus === 200) await tcache.put(tkey, tres.clone());
      return tres;
    }

    const cache = caches.default;
    const cacheKey = new Request(url.toString(), request);
    const cached = await cache.match(cacheKey);
    if (cached) return cached;

    const endpoint = MACRO_ENDPOINTS[url.pathname];
    let body, status = 200;
    try {
      if (endpoint) {
        body = await withLastGood(env, endpoint.name, () => endpoint.fetch(env));
      } else {
        body = { ok: true, service: 'korea-macro-proxy', endpoints: [...Object.keys(MACRO_ENDPOINTS), '/trade/apt?month=YYYYMM', '/trade/complexes?gu=강동구,송파구&months=3'], defaultTradeMonth: defaultMonth(), cron: [CRON_MACRO, CRON_TRADE], lastGoodStore: env.JINGA_KV ? 'kv' : 'edge-cache', keys: { ECOS: !!env.ECOS_API_KEY, REB: !!env.REB_API_KEY, FSS: !!env.FSS_API_KEY, MOLIT: !!env.MOLIT_API_KEY } };
      }
    } catch (e) {
      status = 502;
      body = { ok: false, error: String(e.message || e) };
    }

    const response = jsonResponse(body, status, body.stale ? STALE_CACHE_TTL_SECONDS : CACHE_TTL_SECONDS);
    if (status === 200) await cache.put(cacheKey, response.clone());
    return response;
  },

  // Cron 트리거: 방문자 유무와 관계없이 원천을 조회해 마지막 성공값을 갱신(KV 바인딩 시 전 엣지 공유)
  async scheduled(event, env, ctx) {
    const jobs = event.cron === CRON_TRADE
      ? [{ name: 'trade:' + defaultMonth(), fetch: () => fetchSeoulTrades(env, defaultMonth()) }]
      : Object.values(MACRO_ENDPOINTS).map(ep => ({ name: ep.name, fetch: () => ep.fetch(env) }));
    ctx.waitUntil(Promise.allSettled(jobs.map(job =>
      job.fetch().then(
        data => saveLastGood(env, job.name, data),
        e => console.log(`[cron] ${job.name} 실패: ${e.message || e}`)
      )
    )));
  },
};
