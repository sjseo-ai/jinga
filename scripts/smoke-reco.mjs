// 진가 매물 추천(jinga-reco.mjs) 스모크 테스트 — 네트워크 없음
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseQuery, findComplexes, pickType, candidateScope, recommend, locPP, eligibleComplexes, compareHomes, scoreHome, fmtEok, SIMILAR_MARGIN, infraOf, infraText, stationScore, schoolScore, annualNotes, rentPct, rentText, rentOk, MAX_RECO_GUS } from '../site/public/jinga-reco.mjs';
import { updateAnnual, complexYearView } from '../site/public/api/_annual.mjs';
import { distM, parseZone, inZone, mergeStations, complexMetrics } from './build-kb-infra.mjs';

const DIR = [
  [1293, '상도동삼호', '동작구', '상도동', 0, 295, 23],
  [1, '상도더샵', '동작구', '상도동', 0, 250, 20],
  [2, '삼호', '서초구', '방배동', 1, 200, 20],
  [3, '래미안상도3차', '동작구', '상도동', 0, 230, 18],
  [4, '신대방우성', '동작구', '신대방동', 0, 280, 22],
  [5, '헬리오시티', '송파구', '가락동', 0, 285, 19],
  [6, '작은단지', '동작구', '상도동', 1, 200, 30],
];

test('단지 검색: 동 이름을 섞어 쓰거나 평형을 붙여도 찾음', () => {
  assert.deepEqual(parseQuery('상도삼호아파트 31평형'), { text: '상도삼호아파트', size: 31, unit: '평' });
  assert.deepEqual(parseQuery('헬리오시티 84㎡'), { text: '헬리오시티', size: 84, unit: '㎡' });
  assert.deepEqual(parseQuery('헬리오시티 84'), { text: '헬리오시티', size: 84, unit: '' });
  assert.deepEqual(parseQuery('래미안상도3차'), { text: '래미안상도3차', size: 0, unit: '' }, '이름 속 짧은 숫자는 크기로 보지 않음');
  assert.equal(findComplexes(DIR, '상도삼호아파트')[0][0], 1293);
  assert.equal(findComplexes(DIR, '상도동 삼호')[0][0], 1293);
  assert.equal(findComplexes(DIR, '헬리오')[0][0], 5);
  const samho = findComplexes(DIR, '삼호').map(c => c[0]);
  assert.deepEqual(samho.slice(0, 2), [2, 1293], '이름이 정확히 같은 단지가 먼저(50세대 미만 −5점을 받아도 부분 일치보다 앞)');
  assert.deepEqual(findComplexes(DIR, '가'), [], '한 글자는 검색 안 함');
});

const types = [
  { excl: 83.89, supPy: '31', price: 117000, jeonse: 65000, hh: 17, provided: true, areaId: 94277 },
  { excl: 114.63, supPy: '41', price: 125000, jeonse: 70000, hh: 204, provided: true, areaId: 128404 },
];
test('평형 고르기: 공급평형·전용㎡ 어느 쪽이든, 없으면 -1', () => {
  assert.equal(pickType(types, { size: 31, unit: '평' }), 0);
  assert.equal(pickType(types, { size: 114, unit: '㎡' }), 1);
  assert.equal(pickType(types, { size: 84, unit: '' }), 0);
  assert.equal(pickType(types, { size: 59, unit: '평' }), -1, '상도동삼호에 59평형·59㎡ 없음');
  assert.equal(pickType(types, null), -1);
});

const GU = {
  gu: {
    동작구: { avgPerPyeong: 5500, dongs: [{ name: '상도동', avgPerPyeong: 6400 }, { name: '신대방동', avgPerPyeong: 4700 }] },
    송파구: { avgPerPyeong: 8000, dongs: [{ name: '가락동', avgPerPyeong: 7600 }] },
    서초구: { avgPerPyeong: 9000, dongs: [{ name: '방배동', avgPerPyeong: 20000 }] },
  },
};

test('비교 단지 범위: 기준 동 먼저, 평당가 가까운 동 순, 너무 비싼 동·50세대 미만·기준 단지는 제외', () => {
  const target = { id: 1293, gu: '동작구', dong: '상도동', t: types[0] };
  const s = candidateScope(target, DIR, GU);
  assert.equal(s.dongs[0].dong, '상도동');
  assert.deepEqual(s.rows.map(c => c[0]), [1, 3, 4, 5]);
  assert.ok(!s.dongs.some(d => d.dong === '방배동'), '평당가 4배 동 제외');
  const capped = candidateScope(target, DIR, GU, { max: 3 });
  assert.equal(capped.rows.length, 3); assert.equal(capped.capped, true);
  assert.deepEqual(candidateScope(target, DIR, GU, { scope: 'gu' }).rows.map(c => c[0]), [1, 3, 4]);
  assert.deepEqual(candidateScope(target, DIR, null).rows.map(c => c[0]), [1, 3, 4], 'KB 집계가 없으면 같은 구');
  assert.equal(locPP(GU, '동작구', '없는동'), 5500);
});

const brief = (built, households, interest = 100) => ({ built, households, rebuild: false, interest });
const T = (excl, price, jeonse, extra = {}) => ({ excl, supPy: '', price, jeonse, hh: 100, provided: true, areaId: excl, ...extra });

test('추천: 가격·면적 범위 안에서 단지당 1개, 기준 −3점 이상만 TOP, 모자라면 참고 후보', () => {
  const target = { c: { id: 1293, gu: '동작구', dong: '상도동', far: 295, types, brief: brief(1994, 682) }, t: types[0] };
  const cands = [
    { id: 1, name: '상도더샵', gu: '동작구', dong: '상도동', far: 250, brief: brief(2019, 1500, 400), types: [T(84.9, 120000, 70000), T(59.9, 95000, 60000)] },
    { id: 3, name: '래미안상도3차', gu: '동작구', dong: '상도동', far: 230, brief: brief(2004, 900), types: [T(84.5, 110000, 62000), T(84.5, 131000, 70000)] },
    { id: 4, name: '신대방우성', gu: '동작구', dong: '신대방동', far: 200, brief: brief(1992, 300, 10), types: [T(84.9, 108000, 50000)] },
    { id: 5, name: '헬리오시티', gu: '송파구', dong: '가락동', far: 285, brief: brief(2018, 9510, 2000), types: [T(49, 118000, 70000)] },
    { id: 7, name: '너무비쌈', gu: '동작구', dong: '상도동', far: 200, brief: brief(2020, 1000), types: [T(84, 200000, 90000)] },
  ];
  assert.deepEqual(eligibleComplexes(types[0], cands, { band: 0.1, areaMin: 0.85, areaMax: 1.35 }).map(c => c.id), [1, 3, 4]);
  const r = recommend(target, cands, { band: 0.1, guData: GU, thisYear: 2026 });
  assert.equal(r.eligibleCount, 3, '헬리오시티 49㎡(면적 −42%)·너무비쌈(+71%)은 빠짐');
  assert.equal(r.top[0].c.name, '상도더샵', '신축·대단지·관심도 높음');
  assert.ok(r.top.every(e => e.delta >= -SIMILAR_MARGIN));
  assert.equal(new Set(r.pool.map(e => e.c.id)).size, r.pool.length, '단지당 1개');
  const sangdo3 = r.pool.find(e => e.c.id === 3);
  assert.equal(sangdo3.t.price, 110000, '같은 면적이면 더 싼 주택형이 점수 높음(가성비)');
  assert.equal(r.top.length + r.alts.length, 3);
  assert.ok(r.alts.every(e => e.delta < -SIMILAR_MARGIN));
  const woo = r.pool.find(e => e.c.id === 4);
  const txt = woo.cmp.map(x => `${x.dir}:${x.text}`);
  assert.ok(txt.includes('better:9,000만 저렴'), txt.join(' | '));
  assert.ok(txt.includes('worse:동 시세 -27%'), txt.join(' | '));
  assert.ok(txt.includes('better:용적률 200% (재건축 여력)'), txt.join(' | '));
  assert.equal(recommend(target, cands, { band: 0.1, guData: GU, thisYear: 2026, minHh: 1000 }).pool.map(e => e.c.id).join(), '1', '세대수 조건');
});

test('점수·비교 세부', () => {
  const ref = { excl: 84, locPP: 6000 };
  const base = { c: { brief: brief(2000, 1000) }, t: T(84, 120000, 60000), hh: 1000, locPP: 6000 };
  const s = scoreHome(base, ref, 2026);
  assert.equal(s.parts.loc, 7.5); assert.equal(s.parts.space, 2.5);
  assert.equal(s.parts.station, 6, '입지 정보가 없으면 역세권 6점'); assert.equal(s.parts.school, 6);
  assert.equal(Object.values(s.parts).length, 9);
  base.score = s;
  const e = { c: { brief: brief(2000, 1000) }, t: T(84.5, 120500, 60000), hh: 1100, locPP: 6100 };
  e.score = scoreHome(e, ref, 2026);
  assert.deepEqual(compareHomes(e, base).map(x => x.dir), ['same', 'same', 'same', 'same', 'same']);
  assert.equal(fmtEok(-12000), '1억 2,000만');
});

// 통학구역: 사각형 하나(위도 37.48~37.50, 경도 126.95~126.97)에 가운데 구멍
const ZONE = JSON.stringify({ type: 'MultiPolygon', coordinates: [[
  [[37.48, 126.95], [37.48, 126.97], [37.50, 126.97], [37.50, 126.95], [37.48, 126.95]],
  [[37.489, 126.959], [37.489, 126.961], [37.491, 126.961], [37.491, 126.959], [37.489, 126.959]],
]] });

test('입지 파일 만들기: 거리·통학구역(구멍 제외)·역 합치기·단지별 지표', () => {
  assert.ok(Math.abs(distM(37.4935687, 126.9575966, 37.4963827, 126.9535202) - 477) <= 5, '상도동삼호 → 숭실대입구 약 477m');
  const polys = parseZone(ZONE);
  assert.equal(inZone(37.485, 126.955, polys), true);
  assert.equal(inZone(37.490, 126.960, polys), false, '구멍 안');
  assert.equal(inZone(37.51, 126.955, polys), false);
  assert.deepEqual(parseZone('깨진값'), []);

  const st = mergeStations([
    { 지하철역명: '사당', 지하철호선명: '서울-2호선', wgs84위도: '37.4765', wgs84경도: '126.9816' },
    { 지하철역명: '사당', 지하철호선명: '서울-4호선', wgs84위도: '37.4766', wgs84경도: '126.9818' },
    { 지하철역명: '숭실대입구', 지하철호선명: '서울-7호선', wgs84위도: '37.4963827', wgs84경도: '126.9535202' },
  ]);
  assert.deepEqual(st.map(s => `${s.name}:${s.lines.join('|')}`), ['사당:2호선|4호선', '숭실대입구:7호선']);

  const ctx = {
    stations: st,
    elems: [{ lat: 37.495, lng: 126.945, zones: [], bbox: null }, { lat: 37.486, lng: 126.956, zones: polys, bbox: [37.48, 37.50, 126.95, 126.97] }],
    mids: [{ lat: 37.49, lng: 126.95 }],
    academies: [{ lat: 37.4850, lng: 126.9560, count: 10 }, { lat: 37.4900, lng: 126.9600, count: 5 }, { lat: 37.60, lng: 127.0, count: 99 }],
  };
  const m = complexMetrics(37.485, 126.955, ctx);
  assert.equal(m[0], 1, '가까운 역 = 숭실대입구');
  assert.equal(m[2], 1, '통학구역 안 학교가 더 멀어도 배정');
  assert.equal(m[4], 1);
  assert.equal(m[7], 15, '반경 1km 학원만 합산');
  assert.equal(complexMetrics(37.51, 126.945, ctx)[4], 0, '구역 밖이면 가장 가까운 학교·zone 0');
});

const INFRA = {
  stations: [['숭실대입구', '7호선', 37.496, 126.953], ['사당', '2호선|4호선', 37.476, 126.981]],
  elems: [['서울신남성초등학교', 37.488, 126.965, 20], ['서울봉천초등학교', 37.483, 126.957, 19]],
  mids: [['서문여자중학교', 37.49, 126.95]],
  byId: { 1293: [0, 477, 0, 845, 1, 0, 700, 139], 1: [1, 250, 1, 250, 1, 0, 350, 600], 3: [0, 1500, 0, 1200, 0, 0, 1500, 10] },
};

test('추천 카드 연간 비교: 쌓인 기록이 있을 때만(올해 변동·작년 말 대비·학원·새 역)', () => {
  const map = { seoul: { avgPerPyeong: 1 }, gu: { 동작구: { avgPerPyeong: 1, dongs: [] } } };
  const cx = price => [{ id: 1293, name: '상도동삼호', gu: '동작구', dong: '상도동', types: [{ excl: 83.89, price, jeonse: 65000, provided: true }] }];
  let y26 = updateAnnual(null, { asOf: '2026.01.02', map, complexes: cx(110000) });
  y26 = updateAnnual(y26, { asOf: '2026.12.25', map, complexes: cx(117000) });
  let y27 = updateAnnual(null, { asOf: '2027.01.08', map, complexes: cx(118000) });
  y27 = updateAnnual(y27, { asOf: '2027.03.05', map, complexes: cx(120000) });
  const views = { 2026: complexYearView(y26, 1293), 2027: complexYearView(y27, 1293) };
  const inf = infraOf(INFRA, 1293);   // 역 477m · 학원 139곳

  const notes = annualNotes({ views, excl: 84.2, prevInfra: [900, 845, 1, 700, 120], inf });
  assert.deepEqual(notes.map(n => `${n.dir}:${n.text}`), [
    'up:2027년 KB +1.7%(01.08~03.05)',
    'up:작년 말 대비 +2.6%',
    'up:학원 전년 대비 +19곳',
    'up:가까운 역 423m 가까워짐(새 역)',
  ]);
  assert.deepEqual(annualNotes({ views: { 2027: complexYearView(updateAnnual(null, { asOf: '2027.01.08', map, complexes: cx(118000) }), 1293) }, excl: 84 }), [], '한 주뿐이면 올해 변동을 말하지 않음');
  assert.deepEqual(annualNotes({ views: null, excl: 84, prevInfra: null, inf }), [], '기록이 없으면 빈 줄');
  assert.deepEqual(annualNotes({ views, excl: 59, inf }).length, 0, '같은 면적 주택형이 없으면 없음');
});

test('역세권·학군 점수와 비교 칩', () => {
  const a = infraOf(INFRA, 1293);
  assert.deepEqual(a.station, { name: '숭실대입구', lines: ['7호선'], m: 477 });
  assert.equal(a.elem.zone, true); assert.equal(infraOf(INFRA, 999), null);
  assert.equal(stationScore(a), Math.round(15 * (1000 - 477) / 700 * 10) / 10 === stationScore(a) ? stationScore(a) : 15 * (1000 - 477) / 700);
  assert.equal(stationScore(infraOf(INFRA, 1)), 15, '250m 환승역은 만점');
  assert.equal(stationScore(infraOf(INFRA, 3)), 0, '1.5km');
  assert.equal(stationScore(null), 6);
  assert.ok(schoolScore(infraOf(INFRA, 1)) > schoolScore(a) && schoolScore(a) > schoolScore(infraOf(INFRA, 3)));
  assert.match(infraText(a, { maxFloor: 17, hall: '계단식' }), /^숭실대입구역\(7호선\) 477m·도보 7분 · 배정 신남성초 12분 · 서문여중 10분 · 학원 139곳\(1km\) · 최고 17층 · 계단식$/);

  const target = { c: { id: 1293, gu: '동작구', dong: '상도동', far: 295, types, brief: brief(1994, 682) }, t: types[0] };
  const cands = [
    { id: 1, name: '역세권대단지', gu: '동작구', dong: '상도동', far: 250, brief: brief(2005, 1500, 100), types: [T(84.5, 117000, 65000)] },
    { id: 3, name: '역에서먼곳', gu: '동작구', dong: '상도동', far: 250, brief: brief(2005, 1500, 100), types: [T(84.5, 117000, 65000)] },
  ];
  const r = recommend(target, cands, { band: 0.1, guData: GU, infra: INFRA, thisYear: 2026 });
  assert.deepEqual(r.pool.map(e => e.c.id), [1, 3], '같은 조건이면 역·학군이 좋은 곳이 앞');
  const near = r.pool[0].cmp.map(x => `${x.dir}:${x.text}`), far = r.pool[1].cmp.map(x => `${x.dir}:${x.text}`);
  assert.ok(near.includes('better:역 227m 더 가까움'), near.join(' | '));
  assert.ok(near.includes('better:환승역(2호선·4호선)'), near.join(' | '));
  assert.ok(near.includes('better:초품아(배정 초등 400m 이내)'), near.join(' | '));
  assert.ok(near.includes('better:학원 600곳(4.3배)'), near.join(' | '));
  assert.ok(far.includes('worse:역 1,023m 더 멂'), far.join(' | '));
  assert.ok(far.includes('worse:학원 10곳(8%)'), far.join(' | '));
  assert.equal(r.target.inf.station.m, 477);
});

test('도보 10분 안 역·초등학교 — 지도에 함께 찍을 목록', async () => {
  const m = await import('../site/public/jinga-reco.mjs');
  // [이름, 노선, 위도, 경도] · [이름, 위도, 경도, 학급수]
  const infra = {
    stations: [['대치', '3호선', 37.4949, 127.0631], ['학여울', '3호선', 37.4936, 127.0709], ['수서', '3호선|수인분당선', 37.4873, 127.1016]],
    elems: [['서울대곡초등학교', 37.4948, 127.0625, 24], ['서울대현초등학교', 37.5028, 127.0637, 21], ['서울일원초등학교', 37.4846, 127.0842, 18]],
    mids: [['단국대학교사범대학부속중학교', 37.4938, 127.0669]],
    byId: { 1: [0, 368, 0, 360, 1, 0, 780, 972] },
  };
  const lat = 37.49764, lng = 127.065056;      // 은마 좌표

  const n = m.nearbyInfra(infra, lat, lng, { minutes: 10, assignedElem: '서울대곡초등학교' });
  assert.equal(n.radiusM, 700, '분당 70m × 10분');
  assert.deepEqual(n.stations.map(s => s.name), ['대치', '학여울'], '수서역은 10분 밖이라 빠짐');
  assert.ok(n.stations[0].m < n.stations[1].m, '가까운 역이 먼저');
  assert.deepEqual(n.stations[0].lines, ['3호선']);
  assert.equal(n.stations[0].min, m.walkMin(n.stations[0].m));
  assert.deepEqual(n.elems.map(e => e.name), ['서울대곡초등학교', '서울대현초등학교']);
  assert.equal(n.elems[0].zone, true, '배정 초등학교 표시');
  assert.ok(n.elems.every(e => Number.isFinite(e.lat) && Number.isFinite(e.lng)), '지도에 찍을 좌표가 붙음');

  // 배정 초등학교가 10분 밖이면 그것만 따로 붙여 줌
  const far = m.nearbyInfra(infra, lat, lng, { minutes: 10, assignedElem: '서울일원초등학교' });
  const zone = far.elems.find(e => e.zone);
  assert.ok(zone && zone.far, '10분 밖 배정교는 far 로 표시');
  assert.ok(zone.m > 700);

  assert.equal(m.nearbyInfra(null, lat, lng).stations.length, 0, '자료가 없으면 빈 목록');
  assert.equal(m.nearbyInfra(infra, null, null).elems.length, 0, '좌표가 없으면 빈 목록');
  assert.equal(m.distM(37.5, 127.0, 37.5, 127.0), 0);
  assert.equal(m.shortName('서울대곡초등학교'), '대곡초');
});

test('입지 파일 합치기 — 서울·경기 번호가 어긋나지 않고, 겹친 역·학교는 한 번만', async () => {
  const m = await import('../site/public/jinga-reco.mjs');
  const seoul = {
    regionLabel: '서울',
    stations: [['대치', '3호선', 37.4949, 127.0631]],
    elems: [['서울대곡초등학교', 37.4948, 127.0625, 24]],
    mids: [['단대부중', 37.4938, 127.0669]],
    byId: { 1: [0, 368, 0, 360, 1, 0, 780, 972] },
  };
  const gyeonggi = {
    regionLabel: '경기',
    stations: [['대치', '3호선', 37.4949, 127.0631], ['야탑', '수인분당선', 37.4113, 127.1287]],   // 대치는 서울과 겹침
    elems: [['성남야탑초등학교', 37.4105, 127.1245, 22]],
    mids: [['야탑중', 37.4110, 127.1260]],
    byId: { 900: [1, 538, 0, 501, 1, 0, 90, 54] },
  };
  const M = m.mergeInfra(seoul, gyeonggi);
  assert.equal(M.stations.length, 3);
  assert.equal(M.elems.length, 2);
  assert.deepEqual(M.regions, ['서울', '경기']);
  assert.deepEqual(M.byId[1], seoul.byId[1], '서울 단지 번호는 그대로');
  assert.deepEqual(M.byId[900], [2, 538, 1, 501, 1, 1, 90, 54], '경기 단지 번호는 서울 개수만큼 밀림');

  const kr = m.infraOf(M, 900);
  assert.equal(kr.station.name, '야탑', '밀린 번호로도 제 역을 가리킴');
  assert.equal(kr.elem.name, '성남야탑초등학교');
  assert.equal(kr.mid.name, '야탑중');
  assert.equal(m.infraOf(M, 1).station.name, '대치');

  // 겹쳐 들어온 대치역은 한 번만
  const near = m.nearbyInfra(M, 37.49764, 127.065056, { minutes: 10 });
  assert.deepEqual(near.stations.map(s => s.name), ['대치']);
  assert.equal(m.mergeInfra(seoul).stations.length, 1, '하나만 주면 그대로');
  assert.equal(m.mergeInfra(null, null), null);
});

test('역까지 경사 — 역세권 점수 감점과 카드 문구', async () => {
  const m = await import('../site/public/jinga-reco.mjs');
  const s = await import('./build-kb-slope.mjs');

  // 표고 배열(단지 → 역)과 거리로 지표 만들기
  assert.equal(s.samplePath(37, 127, 37.01, 127.01).length, s.SAMPLES + 1);
  const flat = s.slopeOf([25, 23, 22, 22, 21, 20], 368);
  const hill = s.slopeOf([146, 126, 110, 100, 82, 66], 648);
  const over = s.slopeOf([67, 82, 79, 77, 53, 40], 412);      // 언덕을 넘어가는 길
  assert.deepEqual([flat.rise, flat.grade], [5, 1.4]);
  assert.deepEqual([hill.rise, hill.grade], [80, 12.3]);
  assert.equal(over.up, 42, '표고차(27m)보다 실제 오르막 합이 큼');
  assert.ok(over.maxGrade > over.grade, '구간 최대 경사는 평균보다 가파름');
  assert.equal(s.slopeOf([], 100), null);
  assert.equal(s.slopeOf([10, 20], 0), null);

  // 붙이기 → infraOf 가 함께 돌려줌
  const infra = {
    stations: [['대치', '3호선', 37.4949, 127.0631]], elems: [['서울대곡초등학교', 37.4948, 127.0625, 24]], mids: [['단대부중', 37.4938, 127.0669]],
    byId: { 1: [0, 400, 0, 360, 1, 0, 780, 900], 2: [0, 400, 0, 360, 1, 0, 780, 900] },
  };
  const withSlope = m.attachSlope(infra, { byId: { 1: [80, 12.3, 80, 15.4] } }, { byId: { 2: [5, 1.4, 5, 2.7] } });
  assert.deepEqual(m.infraOf(withSlope, 1).slope, { rise: 80, grade: 12.3, up: 80, maxGrade: 15.4 });
  assert.equal(m.infraOf(infra, 1).slope, null, '경사 자료가 없으면 null');

  // 같은 400m·같은 노선이라도 오르막이면 역세권 점수가 낮음
  const flatScore = m.stationScore(m.infraOf(withSlope, 2));
  const hillScore = m.stationScore(m.infraOf(withSlope, 1));
  assert.ok(hillScore < flatScore, `가파른 쪽이 낮아야 함(${hillScore} < ${flatScore})`);
  assert.equal(m.slopePenalty({ grade: 12.3 }), m.SLOPE_PENALTY_MAX, '10% 이상이면 최대 감점');
  assert.equal(m.slopePenalty({ grade: 1.4 }), 0, '2% 이하는 감점 없음');
  assert.equal(m.slopePenalty({ grade: -8 }), 0, '내리막은 감점 없음');
  assert.equal(m.slopePenalty(null), 0);

  assert.match(m.slopeText({ rise: 80, grade: 12.3 }), /오르막 80m·가파름\(12\.3%\)/);
  assert.match(m.slopeText({ rise: 1, grade: 1.4 }), /거의 평지/);
  assert.equal(m.slopeText(null), '');
  assert.match(m.infraText(m.infraOf(withSlope, 1), {}), /오르막 80m/, '카드 한 줄에도 들어감');
});

test('길 상권 — 길 둘레 점포 밀도·업종 구성과 역세권 가산', async () => {
  const m = await import('../site/public/jinga-reco.mjs');
  const b = await import('./build-kb-sangga.mjs');

  // 길 전체를 덮는 원 — 가운데 기준 반경 = 거리÷2 + 여유
  const c = b.corridor(37.4976, 127.0651, 37.4949, 127.0631, 368);
  assert.equal(c.radius, Math.round(368 / 2 + b.PAD_M));
  assert.ok(Math.abs(c.lat - 37.49625) < 1e-4 && Math.abs(c.lng - 127.0641) < 1e-4, '가운데 좌표');
  assert.equal(b.corridor(37, 127, 37, 127, 50).radius, b.PAD_M + 25);
  assert.equal(b.corridor(37, 127, 37, 127, 5000).radius, 1000, '아주 먼 역은 반경 상한');
  assert.ok(Math.abs(b.areaKm2(1000) - Math.PI) < 1e-9);

  // 점포 수는 totalCount, 업종 비율은 받은 표본으로
  const items = [
    { indsLclsNm: '음식', indsMclsNm: '한식' }, { indsLclsNm: '음식', indsMclsNm: '한식' },
    { indsLclsNm: '소매', indsMclsNm: '편의점' }, { indsLclsNm: '교육', indsMclsNm: '일반 교육' },
    { indsLclsNm: '보건의료', indsMclsNm: '의원' }, { indsLclsNm: '수리·개인', indsMclsNm: '이용·미용' },
    { indsLclsNm: '', indsMclsNm: '' },
  ];
  const s = b.summarize(items, { radius: 334, total: 238 });
  assert.equal(s.n, 238, '원 안 전체 점포 수는 totalCount');
  assert.equal(s.dens, Math.round(238 / b.areaKm2(334)), '㎢당 점포 수');
  assert.equal(s.mix['음식'], 33.3, '업종 비율은 받은 표본 기준');
  assert.equal(s.mix['생활'], 16.7, '수리·개인 → 생활');
  assert.equal(s.mix['의료'], 16.7, '보건의료 → 의료');
  assert.deepEqual(s.top[0], ['한식', 2]);
  assert.deepEqual(b.summarize([], { radius: 300, total: 0 }), { n: 0, dens: 0, mix: {}, top: [] });
  assert.equal(b.shortCat('없는대분류'), '기타');
  assert.equal(b.shortCat(''), null);

  // 붙이기 → infraOf 가 함께 돌려주고 점수에 가산
  const infra = {
    stations: [['대치', '3호선', 37.4949, 127.0631]], elems: [['서울대곡초등학교', 37.4948, 127.0625, 24]], mids: [['단대부중', 37.4938, 127.0669]],
    byId: { 1: [0, 400, 0, 360, 1, 0, 780, 900], 2: [0, 400, 0, 360, 1, 0, 780, 900] },
  };
  const withSg = m.attachSangga(infra, { byId: { 1: [2167, 3929, { 음식: 26, 전문: 16.3 }, [['한식', 62]]] } }, { byId: { 2: [280, 397, { 교육: 28.7 }, []] } });
  assert.deepEqual(m.infraOf(withSg, 1).sangga.mix, { 음식: 26, 전문: 16.3 });
  assert.equal(m.infraOf(infra, 1).sangga, null, '상가 자료가 없으면 null');

  const busy = m.stationScore(m.infraOf(withSg, 1));
  const quiet = m.stationScore(m.infraOf(withSg, 2));
  assert.ok(busy > quiet, );
  assert.equal(m.streetBonus({ dens: m.STREET_FULL }), m.STREET_BONUS_MAX, '기준 상단이면 최대 가산');
  assert.equal(m.streetBonus({ dens: m.STREET_MIN }), 0, '기준 하단 이하는 가산 없음');
  assert.equal(m.streetBonus(null), 0);
  assert.ok(m.stationScore(m.infraOf(withSg, 1)) <= 15, '가산해도 15점을 넘지 않음');
  assert.equal(m.sanggaText({ n: 238, dens: 679, mix: { 소매: 29, 음식: 22.6 } }), '길 상권 238곳(㎢당 679곳) · 소매 29%·음식 22.6%');
  assert.equal(m.sanggaText({ n: 0 }), '');
  assert.match(m.infraText(m.infraOf(withSg, 1), {}), /길 상권 2,167곳/, '카드 한 줄에도 들어감');
});

// ── 임대세대 비율 조건 ────────────────────────────────────────
// 단지 검색과 **같은 산식**(jinga-kb.mjs)을 가져다 씁니다 — 같은 단지가 한쪽에서만 빠지면 더 헷갈립니다.
test('추천에서도 임대 비율로 빼기 — 단지 검색과 같은 기준', () => {
  const target = { c: { id: 1293, gu: '동작구', dong: '상도동', far: 295, types, brief: brief(1994, 682) }, t: types[0] };
  const cands = [
    { id: 1, name: '분양단지', gu: '동작구', dong: '상도동', far: 250, brief: brief(2019, 1500, 400),
      households: 1500, rentUnits: 40, types: [T(84.9, 120000, 70000)] },                      // 2.7%
    { id: 3, name: '임대많은단지', gu: '동작구', dong: '상도동', far: 230, brief: brief(2015, 900),
      households: 943, rentUnits: 532, types: [T(84.5, 110000, 62000)] },                      // 56.4%
    { id: 4, name: '임대조금단지', gu: '동작구', dong: '신대방동', far: 200, brief: brief(2012, 800),
      households: 800, rentUnits: 160, types: [T(84.9, 108000, 50000)] },                      // 20%
  ];
  const base = { band: 0.1, guData: GU, thisYear: 2026 };

  const none = recommend(target, cands, base);
  assert.equal(none.eligibleCount, 3, '제한이 없으면 셋 다');
  assert.deepEqual(none.rentExcluded, []);

  const cut30 = recommend(target, cands, { ...base, maxRentPct: 30 });
  assert.deepEqual(cut30.pool.map(e => e.c.name).sort(), ['분양단지', '임대조금단지']);
  assert.equal(cut30.rentExcluded.length, 1);
  assert.equal(cut30.rentExcluded[0].name, '임대많은단지');
  assert.equal(cut30.rentExcluded[0].pct, 56.4, '왜 빠졌는지 비율까지');
  assert.ok(!cut30.top.some(e => e.c.name === '임대많은단지'), 'TOP 에도 안 나옴');

  const cut15 = recommend(target, cands, { ...base, maxRentPct: 15 });
  assert.deepEqual(cut15.pool.map(e => e.c.name), ['분양단지']);
  assert.equal(cut15.rentExcluded.length, 2);
  assert.equal(cut15.rentExcluded[0].pct, 56.4, '많이 빠진 순으로');

  // 비율을 모르는 단지는 기본으로 남깁니다(모른다고 버리면 멀쩡한 단지가 사라집니다)
  const unknown = [...cands, { id: 9, name: '모르는단지', gu: '동작구', dong: '상도동', far: 210, brief: brief(2010, 700), types: [T(84, 112000, 60000)] }];
  assert.ok(recommend(target, unknown, { ...base, maxRentPct: 30 }).pool.some(e => e.c.name === '모르는단지'));
  const strict = recommend(target, unknown, { ...base, maxRentPct: 30, rentKnownOnly: true });
  assert.ok(!strict.pool.some(e => e.c.name === '모르는단지'), '엄격 모드면 뺌');
  assert.equal(strict.rentExcluded.length, 2);

  // 단지 검색과 값이 같은지 — 같은 함수를 쓰므로 어긋날 수 없어야 합니다
  assert.equal(rentPct(cands[1]), 56.4);
  assert.equal(rentText(cands[1]), '임대 56.4%(532/943세대)');
  assert.equal(rentOk(cands[1], 30), false);
  assert.equal(rentOk(cands[0], 30), true);
});

// ── 고른 자치구에서만 비교하기 ────────────────────────────────
test('찾는 지역: 고른 자치구 안에서만 · 최대 5곳 · 상한을 넘으면 가까운 동부터', () => {
  const target = { id: 1293, gu: '동작구', dong: '상도동', t: { price: 100000, excl: 84 } };

  // 서초구 방배동은 평당가가 세 배라 「서울 전체」에서는 빠지지만, 그 구를 고르면 나와야 합니다
  const wide = candidateScope(target, DIR, GU, { scope: 'similar' });
  assert.ok(!wide.rows.some(c => c[2] === '서초구'), '전체 비교에서는 너무 비싼 동이 빠짐');

  const picked = candidateScope(target, DIR, GU, { scope: 'gus', gus: ['서초구'] });
  assert.deepEqual(picked.rows.map(c => c[0]), [], '서초구 후보는 50세대 미만이라 제외(skipSmall)');
  assert.deepEqual(picked.gus, ['서초구'], '고른 구를 돌려줌');

  const two = candidateScope(target, DIR, GU, { scope: 'gus', gus: ['송파구', '동작구'] });
  assert.deepEqual(two.rows.map(c => c[0]).sort((a, b) => a - b), [1, 3, 4, 5], '고른 두 구의 단지만(기준 단지·소규모 제외)');
  assert.ok(!two.rows.some(c => c[2] === '서초구'));
  assert.equal(two.capped, false);

  // 기준 집이 없는 구만 골라도 됩니다 — 「그 동네로 옮기고 싶다」는 쓰임
  const away = candidateScope(target, DIR, GU, { scope: 'gus', gus: ['송파구'] });
  assert.deepEqual(away.rows.map(c => c[0]), [5]);

  // 다섯 곳까지만, 중복은 하나로
  const many = candidateScope(target, DIR, GU, { scope: 'gus', gus: ['동작구', '동작구', '송파구', '서초구', '강남구', '강동구', '마포구'] });
  assert.equal(many.gus.length, MAX_RECO_GUS);
  assert.deepEqual(many.gus, ['동작구', '송파구', '서초구', '강남구', '강동구']);

  // 고르지 않으면 예전대로(서울 전체)
  const empty = candidateScope(target, DIR, GU, { scope: 'gus', gus: [] });
  assert.deepEqual(empty.rows.map(c => c[0]).sort((a, b) => a - b), wide.rows.map(c => c[0]).sort((a, b) => a - b));
});

test('찾는 지역: 상한을 넘으면 아무 데나 자르지 않고 평당가 가까운 동부터 채움', () => {
  const target = { id: 999, gu: '동작구', dong: '상도동', t: { price: 100000, excl: 84 } };
  // 상도동(기준과 가까움) 2곳 · 신대방동(싼 동) 3곳 — 상한 2면 상도동만 들어와야 합니다
  const rows = [
    [11, 'A', '동작구', '상도동', 0], [12, 'B', '동작구', '상도동', 0],
    [13, 'C', '동작구', '신대방동', 0], [14, 'D', '동작구', '신대방동', 0], [15, 'E', '동작구', '신대방동', 0],
  ];
  const r = candidateScope(target, rows, GU, { scope: 'gus', gus: ['동작구'], max: 2 });
  assert.deepEqual(r.rows.map(c => c[0]), [11, 12], '기준 동부터');
  assert.equal(r.capped, true);
  assert.equal(r.dongs[0].dong, '상도동');

  // 상한 안이면 그대로 다 — 동 목록은 비워 둡니다(줄 세울 필요가 없으므로)
  const all = candidateScope(target, rows, GU, { scope: 'gus', gus: ['동작구'], max: 99 });
  assert.equal(all.rows.length, 5);
  assert.equal(all.capped, false);
  assert.deepEqual(all.dongs, []);
});
