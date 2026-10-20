// 「다른 곳에서 본 이야기」(_outside.mjs) 스모크 테스트 — 순수 계산, 네트워크 없음
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readUrl, looksCopied, parseOutside, addOutside, reportOutside, publicOutside, outsideDigest,
  SOURCES, RULES, SUMMARY_MAX, SUMMARY_MIN, ROWS_MAX, HIDE_REPORTS,
} from '../site/public/api/_outside.mjs';

const OK = {
  complexId: 1001,
  url: 'https://cafe.naver.com/xyz/12345',
  summary: '주차가 저녁 8시 넘으면 거의 꽉 찬다는 얘기가 여러 번 나왔습니다',
  agree: true,
};

test('원문 주소 읽기 — 어디 글인지 알아보고, 위험한 주소는 막음', () => {
  assert.deepEqual(readUrl('https://cafe.naver.com/abc/1'), { url: 'https://cafe.naver.com/abc/1', host: 'cafe.naver.com', source: 'naver-cafe', label: '네이버 카페' });
  assert.equal(readUrl('https://www.hogangnono.com/apt/1').label, '호갱노노', 'www 는 떼고 알아봄');
  assert.equal(readUrl('hogangnono.com/apt/1').url.startsWith('https://'), true, 'http 가 없으면 https 로 붙임');
  assert.equal(readUrl('https://blog.naver.com/me/1').source, 'naver-blog');
  // 목록에 없는 곳은 호스트를 그대로 보여 줌 — 막지는 않음
  assert.equal(readUrl('https://some-forum.co.kr/p/1').source, 'etc');
  assert.equal(readUrl('https://some-forum.co.kr/p/1').label, 'some-forum.co.kr');

  assert.equal(readUrl('javascript:alert(1)'), null, '스크립트 주소는 막음');
  assert.equal(readUrl('data:text/html,<script>'), null);
  assert.equal(readUrl('file:///C:/secret.txt'), null);
  assert.equal(readUrl(''), null);
  assert.equal(readUrl('그냥 글자'), null, '점이 없으면 주소가 아님');
  assert.ok(SOURCES.some(s => s.key === 'asil'), '아실도 목록에 있음(우리가 긁지 않을 뿐, 사람이 읽고 옮겨 적는 것은 됨)');
});

test('옮겨 적은 것처럼 보이면 되돌려보냄', () => {
  assert.match(looksCopied('"주차가 너무 힘들어요 진짜"'), /따옴표/);
  assert.match(looksCopied('「관리가 엉망입니다」'), /따옴표/);
  assert.match(looksCopied('한 줄\n두 줄\n세 줄\n네 줄'), /여러 문단/);
  assert.match(looksCopied('여기 보세요 https://cafe.naver.com/x'), /주소를 넣지 마세요/);
  assert.match(looksCopied('ㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋ'), /알아볼 수 있게/);
  assert.equal(looksCopied('주차가 저녁에 꽉 찬다는 얘기가 많았습니다'), null, '제대로 쓴 요약은 통과');
});

test('한 건 다듬기 — 링크·요약·확인 세 가지가 모두 있어야 올라감', () => {
  const r = parseOutside(OK, () => Date.parse('2026-09-21T00:00:00Z'));
  assert.equal(r.ok, true);
  assert.equal(r.value.source, 'naver-cafe');
  assert.equal(r.value.sourceLabel, '네이버 카페');
  assert.equal(r.value.hidden, false);
  assert.deepEqual(r.value.reports, []);
  assert.equal(r.value.at, '2026-09-21T00:00:00.000Z');
  assert.equal(r.value.id.length, 10);

  assert.match(parseOutside({ ...OK, complexId: 0 }).error, /단지/);
  assert.match(parseOutside({ ...OK, url: '' }).error, /원문 주소/);
  assert.match(parseOutside({ ...OK, url: 'javascript:alert(1)' }).error, /원문 주소/);
  assert.match(parseOutside({ ...OK, summary: '짧음' }).error, new RegExp(`${SUMMARY_MIN}자`));
  assert.match(parseOutside({ ...OK, summary: 'ㄱ'.repeat(SUMMARY_MAX + 5) }).error, new RegExp(`${SUMMARY_MAX}자`));
  assert.match(parseOutside({ ...OK, summary: '"통째로 옮긴 글입니다 정말로요"' }).error, /따옴표/);
  // 확인을 누르지 않으면 올라가지 않음 — 「내 말로 줄였다」를 사람이 한 번 짚고 가게
  assert.match(parseOutside({ ...OK, agree: false }).error, /확인해 주세요/);
  assert.match(parseOutside({ ...OK, agree: undefined }).error, /확인해 주세요/);
});

test('언제 쓰인 글인지(선택)와 길이 자르기', () => {
  const r = parseOutside({ ...OK, note: '  2026년 9월   글  ' });
  assert.equal(r.value.note, '2026년 9월 글', '공백 정리');
  assert.equal(parseOutside({ ...OK, note: 'x'.repeat(200) }).value.note.length, 60);
});

test('넣기·보관 상한', () => {
  let rows = [];
  for (let i = 0; i < ROWS_MAX + 4; i++) rows = addOutside(rows, parseOutside({ ...OK, summary: `주차 이야기입니다 번호 ${i}번째` }).value, 'u');
  assert.equal(rows.length, ROWS_MAX);
  assert.match(rows[0].summary, new RegExp(`${ROWS_MAX + 3}번째`), '가장 새 글이 앞에');
});

test('신고 — 같은 사람은 한 번, 세 번이면 감춤', () => {
  let rows = addOutside([], parseOutside(OK).value, 'writer');
  const id = rows[0].id;
  rows = reportOutside(rows, id, 'a').value;
  rows = reportOutside(rows, id, 'a').value;
  assert.equal(rows[0].reports.length, 1);
  assert.equal(rows[0].hidden, false);
  rows = reportOutside(rows, id, 'b').value;
  rows = reportOutside(rows, id, 'c').value;
  assert.equal(rows[0].reports.length, HIDE_REPORTS);
  assert.equal(rows[0].hidden, true);
  assert.match(reportOutside(rows, '없는id', 'a').error, /찾지 못/);
});

test('내보내는 값 — 올린 사람·신고자는 나가지 않음', () => {
  let rows = addOutside([], parseOutside(OK).value, 'uid-me');
  rows = reportOutside(rows, rows[0].id, 'spy').value;
  const pub = publicOutside(rows[0], 'uid-me');
  assert.equal(pub.mine, true);
  assert.equal(pub.url, OK.url, '원문으로 갈 수 있어야 함 — 이 기능의 핵심');
  assert.equal(pub.sourceLabel, '네이버 카페');
  const s = JSON.stringify(pub);
  assert.doesNotMatch(s, /uid-me|spy/, 'uid·신고자 목록은 내보내지 않음');
  assert.equal(publicOutside(rows[0], 'other').mine, false);
  assert.match(publicOutside({ ...rows[0], name: '' }, null).name, /^이웃 uid-/);
});

test('한눈에 — 어디 이야기가 얼마나(감춘 것은 빼고)', () => {
  let rows = [];
  rows = addOutside(rows, parseOutside({ ...OK, summary: '주차 이야기가 많았습니다 정말로' }).value, 'a');
  rows = addOutside(rows, parseOutside({ ...OK, summary: '관리비 이야기가 있었습니다 확인' }).value, 'b');
  rows = addOutside(rows, parseOutside({ ...OK, url: 'https://hogangnono.com/apt/1', summary: '학군 이야기가 나왔습니다 참고' }).value, 'c');
  const d0 = outsideDigest(rows);
  assert.equal(d0.n, 3);
  assert.deepEqual(d0.by, [{ label: '네이버 카페', n: 2 }, { label: '호갱노노', n: 1 }], '많은 곳부터');

  const hidden = rows.map((r, i) => (i === 0 ? { ...r, hidden: true } : r));
  const d1 = outsideDigest(hidden);
  assert.equal(d1.n, 2, '감춘 글은 빠짐');
  assert.equal(outsideDigest([]).n, 0);
  assert.equal(outsideDigest([]).updatedAt, null);
});

test('규칙 문구에 왜 이렇게 하는지가 들어 있음', () => {
  assert.ok(RULES.length >= 4);
  assert.ok(RULES.some(r => /그대로 옮기지 마세요/.test(r)), '원문 복사 금지가 첫째');
  assert.ok(RULES.some(r => /저작물/.test(r)), '왜 안 되는지 이유를 밝힘');
  assert.ok(RULES.some(r => /원문 주소/.test(r)), '링크 필수');
});

test('규칙 문구에는 HTML 태그를 넣지 않음 — 화면이 **굵게**만 알아봄', () => {
  // 화면은 cmBold 로 `**…**` 만 굵게 바꾸고 나머지는 글자 그대로 내보냅니다.
  // 규칙에 <b> 를 적으면 태그가 그대로 보입니다(실제로 그렇게 나왔습니다).
  for (const r of RULES) {
    assert.doesNotMatch(r, /<[a-z/]/i, `태그가 들어 있음: ${r}`);
  }
  assert.ok(RULES.some(r => /\*\*/.test(r)), '강조는 ** 로');
});
