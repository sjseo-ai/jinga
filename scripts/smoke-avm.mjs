// J-AVM v1(scripts/_avm.mjs) 스모크 테스트 — 네트워크 없이, 만들어 둔 거래로만 시험합니다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex, buildFloorIndex, timeFactor, pickComparables, gradeOf, estimate, describe, ymOf, monthsBetween, floorBand, floorFactor, PYEONG } from './_avm.mjs';

/** 거래 한 건 만들기 — 평당가는 금액·면적에서 자동 계산 */
const t = (over = {}) => {
  const o = { seq: 'A', gu: '강동구', date: '2026-10-15', amount: 60000, area: 84.9, ...over };
  return { ...o, perPyeong: Math.round(o.amount / (o.area / PYEONG)) };
};
/** 같은 값 n건 */
const many = (n, over = {}) => Array.from({ length: n }, (_, i) => t({ ...over, date: over.date || `2026-10-${String(i % 28 + 1).padStart(2, '0')}` }));

test('날짜 다루기', () => {
  assert.equal(ymOf('2026-10-15'), '202610');
  assert.equal(monthsBetween('202604', '202610'), 6);
  assert.equal(monthsBetween('202610', '202604'), -6, '미래 거래는 음수로 나와 걸러집니다');
});

test('비슷한 면적만 고른다 — 같은 단지·기준월 이전', () => {
  const trades = [
    t({ area: 84.9 }), t({ area: 80.0 }), t({ area: 59.9 }),            // 59㎡ 는 ±10% 밖
    t({ area: 84.9, seq: 'B' }),                                        // 다른 단지
    t({ area: 84.9, date: '2026-12-01' }),                              // 기준월보다 미래
    t({ area: 84.9, date: '2025-01-05' }),                              // 12개월보다 오래
  ];
  const got = pickComparables(trades, { seq: 'A', area: 84.9, asOfYM: '202610' });
  assert.equal(got.length, 2, '같은 단지·면적 ±10%·기준월 이전 12개월만');
});

test('시점 보정 — 지수가 없으면 보정하지 않고 그렇다고 알린다', () => {
  const trades = [...many(12, { date: '2026-04-10', amount: 50000 }), ...many(12, { date: '2026-10-10', amount: 60000 })];
  const idx = buildIndex(trades);
  const up = timeFactor(idx, '강동구', '202604', '202610');
  assert.equal(up.adjusted, true);
  assert.ok(up.f > 1.1 && up.f < 1.3, `4월→10월 상승분이 반영되어야 함 (${up.f})`);

  // 지수를 만들 만큼 거래가 없는 달
  const thin = buildIndex([...many(3, { date: '2026-04-10' }), ...many(12, { date: '2026-10-10' })]);
  const no = timeFactor(thin, '강동구', '202604', '202610');
  assert.deepEqual([no.f, no.adjusted], [1, false], '표본이 적은 달은 지수를 쓰지 않습니다');

  // 달 사이가 30% 넘게 벌어지면 시세가 아니라 표본이 바뀐 것으로 봅니다
  const wild = buildIndex([...many(12, { date: '2026-04-10', amount: 30000 }), ...many(12, { date: '2026-10-10', amount: 90000 })]);
  assert.equal(timeFactor(wild, '강동구', '202604', '202610').adjusted, false);
});

// 등급은 **백테스트로 잰 오차**에 맞춰 둡니다 — 표본 수가 아니라 「얼마나 최근 거래로 맞췄나」입니다.
// 표본 수를 등급에 넣어 봤더니 정확도를 설명하지 못했습니다(3~4건 4.8% · 5~9건 4.0% · 10건 이상 4.5%).
test('등급 — 쓴 창의 길이로 매긴다', () => {
  assert.equal(gradeOf(20, 1, 3), 'A', '3개월 안에 모였으면 A (실측 3.9%)');
  assert.equal(gradeOf(3, 1, 3), 'A', '건수가 적어도 최근이면 A — 건수는 등급에 넣지 않습니다');
  assert.equal(gradeOf(20, 1, 6), 'B', '6개월까지 넓혔으면 B (4.4%)');
  assert.equal(gradeOf(20, 1, 12), 'C', '12개월까지 넓혔으면 C (5.0%)');
  assert.equal(gradeOf(2, 1, 3), 'D', '비교 거래가 3건 미만이면 값을 내지 않습니다');
  assert.equal(gradeOf(0, 1, 3), 'none');
});
// **가장 중요한 약속** — 표본이 적으면 한 값을 찍지 않습니다.
test('거래가 적으면 대표값을 내놓지 않는다', () => {
  const trades = [t({ amount: 55000 }), t({ amount: 65000, date: '2026-09-10' })];
  const e = estimate(trades, buildIndex(trades), { seq: 'A', area: 84.9, asOfYM: '202610' });
  assert.equal(e.grade, 'D');
  assert.equal(e.perPyeong, null, '2건으로 한 값을 적지 않습니다');
  assert.equal(e.amount, null);
  assert.ok(e.low > 0 && e.high > e.low, '대신 범위는 보여 줍니다');
  assert.match(describe(e), /범위만/);
});

test('거래가 하나도 없으면 보류한다', () => {
  const e = estimate([t({ seq: 'B' })], buildIndex([]), { seq: 'A', area: 84.9, asOfYM: '202610' });
  assert.deepEqual([e.grade, e.perPyeong, e.n], ['none', null, 0]);
  assert.match(e.reason, /거래가 없습니다/);
  assert.match(describe(e), /추정 보류/);
});

test('거래가 넉넉하면 중앙값과 사분위 범위를 낸다', () => {
  const amounts = [56000, 58000, 60000, 60000, 61000, 62000, 64000, 90000, 59000, 60500];  // 90000 은 특이 거래
  const trades = amounts.map((a, i) => t({ amount: a, date: `2026-10-${String(i + 1).padStart(2, '0')}` }));
  const e = estimate(trades, buildIndex(trades), { seq: 'A', area: 84.9, asOfYM: '202610' });
  assert.equal(e.grade, 'A');
  assert.equal(e.n, 10);
  // 평균이면 90000 에 끌려가지만 중앙값은 버팁니다
  const mean = Math.round(amounts.reduce((s, a) => s + a, 0) / amounts.length / (84.9 / PYEONG));
  assert.ok(e.perPyeong < mean, `중앙값(${e.perPyeong})이 평균(${mean})보다 낮아야 — 특이 거래에 끌려가지 않음`);
  assert.ok(e.low < e.perPyeong && e.perPyeong < e.high, '범위 안에 대표값이 있어야');
  assert.equal(e.amount, Math.round(e.perPyeong * (84.9 / PYEONG)));
});

test('같은 입력이면 같은 값 — 재현 가능해야 한다', () => {
  const trades = many(8, { amount: 60000 }).map((x, i) => ({ ...x, amount: 58000 + i * 500, perPyeong: Math.round((58000 + i * 500) / (84.9 / PYEONG)) }));
  const idx = buildIndex(trades);
  const a = estimate(trades, idx, { seq: 'A', area: 84.9, asOfYM: '202610' });
  const b = estimate(trades, idx, { seq: 'A', area: 84.9, asOfYM: '202610' });
  assert.deepEqual(a, b);
});

// 백테스트에서 나온 결론을 코드가 지키는지 — 창을 넓혔으면 **오래된 거래를 섞지 않습니다.**
test('창을 넓히면 최근 것만 쓴다', () => {
  // 3개월 안에는 1건뿐, 그 앞에 오래된 싼 거래가 여럿 — 12개월까지 넓혀야 하는 상황
  const trades = [
    t({ amount: 70000, date: '2026-10-05' }),
    t({ amount: 50000, date: '2026-01-10' }), t({ amount: 51000, date: '2026-02-10' }), t({ amount: 52000, date: '2026-03-10' }),
  ];
  const e = estimate(trades, buildIndex(trades), { seq: 'A', area: 84.9, asOfYM: '202610' });
  assert.equal(e.window, 12, '3·6개월에 3건이 없으면 12개월까지 넓힙니다');
  assert.equal(e.grade, 'C', '넓혔으면 등급을 낮춥니다');
  assert.equal(e.usedN, 1, '12개월 창에서는 가장 최근 한 건만 — 1년 전 거래와 섞으면 뒤처집니다');
  assert.equal(e.n, 4, '찾은 거래 수는 그대로 알려 줍니다');
  const latest = Math.round(70000 / (84.9 / PYEONG));
  assert.equal(e.perPyeong, latest, '옛 거래에 끌려가지 않아야');
});

// 범위가 좁으면 범위라고 부를 수 없습니다. 처음 사분위 범위는 실제 거래의 37% 만 담았습니다.
test('범위는 등급별 폭 아래로 좁아지지 않는다', () => {
  const trades = many(6, { amount: 60000 });   // 전부 같은 값 → 사분위 범위는 0
  const e = estimate(trades, buildIndex(trades), { seq: 'A', area: 84.9, asOfYM: '202610' });
  assert.equal(e.grade, 'A');
  const w = (e.high - e.low) / 2 / e.perPyeong;
  assert.ok(w >= 0.079, `A 등급은 최소 ±8% (지금 ±${(w * 100).toFixed(1)}%)`);
});

// ── 층 보정 (v3 · 계획서 T007) ──────────────────────────────────────────────
// 배수 자체는 `scripts/exp-floor.mjs` 로 실거래에서 측정했습니다. 여기서는 **측정값이 아니라
// 쓰는 방식**을 시험합니다 — 모르면 보정하지 않는지, 중층 기준인지, 1층이 끌어내리지 않는지.

test('층대는 절대 층수가 아니라 상대 위치로 나눈다', () => {
  assert.equal(floorBand(1, 30), '1층', '1층은 몇 층 건물이든 1층');
  assert.equal(floorBand(2, 30), '2층');
  assert.equal(floorBand(5, 30), '저층');
  assert.equal(floorBand(15, 30), '중층');
  assert.equal(floorBand(25, 30), '고층');
  assert.equal(floorBand(30, 30), '탑층');
  // 5층 빌라의 4층은 「고층」, 30층 아파트의 4층은 「저층」 — 같은 4층이 다르게 읽혀야 합니다
  assert.equal(floorBand(4, 5), '고층');
  assert.equal(floorBand(4, 30), '저층');
});

test('층을 모르면 보정하지 않는다', () => {
  assert.equal(floorFactor(0, 30), 1, '층이 없는 거래');
  assert.equal(floorFactor(null, 30), 1);
  assert.equal(floorFactor(15, 0), 1, '최고층을 모르면 상대 위치를 알 수 없습니다');
  assert.equal(floorBand(15, 0), '모름');
});

test('저층 거래만 있던 단지를 중층 기준으로 끌어올린다', () => {
  // 중앙값은 **1층 한 건쯤은 이미 걸러냅니다**(그래서 평균이 아니라 중앙값을 씁니다).
  // 보정이 실제로 듣는 자리는 최근 거래가 **저층에 몰린** 단지입니다 — 그 단지가 통째로 싸 보입니다.
  const mid = 60000;
  const trades = [
    t({ amount: Math.round(mid * 0.938), floor: 1, date: '2026-10-20' }),
    t({ amount: Math.round(mid * 0.938), floor: 1, date: '2026-10-12' }),
    t({ amount: Math.round(mid * 0.971), floor: 2, date: '2026-10-05' }),
    t({ area: 59.9, floor: 30, date: '2026-10-02' }),   // 최고층 30층만 알려 주는 다른 면적 거래
  ];
  const floors = buildFloorIndex(trades);
  assert.equal(floors.get('A'), 30, '면적이 달라도 같은 단지면 최고층 추정에 씁니다');

  const e = estimate(trades, buildIndex(trades), { seq: 'A', area: 84.9, asOfYM: '202610', floors });
  assert.equal(e.floorBasis, '중층', '층을 안 주면 중층 기준으로 냅니다');
  assert.equal(e.floorAdjustedN, 3, '세 건 모두 보정 대상');

  const noFloor = estimate(trades.map(x => ({ ...x, floor: 0 })), buildIndex(trades), { seq: 'A', area: 84.9, asOfYM: '202610' });
  assert.ok(e.perPyeong > noFloor.perPyeong, `보정 ${e.perPyeong} > 미보정 ${noFloor.perPyeong}`);
  // 보정 후 중앙값은 중층 수준(60,000만원 상당)에 붙어야 합니다
  const expected = Math.round(mid / (84.9 / PYEONG));
  assert.ok(Math.abs(e.perPyeong - expected) / expected < 0.01, `${e.perPyeong} ≈ ${expected}`);
});

test('층을 알려 주면 그 층 기준으로 되돌린다', () => {
  const trades = [...many(4, { floor: 15 }), t({ floor: 30, date: '2026-09-20' })];
  const floors = buildFloorIndex(trades);
  const idx = buildIndex(trades);
  const mid = estimate(trades, idx, { seq: 'A', area: 84.9, asOfYM: '202610', floors });
  const first = estimate(trades, idx, { seq: 'A', area: 84.9, asOfYM: '202610', floors, floor: 1 });

  assert.equal(first.floorBasis, '1층');
  assert.equal(first.floorFactor, 0.938);
  assert.ok(first.perPyeong < mid.perPyeong, '1층은 중층보다 싸게 나와야');
  // 범위도 같이 내려가야 합니다 — 값만 내리고 범위를 그대로 두면 범위가 거짓이 됩니다
  assert.ok(first.low < mid.low && first.high < mid.high);
  assert.equal(first.amount, Math.round(first.perPyeong * (84.9 / PYEONG)));
});
