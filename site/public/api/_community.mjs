// 진가 커뮤니티 — 단지별 「이웃 평가」와 「임장 후기·체크리스트」의 순수 계산(네트워크·저장소 없음)
//
// 왜 필요한가 — 진가 점수는 데이터로 잡히는 것만 봅니다(역세권·학군·경사·상권·용적률·사용승인일).
// 주차 전쟁·층간소음·관리 상태·단지 분위기처럼 **살아 본 사람만 아는 것**은 데이터에 없어서,
// 점수 옆에 사람이 채우는 칸을 따로 둡니다. 둘을 섞어 한 점수로 만들지 않습니다 —
// 근거가 다른 값을 더하면 어느 쪽이 움직였는지 알 수 없게 되기 때문입니다.
import { createHash, randomUUID } from 'node:crypto';

/** 평가 항목 — 진가 점수가 못 보는 것만 골랐습니다 */
export const ASPECTS = [
  { key: 'parking', label: '주차', desc: '세대당 주차 공간과 밤 시간 주차 난이도' },
  { key: 'noise', label: '조용함', desc: '층간소음·도로소음·상가소음이 적은 정도' },
  { key: 'mgmt', label: '관리 상태', desc: '청소·보수·경비·조경 등 단지 관리 수준' },
  { key: 'mood', label: '분위기', desc: '이웃·커뮤니티 시설·아이 키우기 좋은 정도' },
  { key: 'shops', label: '주변 편의', desc: '장보기·병원·식당 등 생활 편의(상권의 실제 쓸모)' },
];
export const ASPECT_KEYS = ASPECTS.map(a => a.key);
export const MIN_SCORE = 1, MAX_SCORE = 5;
export const TEXT_MAX = 500;
export const NICK_MAX = 20;

/** 임장 체크리스트 — 임장 다녀온 사람이 채워 다음 사람에게 남기는 항목 */
export const CHECKLIST = [
  { key: 'water', label: '수압', hint: '욕실·주방 물이 시원하게 나오는지' },
  { key: 'leak', label: '누수·결로', hint: '천장·창틀·베란다 얼룩이나 곰팡이' },
  { key: 'light', label: '채광·향', hint: '낮에 볕이 드는 시간과 방향' },
  { key: 'noise', label: '소음', hint: '창을 열고 닫았을 때 도로·상가 소리' },
  { key: 'parking', label: '주차', hint: '방문 시간대에 빈자리가 있었는지' },
  { key: 'elev', label: '승강기·복도', hint: '대기 시간과 복도·계단 관리 상태' },
  { key: 'slope', label: '역까지 길', hint: '실제로 걸어 본 시간과 오르막 체감' },
  { key: 'shops', label: '주변 상가', hint: '문 연 가게와 비어 있는 가게' },
];
export const CHECK_KEYS = CHECKLIST.map(c => c.key);
/** 체크리스트 값 — 좋음/보통/나쁨/확인 못 함 */
export const CHECK_VALUES = ['good', 'fair', 'bad', 'na'];

const clean = (s, max) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, max);
const isInt = (v, lo, hi) => Number.isInteger(Number(v)) && Number(v) >= lo && Number(v) <= hi;
const round1 = v => Math.round(v * 10) / 10;

/** 이메일 → 사용자 id(원문을 저장하지 않으려고 해시). 같은 이메일이면 늘 같은 id */
export const memberId = (email, salt = '') =>
  createHash('sha256').update(String(email).trim().toLowerCase() + '|' + salt).digest('hex').slice(0, 24);

/** 보여 줄 이름 — 닉네임이 없으면 이메일 앞 두 글자 + 별표 */
export function displayName(nick, email) {
  const n = clean(nick, NICK_MAX);
  if (n) return n;
  const head = String(email || '').split('@')[0] || '이웃';
  return head.slice(0, 2) + '*'.repeat(Math.max(1, Math.min(3, head.length - 2)));
}

/**
 * 평가 한 건 다듬기 — 화면에서 온 값을 그대로 믿지 않고 여기서 거릅니다.
 * → { ok, value } | { ok:false, error }
 */
export function parseRating(input = {}, { now = () => new Date() } = {}) {
  const complexId = Number(input.complexId);
  if (!Number.isInteger(complexId) || complexId <= 0) return { ok: false, error: '단지를 고르지 않았습니다' };
  const scores = {};
  for (const k of ASPECT_KEYS) {
    const v = input.scores ? input.scores[k] : undefined;
    if (v == null || v === '') continue;                     // 모르는 항목은 비워 둘 수 있음
    if (!isInt(v, MIN_SCORE, MAX_SCORE)) return { ok: false, error: `${k} 점수는 ${MIN_SCORE}~${MAX_SCORE} 사이여야 합니다` };
    scores[k] = Number(v);
  }
  if (!Object.keys(scores).length) return { ok: false, error: '항목을 하나 이상 매겨 주세요' };
  const text = clean(input.text, TEXT_MAX);
  const lived = input.lived === true || input.lived === 'true';
  return {
    ok: true,
    value: { complexId, scores, text, lived, at: now().toISOString(), hidden: false, reports: 0 },
  };
}

/** 임장 후기 다듬기 */
export function parseVisit(input = {}, { now = () => new Date() } = {}) {
  const complexId = Number(input.complexId);
  if (!Number.isInteger(complexId) || complexId <= 0) return { ok: false, error: '단지를 고르지 않았습니다' };
  const checks = {};
  for (const k of CHECK_KEYS) {
    const v = input.checks ? input.checks[k] : undefined;
    if (v == null || v === '' || v === 'na') continue;
    if (!CHECK_VALUES.includes(v)) return { ok: false, error: `${k} 값이 올바르지 않습니다` };
    checks[k] = v;
  }
  const text = clean(input.text, TEXT_MAX);
  if (!Object.keys(checks).length && !text) return { ok: false, error: '체크리스트나 후기 중 하나는 채워 주세요' };
  const visitedAt = /^\d{4}-\d{2}-\d{2}$/.test(String(input.visitedAt || '')) ? input.visitedAt : null;
  return { ok: true, value: { complexId, checks, text, visitedAt, at: now().toISOString(), hidden: false, reports: 0 } };
}

/**
 * 평가 모음 → 집계
 * 숨김 처리된 글은 빼고, 항목마다 매긴 사람 수를 따로 셉니다(비워 둘 수 있으므로).
 */
export function aggregate(rows = []) {
  const live = rows.filter(r => r && !r.hidden);
  const by = {};
  for (const k of ASPECT_KEYS) {
    const vals = live.map(r => r.scores && r.scores[k]).filter(v => isInt(v, MIN_SCORE, MAX_SCORE)).map(Number);
    if (vals.length) by[k] = { avg: round1(vals.reduce((a, b) => a + b, 0) / vals.length), n: vals.length };
  }
  const each = Object.values(by);
  const overall = each.length
    ? round1(each.reduce((a, x) => a + x.avg * x.n, 0) / each.reduce((a, x) => a + x.n, 0))
    : null;
  return {
    overall, n: live.length,
    lived: live.filter(r => r.lived).length,
    by,
    updatedAt: live.length ? live.map(r => r.at).sort().pop() : null,
  };
}

/** 체크리스트 모음 → 항목별 좋음/보통/나쁨 수 */
export function aggregateChecks(rows = []) {
  const live = rows.filter(r => r && !r.hidden);
  const by = {};
  for (const k of CHECK_KEYS) {
    const vals = live.map(r => r.checks && r.checks[k]).filter(v => v && v !== 'na');
    if (!vals.length) continue;
    const c = { good: 0, fair: 0, bad: 0 };
    vals.forEach(v => { if (c[v] != null) c[v]++; });
    by[k] = { ...c, n: vals.length };
  }
  return { n: live.length, by, updatedAt: live.length ? live.map(r => r.at).sort().pop() : null };
}

/** 카드 한 줄 — '이웃 평가 4.1(23명) · 주차 3.2 · 조용함 4.4' */
export function ratingText(agg) {
  if (!agg || !agg.n || agg.overall == null) return '';
  const pick = ASPECTS
    .map(a => (agg.by[a.key] ? `${a.label} ${agg.by[a.key].avg.toFixed(1)}` : null))
    .filter(Boolean).slice(0, 3).join(' · ');
  return `이웃 평가 ${agg.overall.toFixed(1)}(${agg.n.toLocaleString('ko-KR')}명)${pick ? ' · ' + pick : ''}`;
}

/** 같은 사람이 같은 단지에 또 쓰면 덮어씁니다(여론 조작 방지) */
export function upsert(rows, row, uid) {
  const out = (rows || []).filter(r => !(r.uid === uid && r.complexId === row.complexId));
  out.push({ ...row, uid, id: row.id || randomUUID().slice(0, 8) });
  return out;
}

export const REPORT_HIDE = 3;          // 신고가 이만큼 쌓이면 자동으로 감춤(관리자가 되살릴 수 있음)
/** 신고 반영 — 같은 사람이 여러 번 신고해도 한 번만 셉니다 */
export function applyReport(rows, id, uid) {
  let found = false;
  const out = (rows || []).map(r => {
    if (r.id !== id) return r;
    found = true;
    const by = new Set(r.reportedBy || []);
    by.add(uid);
    const reports = by.size;
    return { ...r, reportedBy: [...by], reports, hidden: r.hidden || reports >= REPORT_HIDE };
  });
  return { ok: found, rows: out };
}

/** 화면에 내보낼 형태 — 이메일·신고자 같은 것은 빼고 */
export const publicRow = r => ({
  id: r.id, name: r.name || '이웃', at: r.at, text: r.text || '',
  scores: r.scores || undefined, checks: r.checks || undefined,
  lived: r.lived || undefined, visitedAt: r.visitedAt || undefined,
  reports: r.reports || 0,
});

// ── 한눈에 보기 ───────────────────────────────────────────────
// 「고덕그라시움 진가 커뮤니티(22명) : 4.1/5 · 좋음 관리 4.6 · 아쉬움 주차 2.8」 꼴로 줄이는 부분입니다.
// 다른 사이트(네이버·호갱노노 등)의 글을 가져다 싣지는 않습니다 — 그쪽 robots.txt 가 크롤링을 금지하고
// 리뷰 하나하나가 남의 저작물이라, 요약해서 올리는 것도 안전하지 않습니다. 대신 바로가기 링크만 붙입니다.
export const GOOD_AT = 4.0;        // 이보다 높으면 「좋음」
export const WEAK_AT = 2.8;        // 이보다 낮으면 「아쉬움」
const QUOTE_MAX = 60;

/**
 * 집계 + 글 → 요약
 * → { n, avg, goods:[{label,avg}], weaks:[…], quotes:[…], text }
 */
export function digest(agg, rows = [], { source = '진가 커뮤니티' } = {}) {
  const n = (agg && agg.n) || 0;
  if (!n || agg.overall == null) return { source, n: 0, avg: null, goods: [], weaks: [], quotes: [], text: '' };
  const items = ASPECTS
    .filter(a => agg.by[a.key])
    .map(a => ({ key: a.key, label: a.label, avg: agg.by[a.key].avg, n: agg.by[a.key].n }));
  const goods = items.filter(x => x.avg >= GOOD_AT).sort((a, b) => b.avg - a.avg).slice(0, 2);
  const weaks = items.filter(x => x.avg <= WEAK_AT).sort((a, b) => a.avg - b.avg).slice(0, 2);
  const quotes = (rows || [])
    .filter(r => r && !r.hidden && r.text)
    .slice(-2).reverse()
    .map(r => (r.text.length > QUOTE_MAX ? r.text.slice(0, QUOTE_MAX) + '…' : r.text));

  const part = (label, list) => (list.length ? `${label} ${list.map(x => `${x.label} ${x.avg.toFixed(1)}`).join('·')}` : '');
  const body = [part('좋음', goods), part('아쉬움', weaks)].filter(Boolean).join(' / ');
  const quote = quotes.length ? ` · “${quotes[0]}”` : '';
  return {
    source, n, avg: agg.overall, goods, weaks, quotes,
    text: `${source}(${n.toLocaleString('ko-KR')}명) : ${agg.overall.toFixed(1)}/5${body ? ' · ' + body : ''}${quote}`,
  };
}

/**
 * 다른 곳에서 보기 — **링크만** 겁니다(내용을 옮겨 싣지 않습니다).
 * 네이버 부동산은 좌표로, 나머지는 단지명 검색으로 엽니다.
 */
export function outsideLinks({ name, gu = '', dong = '', lat = null, lng = null } = {}) {
  const q = encodeURIComponent([gu, dong, name].filter(Boolean).join(' '));
  const out = [];
  // null·빈 문자열은 Number() 가 0 으로 바꿔 버려 바다 한가운데(0,0)로 링크가 생깁니다 → 값이 있는지부터 확인
  const num = v => (v === null || v === undefined || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
  const la = num(lat), ln = num(lng);
  if (la !== null && ln !== null) {
    out.push({ site: '네이버 부동산', url: `https://new.land.naver.com/complexes?ms=${la},${ln},17`, note: '단지 정보·매물' });
  }
  out.push({ site: '카카오맵', url: `https://map.kakao.com/?q=${q}`, note: '주변·길찾기' });
  out.push({ site: '네이버 검색', url: `https://search.naver.com/search.naver?query=${encodeURIComponent(name + ' 실거주 후기')}`, note: '블로그·카페 후기' });
  out.push({ site: '호갱노노', url: 'https://hogangnono.com/', note: '단지명으로 검색' });
  return out;
}
