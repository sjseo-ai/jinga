// /decision 페이지가 쓸 것들을 만듭니다 (계획서 T009).
//   npm run build:decision
//
// 세 가지를 site/public 에 내놓습니다.
//   1) decision-index.json  — 값이 붙은 단지 799곳만 담은 **경량 검색·시세 색인**
//   2) jinga-finance.mjs    — scripts/_finance.mjs 를 **글자 하나 안 바꾸고** 복사한 것
//   3) finance-rules.json   — data/finance-rules.json 을 그대로 복사한 것
//
// ── 왜 복사인가 ─────────────────────────────────────────────────────────────
// 계산 엔진은 `scripts/_finance.mjs` 한 곳에만 있어야 합니다. 그런데 브라우저는 저장소의
// scripts/ 를 볼 수 없고(배포되는 건 site/public 뿐), 엔진은 node 모듈을 하나도 쓰지 않으므로
// **복사해서 그대로 쓸 수 있습니다.** 사람이 손으로 복사하면 반드시 어긋나므로 스크립트가 하고,
// `scripts/smoke-decision.mjs` 가 **두 파일이 한 글자라도 다르면 테스트를 깨뜨립니다.**
//
// ── 왜 전용 색인인가 ────────────────────────────────────────────────────────
// 그냥 trade-price-seoul.json(260KB) + kapt-list-seoul.json(348KB) 를 둘 다 받게 하면
// 쓰지도 않는 자료까지 600KB 를 휴대전화로 내려받게 됩니다. 필요한 칸만 골라 담습니다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUB = path.join(ROOT, 'site', 'public');

const SRC = {
  prices: path.join(PUB, 'trade-price-seoul.json'),
  kapt: path.join(PUB, 'kapt-list-seoul.json'),
  engine: path.join(ROOT, 'scripts', '_finance.mjs'),
  report: path.join(ROOT, 'scripts', '_report.mjs'),
  compose: path.join(ROOT, 'scripts', '_report-compose.mjs'),
  rules: path.join(ROOT, 'data', 'finance-rules.json'),
};
const OUT = {
  index: path.join(PUB, 'decision-index.json'),
  engine: path.join(PUB, 'jinga-finance.mjs'),
  report: path.join(PUB, 'jinga-report.mjs'),
  compose: path.join(PUB, 'jinga-report-compose.mjs'),
  rules: path.join(PUB, 'finance-rules.json'),
};

/** 복사본 머리에 붙이는 안내 — 이 파일을 직접 고치려는 사람을 막습니다. */
export const ENGINE_HEADER = [
  '// ⚠ 이 파일은 `npm run build:decision` 이 `scripts/` 의 원본에서 복사한 것입니다.',
  '//   직접 고치지 마십시오 — 원본을 고치고 다시 빌드하십시오.',
  '//   `scripts/smoke-decision.mjs` 가 원본과 다르면 테스트를 깨뜨립니다.',
  '',
].join('\n');

/**
 * 모듈을 공개 폴더로 복사. **import 주소만** 바꿉니다 —
 * 원본은 `./_report.mjs` 를 부르지만 복사본 이름은 `jinga-report.mjs` 입니다.
 * 그 한 줄 말고는 글자 하나 건드리지 않으므로, `smoke-decision.mjs` 가
 * 「머리글과 import 주소를 뺀 나머지가 원본과 같은지」로 검사할 수 있습니다.
 */
export const IMPORT_REWRITE = [
  [/from '\.\/_report\.mjs'/g, "from './jinga-report.mjs'"],
  [/from '\.\/_finance\.mjs'/g, "from './jinga-finance.mjs'"],
];
export function rewriteImports(code) {
  let out = String(code);
  for (const [re, to] of IMPORT_REWRITE) out = out.replace(re, to);
  return out;
}
export function copyModule(src, dest) {
  fs.writeFileSync(dest, ENGINE_HEADER + rewriteImports(fs.readFileSync(src, 'utf8')));
}

export function buildIndex({ prices, kapt }) {
  const names = kapt.byCode || {};
  const rows = [];
  let noName = 0;

  for (const [id, c] of Object.entries(prices.byComplex || {})) {
    const meta = names[c.kaptCode];
    // 공식 단지목록에 없으면 **넣지 않습니다.** 이름 없는 단지를 검색에 띄울 수는 없습니다.
    if (!meta || !meta.name) { noName++; continue; }
    const areas = (c.areas || []).map(a => ({
      m2: a.area, pp: a.perPyeong, amt: a.amount, lo: a.low, hi: a.high,
      n: a.n, g: a.grade, last: a.last,
    }));
    if (!areas.length) continue;
    rows.push({ id, name: meta.name, gu: meta.gu, dong: meta.dong, areas });
  }
  rows.sort((a, b) => (a.gu === b.gu ? a.name.localeCompare(b.name, 'ko') : a.gu.localeCompare(b.gu, 'ko')));

  return {
    generatedAt: new Date().toISOString(),
    asOfYM: prices.asOfYM,
    source: prices.source,
    names: kapt.source,
    model: prices.model,
    region: prices.region,          // 서울 전체·자치구·법정동 평당가(실거래 집계)
    counts: { complexes: rows.length, areas: rows.reduce((s, r) => s + r.areas.length, 0), skippedNoName: noName },
    complexes: rows,
  };
}

function run() {
  for (const [k, p] of Object.entries(SRC)) {
    if (!fs.existsSync(p)) {
      console.error(`${path.relative(ROOT, p)} 이 없습니다 (${k}) — 앞 단계를 먼저 돌리십시오`);
      process.exit(1);
    }
  }
  const prices = JSON.parse(fs.readFileSync(SRC.prices, 'utf8'));
  const kapt = JSON.parse(fs.readFileSync(SRC.kapt, 'utf8'));
  const idx = buildIndex({ prices, kapt });

  fs.writeFileSync(OUT.index, JSON.stringify(idx));
  copyModule(SRC.engine, OUT.engine);
  copyModule(SRC.report, OUT.report);
  copyModule(SRC.compose, OUT.compose);
  fs.writeFileSync(OUT.rules, fs.readFileSync(SRC.rules, 'utf8'));

  const kb = p => `${Math.round(fs.statSync(p).size / 1024)}KB`;
  console.log(`decision-index.json  단지 ${idx.counts.complexes.toLocaleString('ko-KR')}곳 · 면적 ${idx.counts.areas.toLocaleString('ko-KR')}칸 · ${kb(OUT.index)}`);
  if (idx.counts.skippedNoName) console.log(`  공식 단지목록에 이름이 없어 뺀 곳 ${idx.counts.skippedNoName}곳`);
  console.log(`jinga-finance.mjs    ${kb(OUT.engine)} (scripts/_finance.mjs 복사)`);
  console.log(`jinga-report.mjs     ${kb(OUT.report)} (scripts/_report.mjs 복사)`);
  console.log(`jinga-report-compose.mjs ${kb(OUT.compose)} (scripts/_report-compose.mjs 복사)`);
  console.log(`finance-rules.json   ${kb(OUT.rules)} (data/finance-rules.json 복사)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) run();

export { SRC, OUT };
