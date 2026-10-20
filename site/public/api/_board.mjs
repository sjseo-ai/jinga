// 진가 의견·문의 게시판 — 점수 산식을 열어 둔 것과 짝이 되는 자리입니다.
//
// 왜 공개 게시판인가 — 1:1 문의로 받으면 같은 지적이 되풀이되고, 무엇보다 **남이 뭘 지적했는지 볼 수 없습니다.**
// 산식을 열어 둔 이유가 「보고 따지게 하는 것」이므로, 지적과 그 답도 같이 보이는 편이 맞습니다.
//
// 저장 — 글 하나에 답글이 딸린 형태로 파일 하나(board/posts.json)에 모읍니다.
//   글이 많아지면 쪼개야 하지만, 지금 규모에서는 한 파일이 읽고 쓰기 쉽고 실수가 적습니다.
// 신원 — 커뮤니티와 같은 방식(메일 확인). 저장할 때 메일 원문은 두지 않고 해시(uid)만 남깁니다.
import { randomUUID } from 'node:crypto';

/** 무엇에 대한 이야기인지 — 화면의 고르는 칸과 같은 순서 */
export const KINDS = [
  { key: 'score', label: '점수 산식', hint: '배점·가중치·계산이 이상하다' },
  { key: 'data', label: '데이터', hint: '시세·단지 정보가 실제와 다르다' },
  { key: 'bug', label: '오류', hint: '화면이 깨지거나 동작하지 않는다' },
  { key: 'idea', label: '제안', hint: '이런 기능이 있으면 좋겠다' },
  { key: 'etc', label: '기타', hint: '' },
];

/** 어느 산식인지 — 「점수 산식」을 골랐을 때만 씁니다. 파일을 바로 짚어 줍니다. */
export const TARGETS = [
  { key: 'kb', label: '단지 검색 점수', file: 'jinga-kb.mjs' },
  { key: 'reco', label: '매물 추천 점수', file: 'jinga-reco.mjs' },
  { key: 'port', label: '포트폴리오 기대수익률', file: 'jinga-port.mjs' },
  { key: 'trades', label: '매매 기록·기간 수익률', file: 'jinga-trades.mjs' },
  { key: 'stock', label: '주식 진가 점수·적정가', file: '' },
  { key: 'none', label: '해당 없음', file: '' },
];

/** 운영자가 정하는 처리 상태 — 답을 주고 끝내는 흐름이 보이게 */
export const STATUSES = [
  { key: 'open', label: '접수', tone: 'wait' },
  { key: 'reviewing', label: '검토 중', tone: 'wait' },
  { key: 'accepted', label: '반영함', tone: 'ok' },
  { key: 'declined', label: '반영 안 함', tone: 'def' },
  { key: 'answered', label: '답변 완료', tone: 'ok' },
];

export const TITLE_MAX = 60;
export const BODY_MAX = 2000;
export const REPLY_MAX = 1000;
export const NAME_MAX = 20;
export const POST_MAX = 500;          // 보관하는 글 수 상한(넘으면 오래된 것부터 지움)
export const REPLY_HIDE = 3;          // 신고가 이만큼 쌓이면 자동으로 감춤
export const PAGE = 20;

const clean = (s, max) => String(s == null ? '' : s).replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim().slice(0, max);
const oneLine = (s, max) => clean(s, max).replace(/\s+/g, ' ');
const keyOf = (list, v, fallback) => (list.some(x => x.key === v) ? v : fallback);
export const kindLabel = k => (KINDS.find(x => x.key === k) || {}).label || '기타';
export const statusLabel = s => (STATUSES.find(x => x.key === s) || STATUSES[0]).label;
export const targetOf = t => TARGETS.find(x => x.key === t) || null;

/**
 * 글 한 건 다듬기 — 화면에서 온 값을 그대로 믿지 않습니다.
 * → { ok, value } | { ok:false, error }
 */
export function parsePost(input = {}, now = () => Date.now()) {
  const title = oneLine(input.title, TITLE_MAX);
  if (title.length < 2) return { ok: false, error: '제목을 2자 이상 적어 주세요' };
  const body = clean(input.body, BODY_MAX);
  if (body.length < 5) return { ok: false, error: '내용을 5자 이상 적어 주세요' };
  const kind = keyOf(KINDS, input.kind, 'etc');
  const target = kind === 'score' ? keyOf(TARGETS, input.target, 'none') : 'none';
  return {
    ok: true,
    value: {
      id: randomUUID().replace(/-/g, '').slice(0, 12),
      kind, target, title, body,
      name: oneLine(input.name, NAME_MAX) || '',
      status: 'open', replies: [], reports: [], hidden: false,
      at: new Date(now()).toISOString(), editedAt: null,
    },
  };
}

/** 답글 한 건 다듬기 — 운영자 답글은 admin: true 로 표시해 화면에서 구분합니다 */
export function parseReply(input = {}, { admin = false, now = () => Date.now() } = {}) {
  const body = clean(input.body, REPLY_MAX);
  if (body.length < 2) return { ok: false, error: '답글을 2자 이상 적어 주세요' };
  return {
    ok: true,
    value: {
      id: randomUUID().replace(/-/g, '').slice(0, 10),
      body, admin: !!admin,
      name: admin ? '운영자' : oneLine(input.name, NAME_MAX) || '',
      reports: [], hidden: false,
      at: new Date(now()).toISOString(),
    },
  };
}

/** 글 넣기 — 새 글이 앞에 오고, 너무 많이 쌓이면 오래된 것부터 버립니다 */
export function addPost(posts, post, uid) {
  const out = [{ ...post, uid }, ...(posts || [])];
  return out.slice(0, POST_MAX);
}

export function addReply(posts, postId, reply, uid) {
  const list = posts || [];
  const i = list.findIndex(p => p.id === postId);
  if (i < 0) return { ok: false, error: '글을 찾지 못했습니다' };
  if (list[i].hidden) return { ok: false, error: '감춰진 글에는 답글을 달 수 없습니다' };
  const post = { ...list[i], replies: [...(list[i].replies || []), { ...reply, uid }] };
  // 운영자가 답하면 「접수」에 머물지 않게 — 이미 손댄 상태(반영/보류)면 그대로 둡니다
  if (reply.admin && (post.status === 'open' || post.status === 'reviewing')) post.status = 'answered';
  const next = [...list];
  next[i] = post;
  return { ok: true, value: next };
}

/** 같은 사람이 여러 번 신고해도 한 번만 셉니다 */
export function report(posts, { postId, replyId = null, uid }) {
  const list = posts || [];
  const i = list.findIndex(p => p.id === postId);
  if (i < 0) return { ok: false, error: '글을 찾지 못했습니다' };
  const mark = row => {
    const reports = [...new Set([...(row.reports || []), uid])];
    return { ...row, reports, hidden: row.hidden || reports.length >= REPLY_HIDE };
  };
  const next = [...list];
  if (!replyId) {
    next[i] = mark(next[i]);
  } else {
    const rs = next[i].replies || [];
    const j = rs.findIndex(r => r.id === replyId);
    if (j < 0) return { ok: false, error: '답글을 찾지 못했습니다' };
    const rr = [...rs];
    rr[j] = mark(rr[j]);
    next[i] = { ...next[i], replies: rr };
  }
  return { ok: true, value: next };
}

/** 운영자 — 상태 바꾸기 · 감추기/되살리기 · 지우기 */
export function adminOp(posts, { op, postId, status }) {
  const list = posts || [];
  const i = list.findIndex(p => p.id === postId);
  if (i < 0) return { ok: false, error: '글을 찾지 못했습니다' };
  const next = [...list];
  if (op === 'status') {
    if (!STATUSES.some(s => s.key === status)) return { ok: false, error: '없는 상태입니다' };
    next[i] = { ...next[i], status };
  } else if (op === 'hide') {
    next[i] = { ...next[i], hidden: true };
  } else if (op === 'show') {
    next[i] = { ...next[i], hidden: false, reports: [] };
  } else if (op === 'remove') {
    next.splice(i, 1);
  } else {
    return { ok: false, error: 'op 가 필요합니다' };
  }
  return { ok: true, value: next };
}

/** 글쓴이가 누구인지 드러내지 않고 보여 줄 이름 */
export const displayName = (name, uid) => name || `이웃 ${String(uid || '').slice(0, 4) || '****'}`;

/** 화면으로 내보낼 글 — uid·신고자 목록처럼 남에게 보일 필요가 없는 것은 뺍니다 */
export const publicPost = (p, me = null, { withReplies = true } = {}) => ({
  id: p.id, kind: p.kind, target: p.target, title: p.title,
  body: p.hidden ? '' : p.body,
  name: displayName(p.name, p.uid),
  status: p.status, at: p.at, hidden: !!p.hidden,
  mine: !!me && p.uid === me,
  replyCount: (p.replies || []).filter(r => !r.hidden).length,
  ...(withReplies ? {
    replies: (p.replies || []).map(r => ({
      id: r.id, body: r.hidden ? '' : r.body, admin: !!r.admin,
      name: r.admin ? '운영자' : displayName(r.name, r.uid),
      at: r.at, hidden: !!r.hidden, mine: !!me && r.uid === me,
    })),
  } : {}),
});

/**
 * 목록 — 분류·상태로 거르고 새 글부터. 감춰진 글은 제목만 남기고 자리는 지킵니다
 * (통째로 없애면 「지웠나?」 싶으므로).
 */
export function listPosts(posts, { kind = '', status = '', page = 1, me = null } = {}) {
  const all = (posts || [])
    .filter(p => (!kind || p.kind === kind) && (!status || p.status === status))
    .sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const from = Math.max(0, (Math.max(1, Number(page) || 1) - 1) * PAGE);
  return {
    total: all.length,
    page: Math.max(1, Number(page) || 1),
    pages: Math.max(1, Math.ceil(all.length / PAGE)),
    rows: all.slice(from, from + PAGE).map(p => publicPost(p, me, { withReplies: false })),
  };
}

/** 한눈에 — 「접수 3 · 검토 중 1 · 반영함 5」 */
export function counts(posts) {
  const out = { total: (posts || []).length };
  for (const s of STATUSES) out[s.key] = (posts || []).filter(p => p.status === s.key).length;
  return out;
}
