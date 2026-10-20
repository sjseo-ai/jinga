// 진가(JINGA) 재테크 - 부동산 정책 뉴스 프록시 (Cloudflare Worker) v3
// GET /policy - 부동산/주택/대출/세제 키워드로 뉴스 검색 RSS를 여러 건 조회해 합치고, 최근 30일치만 정리해 반환합니다.
//
// 소스 (v3, 2026-09-11)
// 1순위 Google 뉴스 검색 RSS — 국내 거의 모든 언론사 기사를 실시간 집계, API 키 불필요.
// 2순위 Bing 뉴스 검색 RSS  — Google이 Cloudflare Worker IP에 503을 주는 경우가 관찰되어(2026-09-11,
//        국내에서는 200) 검색어별로 자동 대체합니다. 역시 키 불필요.
// 둘 다 실패하면 마지막 성공값(last-good)을 stale:true 로 돌려줘 페이지가 "참고 데이터"로 되돌아가지 않게 합니다.
//
// 왜 국토교통부/금융위원회 방식에서 바꿨나:
// 국토교통부 보도자료 목록 페이지는 자체 WAF(봇 차단)가 서버 간 요청(Cloudflare Worker 등)을 리다이렉트
// 루프로 막아 배포 후 계속 실패했습니다(브라우저에서는 정상 접속되지만 서버 요청만 차단).
//
// Google 항목의 <link>는 news.google.com 리다이렉트 링크(클릭 시 언론사 기사로 이동),
// Bing 항목은 apiclick 리다이렉트에서 실제 기사 URL(url 파라미터)을 꺼내 씁니다.
const ALLOWED_ORIGIN = '*';
const CACHE_TTL_SECONDS = 1800; // 30분 - "실시간"에 가깝게, 그러면서도 과호출 방지
const STALE_CACHE_TTL_SECONDS = 300; // 마지막 성공값으로 응답할 때는 5분만 캐시
const LAST_GOOD_TTL_SECONDS = 60 * 60 * 24 * 14;
const LAST_GOOD_KEY = 'https://last-good.jinga.internal/policy';
const MAX_AGE_DAYS = 30;
const MAX_ITEMS = 14;
const UA_BROWSER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// 뉴스 검색에 던질 검색어들(부동산 정책 영역을 여러 각도로 커버)
const QUERIES = [
  '부동산 정책',
  '주택 공급 대책',
  '주택담보대출 대출규제',
  '종합부동산세 양도소득세',
];

// 검색어 자체가 이미 부동산 주제이지만, 혹시 섞여 들어올 수 있는 무관한 기사를 한 번 더 거르는 안전장치
const RELEVANCE_KEYWORDS = [
  '부동산', '주택', '아파트', '전세', '월세', '임대차', '분양', '청약',
  '재건축', '재개발', '정비사업',
  '종부세', '양도세', '취득세', '보유세', '재산세', '공시가격',
  '주택담보대출', '주담대', 'DSR', 'LTV', '담보대출', '가계대출', '가계부채',
  '대출규제', '대출한도', '스트레스', '규제지역', '토지거래허가', '투기과열지구',
  '조정대상지역', '전매제한', '공공주택', '미분양', '실거래가', '갭투자', '택지',
  '공급대책', '주택정책', '집값',
];

function guessType(title) {
  if (/종부세|양도세|취득세|보유세|재산세|세제|공시가격/.test(title)) return { type: 'tax', tag: '세제' };
  if (/규제|DSR|LTV|대출한도|스트레스|토지거래허가|투기과열|조정대상|전매제한|대출.*강화|한도.*축소/.test(title)) return { type: 'reg', tag: '규제' };
  if (/공급|분양|청약|착공|준공|공공주택|신규택지|재건축|재개발|정비사업|미분양|PF/.test(title)) return { type: 'sup', tag: '공급' };
  return { type: 'mkt', tag: '시장' };
}

function corsHeaders(extra) {
  return Object.assign({
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }, extra);
}

// KST 기준 날짜 표기 — Worker는 UTC로 돌기 때문에 그대로 쓰면 오전 9시 이전 기사가 전날로 찍힘
function fmtDate(d) {
  const k = new Date(d.getTime() + 9 * 3600 * 1000);
  const y = k.getUTCFullYear(), m = String(k.getUTCMonth() + 1).padStart(2, '0'), day = String(k.getUTCDate()).padStart(2, '0');
  return y + '.' + m + '.' + day;
}

function decodeEntities(s) {
  return String(s)
    .replace(/&#(\d+);/g, function(_, n) { return String.fromCodePoint(Number(n)); })
    .replace(/&#x([0-9a-f]+);/gi, function(_, n) { return String.fromCodePoint(parseInt(n, 16)); })
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

// 매우 단순한 XML <item> 파서 - Cloudflare Worker에는 DOMParser가 없어 정규식으로 필요한 태그만 뽑아냅니다.
function parseRssItems(xml) {
  const items = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRe.exec(xml))) {
    const block = m[1];
    const pick = function(tag) {
      const re = new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)<\\/' + tag + '>');
      const mm = re.exec(block);
      if (!mm) return '';
      return decodeEntities(mm[1].replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/, '$1').trim());
    };
    items.push({ rawTitle: pick('title'), link: pick('link'), pubDate: pick('pubDate'), source: pick('News:Source') || pick('source') });
  }
  return items;
}

// Google 뉴스 제목은 보통 "기사 제목 - 언론사명" 형식이라 마지막 " - "를 기준으로 분리합니다.
function splitTitleSource(rawTitle) {
  const idx = rawTitle.lastIndexOf(' - ');
  if (idx === -1) return { title: rawTitle, src: 'Google 뉴스' };
  return { title: rawTitle.slice(0, idx), src: rawTitle.slice(idx + 3) };
}

// Bing apiclick 리다이렉트 링크 → 실제 기사 URL
function unwrapBingLink(link) {
  try {
    const u = new URL(link);
    const target = u.searchParams.get('url');
    return target && /^https?:\/\//.test(target) ? target : link;
  } catch (e) {
    return link;
  }
}

function sleep(ms) {
  return new Promise(function(resolve) { setTimeout(resolve, ms); });
}

// 실패 시 짧게 대기했다가 한 번 더 시도
async function fetchText(url, label) {
  const headers = { 'User-Agent': UA_BROWSER, 'Accept-Language': 'ko-KR,ko;q=0.9' };
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      if (attempt > 0) await sleep(600 + Math.floor(Math.random() * 400));
      const res = await fetch(url, { headers: headers });
      if (!res.ok) throw new Error(label + ' HTTP ' + res.status);
      return await res.text();
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

async function fetchGoogleNewsQuery(query) {
  const url = 'https://news.google.com/rss/search?q=' + encodeURIComponent(query) + '&hl=ko&gl=KR&ceid=KR:ko';
  const items = parseRssItems(await fetchText(url, 'google news'));
  return items.map(function(it) {
    const split = splitTitleSource(it.rawTitle);
    return { title: split.title, src: it.source || split.src, link: it.link, pubDate: it.pubDate, via: 'google' };
  });
}

async function fetchBingNewsQuery(query) {
  const url = 'https://www.bing.com/news/search?q=' + encodeURIComponent(query) + '&format=rss&setlang=ko&cc=KR';
  const items = parseRssItems(await fetchText(url, 'bing news'));
  return items.map(function(it) {
    return { title: it.rawTitle, src: (it.source || 'Bing 뉴스').replace(/\s+on MSN$/, ''), link: unwrapBingLink(it.link), pubDate: it.pubDate, via: 'bing' };
  });
}

// 검색어 하나: Google → 실패 시 Bing
async function fetchNewsQuery(query) {
  try {
    return await fetchGoogleNewsQuery(query);
  } catch (googleErr) {
    try {
      return await fetchBingNewsQuery(query);
    } catch (bingErr) {
      throw new Error(query + ': ' + (googleErr.message || googleErr) + ' / ' + (bingErr.message || bingErr));
    }
  }
}

async function fetchPolicyNews() {
  // 4개 검색어를 한 번에 동시 발사하지 않고 살짝 시차를 둬서 순간적인 요청 폭주(503 유발)를 줄입니다.
  const settled = await Promise.allSettled(QUERIES.map(function(q, i) {
    return sleep(i * 150).then(function() { return fetchNewsQuery(q); });
  }));
  const errors = [];
  let all = [];
  settled.forEach(function(r) {
    if (r.status === 'fulfilled') all = all.concat(r.value);
    else errors.push(r.reason.message || String(r.reason));
  });
  if (!all.length) throw new Error('all queries failed - ' + errors.join(' / '));

  const now = Date.now();
  const cutoff = now - MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  const kwRe = new RegExp(RELEVANCE_KEYWORDS.join('|'));

  const normalized = all.map(function(it) {
    const d = it.pubDate ? new Date(it.pubDate) : null;
    return { title: it.title, src: it.src, date: d, link: it.link || null, via: it.via };
  }).filter(function(it) {
    return it.title && kwRe.test(it.title) && it.date && !isNaN(it.date) && it.date.getTime() >= cutoff && it.date.getTime() <= now + 24 * 60 * 60 * 1000;
  });

  normalized.sort(function(a, b) { return b.date - a.date; });

  const seen = new Set();
  const deduped = [];
  for (let i = 0; i < normalized.length; i++) {
    const it = normalized[i];
    const key = it.title.replace(/\s+/g, '');
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(it);
    if (deduped.length >= MAX_ITEMS) break;
  }

  const items = deduped.map(function(it) {
    const g = guessType(it.title);
    return { type: g.type, tag: g.tag, title: it.title, date: fmtDate(it.date), src: it.src, link: it.link };
  });
  const vias = [...new Set(deduped.map(function(it) { return it.via; }))];

  return {
    items: items,
    count: items.length,
    windowDays: MAX_AGE_DAYS,
    fetchedAt: new Date(now).toISOString(),
    warnings: errors.length ? errors : undefined,
    source: vias.length === 1 && vias[0] === 'bing' ? 'Bing 뉴스 검색(다수 언론사 기사 집계)'
      : vias.includes('bing') ? 'Google·Bing 뉴스 검색(다수 언론사 기사 집계)'
      : 'Google 뉴스 검색(다수 언론사 실시간 기사 집계)',
  };
}

/* ── 마지막 성공값(last-good) — KV(JINGA_KV) 바인딩이 있으면 KV, 없으면 엣지 캐시 14일 ── */
async function saveLastGood(env, data) {
  const record = JSON.stringify({ savedAt: new Date().toISOString(), data: data });
  if (env.JINGA_KV) {
    try { await env.JINGA_KV.put('lastgood:policy', record); } catch (e) { console.log('[last-good] KV 저장 실패: ' + (e.message || e)); }
  }
  try {
    await caches.default.put(new Request(LAST_GOOD_KEY), new Response(record, {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=' + LAST_GOOD_TTL_SECONDS },
    }));
  } catch (e) { console.log('[last-good] 캐시 저장 실패: ' + (e.message || e)); }
}

async function loadLastGood(env) {
  if (env.JINGA_KV) {
    try { const v = await env.JINGA_KV.get('lastgood:policy'); if (v) return JSON.parse(v); } catch (e) { /* 캐시로 대체 */ }
  }
  try {
    const hit = await caches.default.match(new Request(LAST_GOOD_KEY));
    if (hit) return await hit.json();
  } catch (e) { /* 없음 */ }
  return null;
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }
    const url = new URL(request.url);
    const cache = caches.default;
    const cacheKey = new Request(url.toString(), request);
    const cached = await cache.match(cacheKey);
    if (cached) return cached;

    let body, status = 200;
    if (url.pathname === '/policy') {
      try {
        const data = await fetchPolicyNews();
        await saveLastGood(env, data);
        body = { ok: true, data: data };
      } catch (e) {
        const prev = await loadLastGood(env);
        if (prev && prev.data) {
          body = { ok: true, stale: true, staleSince: prev.savedAt, error: String(e.message || e), data: prev.data };
        } else {
          status = 502;
          body = { ok: false, error: String(e.message || e) };
        }
      }
    } else {
      body = { ok: true, service: 'policy-news-proxy', endpoints: ['/policy'], sources: ['google', 'bing'], lastGoodStore: env.JINGA_KV ? 'kv' : 'edge-cache' };
    }

    // 실패(502)는 캐시하지 않음 — 이전 버전은 실패 응답에도 max-age를 붙여 브라우저가 30분간 실패를 재사용했음
    const response = new Response(JSON.stringify(body), {
      status: status,
      headers: corsHeaders(status === 200
        ? { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=' + (body.stale ? STALE_CACHE_TTL_SECONDS : CACHE_TTL_SECONDS) }
        : { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }),
    });
    if (status === 200) await cache.put(cacheKey, response.clone());
    return response;
  },

  // Cron 트리거: 방문자가 없어도 매시간 뉴스를 조회해 마지막 성공값을 갱신
  async scheduled(event, env, ctx) {
    ctx.waitUntil(fetchPolicyNews().then(
      function(data) { return saveLastGood(env, data); },
      function(e) { console.log('[cron] policy 실패: ' + (e.message || e)); }
    ));
  },
};
