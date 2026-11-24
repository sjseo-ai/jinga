// 방문 집계 — 「어느 홍보가 먹혔나」만 알기 위한 최소한의 셈.
//
// 왜 직접 만드나 — 서버 함수가 11/12 로 한 칸뿐이라 새 함수를 둘 수 없어 community.mjs 안에 얹었습니다.
// (Vercel Web Analytics 를 켜면 더 좋은 화면을 공짜로 주지만 대시보드에서 직접 켜야 합니다. 둘은 같이 써도 됩니다.)
//
// **사람을 식별하지 않습니다.** 남기는 것은 네 가지뿐입니다.
//   · 날짜            2026-10-12
//   · 어디서 왔는지    blog.naver.com / cafe.naver.com / 직접
//   · utm_source      블로그 링크에 ?utm_source=naverblog 를 붙였을 때만
//   · 휴대폰/PC        화면 폭으로만 가름
//   · 어느 화면        첫화면 / 단지 / 자치구 — 주소 전체가 아니라 갈래만
// IP·접속기록·사용자 문자열(UA)은 **저장하지 않습니다.** 그래서 한 사람이 몇 번 왔는지는 알 수 없고,
// 알 필요도 없습니다. 알고 싶은 건 「네이버 블로그에서 몇 명이 왔나」뿐입니다.
//
// 한계 — 같은 날 파일 하나를 여러 요청이 동시에 고치면 몇 건이 묻힐 수 있습니다(읽고-고쳐-쓰기).
// 하루 수천 건까지는 티가 안 나고, 그보다 많아지면 그때는 Vercel Web Analytics 를 켜는 게 맞습니다.

export const MAX_REFS = 60;        // 유입처는 이만큼만 따로 세고 나머지는 '기타'
export const MAX_DAYS = 120;       // 돌려주는 날짜 수
export const UTM_MAX = 40;

/** 봇은 세지 않습니다 — 검색엔진·링크 미리보기(카톡 등)가 사람 수를 부풀립니다 */
const BOT = /bot|crawl|spider|slurp|facebookexternalhit|kakaotalk-scrap|yeti|daum|preview|headless|lighthouse|curl|wget|python-requests|monitor|pingdom/i;
export const isBot = ua => BOT.test(String(ua || ''));

/** 'YYYY-MM-DD' (한국 시간 기준 — 운영자가 보는 날짜와 맞춰야 합니다) */
export function dayKey(date = new Date()) {
  const kst = new Date(date.getTime() + 9 * 3600e3);
  return kst.toISOString().slice(0, 10);
}

const clean = (s, max) => String(s ?? '').replace(/[\s\u0000-\u001f]/g, '').slice(0, max);

/**
 * 어디서 왔는지 — 주소에서 호스트만 꺼냅니다. 우리 사이트 안에서 넘어온 것은 세지 않습니다(null).
 * 주소가 없으면 '직접'(주소창에 치거나 북마크, 카톡 앱 등).
 */
export function refHost(referrer, selfHost) {
  const raw = String(referrer || '').trim();
  if (!raw) return '직접';
  let h;
  try { h = new URL(raw).hostname.toLowerCase(); } catch { return '기타'; }
  if (!h) return '기타';
  if (selfHost && h === String(selfHost).toLowerCase()) return null;   // 사이트 안 이동
  return h.replace(/^www\./, '').slice(0, 80);
}

/** 링크에 붙여 둔 꼬리표 — ?utm_source=naverblog 처럼 직접 붙였을 때만 */
export function utmSource(url) {
  try {
    const v = new URL(String(url), 'https://x').searchParams.get('utm_source');
    const t = clean(v, UTM_MAX).toLowerCase();
    return t || null;
  } catch { return null; }
}

/**
 * 어느 화면으로 들어왔나 — 검색으로 바로 들어오는 정적 페이지와 첫 화면을 가릅니다.
 * 주소 전체가 아니라 **몇 갈래로만** 셉니다(단지 2,000곳을 각각 세면 파일만 커지고 읽히지도 않습니다).
 */
export function areaKind(url) {
  const raw = String(url || '').trim();
  if (!raw) return '기타';            // 주소를 안 보냈으면 모르는 것 — '/' 로 쳐서 첫화면으로 세면 안 됩니다
  let p;
  try { p = new URL(raw, 'https://x').pathname; } catch { return '기타'; }
  try { p = decodeURIComponent(p); } catch { /* 깨진 인코딩이면 그대로 */ }
  if (p === '/apt/' || p === '/apt') return '단지목록';
  if (p.startsWith('/apt/')) return '단지';
  if (p.startsWith('/gu/')) return '자치구';
  if (p === '/' || p === '/index.html' || p === '/index.htm') return '첫화면';
  return '기타';
}

/** 휴대폰인지 — 화면 폭만 봅니다(사용자 문자열은 저장하지 않습니다) */
export const deviceKind = width => (Number(width) > 0 && Number(width) < 768 ? 'mobile' : 'desktop');

export const emptyMonth = month => ({ month, total: 0, days: {}, refs: {}, utm: {}, device: {}, areas: {} });

const add = (map, key, max) => {
  if (!key) return;
  if (map[key] === undefined && max && Object.keys(map).length >= max) key = '기타';
  map[key] = (map[key] | 0) + 1;
};

/**
 * 한 번 방문한 것을 더합니다. 원본을 바꾸지 않고 새 묶음을 돌려줍니다.
 * hit = { day, ref, utm, device, area }
 */
export function bump(stats, hit) {
  const s = stats && stats.month ? stats : emptyMonth(String(hit?.day || dayKey()).slice(0, 7));
  const out = {
    month: s.month,
    total: (s.total | 0) + 1,
    days: { ...s.days }, refs: { ...s.refs }, utm: { ...s.utm }, device: { ...s.device },
    // areas 는 나중에 더한 칸이라 예전 달 파일에는 없습니다 — 없으면 빈 것으로 시작합니다
    areas: { ...(s.areas || {}) },
  };
  add(out.days, clean(hit?.day, 10) || dayKey());
  add(out.refs, clean(hit?.ref, 80), MAX_REFS);
  add(out.utm, clean(hit?.utm, UTM_MAX), MAX_REFS);
  add(out.device, hit?.device === 'mobile' ? 'mobile' : 'desktop');
  add(out.areas, clean(hit?.area, 16) || '기타', 8);
  return out;
}

const sortDesc = (map, limit) => Object.entries(map || {})
  .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
  .slice(0, limit)
  .map(([key, n]) => ({ key, n }));

/** 여러 달치를 운영자 화면이 쓰기 좋게 — 날짜는 오래된 것부터, 유입처는 많은 것부터 */
export function summarize(months, limit = 25) {
  const all = (months || []).filter(m => m && m.month);
  const merge = key => all.reduce((acc, m) => {
    for (const [k, n] of Object.entries(m[key] || {})) acc[k] = (acc[k] | 0) + (n | 0);
    return acc;
  }, {});
  const days = merge('days');
  const ordered = Object.keys(days).sort().slice(-MAX_DAYS);
  return {
    total: all.reduce((n, m) => n + (m.total | 0), 0),
    months: all.map(m => m.month).sort(),
    days: ordered.map(d => ({ day: d, n: days[d] | 0 })),
    refs: sortDesc(merge('refs'), limit),
    utm: sortDesc(merge('utm'), limit),
    device: sortDesc(merge('device'), 4),
    areas: sortDesc(merge('areas'), 8),
  };
}

export const statsPath = month => `stats/${month}.json`;

/** 최근 몇 달치 파일 이름 — 지금 달부터 거슬러 */
export function recentMonths(n = 3, date = new Date()) {
  const out = [];
  const kst = new Date(date.getTime() + 9 * 3600e3);
  let y = kst.getUTCFullYear(), m = kst.getUTCMonth();
  for (let i = 0; i < n; i++) {
    out.push(`${y}-${String(m + 1).padStart(2, '0')}`);
    if (--m < 0) { m = 11; y--; }
  }
  return out;
}
