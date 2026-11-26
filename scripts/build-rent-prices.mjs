// 전세 시세와 **전세가율** → site/public/rent-price-seoul.json
//   npm run rents:prices
//
// 읽는 것
//   data/rents-seoul.json            전월세 실거래 (build-rents.mjs)
//   site/public/trade-price-seoul.json  매매 추정 시세 (build-trade-prices.mjs)
//
// ── 전세가율이란 ───────────────────────────────────────────────────────────
//   전세가율 = 전세 보증금 ÷ 매매가
// 높으면 전세 수요가 매매가를 받치고 있다는 뜻이고(하방이 두껍다), 낮으면 매매가가 전세보다
// 앞서 올랐다는 뜻입니다(갭이 크다). **미래를 맞히는 지표가 아닙니다.**
//
// ── 이 파일에서 지키는 것 ──────────────────────────────────────────────────
// ① **분모는 매매 「추정」가입니다.** 실거래가가 아니라 J-AVM 추정치입니다. 그래서 전세가율도
//    추정이고, 화면·보고서에서 「추정」으로 적어야 합니다. 여기서 숨기면 뒤에서 못 고칩니다.
// ② **신규 전세만** 분자로 씁니다(`isMarketJeonse`). 갱신은 전월세상한제에 묶여 시세가 아닙니다.
//    2026-11-26 서울 12개월에서 전세 112,077건 중 갱신이 56,488건 — 절반이 넘습니다.
// ③ **표본이 적으면 대표값을 내지 않습니다.** 신규 전세 3건 미만인 면적 칸은 비워 둡니다.
//    한 건으로 「이 단지 전세 시세」를 말할 수는 없습니다.
// ④ **면적은 반올림한 정수로 짝을 맞춥니다.** 매매 집계(`mainAreas`)가 그렇게 묶으므로
//    같은 반올림을 써야 짝이 맞습니다(전월세 원값은 59.785 처럼 소수로 옵니다).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { jeonseByArea, jeonseRatio, areaKey, isMarketJeonse, isJeonse } from './_rents.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = {
  rents: path.join(ROOT, 'data', 'rents-seoul.json'),
  sale: path.join(ROOT, 'site', 'public', 'trade-price-seoul.json'),
};
const OUT = path.join(ROOT, 'site', 'public', 'rent-price-seoul.json');
/** 지역 단위 전세가율만 담은 작은 파일 — 메인 화면(지도·법정동 표)이 이것만 받습니다.
 *  단지별 파일(249KB)을 메인에서 받게 하면 검색만 하는 사람도 그만큼을 내려받습니다. */
const OUT_GU = path.join(ROOT, 'site', 'public', 'rent-gu-seoul.json');

/** 신규 전세가 이만큼은 있어야 대표값을 냅니다 */
export const MIN_N = 3;

const median = arr => {
  const v = arr.filter(x => x > 0).sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : null;
};

/**
 * 매매 파일의 단지·면적 칸에 전세 대표값과 전세가율을 붙입니다.
 * 매매 파일에 없는 단지는 **넣지 않습니다** — 화면이 매매 파일의 id 로 찾기 때문입니다.
 * 몇 곳이 왜 빠졌는지는 counts 에 남깁니다.
 */
export function build({ rents, sale }) {
  // rents 는 파일 객체({ rents: [...] })도, 배열도 받습니다 — 테스트에서 배열만 넘기기 쉽게.
  const list = Array.isArray(rents) ? rents : (rents && rents.rents) || [];
  const meta = Array.isArray(rents) ? {} : (rents || {});
  const cells = new Map();                      // "seq|area" → 전세 집계
  for (const c of jeonseByArea(list)) cells.set(`${c.seq}|${c.area}`, c);

  // 자치구는 전월세 기록에서 가져옵니다(매매 파일에는 자치구가 없습니다)
  const guOf = new Map(), dongOf = new Map();
  for (const r of list) {
    if (!r.seq) continue;
    if (!guOf.has(r.seq)) guOf.set(r.seq, r.gu);
    if (!dongOf.has(r.seq)) dongOf.set(r.seq, r.dong);
  }

  const out = {};
  let areas = 0, withDep = 0, withRatio = 0, thinSample = 0, noRent = 0, dropped = [];
  const byGu = new Map(), byDong = new Map();

  for (const [id, c] of Object.entries(sale.byComplex || {})) {
    const rows = [];
    for (const a of c.areas || []) {
      areas++;
      const cell = cells.get(`${c.seq}|${a.area}`);
      if (!cell) { noRent++; continue; }
      if (!(cell.n >= MIN_N) || !(cell.med > 0)) { thinSample++; continue; }
      withDep++;
      const { ratio, why } = jeonseRatio(cell.med, a.amount);
      if (ratio == null && why && !/한쪽 값이 없습니다/.test(why)) dropped.push({ seq: c.seq, area: a.area, why });
      if (ratio != null) {
        withRatio++;
        const gu = guOf.get(c.seq), dong = dongOf.get(c.seq);
        if (gu) { if (!byGu.has(gu)) byGu.set(gu, []); byGu.get(gu).push(ratio); }
        if (gu && dong) {
          const k = `${gu}|${dong}`;
          if (!byDong.has(k)) byDong.set(k, []);
          byDong.get(k).push(ratio);
        }
      }
      rows.push({
        area: a.area,
        dep: cell.med,                  // 전세 보증금 중앙값(만원) — 신규 전세만
        lo: cell.lo, hi: cell.hi,       // 25~75 백분위
        n: cell.n,                      // 대표값에 쓴 신규 전세 건수
        last: cell.lastJeonse,          // 마지막 신규 전세 계약일
        renew: cell.renew,              // 쓰지 않은 갱신 전세 건수
        wolse: cell.wolse,              // 쓰지 않은 월세 건수
        ratio,                          // 전세가율 (0.584 = 58.4%) · 못 내면 null
        sale: a.amount,                 // 분모로 쓴 매매 **추정**가(만원)
        saleGrade: a.grade,             // 그 추정의 등급 — 전세가율의 믿음은 이것에 묶입니다
      });
    }
    if (rows.length) out[id] = { seq: c.seq, kaptCode: c.kaptCode, gu: guOf.get(c.seq) || null, areas: rows };
  }

  const region = {};
  for (const [gu, rs] of byGu) region[gu] = { ratio: median(rs), cells: rs.length, dongs: {} };
  for (const [k, rs] of byDong) {
    const [gu, dong] = k.split('|');
    if (region[gu]) region[gu].dongs[dong] = { ratio: median(rs), cells: rs.length };
  }
  const allRatios = [...byGu.values()].flat();

  return {
    generatedAt: new Date().toISOString(),
    asOfYM: sale.asOfYM,
    source: meta.source || null,
    saleSource: sale.source,
    model: {
      ratio: '전세가율 = 신규 전세 보증금 중앙값 ÷ 매매 추정가. 분모가 추정치이므로 전세가율도 추정입니다',
      jeonse: `신규 전세만 씁니다 — 갱신은 전월세상한제에 묶여 시세가 아닙니다. 면적 칸당 최소 ${MIN_N}건`,
      area: '면적은 반올림한 정수로 짝을 맞춥니다(매매 집계와 같은 기준)',
      limits: '월세는 전세가율 계산에 쓰지 않습니다. 반전세(보증금+월세)도 월세로 봅니다',
    },
    counts: {
      complexes: Object.keys(out).length,
      areas, withDeposit: withDep, withRatio,
      thinSample,                      // 신규 전세가 MIN_N 미만이라 비워 둔 칸
      noRentData: noRent,              // 그 면적에 전월세 기록이 아예 없던 칸
      droppedOutOfRange: dropped.length,
      seoulRatio: median(allRatios),
      rents: meta.counts || null,
    },
    dropped: dropped.slice(0, 20),     // 말이 안 되는 값은 몇 개라도 눈에 보이게 남깁니다
    region,
    byComplex: out,
  };
}

function run() {
  const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
  let rents, sale;
  try { rents = read(SRC.rents); } catch { console.error('data/rents-seoul.json 이 없습니다 — npm run rents:seoul'); process.exit(1); }
  try { sale = read(SRC.sale); } catch { console.error('site/public/trade-price-seoul.json 이 없습니다 — npm run trades:prices'); process.exit(1); }

  const data = build({ rents, sale });
  fs.writeFileSync(OUT, JSON.stringify(data));
  // 지역 단위만 따로 — 메인 화면이 받는 것은 이쪽입니다
  fs.writeFileSync(OUT_GU, JSON.stringify({
    generatedAt: data.generatedAt, asOfYM: data.asOfYM,
    source: data.source, saleSource: data.saleSource, model: data.model,
    seoulRatio: data.counts.seoulRatio,
    gu: data.region,
  }));
  const c = data.counts;
  const pc = v => (v == null ? '—' : `${(v * 100).toFixed(1)}%`);
  console.log(`rent-price-seoul.json — 단지 ${c.complexes.toLocaleString('ko-KR')}곳 · 전세가율 나온 칸 ${c.withRatio.toLocaleString('ko-KR')}/${c.areas.toLocaleString('ko-KR')}`
    + ` · 서울 중앙 ${pc(c.seoulRatio)} · ${Math.round(fs.statSync(OUT).size / 1024)}KB`);
  console.log(`rent-gu-seoul.json — 자치구 ${Object.keys(data.region).length}곳 · ${Math.round(fs.statSync(OUT_GU).size / 1024)}KB (메인 화면용)`);
  console.log(`  비운 칸 — 표본 ${MIN_N}건 미만 ${c.thinSample.toLocaleString('ko-KR')} · 전월세 기록 없음 ${c.noRentData.toLocaleString('ko-KR')} · 범위 밖 ${c.droppedOutOfRange}`);
  const top = Object.entries(data.region).filter(([, v]) => v.ratio != null).sort((a, b) => b[1].ratio - a[1].ratio);
  if (top.length) {
    console.log(`  자치구 전세가율 높은 쪽: ${top.slice(0, 3).map(([g, v]) => `${g} ${pc(v.ratio)}`).join(' · ')}`);
    console.log(`  낮은 쪽: ${top.slice(-3).reverse().map(([g, v]) => `${g} ${pc(v.ratio)}`).join(' · ')}`);
  }
  if (data.dropped.length) console.log(`  범위 밖 예: ${data.dropped.slice(0, 2).map(d => `${d.seq} ${d.area}㎡ — ${d.why}`).join(' / ')}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) run();

export { SRC, OUT };
