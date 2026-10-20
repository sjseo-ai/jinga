// 진가 매매 기록 — 사고판 내역으로 보유·손익을 셈하고 기간별 수익률을 지수와 견줍니다.
// 순수 계산만 합니다(네트워크·DOM 없음). 시세·환율은 index.html 이 /api/stock-analysis?history=1 로 받아 넣어 줍니다.
//
// 왜 기록을 받나 — 지금까지는 「보유 수량·평단가」만 받았습니다. 그건 지금 모습일 뿐이라
// **언제 얼마에 샀는지·얼마를 실현했는지**를 알 수 없어 기간 수익률을 낼 수 없었습니다.
//
// 셈하는 방식
//   · 평단가·실현손익 — **이동평균법**(증권사·세법에서 쓰는 방식). 살 때 평균을 다시 내고, 팔 때 그 평균과의 차이를 실현손익으로.
//   · 기간 수익률 — **시간가중수익률(TWR)**. 돈을 언제 넣었는지에 좌우되지 않아 지수와 나란히 견줄 수 있습니다.
//     (내가 실제로 번 돈의 비율을 보려면 금액가중이 맞지만, 그건 「지수보다 잘했나」를 답하지 못합니다.)
//   · 미국 종목은 그날 환율로 원화로 바꿔 한 배에 담습니다.

export const SIDES = { buy: '매수', sell: '매도' };
export const PERIODS = [
  { key: 'm1', label: '1개월', days: 30 },
  { key: 'm3', label: '3개월', days: 91 },
  { key: 'm6', label: '6개월', days: 182 },
  { key: 'y1', label: '1년', days: 365 },
  { key: 'all', label: '보유 전체', days: null },
];
export const BENCHMARKS = [
  { key: 'KOSPI', label: '코스피', market: 'KR' },
  { key: 'SPX', label: 'S&P 500', market: 'US' },
];

const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const round = (v, d = 4) => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d);
const clean = (s, max = 40) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, max);
export const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
export const tradeKey = (market, s) => `${market}:${String(s).toUpperCase()}`;
const addDays = (ymd, n) => {
  const d = new Date(ymd + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/**
 * 매매 한 건 다듬기 — 화면에서 온 값을 그대로 믿지 않습니다.
 * → { ok, value } | { ok:false, error }
 */
export function parseTrade(input = {}) {
  const date = String(input.date || '').slice(0, 10);
  if (!isDate(date)) return { ok: false, error: '날짜를 YYYY-MM-DD 로 적어 주세요' };
  const market = input.market === 'US' ? 'US' : 'KR';
  const s = clean(input.s, 12).toUpperCase();
  if (!s) return { ok: false, error: '종목을 고르지 않았습니다' };
  const side = input.side === 'sell' ? 'sell' : 'buy';
  const qty = Number(input.qty);
  if (!(qty > 0)) return { ok: false, error: '수량은 0보다 커야 합니다' };
  const price = Number(input.price);
  if (!(price > 0)) return { ok: false, error: '단가는 0보다 커야 합니다' };
  const fee = Number(input.fee) || 0;
  if (fee < 0) return { ok: false, error: '수수료는 0 이상이어야 합니다' };
  return { ok: true, value: { date, market, s, n: clean(input.n, 40) || s, side, qty, price, fee } };
}

/**
 * 매매 기록 → 종목별 보유·손익(이동평균법)
 * 판 수량이 가진 것보다 많으면 가진 만큼만 팔린 것으로 보고 넘어갑니다(입력 실수로 셈이 망가지지 않게).
 */
export function positions(trades = []) {
  const by = new Map();
  const rows = [...trades].filter(Boolean).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const warnings = [];
  for (const t of rows) {
    const key = tradeKey(t.market, t.s);
    const p = by.get(key) || { market: t.market, s: t.s, n: t.n || t.s, qty: 0, avg: 0, realized: 0, buyAmt: 0, sellAmt: 0, fee: 0, firstAt: t.date, lastAt: t.date, trades: 0 };
    p.n = t.n || p.n;
    p.lastAt = t.date;
    p.trades++;
    p.fee += t.fee || 0;
    if (t.side === 'buy') {
      const cost = t.qty * t.price + (t.fee || 0);
      p.avg = p.qty + t.qty > 0 ? (p.avg * p.qty + cost) / (p.qty + t.qty) : 0;
      p.qty += t.qty;
      p.buyAmt += cost;
    } else {
      const sellQty = Math.min(t.qty, p.qty);
      if (sellQty < t.qty) warnings.push(`${p.n} ${t.date}: 가진 수량(${p.qty})보다 많이 팔았습니다 — 가진 만큼만 셈했습니다`);
      const proceeds = sellQty * t.price - (t.fee || 0);
      p.realized += proceeds - p.avg * sellQty;
      p.qty -= sellQty;
      p.sellAmt += proceeds;
      if (p.qty <= 1e-9) { p.qty = 0; p.avg = 0; }
    }
    by.set(key, p);
  }
  for (const p of by.values()) {
    p.qty = round(p.qty, 6);
    p.avg = round(p.avg, 4);
    p.realized = round(p.realized, 0);
    p.buyAmt = round(p.buyAmt, 0);
    p.sellAmt = round(p.sellAmt, 0);
  }
  return { list: [...by.values()], warnings };
}

/** 어느 날 장 마감 시점의 보유 수량 */
export function qtyOn(trades, market, s, date) {
  const key = tradeKey(market, s);
  let q = 0;
  for (const t of trades) {
    if (tradeKey(t.market, t.s) !== key || String(t.date) > date) continue;
    q += t.side === 'buy' ? t.qty : -t.qty;
  }
  return Math.max(0, round(q, 6));
}

/** 그날 이전(포함) 가장 최근 값 — 휴장일에는 직전 종가를 씁니다 */
export function valueAt(series, date) {
  if (!series || !series.length) return null;
  let best = null;
  for (const [d, v] of series) {
    if (d <= date && (!best || d > best[0])) best = [d, v];
  }
  return best ? best[1] : null;
}

/**
 * 날짜별 포트폴리오 평가액과 그날의 순입금(매수−매도)
 * prices: { 'KR:005930': [[YYYY-MM-DD, 종가], …] } · fx: [[날짜, 원/달러], …]
 * dates: 셈할 날짜들(거래일)
 */
export function valueSeries({ trades = [], prices = {}, fx = [], dates = [] } = {}) {
  const keys = [...new Set(trades.map(t => tradeKey(t.market, t.s)))];
  const out = [];
  // 환율을 못 받은 오래된 날에는 가진 것 중 가장 이른 환율을 씁니다.
  // 1로 두면 달러 금액이 그대로 원화가 되어(1,400배 축소) 평가액이 통째로 망가집니다.
  const oldestFx = fx.length ? fx[0][1] : 1;
  for (const date of dates) {
    const rate = valueAt(fx, date) || oldestFx;
    let value = 0, known = 0;
    for (const key of keys) {
      const [market, s] = key.split(':');
      const q = qtyOn(trades, market, s, date);
      if (!q) continue;
      const px = valueAt(prices[key], date);
      if (px == null) continue;                       // 시세를 못 받은 종목은 빼고 셈합니다
      known++;
      value += q * px * (market === 'US' ? rate : 1);
    }
    let flow = 0;
    for (const t of trades) {
      if (t.date !== date) continue;
      const amt = t.qty * t.price * (t.market === 'US' ? rate : 1);
      flow += t.side === 'buy' ? amt + (t.fee || 0) * (t.market === 'US' ? rate : 1) : -(amt - (t.fee || 0) * (t.market === 'US' ? rate : 1));
    }
    out.push({ date, value: round(value, 0), flow: round(flow, 0), known });
  }
  return out;
}

/**
 * 시간가중수익률 — 돈을 넣은 날의 효과를 빼고 「운용 성적」만 남깁니다.
 * 그날 들어온 돈은 장 시작에 들어온 것으로 봅니다(하루 안의 매매 시각은 알 수 없으므로).
 */
export function twr(series = []) {
  let acc = 1, days = 0;
  for (let i = 1; i < series.length; i++) {
    const prev = series[i - 1], cur = series[i];
    const base = prev.value + (cur.flow || 0);
    if (!(base > 0)) continue;
    acc *= cur.value / base;
    days++;
  }
  return days ? round(acc - 1) : null;
}

/** 기간 안의 조각만 자르기 */
export const slice = (series, from) => series.filter(x => x.date >= from);

/**
 * 기간별 수익률 비교표
 * benchmarks: { KOSPI: [[날짜, 지수], …], SPX: […] }
 * → [{ key, label, from, to, mine, marks: { KOSPI: 값, … }, gaps: { KOSPI: 초과수익 } }]
 */
export function periodTable({ series = [], benchmarks = {}, today = null, periods = PERIODS } = {}) {
  if (!series.length) return [];
  const to = today || series[series.length - 1].date;
  const first = series[0].date;
  return periods.map(p => {
    const from = p.days == null ? first : (addDays(to, -p.days) < first ? first : addDays(to, -p.days));
    const part = slice(series, from);
    const mine = part.length > 1 ? twr(part) : null;
    const marks = {}, gaps = {};
    for (const b of BENCHMARKS) {
      const s = benchmarks[b.key];
      const a = valueAt(s, from), z = valueAt(s, to);
      marks[b.key] = a && z ? round(z / a - 1) : null;
      gaps[b.key] = mine != null && marks[b.key] != null ? round(mine - marks[b.key]) : null;
    }
    return { key: p.key, label: p.label, from, to, days: part.length, mine, marks, gaps, short: p.days != null && from === first };
  });
}

// ── 엑셀(xlsx-lite.mjs buildXlsx 입력) ────────────────────────
const cell = (v, s) => ({ v: v == null ? null : v, s });
const T = v => cell(v, 'TEXT');
const C = v => cell(v, 'CENTER');
const N2 = v => cell(round(v, 2), 'NUM2');
const I = v => cell(v == null ? null : Math.round(v), 'INT');
const P = v => cell(v, 'PCT');
const head = cols => cols.map(v => ({ v, s: 'HEADER' }));

/**
 * 매매 기록·기간별 수익률 → 엑셀 시트 2장(포트폴리오 시트 뒤에 붙습니다)
 * table: periodTable 결과 · gains: pnl 결과 · missing: 시세를 못 받은 종목
 */
export function buildTradeSheets({ trades = [], table = [], gains = null, missing = [], fx = 1, generatedAt = new Date() }) {
  if (!trades.length) return [];
  const day = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const sub = `작성 ${day(generatedAt)} · 환율 ${Math.round(fx).toLocaleString('ko-KR')}원/달러 · 기록 ${trades.length}건`;
  const sorted = [...trades].sort((a, b) => a.date.localeCompare(b.date));
  const g = gains && gains.total;
  const sheets = [];

  sheets.push({
    name: '매매 기록', tabColor: 'FFB45309', freeze: { row: 4, col: 2 },
    colWidths: [12, 12, 20, 8, 8, 12, 14, 12, 14],
    rows: [
      [{ v: '진가 포트폴리오 — 매매 기록', s: 'TITLE' }],
      [{ v: sub, s: 'SUBTITLE' }],
      [],
      head(['날짜', '종목코드', '종목명', '시장', '구분', '수량', '단가', '수수료·세금', '금액']),
      ...sorted.map(t => [C(t.date), T(t.s), T(t.n), C(t.market === 'KR' ? '국내' : '미국'), C(SIDES[t.side]),
        N2(t.qty), N2(t.price), N2(t.fee || 0), N2(t.qty * t.price)]),
      [],
      [{ v: '· 단가·금액은 그 종목의 통화 그대로입니다(미국 종목은 달러).', s: 'NOTE' }],
      [{ v: '· 평단가·실현손익은 이동평균법으로 셈합니다 — 살 때 평균을 다시 내고, 팔 때 그 평균과의 차이를 실현손익으로 봅니다.', s: 'NOTE' }],
      ...(g ? [
        [],
        [{ v: '손익 요약(원)', s: 'SECTION' }],
        head(['실현손익', '평가손익', '합계', '매입원가 대비']),
        [I(g.realized), I(g.unrealized), I(g.total), P(g.rate)],
      ] : []),
    ],
  });

  if (table.length) {
    sheets.push({
      name: '기간별 수익률', tabColor: 'FF7C3AED', freeze: { row: 5, col: 1 },
      colWidths: [12, 13, 13, 15, 12, 12, 12, 12],
      rows: [
        [{ v: '진가 포트폴리오 — 기간별 수익률 비교', s: 'TITLE' }],
        [{ v: sub, s: 'SUBTITLE' }],
        [{ v: '· 시간가중수익률(TWR) — 돈을 언제 넣었는지에 좌우되지 않아 지수와 나란히 견줄 수 있습니다. 입금한 날 늘어난 평가액은 수익으로 치지 않습니다.', s: 'NOTE' }],
        [],
        head(['기간', '시작일', '종료일', '내 포트폴리오', ...BENCHMARKS.flatMap(b => [b.label, `${b.label} 초과`])]),
        ...table.map(r => [C(r.label + (r.short ? '(기록 전체)' : '')), C(r.from), C(r.to), P(r.mine),
          ...BENCHMARKS.flatMap(b => [P(r.marks[b.key]), P(r.gaps[b.key])])]),
        [],
        [{ v: '· 「초과」는 지수보다 얼마나 나은지입니다(내 수익률 − 지수 수익률).', s: 'NOTE' }],
        [{ v: '· 미국 종목은 그날 환율로 원화로 바꿔 한 배에 담아 셈합니다. 세금·배당은 넣지 않았습니다.', s: 'NOTE' }],
        ...(missing.length ? [[{ v: `· 시세를 받지 못해 셈에서 뺀 종목: ${missing.join(', ')}`, s: 'NOTE' }]] : []),
      ],
    });
  }
  return sheets;
}

/** 보유 종목 손익 — 지금 시세(cards)와 합쳐 평가손익까지 */
export function pnl(list = [], priceOf = () => null, fx = 1) {
  const rows = list.map(p => {
    const px = priceOf(p.market, p.s);
    const rate = p.market === 'US' ? fx : 1;
    const value = px != null ? p.qty * px * rate : null;
    const cost = p.qty * p.avg * rate;
    const unrealized = value != null ? round(value - cost, 0) : null;
    const realized = round(p.realized * rate, 0);
    return { ...p, price: px, value: value == null ? null : round(value, 0), cost: round(cost, 0), unrealized, realizedKrw: realized, total: unrealized == null ? realized : round(unrealized + realized, 0) };
  });
  const sum = k => rows.reduce((a, r) => a + (num(r[k]) || 0), 0);
  return {
    rows,
    total: {
      value: round(sum('value'), 0), cost: round(sum('cost'), 0),
      unrealized: round(sum('unrealized'), 0), realized: round(sum('realizedKrw'), 0),
      total: round(sum('total'), 0),
      rate: sum('cost') > 0 ? round(sum('total') / sum('cost')) : null,
    },
  };
}
