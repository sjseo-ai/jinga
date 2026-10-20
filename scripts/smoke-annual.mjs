// 연간 누적 기록(api/_annual.mjs) 스모크 테스트 — 네트워크 없음
import test from 'node:test';
import assert from 'node:assert/strict';
import { updateAnnual, annualAreaView, complexYearView, complexTrend, yearOfAsOf, annualPath } from '../site/public/api/_annual.mjs';

const map = (seoul, gangdong, godeok) => ({ seoul: { avgPerPyeong: seoul }, gu: { 강동구: { avgPerPyeong: gangdong, dongs: [{ name: '고덕동', avgPerPyeong: godeok }] } } });
const cx = price => [{ id: 7, name: '고덕그라시움', gu: '강동구', dong: '고덕동', types: [
  { excl: 84.97, price, jeonse: Math.round(price * 0.5), provided: true },
  { excl: 59.98, price: price - 30000, jeonse: 50000, provided: true },
  { excl: 114, price: 0, jeonse: 0, provided: false },
] }];

test('연간 기록: 주마다 쌓고 같은 기준일은 한 번만, 늦게 들어온 과거 주도 첫 주로', () => {
  assert.equal(yearOfAsOf('2026.09.11'), 2026);
  assert.equal(yearOfAsOf(''), null);
  assert.equal(annualPath(2026), 'annual/2026.json');

  let rec = updateAnnual(null, { asOf: '2026.09.11', map: map(6000, 5000, 6400), complexes: cx(200000) });
  assert.deepEqual(rec.weeks, ['2026.09.11']);
  assert.equal(rec.complexes[7].first.t.length, 2, '시세 미제공 주택형 제외');
  assert.equal(updateAnnual(rec, { asOf: '2026.09.11', map: map(1, 1, 1) }), rec, '같은 기준일은 그대로(저장 안 함)');

  rec = updateAnnual(rec, { asOf: '2026.09.18', map: map(6060, 5100, 6528), complexes: cx(204000) });
  rec = updateAnnual(rec, { asOf: '2026.09.04', map: map(5940, 4950, 6336), complexes: cx(198000) });   // 과거 주가 나중에 들어옴
  assert.deepEqual(rec.weeks, ['2026.09.04', '2026.09.11', '2026.09.18']);
  const v = annualAreaView(rec);
  assert.equal(v.seoul.first.asOf, '2026.09.04');
  assert.equal(v.seoul.last.asOf, '2026.09.18');
  assert.equal(v.seoul.avg, 6000);
  assert.equal(v.gu['강동구'].pct, 3.03, '(5100 / 4950 − 1)');
  assert.equal(v.gu['강동구'].dongs['고덕동'].weeks, 3);

  const c = complexYearView(rec, 7);
  assert.deepEqual([c.first, c.last], ['2026.09.04', '2026.09.18']);
  const big = c.types.find(t => Math.round(t.excl) === 85);
  assert.deepEqual([big.firstPrice, big.price, big.pct], [198000, 204000, 3.03]);
  assert.equal(complexYearView(rec, 999), null);

  const next = updateAnnual(rec, { asOf: '2027.01.08', map: map(6100, 5200, 6600), complexes: cx(210000) });
  assert.equal(next.year, 2027, '해가 바뀌면 새 기록');
  assert.deepEqual(next.weeks, ['2027.01.08']);
  assert.equal(rec.weeks.length, 3, '지난해 기록은 그대로');
});

test('단지 연도별 흐름: 작년 연말 대비 올해 최신 시세', () => {
  let y26 = updateAnnual(null, { asOf: '2026.01.02', map: map(1, 1, 1), complexes: cx(190000) });
  y26 = updateAnnual(y26, { asOf: '2026.12.25', map: map(1, 1, 1), complexes: cx(200000) });
  const y27 = updateAnnual(null, { asOf: '2027.03.05', map: map(1, 1, 1), complexes: cx(210000) });
  const trend = complexTrend({ 2026: complexYearView(y26, 7), 2027: complexYearView(y27, 7) }, 84.5);
  assert.equal(trend.years[2026].pct, 5.26, '2026년 안의 변동(19억 → 20억)');
  assert.equal(trend.sinceLastYearEnd, 5, '2027년 최신 21억 ÷ 2026년 연말 20억');
  assert.equal(complexTrend({ 2027: complexYearView(y27, 7) }, 85).sinceLastYearEnd, null, '작년 기록이 없으면 계산 안 함');
});
