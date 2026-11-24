// 범위 폭 실험대 — 「범위 적중 85%」를 맞추려면 등급별 폭을 얼마로 해야 하나.
//   node scripts/exp-band.mjs               A등급을 여러 폭으로 재 봅니다
//   node scripts/exp-band.mjs --grade=B
//   node scripts/exp-band.mjs --all         네 등급 전부
//
// ── 왜 적중률만 보면 안 되는가 ───────────────────────────────────────────────
// 범위를 넓히면 적중률은 반드시 올라갑니다. 「0원~100억」이라고 하면 100% 맞습니다.
// 그래서 **적중률과 범위 폭을 늘 함께** 봅니다. 폭이 커지는 만큼 그 범위는 쓸모가 없어집니다.
// 판단 기준: 적중 85% 에 처음 닿는 폭. 그보다 넓히는 것은 이득 없이 무뎌지는 것뿐입니다.
//
// ── 주의 ────────────────────────────────────────────────────────────────────
// 실제 범위는 `max(등급폭, 사분위)` 라서 폭을 좁혀도 사분위 아래로는 안 좁아집니다.
// 즉 폭을 줄여도 적중률이 그만큼 떨어지지는 않습니다 — 아래 표의 「폭에 걸린 비율」이 그것입니다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildIndex, buildFloorIndex, estimate, ymOf, monthsBetween, BAND } from './_avm.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TRADES = path.join(ROOT, 'data', 'trades-seoul.json');
const CANDIDATES = [0.06, 0.07, 0.08, 0.085, 0.09, 0.10, 0.11, 0.12, 0.14];
const pct = x => Math.round(x * 1000) / 10;
const r1 = x => Math.round(x * 10) / 10;

/** 한 등급을 여러 폭으로 재기. 등급 판정은 폭과 무관하므로 비교 거래 선별은 한 번만 합니다. */
export function sweep(all, { grade = 'A', months = 3 } = {}) {
  // 지금 쓰는 폭은 반드시 표에 들어가야 합니다 — 비교 대상이 없으면 표를 읽을 수 없습니다
  const widths = [...new Set([...CANDIDATES, BAND[grade]])].filter(w => w != null).sort((a, b) => a - b);
  const ymList = [...new Set(all.map(t => ymOf(t.date)))].sort();
  const targets = ymList.slice(-months - 1, -1);
  const rows = [];

  for (const ym of targets) {
    const past = all.filter(t => monthsBetween(ymOf(t.date), ym) >= 1);
    const index = buildIndex(past);
    const floors = buildFloorIndex(past);
    for (const a of all.filter(t => ymOf(t.date) === ym && t.perPyeong > 0)) {
      // 폭을 0 으로 주면 범위가 **사분위만으로** 정해집니다 — 폭의 효과를 떼어 보기 위한 바닥값
      const e0 = estimate(past, index, { seq: a.seq, area: a.area, asOfYM: ym, lag: 1, floors, band: 0 });
      if (e0.grade !== grade) continue;
      const med = e0.perPyeong || (e0.n ? Math.round((e0.low + e0.high) / 2) : null);
      if (!med) continue;
      rows.push({ actual: a.perPyeong, med, qLow: e0.low, qHigh: e0.high });
    }
  }

  return widths.map(w => {
    let hit = 0, widthSum = 0, boundByBand = 0;
    for (const r of rows) {
      const low = Math.min(r.med * (1 - w), r.qLow);
      const high = Math.max(r.med * (1 + w), r.qHigh);
      if (r.actual >= low && r.actual <= high) hit++;
      widthSum += (high - low) / r.med;
      if (r.med * (1 - w) < r.qLow || r.med * (1 + w) > r.qHigh) boundByBand++;
    }
    return {
      w, n: rows.length,
      inRange: rows.length ? pct(hit / rows.length) : null,
      avgWidth: rows.length ? r1((widthSum / rows.length) * 100) : null,
      boundByBand: rows.length ? pct(boundByBand / rows.length) : null,
    };
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!fs.existsSync(TRADES)) { console.error('data/trades-seoul.json 이 없습니다'); process.exit(1); }
  const T = JSON.parse(fs.readFileSync(TRADES, 'utf8'));
  const only = (process.argv.find(a => a.startsWith('--grade=')) || '').slice(8);
  const grades = process.argv.includes('--all') ? ['A', 'B', 'C', 'D'] : [only || 'A'];

  for (const g of grades) {
    const rowsOut = sweep(T.trades, { grade: g });
    const now = BAND[g];
    console.log(`\n■ ${g}등급 — 지금 폭 ±${(now * 100).toFixed(1)}% · 평가 ${rowsOut[0].n.toLocaleString('ko-KR')}건`);
    console.log(`   ${'폭'.padEnd(7)} ${'범위 적중'.padStart(9)} ${'평균 범위 폭'.padStart(12)} ${'폭에 걸린 비율'.padStart(13)}`);
    for (const r of rowsOut) {
      const mark = r.w === now ? ' ←지금' : r.inRange >= 85 ? ' ✓85%' : '';
      console.log(`   ±${(r.w * 100).toFixed(1).padStart(5)}% ${String(r.inRange).padStart(8)}% ${String(r.avgWidth).padStart(11)}% ${String(r.boundByBand).padStart(12)}%${mark}`);
    }
    const first = rowsOut.find(r => r.inRange >= 85);
    const cur = rowsOut.find(r => r.w === now);
    if (!first) console.log(`   → 이 폭들로는 85% 에 닿지 못합니다. 범위를 넓히는 것으로 풀 문제가 아닙니다.`);
    else if (first.w <= now) console.log(`   → 지금 폭으로 이미 ${cur.inRange}% 입니다. 넓힐 필요 없습니다.`);
    else console.log(`   → ±${(first.w * 100).toFixed(1)}% 에서 ${first.inRange}% 에 닿습니다. 범위 폭은 ${cur.avgWidth}% → ${first.avgWidth}% 로 ${r1(first.avgWidth - cur.avgWidth)}%p 무뎌집니다.`);
  }
  console.log('');
}
