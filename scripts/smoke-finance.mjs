// 대출·비용 및 시나리오 계산(T016) 스모크 테스트.
//
// 이 파일의 숫자는 **손으로 검산한 값**입니다. 엔진이 스스로 낸 값을 그대로 베껴 적으면
// 「계산기가 계산기와 같다」는 것밖에 증명하지 못합니다. 그래서 세 가지 중 하나로만 적었습니다.
//   (가) 세법 조문에서 직접 손계산한 값
//   (나) 외부 자료의 계산 예시와 맞아떨어진 값 (주석에 출처 표기)
//   (다) 수식으로 닫힌 형태가 나오는 값 (만기일시 총이자 = 원금×금리×연수 등)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  acquisitionRate, acquisitionCost, brokerageFee, monthlyPayment, amortize, loanLimit,
  propertyTax, comprehensiveTax, holdingCost, longHoldRate, capitalGainsTax, plan, scenarios, rulesAge,
} from './_finance.mjs';

const RULES = JSON.parse(readFileSync(new URL('../data/finance-rules.json', import.meta.url), 'utf8'));
const 억 = n => n * 100000000;
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} ≠ ${b} (허용 ±${tol})`);

// ── 규칙집 자체의 약속 ──────────────────────────────────────────────────────

test('규칙집은 버전·기준일·확신도를 빠짐없이 달고 있다', () => {
  assert.match(RULES.version, /^\d{4}\.\d{2}\.\d{2}$/);
  assert.match(RULES.asOf, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(RULES.notice.includes('자문이 아닙니다'), '주의문이 있어야 합니다');
  const levels = Object.keys(RULES.confidenceLegend);
  for (const [key, r] of Object.entries(RULES.rules)) {
    assert.ok(r.label, `${key}: 사람이 읽을 이름이 있어야`);
    assert.ok(levels.includes(r.confidence), `${key}: 확신도가 ${levels.join('/')} 중 하나여야`);
    // 확신도가 낮으면 **왜 못 믿는지**를 반드시 적어 둡니다. 경고 없는 추정이 제일 위험합니다.
    if (r.confidence !== 'confirmed') assert.ok(r.warn || r.note, `${key}: 확신도가 낮으면 경고문이 있어야`);
  }
});

test('규칙집이 묵으면 갱신 경고가 뜬다', () => {
  assert.equal(rulesAge(RULES, RULES.asOf).stale, false);
  const old = rulesAge(RULES, '2029-01-01');
  assert.ok(old.stale, '기준일이 한참 지나면 stale');
  assert.ok(old.days > 700);
});

// ── 취득 ────────────────────────────────────────────────────────────────────

test('취득세 — 6억 이하 1%, 9억 초과 3%, 그 사이는 누진', () => {
  assert.equal(acquisitionRate(억(5), RULES), 0.01);
  assert.equal(acquisitionRate(억(6), RULES), 0.01, '6억 이하는 포함');
  assert.equal(acquisitionRate(억(10), RULES), 0.03);
  // 7억 → 7×2/3−3 = 1.66667%, 8억 → 2.33333%
  near(acquisitionRate(억(7), RULES), 0.0166667, 1e-7, '7억 세율');
  near(acquisitionRate(억(8), RULES), 0.0233333, 1e-7, '8억 세율');
  assert.equal(acquisitionRate(억(9), RULES), 0.03, '9억은 정확히 3%로 이어집니다');
});

test('취득세 총액이 외부 계산 예시와 맞는다', () => {
  // 출처 예시: 6억·85㎡ 이하 1주택 = 660만원 / 9억·85㎡ 초과 = 3,150만원
  const a = acquisitionCost({ price: 억(6), areaM2: 84 }, RULES);
  const pick = (r, k) => r.items.find(i => i.key === k).amount;
  assert.equal(pick(a, 'acquisitionTax'), 6000000);
  assert.equal(pick(a, 'localEducationTax'), 600000);
  assert.equal(a.items.find(i => i.key === 'ruralTax'), undefined, '85㎡ 이하는 농특세 없음');

  const b = acquisitionCost({ price: 억(9), areaM2: 101 }, RULES);
  assert.equal(pick(b, 'acquisitionTax'), 27000000);
  assert.equal(pick(b, 'localEducationTax'), 2700000);
  assert.equal(pick(b, 'ruralTax'), 1800000);
  assert.equal(pick(b, 'acquisitionTax') + pick(b, 'localEducationTax') + pick(b, 'ruralTax'), 31500000);
});

test('중개보수 — 경계값은 위 구간으로 올라간다', () => {
  assert.equal(brokerageFee(억(5), RULES), 억(5) * 0.004);        // 2억~9억 미만 0.4%
  assert.equal(brokerageFee(억(9), RULES), 4500000);               // 9억 이상 0.5% = 450만
  assert.equal(brokerageFee(억(12), RULES), 7200000);              // 12억 이상 0.6% = 720만
  assert.equal(brokerageFee(억(15), RULES), 10500000);             // 15억 이상 0.7% = 1,050만
  assert.equal(brokerageFee(40000000, RULES), 240000);             // 5천만 미만 0.6%, 한도 25만 미달
  assert.equal(brokerageFee(190000000, RULES), 800000);            // 0.5% = 95만 → 한도 80만
});

test('다주택·생애최초는 계산하되 반드시 경고를 단다', () => {
  const heavy = acquisitionCost({ price: 억(10), areaM2: 84, houses: 3, adjusted: true }, RULES);
  assert.equal(heavy.rate, 0.12, '조정지역 3주택 이상 12%');
  assert.ok(heavy.warnings.some(w => w.rule === 'acquisitionTaxHeavy' && w.confidence === 'uncertain'));

  const notAdjusted = acquisitionCost({ price: 억(10), areaM2: 84, houses: 2 }, RULES);
  assert.equal(notAdjusted.rate, 0.03, '비조정지역은 표준세율로 두되');
  assert.ok(notAdjusted.warnings.some(w => w.message.includes('낮을 수 있습니다')), '낮게 나올 수 있다고 알립니다');

  const first = acquisitionCost({ price: 억(6), areaM2: 84, firstHome: true }, RULES);
  assert.equal(first.items.find(i => i.key === 'acquisitionTax').amount, 6000000 - 2000000);
  assert.ok(first.warnings.some(w => w.rule === 'firstHomeRelief'));
});

// ── 대출 ────────────────────────────────────────────────────────────────────

test('원리금균등 월 납입액이 금융 공식과 맞는다', () => {
  // 3억·연 4.0%·30년 → P·i/(1−(1+i)^−n).
  // 30년 4% 원리금균등은 원금 30만 단위마다 1,432.25 라는 널리 쓰이는 대조값이 있습니다.
  near(monthlyPayment(억(3), 0.04, 30), 1432246, 2, '3억 4% 30년');
  // 무이자면 원금을 개월수로 나눈 값
  assert.equal(monthlyPayment(12000000, 0, 10), 100000);
});

test('상환 방식별 총이자가 닫힌 수식과 맞는다', () => {
  const P = 억(3), r = 0.04, y = 30;
  // 만기일시: 잔액이 끝까지 그대로 → 총이자 = 원금 × 금리 × 연수
  const bullet = amortize({ principal: P, annualRate: r, years: y, method: 'bullet' });
  assert.equal(bullet.totalInterest, P * r * y);
  assert.equal(bullet.months[bullet.months.length - 1].balance, 0, '마지막 달에 원금을 갚습니다');

  // 원금균등: 총이자 = i × P × (n+1)/2
  const even = amortize({ principal: P, annualRate: r, years: y, method: 'principal' });
  near(even.totalInterest, (r / 12) * P * (361 / 2), 100, '원금균등 총이자');
  assert.ok(even.months[0].payment > even.months[359].payment, '갈수록 줄어듭니다');

  // 원리금균등: 매달 같은 금액, 총이자는 둘 사이
  const equal = amortize({ principal: P, annualRate: r, years: y, method: 'equal' });
  near(equal.months[0].payment, equal.months[200].payment, 2, '매달 같은 금액');
  assert.ok(equal.totalInterest > even.totalInterest && equal.totalInterest < bullet.totalInterest);
  assert.equal(equal.months[equal.months.length - 1].balance, 0, '다 갚고 끝납니다');
  assert.equal(equal.byYear.length, 30);
});

test('거치기간에는 이자만 낸다', () => {
  const g = amortize({ principal: 억(3), annualRate: 0.04, years: 30, method: 'equal', graceYears: 3 });
  assert.equal(g.months[0].principal, 0);
  assert.equal(g.months[35].balance, 억(3), '3년 동안 원금이 그대로');
  assert.ok(g.months[36].principal > 0, '거치가 끝나면 원금을 갚기 시작');
  assert.equal(g.months[g.months.length - 1].balance, 0);
});

test('대출 한도는 LTV·총액상한·DSR 중 가장 작은 것', () => {
  // 12억 규제지역, 연소득 1억 → LTV 40% = 4.8억이 제일 빡빡합니다
  const a = loanLimit({ price: 억(12), annualIncome: 억(1), annualRate: 0.04, years: 30, regulated: true }, RULES);
  assert.equal(a.binding, 'ltv');
  assert.equal(a.limit, 억(4.8));

  // 같은 집, 소득이 3천만이면 DSR 에 먼저 걸립니다
  const b = loanLimit({ price: 억(12), annualIncome: 30000000, annualRate: 0.04, years: 30, regulated: true }, RULES);
  assert.equal(b.binding, 'dsr');
  assert.ok(b.limit < 억(2.5), `DSR 한도 ${b.limit}`);

  // 20억·비규제·고소득이면 총액 상한(4억)이 묶습니다
  const c = loanLimit({ price: 억(20), annualIncome: 억(3), annualRate: 0.04, years: 30 }, RULES);
  assert.equal(c.binding, 'amountCap');
  assert.equal(c.limit, 억(4));

  assert.ok(a.stressRate > 0.04, '스트레스 금리는 실제 금리보다 높습니다');
  assert.ok(a.warnings.some(w => w.rule === 'loan'), 'LTV·스트레스DSR 은 출처가 엇갈려 경고가 붙습니다');
});

// ── 보유 ────────────────────────────────────────────────────────────────────

test('재산세가 외부 계산 예시와 원 단위까지 맞는다', () => {
  // 출처 예시: 공시 3억 1세대1주택 → 본세 99,000 · 도시지역분 180,600 · 지방교육세 19,800 = 299,400원
  const t = propertyTax({ publicPrice: 억(3), oneHouse: true }, RULES);
  assert.equal(t.fairRatio, 0.43);
  assert.equal(t.taxBase, 129000000);
  assert.equal(t.main, 99000);
  assert.equal(t.urban, 180600);
  assert.equal(t.edu, 19800);
  assert.equal(t.total, 299400);
  assert.equal(t.specialRate, true);
});

test('재산세 — 1주택 특례는 공시 9억을 넘으면 사라진다', () => {
  const under = propertyTax({ publicPrice: 억(8), oneHouse: true }, RULES);
  const over = propertyTax({ publicPrice: 억(10), oneHouse: true }, RULES);
  assert.equal(under.specialRate, true);
  assert.equal(over.specialRate, false, '9억 초과는 표준세율');
  // 공시 8억 1주택: 과표 8억×45% = 3.6억 → 3억 초과 특례 0.35%, 누진공제 63만
  assert.equal(under.taxBase, 360000000);
  assert.equal(under.main, Math.round(360000000 * 0.0035 - 630000)); // 630,000
  const multi = propertyTax({ publicPrice: 억(8), oneHouse: false }, RULES);
  assert.equal(multi.fairRatio, 0.6, '1주택이 아니면 공정시장가액비율 60%');
  assert.ok(multi.total > under.total);
});

test('종부세 — 1주택은 공시 12억까지 0원', () => {
  assert.equal(comprehensiveTax({ publicPrice: 억(11), oneHouse: true }, RULES).total, 0);
  // 공시 15억 1주택 단독: (15억−12억)×60% = 1.8억 → 0.5% = 90만, 농특세 20% = 18만
  const t = comprehensiveTax({ publicPrice: 억(15), oneHouse: true }, RULES);
  assert.equal(t.taxBase, 180000000);
  assert.equal(t.main, 900000);
  assert.equal(t.rural, 180000);
  assert.equal(t.total, 1080000);
  // 1주택이 아니면 공제가 9억으로 줄어 세금이 커집니다
  assert.ok(comprehensiveTax({ publicPrice: 억(15), oneHouse: false }, RULES).total > t.total);
});

test('보유비용은 해마다 쌓이고, 빠뜨린 공제를 밝힌다', () => {
  const h = holdingCost({ publicPrice: 억(9), years: 5, monthlyMaintenance: 300000 }, RULES);
  assert.equal(h.rows.length, 5);
  assert.equal(h.rows[0].maintenance, 3600000);
  assert.equal(h.total, h.rows.reduce((s, r) => s + r.total, 0));
  assert.ok(h.note.includes('낮을 수 있습니다'), '실제보다 세게 잡았다고 밝힙니다');

  // 공시가가 오른다고 가정하면 보유세도 같이 오릅니다
  const g = holdingCost({ publicPrice: 억(9), years: 5, publicPriceGrowth: 0.05 }, RULES);
  assert.ok(g.rows[4].propertyTax > g.rows[0].propertyTax);
  assert.equal(g.rows[0].publicPrice, 억(9), '첫해는 입력한 공시가격 그대로');
});

// ── 처분 ────────────────────────────────────────────────────────────────────

test('장기보유특별공제 — 1주택 거주분이 붙으면 최대 80%', () => {
  assert.equal(longHoldRate({ holdYears: 2 }, RULES), 0, '3년 미만은 공제 없음');
  assert.equal(longHoldRate({ holdYears: 10 }, RULES), 0.2, '일반 10년 = 연 2%');
  assert.equal(longHoldRate({ holdYears: 20 }, RULES), 0.3, '일반 상한 30%');
  assert.equal(longHoldRate({ holdYears: 5, liveYears: 5, oneHouse: true }, RULES), 0.4);
  assert.equal(longHoldRate({ holdYears: 10, liveYears: 10, oneHouse: true }, RULES), 0.8, '1주택 상한 80%');
  assert.equal(longHoldRate({ holdYears: 10, liveYears: 1, oneHouse: true }, RULES), 0.2, '2년 미만 거주면 일반 공제');
});

test('양도세 — 1세대1주택 12억 이하는 비과세', () => {
  const t = capitalGainsTax({ buyPrice: 억(8), sellPrice: 억(11), holdYears: 3, liveYears: 3 }, RULES);
  assert.equal(t.exempt, true);
  assert.equal(t.total, 0);
  assert.ok(t.reason.includes('비과세'));
  // 2년을 못 채우면 비과세가 아닙니다
  assert.equal(capitalGainsTax({ buyPrice: 억(8), sellPrice: 억(11), holdYears: 1.5 }, RULES).exempt, false);
});

test('양도세 — 고가주택 안분 계산이 손계산과 맞는다', () => {
  // 10억에 사서 15억에 팔고 5년 보유·거주, 비용 0
  //  차익 5억 → 과세분 5억×(15−12)/15 = 1억 → 장특 40% → 6천만 → 기본공제 250만 → 과표 5,750만
  //  5,750만 × 24% − 576만 = 804만, 지방소득세 80.4만 → 합계 884.4만
  const t = capitalGainsTax({ buyPrice: 억(10), sellPrice: 억(15), holdYears: 5, liveYears: 5 }, RULES);
  assert.equal(t.taxableGain, 억(1));
  assert.equal(t.longHoldRate, 0.4);
  assert.equal(t.taxBase, 57500000);
  assert.equal(t.tax, 8040000);
  assert.equal(t.localTax, 804000);
  assert.equal(t.total, 8844000);
});

test('양도세 — 1~2년 단기보유는 60%가 기본세율을 이긴다', () => {
  // 8억→9억, 1.5년, 비용 0 → 과표 1억−250만 = 9,750만
  //  기본세율 35%−1,544만 = 1,868.5만 vs 단기 60% = 5,850만 → 큰 쪽
  const t = capitalGainsTax({ buyPrice: 억(8), sellPrice: 억(9), holdYears: 1.5 }, RULES);
  assert.equal(t.taxBase, 97500000);
  assert.equal(t.tax, 58500000);
  assert.ok(t.appliedRate.includes('단기보유 60%'));
  assert.equal(t.total, 58500000 + 5850000);
});

test('양도차익이 없으면 세금도 없다', () => {
  const t = capitalGainsTax({ buyPrice: 억(10), sellPrice: 억(9), holdYears: 5 }, RULES);
  assert.equal(t.total, 0);
  assert.ok(t.gain < 0);
  assert.ok(t.reason.includes('양도차익이 없습니다'));
});

// ── 전체 계획 · 시나리오 ────────────────────────────────────────────────────

const CASE = {
  price: 억(12), areaM2: 84, cash: 억(7), annualIncome: 억(1), annualRate: 0.04,
  years: 30, method: 'equal', regulated: true, holdYears: 5, monthlyMaintenance: 250000,
};

test('계획은 사실만 — 미래 가격이 끼어들지 않는다', () => {
  const p = plan(CASE, RULES);
  const dump = JSON.stringify(p);
  assert.ok(!dump.includes('sellPrice'), '처분 가정이 섞이면 안 됩니다');
  assert.ok(!dump.includes('yearlyGrowth'), '상승률 가정이 섞이면 안 됩니다');
  assert.equal(p.rules.version, RULES.version, '어느 규칙으로 계산했는지 결과에 남깁니다');
  assert.equal(p.rules.asOf, RULES.asOf);
  assert.ok(p.notice.includes('자문이 아닙니다'));
});

test('계획 — 돈이 맞아떨어진다', () => {
  const p = plan(CASE, RULES);
  assert.equal(p.loanLimit.limit, 억(4.8), '규제지역 LTV 40%');
  assert.equal(p.loan.principal, 억(4.8), '필요한 5억보다 한도가 작아 한도까지만');
  assert.equal(p.loan.requested, 억(5));
  assert.equal(p.loan.shortfall, 억(0.2));
  // 필요한 현금 = 집값 + 취득비용 − 대출
  assert.equal(p.cashNeeded, 억(12) + p.acquisition.total - 억(4.8));
  assert.ok(p.cashShort > 0, '가진 현금 7억으로는 모자랍니다');
  assert.ok(p.warnings.some(w => w.message.includes('한도')), '한도 초과를 알립니다');
  assert.equal(p.yearly.length, 5);
  assert.equal(p.yearly[0].total, p.yearly[0].loan + p.yearly[0].holding);
  assert.equal(p.loan.months, undefined, '360줄짜리 월 스케줄은 요약에서 뺍니다');
});

test('시나리오는 전부 「가정」이라고 못박고 나온다', () => {
  const s = scenarios(CASE, RULES);
  assert.equal(s.assumed, true);
  assert.ok(s.disclaimer.includes('예측이 아니라 가정'));
  assert.equal(s.cases.length, 3);
  assert.ok(s.cases.every(c => c.assumed === true), '사례마다 가정 표시');
  const [down, flat, up] = s.cases;
  assert.ok(down.sellPrice < flat.sellPrice && flat.sellPrice < up.sellPrice);
  assert.equal(flat.sellPrice, 억(12), '그대로일 때는 산 가격 그대로');
  assert.ok(down.profit < up.profit);
  assert.equal(flat.capitalGains.exempt, false, '12억 초과라 비과세가 아닙니다');
});

test('시나리오 — 손에 남는 돈이 수식과 맞는다', () => {
  const s = scenarios(CASE, RULES);
  for (const c of s.cases) {
    assert.equal(c.proceeds, c.sellPrice - c.sellCosts - c.capitalGains.total - c.loanBalance);
    assert.equal(c.invested, s.base.cashNeeded + s.base.outflowDuringHold);
    assert.equal(c.profit, c.proceeds - c.invested);
  }
});

test('경고는 결과를 따라 끝까지 간다', () => {
  const s = scenarios({ ...CASE, houses: 2, adjusted: true }, RULES);
  const rules = s.warnings.map(w => w.rule);
  assert.ok(rules.includes('acquisitionTaxHeavy'), '다주택 취득세 경고');
  assert.ok(rules.includes('capitalGainsHeavy'), '다주택 양도세 경고');
  assert.ok(rules.includes('loan'), 'LTV·DSR 경고');
  assert.ok(s.warnings.every(w => w.message && w.label), '경고에는 이름과 이유가 있어야');
});
