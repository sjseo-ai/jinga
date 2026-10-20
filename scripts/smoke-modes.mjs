// 단지 검색 유형(매매·전세·재건축·리모델링) 스모크 테스트 — 순수 계산, 네트워크 없음
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, modeEligible, judgePrice, typeMatches, listingCandidates, modeOf, MODES, rulesOf, buildSearchSheets, criteriaText, rentPct, rentText, rentOk } from '../site/public/jinga-kb.mjs';
import { buildXlsx } from '../site/public/xlsx-lite.mjs';

const YEAR = 2026;
// [전용, KB 매매가(만원), 전세가, 세대수]
const type = (excl, price, jeonse, hh) => ({ excl, supPy: String(Math.round(excl / 3.3 * 1.35)), price, lo: price - 5000, hi: price + 5000, jeonse, hh, provided: true, areaId: excl * 10 });
const complex = (id, name, gu, dong, far, hall, built, rebuild, types, interest = 50) => ({
  id, name, gu, dong, far, bcr: 20, hall, types,
  brief: { built, builtYm: `${built}01`, households: types.reduce((s, t) => s + t.hh, 0), rebuild, interest, forSale: 3 },
});

const OLD = complex(1, '은마', '강남구', '대치동', 179, '계단식', 1979, true, [type(84, 250000, 80000, 1200)]);
const MID = complex(2, '분당샛별', '성남', '분당구 야탑동', 220, '계단식', 1994, false, [type(84, 130000, 70000, 900)]);
const NEW = complex(3, '고덕그라시움', '강동구', '고덕동', 250, '복도식', 2019, false, [type(84, 180000, 90000, 1500)]);
const CORRIDOR = complex(4, '복도식단지', '안양', '동안구 평촌동', 230, '복도식', 2002, false, [type(84, 100000, 60000, 800)]);
const ALL = [OLD, MID, NEW, CORRIDOR];
const clone = () => ALL.map(c => ({ ...c, types: c.types.map(t => ({ ...t })) }));

const base = { budget: 300000, budgetMin: 0, minArea: 0, maxArea: 0, minHh: 0, basis: 'kb' };

test('유형 정의: 4가지 · 배점 합계 100점', () => {
  assert.deepEqual(Object.keys(MODES), ['sale', 'jeonse', 'rebuild', 'remodel']);
  for (const [key, m] of Object.entries(MODES)) {
    assert.equal(m.rules.reduce((s, r) => s + r.max, 0), 100, `${key} 배점 합계`);
  }
  assert.equal(modeOf('없는유형').key, 'sale', '모르는 값이면 매매');
  assert.deepEqual(rulesOf({ mode: 'jeonse' }).map(r => r.key), ['budget', 'safety', 'scale', 'newness', 'space', 'pref']);
});

test('전세: KB 전세가로 예산을 판단하고, 매물 호가는 조회하지 않음', () => {
  const t = OLD.types[0];
  assert.equal(judgePrice(t, 'ask', 'jeonse'), 80000, '전세는 호가 기준이어도 KB 전세가');
  assert.equal(judgePrice(t, 'kb', 'sale'), 250000);
  const crit = { ...base, mode: 'jeonse', budget: 85000 };
  assert.equal(typeMatches(t, crit), true, '전세 8억 ≤ 예산 8.5억');
  assert.equal(typeMatches(t, { ...crit, budget: 70000 }), false);
  assert.equal(listingCandidates(clone(), crit).length, 0, '전세는 매물 호가를 조회하지 않음');
  assert.ok(listingCandidates(clone(), { ...base, mode: 'sale' }).length > 0);

  const r = evaluate(clone(), { ...base, mode: 'jeonse', budget: 90000 });
  assert.equal(r.qualifying.length, 4);
  const byName = Object.fromEntries(r.qualifying.map(e => [e.c.name, e.score]));
  // 전세가율이 낮을수록 보증금 안전 점수가 높음(은마 32% → 만점 / 고덕 50% → 만점 / 복도식 60% → 감점)
  assert.ok(byName['은마'].parts.safety > byName['복도식단지'].parts.safety);
  assert.equal(byName['은마'].basisLabel, 'KB 전세 일반거래가');
  assert.equal(byName['은마'].judge, 80000);
  assert.ok(byName['은마'].reasons.some(x => /전세가율 32%/.test(x)));
  assert.equal(byName['고덕그라시움'].parts.newness, 18.4, '2019년 준공(7년차) 신축도');
});

test('재건축: KB 재건축 표시 또는 30년 이상만 · 용적률이 낮을수록 여력 점수 높음', () => {
  assert.equal(modeEligible(OLD, OLD.brief, YEAR, 'rebuild'), true, '1979년 준공·재건축 표시');
  assert.equal(modeEligible(MID, MID.brief, YEAR, 'rebuild'), true, '1994년 = 32년차');
  assert.equal(modeEligible(NEW, NEW.brief, YEAR, 'rebuild'), false, '2019년 준공은 대상 아님');
  assert.equal(modeEligible(CORRIDOR, CORRIDOR.brief, YEAR, 'rebuild'), false, '2002년 = 24년차');

  const r = evaluate(clone(), { ...base, mode: 'rebuild' }, YEAR);
  assert.deepEqual([...new Set(r.qualifying.map(e => e.c.name))].sort(), ['분당샛별', '은마']);
  const eun = r.qualifying.find(e => e.c.name === '은마').score;
  const bun = r.qualifying.find(e => e.c.name === '분당샛별').score;
  assert.ok(eun.parts.potential > bun.parts.potential, '용적률 179% > 220% 여력');
  assert.equal(eun.parts.age, 15, '47년차는 노후도 만점');
  assert.ok(eun.reasons.some(x => /용적률 179%/.test(x) && /사업 여력 큼/.test(x)));
  assert.equal(Object.keys(eun.parts).length, 6);
});

test('리모델링: 15년 이상 · 재건축으로 가는 단지 제외 · 계단식 가점', () => {
  assert.equal(modeEligible(OLD, OLD.brief, YEAR, 'remodel'), false, 'KB 재건축 표시 단지는 제외');
  assert.equal(modeEligible(NEW, NEW.brief, YEAR, 'remodel'), false, '2019년 준공은 7년차라 아직 대상 아님');
  assert.equal(modeEligible(MID, MID.brief, YEAR, 'remodel'), true, '32년차·용적률 220% → 재건축보다 리모델링');
  assert.equal(modeEligible(CORRIDOR, CORRIDOR.brief, YEAR, 'remodel'), true, '24년차');
  assert.equal(modeEligible({ far: 150 }, { built: 1990 }, YEAR, 'remodel'), false, '36년차·용적률 150%면 재건축 쪽');

  const r = evaluate(clone(), { ...base, mode: 'remodel' }, YEAR);
  assert.deepEqual([...new Set(r.qualifying.map(e => e.c.name))].sort(), ['복도식단지', '분당샛별']);
  const mid = r.qualifying.find(e => e.c.name === '분당샛별').score;
  const cor = r.qualifying.find(e => e.c.name === '복도식단지').score;
  assert.equal(mid.parts.struct, 15, '계단식 만점');
  assert.equal(cor.parts.struct, 0, '복도식 0점');
  assert.ok(mid.parts.fit > cor.parts.fit, '연차·용적률이 리모델링에 더 맞음');
  assert.ok(mid.reasons.some(x => /리모델링이 현실적/.test(x)));
});

test('매매는 기존 동작 그대로 · 유형별 엑셀 머리글이 바뀜', () => {
  const sale = evaluate(clone(), { ...base, mode: 'sale' }, YEAR);
  const legacy = evaluate(clone(), base, YEAR);                       // mode 없이 = 매매
  assert.deepEqual(sale.qualifying.map(e => e.score.total), legacy.qualifying.map(e => e.score.total));
  assert.equal(sale.qualifying.length, 4, '매매는 모든 단지가 대상');
  assert.equal(Object.keys(sale.qualifying[0].score.parts).length, 7);

  const args = { criteria: { ...base, mode: 'rebuild' }, gus: ['강남구', '성남'], asOf: '2026.09.11', complexes: clone(), generatedAt: new Date(2026, 8, 16) };
  const sheets = buildSearchSheets({ ...args, result: evaluate(clone(), args.criteria, YEAR) });
  assert.match(sheets[0].rows[0][0].v, /재건축 진가 BEST 5/);
  const head = sheets[0].rows[2].map(c => c.v);
  assert.ok(head.includes('재건축 여력(30)') && head.includes('노후도(15)'));
  assert.equal(head.length, sheets[0].colWidths.length, '머리글 수 = 열 너비 수');
  assert.match(criteriaText({ ...base, mode: 'jeonse' }, ['강동구']), /^전세보증금 /);
  assert.equal(String.fromCharCode(buildXlsx(sheets)[0]), 'P');
});

test('사용승인일: 단지 목록의 approved 를 카드·엑셀에 표시', async () => {
  const k = await import('../site/public/jinga-kb.mjs');
  const b = await import('./build-kb-complexes.mjs');

  assert.equal(b.ymd8('1979.08.30'), '19790830');
  assert.equal(b.ymd8('20160727'), '20160727');
  assert.equal(b.ymd8('1979.08'), null, '날짜가 없으면 null');
  assert.equal(b.parseComplexMain({ 매물종별구분: '01', 준공년월일: '2016.07.27' }).approved, '20160727');
  assert.equal(b.parseComplexMain({ 매물종별구분: '01', 준공년: '2011', 준공월: '11' }).approved, '20111101', '날짜가 없으면 그 달 1일로');

  assert.equal(k.approvedText('19790830'), '1979.08.30');
  assert.equal(k.approvedText('1979'), '');
  assert.equal(k.builtText({ approved: '19790830' }, { built: 1979 }), '사용승인 1979.08.30');
  assert.equal(k.builtText({}, { built: 1979, builtYm: '197908' }), '1979.08 준공', '사용승인일이 없으면 KB 준공년월');
  assert.equal(k.builtText({}, { built: 1979 }), '1979년 준공');
  assert.equal(k.builtText({}, {}), '');

  // 엑셀 머리글·칸에 사용승인일이 들어가는지
  const type = { excl: 84, supPy: '34', price: 200000, lo: 190000, hi: 210000, jeonse: 90000, hh: 900, provided: true, areaId: 1 };
  const c = { id: 1, name: '은마', gu: '강남구', dong: '대치동', far: 204, bcr: 20, approved: '19790830',
    types: [type], brief: { built: 1979, builtYm: '197908', households: 4424, rebuild: true, interest: 900 } };
  const crit = { budget: 300000, budgetMin: 0, minArea: 0, maxArea: 0, minHh: 0, basis: 'kb', mode: 'sale' };
  const sheets = k.buildSearchSheets({ criteria: crit, gus: ['강남구'], asOf: '2026.09.11', complexes: [c], result: k.evaluate([c], crit, 2026), generatedAt: new Date(2026, 8, 16) });
  const head = sheets[0].rows[2].map(x => x.v);
  assert.equal(head[5], '사용승인일', '준공 칸 다음에');
  assert.equal(head.length, sheets[0].colWidths.length);
  assert.equal(sheets[0].rows[3][5].v, '1979.08.30');
  const rawHead = sheets[2].rows[2].map(x => x.v);
  assert.equal(rawHead[17], '사용승인일');
  assert.equal(sheets[2].rows[3][17].v, '1979.08.30', '조회 전수 시트에도');
});

// ── 임대세대 비율 조건 ────────────────────────────────────────
// 임대 비중이 큰 단지는 실제로 사고팔리는 세대가 적어 시세가 주변만큼 움직이지 않는 일이 잦습니다.
// 좋고 나쁨이 아니라 **성격이 다른 단지**라, 점수를 깎는 대신 조건으로 빼고 넣을 수 있게 했습니다.
const RENT_C = (over = {}) => ({
  id: 1, name: '테스트단지', gu: '강동구', dong: '상일동', far: 193, hall: '계단식',
  households: 943, rentUnits: 532, approved: '20210210',
  brief: { built: 2021, households: 943 },
  types: [{ excl: 84, supPy: 34, price: 80000, lo: 75000, hi: 85000, jeonse: 40000, hh: 943, provided: true }],
  ...over,
});

test('임대 비율 — 셈하기와 보여 주기', () => {
  assert.equal(rentPct({ households: 943, rentUnits: 532 }), 56.4, '소수 한 자리');
  assert.equal(rentPct({ households: 4932, rentUnits: 140 }), 2.8);
  assert.equal(rentPct({ households: 500, rentUnits: 0 }), 0);
  assert.equal(rentPct({ households: 0, rentUnits: 0 }), null, '총세대수가 없으면 셈할 수 없음');
  assert.equal(rentPct({}), null);
  assert.equal(rentPct({ households: 100, rentUnits: null }), null);

  assert.equal(rentText({ households: 943, rentUnits: 532 }), '임대 56.4%(532/943세대)');
  assert.equal(rentText({ households: 500, rentUnits: 0 }), '임대 없음');
  assert.equal(rentText({}), '', '모르면 아무 말도 하지 않음');
});

test('임대 비율 조건 — 모르는 단지는 함부로 빼지 않음', () => {
  const hi = { households: 943, rentUnits: 532 };     // 56.4%
  const lo = { households: 4932, rentUnits: 140 };    // 2.8%
  const unknown = {};

  assert.equal(rentOk(hi, 0), true, '0이면 제한 없음 — 다 통과');
  assert.equal(rentOk(hi, 30), false);
  assert.equal(rentOk(lo, 30), true);
  assert.equal(rentOk(hi, 60), true, '상한이 높으면 통과');
  assert.equal(rentOk({ households: 100, rentUnits: 30 }, 30), true, '딱 맞으면 통과(이하)');

  // 모르는 단지를 버리면 멀쩡한 단지가 통째로 사라집니다 — 기본은 남기고, 원할 때만 뺍니다
  assert.equal(rentOk(unknown, 30), true);
  assert.equal(rentOk(unknown, 30, true), false, 'rentKnownOnly 를 켜면 뺌');
  assert.equal(rentOk(unknown, 0, true), true, '제한 자체가 없으면 엄격 여부와 무관');
});

test('검색에서 빼기 — 몇 곳이 빠졌는지도 알려 줌', () => {
  const crit = { budget: 130000, budgetMin: 0, minArea: 0, maxArea: 0, minHh: 0, basis: 'kb', mode: 'sale' };
  const 리엔파크 = RENT_C();
  const 그라시움 = RENT_C({ id: 2, name: '분양단지', households: 4932, rentUnits: 140 });
  const 모름 = RENT_C({ id: 3, name: '모르는단지', households: null, rentUnits: null });
  const all = [리엔파크, 그라시움, 모름];

  const none = evaluate(all, crit, 2026);
  assert.equal(none.complexCount, 3, '제한이 없으면 셋 다');
  assert.deepEqual(none.rentExcluded, []);

  const cut = evaluate(all, { ...crit, maxRentPct: 30 }, 2026);
  assert.deepEqual(cut.best5.map(e => e.c.name).sort(), ['모르는단지', '분양단지'], '임대 56%는 빠짐');
  assert.equal(cut.rentExcluded.length, 1);
  assert.equal(cut.rentExcluded[0].name, '테스트단지');
  assert.equal(cut.rentExcluded[0].pct, 56.4, '왜 빠졌는지 비율까지');

  const strict = evaluate(all, { ...crit, maxRentPct: 30, rentKnownOnly: true }, 2026);
  assert.deepEqual(strict.best5.map(e => e.c.name), ['분양단지']);
  assert.equal(strict.rentExcluded.length, 2);
  // 많이 빠진 순으로 — 비율 모르는 곳은 뒤로
  assert.equal(strict.rentExcluded[0].pct, 56.4);
  assert.equal(strict.rentExcluded[1].pct, null);
});

test('조건 문장에 임대 조건이 드러남', () => {
  const base = { budget: 130000, minArea: 59, maxArea: 84, minHh: 300 };
  assert.doesNotMatch(criteriaText(base, ['강동구']), /임대/, '제한이 없으면 적지 않음');
  assert.match(criteriaText({ ...base, maxRentPct: 30 }, ['강동구']), /임대세대 30% 이하/);
  assert.match(criteriaText({ ...base, maxRentPct: 30, rentKnownOnly: true }, ['강동구']), /비율 모르는 단지도 제외/);
});

test('임대 산식은 한 곳에만 — 단지 검색·매물 추천이 같은 함수를 씀', async () => {
  // 복사해 두면 한쪽만 고쳐져 같은 단지가 검색에서는 빠지고 추천에는 남습니다.
  const rent = await import('../site/public/jinga-rent.mjs');
  const reco = await import('../site/public/jinga-reco.mjs');
  assert.equal(rentPct, rent.rentPct, 'jinga-kb 는 공용 모듈 것을 그대로 내보냄');
  assert.equal(rentOk, rent.rentOk);
  assert.equal(reco.rentPct, rent.rentPct, 'jinga-reco 도 같은 함수');
  assert.equal(reco.rentOk, rent.rentOk);
});
