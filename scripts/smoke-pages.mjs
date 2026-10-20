// 단지·자치구 정적 페이지(_pages.mjs) 스모크 테스트 — 글자만 만들어 보는 순수 계산
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  esc, slug, aptPath, guPath, usedText, parkPerHouse, parkText, areaMix, rentPct,
  aptPage, guPage, hubPage, sitemap, SITE,
} from '../scripts/_pages.mjs';

const C = {
  id: 1747, name: '청계현대', gu: '성동구', dong: '마장동', far: 334,
  lat: 37.56, lng: 127.04, hall: '혼합식', approved: '19980401', households: 1017, rentUnits: 0,
};
const K = {
  dongs: 11, households: 1017, heat: '개별난방', hall: '혼합식', sale: '분양', manage: '위탁관리',
  usedAt: '19980401', topFloor: 28, baseFloor: null, lifts: 54,
  parkGround: 238, parkUnder: 804, cctv: 183, struct: '철근콘크리트구조',
  subwayLine: '5호선', subwayStation: '마장', subwayWalk: '5~10분이내', busWalk: '5~10분이내',
  welfare: '관리사무소, 노인정', education: '초등학교(동명초)',
  evGround: 0, evUnder: 22,
  area60: 474, area85: 334, area135: 165, area136: 44,
};

test('글자 새 나가지 않게 막기', () => {
  assert.equal(esc('<script>"x"&\'y\''), '&lt;script&gt;&quot;x&quot;&amp;&#39;y&#39;');
  assert.equal(esc(null), '');
});

test('주소 조각 — 한글은 살리고 위험한 글자는 뺍니다', () => {
  assert.equal(slug('청계현대'), '청계현대');
  assert.equal(slug('삼익그린맨션(2차)'), '삼익그린맨션2차');
  assert.equal(slug('래미안 솔베뉴'), '래미안솔베뉴');
  assert.equal(slug('a/b?c#d'), 'abcd', '주소를 깨뜨리는 글자는 뺍니다');
  assert.equal(slug(''), 'x');
  assert.equal(slug(null), 'x');
});

test('이름이 겹쳐도 주소는 갈립니다 — 겹치는 이름이 29종류입니다', () => {
  assert.equal(aptPath({ id: 1747, name: '청계현대' }), '/apt/1747-청계현대/');
  const a = aptPath({ id: 11, name: '동부센트레빌' });
  const b = aptPath({ id: 22, name: '동부센트레빌' });
  assert.notEqual(a, b, '번호가 앞에 붙어 서로 다릅니다');
  assert.equal(guPath('성동구'), '/gu/성동구/');
});

test('사용승인일 읽기', () => {
  assert.equal(usedText('19980401'), '1998년 4월');
  assert.equal(usedText('20251201'), '2025년 12월');
  assert.equal(usedText('20250000'), '2025년', '달이 이상하면 해만');
  assert.equal(usedText('1998'), null);
  assert.equal(usedText(''), null);
  assert.equal(usedText(null), null);
});

test('주차 — 모르는 것을 0 으로 적지 않습니다', () => {
  assert.equal(parkPerHouse(K, 1017), 1.02);
  assert.equal(parkText(K), '지하 804대 · 지상 238대');
  assert.equal(parkText({ parkUnder: 0, parkGround: 120 }), '지하주차장 없음 · 지상 120대');
  assert.equal(parkText({ parkUnder: 0, parkGround: 0 }), '지하주차장 없음', '0은 진짜 0');
  assert.equal(parkText({}), null, '둘 다 모르면 아무 말도 안 합니다');
  assert.equal(parkText({ parkUnder: null, parkGround: null }), null);
  assert.equal(parkPerHouse({}, 1000), null);
  assert.equal(parkPerHouse(K, 0), null, '세대수를 모르면 나눌 수 없습니다');
});

test('면적대별·임대 비율', () => {
  assert.deepEqual(areaMix(K).map(m => m.label), ['60㎡ 이하', '60~85㎡', '85~135㎡', '135㎡ 초과']);
  assert.deepEqual(areaMix({ area60: 0, area85: 10 }), [{ label: '60~85㎡', n: 10 }], '0세대인 칸은 뺍니다');
  assert.deepEqual(areaMix({}), []);
  assert.equal(rentPct({ households: 1000, rentUnits: 300 }), 30);
  assert.equal(rentPct({ households: 1000, rentUnits: 0 }), 0);
  assert.equal(rentPct({ households: 1000, rentUnits: null }), null);
});

test('단지 페이지 — 검색에 필요한 것이 다 들어갑니다', () => {
  const p = aptPage(C, K, { sameDong: [C, { id: 9, name: '옆단지', gu: '성동구', dong: '마장동', households: 500 }] });
  assert.equal(p.path, '/apt/1747-청계현대/');
  assert.ok(p.title.includes('청계현대') && p.title.includes('성동구'), '제목에 단지명·지역');
  assert.ok(p.desc.includes('1,017세대') && p.desc.includes('지하 804대'), '설명에 핵심 숫자');

  const h = p.html;
  assert.ok(h.startsWith('<!doctype html>'));
  assert.ok(h.includes('<html lang="ko">'));
  assert.ok(h.includes(`<link rel="canonical" href="${SITE}/apt/1747-%EC%B2%AD%EA%B3%84%ED%98%84%EB%8C%80/">`), 'canonical(인코딩)');
  assert.ok(h.includes('property="og:title"') && h.includes('og:image'), '공유 카드');
  assert.ok(h.includes('"@type":"ApartmentComplex"'), '검색엔진이 읽는 구조화 자료');
  assert.ok(h.includes('세대당 1.02대'), '주차가 크게');
  assert.ok(h.includes('60㎡ 이하'), '면적대별');
  assert.ok(h.includes('/gu/성동구/'), '구 페이지로 가는 길');
  assert.ok(h.includes('/apt/9-옆단지/'), '같은 동 다른 단지로 가는 길');
  assert.ok(!h.includes('/apt/1747-청계현대/">청계현대</a>'), '자기 자신은 링크하지 않습니다');
  assert.ok(h.includes('utm_source=aptpage'), '앱으로 보내는 꼬리표');
  assert.ok(h.includes('투자 자문이나 중개가 아니며'), '고지');
});

test('자료가 빈 단지 — 아는 것만 적고 나머지 줄은 통째로 뺍니다', () => {
  const bare = { id: 5, name: '모름단지', gu: '강동구', dong: '천호동', households: null };
  const { html } = aptPage(bare, { dongs: null, parkUnder: null, parkGround: null });
  assert.ok(!/세대당/.test(html), '주차를 모르면 주차 칸이 없습니다');
  assert.ok(!/>0대</.test(html), '0대라고 적지 않습니다');
  assert.ok(!/undefined|null|NaN/.test(html), '빈 값이 글자로 새지 않습니다');
  assert.ok(html.includes('모름단지'));
});

test('자치구 페이지', () => {
  const rows = [
    { ...C, k: K },
    { id: 2, name: '빠듯단지', gu: '성동구', dong: '행당동', households: 800, k: { parkUnder: 0, parkGround: 400, households: 800 } },
  ];
  const p = guPage('성동구', rows, { avgPerPyeong: 7657, vsSeoul: 127, asOf: '2026.09.11',
    dongs: [{ name: '마장동', count: 5, avgPerPyeong: 6000 }, { name: '행당동', count: 3, avgPerPyeong: 8000 }, { name: '한곳뿐', count: 1, avgPerPyeong: 99999 }] });
  assert.equal(p.path, '/gu/성동구/');
  assert.ok(p.title.includes('평당 7,657만원'));
  assert.ok(p.html.includes('서울 평균의 127%'));
  assert.ok(p.html.includes('행당동'), '동네별 평당가');
  assert.ok(!p.html.includes('한곳뿐'), '단지 1곳뿐인 동은 「동네 평균」으로 쓰지 않습니다');
  assert.ok(p.html.includes('주차가 빠듯한 단지'), '세대당 0.5대짜리가 있으니');
  assert.ok(p.html.includes('/apt/1747-청계현대/'), '단지 페이지로 가는 길');
});

test('입구와 sitemap', () => {
  const hub = hubPage([{ gu: '강동구', n: 56 }, { gu: '성동구', n: 43 }], 1069);
  assert.equal(hub.path, '/apt/');
  assert.ok(hub.html.includes('/gu/강동구/'));
  assert.ok(hub.html.includes('1,069'));

  const sm = sitemap(['/apt/1747-청계현대/', '/gu/성동구/'], '2026-10-19');
  assert.ok(sm.startsWith('<?xml'));
  assert.ok(sm.includes(`${SITE}/apt/1747-%EC%B2%AD%EA%B3%84%ED%98%84%EB%8C%80/`));
  assert.ok(sm.includes(`${SITE}/gu/%EC%84%B1%EB%8F%99%EA%B5%AC/`));
  assert.ok(sm.includes(`${SITE}/`) && sm.includes('/legal.html'));
  assert.equal((sm.match(/<url>/g) || []).length, 5, '첫 화면 + 입구 + 준 주소 2개 + 약관 = 5개');
});

test('sitemap·canonical 은 인코딩된 주소여야 합니다 — 크롤러가 받아 가는 주소와 같아야 하니까', () => {
  const { html } = aptPage(C, K);
  assert.ok(html.includes('canonical" href="https://jinga-retech.vercel.app/apt/1747-%EC%B2%AD%EA%B3%84%ED%98%84%EB%8C%80/"'),
    'canonical 이 인코딩돼 있어야 합니다');
  assert.ok(!/canonical" href="[^"]*청계현대/.test(html), 'canonical 에 날한글이 남으면 안 됩니다');
  assert.ok(html.includes('og:url" content="https://jinga-retech.vercel.app/apt/1747-%EC%B2%AD'), 'og:url 도');

  const sm = sitemap(['/apt/1747-청계현대/', '/gu/성동구/'], '2026-10-19');
  assert.ok(sm.includes('/apt/1747-%EC%B2%AD%EA%B3%84%ED%98%84%EB%8C%80/'));
  assert.ok(sm.includes('/gu/%EC%84%B1%EB%8F%99%EA%B5%AC/'));
  assert.ok(!/<loc>[^<]*[가-힣]/.test(sm), 'sitemap 에 날한글이 남으면 안 됩니다');
  // 화면에 보이는 링크(href)는 읽기 좋게 한글 그대로 둡니다 — 브라우저가 알아서 바꿉니다
  assert.ok(html.includes('href="/gu/성동구/"'), '사람이 보는 링크는 한글 그대로');
});
