// 지수 구성종목 히트맵 데이터(api/_market.mjs) 스모크 테스트 — 원천 응답은 가짜(네트워크 없음)
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMarketSource, parseCsv, parseSp500Csv, parseDowNames, mapNamesToSymbols, parseNaverMarketValue, URLS, DOW_FALLBACK } from '../site/public/api/_market.mjs';

const CSV = `Symbol,Security,GICS Sector,GICS Sub-Industry,Headquarters Location
AAPL,Apple Inc.,Information Technology,Tech Hardware,"Cupertino, California"
BRK.B,Berkshire Hathaway,Financials,Multi-Sector Holdings,"Omaha, Nebraska"
DIS,Walt Disney Company (The),Communication Services,Movies,"Burbank, California"
GOOG,Alphabet Inc. (Class C),Communication Services,Interactive Media,"Mountain View, California"
GOOGL,Alphabet Inc. (Class A),Communication Services,Interactive Media,"Mountain View, California"
IBM,IBM,Information Technology,IT Services,"Armonk, New York"
AMZN,Amazon,Consumer Discretionary,Broadline Retail,"Seattle, Washington"
JPM,JPMorgan Chase,Financials,Banks,"New York City, New York"
`;
const screener = { data: { rows: [
  { symbol: 'AAPL', name: 'Apple Inc. Common Stock', lastsale: '$333.08', pctchange: '0.24%', marketCap: '4861029474400.00', sector: 'Technology' },
  { symbol: 'BRK/B', name: 'Berkshire Hathaway Inc.', lastsale: '$510.10', netchange: '-4.62', pctchange: '-0.897%', volume: '3829669', marketCap: '1136140040496.00', sector: '' },
  { symbol: 'DIS', name: 'Walt Disney Company (The) Class A Common Stock (DE)', lastsale: '$120.00', pctchange: '1.5%', marketCap: '220000000000.00', sector: 'Industrials' },
  { symbol: 'GOOGL', name: 'Alphabet A', lastsale: '$300', pctchange: '3.217%', marketCap: '4273039700000.00', sector: 'Technology' },
  { symbol: 'GOOG', name: 'Alphabet C', lastsale: '$301', pctchange: '3.059%', marketCap: '4228033300000.00', sector: 'Technology' },
  { symbol: 'IBM', name: 'IBM', lastsale: '$250', pctchange: '-2%', marketCap: '230000000000.00', sector: 'Technology' },
  { symbol: 'AMZN', name: 'Amazon', lastsale: '$220', pctchange: '0%', marketCap: '2300000000000.00', sector: 'Consumer Discretionary' },
  { symbol: 'JPM', name: 'JPMorgan', lastsale: '$300', pctchange: '0.5%', marketCap: '800000000000.00', sector: 'Finance' },
  { symbol: 'TMUS', name: 'T-Mobile US', lastsale: '$250', pctchange: '-1.1%', marketCap: '280000000000.00', sector: 'Telecommunications' },
] } };
const ndx = { data: { date: 'Sep 14, 2026', data: { rows: [
  { symbol: 'AAPL', companyName: 'Apple Inc. Common Stock', marketCap: '4,861,029,474,400', lastSalePrice: '$333.08', percentageChange: '+0.24%' },
  { symbol: 'TMUS', companyName: 'T-Mobile US, Inc.', marketCap: '280,000,000,000', lastSalePrice: '$250.00', percentageChange: '-1.10%' },
  { symbol: 'XYZ', companyName: 'No Cap Corp', marketCap: '', lastSalePrice: '$1.00', percentageChange: '0%' },
] } } };
const naver = { marketStatus: 'CLOSE', stocks: [
  { itemCode: '005930', stockName: '삼성전자', closePriceRaw: '251750', compareToPreviousClosePriceRaw: '2750', accumulatedTradingVolumeRaw: '3321511', fluctuationsRatio: '1.10', compareToPreviousPrice: { code: '2' }, marketValueRaw: '1471800639564000', localTradedAt: '2026-09-15T15:30:00+09:00' },
  { itemCode: '000660', stockName: 'SK하이닉스', closePriceRaw: '500000', compareToPreviousClosePriceRaw: '12500', accumulatedTradingVolumeRaw: '1200000', fluctuationsRatio: '2.50', compareToPreviousPrice: { code: '5' }, marketValueRaw: '364000000000000', localTradedAt: '2026-09-15T15:30:01+09:00' },
  { itemCode: '999999', stockName: '보합', closePriceRaw: '1000', fluctuationsRatio: '0.00', compareToPreviousPrice: { code: '3' }, marketValueRaw: '1000', localTradedAt: '2026-09-15T15:30:00+09:00' },
  { itemCode: '069500', stockName: 'KODEX 200', stockEndType: 'etf', closePriceRaw: '50000', fluctuationsRatio: '0.50', compareToPreviousPrice: { code: '2' }, marketValueRaw: '900000000000000', localTradedAt: '2026-09-15T15:30:00+09:00' },
] };
const DOW_NAMES = ['3M Company', 'The Coca-Cola Company', 'Nike, Inc.', 'Alphabet Inc. ↑', 'The Goldman Sachs Group, Inc.', 'Nvidia Corporation'];
const dowHtml = names => `<table class="box"><tr><td>This article needs citations</td></tr></table><table class="wikitable"><tbody><tr>${names.map(n => `<td><a href="/wiki/x">${n.replace('&', '&amp;')}</a><sup>[1]</sup></td>`).join('')}</tr></tbody></table>`;

function fakeFetch(routes, calls = []) {
  return async url => {
    calls.push(url);
    const hit = routes.find(([k]) => url.startsWith(k));
    if (!hit) return new Response('없음', { status: 404 });
    const body = typeof hit[1] === 'function' ? hit[1]() : hit[1];
    if (body instanceof Response) return body;
    return new Response(typeof body === 'string' ? body : JSON.stringify(body));
  };
}

test('원천 파서: CSV 따옴표 칸 · S&P 목록 · 네이버 등락 부호(하락·하한은 음수, 보합 0)', () => {
  assert.deepEqual(parseCsv('a,"b, c",d\n1,"x ""y""",3\n'), [['a', 'b, c', 'd'], ['1', 'x "y"', '3']]);
  const sp = parseSp500Csv(CSV);
  assert.equal(sp.length, 8);
  assert.deepEqual(sp[1], { symbol: 'BRK.B', name: 'Berkshire Hathaway', sector: 'Financials', sub: 'Multi-Sector Holdings' }, 'GICS 세부 업종(sub)은 유사 종목 추천에서 국내 업종과 이어 붙임');
  const kr = parseNaverMarketValue(naver);
  assert.deepEqual(kr.map(x => x.c), [1.1, -2.5, 0]);
  assert.deepEqual(kr.map(x => x.d), [2750, -12500, 0], '전일 대비 금액에도 등락 부호');
  assert.equal(kr[0].vol, 3321511);
  assert.equal(kr[0].cap, 1471800639564000);
});

test('다우 구성: 위키백과 회사 이름 → 티커(A주 우선·이름 별칭), 못 읽으면 내장 목록', () => {
  const sp = parseSp500Csv(CSV);
  assert.deepEqual(parseDowNames(dowHtml(['A Co', 'B Co'])), [], '회사 칸이 30개 안팎이 아니면 무시');
  const names30 = [...Array(24)].map((_, i) => `Filler ${i}`).concat(['Apple Inc.', 'Alphabet Inc. ↑', 'The Walt Disney Company', 'International Business Machines Corporation', 'Amazon.com, Inc.', 'JPMorgan Chase & Co.']);
  // 실제 문서처럼 표 끝에 편출 칸이 붙음 — 「Dropped from Average」 뒤와 ↓ 표시 칸은 현재 구성에서 뺌
  const parsed = parseDowNames(dowHtml([...names30, 'Dropped from Average', 'Verizon Communications Inc. ↓']));
  assert.equal(parsed.length, 30);
  assert.ok(!parsed.some(n => /Verizon|Dropped/.test(n)), '편출 종목 제외');
  assert.equal(parsed[25], 'Alphabet Inc.', '↑ 표시·각주 제거');
  assert.deepEqual(mapNamesToSymbols(parsed.slice(24), sp), ['AAPL', 'GOOGL', 'DIS', 'IBM', 'AMZN', 'JPM']);
  assert.equal(mapNamesToSymbols(['Nobody Holdings'], sp)[0], null);
  void DOW_NAMES;
});

test('지수별 조회: 섹터 한글화 · 클래스 주식 표기(BRK/B→BRK.B) · 시가총액 순 정렬 · 원천 실패 시 직전 값', async () => {
  let t = Date.parse('2026-09-15T01:00:00Z');
  const calls = [];
  let screenerDown = false;
  const src = createMarketSource({
    now: () => t,
    fetchImpl: fakeFetch([
      [URLS.naver('KOSPI').split('?')[0], naver],   // 1·2쪽 모두 같은 응답 — 같은 종목은 한 번만
      [URLS.sp500, CSV],
      [URLS.screener, () => (screenerDown ? new Response('busy', { status: 503 }) : screener)],
      [URLS.ndx, ndx],
      [URLS.dow, dowHtml(['A', 'B'])],
    ], calls),
  });

  const kospi = await src.load('KOSPI');
  assert.equal(kospi.items[0].n, '삼성전자');
  assert.equal(kospi.count, 3, 'ETF 제외 · 두 쪽에 겹친 종목은 한 번만');
  assert.ok(!kospi.items.some(x => x.s === '069500'), 'KODEX 200(ETF)은 시가총액이 커도 빠짐');
  assert.equal(kospi.scope, '시가총액 상위');
  assert.equal(kospi.asOf, '2026-09-15T15:30:01+09:00');
  assert.equal(kospi.note, '장 마감 기준');

  const spx = await src.load('SPX');
  assert.deepEqual(spx.items.map(x => x.s), ['AAPL', 'GOOGL', 'GOOG', 'AMZN', 'BRK.B', 'JPM', 'IBM', 'DIS'], '시가총액 큰 순');
  const brk = spx.items.find(x => x.s === 'BRK.B');
  assert.equal(brk.c, -0.9);
  assert.equal(brk.d, -4.62, '전일 대비 금액(스크리너 netchange)');
  assert.equal(brk.vol, 3829669, '거래량');
  assert.equal(spx.items.find(x => x.s === 'AAPL').d, null, '금액이 없으면 null — 화면이 등락률로 계산');
  assert.equal(spx.items.find(x => x.s === 'DIS').sec, '커뮤니케이션', 'S&P 목록의 GICS 섹터 우선');
  assert.equal(spx.items.find(x => x.s === 'AAPL').sec, '정보기술');
  assert.equal(spx.items.find(x => x.s === 'AAPL').n, 'Apple Inc.', '「Common Stock」 표기 제거');
  assert.equal(spx.items.find(x => x.s === 'DIS').n, 'Walt Disney Company', '주식 종류·설립지·(The) 표기 제거');

  const ndxRes = await src.load('NDX');
  assert.deepEqual(ndxRes.items.map(x => x.s), ['AAPL', 'TMUS']);
  assert.deepEqual(ndxRes.missing, ['XYZ'], '시가총액 없는 종목은 빼고 알려 줌');
  assert.equal(ndxRes.items.find(x => x.s === 'TMUS').sec, '커뮤니케이션', 'S&P 목록에 없으면 나스닥 섹터를 한글화');
  assert.equal(ndxRes.asOf, 'Sep 14, 2026');

  const dji = await src.load('DJI');
  assert.match(dji.note, /내장 목록/, '위키백과 표를 못 읽으면 내장 목록');
  assert.equal(new Set(DOW_FALLBACK).size, 30);

  const before = calls.filter(u => u.startsWith(URLS.screener)).length;
  await src.load('SPX');
  assert.equal(calls.filter(u => u.startsWith(URLS.screener)).length, before, '1분 안에는 스크리너를 다시 부르지 않음');
  t += 2 * 60e3;
  screenerDown = true;
  const stale = await src.load('SPX');
  assert.equal(stale.stale, true, '스크리너가 실패하면 직전 값으로 표시');
  assert.equal(stale.count, spx.count);
});
