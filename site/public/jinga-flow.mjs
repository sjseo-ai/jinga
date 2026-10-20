// 진가 시장 흐름 대시보드(부동산 탭) — /api/market-flow 데이터를 여러 그래프로 동시에 표시
// index.html 이 Chart.js(UMD 전역)를 넘겨 mountMarketFlow() 를 부름. 계산 도우미·그래프 구성은 scripts/smoke-flow.mjs 에서도 씀.

// 'annual'(연도별)은 기간 대신 연도 단위 그래프 묶음(ANNUAL_CHARTS)으로 바뀜
export const RANGES = { '6m': { label: '6개월', days: 183 }, '1y': { label: '1년', days: 366 }, '3y': { label: '3년', days: 1096 }, annual: { label: '연도별', days: 0 } };
export const FLOW_REGIONS = ['서울', '강남11개구', '강북14개구', '수도권', '전국'];
const REGION_LABEL = { 강남11개구: '강남 11개구', 강북14개구: '강북 14개구' };
export const regionLabel = r => REGION_LABEL[r] || r;
const C = { blue: '#1E5FCC', orange: '#E0673A', green: '#16805A', gold: '#C9971C', ink: '#0E1C2B', purple: '#7B5CC4', gray: '#9AA8B6', red: '#D93C3C' };
const REGION_COLORS = { 서울: C.blue, 강남11개구: C.orange, 강북14개구: C.green, 수도권: C.purple, 전국: C.gray };
const DAY = 864e5;

// ── 계산 도우미 ───────────────────────────────────────────────
export const toTime = d => { const [y, m = 1, day = 1] = String(d).split('-').map(Number); return Date.UTC(y, m - 1, day); };
/** 날짜·값 배열 → [{x, y}] (since 이후, 빈 값은 y:null 로 남겨 같은 날짜축끼리 줄이 맞게) */
export function points(dates, vals, since = -Infinity) {
  const out = [];
  (dates || []).forEach((d, i) => {
    const x = toTime(d);
    if (x < since) return;
    const y = vals ? vals[i] : null;
    out.push({ x, y: y == null || !Number.isFinite(y) ? null : y });
  });
  return out;
}
/** 첫 값을 100으로 */
export function rebase(pts) {
  const b = pts.find(p => p.y)?.y;
  return b ? pts.map(p => ({ x: p.x, y: p.y == null ? null : Math.round((p.y / b) * 10000) / 100 })) : [];
}
/** 직전 대비 변동률(%) */
export function changes(pts) {
  return pts.slice(1).map((p, i) => {
    const prev = pts[i].y;
    return { x: p.x, y: p.y == null || !prev ? null : Math.round((p.y / prev - 1) * 10000) / 100 };
  });
}
/** 마지막 값과 그 직전 값 */
export function lastTwo(dates, vals) {
  if (!vals) return null;
  let i = vals.length - 1;
  while (i >= 0 && vals[i] == null) i--;
  if (i < 0) return null;
  let j = i - 1;
  while (j >= 0 && vals[j] == null) j--;
  return { date: dates[i], value: vals[i], prev: j >= 0 ? vals[j] : null, prevDate: j >= 0 ? dates[j] : null };
}
/** 기간 시작 시각 — 가장 최근 주간 기준일에서 거꾸로 */
export function sinceFor(data, range) {
  const last = data && data.weekly && data.weekly.dates && data.weekly.dates[data.weekly.dates.length - 1];
  return (last ? toTime(last) : Date.now()) - (RANGES[range] || RANGES['1y']).days * DAY;
}
const pctOf = lt => (lt && lt.prev ? (lt.value / lt.prev - 1) * 100 : null);
const diffOf = lt => (lt && lt.prev != null ? lt.value - lt.prev : null);
const signed = (v, d = 2, unit = '') => (v == null || !Number.isFinite(v) ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(d)}${unit}`);
const dirOf = v => (v == null || Math.abs(v) < 1e-9 ? '' : v > 0 ? 'up' : 'down');
const ym = d => String(d || '').slice(0, 7).replace('-', '.');
export const fmtDate = (x, monthly) => {
  const d = new Date(x);
  const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1, day = d.getUTCDate();
  return monthly ? `${y}.${String(m).padStart(2, '0')}` : `${y}.${String(m).padStart(2, '0')}.${String(day).padStart(2, '0')}`;
};
const ratePoints = (r, since) => (r && r.points ? r.points.filter(p => toTime(p[0]) >= since).map(p => ({ x: toTime(p[0]), y: p[1] })) : []);
const hasData = pts => pts.some(p => p.y != null);

// ── 그래프 구성 ──────────────────────────────────────────────
// build(data, { region, since }) → { series:[{label, color, data, type, axis, fill, width, dash, step}], latest:{value, sub, dir}, yUnit, y2Unit, ref, monthly, mixed } | null
export const CHARTS = [
  {
    id: 'price', title: '매매·전세 가격지수', source: 'KB 주간 아파트 가격동향',
    read: '지수가 오르면 가격이 오른 것입니다. 매매와 전세가 같은 방향이면 흐름이 뚜렷하고, 전세만 오르면 매매로 옮겨 갈 압력이 쌓이는 중입니다.',
    build(d, { region, since }) {
      const w = d.weekly, rg = w && w.regions[region];
      if (!rg) return null;
      const lt = lastTwo(w.dates, rg.sale), jt = lastTwo(w.dates, rg.jeonse);
      return {
        series: [
          { label: '매매지수', color: C.blue, data: points(w.dates, rg.sale, since), fill: true },
          { label: '전세지수', color: C.orange, data: points(w.dates, rg.jeonse, since) },
        ],
        latest: lt && { value: lt.value.toFixed(2), sub: `매매 ${signed(pctOf(lt), 2, '%')} · 전세 ${signed(pctOf(jt), 2, '%')} 전주`, dir: dirOf(pctOf(lt)) },
      };
    },
  },
  {
    id: 'change', title: '주간 변동률', source: 'KB 주간 아파트 가격지수 전주 대비',
    read: '0선 위는 상승, 아래는 하락입니다. 막대가 점점 길어지면 흐름이 빨라지는 중이고, 짧아지면 힘이 빠지는 중입니다.',
    build(d, { region, since }) {
      const w = d.weekly, rg = w && w.regions[region];
      if (!rg) return null;
      const s = changes(points(w.dates, rg.sale)).filter(p => p.x >= since);
      const j = changes(points(w.dates, rg.jeonse)).filter(p => p.x >= since);
      const last = [...s].reverse().find(p => p.y != null);
      return {
        series: [
          { label: '매매', color: C.blue, data: s, type: 'bar' },
          { label: '전세', color: C.orange, data: j, type: 'bar' },
        ],
        yUnit: '%', ref: 0,
        latest: last && { value: signed(last.y, 2, '%'), sub: `매매 · ${fmtDate(last.x)} 주`, dir: dirOf(last.y) },
      };
    },
  },
  {
    id: 'buyer', title: '매수우위지수 · 매매거래지수', source: 'KB 주간 중개업소 설문(0~200)',
    read: '매수우위지수가 100을 넘으면 "사려는 사람이 더 많다"는 뜻으로 가격 상승 압력입니다. 매매거래지수가 100을 넘으면 거래가 활발합니다.',
    build(d, { region, since }) {
      const w = d.weekly, rg = w && w.regions[region];
      if (!rg || !rg.buyer) return null;
      const lt = lastTwo(w.dates, rg.buyer);
      return {
        series: [
          { label: '매수우위지수', color: C.blue, data: points(w.dates, rg.buyer, since), width: 2.4 },
          { label: '매매거래지수', color: C.green, data: points(w.dates, rg.trade, since) },
        ],
        ref: 100,
        latest: lt && { value: lt.value.toFixed(1), sub: `매수우위 · 전주 ${signed(diffOf(lt), 1, 'p')} · ${lt.value >= 100 ? '매수자 우위' : '매도자 우위'}`, dir: dirOf(diffOf(lt)) },
      };
    },
  },
  {
    id: 'jeonse', title: '전세수급지수 · 전세거래지수', source: 'KB 주간 중개업소 설문(0~200)',
    read: '전세수급지수가 100을 넘으면 전세 물건이 부족하다는 뜻으로 전셋값 상승 압력입니다. 높은 상태가 이어지면 매매 전환 수요로 번지기 쉽습니다.',
    build(d, { region, since }) {
      const w = d.weekly, rg = w && w.regions[region];
      if (!rg || !rg.jeonseSupply) return null;
      const lt = lastTwo(w.dates, rg.jeonseSupply);
      return {
        series: [
          { label: '전세수급지수', color: C.orange, data: points(w.dates, rg.jeonseSupply, since), width: 2.4 },
          { label: '전세거래지수', color: C.green, data: points(w.dates, rg.jeonseTrade, since) },
        ],
        ref: 100,
        latest: lt && { value: lt.value.toFixed(1), sub: `전세수급 · 전주 ${signed(diffOf(lt), 1, 'p')} · ${lt.value >= 100 ? '공급 부족' : '공급 여유'}`, dir: dirOf(diffOf(lt)) },
      };
    },
  },
  {
    id: 'regions', title: '지역별 매매지수 흐름', source: 'KB 주간 매매지수 · 기간 시작 = 100',
    read: '같은 기간 어느 지역이 더 올랐는지 비교합니다. 선이 위에 있을수록 기간 동안 많이 오른 지역입니다(굵은 선 = 선택 지역).',
    build(d, { region, since }) {
      const w = d.weekly;
      if (!w) return null;
      const series = FLOW_REGIONS.filter(r => w.regions[r] && w.regions[r].sale).map(r => ({
        label: regionLabel(r), color: REGION_COLORS[r], data: rebase(points(w.dates, w.regions[r].sale, since)), width: r === region ? 3 : 1.6,
      }));
      const mine = series.find(s => s.label === regionLabel(region));
      const last = mine && [...mine.data].reverse().find(p => p.y != null);
      return {
        series, ref: 100,
        latest: last && { value: signed(last.y - 100, 2, '%'), sub: `${regionLabel(region)} · 기간 누적`, dir: dirOf(last.y - 100) },
      };
    },
  },
  {
    id: 'ratio', title: '전세가율', source: 'KB 월간 · 매매가격 대비 전세가격 비율',
    read: '전세가율이 높을수록 매매가와 전세가 차이(갭)가 작아 매수 전환이 쉬워집니다. 낮으면 전세 대기 수요가 많은 상태입니다.',
    build(d, { region, since }) {
      const r = d.monthly && d.monthly.ratio;
      if (!r) return null;
      const list = [...new Set(['서울', '강남11개구', '강북14개구', '전국', region])].filter(k => r.regions[k]);
      const lt = lastTwo(r.dates, r.regions[region]);
      return {
        series: list.map(k => ({ label: regionLabel(k), color: REGION_COLORS[k], data: points(r.dates, r.regions[k], since), width: k === region ? 3 : 1.6 })),
        yUnit: '%', monthly: true,
        latest: lt && { value: `${lt.value.toFixed(1)}%`, sub: `${regionLabel(region)} · ${ym(lt.date)} · 전월 ${signed(diffOf(lt), 2, '%p')}`, dir: dirOf(diffOf(lt)) },
      };
    },
  },
  {
    id: 'rates', title: '시장금리', source: '국고채 3·10년 · CD 91일(일별) · COFIX 신규취급액(월별)',
    read: '주담대 고정(혼합)금리는 국고채·은행채 금리를, 변동금리는 COFIX를 따라 움직입니다. 금리가 내려가면 매수 여력이 커집니다.',
    build(d, { since }) {
      const rs = d.rates || {};
      const series = [
        ['KR3YT', C.blue, {}], ['KR10YT', C.ink, {}], ['CD91', C.green, {}], ['COFIX', C.orange, { step: true, width: 2.4 }],
      ].filter(([k]) => rs[k]).map(([k, color, extra]) => ({ label: rs[k].name, color, data: ratePoints(rs[k], since), ...extra }));
      if (!series.length) return null;
      const main = series[0].data.filter(p => p.y != null);
      const first = main[0], last = main[main.length - 1];
      return {
        series, yUnit: '%', mixed: true,
        latest: last && { value: `${last.y.toFixed(2)}%`, sub: `${series[0].label} · 기간 시작 대비 ${signed(last.y - first.y, 2, '%p')}`, dir: dirOf(last.y - first.y) },
      };
    },
  },
  {
    id: 'lead50', title: '선도아파트 50 지수', source: 'KB 월간 · 시가총액 상위 50개 단지',
    read: '대장 단지 50곳의 가격 흐름입니다. 시장 전체보다 먼저 움직이는 경향이 있어 방향 전환의 신호로 봅니다(막대 = 전년 같은 달 대비).',
    build(d, { since }) {
      const l = d.monthly && d.monthly.lead50;
      if (!l) return null;
      const yoy = points(l.dates, l.yoy, since);
      const lt = lastTwo(l.dates, l.index), yt = lastTwo(l.dates, l.yoy);
      return {
        series: [
          { label: '선도50 지수', color: C.ink, data: points(l.dates, l.index, since), width: 2.4 },
          { label: '전년동월 대비(%)', color: C.gold, data: yoy, type: 'bar', axis: 'y2' },
        ],
        y2Unit: '%', monthly: true,
        latest: lt && { value: lt.value.toFixed(2), sub: `${ym(lt.date)} · 전년동월 ${signed(yt && yt.value, 2, '%')}`, dir: dirOf(yt && yt.value) },
      };
    },
  },
  {
    id: 'hai', title: '주택구매력지수(HAI) · 주담대 금리', source: 'KB 월간 · 아파트 기준',
    read: '100이면 중위소득 가구가 중간 가격 아파트를 대출을 끼고 무리 없이 살 수 있는 수준입니다. 낮을수록 구입 부담이 크고, 금리가 내리면 올라갑니다.',
    build(d, { region, since }) {
      const h = d.monthly && d.monthly.hai;
      if (!h) return null;
      const key = h.apt[region] ? region : '서울';
      const list = [...new Set([key, '전국'])].filter(k => h.apt[k]);
      const lt = lastTwo(h.dates, h.apt[key]), rt = lastTwo(h.dates, h.loanRate);
      return {
        series: [
          ...list.map(k => ({ label: `${regionLabel(k)} 아파트 HAI`, color: REGION_COLORS[k], data: points(h.dates, h.apt[k], since), width: k === key ? 2.6 : 1.6 })),
          { label: '주담대 금리(%)', color: C.red, data: points(h.dates, h.loanRate, since), axis: 'y2', dash: [5, 4] },
        ],
        y2Unit: '%', monthly: true,
        latest: lt && { value: lt.value.toFixed(1), sub: `${regionLabel(key)} · ${ym(lt.date)} · 주담대 ${rt ? rt.value.toFixed(2) + '%' : '—'}`, dir: dirOf(diffOf(lt)) },
      };
    },
  },
];
export const DEFAULT_ON = CHARTS.map(c => c.id);

// ── 연도별 보기(기간 「연도별」) — /api/market-flow 의 annual 블록 ───────────
const lastIdx = arr => { if (!arr) return -1; for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null) return i; return -1; };
const yearPoints = (years, vals) => years.map((y, i) => ({ x: y, y: vals && vals[i] != null ? vals[i] : null }));
const yearLabel = (a, y) => (y === a.ytdYear ? `${y}년(연초~${String(a.asOf).slice(5).replace('-', '.')})` : `${y}년`);
export const ANNUAL_CHARTS = [
  {
    id: 'a-price', title: '연간 매매·전세 변동률', source: 'KB 주간 아파트 가격지수 · 전년 말 대비(올해는 연초~기준일)',
    read: '막대가 0선 위면 그해 오른 것, 아래면 내린 것입니다. 같은 방향이 여러 해 이어지면 추세가 강한 시기입니다.',
    build(d, { region }) {
      const a = d.annual, r = a && a.regions[region];
      if (!r || !r.saleChg) return null;
      const i = lastIdx(r.saleChg);
      return {
        series: [
          { label: '매매', color: C.blue, data: yearPoints(a.years, r.saleChg), type: 'bar' },
          { label: '전세', color: C.orange, data: yearPoints(a.years, r.jeonseChg), type: 'bar' },
        ],
        yUnit: '%', ref: 0, yearly: true,
        latest: i >= 0 && { value: signed(r.saleChg[i], 2, '%'), sub: `${yearLabel(a, a.years[i])} 매매 · 전세 ${signed(r.jeonseChg && r.jeonseChg[i], 2, '%')}`, dir: dirOf(r.saleChg[i]) },
      };
    },
  },
  {
    id: 'a-regions', title: '지역별 연간 매매 변동률', source: 'KB 주간 매매지수 · 전년 말 대비',
    read: '해마다 어느 지역이 더 올랐는지 비교합니다. 강남과 강북의 차이가 벌어지거나 좁혀지는 흐름을 볼 수 있습니다.',
    build(d, { region }) {
      const a = d.annual;
      if (!a) return null;
      const series = FLOW_REGIONS.filter(r => a.regions[r] && a.regions[r].saleChg).map(r => ({ label: regionLabel(r), color: REGION_COLORS[r], data: yearPoints(a.years, a.regions[r].saleChg), type: 'bar' }));
      const mine = a.regions[region] && a.regions[region].saleChg, i = lastIdx(mine);
      return { series, yUnit: '%', ref: 0, yearly: true, latest: i >= 0 && { value: signed(mine[i], 2, '%'), sub: `${regionLabel(region)} · ${yearLabel(a, a.years[i])}`, dir: dirOf(mine[i]) } };
    },
  },
  {
    id: 'a-sentiment', title: '매수우위·전세수급 연평균', source: 'KB 주간 중개업소 설문 · 그해 주간 값 평균(0~200)',
    read: '매수우위 연평균이 높았던 해는 사려는 사람이 많았던 해, 전세수급이 100을 크게 넘은 해는 전세 물건이 부족했던 해입니다.',
    build(d, { region }) {
      const a = d.annual, r = a && a.regions[region];
      if (!r || (!r.buyerAvg && !r.jeonseSupplyAvg)) return null;
      const i = lastIdx(r.buyerAvg);
      return {
        series: [
          { label: '매수우위 연평균', color: C.blue, data: yearPoints(a.years, r.buyerAvg), width: 2.4 },
          { label: '전세수급 연평균', color: C.orange, data: yearPoints(a.years, r.jeonseSupplyAvg), width: 2.4 },
        ],
        ref: 100, yearly: true,
        latest: i >= 0 && { value: r.buyerAvg[i].toFixed(1), sub: `${yearLabel(a, a.years[i])} 매수우위 · 전세수급 ${r.jeonseSupplyAvg && r.jeonseSupplyAvg[i] != null ? r.jeonseSupplyAvg[i].toFixed(1) : '—'}` },
      };
    },
  },
  {
    id: 'a-ratio', title: '연말 전세가율', source: 'KB 월간 · 그해 마지막 달 값',
    read: '해마다 전세가율이 높아지면 매매 전환 압력이 커지고, 낮아지면 매매가가 전세보다 빨리 오른 해입니다.',
    build(d, { region }) {
      const a = d.annual;
      if (!a) return null;
      const list = [...new Set(['서울', '강남11개구', '강북14개구', '전국', region])].filter(k => a.regions[k] && a.regions[k].ratioEnd);
      if (!list.length) return null;
      const mine = a.regions[region] && a.regions[region].ratioEnd, i = lastIdx(mine);
      return {
        series: list.map(k => ({ label: regionLabel(k), color: REGION_COLORS[k], data: yearPoints(a.years, a.regions[k].ratioEnd), width: k === region ? 3 : 1.6 })),
        yUnit: '%', yearly: true,
        latest: i >= 0 && { value: `${mine[i].toFixed(1)}%`, sub: `${regionLabel(region)} · ${yearLabel(a, a.years[i])}` },
      };
    },
  },
  {
    id: 'a-lead50', title: '선도아파트 50 연간 변동률', source: 'KB 월간 · 전년 말 대비',
    read: '대장 단지 50곳이 해마다 얼마나 움직였는지입니다. 시장 전체보다 먼저, 더 크게 움직이는 경향이 있습니다.',
    build(d) {
      const a = d.annual;
      if (!a || !a.lead50Chg) return null;
      const i = lastIdx(a.lead50Chg);
      return {
        series: [{ label: '선도50 연간 변동률', color: C.gold, data: yearPoints(a.years, a.lead50Chg), type: 'bar' }],
        yUnit: '%', ref: 0, yearly: true,
        latest: i >= 0 && { value: signed(a.lead50Chg[i], 2, '%'), sub: yearLabel(a, a.years[i]), dir: dirOf(a.lead50Chg[i]) },
      };
    },
  },
  {
    id: 'a-rates', title: '시장금리 연평균', source: '네이버 금융 · 국고채·CD 일별 평균 · COFIX 월별 평균',
    read: '금리가 해마다 내려가면 대출 부담이 줄어 매수 여력이 커집니다. 일별 금리는 받을 수 있는 기간(약 3년)만, COFIX는 약 5년 표시합니다.',
    build(d) {
      const a = d.annual, rs = a && a.rates;
      if (!rs) return null;
      const series = [['COFIX', C.orange], ['KR3YT', C.blue], ['KR10YT', C.ink], ['CD91', C.green]].filter(([k]) => rs[k]).map(([k, color]) => ({ label: rs[k].name, color, data: yearPoints(a.years, rs[k].avg) }));
      if (!series.length) return null;
      const main = rs.COFIX || rs.KR3YT, i = lastIdx(main.avg);
      return { series, yUnit: '%', yearly: true, latest: i >= 0 && { value: `${main.avg[i].toFixed(2)}%`, sub: `${main.name} · ${yearLabel(a, a.years[i])} 평균` } };
    },
  },
];
export const DEFAULT_ON_ANNUAL = ANNUAL_CHARTS.map(c => c.id);

/** 한 그래프의 구성(데이터가 전혀 없으면 null) */
export function buildSpec(chartId, data, opts) {
  const def = CHARTS.find(c => c.id === chartId) || ANNUAL_CHARTS.find(c => c.id === chartId);
  if (!def || !data) return null;
  let spec = null;
  try { spec = def.build(data, opts); } catch (e) { return null; }
  if (!spec || !spec.series || !spec.series.some(s => hasData(s.data))) return null;
  if (spec.yearly && data.annual) spec.ytd = data.annual.ytdYear;
  return spec;
}

// ── 화면 ────────────────────────────────────────────────────
const fmtVal = (v, unit) => (v == null ? '—' : `${Math.abs(v) >= 100 ? v.toFixed(1) : v.toFixed(2)}${unit || ''}`);
const refLine = value => ({
  id: 'flowRefLine',
  afterDatasetsDraw(chart) {
    const y = chart.scales.y;
    if (!y || value < y.min || value > y.max) return;
    const py = y.getPixelForValue(value), { left, right } = chart.chartArea, c = chart.ctx;
    c.save(); c.strokeStyle = 'rgba(14,28,43,.38)'; c.lineWidth = 1; c.setLineDash([4, 4]);
    c.beginPath(); c.moveTo(left, py); c.lineTo(right, py); c.stroke(); c.restore();
  },
});

function drawChart(Chart, canvas, spec) {
  const xs = spec.series.flatMap(s => s.data.filter(p => p.y != null).map(p => p.x));
  const min = Math.min(...xs), max = Math.max(...xs), span = max - min;
  const yearly = !!spec.yearly;
  const hasY2 = spec.series.some(s => s.axis === 'y2');
  const tick = { color: '#8696A6', font: { family: 'Pretendard', size: 10.5 } };
  const tickDate = v => { const d = new Date(v); return span < 200 * DAY ? `${d.getUTCMonth() + 1}/${d.getUTCDate()}` : `${String(d.getUTCFullYear()).slice(2)}.${d.getUTCMonth() + 1}`; };
  return new Chart(canvas, {
    data: {
      datasets: spec.series.map(s => {
        const bar = s.type === 'bar';
        return {
          type: bar ? 'bar' : 'line', label: s.label, data: s.data, yAxisID: s.axis || 'y',
          borderColor: s.color, borderWidth: bar ? 0 : s.width || 2, borderDash: s.dash || [],
          backgroundColor: bar ? s.data.map(p => (p.y != null && p.y < 0 && s.axis !== 'y2' ? s.color + '88' : s.color + 'CC')) : s.fill ? s.color + '1F' : s.color,
          fill: !!s.fill, pointRadius: 0, pointHoverRadius: 4, tension: s.step || yearly ? 0 : 0.25, stepped: s.step ? 'before' : false,   // 연도별은 점이 적어 곡선이 실제 값 위아래로 튀므로 직선
          spanGaps: true, order: bar ? 2 : 1, barPercentage: 0.9, categoryPercentage: 0.9, maxBarThickness: yearly ? 22 : 9,
          pointRadius: yearly && !bar ? 3 : 0,
        };
      }),
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false, normalized: true,
      interaction: { mode: spec.mixed ? 'nearest' : 'index', axis: 'x', intersect: false },
      plugins: {
        legend: { display: true, position: 'bottom', labels: { color: '#5E6E7E', font: { family: 'Pretendard', size: 11 }, boxWidth: 10, boxHeight: 10, padding: 10 } },
        tooltip: {
          backgroundColor: '#0E1C2B', padding: 10, titleFont: { family: 'Pretendard', weight: '700' }, bodyFont: { family: 'Pretendard' },
          filter: item => item.parsed.y != null,
          callbacks: {
            title: items => (!items.length ? '' : yearly ? `${items[0].parsed.x}년${items[0].parsed.x === spec.ytd ? '(연초~기준일)' : ''}` : fmtDate(items[0].parsed.x, spec.monthly && !spec.mixed)),
            label: c => `${c.dataset.label}  ${fmtVal(c.parsed.y, c.dataset.yAxisID === 'y2' ? spec.y2Unit : spec.yUnit)}`,
          },
        },
      },
      scales: {
        x: yearly
          ? {
            type: 'linear', min: min - 0.6, max: max + 0.6, grid: { display: false },
            // 축 끝 여백(±0.6) 때문에 눈금이 소수 위치에서 시작해 첫해·마지막 해 이름이 빠지던 문제 → 해마다 정수 위치에 눈금
            afterBuildTicks: axis => { axis.ticks = []; for (let v = Math.ceil(min); v <= Math.floor(max); v++) axis.ticks.push({ value: v }); },
            ticks: { ...tick, autoSkip: false, maxRotation: 0, callback: v => `${String(v).slice(2)}년` },
          }
          : { type: 'linear', min, max, grid: { display: false }, ticks: { ...tick, maxTicksLimit: 6, maxRotation: 0, callback: tickDate } },
        y: { position: 'right', grid: { color: '#EEF1F4' }, ticks: { ...tick, maxTicksLimit: 6, callback: v => `${+Number(v).toFixed(2)}${spec.yUnit || ''}` } },
        ...(hasY2 ? { y2: { position: 'left', grid: { display: false }, ticks: { ...tick, maxTicksLimit: 6, callback: v => `${+Number(v).toFixed(2)}${spec.y2Unit || ''}` } } } : {}),
      },
    },
    plugins: spec.ref != null ? [refLine(spec.ref)] : [],
  });
}

const STORE_KEY = 'jinga-flow:v1';
const readPrefs = () => { try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch (e) { return {}; } };
const writePrefs = p => { try { localStorage.setItem(STORE_KEY, JSON.stringify(p)); } catch (e) { /* 저장 불가(사생활 보호 모드 등) */ } };
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** 상단 펄스 밴드의 KB 칸 채우기(서울 고정) */
function fillPulse(data) {
  const set = (id, big, delta, dir) => {
    const b = document.getElementById(id), dEl = document.getElementById(id + 'D');
    if (b) b.textContent = big;
    if (dEl) { dEl.textContent = delta; dEl.className = 'delta' + (dir ? ' ' + dir : ''); }
  };
  const w = data.weekly, s = w && w.regions.서울;
  const arrow = v => (v == null ? '' : v > 0 ? '▲ ' : v < 0 ? '▼ ' : '');
  const short = d => String(d || '').slice(5).replace('-', '.');
  const sale = s && lastTwo(w.dates, s.sale);
  if (sale) { const p = pctOf(sale); set('pulseKb', sale.value.toFixed(2), `${arrow(p)}${Math.abs(p).toFixed(2)}% 전주 · ${short(sale.date)} 기준`, dirOf(p)); }
  const buyer = s && lastTwo(w.dates, s.buyer);
  if (buyer) { const v = diffOf(buyer); set('pulseBuyer', buyer.value.toFixed(1), `${arrow(v)}${Math.abs(v).toFixed(1)}p 전주 · ${buyer.value >= 100 ? '매수자 우위' : '매도자 우위'}`, dirOf(v)); }
  const js = s && lastTwo(w.dates, s.jeonseSupply);
  if (js) { const v = diffOf(js); set('pulseJeonse', js.value.toFixed(1), `${arrow(v)}${Math.abs(v).toFixed(1)}p 전주 · ${js.value >= 100 ? '전세 공급 부족' : '전세 공급 여유'}`, dirOf(v)); }
  const bond = data.rates && data.rates.KR3YT && data.rates.KR3YT.points;
  if (bond && bond.length > 1) {
    const [d1, v1] = bond[bond.length - 1], v0 = bond[bond.length - 2][1], v = v1 - v0;
    set('pulseBond', `${v1.toFixed(2)}%`, `${arrow(v)}${Math.abs(v).toFixed(3)}%p 전일 · ${short(d1)} 기준`, dirOf(v));
  }
  const r = data.monthly && data.monthly.ratio;
  const ratio = r && lastTwo(r.dates, r.regions.서울);
  if (ratio) { const v = diffOf(ratio); set('pulseRatio', `${ratio.value.toFixed(1)}%`, `${arrow(v)}${Math.abs(v).toFixed(2)}%p 전월 · ${ym(ratio.date)}`, dirOf(v)); }
}

export function mountMarketFlow({ Chart, url = '/api/market-flow' } = {}) {
  const $ = id => document.getElementById(id);
  const grid = $('flowGrid'), chips = $('flowChips'), regionSel = $('flowRegion'), rangeSeg = $('flowRange'), flag = $('flowFlag'), note = $('flowNote');
  const prefs = readPrefs();
  const state = {
    data: null,
    region: FLOW_REGIONS.includes(prefs.region) ? prefs.region : '서울',
    range: RANGES[prefs.range] ? prefs.range : '1y',
    on: new Set(Array.isArray(prefs.on) ? prefs.on.filter(id => CHARTS.some(c => c.id === id)) : DEFAULT_ON),
    onAnnual: new Set(Array.isArray(prefs.onAnnual) ? prefs.onAnnual.filter(id => ANNUAL_CHARTS.some(c => c.id === id)) : DEFAULT_ON_ANNUAL),
    charts: [],
  };
  const isAnnual = () => state.range === 'annual';
  const listFor = () => (isAnnual() ? ANNUAL_CHARTS : CHARTS);
  const setFor = () => (isAnnual() ? state.onAnnual : state.on);
  const save = () => writePrefs({ region: state.region, range: state.range, on: [...state.on], onAnnual: [...state.onAnnual] });

  regionSel.innerHTML = FLOW_REGIONS.map(r => `<option value="${esc(r)}"${r === state.region ? ' selected' : ''}>${esc(regionLabel(r))}</option>`).join('');
  rangeSeg.innerHTML = Object.entries(RANGES).map(([k, v]) => `<button type="button" data-range="${k}" class="${k === state.range ? 'on' : ''}">${v.label}</button>`).join('');
  const renderChips = () => {
    const list = listFor(), on = setFor();
    chips.innerHTML = list.map(c => `<button type="button" class="chip${on.has(c.id) ? ' on' : ''}" data-chart="${c.id}" aria-pressed="${on.has(c.id)}">${esc(c.title)}</button>`).join('')
      + `<button type="button" class="selall" data-all="1">${on.size === list.length ? '하나만 남기기' : '전체 보기'}</button>`;
  };
  renderChips();

  const render = () => {
    state.charts.forEach(ch => ch.destroy());
    state.charts = [];
    if (!state.data) return;
    const opts = { region: state.region, since: sinceFor(state.data, state.range) };
    const shown = listFor().filter(c => setFor().has(c.id));
    if (!shown.length) { grid.innerHTML = '<div class="flow-empty">위에서 보고 싶은 그래프를 골라 주세요.</div>'; return; }
    grid.innerHTML = shown.map(c => `
      <article class="card flow-card" data-chart="${c.id}">
        <div class="panel-head">
          <div><div class="sec-title">${esc(c.title)}</div><div class="sec-note">${esc(c.source)}</div></div>
          <div class="flow-latest"><b>—</b><small></small></div>
        </div>
        <div class="flow-box"><canvas aria-label="${esc(c.title)} 그래프" role="img"></canvas></div>
        <p class="flow-read">${esc(c.read)}</p>
      </article>`).join('');
    for (const c of shown) {
      const card = grid.querySelector(`[data-chart="${c.id}"]`);
      const spec = buildSpec(c.id, state.data, opts);
      const box = card.querySelector('.flow-box');
      if (!spec) { box.innerHTML = '<div class="flow-empty">원천에서 이 지표를 받지 못했습니다. 잠시 후 자동으로 다시 시도합니다.</div>'; continue; }
      if (spec.latest) {
        card.querySelector('.flow-latest b').textContent = spec.latest.value;
        const sub = card.querySelector('.flow-latest small');
        sub.textContent = spec.latest.sub;
        sub.className = spec.latest.dir || '';
      }
      if (typeof Chart !== 'function') { box.innerHTML = '<div class="flow-empty">그래프 라이브러리(Chart.js)를 불러오지 못했습니다.</div>'; continue; }
      try { state.charts.push(drawChart(Chart, box.querySelector('canvas'), spec)); }
      catch (e) { console.warn('시장 흐름 그래프 실패:', c.id, e); box.innerHTML = '<div class="flow-empty">그래프를 그리지 못했습니다.</div>'; }
    }
  };

  chips.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    const list = listFor(), on = setFor();
    if (b.dataset.all) {
      const next = on.size === list.length ? new Set([list[0].id]) : new Set(list.map(c => c.id));
      if (isAnnual()) state.onAnnual = next; else state.on = next;
    } else {
      const id = b.dataset.chart;
      on.has(id) ? on.delete(id) : on.add(id);
    }
    save(); renderChips(); render();
  });
  regionSel.addEventListener('change', () => { state.region = regionSel.value; save(); render(); });
  rangeSeg.addEventListener('click', e => {
    const b = e.target.closest('button[data-range]');
    if (!b) return;
    state.range = b.dataset.range;
    rangeSeg.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    save(); renderChips(); render();
  });

  const setFlag = (text, live) => { if (flag) { flag.textContent = text; flag.className = live ? 'live-flag' : 'demo-flag'; } };
  async function load() {
    try {
      const res = await fetch(url, { cache: 'no-cache' });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || 'HTTP ' + res.status);
      state.data = json;
      setFlag(json.stale ? '최근 조회값' : '● LIVE', !json.stale);
      const parts = [];
      if (json.weekly) parts.push(`KB 주간 ${json.weekly.updated || json.weekly.dates[json.weekly.dates.length - 1]}`);
      if (json.monthly && json.monthly.ratio) parts.push(`월간 ${ym(json.monthly.ratio.dates[json.monthly.ratio.dates.length - 1])}`);
      const rate = json.rates && json.rates.KR3YT;
      if (rate) parts.push(`금리 ${rate.points[rate.points.length - 1][0]}`);
      if (json.annual && json.annual.years.length) parts.push(`연도별 ${json.annual.years[0]}~${json.annual.ytdYear}년`);
      if (note) note.textContent = `KB부동산 주간·월간 주택가격동향 · 네이버 금융 시장금리 — ${parts.join(' · ')} 기준. 보고 싶은 그래프를 골라 여러 개를 함께 볼 수 있습니다.`;
      fillPulse(json);
      render();
      return true;
    } catch (e) {
      console.warn('시장 흐름 지표 불러오기 실패:', e);
      if (!state.data) {
        setFlag('연결 실패', false);
        grid.innerHTML = '<div class="flow-empty">시장 지표를 불러오지 못했습니다. 잠시 후 자동으로 다시 시도합니다.</div>';
      }
      return false;
    }
  }
  return { load, render, state };
}
