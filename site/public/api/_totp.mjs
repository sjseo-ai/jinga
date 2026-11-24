// 관리자 2단계 인증(TOTP) — 구글 OTP·Authy 같은 앱이 보여 주는 6자리 숫자(RFC 6238).
//
// 왜 직접 만드는가 — 쓰는 알고리즘이 HMAC-SHA1 하나뿐이고 node:crypto 에 이미 있습니다.
// 이걸 위해 바깥 꾸러미를 들이면 **메일을 보내는 서버에 남의 코드가 하나 더** 들어옵니다.
// 지난주 nodemailer 에서 겪었듯 그 코드는 언젠가 취약점을 들고 옵니다. 40줄이면 되는 일에 그럴 이유가 없습니다.
//
// 지키는 것
//   · 비밀값은 **Blob 비공개 저장소에만** 둡니다. 화면에는 설정할 때 한 번만 보여 줍니다.
//   · 시계가 조금 어긋나도 되게 **앞뒤 한 칸(±30초)**까지 받습니다. 그 이상은 받지 않습니다.
//   · **한 번 쓴 코드는 다시 못 씁니다**(어깨너머로 본 사람이 30초 안에 따라 들어오는 것을 막습니다).
//   · 코드를 맞춰 보는 것도 횟수를 셉니다 — 6자리는 100만 가지뿐이라, 막지 않으면 결국 뚫립니다.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const TOTP_PATH = 'admin/totp.json';
export const STEP_S = 30;          // 코드가 바뀌는 간격
export const DIGITS = 6;
export const WINDOW = 1;           // 앞뒤로 허용하는 칸 수(±30초)

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** 사람이 손으로 옮겨 적을 수 있게 base32 로 — 비밀값 20바이트(160비트) */
export function newSecret(bytes = randomBytes(20)) {
  let bits = '', out = '';
  for (const b of bytes) bits += b.toString(2).padStart(8, '0');
  for (let i = 0; i + 5 <= bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5), 2)];
  return out;
}

export function fromBase32(secret) {
  const clean = String(secret || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = '';
  for (const c of clean) bits += B32.indexOf(c).toString(2).padStart(5, '0');
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

/** 한 칸(counter)의 코드 */
export function codeFor(secret, counter) {
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const mac = createHmac('sha1', fromBase32(secret)).update(buf).digest();
  const off = mac[mac.length - 1] & 0x0f;
  const num = ((mac[off] & 0x7f) << 24) | (mac[off + 1] << 16) | (mac[off + 2] << 8) | mac[off + 3];
  return String(num % 10 ** DIGITS).padStart(DIGITS, '0');
}

export const counterAt = (nowMs, step = STEP_S) => Math.floor(nowMs / 1000 / step);

/**
 * 코드가 맞는가 → 맞으면 그 칸 번호, 아니면 null.
 * `usedCounter` 를 넘기면 **이미 쓴 칸은 거절**합니다(같은 코드 재사용 방지).
 * 숫자 비교도 시간 차가 나지 않게 맞춥니다.
 */
export function verifyCode(secret, input, { nowMs = Date.now(), window = WINDOW, usedCounter = null } = {}) {
  const given = String(input || '').replace(/\D/g, '');
  if (given.length !== DIGITS || !secret) return null;
  const now = counterAt(nowMs);
  for (let d = -window; d <= window; d++) {
    const c = now + d;
    const expect = codeFor(secret, c);
    const a = Buffer.from(expect), b = Buffer.from(given);
    if (a.length === b.length && timingSafeEqual(a, b)) {
      if (usedCounter != null && c <= usedCounter) return null;    // 썼던 코드는 다시 못 씁니다
      return c;
    }
  }
  return null;
}

/** 인증 앱에 넣을 주소 — QR 로 만들거나 손으로 비밀값을 옮겨 적습니다 */
export const otpauthUrl = (secret, account = 'admin', issuer = '진가 JINGA') =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`
  + `?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_S}`;

/**
 * 인증 앱을 잃어버렸을 때 쓰는 **백업 코드** 10개.
 * 저장은 해시로만 — 종이에 적어 둔 쪽이 원본입니다. 한 번 쓰면 지웁니다.
 */
export function newBackupCodes(n = 10) {
  const codes = Array.from({ length: n }, () => randomBytes(5).toString('hex').toUpperCase().replace(/(.{5})/, '$1-'));
  return codes;
}
export const hashBackup = (code, salt) =>
  createHmac('sha256', String(salt)).update(String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '')).digest('hex').slice(0, 32);

/** 백업 코드 확인 → 맞으면 남은 해시 목록(그 코드는 빠짐), 아니면 null */
export function useBackup(code, { hashes = [], salt = '' }) {
  const h = hashBackup(code, salt);
  const i = hashes.indexOf(h);
  if (i < 0) return null;
  return hashes.filter((_, j) => j !== i);
}
