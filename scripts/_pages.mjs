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

/**
 * 지역 — 서울은 「자치구」, 경기는 「시」입니다. 주소 표기(addressRegion)도 달라야
 * 검색엔진이 엉뚱한 지역으로 읽지 않습니다. 단지 id 와 지역 이름은 둘 사이에 겹치지 않습니다(확인함).
 */
export const REGIONS = {
  seoul:    { key: 'seoul',    label: '서울', full: '서울특별시', unit: '자치구' },
  gyeonggi: { key: 'gyeonggi', label: '경기', full: '경기도',     unit: '시' },
};
export const regionOf = k => REGIONS[k] || REGIONS.seoul;
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

/**
 * 단지 하나의 주소 — 이름이 겹치는 단지가 29종류라 번호를 앞에 붙여 갈라 둡니다.
 * **주소는 처음 만든 이름(slugName)으로 고정합니다.** 2026-11-20 에 화면 이름을 국토교통부 공식 이름으로
 * 바꾸면서(「논현(신동아)」 → 「논현신동아」) 594곳의 주소가 한꺼번에 바뀔 뻔했습니다.
 * 이제 막 검색에 잡히기 시작한 2,000장이 전부 끊기므로, 보이는 이름만 바꾸고 주소는 그대로 둡니다.
 */
export const aptPath = c => `/apt/${c.id}-${slug(c.slugName || c.name)}/`;
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

/**
 * 두 출처가 「세대당 1대」를 같은 쪽으로 보는가.
 * true 일 때만 단지 이름을 목록에 올립니다 — 한쪽만 보고 「주차 빠듯한 곳」이라 적었다가
 * 2026-11-12 에 명일 신동아(K-apt 0.62 · KB 1.05)로 지적을 받았습니다.
 * 한쪽을 모르면 null — 모르는 것은 「같다」도 「다르다」도 아닙니다.
 */
export function sourcesAgree(kaptPer, kbPer) {
  if (kaptPer == null || kbPer == null) return null;
  return (kaptPer < 1) === (kbPer < 1);
}

/** 주차 한 마디 — 두 출처가 엇갈리면 단정하지 않습니다 */
export function parkAdvice(per, kbPer) {
  if (per == null) return '';
  if (sourcesAgree(per, kbPer) === false) {
    return '두 자료가 세대당 한 대를 두고 엇갈립니다. 실제 사정은 관리사무소에 확인해 보시는 편이 확실합니다.';
  }
  if (per < 1) return '세대당 한 대가 안 됩니다. 차가 두 대인 집은 저녁에 자리를 찾기 어려울 수 있습니다.';
  if (per < 1.2) return '세대당 한 대는 넘습니다. 두 대를 대려면 빠듯할 수 있습니다.';
  return '주차는 넉넉한 편입니다.';
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

/** 값에 태그를 넣어야 할 때만. **들어가는 값은 부르는 쪽에서 esc 해 두어야 합니다.** */
const rowHtml = (label, html) => (html == null || html === '' ? '' :
  `<tr><th>${esc(label)}</th><td>${html}</td></tr>`);

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
<script>/* 방문 발자국 — 날짜·유입처·utm·화면폭·화면갈래만 보냅니다. 사람을 식별하지 않습니다(api/_stats.mjs).
   이 페이지들이 검색에서 들어오는 입구라 여기가 빠지면 「색인이 먹히고 있나」가 통째로 안 보입니다. */
(function(){try{if(sessionStorage.getItem('jinga_hit'))return;sessionStorage.setItem('jinga_hit','1')}catch(e){}
var b=JSON.stringify({action:'hit',ref:document.referrer||'',url:location.href,w:window.innerWidth||0});
try{if(navigator.sendBeacon&&navigator.sendBeacon('/api/community',new Blob([b],{type:'application/json'})))return}catch(e){}
fetch('/api/community',{method:'POST',headers:{'Content-Type':'application/json'},body:b,keepalive:true}).catch(function(){})})();</script>
</body>
</html>
`;

/** 단지 한 장 */
export function aptPage(c, k, ctx = {}) {
  const R = regionOf(ctx.region);
  const path = aptPath(c);
  const per = parkPerHouse(k, k.households || c.households);
  const kbTotal = num(ctx.kbPark && ctx.kbPark.total);
  const kbPer = num(ctx.kbPark && ctx.kbPark.per);
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
    row('주차 (K-apt)', park && per != null ? `${park} (세대당 ${per}대)` : park),
    row('주차 (KB부동산)', kbPer != null ? `${kbTotal != null ? `${man(kbTotal)}대 · ` : ''}세대당 ${kbPer}대` : null),
    row('승강기', k.lifts ? `${man(k.lifts)}대` : null),
    row('복도 구조', k.hall || c.hall),
    row('난방', k.heat),
    row('층', k.topFloor ? `지상 ${k.topFloor}층${k.baseFloor ? ` · 지하 ${k.baseFloor}층` : ''}` : null),
    row('분양 형태', k.sale),
    row('관리 방식', k.manage),
    row('구조', k.struct),
    // 용적률·임대세대는 **KB 수집물에서만** 오던 값이라 2026-11-20 에 뺐습니다.
    // 이 페이지는 「국토교통부 공식 자료」라고 적혀 있는데 그 두 줄만 출처가 달랐습니다.
    // 용적률은 건축물대장(공공데이터포털 15134735)으로 다시 넣을 수 있습니다 — 지번을 먼저 붙여야 합니다.
    row('지하철', k.subwayStation ? `${k.subwayStation}${k.subwayLine ? `(${k.subwayLine})` : ''}${k.subwayWalk ? ` · 도보 ${k.subwayWalk}` : ''}` : null),
    row('버스', k.busWalk ? `도보 ${k.busWalk}` : null),
    row('CCTV', k.cctv ? `${man(k.cctv)}대` : null),
    row('전기차 충전', (num(k.evUnder) || num(k.evGround)) ? `지하 ${num(k.evUnder) || 0}기 · 지상 ${num(k.evGround) || 0}기` : null),
  ].filter(Boolean).join('');

  // 주차는 시세표에 없는 값이라 따로 크게 — 이 페이지의 존재 이유입니다.
  // 두 출처가 자주 어긋나므로(서울 1,035곳 중 603곳) 어느 쪽도 고르지 않고 둘 다 보여 줍니다.
  const parkCard = per != null ? `
  <section class="hl">
    <div class="hl-n">세대당 ${per}대</div>
    <div class="hl-t">${esc(park)} <span class="src">국토교통부 K-apt</span></div>
    ${kbPer != null && kbPer !== per ? `
    <div class="alt"><b>KB부동산은 세대당 ${kbPer}대</b>${kbTotal != null ? ` (총 ${man(kbTotal)}대)` : ''}로 올려 두었습니다.
      두 자료가 다릅니다 — 어느 쪽이 맞다고 저희가 고르지 않고 둘 다 보여 드립니다.</div>` : ''}
    <p>${parkAdvice(per, kbPer)}</p>
  </section>` : '';

  const mixTable = mix.length ? `
  <h2>면적대별 세대수</h2>
  <table class="t"><tbody>${mix.map(m => row(m.label, `${man(m.n)}세대`)).join('')}</tbody></table>` : '';

  // ── 실거래 기반 추정 시세 ──────────────────────────────────────────────────
  // 자료는 국토교통부 실거래가, 계산은 저희 것(J-AVM v2 — docs/model-card.md).
  // **모델 카드가 요구하는 여섯 가지를 한 화면에 함께 적습니다**: 추정치·범위·거래 건수·등급·기준월·출처.
  // 하나라도 빠지면 추정치가 실거래가처럼 읽힙니다. 특히 등급 D 는 대표값 없이 범위만 적습니다.
  const tp = ctx.tradePrice || null;
  const GRADE_NOTE = { A: '최근 3개월 거래로 계산', B: '최근 6개월까지 넓혀 계산', C: '최근 1년까지 넓혀 계산', D: '거래가 적어 범위만' };
  const priceTable = tp && tp.areas && tp.areas.length ? `
  <h2>실거래로 본 시세 <span class="src">국토교통부 실거래가 · 진가 추정</span></h2>
  <table class="t"><tbody>${tp.areas.map(a => rowHtml(
    `전용 ${a.area}㎡`,
    `${a.amount ? `<b>${Math.round(a.amount / 1000) / 10}억</b> ` : ''}`
    + `<span class="dim">${Math.round(a.low / 1000) / 10}~${Math.round(a.high / 1000) / 10}억 · `
    + `거래 ${man(a.n)}건 · ${esc(a.grade)}등급${a.amount ? '' : ' (대표값 없음)'}</span>`)).join('')}</tbody></table>
  <p class="dim"><b>추정치이며 실거래가가 아닙니다.</b>
  ${esc(String(tp.asOfYM).slice(0, 4))}년 ${Number(String(tp.asOfYM).slice(4))}월 기준 ·
  같은 단지의 비슷한 면적 거래로 계산했습니다(${GRADE_NOTE[tp.areas[0].grade] || ''}).
  범위는 실제 거래의 약 85%가 들어오도록 잡았고, 거래가 1~2건뿐이면 대표값 없이 범위만 보여 드립니다.
  층·향·수리 상태는 반영하지 않았습니다 — 실거래 자료에 없습니다.
  산식은 <a href="${SITE}/?utm_source=aptpage">진가</a>에서 공개합니다.</p>` : '';

  const near = (ctx.sameDong || []).filter(x => x.id !== c.id).slice(0, 8);
  const nearList = near.length ? `
  <h2>${esc(c.dong)}의 다른 단지</h2>
  <ul class="links">${near.map(x =>
    `<li><a href="${aptPath(x)}">${esc(x.name)}</a>${x.households ? ` <span class="dim">${man(x.households)}세대</span>` : ''}</li>`).join('')}</ul>` : '';

  const jsonld = {
    '@context': 'https://schema.org', '@type': 'ApartmentComplex',
    name: c.name, url: SITE + encPath(path),
    address: { '@type': 'PostalAddress', addressRegion: R.full, addressLocality: c.gu, streetAddress: c.dong, addressCountry: 'KR' },
    ...(c.households ? { numberOfAccommodationUnits: c.households } : {}),
    // 좌표(lat/lng)도 KB 수집물이라 2026-11-20 에 뺐습니다 — 공공 지오코딩으로 다시 넣을 수 있습니다.
  };

  const body = `
  <nav class="crumb"><a href="/apt/">단지</a> › <a href="${guPath(c.gu)}">${esc(c.gu)}</a> › ${esc(c.name)}</nav>
  <h1>${esc(c.name)}</h1>
  <p class="sub">${esc(where)}${bits.length ? ` · ${esc(bits.join(' · '))}` : ''}</p>
  ${parkCard}
  ${priceTable}
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
  const R = regionOf(info.region);
  const path = guPath(gu);
  const withK = rows.filter(r => r.k);
  const parks = withK
    .map(r => ({ r, per: parkPerHouse(r.k, r.k.households || r.households), kbPer: num(r.kbPark && r.kbPark.per) }))
    .filter(x => x.per != null);
  // 단지 이름을 짚는 목록은 **두 출처가 같은 쪽을 가리킬 때만** 올립니다.
  // 한쪽만 보고 적었다가 틀리면, 그 단지 사는 분들에게는 남의 집 이야기가 아닙니다.
  const agreed = parks.filter(x => sourcesAgree(x.per, x.kbPer) === true);
  const roomy = agreed.filter(x => x.per >= 1).sort((a, b) => b.per - a.per).slice(0, 5);
  const tight = agreed.filter(x => x.per < 1).sort((a, b) => a.per - b.per).slice(0, 5);
  const disputed = parks.filter(x => sourcesAgree(x.per, x.kbPer) === false).length;
  const big = [...rows].filter(r => r.households).sort((a, b) => b.households - a.households).slice(0, 10);

  // 2026-11-19 — **이 페이지에는 시세를 싣지 않습니다.**
  // 평당가·동네별 시세는 KB부동산에서 모아 온 값이었습니다. 자치구 페이지는 검색에 그대로 색인되는
  // 공개 문서라, 매주 갱신해 올려 두는 것은 KB 자료를 계속 다시 배포하는 것과 같습니다
  // (KB 약관 제12조 제4항·제14조 제1항 제5호, 저작권법 제93조).
  // 남은 내용(세대수·준공·주차·승강기·재건축)은 전부 국토교통부 공공데이터라 그대로 둡니다.
  // 국토교통부 실거래 기반 가격이 준비되면 저희가 만든 값으로 다시 싣습니다.
  // ── 실거래로 본 평당가 ────────────────────────────────────────────────────
  // 2026-11-19 에 KB 시세를 내렸던 자리를, 2026-11-20 에 **국토교통부 실거래**로 되살립니다.
  // 같은 「평당가」라도 재는 것이 다릅니다 — KB 는 전 단지 시세 조사값, 이쪽은 **실제 거래된 것만**의 중앙값입니다.
  // 거래는 상대적으로 싼 물건에서 더 자주 일어나므로 KB 집계보다 낮게 나옵니다. 그 말을 화면에 적어 둡니다.
  const tr = info.trade || null;
  const trDongs = (tr && tr.dongs || []).slice(0, 12);
  const tradeBlock = tr && tr.perPyeong > 0 ? `
  <section class="hl">
    <div class="hl-n">평당 ${man(tr.perPyeong)}만원</div>
    <div class="hl-t">최근 ${tr.months}개월 실거래 ${man(tr.n)}건의 중앙값 <span class="src">국토교통부 실거래가</span></div>
    ${tr.seoul && tr.seoul.perPyeong ? `<p>서울 평균(${man(tr.seoul.perPyeong)}만원)의 ${Math.round(tr.perPyeong / tr.seoul.perPyeong * 1000) / 10}% 수준입니다.</p>` : ''}
    <div class="alt"><b>시세가 아니라 거래된 값입니다.</b> 실제로 팔린 집들의 평당가라,
      매물로 나와 있는 값이나 시세 조사값과는 다릅니다. 거래가 드문 달·동네일수록 흔들립니다.</div>
  </section>
  ${trDongs.length >= 2 ? `<h2>동네별 평당가 <span class="src">국토교통부 실거래가</span></h2>
  <table class="t"><tbody>${trDongs.map(d => row(d.name, `${man(d.perPyeong)}만원 · 거래 ${man(d.n)}건`)).join('')}</tbody></table>
  <p class="dim">최근 ${tr.months}개월에 <b>거래가 10건 이상인 동</b>만 셉니다. 두세 건으로 「동네 시세」라고 적을 수는 없습니다.</p>` : ''}` : '';

  const title = `${gu} 아파트 ${tr && tr.perPyeong ? `실거래 평당 ${man(tr.perPyeong)}만원 · ` : ''}단지별 주차·세대수 ${man(rows.length)}곳 — ${BRAND}`;
  const desc = `${gu} 아파트 ${man(rows.length)}곳의 세대수·준공·지하주차 대수를 국토교통부 공식 자료로 정리했습니다.`
    + ` ${R.full} ${gu}.`;

  const body = `
  <nav class="crumb"><a href="/apt/">단지</a> › ${esc(gu)}</nav>
  <h1>${esc(gu)} 아파트</h1>
  <p class="sub">단지 ${man(rows.length)}곳 · 국토교통부 공동주택관리정보시스템(K-apt) 공식 자료${info.kaptAsOf ? ` ${esc(info.kaptAsOf)} 기준` : ''}</p>
${tradeBlock}

  ${roomy.length ? `<h2>주차가 넉넉한 단지</h2>
  <ul class="links">${roomy.map(x =>
    `<li><a href="${aptPath(x.r)}">${esc(x.r.name)}</a> <span class="dim">세대당 ${x.per}대 · ${esc(x.r.dong)}</span></li>`).join('')}</ul>` : ''}

  ${tight.length ? `<h2>주차가 빠듯한 단지 (세대당 1대 미만)</h2>
  <ul class="links">${tight.map(x =>
    `<li><a href="${aptPath(x.r)}">${esc(x.r.name)}</a> <span class="dim">세대당 ${x.per}대 · ${esc(x.r.dong)}</span></li>`).join('')}</ul>` : ''}

  ${(roomy.length || tight.length) ? `<p class="dim">주차는 <b>국토교통부 K-apt 신고값과 KB부동산 단지정보가 서로 다른 경우가 많습니다</b>(서울 기준 절반 이상).
  그래서 이 두 목록에는 <b>두 자료가 모두 같은 쪽을 가리키는 단지만</b> 올립니다.
  ${disputed ? `${esc(gu)}에서 두 자료가 엇갈리는 단지 ${man(disputed)}곳은 목록에서 뺐습니다 — ` : ''}단지를 누르면 두 숫자를 다 보실 수 있습니다.</p>` : ''}

  ${big.length ? `<h2>세대수가 많은 단지</h2>
  <ul class="links">${big.map(r =>
    `<li><a href="${aptPath(r)}">${esc(r.name)}</a> <span class="dim">${man(r.households)}세대 · ${esc(r.dong)}</span></li>`).join('')}</ul>` : ''}

  <section class="cta">
    <h2>${esc(gu)}에서 예산에 맞는 단지 찾기</h2>
    <p>예산·면적·세대수를 넣으면 조건에 맞는 단지를 점수순으로 5곳 추려 줍니다. 전체 데이터는 엑셀로 받을 수 있습니다.</p>
    <p><a class="btn" href="${SITE}/?utm_source=gupage&amp;utm_content=${encodeURIComponent(gu)}">진가에서 ${esc(gu)} 찾아보기</a></p>
  </section>

  <h2>${esc(gu)} 단지 — 국토교통부 공식 자료가 있는 ${man(rows.length)}곳</h2>
  <ul class="links cols">${[...rows].sort((a, b) => a.name.localeCompare(b.name, 'ko')).map(r =>
    `<li><a href="${aptPath(r)}">${esc(r.name)}</a> <span class="dim">${esc(r.dong)}</span></li>`).join('')}</ul>`;

  return { path, title, desc, html: page({ title, desc, path, body }) };
}

/** 입구 — 25개 구로 갈라집니다 */
export function hubPage(groups, total) {
  const path = '/apt/';
  const names = groups.map(g => regionOf(g.region).label).join('·');
  const title = `${names} 아파트 단지 정보 — 지하주차·세대수·평형 | ${BRAND}`;
  const desc = `${names} 아파트 ${man(total)}곳의 세대수·동수·지하주차 대수·승강기·면적대별 세대수를 `
    + '국토교통부 공동주택관리정보시스템(K-apt) 공식 자료로 정리했습니다. 지역별로 찾아보세요.';
  const body = `
  <h1>${esc(names)} 아파트 단지 정보</h1>
  <p class="sub">${man(total)}곳 · 국토교통부 공식 자료</p>
  <p>시세표에는 나오지 않는 <b>지하주차 대수·세대당 주차·승강기·면적대별 세대수</b>를 단지마다 정리했습니다.
  관리주체가 국토교통부에 신고한 공식 숫자입니다.</p>
  ${groups.map(g => {
    const R = regionOf(g.region);
    return `<h2>${esc(R.label)} ${esc(R.unit)}로 찾기 <span class="dim">${man(g.rows.reduce((n, x) => n + x.n, 0))}곳</span></h2>
  <ul class="links cols">${g.rows.map(x =>
    `<li><a href="${guPath(x.gu)}">${esc(x.gu)}</a> <span class="dim">${man(x.n)}곳</span></li>`).join('')}</ul>`;
  }).join('')}
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
/* 두 자료가 어긋날 때 — 숨기지 않고 눈에 띄게 둡니다 */
.alt{margin-top:9px;padding:9px 11px;background:#fff8ec;border:1px solid #f0d9a8;border-radius:7px;font-size:13.5px;line-height:1.65;color:#6b4e12}
.alt b{color:#49340a}
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
