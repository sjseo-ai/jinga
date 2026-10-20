// 관리자 로그인(api/_auth.mjs) 스모크 테스트 — 비밀번호 해시·세션 쿠키·잠금·비밀번호 변경(네트워크 없음)
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hashPassword, verifyPassword, makeSession, verifySession, readCookie, adminAuth, createAdminLogin,
  PASSWORD_PATH, SESSION_COOKIE, SESSION_TTL_S,
} from '../site/public/api/_auth.mjs';
import { createHandlers } from '../site/public/api/_core.mjs';

const SITE = 'https://jinga.example';
const ENV = { JINGA_ADMIN_SECRET: 'k'.repeat(64) };

function memStore() {
  const m = new Map();
  return {
    map: m,
    async get(p) { return m.has(p) ? structuredClone(m.get(p)) : null; },
    async put(p, o) { m.set(p, structuredClone(o)); },
    async del(p) { m.delete(p); },
    async list(prefix) { return [...m.keys()].filter(k => k.startsWith(prefix)); },
  };
}
const req = (method, body, headers = {}) => new Request(`${SITE}/api/admin-login`, {
  method, headers: { 'Content-Type': 'application/json', 'x-real-ip': '1.2.3.4', ...headers }, body: body ? JSON.stringify(body) : undefined,
});
const cookieFrom = res => (/jinga_admin=([^;]*)/.exec(res.headers.get('set-cookie') || '') || [])[1] || '';

test('비밀번호 해시·세션 서명: 맞는 값만 통과, 만료·변조·비밀번호 변경 후 세션은 거부', async () => {
  const t = Date.parse('2026-09-15T00:00:00Z');
  const rec = await hashPassword('진가관리자-2026!', t);
  assert.ok(!JSON.stringify(rec).includes('진가관리자'), '비밀번호 원문은 저장하지 않음');
  assert.equal(await verifyPassword('진가관리자-2026!', rec), true);
  assert.equal(await verifyPassword('진가관리자-2026', rec), false);
  assert.equal(await verifyPassword(undefined, rec), false);

  const token = makeSession(ENV.JINGA_ADMIN_SECRET, rec, t);
  assert.equal(verifySession(token, ENV.JINGA_ADMIN_SECRET, rec, t + 60e3), true);
  assert.equal(verifySession(token, ENV.JINGA_ADMIN_SECRET, rec, t + SESSION_TTL_S * 1000 + 1), false, '12시간 지나면 만료');
  assert.equal(verifySession(token.slice(0, -2) + 'xx', ENV.JINGA_ADMIN_SECRET, rec, t), false, '서명 변조');
  assert.equal(verifySession(token.replace(/^v1\.\d+/, `v1.${9999999999}`), ENV.JINGA_ADMIN_SECRET, rec, t), false, '만료 시각 변조');
  assert.equal(verifySession(token, 'other', rec, t), false, '다른 관리 키');
  const changed = await hashPassword('새비밀번호입니다', t + 1000);
  assert.equal(verifySession(token, ENV.JINGA_ADMIN_SECRET, changed, t), false, '비밀번호를 바꾸면 기존 세션이 풀림');

  assert.equal(readCookie(new Request(SITE, { headers: { cookie: `a=1; ${SESSION_COOKIE}=${token}; b=2` } }), SESSION_COOKIE), token);
});

test('로그인 흐름: 설정 전 안내 → 관리 키로 설정 → 틀리면 잠금 → 로그인 쿠키로 관리 API → 변경 → 로그아웃', async () => {
  let t = Date.parse('2026-09-15T00:00:00Z');
  const store = memStore();
  const handle = createAdminLogin(store, ENV, () => t);

  assert.deepEqual(await (await handle(req('GET'))).json(), { ok: true, passwordSet: false, loggedIn: false });
  assert.equal((await handle(req('POST', { action: 'login', password: 'whatever1' }))).status, 409, '비밀번호를 정하기 전');
  assert.equal((await handle(req('POST', { action: 'set', password: 'abcd1234!' }))).status, 401, '설정은 관리 키로만');
  const keyH = { Authorization: `Bearer ${ENV.JINGA_ADMIN_SECRET}` };
  assert.equal((await handle(req('POST', { action: 'set', password: 'short' }, keyH))).status, 400, '8자 미만 거부');
  assert.equal((await handle(req('POST', { action: 'set', password: 'abcd1234!' }, keyH))).status, 200);
  assert.ok(store.map.has(PASSWORD_PATH));

  for (let i = 0; i < 4; i++) assert.equal((await handle(req('POST', { action: 'login', password: 'wrong-pass' }))).status, 401);
  const fifth = await handle(req('POST', { action: 'login', password: 'wrong-pass' }));
  assert.match((await fifth.json()).error, /15분/);
  const locked = await handle(req('POST', { action: 'login', password: 'abcd1234!' }));
  assert.equal(locked.status, 429, '5번 틀리면 맞는 비밀번호도 15분 막음');
  assert.equal((await handle(req('POST', { action: 'login', password: 'abcd1234!' }, { 'x-real-ip': '9.9.9.9' }))).status, 200, '다른 IP는 영향 없음');
  t += 16 * 60e3;

  assert.equal((await handle(req('POST', { action: 'login', password: 'abcd1234!' }, { origin: 'https://evil.example' }))).status, 403, '다른 사이트에서 온 로그인 거부');
  const ok = await handle(req('POST', { action: 'login', password: 'abcd1234!' }));
  assert.equal(ok.status, 200);
  const setCookie = ok.headers.get('set-cookie');
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Strict/);
  assert.match(setCookie, /Secure/);
  const cookie = cookieFrom(ok);
  const withCookie = (extra = {}) => ({ cookie: `${SESSION_COOKIE}=${cookie}`, ...extra });
  assert.equal((await (await handle(req('GET', null, withCookie()))).json()).loggedIn, true);

  // 로그인 쿠키로 구독자 관리 API — 토큰은 빼고 내보냄, 다른 사이트에서 온 쓰기 요청은 거부
  await store.put('subs/' + 'c'.repeat(32) + '.json', { id: 'c'.repeat(32), email: 'x@y.co', status: 'confirmed', token: 'secret-token' });
  const admin = createHandlers(store, ENV, () => t, { authorize: async r => (await adminAuth(r, store, ENV, t)) === 'session' });
  const list = await admin.admin(new Request(`${SITE}/api/admin`, { headers: withCookie() }));
  assert.equal(list.status, 200);
  assert.equal((await list.json()).subscribers[0].token, undefined, '로그인 사용자에게 토큰을 보내지 않음');
  assert.equal((await admin.admin(new Request(`${SITE}/api/admin`))).status, 401);
  const csrf = await admin.admin(new Request(`${SITE}/api/admin`, { method: 'POST', headers: withCookie({ origin: 'https://evil.example', 'Content-Type': 'application/json' }), body: JSON.stringify({ action: 'delete', id: 'c'.repeat(32) }) }));
  assert.equal(csrf.status, 401, '다른 사이트에서 온 삭제 요청 거부');
  assert.equal(store.map.size >= 2, true);

  assert.equal((await handle(req('POST', { action: 'change', current: 'wrong-pass', next: 'newpass-5678' }, withCookie()))).status, 403);
  const changed = await handle(req('POST', { action: 'change', current: 'abcd1234!', next: 'newpass-5678' }, withCookie()));
  assert.equal(changed.status, 200);
  assert.equal((await (await handle(req('GET', null, withCookie()))).json()).loggedIn, false, '바꾸기 전 쿠키는 풀림');
  const newCookie = cookieFrom(changed);
  assert.equal((await (await handle(req('GET', null, { cookie: `${SESSION_COOKIE}=${newCookie}` }))).json()).loggedIn, true, '바꾼 뒤 받은 쿠키로 계속 로그인');
  assert.equal((await handle(req('POST', { action: 'login', password: 'newpass-5678' }))).status, 200);

  const out = await handle(req('POST', { action: 'logout' }));
  assert.match(out.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal((await handle(req('POST', { action: 'clear' }, keyH))).status, 200);
  assert.equal(store.map.has(PASSWORD_PATH), false);
});
