// 커뮤니티 모아 보기(_hub.mjs) 스모크 테스트 — 순수 계산, 네트워크 없음
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hubEntry, putEntry, requestCounts, searchHub, cleanMeta, idFromPath, rankScore,
  HUB_KINDS, HUB_SORTS, HUB_PAGE,
} from '../site/public/api/_hub.mjs';

const R = (at, scores, text, extra = {}) => ({ complexId: 1, scores, text, at, hidden: false, reports: 0, uid: 'u' + at, ...extra });
const V = (at, text, extra = {}) => ({ complexId: 1, checks: { slope: 'good' }, text, at, hidden: false, reports: 0, uid: 'v' + at, ...extra });

test('단지 한 줄 요약 — 평가·후기를 합쳐 최근 글 한 줄까지', () => {
  const e = hubEntry(1, {
    ratings: [R('2026-09-10', { mgmt: 5, parking: 3 }, '관리가 잘 됩니다'), R('2026-09-12', { mgmt: 4 }, '주차가 불편해요', { lived: true })],
    visits: [V('2026-09-15', '역까지 언덕이 없습니다')],
    meta: { name: '  고덕그라시움  ', gu: '강동구', dong: '고덕동' },
  });
  assert.equal(e.id, 1);
  assert.equal(e.name, '고덕그라시움', '이름 공백 정리');
  assert.equal(e.ratings, 2);
  assert.equal(e.avg, 4, '평균은 소수 한 자리');
  assert.equal(e.lived, 1);
  assert.equal(e.visits, 1);
  assert.equal(e.last.kind, 'visit', '가장 최근 글이 후기');
  assert.equal(e.last.text, '역까지 언덕이 없습니다');
  assert.equal(e.lastAt, '2026-09-15');
});

test('감춰진 글은 요약·최근 글에서 빠짐', () => {
  const e = hubEntry(1, {
    ratings: [R('2026-09-10', { mgmt: 4 }, '보이는 글'), R('2026-09-20', { mgmt: 1 }, '광고 글', { hidden: true })],
  });
  assert.equal(e.ratings, 1);
  assert.equal(e.avg, 4, '감춘 1점은 평균에 안 들어감');
  assert.equal(e.last.text, '보이는 글', '감춘 글이 최근 글로 올라오지 않음');
});

test('이름을 이번에 못 받으면 예전 색인 이름을 그대로', () => {
  const prev = { id: 1, name: '고덕그라시움', gu: '강동구', dong: '고덕동', lastAt: '2026-09-01' };
  const e = hubEntry(1, { ratings: [R('2026-09-10', { mgmt: 4 }, '좋아요')], meta: {}, prev });
  assert.equal(e.name, '고덕그라시움');
  assert.equal(e.gu, '강동구');
  assert.equal(cleanMeta({ name: 'x'.repeat(100) }).name.length, 40, '이름은 40자까지');
});

test('색인 고치기 — 글이 다 사라지면 줄을 뺌', () => {
  let idx = putEntry({}, hubEntry(1, { ratings: [R('2026-09-10', { mgmt: 4 }, '글')], meta: { name: 'A' } }));
  assert.ok(idx[1]);
  idx = putEntry(idx, hubEntry(1, { ratings: [R('2026-09-10', { mgmt: 4 }, '글', { hidden: true })] }));
  assert.equal(idx[1], undefined, '보이는 글이 없으면 목록에서 뺌');
});

test('동행 요청 — 단지별 열린 요청 수, 닫힌 것은 빼고', () => {
  const by = requestCounts([
    { complexId: 1, complexName: '고덕그라시움', region: '강동구', status: 'open' },
    { complexId: 1, status: 'open' },
    { complexId: 1, status: 'matched' },
    { complexId: 2, complexName: '헬리오시티', region: '송파구', status: 'closed' },
    { complexId: null, status: 'open' },
  ]);
  assert.equal(by[1].open, 2, '열린 것만');
  assert.equal(by[1].name, '고덕그라시움');
  assert.equal(by[2], undefined, '닫힌 요청만 있는 단지는 없음');
});

// 목록 시험용 — 세 단지
const IDX = {
  1: { id: 1, name: '고덕그라시움', gu: '강동구', dong: '고덕동', ratings: 22, avg: 4.1, lived: 10, visits: 3, lastAt: '2026-09-15', last: { kind: 'visit', text: '역까지 평지입니다' } },
  2: { id: 2, name: '헬리오시티', gu: '송파구', dong: '가락동', ratings: 1, avg: 5, lived: 0, visits: 0, outside: 1, lastAt: '2026-09-17', last: { kind: 'rating', text: '주차 넉넉' } },
  3: { id: 3, name: '래미안 원베일리', gu: '서초구', dong: '반포동', ratings: 0, avg: null, lived: 0, visits: 5, lastAt: '2026-09-10', last: { kind: 'visit', text: '경사가 있어요' } },
};
const REQ = [{ complexId: 4, complexName: '마포래미안푸르지오', region: '마포구', status: 'open' }, { complexId: 1, status: 'open' }];

test('목록 — 색인과 동행 요청을 단지별로 합침', () => {
  const r = searchHub(IDX, REQ);
  assert.equal(r.total, 4, '글 있는 3곳 + 동행 요청만 있는 1곳');
  assert.equal(r.rows.find(x => x.id === 4).name, '마포래미안푸르지오', '요청에 적힌 이름을 씀');
  assert.equal(r.rows.find(x => x.id === 1).requests, 1);
  assert.deepEqual(r.regions, ['강동구', '마포구', '서초구', '송파구'], '지역 칸 목록은 가나다순');
  assert.deepEqual(r.sums, { complexes: 4, ratings: 23, visits: 8, outside: 1, requests: 2 });
});

test('한 칸 검색 — 이름·지역·동·글 내용, 띄어쓰기 무시', () => {
  assert.deepEqual(searchHub(IDX, [], { q: '고덕' }).rows.map(r => r.id), [1]);
  assert.deepEqual(searchHub(IDX, [], { q: '송파' }).rows.map(r => r.id), [2], '지역으로도');
  assert.deepEqual(searchHub(IDX, [], { q: '반포동' }).rows.map(r => r.id), [3], '동으로도');
  assert.deepEqual(searchHub(IDX, [], { q: '래미안원베일리' }).rows.map(r => r.id), [3], '띄어쓰기 없이 쳐도');
  assert.deepEqual(searchHub(IDX, [], { q: '경사' }).rows.map(r => r.id), [3], '최근 글 내용으로도');
  assert.equal(searchHub(IDX, [], { q: '없는단지' }).total, 0);
});

test('분류·지역으로 거르기', () => {
  assert.deepEqual(searchHub(IDX, REQ, { kind: 'rating' }).rows.map(r => r.id).sort(), [1, 2]);
  assert.deepEqual(searchHub(IDX, REQ, { kind: 'visit' }).rows.map(r => r.id).sort(), [1, 3]);
  assert.deepEqual(searchHub(IDX, REQ, { kind: 'companion' }).rows.map(r => r.id).sort(), [1, 4]);
  assert.deepEqual(searchHub(IDX, REQ, { region: '서초구' }).rows.map(r => r.id), [3]);
  assert.equal(searchHub(IDX, REQ, { region: '서초구' }).regions.length, 4, '지역을 골라도 지역 목록은 그대로');
  assert.deepEqual(HUB_KINDS.map(k => k.key), ['', 'rating', 'visit', 'outside', 'companion']);
  assert.deepEqual(searchHub(IDX, REQ, { kind: 'outside' }).rows.map(r => r.id), [2], '다른 곳 이야기가 있는 단지만');
});

test('정렬 — 최근·글 많은·평점(평가 없는 단지는 뒤로)', () => {
  assert.deepEqual(searchHub(IDX, [], { sort: 'recent' }).rows.map(r => r.id), [2, 1, 3]);
  assert.deepEqual(searchHub(IDX, [], { sort: 'many' }).rows.map(r => r.id), [1, 3, 2]);
  // 한 사람이 준 5.0(헬리오시티)보다 스물두 명이 준 4.1(고덕그라시움)이 위 — 평가가 적으면 평균을 중간값 쪽으로 당김
  const s = searchHub(IDX, [], { sort: 'score' }).rows.map(r => r.id);
  assert.deepEqual(s, [1, 2, 3], '22명 4.1 → 1명 5.0 → 평가 없음');
  assert.ok(rankScore(IDX[1]) > rankScore(IDX[2]));
  assert.equal(rankScore(IDX[3]), -1, '평가 없는 단지는 맨 뒤');
  // 평가가 충분히 쌓이면 평균대로 — 30명 5.0 은 22명 4.1 보다 위
  assert.ok(rankScore({ avg: 5, ratings: 30 }) > rankScore(IDX[1]));
  assert.deepEqual(HUB_SORTS.map(x => x.key), ['recent', 'many', 'score']);
});

test('쪽 나누기와 파일 이름에서 단지 번호', () => {
  const big = {};
  for (let i = 1; i <= HUB_PAGE + 5; i++) big[i] = { id: i, name: '단지' + i, gu: '강동구', ratings: 1, avg: 4, visits: 0, lastAt: `2026-09-${String(i % 28 + 1).padStart(2, '0')}` };
  const p1 = searchHub(big, [], { page: 1 });
  assert.equal(p1.rows.length, HUB_PAGE);
  assert.equal(p1.pages, 2);
  assert.equal(searchHub(big, [], { page: 2 }).rows.length, 5);
  assert.equal(idFromPath('community/ratings/12345.json'), 12345);
  assert.equal(idFromPath('community/index.json'), null);
});

test('다른 곳 이야기도 색인에 — 수·최근 글·출처', () => {
  const O = (at, summary, sourceLabel = '네이버 카페', extra = {}) => ({ id: 'o' + at, url: 'https://cafe.naver.com/x/1', host: 'cafe.naver.com', source: 'naver-cafe', sourceLabel, summary, at, hidden: false, reports: [], ...extra });
  const e = hubEntry(1, {
    ratings: [R('2026-09-10', { mgmt: 4 }, '관리 좋음')],
    outside: [O('2026-09-19', '주차가 저녁에 꽉 찬다는 얘기'), O('2026-09-18', '학군 이야기', '호갱노노')],
    meta: { name: '고덕그라시움', gu: '강동구' },
  });
  assert.equal(e.outside, 2);
  assert.deepEqual(e.outsideBy, [{ label: '네이버 카페', n: 1 }, { label: '호갱노노', n: 1 }]);
  assert.equal(e.last.kind, 'outside', '가장 최근 글이 다른 곳 이야기');
  assert.equal(e.last.text, '주차가 저녁에 꽉 찬다는 얘기', '요약이 본문 자리에 들어감');

  // 감춘 것은 빠지고, 다른 곳 이야기만 있어도 색인에 남음
  const onlyOutside = hubEntry(2, { outside: [O('2026-09-19', '관리비 이야기'), O('2026-09-20', '광고 글', '네이버 카페', { hidden: true })] });
  assert.equal(onlyOutside.outside, 1);
  assert.ok(putEntry({}, onlyOutside)[2], '평가·후기가 없어도 다른 곳 이야기가 있으면 목록에 남음');
  assert.equal(putEntry({}, hubEntry(3, {}))[3], undefined, '셋 다 없으면 빠짐');
});
