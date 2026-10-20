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
import { aptPage, guPage, hubPage, sitemap, aptPath, guPath, CSS, usedText } from './_pages.mjs';

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

export async function buildPages({ quiet = false } = {}) {
  const say = m => { if (!quiet) log(m); };
  const kb = read('kb-seoul-complexes.json');
  const gu = read('kb-seoul-gu.json');
  let kapt;
  try { kapt = read('kapt-seoul.json'); }
  catch { say('kapt-seoul.json 이 없어 단지 페이지를 만들지 않습니다'); return { apt: 0, gu: 0, paths: [] }; }

  const byComplex = kapt.byComplex || {};
  const rows = kb.complexes.map(c => ({
    id: c[0], name: c[1], gu: c[2], dong: c[3], far: c[5], lat: c[7], lng: c[8],
    hall: c[10], approved: c[11], households: c[12], rentUnits: c[13],
    k: byComplex[String(c[0])] || null,
  }));

  const withK = rows.filter(r => r.k);
  if (!withK.length) { say('국토부 자료가 붙은 단지가 없습니다'); return { apt: 0, gu: 0, paths: [] }; }

  clean();
  fs.writeFileSync(path.join(PUB, 'pages.css'), CSS);

  // 같은 동 단지끼리 묶어 서로 링크를 겁니다 — 검색엔진이 페이지를 타고 들어오는 길이 됩니다
  const dongMap = new Map();
  for (const r of withK) {
    const key = `${r.gu}|${r.dong}`;
    if (!dongMap.has(key)) dongMap.set(key, []);
    dongMap.get(key).push(r);
  }

  const paths = [];
  const seen = new Set();
  for (const r of withK) {
    const p = aptPath(r);
    if (seen.has(p)) { say(`주소가 겹칩니다: ${p} (${r.name}) — 건너뜁니다`); continue; }
    seen.add(p);
    const { html } = aptPage(r, r.k, { sameDong: dongMap.get(`${r.gu}|${r.dong}`) || [] });
    write(p, html);
    paths.push(p);
  }
  say(`단지 ${paths.length}장`);

  // 자치구 — 국토부 자료가 있는 단지가 하나라도 있는 구만
  const guNames = [...new Set(withK.map(r => r.gu))].sort((a, b) => a.localeCompare(b, 'ko'));
  const seoulAvg = gu.seoul && gu.seoul.avgPerPyeong;
  const guCounts = [];
  for (const g of guNames) {
    const mine = withK.filter(r => r.gu === g);
    const info = { ...(gu.gu || {})[g], asOf: gu.asOf };
    if (info.avgPerPyeong && seoulAvg) info.vsSeoul = Math.round(info.avgPerPyeong / seoulAvg * 1000) / 10;
    const { html } = guPage(g, mine, info);
    const p = guPath(g);
    write(p, html);
    paths.push(p);
    guCounts.push({ gu: g, n: mine.length });
  }
  say(`자치구 ${guNames.length}장`);

  write('/apt/', hubPage(guCounts, withK.length).html);

  // sitemap — 만든 페이지를 전부 넣습니다(검색엔진에 이 주소들이 있다고 알리는 유일한 길)
  fs.writeFileSync(path.join(PUB, 'sitemap.xml'), sitemap(paths));
  say(`sitemap.xml 에 ${paths.length + 3}개 주소`);

  return { apt: paths.filter(p => p.startsWith('/apt/')).length, gu: guNames.length, paths };
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
