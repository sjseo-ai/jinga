// 단지·자치구 정적 페이지(_pages.mjs) 스모크 테스트 — 글자만 만들어 보는 순수 계산
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  esc, slug, aptPath, guPath, usedText, parkPerHouse, parkText, areaMix, rentPct, sourcesAgree, parkAdvice,
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
    // KB 값을 같이 둡니다 — 두 자료가 같은 쪽을 가리켜야 이름을 올리기 때문입니다
    { id: 2, name: '빠듯단지', gu: '성동구', dong: '행당동', households: 800, k: { parkUnder: 0, parkGround: 400, households: 800 }, kbPark: { total: 420, per: 0.53 } },
  ];
  // 시세를 **넘겨도** 페이지에 나오면 안 됩니다. 부르는 쪽(build-pages.mjs)에서 빼는 것만으로는
  // 예전 호출이 하나 남아 있어도 조용히 다시 실립니다 — 그래서 그리는 쪽에서 막고 여기서 지킵니다.
  const p = guPage('성동구', rows, { avgPerPyeong: 7657, vsSeoul: 127, asOf: '2026.09.11', kaptAsOf: '2026.10.12',
    dongs: [{ name: '마장동', count: 5, avgPerPyeong: 6000 }, { name: '행당동', count: 3, avgPerPyeong: 8000 }] });
  assert.equal(p.path, '/gu/성동구/');
  assert.ok(!p.title.includes('평당'), '제목에 시세를 쓰지 않습니다');
  assert.ok(!p.html.includes('7,657') && !p.html.includes('서울 평균의 127%'), 'KB 평당가를 싣지 않습니다');
  assert.ok(!p.html.includes('동네별 평당가') && !p.html.includes('6,000만원'), '동네별 시세도 싣지 않습니다');
  assert.ok(p.html.includes('K-apt') && p.html.includes('2026.10.12'), '남는 것은 국토부 공식 자료');
  assert.ok(p.html.includes('주차가 빠듯한 단지'), '두 자료 모두 세대당 0.5대 안팎이니');
  assert.ok(p.html.includes('빠듯단지'), '두 자료가 일치하면 이름을 올립니다');
  assert.ok(p.html.includes('/apt/1747-청계현대/'), '단지 페이지로 가는 길');
});

test('입구와 sitemap', () => {
  const hub = hubPage([
    { region: 'seoul', rows: [{ gu: '강동구', n: 56 }, { gu: '성동구', n: 43 }] },
    { region: 'gyeonggi', rows: [{ gu: '용인', n: 120 }] },
  ], 1189);
  assert.equal(hub.path, '/apt/');
  assert.ok(hub.html.includes('/gu/강동구/') && hub.html.includes('/gu/용인/'), '두 지역 모두');
  assert.ok(hub.html.includes('1,189'));
  assert.ok(hub.html.includes('서울 자치구로 찾기') && hub.html.includes('경기 시로 찾기'),
    '서울은 「자치구」, 경기는 「시」로 불러야 합니다');

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

test('지역을 가립니다 — 경기 단지를 서울로 적으면 안 됩니다', () => {
  const seoul = aptPage(C, K, { region: 'seoul' }).html;
  assert.ok(seoul.includes('"addressRegion":"서울특별시"'));

  const gg = { ...C, id: 90001, name: '수지한양', gu: '용인', dong: '풍덕천동' };
  const html = aptPage(gg, K, { region: 'gyeonggi' }).html;
  assert.ok(html.includes('"addressRegion":"경기도"'), '경기 단지는 경기도로');
  assert.ok(!html.includes('서울특별시'), '서울이 섞이면 안 됩니다');
  assert.ok(html.includes('/gu/용인/'));

  // 지역을 안 주면 서울로 둡니다(예전 호출을 깨지 않게)
  assert.ok(aptPage(C, K).html.includes('"addressRegion":"서울특별시"'));
});

test('경기 시 페이지 — 평당가 집계가 없어도 만들어집니다', () => {
  const rows = [{ id: 90001, name: '수지한양', gu: '용인', dong: '풍덕천동', households: 800, k: K }];
  const p = guPage('용인', rows, { region: 'gyeonggi' });
  assert.equal(p.path, '/gu/용인/');
  assert.ok(p.html.includes('용인 아파트'));
  assert.ok(p.desc.includes('경기도 용인'), '설명에 지역이 들어가야 검색에서 갈립니다');
  assert.ok(!p.html.includes('평당'), '평당가 자료가 없으면 그 줄은 통째로 빠집니다');
  assert.ok(!/undefined|NaN/.test(p.html));
});

test('주차: 두 자료가 엇갈리면 이름을 짚지 않습니다', () => {
  // 2026-11-12 명일 신동아 — 우리는 K-apt 0.62 로 「빠듯한 곳」에 올렸는데
  // 독자가 본 KB부동산 화면은 1.05 였습니다. 한쪽만 보고 단정한 탓입니다.
  assert.equal(sourcesAgree(0.62, 1.05), false, '1대를 사이에 두고 갈리면 false');
  assert.equal(sourcesAgree(0.62, 0.83), true, '둘 다 1대 미만이면 true');
  assert.equal(sourcesAgree(1.21, 0.51), false, 'K-apt 가 더 높은 반대 경우도 걸러야 합니다');
  assert.equal(sourcesAgree(1.76, 1.8), true);
  assert.equal(sourcesAgree(0.99, 1), false, '경계선도 규칙대로');
  assert.equal(sourcesAgree(0.62, null), null, 'KB 를 모르면 「같다」도 「다르다」도 아닙니다');
  assert.equal(sourcesAgree(null, 1.05), null);

  // 한 마디도 단정하지 않습니다
  assert.match(parkAdvice(0.62, 1.05), /엇갈/);
  assert.match(parkAdvice(0.62, 0.83), /한 대가 안 됩니다/);
  assert.match(parkAdvice(1.5, 1.6), /넉넉/);
  assert.equal(parkAdvice(null, 1.05), '');
});

test('구 페이지: 엇갈리는 단지는 목록에서 빠지고, 왜 뺐는지 밝힙니다', () => {
  const mk = (id, name, hh, under, ground, kbPer) => ({
    id, name, gu: '강동구', dong: '명일동', households: hh,
    k: { households: hh, parkUnder: under, parkGround: ground },
    kbPark: kbPer == null ? null : { total: Math.round(kbPer * hh), per: kbPer },
  });
  const rows = [
    mk(1, '신동아', 570, 0, 355, 1.05),      // 엇갈림 — 빠져야 합니다
    mk(2, '한양', 500, 0, 325, 0.7),         // 둘 다 1대 미만 — 빠듯한 곳
    mk(3, '고덕아이파크', 1000, 1760, 0, 1.8), // 둘 다 1대 이상 — 넉넉한 곳
  ];
  const html = guPage('강동구', rows, { region: 'seoul' }).html;
  assert.ok(!/신동아/.test(html.split('세대수가 많은')[0]), '엇갈리는 단지는 주차 목록에 없어야 합니다');
  assert.ok(/한양/.test(html));
  assert.ok(/고덕아이파크/.test(html));
  assert.match(html, /엇갈리는 단지 1곳은 목록에서 뺐습니다/);
});

test('단지 페이지: 두 숫자를 나란히 싣습니다', () => {
  const c = { id: 1, name: '신동아', gu: '강동구', dong: '명일동', households: 570 };
  const k = { households: 570, parkUnder: 0, parkGround: 355 };
  const html = aptPage(c, k, { region: 'seoul', kbPark: { total: 600, per: 1.05 } }).html;
  assert.match(html, /세대당 0\.62대/, 'K-apt 값');
  assert.match(html, /KB부동산은 세대당 1\.05대/, 'KB 값도 함께');
  assert.match(html, /600대/);
  assert.match(html, /고르지 않고/, '어느 쪽이 맞다고 고르지 않는다고 밝힙니다');

  // KB 를 모르면 그 줄만 빠지고 나머지는 그대로
  const only = aptPage(c, k, { region: 'seoul' }).html;
  assert.match(only, /세대당 0\.62대/);
  assert.ok(!/KB부동산은/.test(only));
});

// ── 실거래 기반 추정 시세 (T011) ────────────────────────────────────────────
// 모델 카드가 요구하는 여섯 가지를 한 화면에 함께 적어야 합니다 —
// 추정치·범위·거래 건수·등급·기준월·출처. 하나라도 빠지면 추정치가 실거래가처럼 읽힙니다.
test('단지 페이지의 추정 시세 — 여섯 가지를 함께 적는다', () => {
  const tp = {
    asOfYM: '202611',
    areas: [{ area: 84, perPyeong: 9800, amount: 249068, low: 224344, high: 274605, n: 3, grade: 'A', last: '202610' }],
  };
  const { html } = aptPage(C, K, { tradePrice: tp });
  assert.ok(html.includes('24.9억'), '추정치');
  assert.ok(html.includes('22.4~27.5억'), '범위');
  assert.ok(html.includes('거래 3건'), '거래 건수');
  assert.ok(html.includes('A등급'), '등급');
  assert.ok(html.includes('2026년 11월 기준'), '기준월');
  assert.ok(html.includes('국토교통부 실거래가'), '출처');
  assert.ok(html.includes('추정치이며 실거래가가 아닙니다'), '추정임을 분명히');
});

test('거래가 적은 면적은 대표값 없이 범위만 — 0 이나 빈칸으로 두지 않는다', () => {
  const tp = { asOfYM: '202611', areas: [{ area: 59, perPyeong: null, amount: null, low: 90000, high: 135000, n: 2, grade: 'D', last: '202605' }] };
  const { html } = aptPage(C, K, { tradePrice: tp });
  assert.ok(html.includes('9~13.5억'), '범위는 보여 줍니다');
  assert.ok(html.includes('대표값 없음'), '왜 숫자가 하나가 아닌지 적습니다');
  assert.ok(!/>\s*0억/.test(html), '0억 같은 값이 나오면 안 됩니다');
});

test('실거래 자료가 없는 단지는 그 칸이 통째로 빠진다', () => {
  const { html } = aptPage(C, K, {});
  assert.ok(!html.includes('실거래로 본 시세'), '없으면 제목도 나오지 않아야 — 빈 표는 고장으로 보입니다');
});

// 자치구 페이지의 평당가 — KB 를 내린 자리를 **실거래**로 되살린 것(2026-11-20).
// 같은 「평당가」라도 재는 것이 다르므로, 무엇을 잰 값인지 화면에 적혀 있어야 합니다.
test('자치구 페이지는 실거래 평당가를 싣되 무엇을 잰 값인지 밝힌다', () => {
  const rows = [{ ...C, k: K }];
  const trade = { perPyeong: 7020, n: 100, months: 3, seoul: { perPyeong: 4580, n: 8431 },
    dongs: [{ name: '광장동', perPyeong: 8559, n: 30 }, { name: '자양동', perPyeong: 7939, n: 41 }] };
  const p = guPage('광진구', rows, { region: 'seoul', kaptAsOf: '2026.10.12', trade });
  assert.ok(p.html.includes('평당 7,020만원'), '평당가');
  assert.ok(p.html.includes('실거래 100건의 중앙값'), '몇 건을 어떻게 셌는지');
  assert.ok(p.html.includes('국토교통부 실거래가'), '출처');
  assert.ok(p.html.includes('시세가 아니라 거래된 값입니다'), 'KB 시세와 다른 것임을 밝힘');
  assert.ok(p.html.includes('광장동') && p.html.includes('8,559'), '동네별');
  assert.ok(p.title.includes('실거래 평당 7,020만원'), '제목에도 실거래임을 밝힘');
});

test('실거래 자료가 없는 자치구는 평당가 칸이 통째로 빠진다', () => {
  const rows = [{ ...C, k: K }];
  const p = guPage('광진구', rows, { region: 'seoul', kaptAsOf: '2026.10.12' });
  assert.ok(!p.html.includes('평당'), '없으면 아예 안 싣습니다');
  assert.ok(!p.title.includes('평당'));
});
