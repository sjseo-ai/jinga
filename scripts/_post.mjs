// 자치구 연재 글감 뽑기 — 블로그에 주 2회 올릴 「오늘은 OO구」 초안의 **계산 부분**.
//
// 왜 — 25개 구를 맨손으로 쓰면 세 번째 글쯤에서 지칩니다. 사이트가 이미 들고 있는 자료로
// 구마다 **남들이 안 쓰는 숫자**를 뽑아 두면, 쓰는 사람은 거기에 생각만 얹으면 됩니다.
//
// 쓰는 자료 (전부 이미 저장소에 있는 정적 파일 — 새로 조회하지 않습니다)
//   kb-seoul-complexes.json  단지 목록(세대수·준공·용적률·임대세대·복도구조·좌표)
//   kb-seoul-gu.json         구·동별 평당가와 단지 수
//   kapt-seoul.json          국토부 공식(주차·승강기·지하철·면적대별 세대수)
//   seoul-union.json         정비사업 조합(재건축·리모델링)
//
// **없는 것은 쓰지 않습니다.** 자료가 비면 그 꼭지는 통째로 빠집니다 —
// 빈칸을 0 으로 적으면 「주차 0대」 같은 거짓말이 됩니다(이 프로젝트에서 네 번 겪었습니다).

export const MIN_DONG_COMPLEXES = 2;   // 이만큼은 있어야 「동네 평균」으로 씁니다
export const MIN_PARK_PER = 1;         // 세대당 이 아래라야 「빠듯한 곳」입니다

export const GU_ORDER = [
  '강남구', '강동구', '강북구', '강서구', '관악구', '광진구', '구로구', '금천구', '노원구',
  '도봉구', '동대문구', '동작구', '마포구', '서대문구', '서초구', '성동구', '성북구', '송파구',
  '양천구', '영등포구', '용산구', '은평구', '종로구', '중구', '중랑구',
];

/** 가나다순이 맞는지 스스로 확인 — 손으로 적은 목록이라 */
export const isSorted = (list = GU_ORDER) =>
  list.every((g, i) => i === 0 || list[i - 1].localeCompare(g, 'ko') <= 0);

const num = v => (v === null || v === undefined || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
export const man = n => (n == null ? null : Math.round(n).toLocaleString('ko-KR'));
export const pct = (a, b) => (!(b > 0) ? null : Math.round((a / b) * 1000) / 10);

/** 'YYYYMMDD' → 연도. 없거나 이상하면 null */
export function yearOf(approved) {
  const t = String(approved || '').trim();
  if (!/^\d{8}$/.test(t)) return null;
  const y = Number(t.slice(0, 4));
  return y >= 1960 && y <= 2100 ? y : null;
}

/** 단지 한 줄(배열)을 이름 있는 묶음으로 */
export const toComplex = c => ({
  id: c[0], name: c[1], gu: c[2], dong: c[3],
  far: num(c[5]), lat: num(c[7]), lng: num(c[8]), maxFloor: num(c[9]),
  hall: c[10] || '', approved: c[11], households: num(c[12]), rentUnits: num(c[13]),
  year: yearOf(c[11]),
});

/** 임대세대 비율(%) — 세대수를 모르면 null */
export const rentPct = c => (c.households > 0 && c.rentUnits != null
  ? Math.round((c.rentUnits / c.households) * 1000) / 10 : null);

const top = (rows, by, n, keep = () => true) => rows
  .filter(r => keep(r) && by(r) != null)
  .sort((a, b) => by(b) - by(a))
  .slice(0, n);

const bottom = (rows, by, n, keep = () => true) => rows
  .filter(r => keep(r) && by(r) != null)
  .sort((a, b) => by(a) - by(b))
  .slice(0, n);

/**
 * 한 자치구의 글감.
 * data = { complexes:[배열줄…], gu:{구별 집계}, seoul:{서울 집계}, kapt:{byComplex}, union:{sites,byComplex}, asOf }
 */
export function guFacts(guName, data, opts = {}) {
  const minHh = opts.minHouseholds ?? 300;
  const all = (data.complexes || []).map(toComplex).filter(c => c.gu === guName);
  if (!all.length) return null;

  const big = all.filter(c => (c.households || 0) >= minHh);
  const kapt = data.kapt || {};
  const withKapt = big.map(c => ({ ...c, k: kapt[String(c.id)] || null })).filter(c => c.k);

  // ── 시세 (구·동별 평당가)
  const guRow = (data.gu || {})[guName] || null;
  const seoulAvg = num(data.seoul && data.seoul.avgPerPyeong);
  // 단지 한 곳뿐인 동은 「동네 평균」이라 부를 수 없습니다 — 종로구 평동(1곳)이 구 전체를 8배 차이로 보이게 했습니다
  const dongs = ((guRow && guRow.dongs) || []).filter(d => num(d.avgPerPyeong) > 0 && num(d.count) >= MIN_DONG_COMPLEXES);
  const price = guRow && num(guRow.avgPerPyeong) ? {
    perPyeong: num(guRow.avgPerPyeong),
    count: num(guRow.count),
    households: num(guRow.households),
    vsSeoul: seoulAvg ? Math.round((guRow.avgPerPyeong / seoulAvg) * 1000) / 10 : null,
    seoulAvg,
    topDongs: [...dongs].sort((a, b) => b.avgPerPyeong - a.avgPerPyeong).slice(0, 5),
    lowDongs: [...dongs].sort((a, b) => a.avgPerPyeong - b.avgPerPyeong).slice(0, 3),
    spread: dongs.length >= 2
      ? Math.round((Math.max(...dongs.map(d => d.avgPerPyeong)) / Math.min(...dongs.map(d => d.avgPerPyeong))) * 10) / 10
      : null,
  } : null;

  // ── 나이
  const years = big.map(c => c.year).filter(Boolean);
  const age = years.length ? {
    median: years.slice().sort((a, b) => a - b)[Math.floor(years.length / 2)],
    old30: years.filter(y => new Date().getFullYear() - y >= 30).length,
    new10: years.filter(y => new Date().getFullYear() - y <= 10).length,
    oldest: bottom(big, c => c.year, 3),
    newest: top(big, c => c.year, 3),
  } : null;

  // ── 규모
  const scale = {
    total: all.length,
    big: big.length,
    households: all.reduce((n, c) => n + (c.households || 0), 0),
    biggest: top(all, c => c.households, 5),
  };

  // ── 재건축 여력(용적률이 낮고 오래된 곳)
  const far180 = big.filter(c => c.far != null && c.far <= 180 && c.year && new Date().getFullYear() - c.year >= 25);
  const rebuild = {
    lowFar: bottom(far180, c => c.far, 5),
    lowFarCount: far180.length,
    unions: ((data.union && data.union.sites) || []).filter(s => s.gu === guName && s.live),
  };

  // ── 임대세대 비율
  const rents = big.map(c => ({ ...c, pct: rentPct(c) })).filter(c => c.pct != null && c.pct > 0);
  const rent = rents.length ? {
    count: rents.length,
    over30: rents.filter(c => c.pct >= 30).length,
    highest: top(rents, c => c.pct, 5),
  } : null;

  // ── 주차 (국토부 공식) — 세대당 1대가 안 되면 저녁에 자리가 없다는 뜻
  const parks = withKapt
    .map(c => {
      const u = num(c.k.parkUnder), g = num(c.k.parkGround);
      if (u == null && g == null) return null;
      const total = (u || 0) + (g || 0);
      const hh = num(c.k.households) || c.households;
      return hh > 0 ? { ...c, per: Math.round((total / hh) * 100) / 100, under: u, ground: g } : null;
    })
    .filter(Boolean);
  // 「빠듯한 곳」은 **세대당 1대 미만만** 넣습니다. 1.2대를 빠듯하다고 적으면 거짓이고,
  // 자료가 적은 구에서는 넉넉한 곳과 같은 단지가 양쪽에 다 올라옵니다(종로구에서 실제로 그랬습니다).
  const tight = parks.filter(p => p.per < MIN_PARK_PER);
  const parking = parks.length ? {
    count: parks.length,
    under1: tight.length,
    best: top(parks, p => p.per, 5),
    worst: bottom(tight, p => p.per, 5),
    noUnder: parks.filter(p => p.under === 0).length,
  } : null;

  // ── 지하철 (국토부 공식 — 도보 시간 문자열 그대로)
  const subway = withKapt.filter(c => c.k.subwayStation);
  const lines = [...new Set(subway.flatMap(c => String(c.k.subwayLine || '').split(/[,·]/).map(s => s.trim()).filter(Boolean)))];

  // ── 복도 구조
  const halls = big.reduce((m, c) => { const h = c.hall || '모름'; m[h] = (m[h] | 0) + 1; return m; }, {});

  return {
    gu: guName,
    asOf: data.asOf || null,
    minHouseholds: minHh,
    scale, price, age, rebuild, rent, parking,
    subway: subway.length ? { count: subway.length, lines: lines.sort(), kaptTotal: withKapt.length } : null,
    halls,
    kaptCoverage: big.length ? { have: withKapt.length, of: big.length, pct: pct(withKapt.length, big.length) } : null,
  };
}

/**
 * 먼저 다룰 구를 앞으로 끌어올린 순서.
 * 「30대가 가장 많이 산 구부터」처럼 이유가 있을 때 씁니다 — 나머지는 가나다순 그대로입니다.
 */
export function orderWithFirst(first = [], list = GU_ORDER) {
  const head = first.filter(g => list.includes(g));
  const seen = new Set(head);
  return [...head, ...list.filter(g => !seen.has(g))];
}

/** 주 2회(화·금) 연재 일정 — 시작일부터 주어진 순서로 */
export function schedule(startISO, list = GU_ORDER, days = [2, 5]) {
  const out = [];
  const d = new Date(startISO + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) throw new Error(`날짜가 이상합니다: ${startISO}`);
  let i = 0;
  // 시작일 당일도 후보에 넣습니다
  for (let guard = 0; guard < 2000 && i < list.length; guard++) {
    if (days.includes(d.getUTCDay())) out.push({ date: d.toISOString().slice(0, 10), gu: list[i++] });
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}
