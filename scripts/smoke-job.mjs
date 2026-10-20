// 서버 주간 작업(api/_job.mjs) 스모크 테스트 — 저장소는 메모리, KB·뉴스·시장 지표는 가짜 응답(네트워크·메일 발송 없음)
import test from 'node:test';
import assert from 'node:assert/strict';
import { runJob, startJob, cronTick, weekStartId, JOB_PATH, LAST_FULL_PATH } from '../site/public/api/_job.mjs';

const ORIGIN = 'https://jinga.example';

function memStore() {
  const m = new Map();
  return {
    map: m,
    async get(p) { return m.has(p) ? structuredClone(m.get(p)) : null; },
    async put(p, o) { m.set(p, structuredClone(o)); },
    async getText(p) { return m.has(p) ? String(m.get(p)) : null; },
    async getBytes(p) { return m.has(p) ? new Uint8Array(m.get(p)) : null; },
    async putRaw(p, body) { m.set(p, typeof body === 'string' ? body : Buffer.from(body)); },
    async del(p) { m.delete(p); },
    async list(prefix) { return [...m.keys()].filter(k => k.startsWith(prefix)); },
  };
}

// [id, 단지명, 자치구, 법정동, 50세대 미만]
const DIR = [[1, '신축대단지', '강동구', '고덕동', 0], [2, '가락구축', '송파구', '가락동', 0], [3, '마포단지', '마포구', '성산동', 0], [4, '소규모', '강동구', '명일동', 1]];
const PRICE = { 1: 120000, 2: 110000, 3: 125000, 4: 90000 };

function installFetch() {
  const rss = `<rss><channel><item><title>강동구 고덕 재건축 조합설립인가 - 테스트신문</title><link>https://news.example/1</link><pubDate>${new Date().toUTCString()}</pubDate></item></channel></rss>`;
  const ok = body => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
  globalThis.fetch = async input => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    if (url.origin === ORIGIN && url.pathname === '/kb-seoul-complexes.json') return ok({ complexes: DIR });
    if (url.origin === ORIGIN) return new Response('없음', { status: 404 });
    if (url.hostname === 'api.kbland.kr') {
      const id = Number(url.searchParams.get('단지기본일련번호'));
      if (url.pathname.endsWith('/mpriByType')) {
        return ok({ dataBody: { data: [{ 전용면적: '84.9', 매매일반거래가: PRICE[id], 매매하한가: PRICE[id] - 5000, 매매상한가: PRICE[id] + 5000, 전세일반거래가: PRICE[id] * 0.55, 세대수: 600, 시세제공여부: '1', 면적일련번호: id * 10 }] } });
      }
      if (url.pathname.endsWith('/brif')) return ok({ dataBody: { data: { 준공년월: '202001', 총세대수: '1200', 재건축여부: '0', 관심등록수: '80' } } });
      if (url.pathname.endsWith('/BasePrcInfoNew')) return ok({ dataBody: { data: { 매물매매평균가: Math.round(PRICE[id] * 1.08), 매매건수: '3', 시세: [{ 시세기준년월일: '20260911' }] } } });
    }
    if (url.hostname === 'news.google.com') return new Response(rss);
    if (url.hostname.endsWith('workers.dev')) return ok({ ok: false, error: '테스트' });
    throw new Error('예상하지 못한 호출: ' + url);
  };
}

test('서버 주간 작업: KB 조회 → 지역 지도 → 호가·단지 정보 → 뉴스 → 조건별 보고서 → 메일 설정 없으면 발송만 건너뜀', async () => {
  const realFetch = globalThis.fetch;
  installFetch();
  try {
    const store = memStore();
    await store.put('weekly/config.json', { gus: ['강동구', '송파구'], budgetMinEok: 0, budgetEok: 13, minArea: 59, maxArea: 0, minHouseholds: 300, priceBasis: 'ask', newsPerGu: 3 });
    const subId = 'a'.repeat(32);
    await store.put(`subs/${subId}.json`, { id: subId, email: 'me@kch.co.kr', status: 'confirmed', token: 't', createdAt: '2026-09-01T00:00:00Z',
      criteria: { gus: ['마포구'], budgetMinEok: 0, budgetEok: 14, minArea: 59, maxArea: 0, minHouseholds: 300, priceBasis: 'ask' } });

    const now = new Date('2026-09-15T00:00:00Z');   // 화요일 09:00(한국) — 운영 실행은 이번 주 월요일 날짜
    const s = await startJob(store, { mode: 'full', now });
    assert.equal(s.ok, true);
    assert.equal(s.job.id, '2026-09-14');
    const busy = await store.get(JOB_PATH);
    await store.put(JOB_PATH, { ...busy, updatedAt: new Date().toISOString() });
    assert.equal((await startJob(store, { mode: 'test', now })).ok, false, '진행 중인 작업이 있으면 새로 시작하지 않음');

    let r;
    for (let i = 0; i < 20; i++) {
      r = await runJob({ store, env: {}, origin: ORIGIN });
      if (!r.ran || r.done || r.failed) break;
    }
    const job = await store.get(JOB_PATH);
    assert.equal(job.failed, false, job.error || '');
    assert.equal(job.done, true, job.log.join('\n'));

    const dir = 'weekly/reports/2026-09-14';
    const manifest = await store.get(`${dir}/groups.json`);
    assert.equal(Object.keys(manifest.groups).length, 2, '기본 조건 + 구독자 조건');
    const base = await store.getText(`${dir}/base.html`);
    assert.ok(base.includes('신축대단지') && base.includes('<!--MAIL_TOP-->'), '기본 조건 보고서');
    const mapo = Object.values(manifest.groups).find(g => !g.isDefault);
    assert.match(mapo.web, /^r\/2026-09-14\/[0-9a-f]{10}\.html$/);
    assert.ok((await store.getText(`${dir}/${mapo.webId}.html`)).includes('마포단지'), '구독자 조건(마포구) 보고서');
    const xlsx = await store.getBytes(`${dir}/base.xlsx`);
    assert.equal(String.fromCharCode(xlsx[0], xlsx[1]), 'PK', '엑셀 첨부 파일');

    const snap = await store.get('weekly/data/2026-09-14.json');
    assert.equal(Object.keys(snap.groups).length, 2, '다음 주 비교용 스냅샷');
    const map = await store.get('weekly/kb-seoul-gu.json');
    assert.ok(map.gu['강동구'] && map.gu['마포구'], '지역 지도는 서울 전체(50세대 이상) 집계');
    assert.equal(map.asOf, '2026.09.11');
    assert.equal((await store.list('weekly/work/')).length, 0, '작업 조각은 끝나면 삭제');
    assert.ok(job.log.some(l => l.includes('발송을 건너뜀')), '메일 설정이 없으면 발송 단계만 건너뜀');

    const lastFull = await store.get(LAST_FULL_PATH);
    assert.deepEqual([lastFull.id, lastFull.done, lastFull.asOf], ['2026-09-14', true, '2026.09.11'], '이번 주 운영 기록');
    assert.ok(await store.get('weekly/jobs/2026-09-14-full.json'), '끝난 작업 이력');
    const annual = await store.get('annual/2026.json');
    assert.deepEqual(annual.weeks, ['2026.09.11'], '연간 기록은 KB 기준일 연도 파일에');
    assert.ok(annual.gu['강동구'].first.pp > 0 && annual.gu['강동구'].dongs['고덕동'].n === 1);
    assert.deepEqual(annual.complexes[1].first.t[0].slice(0, 2), [84.9, 120000], '단지 주택형 [전용㎡, KB 일반가, 전세가]');
    assert.ok(job.log.some(l => l.includes('연간 기록 2026년 — 1주째')));
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('매일 크론: 월요일에만 이번 주 작업 시작(화·수는 이어 가기만) · 7일 지난 미확인 신청 삭제', async () => {
  const store = memStore();
  const oldId = 'b'.repeat(32);
  await store.put(`subs/${oldId}.json`, { id: oldId, email: 'old@x.co', status: 'pending', token: 't', createdAt: '2026-09-01T00:00:00Z' });

  const mon = new Date('2026-09-14T00:00:00Z');   // 월요일 09:00(한국)
  const tue = new Date('2026-09-15T00:00:00Z');
  const wed = new Date('2026-09-16T00:00:00Z');
  const thu = new Date('2026-09-17T00:00:00Z');

  const t0 = await cronTick(store, {}, ORIGIN, tue);
  assert.equal(t0.run, false, '구독자에게 월요일 발송으로 안내하므로 화요일에는 새로 시작하지 않음');
  assert.equal(t0.missedMonday, '2026-09-14', '월요일을 놓친 주는 상태로 알려 관리자가 직접 시작할 수 있게');
  assert.equal(store.map.has(`subs/${oldId}.json`), false, '7일 지난 미확인 신청 삭제');

  // 월요일 크론을 놓쳤을 때 늦게라도 보내려면 설정으로 켬
  await store.put('weekly/config.json', { lateStartUntilDay: 3 });
  const late = await cronTick(store, {}, ORIGIN, tue);
  assert.equal(late.started, '2026-09-14');
  assert.equal(late.late, true, '늦은 시작은 표시');
  await store.put('weekly/config.json', {});
  await store.del(JOB_PATH); await store.del(LAST_FULL_PATH);

  const t1 = await cronTick(store, {}, ORIGIN, mon);
  assert.equal(t1.run, true);
  assert.equal(t1.started, '2026-09-14');
  assert.equal(t1.late, false);
  let job = await store.get(JOB_PATH);
  await store.put(JOB_PATH, { ...job, updatedAt: new Date().toISOString() });
  assert.equal((await cronTick(store, {}, ORIGIN, mon)).run, false, '진행 중인 작업은 중복 실행하지 않음');
  job = await store.get(JOB_PATH);
  await store.put(JOB_PATH, { ...job, updatedAt: new Date(Date.now() - 20 * 60e3).toISOString() });
  assert.equal((await cronTick(store, {}, ORIGIN, tue)).resumed, '2026-09-14', '월요일에 시작해 멈춘 작업은 화요일 크론이 이어 감');
  await store.put(JOB_PATH, { ...job, done: true });
  assert.equal((await cronTick(store, {}, ORIGIN, tue)).run, false, '이번 주 작업이 끝났으면 다시 시작하지 않음');
  assert.equal((await cronTick(store, {}, ORIGIN, thu)).run, false, '목요일에는 새로 시작하지 않음');

  // 운영 실행이 끝난 뒤 같은 주에 시험 실행이 job.json 을 덮어써도, 다음 월요일 전까지 운영 실행을 또 시작하지 않아야 함(중복 발송 방지)
  await store.put(JOB_PATH, { ...job, id: '2026-09-15', mode: 'test', done: true });
  assert.equal((await cronTick(store, {}, ORIGIN, wed)).run, false, '시험 실행이 덮어써도 이번 주 운영 기록(last-full)으로 판단');
  assert.equal((await store.get(LAST_FULL_PATH)).id, '2026-09-14');

  // 멈춘 운영 실행은 시험 실행으로 덮어쓰지 못함
  await store.put(JOB_PATH, { ...job, mode: 'full', done: false, failed: false, updatedAt: new Date(Date.now() - 60 * 60e3).toISOString() });
  const blocked = await startJob(store, { mode: 'test', now: wed });
  assert.equal(blocked.ok, false);
  assert.match(blocked.error, /끝나지 않은 운영 실행/);

  assert.equal(weekStartId(new Date('2026-09-20T14:59:00Z')), '2026-09-14', '일요일 23:59(한국)는 지난 월요일 주');
  assert.equal(weekStartId(new Date('2026-09-20T15:00:00Z')), '2026-09-21', '월요일 00:00(한국)부터 새 주');
});
