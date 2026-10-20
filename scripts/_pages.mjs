// 단지·자치구 정적 페이지 — **조립 부분**(파일을 쓰지 않습니다. 그래서 테스트할 수 있습니다)
//
// 왜 만드나 — 지금 검색엔진이 읽을 수 있는 페이지가 index/admin/legal 세 장뿐입니다.
// 국토부 공식 자료를 1,000개 넘는 단지만큼 들고 있으면서 「고덕그라시움 지하주차」로 검색하면
// 아무것도 안 나옵니다. 가진 자료를 **검색에 걸리는 모양**으로 내보내는 것이 이 파일이 하는 일입니다.
//
// 만드는 페이지
//   /apt/<id>-<단지명>/   국토부 공식 자료가 있는 단지만(자료가 빈 페이지는 오히려 해가 됩니다)
//   /gu/<자치구>/         구 요약 + 그 구 단지 목록
//   /apt/                 전체 입구
//
// 규칙 — **모르는 값은 그 줄을 통째로 빼 둡니다.** 빈칸을 0 으로 적으면 「지하주차 0대」 같은
// 거짓이 되고, 그런 페이지가 1,000장이면 사이트 전체의 신뢰가 무너집니다.

export const SITE = 'https://jinga-retech.vercel.app';
export const BRAND = '진가 JINGA';

const H = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => H[c]);

const num = v => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};
export const man = n => (n == null ? null : Math.round(n).toLocaleString('ko-KR'));

/** 주소에 쓸 조각 — 한글은 그대로 둡니다(네이버·구글 모두 한글 주소를 읽습니다) */
export function slug(s) {
  return String(s ?? '')
    .replace(/\s+/g, '')
    .replace(/[^0-9A-Za-z가-힣ㄱ-ㅎㅏ-ㅣ]/g, '')
    .slice(0, 40) || 'x';
}

/**
 * 검색엔진에 알려 줄 때 쓰는 주소 — 한글을 퍼센트 인코딩합니다.
 * 브라우저는 알아서 바꿔 주지만 **sitemap 과 canonical 은 바꿔 주지 않습니다.**
 * 크롤러가 받아 가는 주소(인코딩된 것)와 canonical 이 다르면 같은 페이지로 보지 않습니다.
 */
export const encPath = p => String(p).split('/').map(encodeURIComponent).join('/');

/** 단지 하나의 주소 — 이름이 겹치는 단지가 29종류라 번호를 앞에 붙여 갈라 둡니다 */
export const aptPath = c => `/apt/${c.id}-${slug(c.name)}/`;
export const guPath = g => `/gu/${slug(g)}/`;

/** 'YYYYMMDD' → '2001년 3월' */
export function usedText(v) {
  const t = String(v || '').trim();
  if (!/^\d{8}$/.test(t)) return null;
  const y = Number(t.slice(0, 4)), m = Number(t.slice(4, 6));
  if (!(y >= 1960 && y <= 2100)) return null;
  return m >= 1 && m <= 12 ? `${y}년 ${m}월` : `${y}년`;
}
export const yearOf = v => {
  const t = usedText(v);
  return t ? Number(t.slice(0, 4)) : null;
};

/** 세대당 주차 대수 — 모르면 null (0 으로 치면 「주차 없음」이 됩니다) */
export function parkPerHouse(k, households) {
  const u = num(k && k.parkUnder), g = num(k && k.parkGround), hh = num(households);
  if (u == null && g == null) return null;
  if (!(hh > 0)) return null;
  return Math.round(((u || 0) + (g || 0)) / hh * 100) / 100;
}

/** 주차를 한 줄로 — 「지하 804대 · 지상 238대」 */
export function parkText(k) {
  const u = num(k && k.parkUnder), g = num(k && k.parkGround);
  if (u == null && g == null) return null;
  if (!u) return g ? `지하주차장 없음 · 지상 ${man(g)}대` : '지하주차장 없음';
  return `지하 ${man(u)}대${g ? ` · 지상 ${man(g)}대` : ''}`;
}

export function areaMix(k) {
  return [[k.area60, '60㎡ 이하'], [k.area85, '60~85㎡'], [k.area135, '85~135㎡'], [k.area136, '135㎡ 초과']]
    .filter(([n]) => num(n) > 0)
    .map(([n, label]) => ({ label, n: num(n) }));
}

/** 임대 비율(%) — 한쪽이라도 모르면 null */
export function rentPct(c) {
  const hh = num(c.households), r = num(c.rentUnits);
  return hh > 0 && r != null ? Math.round(r / hh * 1000) / 10 : null;
}

const row = (label, value) => (value == null || value === '' ? '' :
  `<tr><th>${esc(label)}</th><td>${esc(String(value))}</td></tr>`);

const page = ({ title, desc, path, body, extraHead = '' }) => `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${SITE}${encPath(path)}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="${esc(BRAND)}">
<meta property="og:locale" content="ko_KR">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${SITE}${encPath(path)}">
<meta property="og:image" content="${SITE}/og.png">
<meta name="twitter:card" content="summary_large_image">
<link rel="stylesheet" href="/pages.css">
<link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png">
${extraHead}</head>
<body>
<header class="top"><a class="brand" href="${SITE}/">진가 <span>JINGA</span></a>
<nav><a href="/apt/">단지 찾기</a><a href="${SITE}/">예산으로 비교</a></nav></header>
<main>
${body}
</main>
<footer>
<p><a href="${SITE}/">진가에서 예산·면적을 넣고 조건에 맞는 단지 비교하기</a></p>
<p class="dim">KB부동산 공개 시세와 국토교통부 공동주택관리정보시스템(K-apt) 공개 자료를 참고 목적으로 정리한 페이지입니다.
투자 자문이나 중개가 아니며, 실제 거래가·현황과 다를 수 있습니다.
<a href="${SITE}/legal.html">데이터 출처와 한계</a></p>
</footer>
</body>
</html>
`;

/** 단지 한 장 */
export function aptPage(c, k, ctx = {}) {
  const path = aptPath(c);
  const per = parkPerHouse(k, k.households || c.households);
  const park = parkText(k);
  const used = usedText(k.usedAt || c.approved);
  const mix = areaMix(k);
  const rp = rentPct(c);
  const where = `${c.gu} ${c.dong}`;

  // 제목·설명에 사람들이 실제로 검색하는 말을 넣습니다
  const bits = [
    c.households ? `${man(c.households)}세대` : null,
    k.dongs ? `${k.dongs}개 동` : null,
    used,
    per != null ? `세대당 주차 ${per}대` : null,
  ].filter(Boolean);
  const title = `${c.name} (${where}) ${park ? '지하주차·' : ''}세대수·평형 — ${BRAND}`;
  const desc = `${c.name} ${where} — ${bits.join(' · ')}${park ? `. 주차 ${park}` : ''}` +
    `${k.subwayStation ? `. 지하철 ${k.subwayStation}${k.subwayWalk ? ` 도보 ${k.subwayWalk}` : ''}` : ''}.` +
    ' 국토교통부 공식 자료로 정리했습니다.';

  const facts = [
    row('세대수', c.households ? `${man(c.households)}세대` : null),
    row('동수', k.dongs ? `${k.dongs}개 동` : null),
    row('사용승인', used),
    row('주차', park && per != null ? `${park} (세대당 ${per}대)` : park),
    row('승강기', k.lifts ? `${man(k.lifts)}대` : null),
    row('복도 구조', k.hall || c.hall),
    row('난방', k.heat),
    row('층', k.topFloor ? `지상 ${k.topFloor}층${k.baseFloor ? ` · 지하 ${k.baseFloor}층` : ''}` : null),
    row('용적률', c.far ? `${c.far}%` : null),
    row('분양 형태', k.sale),
    row('관리 방식', k.manage),
    row('구조', k.struct),
    row('지하철', k.subwayStation ? `${k.subwayStation}${k.subwayLine ? `(${k.subwayLine})` : ''}${k.subwayWalk ? ` · 도보 ${k.subwayWalk}` : ''}` : null),
    row('버스', k.busWalk ? `도보 ${k.busWalk}` : null),
    row('CCTV', k.cctv ? `${man(k.cctv)}대` : null),
    row('전기차 충전', (num(k.evUnder) || num(k.evGround)) ? `지하 ${num(k.evUnder) || 0}기 · 지상 ${num(k.evGround) || 0}기` : null),
    row('임대세대', rp != null && rp > 0 ? `${man(c.rentUnits)}세대 (${rp}%)` : null),
  ].filter(Boolean).join('');

  // 주차는 시세표에 없는 값이라 따로 크게 — 이 페이지의 존재 이유입니다
  const parkCard = per != null ? `
  <section class="hl">
    <div class="hl-n">세대당 ${per}대</div>
    <div class="hl-t">${esc(park)}</div>
    <p>${per < 1
      ? '세대당 한 대가 안 됩니다. 차가 두 대인 집은 저녁에 자리를 찾기 어려울 수 있습니다.'
      : per < 1.2 ? '세대당 한 대는 넘습니다. 두 대를 대려면 빠듯할 수 있습니다.'
      : '주차는 넉넉한 편입니다.'}</p>
  </section>` : '';

  const mixTable = mix.length ? `
  <h2>면적대별 세대수</h2>
  <table class="t"><tbody>${mix.map(m => row(m.label, `${man(m.n)}세대`)).join('')}</tbody></table>` : '';

  const near = (ctx.sameDong || []).filter(x => x.id !== c.id).slice(0, 8);
  const nearList = near.length ? `
  <h2>${esc(c.dong)}의 다른 단지</h2>
  <ul class="links">${near.map(x =>
    `<li><a href="${aptPath(x)}">${esc(x.name)}</a>${x.households ? ` <span class="dim">${man(x.households)}세대</span>` : ''}</li>`).join('')}</ul>` : '';

  const jsonld = {
    '@context': 'https://schema.org', '@type': 'ApartmentComplex',
    name: c.name, url: SITE + encPath(path),
    address: { '@type': 'PostalAddress', addressRegion: '서울특별시', addressLocality: c.gu, streetAddress: c.dong, addressCountry: 'KR' },
    ...(c.households ? { numberOfAccommodationUnits: c.households } : {}),
    ...(c.lat && c.lng ? { geo: { '@type': 'GeoCoordinates', latitude: c.lat, longitude: c.lng } } : {}),
  };

  const body = `
  <nav class="crumb"><a href="/apt/">단지</a> › <a href="${guPath(c.gu)}">${esc(c.gu)}</a> › ${esc(c.name)}</nav>
  <h1>${esc(c.name)}</h1>
  <p class="sub">${esc(where)}${bits.length ? ` · ${esc(bits.join(' · '))}` : ''}</p>
  ${parkCard}
  <h2>단지 정보 <span class="src">국토교통부 공식 자료</span></h2>
  <table class="t"><tbody>${facts}</tbody></table>
  ${mixTable}
  ${k.education ? `<h2>학교</h2><p>${esc(k.education)}</p>` : ''}
  ${k.welfare ? `<h2>부대시설</h2><p>${esc(k.welfare)}</p>` : ''}
  <section class="cta">
    <h2>이 단지, 같은 돈이면 어디가 나을까</h2>
    <p>예산과 면적을 넣으면 ${esc(c.gu)}에서 조건에 맞는 단지를 점수순으로 추려 줍니다. 무료·로그인 없음.</p>
    <p><a class="btn" href="${SITE}/?utm_source=aptpage&amp;utm_content=${encodeURIComponent(c.name)}">진가에서 비교해 보기</a></p>
  </section>
  <section class="note">
    <h2>여기에 없는 것</h2>
    <p><b>몇 베이인지</b>와 <b>지하주차장에서 엘리베이터로 바로 가는지</b>는 어떤 공개 자료에도 없습니다.
    가 보신 분이 알려 주셔야 쌓입니다 — <a href="${SITE}/?utm_source=aptpage">진가 커뮤니티</a>에서 남길 수 있습니다.</p>
  </section>
  ${nearList}`;

  return { path, title, desc,
    html: page({ title, desc, path, body,
      extraHead: `<script type="application/ld+json">${JSON.stringify(jsonld)}</script>\n` }) };
}

/** 자치구 한 장 */
export function guPage(gu, rows, info = {}) {
  const path = guPath(gu);
  const withK = rows.filter(r => r.k);
  const parks = withK
    .map(r => ({ r, per: parkPerHouse(r.k, r.k.households || r.households) }))
    .filter(x => x.per != null);
  const roomy = [...parks].sort((a, b) => b.per - a.per).slice(0, 5);
  const tight = parks.filter(x => x.per < 1).sort((a, b) => a.per - b.per).slice(0, 5);
  const big = [...rows].filter(r => r.households).sort((a, b) => b.households - a.households).slice(0, 10);

  const pp = num(info.avgPerPyeong);
  const title = `${gu} 아파트 ${pp ? `평당 ${man(pp)}만원 · ` : ''}단지 ${man(rows.length)}곳 — ${BRAND}`;
  const desc = `${gu} 아파트 ${man(rows.length)}곳의 세대수·준공·지하주차 대수를 국토교통부 공식 자료로 정리했습니다.`
    + (pp ? ` 평당 ${man(pp)}만원${info.vsSeoul ? `(서울 평균의 ${info.vsSeoul}%)` : ''}.` : '');

  const dongs = (info.dongs || []).filter(d => num(d.avgPerPyeong) > 0 && num(d.count) >= 2)
    .sort((a, b) => b.avgPerPyeong - a.avgPerPyeong);

  const body = `
  <nav class="crumb"><a href="/apt/">단지</a> › ${esc(gu)}</nav>
  <h1>${esc(gu)} 아파트</h1>
  <p class="sub">단지 ${man(rows.length)}곳${pp ? ` · 평당 ${man(pp)}만원` : ''}${info.vsSeoul ? ` (서울 평균의 ${info.vsSeoul}%)` : ''}${info.asOf ? ` · KB시세 ${esc(info.asOf)} 기준` : ''}</p>

  ${dongs.length >= 2 ? `<h2>동네별 평당가</h2>
  <table class="t"><tbody>${dongs.slice(0, 12).map(d =>
    row(d.name, `${man(d.avgPerPyeong)}만원 · ${man(d.count)}개 단지`)).join('')}</tbody></table>
  <p class="dim">단지가 2곳 이상인 동만 셉니다. 한 곳뿐인 동은 「동네 평균」이라 부르기 어렵습니다.</p>` : ''}

  ${roomy.length ? `<h2>주차가 넉넉한 단지 <span class="src">국토교통부 공식 자료</span></h2>
  <ul class="links">${roomy.map(x =>
    `<li><a href="${aptPath(x.r)}">${esc(x.r.name)}</a> <span class="dim">세대당 ${x.per}대 · ${esc(x.r.dong)}</span></li>`).join('')}</ul>` : ''}

  ${tight.length ? `<h2>주차가 빠듯한 단지 (세대당 1대 미만)</h2>
  <ul class="links">${tight.map(x =>
    `<li><a href="${aptPath(x.r)}">${esc(x.r.name)}</a> <span class="dim">세대당 ${x.per}대 · ${esc(x.r.dong)}</span></li>`).join('')}</ul>` : ''}

  ${big.length ? `<h2>세대수가 많은 단지</h2>
  <ul class="links">${big.map(r =>
    `<li><a href="${aptPath(r)}">${esc(r.name)}</a> <span class="dim">${man(r.households)}세대 · ${esc(r.dong)}</span></li>`).join('')}</ul>` : ''}

  <section class="cta">
    <h2>${esc(gu)}에서 예산에 맞는 단지 찾기</h2>
    <p>예산·면적·세대수를 넣으면 조건에 맞는 단지를 점수순으로 5곳 추려 줍니다. 전체 데이터는 엑셀로 받을 수 있습니다.</p>
    <p><a class="btn" href="${SITE}/?utm_source=gupage&amp;utm_content=${encodeURIComponent(gu)}">진가에서 ${esc(gu)} 찾아보기</a></p>
  </section>

  <h2>${esc(gu)} 단지 전체 (${man(rows.length)}곳)</h2>
  <ul class="links cols">${[...rows].sort((a, b) => a.name.localeCompare(b.name, 'ko')).map(r =>
    `<li><a href="${aptPath(r)}">${esc(r.name)}</a> <span class="dim">${esc(r.dong)}</span></li>`).join('')}</ul>`;

  return { path, title, desc, html: page({ title, desc, path, body }) };
}

/** 입구 — 25개 구로 갈라집니다 */
export function hubPage(guRows, total) {
  const path = '/apt/';
  const title = `서울 아파트 단지 정보 — 지하주차·세대수·평형 | ${BRAND}`;
  const desc = `서울 아파트 ${man(total)}곳의 세대수·동수·지하주차 대수·승강기·면적대별 세대수를 `
    + '국토교통부 공동주택관리정보시스템(K-apt) 공식 자료로 정리했습니다. 자치구별로 찾아보세요.';
  const body = `
  <h1>서울 아파트 단지 정보</h1>
  <p class="sub">${man(total)}곳 · 국토교통부 공식 자료</p>
  <p>시세표에는 나오지 않는 <b>지하주차 대수·세대당 주차·승강기·면적대별 세대수</b>를 단지마다 정리했습니다.
  관리주체가 국토교통부에 신고한 공식 숫자입니다.</p>
  <h2>자치구로 찾기</h2>
  <ul class="links cols">${guRows.map(g =>
    `<li><a href="${guPath(g.gu)}">${esc(g.gu)}</a> <span class="dim">${man(g.n)}곳</span></li>`).join('')}</ul>
  <section class="cta">
    <h2>예산으로 찾고 싶다면</h2>
    <p>예산·면적·세대수·임대세대 비율을 넣으면 조건에 맞는 단지를 점수순으로 추려 줍니다.</p>
    <p><a class="btn" href="${SITE}/?utm_source=apthub">진가에서 비교해 보기</a></p>
  </section>`;
  return { path, title, desc, html: page({ title, desc, path, body }) };
}

/** sitemap.xml — 만든 페이지를 전부 넣습니다 */
export function sitemap(paths, today) {
  const d = today || new Date().toISOString().slice(0, 10);
  const url = (loc, pri, freq) =>
    `  <url><loc>${SITE}${encPath(loc)}</loc><lastmod>${d}</lastmod><changefreq>${freq}</changefreq><priority>${pri}</priority></url>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${url('/', '1.0', 'daily')}
${url('/apt/', '0.8', 'weekly')}
${paths.map(p => url(p, p.startsWith('/gu/') ? '0.7' : '0.5', 'monthly')).join('\n')}
${url('/legal.html', '0.3', 'monthly')}
</urlset>
`;
}

export const CSS = `/* 단지·자치구 페이지 — 가볍게. 검색에서 들어온 사람이 먼저 보는 화면이라 빨리 떠야 합니다 */
:root{--ink:#14181d;--muted:#5e6a76;--line:#e2e6ea;--blue:#1b64da;--bg:#f6f8fa;color-scheme:light}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);line-height:1.7;
 font-family:Pretendard,-apple-system,BlinkMacSystemFont,"Malgun Gothic","맑은 고딕",sans-serif;
 font-size:16px;-webkit-text-size-adjust:100%}
a{color:var(--blue)}
.top{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;
 padding:14px 16px;background:#0e1c2b;color:#fff}
.top .brand{font-weight:800;font-size:19px;color:#fff;text-decoration:none;letter-spacing:-.5px}
.top .brand span{font-size:12px;color:#8fb4ea;font-weight:600;letter-spacing:2px;margin-left:4px}
.top nav a{color:#cfe0f5;text-decoration:none;font-size:14px;margin-left:14px}
.top nav a:hover{text-decoration:underline}
main{max-width:760px;margin:0 auto;padding:24px 16px 56px}
.crumb{font-size:13px;color:var(--muted);margin-bottom:10px}
.crumb a{color:var(--muted)}
h1{font-size:28px;line-height:1.3;margin:0 0 6px;letter-spacing:-.8px}
.sub{color:var(--muted);margin:0 0 22px;font-size:15px}
h2{font-size:19px;margin:34px 0 10px;letter-spacing:-.4px}
.src{font-size:12px;font-weight:600;color:var(--blue);background:#eaf1fd;border-radius:999px;padding:3px 9px;margin-left:6px;vertical-align:middle}
.t{width:100%;border-collapse:collapse;background:#fff;border:1px solid var(--line);border-radius:10px;overflow:hidden}
.t th,.t td{padding:10px 14px;border-bottom:1px solid var(--line);text-align:left;font-size:15px}
.t tr:last-child th,.t tr:last-child td{border-bottom:0}
.t th{width:38%;color:var(--muted);font-weight:600;background:#fbfcfd}
.t td{font-weight:600}
.hl{background:#fff;border:1px solid var(--line);border-left:4px solid var(--blue);border-radius:10px;padding:16px 18px;margin:0 0 8px}
.hl-n{font-size:30px;font-weight:800;letter-spacing:-1px;color:var(--blue)}
.hl-t{font-weight:700;margin-top:2px}
.hl p{margin:8px 0 0;color:var(--muted);font-size:14.5px}
.links{list-style:none;padding:0;margin:0}
.links li{padding:8px 0;border-bottom:1px solid var(--line)}
.links a{font-weight:600;text-decoration:none}
.links a:hover{text-decoration:underline}
.cols{column-width:220px;column-gap:26px}
.cols li{break-inside:avoid}
.dim{color:var(--muted);font-weight:400;font-size:13.5px}
.cta{background:#fff;border:1px solid var(--line);border-radius:12px;padding:20px 22px;margin:34px 0}
.cta h2{margin-top:0}
.cta p{margin:0 0 12px;color:var(--muted);font-size:15px}
.btn{display:inline-block;background:var(--blue);color:#fff;text-decoration:none;font-weight:700;
 padding:11px 20px;border-radius:8px}
.note{background:#fffbe9;border:1px solid #f0e0a8;border-radius:12px;padding:16px 20px;margin:28px 0}
.note h2{margin-top:0;font-size:17px}
.note p{margin:0;font-size:14.5px}
footer{max-width:760px;margin:0 auto;padding:0 16px 56px;font-size:13.5px}
footer p{margin:0 0 10px}
footer .dim{line-height:1.65}
@media(max-width:480px){h1{font-size:23px}main{padding-top:18px}.t th{width:42%}.t th,.t td{padding:9px 11px;font-size:14.5px}}
`;
