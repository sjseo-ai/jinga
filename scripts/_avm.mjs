// J-AVM v1 — 국토교통부 실거래로 **단지·면적대별 추정 시세**를 내는 계산부(T012). 순수 함수만.
//
// ── 지키는 것 (로드맵 hard_rules) ────────────────────────────────────────────
//  · 실거래가와 추정가를 **같은 숫자처럼 쓰지 않습니다.** 추정은 늘 범위·표본수·기준일과 함께 나갑니다.
//  · 표본이 적으면 **값을 내놓지 않습니다.** 범위만 주거나 아예 보류합니다. 억지로 한 점을 찍지 않습니다.
//  · 같은 입력이면 같은 값이 나옵니다(난수·현재시각 의존 없음).
//
// ── v1 이 하는 일 ───────────────────────────────────────────────────────────
//  1) 같은 단지(aptSeq)의 **비슷한 면적**(기본 ±10%) 거래를 최근 N개월에서 고릅니다.
//  2) 각 거래를 **그 자치구의 월별 지수**로 기준월까지 끌어옵니다(시점 보정).
//  3) 보정된 평당가의 **중앙값**을 추정치로, 사분위 범위를 불확실성으로 냅니다.
//
// ── v1 이 하지 않는 일 (알면서 비워 둔 것) ────────────────────────────────────
//  · 층 보정 — 1층·탑층 할인은 자료로 확인한 뒤에 넣습니다. 지금은 **보정하지 않고 범위에 녹여 둡니다.**
//  · 향·조망·수리 상태 — 실거래 자료에 없습니다.
//  · 같은 단지 거래가 없을 때 옆 단지로 넓히기 — 「남의 단지 가격」이 되기 쉬워 v1 에서는 하지 않습니다.
//  평균이 아니라 중앙값을 쓰는 이유: 한 건의 특이 거래(직거래·증여성)에 끌려가지 않기 위해서입니다.

export const PYEONG = 3.3058;

const median = xs => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};
const quantile = (xs, q) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * q)));
  return s[i];
};

/** 'YYYY-MM-DD' → 'YYYYMM' */
export const ymOf = date => String(date || '').slice(0, 7).replace('-', '');
/** 'YYYYMM' 두 개 사이 개월 수 */
export const monthsBetween = (a, b) => {
  const p = s => ({ y: Number(String(s).slice(0, 4)), m: Number(String(s).slice(4, 6)) });
  const x = p(a), y = p(b);
  return (y.y - x.y) * 12 + (y.m - x.m);
};

/**
 * 자치구 월별 지수 — 그 구에서 그달에 거래된 전부의 중앙 평당가.
 * 한 단지의 거래만으로 시점을 보정하면 표본이 너무 적어 흔들립니다. 그래서 구 전체의 흐름을 씁니다.
 * 거래가 적은 달(기본 10건 미만)은 **지수를 만들지 않습니다** — 몇 건으로 만든 지수는 시세가 아니라 잡음입니다.
 */
export function buildIndex(trades, { minTrades = 10 } = {}) {
  const bucket = new Map();
  for (const t of trades) {
    if (!(t.perPyeong > 0) || !t.gu) continue;
    const k = `${t.gu}|${ymOf(t.date)}`;
    if (!bucket.has(k)) bucket.set(k, []);
    bucket.get(k).push(t.perPyeong);
  }
  const index = new Map();
  for (const [k, xs] of bucket) if (xs.length >= minTrades) index.set(k, { med: median(xs), n: xs.length });
  return index;
}

/**
 * 시점 보정 계수 — 거래월(from)의 값을 기준월(to)로 끌어오는 배수.
 * 둘 중 한 달이라도 지수가 없으면 **1(보정 없음)**을 돌려주고 보정하지 않았다고 알립니다.
 * 모르는 것을 0 이나 추정으로 메우지 않습니다.
 */
export function timeFactor(index, gu, fromYM, toYM) {
  if (fromYM === toYM) return { f: 1, adjusted: true };
  const a = index.get(`${gu}|${fromYM}`), b = index.get(`${gu}|${toYM}`);
  if (!a || !b || !(a.med > 0) || !(b.med > 0)) return { f: 1, adjusted: false };
  const f = b.med / a.med;
  // 두 달 사이 30% 넘게 벌어지면 지수가 아니라 표본이 바뀐 것으로 봅니다(단지 구성이 달라진 달).
  if (f < 0.7 || f > 1.3) return { f: 1, adjusted: false };
  return { f, adjusted: true };
}

/**
 * 비슷한 면적의 같은 단지 거래 고르기.
 * `lag` — 기준월에서 이만큼 **앞선 달까지만** 씁니다. 평소에는 0(그달 거래도 씀)이지만,
 * 백테스트에서는 1 로 두어 **맞히려는 달의 거래를 보지 못하게** 합니다. 그걸 빼지 않으면
 * 답을 보고 답을 맞히는 셈이 되어 오차가 실제보다 훨씬 좋게 나옵니다.
 */
export function pickComparables(trades, { seq, area, asOfYM, months = 12, areaTol = 0.1, lag = 0 }) {
  const lo = area * (1 - areaTol), hi = area * (1 + areaTol);
  return trades.filter(t => t.seq === seq
    && t.area >= lo && t.area <= hi
    && t.perPyeong > 0
    && monthsBetween(ymOf(t.date), asOfYM) >= lag          // 기준월보다 미래(또는 lag 안쪽) 거래는 쓰지 않음
    && monthsBetween(ymOf(t.date), asOfYM) < months);
}

/**
 * 쓰는 창(개월). **짧은 창부터** 써 보고, 표본이 모자랄 때만 넓힙니다.
 *
 * 왜 3개월인가 — 백테스트에서 직접 쟀습니다(2026-11-19, 서울 8,326건).
 *   3개월 중앙값 3.9% · 직전 1건 4.2% · 6개월 5.5% · **12개월 7.2%**
 * 오르는 장에서 12개월 중앙값은 지난 1년에 묶여 뒤처집니다. 창이 길수록 표본은 늘지만 더 틀립니다.
 * 그래서 「표본이 많을수록 좋다」가 아니라 「최근 것이 좋다」가 맞습니다.
 */
export const WINDOWS = [3, 6, 12];

/**
 * 등급은 **백테스트로 잰 오차**에 맞춰 둡니다(2026-11-19 · 서울 9,709건, 중앙오차 기준).
 *   A  3개월 창   3.9%
 *   B  6개월 창   4.7%
 *   C 12개월 창   6.1%
 *   D  비교 거래 1~2건 — 값 없이 범위만
 *   none 0건 — 아무것도 내보내지 않음
 *
 * **표본 수는 등급에 넣지 않습니다.** 넣어 봤는데 정확도를 설명하지 못했습니다 —
 * 3~4건 4.8% · 5~9건 4.0% · 10건 이상 4.5% 로 들쭉날쭉했습니다. 거래가 많은 단지는 대개 대단지라
 * 동·층·향이 제각각이어서, 건수가 많다고 더 잘 맞지 않습니다. 실제로 가르는 것은 **얼마나 최근인가**였습니다.
 */
export function gradeOf(n, monthsSinceLast, window = 3) {
  if (n < 1) return 'none';
  if (n < 3) return 'D';
  return window <= 3 ? 'A' : window <= 6 ? 'B' : 'C';
}

/**
 * 등급별 범위 폭(±%). 백테스트의 「범위 적중」으로 맞춘 값이고, **목표는 85%** 입니다.
 * 처음에는 사분위 범위를 썼는데 적중이 37% 뿐이었습니다 — 열 번에 여섯 번은 범위 밖에서 거래됐다는 뜻이라,
 * 범위라고 부를 수 없었습니다. 등급마다 오차 분포에 맞춰 넓혔습니다.
 *
 * 2026-11-24 재측정(`scripts/exp-band.mjs`) — **A 만 목표에 미달이었습니다.**
 *
 *   A  ±8.0% → 82.3%   ±9.0% → **86.1%** (평균 범위 폭 16.9% → 18.8%)   ← 0.09 로 넓힘
 *   B  ±11%  → 87.1%   그대로
 *   C  ±15%  → 87.3%   그대로
 *   D  ±20%  → 92.1%   그대로 — 목표보다 넉넉하지만 **일부러 둡니다.**
 *                      D 는 값을 내놓지 않는 등급이라 「모르겠다」가 범위 폭으로 보여야 합니다.
 *                      좁히면 가장 모르는 자리에서 가장 아는 척하게 됩니다.
 *
 * 넓히면 적중률은 반드시 오릅니다(「0원~100억」은 100% 맞습니다). 그래서 폭을 함께 보고,
 * **85% 에 처음 닿는 폭**에서 멈춥니다. 그보다 넓히는 것은 이득 없이 무뎌지는 것뿐입니다.
 */
export const BAND = { A: 0.09, B: 0.11, C: 0.15, D: 0.20 };

/**
 * ── 층 보정 (v3 · 2026-11-23) ───────────────────────────────────────────────
 * v1·v2 에서는 **일부러 비워 뒀던** 자리입니다. 「1층은 싸다」는 건 누구나 알지만,
 * 얼마나 싼지를 재지 않고 넣으면 추측을 모델에 박는 셈이기 때문입니다.
 *
 * `scripts/exp-floor.mjs` 로 **같은 단지·같은 면적대 안에서** 재고(4,459개 묶음 · 51,995건,
 * 자치구 지수로 시점을 먼저 걷어낸 뒤) 중층을 1.000 으로 놓은 값입니다.
 *
 *   1층  0.938 (−6.2%)   2층  0.971 (−2.9%)   저층 0.995   중층 1.000   고층 1.004   탑층 1.002
 *
 * **재고 나서 알게 된 것: 쓸모 있는 건 1·2층뿐입니다.** 저층·고층·탑층은 ±0.5% 안이라
 * 사실상 평평합니다. 「고층일수록 비싸다」는 통념은 서울 아파트 실거래에서 확인되지 않았습니다
 * (탑층이 고층보다 싼 것도 같은 이유 — 누수·단열 때문으로 보이지만 자료로는 확인 못 했습니다).
 *
 * 백테스트(202608~202610 · 9,764건): 보정 없음 4.3% → **4.1%**, ±10% 안 83.4% → 84.7%.
 * 처음으로 기준선(직전 거래 그대로 4.3%)을 **이겼습니다.** 1층만 보면 4.9% → 4.3% 로 가장 크게 듭니다.
 */
export const FLOOR_FACTOR = { '1층': 0.938, '2층': 0.971, '저층': 0.995, '중층': 1, '고층': 1.004, '탑층': 1.002 };

/** 단지별 관측 최고층 — 건축물대장이 없으므로 거래에서 추정합니다. estimate 에 넘겨 쓰십시오. */
export function buildFloorIndex(trades) {
  const m = new Map();
  for (const t of trades) {
    if (!t.seq || !(t.floor > 0)) continue;
    m.set(t.seq, Math.max(m.get(t.seq) || 0, t.floor));
  }
  return m;
}

/** 절대 층수가 아니라 **상대 위치**(층/최고층)로 나눕니다 — 5층 빌라의 5층과 30층 아파트의 5층은 다릅니다. */
export function floorBand(floor, maxFloor) {
  if (!(floor > 0)) return '모름';
  if (floor === 1) return '1층';
  if (!(maxFloor > 1)) return '모름';
  const rel = floor / maxFloor;
  if (rel >= 0.95) return '탑층';
  if (floor === 2) return '2층';
  if (rel >= 0.7) return '고층';
  if (rel >= 0.35) return '중층';
  return '저층';
}

/** 층 배수. 모르면 1 — 모르는 것을 보정하지 않습니다. */
export const floorFactor = (floor, maxFloor) => FLOOR_FACTOR[floorBand(floor, maxFloor)] || 1;

/**
 * 한 단지·한 면적의 추정.
 * 돌려주는 것: { perPyeong, amount, low, high, n, grade, asOfYM, adjustedN, lastDealYM, reason }
 * **grade 'D' 와 'none' 은 perPyeong 을 null 로 둡니다** — 값을 줄 만큼 알지 못한다는 뜻입니다.
 */
export function estimate(trades, index, { seq, area, asOfYM, months = null, areaTol = 0.1, lag = 0, floors = null, floor = null, band = null }) {
  // 짧은 창부터 — 3개월에 3건이 모이면 거기서 멈춥니다. 모자랄 때만 6·12개월로 넓힙니다.
  // (months 를 직접 주면 그 창만 씁니다 — 실험·백테스트용)
  const tries = months ? [months] : WINDOWS;
  let comps = [], window = tries[tries.length - 1];
  for (const w of tries) {
    const got = pickComparables(trades, { seq, area, asOfYM, months: w, areaTol, lag });
    if (got.length >= 3 || w === tries[tries.length - 1]) { comps = got; window = w; break; }
    if (got.length > comps.length) { comps = got; window = w; }
  }
  if (!comps.length) {
    return { perPyeong: null, amount: null, low: null, high: null, n: 0, grade: 'none', asOfYM, window,
      reason: `최근 ${window}개월 안에 전용 ${Math.round(area)}㎡ 안팎(±${Math.round(areaTol * 100)}%) 거래가 없습니다` };
  }
  // 창을 넓혔으면 **최근 것만** 씁니다. 넓힌 창의 거래를 전부 쓰면 오래된 가격이 중앙값을 끌어내립니다
  // (백테스트: 6개월 전부 5.5% / 12개월 전부 7.2% vs 직전 3건 4.2%).
  // 12개월까지 넓혀야 할 만큼 거래가 드문 단지는 **가장 최근 한 건**이 가장 정확했습니다
  // (12개월 중앙값 6.1% vs 직전 1건 5.0%). 1년 전 거래와 섞으면 그만큼 뒤처집니다.
  const found = comps.length;
  if (window > WINDOWS[0]) {
    comps = [...comps].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, window > 6 ? 1 : 3);
  }
  const gu = comps[0].gu;
  // 층 보정 — 비교 거래를 **중층 기준으로 고르게 맞춥니다.** 하필 최근 거래가 1층 한 건이면
  // 그 단지 전체가 6% 싸 보이기 때문입니다. 단지의 최고층은 거래에서 추정합니다.
  const maxFloor = floors ? floors.get(seq) : comps.reduce((s, t) => Math.max(s, t.floor || 0), 0);
  let floorAdjustedN = 0;
  let adjustedN = 0;
  const vals = comps.map(t => {
    const { f, adjusted } = timeFactor(index, gu, ymOf(t.date), asOfYM);
    if (adjusted) adjustedN++;
    const ff = floorFactor(t.floor, maxFloor);
    if (ff !== 1) floorAdjustedN++;
    return Math.round((t.perPyeong * f) / ff);
  });
  const lastDealYM = comps.map(t => ymOf(t.date)).sort().pop();
  const n = vals.length;
  const grade = gradeOf(found, monthsBetween(lastDealYM, asOfYM), window);
  const med = median(vals);
  // 범위 = 등급별 폭(BAND)과 실제 거래 흩어짐(사분위) 중 **넓은 쪽**.
  // 폭만 쓰면 값이 크게 갈리는 단지에서 좁고, 사분위만 쓰면 거래가 몰린 단지에서 지나치게 좁습니다.
  // band 를 직접 주면 그 폭을 씁니다 — `scripts/exp-band.mjs` 가 폭을 바꿔 가며 재기 위한 구멍입니다.
  const w = band != null ? band : (BAND[grade] || 0.2);
  const lowMid = Math.min(med * (1 - w), n >= 5 ? quantile(vals, 0.25) : Math.min(...vals));
  const highMid = Math.max(med * (1 + w), n >= 5 ? quantile(vals, 0.75) : Math.max(...vals));

  // 여기까지는 전부 **중층 기준** 값입니다. 어느 층인지 알려 준 경우에만 그 층으로 되돌립니다.
  // 모르면 중층 기준으로 내보내고, 그렇다고 말합니다(floorBasis).
  const tf = floor != null ? floorFactor(floor, maxFloor) : 1;
  const med2 = Math.round(med * tf), low = lowMid * tf, high = highMid * tf;

  const py = area / PYEONG;
  const show = grade === 'A' || grade === 'B' || grade === 'C';
  return {
    perPyeong: show ? med2 : null,
    amount: show ? Math.round(med2 * py) : null,          // 만원
    low: Math.round(low), high: Math.round(high),
    lowAmount: Math.round(low * py), highAmount: Math.round(high * py),
    n: found, usedN: n, adjustedN, grade, asOfYM, lastDealYM, gu, window,
    floorAdjustedN, maxFloor: maxFloor || null,
    floorBasis: floor != null ? floorBand(floor, maxFloor) : '중층',
    floorFactor: tf,
    reason: show ? null : '거래가 너무 적어 한 값으로 적지 않고 범위만 보여 드립니다',
  };
}

/** 사람이 읽을 한 줄 — 화면·보고서에 그대로 쓰라고 여기서 만듭니다(표시를 코드마다 다르게 쓰지 않도록) */
export function describe(e) {
  const man = n => (n == null ? '—' : Math.round(n).toLocaleString('ko-KR'));
  if (e.grade === 'none') return `추정 보류 — ${e.reason}`;
  const range = `${man(e.lowAmount)}~${man(e.highAmount)}만원`;
  const head = e.amount ? `${man(e.amount)}만원 (${range})` : range;
  const tail = `거래 ${e.n}건 · 등급 ${e.grade} · ${e.asOfYM.slice(0, 4)}년 ${Number(e.asOfYM.slice(4))}월 기준`;
  // 대표값이 없는 경우에는 **왜 없는지**까지 한 줄에 붙입니다 — 숫자만 비어 있으면 고장으로 읽힙니다.
  return `${head} · ${tail}${e.reason ? ` — ${e.reason}` : ''}`;
}
