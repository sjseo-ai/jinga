// 포트폴리오 평가·정기 모으기(jinga-port.mjs) 스모크 테스트 — 순수 계산만, 네트워크 없음
import test from 'node:test';
import assert from 'node:assert/strict';
import { valuate, simulate, scenarioReturns, upsideOf, bandOf, scheduleDates, priceAt, buildPortfolioSheets, CYCLES } from '../site/public/jinga-port.mjs';
import { buildXlsx } from '../site/public/xlsx-lite.mjs';

const FX = 1364.9;
const CARDS = [
  { s: '005930', n: '삼성전자', market: 'KR', analyzed: true, p: 100000, score: 69.2, fair: 120000, expUpside: 0.2, clamped: false, sec: '정보기술', forward: { basis: '증권사 컨센서스' } },
  { s: '000660', n: 'SK하이닉스', market: 'KR', analyzed: true, p: 200000, score: 63.5, fair: 500000, expUpside: 0.974, clamped: true, sec: '정보기술', forward: null },
  { s: 'MU', n: 'Micron Technology Inc.', market: 'US', analyzed: true, p: 100, score: 70, fair: null, expUpside: null, sec: '정보기술', forward: { basis: '나스닥', target: 120, targetLow: 90, targetHigh: 150 } },
  { s: '383310', n: '에코프로에이치엔', market: 'KR', analyzed: false, p: 50000, sec: '산업재', forward: null },
];

test('기대수익률 근거: 진가 적정가 → 애널리스트 목표가 → 없으면 제외', () => {
  assert.deepEqual(upsideOf(CARDS[0]), { v: 0.2, basis: '진가 적정가 대비' });
  assert.deepEqual(upsideOf(CARDS[1]), { v: null, basis: '적정가가 상한에 걸려 제외' }, '적정가 상한에 걸린 종목은 기대수익률에서 뺌');
  assert.deepEqual(upsideOf(CARDS[2]), { v: 0.2, basis: '애널리스트 목표가 대비' });
  assert.deepEqual(upsideOf(CARDS[3]), { v: null, basis: '적정가·목표가 없음' });
  assert.equal(upsideOf(null).v, null);
});

test('시나리오 폭: 목표가 상·하한이 있으면 그 절반, 없으면 시장 기본값', () => {
  assert.equal(bandOf(CARDS[2]), 0.3, '(150-90)/2/100');
  assert.equal(bandOf(CARDS[0]), 0.25, '국내 기본값');
  assert.equal(bandOf({ market: 'US' }), 0.2, '미국 기본값');
  const sc = scenarioReturns(CARDS[2]);
  assert.deepEqual([sc.bull, sc.base, sc.bear], [0.5, 0.2, -0.1]);
  assert.deepEqual(scenarioReturns(CARDS[3]).base, null);
});

test('보유 평가: 원화 환산·비중·손익 · 전망 없는 종목은 0%로 치지 않음', () => {
  const v = valuate({
    holdings: [
      { market: 'KR', s: '005930', qty: 100, avg: 80000 },
      { market: 'US', s: 'MU', qty: 10, avg: 80 },
      { market: 'KR', s: '383310', qty: 10, avg: 60000 },
      { market: 'KR', s: '005930', qty: 0, avg: 1 },        // 수량 0은 무시
    ],
    cards: CARDS, fx: FX,
  });
  assert.equal(v.rows.length, 3);
  const [ss, mu, eco] = v.rows;
  assert.equal(ss.value, 10000000);
  assert.equal(Math.round(mu.value), Math.round(10 * 100 * FX), '미국 종목은 원화 환산');
  assert.equal(v.total.value, Math.round(10000000 + 10 * 100 * FX + 500000));
  assert.equal(Math.round(v.total.cost), Math.round(8000000 + 10 * 80 * FX + 600000));
  assert.ok(v.total.plPct > 0);
  assert.equal(Math.round((ss.weight + mu.weight + eco.weight) * 100) / 100, 1);
  assert.equal(eco.base, null);
  assert.deepEqual(v.coverage.missing, ['에코프로에이치엔']);
  assert.ok(v.coverage.ratio > 0.9 && v.coverage.ratio < 1, '전망 없는 종목 비중만큼 빠짐');
  // 기대수익률은 전망 있는 종목(삼성전자 20% · 마이크론 20%)의 가중평균 = 20%
  assert.equal(v.scenarios.base, 0.2);
  assert.equal(v.expected.base, Math.round(v.total.value * 1.2));
});

test('회차 날짜: 일·주·월 주기(월은 말일 보정)', () => {
  assert.deepEqual(scheduleDates(new Date(2026, 8, 16), 'week', 3).map(d => d.getDate()), [16, 23, 30]);
  assert.deepEqual(scheduleDates(new Date(2026, 8, 16), 'day', 3).map(d => d.getDate()), [16, 17, 18]);
  const months = scheduleDates(new Date(2026, 0, 31), 'month', 3);
  assert.deepEqual(months.map(d => `${d.getMonth() + 1}-${d.getDate()}`), ['1-31', '2-28', '3-31'], '2월은 말일로');
  assert.equal(CYCLES.month.perYear, 12);
  assert.equal(Math.round(priceAt(100, 0.2, 365)), 120);
});

test('정기 모으기: 금액 기준은 비중대로 나눠 사고, 누적 투자금·평가금액이 쌓임', () => {
  const v = valuate({ holdings: [{ market: 'KR', s: '005930', qty: 100, avg: 100000 }, { market: 'US', s: 'MU', qty: 10, avg: 100 }], cards: CARDS, fx: FX });
  const sim = simulate({ valuation: v, plan: { mode: 'amount', amount: 1000000, cycle: 'month', count: 12, start: new Date(2026, 8, 16) }, scenario: 'base', fx: FX });
  assert.equal(sim.steps.length, 12);
  assert.equal(sim.legs.length, 24, '회차 × 종목');
  assert.equal(sim.steps[0].buy, 1000000, '1회차에 회차당 금액 전부 매수');
  assert.equal(Math.round(sim.summary.buyTotal), 12000000);
  assert.ok(sim.steps[11].invested > sim.steps[0].invested);
  assert.ok(sim.steps[11].value > sim.summary.invested, '기준 시나리오(+20%)면 평가금액이 투자금보다 큼');
  const first = sim.legs[0], last = sim.legs[sim.legs.length - 2];
  assert.ok(last.price > first.price, '회차가 갈수록 예상 단가가 오름(기대수익률 복리)');
  assert.ok(sim.holdings.every(h => h.end > h.start));

  const bear = simulate({ valuation: v, plan: { mode: 'amount', amount: 1000000, cycle: 'month', count: 12, start: new Date(2026, 8, 16) }, scenario: 'bear', fx: FX });
  assert.ok(bear.summary.value < sim.summary.value, '약세 시나리오는 평가금액이 더 낮음');
});

test('정기 모으기: 수량 기준은 종목별 회차당 수량대로', () => {
  const v = valuate({ holdings: [{ market: 'KR', s: '005930', qty: 10, avg: 100000, per: 5 }, { market: 'US', s: 'MU', qty: 1, avg: 100, per: 2 }], cards: CARDS, fx: FX });
  const sim = simulate({ valuation: v, plan: { mode: 'qty', cycle: 'week', count: 4, start: new Date(2026, 8, 16) }, scenario: 'base', fx: FX });
  assert.deepEqual(sim.holdings.map(h => h.bought), [20, 8], '4회 × 5주 · 4회 × 2주');
  assert.deepEqual(sim.holdings.map(h => h.end), [30, 9]);
  assert.equal(Math.round(sim.steps[0].buy), Math.round(5 * 100000 + 2 * 100 * FX));
});

test('엑셀: 시트 3장이 만들어지고 xlsx 바이트가 나옴', () => {
  const v = valuate({ holdings: [{ market: 'KR', s: '005930', qty: 100, avg: 80000 }, { market: 'US', s: 'MU', qty: 10, avg: 80 }], cards: CARDS, fx: FX });
  const sim = simulate({ valuation: v, plan: { mode: 'amount', amount: 500000, cycle: 'month', count: 6, start: new Date(2026, 8, 16) }, scenario: 'base', fx: FX });
  const sheets = buildPortfolioSheets({ valuation: v, sim, fx: FX, generatedAt: new Date(2026, 8, 16), asOf: '2026-09-16T00:00:00Z' });
  assert.deepEqual(sheets.map(s => s.name), ['포트폴리오', '정기 모으기', '회차별 종목']);
  assert.equal(sheets[1].rows.length, 5 + 6 + 1, '머리말 + 회차 6줄 + 합계');
  const bytes = buildXlsx(sheets);
  assert.equal(String.fromCharCode(bytes[0], bytes[1]), 'PK');
  assert.ok(bytes.length > 3000);

  const only = buildPortfolioSheets({ valuation: v, fx: FX });
  assert.deepEqual(only.map(s => s.name), ['포트폴리오'], '정기 모으기를 안 하면 시트 1장');
});
