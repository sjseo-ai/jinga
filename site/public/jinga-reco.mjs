// jinga-reco.mjs — 진가 매물 추천: 「사고 싶은 집(단지·평형)」과 비슷한 가격대에서 비슷하거나 더 나은 아파트 TOP 5
// 순수 계산만 담당(네트워크 없음). 페이지(index.html)가 KB시세(jinga-kb.mjs 클라이언트)·입지 파일(kb-seoul-infra.json)을 넘기고, scripts/smoke-reco.mjs 가 검사.
//   1) findComplexes·parseQuery·pickType — 단지명 검색(「상도삼호 31평형」처럼 동 이름·평형을 섞어 써도 찾음)
//   2) candidateScope — 서울 KB시세 구·동 집계(kb-seoul-gu.json)에서 평당가가 기준 집과 가까운 동부터 비교 단지를 고름
//   3) recommend — 가격 범위(±%)·면적 범위에 드는 주택형을 같은 산식으로 점수화, 기준 집 점수 −3점 이상을 추천
//      2026-09-15 역세권(가까운 역·환승)·학군(배정 초등·중학교·학원가) 반영 — scripts/build-kb-infra.mjs 가 만든 단지별 지표 사용

const PY = 3.3058;
const clamp01 = v => Math.max(0, Math.min(1, v));
const round1 = v => Math.round(v * 10) / 10;
// 임대세대 비율은 단지 검색과 **같은 산식**을 써야 합니다 — 같은 단지가 한쪽에서는 빠지고
// 한쪽에서는 남으면 그게 더 헷갈립니다. 그래서 복사하지 않고 공용 모듈에서 가져옵니다.
// (jinga-kb.mjs 를 가져오면 화면이 ?v= 를 붙여 부르는 것과 주소가 달라 38KB 를 두 번 내려받습니다.)
import { rentPct, rentOk, rentText } from './jinga-rent.mjs';
export { rentPct, rentOk, rentText };

export const SIMILAR_MARGIN = 3;      // 기준 집보다 이만큼 낮아도 「비슷함」으로 추천
export const SCOPE_MAX = 500;         // 브라우저가 KB시세를 조회할 비교 단지 수 상한
export const MAX_RECO_GUS = 5;        // 「고른 자치구에서만」으로 한 번에 고를 수 있는 구 수
export const WALK_M_PER_MIN = 70;     // 직선거리 → 도보 분 환산(실제 길은 더 김)

/** 만원 → '1억 2,000만' */
export function fmtEok(man) {
  const n = Math.round(Math.abs(Number(man) || 0)), eok = Math.floor(n / 10000), rest = n % 10000;
  if (!eok) return rest.toLocaleString('ko-KR') + '만';
  return eok + '억' + (rest ? ' ' + rest.toLocaleString('ko-KR') + '만' : '');
}

// ── 1) 단지 검색 ─────────────────────────────────────────────
export const normName = s => String(s || '').replace(/아파트|APT|\s|[()（）\-·.,_]/gi, '').toLowerCase();

/** '상도삼호 31평형' → { text:'상도삼호', size:31, unit:'평' } · '헬리오시티 84㎡' → unit '㎡' · 단위 없는 끝 숫자(20 이상)도 크기로 */
export function parseQuery(q) {
  const s = String(q || '').trim();
  const m = s.match(/^(.*?)[\s]*(\d{2,3}(?:\.\d+)?)\s*(평형|평|㎡|m2|㎥|제곱미터|타입|형)?\s*$/i);
  if (m && m[1].trim() && (m[3] || Number(m[2]) >= 20)) {
    const unit = !m[3] ? '' : /평/.test(m[3]) ? '평' : /㎡|m2|㎥|제곱/.test(m[3]) ? '㎡' : '';
    return { text: m[1].trim(), size: Number(m[2]), unit };
  }
  return { text: s, size: 0, unit: '' };
}

/** q 글자가 s 안에 순서대로 다 있으면 떨어진 글자 수(작을수록 가까움), 없으면 -1 */
function subseqGap(q, s) {
  let pos = -1, first = -1;
  for (const ch of q) {
    pos = s.indexOf(ch, pos + 1);
    if (pos < 0) return -1;
    if (first < 0) first = pos;
  }
  return pos - first + 1 - q.length;
}

/** 디렉터리 행 [id, 단지명, 자치구, 법정동, 50세대미만, 용적률, 건폐율, 위도, 경도, 최고층수, 현관구조] 중 검색어와 가까운 순 */
export function findComplexes(rows, text, limit = 8) {
  const q = normName(text);
  if (q.length < 2) return [];
  const scored = [];
  for (const c of rows) {
    const n = normName(c[1]), d = normName(c[3]), dn = d + n, dbase = d.replace(/동$/, '') + n;
    let s = -1;
    if (n === q) s = 100;
    else if (n.includes(q)) s = 90 - (n.length - q.length) * 0.5;
    else if (dn.includes(q) || dbase.includes(q)) s = 80 - (dn.length - q.length) * 0.3;
    else {
      const g1 = subseqGap(q, n), g2 = g1 < 0 ? Math.min(...[subseqGap(q, dn), subseqGap(q, dbase)].filter(v => v >= 0), Infinity) : -1;
      if (g1 >= 0 && g1 <= 4) s = 60 - g1 * 3;
      else if (Number.isFinite(g2) && g2 >= 0 && g2 <= 4) s = 50 - g2 * 3;
    }
    if (s < 0) continue;
    if (c[4]) s -= 5;                        // 50세대 미만은 뒤로
    scored.push([s, c]);
  }
  scored.sort((a, b) => b[0] - a[0] || a[1][1].length - b[1][1].length);
  return scored.slice(0, limit).map(x => x[1]);
}

/** 입력한 크기(평형·㎡)에 맞는 주택형 index — 공급평형·전용㎡ 어느 쪽이든 3 이내로 가까운 것, 없으면 -1 */
export function pickType(types, hint) {
  const size = hint && hint.size;
  if (!size) return -1;
  let best = -1, bestGap = Infinity;
  (types || []).forEach((t, i) => {
    const gaps = [];
    if (hint.unit !== '㎡' && Number(t.supPy)) gaps.push(Math.abs(Number(t.supPy) - size));
    if (hint.unit !== '평') gaps.push(Math.abs(t.excl - size));
    const g = Math.min(...gaps, Infinity);
    if (g < bestGap) { bestGap = g; best = i; }
  });
  return bestGap <= 3 ? best : -1;
}

// ── 2) 비교할 단지 고르기 ────────────────────────────────────
/** 법정동 KB 평균 평당가(전용, 만원) — 동 값이 없으면 구 평균 */
export function locPP(guData, gu, dong) {
  const g = guData && guData.gu && guData.gu[gu];
  if (!g) return null;
  const d = (g.dongs || []).find(x => x.name === dong);
  return (d && d.avgPerPyeong) || g.avgPerPyeong || null;
}

/**
 * target: { id, gu, dong, t(주택형) } · rows: 디렉터리 · guData: kb-seoul-gu.json
 * scope 'similar'(서울 전체): 기준 집 동을 먼저, 이어서 동 평균 평당가가 기준 집 평당가와 가까운 동부터 max곳까지
 * scope 'gu': 기준 단지와 같은 자치구
 * → { rows, dongs:[{gu, dong, avg, ratio, count}], pp0, capped }
 */
export function candidateScope(target, rows, guData, { scope = 'similar', gus = [], max = SCOPE_MAX, skipSmall = true } = {}) {
  const pp0 = target.t.price / (target.t.excl / PY);
  const pool = rows.filter(c => c[0] !== target.id && !(skipSmall && c[4]));

  // 고른 자치구에서만 — 기준 집이 어디에 있든 **내가 고른 구 안에서만** 견줍니다.
  // 상한(500곳)을 넘으면 아무 데나 자르지 않고, 기준 집과 평당가가 가까운 동부터 채웁니다.
  const picked = [...new Set((gus || []).filter(Boolean))].slice(0, MAX_RECO_GUS);
  if (scope === 'gus' && picked.length) {
    const set = new Set(picked);
    const r = pool.filter(c => set.has(c[2]));
    if (r.length <= max || !guData || !guData.gu) {
      return { rows: r.slice(0, max), dongs: [], pp0: Math.round(pp0), capped: r.length > max, gus: picked };
    }
    const order = dongOrder(guData, target, pp0, g => set.has(g));
    const { rows: out, dongs, capped } = fillByDong(pool, order, max);
    return { rows: out, dongs, pp0: Math.round(pp0), capped, gus: picked };
  }

  if (scope === 'gu' || !guData || !guData.gu) {
    const r = pool.filter(c => c[2] === target.gu);
    return { rows: r.slice(0, max), dongs: [], pp0, capped: r.length > max };
  }
  const order = dongOrder(guData, target, pp0);
  const { rows: out, dongs, capped } = fillByDong(pool, order, max);
  return { rows: out, dongs, pp0: Math.round(pp0), capped };
}

/**
 * 기준 집과 평당가가 가까운 동부터 줄 세우기.
 * keepGu 를 주면 그 구만 봅니다(고른 자치구에서만 쓸 때). 비율이 너무 벌어진 동은 뺍니다.
 */
function dongOrder(guData, target, pp0, keepGu = null) {
  const own = locPP(guData, target.gu, target.dong);
  // 오래된 단지는 동 평균보다 싸므로, 기준 집이 속한 동의 위치만큼 중심을 옮김(0.85~1.2배)
  const center = own ? Math.max(0.85, Math.min(1.2, Math.sqrt(own / pp0))) : 1;
  const dongs = [];
  for (const [gu, g] of Object.entries(guData.gu)) {
    if (keepGu && !keepGu(gu)) continue;
    for (const d of g.dongs || []) {
      if (!(d.avgPerPyeong > 0)) continue;
      const isOwn = gu === target.gu && d.name === target.dong;
      const ratio = d.avgPerPyeong / pp0;
      // 고른 구 안에서는 비율이 벌어져도 남깁니다 — 「그 구를 보겠다」는 뜻이므로
      if (!isOwn && !keepGu && (ratio < 0.55 || ratio > 1.7)) continue;
      dongs.push({ gu, dong: d.name, avg: d.avgPerPyeong, ratio: Math.round(ratio * 100) / 100, own: isOwn, dist: Math.abs(Math.log(ratio / center)) });
    }
  }
  dongs.sort((a, b) => (b.own - a.own) || a.dist - b.dist);
  return dongs;
}

/** 줄 세운 동 순서대로 상한까지 채우기 — 큰 동이 상한을 넘기면 건너뛰고 더 작은 가까운 동으로 */
function fillByDong(pool, order, max) {
  const byKey = new Map();
  for (const c of pool) { const k = c[2] + '|' + c[3]; if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(c); }
  const out = [], used = [];
  let capped = false;
  for (const d of order) {
    const list = byKey.get(d.gu + '|' + d.dong) || [];
    if (!list.length) continue;
    if (out.length && out.length + list.length > max) { capped = true; continue; }
    out.push(...list.slice(0, max));
    used.push({ gu: d.gu, dong: d.dong, avg: d.avg, ratio: d.ratio, count: Math.min(list.length, max) });
    if (out.length >= max) { capped = true; break; }
  }
  return { rows: out, dongs: used, capped };
}

// ── 입지(역세권·학군) ────────────────────────────────────────
/**
 * kb-seoul-infra.json 에서 단지 하나의 지표 → { station:{name, lines:[], m}, elem:{name, m, zone, classSize}, mid:{name, m}, academies } | null
 */
/**
 * 경사 자료(slope-<지역>.json)를 입지 자료에 붙임 — byId[단지] = [rise, grade, up, maxGrade]
 * 붙여 두면 infraOf 가 slope 를 함께 돌려주고, 역세권 점수·카드 문구가 이를 씁니다.
 */
export function attachSangga(infra, ...files) {
  if (!infra) return infra;
  const sangga = { ...(infra.sangga || {}) };
  for (const f of files) {
    if (!f || !f.byId) continue;
    for (const [id, v] of Object.entries(f.byId)) sangga[id] = v;
  }
  return { ...infra, sangga };
}

export function attachSlope(infra, ...files) {
  if (!infra) return infra;
  const slope = { ...(infra.slope || {}) };
  for (const f of files) {
    if (!f || !f.byId) continue;
    for (const [id, v] of Object.entries(f.byId)) slope[id] = v;
  }
  return { ...infra, slope };
}

export function infraOf(infra, id) {
  const v = infra && infra.byId && infra.byId[id];
  if (!v) return null;
  const [st, stM, el, elM, zone, mid, midM, academies] = v;
  const s = infra.stations[st], e = infra.elems[el], m = infra.mids[mid];
  const sl = infra.slope && infra.slope[id];
  const sg = infra.sangga && infra.sangga[id];
  return {
    slope: sl ? { rise: sl[0], grade: sl[1], up: sl[2], maxGrade: sl[3] } : null,
    sangga: sg ? { n: sg[0], dens: sg[1], mix: sg[2] || {}, top: sg[3] || [] } : null,
    station: s && stM != null ? { name: s[0], lines: s[1] ? String(s[1]).split('|') : [], m: stM } : null,
    elem: e && elM != null ? { name: e[0], m: elM, zone: !!zone, classSize: e[3] ?? null } : null,
    mid: m && midM != null ? { name: m[0], m: midM } : null,
    academies: Number(academies) || 0,
  };
}
const shortSchool = n => String(n || '').replace(/^서울/, '').replace(/초등학교$/, '초').replace(/여자중학교$/, '여중').replace(/중학교$/, '중');
export const walkMin = m => Math.max(1, Math.round(m / WALK_M_PER_MIN));

/** 두 위경도 사이 직선거리(m) — 서울 정도 범위에서는 이 근사로 충분합니다 */
export function distM(lat1, lng1, lat2, lng2) {
  if (![lat1, lng1, lat2, lng2].every(v => Number.isFinite(Number(v)))) return null;
  const k = Math.PI / 180, x = (lng2 - lng1) * k * Math.cos(((lat1 + lat2) / 2) * k), y = (lat2 - lat1) * k;
  return Math.round(Math.sqrt(x * x + y * y) * 6371e3);
}

/**
 * 어떤 좌표에서 도보 N분 안에 있는 지하철역·초등학교 — 지도에 함께 찍으려고 씁니다.
 * 거리는 직선거리(실제 길은 더 김)이고, 도보 분은 분당 70m 기준입니다.
 * assignedElem: 배정 초등학교 이름(통학구역) — 10분 밖이어도 하나는 남겨 「배정」으로 보여 줍니다.
 */
export function nearbyInfra(infra, lat, lng, { minutes = 10, limit = 4, assignedElem = null } = {}) {
  const radiusM = minutes * WALK_M_PER_MIN;
  const empty = { radiusM, minutes, stations: [], elems: [] };
  if (!infra || !Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) return empty;

  // 서울·경기 입지 파일의 조회 사각이 겹쳐 같은 역·학교가 두 번 들어올 수 있어 이름으로 한 번만 남깁니다(노선은 합침)
  const near = (rows, pick) => {
    const by = new Map();
    (rows || []).forEach(r => {
      const m = distM(lat, lng, pick.lat(r), pick.lng(r));
      if (m == null || m > radiusM) return;
      const item = { ...pick.row(r), m, min: walkMin(m) };
      const cur = by.get(item.name);
      if (!cur) { by.set(item.name, item); return; }
      if (item.lines && cur.lines) cur.lines = [...new Set([...cur.lines, ...item.lines])];
      if (item.m < cur.m) { cur.m = item.m; cur.min = item.min; cur.lat = item.lat; cur.lng = item.lng; }
    });
    return [...by.values()].sort((a, b) => a.m - b.m).slice(0, limit);
  };

  const stations = near(infra.stations, {
    lat: r => r[2], lng: r => r[3],
    row: r => ({ name: r[0], lines: r[1] ? String(r[1]).split('|') : [], lat: r[2], lng: r[3], kind: 'station' }),
  });
  const elems = near(infra.elems, {
    lat: r => r[1], lng: r => r[2],
    row: r => ({ name: r[0], lat: r[1], lng: r[2], classSize: r[3] ?? null, kind: 'elem' }),
  });
  // 배정 초등학교가 10분 밖이면 그것도 한 곳 붙여 줌(학군은 거리보다 통학구역이 먼저)
  if (assignedElem && !elems.some(e => e.name === assignedElem)) {
    const r = (infra.elems || []).find(x => x[0] === assignedElem);
    if (r) {
      const m = distM(lat, lng, r[1], r[2]);
      if (m != null) elems.push({ name: r[0], lat: r[1], lng: r[2], classSize: r[3] ?? null, kind: 'elem', m, min: walkMin(m), far: true });
    }
  }
  elems.forEach(e => { e.zone = !!assignedElem && e.name === assignedElem; });
  return { radiusM, minutes, stations, elems };
}

/**
 * 입지 파일 여러 개(서울·경기)를 하나로 — 역·학교 목록을 이어 붙이고 단지별 지표의 번호를 그만큼 밀어 줍니다.
 * 파일마다 stations·elems·mids 가 따로 번호 매겨져 있어, 그냥 합치면 엉뚱한 역·학교를 가리키게 됩니다.
 */
export function mergeInfra(...files) {
  const list = files.filter(f => f && f.byId);
  if (list.length <= 1) return list[0] || null;
  const out = { ...list[0], stations: [], elems: [], mids: [], byId: {}, regions: [] };
  const off = { stations: 0, elems: 0, mids: 0 };
  for (const f of list) {
    out.regions.push(f.regionLabel || f.region || '');
    for (const [id, v] of Object.entries(f.byId)) {
      const shift = (idx, key) => (idx == null || idx < 0 ? idx : idx + off[key]);
      out.byId[id] = [shift(v[0], 'stations'), v[1], shift(v[2], 'elems'), v[3], v[4], shift(v[5], 'mids'), v[6], v[7]];
    }
    out.stations.push(...(f.stations || []));
    out.elems.push(...(f.elems || []));
    out.mids.push(...(f.mids || []));
    off.stations = out.stations.length;
    off.elems = out.elems.length;
    off.mids = out.mids.length;
  }
  return out;
}

/** 지도·카드에 쓰는 짧은 이름 — '서울대치초등학교' → '대치초' */
export const shortName = n => shortSchool(n);
/** 카드 한 줄: '숭실대입구(7호선) 도보 7분 · 배정 신남성초 12분 · 학원 139곳' */
export function infraText(inf, { maxFloor = null, hall = null } = {}) {
  const parts = [];
  if (inf && inf.station) parts.push(`${inf.station.name}역(${inf.station.lines.join('·') || '노선 미상'}) ${inf.station.m.toLocaleString('ko-KR')}m·도보 ${walkMin(inf.station.m)}분`);
  if (inf && inf.slope && slopeText(inf.slope)) parts.push(slopeText(inf.slope));
  if (inf && inf.sangga && sanggaText(inf.sangga)) parts.push(sanggaText(inf.sangga));
  if (inf && inf.elem) parts.push(`${inf.elem.zone ? '배정' : '가까운'} ${shortSchool(inf.elem.name)} ${walkMin(inf.elem.m)}분`);
  if (inf && inf.mid) parts.push(`${shortSchool(inf.mid.name)} ${walkMin(inf.mid.m)}분`);
  if (inf) parts.push(`학원 ${inf.academies.toLocaleString('ko-KR')}곳(1km)`);
  if (maxFloor) parts.push(`최고 ${maxFloor}층`);
  if (hall) parts.push(hall);
  return parts.join(' · ');
}

// ── 연간 비교(쌓인 기록) ─────────────────────────────────────
const signedPct = v => `${v > 0 ? '+' : ''}${v.toFixed(1)}%`;
const mmdd = asOf => String(asOf || '').slice(5).replace(/[.-]/, '.');
/**
 * 추천 카드의 연간 비교 문구 — 기록이 없으면 빈 배열(카드에서 줄을 숨김)
 * views: /api/annual?ids= 의 complexes[id] = { 연도: { first, last, types:[{excl, price, firstPrice, pct}] } }
 * prevInfra: 전년 annual/infra-<연도>.json 의 byId[id] = [역 m, 배정 초등 m, 구역 안, 중학교 m, 학원 수] · inf: 올해 infraOf()
 */
export function annualNotes({ views = null, excl, prevInfra = null, inf = null } = {}) {
  const out = [];
  const key = Math.round(excl);
  const years = views ? Object.keys(views).map(Number).sort((a, b) => a - b) : [];
  const cy = years[years.length - 1];
  const typeOf = y => (views && views[y] ? views[y].types.find(t => Math.round(t.excl) === key) : null);
  const cur = cy ? typeOf(cy) : null;
  if (cur && cur.pct != null && views[cy].first !== views[cy].last) {
    out.push({ key: 'ytd', text: `${cy}년 KB ${signedPct(cur.pct)}(${mmdd(views[cy].first)}~${mmdd(views[cy].last)})`, dir: cur.pct > 0 ? 'up' : cur.pct < 0 ? 'down' : '' });
  }
  const prev = cy ? typeOf(cy - 1) : null;
  if (cur && prev && prev.price > 0) {
    const p = Math.round((cur.price / prev.price - 1) * 1000) / 10;
    out.push({ key: 'yoy', text: `작년 말 대비 ${signedPct(p)}`, dir: p > 0 ? 'up' : p < 0 ? 'down' : '' });
  }
  if (prevInfra && inf) {
    const [prevStation, , , , prevAcad] = prevInfra;
    const dA = inf.academies - (Number(prevAcad) || 0);
    if (Math.abs(dA) >= 5) out.push({ key: 'academy', text: `학원 전년 대비 ${dA > 0 ? '+' : ''}${dA}곳`, dir: dA > 0 ? 'up' : 'down' });
    if (inf.station && prevStation != null && prevStation - inf.station.m >= 150) out.push({ key: 'station', text: `가까운 역 ${(prevStation - inf.station.m).toLocaleString('ko-KR')}m 가까워짐(새 역)`, dir: 'up' });
  }
  return out;
}

// ── 3) 점수·추천 ─────────────────────────────────────────────
export const AREA_RANGES = {
  similar: { label: '비슷하게 (−10% ~ +15%)', min: 0.90, max: 1.15 },
  wider: { label: '비슷하거나 넓게 (−15% ~ +35%)', min: 0.85, max: 1.35 },
  any: { label: '면적 무관', min: 0, max: Infinity },
};

export const RECO_RULES = [
  { key: 'station', label: '역세권', max: 15, desc: '가장 가까운 지하철역까지 직선거리 300m 이내 만점 → 1km 이상 0점, 환승역(2개 노선 이상)이면 +2점(최대 15). 역까지 오르막이면 최대 3점 감점(평균 경사 2% 이하 0점 → 10% 이상 3점, 내리막은 감점 없음), 길에 상가가 이어지면 최대 2점 가산(역까지 가는 길 둘레의 ㎢당 점포 500곳 이하 0점 → 3,500곳 이상 만점, 로그 척도). 합계는 15점을 넘지 않습니다. 역 정보가 없으면 6점' },
  { key: 'school', label: '학군', max: 15, desc: '배정 초등학교(단지가 통학구역 안에 드는 학교) 300m 이내 7점 → 900m 0점(통학구역 밖이면 70%) + 가까운 중학교 400m 이내 3점 → 1.2km 0점 + 반경 1km 일반교과 학원 수 20곳 이하 0점 → 300곳 이상 5점(로그 척도, 서울 단지 중앙값 86곳). 정보가 없으면 6점' },
  { key: 'loc', label: '입지 시세', max: 15, desc: '단지가 속한 법정동의 KB 평균 평당가(서울 KB시세 집계)를 기준 집의 동과 비교. 같으면 7.5점, 30% 높으면 만점, 30% 낮으면 0점' },
  { key: 'value', label: '가성비', max: 15, desc: '이 주택형의 전용 평당가 ÷ 소속 동 평균 평당가. 동 평균과 같으면 7.5점, 25% 싸면 만점, 25% 비싸면 0점' },
  { key: 'newness', label: '신축도', max: 15, desc: '준공 5년 이내 만점 → 30년 이상 0점. 재건축 단지는 최소 7.5점, 준공연도를 모르면 6점' },
  { key: 'scale', label: '단지 규모', max: 10, desc: '총세대수 100세대 0점 → 3,000세대 이상 만점(로그 척도)' },
  { key: 'space', label: '공간', max: 5, desc: '전용면적이 기준 평형과 같으면 2.5점, 15% 넓으면 만점, 15% 좁으면 0점' },
  { key: 'jeonse', label: '전세가율', max: 5, desc: 'KB 전세가 ÷ 매매가 35% 0점 → 65% 이상 만점' },
  { key: 'pref', label: '관심도', max: 5, desc: 'KB부동산 관심단지 등록 수 0명 0점 → 500명 이상 만점(로그 척도)' },
];

const hhOf = c => (c.brief && c.brief.households) || (c.types || []).reduce((s, t) => s + (t.hh || 0), 0);

/** 가격(KB 일반가)·면적 범위에 드는 주택형 */
export function eligibleTypes(ref, types, { band = 0.1, areaMin = 0.85, areaMax = 1.35 } = {}) {
  return (types || []).filter(t => t.provided && t.price > 0
    && t.price >= ref.price * (1 - band) && t.price <= ref.price * (1 + band)
    && t.excl >= ref.excl * areaMin && t.excl <= ref.excl * areaMax);
}
/** 비교 대상 중 조건에 드는 주택형이 하나라도 있는 단지 */
export const eligibleComplexes = (refType, complexes, opts) => complexes.filter(c => eligibleTypes(refType, c.types, opts).length);

/** 역세권 점수(15) */
export const SLOPE_FLAT = 2, SLOPE_STEEP = 10, SLOPE_PENALTY_MAX = 3;
/**
 * 역까지 오르막 감점(최대 3점) — 평균 경사 2% 이하면 0, 10% 이상이면 최대.
 * 같은 400m라도 평지와 비탈은 체감이 달라 역세권 점수에서 덜어 냅니다. 내리막(음수)은 감점하지 않습니다.
 */
export function slopePenalty(slope) {
  const g = slope && Number(slope.grade);
  if (!Number.isFinite(g) || g <= SLOPE_FLAT) return 0;
  return round1(SLOPE_PENALTY_MAX * clamp01((g - SLOPE_FLAT) / (SLOPE_STEEP - SLOPE_FLAT)));
}
/** 역까지 경사 한 줄 — '역에서 집까지 오르막 27m·다소 가파름(6.6%)' */
export function slopeText(slope) {
  if (!slope || !Number.isFinite(Number(slope.grade))) return '';
  const g = Math.abs(Number(slope.grade)), rise = Number(slope.rise) || 0;
  const level = g < 2 ? '거의 평지' : g < 5 ? '완만' : g < 8 ? '다소 가파름' : '가파름';
  if (Math.abs(rise) < 2) return `역까지 ${level}(${g.toFixed(1)}%)`;
  return `역에서 집까지 ${rise > 0 ? '오르막' : '내리막'} ${Math.abs(rise).toFixed(0)}m·${level}(${g.toFixed(1)}%)`;
}

export const STREET_MIN = 500, STREET_FULL = 3500, STREET_BONUS_MAX = 2;
/**
 * 길 상권 가산(최대 2점) — 역까지 가는 길 둘레의 ㎢당 점포 수가 500곳 이하면 0, 3,500곳 이상이면 최대(로그 척도).
 * 상가가 이어진 길은 야간 보행·생활 편의가 낫다고 보고 역세권 점수에 얹습니다(정비 상태를 재는 값은 아닙니다).
 * 서울 실측 분포에 맞춘 값입니다 — 하위 10% 580곳 · 중앙값 1,620곳 · 상위 10% 3,501곳.
 */
export function streetBonus(sangga) {
  const v = sangga && Number(sangga.dens);
  if (!Number.isFinite(v) || v <= STREET_MIN) return 0;
  const t = Math.log(v / STREET_MIN) / Math.log(STREET_FULL / STREET_MIN);
  return round1(STREET_BONUS_MAX * clamp01(t));
}
/** 길 상권 한 줄 — '길 상권 238곳(㎢당 679곳) · 소매 29%·음식 23%' */
export function sanggaText(sangga) {
  if (!sangga || !sangga.n) return '';
  const mix = Object.entries(sangga.mix || {}).slice(0, 2).map(([k, v]) => `${k} ${v}%`).join('·');
  return `길 상권 ${sangga.n.toLocaleString('ko-KR')}곳(㎢당 ${(sangga.dens || 0).toLocaleString('ko-KR')}곳)${mix ? ' · ' + mix : ''}`;
}

export function stationScore(inf) {
  const s = inf && inf.station;
  if (!s) return 6;
  const base = 15 * clamp01((1000 - s.m) / 700);
  const withTransfer = Math.min(15, base + (s.lines.length >= 2 && s.m <= 1000 ? 2 : 0));
  const adjusted = withTransfer - slopePenalty(inf && inf.slope) + streetBonus(inf && inf.sangga);
  return Math.max(0, Math.min(15, round1(adjusted)));
}
/** 학군 점수(15) = 배정 초등 7 + 중학교 3 + 학원가 5 */
export function schoolScore(inf) {
  if (!inf || (!inf.elem && !inf.mid)) return 6;
  const elem = inf.elem ? 7 * clamp01((900 - inf.elem.m) / 600) * (inf.elem.zone ? 1 : 0.7) : 3;
  const mid = inf.mid ? 3 * clamp01((1200 - inf.mid.m) / 800) : 1.5;
  // 서울 단지 반경 1km 학원 수 중앙값 86 · 상위 10% 185 · 대치 은마 972(2026-09-15) — 20곳 이하 0점 → 300곳 이상 만점
  const acad = 5 * clamp01(Math.log(Math.max(inf.academies, 1) / 20) / Math.log(15));
  return elem + mid + acad;
}

/** e: { c, t, hh, locPP, inf } · ref: { excl, locPP } */
export function scoreHome(e, ref, thisYear = new Date().getFullYear()) {
  const { c, t, hh } = e;
  const b = c.brief || null;
  const p = {};
  const pp = t.price / (t.excl / PY);
  p.station = stationScore(e.inf);
  p.school = schoolScore(e.inf);
  p.loc = e.locPP && ref.locPP ? 15 * clamp01((e.locPP / ref.locPP - 0.7) / 0.6) : 7.5;
  p.value = e.locPP ? 15 * clamp01((1.25 - pp / e.locPP) / 0.5) : 7.5;
  const age = b && b.built ? thisYear - b.built : null;
  let newness = age == null ? 6 : 15 * clamp01((30 - age) / 25);
  if (b && b.rebuild) newness = Math.max(newness, 7.5);
  p.newness = newness;
  p.scale = 10 * clamp01(Math.log(Math.max(hh, 1) / 100) / Math.log(30));
  p.space = 5 * clamp01((t.excl / ref.excl - 0.85) / 0.30);
  const jr = t.jeonse > 0 ? t.jeonse / t.price : 0;
  p.jeonse = 5 * clamp01((jr - 0.35) / 0.30);
  p.pref = 5 * clamp01(Math.log10(1 + ((b && b.interest) || 0)) / Math.log10(501));
  Object.keys(p).forEach(k => { p[k] = round1(p[k]); });
  return { total: round1(Object.values(p).reduce((a, v) => a + v, 0)), parts: p, pp: Math.round(pp), jr, age };
}

/** 기준 집 대비 좋아진 점·아쉬운 점 — [{ key, text, dir:'better'|'worse'|'same' }] */
export function compareHomes(e, base) {
  const out = [];
  const add = (key, dir, text) => out.push({ key, dir, text });
  const dp = e.t.price - base.t.price;
  if (Math.abs(dp) < base.t.price * 0.01) add('price', 'same', '가격 비슷');
  else add('price', dp < 0 ? 'better' : 'worse', `${fmtEok(dp)} ${dp < 0 ? '저렴' : '비쌈'}`);
  const da = e.t.excl - base.t.excl;
  if (Math.abs(da) < 2) add('space', 'same', '면적 비슷');
  else add('space', da > 0 ? 'better' : 'worse', `전용 ${da > 0 ? '+' : '−'}${Math.abs(da).toFixed(1)}㎡`);
  const es = e.inf && e.inf.station, bs = base.inf && base.inf.station;
  if (es && bs) {
    const d = es.m - bs.m;
    if (Math.abs(d) <= 150) add('station', 'same', '역 거리 비슷');
    else add('station', d < 0 ? 'better' : 'worse', `역 ${Math.abs(d).toLocaleString('ko-KR')}m 더 ${d < 0 ? '가까움' : '멂'}`);
    if (es.lines.length >= 2 && bs.lines.length < 2 && es.m <= 1000) add('transfer', 'better', `환승역(${es.lines.join('·')})`);
  }
  const ee = e.inf && e.inf.elem, be = base.inf && base.inf.elem;
  if (ee && be) {
    const near = x => x.zone && x.m <= 400;
    if (near(ee) && !near(be)) add('elem', 'better', '초품아(배정 초등 400m 이내)');
    else if (!near(ee) && near(be)) add('elem', 'worse', `배정 초등 ${walkMin(ee.m)}분`);
  }
  if (e.inf && base.inf) {
    const r = (e.inf.academies + 1) / (base.inf.academies + 1);
    if (r >= 1.5) add('academy', 'better', `학원 ${e.inf.academies.toLocaleString('ko-KR')}곳(${r.toFixed(1)}배)`);
    else if (r <= 0.67) add('academy', 'worse', `학원 ${e.inf.academies.toLocaleString('ko-KR')}곳(${Math.round(r * 100)}%)`);
  }
  if (e.score.age != null && base.score.age != null) {
    const dy = base.score.age - e.score.age;
    if (Math.abs(dy) <= 2) add('newness', 'same', '연식 비슷');
    else add('newness', dy > 0 ? 'better' : 'worse', dy > 0 ? `${dy}년 더 신축` : `${-dy}년 더 구축`);
  }
  if (e.hh && base.hh) {
    const r = e.hh / base.hh;
    if (r >= 1.3) add('scale', 'better', `세대수 ${r.toFixed(1)}배`);
    else if (r <= 0.7) add('scale', 'worse', `세대수 ${Math.round(r * 100)}% 규모`);
    else add('scale', 'same', '규모 비슷');
  }
  if (e.locPP && base.locPP) {
    const r = (e.locPP / base.locPP - 1) * 100;
    if (r >= 5) add('loc', 'better', `동 시세 +${Math.round(r)}%`);
    else if (r <= -5) add('loc', 'worse', `동 시세 ${Math.round(r)}%`);
    else add('loc', 'same', '입지 시세 비슷');
  }
  if (e.score.jr && base.score.jr) {
    const d = (e.score.jr - base.score.jr) * 100;
    if (d >= 3) add('jeonse', 'better', `전세가율 +${Math.round(d)}%p`);
    else if (d <= -3) add('jeonse', 'worse', `전세가율 ${Math.round(d)}%p`);
  }
  const old = age => age != null && age >= 25;   // 재건축을 말할 만한 연식(20년차는 이르다 — 2026-09-15 실데이터 점검)
  if (e.c.far && base.c.far && old(e.score.age) && old(base.score.age) && e.c.far <= base.c.far - 30) {
    add('far', 'better', `용적률 ${e.c.far}% (재건축 여력)`);
  }
  return out;
}

/**
 * target: { c(단지, brief 포함), t(주택형) } · candidates: [{ id, name, gu, dong, far, types, brief }]
 * opts: { band, areaMin, areaMax, minHh, maxRentPct, rentKnownOnly, guData, infra, thisYear }
 * → { target:{…, score}, top(비슷하거나 더 나은 곳 최대 5), alts(모자라면 참고 후보), pool(전체 점수순), eligibleCount }
 */
export function recommend(target, candidates, { band = 0.1, areaMin = 0.85, areaMax = 1.35, minHh = 0, maxRentPct = 0, rentKnownOnly = false, guData = null, infra = null, thisYear = new Date().getFullYear() } = {}) {
  const ref = { price: target.t.price, excl: target.t.excl, locPP: locPP(guData, target.c.gu, target.c.dong) };
  const base = { c: target.c, t: target.t, hh: hhOf(target.c), locPP: ref.locPP, inf: infraOf(infra, target.c.id) };
  base.score = scoreHome(base, ref, thisYear);
  const pool = [];
  const rentExcluded = [];          // 임대 비율로 뺀 단지 — 몇 곳을 왜 뺐는지 화면에 알려 주려고
  for (const c of candidates) {
    if (c.id === target.c.id) continue;
    const hh = hhOf(c);
    if (hh < minHh) continue;
    if (!rentOk(c, maxRentPct, rentKnownOnly)) { rentExcluded.push({ id: c.id, name: c.name, pct: rentPct(c) }); continue; }
    const lp = locPP(guData, c.gu, c.dong), inf = infraOf(infra, c.id);
    let best = null;
    for (const t of eligibleTypes(ref, c.types, { band, areaMin, areaMax })) {
      const score = scoreHome({ c, t, hh, locPP: lp, inf }, ref, thisYear);
      if (!best || score.total > best.score.total || (score.total === best.score.total && t.price < best.t.price)) best = { c, t, hh, locPP: lp, inf, score };
    }
    if (!best) continue;
    best.delta = round1(best.score.total - base.score.total);
    best.cmp = compareHomes(best, base);
    pool.push(best);
  }
  pool.sort((a, b) => b.score.total - a.score.total || a.t.price - b.t.price);
  const top = pool.filter(e => e.delta >= -SIMILAR_MARGIN).slice(0, 5);
  const alts = top.length < 5 ? pool.filter(e => e.delta < -SIMILAR_MARGIN).slice(0, 5 - top.length) : [];
  rentExcluded.sort((a, b) => (b.pct || 0) - (a.pct || 0));
  return { target: base, top, alts, pool, eligibleCount: pool.length, rentExcluded };
}
