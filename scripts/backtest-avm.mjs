// J-AVM 백테스트 (T013) — **지난달 거래를 미리 보지 않고** 맞힐 수 있었는지 재 봅니다.
//   node scripts/backtest-avm.mjs                 최근 3개월을 차례로 검증
//   node scripts/backtest-avm.mjs --months=6      더 길게
//
// 결과: research/metrics.json (기계용) · research/avm-backtest.md (사람용)
//
// ── 미래 정보 차단 ───────────────────────────────────────────────────────────
// 맞히려는 달이 M 이면, 그 달의 거래는 **단 한 건도** 보지 않습니다.
//   · 비교 거래: lag=1 로 M 이전 달까지만
//   · 자치구 지수: M 이전 거래로만 다시 만듭니다
// 이걸 빼먹으면 「답을 보고 답을 맞히는」 셈이라 오차가 실제보다 훨씬 좋게 나옵니다.
//
// ── 무엇과 견주는가 ──────────────────────────────────────────────────────────
// 아무 모델이나 숫자를 내놓을 수 있으므로, **더 단순한 방법보다 나은지**를 봐야 뜻이 있습니다.
//   기준선: 같은 단지·같은 면적대의 **직전 거래 평당가 그대로**(시점 보정도, 중앙값도 없이)
// J-AVM 이 이것보다 못하면 복잡하게 만들 이유가 없습니다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildIndex, buildFloorIndex, estimate, ymOf, monthsBetween, PYEONG } from './_avm.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TRADES = path.join(ROOT, 'data', 'trades-seoul.json');
const OUT_JSON = path.join(ROOT, 'research', 'metrics.json');
const OUT_MD = path.join(ROOT, 'research', 'avm-backtest.md');

const median = xs => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const pct = x => Math.round(x * 1000) / 10;
const round1 = x => Math.round(x * 10) / 10;

/** 기준선 — 같은 단지·면적대의 직전 거래 평당가(보정 없음) */
export function baseline(trades, { seq, area, asOfYM, areaTol = 0.1, months = 12 }) {
  const lo = area * (1 - areaTol), hi = area * (1 + areaTol);
  const past = trades.filter(t => t.seq === seq && t.area >= lo && t.area <= hi && t.perPyeong > 0
    && monthsBetween(ymOf(t.date), asOfYM) >= 1 && monthsBetween(ymOf(t.date), asOfYM) < months);
  if (!past.length) return null;
  past.sort((a, b) => (a.date < b.date ? 1 : -1));
  return past[0].perPyeong;
}

/** 오차율(%) — 실제 대비 */
const err = (pred, actual) => Math.abs(pred - actual) / actual * 100;

export function backtest(allTrades, { months = 3 } = {}) {
  const ymList = [...new Set(allTrades.map(t => ymOf(t.date)))].sort();
  const targets = ymList.slice(-months - 1, -1);   // 마지막 달은 신고가 덜 들어와 제외
  const rows = [];

  for (const ym of targets) {
    // **그 달 이전 거래만** — 지수도 비교 거래도 여기서만 나옵니다
    const past = allTrades.filter(t => monthsBetween(ymOf(t.date), ym) >= 1);
    const index = buildIndex(past);
    const floors = buildFloorIndex(past);
    const actuals = allTrades.filter(t => ymOf(t.date) === ym && t.perPyeong > 0);

    for (const a of actuals) {
      const e = estimate(past, index, { seq: a.seq, area: a.area, asOfYM: ym, lag: 1, floors });
      const b = baseline(past, { seq: a.seq, area: a.area, asOfYM: ym });
      // 등급과 무관하게 **중앙값은 늘 계산해** 재 봅니다 — 어느 창까지 쓸 만한지 알아야 공개 기준을 정합니다.
      const pred = e.perPyeong || (e.n ? Math.round((e.low + e.high) / 2) : null);
      if (!pred) continue;
      rows.push({
        ym, gu: a.gu, grade: e.grade, n: e.n, window: e.window, since: 0,
        year: a.year, floor: a.floor,
        actual: a.perPyeong, pred, published: !!e.perPyeong, base: b,
        e: err(pred, a.perPyeong),
        be: b ? err(b, a.perPyeong) : null,
        inRange: a.perPyeong >= e.low && a.perPyeong <= e.high,
        name: a.name, dong: a.dong, area: a.area, date: a.date,
      });
    }
  }

  const slice = (list, label) => {
    const es = list.map(r => r.e);
    const bes = list.map(r => r.be).filter(v => v != null);
    return {
      label, n: list.length,
      mdape: es.length ? round1(median(es)) : null,
      mae: es.length ? round1(es.reduce((s, v) => s + v, 0) / es.length) : null,
      p90: es.length ? round1([...es].sort((a, b) => a - b)[Math.floor(es.length * 0.9)]) : null,
      within5: es.length ? pct(es.filter(v => v <= 5).length / es.length) : null,
      within10: es.length ? pct(es.filter(v => v <= 10).length / es.length) : null,
      inRange: list.length ? pct(list.filter(r => r.inRange).length / list.length) : null,
      baselineMdape: bes.length ? round1(median(bes)) : null,
    };
  };

  const byKey = (keyFn, label) => {
    const m = new Map();
    for (const r of rows) { const k = keyFn(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r); }
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length).map(([k, v]) => slice(v, `${label} ${k}`));
  };

  const ageBand = r => (!r.year ? '모름' : new Date().getFullYear() - r.year <= 10 ? '10년 이하'
    : new Date().getFullYear() - r.year <= 25 ? '11~25년' : '26년 이상');

  // 면적대 코호트 — 사는 사람도, 거래 빈도도 다릅니다. 전용 60㎡·85㎡ 는 세법·청약에서 쓰는 경계라 그대로 씁니다.
  const areaBand = r => (!(r.area > 0) ? '모름' : r.area <= 60 ? '60㎡ 이하'
    : r.area <= 85 ? '60~85㎡' : r.area <= 135 ? '85~135㎡' : '135㎡ 초과');

  // 층대 코호트 — 층 보정(v3)이 실제로 어디서 듣는지 계속 지켜보기 위해서입니다.
  const floorBandOf = r => (!(r.floor > 0) ? '모름' : r.floor === 1 ? '1층' : r.floor === 2 ? '2층' : '3층 이상');

  const worst = [...rows].sort((a, b) => b.e - a.e).slice(0, 10)
    .map(r => ({ name: r.name, dong: r.dong, gu: r.gu, area: r.area, date: r.date, grade: r.grade, n: r.n, actual: r.actual, pred: r.pred, err: round1(r.e) }));

  return {
    generatedAt: new Date().toISOString(),
    method: '시간순 분할 — 맞히려는 달의 거래는 비교 거래·지수 어디에도 쓰지 않음(lag=1)',
    targetMonths: targets,
    overall: slice(rows, '전체'),
    byGrade: byKey(r => r.grade, '등급'),
    byWindow: byKey(r => r.window + '개월 창', ''),
    byN: byKey(r => (r.n >= 10 ? '10건 이상' : r.n >= 5 ? '5~9건' : '3~4건'), '표본'),
    byAge: byKey(ageBand, '연식'),
    byArea: byKey(areaBand, '전용'),
    byFloor: byKey(floorBandOf, ''),
    byGu: byKey(r => r.gu, '').slice(0, 25),
    worst,
  };
}

function md(m) {
  const row = s => `| ${s.label} | ${s.n.toLocaleString('ko-KR')} | ${s.mdape}% | ${s.mae}% | ${s.p90}% | ${s.within10}% | ${s.inRange}% | ${s.baselineMdape ?? '—'}% |`;
  const head = '| 구분 | 건수 | 중앙오차 | 평균오차 | 상위10%오차 | ±10% 안 | 범위 적중 | 기준선 중앙오차 |\n|---|---|---|---|---|---|---|---|';
  return `# T013 — J-AVM 백테스트

생성 ${m.generatedAt.slice(0, 10)} · 코드 \`scripts/backtest-avm.mjs\` · 수치 \`research/metrics.json\`

## 어떻게 쟀나

${m.method}
검증 대상 달: ${m.targetMonths.join(', ')} (마지막 달은 신고가 덜 들어와 제외)
기준선: 같은 단지·면적대의 **직전 거래 평당가 그대로**(시점 보정도 중앙값도 없음)

**값을 내놓지 않은 건(등급 D·보류)은 정확도 계산에서 뺐습니다.** 모델이 「모르겠다」고 한 것을
틀렸다고 세면 「아무 때나 값을 내놓는 모델」이 더 좋아 보이게 됩니다.

## 전체

${head}
${row(m.overall)}

## 등급별 — 등급이 높을수록 정확해야 합니다

${head}
${m.byGrade.map(row).join('\n')}

## 연식별

${head}
${m.byAge.map(row).join('\n')}

## 면적대별

${head}
${m.byArea.map(row).join('\n')}

## 층대별 — 층 보정(v3)이 듣는 자리

${head}
${m.byFloor.map(row).join('\n')}

## 자치구별 (상위 10)

${head}
${m.byGu.slice(0, 10).map(row).join('\n')}

## 가장 크게 틀린 10건

| 단지 | 전용 | 거래일 | 등급 | 표본 | 실제 평당 | 추정 평당 | 오차 |
|---|---|---|---|---|---|---|---|
${m.worst.map(w => `| ${w.name}(${w.dong}) | ${w.area}㎡ | ${w.date} | ${w.grade} | ${w.n}건 | ${w.actual.toLocaleString('ko-KR')} | ${w.pred.toLocaleString('ko-KR')} | ${w.err}% |`).join('\n')}

## 읽는 법

- **중앙오차(MdAPE)** 가 이 모델의 대표 성적입니다. 평균오차는 몇 건의 큰 실수에 끌려갑니다.
- **범위 적중**은 「우리가 제시한 범위 안에 실제 거래가 들어왔나」입니다. 이 값이 낮으면 범위를 넓혀야 합니다.
- **기준선보다 중앙오차가 낮아야** 이 모델을 쓸 이유가 있습니다.
`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!fs.existsSync(TRADES)) { console.error('data/trades-seoul.json 이 없습니다 — npm run trades:seoul 먼저'); process.exit(1); }
  const months = Number((process.argv.find(a => a.startsWith('--months=')) || '').slice(9)) || 3;
  const T = JSON.parse(fs.readFileSync(TRADES, 'utf8'));
  const m = backtest(T.trades, { months });
  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(m, null, 2));
  fs.writeFileSync(OUT_MD, md(m));
  const o = m.overall;
  console.log(`검증 ${m.targetMonths.join(' ')} · 평가 건수 ${o.n.toLocaleString('ko-KR')}`);
  console.log(`중앙오차 ${o.mdape}% · 평균오차 ${o.mae}% · ±10% 안 ${o.within10}% · 범위 적중 ${o.inRange}%`);
  const d = o.baselineMdape - o.mdape;
  console.log(`기준선(직전 거래 그대로) 중앙오차 ${o.baselineMdape}% → ${d > 0.2 ? '모델이 낫습니다' : d < -0.2 ? '**기준선이 더 낫습니다 — 복잡하게 만들 이유가 없습니다**' : '정확도는 사실상 같습니다(모델이 더하는 것은 범위·등급·특이거래 방어)'}`);
  console.log(`등급별: ${m.byGrade.map(g => `${g.label} ${g.mdape}%(${g.n})`).join(' · ')}`);
  console.log(`→ research/metrics.json · research/avm-backtest.md`);
}
