// 시장 흐름 대시보드(api/_flow.mjs · jinga-flow.mjs) 스모크 테스트 — 원천 응답은 가짜(네트워크 없음)
import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePriceIndex, parseMarketTrend, parseMonthlyRegions, parseLead50, parseHai, parseNaverRates, alignSeries, loadFlow, createFlowSource, mergeMissing, kbDate, KB_BASE, NAVER_BASE, buildAnnual, yearChanges, yearMeans, yearEnds, tailWeekly } from '../site/public/api/_flow.mjs';
import { points, rebase, changes, lastTwo, sinceFor, buildSpec, CHARTS, ANNUAL_CHARTS, toTime } from '../site/public/jinga-flow.mjs';

const ok = data => ({ dataHeader: { resultCode: '10000', message: 'NO_ERROR' }, dataBody: { data } });
const W = ['20260824', '20260831', '20260907'];
const region = (name, dataList, extra = {}) => ({ 지역코드: '1', 지역명: name, dataList, ...extra });
const priceJson = (seoul, gangnam) => ok({ 업데이트일자: '20260907', 날짜리스트: W, 데이터리스트: [region('전국', [100, 100.1, 100.2, 0.1]), region('서울', seoul), region('강남11개구', gangnam), region('부산', [1, 2, 3, 4])] });
const trendJson = (field, vals) => ok({ 업데이트일자: '20260907', 날짜리스트: W, 데이터리스트: [region('서울', W.map((d, i) => ({ 기준날짜: d, [field]: vals[i], 매수자많음: 1 })))] });

test('KB 가격지수: 끝에 붙은 증감률은 버리고 필요한 지역만', () => {
  const p = parsePriceIndex(priceJson([108.6, 108.894829, 109.1331461, 0.2188], [110, 111, 112, 0.9]));
  assert.deepEqual(p.dates, ['2026-08-24', '2026-08-31', '2026-09-07']);
  assert.deepEqual(p.regions.서울, [108.6, 108.89, 109.13]);
  assert.equal(p.regions.부산, undefined);
  assert.equal(p.updated, '2026-09-07');
  assert.throws(() => parsePriceIndex({ dataHeader: { resultCode: '10400' }, dataBody: { data: { message: ['필수값 오류'] } } }), /10400.*필수값/);
  assert.equal(kbDate('202608'), '2026-08');
});

test('KB 시장동향·월간·선도50·HAI 파싱과 날짜 맞춤', () => {
  const t = parseMarketTrend(trendJson('매수우위지수', [78.9194, 77.957, 75.8548]), '매수우위지수');
  assert.deepEqual(t.regions.서울, [78.92, 77.96, 75.85]);
  assert.deepEqual(alignSeries(['2026-08-31', '2026-09-07', '2026-09-14'], t.dates, t.regions.서울), [77.96, 75.85, null]);

  const months = Array.from({ length: 80 }, (_, i) => `20${String(20 + Math.floor(i / 12)).padStart(2, '0')}${String(i % 12 + 1).padStart(2, '0')}`);
  const m = parseMonthlyRegions(ok({ 업데이트일자: '20260810', 날짜리스트: months, 데이터리스트: [region('서울', months.map((_, i) => 40 + i / 10))] }), 72);
  assert.equal(m.dates.length, 72);
  assert.equal(m.dates[71], kbDate(months[79]));
  assert.equal(m.regions.서울[71], 47.9);

  const l = parseLead50(ok({ 업데이트일자: '20260810', 날짜리스트: ['202607', '202608'], 선도50지수리스트: [99.245, 99.444], 전월대비증감률리스트: [0.38, 0.2], 전년동월대비증감률리스트: [6.948, 5.443] }));
  assert.deepEqual(l.index, [99.25, 99.44]);
  assert.deepEqual(l.yoy, [6.95, 5.44]);

  const h = parseHai(ok({
    업데이트일자: '20260613', 날짜리스트: ['202605', '202606'],
    주담보월소득리스트: [{ 주택담보대출금리: 4.32, 기준날짜: '202605' }, { 주택담보대출금리: 4.36, 기준날짜: '202606' }],
    주택구매력리스트: [{ 지역명: '서울', 지역구분리스트: [{ 매물종별구분: '종합', 매물종별구분리스트: [61.19, 60.44] }, { 매물종별구분: '아파트', 매물종별구분리스트: [37.061, 36.444] }] }],
  }));
  assert.deepEqual(h.apt.서울, [37.1, 36.4], '아파트만');
  assert.deepEqual(h.loanRate, [4.32, 4.36]);
});

test('네이버 금리: 여러 페이지를 날짜 오름차순으로 합치고 중복 제거', () => {
  const pts = parseNaverRates([
    { result: [{ localTradedAt: '2026-09-14T16:08:06+09:00', closePrice: '4.0150' }, { localTradedAt: '2026-09-11T16:19:07+09:00', closePrice: '4.0230' }] },
    { result: [{ localTradedAt: '2026-09-11T10:00:00+09:00', closePrice: '9.9' }, { localTradedAt: '2026-09-10T16:00:00+09:00', closePrice: '1,004.5' }] },
  ]);
  assert.deepEqual(pts, [['2026-09-10', 1004.5], ['2026-09-11', 4.023], ['2026-09-14', 4.015]]);
});

function fakeFetch({ failKb = new Set(), failRates = false } = {}) {
  const calls = [];
  const respond = body => ({ ok: true, status: 200, json: async () => body });
  const f = async url => {
    calls.push(url);
    const u = new URL(url);
    if (url.startsWith(NAVER_BASE)) {
      if (failRates) return { ok: false, status: 500, json: async () => ({}) };
      const code = u.searchParams.get('reutersCode');
      return respond({ isSuccess: true, result: [{ localTradedAt: '2026-09-14T16:00:00+09:00', closePrice: code === 'KR3YT=RR' ? '4.01' : '3.1' }, { localTradedAt: '2025-09-12T16:00:00+09:00', closePrice: '2.5' }] });
    }
    assert.ok(url.startsWith(KB_BASE));
    const ep = u.pathname.split('/').pop();
    if (failKb.has(ep)) return { ok: false, status: 500, json: async () => ({}) };
    const menu = u.searchParams.get('메뉴코드');
    if (ep === 'priceIndex') return respond(u.searchParams.get('매매전세코드') === '01' ? priceJson([108.6, 108.9, 109.13, 0.2], [110, 111, 112, 0.9]) : priceJson([107.5, 107.7, 107.93, 0.2], [100, 100, 100, 0]));
    if (ep === 'maktTrnd') {
      const field = { '01': '매수우위지수', '02': '매매거래지수', '03': '전세수급지수', '04': '전세거래지수' }[menu];
      return respond(trendJson(field, [80, 78, 76]));
    }
    if (ep === 'dealCntstTnantRato') return respond(ok({ 업데이트일자: '20260810', 날짜리스트: ['202607', '202608'], 데이터리스트: [region('서울', [50.41, 50.39]), region('전국', [66, 66.1])] }));
    if (ep === 'leadApt50Indx') return respond(ok({ 업데이트일자: '20260810', 날짜리스트: ['202607', '202608'], 선도50지수리스트: [99.2, 99.4], 전월대비증감률리스트: [0.4, 0.2], 전년동월대비증감률리스트: [6.9, 5.4] }));
    if (ep === 'HAI') return respond(ok({ 업데이트일자: '20260613', 날짜리스트: ['202605', '202606'], 주담보월소득리스트: [{ 주택담보대출금리: 4.32, 기준날짜: '202605' }, { 주택담보대출금리: 4.36, 기준날짜: '202606' }], 주택구매력리스트: [{ 지역명: '서울', 지역구분리스트: [{ 매물종별구분: '아파트', 매물종별구분리스트: [37, 36.4] }] }, { 지역명: '전국', 지역구분리스트: [{ 매물종별구분: '아파트', 매물종별구분리스트: [121.8, 121.4] }] }] }));
    throw new Error('unexpected ' + url);
  };
  f.calls = calls;
  return f;
}

test('loadFlow: 원천을 합쳐 지역별 주간 행을 만들고, 일부 실패는 errors 로', async () => {
  const f = fakeFetch({ failKb: new Set(['leadApt50Indx']) });
  const d = await loadFlow({ fetch: f, now: () => new Date('2026-09-15T00:00:00Z') });
  assert.deepEqual(d.weekly.dates, ['2026-08-24', '2026-08-31', '2026-09-07']);
  const s = d.weekly.regions.서울;
  assert.deepEqual(s.sale, [108.6, 108.9, 109.13]);
  assert.deepEqual(s.jeonse, [107.5, 107.7, 107.93]);
  assert.deepEqual(s.buyer, [80, 78, 76]);
  assert.ok(s.jeonseSupply && s.jeonseTrade && s.trade);
  assert.equal(d.weekly.regions.강남11개구.buyer, null, '시장동향에 없는 지역은 null');
  assert.equal(d.monthly.lead50, null);
  assert.ok(d.errors.some(e => e.includes('lead50')));
  assert.deepEqual(d.rates.KR3YT.points, [['2025-09-12', 2.5], ['2026-09-14', 4.01]]);
  assert.equal(f.calls.filter(u => u.includes('reutersCode=KR3YT')).length, 1, '60행 미만이면 다음 페이지를 부르지 않음');
  assert.ok(f.calls.some(u => decodeURIComponent(u).includes('기간=10')), '주간은 연도별 지표용 10년치');
  assert.ok(d.annual && Array.isArray(d.annual.years), '연도별 블록');

  await assert.rejects(loadFlow({ fetch: fakeFetch({ failKb: new Set(['priceIndex', 'maktTrnd', 'dealCntstTnantRato', 'leadApt50Indx', 'HAI']), failRates: true }) }), /KB|네이버/);
});

test('createFlowSource: 캐시·동시 요청 합치기·실패 시 직전 값', async () => {
  let t = 0, n = 0, fail = false;
  const base = { weekly: { dates: ['2026-09-07'], regions: {} }, monthly: { ratio: { dates: [] }, lead50: { dates: [] }, hai: null }, rates: { KR3YT: { points: [] } }, errors: [] };
  const src = createFlowSource({ ttlMs: 1000, now: () => t, load: async () => { n++; if (fail) throw new Error('down'); return n === 1 ? base : { ...base, monthly: { ratio: null, lead50: null, hai: null }, rates: {} }; } });
  const [a, b] = await Promise.all([src.get(), src.get()]);
  assert.equal(n, 1); assert.equal(a, b);
  t = 500; await src.get(); assert.equal(n, 1, 'TTL 안에서는 다시 부르지 않음');
  t = 2000;
  const c = await src.get();
  assert.equal(n, 2);
  assert.ok(c.monthly.ratio && c.rates.KR3YT, '빠진 부분은 직전 값으로');
  assert.deepEqual(c.staleParts.sort(), ['KR3YT', 'lead50', 'ratio']);
  t = 4000; fail = true;
  const e = await src.get();
  assert.equal(e.stale, true); assert.equal(e.error, 'down');
  assert.equal(mergeMissing(base, null), base);
});

test('연도별 지표: 전년 말 대비 변동률·연평균·연말 값, 올해는 연초~기준일, 화면용 주간은 최근 n주', () => {
  const dates = ['2024-12-30', '2025-06-30', '2025-12-29', '2026-09-07'];
  assert.deepEqual(yearChanges(dates, [100, 104, 110, 115.5], [2025, 2026]), [10, 5]);
  assert.deepEqual(yearMeans(dates, [100, 104, 110, 115.5], [2025, 2026]), [107, 115.5]);
  assert.deepEqual(yearMeans(dates, [100, 104, 110, 115.5], [2025], 3), [null], '표본이 적은 해는 제외');
  assert.deepEqual(yearEnds(['2025-11', '2025-12', '2026-08'], [50, 51, 52], [2025, 2026]), [51, 52]);

  const reg = vals => ({ 서울: vals, 강남11개구: vals.map(v => v * 1.1) });
  const got = {
    sale: { dates, regions: reg([100, 104, 110, 115.5]) },
    jeonse: { dates, regions: reg([100, 101, 102, 103]) },
    buyer: { dates, regions: reg([40, 60, 80, 70]) },
    jeonseSupply: { dates, regions: reg([150, 160, 170, 180]) },
    ratio: { dates: ['2024-12', '2025-12', '2026-08'], regions: { 서울: [52, 51, 50.4] } },
    lead50: { dates: ['2024-12', '2025-12', '2026-08'], index: [90, 99, 104.94] },
  };
  const cofix2025 = Array.from({ length: 12 }, (_, i) => [`2025-${String(i + 1).padStart(2, '0')}-15`, 3]);
  const a = buildAnnual(got, {
    COFIX: { name: 'COFIX 신규취급액', points: [...cofix2025, ['2026-06-15', 3.1], ['2026-07-15', 3.2], ['2026-08-18', 3.18]] },
    KR3YT: { name: '국고채 3년', points: Array.from({ length: 40 }, (_, i) => [`2025-10-${String((i % 28) + 1).padStart(2, '0')}`, 2.5]) },
  });
  assert.deepEqual(a.years, [2025, 2026], '주간 시작 다음 해부터');
  assert.equal(a.ytdYear, 2026);
  assert.deepEqual(a.regions.서울.saleChg, [10, 5]);
  assert.deepEqual(a.regions.서울.buyerAvg, [70, 70]);
  assert.deepEqual(a.regions.서울.ratioEnd, [51, 50.4]);
  assert.deepEqual(a.lead50Chg, [10, 6]);
  assert.deepEqual(a.rates.COFIX.avg, [3, 3.16], 'COFIX: 지난 해는 10개월 이상, 올해는 3개월 이상');
  assert.deepEqual(a.rates.KR3YT.avg, [null, null], '일별 금리가 한 해에 40일뿐이면 연평균으로 쓰지 않음');
  assert.equal(buildAnnual({}, {}), null);

  const data = { annual: a };
  for (const c of ANNUAL_CHARTS) {
    const spec = buildSpec(c.id, data, { region: '서울' });
    assert.ok(spec && spec.yearly, c.id);
    assert.equal(spec.ytd, 2026);
  }
  const price = buildSpec('a-price', data, { region: '서울' });
  assert.equal(price.latest.value, '+5.00%');
  assert.match(price.latest.sub, /^2026년\(연초~09\.07\) 매매 · 전세 \+0\.98%$/);
  assert.equal(buildSpec('a-price', { annual: null }, { region: '서울' }), null);

  const w = tailWeekly({ dates: ['a', 'b', 'c'], updated: 'x', regions: { 서울: { sale: [1, 2, 3], buyer: null } } }, 2);
  assert.deepEqual([w.dates, w.regions.서울.sale, w.regions.서울.buyer], [['b', 'c'], [2, 3], null]);
});

test('대시보드 계산: 기간 자르기·100 기준·변동률·최근 두 값', () => {
  const dates = ['2026-08-24', '2026-08-31', '2026-09-07'];
  const pts = points(dates, [100, null, 102], toTime('2026-08-30'));
  assert.deepEqual(pts.map(p => p.y), [null, 102]);
  assert.deepEqual(rebase(points(dates, [50, 55, 60])).map(p => p.y), [100, 110, 120]);
  assert.deepEqual(changes(points(dates, [100, 101, 99.99])).map(p => p.y), [1, -1]);
  assert.deepEqual(lastTwo(dates, [100, 101, null]), { date: '2026-08-31', value: 101, prev: 100, prevDate: '2026-08-24' });
  assert.equal(sinceFor({ weekly: { dates } }, '6m'), toTime('2026-09-07') - 183 * 864e5);
});

test('대시보드 그래프 구성: 받은 데이터로 9개 그래프가 모두 그려지고, 없는 지표는 null', async () => {
  const data = await loadFlow({ fetch: fakeFetch() });
  const opts = { region: '서울', since: -Infinity };
  for (const c of CHARTS) {
    const spec = buildSpec(c.id, data, opts);
    assert.ok(spec, `${c.id} 구성`);
    assert.ok(spec.latest && spec.latest.value, `${c.id} 최신값`);
  }
  assert.equal(buildSpec('price', data, opts).latest.value, '109.13');
  assert.match(buildSpec('buyer', data, opts).latest.sub, /매도자 우위/);
  assert.equal(buildSpec('regions', data, { region: '강남11개구', since: -Infinity }).latest.value, '+1.82%');
  assert.equal(buildSpec('buyer', data, { region: '강남11개구', since: -Infinity }), null, '시장동향이 없는 지역');
  assert.equal(buildSpec('lead50', { ...data, monthly: { ...data.monthly, lead50: null } }, opts), null);
  assert.equal(buildSpec('rates', data, opts).latest.value, '4.01%');
});
