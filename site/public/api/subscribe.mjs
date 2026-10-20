import { waitUntil } from '@vercel/functions';
import { createHandlers, recordPath } from './_core.mjs';
import { blobStore } from './_blob.mjs';
import { mailConfigFromEnv, canSend, createTransport, confirmMail, changeMail, fromHeader } from './_mail.mjs';

// POST /api/subscribe  { email, consent: true, criteria, website(봇 함정 칸, 비워 둠) }
// 신청이 저장되면 응답을 먼저 돌려주고 확인(또는 조건 변경 확인) 메일을 바로 보냄 — 실패하면 매일 크론(api/weekly)이 다시 보냄
export async function POST(request) {
  const store = blobStore();
  const cfg = mailConfigFromEnv();
  if (!cfg.siteUrl) cfg.siteUrl = new URL(request.url).origin;
  const onMail = (kind, record) => {
    if (!canSend(cfg)) return;
    waitUntil((async () => {
      try {
        const tx = await createTransport(cfg);
        await tx.sendMail({ from: fromHeader(cfg), to: record.email, ...(kind === 'change' ? changeMail(cfg, record) : confirmMail(cfg, record)) });
        const cur = await store.get(recordPath(record.id));
        if (cur) await store.put(recordPath(record.id), { ...cur, [kind === 'change' ? 'changeMailSentAt' : 'confirmMailSentAt']: new Date().toISOString() });
      } catch (e) {
        console.error(`[subscribe] ${kind} 메일 발송 실패 — 매일 크론이 다시 시도:`, e.message);
      }
    })());
  };
  return createHandlers(store, process.env, undefined, { onMail }).subscribe(request);
}

// GET /api/subscribe?action=confirm|unsubscribe&id=&token=
// 원래 /api/confirm · /api/unsubscribe 함수였는데, Vercel Hobby 는 서버 함수를 12개까지만 둘 수 있어
// 구독 관련 셋을 이 함수 하나로 합쳤습니다. 이미 발송된 메일의 링크는 vercel.json rewrites 가 이리로 넘겨 줍니다.
export async function GET(request) {
  const action = new URL(request.url).searchParams.get('action');
  const handlers = createHandlers(blobStore(), process.env);
  if (action === 'confirm') return handlers.confirm(request);
  if (action === 'unsubscribe') return handlers.unsubscribe(request);
  return new Response(JSON.stringify({ ok: false, error: 'action(confirm|unsubscribe)이 필요합니다' }),
    { status: 400, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}
