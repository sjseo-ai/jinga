// 관리자 로그인 — 사용자가 직접 정한 비밀번호(서버에는 scrypt 해시만) → HttpOnly 세션 쿠키
//   비밀번호 기록: Blob admin/password.json { algo:'scrypt', N, r, p, salt, hash, updatedAt }
//   세션: v1.<만료초>.<난수>.<서명> — 서명 키는 JINGA_ADMIN_SECRET + 비밀번호 기록(바꾸면 모든 세션이 풀림), 12시간
//   무차별 대입 방지: 같은 IP 15분 안 5번 틀리면 15분 잠금, 모든 IP 합쳐 15분 안 30번이면 전체 15분 잠금
// 운영 PC 스크립트(발송·관리 API)는 계속 관리 키(Authorization: Bearer JINGA_ADMIN_SECRET)로 들어옴
import { scrypt as scryptCb, randomBytes, createHmac, timingSafeEqual, createHash } from 'node:crypto';
// 2단계 인증(6자리 코드) — 구현은 _totp.mjs, 여기서는 쓰기만 합니다
import { TOTP_PATH, newSecret, verifyCode, otpauthUrl, newBackupCodes, hashBackup, useBackup } from './_totp.mjs';

export const PASSWORD_PATH = 'admin/password.json';
export const GUARD_PATH = 'admin/login-guard.json';
export const ACCESS_PATH = 'admin/access-log.json';
export const ACCESS_KEEP = 200;
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

/**
 * 접속 주소를 **원문으로 두지 않습니다.**
 * 잠금 횟수를 세려면 「같은 곳인지」만 알면 되고, 그 곳이 어디인지는 알 필요가 없습니다.
 * 2026-11-20 까지 잠금 기록(login-guard.json)이 IP 를 **열쇠 이름 그대로** 들고 있었습니다 —
 * 개인정보처리방침에는 「접속 주소는 해시값으로」라고 적어 두고 있었으므로, 고지문 쪽이 맞고 코드가 틀렸습니다.
 * 소금은 관리 키에서 가져옵니다(키가 없으면 세기만 하고 되돌릴 수 없는 값으로).
 */
export const ipKey = (ip, secret = '') =>
  createHash('sha256').update(`ip|${String(ip || '').trim().toLowerCase()}|${secret}`).digest('hex').slice(0, 16);

/**
 * 관리자 문을 누가 두드렸는지 남깁니다(최근 200건만).
 * 남기는 것: 시각 · 무엇을(로그인·비밀번호 변경·로그아웃) · 됐는지 · 접속 주소의 **해시**.
 * 남기지 않는 것: IP 원문, 비밀번호, 세션 토큰.
 * 왜 — 누가 언제 들어왔는지 모르면, 들어온 적이 있는지도 모릅니다.
 */
export async function recordAccess(store, { kind, ok, ip, note = '', at = Date.now() }, keep = ACCESS_KEEP) {
  try {
    const log = (await store.get(ACCESS_PATH)) || { items: [] };
    const row = { at: new Date(at).toISOString(), kind, ok: !!ok, ip, ...(note ? { note } : {}) };
    await store.put(ACCESS_PATH, { items: [row, ...(log.items || [])].slice(0, keep) });
  } catch { /* 기록이 실패해도 로그인은 막지 않습니다 — 문을 잠그는 것이 기록보다 먼저입니다 */ }
}

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
    const ipRaw = clientIp(request);
    const ip = ipKey(ipRaw, env.JINGA_ADMIN_SECRET || '');   // 원문은 들고 다니지 않습니다(위 ipKey 주석)

    if (body.action === 'login') {
      if (!rec) return json({ ok: false, error: '관리자 비밀번호가 아직 정해지지 않았습니다. 운영 PC에서 scripts\\admin-password.cmd 로 정해 주세요.' }, 409);
      if (!sameOrigin(request)) return json({ ok: false, error: 'origin' }, 403);
      const g = await guard.load();
      const wait = guard.lockedFor(g, ip, t);
      if (wait) {
        await recordAccess(store, { kind: 'login', ok: false, ip, at: t, note: '잠금 중 시도' });
        return json({ ok: false, error: `로그인 시도가 너무 많아 잠시 막았습니다. ${Math.ceil(wait / 60)}분 뒤에 다시 시도하세요.` }, 429, { 'Retry-After': String(wait) });
      }
      if (!(await verifyPassword(body.password, rec))) {
        const e = await guard.fail(g, ip, t);
        const left = e.lockUntil ? 0 : IP_LIMIT - e.n;
        await recordAccess(store, { kind: 'login', ok: false, ip, at: t, note: e.lockUntil ? '15분 잠금' : `${left}번 남음` });
        return json({ ok: false, error: left ? `비밀번호가 맞지 않습니다. (${left}번 더 틀리면 15분 잠금)` : '비밀번호가 여러 번 틀려 15분 동안 잠갔습니다.' }, 401);
      }
      // ── 2단계 인증 ──────────────────────────────────────────────────────
      // 비밀번호가 맞아도 여기서 한 번 더 막습니다. 비밀번호 하나가 새면 그대로 들어오던 것을
      // 인증 앱의 6자리(30초마다 바뀜)로 한 겹 더 두른 것입니다.
      // **틀린 코드도 잠금 횟수에 넣습니다** — 6자리는 100만 가지뿐이라 그냥 두면 결국 맞힙니다.
      const totp = (await store.get(TOTP_PATH).catch(() => null)) || null;
      if (totp && totp.enabled) {
        const given = String(body.code || '').trim();
        if (!given) return json({ ok: false, error: '인증 앱의 6자리 숫자를 입력하세요', need: 'code' }, 401);
        const used = verifyCode(totp.secret, given, { nowMs: t, usedCounter: totp.usedCounter ?? null });
        const backupLeft = used == null && totp.backup ? useBackup(given, totp.backup) : null;
        if (used == null && !backupLeft) {
          const e = await guard.fail(g, ip, t);
          await recordAccess(store, { kind: 'login', ok: false, ip, at: t, note: '2단계 코드 불일치' });
          return json({ ok: false, error: e.lockUntil ? '여러 번 틀려 15분 동안 잠갔습니다.' : '인증 코드가 맞지 않습니다.', need: 'code' }, 401);
        }
        await store.put(TOTP_PATH, backupLeft
          ? { ...totp, backup: { ...totp.backup, hashes: backupLeft } }
          : { ...totp, usedCounter: used });
        if (backupLeft) {
          await recordAccess(store, { kind: 'login', ok: true, ip, at: t, note: `백업 코드 사용(남은 ${backupLeft.length}개)` });
          if (g[ip]) { delete g[ip]; await store.put(GUARD_PATH, g); }
          return json({ ok: true, usedBackup: true, backupLeft: backupLeft.length }, 200,
            { 'Set-Cookie': sessionCookie(makeSession(env.JINGA_ADMIN_SECRET, rec, t)) });
        }
      }

      if (g[ip]) { delete g[ip]; await store.put(GUARD_PATH, g); }
      await recordAccess(store, { kind: 'login', ok: true, ip, at: t, note: totp && totp.enabled ? '2단계 통과' : '' });
      return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(makeSession(env.JINGA_ADMIN_SECRET, rec, t)) });
    }

    if (body.action === 'logout') {
      await recordAccess(store, { kind: 'logout', ok: true, ip, at: t });
      return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie('', 0) });
    }

    if (body.action === 'change') {
      if ((await adminAuth(request, store, env, t)) !== 'session') return json({ ok: false, error: '로그인이 필요합니다' }, 401);
      if (!(await verifyPassword(body.current, rec))) return json({ ok: false, error: '지금 비밀번호가 맞지 않습니다' }, 403);
      const problem = passwordProblem(body.next);
      if (problem) return json({ ok: false, error: problem }, 400);
      const next = await hashPassword(body.next, t);
      await store.put(PASSWORD_PATH, next);
      await recordAccess(store, { kind: 'change', ok: true, ip, at: t, note: '비밀번호 변경 — 기존 세션 모두 해제' });
      return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(makeSession(env.JINGA_ADMIN_SECRET, next, t)) });
    }

    // ── 2단계 인증 설정 ────────────────────────────────────────────────────
    // 켜는 순서: totp-setup(비밀값·백업 코드를 받아 인증 앱에 넣음) → totp-enable(코드로 확인) → 켜짐.
    // **확인을 받기 전에는 켜지지 않습니다.** 바로 켜면 앱 등록에 실패했을 때 자기 집 문을 잠그고 열쇠를 잃습니다.
    if (body.action === 'totp-setup') {
      if ((await adminAuth(request, store, env, t)) !== 'session') return json({ ok: false, error: '로그인이 필요합니다' }, 401);
      const secret = newSecret();
      const codes = newBackupCodes();
      const salt = randomBytes(16).toString('hex');
      await store.put(TOTP_PATH, { enabled: false, pending: { secret, backup: { salt, hashes: codes.map(c => hashBackup(c, salt)) } }, updatedAt: new Date(t).toISOString() });
      // 비밀값과 백업 코드를 **이 응답에서 한 번만** 보여 줍니다. 저장소에는 해시만 남습니다.
      return json({ ok: true, secret, url: otpauthUrl(secret, 'admin'), backupCodes: codes });
    }

    if (body.action === 'totp-enable') {
      if ((await adminAuth(request, store, env, t)) !== 'session') return json({ ok: false, error: '로그인이 필요합니다' }, 401);
      const cur = (await store.get(TOTP_PATH).catch(() => null)) || null;
      if (!cur || !cur.pending) return json({ ok: false, error: '먼저 설정을 시작하세요' }, 409);
      const used = verifyCode(cur.pending.secret, body.code, { nowMs: t });
      if (used == null) return json({ ok: false, error: '코드가 맞지 않습니다. 앱의 숫자가 바뀌기 전에 입력해 보세요.' }, 400);
      await store.put(TOTP_PATH, { enabled: true, secret: cur.pending.secret, backup: cur.pending.backup, usedCounter: used, updatedAt: new Date(t).toISOString() });
      await recordAccess(store, { kind: 'totp', ok: true, ip, at: t, note: '2단계 인증 켬' });
      return json({ ok: true });
    }

    if (body.action === 'totp-disable') {
      if ((await adminAuth(request, store, env, t)) !== 'session') return json({ ok: false, error: '로그인이 필요합니다' }, 401);
      // 끄는 데도 비밀번호를 다시 받습니다 — 남이 내 화면을 잠깐 쓰는 동안 꺼 버리지 못하게.
      if (!rec || !(await verifyPassword(body.password, rec))) return json({ ok: false, error: '비밀번호가 맞지 않습니다' }, 403);
      await store.put(TOTP_PATH, { enabled: false, updatedAt: new Date(t).toISOString() });
      await recordAccess(store, { kind: 'totp', ok: true, ip, at: t, note: '2단계 인증 끔' });
      return json({ ok: true });
    }

    if (body.action === 'totp-status') {
      if (!(await adminAuth(request, store, env, t))) return json({ ok: false, error: '로그인이 필요합니다' }, 401);
      const cur = (await store.get(TOTP_PATH).catch(() => null)) || null;
      return json({ ok: true, enabled: !!(cur && cur.enabled), backupLeft: (cur && cur.backup && cur.backup.hashes.length) || 0 });
    }

    // 관리자 접근 기록 보기 — 로그인한 사람만. 「내가 안 한 로그인이 있나」를 보는 자리입니다.
    if (body.action === 'access-log') {
      if (!(await adminAuth(request, store, env, t))) return json({ ok: false, error: '로그인이 필요합니다' }, 401);
      const log = (await store.get(ACCESS_PATH)) || { items: [] };
      return json({ ok: true, items: (log.items || []).slice(0, Math.min(Number(body.limit) || 50, ACCESS_KEEP)) });
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
