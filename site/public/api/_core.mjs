// 진가 주간 보고서 메일 구독 — 저장소와 무관한 처리 로직(테스트 가능)
// Vercel 함수(api/subscribe·confirm·unsubscribe·admin)가 _blob.mjs 저장소를 넣어 씁니다.
//   신청(pending) → 운영 PC가 확인 메일 발송 → 사용자가 확인 링크 클릭(confirmed) → 매주 보고서 발송
//   구독자마다 보고서 조건(자치구·예산·면적·규모·예산 기준)을 저장 — 운영 PC가 조건별로 보고서를 만들어 보냄
//   이미 구독 중인 주소로 다시 신청하면 조건 변경 확인 메일을 보내고, 링크를 눌러야 바뀜(남이 조건을 바꾸지 못하게)
//   모든 메일에 수신 거부 링크, 7일 동안 확인하지 않은 신청은 운영 PC가 삭제
import { createLimiter, clientIp, mailRules } from './_ratelimit.mjs';   // 구독 신청도 로그인 없이 메일을 보내는 길목

const EMAIL_RE = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[A-Za-z]{2,}$/;
export const PENDING_RESEND_MS = 10 * 60 * 1000;   // 같은 주소 재신청 시 10분 안이면 새 토큰·새 메일을 만들지 않음
export const CHANGE_TTL_MS = 7 * 24 * 3600e3;      // 조건 변경 확인 링크 유효 기간
export const MAX_SUBSCRIBERS = 5000;
const MSG_PENDING = '확인 메일을 보내드립니다(보통 10분 안에 도착). 메일의 「구독 확인」을 눌러야 구독이 시작됩니다.';

// ── 보고서 조건 ────────────────────────────────────────────────
export const SEOUL_GUS = ['강남구', '강동구', '강북구', '강서구', '관악구', '광진구', '구로구', '금천구', '노원구', '도봉구', '동대문구', '동작구', '마포구',
  '서대문구', '서초구', '성동구', '성북구', '송파구', '양천구', '영등포구', '용산구', '은평구', '종로구', '중구', '중랑구'];
export const MAX_REPORT_GUS = 5;
export const HOUSEHOLD_STEPS = [0, 300, 500, 1000];
// 임대세대 비율 상한(%) — 0이면 제한 없음. 화면의 선택지와 같은 값만 받습니다.
// 이미 구독 중인 분의 조건에 이 값이 없으면 0(제한 없음)으로 봅니다 —
// 받아 보던 보고서의 내용을 말없이 바꾸지 않으려는 것입니다.
export const RENT_STEPS = [0, 1, 15, 30];

/** 사이트에서 받은 조건 → 저장 형식(reports/config.json 과 같은 키, 억·㎡ 단위). 잘못되면 { error } */
export function normalizeCriteria(raw) {
  if (!raw || typeof raw !== 'object') return { error: '보고서 조건이 없습니다' };
  const gus = [...new Set(Array.isArray(raw.gus) ? raw.gus.map(String) : [])];
  if (!gus.length) return { error: '자치구를 1개 이상 선택해 주세요' };
  if (gus.length > MAX_REPORT_GUS) return { error: `자치구는 ${MAX_REPORT_GUS}개까지 선택할 수 있습니다` };
  if (gus.some(g => !SEOUL_GUS.includes(g))) return { error: '서울 자치구만 선택할 수 있습니다' };
  const num = v => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; };
  const eok = v => Math.round(num(v) * 100) / 100;
  let budgetMinEok = eok(raw.budgetMinEok), budgetEok = eok(raw.budgetEok);
  if (!budgetEok) return { error: '예산 상한을 입력해 주세요' };
  if (budgetMinEok > budgetEok) [budgetMinEok, budgetEok] = [budgetEok, budgetMinEok];
  if (budgetEok > 200) return { error: '예산 상한은 200억 이하로 입력해 주세요' };
  let minArea = Math.floor(num(raw.minArea)), maxArea = Math.floor(num(raw.maxArea));
  if (maxArea && minArea > maxArea) [minArea, maxArea] = [maxArea, minArea];
  if (minArea > 400 || maxArea > 400) return { error: '전용면적은 400㎡ 이하로 입력해 주세요' };
  const minHouseholds = HOUSEHOLD_STEPS.includes(Number(raw.minHouseholds)) ? Number(raw.minHouseholds) : 300;
  const priceBasis = raw.priceBasis === 'kb' ? 'kb' : 'ask';
  const maxRentPct = RENT_STEPS.includes(Number(raw.maxRentPct)) ? Number(raw.maxRentPct) : 0;
  return { criteria: { gus: SEOUL_GUS.filter(g => gus.includes(g)), budgetMinEok, budgetEok, minArea, maxArea, minHouseholds, priceBasis, maxRentPct } };
}

/** 같은 조건이면 같은 키 — 조건이 같은 구독자는 보고서 하나를 같이 받음 */
export function criteriaKey(c) {
  return [SEOUL_GUS.filter(g => c.gus.includes(g)).join(','), c.budgetMinEok || 0, c.budgetEok, c.minArea || 0, c.maxArea || 0, c.minHouseholds || 0, c.priceBasis === 'kb' ? 'kb' : 'ask', c.maxRentPct || 0].join('|');
}

const eokText = v => {
  const man = Math.round(v * 10000), e = Math.floor(man / 10000), r = man % 10000;
  return e ? `${e}억${r ? ` ${r.toLocaleString('ko-KR')}만` : ''}` : `${r.toLocaleString('ko-KR')}만`;
};
/** 메일·안내 페이지에 보여줄 조건 한 줄 */
export function criteriaLabel(c) {
  const money = c.budgetMinEok ? `${eokText(c.budgetMinEok)} ~ ${eokText(c.budgetEok)}` : `${eokText(c.budgetEok)} 이하`;
  const area = c.maxArea ? (c.minArea ? `${c.minArea}~${c.maxArea}㎡` : `${c.maxArea}㎡ 이하`) : (c.minArea ? `${c.minArea}㎡ 이상` : '면적 무관');
  const rentWord = c.maxRentPct === 1 ? '없는 단지만' : `${c.maxRentPct}% 이하`;
  const rent = c.maxRentPct > 0 ? ` · 임대세대 ${rentWord}` : '';
  return `${c.gus.join('·')} · 예산 ${money}(${c.priceBasis === 'kb' ? 'KB시세' : '매물 호가'} 기준) · 전용 ${area} · ${c.minHouseholds ? `${c.minHouseholds.toLocaleString('ko-KR')}세대 이상` : '규모 무관'}${rent}`;
}

export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
export function randomToken() {
  const a = new Uint8Array(24);
  crypto.getRandomValues(a);
  return [...a].map(b => b.toString(16).padStart(2, '0')).join('');
}
export function normalizeEmail(v) {
  const e = String(v || '').trim().toLowerCase();
  return e.length <= 254 && EMAIL_RE.test(e) ? e : null;
}
export const recordPath = id => `subs/${id}.json`;
export function maskEmail(e) {
  const [u, d] = String(e).split('@');
  return `${u.slice(0, 2)}${'*'.repeat(Math.max(1, u.length - 2))}@${d}`;
}
function safeEqual(a, b) {
  a = String(a || ''); b = String(b || '');
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
});
export function page(title, message, ok = true) {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · 진가</title>
<style>body{margin:0;background:#EBEEF2;font:15px/1.7 "Pretendard","Malgun Gothic",sans-serif;color:#13212F;display:grid;place-items:center;min-height:100vh}
.box{background:#fff;border:1px solid #D7DEE6;border-radius:14px;padding:32px 36px;max-width:460px;margin:20px;text-align:center}
h1{font-size:20px;margin:0 0 10px;color:${ok ? '#0E1C2B' : '#B3261E'}}a{display:inline-block;margin-top:18px;background:#0E1C2B;color:#fff;text-decoration:none;padding:10px 20px;border-radius:9px;font-weight:700}</style></head>
<body><div class="box"><h1>${esc(title)}</h1><p>${esc(message)}</p><a href="/">진가 사이트로 가기</a></div></body></html>`;
}
const htmlRes = (title, message, ok = true, status = 200) => new Response(page(title, message, ok), {
  status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
});

/** store: { get(path)→객체|null, put(path, 객체), del(path), list(prefix)→[path] } · env: { JINGA_ADMIN_SECRET }
 *  hooks.onMail(kind: 'confirm'|'change', record) — 신청 직후 확인 메일을 보내게 함(서버). 없으면 운영 PC·매일 크론이 보냄 */
export function createHandlers(store, env, now = () => Date.now(), hooks = {}) {
  const iso = () => new Date(now()).toISOString();
  const idOk = id => /^[0-9a-f]{32}$/.test(id || '');
  return {
    async subscribe(request) {
      if (request.method !== 'POST') return json({ ok: false, error: 'POST만 허용됩니다' }, 405);
      let body;
      try { body = await request.json(); } catch { return json({ ok: false, error: '잘못된 요청입니다' }, 400); }
      if (body && body.website) return json({ ok: true, status: 'pending', message: MSG_PENDING });   // 봇 함정 칸 — 저장하지 않음
      const email = normalizeEmail(body && body.email);
      if (!email) return json({ ok: false, error: '메일 주소 형식을 확인해 주세요' }, 400);
      if (body.consent !== true) return json({ ok: false, error: '개인정보 수집·이용 동의가 필요합니다' }, 400);
      const { criteria, error } = normalizeCriteria(body.criteria);
      if (error) return json({ ok: false, error }, 400);
      // 메일이 **실제로 나가는 자리**에서만 횟수를 셉니다.
      // 형식이 틀려 되돌려보낸 요청이나 메일 없이 조건만 바꾸는 경우까지 세면, 제대로 쓰는 사람이 먼저 막힙니다.
      // 같은 주소 10분 재발송 방지(PENDING_RESEND_MS)만으로는 부족합니다 — 주소를 바꿔 가며 부르면
      // 우리 계정에서 남의 주소로 메일이 계속 나갑니다. 보내는 곳(IP)과 전체 횟수도 함께 셉니다.
      const mailGate = () => createLimiter(store, { now }).check(mailRules('sub', clientIp(request), email));
      const tooMany = g => json({ ok: false, error: `${g.label}. ${Math.ceil(g.retryAfterS / 60)}분 뒤에 다시 시도해 주세요.` }, 429, { 'Retry-After': String(g.retryAfterS) });
      const id = (await sha256Hex(email)).slice(0, 32);
      const existing = await store.get(recordPath(id));

      if (existing && existing.status === 'confirmed') {
        if (existing.criteria && criteriaKey(existing.criteria) === criteriaKey(criteria)) {
          return json({ ok: true, status: 'already', message: '이미 같은 조건으로 구독 중인 주소입니다.' });
        }
        // 조건 변경 — 확인 링크를 눌러야 반영. 10분 안에 또 바꾸면 새 메일 없이 조건만 갱신(메일 폭탄 방지)
        const recent = existing.changeMailSentAt && now() - Date.parse(existing.changeMailSentAt) < PENDING_RESEND_MS;
        if (!recent) { const g = await mailGate(); if (!g.ok) return tooMany(g); }
        const updated = { ...existing, pendingCriteria: criteria, changeRequestedAt: iso(), changeMailSentAt: recent ? existing.changeMailSentAt : null };
        await store.put(recordPath(id), updated);
        if (!recent && hooks.onMail) await hooks.onMail('change', updated);
        return json({ ok: true, status: 'change-pending', message: recent
          ? '이미 조건 변경 확인 메일을 보냈습니다. 그 메일의 「조건 변경 확인」을 누르면 방금 입력한 조건으로 바뀝니다.'
          : '이미 구독 중인 주소입니다. 조건 변경 확인 메일을 보내드립니다(보통 10분 안에 도착). 메일의 「조건 변경 확인」을 눌러야 바뀝니다.' });
      }
      if (existing && now() - Date.parse(existing.createdAt) < PENDING_RESEND_MS) {
        await store.put(recordPath(id), { ...existing, criteria });   // 확인 전이면 조건만 최신으로
        return json({ ok: true, status: 'pending', message: '이미 신청된 주소입니다. 확인 메일을 기다려 주세요(보통 10분 안에 도착). 조건은 방금 입력한 내용으로 바꿨습니다.' });
      }
      { const g = await mailGate(); if (!g.ok) return tooMany(g); }
      if (!existing && (await store.list('subs/')).length >= MAX_SUBSCRIBERS) return json({ ok: false, error: '구독 신청이 일시 중단되었습니다' }, 503);
      const record = {
        id, email, status: 'pending', token: randomToken(), criteria, consentAt: iso(), createdAt: iso(),
        confirmMailSentAt: null, confirmedAt: null, lastWeeklySentAt: null,
      };
      await store.put(recordPath(id), record);
      if (hooks.onMail) await hooks.onMail('confirm', record);
      return json({ ok: true, status: 'pending', message: MSG_PENDING });
    },

    async confirm(request) {
      const u = new URL(request.url);
      const id = u.searchParams.get('id'), token = u.searchParams.get('token');
      const r = idOk(id) ? await store.get(recordPath(id)) : null;
      if (!r || !safeEqual(r.token, token)) return htmlRes('링크가 유효하지 않습니다', '이미 해지됐거나 잘못된 링크입니다. 사이트에서 다시 신청해 주세요.', false, 404);
      if (r.status === 'confirmed' && r.pendingCriteria) {
        if (now() - Date.parse(r.changeRequestedAt) > CHANGE_TTL_MS) {
          const { pendingCriteria, changeRequestedAt, changeMailSentAt, ...rest } = r;
          await store.put(recordPath(id), rest);
          return htmlRes('변경 요청이 만료되었습니다', '조건 변경 확인은 요청 후 7일 안에 해야 합니다. 사이트에서 다시 신청해 주세요.', false, 410);
        }
        const { pendingCriteria, changeRequestedAt, changeMailSentAt, ...rest } = r;
        await store.put(recordPath(id), { ...rest, criteria: pendingCriteria, criteriaChangedAt: iso() });
        return htmlRes('보고서 조건이 바뀌었습니다', `다음 주 월요일 보고서부터 이 조건으로 보내드립니다 — ${criteriaLabel(pendingCriteria)}`);
      }
      if (r.status !== 'confirmed') await store.put(recordPath(id), { ...r, status: 'confirmed', confirmedAt: iso() });
      return htmlRes('구독이 확인되었습니다', `${maskEmail(r.email)} 주소로 매주 월요일 아침 진가 주간 보고서를 보내드립니다${r.criteria ? ` — ${criteriaLabel(r.criteria)}` : ''}. 메일 아래의 수신 거부 링크로 언제든 해지할 수 있습니다.`);
    },

    async unsubscribe(request) {
      const u = new URL(request.url);
      const id = u.searchParams.get('id'), token = u.searchParams.get('token');
      const r = idOk(id) ? await store.get(recordPath(id)) : null;
      if (!r) return htmlRes('이미 해지된 주소입니다', '구독 정보가 없습니다. 더 이상 보고서가 발송되지 않습니다.');
      if (!safeEqual(r.token, token)) return htmlRes('링크가 유효하지 않습니다', '메일에 있는 수신 거부 링크를 그대로 눌러 주세요.', false, 404);
      await store.del(recordPath(id));
      return htmlRes('수신 거부가 완료되었습니다', `${maskEmail(r.email)} 주소를 삭제했습니다. 더 이상 주간 보고서를 보내지 않습니다.`);
    },

    // 운영 PC 전용 — Authorization: Bearer JINGA_ADMIN_SECRET
    async admin(request) {
      if (!env.JINGA_ADMIN_SECRET) return json({ ok: false, error: '관리 키가 설정되지 않았습니다' }, 503);
      const byKey = safeEqual(request.headers.get('authorization'), `Bearer ${env.JINGA_ADMIN_SECRET}`);
      if (!byKey && !(hooks.authorize && await hooks.authorize(request))) return json({ ok: false, error: 'unauthorized' }, 401);
      if (request.method === 'GET') {
        const paths = await store.list('subs/');
        let subscribers = (await Promise.all(paths.map(p => store.get(p)))).filter(Boolean);
        // 관리자 페이지(로그인 또는 ?view=page)에는 확인·해지 토큰을 내보내지 않음 — 토큰은 메일 발송 스크립트만 씀
        if (!byKey || new URL(request.url).searchParams.get('view') === 'page') subscribers = subscribers.map(({ token, ...rest }) => rest);
        return json({ ok: true, subscribers, fetchedAt: iso() });
      }
      if (request.method !== 'POST') return json({ ok: false, error: 'method' }, 405);
      const b = await request.json().catch(() => ({}));
      if (!idOk(b.id)) return json({ ok: false, error: 'id' }, 400);
      const r = await store.get(recordPath(b.id));
      if (!r) return json({ ok: false, error: 'not found' }, 404);
      if (b.action === 'mark' && ['confirmMailSentAt', 'lastWeeklySentAt', 'changeMailSentAt'].includes(b.field)) {
        await store.put(recordPath(b.id), { ...r, [b.field]: iso() });
        return json({ ok: true });
      }
      if (b.action === 'delete') { await store.del(recordPath(b.id)); return json({ ok: true }); }
      return json({ ok: false, error: 'action' }, 400);
    },
  };
}
