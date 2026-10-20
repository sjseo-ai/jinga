// 자치구 연재 글감(_post.mjs) 스모크 테스트 — 순수 계산, 네트워크 없음
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GU_ORDER, isSorted, yearOf, toComplex, rentPct, guFacts, schedule, man, pct,
  MIN_DONG_COMPLEXES, MIN_PARK_PER, orderWithFirst,
} from '../scripts/_post.mjs';

test('자치구 25개가 가나다순으로 빠짐없이', () => {
  assert.equal(GU_ORDER.length, 25);
  assert.equal(new Set(GU_ORDER).size, 25, '중복 없음');
  assert.equal(isSorted(), true, '가나다순이 아닙니다');
  assert.equal(GU_ORDER[0], '강남구');
  assert.equal(GU_ORDER[24], '중랑구');
  assert.equal(isSorted(['강동구', '강남구']), false, '검사가 실제로 거르는지');
});

test('준공일 읽기 — 이상한 값은 「모름」', () => {
  assert.equal(yearOf('19970828'), 1997);
  assert.equal(yearOf('20250101'), 2025);
  assert.equal(yearOf(''), null);
  assert.equal(yearOf(null), null);
  assert.equal(yearOf('1997'), null, '8자리가 아니면');
  assert.equal(yearOf('18000101'), null, '너무 옛날이면 잘못된 값');
});

// [id, name, gu, dong, under50, far, bcr, lat, lng, maxFloor, hall, approved, households, rentUnits]
const row = (o = {}) => [
  o.id ?? 1, o.name ?? '가나아파트', o.gu ?? '강동구', o.dong ?? '명일동', 0,
  o.far ?? 250, 20, 37.5, 127.1, o.maxFloor ?? 15, o.hall ?? '계단식',
  o.approved ?? '20100101', o.households ?? 500, o.rentUnits ?? 0,
];

test('단지 한 줄 읽기', () => {
  const c = toComplex(row({ name: '테스트', households: 500, rentUnits: 100, far: 180 }));
  assert.equal(c.name, '테스트');
  assert.equal(c.households, 500);
  assert.equal(c.far, 180);
  assert.equal(c.year, 2010);
  assert.equal(rentPct(c), 20);
});

test('임대 비율 — 세대수를 모르면 셈하지 않습니다', () => {
  assert.equal(rentPct({ households: 1000, rentUnits: 300 }), 30);
  assert.equal(rentPct({ households: 841, rentUnits: 737 }), 87.6);
  assert.equal(rentPct({ households: 500, rentUnits: 0 }), 0, '임대 0세대는 진짜 0');
  assert.equal(rentPct({ households: null, rentUnits: 100 }), null);
  assert.equal(rentPct({ households: 500, rentUnits: null }), null, '모르는 것을 0% 라고 하면 안 됩니다');
});

const DATA = {
  asOf: '2026.09.11',
  seoul: { avgPerPyeong: 6000 },
  gu: {
    강동구: {
      count: 60, households: 90000, avgPerPyeong: 7000,
      dongs: [
        { name: '둔촌동', count: 21, avgPerPyeong: 9500 },
        { name: '명일동', count: 21, avgPerPyeong: 7100 },
        { name: '천호동', count: 10, avgPerPyeong: 4000 },
      ],
    },
  },
  complexes: [
    row({ id: 1, name: '큰단지', households: 3000, approved: '20200101', far: 300 }),
    row({ id: 2, name: '낡은단지', households: 800, approved: '19850101', far: 160 }),
    row({ id: 3, name: '임대많은단지', households: 1000, rentUnits: 700, approved: '20100101' }),
    row({ id: 4, name: '작은단지', households: 120, approved: '20000101' }),
    row({ id: 5, name: '남의구', gu: '강남구', households: 900 }),
  ],
  kapt: {
    1: { households: 3000, parkUnder: 4500, parkGround: 100, subwayStation: '둔촌동', subwayLine: '9호선' },
    2: { households: 800, parkUnder: 0, parkGround: 400 },
    3: { households: 1000, parkUnder: 900, parkGround: 50, subwayStation: '명일', subwayLine: '5호선' },
  },
  union: { sites: [
    { gu: '강동구', name: '낡은단지 재건축정비사업 조합', step: '조합설립인가', live: true },
    { gu: '강동구', name: '끝난곳 재건축정비사업 조합', step: '조합해산', live: false },
    { gu: '강남구', name: '남의구 조합', step: '조합설립인가', live: true },
  ] },
};

test('구 글감 — 다른 구 단지는 섞이지 않습니다', () => {
  const f = guFacts('강동구', DATA);
  assert.equal(f.gu, '강동구');
  assert.equal(f.scale.total, 4, '강남구 단지는 빠짐');
  assert.equal(f.scale.households, 3000 + 800 + 1000 + 120);
  assert.equal(f.scale.biggest[0].name, '큰단지');
  assert.equal(guFacts('없는구', DATA), null);
});

test('시세 — 서울 평균 대비와 동네 격차', () => {
  const p = guFacts('강동구', DATA).price;
  assert.equal(p.perPyeong, 7000);
  assert.equal(p.vsSeoul, 116.7, '7000/6000');
  assert.equal(p.topDongs[0].name, '둔촌동', '비싼 동이 앞');
  assert.equal(p.lowDongs[0].name, '천호동');
  assert.equal(p.spread, 2.4, '9500/4000');
});

test('주차 — 세대당 1대 못 미치는 곳과 지하주차장 없는 곳', () => {
  const p = guFacts('강동구', DATA).parking;
  assert.equal(p.count, 3);
  assert.equal(p.best[0].name, '큰단지', '세대당 1.53대');
  assert.equal(p.best[0].per, 1.53);
  assert.equal(p.worst[0].name, '낡은단지', '세대당 0.5대');
  assert.equal(p.under1, 2, '낡은단지 0.5대 · 임대많은단지 0.95대 — 0.95도 1대 미만입니다');
  assert.equal(p.noUnder, 1, '지하 0대인 곳');
});

test('재건축 여력 — 용적률 낮고 오래된 곳 + 살아 있는 조합만', () => {
  const r = guFacts('강동구', DATA).rebuild;
  assert.equal(r.lowFarCount, 1, '용적률 160% · 1985년');
  assert.equal(r.lowFar[0].name, '낡은단지');
  assert.equal(r.unions.length, 1, '해산한 조합과 남의 구는 빠짐');
  assert.equal(r.unions[0].step, '조합설립인가');
});

test('임대 비율 높은 단지', () => {
  const r = guFacts('강동구', DATA).rent;
  assert.equal(r.over30, 1);
  assert.equal(r.highest[0].name, '임대많은단지');
  assert.equal(r.highest[0].pct, 70);
});

test('자료가 비면 그 꼭지는 통째로 빠집니다 — 0 으로 적지 않습니다', () => {
  const bare = { complexes: DATA.complexes, gu: {}, seoul: {}, kapt: {}, union: { sites: [] } };
  const f = guFacts('강동구', bare);
  assert.equal(f.price, null, '시세 자료가 없으면 null');
  assert.equal(f.parking, null, '주차 자료가 없으면 null');
  assert.equal(f.subway, null);
  assert.equal(f.rebuild.unions.length, 0);
  assert.ok(f.scale.total > 0, '단지 목록만으로 되는 것은 남습니다');
});

test('연재 일정 — 화·금, 가나다순, 25편', () => {
  const s = schedule('2026-10-14');
  assert.equal(s.length, 25);
  assert.equal(s[0].gu, '강남구');
  assert.equal(s[24].gu, '중랑구');
  // 2026-10-14 는 수요일 → 첫 글은 16일(금)
  assert.equal(s[0].date, '2026-10-16');
  assert.equal(s[1].date, '2026-10-20', '다음은 화요일');
  for (const r of s) {
    const d = new Date(r.date + 'T00:00:00Z').getUTCDay();
    assert.ok(d === 2 || d === 5, `${r.date} 가 화·금이 아닙니다`);
  }
  // 시작일이 바로 화요일이면 그날부터
  assert.equal(schedule('2026-10-13')[0].date, '2026-10-13');
  assert.throws(() => schedule('어제'), /날짜/);
});

test('숫자 꾸미기', () => {
  assert.equal(man(12032), '12,032');
  assert.equal(man(null), null);
  assert.equal(pct(56, 66), 84.8);
  assert.equal(pct(1, 0), null, '0 으로 나누지 않습니다');
});

test('단지 한 곳뿐인 동은 「동네 평균」으로 쓰지 않습니다', () => {
  // 종로구 평동(단지 1곳 · 평당 10,260만원)이 구 전체를 8배 격차로 보이게 했습니다
  const d = JSON.parse(JSON.stringify(DATA));
  d.gu.강동구.dongs.push({ name: '한곳뿐인동', count: 1, avgPerPyeong: 30000 });
  const p = guFacts('강동구', d).price;
  assert.equal(MIN_DONG_COMPLEXES, 2);
  assert.ok(!p.topDongs.some(x => x.name === '한곳뿐인동'), '표본 1곳은 순위에서 빠져야 합니다');
  assert.equal(p.spread, 2.4, '격차 계산에도 섞이면 안 됩니다(30000/4000=7.5 가 되어선 안 됨)');
});

test('「빠듯한 곳」은 세대당 1대 미만만 — 넉넉한 곳과 겹치면 안 됩니다', () => {
  // 자료가 적은 구에서 best 5 와 worst 5 가 같은 단지로 채워지던 문제
  const d = JSON.parse(JSON.stringify(DATA));
  d.kapt = {
    1: { households: 3000, parkUnder: 4500, parkGround: 100 },   // 1.53
    3: { households: 1000, parkUnder: 1200, parkGround: 50 },    // 1.25
  };
  const p = guFacts('강동구', d).parking;
  assert.equal(MIN_PARK_PER, 1);
  assert.equal(p.under1, 0, '둘 다 1대 이상');
  assert.deepEqual(p.worst, [], '1대 넘는 단지를 「빠듯한 곳」이라 적으면 거짓입니다');
  assert.equal(p.best.length, 2);
  const names = new Set([...p.best, ...p.worst].map(x => x.name));
  assert.equal(names.size, p.best.length + p.worst.length, '양쪽에 같은 단지가 올라오지 않습니다');
});

test('먼저 다룰 구를 앞으로 — 나머지는 가나다순 그대로', () => {
  const o = orderWithFirst(['노원구', '강서구', '성북구']);
  assert.equal(o.length, 25, '빠지거나 늘어나지 않습니다');
  assert.equal(new Set(o).size, 25, '중복 없음');
  assert.deepEqual(o.slice(0, 3), ['노원구', '강서구', '성북구'], '준 순서 그대로 앞에');
  assert.equal(o[3], '강남구', '나머지는 가나다순');
  assert.ok(!o.slice(3).includes('노원구'), '앞으로 뺀 구가 뒤에 또 나오지 않습니다');
  assert.deepEqual(orderWithFirst([]), GU_ORDER, '아무것도 안 주면 그대로');
  assert.deepEqual(orderWithFirst(['없는구']), GU_ORDER, '목록에 없는 이름은 무시');
  // 일정에도 그대로 실립니다
  const s = schedule('2026-10-20', o);
  assert.equal(s[0].gu, '노원구');
  assert.equal(s[0].date, '2026-10-20');
  assert.equal(s.length, 25);
});
