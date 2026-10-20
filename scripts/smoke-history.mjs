// 과거 시세(_history.mjs) 스모크 테스트 — 응답 다듬기·보관은 가짜 fetch 로, 실제 원천 확인은 --live
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseNaverChart, parseNasdaqHistory, parseFx, tradingDays, createHistory, INDEX_CODES } from '../site/public/api/_history.mjs';

test('네이버 차트 다듬기 — 날짜에 붙임표, 오래된 것부터', () => {
  const rows = parseNaverChart([
    { localDate: '20260105', closePrice: '71,200' },
    { localDate: '20260102', closePrice: 70000 },
    { localDate: 'bad', closePrice: 1 },
    { localDate: '20260106', closePrice: null },
  ]);
  assert.deepEqual(rows, [['2026-01-02', 70000], ['2026-01-05', 71200]]);
  assert.deepEqual(parseNaverChart(null), []);
});

test('나스닥 historical 다듬기 — MM/DD/YYYY 와 $ 떼기', () => {
  const rows = parseNasdaqHistory({ data: { tradesTable: { rows: [
    { date: '01/05/2026', close: '$71.20' },
    { date: '01/02/2026', close: '$70.00' },
    { date: '—', close: '$1' },
  ] } } });
  assert.deepEqual(rows, [['2026-01-02', 70], ['2026-01-05', 71.2]]);
  assert.deepEqual(parseNasdaqHistory({}), []);
});

test('환율 다듬기 — 여러 쪽을 합치고 겹치는 날은 하나로', () => {
  const rows = parseFx([
    { result: [{ localTradedAt: '2026-01-05T15:30:00+0900', closePrice: '1,390.50' }] },
    { result: [{ localTradedAt: '2026-01-05', closePrice: 1390.5 }, { localTradedAt: '2026-01-02', closePrice: 1380 }] },
    null,
  ]);
  assert.deepEqual(rows, [['2026-01-02', 1380], ['2026-01-05', 1390.5]]);
});

test('거래일 모으기 — 여러 종목의 날짜를 합집합으로, 시작일부터', () => {
  const a = [['2026-01-02', 1], ['2026-01-05', 1]];
  const b = [['2026-01-05', 1], ['2026-01-06', 1]];
  assert.deepEqual(tradingDays([a, b, null], '2026-01-05'), ['2026-01-05', '2026-01-06']);
  assert.equal(tradingDays([a, b]).length, 3);
});

test('한 번 받은 것은 다시 부르지 않음 — 보관', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return { ok: true, json: async () => [{ localDate: '20260102', closePrice: 100 }] }; };
  const h = createHistory({ fetchImpl, ttlMs: 60e3 });
  const from = new Date('2026-01-01T00:00:00Z'), to = new Date('2026-02-01T00:00:00Z');
  await h.krItem('005930', from, to);
  await h.krItem('005930', from, to);
  assert.equal(calls, 1, '두 번째는 보관한 값');
  await h.krItem('000660', from, to);
  assert.equal(calls, 2);
});

test('원천이 죽으면 직전 값으로, 처음부터 죽으면 그 종목만 빼기', async () => {
  let ok = true, n = 0;
  const fetchImpl = async url => {
    n++;
    if (!ok) throw new Error('down');
    if (url.includes('005930')) return { ok: true, json: async () => [{ localDate: '20260102', closePrice: 100 }] };
    return { ok: true, json: async () => [] };
  };
  const h = createHistory({ fetchImpl, ttlMs: 0 });
  const from = new Date('2026-01-01T00:00:00Z'), to = new Date('2026-02-01T00:00:00Z');
  assert.equal((await h.krItem('005930', from, to)).length, 1);
  ok = false;
  assert.equal((await h.krItem('005930', from, to)).length, 1, '직전 값');
  await assert.rejects(() => h.krItem('999999', from, to), /down/);
  assert.ok(n > 0);
});

test('한 번에 받기 — 못 받은 종목은 missing 으로', async () => {
  const fetchImpl = async url => {
    if (url.includes('api.nasdaq.com')) throw new Error('블록');
    if (url.includes('marketIndex')) return { ok: true, json: async () => ({ result: [{ localTradedAt: '2026-01-02', closePrice: 1380 }] }) };
    return { ok: true, json: async () => [{ localDate: '20260102', closePrice: 100 }] };
  };
  const h = createHistory({ fetchImpl });
  const r = await h.load(['KR:005930', 'US:MU'], '2026-01-02');
  assert.deepEqual(Object.keys(r.prices), ['KR:005930']);
  assert.deepEqual(r.missing, ['US:MU']);
  assert.equal(r.benchmarks.KOSPI.length, 1);
  assert.equal(r.fx.length, 1);
  assert.equal(r.from, '2026-01-02');
  assert.deepEqual(Object.keys(INDEX_CODES).sort(), ['DJI', 'KOSDAQ', 'KOSPI', 'NDX', 'SPX']);
});

// 실제 원천 확인 — node scripts/smoke-history.mjs --live (네트워크가 있어야 함)
if (process.argv.includes('--live')) {
  test('실제 원천 — 국내·미국·지수·환율', { concurrency: false }, async () => {
    const h = createHistory();
    const r = await h.load(['KR:005930', 'US:MU'], '2026-06-01');
    for (const [k, v] of Object.entries(r.prices)) console.log(`  ${k}: ${v.length}행 ${v[0][0]}~${v[v.length - 1][0]} 마지막 ${v[v.length - 1][1]}`);
    console.log(`  KOSPI ${r.benchmarks.KOSPI.length}행 · SPX ${r.benchmarks.SPX.length}행 · 환율 ${r.fx.length}행 · 못 받음 ${r.missing.join(',') || '없음'}`);
    assert.ok(r.benchmarks.KOSPI.length > 30);
    assert.ok(r.fx.length > 30);
  });
}
