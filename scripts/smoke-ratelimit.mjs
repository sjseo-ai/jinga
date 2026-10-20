// 공개 API 남용 막기(_ratelimit.mjs) 스모크 테스트 — 가짜 저장소, 네트워크 없음
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLimiter, clientIp, mailKey, mailRules, idKey, RATE_PATH } from '../site/public/api/_ratelimit.mjs';

const fakeStore = (init = {}) => {
  const data = { ...init };
  return {
    data,
    get: async p => (p in data ? JSON.parse(JSON.stringify(data[p])) : null),
    put: async (p, v) => { data[p] = JSON.parse(JSON.stringify(v)); },
    del: async p => { delete data[p]; },
  };
};
const req = headers => ({ headers: { get: k => headers[k] || null } });

test('보내는 곳 알아내기 — 프록시 헤더 순서와 다듬기', () => {
  assert.equal(clientIp(req({ 'x-real-ip': '1.2.3.4' })), '1.2.3.4');
  assert.equal(clientIp(req({ 'x-forwarded-for': '5.6.7.8, 9.9.9.9' })), '5.6.7.8', '첫 칸이 진짜 보낸 곳');
  assert.equal(clientIp(req({ 'x-real-ip': '1.2.3.4', 'x-forwarded-for': '5.6.7.8' })), '1.2.3.4', 'x-real-ip 가 먼저');
  assert.equal(clientIp(req({})), 'unknown');
  assert.equal(clientIp(req({ 'x-real-ip': '2001:DB8::1' })), '2001:db8::1', 'IPv6 도 그대로');
  // 헤더는 보내는 쪽이 지어낼 수 있습니다 — 주소 모양이 아니면 모두 한 칸으로 몰아
  // 값을 바꿔 가며 제한을 피하지 못하게 합니다(글자만 골라내면 '<script>1.2.3.4' 의 c 가 살아남아 새 칸이 됩니다).
  assert.equal(clientIp(req({ 'x-real-ip': '<script>1.2.3.4' })), 'unknown');
  assert.equal(clientIp(req({ 'x-real-ip': 'a'.repeat(200) })), 'unknown');
  assert.equal(clientIp(req({ 'x-real-ip': '1.2.3.4; rm -rf' })), 'unknown');
  assert.equal(clientIp(req({ 'x-real-ip': 'guard/rate.json' })), 'unknown', '저장 경로가 될 만한 값도 막음');
});

test('창 안에서 정해진 횟수까지만 — 넘으면 남은 시간을 알려 줌', async () => {
  let t = 1_000_000;
  const store = fakeStore();
  const lim = createLimiter(store, { now: () => t });
  const rule = [{ key: 'login:ip:1.1.1.1', max: 3, windowMs: 60e3, label: '너무 자주' }];

  for (let i = 0; i < 3; i++) assert.equal((await lim.check(rule)).ok, true, `${i + 1}번째는 통과`);
  const blocked = await lim.check(rule);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.label, '너무 자주');
  assert.ok(blocked.retryAfterS > 0 && blocked.retryAfterS <= 60);

  // 막힌 동안 더 때려도 잠금이 길어지지 않음(세지 않으므로)
  const again = await lim.check(rule);
  assert.equal(again.retryAfterS, blocked.retryAfterS);

  t += 60e3 + 1;                       // 창이 지나면 다시 열림
  assert.equal((await lim.check(rule)).ok, true);
});

test('여러 겹 — 하나만 넘쳐도 막고, 막힌 요청은 다른 칸도 올리지 않음', async () => {
  let t = 0;
  const lim = createLimiter(fakeStore(), { now: () => t });
  const rules = [
    { key: 'a:ip', max: 5, windowMs: 60e3 },
    { key: 'a:mail', max: 2, windowMs: 60e3, label: '같은 주소' },
  ];
  assert.equal((await lim.check(rules)).ok, true);
  assert.equal((await lim.check(rules)).ok, true);
  const r = await lim.check(rules);
  assert.equal(r.ok, false);
  assert.equal(r.label, '같은 주소', '넘친 규칙을 알려 줌');

  // 메일 칸 때문에 막혔으니 IP 칸은 2에서 멈춰 있어야 함 — 다른 주소로는 아직 보낼 수 있음
  // 막힌 요청이 IP 칸을 올리지 않았으므로(2에서 멈춤) 다른 주소로는 세 번 더 보낼 수 있어야 합니다
  const withMail = n => [{ key: 'a:ip', max: 5, windowMs: 60e3 }, { key: 'mail' + n, max: 2, windowMs: 60e3 }];
  assert.equal((await lim.check(withMail(1))).ok, true, 'IP 3');
  assert.equal((await lim.check(withMail(2))).ok, true, 'IP 4');
  assert.equal((await lim.check(withMail(3))).ok, true, 'IP 5');
  const ipFull = await lim.check(withMail(4));
  assert.equal(ipFull.ok, false, '이제는 IP 칸이 찼음');
});

test('메일 주소는 원문으로 저장하지 않음', async () => {
  const k = mailKey('login', ' Kim@Example.COM ');
  assert.equal(k, mailKey('login', 'kim@example.com'), '공백·대소문자는 같은 것으로');
  assert.doesNotMatch(k, /kim|example/i, '주소가 열쇠에 드러나지 않음');
  assert.notEqual(k, mailKey('login', 'other@example.com'));
  assert.notEqual(k, mailKey('sub', 'kim@example.com'), '용도가 다르면 칸도 다름');
});

test('메일 길목 기본 규칙 — 한 사람·한 주소·전체 세 겹', () => {
  const rules = mailRules('login', '1.2.3.4', 'a@b.com');
  assert.equal(rules.length, 3);
  assert.deepEqual(rules.map(r => r.max), [5, 3, 120]);
  assert.equal(rules[0].key, idKey('login', 'ip', '1.2.3.4'));
  assert.doesNotMatch(rules[0].key, /1\.2\.3\.4/, '접속 주소도 원문으로 남기지 않음 — 개인정보라서');
  assert.equal(rules[2].key, 'login:all');
  assert.ok(rules.every(r => r.label), '막혔을 때 보여 줄 말이 모두 있음');
});

test('저장소가 말썽이어도 서비스는 계속', async () => {
  const store = fakeStore();
  store.get = async () => { throw new Error('blob down'); };
  store.put = async () => { throw new Error('blob down'); };
  const lim = createLimiter(store);
  assert.equal((await lim.check([{ key: 'x', max: 1, windowMs: 60e3 }])).ok, true, '못 세면 통과시킴');
});

test('오래된 칸은 지워 파일이 계속 커지지 않게', async () => {
  let t = 0;
  const store = fakeStore();
  const lim = createLimiter(store, { now: () => t });
  await lim.check([{ key: 'old', max: 10, windowMs: 60e3 }]);
  t += 25 * 3600e3;                    // 하루가 지나면
  await lim.check([{ key: 'new', max: 10, windowMs: 60e3 }]);
  assert.deepEqual(Object.keys(store.data[RATE_PATH]), ['new']);
});

test('규칙이 없으면 그냥 통과 — 저장도 하지 않음', async () => {
  const store = fakeStore();
  const lim = createLimiter(store);
  assert.equal((await lim.check([])).ok, true);
  assert.equal((await lim.check([{ key: '', max: 5, windowMs: 1 }])).ok, true);
  assert.equal(store.data[RATE_PATH], undefined);
});

test('저장된 파일에 접속 주소·메일 주소가 남지 않음', async () => {
  const store = fakeStore();
  const lim = createLimiter(store);
  await lim.check(mailRules('sub', '203.0.113.77', 'victim@example.com'));
  const saved = JSON.stringify(store.data[RATE_PATH]);
  assert.doesNotMatch(saved, /203\.0\.113\.77/, '접속 주소 원문 없음');
  assert.doesNotMatch(saved, /victim|example\.com/i, '메일 주소 원문 없음');
  assert.match(saved, /sub:all/, '전체 칸은 이름 그대로여도 됨(개인이 드러나지 않음)');
  // 같은 사람은 늘 같은 칸으로 가야 셈이 맞습니다
  assert.equal(idKey('sub', 'ip', '203.0.113.77'), idKey('sub', 'ip', '203.0.113.77'));
  assert.notEqual(idKey('sub', 'ip', '203.0.113.77'), idKey('sub', 'ip', '203.0.113.78'));
});
