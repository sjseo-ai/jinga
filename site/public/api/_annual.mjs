// 연간 누적 기록 — 주간 운영 실행(api/_job.mjs map 단계)이 KB시세 서울 전체 집계를 해마다 annual/<연도>.json(비공개 Blob)에 쌓음
//   · 연도 = KB시세 기준일(asOf 'YYYY.MM.DD')의 연도. 같은 기준일은 한 번만 반영(작업을 다시 돌려도 중복 없음)
//   · 서울·구·동: 그해 첫 주·마지막 주 평당가(전용, 만원) + 주간 합계·주 수(→ 연평균) → 연간 변동률
//   · 단지: 그해 첫 주·마지막 주 주택형별 [전용㎡, KB 일반가, KB 전세가] → 단지·주택형 연간 변동률
// 원천에 과거가 남지 않는 값만 쌓음. KB 주간·월간 시장 지표는 원천(KB데이터허브)에 2003년부터 있어 /api/market-flow 가 매번 연도별로 계산.
export const ANNUAL_PREFIX = 'annual/';
export const annualPath = year => `${ANNUAL_PREFIX}${year}.json`;
export const yearOfAsOf = asOf => { const m = String(asOf || '').match(/^(\d{4})[.-]/); return m ? Number(m[1]) : null; };

const r0 = v => Math.round(v);
export const pct = (a, b) => (a > 0 && b > 0 ? Math.round((a / b - 1) * 10000) / 100 : null);
const typesOf = c => (c.types || []).filter(t => t.provided && t.price > 0 && t.excl > 0).map(t => [Math.round(t.excl * 100) / 100, t.price, t.jeonse || 0]);

/**
 * 이번 주 KB 집계를 그해 기록에 반영 — 같은 asOf 가 이미 있으면 prev 를 그대로 돌려줌(저장할 필요 없음)
 * map: api/_weekly.mjs aggregate() 결과 { seoul:{avgPerPyeong}, gu:{ 구:{avgPerPyeong, dongs:[{name, avgPerPyeong}]} } }
 * complexes: [{ id, name, gu, dong, types:[compactKbTypes] }]
 */
export function updateAnnual(prev, { asOf, map, complexes = [], now = new Date() }) {
  const year = yearOfAsOf(asOf);
  if (!year || !map || !map.gu) return prev || null;
  if (prev && prev.year === year && prev.weeks.includes(asOf)) return prev;
  const rec = prev && prev.year === year ? structuredClone(prev) : { year, weeks: [], seoul: {}, gu: {}, complexes: {} };
  rec.weeks.push(asOf);
  rec.weeks.sort();
  const isFirst = rec.weeks[0] === asOf, isLast = rec.weeks[rec.weeks.length - 1] === asOf;   // 늦게 들어온 과거 주도 순서대로 반영
  const put = (s, pp) => {
    if (!(pp > 0)) return;
    if (!s.first || isFirst) s.first = { asOf, pp: r0(pp) };
    if (!s.last || isLast) s.last = { asOf, pp: r0(pp) };
    s.sum = r0((s.sum || 0) + pp);
    s.n = (s.n || 0) + 1;
  };
  put(rec.seoul, map.seoul && map.seoul.avgPerPyeong);
  for (const [gu, g] of Object.entries(map.gu)) {
    const G = rec.gu[gu] = rec.gu[gu] || { dongs: {} };
    put(G, g.avgPerPyeong);
    for (const d of g.dongs || []) put(G.dongs[d.name] = G.dongs[d.name] || {}, d.avgPerPyeong);
  }
  for (const c of complexes) {
    const ts = typesOf(c);
    if (!ts.length) continue;
    const C = rec.complexes[c.id] = rec.complexes[c.id] || { name: c.name, gu: c.gu, dong: c.dong };
    if (!C.first || isFirst) C.first = { asOf, t: ts };
    if (!C.last || isLast) C.last = { asOf, t: ts };
  }
  rec.updatedAt = now.toISOString();
  return rec;
}

const slotView = s => (s && s.first ? { first: s.first, last: s.last, avg: s.n ? r0(s.sum / s.n) : null, weeks: s.n || 0, pct: pct(s.last.pp, s.first.pp) } : null);

/** 그해 서울·구·동 요약 — { year, weeks, seoul, gu:{ 구:{first,last,avg,weeks,pct, dongs:{동:{…}}} } } */
export function annualAreaView(rec) {
  if (!rec) return null;
  return {
    year: rec.year, weeks: rec.weeks, updatedAt: rec.updatedAt, seoul: slotView(rec.seoul),
    gu: Object.fromEntries(Object.entries(rec.gu).map(([n, g]) => [n, { ...slotView(g), dongs: Object.fromEntries(Object.entries(g.dongs || {}).map(([dn, d]) => [dn, slotView(d)])) }])),
  };
}

/** 단지 하나의 그해 주택형 변동 — 전용㎡(정수)가 같은 주택형끼리 첫 주 대비 마지막 주 */
export function complexYearView(rec, id) {
  const C = rec && rec.complexes && rec.complexes[id];
  if (!C || !C.first || !C.last) return null;
  return {
    year: rec.year, first: C.first.asOf, last: C.last.asOf,
    types: C.last.t.map(([excl, price, jeonse]) => {
      const f = C.first.t.find(x => Math.round(x[0]) === Math.round(excl));
      return { excl, price, jeonse, firstPrice: f ? f[1] : null, pct: f ? pct(price, f[1]) : null };
    }),
  };
}

/**
 * 여러 해 기록에서 단지·주택형(전용㎡ 정수)의 연도별 흐름 — { years:{ 2026:{first,last,price,pct} }, sinceLastYearEnd }
 * sinceLastYearEnd: 올해 마지막 주 KB 일반가 ÷ 작년 마지막 주 KB 일반가 − 1 (작년 기록이 있어야 계산)
 */
export function complexTrend(viewsByYear, excl) {
  const key = Math.round(excl);
  const years = {};
  for (const [y, v] of Object.entries(viewsByYear || {})) {
    const t = v && v.types.find(x => Math.round(x.excl) === key);
    if (t) years[y] = { first: v.first, last: v.last, price: t.price, pct: t.pct };
  }
  const ys = Object.keys(years).map(Number).sort((a, b) => a - b);
  const cur = ys[ys.length - 1], prev = ys.find(y => y === cur - 1);
  return { years, sinceLastYearEnd: cur && prev ? pct(years[cur].price, years[prev].price) : null };
}
