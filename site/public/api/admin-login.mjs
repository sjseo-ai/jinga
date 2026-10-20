import { blobStore } from './_blob.mjs';
import { createAdminLogin } from './_auth.mjs';

// 관리자 로그인 — GET 로그인 상태 · POST { action: 'login', password } | { action: 'logout' } | { action: 'change', current, next }
// 운영 PC 전용(관리 키): { action: 'set', password } | { action: 'clear' }
const handle = request => createAdminLogin(blobStore(), process.env)(request);
export async function GET(request) { return handle(request); }
export async function POST(request) { return handle(request); }
