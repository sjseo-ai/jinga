// 의견·문의 게시판(_board.mjs) 스모크 테스트 — 순수 계산, 네트워크 없음
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePost, parseReply, addPost, addReply, report, adminOp, publicPost, listPosts, counts,
  displayName, kindLabel, statusLabel, targetOf,
  KINDS, TARGETS, STATUSES, TITLE_MAX, BODY_MAX, POST_MAX, REPLY_HIDE, PAGE,
} from '../site/public/api/_board.mjs';

const at = t => () => Date.parse(`2026-09-${String(t).padStart(2, '0')}T00:00:00Z`);
const post = (over = {}, t = 10) => parsePost({ title: '강남구 배점이 이상합니다', body: '가격 안전 배점이 너무 큽니다.', kind: 'score', target: 'kb', ...over }, at(t)).value;

test('글 다듬기 — 값 검사와 잘라내기', () => {
  const r = parsePost({ title: '  배점   문의  ', body: '가격 안전이 25점인 근거가 궁금합니다.', kind: 'score', target: 'kb', name: '이웃A' });
  assert.equal(r.ok, true);
  assert.equal(r.value.title, '배점 문의', '제목은 한 줄로 공백 정리');
  assert.equal(r.value.kind, 'score');
  assert.equal(r.value.target, 'kb');
  assert.equal(r.value.status, 'open', '처음은 접수');
  assert.deepEqual(r.value.replies, []);
  assert.equal(r.value.hidden, false);
  assert.equal(r.value.id.length, 12);

  assert.match(parsePost({ title: 'ㄱ', body: '내용이 충분합니다' }).error, /제목/);
  assert.match(parsePost({ title: '제대로 된 제목', body: '짧음' }).error, /내용/);
  assert.equal(parsePost({ title: 'x'.repeat(200), body: '내용이 충분합니다' }).value.title.length, TITLE_MAX);
  assert.equal(parsePost({ title: '제목입니다', body: 'y'.repeat(5000) }).value.body.length, BODY_MAX);

  // 모르는 분류·대상은 조용히 기본값으로
  assert.equal(parsePost({ title: '제목입니다', body: '내용이 충분합니다', kind: '해킹' }).value.kind, 'etc');
  assert.equal(parsePost({ title: '제목입니다', body: '내용이 충분합니다', kind: 'score', target: '없는것' }).value.target, 'none');
  // 산식 이야기가 아니면 대상은 의미가 없음
  assert.equal(parsePost({ title: '제목입니다', body: '내용이 충분합니다', kind: 'bug', target: 'kb' }).value.target, 'none');

  assert.deepEqual(KINDS.map(k => k.key), ['score', 'data', 'bug', 'idea', 'etc']);
  assert.equal(kindLabel('score'), '점수 산식');
  assert.equal(kindLabel('없는것'), '기타');
  assert.equal(targetOf('reco').file, 'jinga-reco.mjs', '어느 파일을 보면 되는지 짚어 줌');
  assert.equal(targetOf('없는것'), null);
});

test('답글 — 운영자 답글은 표시되고 상태가 「답변 완료」로', () => {
  let posts = addPost([], post(), 'u1');
  const r = parseReply({ body: '확인해 보겠습니다' }, { admin: true, now: at(11) });
  assert.equal(r.value.admin, true);
  assert.equal(r.value.name, '운영자');

  const after = addReply(posts, posts[0].id, r.value, 'admin');
  assert.equal(after.ok, true);
  assert.equal(after.value[0].replies.length, 1);
  assert.equal(after.value[0].status, 'answered', '운영자가 답하면 접수 → 답변 완료');

  // 이미 손댄 상태는 답글이 덮지 않음
  const accepted = adminOp(after.value, { op: 'status', postId: posts[0].id, status: 'accepted' }).value;
  const more = addReply(accepted, posts[0].id, parseReply({ body: '반영했습니다' }, { admin: true }).value, 'admin');
  assert.equal(more.value[0].status, 'accepted', '「반영함」을 「답변 완료」로 되돌리지 않음');

  // 일반 답글은 상태를 바꾸지 않음
  const plain = addReply(posts, posts[0].id, parseReply({ body: '저도 같은 생각입니다' }).value, 'u2');
  assert.equal(plain.value[0].status, 'open');
  assert.equal(plain.value[0].replies[0].admin, false);

  assert.match(parseReply({ body: 'ㄱ' }).error, /답글/);
  assert.match(addReply(posts, '없는id', r.value, 'u2').error, /찾지 못/);
});

test('신고 — 같은 사람은 한 번만, 세 번 쌓이면 감춤', () => {
  let posts = addPost([], post(), 'u1');
  const id = posts[0].id;
  posts = report(posts, { postId: id, uid: 'a' }).value;
  posts = report(posts, { postId: id, uid: 'a' }).value;
  assert.equal(posts[0].reports.length, 1, '같은 사람이 여러 번 눌러도 한 번');
  assert.equal(posts[0].hidden, false);
  posts = report(posts, { postId: id, uid: 'b' }).value;
  posts = report(posts, { postId: id, uid: 'c' }).value;
  assert.equal(posts[0].reports.length, REPLY_HIDE);
  assert.equal(posts[0].hidden, true, '세 명이 신고하면 자동으로 감춤');

  // 답글도 따로 신고됨
  let p2 = addPost([], post(), 'u1');
  p2 = addReply(p2, p2[0].id, parseReply({ body: '광고 글입니다 여기로 오세요' }).value, 'spam').value;
  const rid = p2[0].replies[0].id;
  for (const who of ['a', 'b', 'c']) p2 = report(p2, { postId: p2[0].id, replyId: rid, uid: who }).value;
  assert.equal(p2[0].replies[0].hidden, true);
  assert.equal(p2[0].hidden, false, '답글을 신고해도 글 자체는 그대로');
  assert.match(report(p2, { postId: p2[0].id, replyId: '없는것', uid: 'a' }).error, /답글/);
});

test('운영자 — 상태 바꾸기·감추기·되살리기·지우기', () => {
  let posts = addPost([], post(), 'u1');
  const id = posts[0].id;
  posts = adminOp(posts, { op: 'status', postId: id, status: 'reviewing' }).value;
  assert.equal(posts[0].status, 'reviewing');
  assert.match(adminOp(posts, { op: 'status', postId: id, status: '없는상태' }).error, /없는 상태/);

  posts = report(report(report(posts, { postId: id, uid: 'a' }).value, { postId: id, uid: 'b' }).value, { postId: id, uid: 'c' }).value;
  assert.equal(posts[0].hidden, true);
  posts = adminOp(posts, { op: 'show', postId: id }).value;
  assert.equal(posts[0].hidden, false);
  assert.deepEqual(posts[0].reports, [], '되살리면 신고도 지움 — 다시 바로 감춰지지 않게');

  posts = adminOp(posts, { op: 'hide', postId: id }).value;
  assert.equal(posts[0].hidden, true);
  posts = adminOp(posts, { op: 'remove', postId: id }).value;
  assert.equal(posts.length, 0);
  assert.match(adminOp(posts, { op: 'remove', postId: id }).error, /찾지 못/);
  assert.match(adminOp([{ id: 'x' }], { op: '이상한것', postId: 'x' }).error, /op/);
});

test('내보내는 값 — uid·신고자는 나가지 않고, 내 글인지만 알려 줌', () => {
  let posts = addPost([], post({ name: '이웃A' }), 'uid-me');
  posts = report(posts, { postId: posts[0].id, uid: 'spy' }).value;
  posts = addReply(posts, posts[0].id, parseReply({ body: '저도요' }).value, 'uid-other').value;

  const pub = publicPost(posts[0], 'uid-me');
  assert.equal(pub.mine, true);
  assert.equal(pub.name, '이웃A');
  assert.equal(pub.replies[0].mine, false);
  const s = JSON.stringify(pub);
  assert.doesNotMatch(s, /uid-me|uid-other|spy/, '누가 썼는지·누가 신고했는지 나가지 않음');
  assert.equal(publicPost(posts[0], 'uid-other').mine, false);

  // 이름을 안 적으면 uid 앞 네 자로 만든 별명
  const anon = publicPost({ ...posts[0], name: '' }, null);
  assert.equal(anon.name, '이웃 uid-');
  assert.equal(displayName('', ''), '이웃 ****');

  // 감춰진 글은 내용을 비우되 자리는 남김
  const hid = publicPost({ ...posts[0], hidden: true }, null);
  assert.equal(hid.body, '');
  assert.equal(hid.title, posts[0].title, '제목은 남겨 「지워졌나」 싶지 않게');
  assert.equal(hid.hidden, true);
});

test('목록 — 분류·상태로 거르고 새 글부터, 쪽 나누기', () => {
  let posts = [];
  for (let i = 1; i <= 25; i++) {
    posts = addPost(posts, post({ title: `글 ${i}`, kind: i % 2 ? 'score' : 'bug' }, 10 + (i % 20)), `u${i}`);
  }
  const all = listPosts(posts);
  assert.equal(all.total, 25);
  assert.equal(all.rows.length, PAGE);
  assert.equal(all.pages, 2);
  assert.equal(listPosts(posts, { page: 2 }).rows.length, 5);
  assert.equal(listPosts(posts, { page: 99 }).rows.length, 0, '없는 쪽은 빈 목록');
  assert.equal(listPosts(posts, { page: 0 }).page, 1, '0쪽은 1쪽으로');

  const onlyScore = listPosts(posts, { kind: 'score' });
  assert.equal(onlyScore.total, 13);
  assert.ok(onlyScore.rows.every(r => r.kind === 'score'));
  assert.equal(listPosts(posts, { status: 'accepted' }).total, 0);
  assert.ok(all.rows[0].at >= all.rows[1].at, '새 글이 앞에');
  assert.equal(all.rows[0].replies, undefined, '목록에는 답글 본문을 싣지 않음');
  assert.equal(typeof all.rows[0].replyCount, 'number');
});

test('답글 수는 감춰진 것을 빼고 셈', () => {
  let posts = addPost([], post(), 'u1');
  const id = posts[0].id;
  posts = addReply(posts, id, parseReply({ body: '보이는 답글' }).value, 'a').value;
  posts = addReply(posts, id, parseReply({ body: '감춰질 답글' }).value, 'b').value;
  const rid = posts[0].replies[1].id;
  for (const who of ['x', 'y', 'z']) posts = report(posts, { postId: id, replyId: rid, uid: who }).value;
  assert.equal(publicPost(posts[0], null).replyCount, 1);
  assert.equal(listPosts(posts).rows[0].replyCount, 1);
});

test('한눈에 보기와 보관 상한', () => {
  let posts = addPost(addPost([], post(), 'u1'), post(), 'u2');
  posts = adminOp(posts, { op: 'status', postId: posts[0].id, status: 'accepted' }).value;
  const c = counts(posts);
  assert.equal(c.total, 2);
  assert.equal(c.accepted, 1);
  assert.equal(c.open, 1);
  assert.equal(c.declined, 0);
  assert.deepEqual(STATUSES.map(s => s.key), ['open', 'reviewing', 'accepted', 'declined', 'answered']);
  assert.equal(statusLabel('accepted'), '반영함');
  assert.equal(statusLabel('없는것'), '접수');

  // 너무 많이 쌓이면 오래된 것부터 버림
  let many = [];
  for (let i = 0; i < POST_MAX + 5; i++) many = addPost(many, post({ title: `글 ${i}` }), 'u');
  assert.equal(many.length, POST_MAX);
  assert.equal(many[0].title, `글 ${POST_MAX + 4}`, '가장 새 글이 남음');
  assert.deepEqual(TARGETS.map(t => t.key), ['kb', 'reco', 'port', 'trades', 'stock', 'none']);
});
