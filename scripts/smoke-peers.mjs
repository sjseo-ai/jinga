// 진가 유사 종목 추천(api/_peers.mjs) 스모크 테스트 — 네트워크 없음
import test from 'node:test';
import assert from 'node:assert/strict';
import { themeOf, searchStocks, rankPeers, peerScore, whyPeer, THEMES } from '../site/public/api/_peers.mjs';

test('테마: 국내 네이버 업종과 미국 GICS 세부 업종을 같은 테마로', () => {
  assert.deepEqual(themeOf({ market: 'KR', industry: '반도체와반도체장비' }), { key: 'semi', label: '반도체' });
  assert.deepEqual(themeOf({ market: 'US', sub: 'Semiconductors' }), { key: 'semi', label: '반도체' });
  assert.deepEqual(themeOf({ market: 'US', sub: 'Semiconductor Materials & Equipment' }).key, 'semi');
  assert.equal(themeOf({ market: 'KR', industry: '자동차' }).key, 'auto');
  assert.equal(themeOf({ market: 'KR', industry: '자동차부품' }).key, 'auto');
  assert.equal(themeOf({ market: 'US', sub: 'Automobile Manufacturers' }).key, 'auto');
  assert.equal(themeOf({ market: 'KR', industry: '식품' }).key, 'food');
  assert.equal(themeOf({ market: 'KR', industry: '식품과기본식료품소매' }).key, 'retail', '소매는 음식료가 아니라 유통');
  assert.equal(themeOf({ market: 'US', sub: 'Interactive Media & Services' }).key, 'net');
  assert.equal(themeOf({ market: 'US', sub: '' }), null);
  assert.equal(themeOf({ market: 'KR', industry: '듣도보도못한업종' }), null);
  assert.equal(new Set(THEMES.map(t => t.key)).size, THEMES.length, '테마 키 중복 없음');
});

const U = [
  { s: '005930', n: '삼성전자', market: 'KR', sec: '정보기술', industry: '반도체와반도체장비', cap: 1.45e15 },
  { s: '000660', n: 'SK하이닉스', market: 'KR', sec: '정보기술', industry: '반도체와반도체장비', cap: 1.23e15 },
  { s: '005380', n: '현대차', market: 'KR', sec: '경기소비재', industry: '자동차', cap: 7.5e13 },
  { s: 'MU', n: 'Micron Technology Inc.', market: 'US', sec: '정보기술', sub: 'Semiconductors', cap: 1.04e12 },
  { s: 'NVDA', n: 'NVIDIA Corporation', market: 'US', sec: '정보기술', sub: 'Semiconductors', cap: 5.08e12 },
  { s: 'AAPL', n: 'Apple Inc.', market: 'US', sec: '정보기술', sub: 'Technology Hardware, Storage & Peripherals', cap: 4.86e12 },
];

test('검색: 종목명·티커·한글 별칭(마이크론 → MU)', () => {
  assert.equal(searchStocks(U, '삼성전자')[0].s, '005930');
  assert.equal(searchStocks(U, '삼성')[0].s, '005930');
  assert.equal(searchStocks(U, 'SK하이닉스')[0].s, '000660');
  assert.equal(searchStocks(U, '005930')[0].s, '005930');
  assert.equal(searchStocks(U, '마이크론')[0].s, 'MU', '한글 별칭');
  assert.equal(searchStocks(U, 'micron')[0].s, 'MU');
  assert.equal(searchStocks(U, 'MU')[0].s, 'MU');
  assert.equal(searchStocks(U, '엔비디아')[0].s, 'NVDA');
  assert.deepEqual(searchStocks(U, ''), []);
  assert.deepEqual(searchStocks(U, '없는종목'), []);
  assert.ok(searchStocks(U, 'a', 3).length <= 3);
});

const row = (base, extra) => ({ ...base, theme: themeOf(base), ...extra });
const ROWS = [
  row(U[0], { score: 73.8, expUpside: 1.0555, confidence: '낮음', oneOff: true, metrics: { per: 11.19, roe: 0.2592, niG: 1.1644 } }),
  row(U[1], { score: 74.7, expUpside: 1.0555, confidence: '낮음', oneOff: true, metrics: { per: 7.61, roe: 0.6058, niG: 0.5562 } }),
  row(U[2], { score: 43, expUpside: -0.0101, confidence: '높음', metrics: { per: 12.09, roe: 0.0653, niG: 0.2324 } }),
  row(U[3], { score: 58.6, expUpside: -0.5321, confidence: '높음', oneOff: true, metrics: { per: 122.21, roe: 0.0848, niG: 9.9756 } }),
  row(U[4], { score: 64.9, expUpside: -0.1635, confidence: '낮음', metrics: { per: 42.34, roe: 0.5243, niG: 0.6475 } }),
  row(U[5], { score: 49.9, expUpside: -0.2981, confidence: '낮음', metrics: { per: 43.4, roe: 1.0418, niG: 0.195 } }),
];

test('추천 점수: 기대 상승여력 가산, 신뢰도 낮음·일회성 감점', () => {
  assert.equal(peerScore({ score: 60 }), 60);
  assert.equal(peerScore({ score: 60, expUpside: 0.2 }), 64);
  assert.equal(peerScore({ score: 60, expUpside: 3 }), 70, '가산은 최대 10점');
  assert.equal(peerScore({ score: 60, expUpside: -1 }), 52, '감산은 최대 8점');
  assert.equal(peerScore({ score: 60, confidence: '낮음', oneOff: true }), 52);
  assert.equal(peerScore({ score: null }), null);
  assert.equal(peerScore({ score: 60, expUpside: 0.97, clamped: true }), 60, '적정가 상한에 걸린 종목은 기대 상승여력을 순위에 쓰지 않음(국내 다수가 +97%로 같게 나옴)');
});

test('유사 종목: 같은 테마 먼저, 다른 시장도 섞고, 기준 종목·재무 없는 종목은 제외', () => {
  const target = ROWS[0];
  const peers = rankPeers(target, ROWS, { limit: 5, minOther: 2 });
  assert.ok(!peers.some(p => p.s === '005930'), '기준 종목 제외');
  assert.equal(peers[0].s, '000660', '같은 테마에서 추천 점수 1위');
  assert.deepEqual(peers.filter(p => p.tier === 'theme').map(p => p.s).sort(), ['000660', 'MU', 'NVDA']);
  assert.ok(peers.filter(p => p.market === 'US').length >= 2, '미국 종목 최소 2곳');
  assert.ok(!peers.some(p => p.s === '005380'), '섹터도 테마도 다른 종목 제외');
  assert.ok(peers.every((p, i) => i === 0 || p.tier === 'sector' || peers[i - 1].tier === 'theme'), '테마가 섹터보다 앞');

  const naRow = { s: 'XXX', n: '재무없음', market: 'KR', sec: '정보기술', industry: '반도체와반도체장비', cap: 1e12, na: true };
  assert.ok(!rankPeers(target, [...ROWS, naRow]).some(p => p.s === 'XXX'));
  assert.equal(rankPeers(target, [ROWS[2]]).length, 0, '맞는 종목이 없으면 빈 목록');

  const why = peers.find(p => p.s === '000660').why;
  assert.equal(why[0], '같은 테마 반도체');
  assert.ok(why.includes('PER 7.6배(기준 11.2배)'), why.join(' | '));
  assert.ok(why.includes('ROE 61%'));
  assert.ok(whyPeer({ ...ROWS[3], tier: 'theme' }, target).includes('미국 상장'));
  assert.ok(whyPeer({ ...ROWS[3], tier: 'theme', clamped: true }, target).includes('적정가 상한 적용(상승여력 비교 제외)'));
});
