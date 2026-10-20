// 진가 포트폴리오 — 보유 종목 평가·기대수익률과 정기 모으기(적립식) 시뮬레이션
// 순수 계산만 합니다(네트워크·DOM 없음). 시세·적정가·컨센서스는 index.html 이 /api/stock-analysis?peers=1&cards=1 로 받아 넣어 줍니다.
//
// 기대수익률 근거(위에서부터 먼저 있는 것)
//   1) 진가 적정가 대비 기대 상승여력 — 진가 점수 산정 대상(코스피·코스닥 상위 100 · S&P 500 · 나스닥 100)
//   2) 애널리스트 목표가 대비 상승여력 — 미국은 나스닥 컨센서스 목표가
//   3) 둘 다 없으면 「전망 없음」 — 0%로 치지 않고 기대수익률 계산에서 빼고, 그 비중을 따로 알려 줍니다.
// 시나리오 폭은 애널리스트 목표가 상·하한이 있으면 그 절반, 없으면 시장 기본값(국내 ±25%p · 미국 ±20%p)을 씁니다.
// 모두 가정에 따른 계산이며 투자 권유가 아닙니다.

export const CYCLES = {
  day: { key: 'day', label: '일', days: 1, perYear: 365 },
  week: { key: 'week', label: '주', days: 7, perYear: 52 },
  month: { key: 'month', label: '월', days: 30.4375, perYear: 12 },
};
export const DEFAULT_BAND = { KR: 0.25, US: 0.20 };
export const SCENARIOS = [
  { key: 'bull', label: '강세', sign: 1 },
  { key: 'base', label: '기준', sign: 0 },
  { key: 'bear', label: '약세', sign: -1 },
];

const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const round = (v, d = 4) => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d);
export const cardKey = (market, s) => `${market}:${String(s).toUpperCase()}`;

/** 카드 목록 → { 'KR:005930': card } */
export const cardMap = cards => new Map((cards || []).map(c => [cardKey(c.market, c.s), c]));

/** 1년 기대수익률과 그 근거 */
export function upsideOf(card) {
  if (!card) return { v: null, basis: '시세를 받지 못함' };
  const p = num(card.p);
  if (card.analyzed !== false && num(card.expUpside) != null && !card.clamped) {
    return { v: card.expUpside, basis: '진가 적정가 대비' };
  }
  const t = card.forward && num(card.forward.target);
  if (t != null && p) return { v: round(t / p - 1), basis: '애널리스트 목표가 대비' };
  if (card.analyzed !== false && card.clamped) return { v: null, basis: '적정가가 상한에 걸려 제외' };
  return { v: null, basis: '적정가·목표가 없음' };
}

/** 시나리오 폭(±) */
export function bandOf(card) {
  const p = card && num(card.p);
  const f = (card && card.forward) || {};
  if (p && num(f.targetHigh) != null && num(f.targetLow) != null) {
    const half = (f.targetHigh - f.targetLow) / 2 / p;
    if (half > 0.02) return Math.min(1.5, half);
  }
  return DEFAULT_BAND[card && card.market === 'US' ? 'US' : 'KR'];
}

/** 시나리오별 1년 기대수익률 */
export function scenarioReturns(card) {
  const { v, basis } = upsideOf(card);
  const band = bandOf(card);
  if (v == null) return { basis, band, bull: null, base: null, bear: null };
  return { basis, band, bull: round(v + band), base: round(v), bear: round(v - band) };
}

/**
 * 보유 종목 평가 — holdings: [{ market, s, qty, avg, per }] (avg 평단가, per 회차당 매수 수량)
 * 금액은 원화 환산(미국 종목은 fx 원/달러) 기준으로 합칩니다.
 */
export function valuate({ holdings = [], cards = [], fx = 1 } = {}) {
  const map = cards instanceof Map ? cards : cardMap(cards);
  const rows = [];
  for (const h of holdings) {
    const qty = num(h.qty) || 0;
    if (!h.s || qty <= 0) continue;
    const c = map.get(cardKey(h.market, h.s)) || null;
    const rate = h.market === 'US' ? fx : 1;
    const price = c ? num(c.p) : null;
    const avg = num(h.avg);
    const sc = scenarioReturns(c);
    rows.push({
      market: h.market, s: h.s, n: (c && c.n) || h.n || h.s, qty, avg, per: num(h.per) || 0,
      currency: h.market === 'US' ? 'USD' : 'KRW', rate, price,
      sec: (c && c.sec) || '', theme: (c && c.theme) || null, analyzed: c ? c.analyzed !== false : false,
      score: c ? num(c.score) : null, fair: c ? num(c.fair) : null,
      value: price == null ? null : qty * price * rate,
      cost: avg == null ? null : qty * avg * rate,
      ...sc,
    });
  }
  const sum = key => rows.reduce((a, r) => a + (num(r[key]) || 0), 0);
  const value = sum('value'), cost = sum('cost');
  for (const r of rows) r.weight = value > 0 && r.value != null ? round(r.value / value) : null;

  // 기대수익률은 「전망이 있는 비중」 안에서 평가금액 가중평균 — 전망 없는 종목을 0%로 치지 않습니다
  const covered = rows.filter(r => r.base != null && r.value != null);
  const coveredValue = covered.reduce((a, r) => a + r.value, 0);
  const wavg = key => (coveredValue > 0 ? round(covered.reduce((a, r) => a + r.value * r[key], 0) / coveredValue) : null);
  const scenarios = { bull: wavg('bull'), base: wavg('base'), bear: wavg('bear') };

  return {
    rows,
    total: {
      value: round(value, 0), cost: round(cost, 0),
      pl: cost > 0 ? round(value - cost, 0) : null, plPct: cost > 0 ? round(value / cost - 1) : null,
      count: rows.length,
    },
    scenarios,
    coverage: { ratio: value > 0 ? round(coveredValue / value) : null, count: covered.length, missing: rows.filter(r => r.base == null).map(r => r.n) },
    expected: Object.fromEntries(SCENARIOS.map(sc => [sc.key, scenarios[sc.key] == null || value <= 0 ? null : round(value * (1 + scenarios[sc.key]), 0)])),
  };
}

/** 회차 날짜 — 월 주기는 같은 날짜(말일은 그 달 마지막 날) */
export function scheduleDates(start, cycle, count) {
  const c = CYCLES[cycle] || CYCLES.month;
  const base = start instanceof Date ? new Date(start.getTime()) : new Date(start);
  const day = base.getDate();
  const out = [];
  for (let i = 0; i < count; i++) {
    if (c.key === 'month') {
      const d = new Date(base.getFullYear(), base.getMonth() + i, 1);
      d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
      out.push(d);
    } else {
      out.push(new Date(base.getTime() + i * c.days * 86400e3));
    }
  }
  return out;
}

/** 연 기대수익률 r 을 경과일수 t 만큼 복리로 — 가격 경로 가정 */
export const priceAt = (p0, r, days) => (p0 == null || r == null ? p0 : p0 * (1 + r) ** (days / 365));

/**
 * 정기 모으기 시뮬레이션
 * plan: { mode: 'amount'|'qty', amount(원, 회차당 총액), cycle: 'day'|'week'|'month', count, start }
 * 비중: 금액 기준이면 현재 평가금액 비중대로 나눠 삽니다(평가금액이 없으면 같은 비율).
 * 수량 기준이면 각 종목의 per(회차당 매수 수량)대로 삽니다.
 */
export function simulate({ valuation, plan = {}, scenario = 'base', fx = 1 } = {}) {
  const rows = (valuation && valuation.rows) || [];
  const cycle = CYCLES[plan.cycle] ? plan.cycle : 'month';
  const count = Math.max(0, Math.min(600, Math.floor(num(plan.count) || 0)));
  const mode = plan.mode === 'qty' ? 'qty' : 'amount';
  const amount = num(plan.amount) || 0;
  const dates = scheduleDates(plan.start || new Date(), cycle, count);
  const t0 = dates.length ? dates[0].getTime() : Date.now();

  const live = rows.filter(r => r.price != null);
  const totalValue = live.reduce((a, r) => a + (r.value || 0), 0);
  const shareOf = r => {
    if (mode !== 'amount') return 0;
    if (totalValue > 0) return (r.value || 0) / totalValue;
    return live.length ? 1 / live.length : 0;
  };

  const state = live.map(r => ({ r, qty: r.qty, invested: r.cost != null ? r.cost : r.qty * r.price * r.rate, bought: 0, spent: 0 }));
  const steps = [];
  const legs = [];
  dates.forEach((d, i) => {
    const days = (d.getTime() - t0) / 86400e3;
    let buy = 0;
    for (const st of state) {
      const ret = st.r[scenario];
      const price = priceAt(st.r.price, ret, days);          // 현지 통화 기준 예상 단가
      const won = price * st.r.rate;
      const q = mode === 'qty' ? st.r.per || 0 : won > 0 ? (amount * shareOf(st.r)) / won : 0;
      const spend = q * won;
      st.qty += q; st.bought += q; st.spent += spend; st.invested += spend;
      buy += spend;
      legs.push({ i: i + 1, date: d, market: st.r.market, s: st.r.s, n: st.r.n, price, won, qty: q, amount: spend, cumQty: st.qty });
    }
    const value = state.reduce((a, st) => a + st.qty * priceAt(st.r.price, st.r[scenario], days) * st.r.rate, 0);
    const invested = state.reduce((a, st) => a + st.invested, 0);
    steps.push({
      i: i + 1, date: d, buy: round(buy, 0), invested: round(invested, 0), value: round(value, 0),
      pl: round(value - invested, 0), plPct: invested > 0 ? round(value / invested - 1) : null,
    });
  });

  const last = steps[steps.length - 1] || null;
  return {
    scenario, cycle, mode, count, amount, fx,
    steps, legs,
    holdings: state.map(st => ({ market: st.r.market, s: st.r.s, n: st.r.n, start: st.r.qty - st.bought, bought: round(st.bought, 4), end: round(st.qty, 4), spent: round(st.spent, 0) })),
    summary: last
      ? { months: round((dates[dates.length - 1] - t0) / 86400e3 / 30.4375, 1), invested: last.invested, value: last.value, pl: last.pl, plPct: last.plPct, buyTotal: round(steps.reduce((a, s) => a + s.buy, 0), 0) }
      : null,
  };
}

// ── 엑셀(xlsx-lite.mjs buildXlsx 입력) ────────────────────────
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const cell = (v, s) => ({ v: v == null ? null : v, s });
const T = v => cell(v, 'TEXT');
const C = v => cell(v, 'CENTER');
const N1 = v => cell(round(v, 1), 'NUM1');
const N2 = v => cell(round(v, 2), 'NUM2');
const I = v => cell(v == null ? null : Math.round(v), 'INT');
const P = v => cell(v, 'PCT');
const head = cols => cols.map(v => ({ v, s: 'HEADER' }));

/** 포트폴리오·정기 모으기 → 엑셀 시트 */
export function buildPortfolioSheets({ valuation, sim = null, fx = 1, generatedAt = new Date(), asOf = null, title = '진가 포트폴리오' }) {
  const v = valuation;
  const sub = `작성 ${ymd(generatedAt)} · 환율 ${Math.round(fx).toLocaleString('ko-KR')}원/달러${asOf ? ` · 시세·분석 기준 ${String(asOf).slice(0, 10)}` : ''}`;
  const sheets = [];

  sheets.push({
    name: '포트폴리오', tabColor: 'FF1E5FCC', freeze: { row: 4, col: 2 },
    colWidths: [12, 24, 8, 11, 13, 13, 16, 9, 16, 16, 9, 9, 13, 9, 9, 9, 22],
    rows: [
      [{ v: `${title} — 보유 종목 평가·기대수익률`, s: 'TITLE' }],
      [{ v: sub, s: 'SUBTITLE' }],
      [],
      head(['종목코드', '종목명', '시장', '보유수량', '평단가', '현재가', '평가금액(원)', '비중', '매입금액(원)', '평가손익(원)', '수익률',
        '진가점수', '적정가', '강세', '기준', '약세', '기대수익률 근거']),
      ...v.rows.map(r => [T(r.s), T(r.n), C(r.market === 'KR' ? '국내' : '미국'), N2(r.qty), N2(r.avg), N2(r.price),
        I(r.value), P(r.weight), I(r.cost), I(r.value != null && r.cost != null ? r.value - r.cost : null),
        P(r.cost ? r.value / r.cost - 1 : null), N1(r.score), N2(r.fair), P(r.bull), P(r.base), P(r.bear), T(r.basis)]),
      [{ v: '합계', s: 'TOTAL_LABEL' }, T(''), C(''), C(''), C(''), C(''),
        { v: v.total.value, s: 'TOTAL_INT' }, { v: v.total.value ? 1 : null, s: 'TOTAL_PCT' },
        { v: v.total.cost, s: 'TOTAL_INT' }, { v: v.total.pl, s: 'TOTAL_INT' }, { v: v.total.plPct, s: 'TOTAL_PCT' },
        C(''), C(''), { v: v.scenarios.bull, s: 'TOTAL_PCT' }, { v: v.scenarios.base, s: 'TOTAL_PCT' }, { v: v.scenarios.bear, s: 'TOTAL_PCT' }, T('')],
      [],
      [{ v: '1년 뒤 예상 평가금액(원)', s: 'SECTION' }],
      [{ v: '강세', s: 'HEADER' }, { v: '기준', s: 'HEADER' }, { v: '약세', s: 'HEADER' }],
      [I(v.expected.bull), I(v.expected.base), I(v.expected.bear)],
      [],
      [{ v: `· 전망 반영 비중 ${v.coverage.ratio == null ? '—' : (v.coverage.ratio * 100).toFixed(1) + '%'}(${v.coverage.count}종목). 전망이 없는 종목은 0%로 치지 않고 기대수익률 계산에서 뺍니다${v.coverage.missing.length ? `: ${v.coverage.missing.join(', ')}` : ''}.`, s: 'NOTE' }],
      [{ v: '· 기대수익률 = 진가 적정가 대비 상승여력(점수 산정 대상) 또는 애널리스트 컨센서스 목표가 대비 상승여력.', s: 'NOTE' }],
      [{ v: '· 강세·약세는 애널리스트 목표가 상·하한의 절반(없으면 국내 ±25%p · 미국 ±20%p)을 더하고 뺀 값입니다.', s: 'NOTE' }],
      [{ v: '· 가정에 따른 계산이며 투자 권유가 아닙니다.', s: 'NOTE' }],
    ],
  });

  if (sim && sim.steps.length) {
    const scLabel = (SCENARIOS.find(s => s.key === sim.scenario) || SCENARIOS[1]).label;
    const how = sim.mode === 'qty' ? '수량 기준(종목별 회차당 수량)' : `금액 기준 회차당 ${Math.round(sim.amount).toLocaleString('ko-KR')}원(현재 비중대로 나눔)`;
    sheets.push({
      name: '정기 모으기', tabColor: 'FF0F9D58', freeze: { row: 5 },
      colWidths: [8, 14, 18, 18, 18, 18, 11],
      rows: [
        [{ v: `${title} — 정기 모으기 시뮬레이션`, s: 'TITLE' }],
        [{ v: `${CYCLES[sim.cycle].label} 단위 · ${sim.count}회 · ${how} · ${scLabel} 시나리오 · ${sub}`, s: 'SUBTITLE' }],
        [{ v: '· 예상 단가는 종목별 1년 기대수익률이 그대로 이어진다고 보고 회차마다 복리로 올린 가정값입니다(실제 시세가 아닙니다).', s: 'NOTE' }],
        [],
        head(['회차', '날짜', '매수금액(원)', '누적 투자금(원, 기존 매입 포함)', '평가금액(원)', '평가손익(원)', '수익률']),
        ...sim.steps.map(s => [C(s.i), C(ymd(s.date)), I(s.buy), I(s.invested), I(s.value), I(s.pl), P(s.plPct)]),
        [{ v: '합계', s: 'TOTAL_LABEL' }, C(''), { v: sim.summary.buyTotal, s: 'TOTAL_INT' },
          { v: sim.summary.invested, s: 'TOTAL_INT' }, { v: sim.summary.value, s: 'TOTAL_INT' },
          { v: sim.summary.pl, s: 'TOTAL_INT' }, { v: sim.summary.plPct, s: 'TOTAL_PCT' }],
      ],
    });
    sheets.push({
      name: '회차별 종목', freeze: { row: 2, col: 2 },
      colWidths: [8, 14, 12, 24, 8, 14, 14, 16, 14],
      rows: [
        head(['회차', '날짜', '종목코드', '종목명', '시장', '예상단가', '매수수량', '매수금액(원)', '누적수량']),
        ...sim.legs.map(l => [C(l.i), C(ymd(l.date)), T(l.s), T(l.n), C(l.market === 'KR' ? '국내' : '미국'),
          N2(l.price), cell(round(l.qty, 4), 'DEC3'), I(l.amount), cell(round(l.cumQty, 4), 'DEC3')]),
      ],
    });
  }
  return sheets;
}
