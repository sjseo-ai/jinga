/**
 * 진가(JINGA) 재테크 페이지 — 아파트 실거래가 프록시 (Cloudflare Worker)
 * ============================================================
 * 담당 범위:
 *   GET /trade/apt[?month=YYYYMM] → 서울 25개 자치구 아파트 매매 실거래 집계
 *       (국토교통부 "아파트 매매 실거래가 자료" — 공공데이터포털 data.go.kr)
 *
 * 응답 형식 (jinga-retech.html의 window.jingaApplyTrade()가 그대로 소비):
 *   { ok:true, data:{ month:'202608', asOf:'2026-09-10T..', seoul:{count, avgPerPyeong},
 *       gu:{ '강남구':{ count, avgPerPyeong, medianPerPyeong,
 *                       dongs:[{ name:'역삼동', count, avgPerPyeong, avgAmount }, ...] }, ... } } }
 *   avgPerPyeong = 전용면적 3.3058㎡(1평)당 거래금액(만원) 평균. avgAmount = 거래금액(만원) 평균.
 *
 * ⚠️ API 키는 절대 이 파일에 하드코딩하지 마세요.
 *   Cloudflare 대시보드 → 이 Worker → Settings → Variables and Secrets 에서
 *   MOLIT_API_KEY = 공공데이터포털(data.go.kr) 인증키 (일반 인증키 Decoding 값. 특수문자가 없으면 Encoding/Decoding 동일)
 *
 * 왜 "지난달"을 기본으로 쓰나:
 *   실거래 신고는 계약 후 30일 이내라, 이번 달 데이터는 항상 절반쯤 비어 있습니다. 기본값은
 *   매월 15일 이전이면 "두 달 전", 15일 이후면 "지난달"(신고가 대부분 들어온 시점)입니다.
 *   ?month=YYYYMM 으로 특정 월을 지정할 수도 있습니다.
 *
 * Cloudflare 무료 플랜 한도: 요청당 외부 호출 50개 → 25개 구 × 1페이지(최대 1,000건) = 25회.
 *   한 구의 월 거래가 1,000건을 넘으면 2페이지를 추가로 가져옵니다(서울에서 드묾).
 *   집계 결과는 6시간 캐시합니다(실거래 데이터는 하루 단위로 갱신되므로 충분).
 */

const ALLOWED_ORIGIN = '*';
const CACHE_TTL_SECONDS = 21600; // 6시간
const PYEONG = 3.3058;

// 서울 25개 자치구 법정동코드 앞 5자리(LAWD_CD)
const GU_CODES = {
  종로구: '11110', 중구: '11140', 용산구: '11170', 성동구: '11200', 광진구: '11215',
  동대문구: '11230', 중랑구: '11260', 성북구: '11290', 강북구: '11305', 도봉구: '11320',
  노원구: '11350', 은평구: '11380', 서대문구: '11410', 마포구: '11440', 양천구: '11470',
  강서구: '11500', 구로구: '11530', 금천구: '11545', 영등포구: '11560', 동작구: '11590',
  관악구: '11620', 서초구: '11650', 강남구: '11680', 송파구: '11710', 강동구: '11740',
};

function corsHeaders(extra) {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    ...extra,
  };
}

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
    + `?serviceKey=${encodeURIComponent(env.MOLIT_API_KEY)}&LAWD_CD=${lawdCd}&DEAL_YMD=${month}&pageNo=${pageNo}&numOfRows=1000`;
  const res = await fetch(url, { cf: { cacheTtl: CACHE_TTL_SECONDS, cacheEverything: true } });
  const xml = await res.text();
  if (!res.ok) throw new Error(`MOLIT upstream HTTP ${res.status}`);
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
    items.push({ dong, amount, area, perPyeong: amount / (area / PYEONG), apt: tag(it, 'aptNm') || '' });
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

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() });
    const url = new URL(request.url);

    let body, status = 200;
    if (url.pathname === '/trade/apt') {
      const month = /^\d{6}$/.test(url.searchParams.get('month') || '') ? url.searchParams.get('month') : defaultMonth();
      const cache = caches.default;
      const cacheKey = new Request(`${url.origin}/trade/apt?month=${month}`, { method: 'GET' });
      const cached = await cache.match(cacheKey);
      if (cached) return cached;
      try {
        body = { ok: true, data: await fetchSeoulTrades(env, month) };
      } catch (e) {
        status = 502;
        body = { ok: false, error: String(e.message || e) };
      }
      const response = new Response(JSON.stringify(body), {
        status,
        headers: corsHeaders(status === 200
          ? { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${CACHE_TTL_SECONDS}` }
          : { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }),
      });
      if (status === 200) await cache.put(cacheKey, response.clone());
      return response;
    }

    body = { ok: true, service: 'realestate-trade-proxy', endpoints: ['/trade/apt?month=YYYYMM'], defaultMonth: defaultMonth(), keys: { MOLIT: !!env.MOLIT_API_KEY } };
    return new Response(JSON.stringify(body), { headers: corsHeaders({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }) });
  },
};
