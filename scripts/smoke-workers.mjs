// Worker 스모크 테스트 — Cloudflare 없이 Node에서 fetch/caches/KV를 흉내 내 장애 대응 로직을 검사합니다.
//   node --test scripts/smoke-workers.mjs          (npm test)
//   LIVE=1 node --test scripts/smoke-workers.mjs   (실제 Google/Bing 뉴스 RSS까지 호출)
import test from 'node:test';
import assert from 'node:assert/strict';

const realFetch = globalThis.fetch;

class MemCache {
  constructor() { this.map = new Map(); }
  async match(req) { const r = this.map.get(typeof req === 'string' ? req : req.url); return r ? r.clone() : undefined; }
  async put(req, res) { this.map.set(typeof req === 'string' ? req : req.url, res.clone()); }
}
class MemKV {
  constructor() { this.map = new Map(); }
  async get(k) { return this.map.has(k) ? this.map.get(k) : null; }
  async put(k, v) { this.map.set(k, v); }
}
function freshCaches() { globalThis.caches = { default: new MemCache() }; }

// url 패턴 → 응답 함수 목록으로 fetch를 대체
function mockFetch(routes) {
  globalThis.fetch = async (input) => {
    const url = typeof input === 'string' ? input : input.url;
    for (const [re, fn] of routes) if (re.test(url)) return fn(url);
    throw new Error('예상하지 못한 호출: ' + url);
  };
}

const { default: policy } = await import('../workers/jinga-policy-proxy/src/index.js');
const { default: macro } = await import('../workers/jinga-korea-macro/src/index.js');

const today = new Date().toUTCString();
const BING_RSS = `<?xml version="1.0"?><rss><channel><title>부동산 정책 - Bing뉴스</title>
<item><title>공급대책 &#183; 3기 신도시 주택 공급 가시화</title><link>http://www.bing.com/news/apiclick.aspx?ref=FexRss&amp;url=https%3a%2f%2fwww.example.com%2fnews%2f1&amp;mkt=ko-kr</link><pubDate>${today}</pubDate><News:Source>이투데이 on MSN</News:Source></item>
<item><title>무관한 스포츠 기사</title><link>http://www.bing.com/x</link><pubDate>${today}</pubDate><News:Source>스포츠</News:Source></item>
</channel></rss>`;
const GOOGLE_RSS = `<rss><channel><item><title>주담대 DSR 규제 강화 - 머니투데이</title><link>https://news.google.com/rss/articles/abc</link><pubDate>${today}</pubDate></item></channel></rss>`;

async function getJson(worker, path, env = {}) {
  const res = await worker.fetch(new Request('https://w.example' + path), env);
  return { status: res.status, cacheControl: res.headers.get('Cache-Control'), body: await res.json() };
}

test('policy: Google 503이면 Bing으로 대체하고 실제 기사 URL을 꺼낸다', async () => {
  freshCaches();
  mockFetch([
    [/news\.google\.com/, () => new Response('busy', { status: 503 })],
    [/bing\.com\/news/, () => new Response(BING_RSS)],
  ]);
  const { status, body } = await getJson(policy, '/policy');
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.data.items.length, 1, '무관한 기사는 걸러져야 함');
  const it = body.data.items[0];
  assert.equal(it.title, '공급대책 · 3기 신도시 주택 공급 가시화');
  assert.equal(it.src, '이투데이');
  assert.equal(it.link, 'https://www.example.com/news/1');
  assert.match(body.data.source, /Bing/);
});

test('policy: Google 정상이면 Google 결과를 쓴다', async () => {
  freshCaches();
  mockFetch([[/news\.google\.com/, () => new Response(GOOGLE_RSS)]]);
  const { body } = await getJson(policy, '/policy');
  assert.equal(body.data.items[0].src, '머니투데이');
  assert.match(body.data.source, /^Google/);
});

test('policy: 모두 실패하면 마지막 성공값을 stale로, 그것도 없으면 캐시 금지 502', async () => {
  freshCaches();
  const env = { JINGA_KV: new MemKV() };
  mockFetch([[/news\.google\.com/, () => new Response(GOOGLE_RSS)]]);
  await getJson(policy, '/policy', env);
  freshCaches(); // 엣지 캐시 만료 상황 — KV만 남음
  mockFetch([[/./, () => new Response('down', { status: 503 })]]);
  const stale = await getJson(policy, '/policy', env);
  assert.equal(stale.status, 200);
  assert.equal(stale.body.stale, true);
  assert.equal(stale.body.data.items.length, 1);
  assert.equal(stale.cacheControl, 'public, max-age=300');

  freshCaches();
  const none = await getJson(policy, '/policy', {});
  assert.equal(none.status, 502);
  assert.equal(none.cacheControl, 'no-store');
});

test('macro: ECOS StatisticSearch 404이면 100대 통계지표로 대체', async () => {
  freshCaches();
  mockFetch([
    [/StatisticSearch/, () => new Response('not found', { status: 404 })],
    [/KeyStatisticList/, () => Response.json({ KeyStatisticList: { row: [
      { KEYSTAT_NAME: '원/달러 환율(종가)', DATA_VALUE: '1339.2', CYCLE: '20260910', UNIT_NAME: '원' },
      { KEYSTAT_NAME: '한국은행 기준금리', DATA_VALUE: '2.5', CYCLE: '20260910', UNIT_NAME: '%' },
    ] } })],
  ]);
  const { status, body } = await getJson(macro, '/rate/base', { ECOS_API_KEY: 'k' });
  assert.equal(status, 200);
  assert.equal(body.data.value, 2.5);
  assert.match(body.data.source, /100대/);
});

test('macro: Cron이 저장한 마지막 성공값으로 장애 시에도 응답', async () => {
  freshCaches();
  const env = { ECOS_API_KEY: 'k', JINGA_KV: new MemKV() };
  mockFetch([
    [/StatisticSearch/, () => Response.json({ StatisticSearch: { row: [{ DATA_VALUE: '2.5', TIME: '20260910', UNIT_NAME: '%' }] } })],
    [/./, () => new Response('down', { status: 503 })],   // 주간지수·주담대는 실패해도 됨
  ]);
  const pending = [];
  await macro.scheduled({ cron: '*/30 * * * *' }, env, { waitUntil: p => pending.push(p) });
  await Promise.all(pending);
  assert.ok(await env.JINGA_KV.get('lastgood:base'), 'Cron 성공분이 KV에 저장돼야 함');

  freshCaches();
  mockFetch([[/./, () => new Response('down', { status: 404 })]]);
  const { status, body } = await getJson(macro, '/rate/base', env);
  assert.equal(status, 200);
  assert.equal(body.stale, true);
  assert.equal(body.data.value, 2.5);
});

test('macro: /trade/complexes는 단지·면적별 가장 최근 거래가를 준다', async () => {
  freshCaches();
  const k = new Date(Date.now() + 9 * 3600e3);
  let y = k.getUTCFullYear(), m = k.getUTCMonth() + 1;
  const cur = `${y}${String(m).padStart(2, '0')}`;
  if (--m === 0) { m = 12; y--; }
  const prev = `${y}${String(m).padStart(2, '0')}`;
  const item = (apt, dong, area, amount, day, floor, by) =>
    `<item><aptNm>${apt}</aptNm><umdNm>${dong}</umdNm><excluUseAr>${area}</excluUseAr><dealAmount>${amount}</dealAmount>`
    + `<dealDay>${day}</dealDay><floor>${floor}</floor><buildYear>${by}</buildYear><cdealType> </cdealType></item>`;
  const xml = items => `<response><header><resultCode>000</resultCode></header><body><items>${items}</items><totalCount>9</totalCount></body></response>`;
  mockFetch([[/apis\.data\.go\.kr/, url => {
    const ym = new URL(url).searchParams.get('DEAL_YMD');
    if (ym === cur) return new Response(xml(item('래미안솔베뉴', '명일동', '84.97', '200,000', '5', '12', '2019')));
    if (ym === prev) return new Response(xml(item('래미안솔베뉴', '명일동', '84.95', '195,000', '20', '7', '2019')
      + item('고덕아이파크', '고덕동', '59.9', '129,000', '3', '5', '2011')));
    return new Response(xml(''));
  }]]);
  const { status, body } = await getJson(macro, '/trade/complexes?gu=강동구&months=3', { MOLIT_API_KEY: 'k' });
  assert.equal(status, 200, JSON.stringify(body));
  const sol = body.data.complexes.find(c => c.apt === '래미안솔베뉴');
  assert.equal(sol.count, 2);
  assert.equal(sol.latest.amount, 200000, '가장 최근 거래가(이번 달)를 써야 함');
  assert.equal(sol.min, 195000);
  assert.equal(body.data.complexes.length, 2);

  const tooMany = await getJson(macro, '/trade/complexes?gu=' + encodeURIComponent('강남구,강동구,강북구,강서구,관악구,광진구,구로구,금천구,노원구,도봉구,동대문구,동작구,마포구,서대문구,서초구,성동구') + '&months=3', { MOLIT_API_KEY: 'k' });
  assert.equal(tooMany.status, 400);
  assert.equal(tooMany.cacheControl, 'no-store');
});

test('policy(LIVE): 실제 Google/Bing RSS를 파싱할 수 있다', { skip: !process.env.LIVE }, async () => {
  freshCaches();
  globalThis.fetch = realFetch;
  const { status, body } = await getJson(policy, '/policy');
  assert.equal(status, 200, JSON.stringify(body).slice(0, 300));
  assert.ok(body.data.items.length > 0);
  console.log('  실제 수집', body.data.count, '건 ·', body.data.source, '· 첫 기사:', body.data.items[0].title);
});
