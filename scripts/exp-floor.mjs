// 층 보정 실험대 (계획서 T007) — **층을 보정하면 더 정확해지는가**를 직접 재 봅니다.
//   node scripts/exp-floor.mjs            측정 + 세 갈래 백테스트
//   node scripts/exp-floor.mjs --months=6 검증 기간 늘리기
//
// 왜 실험부터 하는가: J-AVM v1 때 「그럴듯한 보정」을 먼저 넣었다가 기준선보다 나빠진 적이 있습니다.
// 그래서 보정은 **재서 이긴 것만** 넣습니다. 이 파일은 그 판정을 위한 것이고, 모델에 들어가지 않습니다.
//
// ── 두 가지 쓰임을 따로 재야 합니다 ──────────────────────────────────────────
//  (가) 단지 페이지 — 어느 층이 다음에 팔릴지 **모릅니다.** 할 수 있는 건 비교 거래를
//       「중층 기준」으로 고르게 만들어, 하필 1층 한 건이 추정을 끌어내리는 것을 막는 일입니다.
//  (나) 특정 매물 — 사용자가 "15층 매물을 보고 있다"고 말해 주면 **목표 층을 압니다.**
//       그때는 중층 기준값에 그 층의 배수를 다시 곱할 수 있습니다.
// (가)는 분산만 줄고 (나)는 편향까지 줄기 때문에, 이기는 폭이 다릅니다. 섞어 재면 판단을 못 합니다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildIndex, timeFactor, pickComparables, ymOf, monthsBetween, PYEONG } from './_avm.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TRADES = path.join(ROOT, 'data', 'trades-seoul.json');

const median = xs => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const round1 = x => (x == null ? null : Math.round(x * 10) / 10);
const round3 = x => (x == null ? null : Math.round(x * 1000) / 1000);
const err = (pred, actual) => Math.abs(pred - actual) / actual * 100;

/** 단지별 관측 최고층 — 건물 높이의 대용값(대장 자료가 없으므로 거래에서 추정) */
export function maxFloors(trades) {
  const m = new Map();
  for (const t of trades) {
    if (!t.seq || !(t.floor > 0)) continue;
    m.set(t.seq, Math.max(m.get(t.seq) || 0, t.floor));
  }
  return m;
}

/** 층을 사람이 쓰는 말로 — 상대 위치(층/최고층)로 나눕니다 */
export function floorBand(floor, maxFloor) {
  if (!(floor > 0)) return '모름';
  if (floor === 1) return '1층';
  if (!(maxFloor > 1)) return '모름';
  const rel = floor / maxFloor;
  if (rel >= 0.95) return '탑층';
  if (floor === 2) return '2층';
  if (rel >= 0.7) return '고층';
  if (rel >= 0.35) return '중층';
  return '저층';
}

/**
 * 층 배수 측정 — **같은 단지·같은 면적대 안에서만** 견줍니다.
 * 단지·면적·지역 차이를 빼고 층만 남기기 위해서입니다. 시점 차이는 자치구 지수로 먼저 걷어냅니다.
 */
export function measureFloorEffect(trades, index, { minGroup = 4, areaTol = 0.1 } = {}) {
  const mf = maxFloors(trades);
  const asOf = [...new Set(trades.map(t => ymOf(t.date)))].sort().pop();

  // (단지, 면적대) 묶음 만들기 — 면적대는 전용 ㎡ 를 5㎡ 간격으로 끊습니다
  const groups = new Map();
  for (const t of trades) {
    if (!t.seq || !(t.perPyeong > 0) || !(t.floor > 0)) continue;
    const k = `${t.seq}|${Math.round(t.area / 5)}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(t);
  }

  const ratios = new Map(); // band → [비율]
  let usedGroups = 0, usedTrades = 0;
  for (const g of groups.values()) {
    if (g.length < minGroup) continue;
    // 시점 보정 — 같은 묶음 안의 거래를 모두 기준월로 끌어옵니다
    const vals = g.map(t => ({ t, v: t.perPyeong * timeFactor(index, t.gu, ymOf(t.date), asOf).f }));
    const med = median(vals.map(x => x.v));
    if (!(med > 0)) continue;
    usedGroups++;
    for (const { t, v } of vals) {
      const band = floorBand(t.floor, mf.get(t.seq));
      if (band === '모름') continue;
      if (!ratios.has(band)) ratios.set(band, []);
      ratios.get(band).push(v / med);
      usedTrades++;
    }
  }

  const ORDER = ['1층', '2층', '저층', '중층', '고층', '탑층'];
  const table = ORDER.filter(b => ratios.has(b)).map(b => ({
    band: b, n: ratios.get(b).length, factor: round3(median(ratios.get(b))),
  }));
  // 중층을 1.000 으로 놓고 다시 재기 — 「중층 기준」이라고 말하려면 중층이 1 이어야 합니다
  const mid = table.find(r => r.band === '중층');
  const norm = mid && mid.factor ? mid.factor : 1;
  return { table: table.map(r => ({ ...r, factor: round3(r.factor / norm) })), usedGroups, usedTrades, asOf };
}

/** 측정표를 배수 함수로 */
export const factorFn = table => {
  const m = new Map(table.map(r => [r.band, r.factor]));
  return (floor, maxFloor) => m.get(floorBand(floor, maxFloor)) || 1;
};

// ── 세 갈래 백테스트 ────────────────────────────────────────────────────────

/** 한 가지 방식으로 한 달을 맞혀 봅니다. mode: 'none' | 'normalize' | 'target' */
function runMonth(all, ym, mode, fac, mf) {
  const past = all.filter(t => monthsBetween(ymOf(t.date), ym) >= 1);
  const index = buildIndex(past);
  const actuals = all.filter(t => ymOf(t.date) === ym && t.perPyeong > 0);
  const out = [];

  for (const a of actuals) {
    // 창 고르기는 모델과 같게 (3→6→12, 넓히면 최근 것만)
    let comps = [], window = 12;
    for (const w of [3, 6, 12]) {
      const got = pickComparables(past, { seq: a.seq, area: a.area, asOfYM: ym, months: w, lag: 1 });
      if (got.length >= 3 || w === 12) { comps = got; window = w; break; }
      if (got.length > comps.length) { comps = got; window = w; }
    }
    if (!comps.length) continue;
    if (window > 3) comps = [...comps].sort((x, y) => (x.date < y.date ? 1 : -1)).slice(0, window > 6 ? 1 : 3);

    const vals = comps.map(t => {
      const f = timeFactor(index, t.gu, ymOf(t.date), ym).f;
      const ff = mode === 'none' ? 1 : fac(t.floor, mf.get(t.seq)); // 비교거래를 중층 기준으로
      return (t.perPyeong * f) / ff;
    });
    let pred = median(vals);
    // (나) 목표 층을 알 때만 다시 곱합니다
    if (mode === 'target') pred *= fac(a.floor, mf.get(a.seq));
    if (!(pred > 0)) continue;
    out.push({ e: err(pred, a.perPyeong), band: floorBand(a.floor, mf.get(a.seq)) });
  }
  return out;
}

export function compare(all, { months = 3 } = {}) {
  const ymList = [...new Set(all.map(t => ymOf(t.date)))].sort();
  const targets = ymList.slice(-months - 1, -1);
  const index = buildIndex(all);
  const eff = measureFloorEffect(all, index);
  const fac = factorFn(eff.table);
  const mf = maxFloors(all);

  const modes = ['none', 'normalize', 'target'];
  const result = {};
  for (const mode of modes) {
    const rows = targets.flatMap(ym => runMonth(all, ym, mode, fac, mf));
    const es = rows.map(r => r.e);
    const byBand = {};
    for (const b of ['1층', '2층', '저층', '중층', '고층', '탑층']) {
      const sub = rows.filter(r => r.band === b).map(r => r.e);
      if (sub.length >= 30) byBand[b] = { n: sub.length, mdape: round1(median(sub)) };
    }
    result[mode] = {
      n: es.length, mdape: round1(median(es)),
      mae: round1(es.reduce((s, v) => s + v, 0) / es.length),
      within10: round1(es.filter(v => v <= 10).length / es.length * 100),
      byBand,
    };
  }
  return { targets, effect: eff, result };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!fs.existsSync(TRADES)) { console.error('data/trades-seoul.json 이 없습니다 — npm run trades:seoul 먼저'); process.exit(1); }
  const months = Number((process.argv.find(a => a.startsWith('--months=')) || '').slice(9)) || 3;
  const T = JSON.parse(fs.readFileSync(TRADES, 'utf8'));
  const { targets, effect, result } = compare(T.trades, { months });

  console.log(`\n■ 층 배수 측정 — 같은 단지·같은 면적대 안에서 (${effect.usedGroups.toLocaleString('ko-KR')}개 묶음 · ${effect.usedTrades.toLocaleString('ko-KR')}건)`);
  console.log('   중층을 1.000 으로 놓고 견준 값입니다. 1 보다 작으면 그만큼 싸게 거래됐다는 뜻.');
  for (const r of effect.table) {
    const pct = (r.factor - 1) * 100;
    console.log(`   ${r.band.padEnd(5, ' ')} ${r.factor.toFixed(3)}  ${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%  (${r.n.toLocaleString('ko-KR')}건)`);
  }

  console.log(`\n■ 보정이 정확도를 높이는가 — 검증 ${targets.join(' ')}`);
  const label = { none: '보정 없음(현재)', normalize: '(가) 비교거래만 중층 기준', target: '(나) 목표 층까지 반영' };
  for (const m of ['none', 'normalize', 'target']) {
    const r = result[m];
    console.log(`   ${label[m].padEnd(26, ' ')} 중앙오차 ${String(r.mdape).padStart(4)}% · 평균 ${String(r.mae).padStart(4)}% · ±10% 안 ${r.within10}%  (${r.n.toLocaleString('ko-KR')}건)`);
  }
  const base = result.none.mdape;
  for (const m of ['normalize', 'target']) {
    const d = base - result[m].mdape;
    console.log(`   → ${label[m]}: ${d > 0.1 ? `중앙오차 ${round1(d)}%p 개선` : d < -0.1 ? `중앙오차 ${round1(-d)}%p 악화 — 넣지 말 것` : '차이 없음'}`);
  }

  console.log(`\n■ 층대별 중앙오차 — 보정이 어디서 듣는지`);
  const bands = Object.keys(result.none.byBand);
  console.log(`   ${'층대'.padEnd(6)} ${'건수'.padStart(7)} ${'보정없음'.padStart(9)} ${'(가)'.padStart(8)} ${'(나)'.padStart(8)}`);
  for (const b of bands) {
    const a = result.none.byBand[b], n = result.normalize.byBand[b], t = result.target.byBand[b];
    console.log(`   ${b.padEnd(6)} ${String(a.n).padStart(7)} ${String(a.mdape).padStart(8)}% ${String(n ? n.mdape : '—').padStart(7)}% ${String(t ? t.mdape : '—').padStart(7)}%`);
  }
  console.log('');
}
