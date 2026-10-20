// 커뮤니티(이웃 평가·임장 후기)와 임장동행 매칭의 순수 계산 스모크 테스트 — 네트워크·저장소 없음
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ASPECTS, ASPECT_KEYS, CHECKLIST, CHECK_KEYS, parseRating, parseVisit, aggregate, aggregateChecks,
  ratingText, upsert, applyReport, REPORT_HIDE, memberId, displayName, publicRow, TEXT_MAX,
} from '../site/public/api/_community.mjs';
import {
  KINDS, KIND_KEYS, parseHost, parseRequest, matchHosts, applyTo, accept,
  looksLikeLicense, publicHost, publicRequest, HOST_RULES, REGION_MAX,
} from '../site/public/api/_companion.mjs';

const NOW = () => new Date('2026-09-18T01:00:00Z');

test('평가 항목은 진가 점수가 못 보는 것만 — 값 검사', () => {
  assert.deepEqual(ASPECT_KEYS, ['parking', 'noise', 'mgmt', 'mood', 'shops']);
  assert.ok(ASPECTS.every(a => a.label && a.desc));

  const ok = parseRating({ complexId: 186, scores: { parking: 2, noise: 4 }, text: ' 주차가  많이 힘듭니다 ', lived: true }, { now: NOW });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.value.scores, { parking: 2, noise: 4 }, '비워 둔 항목은 빠짐');
  assert.equal(ok.value.text, '주차가 많이 힘듭니다', '공백 정리');
  assert.equal(ok.value.lived, true);
  assert.equal(ok.value.hidden, false);

  assert.match(parseRating({ complexId: 0, scores: { parking: 3 } }).error, /단지/);
  assert.match(parseRating({ complexId: 1, scores: {} }).error, /하나 이상/);
  assert.match(parseRating({ complexId: 1, scores: { parking: 6 } }).error, /1~5/);
  assert.match(parseRating({ complexId: 1, scores: { parking: 2.5 } }).error, /1~5/);
  assert.equal(parseRating({ complexId: 1, scores: { parking: 3 }, text: 'ㄱ'.repeat(TEXT_MAX + 50) }).value.text.length, TEXT_MAX, '긴 글은 잘림');
});

test('평가 집계 — 항목마다 매긴 사람 수를 따로 세고, 숨긴 글은 뺌', () => {
  const rows = [
    { scores: { parking: 2, noise: 4, mgmt: 4 }, lived: true, at: '2026-09-01T00:00:00Z' },
    { scores: { parking: 3, noise: 5 }, lived: false, at: '2026-09-10T00:00:00Z' },
    { scores: { parking: 5, noise: 5 }, lived: true, at: '2026-09-15T00:00:00Z', hidden: true },   // 신고로 숨김
  ];
  const agg = aggregate(rows);
  assert.equal(agg.n, 2, '숨긴 글 제외');
  assert.equal(agg.lived, 1);
  assert.deepEqual(agg.by.parking, { avg: 2.5, n: 2 });
  assert.deepEqual(agg.by.noise, { avg: 4.5, n: 2 });
  assert.deepEqual(agg.by.mgmt, { avg: 4, n: 1 }, '한 명만 매긴 항목도 셈');
  assert.equal(agg.by.mood, undefined, '아무도 안 매긴 항목은 없음');
  assert.equal(agg.overall, 3.6, '항목별 평균을 매긴 사람 수로 가중');
  assert.equal(agg.updatedAt, '2026-09-10T00:00:00Z');
  assert.deepEqual(aggregate([]), { overall: null, n: 0, lived: 0, by: {}, updatedAt: null });

  assert.match(ratingText(agg), /^이웃 평가 3\.6\(2명\) · 주차 2\.5 · 조용함 4\.5/);
  assert.equal(ratingText(aggregate([])), '', '평가가 없으면 빈 문구');
});

test('임장 후기 — 체크리스트 항목과 집계', () => {
  assert.deepEqual(CHECK_KEYS, ['water', 'leak', 'light', 'noise', 'parking', 'elev', 'slope', 'shops']);
  const v = parseVisit({ complexId: 186, checks: { water: 'good', leak: 'bad', light: 'na' }, text: '오후에 볕이 잘 듦', visitedAt: '2026-09-14' }, { now: NOW });
  assert.equal(v.ok, true);
  assert.deepEqual(v.value.checks, { water: 'good', leak: 'bad' }, '「확인 못 함」은 빼고 저장');
  assert.equal(v.value.visitedAt, '2026-09-14');
  assert.match(parseVisit({ complexId: 1, checks: {}, text: '' }).error, /하나는/);
  assert.match(parseVisit({ complexId: 1, checks: { water: '좋음' } }).error, /올바르지/);
  assert.equal(parseVisit({ complexId: 1, text: '메모만' }).ok, true, '후기만 써도 됨');
  assert.equal(parseVisit({ complexId: 1, text: 'x', visitedAt: '2026-9-1' }).value.visitedAt, null, '날짜 형식이 아니면 비움');

  const agg = aggregateChecks([
    { checks: { water: 'good', parking: 'bad' }, at: '2026-09-01T00:00:00Z' },
    { checks: { water: 'good', parking: 'fair' }, at: '2026-09-05T00:00:00Z' },
    { checks: { water: 'bad' }, at: '2026-09-09T00:00:00Z', hidden: true },
  ]);
  assert.deepEqual(agg.by.water, { good: 2, fair: 0, bad: 0, n: 2 });
  assert.deepEqual(agg.by.parking, { good: 0, fair: 1, bad: 1, n: 2 });
  assert.equal(agg.n, 2);
});

test('같은 사람이 다시 쓰면 덮어쓰고, 신고가 쌓이면 감춤', () => {
  const uid = memberId('me@kch.co.kr');
  assert.equal(uid, memberId(' ME@KCH.CO.KR '), '대소문자·공백이 달라도 같은 사람');
  assert.notEqual(uid, memberId('me@kch.co.kr', 'salt'), '소금이 다르면 다른 id');
  assert.equal(uid.length, 24);

  let rows = [];
  rows = upsert(rows, { complexId: 186, scores: { parking: 2 }, at: 'a' }, uid);
  rows = upsert(rows, { complexId: 186, scores: { parking: 4 }, at: 'b' }, uid);
  rows = upsert(rows, { complexId: 999, scores: { parking: 1 }, at: 'c' }, uid);
  assert.equal(rows.filter(r => r.complexId === 186).length, 1, '같은 단지엔 한 사람 한 건');
  assert.equal(rows.find(r => r.complexId === 186).scores.parking, 4, '나중 값으로');
  assert.equal(rows.length, 2, '다른 단지는 따로');

  const target = rows[0].id;
  let r1 = applyReport(rows, target, 'u1');
  assert.equal(r1.ok, true);
  r1 = applyReport(r1.rows, target, 'u1');                       // 같은 사람이 또 신고
  assert.equal(r1.rows.find(r => r.id === target).reports, 1, '같은 사람은 한 번만');
  r1 = applyReport(r1.rows, target, 'u2');
  r1 = applyReport(r1.rows, target, 'u3');
  const hit = r1.rows.find(r => r.id === target);
  assert.equal(hit.reports, REPORT_HIDE);
  assert.equal(hit.hidden, true, '신고 3건이면 자동으로 감춤');
  assert.equal(applyReport(rows, '없는id', 'u1').ok, false);

  assert.equal(displayName('', 'hongkildong@x.com'), 'ho***');
  assert.equal(displayName('길동이', 'x@y.com'), '길동이');
  assert.equal(publicRow({ id: 'a', uid: 'SECRET', reportedBy: ['u1'], at: 'x', text: 't' }).uid, undefined, '이메일·신고자는 내보내지 않음');
});

test('동행자 — 이웃은 바로 활동, 공인중개사는 등록번호 확인 뒤 활동', () => {
  assert.deepEqual(KIND_KEYS, ['neighbor', 'agent']);
  assert.equal(KINDS.neighbor.needsLicense, false);
  assert.equal(KINDS.agent.needsLicense, true);
  assert.match(KINDS.neighbor.cannot, /공인중개사법/);

  const n = parseHost({ kind: 'neighbor', name: '고덕이웃', regions: ['강동구', '강동구', '송파구'], intro: '3년 살았습니다', agree: true }, { now: NOW });
  assert.equal(n.ok, true);
  assert.deepEqual(n.value.regions, ['강동구', '송파구'], '중복 제거');
  assert.equal(n.value.status, 'active', '이웃은 바로 활동');
  assert.equal(n.value.license, '', '이웃은 등록번호를 저장하지 않음');

  const a = parseHost({ kind: 'agent', name: '대치공인', regions: ['강남구'], license: '11680-2024', agree: true }, { now: NOW });
  assert.equal(a.ok, true);
  assert.equal(a.value.status, 'pending', '공인중개사는 관리자 확인 대기');
  assert.equal(a.value.verified, false);

  assert.match(parseHost({ kind: 'agent', name: '중개', regions: ['강남구'], license: '없음', agree: true }).error, /등록번호/);
  assert.match(parseHost({ kind: 'neighbor', name: '고', regions: ['강동구'], agree: true }).error, /2자 이상/);
  assert.match(parseHost({ kind: 'neighbor', name: '이웃', regions: [], agree: true }).error, /지역/);
  assert.match(parseHost({ kind: 'neighbor', name: '이웃', regions: ['강동구'] }).error, /수칙에 동의/);
  assert.match(parseHost({ kind: '없음', name: '이웃', regions: ['강동구'], agree: true }).error, /종류/);
  assert.equal(parseHost({ kind: 'neighbor', name: '이웃', regions: Array.from({ length: 9 }, (_, i) => '구' + i), agree: true }).value.regions.length, REGION_MAX);
  assert.equal(looksLikeLicense('11680-2024'), true);
  assert.equal(looksLikeLicense('강남-1'), false);
});

test('요청 → 지원 → 수락(이때만 연락처 공개)', () => {
  const req = parseRequest({ region: '강동구', complexName: '고덕그라시움', when: '이번 주 토요일 오전', wantKind: null, agree: true }, { now: NOW });
  assert.equal(req.ok, true);
  assert.equal(req.value.status, 'open');
  assert.match(parseRequest({ region: '', when: '토요일', agree: true }).error, /지역/);
  assert.match(parseRequest({ region: '강동구', when: '', agree: true }).error, /언제/);
  assert.match(parseRequest({ region: '강동구', when: '토요일' }).error, /동의/);

  const hosts = [
    { id: 'h1', kind: 'neighbor', regions: ['강동구'], status: 'active', done: 5, at: '2026-01-01' },
    { id: 'h2', kind: 'agent', regions: ['강동구'], status: 'active', verified: true, done: 1, at: '2026-02-01' },
    { id: 'h3', kind: 'agent', regions: ['강동구'], status: 'pending', verified: false, done: 0, at: '2026-03-01' },
    { id: 'h4', kind: 'neighbor', regions: ['송파구'], status: 'active', done: 9, at: '2026-01-01' },
  ];
  const m = matchHosts(req.value, hosts);
  assert.deepEqual(m.map(h => h.id), ['h2', 'h1'], '확인된 공인중개사 먼저, 대기·다른 지역은 제외');
  assert.deepEqual(matchHosts({ ...req.value, wantKind: 'neighbor' }, hosts).map(h => h.id), ['h1'], '종류를 지정하면 그 종류만');

  let r = applyTo(req.value, 'h1');
  assert.equal(r.ok, true);
  r = applyTo(r.value, 'h1');
  assert.deepEqual(r.value.applicants, ['h1'], '같은 사람이 또 눌러도 한 번');
  r = applyTo(r.value, 'h2');
  assert.deepEqual(r.value.applicants, ['h1', 'h2']);

  assert.match(accept(r.value, 'h9').error, /지원하지 않은/);
  const acc = accept(r.value, 'h2', { now: NOW });
  assert.equal(acc.ok, true);
  assert.equal(acc.value.status, 'matched');
  assert.equal(acc.value.matchedHostId, 'h2');
  assert.equal(applyTo(acc.value, 'h3').ok, false, '마감된 요청엔 지원 불가');
  assert.equal(accept(acc.value, 'h1').ok, false);

  // 내보낼 때 개인정보가 섞이지 않는지
  const ph = publicHost({ id: 'h2', kind: 'agent', name: '대치공인', regions: ['강남구'], license: '11680-2024', intro: 'x', verified: true, done: 1, at: 'z' });
  assert.equal(ph.license, undefined, '등록번호는 내보내지 않음');
  assert.equal(ph.kindLabel, '개업공인중개사');
  assert.match(ph.cannot, /법정 상한/);
  const pr = publicRequest({ id: 'r1', uid: 'U', region: '강동구', when: '토', status: 'open', applicants: ['h1'] }, { forUid: 'U' });
  assert.equal(pr.uid, undefined);
  assert.equal(pr.applicants, 1, '지원자는 수만 공개');
  assert.equal(pr.mine, true);

  assert.ok(HOST_RULES.some(r2 => /무등록 중개업/.test(r2)), '수칙에 법적 경계를 적어 둠');
  assert.ok(HOST_RULES.some(r2 => /수수료를 받지 않습니다/.test(r2)));
});

test('한눈에 보기 요약과 바깥 바로가기 — 남의 글은 옮기지 않고 링크만', async () => {
  const m = await import('../site/public/api/_community.mjs');

  const rows = [
    { scores: { parking: 2, noise: 4, mgmt: 5 }, text: '밤에 주차 자리가 정말 없습니다', at: '2026-09-01' },
    { scores: { parking: 3, noise: 5, mgmt: 5 }, text: '관리사무소가 부지런해요', at: '2026-09-10' },
    { scores: { parking: 2, noise: 4 }, at: '2026-09-12' },
    { scores: { parking: 1 }, text: '가려진 글', at: '2026-09-13', hidden: true },
  ];
  const agg = m.aggregate(rows);
  const d = m.digest(agg, rows.filter(r => !r.hidden));
  assert.equal(d.source, '진가 커뮤니티');
  assert.equal(d.n, 3, '가려진 글은 빠짐');
  assert.equal(d.avg, agg.overall);
  assert.deepEqual(d.goods.map(g => g.label), ['관리 상태', '조용함'], '4.0 이상은 「좋음」, 높은 순');
  assert.deepEqual(d.weaks.map(g => g.label), ['주차'], '2.8 이하는 「아쉬움」');
  assert.equal(d.quotes.length, 2, '최근 후기 두 개');
  assert.match(d.text, /^진가 커뮤니티\(3명\) : 3\.7\/5 · 좋음 관리 상태 5\.0·조용함 4\.3 \/ 아쉬움 주차 2\.3 · “/);

  assert.equal(m.digest(m.aggregate([]), []).text, '', '평가가 없으면 빈 문구');
  const long = m.digest(m.aggregate([{ scores: { parking: 3 }, text: 'ㄱ'.repeat(200), at: 'a' }]), [{ scores: { parking: 3 }, text: 'ㄱ'.repeat(200), at: 'a' }]);
  assert.ok(long.quotes[0].endsWith('…'), '긴 후기는 줄임표');

  // 바깥 링크 — 좌표가 있으면 네이버 부동산까지, 없으면 검색 링크만
  const links = m.outsideLinks({ name: '고덕그라시움', gu: '강동구', dong: '고덕동', lat: 37.5561, lng: 127.1543 });
  assert.deepEqual(links.map(l => l.site), ['네이버 부동산', '카카오맵', '네이버 검색', '호갱노노']);
  assert.match(links[0].url, /new\.land\.naver\.com\/complexes\?ms=37\.5561,127\.1543,17/);
  assert.match(links[2].url, /search\.naver\.com/);
  assert.ok(links.every(l => /^https:\/\//.test(l.url)), '모두 바깥으로 나가는 링크');
  assert.equal(m.outsideLinks({ name: '이름만' }).some(l => l.site === '네이버 부동산'), false, '좌표가 없으면 좌표 링크는 빼기');
});
