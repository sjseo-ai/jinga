// 진가 의사결정 엔진 — 대출·비용 및 시나리오 계산(T016). 순수 함수만, 바깥을 읽지 않습니다.
//
// ── 지키는 것 (로드맵 hard_rules) ────────────────────────────────────────────
//  · **세무·금융 자문이 아닙니다.** 모든 결과에 규칙 버전·기준일·주의문을 함께 냅니다.
//  · 세법·대출규제는 자주 바뀝니다. 수치는 코드가 아니라 `data/finance-rules.json` 에만 두고,
//    규칙마다 **출처와 확신도**(confirmed/likely/uncertain)를 적어 둡니다.
//  · 출처가 엇갈리는 항목(LTV·스트레스DSR·다주택 중과)은 **계산은 하되 경고를 함께 냅니다.**
//    숫자를 안 내면 쓸모가 없고, 경고 없이 내면 거짓말이 됩니다.
//  · 과거·현재(취득비용·보유비용·대출)와 **미래 가정(가격 변동 시나리오)을 절대 섞지 않습니다.**
//    시나리오 결과는 `assumed: true` 를 달고 나갑니다.
//  · 같은 입력이면 같은 값이 나옵니다(난수·현재시각 의존 없음 — 기준일은 인자로 받습니다).
//
// ── 알면서 비워 둔 것 ───────────────────────────────────────────────────────
//  · 재산세 세부담상한제, 종부세 재산세중복분·고령자·장기보유 세액공제 → 실제 고지액은 더 낮을 수 있습니다.
//  · 임대소득·전세보증금 운용, 중도상환수수료, 변동금리 경로 → 다음 판.
//  · 다주택자 계산은 경고를 달아 두되 권하지 않습니다.

const KRW = n => Math.round(Number(n) || 0);
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

/**
 * 누진공제 방식 구간표: 해당 구간 세율 × 과세표준 − 누진공제.
 * 세법 구간은 대부분 「X 이하」(inclusive)지만 중개보수는 「X 미만」(exclusive)이라 둘 다 받습니다.
 */
const bracketOf = (brackets, base, exclusive = false) =>
  brackets.find(b => b.upTo == null || (exclusive ? base < b.upTo : base <= b.upTo)) || brackets[brackets.length - 1];

/** 구간별 한계세율 누적(종부세처럼 누진공제가 없는 표) */
const marginalTax = (brackets, base) => {
  let left = Math.max(0, base), prev = 0, tax = 0;
  for (const b of brackets) {
    const top = b.upTo == null ? Infinity : b.upTo;
    const slice = Math.min(left, top - prev);
    if (slice <= 0) break;
    tax += slice * b.rate;
    left -= slice;
    prev = top;
  }
  return tax;
};

// ── 규칙집 ──────────────────────────────────────────────────────────────────

/** 규칙집이 얼마나 묵었는지. 오래되면 쓰는 쪽에서 갱신 경고를 냅니다. */
export function rulesAge(rules, today) {
  const asOf = new Date(`${rules.asOf}T00:00:00Z`);
  const now = new Date(`${String(today).slice(0, 10)}T00:00:00Z`);
  const days = Math.floor((now - asOf) / 86400000);
  return { days, stale: days > num(rules.staleAfterDays, 180), asOf: rules.asOf, version: rules.version };
}

/** 쓰인 규칙 중 확신도가 낮은 것을 경고로 모읍니다. */
const warnOf = (rules, key) => {
  const r = rules.rules[key];
  if (!r || r.confidence === 'confirmed') return null;
  return { rule: key, label: r.label, confidence: r.confidence, message: r.warn || r.note || '공식 원문으로 확인하지 못한 값입니다.' };
};

// ── 취득 ────────────────────────────────────────────────────────────────────

/** 6억 초과 9억 이하 구간 세율: 취득가액(억원) × 2/3 − 3 (%), 소수 다섯째자리 반올림 */
export function acquisitionRate(price, rules) {
  const r = rules.rules.acquisitionTax;
  const b = bracketOf(r.brackets, price);
  if (b.rate != null) return b.rate;
  const pct = (price / 1e8) * (2 / 3) - 3;
  return Math.round(pct * 1e5) / 1e7; // %→소수. 1e5 로 반올림한 뒤 100 으로 나눔
}

/** 중개보수 상한(부가세 별도) */
export function brokerageFee(price, rules) {
  const r = rules.rules.brokerage;
  const b = bracketOf(r.brackets, price, true); // 「9억 미만 0.4% / 9억 이상 0.5%」 — 경계값은 위 구간

  const raw = price * b.rate;
  return KRW(b.cap != null ? Math.min(raw, b.cap) : raw);
}

/**
 * 집을 살 때 한 번 드는 돈 전부.
 * @param {{price:number, areaM2:number, houses?:number, adjusted?:boolean, firstHome?:boolean,
 *          brokerageRate?:number, moveCost?:number, repairCost?:number}} input
 */
export function acquisitionCost(input, rules) {
  const price = num(input.price);
  const areaM2 = num(input.areaM2);
  const houses = Math.max(1, num(input.houses, 1));
  const r = rules.rules.acquisitionTax;
  const warnings = [];

  let rate = acquisitionRate(price, rules);
  let heavy = false;
  if (houses >= 2) {
    const h = rules.rules.acquisitionTaxHeavy;
    if (input.adjusted) {
      rate = houses >= 3 ? h.rates.house3Plus : h.rates.adjusted2House;
      heavy = true;
      warnings.push(warnOf(rules, 'acquisitionTaxHeavy'));
    } else {
      warnings.push({
        rule: 'acquisitionTaxHeavy', label: h.label, confidence: 'uncertain',
        message: '비조정지역 다주택 취득세율은 이 계산에 넣지 않았습니다. 표준세율로 계산한 값이라 실제보다 낮을 수 있습니다.',
      });
    }
  }

  const tax = KRW(price * rate);
  const eduTax = KRW(tax * r.localEducationTaxRate);
  const ruralTax = areaM2 > r.ruralTaxExemptAreaM2 ? KRW(price * r.ruralTaxRate) : 0;

  let relief = 0;
  if (input.firstHome && !heavy) {
    relief = Math.min(tax, rules.rules.firstHomeRelief.maxRelief);
    warnings.push(warnOf(rules, 'firstHomeRelief'));
  }

  const reg = rules.rules.registration;
  const registration = KRW(reg.baseFee + price * reg.rateOfPrice);
  warnings.push(warnOf(rules, 'registration'));

  const brokerageBase = input.brokerageRate != null ? KRW(price * num(input.brokerageRate)) : brokerageFee(price, rules);
  const brokerage = KRW(brokerageBase * (1 + rules.rules.brokerage.vatRate));
  warnings.push(warnOf(rules, 'brokerage'));

  const other = KRW(num(input.moveCost) + num(input.repairCost));
  const items = [
    { key: 'acquisitionTax', label: '취득세', amount: tax - relief, note: `세율 ${(rate * 100).toFixed(4).replace(/0+$/, '').replace(/\.$/, '')}%${relief ? ` · 생애최초 감면 ${relief.toLocaleString()}원 반영` : ''}` },
    { key: 'localEducationTax', label: '지방교육세', amount: eduTax, note: '취득세의 10%' },
    { key: 'ruralTax', label: '농어촌특별세', amount: ruralTax, note: areaM2 > 85 ? '전용 85㎡ 초과' : '전용 85㎡ 이하 비과세' },
    { key: 'brokerage', label: '중개보수(부가세 포함)', amount: brokerage, note: '상한 기준. 협의로 낮출 수 있습니다' },
    { key: 'registration', label: '법무·등기 실비', amount: registration, note: '가정값' },
    { key: 'other', label: '이사·수리 등', amount: other, note: '입력값' },
  ].filter(i => i.amount > 0 || i.key === 'acquisitionTax');

  const total = items.reduce((s, i) => s + i.amount, 0);
  return { price, rate, items, total, cashNeededWithoutLoan: price + total, warnings: warnings.filter(Boolean) };
}

// ── 대출 ────────────────────────────────────────────────────────────────────

/** 원리금균등 월 납입액 */
export function monthlyPayment(principal, annualRate, years) {
  const n = Math.round(years * 12);
  if (n <= 0) return 0;
  const i = annualRate / 12;
  if (i === 0) return principal / n;
  return (principal * i) / (1 - Math.pow(1 + i, -n));
}

/**
 * 상환 스케줄. method: 'equal'(원리금균등) | 'principal'(원금균등) | 'bullet'(만기일시)
 * graceYears 동안은 이자만 냅니다.
 */
export function amortize({ principal, annualRate, years, method = 'equal', graceYears = 0 }) {
  const P = num(principal), rate = num(annualRate), n = Math.round(num(years) * 12);
  const g = Math.round(clamp(num(graceYears), 0, years) * 12);
  const i = rate / 12;
  const rows = [];
  let bal = P, totalInterest = 0;

  const payAfterGrace = method === 'equal' ? monthlyPayment(P, rate, (n - g) / 12) : 0;
  const principalStep = method === 'principal' && n > g ? P / (n - g) : 0;

  for (let m = 1; m <= n; m++) {
    const interest = bal * i;
    let princ = 0;
    if (m <= g) princ = 0;
    else if (method === 'bullet') princ = m === n ? bal : 0;
    else if (method === 'principal') princ = Math.min(bal, principalStep);
    else princ = Math.min(bal, payAfterGrace - interest);
    bal = Math.max(0, bal - princ);
    totalInterest += interest;
    rows.push({ month: m, payment: KRW(interest + princ), interest: KRW(interest), principal: KRW(princ), balance: KRW(bal) });
  }

  const byYear = [];
  for (let y = 0; y * 12 < rows.length; y++) {
    const slice = rows.slice(y * 12, y * 12 + 12);
    byYear.push({
      year: y + 1,
      payment: slice.reduce((s, r) => s + r.payment, 0),
      interest: slice.reduce((s, r) => s + r.interest, 0),
      principal: slice.reduce((s, r) => s + r.principal, 0),
      balance: slice[slice.length - 1].balance,
    });
  }

  return {
    method, principal: KRW(P), annualRate: rate, years: num(years), graceYears: num(graceYears),
    firstPayment: rows.length ? rows[0].payment : 0,
    maxPayment: rows.reduce((s, r) => Math.max(s, r.payment), 0),
    totalInterest: KRW(totalInterest),
    totalPaid: KRW(P + totalInterest),
    months: rows, byYear,
  };
}

/**
 * 빌릴 수 있는 돈 — LTV·총액상한·DSR 중 **가장 작은 것**이 한도입니다.
 * @param {{price:number, annualIncome:number, annualRate:number, years:number,
 *          regulated?:boolean, firstHome?:boolean, otherDebtAnnual?:number, metro?:boolean}} input
 */
export function loanLimit(input, rules) {
  const L = rules.rules.loan;
  const price = num(input.price);
  const years = Math.max(1, num(input.years, 30));
  const rate = num(input.annualRate);

  const ltvRate = input.regulated
    ? (input.firstHome ? L.ltv.firstHomeRegulated : L.ltv.regulated)
    : L.ltv.normal;
  const byLtv = KRW(price * ltvRate);

  const capRow = bracketOf(L.amountCapByPrice, price);
  const byAmountCap = KRW(capRow.cap);

  // DSR — 스트레스 금리로, 만기는 최장 40년까지만 인정해 계산합니다.
  const stress = rate + (input.metro === false ? L.stressRateAdd.other : L.stressRateAdd.capital);
  const dsrYears = Math.min(years, L.dsrTermYearsCap);
  const capacity = Math.max(0, num(input.annualIncome) * L.dsrCap - num(input.otherDebtAnnual));
  const perUnit = monthlyPayment(1, stress, dsrYears) * 12;
  const byDsr = perUnit > 0 ? KRW(capacity / perUnit) : 0;

  const candidates = [
    { key: 'ltv', label: `LTV ${Math.round(ltvRate * 100)}%`, amount: byLtv },
    { key: 'amountCap', label: '주택가격대별 총액 상한', amount: byAmountCap },
    { key: 'dsr', label: `DSR ${Math.round(L.dsrCap * 100)}% (스트레스 ${(stress * 100).toFixed(2)}%)`, amount: byDsr },
  ];
  const binding = candidates.reduce((a, b) => (b.amount < a.amount ? b : a));

  return {
    limit: binding.amount, binding: binding.key, bindingLabel: binding.label, candidates,
    stressRate: stress, ltvRate,
    warnings: [warnOf(rules, 'loan')].filter(Boolean),
  };
}

// ── 보유 ────────────────────────────────────────────────────────────────────

/** 재산세 한 해분 (본세 + 도시지역분 + 지방교육세) */
export function propertyTax({ publicPrice, oneHouse = true }, rules) {
  const r = rules.rules.propertyTax;
  const pp = num(publicPrice);
  const ratio = oneHouse ? bracketOf(r.fairRatioOneHouse, pp).ratio : r.fairRatio;
  const base = pp * ratio;
  const special = oneHouse && pp <= r.oneHouseSpecialMaxPublicPrice;
  const table = special ? r.oneHouseBrackets : r.standardBrackets;
  const b = bracketOf(table, base);
  const main = Math.max(0, KRW(base * b.rate - b.deduct));
  const urban = KRW(base * r.urbanAreaRate);
  const edu = KRW(main * r.localEducationTaxRate);
  return {
    publicPrice: pp, fairRatio: ratio, taxBase: KRW(base), specialRate: special,
    main, urban, edu, total: main + urban + edu,
    note: r.capNotModeled,
  };
}

/** 종합부동산세 한 해분 (+ 농특세) */
export function comprehensiveTax({ publicPrice, oneHouse = true, soleOwner = true }, rules) {
  const r = rules.rules.comprehensiveTax;
  const pp = num(publicPrice);
  const deduction = oneHouse && soleOwner ? r.oneHouseDeduction : r.basicDeduction;
  const base = Math.max(0, pp - deduction) * r.fairRatio;
  const main = KRW(marginalTax(r.brackets, base));
  const rural = KRW(main * r.ruralTaxRate);
  return { publicPrice: pp, deduction, taxBase: KRW(base), main, rural, total: main + rural, note: r.notModeled };
}

/**
 * 가지고 있는 동안 해마다 나가는 돈.
 * publicPriceRatio: 공시가격 ÷ 시세 (모르면 0.7 가정)
 */
export function holdingCost(input, rules) {
  const years = Math.max(1, Math.round(num(input.years, 5)));
  const oneHouse = input.houses == null ? true : num(input.houses, 1) <= 1;
  const growth = num(input.publicPriceGrowth, 0);
  const rows = [];
  const warnings = [warnOf(rules, 'comprehensiveTax')].filter(Boolean);

  for (let y = 1; y <= years; y++) {
    const pp = num(input.publicPrice) * Math.pow(1 + growth, y - 1);
    const pt = propertyTax({ publicPrice: pp, oneHouse }, rules);
    const ct = comprehensiveTax({ publicPrice: pp, oneHouse, soleOwner: input.soleOwner !== false }, rules);
    const maintenance = KRW(num(input.monthlyMaintenance) * 12);
    rows.push({
      year: y, publicPrice: KRW(pp),
      propertyTax: pt.total, comprehensiveTax: ct.total, maintenance,
      total: pt.total + ct.total + maintenance,
    });
  }
  return {
    years, rows,
    total: rows.reduce((s, r) => s + r.total, 0),
    firstYear: rows[0],
    note: '세부담상한·세액공제를 넣지 않았으므로 실제 고지액은 이 값보다 낮을 수 있습니다.',
    warnings,
  };
}

// ── 처분 ────────────────────────────────────────────────────────────────────

/** 장기보유특별공제율 */
export function longHoldRate({ holdYears, liveYears = 0, oneHouse = false }, rules) {
  const r = rules.rules.capitalGainsTax;
  const g = r.longHoldGeneral, o = r.longHoldOneHouse;
  if (holdYears < g.minYears) return 0;
  if (oneHouse && liveYears >= o.requiresLiveYears) {
    return Math.min(o.holdMax, Math.floor(holdYears) * o.holdPerYear)
      + Math.min(o.liveMax, Math.floor(liveYears) * o.livePerYear);
  }
  return Math.min(g.max, Math.floor(holdYears) * g.perYear);
}

/**
 * 팔 때 내는 세금. 1세대1주택 12억 비과세·고가주택 안분·장특공제·단기중과를 반영합니다.
 * @param {{buyPrice:number, sellPrice:number, holdYears:number, liveYears?:number,
 *          houses?:number, acquisitionCosts?:number, sellCosts?:number, improveCosts?:number}} input
 */
export function capitalGainsTax(input, rules) {
  const r = rules.rules.capitalGainsTax;
  const buy = num(input.buyPrice), sell = num(input.sellPrice);
  const holdYears = num(input.holdYears), liveYears = num(input.liveYears, 0);
  const houses = Math.max(1, num(input.houses, 1));
  const oneHouse = houses === 1;
  const costs = num(input.acquisitionCosts) + num(input.sellCosts) + num(input.improveCosts);
  const warnings = [warnOf(rules, 'capitalGainsTax')].filter(Boolean);
  if (houses >= 2) warnings.push(warnOf(rules, 'capitalGainsHeavy'));

  const gain = sell - buy - costs;
  const exemptPrice = r.oneHouseExemptPrice;
  const qualifies = oneHouse && holdYears >= r.oneHouseMinHoldYears;

  if (gain <= 0) {
    return { gain: KRW(gain), taxableGain: 0, longHoldRate: 0, taxBase: 0, tax: 0, localTax: 0, total: 0, exempt: false, reason: '양도차익이 없습니다', net: KRW(sell - costs), warnings };
  }
  if (qualifies && sell <= exemptPrice) {
    return { gain: KRW(gain), taxableGain: 0, longHoldRate: 0, taxBase: 0, tax: 0, localTax: 0, total: 0, exempt: true, reason: '1세대1주택 2년 이상 보유 · 양도가 12억 이하 비과세', net: KRW(sell - costs), warnings };
  }

  const taxableGain = qualifies ? gain * ((sell - exemptPrice) / sell) : gain;
  const lh = longHoldRate({ holdYears, liveYears, oneHouse: qualifies }, rules);
  const base = Math.max(0, taxableGain * (1 - lh) - r.basicDeduction);

  const bb = bracketOf(r.baseBrackets, base);
  let tax = Math.max(0, base * bb.rate - bb.deduct);
  let applied = `기본세율 ${Math.round(bb.rate * 100)}%`;
  const short = r.shortTermRates.find(s => holdYears < s.underYears);
  if (short) {
    const shortTax = base * short.rate;
    if (shortTax > tax) { tax = shortTax; applied = `단기보유 ${Math.round(short.rate * 100)}%`; }
  }
  if (houses >= 2) {
    const h = rules.rules.capitalGainsHeavy;
    const add = houses >= 3 ? h.surcharge3House : h.surcharge2House;
    tax += base * add;
    applied += ` + 다주택 중과 ${Math.round(add * 100)}%p(불확실)`;
  }

  const localTax = KRW(tax * r.localIncomeTaxRate);
  return {
    gain: KRW(gain), taxableGain: KRW(taxableGain), longHoldRate: lh, taxBase: KRW(base),
    tax: KRW(tax), localTax, total: KRW(tax) + localTax, exempt: false, appliedRate: applied,
    net: KRW(sell - costs - KRW(tax) - localTax), warnings,
  };
}

// ── 전체 계획 ───────────────────────────────────────────────────────────────

/**
 * 사실(취득·대출·보유)만 계산합니다. 미래 가격은 여기 들어오지 않습니다.
 * @param {object} input 아래 scenarios 의 input 과 같습니다.
 */
export function plan(input, rules, today = rules.asOf) {
  const price = num(input.price);
  const acq = acquisitionCost(input, rules);
  const limit = loanLimit(input, rules);
  const wanted = input.loanAmount == null ? Math.max(0, price - num(input.cash)) : num(input.loanAmount);
  const loanAmount = Math.min(wanted, limit.limit);
  const shortfall = Math.max(0, wanted - limit.limit);

  const loan = amortize({
    principal: loanAmount, annualRate: num(input.annualRate), years: num(input.years, 30),
    method: input.method || 'equal', graceYears: num(input.graceYears),
  });
  const hold = holdingCost({
    ...input,
    publicPrice: input.publicPrice != null ? num(input.publicPrice) : price * num(input.publicPriceRatio, 0.7),
    years: num(input.holdYears, 5),
  }, rules);

  const age = rulesAge(rules, today);
  const warnings = [...acq.warnings, ...limit.warnings, ...hold.warnings];
  if (age.stale) {
    warnings.push({ rule: 'rules', label: '규칙집', confidence: 'uncertain', message: `규칙집 기준일(${age.asOf})이 ${age.days}일 지났습니다. 세법·대출규제가 바뀌었을 수 있으니 data/finance-rules.json 을 갱신하십시오.` });
  }
  if (shortfall > 0) {
    warnings.push({ rule: 'loan', label: '자금', confidence: 'confirmed', message: `필요한 대출(${Math.round(wanted / 1e8 * 10) / 10}억)이 한도(${Math.round(limit.limit / 1e8 * 10) / 10}억)를 넘습니다. ${limit.bindingLabel}에 걸립니다.` });
  }

  const cashNeeded = price + acq.total - loanAmount;
  const yearlyLoan = loan.byYear.slice(0, hold.years);
  const yearlyOut = hold.rows.map((h, i) => ({
    year: h.year,
    loan: yearlyLoan[i] ? yearlyLoan[i].payment : 0,
    holding: h.total,
    total: (yearlyLoan[i] ? yearlyLoan[i].payment : 0) + h.total,
  }));

  return {
    rules: { version: rules.version, asOf: rules.asOf, ageDays: age.days, stale: age.stale },
    notice: rules.notice,
    input: { price, cash: num(input.cash), holdYears: hold.years },
    acquisition: acq,
    loanLimit: limit,
    loan: { ...loan, requested: KRW(wanted), shortfall: KRW(shortfall), months: undefined },
    holding: hold,
    cashNeeded: KRW(cashNeeded),
    cashShort: KRW(Math.max(0, cashNeeded - num(input.cash))),
    yearly: yearlyOut,
    outflowDuringHold: yearlyOut.reduce((s, y) => s + y.total, 0),
    warnings: warnings.filter(Boolean),
  };
}

/**
 * **여기서부터는 전부 가정입니다.** 가격이 해마다 얼마씩 움직인다고 *치면* 어떻게 되는지만 봅니다.
 * 진가는 미래 가격을 예측하지 않습니다 — 세 갈래를 나란히 놓고 보여 줄 뿐입니다.
 */
export const DEFAULT_SCENARIOS = [
  { key: 'down', label: '내릴 때', yearlyGrowth: -0.02 },
  { key: 'flat', label: '그대로일 때', yearlyGrowth: 0 },
  { key: 'up', label: '오를 때', yearlyGrowth: 0.03 },
];

export function scenarios(input, rules, list = DEFAULT_SCENARIOS, today = rules.asOf) {
  const base = plan(input, rules, today);
  const years = base.input.holdYears;
  const price = base.input.price;
  const sellCostRate = num(input.sellBrokerageRate, null);

  const cases = list.map(s => {
    const sellPrice = KRW(price * Math.pow(1 + s.yearlyGrowth, years));
    const sellCosts = sellCostRate != null ? KRW(sellPrice * sellCostRate) : KRW(brokerageFee(sellPrice, rules) * (1 + rules.rules.brokerage.vatRate));
    const cgt = capitalGainsTax({
      buyPrice: price, sellPrice, holdYears: years,
      liveYears: num(input.liveYears, input.lives === false ? 0 : years),
      houses: num(input.houses, 1),
      acquisitionCosts: base.acquisition.total, sellCosts,
      improveCosts: num(input.improveCosts),
    }, rules);

    const balance = base.loan.byYear[years - 1] ? base.loan.byYear[years - 1].balance : base.loan.principal;
    const proceeds = sellPrice - sellCosts - cgt.total - balance;
    const invested = base.cashNeeded + base.outflowDuringHold;
    const profit = proceeds - invested;
    return {
      key: s.key, label: s.label, assumed: true, yearlyGrowth: s.yearlyGrowth,
      sellPrice, sellCosts, capitalGains: cgt, loanBalance: balance,
      proceeds: KRW(proceeds), invested: KRW(invested), profit: KRW(profit),
      returnOnCash: invested > 0 ? Math.round((profit / invested) * 1000) / 1000 : null,
    };
  });

  return {
    assumed: true,
    disclaimer: '아래 가격은 **예측이 아니라 가정**입니다. 진가는 미래 가격을 맞히지 않습니다. 세 갈래를 나란히 두고 "이렇게 움직이면 이렇게 된다"만 보여 줍니다.',
    base, years, cases,
    warnings: [...base.warnings, ...(cases[0] ? cases[0].capitalGains.warnings : [])].filter(Boolean),
  };
}
