// J-AVM 을 실제 수집본에 돌려 **얼마나 많은 단지에 값을 줄 수 있는지** 봅니다(T012 검증).
//   node scripts/run-avm.mjs                 전체 요약
//   node scripts/run-avm.mjs 강동구 고덕그라시움 84.9    한 단지 보기
//
// 커버리지가 이 모델의 진짜 성적표입니다. 추정이 얼마나 정확한지(T013 백테스트)는 그다음 문제이고,
// 먼저 「몇 곳에 값을 줄 수 있나」를 알아야 화면을 어떻게 만들지 정할 수 있습니다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { byComplex } from './_trades.mjs';
import { buildIndex, buildFloorIndex, estimate, describe, ymOf } from './_avm.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TRADES = path.join(ROOT, 'data', 'trades-seoul.json');

/** 단지 안에서 많이 거래된 면적대들 — 그 단지의 「주력 평형」 */
export function mainAreas(trades, top = 3) {
  const by = new Map();
  for (const t of trades) {
    const k = Math.round(t.area);                      // 1㎡ 단위로 뭉칩니다(84.9 와 84.97 은 같은 평형)
    by.set(k, (by.get(k) || 0) + 1);
  }
  return [...by.entries()].sort((a, b) => b[1] - a[1]).slice(0, top).map(([area, n]) => ({ area, n }));
}

function main(argv = process.argv.slice(2)) {
  if (!fs.existsSync(TRADES)) { console.error('data/trades-seoul.json 이 없습니다 — npm run trades:seoul 먼저'); process.exit(1); }
  const T = JSON.parse(fs.readFileSync(TRADES, 'utf8'));
  const index = buildIndex(T.trades);
  const floors = buildFloorIndex(T.trades);
  const asOfYM = T.months[0];
  const complexes = byComplex(T.trades);

  if (argv.length >= 2) {
    const [gu, name, areaArg] = argv;
    const c = complexes.find(x => x.gu === gu && x.name.includes(name));
    if (!c) { console.error(`${gu} ${name} — 실거래에서 못 찾았습니다`); process.exit(1); }
    console.log(`${c.name} (${c.gu} ${c.dong}) · 최근 12개월 거래 ${c.n}건 · 마지막 ${c.last}`);
    const areas = areaArg ? [{ area: Number(areaArg), n: 0 }] : mainAreas(c.trades);
    for (const a of areas) {
      const e = estimate(T.trades, index, { seq: c.seq, area: a.area, asOfYM, floors });
      console.log(`  전용 ${a.area}㎡ — ${describe(e)}`);
    }
    return;
  }

  // 전체: 단지마다 가장 많이 거래된 면적 하나로 등급 분포를 봅니다
  const tally = { A: 0, B: 0, C: 0, D: 0, none: 0 };
  let priced = 0;
  for (const c of complexes) {
    const [top] = mainAreas(c.trades, 1);
    const e = estimate(T.trades, index, { seq: c.seq, area: top.area, asOfYM, floors });
    tally[e.grade]++;
    if (e.perPyeong) priced++;
  }
  const idxMonths = [...new Set([...index.keys()].map(k => k.split('|')[1]))].sort();
  console.log(`기준월 ${asOfYM} · 거래 ${T.trades.length.toLocaleString('ko-KR')}건 · 단지 ${complexes.length.toLocaleString('ko-KR')}곳`);
  console.log(`구·월 지수 ${index.size}개 (${idxMonths[0]}~${idxMonths[idxMonths.length - 1]})`);
  console.log(`등급 — A ${tally.A} · B ${tally.B} · C ${tally.C} · D ${tally.D} · 보류 ${tally.none}`);
  console.log(`**값을 줄 수 있는 단지 ${priced.toLocaleString('ko-KR')}곳 = ${(priced / complexes.length * 100).toFixed(1)}%** (나머지는 범위만 또는 보류)`);

  // 우리 단지 페이지에 실제로 붙일 수 있는 비율 — 이게 제품에서 보이는 숫자입니다.
  // 실거래에는 나홀로 아파트까지 다 들어오므로 위 비율보다 이쪽이 높게 나오는 것이 정상입니다.
  const MATCH = path.join(ROOT, 'data', 'trade-match.json');
  if (fs.existsSync(MATCH)) {
    const pairs = JSON.parse(fs.readFileSync(MATCH, 'utf8')).pairs;
    const seqs = new Set(pairs.map(p => p[0]));
    const mine = complexes.filter(c => seqs.has(c.seq));
    let ok = 0, ranged = 0;
    for (const c of mine) {
      const [top] = mainAreas(c.trades, 1);
      const e = estimate(T.trades, index, { seq: c.seq, area: top.area, asOfYM, floors });
      if (e.perPyeong) ok++; else if (e.n) ranged++;
    }
    console.log(`\n우리 단지 페이지 기준 — K-apt 와 맞춘 ${mine.length}곳 중`);
    console.log(`  값 제시 ${ok}곳 (${(ok / mine.length * 100).toFixed(1)}%) · 범위만 ${ranged}곳 · 거래 없음 ${mine.length - ok - ranged}곳`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
