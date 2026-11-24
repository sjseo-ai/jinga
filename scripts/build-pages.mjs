// 단지·자치구 정적 페이지 찍어내기 — 파일을 쓰는 쪽(조립은 _pages.mjs)
//
//   node scripts/build-pages.mjs            전부 다시 만들기
//   node scripts/build-pages.mjs --clean    만든 것만 지우기
//
// 어디에 — site/public/apt/ · site/public/gu/ · site/public/pages.css · sitemap.xml
//   이 폴더들은 .gitignore 에 넣어 두었습니다(1,000장이 넘어 저장소가 무거워집니다).
//   배포할 때 build-site.mjs 가 먼저 이 스크립트를 돌리므로 **없어도 배포본에는 항상 들어갑니다.**
//
// 왜 K-apt 자료가 있는 단지만 — 세대수·준공만 있는 페이지는 어디에나 있는 정보라
// 검색에서 「내용 없는 페이지」로 깎입니다. 지하주차 대수처럼 **남들이 안 주는 값**이 있어야 값어치가 있습니다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { aptPage, guPage, hubPage, sitemap, aptPath, guPath, CSS, REGIONS } from './_pages.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUB = path.join(ROOT, 'site', 'public');
const OUT_APT = path.join(PUB, 'apt');
const OUT_GU = path.join(PUB, 'gu');

const read = f => JSON.parse(fs.readFileSync(path.join(PUB, f), 'utf8'));
const log = m => console.log(`[${new Date().toLocaleTimeString('ko-KR', { hour12: false })}] ${m}`);

function clean() {
  for (const d of [OUT_APT, OUT_GU]) fs.rmSync(d, { recursive: true, force: true });
}

/** 주소(/apt/123-이름/)를 실제 파일 경로로 */
const fileFor = urlPath => path.join(PUB, urlPath.replace(/^\//, '').replace(/\/$/, ''), 'index.html');

function write(urlPath, html) {
  const f = fileFor(urlPath);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, html);
}

/** 지역 한 곳의 재료 — 국토부 자료가 아직 없으면 null */
function loadRegion(key, say) {
  let kapt;
  try { kapt = read(`kapt-${key}.json`); }
  catch { say(`kapt-${key}.json 이 아직 없습니다 — ${REGIONS[key].label} 페이지는 건너뜁니다`); return null; }
  const kb = read(`kb-${key}-complexes.json`);
  // KB 가 보는 주차 — 국토부 신고값과 자주 다릅니다. 둘 다 싣기 위해 함께 읽습니다(없으면 그 줄만 빠집니다)
  // 실거래 기반 추정 시세(scripts/build-trade-prices.mjs) — 없으면 그 칸만 빠집니다
  let tradePrice = {}, tradeAsOf = null, tradeRegion = null;
  try { const tp = read('trade-price-' + key + '.json'); tradePrice = tp.byComplex || {}; tradeAsOf = tp.asOfYM; tradeRegion = tp.region || null; }
  catch { say('trade-price-' + key + '.json 이 없습니다 — 실거래 시세 없이 만듭니다'); }
  let kbPark = {};
  try { kbPark = read(`kb-${key}-parking.json`).byComplex || {}; }
  catch { say(`kb-${key}-parking.json 이 없습니다 — KB 주차는 빼고 만듭니다`); }
  // kb-{지역}-gu.json(평당가 집계)은 **더 읽지 않습니다** — 2026-11-19.
  // 자치구 페이지에 KB 시세를 싣지 않기로 했습니다(_pages.mjs guPage 주석 참고).
  // 파일은 블로그 연재 글감(post-draft.mjs)이 아직 쓰므로 지우지 않습니다.

  // 국토교통부 공식 단지 목록(15057332) — 이름·자치구·법정동의 **출처**이자 짝짓기 검산용(2026-11-20)
  let official = {};
  try { official = read(`kapt-list-${key}.json`).byCode || {}; }
  catch { say(`kapt-list-${key}.json 이 없습니다 — 공식 이름 대조 없이 만듭니다(npm run kapt:list)`); }

  const byComplex = kapt.byComplex || {};
  let wrongMatch = 0;
  const withK = kb.complexes
    .map(c => ({
      id: c[0], name: c[1], slugName: c[1], gu: c[2], dong: c[3], far: c[5], lat: c[7], lng: c[8],
      hall: c[10], approved: c[11], households: c[12], rentUnits: c[13],
      k: byComplex[String(c[0])] || null,
      kbPark: kbPark[String(c[0])] || null,
      tradePrice: tradePrice[String(c[0])] ? { ...tradePrice[String(c[0])], asOfYM: tradeAsOf } : null,
    }))
    .filter(r => r.k)
    .map(r => {
      const off = r.k.code ? official[r.k.code] : null;
      if (!off) return r;
      // **지역이 다르면 짝짓기가 틀린 것입니다.** 압구정 한양5차에 쌍문한양5차의 주차·세대수가 붙어 있었습니다.
      // 이름이 비슷해 잘못 붙은 것이라, 고치는 게 아니라 **빼는 것**이 맞습니다 — 어느 쪽이 맞는지 모르니까요.
      //
      // 무엇으로 비교하느냐는 지역마다 다릅니다.
      //   서울 — 공식 as2 가 「강남구」라 자치구를 그대로 견줍니다.
      //   경기 — 공식 as2 는 「수원시 장안구」인데 우리는 「수원」·「동탄」처럼 부릅니다(동탄은 화성시).
      //          이름 규칙이 서로 달라 자치구로는 견줄 수 없어, **법정동**으로 봅니다.
      // 경기는 우리 쪽 법정동이 「수정구 단대동」처럼 구를 달고 있어, **마지막 토막**만 견줍니다.
      const lastWord = s => String(s || '').trim().split(/\s+/).pop();
      const bad = key === 'seoul'
        ? (off.gu && off.gu !== r.gu)
        : (off.dong && r.dong && lastWord(off.dong) !== lastWord(r.dong));
      if (bad) { wrongMatch++; return { ...r, k: null }; }
      // 주소(slugName)는 그대로 두고 보이는 이름·법정동만 공식 값으로
      return { ...r, name: off.name || r.name, dong: off.dong || r.dong };
    })
    .filter(r => r.k);
  if (wrongMatch) say(`${REGIONS[key].label}: 국토부 자료가 **다른 단지에 붙어 있던 ${wrongMatch}곳**을 뺐습니다(공식 목록과 자치구 불일치)`);
  if (!withK.length) { say(`${REGIONS[key].label}: 국토부 자료가 붙은 단지가 없습니다`); return null; }
  return { key, withK, tradeRegion, kaptAsOf: (kapt.generatedAt || '').slice(0, 10).replace(/-/g, '.') };
}

export async function buildPages({ quiet = false } = {}) {
  const say = m => { if (!quiet) log(m); };
  const regions = Object.keys(REGIONS).map(k => loadRegion(k, say)).filter(Boolean);
  if (!regions.length) { say('만들 자료가 없습니다'); return { apt: 0, gu: 0, paths: [] }; }

  clean();
  fs.writeFileSync(path.join(PUB, 'pages.css'), CSS);

  const paths = [];
  const seen = new Set();
  const groups = [];
  let aptCount = 0, guCount = 0, total = 0;

  for (const R of regions) {
    // 같은 동 단지끼리 묶어 서로 링크를 겁니다 — 검색엔진이 페이지를 타고 들어오는 길이 됩니다
    const dongMap = new Map();
    for (const r of R.withK) {
      const key = `${r.gu}|${r.dong}`;
      if (!dongMap.has(key)) dongMap.set(key, []);
      dongMap.get(key).push(r);
    }

    for (const r of R.withK) {
      const p = aptPath(r);
      if (seen.has(p)) { say(`주소가 겹칩니다: ${p} (${r.name}) — 건너뜁니다`); continue; }
      seen.add(p);
      write(p, aptPage(r, r.k, { sameDong: dongMap.get(`${r.gu}|${r.dong}`) || [], region: R.key, kbPark: r.kbPark, tradePrice: r.tradePrice }).html);
      paths.push(p);
      aptCount++;
    }

    const names = [...new Set(R.withK.map(r => r.gu))].sort((a, b) => a.localeCompare(b, 'ko'));
    const rows = [];
    for (const g of names) {
      const mine = R.withK.filter(r => r.gu === g);
      write(guPath(g), guPage(g, mine, { region: R.key, kaptAsOf: R.kaptAsOf, trade: R.tradeRegion && R.tradeRegion.gu[g] ? { ...R.tradeRegion.gu[g], months: R.tradeRegion.months, seoul: R.tradeRegion.seoul } : null }).html);
      paths.push(guPath(g));
      rows.push({ gu: g, n: mine.length });
      guCount++;
    }
    groups.push({ region: R.key, rows });
    total += R.withK.length;
    say(`${REGIONS[R.key].label} — 단지 ${R.withK.length}장 · ${REGIONS[R.key].unit} ${names.length}장`);
  }

  write('/apt/', hubPage(groups, total).html);

  // sitemap — 만든 페이지를 전부 넣습니다(검색엔진에 이 주소들이 있다고 알리는 유일한 길)
  fs.writeFileSync(path.join(PUB, 'sitemap.xml'), sitemap(paths));
  say(`sitemap.xml 에 ${paths.length + 3}개 주소`);

  return { apt: aptCount, gu: guCount, paths };
}

// 직접 실행했을 때만 돌립니다(build-site.mjs 가 불러 쓸 수 있게)
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--clean')) {
    clean();
    log('만든 페이지를 지웠습니다');
  } else {
    const t0 = Date.now();
    const r = await buildPages();
    const size = r.paths.reduce((n, p) => n + (fs.existsSync(fileFor(p)) ? fs.statSync(fileFor(p)).size : 0), 0);
    log(`끝 — 단지 ${r.apt}장 · 자치구 ${r.gu}장 · ${(size / 1024 / 1024).toFixed(1)}MB · ${Math.round((Date.now() - t0) / 1000)}초`);
  }
}
