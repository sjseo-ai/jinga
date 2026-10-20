// 「다른 곳에서 본 이야기」 — 네이버 카페·호갱노노 같은 곳의 여론을 단지 옆에 두는 자리입니다.
//
// 왜 이런 모양인가 — 그 글들을 우리가 긁어 오는 것은 못 합니다.
//   · 네이버 부동산·호갱노노·아실·KB 모두 robots.txt 로 자동 수집을 막아 두었고(호갱노노는 「서면 허락 없이 금지」,
//     아실은 ClaudeBot 을 이름으로 차단), 이용약관에도 어긋납니다.
//   · 무엇보다 **댓글 하나하나가 그 사람의 저작물**입니다. 옮겨 실으면 복제·공중송신이 됩니다.
//   · 모아 둔 더미를 통째로 가져오면 데이터베이스제작자의 권리(저작권법 제93조)도 걸립니다.
//
// 그래서 **옮겨 적지 않고, 읽은 사람이 자기 말로 줄여 적고 원문 링크를 답니다.**
//   · 보는 사람은 링크로 원문에 가서 직접 읽습니다 — 트래픽은 원래 사이트로 갑니다.
//   · 출처를 밝힌 짧은 요약은 저작권법 제28조(인용)가 말하는 정당한 범위 안에 있습니다.
//   · 그래서 이 모듈은 **원문을 그대로 붙여넣는 것을 막는 쪽으로** 짜여 있습니다(길이 상한·따옴표 검사·링크 필수).
import { randomUUID } from 'node:crypto';

export const URL_MAX = 300;
export const SUMMARY_MIN = 10;
export const SUMMARY_MAX = 200;      // 「요약」이라는 성격을 지키는 선 — 길면 옮겨 적은 것에 가까워집니다
export const NOTE_MAX = 60;
export const ROWS_MAX = 60;          // 단지마다 보관하는 글 수
export const HIDE_REPORTS = 3;

/** 자주 쓰는 출처 — 주소의 호스트로 알아봅니다(목록에 없으면 호스트를 그대로 보여 줍니다) */
export const SOURCES = [
  { key: 'naver-land', label: '네이버 부동산', hosts: ['land.naver.com', 'new.land.naver.com', 'm.land.naver.com', 'fin.land.naver.com'] },
  { key: 'naver-cafe', label: '네이버 카페', hosts: ['cafe.naver.com', 'm.cafe.naver.com'] },
  { key: 'naver-blog', label: '네이버 블로그', hosts: ['blog.naver.com', 'm.blog.naver.com'] },
  { key: 'hogangnono', label: '호갱노노', hosts: ['hogangnono.com', 'www.hogangnono.com'] },
  { key: 'asil', label: '아실', hosts: ['asil.kr', 'www.asil.kr'] },
  { key: 'kbland', label: 'KB부동산', hosts: ['kbland.kr', 'www.kbland.kr', 'data.kbland.kr'] },
  { key: 'youtube', label: '유튜브', hosts: ['youtube.com', 'www.youtube.com', 'youtu.be', 'm.youtube.com'] },
  { key: 'dc', label: '디시인사이드', hosts: ['gall.dcinside.com', 'm.dcinside.com'] },
  { key: 'ruliweb', label: '루리웹', hosts: ['bbs.ruliweb.com'] },
  { key: 'news', label: '뉴스', hosts: ['n.news.naver.com', 'news.naver.com', 'v.daum.net'] },
];

/** 링크를 달 수 없는 곳은 받지 않습니다 — 확인할 방법이 없는 이야기는 소문일 뿐입니다 */
const BAD_SCHEME = /^(javascript|data|vbscript|file):/i;

const clean = (s, max) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, max);

/** 주소 → { url, host, source, label }. 주소가 이상하면 null */
export function readUrl(raw) {
  const t = String(raw == null ? '' : raw).trim().slice(0, URL_MAX);
  if (!t || BAD_SCHEME.test(t)) return null;
  let u;
  try { u = new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (!u.hostname.includes('.')) return null;
  const host = u.hostname.replace(/^www\./, '');
  const hit = SOURCES.find(s => s.hosts.some(h => h.replace(/^www\./, '') === host));
  return { url: u.toString().slice(0, URL_MAX), host, source: hit ? hit.key : 'etc', label: hit ? hit.label : host };
}

/**
 * 요약이 「옮겨 적은 것」처럼 보이는지 — 막는 것이 아니라 되돌려보내고 다시 쓰게 합니다.
 * 완벽히 가려낼 수는 없습니다. 눈에 띄는 것만 걸러 내고, 나머지는 안내와 신고에 맡깁니다.
 */
export function looksCopied(text) {
  const t = String(text || '').trim();
  if (/^["'“”‘’「『]/.test(t) && /["'“”‘’」』]$/.test(t)) return '따옴표로 감싼 것은 원문을 옮긴 것으로 봅니다 — 읽고 느낀 것을 직접 적어 주세요';
  if ((t.match(/\n/g) || []).length >= 3) return '여러 문단을 붙여넣은 것 같습니다 — 한두 문장으로 줄여 주세요';
  if (/https?:\/\//i.test(t)) return '요약에는 주소를 넣지 마세요 — 원문 주소는 위 칸에 넣습니다';
  if (/^(ㄱ|ㄴ|ㄷ|ㅋ|ㅎ|ㅠ|ㅜ)+$/.test(t.replace(/\s/g, ''))) return '내용을 알아볼 수 있게 적어 주세요';
  return null;
}

export const RULES = [
  '**원문을 그대로 옮기지 마세요.** 남이 쓴 글은 그 사람의 저작물입니다 — 읽고 **무슨 얘기였는지**만 자기 말로 적어 주세요.',
  '원문 주소를 반드시 답니다. 보는 사람이 직접 가서 읽을 수 있어야 합니다.',
  '본 적 없는 이야기를 지어내지 마세요. 확인되지 않은 시세·호재는 다른 사람의 판단을 망칩니다.',
  '글쓴이의 이름·닉네임·연락처는 옮기지 마세요.',
  '광고·매물 홍보는 신고 세 번이면 자동으로 감춰집니다.',
];

/**
 * 한 건 다듬기 — 화면에서 온 값을 그대로 믿지 않습니다.
 * → { ok, value } | { ok:false, error }
 */
export function parseOutside(input = {}, now = () => Date.now()) {
  const complexId = Number(input.complexId);
  if (!Number.isInteger(complexId) || complexId <= 0) return { ok: false, error: '단지를 고르지 않았습니다' };

  const link = readUrl(input.url);
  if (!link) return { ok: false, error: '원문 주소를 넣어 주세요(http 로 시작하는 주소)' };

  const summary = clean(input.summary, SUMMARY_MAX + 1);
  if (summary.length < SUMMARY_MIN) return { ok: false, error: `요약을 ${SUMMARY_MIN}자 이상 적어 주세요` };
  if (summary.length > SUMMARY_MAX) return { ok: false, error: `요약은 ${SUMMARY_MAX}자까지입니다 — 길면 옮겨 적은 것에 가까워집니다` };
  const copied = looksCopied(summary);
  if (copied) return { ok: false, error: copied };

  // 「내 말로 줄였다」를 사람이 한 번 확인하게 — 눌러야만 올라갑니다
  if (input.agree !== true) return { ok: false, error: '원문을 그대로 옮기지 않았다고 확인해 주세요' };

  return {
    ok: true,
    value: {
      id: randomUUID().replace(/-/g, '').slice(0, 10),
      complexId,
      url: link.url, host: link.host, source: link.source, sourceLabel: link.label,
      summary,
      note: clean(input.note, NOTE_MAX),      // 「2026년 9월 글」처럼 언제 쓰인 글인지(선택)
      at: new Date(now()).toISOString(),
      hidden: false, reports: [],
    },
  };
}

/** 새 글이 앞에, 너무 쌓이면 오래된 것부터 */
export const addOutside = (rows, row, uid) => [{ ...row, uid }, ...(rows || [])].slice(0, ROWS_MAX);

/** 같은 사람이 여러 번 신고해도 한 번만 셉니다 */
export function reportOutside(rows, id, uid) {
  const list = rows || [];
  const i = list.findIndex(r => r.id === id);
  if (i < 0) return { ok: false, error: '글을 찾지 못했습니다' };
  const reports = [...new Set([...(list[i].reports || []), uid])];
  const next = [...list];
  next[i] = { ...next[i], reports, hidden: next[i].hidden || reports.length >= HIDE_REPORTS };
  return { ok: true, value: next };
}

/** 화면으로 — 누가 올렸는지·누가 신고했는지는 내보내지 않습니다 */
export const publicOutside = (r, me = null) => ({
  id: r.id, url: r.url, host: r.host, source: r.source, sourceLabel: r.sourceLabel,
  summary: r.summary, note: r.note || '', at: r.at,
  name: r.name || `이웃 ${String(r.uid || '').slice(0, 4) || '****'}`,
  mine: !!me && r.uid === me,
});

/** 「네이버 카페 3 · 호갱노노 2」 — 어디 이야기가 얼마나 모였는지 */
export function outsideDigest(rows = []) {
  const live = (rows || []).filter(r => !r.hidden);
  const by = new Map();
  for (const r of live) by.set(r.sourceLabel || r.host, (by.get(r.sourceLabel || r.host) || 0) + 1);
  return {
    n: live.length,
    by: [...by.entries()].sort((a, b) => b[1] - a[1]).map(([label, n]) => ({ label, n })),
    updatedAt: live.length ? live.map(r => r.at).sort().pop() : null,
  };
}
