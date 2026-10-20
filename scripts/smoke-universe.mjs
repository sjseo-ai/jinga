// 전 종목 검색 목록(api/_universe.mjs) 스모크 테스트 — 네트워크는 가짜 응답
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseScreenerAll, krRowsFrom, markIndexes, totalPages, isCommonUsName, buildUniverse, createUniverseStore, MIN_ROWS } from '../site/public/api/_universe.mjs';
import { themeOf } from '../site/public/api/_peers.mjs';

const screener = rows => ({ data: { rows } });
const naverPage = (stocks, totalCount) => ({ totalCount, stocks });
const krStock = (itemCode, stockName, price, cap, end = 'stock') => ({
  itemCode, stockName, stockEndType: end, closePriceRaw: String(price), marketValueRaw: String(cap),
  compareToPreviousPrice: { code: '2' }, compareToPreviousClosePrice: '100', fluctuationsRatio: '1.0', accumulatedTradingVolume: '1,000',
});

test('나스닥 스크리너: 보통주·ADR 만 남기고 워런트·유닛·우선주는 뺌', () => {
  const rows = parseScreenerAll(screener([
    { symbol: 'MU', name: 'Micron Technology Inc. Common Stock', lastsale: '$927.60', marketCap: '1,047,625,086,868', sector: 'Technology', industry: 'Semiconductors' },
    { symbol: 'SONY', name: 'Sony Group Corporation American Depositary Shares', lastsale: '$30.00', marketCap: '180,000,000,000', sector: 'Technology', industry: 'Consumer Electronics/Appliances' },
    { symbol: 'ABCDW', name: 'Acme Corp Warrants', lastsale: '$0.40', marketCap: '', sector: '', industry: 'Blank Checks' },
    { symbol: 'ABCDU', name: 'Acme Corp Units', lastsale: '$10.10', marketCap: '', sector: '', industry: 'Blank Checks' },
    { symbol: 'BAC/PL', name: 'Bank of America Corp 7.25% Preferred', lastsale: '$1,300', marketCap: '', sector: 'Finance', industry: 'Major Banks' },
    { symbol: 'MU', name: '중복', lastsale: '$1', marketCap: '1', sector: '', industry: '' },
  ]));
  assert.deepEqual(rows.map(r => r.s), ['MU', 'SONY'], 'ADR 은 남기고 워런트·유닛·우선주·중복은 제외');
  assert.deepEqual([rows[0].n, rows[0].cap, rows[0].p, rows[0].sec, rows[0].sub], ['Micron Technology Inc.', 1047625086868, 927.6, '정보기술', 'Semiconductors']);
  assert.equal(rows[1].n, 'Sony Group Corporation', '주식 종류 표기는 이름에서 지움');
  assert.equal(isCommonUsName('Acme Corp Rights'), false);
});

test('지수 소속·GICS 세부 업종 붙이기', () => {
  const rows = markIndexes(parseScreenerAll(screener([
    { symbol: 'AAPL', name: 'Apple Inc. Common Stock', lastsale: '$331.34', marketCap: '4,835,635,601,200', sector: 'Technology', industry: 'Computer Manufacturing' },
    { symbol: 'RKLB', name: 'Rocket Lab Corporation Common Stock', lastsale: '$62.55', marketCap: '38,032,116,413', sector: 'Industrials', industry: 'Military/Government/Technical' },
  ])), {
    sp: new Set(['AAPL']), ndx: new Set(['AAPL']), dow: new Set(['AAPL']),
    subBySymbol: new Map([['AAPL', 'Technology Hardware, Storage & Peripherals']]), secBySymbol: new Map([['AAPL', '정보기술']]),
  });
  assert.deepEqual(rows[0].idx, ['SPX', 'NDX', 'DJI']);
  assert.equal(rows[0].sub, 'Technology Hardware, Storage & Peripherals', '지수 구성종목은 GICS 세부 업종이 우선');
  assert.deepEqual(rows[1].idx, [], '지수에 없는 종목도 목록에는 남음');
  assert.equal(themeOf(rows[1]).label, '항공우주·방산', '스크리너 업종도 테마로 이어짐');
});

test('네이버 시가총액 순위: 주식만·중복 없이 · 쪽 수 계산', () => {
  const pages = [naverPage([krStock('005930', '삼성전자', '253,250', '1480570057476000'), krStock('069500', 'KODEX 200', '45,000', '1000', 'etf')], 2480),
    naverPage([krStock('005930', '삼성전자', '253,250', '1480570057476000'), krStock('000660', 'SK하이닉스', '1,742,000', '1272517699830000')], 2480)];
  const rows = krRowsFrom(pages, 'KOSPI');
  assert.deepEqual(rows.map(r => r.s), ['005930', '000660'], 'ETF 제외·중복 제거');
  assert.deepEqual([rows[0].market, rows[0].idx[0], rows[0].p], ['KR', 'KOSPI', 253250]);
  assert.equal(totalPages(2480), 25);
  assert.equal(totalPages(0), 1);
});

test('목록 만들기: 원천을 끝까지 넘겨 모으고, 너무 적으면 실패로 봄', async () => {
  const us = Array.from({ length: 3000 }, (_, i) => ({ symbol: `U${i}`, name: `Company ${i} Common Stock`, lastsale: '$10', marketCap: '1000000', sector: 'Finance', industry: 'Major Banks' }));
  const krOf = (index, page) => naverPage(Array.from({ length: page < 3 ? 100 : 50 }, (_, i) => krStock(String(1000000 + page * 1000 + i).slice(1), `${index}${page}-${i}`, '1,000', '100000000')), 250);
  const calls = [];
  const fetchImpl = async url => {
    calls.push(url);
    const u = new URL(url);
    if (u.hostname === 'm.stock.naver.com') return Response.json(krOf(u.pathname.split('/').pop(), Number(u.searchParams.get('page'))));
    return Response.json(screener(us));
  };
  const built = await buildUniverse({ fetchImpl, now: () => new Date('2026-09-16T00:00:00Z') });
  assert.equal(built.counts.KOSPI, 250, '1~3쪽(100+100+50)');
  assert.equal(built.counts.US, 3000);
  assert.equal(built.counts.total, 3500);
  assert.equal(calls.filter(u => u.includes('KOSPI')).length, 3, '100개 미만이 오면 그만 부름');
  assert.deepEqual(built.errors, []);

  await assert.rejects(() => buildUniverse({ fetchImpl: async () => Response.json(screener([])) }), /너무 적습니다/);
});

test('보관: 하루 지나면 새로 모으고, 새로 모으다 실패하면 예전 목록을 씀', async () => {
  const rows = Array.from({ length: MIN_ROWS }, (_, i) => ({ s: `S${i}`, n: `n${i}`, market: 'US', idx: [], cap: 1, p: 1, sec: '', sub: '' }));
  const saved = { rows, errors: [], builtAt: '2026-09-10T00:00:00Z', counts: { total: rows.length } };
  const m = new Map([['stocks/universe.json', saved]]);
  const store = { async get(p) { return m.get(p) || null; }, async put(p, v) { m.set(p, v); } };

  let fail = true;
  const fetchImpl = async url => {
    if (fail) throw new Error('원천 고장');
    return new URL(url).hostname === 'm.stock.naver.com'
      ? Response.json(naverPage([krStock('005930', '삼성전자', '1,000', '100')], 1))
      : Response.json(screener(rows.map(r => ({ symbol: r.s, name: r.n, lastsale: '$1', marketCap: '1', sector: '', industry: '' }))));
  };
  const cache = new Map();
  const u1 = await createUniverseStore({ store, fetchImpl, cache }).load();
  assert.equal(u1.stale, true, '새로 모으지 못하면 예전 목록');
  assert.equal(u1.rows.length, MIN_ROWS);

  fail = false;
  const u2 = await createUniverseStore({ store, fetchImpl, cache: new Map() }).load();
  assert.equal(u2.stale, undefined);
  assert.equal(u2.counts.KOSPI, 1, '새로 모은 목록으로 갈아 끼움');
  assert.equal((await store.get('stocks/universe.json')).counts.KOSPI, 1, '저장소에도 남김');
});
