// 역까지 가는 길의 경사 — site/public/slope-<지역>.json
//   npm run kb:slope            서울 (kb-seoul-infra.json 의 「가장 가까운 역」 기준)
//   npm run kb:slope:gyeonggi   경기
//
// 무엇을 재나 — 단지에서 가장 가까운 지하철역까지 **직선 경로를 5등분한 6개 지점의 표고**를 받아
//   · rise    단지 표고 − 역 표고(양수면 역에서 집으로 오르막)
//   · grade   rise ÷ 거리 (평균 경사, %)
//   · up      경로에서 올라가는 구간의 표고 합(언덕을 넘는 길이면 표고차보다 큼)
//   · maxGrade 구간별 경사 중 가장 가파른 값(%)
// 표고는 OpenTopoData 의 SRTM 30m(키 없음, 초당 1회·하루 1,000회 제한)로 받습니다. 한 번에 100지점씩 묶어
// 단지 약 8,500곳이면 요청 약 900회 — 하루 한도에 가까워 자주 돌리지 말고, 지형은 거의 안 바뀌니 단지 목록을
// 새로 만들 때만 다시 돌리면 됩니다. 이미 만들어 둔 값이 있으면 그 단지는 건너뜁니다(--all 로 전부 다시).
//
// 한계 — 실제 보행 경로가 아니라 직선 위의 표고이고, SRTM 30m 는 30m 격자라 좁은 골목의 급경사는 뭉개집니다.
//        건물 옥상 높이가 섞여 들어가기도 합니다. 그래서 「대략 평지/오르막/가파름」 수준으로만 씁니다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadStations, nearestStation } from './_nearest-station.mjs';

const API = 'https://api.opentopodata.org/v1/srtm30m';
const BATCH = 100;                 // 한 요청에 담을 지점 수(OpenTopoData 공개 서버 상한)
const GAP_MS = 1100;               // 초당 1회 제한 — 여유 있게
export const SAMPLES = 5;          // 경로를 5등분 → 지점 6개
export const REGIONS = {
  // 2026-11-24 — 역 좌표 원천을 KB 꿀세권에서 국가철도공단 표준데이터(station-<지역>.json)로 바꿨습니다.
  // 「가장 가까운 역」은 이제 미리 계산된 값을 읽는 게 아니라 _nearest-station.mjs 가 직접 찾습니다.
  seoul: { label: '서울', dir: 'kb-seoul-complexes.json', out: 'slope-seoul.json' },
  gyeonggi: { label: '경기', dir: 'kb-gyeonggi-complexes.json', out: 'slope-gyeonggi.json' },
};

const log = msg => console.log(`[${new Date().toLocaleTimeString('ko-KR', { hour12: false })}] ${msg}`);
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** 두 점 사이를 n등분한 지점들(양 끝 포함) */
export function samplePath(aLat, aLng, bLat, bLng, n = SAMPLES) {
  const out = [];
  for (let i = 0; i <= n; i++) { const t = i / n; out.push([aLat + (bLat - aLat) * t, aLng + (bLng - aLng) * t]); }
  return out;
}

/**
 * 표고 배열(단지 → 역 순서)과 거리(m) → 경사 지표
 * elevs[0] 이 단지, 마지막이 역입니다.
 */
export function slopeOf(elevs, distM) {
  const e = (elevs || []).map(Number).filter(Number.isFinite);
  if (e.length < 2 || !(distM > 0)) return null;
  const rise = Math.round((e[0] - e[e.length - 1]) * 10) / 10;
  const step = distM / (e.length - 1);
  let up = 0, down = 0, maxUp = 0;
  for (let i = 1; i < e.length; i++) {
    const d = e[i - 1] - e[i];                       // 역 쪽으로 갈 때 내려가면 +(= 집으로 올 때 오르막)
    if (d > 0) { up += d; maxUp = Math.max(maxUp, d / step); } else down += -d;
  }
  const pct = v => Math.round(v * 1000) / 10;
  return {
    rise, grade: pct(rise / distM), up: Math.round(up * 10) / 10, down: Math.round(down * 10) / 10,
    maxGrade: pct(maxUp), elevs: e.map(v => Math.round(v)),
  };
}

/** 경사 지표 → 한 줄 설명. 평균 경사 기준(도보 체감) */
export function slopeText(s) {
  if (!s) return '';
  const g = Math.abs(s.grade);
  const dir = s.rise >= 2 ? '오르막' : s.rise <= -2 ? '내리막' : '평지';
  const level = g < 2 ? '거의 평지' : g < 5 ? '완만' : g < 8 ? '다소 가파름' : '가파름';
  if (dir === '평지') return `역까지 ${level}(평균 ${g.toFixed(1)}%)`;
  return `역에서 집까지 ${dir} ${Math.abs(s.rise).toFixed(0)}m · ${level}(평균 ${g.toFixed(1)}%)`;
}

/**
 * 표고를 묶음으로 받아 옵니다. onProgress 가 있으면 묶음마다 불러 줍니다.
 *
 * 2026-11-24 에 이것을 7분 돌리고 세션이 끊겨 **아무것도 남지 않았습니다.** 전부 받은 뒤에야
 * 한 번 저장했기 때문입니다. 이제 묶음마다 알려 주고, 부르는 쪽이 중간 저장을 합니다.
 */
async function fetchElevations(points, fetchImpl, onProgress = null) {
  const out = [];
  for (let i = 0; i < points.length; i += BATCH) {
    const chunk = points.slice(i, i + BATCH);
    const q = chunk.map(p => `${p[0].toFixed(6)},${p[1].toFixed(6)}`).join('|');
    let done = false;
    for (let t = 0; t < 3 && !done; t++) {
      try {
        const r = await fetchImpl(`${API}?locations=${q}`, { headers: { 'User-Agent': 'jinga-retech/1.0' }, signal: AbortSignal.timeout(30000) });
        if (r.status === 429) { await sleep(5000 * (t + 1)); continue; }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json();
        if (!Array.isArray(j.results)) throw new Error('형식: ' + JSON.stringify(j).slice(0, 120));
        out.push(...j.results.map(x => x.elevation));
        done = true;
      } catch (e) { if (t === 2) throw e; await sleep(2000 * (t + 1)); }
    }
    if (onProgress) onProgress(out, points.length);          // 누적 배열을 그대로 넘깁니다
    await sleep(GAP_MS);
  }
  return out;
}

export async function main(regionKey = 'seoul', { fetchImpl = (...a) => fetch(...a), all = false } = {}) {
  const region = REGIONS[regionKey];
  if (!region) throw new Error('모르는 지역: ' + regionKey);
  const t0 = Date.now();
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'site', 'public');
  const stations = loadStations(root, regionKey);
  const dir = JSON.parse(fs.readFileSync(path.join(root, region.dir), 'utf8'));
  const dest = path.join(root, region.out);
  const prev = !all && fs.existsSync(dest) ? JSON.parse(fs.readFileSync(dest, 'utf8')) : null;
  const byId = (prev && prev.byId) || {};

  // 단지 → 가장 가까운 역. 좌표·역이 없으면 건너뜀
  const jobs = [];
  for (const c of dir.complexes) {
    const id = c[0], lat = c[7], lng = c[8];
    if (lat == null || lng == null) continue;
    if (byId[id] && !all) continue;
    const s = nearestStation(lat, lng, stations);
    if (!s || !(s.m > 0)) continue;
    jobs.push({ id, lat, lng, stLat: s.lat, stLng: s.lng, m: s.m, station: s.name });
  }
  log(`${region.label} — 경사를 잴 단지 ${jobs.length}곳(이미 있는 ${Object.keys(byId).length}곳은 건너뜀)`);
  if (!jobs.length) { log('새로 잴 단지가 없습니다'); return prev; }

  const points = jobs.flatMap(j => samplePath(j.lat, j.lng, j.stLat, j.stLng));
  const calls = Math.ceil(points.length / BATCH);
  log(`표고 지점 ${points.length.toLocaleString('ko-KR')}개 · 요청 ${calls}회(초당 1회, 약 ${Math.ceil(calls * GAP_MS / 1000 / 60)}분) — OpenTopoData SRTM 30m`);
  // 받은 표고를 묶음마다 셈해 **중간 저장**합니다. 끊겨도 받은 단지까지는 남고, 다시 돌리면
  // 거기서부터 이어서 돕니다(위 byId[id] 검사). 한 단지는 표고 SAMPLES+1 개가 모두 와야 셀 수 있습니다.
  const perJob = SAMPLES + 1;
  const snapshot = () => ({
    generatedAt: new Date().toISOString(),
    region: regionKey, regionLabel: region.label,
    source: 'OpenTopoData SRTM 30m — 단지에서 가장 가까운 지하철역까지 직선 경로를 5등분한 표고. 실제 보행 경로가 아니며 30m 격자라 좁은 골목의 급경사는 뭉개집니다. 역 좌표는 국가철도공단 전국도시철도역사정보표준데이터.',
    fields: ['rise', 'grade', 'up', 'maxGrade'],
    samples: SAMPLES,
    count: Object.keys(byId).length,
    byId,
  });
  let saved = Object.keys(byId).length, nextJob = 0;
  const save = () => { fs.writeFileSync(dest, JSON.stringify(snapshot())); saved = Object.keys(byId).length; };
  const elevs = await fetchElevations(points, fetchImpl, acc => {
    const ready = Math.floor(acc.length / perJob);                // 표고가 전부 온 단지까지만 셉니다
    for (; nextJob < ready; nextJob++) {
      const j = jobs[nextJob];
      if (!j) continue;
      const s = slopeOf(acc.slice(nextJob * perJob, (nextJob + 1) * perJob), j.m);
      if (s) byId[j.id] = [s.rise, s.grade, s.up, s.maxGrade];
    }
    if (Object.keys(byId).length - saved >= 300) { save(); log(`  ${ready}/${jobs.length} 단지 (중간 저장)`); }
  });
  if (elevs.length !== points.length) throw new Error(`표고 개수가 맞지 않습니다(${elevs.length}/${points.length})`);

  // 끝까지 받았으면 **전부 다시 셉니다.** 중간 저장은 묶음이 꽉 찬 단지까지만 세기 때문에
  // 마지막 묶음의 단지들이 빠집니다. 같은 값을 덮어쓰는 것이라 결과는 달라지지 않고,
  // 「중간에 끊겼을 때 남는 양」만 늘어납니다.
  let ok = 0;
  jobs.forEach((j, i) => {
    const seg = elevs.slice(i * (SAMPLES + 1), (i + 1) * (SAMPLES + 1));
    const s = slopeOf(seg, j.m);
    if (!s) return;
    byId[j.id] = [s.rise, s.grade, s.up, s.maxGrade];
    ok++;
  });

  const out = snapshot();
  fs.writeFileSync(dest, JSON.stringify(out));
  const gr = Object.values(byId).map(v => Math.abs(v[1])).sort((a, b) => a - b);
  const med = gr[gr.length >> 1];
  const steep = Object.values(byId).filter(v => v[1] >= 5).length;
  log(`${ok}곳 계산 → ${path.relative(process.cwd(), dest)} (${(fs.statSync(dest).size / 1024).toFixed(0)}KB) · 전체 ${out.count}곳 · 평균 경사 중앙값 ${med}% · 오르막 5% 이상 ${steep}곳 · ${Math.round((Date.now() - t0) / 1000)}초`);
  return out;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (invokedDirectly) {
  const args = process.argv.slice(2);
  const region = args.find(a => !a.startsWith('-')) || 'seoul';
  main(region, { all: args.includes('--all') }).catch(e => { console.error('[경사] 실패:', e.message); process.exit(1); });
}
