import { createHandlers } from './_core.mjs';
import { blobStore } from './_blob.mjs';
import { adminAuth } from './_auth.mjs';

// 구독자 관리 — 운영 PC(Authorization: Bearer JINGA_ADMIN_SECRET) 또는 관리자 페이지 로그인(세션 쿠키)
//   GET  → 구독자 목록(로그인 사용자에게는 확인·해지 토큰을 빼고)
//   POST { action: 'mark', id, field: 'confirmMailSentAt' | 'lastWeeklySentAt' | 'changeMailSentAt' } | { action: 'delete', id }
const handle = request => {
  const store = blobStore();
  const authorize = async r => (await adminAuth(r, store, process.env)) === 'session';
  return createHandlers(store, process.env, undefined, { authorize }).admin(request);
};
export async function GET(request) { return handle(request); }
export async function POST(request) { return handle(request); }
