// 커뮤니티 모아 보기 — 「커뮤니티」 탭에서 단지별로 나눠 보고, 한 칸에서 찾고, 분류로 거르는 부분입니다.
//
// 왜 색인이 필요한가 — 평가·후기는 단지마다 파일이 따로 있습니다(community/ratings/<단지>.json).
// 그래서 「글이 있는 단지가 어디어디인가」를 알려면 파일을 전부 열어 봐야 합니다.
// 글이 올라올 때마다 단지 한 줄 요약을 community/index.json 에 고쳐 적어 두고, 탭은 이 파일 하나만 읽습니다.
//
// 단지 이름 — 평가 글에는 단지 번호만 있고 이름이 없습니다. 글을 쓸 때 화면이 이름·지역을 같이 보내
// 색인에 적어 둡니다. 예전 글처럼 이름이 비어 있으면 화면이 KB 단지 목록에서 번호로 찾아 채웁니다.
import { aggregate, aggregateChecks } from './_community.mjs';
import { outsideDigest } from './_outside.mjs';

export const INDEX_PATH = 'community/index.json';
export const HUB_KINDS = [
  { key: '', label: '전체' },
  { key: 'rating', label: '이웃 평가' },
  { key: 'visit', label: '임장 후기' },
  { key: 'outside', label: '다른 곳 이야기' },
  { key: 'companion', label: '임장 동행' },
];
export const HUB_SORTS = [
  { key: 'recent', label: '최근 글 순' },
  { key: 'many', label: '글 많은 순' },
  { key: 'score', label: '평점 높은 순' },
];
export const HUB_PAGE = 24;
const SNIPPET = 80;

const clean = (s, max) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, max);
const round1 = v => (v == null ? null : Math.round(v * 10) / 10);

// 평점 순위용 점수 — 평가가 적을수록 평균을 PRIOR 쪽으로 당깁니다(베이즈 평균).
// PRIOR_N 명이 PRIOR 점을 줬다고 치고 섞는 셈이라, 평가가 몇 건 안 되는 단지가 우연히 맨 위에 서지 않습니다.
// 화면에 보이는 평균은 그대로 두고 **줄 세우는 데만** 씁니다.
export const PRIOR = 3.5;
export const PRIOR_N = 3;
export const rankScore = e => (e.avg == null ? -1 : (e.avg * e.ratings + PRIOR * PRIOR_N) / (e.ratings + PRIOR_N));

/** 화면이 보낸 단지 이름·지역을 다듬습니다 — 믿지 않고 길이만 자르고 공백 정리 */
export function cleanMeta(meta = {}) {
  return { name: clean(meta.name, 40), gu: clean(meta.gu, 12), dong: clean(meta.dong, 12) };
}

/** 가장 최근의 보이는 글 한 줄(목록 카드에 붙일 것) */
function latest(rows, kind) {
  const live = (rows || []).filter(r => !r.hidden && r.text);
  if (!live.length) return null;
  const r = live.reduce((a, b) => (String(b.at) > String(a.at) ? b : a));
  return { kind, text: clean(r.text, SNIPPET), at: r.at };
}

/**
 * 단지 한 곳의 요약 — 평가·후기 파일 두 개를 받아 한 줄로 줄입니다.
 * prev 는 예전 색인 줄(이름을 이번에 못 받았을 때 그대로 두려고).
 */
export function hubEntry(id, { ratings = [], visits = [], outside = [], meta = {}, prev = null } = {}) {
  const a = aggregate(ratings || []);
  const c = aggregateChecks(visits || []);
  const o = outsideDigest(outside || []);
  const m = cleanMeta(meta);
  // 다른 곳 이야기는 요약이 곧 본문이라 text 자리에 summary 를 넣어 같은 모양으로 맞춥니다
  const lastO = latest((outside || []).map(r => ({ ...r, text: r.summary })), 'outside');
  const last = [latest(ratings, 'rating'), latest(visits, 'visit'), lastO]
    .filter(Boolean).sort((x, y) => String(y.at).localeCompare(String(x.at)))[0] || null;
  return {
    id: Number(id),
    name: m.name || (prev && prev.name) || '',
    gu: m.gu || (prev && prev.gu) || '',
    dong: m.dong || (prev && prev.dong) || '',
    ratings: a.n || 0,
    avg: a.n ? round1(a.overall) : null,
    lived: a.lived || 0,
    visits: c.n || 0,
    outside: o.n || 0,
    outsideBy: o.by || [],
    lastAt: last ? last.at : (prev && prev.lastAt) || null,
    last,
  };
}

/** 색인에 한 줄 고쳐 넣기 — 글이 모두 없어졌으면(전부 감춤) 줄을 뺍니다 */
export function putEntry(index, entry) {
  const out = { ...(index || {}) };
  if (!entry.ratings && !entry.visits && !entry.outside) delete out[entry.id];
  else out[entry.id] = entry;
  return out;
}

/** 동행 요청 목록 → 단지별 「열린 요청 수」 */
export function requestCounts(requests = []) {
  const by = {};
  for (const r of requests || []) {
    if (!r || !r.complexId || r.status === 'closed') continue;
    const id = Number(r.complexId);
    by[id] = by[id] || { open: 0, name: r.complexName || '', gu: r.region || '' };
    if (r.status === 'open') by[id].open++;
  }
  return by;
}

/**
 * 탭 목록 — 색인과 동행 요청을 합쳐 단지별로 보여 줍니다.
 *   q      — 한 칸 검색: 단지 이름·지역·동·최근 글 내용에서 찾음(띄어쓰기 무시)
 *   kind   — '' | rating | visit | companion (그 종류의 글이 있는 단지만)
 *   region — 구·시 이름(비우면 전체)
 *   sort   — recent | many | score
 */
export function searchHub(index = {}, requests = [], { q = '', kind = '', region = '', sort = 'recent', page = 1 } = {}) {
  const reqBy = requestCounts(requests);
  const ids = new Set([...Object.keys(index || {}), ...Object.keys(reqBy)].map(Number));
  let rows = [...ids].map(id => {
    const e = (index || {})[id] || { id, name: '', gu: '', dong: '', ratings: 0, avg: null, lived: 0, visits: 0, outside: 0, lastAt: null, last: null };
    const rq = reqBy[id];
    return {
      ...e,
      name: e.name || (rq && rq.name) || '',
      gu: e.gu || (rq && rq.gu) || '',
      requests: rq ? rq.open : 0,
    };
  });

  const norm = s => String(s || '').replace(/\s+/g, '').toLowerCase();
  const nq = norm(q);
  if (nq) {
    rows = rows.filter(r => [r.name, r.gu, r.dong, r.last && r.last.text].some(v => norm(v).includes(nq)));
  }
  if (kind === 'rating') rows = rows.filter(r => r.ratings > 0);
  else if (kind === 'visit') rows = rows.filter(r => r.visits > 0);
  else if (kind === 'outside') rows = rows.filter(r => (r.outside || 0) > 0);
  else if (kind === 'companion') rows = rows.filter(r => r.requests > 0);
  if (region) rows = rows.filter(r => r.gu === region);

  const total = r => r.ratings + r.visits + (r.outside || 0) + r.requests;
  const cmp = {
    recent: (a, b) => String(b.lastAt || '').localeCompare(String(a.lastAt || '')) || total(b) - total(a),
    many: (a, b) => total(b) - total(a) || String(b.lastAt || '').localeCompare(String(a.lastAt || '')),
    // 평점 순 — 평가가 없는 단지는 뒤로, 그리고 **평가 수가 적으면 평균을 중간값 쪽으로 당겨** 견줍니다.
    // 그냥 평균으로 줄 세우면 한 사람이 5점을 준 단지가 스물두 명이 4.1점을 준 단지보다 위에 섭니다.
    score: (a, b) => (a.avg == null) - (b.avg == null) || rankScore(b) - rankScore(a) || b.ratings - a.ratings,
  }[sort] || null;
  rows.sort(cmp || ((a, b) => String(b.lastAt || '').localeCompare(String(a.lastAt || ''))));

  // 지역 칸에 보여 줄 목록 — 거르기 전 전체에서(골라도 다른 지역으로 옮겨 갈 수 있게)
  const regions = [...new Set([...ids].map(id => ((index || {})[id] || {}).gu || (reqBy[id] || {}).gu).filter(Boolean))].sort();

  const p = Math.max(1, Number(page) || 1);
  return {
    total: rows.length,
    page: p,
    pages: Math.max(1, Math.ceil(rows.length / HUB_PAGE)),
    rows: rows.slice((p - 1) * HUB_PAGE, p * HUB_PAGE),
    regions,
    sums: {
      complexes: ids.size,
      ratings: Object.values(index || {}).reduce((s, e) => s + (e.ratings || 0), 0),
      visits: Object.values(index || {}).reduce((s, e) => s + (e.visits || 0), 0),
      outside: Object.values(index || {}).reduce((s, e) => s + (e.outside || 0), 0),
      requests: Object.values(reqBy).reduce((s, e) => s + e.open, 0),
    },
  };
}

/** 파일 이름 → 단지 번호(community/ratings/12345.json → 12345) */
export const idFromPath = path => {
  const m = String(path || '').match(/\/(\d+)\.json$/);
  return m ? Number(m[1]) : null;
};
