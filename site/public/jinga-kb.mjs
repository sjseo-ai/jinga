// jinga-kb.mjs — KB시세 조회 · 진가 점수(BEST 5) · 엑셀 시트 구성 공용 모듈
// 웹페이지(index.html이 동적 import)와 주간 보고서(scripts/weekly-report.mjs)가 같은 규칙을 쓰도록 한 곳에 둡니다.
// KB부동산(api.kbland.kr)은 KB 웹이 내부적으로 쓰는 비공식 엔드포인트라 형식이 예고 없이 바뀔 수 있습니다.

export const KB_API = 'https://api.kbland.kr';
const PYEONG = 3.3058;
const clamp01 = v => Math.max(0, Math.min(1, v));

/** 만원 → '18억 5,667만' */
export function fmtEok(man) {
  const n = Math.round(Number(man) || 0);
  const sign = n < 0 ? '-' : '';
  const a = Math.abs(n), eok = Math.floor(a / 10000), rest = a % 10000;
  if (!eok) return sign + rest.toLocaleString('ko-KR') + '만';
  return sign + eok + '억' + (rest ? ' ' + rest.toLocaleString('ko-KR') + '만' : '');
}

// ── KB 응답 정리 ──────────────────────────────────────────────
/** mpriByType 주택형 목록 → 전용면적(㎡ 반올림)·시세가 같은 타입(A/B/C…)을 하나로 묶은 배열 */
export function compactKbTypes(rows) {
  const map = new Map();
  (rows || []).forEach(t => {
    const excl = Number(t.전용면적), price = Number(t.매매일반거래가) || 0;
    if (!excl) return;
    const key = Math.round(excl) + '|' + price;
    const g = map.get(key) || {
      excl, supPy: t.공급면적평N || '', price,
      lo: Number(t.매매하한가) || 0, hi: Number(t.매매상한가) || 0, jeonse: Number(t.전세일반거래가) || 0,
      hh: 0, provided: t.시세제공여부 === '1' && price > 0, areaId: t.면적일련번호,
    };
    g.hh += Number(t.세대수) || 0;
    map.set(key, g);
  });
  return [...map.values()];
}

/** complex/brif → 점수에 쓰는 단지 정보 */
export function compactBrief(d) {
  if (!d) return { built: null, builtYm: '', households: 0, rebuild: false, interest: 0, forSale: 0 };
  return {
    built: Number(String(d.준공년월 || '').slice(0, 4)) || null,
    builtYm: d.준공년월 || '',
    households: Number(d.총세대수) || 0,
    rebuild: d.재건축여부 === '1',
    interest: Number(d.관심등록수) || 0,
    forSale: Number(d.매매건수) || 0,
  };
}

/**
 * KB 조회 클라이언트. 브라우저는 출처 헤더가 자동으로 붙어 그대로 되고, Node는 headers에 UA·Referer를 넘깁니다.
 * cache: { get(key), set(key, value) } — 브라우저는 localStorage 어댑터를 넘김(선택)
 */
export function createKbClient({ fetchImpl = (...a) => fetch(...a), headers = {}, cache = null } = {}) {
  const get = async (path, params) => {
    const r = await fetchImpl(`${KB_API}${path}?${new URLSearchParams(params)}`, { headers });
    if (!r.ok) throw new Error(`KB http ${r.status}`);
    const body = (await r.json())?.dataBody;
    if (!body || !('data' in body)) throw new Error('KB 응답 형식이 예상과 다릅니다');
    return body.data;
  };
  const cached = async (key, fn) => {
    const hit = cache && cache.get(key);
    if (hit) return hit;
    const v = await fn();
    if (cache) cache.set(key, v);
    return v;
  };
  return {
    types: id => cached('t:' + id, async () => compactKbTypes(await get('/land-complex/complex/mpriByType', { 단지기본일련번호: id }))),
    brief: id => cached('b:' + id, async () => compactBrief(await get('/land-complex/complex/brif', { 단지기본일련번호: id }))),
    /** 주택형(면적일련번호) 상세 — KB에 올라온 매물의 매매 호가 평균·매물 수, 최근 실거래 */
    listing: (id, areaId) => cached(`l:${id}:${areaId}`, async () => {
      const d = await get('/land-price/price/BasePrcInfoNew', { 단지기본일련번호: id, 면적일련번호: areaId });
      const rt = (d && d.최근실거래가) || {};
      return {
        askAvg: Number(d && d.매물매매평균가) || 0,
        askCount: Number(d && d.매매건수) || 0,
        jeonseAskAvg: Number(d && d.매물전세평균가) || 0,
        recentDeal: rt.거래금액 ? { amount: Number(rt.거래금액), date: String(rt.계약년월일 || ''), floor: rt.거래층 || '' } : null,
      };
    }),
    /** KB시세 기준일(YYYY.MM.DD) — 주택형 하나의 상세 시세에서 읽음 */
    asOf: async (id, areaId) => {
      const d = await get('/land-price/price/BasePrcInfoNew', { 단지기본일련번호: id, 면적일련번호: areaId });
      const s = String(d?.시세?.[0]?.시세기준년월일 || '');
      return s.length === 8 ? `${s.slice(0, 4)}.${s.slice(4, 6)}.${s.slice(6, 8)}` : '';
    },
  };
}

/** 동시 n건으로 순서대로 처리 — 실패한 항목은 null */
export async function runPool(items, n, fn, onProgress = () => {}) {
  let next = 0, done = 0;
  const out = new Array(items.length);
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const k = next++;
      try { out[k] = await fn(items[k]); } catch (e) { out[k] = null; }
      onProgress(++done);
    }
  }));
  return out;
}

// ── 진가 점수 ─────────────────────────────────────────────────
// KB시세·단지 정보만으로 계산하는 참고 점수(100점). 역세권·학군·향 같은 개별 요인은 들어가지 않습니다.
export const SCORE_RULES = [
  { key: 'budget', label: '예산 활용', max: 25, desc: 'KB 일반거래가가 예산 상한의 95% 이상이면 만점, 예산 하한(하한을 정하지 않으면 상한의 70%)이면 0점. 예산 범위 안에서 위쪽일수록 입지·상품성이 좋은 경향을 반영' },
  { key: 'safety', label: '가격 안전', max: 10, desc: '호가 기준이고 매물이 있으면: 호가 평균이 예산 상한의 95% 이하면 만점, 상한에 가까울수록 감점. KB 기준(또는 매물 없음)이면: KB 상위평균가까지 예산 이내면 만점, 넘을수록 감점' },
  { key: 'scale', label: '단지 규모', max: 15, desc: '총세대수 100세대 0점 → 3,000세대 이상 만점(로그 척도). 대단지일수록 관리·환금성에 유리' },
  { key: 'newness', label: '신축도', max: 20, desc: '준공 5년 이내 만점 → 30년 이상 0점. 재건축 단지는 최소 10점, 준공연도를 모르면 8점' },
  { key: 'jeonse', label: '전세가율', max: 15, desc: 'KB 전세가 ÷ 매매가가 35%면 0점 → 65% 이상 만점. 실사용 가치 대비 가격 거품이 적을수록 가점' },
  { key: 'space', label: '공간', max: 10, desc: '전용 45㎡ 0점 → 100㎡ 이상 만점. 같은 예산이면 넓을수록 가점' },
  { key: 'pref', label: '관심도', max: 5, desc: 'KB부동산 관심단지 등록 수 0명 0점 → 500명 이상 만점(로그 척도)' },
];


// ── 검색 유형(매매 · 전세 · 재건축 · 리모델링) ─────────────────
// 유형마다 「예산으로 보는 가격」과 「점수 항목」이 다릅니다. mode 를 주지 않으면 매매(기존 동작)입니다.
//   매매   — KB 매매 일반거래가(또는 매물 호가 평균)로 판단, 기존 진가 점수 그대로
//   전세   — KB 전세 일반거래가로 판단(매물 호가는 매매 호가라 쓰지 않음), 전세가율이 낮을수록 보증금이 안전하다고 봄
//   재건축 — KB 재건축 표시 또는 준공 30년 이상 단지만. 용적률이 낮을수록·대단지일수록 사업 여력이 크다고 봄
//   리모델링 — 준공 15년 이상이면서 용적률이 높아(200% 이상) 재건축 사업성이 낮거나 아직 재건축 연한(30년)에 못 미친 단지.
//              현관 구조가 계단식이면 증축·평면 개선에 유리해 가점(KB 단지 정보의 현관구조)
export const REBUILD_MIN_AGE = 30;      // 재건축 연한
export const REMODEL_MIN_AGE = 15;      // 리모델링 가능 연한
export const REMODEL_FAR = 200;         // 이 용적률을 넘으면 재건축보다 리모델링이 현실적

const SALE_RULES = SCORE_RULES;

const JEONSE_RULES = [
  { key: 'budget', label: '예산 활용', max: 25, desc: 'KB 전세 일반거래가가 예산 상한의 95% 이상이면 만점, 예산 하한(정하지 않으면 상한의 70%)이면 0점' },
  { key: 'safety', label: '보증금 안전', max: 20, desc: '전세가율(전세÷매매)이 75%면 0점 → 55% 이하면 만점. 매매가 대비 보증금이 낮을수록 돌려받기 안전' },
  { key: 'scale', label: '단지 규모', max: 15, desc: '총세대수 100세대 0점 → 3,000세대 이상 만점(로그 척도). 대단지일수록 관리·환금성에 유리' },
  { key: 'newness', label: '신축도', max: 20, desc: '준공 5년 이내 만점 → 30년 이상 0점. 준공연도를 모르면 8점' },
  { key: 'space', label: '공간', max: 15, desc: '전용 45㎡ 0점 → 100㎡ 이상 만점. 같은 보증금이면 넓을수록 가점' },
  { key: 'pref', label: '관심도', max: 5, desc: 'KB부동산 관심단지 등록 수 0명 0점 → 500명 이상 만점(로그 척도)' },
];

const REBUILD_RULES = [
  { key: 'budget', label: '예산 활용', max: 20, desc: '판단 가격이 예산 상한의 95% 이상이면 만점, 예산 하한(정하지 않으면 상한의 70%)이면 0점' },
  { key: 'potential', label: '재건축 여력', max: 30, desc: '용적률 120% 이하면 만점 → 250% 이상 0점(용적률을 모르면 12점). KB에 재건축으로 표시된 단지는 최소 20점' },
  { key: 'age', label: '노후도', max: 15, desc: '준공 30년 이상이면 만점 → 20년 이하 0점(준공연도를 모르면 7점). 재건축 연한은 30년' },
  { key: 'scale', label: '사업 규모', max: 20, desc: '총세대수 100세대 0점 → 3,000세대 이상 만점. 대단지일수록 분담금 분산·사업성에 유리' },
  { key: 'safety', label: '가격 안전', max: 10, desc: '호가 기준이고 매물이 있으면 호가 평균이 예산 상한의 95% 이하면 만점. KB 기준이면 KB 상위평균가까지 예산 이내면 만점' },
  { key: 'pref', label: '관심도', max: 5, desc: 'KB부동산 관심단지 등록 수 0명 0점 → 500명 이상 만점(로그 척도)' },
];

const REMODEL_RULES = [
  { key: 'budget', label: '예산 활용', max: 20, desc: '판단 가격이 예산 상한의 95% 이상이면 만점, 예산 하한(정하지 않으면 상한의 70%)이면 0점' },
  { key: 'fit', label: '리모델링 적합', max: 30, desc: '준공 15년차 0점 → 25년 이상 만점. 용적률 200% 이상이면(재건축 사업성이 낮아 리모델링이 현실적) 최대 10점 가점, 용적률 150% 이하면 감점' },
  { key: 'struct', label: '구조', max: 15, desc: 'KB 단지 정보의 현관구조 — 계단식만이면 만점 · 「계단식, 복도식」처럼 섞여 있으면 절반 · 복도식만이면 0점(계단식이 수평·별동 증축과 평면 개선에 유리). 모르면 7점' },
  { key: 'scale', label: '단지 규모', max: 20, desc: '총세대수 100세대 0점 → 3,000세대 이상 만점. 동의율·분담금에 유리' },
  { key: 'jeonse', label: '전세가율', max: 10, desc: 'KB 전세가 ÷ 매매가가 35%면 0점 → 65% 이상 만점. 실사용 가치 대비 가격 거품이 적을수록 가점' },
  { key: 'pref', label: '관심도', max: 5, desc: 'KB부동산 관심단지 등록 수 0명 0점 → 500명 이상 만점(로그 척도)' },
];

export const MODES = {
  sale: { key: 'sale', label: '매매', money: '매매가', rules: SALE_RULES, useAsk: true, priceLabel: 'KB 일반거래가' },
  jeonse: { key: 'jeonse', label: '전세', money: '전세보증금', rules: JEONSE_RULES, useAsk: false, priceLabel: 'KB 전세 일반거래가' },
  rebuild: { key: 'rebuild', label: '재건축', money: '매매가', rules: REBUILD_RULES, useAsk: true, priceLabel: 'KB 일반거래가' },
  remodel: { key: 'remodel', label: '리모델링', money: '매매가', rules: REMODEL_RULES, useAsk: true, priceLabel: 'KB 일반거래가' },
};
export const modeOf = k => MODES[k] || MODES.sale;
export const rulesOf = crit => modeOf(crit && crit.mode).rules;

/**
 * 단지가 그 유형의 대상인지
 *  unionOnly 를 켜면 「조합이 설립된 단지」만 — c.union(서울시 정비사업 정보몽땅, scripts/build-union.mjs)이 붙어 있고
 *  그 사업 종류가 이 유형과 같아야 합니다(재건축·소규모재건축 → 재건축 / 리모델링주택조합 → 리모델링).
 *  끄면 예전처럼 준공연도·용적률·KB 재건축 표시로만 가립니다.
 */
export function modeEligible(c, brief, thisYear = new Date().getFullYear(), mode = 'sale', unionOnly = false) {
  if (mode !== 'rebuild' && mode !== 'remodel') return true;
  if (unionOnly) return !!(c && c.union && c.union.mode === mode);
  const built = brief && brief.built;
  const age = built ? thisYear - built : null;
  const far = Number(c && c.far) || 0;
  if (mode === 'rebuild') return !!(brief && brief.rebuild) || (age != null && age >= REBUILD_MIN_AGE);
  if (brief && brief.rebuild) return false;                    // 이미 재건축으로 가는 단지는 리모델링 후보에서 제외
  if (age == null || age < REMODEL_MIN_AGE) return false;
  return far === 0 ? age < REBUILD_MIN_AGE : far >= REMODEL_FAR || age < REBUILD_MIN_AGE;
}

/** 사용승인일 'YYYYMMDD' → '1979.08.30'(건축물대장의 사용승인일 = KB 준공년월일) */
export function approvedText(v) {
  const t = String(v || '');
  return /^\d{8}$/.test(t) ? `${t.slice(0, 4)}.${t.slice(4, 6)}.${t.slice(6)}` : '';
}
/** 카드 한 줄에 쓰는 준공 표기 — 사용승인일이 있으면 날짜까지, 없으면 KB 준공연도 */
export function builtText(complex, brief) {
  const a = approvedText(complex && complex.approved);
  const year = brief && brief.built;
  if (a) return `사용승인 ${a}`;
  if (brief && brief.builtYm && /^\d{6}$/.test(String(brief.builtYm))) return `${String(brief.builtYm).slice(0, 4)}.${String(brief.builtYm).slice(4)} 준공`;
  return year ? `${year}년 준공` : '';
}

/** 조합 표시 문구 — 「재건축 조합설립인가」처럼 종류와 진행 단계를 함께 */
export const unionText = u => (!u ? '' : `${u.kind}${u.step ? ' ' + u.step : ' 조합 설립'}`);

const budgetPart = (judge, { budget, budgetMin = 0 }, max) => {
  const lo = budgetMin > 0 ? budgetMin : budget * 0.70, top = budget * 0.95;
  return top > lo ? max * clamp01((judge - lo) / (top - lo)) : max;
};
const scalePart = (hh, max) => max * clamp01(Math.log(Math.max(hh, 1) / 100) / Math.log(30));
const prefPart = (brief, max) => max * clamp01(Math.log10(1 + ((brief && brief.interest) || 0)) / Math.log10(501));
const safetyPart = (t, judge, useAsk, useEst, budget, max) => (useAsk || useEst
  ? max * clamp01((budget - judge) / (budget * 0.05))
  : t.hi > budget ? max * clamp01((budget - t.price) / Math.max(1, t.hi - t.price)) : max);
const round1 = p => { Object.keys(p).forEach(k => { p[k] = Math.round(p[k] * 10) / 10; }); return p; };
const sumParts = p => Math.round(Object.values(p).reduce((a, b) => a + b, 0) * 10) / 10;

/** 전세 — KB 전세 일반거래가로 판단(매물 호가는 매매 호가라 쓰지 않음) */
function scoreJeonse(t, brief, hh, crit, thisYear) {
  const judge = t.jeonse;
  const jr = t.price > 0 && t.jeonse > 0 ? t.jeonse / t.price : 0;
  const p = {
    budget: budgetPart(judge, crit, 25),
    safety: 20 * clamp01((0.75 - jr) / 0.20),
    scale: scalePart(hh, 15),
    newness: 0,
    space: 15 * clamp01((t.excl - 45) / 55),
    pref: prefPart(brief, 5),
  };
  const built = brief && brief.built;
  const age = built ? thisYear - built : null;
  p.newness = age == null ? 8 : 20 * clamp01((30 - age) / 25);
  round1(p);
  const reasons = [];
  if (built) reasons.push(`${built}년 준공(${age}년차)`);
  if (hh) reasons.push(`${hh.toLocaleString('ko-KR')}세대`);
  if (jr) reasons.push(`전세가율 ${Math.round(jr * 100)}%${jr <= 0.55 ? ' · 보증금 안전' : jr >= 0.75 ? ' · 보증금 부담' : ''}`);
  reasons.push(`예산의 ${Math.round((judge / crit.budget) * 100)}%`);
  return {
    total: sumParts(p), parts: p, reasons, jeonseRatio: jr, age, judge,
    useAsk: false, useEst: false, askGap: null, askAvg: null, askCount: 0,
    basisLabel: 'KB 전세 일반거래가', altLabel: 'KB 매매 일반거래가', altValue: fmtEok(t.price),
  };
}

/** 재건축 — 용적률·노후도·단지 규모로 사업 여력을 봄 */
function scoreRebuild(t, brief, hh, crit, thisYear) {
  const ask = hasAsk(t) ? t.listing : null;
  const useAsk = crit.basis === 'ask' && !!ask;
  const useEst = crit.basis === 'ask' && !ask && t.askEst > 0;
  const judge = useAsk ? ask.askAvg : useEst ? t.askEst : t.price;
  const far = Number(crit.far) || 0;                      // scoreEntry 가 단지 용적률을 넣어 줌
  const built = brief && brief.built;
  const age = built ? thisYear - built : null;
  let potential = far > 0 ? 30 * clamp01((250 - far) / 130) : 12;
  if (brief && brief.rebuild) potential = Math.max(potential, 20);
  const p = {
    budget: budgetPart(judge, crit, 20),
    potential,
    age: age == null ? 7 : 15 * clamp01((age - 20) / 10),
    scale: scalePart(hh, 20),
    safety: safetyPart(t, judge, useAsk, useEst, crit.budget, 10),
    pref: prefPart(brief, 5),
  };
  round1(p);
  const reasons = [];
  if (crit.union) reasons.push(unionText(crit.union));
  if (built) reasons.push(`${built}년 준공(${age}년차)${brief.rebuild ? ' · KB 재건축 표시' : ''}`);
  else if (brief && brief.rebuild) reasons.push('KB 재건축 표시');
  if (far > 0) reasons.push(`용적률 ${Math.round(far)}%${far <= 180 ? ' · 사업 여력 큼' : far >= 250 ? ' · 여력 작음' : ''}`);
  if (hh) reasons.push(`${hh.toLocaleString('ko-KR')}세대`);
  reasons.push(`예산의 ${Math.round((judge / crit.budget) * 100)}%`);
  return { ...askFields(t, ask, useAsk, useEst), total: sumParts(p), parts: p, reasons, age, judge, useAsk, useEst,
    jeonseRatio: t.price > 0 && t.jeonse > 0 ? t.jeonse / t.price : 0 };
}

/** 리모델링 — 연한·용적률·현관구조(계단식)로 적합도를 봄 */
function scoreRemodel(t, brief, hh, crit, thisYear) {
  const ask = hasAsk(t) ? t.listing : null;
  const useAsk = crit.basis === 'ask' && !!ask;
  const useEst = crit.basis === 'ask' && !ask && t.askEst > 0;
  const judge = useAsk ? ask.askAvg : useEst ? t.askEst : t.price;
  const far = Number(crit.far) || 0;
  const hall = String(crit.hall || '');
  const built = brief && brief.built;
  const age = built ? thisYear - built : null;
  let fit = age == null ? 10 : 20 * clamp01((age - REMODEL_MIN_AGE) / 10);
  if (far >= REMODEL_FAR) fit += 10 * clamp01((far - REMODEL_FAR) / 100 + 0.5);
  else if (far > 0 && far <= 150) fit -= 5;
  const jr = t.price > 0 && t.jeonse > 0 ? t.jeonse / t.price : 0;
  const p = {
    budget: budgetPart(judge, crit, 20),
    fit: Math.max(0, Math.min(30, fit)),
    struct: structPart(hall),
    scale: scalePart(hh, 20),
    jeonse: 10 * clamp01((jr - 0.35) / 0.30),
    pref: prefPart(brief, 5),
  };
  round1(p);
  const reasons = [];
  if (crit.union) reasons.push(unionText(crit.union));
  if (built) reasons.push(`${built}년 준공(${age}년차)`);
  if (far > 0) reasons.push(`용적률 ${Math.round(far)}%${far >= REMODEL_FAR ? ' · 재건축보다 리모델링이 현실적' : ''}`);
  if (hall) reasons.push(`${hall}`);
  if (hh) reasons.push(`${hh.toLocaleString('ko-KR')}세대`);
  reasons.push(`예산의 ${Math.round((judge / crit.budget) * 100)}%`);
  return { ...askFields(t, ask, useAsk, useEst), total: sumParts(p), parts: p, reasons, age, judge, useAsk, useEst, jeonseRatio: jr };
}

/** 호가 관련 표시용 값(재건축·리모델링이 매매와 같은 방식으로 판단 가격을 보여 주도록) */
function askFields(t, ask, useAsk, useEst) {
  const gap = ask ? Math.round((ask.askAvg / t.price - 1) * 1000) / 10 : null;
  const sg = v => `${v >= 0 ? '+' : ''}${v}%`;
  const estPct = useEst ? Math.round((t.askEst / t.price - 1) * 1000) / 10 : null;
  let altLabel, altValue;
  if (useAsk) { altLabel = 'KB 일반거래가'; altValue = `${fmtEok(t.price)} (호가 ${sg(gap)})`; }
  else if (useEst) { altLabel = 'KB 일반거래가'; altValue = `${fmtEok(t.price)} (KB 매물 ${t.listing ? t.listing.askCount : 0}건)`; }
  else if (ask) { altLabel = `호가 평균 (매물 ${ask.askCount}건)`; altValue = `${fmtEok(ask.askAvg)} (${sg(gap)})`; }
  else { altLabel = 'KB 하위 ~ 상위'; altValue = `${fmtEok(t.lo)} ~ ${fmtEok(t.hi)}`; }
  return {
    askGap: gap, askAvg: ask ? ask.askAvg : null, askCount: ask ? ask.askCount : 0,
    basisLabel: useAsk ? `호가 평균 (매물 ${ask.askCount}건)` : useEst ? `추정 호가 (KB ${sg(estPct)})` : 'KB 일반거래가',
    altLabel, altValue,
  };
}

/** 현관구조 점수 — 계단식만 만점, 「계단식, 복도식」처럼 섞여 있으면 절반, 복도식만이면 0점, 모르면 중간 */
export function structPart(hall, max = 15) {
  const h = String(hall || '');
  const stair = /계단/.test(h), corridor = /복도/.test(h), mixed = /혼합/.test(h);
  if (mixed || (stair && corridor)) return max / 2;
  if (stair) return max;
  if (corridor) return 0;
  return max * 0.47;
}

const MODE_SCORERS = { jeonse: scoreJeonse, rebuild: scoreRebuild, remodel: scoreRemodel };

/**
 * 조건 판정 — 예산·전용면적 상하한. 면적은 ㎡ 정수부 기준(상한 84면 84.97㎡도 84㎡형으로 포함).
 * crit: { budget(상한, 만원), budgetMin(하한, 0=없음), minArea, maxArea(0=없음) }
 */
const areaOk = (t, minArea, maxArea) => { const a = Math.floor(t.excl); return a >= minArea && (!maxArea || a <= maxArea); };
// 믿을 수 있는 호가 평균의 조건 — 매물 1건짜리나 KB보다 50% 넘게 높은 값은 다른 평형 매물이 섞였거나 이상치일 가능성이 큼
// (2026-09-11 실측: 매물 1건에 KB 대비 +89% 같은 값이 섞여 평균 괴리를 부풀림)
export const ASK_MIN_COUNT = 2, ASK_MAX_GAP = 50;
const hasAsk = t => !!(t.listing && t.listing.askCount >= ASK_MIN_COUNT && t.listing.askAvg > 0 && t.price > 0
  && (t.listing.askAvg / t.price - 1) * 100 <= ASK_MAX_GAP);
export const isReliableAsk = hasAsk;

/**
 * 매물 호가를 믿을 수 없는 면적(매물 없음·표본 부족·이상치)의 "추정 호가"를 채움.
 * 같은 구에 믿을 수 있는 호가 표본이 5개 이상이면 그 구의, 아니면 조회 지역 전체의 호가 괴리(호가÷KB−1) 중앙값을 KB 일반가에 적용.
 * 매물 없는 곳을 KB시세로 판단하면 호가가 붙은 곳보다 10~20% 싸게 계산돼 순위가 왜곡되기 때문.
 */
export function prepareAsk(complexes) {
  const byGu = {}, all = [];
  for (const c of complexes) {
    for (const t of c.types) {
      if (!hasAsk(t)) continue;
      const g = t.listing.askAvg / t.price - 1;
      (byGu[c.gu] = byGu[c.gu] || []).push(g);
      all.push(g);
    }
  }
  const med = a => { const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const allMed = all.length ? med(all) : 0;
  for (const c of complexes) {
    const own = byGu[c.gu] && byGu[c.gu].length >= 5;
    const g = Math.max(0, own ? med(byGu[c.gu]) : allMed);
    const note = own ? `${c.gu} 호가 괴리 중앙값` : '조회 지역 호가 괴리 중앙값';
    for (const t of c.types) {
      if (!t.provided || hasAsk(t)) { t.askEst = null; continue; }
      t.askEst = Math.round(t.price * (1 + g));
      t.askEstNote = note;
    }
  }
  return { allMedPct: Math.round(allMed * 1000) / 10, samples: all.length };
}

/** 예산 판단 가격 — 전세 유형은 KB 전세 일반거래가, 그 밖에는 basis 'ask'면 믿을 수 있는 호가 평균 → 추정 호가 → KB 일반가 */
export function judgePrice(t, basis, mode = 'sale') {
  if (mode === 'jeonse') return t.jeonse;
  if (basis !== 'ask') return t.price;
  if (hasAsk(t)) return t.listing.askAvg;
  return t.askEst > 0 ? t.askEst : t.price;
}

export function typeMatches(t, { budget, budgetMin = 0, minArea = 0, maxArea = 0, basis = 'kb', mode = 'sale' }) {
  if (!t.provided) return false;
  const p = judgePrice(t, basis, mode);
  if (!(p > 0)) return false;                       // 전세 시세가 없는 주택형은 전세 검색에서 빠짐
  return p <= budget && p >= budgetMin && areaOk(t, minArea, maxArea);
}

/** 단지 조건 — 용적률(%) 하한~상한. 조건을 줬는데 용적률을 모르는 단지는 제외, 조건이 없으면 모두 통과 */
// 임대세대 비율은 매물 추천(jinga-reco.mjs)과 **같은 값을 써야 해서** 따로 뺀 모듈에 있습니다.
// 두 곳에 복사해 두면 한쪽만 고쳐져 같은 단지가 검색에서는 빠지고 추천에는 남습니다.
// export ... from 은 지역 이름을 만들지 않습니다 — 이 파일 안에서도 쓰므로 import 하고 다시 내보냅니다.
import { rentPct, rentText, rentOk } from './jinga-rent.mjs';
export { rentPct, rentText, rentOk };

export function complexOk(c, { farMin = 0, farMax = 0 } = {}) {
  if (!farMin && !farMax) return true;
  const far = Number(c && c.far);
  if (!(far > 0)) return false;
  return far >= farMin && (!farMax || far <= farMax);
}

/** 매물 호가(주택형 상세)를 조회할 후보 — 면적 조건에 맞고 KB 일반가가 예산 근처(하한 80% ~ 상한 110%)인 아직 안 받은 면적 */
export function listingCandidates(complexes, criteria) {
  const { budget, budgetMin = 0, minArea = 0, maxArea = 0, mode = 'sale' } = criteria;
  const out = [];
  if (!modeOf(mode).useAsk) return out;              // 전세는 매매 호가를 쓰지 않으므로 조회하지 않음
  for (const c of complexes) {
    if (!complexOk(c, criteria)) continue;
    for (const t of c.types) {
      if (!t.provided || t.listing !== undefined || !areaOk(t, minArea, maxArea)) continue;
      if (t.price <= budget * 1.10 && t.price >= budgetMin * 0.80) out.push({ c, t });
    }
  }
  return out;
}

/** 유형별 점수 — 기본은 매매(기존 산식 그대로) */
export function scoreEntry(t, brief, hh, crit, thisYear = new Date().getFullYear()) {
  const fn = MODE_SCORERS[(crit && crit.mode) || 'sale'];
  return fn ? fn(t, brief, hh, crit, thisYear) : scoreSale(t, brief, hh, crit, thisYear);
}

function scoreSale(t, brief, hh, { budget, budgetMin = 0, basis = 'kb' }, thisYear) {
  const p = {};
  const ask = hasAsk(t) ? t.listing : null;
  const useAsk = basis === 'ask' && !!ask;
  const useEst = basis === 'ask' && !ask && t.askEst > 0;
  const judge = useAsk ? ask.askAvg : useEst ? t.askEst : t.price;
  const ratio = judge / budget;
  const lo = budgetMin > 0 ? budgetMin : budget * 0.70, top = budget * 0.95;
  p.budget = top > lo ? 25 * clamp01((judge - lo) / (top - lo)) : 25;   // 범위가 아주 좁으면(하한 ≥ 상한의 95%) 모두 만점
  p.safety = useAsk || useEst
    ? 10 * clamp01((budget - judge) / (budget * 0.05))
    : t.hi > budget ? 10 * clamp01((budget - t.price) / Math.max(1, t.hi - t.price)) : 10;
  p.scale = 15 * clamp01(Math.log(Math.max(hh, 1) / 100) / Math.log(30));
  const built = brief && brief.built;
  const age = built ? thisYear - built : null;
  let newness = age == null ? 8 : 20 * clamp01((30 - age) / 25);
  if (brief && brief.rebuild) newness = Math.max(newness, 10);
  p.newness = newness;
  const jr = t.jeonse > 0 ? t.jeonse / t.price : 0;
  p.jeonse = 15 * clamp01((jr - 0.35) / 0.30);
  p.space = 10 * clamp01((t.excl - 45) / 55);
  p.pref = 5 * clamp01(Math.log10(1 + ((brief && brief.interest) || 0)) / Math.log10(501));
  Object.keys(p).forEach(k => { p[k] = Math.round(p[k] * 10) / 10; });
  const total = Math.round(Object.values(p).reduce((a, b) => a + b, 0) * 10) / 10;

  const gap = ask ? Math.round((ask.askAvg / t.price - 1) * 1000) / 10 : null;   // KB 대비 호가 괴리(%)
  const sg = v => `${v >= 0 ? '+' : ''}${v}%`;
  const reasons = [];
  if (built) reasons.push(`${built}년 준공(${age}년차)${brief.rebuild ? ' · 재건축' : ''}`);
  else if (brief && brief.rebuild) reasons.push('재건축 단지');
  if (hh) reasons.push(`${hh.toLocaleString('ko-KR')}세대`);
  if (jr) reasons.push(`전세가율 ${Math.round(jr * 100)}%`);
  const rawCount = t.listing ? t.listing.askCount : 0;
  const estPct = useEst ? Math.round((t.askEst / t.price - 1) * 1000) / 10 : null;
  reasons.push(`예산의 ${Math.round(ratio * 100)}%${!useAsk && !useEst && p.safety >= 10 ? ' · KB 상위가도 예산 이내' : ''}`);
  if (useEst) reasons.push(`KB 매물 ${rawCount ? rawCount + '건(표본 부족·이상치)' : '없음'} → ${t.askEstNote} ${sg(estPct)} 적용 추정`);
  else if (basis === 'ask' && !ask) reasons.push('KB 매물 없음 → KB시세로 판단');

  // 카드·보고서 표시용
  let altLabel, altValue;
  if (useAsk) { altLabel = 'KB 일반거래가'; altValue = `${fmtEok(t.price)} (호가 ${sg(gap)})`; }
  else if (useEst) { altLabel = 'KB 일반거래가'; altValue = `${fmtEok(t.price)} (KB 매물 ${rawCount}건)`; }
  else if (ask) { altLabel = `호가 평균 (매물 ${ask.askCount}건)`; altValue = `${fmtEok(ask.askAvg)} (${sg(gap)})`; }
  else { altLabel = 'KB 하위 ~ 상위'; altValue = `${fmtEok(t.lo)} ~ ${fmtEok(t.hi)}`; }
  return {
    total, parts: p, reasons, jeonseRatio: jr, age,
    judge, useAsk, useEst, askGap: gap, askAvg: ask ? ask.askAvg : null, askCount: ask ? ask.askCount : 0,
    basisLabel: useAsk ? `호가 평균 (매물 ${ask.askCount}건)` : useEst ? `추정 호가 (KB ${sg(estPct)})` : 'KB 일반거래가', altLabel, altValue,
  };
}

/**
 * complexes: [{ id, name, gu, dong, types:[compactKbTypes], brief: compactBrief | null | false }]
 * criteria:  { budget(상한, 만원), budgetMin(하한, 0=없음), minArea, maxArea(㎡, 0=없음), minHh(세대), farMin·farMax(용적률 %, 0=없음) }
 * → { qualifying: 조건 충족 단지×면적(점수 내림차순), best5: 단지별 최고점 면적 상위 5, complexCount }
 */
export function evaluate(complexes, criteria, thisYear = new Date().getFullYear()) {
  const mode = (criteria && criteria.mode) || 'sale';
  if (criteria.basis === 'ask' && modeOf(mode).useAsk) prepareAsk(complexes);
  const minHh = criteria.minHh || 0;
  const maxRentPct = criteria.maxRentPct || 0;
  const qualifying = [];
  const rentExcluded = [];          // 임대 비율 때문에 뺀 단지 — 화면에 몇 곳인지 알려 주려고 모읍니다
  for (const c of complexes) {
    if (!complexOk(c, criteria)) continue;
    if (!modeEligible(c, c.brief || null, thisYear, mode, !!criteria.unionOnly)) continue;
    if (!rentOk(c, maxRentPct, !!criteria.rentKnownOnly)) { rentExcluded.push({ id: c.id, name: c.name, pct: rentPct(c) }); continue; }
    const hh = (c.brief && c.brief.households) || c.types.reduce((s, t) => s + (t.hh || 0), 0);
    if (hh < minHh) continue;
    // 재건축·리모델링 점수는 단지의 용적률·현관구조를 함께 봄
    const crit = mode === 'rebuild' || mode === 'remodel' ? { ...criteria, far: c.far, hall: c.hall, union: c.union || null } : criteria;
    for (const t of c.types) {
      if (!typeMatches(t, criteria)) continue;
      qualifying.push({ c, t, hh, score: scoreEntry(t, c.brief || null, hh, crit, thisYear) });
    }
  }
  qualifying.sort((a, b) => b.score.total - a.score.total || b.score.judge - a.score.judge);
  const seen = new Set(), best5 = [];
  for (const e of qualifying) {
    if (seen.has(e.c.id)) continue;
    seen.add(e.c.id);
    best5.push(e);
    if (best5.length === 5) break;
  }
  rentExcluded.sort((a, b) => (b.pct || 0) - (a.pct || 0));
  return { qualifying, best5, complexCount: new Set(qualifying.map(e => e.c.id)).size, rentExcluded };
}

// ── 엑셀 시트(xlsx-lite.mjs buildXlsx 입력) ───────────────────
const eokCell = man => ({ v: man ? Math.round(man) / 10000 : null, s: 'NUM2' });
const pad2 = n => String(n).padStart(2, '0');
export const fmtDateTime = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

export function criteriaText({ budget, budgetMin = 0, minArea = 0, maxArea = 0, minHh = 0, basis = 'kb', farMin = 0, farMax = 0, mode = 'sale', unionOnly = false, maxRentPct = 0, rentKnownOnly = false }, gus) {
  const m = modeOf(mode);
  const far = farMin || farMax ? ` · 용적률 ${farMin && farMax ? `${farMin}~${farMax}%` : farMax ? `${farMax}% 이하` : `${farMin}% 이상`}` : '';
  const money = budgetMin ? `${fmtEok(budgetMin)} ~ ${fmtEok(budget)}` : `${fmtEok(budget)} 이하`;
  const area = maxArea ? (minArea ? `${minArea}~${maxArea}㎡` : `${maxArea}㎡ 이하`) : `${minArea}㎡ 이상`;
  const union = unionOnly && (mode === 'rebuild' || mode === 'remodel') ? ' · 조합 설립 단지만' : '';
  const rent = maxRentPct > 0
    ? ` · 임대세대 ${maxRentPct}% 이하${rentKnownOnly ? '(비율 모르는 단지도 제외)' : ''}`
    : '';
  return `${m.money} ${money}(${m.useAsk && basis === 'ask' ? '매물 호가 평균 기준' : 'KB시세 기준'}) · 전용 ${area} · ${minHh ? minHh.toLocaleString('ko-KR') + '세대 이상' : '규모 무관'}${far}${rent}${union} · 아파트만 · ${gus.join('·')}`;
}

const SCORE_BASE = ['순위', '단지명', '지역', '법정동', '준공', '사용승인일', '총세대', '임대세대', '임대비율', '용적률(%)', '건폐율(%)', '전용(㎡)', '공급평형', '판단 가격(억)', 'KB 일반가(억)', '호가 평균(억)', '매물 수', '호가 괴리', 'KB 하위(억)', 'KB 상위(억)', 'KB 전세(억)', '전세가율', '진가 점수'];
const scoreHead = rules => [...SCORE_BASE, ...rules.map(r => `${r.label}(${r.max})`)];
const scoreWidths = rules => [6, 22, 9, 10, 7, 12, 8, 9, 9, 9, 9, 9, 9, 11, 11, 11, 7, 9, 10, 10, 10, 9, 9, ...rules.map(() => 9)];

function scoreRow(e, rank, rules = SCORE_RULES) {
  const { c, t, hh, score } = e;
  const b = c.brief || {};
  return [
    { v: rank, s: 'CENTER' }, { v: c.name, s: 'TEXT' }, { v: c.gu, s: 'TEXT' }, { v: c.dong, s: 'TEXT' },
    { v: b.built || null, s: 'YEAR_V' }, { v: approvedText(c.approved), s: 'CENTER' }, { v: hh, s: 'INT' },
    { v: Number(c.households) > 0 ? Number(c.rentUnits) || 0 : null, s: 'INT' },
    { v: rentPct(c) == null ? null : rentPct(c) / 100, s: 'PCT' },
    { v: c.far || null, s: 'INT' }, { v: c.bcr || null, s: 'INT' }, { v: t.excl, s: 'NUM2' }, { v: t.supPy ? `${t.supPy}평형` : '', s: 'TEXT' },
    eokCell(score.judge), eokCell(t.price), eokCell(score.askAvg), { v: score.askCount || null, s: 'INT' },
    { v: score.askGap == null ? null : score.askGap / 100, s: 'PCT' },
    eokCell(t.lo), eokCell(t.hi), eokCell(t.jeonse), { v: score.jeonseRatio || null, s: 'PCT' },
    { v: score.total, s: 'NUM1' }, ...rules.map(r => ({ v: score.parts[r.key] ?? null, s: 'NUM1' })),
  ];
}

export function buildSearchSheets({ criteria, gus, asOf, complexes, result, generatedAt = new Date(), title = '진가 단지 검색' }) {
  const mode = modeOf(criteria && criteria.mode);
  const rules = mode.rules;
  const HEAD = scoreHead(rules), WIDTHS = scoreWidths(rules);
  const sub = `KB시세 ${asOf || '(기준일 미확인)'} 기준 · ${mode.label} · ${criteriaText(criteria, gus)} · 생성 ${fmtDateTime(generatedAt)}`;
  const head = cols => cols.map(v => ({ v, s: 'HEADER' }));

  const best = {
    name: '진가 BEST 5', colWidths: WIDTHS, freeze: { row: 3 }, tabColor: 'FF1E5FCC',
    rows: [
      [{ v: `${title} — ${mode.label} 진가 BEST 5`, s: 'TITLE' }], [{ v: sub, s: 'SUBTITLE' }], head(HEAD),
      ...result.best5.map((e, i) => scoreRow(e, i + 1, rules)),
      [], [{ v: '· 단지마다 점수가 가장 높은 면적 하나만 올립니다. 점수 산식은 「점수 산식·출처」 시트 참고.', s: 'NOTE' }],
    ],
  };
  const all = {
    name: '조건 충족 전체', colWidths: WIDTHS, freeze: { row: 3, col: 2 },
    rows: [
      [{ v: `${title} — ${mode.label} 조건 충족 전체(단지×면적, 진가 점수순)`, s: 'TITLE' }], [{ v: sub, s: 'SUBTITLE' }],
      head(['점수순', ...HEAD.slice(1)]),
      ...result.qualifying.map((e, i) => scoreRow(e, i + 1, rules)),
    ],
  };

  const qual = new Set(result.qualifying.map(e => e.t));
  const rawRows = [];
  for (const c of complexes) {
    const b = c.brief || {};
    const hhAll = b.households || c.types.reduce((s, t) => s + (t.hh || 0), 0);
    for (const t of c.types) {
      rawRows.push([
        { v: c.id, s: 'YEAR_V' }, { v: c.name, s: 'TEXT' }, { v: c.gu, s: 'TEXT' }, { v: c.dong, s: 'TEXT' },
        { v: t.excl, s: 'NUM2' }, { v: t.supPy ? `${t.supPy}평형` : '', s: 'TEXT' }, { v: t.hh || null, s: 'INT' },
        eokCell(t.price), eokCell(t.lo), eokCell(t.hi), eokCell(t.jeonse),
        { v: t.price > 0 && t.jeonse > 0 ? t.jeonse / t.price : null, s: 'PCT' },
        eokCell(t.listing && t.listing.askAvg), { v: t.listing ? t.listing.askCount : null, s: 'INT' },
        { v: t.provided ? 'Y' : 'N', s: 'CENTER' }, { v: qual.has(t) ? 'Y' : '', s: 'CENTER' },
        { v: b.built || null, s: 'YEAR_V' }, { v: approvedText(c.approved), s: 'CENTER' }, { v: hhAll || null, s: 'INT' }, { v: c.far || null, s: 'INT' }, { v: c.bcr || null, s: 'INT' },
      ]);
    }
  }
  const raw = {
    name: '조회 전수(KB)', colWidths: [12, 22, 9, 10, 9, 9, 9, 11, 10, 10, 10, 9, 11, 7, 8, 8, 7, 12, 8, 9, 9], freeze: { row: 3, col: 2 },
    rows: [
      [{ v: `${title} — 조회한 전체 단지·주택형 KB시세`, s: 'TITLE' }],
      [{ v: sub + ' · 준공·총세대는 조건 충족 후보 단지만, 호가 평균은 예산 근처 면적만 조회(나머지는 빈칸)', s: 'SUBTITLE' }],
      head(['단지기본일련번호', '단지명', '지역', '법정동', '전용(㎡)', '공급평형', '이 면적 세대', 'KB 일반가(억)', 'KB 하위(억)', 'KB 상위(억)', 'KB 전세(억)', '전세가율', '호가 평균(억)', '매물 수', '시세 제공', '조건 충족', '준공', '사용승인일', '총세대', '용적률(%)', '건폐율(%)']),
      ...rawRows,
    ],
  };

  const method = {
    name: '점수 산식·출처', colWidths: [14, 8, 100],
    rows: [
      [{ v: '진가 점수 산식과 데이터 출처', s: 'TITLE' }], [{ v: sub, s: 'SUBTITLE' }],
      head(['항목', '배점', '기준']),
      ...rules.map(r => [{ v: r.label, s: 'LABEL_B' }, { v: r.max, s: 'INT' }, { v: r.desc, s: 'TEXT' }]),
      [{ v: '합계', s: 'TOTAL_LABEL' }, { v: rules.reduce((s, r) => s + r.max, 0), s: 'TOTAL_INT' }, { v: '동점이면 KB 일반거래가가 높은 곳이 앞섭니다.', s: 'TEXT' }],
      [],
      [{ v: '· KB시세·단지 정보: KB부동산(kbland.kr) 웹이 내부적으로 쓰는 비공식 엔드포인트(mpriByType·brif·BasePrcInfoNew). 공식 API가 아니며 예고 없이 바뀔 수 있습니다.', s: 'NOTE' }],
      [{ v: '· 대상: KB 매물종별 아파트만(오피스텔·주상복합 제외). 용적률·건폐율은 KB 단지 상세(complex/main) 기준이며, 용적률 조건을 주면 용적률 정보가 없는 단지는 빠집니다.', s: 'NOTE' }],
      [{ v: '· KB 일반거래가·상위·하위평균가는 KB 조사 시세이며 실제 거래가·호가와 다를 수 있습니다. 역세권·학군·향·층 같은 개별 요인은 점수에 들어가지 않습니다.', s: 'NOTE' }],
      [{ v: '· 투자 판단의 근거가 아닌 참고 자료입니다.', s: 'NOTE' }],
    ],
  };
  return [best, all, raw, method];
}
