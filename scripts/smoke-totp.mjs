// 관리자 2단계 인증(site/public/api/_totp.mjs) 스모크 테스트.
import test from 'node:test';
import assert from 'node:assert/strict';
import { newSecret, fromBase32, codeFor, counterAt, verifyCode, otpauthUrl, newBackupCodes, hashBackup, useBackup, DIGITS, STEP_S } from '../site/public/api/_totp.mjs';

// RFC 6238 의 시험값 — 비밀값 "12345678901234567890"(ASCII)을 base32 로 적으면 아래와 같습니다.
// 남이 만든 코드가 아니라 **표준이 맞다고 적어 둔 값**과 맞춰 봐야 인증 앱과 같은 숫자가 나옵니다.
const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

test('표준 시험값과 같은 코드가 나온다', () => {
  assert.equal(fromBase32(RFC_SECRET).toString('ascii'), '12345678901234567890');
  // RFC 6238 Appendix B (SHA-1, 8자리) 의 59초·1111111109초 항목을 6자리로 줄인 값
  assert.equal(codeFor(RFC_SECRET, counterAt(59_000)), '287082');
  assert.equal(codeFor(RFC_SECRET, counterAt(1111111109_000)), '081804');
  assert.equal(codeFor(RFC_SECRET, counterAt(1234567890_000)), '005924');
});

test('비밀값은 사람이 옮겨 적을 수 있는 모양', () => {
  const s = newSecret();
  assert.match(s, /^[A-Z2-7]{32}$/, 'base32 32자(160비트)');
  assert.notEqual(newSecret(), newSecret(), '매번 달라야');
  assert.match(otpauthUrl(s, 'admin'), /^otpauth:\/\/totp\/.*secret=[A-Z2-7]{32}.*digits=6.*period=30/);
});

test('시계가 조금 어긋나도 받지만, 많이 어긋나면 안 받는다', () => {
  const s = newSecret();
  const now = 1764000000_000;
  assert.ok(verifyCode(s, codeFor(s, counterAt(now)), { nowMs: now }), '지금 코드');
  assert.ok(verifyCode(s, codeFor(s, counterAt(now) - 1), { nowMs: now }), '30초 전 코드도 받습니다');
  assert.ok(verifyCode(s, codeFor(s, counterAt(now) + 1), { nowMs: now }), '30초 뒤 코드도 받습니다');
  assert.equal(verifyCode(s, codeFor(s, counterAt(now) - 2), { nowMs: now }), null, '60초 전은 안 받습니다');
  assert.equal(verifyCode(s, '000000', { nowMs: now }), null);
  assert.equal(verifyCode(s, '12345', { nowMs: now }), null, `${DIGITS}자리가 아니면 거절`);
  assert.equal(verifyCode('', '123456', { nowMs: now }), null, '비밀값이 없으면 거절');
});

// 어깨너머로 코드를 본 사람이 30초 안에 따라 들어오는 것을 막습니다.
test('한 번 쓴 코드는 다시 못 쓴다', () => {
  const s = newSecret();
  const now = 1764000000_000;
  const c = counterAt(now);
  const used = verifyCode(s, codeFor(s, c), { nowMs: now });
  assert.equal(used, c);
  assert.equal(verifyCode(s, codeFor(s, c), { nowMs: now, usedCounter: used }), null, '같은 코드를 또 쓰면 거절');
  // 다음 칸은 됩니다
  assert.ok(verifyCode(s, codeFor(s, c + 1), { nowMs: now + STEP_S * 1000, usedCounter: used }));
});

test('백업 코드 — 해시로만 두고, 한 번 쓰면 사라진다', () => {
  const codes = newBackupCodes();
  assert.equal(codes.length, 10);
  assert.ok(codes.every(c => /^[0-9A-F]{5}-[0-9A-F]{5}$/.test(c)), `모양: ${codes[0]}`);

  const salt = 'salt';
  const hashes = codes.map(c => hashBackup(c, salt));
  assert.ok(!hashes.some(h => codes.some(c => h.includes(c.replace('-', '')))), '원문이 해시에 비치면 안 됩니다');

  const left = useBackup(codes[3], { hashes, salt });
  assert.equal(left.length, 9, '쓴 코드는 빠집니다');
  assert.equal(useBackup(codes[3], { hashes: left, salt }), null, '같은 코드를 또 쓰면 거절');
  assert.equal(useBackup('AAAAA-BBBBB', { hashes: left, salt }), null, '없는 코드는 거절');
  // 적을 때 줄표·소문자가 섞여도 받습니다
  assert.ok(useBackup(codes[0].toLowerCase().replace('-', ' '), { hashes, salt }));
});
