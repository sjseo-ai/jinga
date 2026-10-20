// 단지 사진·현장 정보 — 「몇 베이인지, 지하주차장에서 엘리베이터로 바로 가는지」처럼
// **가 봐야 아는 것**을 모으는 자리입니다.
//
// 왜 직접 모으나 — 이 값들은 어디에서도 받아올 수 없습니다(2026-10-11 확인).
//   · KB 단지 요약에 이미지 필드가 있지만 주소를 맞춰도 404 이고, 된다 해도 **KB·네이버 사진은 저작물**이라
//     끌어다 쓰면 복제·전송이 됩니다(robots.txt 도 막아 둠). 평면도도 분양사·중개사의 저작물입니다.
//   · 「몇 베이」는 평면도를 사람이 보고 세는 값이라 어떤 공개 데이터에도 필드가 없습니다.
//   · 「지하주차장 ↔ 엘리베이터 직결」도 마찬가지입니다. 공동주택 공공데이터에 주차대수·승강기 대수는 있어도
//     **연결 여부**는 없습니다.
//
// 그래서 **본인이 직접 찍은 사진과, 가 보고 아는 사실**만 받습니다.
//   · 평면도·분양 홍보물·남의 사진을 올리는 것은 금지합니다(저작권).
//   · 한 사람 말을 사실처럼 보이지 않게, 여러 답을 모아 「3베이 (7명 중 6명)」처럼 보여 줍니다.
//   · 사진은 화면에서 미리 줄이고 다시 저장해 올립니다 — 그 과정에서 **찍은 위치(EXIF)가 사라집니다.**
import { randomUUID } from 'node:crypto';

export const PHOTO_MAX_BYTES = 600 * 1024;   // 화면에서 1280px·JPEG 로 줄여 올립니다
export const PHOTOS_PER_COMPLEX = 40;
export const CAPTION_MAX = 60;
export const HIDE_REPORTS = 3;
export const MIME = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/** 무엇을 찍은 사진인지 — **평면도는 없습니다**(남의 저작물이라 받지 않습니다) */
export const PHOTO_KINDS = [
  { key: 'view', label: '단지 전경' },
  { key: 'entrance', label: '출입구·로비' },
  { key: 'parking', label: '지하주차장' },
  { key: 'lift', label: '엘리베이터·연결통로' },
  { key: 'corridor', label: '복도·계단' },
  { key: 'yard', label: '조경·놀이터' },
  { key: 'around', label: '주변(상가·역·학교)' },
  { key: 'etc', label: '기타' },
];

/**
 * 가 봐야 아는 것들 — 고르기만 하면 되게 보기를 둡니다.
 * 「모름」을 반드시 두어, 모르는 것을 찍지 않게 합니다.
 */
export const FACTS = [
  {
    key: 'bay', label: '베이 구조', hint: '거실과 방이 앞쪽(남향)에 몇 칸 늘어서 있는지',
    options: [
      { v: '2bay', label: '2베이' }, { v: '3bay', label: '3베이' },
      { v: '4bay', label: '4베이 이상' }, { v: 'mixed', label: '주택형마다 다름' },
    ],
  },
  {
    key: 'parkLift', label: '지하주차장 ↔ 엘리베이터', hint: '주차하고 계단 없이 집까지 올라갈 수 있는지',
    options: [
      { v: 'direct', label: '모든 동 바로 연결' }, { v: 'partial', label: '일부 동만 연결' },
      { v: 'none', label: '연결 안 됨(지상으로 나가야 함)' }, { v: 'noUnderground', label: '지하주차장 없음' },
    ],
  },
  {
    key: 'parkEase', label: '주차 여유', hint: '저녁에 자리를 찾기 쉬운지',
    options: [
      { v: 'easy', label: '넉넉함' }, { v: 'ok', label: '보통' },
      { v: 'hard', label: '저녁엔 어려움' }, { v: 'veryHard', label: '이중주차 일상' },
    ],
  },
];

export const RULES = [
  '**직접 찍은 사진만 올려 주세요.** 평면도·분양 홍보물·다른 사이트 사진은 그 사람의 저작물이라 올릴 수 없습니다.',
  '사람 얼굴, 차량 번호판, 집 안이 나오지 않게 찍어 주세요.',
  '가 보지 않고 짐작으로 고르지 마세요 — 모르면 그냥 비워 두면 됩니다.',
  '사진은 올리기 전에 자동으로 줄여 저장하며, 그때 **찍은 위치 정보가 지워집니다.**',
  '광고·허위 사진은 신고 세 번이면 자동으로 감춰집니다.',
];

const clean = (s, max) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, max);
const factDef = key => FACTS.find(f => f.key === key) || null;

/** 고른 답 한 묶음 다듬기 — 모르는 항목은 아예 빼서 「모름」이 답으로 쌓이지 않게 합니다 */
export function parseFacts(input = {}) {
  const complexId = Number(input.complexId);
  if (!Number.isInteger(complexId) || complexId <= 0) return { ok: false, error: '단지를 고르지 않았습니다' };
  const picked = {};
  for (const f of FACTS) {
    const v = input[f.key];
    if (v && f.options.some(o => o.v === v)) picked[f.key] = v;
  }
  if (!Object.keys(picked).length) return { ok: false, error: '아는 항목을 하나 이상 골라 주세요' };
  return { ok: true, value: { complexId, ...picked } };
}

/** 같은 사람은 한 번만 — 다시 올리면 예전 답을 덮습니다 */
export function upsertFacts(rows, value, uid, now = () => Date.now()) {
  const row = { ...value, uid, at: new Date(now()).toISOString() };
  const out = (rows || []).filter(r => r.uid !== uid);
  out.push(row);
  return out;
}

/**
 * 모인 답 → 항목마다 「가장 많이 고른 답과 그 수」.
 * 한 사람 답을 사실처럼 보이지 않게 **몇 명 중 몇 명인지**를 함께 돌려줍니다.
 */
export function aggregateFacts(rows = []) {
  const out = {};
  for (const f of FACTS) {
    const votes = (rows || []).map(r => r[f.key]).filter(v => f.options.some(o => o.v === v));
    if (!votes.length) { out[f.key] = null; continue; }
    const by = new Map();
    for (const v of votes) by.set(v, (by.get(v) || 0) + 1);
    const ranked = [...by.entries()].sort((a, b) => b[1] - a[1]);
    const [top, n] = ranked[0];
    out[f.key] = {
      value: top,
      label: (f.options.find(o => o.v === top) || {}).label || top,
      n, total: votes.length,
      agreed: n === votes.length,                       // 답이 갈리면 화면에서 알려 줍니다
      others: ranked.slice(1).map(([v, c]) => ({ value: v, label: (f.options.find(o => o.v === v) || {}).label || v, n: c })),
    };
  }
  return out;
}

/** 「3베이(7명 중 6명) · 지하주차장 모든 동 바로 연결(4명)」 — 카드에 붙일 한 줄 */
export function factsDigest(agg) {
  const parts = [];
  for (const f of FACTS) {
    const a = agg && agg[f.key];
    if (!a) continue;
    parts.push(a.agreed ? `${a.label}(${a.n}명)` : `${a.label}(${a.total}명 중 ${a.n}명)`);
  }
  return parts.join(' · ');
}

/** 사진 한 장의 딸림 정보 — 사진 자체는 따로 저장하고 여기에는 설명만 둡니다 */
export function parsePhoto(input = {}, now = () => Date.now()) {
  const complexId = Number(input.complexId);
  if (!Number.isInteger(complexId) || complexId <= 0) return { ok: false, error: '단지를 고르지 않았습니다' };
  const kind = PHOTO_KINDS.some(k => k.key === input.kind) ? input.kind : 'etc';
  const type = String(input.type || '').toLowerCase();
  if (!MIME[type]) return { ok: false, error: 'JPG·PNG·WEBP 사진만 올릴 수 있습니다' };
  const bytes = Number(input.bytes);
  if (!(bytes > 0)) return { ok: false, error: '사진을 고르지 않았습니다' };
  if (bytes > PHOTO_MAX_BYTES) return { ok: false, error: `사진이 너무 큽니다(${Math.round(bytes / 1024)}KB) — 화면에서 줄여 올려 주세요` };
  if (input.own !== true) return { ok: false, error: '직접 찍은 사진이라고 확인해 주세요' };
  const id = randomUUID().replace(/-/g, '').slice(0, 14);
  return {
    ok: true,
    value: {
      id, complexId, kind, ext: MIME[type], type, bytes,
      caption: clean(input.caption, CAPTION_MAX),
      at: new Date(now()).toISOString(), hidden: false, reports: [],
    },
  };
}

export const photoPath = (complexId, id, ext) => `album/${complexId}/${id}.${ext}`;

/** 새 사진이 앞에, 단지마다 상한까지 */
export const addPhoto = (rows, row, uid) => [{ ...row, uid }, ...(rows || [])].slice(0, PHOTOS_PER_COMPLEX);

/** 같은 사람이 여러 번 신고해도 한 번만 */
export function reportPhoto(rows, id, uid) {
  const list = rows || [];
  const i = list.findIndex(r => r.id === id);
  if (i < 0) return { ok: false, error: '사진을 찾지 못했습니다' };
  const reports = [...new Set([...(list[i].reports || []), uid])];
  const next = [...list];
  next[i] = { ...next[i], reports, hidden: next[i].hidden || reports.length >= HIDE_REPORTS };
  return { ok: true, value: next };
}

/** 화면으로 — 올린 사람·신고자는 내보내지 않습니다 */
export const publicPhoto = (r, me = null) => ({
  id: r.id, kind: r.kind,
  kindLabel: (PHOTO_KINDS.find(k => k.key === r.kind) || {}).label || '기타',
  caption: r.caption || '', at: r.at, bytes: r.bytes,
  mine: !!me && r.uid === me,
});

export const livePhotos = (rows = []) => (rows || []).filter(r => !r.hidden);
