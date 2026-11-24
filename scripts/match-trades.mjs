// 실거래 단지 ↔ 국토부 K-apt 단지 맞추기 (T010) — **맞춤률을 재는 것이 먼저입니다.**
//   node scripts/match-trades.mjs            맞춤률만 봅니다
//   node scripts/match-trades.mjs --save     data/trade-match.json 에 대응표를 씁니다
//
// 왜 필요한가 — 실거래 자료에는 `aptSeq`(11740-2609) 가, K-apt 에는 `kaptCode`(A13501004) 가 있습니다.
// 둘을 잇는 공식 대응표는 없습니다. 이름과 법정동으로 맞춰야 하는데, 같은 단지가
// 「래미안강동」·「래미안 강동」·「래미안강동아파트」로 들어옵니다.
//
// **못 맞춘 단지는 가격을 보여 주지 않습니다.** 억지로 붙이면 남의 단지 가격을 보여 주게 됩니다.
// 그래서 이 스크립트가 하는 일은 「얼마나 맞았나」를 정직하게 세는 것입니다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { byComplex } from './_trades.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TRADES = path.join(ROOT, 'data', 'trades-seoul.json');
const OUT = path.join(ROOT, 'data', 'trade-match.json');

/**
 * 이름 고르기. 실제로 어긋난 것들을 보고 정한 규칙입니다(2026-11-19, 서울 12개월 실거래 대조).
 *   상계주공7(고층)   ↔ 상계주공7단지      → 고층·저층, N단지의 '단지'를 뗍니다
 *   에스케이북한산시티 ↔ SK북한산시티아파트  → 한글 음차를 영문 약자로, '아파트'를 뗍니다
 * 「래미안 강동(1단지)」 → 「래미안강동1」
 */
export const normName = s => String(s || '')
  .replace(/[\s()[\]{}\-–—·.,'"]/g, '')
  .replace(/에스케이/g, 'sk').replace(/엘지/g, 'lg').replace(/지에스/g, 'gs')
  .replace(/디에이치/g, 'dh').replace(/케이씨씨/g, 'kcc').replace(/제이더블유/g, 'jw')
  .replace(/고층|저층/g, '')
  .replace(/아파트/g, '')
  .replace(/(\d+)단지/g, '$1')
  .toLowerCase();

/**
 * 느슨한 열쇠 — 꼬리의 숫자·차수까지 떼어 봅니다(「중계그린1」 ↔ 「중계그린」).
 * **후보가 딱 하나일 때만** 씁니다. 1차·2차가 따로 있는 단지에 이걸 그냥 쓰면 남의 단지에 붙습니다.
 */
export const looseName = s => normName(s).replace(/\d+차?$/, '');

/** K-apt 쪽 색인: 엄격한 열쇠와 느슨한 열쇠를 함께 만듭니다 */
export function buildIndex(kaptByComplex, kbRows) {
  const meta = new Map(kbRows.map(c => [String(c[0]), { gu: c[2], dong: c[3], name: c[1] }]));
  const strict = new Map(), loose = new Map();
  const add = (map, key, v) => {
    if (!map.has(key)) map.set(key, []);
    const list = map.get(key);
    if (!list.some(x => x.id === v.id)) list.push(v);
  };
  for (const [id, v] of Object.entries(kaptByComplex)) {
    const m = meta.get(id);
    if (!m) continue;
    const entry = { id, code: v.code, name: v.kaptName || m.name, gu: m.gu, dong: m.dong, households: v.households };
    for (const nm of new Set([v.kaptName, m.name].filter(Boolean))) {
      add(strict, `${normName(nm)}|${m.dong}`, entry);
      add(loose, `${looseName(nm)}|${m.dong}`, entry);
    }
  }
  return { strict, loose, size: strict.size };
}

/** 한 단지를 맞춰 봅니다 → { status: 'ok'|'loose'|'ambiguous'|'miss', hit } */
export function matchOne(complex, index) {
  const got = index.strict.get(`${normName(complex.name)}|${complex.dong}`);
  if (got && got.length === 1) return { status: 'ok', hit: got[0] };
  if (got && got.length > 1) return { status: 'ambiguous', hit: null, candidates: got.length };
  // 느슨한 열쇠는 **후보가 딱 하나일 때만**. 여럿이면 못 맞춘 것으로 둡니다 — 찍지 않습니다.
  const l = index.loose.get(`${looseName(complex.name)}|${complex.dong}`);
  if (l && l.length === 1) return { status: 'loose', hit: l[0] };
  if (l && l.length > 1) return { status: 'ambiguous', hit: null, candidates: l.length };
  return { status: 'miss', hit: null };
}

export function report(trades, kaptByComplex, kbRows) {
  const index = buildIndex(kaptByComplex, kbRows);
  const complexes = byComplex(trades);
  const rows = complexes.map(c => ({ c, ...matchOne(c, index) }));
  const hit = rows.filter(r => r.hit);
  const amb = rows.filter(r => r.status === 'ambiguous');
  const miss = rows.filter(r => r.status === 'miss');
  const tradeN = rows.reduce((n, r) => n + r.c.n, 0);
  // **분모가 둘입니다.** 실거래에는 50세대 미만 나홀로 단지까지 다 들어오는데,
  // K-apt 쪽 자료는 300세대 이상만 모아 두었습니다. 두 숫자를 한 비율로 적으면 늘 낮게 나옵니다.
  const kaptTotal = new Set(hit.map(r => r.hit.id)).size;
  return {
    indexSize: index.size,
    kaptComplexes: Object.keys(kaptByComplex).length,
    complexes: complexes.length,
    ok: rows.filter(r => r.status === 'ok').length,
    loose: rows.filter(r => r.status === 'loose').length,
    ambiguous: amb.length, miss: miss.length,
    coveredKapt: kaptTotal,
    kaptRate: Math.round(kaptTotal / Object.keys(kaptByComplex).length * 1000) / 10,
    complexRate: Math.round(hit.length / complexes.length * 1000) / 10,
    tradeRate: Math.round(hit.reduce((n, r) => n + r.c.n, 0) / tradeN * 1000) / 10,
    bigMisses: miss.filter(r => r.c.n >= 10).slice(0, 15).map(r => ({ name: r.c.name, dong: r.c.dong, gu: r.c.gu, n: r.c.n })),
    pairs: hit.map(r => [r.c.seq, r.hit.code, r.hit.id, r.c.name, r.status]),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!fs.existsSync(TRADES)) { console.error('data/trades-seoul.json 이 없습니다 — npm run trades:seoul 먼저'); process.exit(1); }
  const T = JSON.parse(fs.readFileSync(TRADES, 'utf8'));
  const kapt = JSON.parse(fs.readFileSync(path.join(ROOT, 'site/public/kapt-seoul.json'), 'utf8')).byComplex;
  const kb = JSON.parse(fs.readFileSync(path.join(ROOT, 'site/public/kb-seoul-complexes.json'), 'utf8')).complexes;
  const r = report(T.trades, kapt, kb);
  console.log(`K-apt 단지 ${r.kaptComplexes.toLocaleString('ko-KR')}곳(색인 ${r.indexSize}) · 실거래 단지 ${r.complexes.toLocaleString('ko-KR')}곳`);
  console.log(`맞음 ${r.ok} · 느슨하게 맞음 ${r.loose} · 여럿 겹침 ${r.ambiguous} · 못 맞춤 ${r.miss}`);
  console.log(`**K-apt 단지 중 가격을 붙일 수 있는 곳 ${r.coveredKapt}곳 = ${r.kaptRate}%** ← 이게 쓸 수 있는 비율입니다`);
  console.log(`(참고) 실거래 단지 전체 기준 ${r.complexRate}% · 거래 건수 기준 ${r.tradeRate}%`);
  console.log(`거래 10건 이상인데 못 맞춘 곳: ${r.bigMisses.map(m => `${m.name}(${m.dong} ${m.n}건)`).join(' / ') || '없음'}`);
  if (process.argv.includes('--save')) {
    fs.writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), rate: r.complexRate, pairs: r.pairs }));
    console.log(`→ data/trade-match.json (${r.pairs.length}쌍)`);
  }
}
