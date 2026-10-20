// 주간 보고서 메일 구독 스모크 테스트 — 저장소를 메모리로 흉내 내 신청·확인·조건 변경·해지·관리 API를 검사(네트워크·메일 발송 없음)
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandlers, normalizeEmail, recordPath, sha256Hex, MAX_SUBSCRIBERS, normalizeCriteria, criteriaKey, criteriaLabel } from '../site/public/api/_core.mjs';
import { confirmMail, changeMail, weeklyMail, linksFor, changeLinkFor, normalizeMailConfig, mailReady, smtpOptions, providerFor, fromHeader } from './mail-lib.mjs';

test('보내는 계정: Gmail·네이버 SMTP 설정과 예전 설정 키 호환', () => {
  const g = normalizeMailConfig({ gmailUser: 'me@gmail.com', gmailAppPassword: 'abcd efgh ijkl mnop', adminSecret: 'k', siteUrl: 'https://s' });
  assert.equal(g.provider, 'gmail');
  assert.ok(mailReady(g), '예전 Gmail 설정 키도 그대로 동작');
  assert.deepEqual(smtpOptions(g), { host: 'smtp.gmail.com', port: 465, secure: true, auth: { user: 'me@gmail.com', pass: 'abcdefghijklmnop' } });
  const n = normalizeMailConfig({ senderUser: 'myid@naver.com', senderPass: 'pass word1', smtpAuthUser: 'myid', adminSecret: 'k', siteUrl: 'https://s' });
  assert.equal(n.provider, 'naver');
  assert.deepEqual(smtpOptions(n), { host: 'smtp.naver.com', port: 465, secure: true, auth: { user: 'myid', pass: 'pass word1' } }, '네이버 비밀번호는 띄어쓰기를 지우지 않음');
  assert.equal(fromHeader(n), '"진가 주간 보고서" <myid@naver.com>');
  assert.equal(providerFor('someone@NAVER.com'), 'naver');
  assert.equal(providerFor('x@daum.net'), null);
  assert.equal(mailReady(normalizeMailConfig({ senderUser: 'x@daum.net', senderPass: 'p', adminSecret: 'k', siteUrl: 'https://s' })), false, '지원하지 않는 도메인은 발송 안 함');
});

const CRIT = { gus: ['송파구', '강동구'], budgetMinEok: 10, budgetEok: 13, minArea: 59, maxArea: 84, minHouseholds: 300, priceBasis: 'ask' };

test('보고서 조건: 검증·정규화·같은 조건 같은 키', () => {
  const { criteria } = normalizeCriteria({ ...CRIT, budgetMinEok: '13', budgetEok: '10', minArea: 84.9, maxArea: 59, minHouseholds: 777, priceBasis: 'x' });
  assert.deepEqual(criteria, { gus: ['강동구', '송파구'], budgetMinEok: 10, budgetEok: 13, minArea: 59, maxArea: 84, minHouseholds: 300, priceBasis: 'ask', maxRentPct: 0 },
    '자치구는 가나다 고정 순서, 뒤바뀐 상하한은 교환, 허용 안 된 규모·기준은 기본값');
  assert.equal(criteriaKey(criteria), criteriaKey(normalizeCriteria(CRIT).criteria));
  assert.notEqual(criteriaKey(criteria), criteriaKey({ ...criteria, budgetEok: 14 }));
  assert.match(normalizeCriteria({ ...CRIT, gus: [] }).error, /1개 이상/);
  assert.match(normalizeCriteria({ ...CRIT, gus: ['강남구', '강동구', '강북구', '강서구', '관악구', '광진구'] }).error, /5개/);
  assert.match(normalizeCriteria({ ...CRIT, gus: ['분당구'] }).error, /서울/);
  assert.match(normalizeCriteria({ ...CRIT, budgetEok: 0 }).error, /상한/);
  assert.equal(criteriaLabel(criteria), '강동구·송파구 · 예산 10억 ~ 13억(매물 호가 기준) · 전용 59~84㎡ · 300세대 이상');
  assert.equal(criteriaLabel({ ...criteria, budgetMinEok: 0, budgetEok: 9.5, minArea: 0, maxArea: 0, minHouseholds: 0, priceBasis: 'kb' }),
    '강동구·송파구 · 예산 9억 5,000만 이하(KB시세 기준) · 전용 면적 무관 · 규모 무관');
});

function memStore() {
  const m = new Map();
  return {
    map: m,
    subs: () => [...m.keys()].filter(k => k.startsWith('subs/')).length,   // 구독자 수(남용 방지 카운터 guard/ 는 빼고)
    async get(p) { return m.has(p) ? structuredClone(m.get(p)) : null; },
    async put(p, o) { m.set(p, structuredClone(o)); },
    async del(p) { m.delete(p); },
    async list(prefix) { return [...m.keys()].filter(k => k.startsWith(prefix)); },
  };
}
const post = (url, body, headers = {}) => new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
const SITE = 'https://jinga.example';
const sub = (email, extra = {}) => post(`${SITE}/api/subscribe`, { email, consent: true, criteria: CRIT, ...extra });

test('구독 신청: 형식·동의·조건 검사, 봇 함정, 10분 재신청 제한', async () => {
  let t = Date.parse('2026-09-14T00:00:00Z');
  const store = memStore();
  const h = createHandlers(store, { JINGA_ADMIN_SECRET: 's' }, () => t);
  assert.equal((await h.subscribe(sub('not-mail'))).status, 400);
  assert.equal((await h.subscribe(sub('a@b.co', { consent: undefined }))).status, 400, '동의 없으면 거절');
  assert.equal((await h.subscribe(sub('a@b.co', { criteria: undefined }))).status, 400, '조건 없으면 거절');
  assert.equal((await h.subscribe(sub('a@b.co', { criteria: { ...CRIT, gus: [] } }))).status, 400, '자치구 없으면 거절');
  const bot = await (await h.subscribe(sub('x@y.co', { website: 'spam' }))).json();
  assert.equal(bot.ok, true);
  assert.equal(store.subs(), 0, '봇 함정 칸이 채워지면 저장하지 않음');

  const r1 = await (await h.subscribe(sub(' Test.User@Example.com '))).json();
  assert.equal(r1.status, 'pending');
  const id = (await sha256Hex('test.user@example.com')).slice(0, 32);
  const rec = await store.get(recordPath(id));
  assert.equal(rec.email, 'test.user@example.com');
  assert.equal(rec.token.length, 48);
  assert.deepEqual(rec.criteria.gus, ['강동구', '송파구']);
  t += 5 * 60e3;
  await h.subscribe(sub('test.user@example.com', { criteria: { ...CRIT, budgetEok: 15 } }));
  const again = await store.get(recordPath(id));
  assert.equal(again.token, rec.token, '10분 안 재신청은 토큰 유지');
  assert.equal(again.criteria.budgetEok, 15, '확인 전 재신청은 조건만 최신으로');
  t += 6 * 60e3;
  await h.subscribe(sub('test.user@example.com'));
  assert.notEqual((await store.get(recordPath(id))).token, rec.token, '10분 지나면 새 토큰');
});

test('확인·조건 변경·해지 링크와 이미 구독 중 처리', async () => {
  let t = Date.parse('2026-09-14T00:00:00Z');
  const store = memStore();
  const h = createHandlers(store, { JINGA_ADMIN_SECRET: 's' }, () => t);
  await h.subscribe(sub('me@kch.co.kr'));
  const [p] = await store.list('subs/');
  const rec = await store.get(p);
  assert.equal((await h.confirm(new Request(`${SITE}/api/confirm?id=${rec.id}&token=wrong`))).status, 404);
  const ok = await h.confirm(new Request(`${SITE}/api/confirm?id=${rec.id}&token=${rec.token}`));
  assert.equal(ok.status, 200);
  const okText = await ok.text();
  assert.match(okText, /구독이 확인되었습니다/);
  assert.match(okText, /강동구·송파구/);
  assert.equal((await store.get(p)).status, 'confirmed');
  assert.equal((await (await h.subscribe(sub('me@kch.co.kr'))).json()).status, 'already', '같은 조건이면 그대로');

  // 조건 변경 — 확인 전에는 기존 조건 유지
  const NEW = { ...CRIT, gus: ['마포구'], budgetEok: 11 };
  const ch = await (await h.subscribe(sub('me@kch.co.kr', { criteria: NEW }))).json();
  assert.equal(ch.status, 'change-pending');
  let cur = await store.get(p);
  assert.deepEqual(cur.criteria.gus, ['강동구', '송파구'], '변경 확인 전에는 기존 조건으로 발송');
  assert.deepEqual(cur.pendingCriteria.gus, ['마포구']);
  assert.equal(cur.changeMailSentAt, null, '운영 PC가 변경 확인 메일을 보내도록 표시');
  const auth = { Authorization: 'Bearer s' };
  await h.admin(post(`${SITE}/api/admin`, { action: 'mark', id: rec.id, field: 'changeMailSentAt' }, auth));
  t += 3 * 60e3;
  await h.subscribe(sub('me@kch.co.kr', { criteria: { ...NEW, budgetEok: 12 } }));
  cur = await store.get(p);
  assert.ok(cur.changeMailSentAt, '10분 안 재변경은 메일을 다시 보내지 않음');
  assert.equal(cur.pendingCriteria.budgetEok, 12, '대신 바꿀 조건은 최신으로');
  const applied = await h.confirm(new Request(`${SITE}/api/confirm?id=${rec.id}&token=${rec.token}`));
  assert.match(await applied.text(), /조건이 바뀌었습니다/);
  cur = await store.get(p);
  assert.deepEqual(cur.criteria.gus, ['마포구']);
  assert.equal(cur.pendingCriteria, undefined);

  // 7일 지난 변경 요청은 적용하지 않음
  await h.subscribe(sub('me@kch.co.kr', { criteria: CRIT }));
  t += 8 * 24 * 3600e3;
  assert.equal((await h.confirm(new Request(`${SITE}/api/confirm?id=${rec.id}&token=${rec.token}`))).status, 410);
  assert.deepEqual((await store.get(p)).criteria.gus, ['마포구']);

  assert.equal((await h.unsubscribe(new Request(`${SITE}/api/unsubscribe?id=${rec.id}&token=bad`))).status, 404);
  const un = await h.unsubscribe(new Request(`${SITE}/api/unsubscribe?id=${rec.id}&token=${rec.token}`));
  assert.match(await un.text(), /수신 거부가 완료/);
  assert.equal(store.subs(), 0, '해지하면 주소 삭제');
});

test('관리 API: 인증, 목록, 발송 표시, 삭제', async () => {
  const store = memStore();
  const h = createHandlers(store, { JINGA_ADMIN_SECRET: 'secret123' });
  await h.subscribe(sub('one@kch.co.kr'));
  assert.equal((await h.admin(new Request(`${SITE}/api/admin`))).status, 401);
  assert.equal((await h.admin(new Request(`${SITE}/api/admin`, { headers: { Authorization: 'Bearer nope' } }))).status, 401);
  const auth = { Authorization: 'Bearer secret123' };
  const { subscribers } = await (await h.admin(new Request(`${SITE}/api/admin`, { headers: auth }))).json();
  assert.equal(subscribers.length, 1);
  assert.ok(subscribers[0].token, '발송 스크립트용 목록에는 토큰 포함');
  const forPage = await (await h.admin(new Request(`${SITE}/api/admin?view=page`, { headers: auth }))).json();
  assert.equal(forPage.subscribers[0].token, undefined, '관리자 페이지용 목록에는 토큰을 내보내지 않음');
  assert.deepEqual(forPage.subscribers[0].criteria.gus, ['강동구', '송파구']);
  const id = subscribers[0].id;
  assert.equal((await h.admin(post(`${SITE}/api/admin`, { action: 'mark', id, field: 'confirmMailSentAt' }, auth))).status, 200);
  assert.ok((await store.get(recordPath(id))).confirmMailSentAt);
  assert.equal((await h.admin(post(`${SITE}/api/admin`, { action: 'mark', id, field: 'email' }, auth))).status, 400, '허용된 필드만');
  assert.equal((await h.admin(post(`${SITE}/api/admin`, { action: 'delete', id }, auth))).status, 200);
  assert.equal(store.subs(), 0);
  const noKey = createHandlers(store, {});
  assert.equal((await noKey.admin(new Request(`${SITE}/api/admin`, { headers: auth }))).status, 503);
  assert.ok(MAX_SUBSCRIBERS >= 1000);
  assert.equal(normalizeEmail('a@b'), null);
});

test('메일 내용: 확인·변경 확인 메일의 조건, 수신 거부 링크·헤더, 조건별 보고서 본문과 첨부', () => {
  const cfg = { siteUrl: SITE, gmailUser: 'sender@gmail.com' };
  const criteria = normalizeCriteria(CRIT).criteria;
  const r = { id: 'a'.repeat(32), token: 'tok', email: 'me@kch.co.kr', criteria };
  const { confirm, unsubscribe } = linksFor(cfg, r);
  const c = confirmMail(cfg, r);
  assert.ok(c.html.includes(confirm) && c.text.includes(unsubscribe));
  assert.ok(c.text.includes('강동구·송파구'), '확인 메일에 신청한 조건 표시');
  const m = changeMail(cfg, { ...r, pendingCriteria: { ...criteria, gus: ['마포구'] } });
  assert.ok(m.html.includes('지금 조건') && m.html.includes('마포구') && m.html.includes(confirm));

  const change = changeLinkFor(cfg, criteria);
  const q = new URL(change).searchParams;
  assert.equal(q.get('sub_gus'), '강동구,송파구');
  assert.equal(q.get('sub_budget'), '10-13');
  assert.equal(q.get('sub_area'), '59-84');
  assert.ok(!change.includes('kch.co.kr'), '조건 바꾸기 링크에 메일 주소를 넣지 않음');

  const w = weeklyMail(cfg, r, { today: '2026-09-14', reportHtml: '<html><body><div class="page">보고서</div></body></html>', xlsxPath: 'C:/x/진가_주간데이터.xlsx', criteria });
  assert.equal(w.subject, '[진가] 주간 보고서 2026-09-14 · 강동구·송파구');
  assert.ok(w.html.includes('보고서') && w.html.includes(unsubscribe));
  assert.ok(w.html.includes('조건 바꾸기') && w.html.includes('sub_gus='));
  assert.ok(w.html.indexOf('사이트에서 단지 검색하기') < w.html.indexOf('보고서</div>'), '안내 줄은 본문 위');
  assert.equal(w.headers['List-Unsubscribe'], `<${unsubscribe}>`);
  assert.equal(w.attachments[0].filename, '진가_주간데이터.xlsx');
  assert.equal(weeklyMail(cfg, r, { today: '2026-09-14', reportHtml: '<body></body>', xlsxPath: null }).subject, '[진가] 주간 보고서 2026-09-14', '조건 없는 구독자는 기본 보고서');
});

test('새 보고서 양식: 자리 표시에 조건·웹 보기 버튼(위)과 수신 거부(아래)를 넣음', () => {
  const cfg = { siteUrl: SITE };
  const criteria = normalizeCriteria(CRIT).criteria;
  const r = { id: 'b'.repeat(32), token: 't2', email: 'me@kch.co.kr' };
  const report = '<html><body><table><!--MAIL_TOP--><tr><td>본문</td></tr><!--MAIL_BOTTOM--></table></body></html>';
  const w = weeklyMail(cfg, r, { today: '2026-09-14', reportHtml: report, xlsxPath: null, criteria, webUrl: `${SITE}/r/2026-09-14/abc.html` });
  assert.ok(!w.html.includes('MAIL_TOP') && !w.html.includes('MAIL_BOTTOM'));
  assert.ok(w.html.indexOf('웹에서 탭으로 보기') < w.html.indexOf('본문'), '웹 보기 버튼은 본문 위');
  assert.ok(w.html.indexOf('수신 거부') > w.html.indexOf('본문'), '수신 거부는 본문 아래');
  assert.ok(w.html.includes('강동구·송파구 · 예산'));
  const noWeb = weeklyMail(cfg, r, { today: '2026-09-14', reportHtml: report, xlsxPath: null });
  assert.ok(!noWeb.html.includes('웹에서 탭으로 보기'), '웹 사본이 배포되지 않았으면 버튼 없음');
  assert.ok(noWeb.html.includes('내 조건을 정해 받기'), '조건 없는 구독자에게는 조건 정하기 링크');
});

test('신청 직후 메일 훅(서버): 새 신청은 확인 메일, 조건 변경은 변경 확인 메일 — 10분 안 재변경은 생략', async () => {
  let t = Date.parse('2026-09-14T00:00:00Z');
  const calls = [];
  const store = memStore();
  const h = createHandlers(store, { JINGA_ADMIN_SECRET: 's' }, () => t, { onMail: async (kind, rec) => { calls.push([kind, rec.email, !!rec.token]); } });
  await h.subscribe(sub('hook@kch.co.kr'));
  assert.deepEqual(calls, [['confirm', 'hook@kch.co.kr', true]]);
  const [p] = await store.list('subs/');
  await store.put(p, { ...(await store.get(p)), status: 'confirmed' });
  await h.subscribe(sub('hook@kch.co.kr', { criteria: { ...CRIT, gus: ['마포구'] } }));
  assert.equal(calls[1][0], 'change');
  await store.put(p, { ...(await store.get(p)), changeMailSentAt: new Date(t).toISOString() });
  t += 60e3;
  await h.subscribe(sub('hook@kch.co.kr', { criteria: { ...CRIT, gus: ['용산구'] } }));
  assert.equal(calls.length, 2, '10분 안 재변경은 메일 없이 바꿀 조건만 갱신');
});

test('메일 폭탄 막기: 주소를 바꿔 가며 불러도 한 곳에서 5번까지', async () => {
  let t = Date.parse('2026-09-14T00:00:00Z');
  const store = memStore();
  const sent = [];
  const h = createHandlers(store, { JINGA_ADMIN_SECRET: 's' }, () => t, { onMail: (kind, r) => sent.push(r.email) });
  const from = ip => ({ 'x-real-ip': ip });

  for (let i = 0; i < 5; i++) {
    const r = await h.subscribe(post(`${SITE}/api/subscribe`, { email: `v${i}@x.com`, consent: true, criteria: CRIT }, from('1.2.3.4')));
    assert.equal(r.status, 200, `${i + 1}번째까지는 받아 줌`);
  }
  const blocked = await h.subscribe(post(`${SITE}/api/subscribe`, { email: 'v5@x.com', consent: true, criteria: CRIT }, from('1.2.3.4')));
  assert.equal(blocked.status, 429, '6번째는 막음');
  assert.ok(Number(blocked.headers.get('Retry-After')) > 0, '언제 다시 되는지 알려 줌');
  assert.match((await blocked.json()).error, /다시 시도/);
  assert.equal(sent.length, 5, '막힌 요청은 메일을 보내지 않음');
  assert.equal(store.subs(), 5, '막힌 요청은 저장도 하지 않음');

  // 다른 곳에서는 그대로 됨 — 한 사람 때문에 전체가 막히지 않게
  assert.equal((await h.subscribe(post(`${SITE}/api/subscribe`, { email: 'other@x.com', consent: true, criteria: CRIT }, from('9.9.9.9')))).status, 200);

  // 같은 주소로는 1시간에 3번까지(다른 곳에서 불러도)
  const same = 'target@victim.com';
  for (let i = 0; i < 3; i++) {
    t += 11 * 60e3;                    // 10분 재발송 제한은 피해 가며
    assert.equal((await h.subscribe(post(`${SITE}/api/subscribe`, { email: same, consent: true, criteria: { ...CRIT, budgetEok: 13 + i } }, from(`5.5.5.${i}`)))).status, 200);
  }
  t += 11 * 60e3;
  const mailFull = await h.subscribe(post(`${SITE}/api/subscribe`, { email: same, consent: true, criteria: { ...CRIT, budgetEok: 20 } }, from('5.5.5.9')));
  assert.equal(mailFull.status, 429, '한 주소에 계속 보내는 것도 막음');
  assert.match((await mailFull.json()).error, /같은 주소/);

  t += 61 * 60e3;                      // 한 시간이 지나면 다시 열림
  assert.equal((await h.subscribe(post(`${SITE}/api/subscribe`, { email: same, consent: true, criteria: { ...CRIT, budgetEok: 21 } }, from('5.5.5.9')))).status, 200);
});

test('구독 조건에 임대세대 비율 — 없던 구독자는 제한 없음으로', () => {
  const base = { gus: ['강동구'], budgetMinEok: 0, budgetEok: 13, minArea: 59, maxArea: 0, minHouseholds: 300, priceBasis: 'ask' };

  // 이미 구독 중인 분의 조건에는 이 값이 없습니다 — 받아 보던 보고서를 말없이 바꾸지 않으려고 0으로 봅니다
  assert.equal(normalizeCriteria(base).criteria.maxRentPct, 0);
  assert.equal(normalizeCriteria({ ...base, maxRentPct: 30 }).criteria.maxRentPct, 30);
  assert.equal(normalizeCriteria({ ...base, maxRentPct: 1 }).criteria.maxRentPct, 1);
  assert.equal(normalizeCriteria({ ...base, maxRentPct: 77 }).criteria.maxRentPct, 0, '화면에 없는 값은 받지 않음');
  assert.equal(normalizeCriteria({ ...base, maxRentPct: '30' }).criteria.maxRentPct, 30, '문자열로 와도');

  // 조건이 다르면 보고서도 따로 — 같은 묶음으로 합쳐지면 안 됩니다
  const k0 = criteriaKey(normalizeCriteria(base).criteria);
  const k30 = criteriaKey(normalizeCriteria({ ...base, maxRentPct: 30 }).criteria);
  assert.notEqual(k0, k30);
  assert.equal(k30, criteriaKey(normalizeCriteria({ ...base, maxRentPct: 30 }).criteria), '같은 조건은 같은 키');

  // 메일·보고서에 조건이 그대로 보여야 합니다
  assert.doesNotMatch(criteriaLabel(normalizeCriteria(base).criteria), /임대/);
  assert.match(criteriaLabel(normalizeCriteria({ ...base, maxRentPct: 30 }).criteria), /임대세대 30% 이하/);
  assert.match(criteriaLabel(normalizeCriteria({ ...base, maxRentPct: 1 }).criteria), /임대세대 없는 단지만/);
});
