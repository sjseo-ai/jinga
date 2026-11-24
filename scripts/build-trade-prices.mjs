// 단지 페이지에 올릴 **실거래 기반 추정 시세**를 미리 계산해 둡니다(T011).
//   npm run trades:prices   → site/public/trade-price-seoul.json
//
// 앞선 단계의 결과를 이어 붙이는 자리입니다.
//   data/trades-seoul.json  (수집·정규화 T010)
//   data/trade-match.json   (실거래 단지 ↔ K-apt 짝짓기 T010)
//   scripts/_avm.mjs        (추정 J-AVM v2 T012·T013)
//
// **모르는 단지는 아예 넣지 않습니다.** 파일에 없으면 페이지에 그 칸이 통째로 빠집니다 —
// 빈칸을 0 이나 「-」로 채우면 「거래가 없다」가 아니라 「값이 0」으로 읽힙니다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { byComplex } from './_trades.mjs';
import { buildIndex, buildFloorIndex, estimate } from './_avm.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'site', 'public', 'trade-price-seoul.json');

/**
 * 그 단지에서 많이 거래된 면적대.
 * 1㎡ 단위로 뭉치고, **서로 3㎡ 안쪽이면 같은 평형으로 보고 하나만** 남깁니다.
 * 안 그러면 89㎡·90㎡ 가 따로 잡혀 같은 값이 두 줄 나옵니다(비교 범위가 ±10% 라 거의 같은 거래를 봅니다).
 */
export function mainAreas(trades, top = 3, gap = 3) {
  const by = new Map();
  for (const t of trades) { const k = Math.round(t.area); by.set(k, (by.get(k) || 0) + 1); }
  const picked = [];
  for (const [area] of [...by.entries()].sort((a, b) => b[1] - a[1])) {
    if (picked.some(p => Math.abs(p - area) <= gap)) continue;
    picked.push(area);
    if (picked.length >= top) break;
  }
  return picked;
}

/** 화면에 그대로 쓸 한 칸 — 등급 D·보류는 대표값 없이 범위만, 또는 통째로 빠짐 */
export function cell(e, area) {
  if (e.grade === 'none') return null;
  return {
    area,
    perPyeong: e.perPyeong,                   // 만원/평 (D 등급이면 null)
    amount: e.amount,                         // 만원    (D 등급이면 null)
    low: e.lowAmount, high: e.highAmount,     // 만원 범위
    n: e.n, grade: e.grade, last: e.lastDealYM,
  };
}

/**
 * 자치구·법정동 평당가 — **최근 3개월 실거래의 중앙값**.
 * 평균이 아니라 중앙값, 12개월이 아니라 3개월인 이유는 단지 추정과 같습니다(docs/model-card.md).
 * 거래가 적은 동은 아예 싣지 않습니다 — 두세 건으로 「동네 시세」라고 적을 수는 없습니다.
 */
export function guPrices(trades, asOfYM, { months = 3, minGu = 30, minDong = 10 } = {}) {
  const cut = (() => { const y = Number(asOfYM.slice(0, 4)), m = Number(asOfYM.slice(4)); const d = new Date(Date.UTC(y, m - 1 - (months - 1), 1)); return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`; })();
  const recent = trades.filter(t => t.perPyeong > 0 && String(t.date).slice(0, 7).replace('-', '') >= cut);
  const med = xs => { const s = [...xs].sort((a, b) => a - b); const i = s.length >> 1; return s.length % 2 ? s[i] : Math.round((s[i - 1] + s[i]) / 2); };

  const guMap = new Map(), dongMap = new Map();
  for (const t of recent) {
    if (!guMap.has(t.gu)) guMap.set(t.gu, []);
    guMap.get(t.gu).push(t.perPyeong);
    const dk = `${t.gu}|${t.dong}`;
    if (!dongMap.has(dk)) dongMap.set(dk, []);
    dongMap.get(dk).push(t.perPyeong);
  }
  const out = {};
  for (const [gu, xs] of guMap) {
    if (xs.length < minGu) continue;
    const dongs = [...dongMap.entries()]
      .filter(([k, v]) => k.startsWith(`${gu}|`) && v.length >= minDong)
      .map(([k, v]) => ({ name: k.split('|')[1], perPyeong: med(v), n: v.length }))
      .sort((a, b) => b.perPyeong - a.perPyeong);
    out[gu] = { perPyeong: med(xs), n: xs.length, dongs };
  }
  const all = recent.map(t => t.perPyeong);
  return { months, from: cut, seoul: all.length ? { perPyeong: med(all), n: all.length } : null, gu: out };
}

export function build({ trades, pairs, asOfYM }) {
  const index = buildIndex(trades);
  const floors = buildFloorIndex(trades);  // 층 보정 — 비교 거래를 중층 기준으로 맞춥니다(v3)
  const complexes = new Map(byComplex(trades).map(c => [c.seq, c]));
  const byId = {};
  let areas = 0, priced = 0;

  for (const [seq, kaptCode, id] of pairs) {
    const c = complexes.get(seq);
    if (!c) continue;
    const cells = mainAreas(c.trades).map(a => cell(estimate(trades, index, { seq, area: a, asOfYM, floors }), a)).filter(Boolean);
    if (!cells.length) continue;
    areas += cells.length;
    priced += cells.filter(x => x.amount).length;
    byId[id] = { seq, kaptCode, areas: cells.sort((a, b) => a.area - b.area) };
  }
  return {
    generatedAt: new Date().toISOString(),
    asOfYM,
    source: '국토교통부 아파트 매매 실거래가(공공데이터포털 15126468) — 진가 자체 추정(J-AVM v2). 추정치이며 실거래가가 아닙니다.',
    model: 'docs/model-card.md',
    counts: { complexes: Object.keys(byId).length, areas, priced },
    region: guPrices(trades, asOfYM),
    byComplex: byId,
  };
}

/**
 * 앱의 지역 지도가 읽던 KB 집계(kb-seoul-gu.json)와 **같은 모양**으로 다시 씁니다 — 속은 실거래입니다.
 * 모양을 맞추는 이유는 화면 코드를 최소로 고치기 위해서입니다. 다만 `source` 를 함께 넣어
 * 화면이 「무엇을 재는 값인지」 표시할 수 있게 합니다.
 */
export function appShape(region, asOfYM) {
  const gu = {};
  for (const [name, v] of Object.entries(region.gu)) {
    gu[name] = { avgPerPyeong: v.perPyeong, count: v.n, households: null,
      dongs: (v.dongs || []).map(d => ({ name: d.name, avgPerPyeong: d.perPyeong, count: d.n })) };
  }
  return {
    asOf: `${String(asOfYM).slice(0, 4)}.${String(asOfYM).slice(4)}`,
    generatedAt: new Date().toISOString(),
    source: `국토교통부 아파트 매매 실거래가 — 최근 ${region.months}개월 거래의 중앙값(시세 조사값이 아닙니다)`,
    basis: 'trade',
    seoul: region.seoul ? { avgPerPyeong: region.seoul.perPyeong, count: region.seoul.n } : null,
    gu,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const read = p => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
  let T, M;
  try { T = read('data/trades-seoul.json'); } catch { console.error('data/trades-seoul.json 이 없습니다 — npm run trades:seoul'); process.exit(1); }
  try { M = read('data/trade-match.json'); } catch { console.error('data/trade-match.json 이 없습니다 — node scripts/match-trades.mjs --save'); process.exit(1); }
  const data = build({ trades: T.trades, pairs: M.pairs, asOfYM: T.months[0] });
  fs.writeFileSync(OUT, JSON.stringify(data));
  const GU_OUT = path.join(ROOT, 'site', 'public', 'trade-gu-seoul.json');
  fs.writeFileSync(GU_OUT, JSON.stringify(appShape(data.region, data.asOfYM)));
  console.log(`site/public/trade-price-seoul.json — 단지 ${data.counts.complexes.toLocaleString('ko-KR')}곳 ·`
    + ` 면적 ${data.counts.areas.toLocaleString('ko-KR')}개 중 대표값 ${data.counts.priced.toLocaleString('ko-KR')}개`
    + ` · 자치구 ${Object.keys(data.region.gu).length}곳 · 기준 ${data.asOfYM} · ${(fs.statSync(OUT).size / 1024).toFixed(0)}KB`);
}
