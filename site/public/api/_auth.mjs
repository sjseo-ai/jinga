// 관리자 로그인 — 사용자가 직접 정한 비밀번호(서버에는 scrypt 해시만) → HttpOnly 세션 쿠키
//   비밀번호 기록: Blob admin/password.json { algo:'scrypt', N, r, p, salt, hash, updatedAt }
//   세션: v1.<만료초>.<난수>.<서명> — 서명 키는 JINGA_ADMIN_SECRET + 비밀번호 기록(바꾸면 모든 세션이 풀림), 12시간
//   무차별 대입 방지: 같은 IP 15분 안 5번 틀리면 15분 잠금, 모든 IP 합쳐 15분 안 30번이면 전체 15분 잠금
// 운영 PC 스크립트(발송·관리 API)는 계속 관리 키(Authorization: Bearer JINGA_ADMIN_SECRET)로 들어옴
import { scrypt as scryptCb, randomBytes, createHmac, timingSafeEqual } from 'node:crypto';

export const PASSWORD_PATH = 'admin/password.json';
export const GUARD_PATH = 'admin/login-guard.json';
export const SESSION_COOKIE = 'jinga_admin';
export const SESSION_TTL_S = 12 * 3600;
export const MIN_PASSWORD = 8;
const KDF = { N: 16384, r: 8, p: 1, keylen: 32 };
const FAIL_WINDOW_MS = 15 * 60e3, LOCK_MS = 15 * 60e3, IP_LIMIT = 5, GLOBAL_LIMIT = 30;

const scrypt = (pw, salt, keylen, opts) => new Promise((resolve, reject) =>
  scryptCb(pw, salt, keylen, { ...opts, maxmem: 64 * 1024 * 1024 }, (e, key) => (e ? reject(e) : resolve(key))));
const b64u = buf => Buffer.from(buf).toString('base64url');
const sameBytes = (a, b) => a.length === b.length && timingSafeEqual(a, b);
const safeEq = (a, b) => sameBytes(Buffer.from(String(a || '')), Buffer.from(String(b || '')));

export function passwordProblem(pw) {
  const s = String(pw ?? '');
  if (s.length < MIN_PASSWORD) return `비밀번호는 ${MIN_PASSWORD}자 이상으로 정해 주세요`;
  if (s.length > 128) return '비밀번호는 128자 이하로 정해 주세요';
  return null;
}

export async function hashPassword(password, now = Date.now()) {
  const salt = randomBytes(16);
  const hash = await scrypt(String(password).normalize('NFC'), salt, KDF.keylen, { N: KDF.N, r: KDF.r, p: KDF.p });
  return { algo: 'scrypt', N: KDF.N, r: KDF.r, p: KDF.p, salt: salt.toString('base64'), hash: hash.toString('base64'), updatedAt: new Date(now).toISOString() };
}

export async function verifyPassword(password, rec) {
  if (!rec || rec.algo !== 'scrypt' || password == null) return false;
  const expected = Buffer.from(rec.hash, 'base64');
  const got = await scrypt(String(password).normalize('NFC'), Buffer.from(rec.salt, 'base64'), expected.length, { N: rec.N, r: rec.r, p: rec.p });
  return sameBytes(got, expected);
}

const sessionKey = (secret, rec) => createHmac('sha256', String(secret)).update(`jinga-admin-session|${rec.salt}|${rec.updatedAt}`).digest();

export function makeSession(secret, rec, nowMs = Date.now()) {
  const body = `v1.${Math.floor(nowMs / 1000) + SESSION_TTL_S}.${b64u(randomBytes(12))}`;
  return `${body}.${b64u(createHmac('sha256', sessionKey(secret, rec)).update(body).digest())}`;
}

export function verifySession(token, secret, rec, nowMs = Date.now()) {
  if (!token || !secret || !rec) return false;
  const parts = String(token).split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') return false;
  const exp = Number(parts[1]);
  if (!Number.isFinite(exp) || exp * 1000 <= nowMs) return false;
  const expect = b64u(createHmac('sha256', sessionKey(secret, rec)).update(parts.slice(0, 3).join('.')).digest());
  return safeEq(parts[3], expect);
}

export function readCookie(request, name) {
  for (const part of String(request.headers.get('cookie') || '').split(/;\s*/)) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i) === name) return decodeURIComponent(part.slice(i + 1));
  }
  return null;
}
export const sessionCookie = (token, maxAge = SESSION_TTL_S) => `${SESSION_COOKIE}=${token}; Path=/api; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;

// 쿠키로 들어온 쓰기 요청은 같은 사이트에서 온 것만(SameSite=Strict 에 더해 한 번 더)
function sameOrigin(request) {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  try {
    const o = new URL(origin).host;
    return [new URL(request.url).host, request.headers.get('x-forwarded-host'), request.headers.get('host')].filter(Boolean).includes(o);
  } catch { return false; }
}

/** 'key'(관리 키) | 'session'(로그인) | null */
export async function adminAuth(request, store, env = process.env, nowMs = Date.now()) {
  if (!env.JINGA_ADMIN_SECRET) return null;
  if (safeEq(request.headers.get('authorization'), `Bearer ${env.JINGA_ADMIN_SECRET}`)) return 'key';
  const token = readCookie(request, SESSION_COOKIE);
  if (!token || (request.method !== 'GET' && !sameOrigin(request))) return null;
  return verifySession(token, env.JINGA_ADMIN_SECRET, await store.get(PASSWORD_PATH), nowMs) ? 'session' : null;
}

const clientIp = request => String(request.headers.get('x-real-ip') || String(request.headers.get('x-forwarded-for') || '').split(',')[0] || 'unknown').trim().slice(0, 64);

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
});

/** api/admin-login 처리 — GET 상태 / POST { action: 'login'|'logout'|'change'|'set'|'clear' } */
export function createAdminLogin(store, env = process.env, now = () => Date.now()) {
  const guard = {
    async load() { return (await store.get(GUARD_PATH)) || {}; },
    lockedFor(g, ip, t) {
      const until = Math.max((g[ip] && g[ip].lockUntil) || 0, (g['*'] && g['*'].lockUntil) || 0);
      return until > t ? Math.ceil((until - t) / 1000) : 0;
    },
    bump(g, key, limit, t) {
      const e = g[key] && t - g[key].first < FAIL_WINDOW_MS ? g[key] : { n: 0, first: t };
      e.n++;
      if (e.n >= limit) { e.lockUntil = t + LOCK_MS; e.n = 0; e.first = t; }
      g[key] = e;
      return e;
    },
    async fail(g, ip, t) {
      for (const [k, v] of Object.entries(g)) if (t - v.first > 3600e3 && !(v.lockUntil > t)) delete g[k];
      const e = this.bump(g, ip, IP_LIMIT, t);
      this.bump(g, '*', GLOBAL_LIMIT, t);
      await store.put(GUARD_PATH, g);
      return e;
    },
  };

  return async function handle(request) {
    if (!env.JINGA_ADMIN_SECRET) return json({ ok: false, error: '관리 키가 설정되지 않았습니다' }, 503);
    const t = now();
    const rec = await store.get(PASSWORD_PATH);
    if (request.method === 'GET') {
      const who = await adminAuth(request, store, env, t);
      return json({ ok: true, passwordSet: !!rec, loggedIn: !!who });
    }
    if (request.method !== 'POST') return json({ ok: false, error: 'method' }, 405);
    const body = await request.json().catch(() => ({}));
    const ip = clientIp(request);

    if (body.action === 'login') {
      if (!rec) return json({ ok: false, error: '관리자 비밀번호가 아직 정해지지 않았습니다. 운영 PC에서 scripts\\admin-password.cmd 로 정해 주세요.' }, 409);
      if (!sameOrigin(request)) return json({ ok: false, error: 'origin' }, 403);
      const g = await guard.load();
      const wait = guard.lockedFor(g, ip, t);
      if (wait) return json({ ok: false, error: `로그인 시도가 너무 많아 잠시 막았습니다. ${Math.ceil(wait / 60)}분 뒤에 다시 시도하세요.` }, 429, { 'Retry-After': String(wait) });
      if (!(await verifyPassword(body.password, rec))) {
        const e = await guard.fail(g, ip, t);
        const left = e.lockUntil ? 0 : IP_LIMIT - e.n;
        return json({ ok: false, error: left ? `비밀번호가 맞지 않습니다. (${left}번 더 틀리면 15분 잠금)` : '비밀번호가 여러 번 틀려 15분 동안 잠갔습니다.' }, 401);
      }
      if (g[ip]) { delete g[ip]; await store.put(GUARD_PATH, g); }
      return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(makeSession(env.JINGA_ADMIN_SECRET, rec, t)) });
    }

    if (body.action === 'logout') return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie('', 0) });

    if (body.action === 'change') {
      if ((await adminAuth(request, store, env, t)) !== 'session') return json({ ok: false, error: '로그인이 필요합니다' }, 401);
      if (!(await verifyPassword(body.current, rec))) return json({ ok: false, error: '지금 비밀번호가 맞지 않습니다' }, 403);
      const problem = passwordProblem(body.next);
      if (problem) return json({ ok: false, error: problem }, 400);
      const next = await hashPassword(body.next, t);
      await store.put(PASSWORD_PATH, next);
      return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(makeSession(env.JINGA_ADMIN_SECRET, next, t)) });
    }

    // 운영 PC(scripts/admin-password.mjs) 전용 — 관리 키로 비밀번호를 새로 정하거나 지움
    if (body.action === 'set' || body.action === 'clear') {
      if ((await adminAuth(request, store, env, t)) !== 'key') return json({ ok: false, error: 'unauthorized' }, 401);
      if (body.action === 'clear') { await store.del(PASSWORD_PATH); return json({ ok: true }); }
      const problem = passwordProblem(body.password);
      if (problem) return json({ ok: false, error: problem }, 400);
      await store.put(PASSWORD_PATH, await hashPassword(body.password, t));
      await store.put(GUARD_PATH, {});
      return json({ ok: true });
    }
    return json({ ok: false, error: 'action' }, 400);
  };
}
