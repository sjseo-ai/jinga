// 입지 파일(site/public/kb-<지역>-infra.json) — 매물 추천의 역세권·학군 점수, 추천 지도의 「도보 10분 안 역·초등학교」용
//   npm run kb:infra              서울 → kb-seoul-infra.json   (약 1분)
//   npm run kb:infra:gyeonggi     경기 주요 8곳 → kb-gyeonggi-infra.json (약 1분)
//   (npm run kb:complexes / kb:complexes:gyeonggi 로 좌표가 들어간 단지 목록을 먼저 만든 뒤 실행)
// KB부동산 지도 「꿀세권」 레이어가 쓰는 비공식 엔드포인트(api.kbland.kr/land-complex/honeyLocation/*) — 형식이 예고 없이 바뀔 수 있음
//   · subwayMarkerList   지하철역(이름·호선·좌표). 한 번에 약 11km 사각까지만 받아 줘서 서울을 칸으로 나눠 조회(확대 수준 14)
//   · schoolMarkerList   schoolCode 03 초등학교(통학구역 경계 GeoJSON MultiPolygon, 좌표는 [위도, 경도]) · 04 중학교 — 서울 전역 한 번에
//   · academyMarkerList  academyCode 01 일반교과 학원 묶음(좌표·학원개수) — 서울 전역 한 번에
// 단지마다: 가장 가까운 역(직선거리·호선) · 배정 초등학교(단지가 통학구역 안에 드는 학교, 없으면 가장 가까운 초등학교)
//          · 가장 가까운 중학교 · 반경 1km 일반교과 학원 수
// 역·학교는 거의 바뀌지 않으므로 분기 1회 정도 다시 만들면 됩니다(단지 목록을 새로 만들었으면 이것도 다시).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const H = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36', Referer: 'https://kbland.kr/', Accept: 'application/json' };
export const SEOUL_BOX = { startLat: 37.413, startLng: 126.734, endLat: 37.715, endLng: 127.269 };
// 경기는 8곳이 흩어져 있어 한 사각으로 묶으면 빈 땅까지 훑게 됩니다 — 지역마다 단지 좌표를 감싸는 사각으로 나눠 조회
export const GYEONGGI_BOXES = {
  남양주: { startLat: 37.566, startLng: 127.102, endLat: 37.758, endLng: 127.347 },
  구리: { startLat: 37.574, startLng: 127.100, endLat: 37.648, endLng: 127.167 },
  하남: { startLat: 37.464, startLng: 127.136, endLat: 37.586, endLng: 127.236 },
  성남: { startLat: 37.325, startLng: 127.058, endLat: 37.483, endLng: 127.191 },
  용인: { startLat: 37.129, startLng: 127.043, endLat: 37.356, endLng: 127.374 },
  수원: { startLat: 37.224, startLng: 126.926, endLat: 37.324, endLng: 127.094 },
  안양: { startLat: 37.352, startLng: 126.883, endLat: 37.444, endLng: 126.989 },
  동탄: { startLat: 37.147, startLng: 127.040, endLat: 37.228, endLng: 127.139 },
};
// 지역별 설정 — 단지 목록·결과 파일·「너무 적으면 실패로 보는」 최소 개수
export const REGIONS = {
  seoul: { label: '서울', dir: 'kb-seoul-complexes.json', out: 'kb-seoul-infra.json', boxes: { 서울: SEOUL_BOX }, annual: true, min: { stations: 200, elems: 400, mids: 200, academies: 5000 } },
  gyeonggi: { label: '경기', dir: 'kb-gyeonggi-complexes.json', out: 'kb-gyeonggi-infra.json', boxes: GYEONGGI_BOXES, annual: false, min: { stations: 40, elems: 200, mids: 100, academies: 1000 } },
};
export const ACADEMY_RADIUS_M = 1000;
const TILE = 0.09;                 // 역 조회 칸(도) — 0.1도(약 11km)까지 허용됨
const log = msg => console.log(`[${new Date().toLocaleTimeString('ko-KR', { hour12: false })}] ${msg}`);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const num = v => { const n = Number(v); return v != null && v !== '' && Number.isFinite(n) ? n : null; };

async function kb(pathname, params) {
  let last;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(`https://api.kbland.kr${pathname}?${new URLSearchParams(params)}`, { headers: H, signal: AbortSignal.timeout(30000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      const d = j && j.dataBody && j.dataBody.data;
      if (Array.isArray(d)) return d;
      const code = Number((d && d.resultCode) ?? (j && j.dataBody && j.dataBody.resultCode));
      if (code === 33210) return [];                               // No Data(역·학교가 없는 칸) — dataBody.resultCode 로 옴
      throw new Error(`형식: ${JSON.stringify(j && j.dataBody).slice(0, 120)}`);
    } catch (e) { last = e; await sleep(1200 * (i + 1)); }
  }
  throw last;
}

/** 두 좌표 사이 직선거리(m) — 서울 범위에서는 평면 근사로 충분 */
export function distM(lat1, lng1, lat2, lng2) {
  const k = Math.PI / 180, x = (lng2 - lng1) * k * Math.cos(((lat1 + lat2) / 2) * k), y = (lat2 - lat1) * k;
  return Math.round(Math.sqrt(x * x + y * y) * 6371e3);
}

/** KB 통학구역 문자열 → [[외곽 링, 구멍 링…], …] (링 좌표는 [위도, 경도]) */
export function parseZone(str) {
  try {
    const g = typeof str === 'string' ? JSON.parse(str) : str;
    if (!g || !g.coordinates) return [];
    return g.type === 'MultiPolygon' ? g.coordinates : g.type === 'Polygon' ? [g.coordinates] : [];
  } catch { return []; }
}
function inRing(lat, lng, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [yi, xi] = ring[i], [yj, xj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
/** 좌표가 통학구역(MultiPolygon) 안에 드는지 — 구멍은 제외 */
export function inZone(lat, lng, polys) {
  for (const [outer, ...holes] of polys || []) {
    if (outer && inRing(lat, lng, outer) && !holes.some(h => inRing(lat, lng, h))) return true;
  }
  return false;
}
function bboxOf(polys) {
  let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity;
  for (const poly of polys) for (const [la, ln] of poly[0] || []) { a = Math.min(a, la); b = Math.max(b, la); c = Math.min(c, ln); d = Math.max(d, ln); }
  return [a, b, c, d];
}

/** 같은 이름·500m 안의 역(호선별로 따로 옴)을 하나로 묶어 호선 목록을 만듦 */
export function mergeStations(raw) {
  const out = [];
  for (const s of raw) {
    const name = String(s.지하철역명 || '').replace(/역$/, '').trim(), lat = num(s.wgs84위도), lng = num(s.wgs84경도);
    if (!name || lat == null || lng == null) continue;
    const line = String(s.지하철호선명 || '').replace(/^서울-/, '').trim();
    const hit = out.find(o => o.name === name && distM(o.lat, o.lng, lat, lng) <= 500);
    if (hit) { if (line && !hit.lines.includes(line)) hit.lines.push(line); continue; }
    out.push({ name, lat, lng, lines: line ? [line] : [] });
  }
  return out;
}

/**
 * 단지 좌표 → [가까운 역 index, 역까지 m, 배정 초등 index, 초등까지 m, 통학구역 안(1/0), 가까운 중학교 index, 중학교까지 m, 반경 1km 학원 수]
 * ctx: { stations:[{lat,lng}], elems:[{lat,lng,zones,bbox}], mids:[{lat,lng}], academies:[{lat,lng,count}] }
 */
export function complexMetrics(lat, lng, ctx) {
  const nearest = list => {
    let idx = -1, best = Infinity;
    list.forEach((p, i) => { const d = distM(lat, lng, p.lat, p.lng); if (d < best) { best = d; idx = i; } });
    return [idx, idx < 0 ? null : best];
  };
  const [st, stM] = nearest(ctx.stations);
  let elem = -1, elemM = null, zone = 0;
  ctx.elems.forEach((e, i) => {
    if (!e.zones.length) return;
    const [a, b, c, d] = e.bbox;
    if (lat < a || lat > b || lng < c || lng > d || !inZone(lat, lng, e.zones)) return;
    const m = distM(lat, lng, e.lat, e.lng);
    if (elemM == null || m < elemM) { elem = i; elemM = m; zone = 1; }
  });
  if (elem < 0) [elem, elemM] = nearest(ctx.elems);
  const [mid, midM] = nearest(ctx.mids);
  let academies = 0;
  const dLat = ACADEMY_RADIUS_M / 111000;
  for (const a of ctx.academies) {
    if (Math.abs(a.lat - lat) > dLat) continue;
    if (distM(lat, lng, a.lat, a.lng) <= ACADEMY_RADIUS_M) academies += a.count;
  }
  return [st, stM, elem, elemM, zone, mid, midM, academies];
}

export async function main(regionKey = 'seoul') {
  const region = REGIONS[regionKey];
  if (!region) throw new Error('모르는 지역: ' + regionKey);
  const t0 = Date.now();
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'site', 'public');
  const dir = JSON.parse(fs.readFileSync(path.join(root, region.dir), 'utf8'));
  const iLat = dir.fields.indexOf('lat'), iLng = dir.fields.indexOf('lng');
  if (iLat < 0 || iLng < 0) throw new Error('단지 목록에 좌표가 없습니다 — npm run kb:complexes 를 먼저 실행하세요');

  // 1) 지하철역 — 칸으로 나눠 조회(한 번에 약 11km 사각까지만 받아 줌)
  const raw = [];
  let tiles = 0;
  for (const area of Object.values(region.boxes)) {
    for (let la = area.startLat; la < area.endLat; la += TILE) {
      for (let ln = area.startLng; ln < area.endLng; ln += TILE) {
        const box = { zoomLevel: 14, startLat: +la.toFixed(4), startLng: +ln.toFixed(4), endLat: +(la + TILE + 0.005).toFixed(4), endLng: +(ln + TILE + 0.005).toFixed(4) };
        raw.push(...await kb('/land-complex/honeyLocation/subwayMarkerList', box));
        tiles++;
        await sleep(150);
      }
    }
  }
  const seen = new Set();
  const stations = mergeStations(raw.filter(s => { const k = s.지하철역식별자 || `${s.지하철역명}|${s.지하철호선명}`; if (seen.has(k)) return false; seen.add(k); return true; }));
  log(`지하철역 ${tiles}칸 조회 → ${seen.size}개(호선별) → 역 ${stations.length}곳`);

  // 2) 초등(통학구역)·중학교, 3) 일반교과 학원 — 지역 사각마다 한 번씩(서울은 한 번)
  const elemRaw = [], midRaw = [], acadRaw = [];
  for (const [name, area] of Object.entries(region.boxes)) {
    const whole = { zoomLevel: 15, ...area };
    elemRaw.push(...await kb('/land-complex/honeyLocation/schoolMarkerList', { schoolCode: '03', ...whole }));
    midRaw.push(...await kb('/land-complex/honeyLocation/schoolMarkerList', { schoolCode: '04', ...whole }));
    acadRaw.push(...await kb('/land-complex/honeyLocation/academyMarkerList', { academyCode: '01', ...whole }));
    if (Object.keys(region.boxes).length > 1) log(`  ${name} 조회`);
    await sleep(150);
  }
  // 지역 사각이 겹치면 같은 학교·학원이 두 번 들어오므로 이름·좌표로 한 번만 남김
  const uniqBy = (rows, key) => { const seen = new Set(); return rows.filter(r => { const k = key(r); if (seen.has(k)) return false; seen.add(k); return true; }); };
  const elems = uniqBy(elemRaw, s => `${s.학교명}|${s.wgs84위도}|${s.wgs84경도}`).map(s => {
    const zones = parseZone(s.wgs84폴리곤);
    return { name: s.학교명, lat: num(s.wgs84위도), lng: num(s.wgs84경도), classSize: num(s.학급당학생수), zones, bbox: zones.length ? bboxOf(zones) : null };
  }).filter(s => s.name && s.lat != null && s.lng != null);
  const mids = uniqBy(midRaw, s => `${s.학교명}|${s.wgs84위도}|${s.wgs84경도}`).map(s => ({ name: s.학교명, lat: num(s.wgs84위도), lng: num(s.wgs84경도) })).filter(s => s.name && s.lat != null && s.lng != null);
  const academies = uniqBy(acadRaw, a => `${a.wgs84위도}|${a.wgs84경도}`).map(a => ({ lat: num(a.wgs84위도), lng: num(a.wgs84경도), count: num(a.학원개수) || 0 })).filter(a => a.lat != null && a.lng != null);
  const acadTotal = academies.reduce((s, a) => s + a.count, 0);
  log(`초등학교 ${elems.length}곳(통학구역 ${elems.filter(e => e.zones.length).length}) · 중학교 ${mids.length}곳 · 일반교과 학원 ${acadTotal.toLocaleString('ko-KR')}곳(${academies.length}묶음)`);
  const min = region.min;
  if (stations.length < min.stations || elems.length < min.elems || mids.length < min.mids || acadTotal < min.academies) {
    throw new Error(`조회 결과가 너무 적습니다(역 ${stations.length}·초등 ${elems.length}·중등 ${mids.length}·학원 ${acadTotal}) — 기존 파일을 그대로 둡니다`);
  }

  // 4) 단지별 지표
  const ctx = { stations, elems, mids, academies };
  const byId = {};
  let noCoord = 0, zoned = 0;
  for (const c of dir.complexes) {
    const lat = c[iLat], lng = c[iLng];
    if (lat == null || lng == null) { noCoord++; continue; }
    const m = complexMetrics(lat, lng, ctx);
    if (m[4]) zoned++;
    byId[c[0]] = m;
  }
  const out = {
    generatedAt: new Date().toISOString(),
    region: regionKey, regionLabel: region.label,
    source: 'KB부동산 지도 꿀세권(지하철역·학교·학원) — 비공식 조회. 거리는 직선거리',
    academyRadiusM: ACADEMY_RADIUS_M,
    stations: stations.map(s => [s.name, s.lines.join('|'), s.lat, s.lng]),
    elems: elems.map(e => [e.name, e.lat, e.lng, e.classSize]),
    mids: mids.map(m => [m.name, m.lat, m.lng]),
    fields: ['station', 'stationM', 'elem', 'elemM', 'elemZone', 'mid', 'midM', 'academies'],
    byId,
  };
  const dest = path.join(root, region.out);
  fs.writeFileSync(dest, JSON.stringify(out));
  // 연도별 사본(site/public/annual/infra-<연도>.json) — 해마다 남겨 두고 전년 대비(학원 수·가까운 역 변화)에 씀. 같은 해에 다시 만들면 그해 파일만 바뀜
  // 연간 비교는 서울 단지만 쌓고 있어 서울일 때만 남깁니다
  if (region.annual) {
    const year = new Date(Date.now() + 9 * 3600e3).getUTCFullYear();
    const annualDir = path.join(root, 'annual');
    fs.mkdirSync(annualDir, { recursive: true });
    fs.writeFileSync(path.join(annualDir, `infra-${year}.json`), JSON.stringify({
      year, generatedAt: out.generatedAt, fields: ['stationM', 'elemM', 'elemZone', 'midM', 'academies'],
      byId: Object.fromEntries(Object.entries(byId).map(([id, m]) => [id, [m[1], m[3], m[4], m[6], m[7]]])),
    }));
  }
  const ms = Object.values(byId), med = (k, a = ms.map(v => v[k]).filter(v => v != null).sort((x, y) => x - y)) => a[a.length >> 1];
  log(`단지 ${ms.length}곳 → ${path.relative(process.cwd(), dest)} (${(fs.statSync(dest).size / 1024).toFixed(0)}KB) · 좌표 없음 ${noCoord} · 통학구역 안 ${zoned} · 중앙값 역 ${med(1)}m · 초등 ${med(3)}m · 학원 ${med(7)}곳 · ${Math.round((Date.now() - t0) / 1000)}초`);
  return out;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (invokedDirectly) {
  const arg = process.argv.slice(2).find(a => !a.startsWith('-')) || 'seoul';
  main(arg).catch(e => { console.error('[KB 입지 파일] 실패:', e); process.exit(1); });
}
