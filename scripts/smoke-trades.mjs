// 매매 기록·기간별 수익률(jinga-trades.mjs) 스모크 테스트 — 순수 계산, 네트워크 없음
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseTrade, positions, qtyOn, valueAt, valueSeries, twr, slice, periodTable, pnl,
  PERIODS, BENCHMARKS, tradeKey, isDate, buildTradeSheets,
} from '../site/public/jinga-trades.mjs';

const T = (date, s, side, qty, price, extra = {}) => ({ date, market: 'KR', s, n: s, side, qty, price, fee: 0, ...extra });

test('매매 한 건 다듬기 — 값 검사', () => {
  const ok = parseTrade({ date: '2026-03-02', market: 'KR', s: '005930', n: '삼성전자', side: 'buy', qty: 10, price: 70000, fee: 105 });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.value, { date: '2026-03-02', market: 'KR', s: '005930', n: '삼성전자', side: 'buy', qty: 10, price: 70000, fee: 105 });
  assert.equal(parseTrade({ date: '2026-3-2', s: 'x', qty: 1, price: 1 }).ok, false, '날짜 형식');
  assert.match(parseTrade({ date: '2026-03-02', s: '', qty: 1, price: 1 }).error, /종목/);
  assert.match(parseTrade({ date: '2026-03-02', s: 'A', qty: 0, price: 1 }).error, /수량/);
  assert.match(parseTrade({ date: '2026-03-02', s: 'A', qty: 1, price: 0 }).error, /단가/);
  assert.match(parseTrade({ date: '2026-03-02', s: 'A', qty: 1, price: 1, fee: -5 }).error, /수수료/);
  assert.equal(parseTrade({ date: '2026-03-02', market: 'US', s: 'mu', qty: 1, price: 1 }).value.s, 'MU', '티커는 대문자로');
  assert.equal(isDate('2026-03-02'), true);
});

test('이동평균법 — 평단가·실현손익·보유수량', () => {
  const trades = [
    T('2026-01-05', '005930', 'buy', 10, 70000),
    T('2026-02-10', '005930', 'buy', 10, 90000),      // 평단 80,000
    T('2026-03-15', '005930', 'sell', 5, 100000),     // 실현 (100,000-80,000)*5 = 100,000
    T('2026-04-01', '000660', 'buy', 2, 200000),
  ];
  const { list, warnings } = positions(trades);
  const ss = list.find(p => p.s === '005930');
  assert.equal(ss.qty, 15);
  assert.equal(ss.avg, 80000, '판 뒤에도 평단가는 그대로');
  assert.equal(ss.realized, 100000);
  assert.equal(ss.buyAmt, 10 * 70000 + 10 * 90000);
  assert.equal(ss.sellAmt, 500000);
  assert.equal(ss.firstAt, '2026-01-05');
  assert.equal(ss.trades, 3);
  assert.equal(warnings.length, 0);
  assert.equal(list.length, 2);

  // 수수료는 매수 원가에 더하고 매도 대금에서 뺌
  const withFee = positions([T('2026-01-05', 'A', 'buy', 10, 1000, { fee: 100 })]).list[0];
  assert.equal(withFee.avg, 1010, '(10,000+100)/10');

  // 가진 것보다 많이 팔면 가진 만큼만
  const over = positions([T('2026-01-05', 'A', 'buy', 5, 1000), T('2026-02-05', 'A', 'sell', 10, 1200)]);
  assert.equal(over.list[0].qty, 0);
  assert.equal(over.list[0].realized, 1000, '5주만 팔린 것으로');
  assert.match(over.warnings[0], /많이 팔았습니다/);

  // 다 팔면 평단가는 0으로 되돌림
  const flat = positions([T('2026-01-05', 'A', 'buy', 5, 1000), T('2026-02-05', 'A', 'sell', 5, 1200)]).list[0];
  assert.equal(flat.qty, 0);
  assert.equal(flat.avg, 0);

  assert.equal(qtyOn(trades, 'KR', '005930', '2026-02-01'), 10, '그날까지의 보유');
  assert.equal(qtyOn(trades, 'KR', '005930', '2026-03-20'), 15);
  assert.equal(qtyOn(trades, 'KR', '999999', '2026-12-31'), 0);
  assert.equal(tradeKey('US', 'mu'), 'US:MU');
});

test('휴장일에는 직전 종가 — valueAt', () => {
  const s = [['2026-01-02', 100], ['2026-01-05', 110], ['2026-01-06', 120]];
  assert.equal(valueAt(s, '2026-01-05'), 110);
  assert.equal(valueAt(s, '2026-01-04'), 100, '휴장일이면 직전 값');
  assert.equal(valueAt(s, '2026-01-01'), null, '첫 값보다 앞이면 없음');
  assert.equal(valueAt([], '2026-01-01'), null);
});

test('날짜별 평가액과 순입금 — 미국 종목은 그날 환율로 원화 환산', () => {
  const trades = [
    T('2026-01-02', '005930', 'buy', 10, 100),
    { date: '2026-01-05', market: 'US', s: 'MU', n: 'MU', side: 'buy', qty: 2, price: 50, fee: 0 },
  ];
  const prices = { 'KR:005930': [['2026-01-02', 100], ['2026-01-05', 120], ['2026-01-06', 130]], 'US:MU': [['2026-01-05', 50], ['2026-01-06', 60]] };
  const fx = [['2026-01-02', 1000], ['2026-01-05', 1000], ['2026-01-06', 1100]];
  const ser = valueSeries({ trades, prices, fx, dates: ['2026-01-02', '2026-01-05', '2026-01-06'] });

  assert.deepEqual(ser[0], { date: '2026-01-02', value: 1000, flow: 1000, known: 1 });
  assert.deepEqual(ser[1], { date: '2026-01-05', value: 1200 + 2 * 50 * 1000, flow: 2 * 50 * 1000, known: 2 });
  assert.equal(ser[2].value, 1300 + 2 * 60 * 1100, '환율이 오르면 원화 평가액도 오름');
  assert.equal(ser[2].flow, 0);

  // 환율을 못 받은 날에는 1이 아니라 가장 이른 환율로 — 달러를 원화로 그냥 두면 평가액이 통째로 틀어집니다
  const early = valueSeries({ trades, prices, fx: [['2026-01-06', 1100]], dates: ['2026-01-05'] });
  assert.equal(early[0].value, 1200 + 2 * 50 * 1100);
});

test('시간가중수익률 — 돈 넣은 날에 수익이 생기지 않음', () => {
  // 100 넣고 그대로 → 0%
  assert.equal(twr([{ value: 100, flow: 100 }, { value: 100, flow: 0 }]), 0);
  // 100 → 110 이면 10%
  assert.equal(twr([{ value: 100, flow: 100 }, { value: 110, flow: 0 }]), 0.1);
  // 100 에서 10% 오른 뒤(110) 100 을 더 넣어 210 → 추가 입금은 수익이 아님
  const s = [{ value: 100, flow: 100 }, { value: 110, flow: 0 }, { value: 210, flow: 100 }];
  assert.equal(twr(s), 0.1, '입금으로 커진 평가액은 수익률에 넣지 않음');
  // 그 뒤 231 이면 다시 10% → 총 21%
  assert.equal(twr([...s, { value: 231, flow: 0 }]), 0.21);
  assert.equal(twr([]), null);
  assert.equal(twr([{ value: 100, flow: 0 }]), null, '하루뿐이면 셈할 수 없음');
  assert.equal(slice([{ date: 'a' }, { date: 'c' }], 'b').length, 1);
});

test('기간별 비교표 — 지수와 나란히, 기록이 짧으면 표시', () => {
  const dates = [];
  for (let i = 0; i < 40; i++) dates.push(new Date(Date.UTC(2026, 7, 10 + i)).toISOString().slice(0, 10));
  // 매일 1% 오르는 포트폴리오
  const series = dates.map((date, i) => ({ date, value: Math.round(1000 * 1.01 ** i), flow: i === 0 ? 1000 : 0 }));
  // 지수는 매일 0.5%
  const kospi = dates.map((date, i) => [date, 2000 * 1.005 ** i]);
  const spx = dates.map((date, i) => [date, 5000 * 1.002 ** i]);

  const table = periodTable({ series, benchmarks: { KOSPI: kospi, SPX: spx }, today: dates[dates.length - 1] });
  assert.deepEqual(table.map(r => r.key), PERIODS.map(p => p.key));
  const all = table.find(r => r.key === 'all');
  assert.ok(all.mine > 0.4 && all.mine < 0.5, '39일 × 1% ≈ 47%');
  assert.ok(all.mine > all.marks.KOSPI, '포트폴리오가 지수보다 나음');
  assert.equal(all.gaps.KOSPI, Math.round((all.mine - all.marks.KOSPI) * 1e4) / 1e4);
  assert.deepEqual(BENCHMARKS.map(b => b.key), ['KOSPI', 'SPX']);

  const y1 = table.find(r => r.key === 'y1');
  assert.equal(y1.short, true, '기록이 1년보다 짧으면 표시');
  assert.equal(y1.from, series[0].date, '가진 기록의 처음부터');
  const m1 = table.find(r => r.key === 'm1');
  assert.equal(m1.short, false, '40일치는 1개월을 채움');
  assert.equal(periodTable({ series: [] }).length, 0);
});

test('보유 손익 — 평가손익 + 실현손익', () => {
  const list = positions([
    T('2026-01-05', '005930', 'buy', 10, 70000),
    T('2026-03-15', '005930', 'sell', 5, 100000),
    { date: '2026-02-01', market: 'US', s: 'MU', n: 'MU', side: 'buy', qty: 2, price: 100, fee: 0 },
  ]).list;
  const px = (m, s) => (s === '005930' ? 90000 : s === 'MU' ? 120 : null);
  const r = pnl(list, px, 1300);
  const ss = r.rows.find(x => x.s === '005930');
  assert.equal(ss.value, 5 * 90000);
  assert.equal(ss.cost, 5 * 70000);
  assert.equal(ss.unrealized, 100000);
  assert.equal(ss.realizedKrw, 150000, '(100,000-70,000)*5');
  assert.equal(ss.total, 250000);
  const mu = r.rows.find(x => x.s === 'MU');
  assert.equal(mu.value, 2 * 120 * 1300, '미국 종목은 환율로 원화 환산');
  assert.equal(r.total.total, ss.total + mu.total);
  assert.ok(r.total.rate > 0);
  assert.equal(pnl([], px, 1300).total.rate, null);
});

test('엑셀 시트 — 매매 기록과 기간별 수익률 두 장', () => {
  const trades = [T('2026-01-05', '005930', 'buy', 10, 70000), { date: '2026-02-01', market: 'US', s: 'MU', n: 'MU', side: 'sell', qty: 1, price: 100, fee: 0.5 }];
  const table = [{ key: 'm1', label: '1개월', from: '2026-01-05', to: '2026-02-01', mine: 0.1, marks: { KOSPI: 0.05, SPX: 0.02 }, gaps: { KOSPI: 0.05, SPX: 0.08 }, short: true }];
  const gains = pnl(positions(trades).list, () => 90000, 1300);
  const sheets = buildTradeSheets({ trades, table, gains, missing: ['US:XYZ'], fx: 1300 });
  assert.deepEqual(sheets.map(s => s.name), ['매매 기록', '기간별 수익률']);
  const txt = JSON.stringify(sheets);
  assert.match(txt, /이동평균법/);
  assert.match(txt, /US:XYZ/, '못 받은 종목을 적어 둠');
  assert.equal(sheets[1].rows[4].length, 4 + BENCHMARKS.length * 2, '지수마다 수익률·초과 두 칸');
  assert.match(sheets[1].rows[5][0].v, /기록 전체/);
  assert.deepEqual(buildTradeSheets({ trades: [] }), [], '기록이 없으면 시트도 없음');
});
