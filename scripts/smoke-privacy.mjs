// 개인정보·비밀값이 새지 않는지 — **배포될 파일과 서버 코드를 직접 열어 봅니다**(T014).
//   node --test scripts/smoke-privacy.mjs
//
// 공개 고지문(legal.html 「개인정보처리방침」)이 말하는 것이 코드에서도 사실이어야 합니다.
// 고지문은 사람이 쓰고 코드는 따로 자라므로, 둘이 어긋나는 순간을 잡는 것이 이 테스트의 일입니다.
// 자세한 점검 기록은 security/privacy-checklist.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { areaKind } from '../site/public/api/_stats.mjs';
import { idKey, mailKey } from '../site/public/api/_ratelimit.mjs';
import { memberId, displayName } from '../site/public/api/_community.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUB = path.join(ROOT, 'site', 'public');
const api = f => fs.readFileSync(path.join(PUB, 'api', f), 'utf8');

const walk = (dir, acc = []) => {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p, acc); }
    else acc.push(p);
  }
  return acc;
};

// 고지문 — 「접속 주소(IP)도 브라우저 정보(User-Agent)도 저장하지 않아, 한 사람이 몇 번 왔는지는 알 수 없습니다」
test('방문 집계는 개인을 식별할 값을 담지 않는다', () => {
  const s = api('_stats.mjs');
  assert.ok(!/x-forwarded-for|x-real-ip|user-?agent/i.test(s), '집계 코드가 IP·User-Agent 를 보면 안 됩니다');
  // 담는 값이 무엇인지도 고정해 둡니다 — 나중에 한 줄 늘어나는 것이 가장 흔한 사고입니다
  const hit = api('community.mjs').match(/const hit = \{[^}]*\}/s);
  assert.ok(hit, 'community.mjs 에서 방문 기록을 만드는 자리를 찾지 못했습니다');
  // `{ day: dayKey(), ref, utm: ... }` 처럼 **이름만 적는 줄임표기**도 세야 합니다
  const inner = hit[0].replace(/^const hit = \{/, '').replace(/\}$/, '');
  const keys = inner.split(',').map(x => x.trim().split(':')[0].trim()).filter(Boolean).sort();
  assert.deepEqual(keys, ['area', 'day', 'device', 'ref', 'utm'],
    `방문 기록에 담는 값이 달라졌습니다: ${keys.join(', ')} — 고지문(legal.html)도 함께 고쳐야 합니다`);
  assert.equal(areaKind(''), '기타', '주소를 모르면 첫화면으로 세지 않습니다');
});

// 고지문 — 「접속 주소(IP)·메일 주소의 해시값」
test('남용 방지는 IP·메일을 해시로만 센다', () => {
  const k1 = idKey('login', 'ip', '1.2.3.4');
  assert.ok(!k1.includes('1.2.3.4'), '열쇠에 IP 원문이 들어가면 안 됩니다');
  assert.match(k1, /^login:ip:[0-9a-f]{16}$/);
  const k2 = mailKey('sub', 'Me@KCH.co.kr');
  assert.ok(!/kch/i.test(k2), '열쇠에 메일 원문이 들어가면 안 됩니다');
  assert.equal(mailKey('sub', 'me@kch.co.kr'), k2, '대소문자가 달라도 같은 사람으로 셉니다');
});

// 고지문 — 커뮤니티는 메일을 알아볼 수 없게 두고, 표시 이름은 가립니다
test('커뮤니티는 메일을 그대로 보여 주지 않는다', () => {
  const id = memberId('me@kch.co.kr', 'salt');
  assert.match(id, /^[0-9a-f]{24}$/);
  assert.ok(!id.includes('kch'), '해시여야 합니다');
  const shown = displayName('', 'myname@kch.co.kr');
  assert.ok(!shown.includes('@'), `표시 이름에 메일이 드러나면 안 됩니다: ${shown}`);
  assert.ok(!shown.includes('myname'), `메일 앞부분이 그대로 보이면 안 됩니다: ${shown}`);
});

// 로그를 아예 못 쓰게 하면 장애를 못 봅니다. 그래서 **무엇을 찍느냐**를 봅니다.
// 서버 코드의 console 호출은 전부 오류 메시지(e.message)뿐이어야 하고,
// 메일 서버가 돌려주는 메시지에는 받는 사람 주소가 섞여 오므로 **메일 실패 로그는 가려서** 찍어야 합니다.
test('서버 로그에 개인정보가 섞이지 않는다', () => {
  const files = fs.readdirSync(path.join(PUB, 'api')).filter(f => f.endsWith('.mjs'));
  const bad = [];
  for (const f of files) {
    for (const m of api(f).matchAll(/console\.\w+\(([^;]*?)\);/gs)) {
      const arg = m[1];
      if (/\b(email|mail(To|Addr)?|address|recipient|to)\b\s*[,)]/i.test(arg) && !/scrub\(/.test(arg)) bad.push(`${f}: ${arg.trim().slice(0, 60)}`);
      if (/메일 (발송|실패|전송)|확인 메일/.test(arg) && /e\.message/.test(arg) && !/scrub\(/.test(arg)) {
        bad.push(`${f}: 메일 실패 로그를 가리지 않았습니다 — ${arg.trim().slice(0, 50)}`);
      }
    }
  }
  assert.deepEqual(bad, [], `로그에 메일 주소가 남을 수 있습니다:\n  ${bad.join('\n  ')}`);
});

test('가림 함수가 실제로 메일 주소를 지운다', async () => {
  const { scrub } = await import('../site/public/api/_core.mjs');
  const out = scrub('550 5.1.1 <someone@example.com> User unknown');
  assert.ok(!out.includes('someone@example.com'), `가려지지 않았습니다: ${out}`);
  assert.ok(out.includes('User unknown'), '오류 내용은 남아야 고칠 수 있습니다');
  assert.equal(scrub(null), '');
});

test('배포 폴더에 비밀값 모양이 없다', () => {
  const files = walk(PUB).filter(p => /\.(mjs|js|html|json|css)$/.test(p));
  const bad = [];
  for (const p of files) {
    const s = fs.readFileSync(p, 'utf8');
    if (/serviceKey=[A-Za-z0-9%+/]{20,}/.test(s)) bad.push(`${path.relative(PUB, p)} (serviceKey)`);
    if (/(apiKey|api_key|secret|password|token)["']?\s*[:=]\s*["'][A-Za-z0-9%+/_-]{24,}["']/i.test(s)) bad.push(`${path.relative(PUB, p)} (키 대입)`);
  }
  assert.deepEqual(bad, [], `배포될 파일에 비밀값이 들어 있습니다: ${bad.join(', ')}`);
});

test('관리자 문은 잠겨 있다', () => {
  const a = api('_auth.mjs');
  assert.match(a, /scrypt/, '비밀번호는 해시로만');
  assert.match(a, /HttpOnly/i, '세션 쿠키는 스크립트가 읽지 못하게');
  assert.match(a, /timingSafeEqual/, '서명 비교는 시간 차가 나지 않게');
  assert.ok(/IP_LIMIT\s*=\s*\d+/.test(a) && /LOCK_MS/.test(a), '무차별 대입 잠금이 있어야');
});

test('구독자는 스스로 끊을 수 있다', () => {
  const m = api('_mail.mjs');
  assert.match(m, /unsubscribe/, '모든 메일에 수신 거부 링크');
  assert.match(m, /token=\$\{r\.token\}/, '토큰 없이는 남의 구독을 해지할 수 없어야');
  const job = api('_job.mjs');
  assert.match(job, /PENDING_TTL_MS\s*=\s*7 \* 24/, '7일 지난 미확인 신청은 자동 삭제');
});
