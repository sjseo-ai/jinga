// J-AVM 실험대 — 「어떤 방식이 실제로 덜 틀리나」를 같은 조건에서 나란히 재 봅니다(T013).
//   node scripts/exp-avm.mjs
//
// 백테스트에서 v1(12개월 중앙값)이 **직전 거래 그대로보다 못하다**고 나왔습니다(7.2% vs 4.2%).
// 오르는 장에서 12개월 중앙값은 과거에 묶여 뒤처집니다. 그래서 창(window)과 가중을 바꿔 가며 잽니다.
// 여기서 이긴 방식을 _avm.mjs 에 반영합니다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildIndex, timeFactor, ymOf, monthsBetween } from './_avm.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const median = xs => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const round1 = x => Math.round(x * 10) / 10;

/** 비교 거래(최근 것이 앞) — 맞히려는 달은 보지 않습니다 */
function comps(trades, seq, area, ym, months, areaTol = 0.1) {
  const lo = area * (1 - areaTol), hi = area * (1 + areaTol);
  return trades.filter(t => t.seq === seq && t.area >= lo && t.area <= hi && t.perPyeong > 0
    && monthsBetween(ymOf(t.date), ym) >= 1 && monthsBetween(ymOf(t.date), ym) < months)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}
const adj = (t, index, ym) => Math.round(t.perPyeong * timeFactor(index, t.gu, ymOf(t.date), ym).f);

/** 재 볼 방식들 — 이름 : (비교거래, 지수, 기준월) → 평당가 또는 null */
export const METHODS = {
  '12개월 중앙값(v1)': (c, ix, ym) => (c.length ? median(c.map(t => adj(t, ix, ym))) : null),
  '6개월 중앙값': (c, ix, ym) => { const s = c.filter(t => monthsBetween(ymOf(t.date), ym) < 6); return s.length ? median(s.map(t => adj(t, ix, ym))) : null; },
  '3개월 중앙값': (c, ix, ym) => { const s = c.filter(t => monthsBetween(ymOf(t.date), ym) < 3); return s.length ? median(s.map(t => adj(t, ix, ym))) : null; },
  '직전 1건': c => (c.length ? c[0].perPyeong : null),
  '직전 3건 중앙값': (c, ix, ym) => (c.length ? median(c.slice(0, 3).map(t => adj(t, ix, ym))) : null),
  '직전 3건(보정 없음)': c => (c.length ? median(c.slice(0, 3).map(t => t.perPyeong)) : null),
  '직전 5건 중앙값': (c, ix, ym) => (c.length ? median(c.slice(0, 5).map(t => adj(t, ix, ym))) : null),
};

export function run(allTrades, { months = 3 } = {}) {
  const ymList = [...new Set(allTrades.map(t => ymOf(t.date)))].sort();
  const targets = ymList.slice(-months - 1, -1);
  const errs = Object.fromEntries(Object.keys(METHODS).map(k => [k, []]));
  let cases = 0;

  for (const ym of targets) {
    const past = allTrades.filter(t => monthsBetween(ymOf(t.date), ym) >= 1);
    const index = buildIndex(past);
    for (const a of allTrades.filter(t => ymOf(t.date) === ym && t.perPyeong > 0)) {
      const c = comps(past, a.seq, a.area, ym, 12);
      if (c.length < 3) continue;              // 모든 방식이 값을 낼 수 있는 경우만 — 공정하게 견주려고
      cases++;
      for (const [name, fn] of Object.entries(METHODS)) {
        const p = fn(c, index, ym);
        if (p) errs[name].push(Math.abs(p - a.perPyeong) / a.perPyeong * 100);
      }
    }
  }
  return { targets, cases, rows: Object.entries(errs).map(([name, es]) => ({
    name, n: es.length, mdape: round1(median(es)),
    within5: round1(es.filter(v => v <= 5).length / es.length * 100),
    within10: round1(es.filter(v => v <= 10).length / es.length * 100),
  })).sort((a, b) => a.mdape - b.mdape) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const T = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'trades-seoul.json'), 'utf8'));
  const r = run(T.trades);
  console.log(`검증 ${r.targets.join(' ')} · 비교 거래가 3건 이상인 ${r.cases.toLocaleString('ko-KR')}건에서\n`);
  console.log('방식'.padEnd(24) + '중앙오차   ±5% 안   ±10% 안');
  for (const x of r.rows) console.log(`${x.name.padEnd(22)}  ${String(x.mdape).padStart(5)}%  ${String(x.within5).padStart(6)}%  ${String(x.within10).padStart(7)}%`);
}
