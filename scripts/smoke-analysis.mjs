// 진가 종목 분석(api/_analysis.mjs · _fundamentals.mjs) 스모크 테스트 — 가상의 종목·재무로 점수·적정가·시나리오·추천 규칙 확인(네트워크 없음)
import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeIndex, stockMetrics, scenarioProbabilities, pctRank, median, isPreferredKr, SCENARIOS, SECTOR_BETA, FAIR_RANGE } from '../site/public/api/_analysis.mjs';
import { secPeriods, mergeFrames, parseNaverAnnual, parseNaverIntegration, krSectorOf, buildUsFundamentals, SEC_TICKERS_URL, secFrameUrl } from '../site/public/api/_fundamentals.mjs';

test('기본 계산: 백분위 · 중앙값 · 시나리오 확률(VIX가 높으면 약세 비중↑, 합계 1)', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(pctRank([10, 20, 30], 10), 0);
  assert.equal(pctRank([10, 20, 30], 30), 1);
  assert.equal(pctRank([10, 20, 20, 30], 20), 0.5);
  const calm = scenarioProbabilities({ vix: 12, trendPct: 15 });
  const fear = scenarioProbabilities({ vix: 35, trendPct: -15 });
  const none = scenarioProbabilities({});
  for (const p of [calm, fear, none]) assert.equal(Math.round((p.bull + p.base + p.bear) * 100), 100);
  assert.ok(calm.bull > calm.bear && fear.bear > fear.bull);
  assert.deepEqual(none, { bull: 0.25, bear: 0.25, base: 0.5 });
});

test('지표: 미국은 회사 단위(시가총액 ÷ 순이익 등), 국내는 네이버 PER·PBR과 컨센서스, 우선주 판별', () => {
  const us = stockMetrics({ cap: 1000, p: 10 }, { ni: 50, ni0: 40, equity: 200, debt: 100, cash: 50, oi: 80, da: 20, rev: 500, rev0: 400, ocf: 90, capex: 30 }, 'US');
  assert.equal(us.per, 20);
  assert.equal(us.pbr, 5);
  assert.equal(us.ev, 1050);
  assert.equal(us.evEbitda, 10.5);
  assert.equal(us.roe, 0.25);
  assert.equal(us.opm, 0.16);
  assert.equal(us.revG, 0.25);
  assert.equal(us.niG, 0.25);
  assert.equal(us.lev, 0.5);
  assert.equal(us.cashY, 0.06);
  const loss = stockMetrics({ cap: 1000, p: 10 }, { ni: -5, equity: 100 }, 'US');
  assert.equal(loss.per, null);
  assert.equal(loss.loss, true);

  const kr = stockMetrics({ cap: 1e13, p: 50000 }, { per: 10, pbr: 2, cnsPer: 8, oi: 20000, opm: 12, rev: 100000, revFwd: 120000, debtRatio: 40, divYield: 2.5 }, 'KR');
  assert.equal(kr.ni, 1e12);
  assert.equal(kr.equity, 5e12);
  assert.equal(kr.roe, 0.2);
  assert.equal(kr.evEbitda, 1e13 / (20000 * 1e8));
  assert.ok(Math.abs(kr.revG - 0.2) < 1e-9);
  assert.ok(Math.abs(kr.niG - 0.25) < 1e-9, '추정 PER 8배 → 이익 +25% 전망');
  assert.equal(kr.cashY, 0.025);
  assert.equal(stockMetrics({ cap: 0, p: 1 }, {}, 'US'), null);

  assert.equal(isPreferredKr({ s: '005935', n: '삼성전자우' }), true);
  assert.equal(isPreferredKr({ s: '005387', n: '현대차2우B' }), true);
  assert.equal(isPreferredKr({ s: '005930', n: '삼성전자' }), false);
});

// 가상 지수 — 정보기술 7종목(적당히 싸고 성장하는 CHEAP, 비싼 PRICY, 적자 LOSS) + 필수소비재 6 + 금융 3 + 에너지 2 + 재무 없음 1
function universe() {
  const items = [], bySymbol = {};
  const add = (s, sec, cap, f) => { items.push({ s, n: `${s} Inc.`, sec, cap, p: cap / 100, c: 0 }); bySymbol[s] = f; };
  const tech = (ni, ni0, rev, rev0, eq) => ({ ni, ni0, rev, rev0, oi: ni * 1.3, da: ni * 0.2, equity: eq, debt: ni, cash: ni * 0.5, ocf: ni * 1.4, capex: ni * 0.3 });
  add('CHEAP', '정보기술', 1000, tech(60, 45, 600, 450, 400));   // PER 16.7(섹터 약 24), 이익 +33%
  add('T2', '정보기술', 1000, tech(40, 38, 500, 480, 300));
  add('T3', '정보기술', 1200, tech(50, 45, 520, 500, 350));
  add('T4', '정보기술', 900, tech(35, 34, 400, 390, 250));
  add('T5', '정보기술', 1100, tech(45, 40, 450, 430, 320));
  add('PRICY', '정보기술', 3000, tech(30, 29, 300, 295, 150));   // PER 100
  add('LOSS', '정보기술', 800, { ...tech(10, 20, 200, 190, 100), ni: -20 });
  const staple = (ni, eq) => ({ ni, ni0: ni * 0.98, rev: ni * 10, rev0: ni * 9.8, oi: ni * 1.4, da: ni * 0.3, equity: eq, debt: ni * 2, cash: ni * 0.2, ocf: ni * 1.3, capex: ni * 0.4 });
  ['S1', 'S2', 'S3', 'S4', 'S5', 'S6'].forEach((s, i) => add(s, '필수소비재', 800 + i * 50, staple(40 + i * 2, 300)));
  ['F1', 'F2', 'F3'].forEach((s, i) => add(s, '금융', 900 + i * 100, { ni: 80 + i * 5, ni0: 75, equity: 900, rev: 400, rev0: 380 }));
  ['E1', 'E2'].forEach((s, i) => add(s, '에너지', 700 + i * 100, staple(50 + i * 5, 400)));
  add('BOOM', '필수소비재', 900, { ...staple(45, 300), rev: 900, rev0: 300 });   // 매출 +200% — 일회성·인수합병 경고
  add('NODATA', '정보기술', 500, null);
  return { market: { index: 'TEST', label: 'TEST', market: 'US', currency: 'USD', asOf: null, fetchedAt: '2026-09-15T00:00:00Z', items }, fund: { builtAt: '2026-09-15T00:00:00Z', source: 'test', periods: { fy: 2025, inst: ['CY2026Q2I'] }, bySymbol } };
}

test('분석: 싼 성장주가 적자·고평가보다 점수·상승여력이 높고, 비교 대상·제한·시나리오 폭 규칙을 따름', () => {
  const { market, fund } = universe();
  const r = analyzeIndex({ market, fund, regime: { vix: 20, trendPct: 5, trendLabel: 'TEST 연초 대비' } });
  const by = Object.fromEntries(r.stocks.map(x => [x.s, x]));
  assert.equal(r.coverage.total, 20);
  assert.equal(r.coverage.analyzed, 19, '재무가 없는 종목은 분석 제외');
  assert.equal(by.NODATA.na, true);

  assert.ok(by.CHEAP.score > by.PRICY.score && by.CHEAP.score > by.LOSS.score, '점수');
  assert.ok(by.CHEAP.expUpside > 0 && by.PRICY.expUpside < 0, '싼 종목은 상승여력, 비싼 종목은 하락여력');
  assert.equal(by.PRICY.clamped, true, '적정가가 현재가 0.4배 밑이면 제한');
  assert.ok(Math.abs(by.PRICY.fair - by.PRICY.p * FAIR_RANGE[0]) < 0.01);
  assert.equal(by.PRICY.confidence, '낮음');
  assert.equal(by.LOSS.metrics.loss, true);
  assert.ok(by.LOSS.reasons.includes('최근 적자'));
  assert.ok(by.CHEAP.methods.per != null && by.CHEAP.methods.ev != null && by.CHEAP.methods.pbr != null, '세 방식 모두 계산');
  assert.equal(by.CHEAP.confidence, '높음');
  assert.equal(by.F1.methods.ev, undefined, '금융은 EV/EBITDA 방식 제외');
  assert.equal(by.T2.peer.group, '정보기술', '6종목 이상이면 섹터 중앙값');
  assert.equal(by.F1.peer.group, '금융·지수 보정', '3~5종목 섹터는 지수 중앙값과 섞음');
  assert.equal(by.E1.peer.group, '지수 전체', '3종목 미만 섹터는 지수 전체');
  assert.equal(by.BOOM.oneOff, true);
  assert.ok(by.BOOM.reasons.includes('일회성·인수합병 영향 가능'));

  // 시나리오 폭: 기술(β 1.25) > 필수소비재(β 0.6)
  const spread = x => (x.fairBull - x.fairBear) / x.fair;
  assert.ok(spread(by.T3) > spread(by.S3));
  const bull = SCENARIOS.find(s => s.key === 'bull');
  assert.ok(Math.abs(by.T3.fairBull - by.T3.fair * (1 + bull.multK * SECTOR_BETA.정보기술) * (1 + bull.earnK * SECTOR_BETA.정보기술)) < 0.02);
  assert.equal(r.scenarios.reduce((a, s) => a + s.prob, 0).toFixed(2), '1.00');
  assert.ok(r.scenarios.every(s => s.medImpact != null && s.capImpact != null));

  // 추천: 상승여력 플러스·섹터당 1종목·일회성 경고 제외, 섹터 TOP은 3종목 이상 섹터만
  assert.ok(r.top.length >= 1 && r.top.length <= 3);
  assert.ok(r.top.every(s => by[s].expUpside > 0));
  assert.ok(!r.top.includes('BOOM'), '일회성 성장 경고 종목은 후보가 충분하면 제외');
  const secs = r.top.map(s => by[s].sec);
  assert.equal(new Set(secs).size, secs.length, '섹터당 1종목');
  assert.equal(r.top[0], 'CHEAP');
  assert.ok(r.topSectors.every(name => r.sectors.find(x => x.name === name).count >= 3));
  const s0 = r.sectors.find(x => x.name === r.topSectors[0]);
  assert.ok(s0.drivers && s0.drivers.momentum != null, '섹터 전망 구성 요소');
  const parts = by.CHEAP.parts;
  assert.ok(Math.abs(parts.sector + parts.value + parts.growth + parts.quality + parts.traits - by.CHEAP.score) < 0.3, '점수 = 요소 합');
  assert.match(r.fundamentals.label, /FY2025/);
});

test('국내: 우선주는 분석 제외하고 사유 표시', () => {
  const items = [{ s: '005930', n: '삼성전자', cap: 1e15, p: 250000 }, { s: '005935', n: '삼성전자우', cap: 1e14, p: 200000 }];
  const f = { per: 11, pbr: 2.9, sector: '정보기술', industry: '반도체와반도체장비' };
  const r = analyzeIndex({ market: { index: 'KOSPI', label: 'KOSPI', market: 'KR', currency: 'KRW', items }, fund: { bySymbol: { '005930': f, '005935': f } } });
  const pref = r.stocks.find(x => x.s === '005935');
  assert.equal(pref.na, true);
  assert.equal(pref.naReason, '우선주');
  assert.equal(r.coverage.preferred, 1);
  assert.equal(r.stocks.find(x => x.s === '005930').sec, '정보기술');
});

test('재무 수집 파서: SEC 기간·frames 병합, 네이버 연간·종목 정보, 업종 → 섹터', async () => {
  assert.deepEqual(secPeriods(new Date('2026-09-15T00:00:00Z')), { fy: 2025, cur: 'CY2025', prev: 'CY2024', inst: ['CY2026Q2I', 'CY2025Q4I'] });
  assert.deepEqual(secPeriods(new Date('2026-03-01T00:00:00Z')), { fy: 2024, cur: 'CY2024', prev: 'CY2023', inst: ['CY2025Q3I', 'CY2024Q4I'] }, '4분기말 뒤 60일(75일 미만)이면 3분기말');
  const merged = mergeFrames([{ data: [{ cik: 1, val: 10 }, { cik: 9, val: 99 }] }, null, { data: [{ cik: 1, val: 20 }, { cik: 2, val: 30 }] }], new Set([1, 2]));
  assert.deepEqual([...merged].map(([k, v]) => [k, v.val]), [[1, 10], [2, 30]], '앞 항목 우선, 대상 외 CIK 제외');

  const annual = { financeInfo: { trTitleList: [{ key: '202412', isConsensus: 'N' }, { key: '202512', isConsensus: 'N' }, { key: '202612', isConsensus: 'Y' }], rowList: [
    { title: '매출액', columns: { 202412: { value: '3,008,709' }, 202512: { value: '3,336,059' }, 202612: { value: '7,396,375' } } },
    { title: '영업이익', columns: { 202412: { value: '327,260' }, 202512: { value: '436,011' }, 202612: { value: '-' } } },
    { title: '지배주주순이익', columns: { 202412: { value: '336,214' }, 202512: { value: '442,610' }, 202612: { value: '-' } } },
    { title: 'ROE', columns: { 202512: { value: '10.85' } } },
  ] } };
  const a = parseNaverAnnual(annual);
  assert.equal(a.fy, '202512');
  assert.equal(a.rev, 3336059);
  assert.equal(a.revFwd, 7396375);
  assert.equal(a.oiFwd, null, '「-」는 값 없음');
  assert.equal(a.ni0, 336214);
  const ig = parseNaverIntegration({ industryCode: '278', totalInfos: [{ code: 'per', value: '11.25배' }, { code: 'pbr', value: '2.91배' }, { code: 'cnsPer', value: '5.20배' }, { code: 'dividendYieldRatio', value: '0.67%' }, { code: 'eps', value: '-1,234원' }] });
  assert.deepEqual([ig.per, ig.pbr, ig.cnsPer, ig.divYield, ig.eps, ig.industryCode], [11.25, 2.91, 5.2, 0.67, -1234, 278]);
  assert.equal(krSectorOf('반도체와반도체장비'), '정보기술');
  assert.equal(krSectorOf('은행'), '금융');
  assert.equal(krSectorOf('가스유틸리티'), '유틸리티', '유틸리티를 에너지보다 먼저');
  assert.equal(krSectorOf('화장품'), '필수소비재');
  assert.equal(krSectorOf('조선'), '산업재');
  assert.equal(krSectorOf(null), '기타');

  // SEC 수집: 티커 → CIK, 항목별 frames(없는 항목 404) → 종목별 값
  const frames = {
    'NetIncomeLoss/USD/CY2025': [{ cik: 320193, val: 112e9, end: '2025-09-27' }, { cik: 1067983, val: 90e9, end: '2025-12-31' }],
    'NetIncomeLoss/USD/CY2024': [{ cik: 320193, val: 94e9 }],
    'Revenues/USD/CY2025': [{ cik: 1067983, val: 370e9 }],
    'RevenueFromContractWithCustomerExcludingAssessedTax/USD/CY2025': [{ cik: 320193, val: 416e9 }],
    'StockholdersEquity/USD/CY2026Q2I': [{ cik: 320193, val: 90e9 }],
    'StockholdersEquity/USD/CY2025Q4I': [{ cik: 320193, val: 88e9 }, { cik: 1067983, val: 650e9 }],
  };
  const fetchImpl = async url => {
    if (url === SEC_TICKERS_URL) return Response.json({ 0: { cik_str: 320193, ticker: 'AAPL' }, 1: { cik_str: 1067983, ticker: 'BRK-B' } });
    const key = Object.keys(frames).find(k => { const [c, u, p] = k.split('/'); return url === secFrameUrl(c, u, p); });
    return key ? Response.json({ data: frames[key] }) : new Response('없음', { status: 404 });
  };
  const us = await buildUsFundamentals({ symbols: ['AAPL', 'BRK.B', 'ZZZZ'], fetchImpl, now: new Date('2026-09-15T00:00:00Z') });
  assert.equal(us.count, 2, '티커가 없는 종목은 빠짐');
  assert.deepEqual([us.bySymbol.AAPL.ni, us.bySymbol.AAPL.ni0, us.bySymbol.AAPL.rev, us.bySymbol.AAPL.equity], [112e9, 94e9, 416e9, 90e9], '재무상태는 최근 분기말 우선');
  assert.equal(us.bySymbol['BRK.B'].equity, 650e9, '최근 분기말 값이 없으면 직전 연말');
  assert.equal(us.bySymbol['BRK.B'].rev, 370e9, '매출 항목 이름이 달라도 찾음');
});
