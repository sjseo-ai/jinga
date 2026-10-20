// 주간 보고서 서버 작업 입구 — api/_job.mjs
//   GET  (Vercel Cron, Authorization: Bearer CRON_SECRET) 매일 08:30(한국) 전후: **월요일에** 이번 주 작업 시작(구독자 안내와 같은 발송 요일) · 멈춘 작업 이어 가기 · 구독 메일 보정
//   GET  ?status=1 (관리 키 또는 관리자 로그인)          작업 상태
//   POST (관리 키 또는 관리자 로그인) { action: 'start', mode: 'test'|'full', force? } | { action: 'continue' } | { action: 'seed', name, date?, data }
// 실제 일은 응답을 먼저 돌려준 뒤 waitUntil 로 최대 5분 하고, 남으면 이 주소를 다시 불러 이어 갑니다.
import { waitUntil } from '@vercel/functions';
import { blobStore } from './_blob.mjs';
import { adminAuth } from './_auth.mjs';
import { runJob, startJob, cronTick, jobSummary, JOB_PATH, LAST_FULL_PATH } from './_job.mjs';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
async function who(request, store) {
  const h = request.headers.get('authorization') || '';
  if (process.env.CRON_SECRET && h === `Bearer ${process.env.CRON_SECRET}`) return 'cron';
  return (await adminAuth(request, store, process.env)) ? 'admin' : null;
}
const originOf = request => String(process.env.JINGA_SITE_URL || new URL(request.url).origin).replace(/\/+$/, '');

async function work(store, origin) {
  const r = await runJob({ store, origin });
  if (r.ran && !r.done && !r.failed) {
    // 다음 실행을 새 함수 호출로 — 상대가 곧바로 202를 돌려주므로 오래 기다리지 않음
    await fetch(`${origin}/api/weekly`, {
      method: 'POST', signal: AbortSignal.timeout(25000),
      headers: { Authorization: `Bearer ${process.env.JINGA_ADMIN_SECRET}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'continue' }),
    }).catch(e => console.error('[weekly] 다음 단계 호출 실패 — 매일 크론이 이어 감:', e.message));
  }
}

export async function GET(request) {
  const store = blobStore();
  const role = await who(request, store);
  if (!role) return json({ ok: false, error: 'unauthorized' }, 401);
  if (role === 'admin' && new URL(request.url).searchParams.get('status')) {
    return json({ ok: true, job: jobSummary(await store.get(JOB_PATH)), lastFull: await store.get(LAST_FULL_PATH) });
  }
  const origin = originOf(request);
  const tick = await cronTick(store, process.env, origin);
  if (tick.run) waitUntil(work(store, origin));
  return json({ ok: true, ...tick }, 202);
}

const SEEDS = { snapshot: d => `weekly/data/${d}.json`, map: () => 'weekly/kb-seoul-gu.json', config: () => 'weekly/config.json' };

export async function POST(request) {
  const store = blobStore();
  if ((await who(request, store)) !== 'admin') return json({ ok: false, error: 'unauthorized' }, 401);
  const body = await request.json().catch(() => ({}));
  const origin = originOf(request);
  if (body.action === 'start') {
    const r = await startJob(store, { mode: body.mode === 'full' ? 'full' : 'test', force: !!body.force });
    if (!r.ok) return json(r, 409);
    waitUntil(work(store, origin));
    return json(r, 202);
  }
  if (body.action === 'continue') {
    waitUntil(work(store, origin));
    return json({ ok: true }, 202);
  }
  if (body.action === 'seed' && SEEDS[body.name] && body.data && typeof body.data === 'object') {
    if (body.name === 'snapshot' && !/^\d{4}-\d{2}-\d{2}$/.test(body.date || '')) return json({ ok: false, error: 'date' }, 400);
    await store.put(SEEDS[body.name](body.date), body.data);
    return json({ ok: true });
  }
  return json({ ok: false, error: 'action' }, 400);
}
