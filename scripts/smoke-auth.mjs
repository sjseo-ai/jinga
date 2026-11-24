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

// ── 접근 기록·주소 가림 (T014, 2026-11-20) ──────────────────────────────────
// 「누가 언제 들어왔는지 모르면, 들어온 적이 있는지도 모릅니다.」
import { ipKey, recordAccess, ACCESS_PATH, ACCESS_KEEP } from '../site/public/api/_auth.mjs';

test('잠금 기록에 접속 주소를 원문으로 두지 않는다', async () => {
  const store = memStore();
  const login = createAdminLogin(store, { JINGA_ADMIN_SECRET: 'k' }, () => Date.now());
  await store.put(PASSWORD_PATH, await hashPassword('right-password-1'));
  const req = (body, ip) => new Request('https://jinga.example/api/admin-login', {
    method: 'POST', headers: { 'Content-Type': 'application/json', origin: 'https://jinga.example', 'x-real-ip': ip },
    body: JSON.stringify(body),
  });
  await login(req({ action: 'login', password: '틀린비밀번호' }, '203.0.113.9'));
  const guard = await store.get('admin/login-guard.json');
  const keys = Object.keys(guard).filter(k => k !== '*');
  assert.ok(keys.length, '실패를 세기는 해야 합니다');
  assert.ok(!keys.some(k => k.includes('203.0.113.9')), `잠금 기록에 IP 원문이 있습니다: ${keys.join(', ')}`);
  assert.ok(keys.every(k => /^[0-9a-f]{16}$/.test(k)), '해시 열쇠여야 합니다');
  // 소금이 다르면 다른 열쇠 — 기록만으로 원래 주소를 되찾을 수 없습니다
  assert.notEqual(ipKey('203.0.113.9', 'a'), ipKey('203.0.113.9', 'b'));
});

test('관리자 접근 기록이 남고, 로그인한 사람만 볼 수 있다', async () => {
  const store = memStore();
  const env = { JINGA_ADMIN_SECRET: 'k' };
  const login = createAdminLogin(store, env, () => Date.now());
  await store.put(PASSWORD_PATH, await hashPassword('right-password-1'));
  const req = (body, extra = {}) => new Request('https://jinga.example/api/admin-login', {
    method: 'POST', headers: { 'Content-Type': 'application/json', origin: 'https://jinga.example', 'x-real-ip': '203.0.113.9', ...extra },
    body: JSON.stringify(body),
  });

  await login(req({ action: 'login', password: '틀림' }));
  const ok = await login(req({ action: 'login', password: 'right-password-1' }));
  const cookie = ok.headers.get('Set-Cookie').split(';')[0];

  const log = await store.get(ACCESS_PATH);
  assert.equal(log.items.length, 2, '실패와 성공이 모두 남아야');
  assert.equal(log.items[0].ok, true, '최근 것이 앞');
  assert.equal(log.items[1].ok, false);
  assert.ok(/^[0-9a-f]{16}$/.test(log.items[0].ip), '주소는 해시로만');
  assert.ok(!JSON.stringify(log).includes('203.0.113.9'), '기록 어디에도 IP 원문이 없어야');
  assert.ok(!JSON.stringify(log).includes('right-password-1'), '비밀번호가 들어가면 안 됩니다');

  // 로그인 없이 기록을 보려 하면 거절
  const denied = await login(req({ action: 'access-log' }));
  assert.equal(denied.status, 401);
  const seen = await (await login(req({ action: 'access-log' }, { cookie }))).json();
  assert.equal(seen.ok, true);
  assert.equal(seen.items.length, 2);
});

test('기록은 최근 것만 남긴다 — 무한히 쌓이지 않게', async () => {
  const store = memStore();
  for (let i = 0; i < 5; i++) await recordAccess(store, { kind: 'login', ok: true, ip: 'x' }, 3);
  assert.equal((await store.get(ACCESS_PATH)).items.length, 3);
  assert.equal(ACCESS_KEEP, 200);
});

// ── 2단계 인증 (T014, 2026-11-23) ───────────────────────────────────────────
import { TOTP_PATH, codeFor, counterAt } from '../site/public/api/_totp.mjs';

const loginEnv = { JINGA_ADMIN_SECRET: 'k' };
const post = (body, extra = {}) => new Request('https://jinga.example/api/admin-login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', origin: 'https://jinga.example', 'x-real-ip': '198.51.100.7', ...extra },
  body: JSON.stringify(body),
});

async function loggedIn(store) {
  const login = createAdminLogin(store, loginEnv, () => Date.now());
  await store.put(PASSWORD_PATH, await hashPassword('right-password-1'));
  const r = await login(post({ action: 'login', password: 'right-password-1' }));
  return { login, cookie: r.headers.get('Set-Cookie').split(';')[0] };
}

test('2단계 인증은 코드로 확인하기 전에는 켜지지 않는다', async () => {
  const store = memStore();
  const { login, cookie } = await loggedIn(store);

  const setup = await (await login(post({ action: 'totp-setup' }, { cookie }))).json();
  assert.match(setup.secret, /^[A-Z2-7]{32}$/);
  assert.match(setup.url, /^otpauth:\/\/totp\//);
  assert.equal(setup.backupCodes.length, 10);
  assert.equal((await store.get(TOTP_PATH)).enabled, false, '설정만 해서는 켜지지 않습니다');
  // 저장소에는 백업 코드 원문이 없어야 합니다
  assert.ok(!JSON.stringify(await store.get(TOTP_PATH)).includes(setup.backupCodes[0].replace('-', '')), '백업 코드는 해시로만');

  const bad = await login(post({ action: 'totp-enable', code: '000000' }, { cookie }));
  assert.equal(bad.status, 400);
  assert.equal((await store.get(TOTP_PATH)).enabled, false);

  const good = await login(post({ action: 'totp-enable', code: codeFor(setup.secret, counterAt(Date.now())) }, { cookie }));
  assert.equal(good.status, 200);
  assert.equal((await store.get(TOTP_PATH)).enabled, true);
  return setup;
});

test('켜 두면 비밀번호만으로는 못 들어온다', async () => {
  const store = memStore();
  const { login, cookie } = await loggedIn(store);
  const setup = await (await login(post({ action: 'totp-setup' }, { cookie }))).json();
  await login(post({ action: 'totp-enable', code: codeFor(setup.secret, counterAt(Date.now())) }, { cookie }));

  const only = await login(post({ action: 'login', password: 'right-password-1' }));
  assert.equal(only.status, 401, '비밀번호가 맞아도 막아야');
  assert.equal((await only.json()).need, 'code', '화면이 코드 칸을 띄울 수 있게 알려 줍니다');

  const wrong = await login(post({ action: 'login', password: 'right-password-1', code: '000000' }));
  assert.equal(wrong.status, 401);

  // 켤 때 쓴 코드는 이미 「쓴 것」이라 로그인에 다시 쓰이지 않습니다 — 다음 칸 코드로 들어갑니다.
  const code = codeFor(setup.secret, counterAt(Date.now()) + 1);
  const ok = await login(post({ action: 'login', password: 'right-password-1', code }));
  assert.equal(ok.status, 200);
  assert.ok(ok.headers.get('Set-Cookie'), '세션이 나와야');

  // 같은 코드를 또 쓰면 거절 — 어깨너머로 본 사람이 따라 들어오지 못하게
  const replay = await login(post({ action: 'login', password: 'right-password-1', code }));
  assert.equal(replay.status, 401, '한 번 쓴 코드는 다시 못 씁니다');
});

test('인증 앱을 잃어버려도 백업 코드로 들어온다 — 한 번만', async () => {
  const store = memStore();
  const { login, cookie } = await loggedIn(store);
  const setup = await (await login(post({ action: 'totp-setup' }, { cookie }))).json();
  await login(post({ action: 'totp-enable', code: codeFor(setup.secret, counterAt(Date.now())) }, { cookie }));

  const r = await login(post({ action: 'login', password: 'right-password-1', code: setup.backupCodes[0] }));
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.usedBackup, true);
  assert.equal(j.backupLeft, 9);

  const again = await login(post({ action: 'login', password: 'right-password-1', code: setup.backupCodes[0] }));
  assert.equal(again.status, 401, '쓴 백업 코드는 다시 못 씁니다');
});

test('끄려면 비밀번호를 다시 받는다 — 남이 내 화면을 잠깐 쓰는 동안 꺼 버리지 못하게', async () => {
  const store = memStore();
  const { login, cookie } = await loggedIn(store);
  const setup = await (await login(post({ action: 'totp-setup' }, { cookie }))).json();
  await login(post({ action: 'totp-enable', code: codeFor(setup.secret, counterAt(Date.now())) }, { cookie }));

  assert.equal((await login(post({ action: 'totp-disable' }, { cookie }))).status, 403, '비밀번호 없이는 못 끕니다');
  assert.equal((await login(post({ action: 'totp-disable', password: '틀림' }, { cookie }))).status, 403);
  assert.equal((await login(post({ action: 'totp-disable', password: 'right-password-1' }, { cookie }))).status, 200);
  assert.equal((await store.get(TOTP_PATH)).enabled, false);

  // 로그인 없이 설정을 건드리려 하면 전부 거절
  assert.equal((await login(post({ action: 'totp-setup' }))).status, 401);
  assert.equal((await login(post({ action: 'totp-status' }))).status, 401);
});
