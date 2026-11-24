// 지하철역 좌표(site/public/station-<지역>.json) — KB 꿀세권 역 좌표의 대체본
//   npm run stations            data/ 에 떨어뜨린 표준데이터 파일을 읽어 만듭니다(네트워크 호출 없음)
//
// ■ 사람이 한 번 해 주셔야 하는 것
//   공공데이터포털 「전국도시철도역사정보표준데이터」(데이터셋 15013205)는 **오픈API 가 아니라 파일(XLSX) 제공**입니다.
//   https://www.data.go.kr/data/15013205/standard.do → 「내려받기」 → 받은 파일을 아래 이름 중 하나로 저장:
//       data/stations.csv      (엑셀에서 「CSV UTF-8」로 저장한 것 — 권장)
//       data/stations.xlsx     (받은 그대로. 이 스크립트는 XLSX 를 직접 읽지 못해 CSV 로 바꿔 달라고 알려 줍니다)
//   제공기관 국가철도공단 · 소관 국토교통부 · 갱신 연 1회. 역사는 거의 바뀌지 않으므로 한 번 넣으면 오래 씁니다.
//
// 왜 파일인가 — 자동 수집을 붙이고 싶었지만 이 데이터셋에는 호출할 API 가 없습니다.
//   레일포털·서울 열린데이터광장에 비슷한 API 가 있지만 각각 별도 키·활용신청이 필요해,
//   **키를 늘리지 않고 끝나는 쪽**을 골랐습니다. 역 좌표가 들어오면 slope-*·sangga-* 재생성과
//   추천 지도의 역 핀이 함께 되살아납니다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUB = path.join(ROOT, 'site', 'public');
const DATA = path.join(ROOT, 'data');

export const SOURCE = '국가철도공단 전국도시철도역사정보표준데이터(공공데이터포털 15013205, 소관 국토교통부)';
export const CANDIDATES = ['stations.csv', 'stations.xlsx', '전국도시철도역사정보표준데이터.csv', '전국도시철도역사정보표준데이터.xlsx'];
/** 지역별 좌표 사각 — 표준데이터는 전국이라 쓰는 범위만 잘라 담습니다 */
export const BOXES = {
  seoul: { label: '서울', lat: [37.40, 37.72], lng: [126.73, 127.28], out: 'station-seoul.json', min: 250 },
  gyeonggi: { label: '경기', lat: [37.10, 37.80], lng: [126.60, 127.45], out: 'station-gyeonggi.json', min: 150 },
};

/** 쉼표 구분 한 줄 — 따옴표 안의 쉼표를 지키며 나눕니다 */
export function splitCsvLine(line) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i += 1; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map(s => s.trim());
}

/** 표준데이터 머리글은 기관마다 조금씩 다릅니다 — 뜻으로 찾습니다 */
export function pickColumns(header) {
  const find = (...pats) => header.findIndex(h => pats.some(p => p.test(h)));
  return {
    name: find(/역사?명$/, /^역명/, /역사명/),
    line: find(/노선명/, /^노선/),
    lat: find(/위도/, /^lat/i),
    lng: find(/경도/, /^lon/i, /^lng/i),
    transfer: find(/환승.*노선/, /환승역/),
  };
}

/** CSV 본문 → [{ name, lines:[], lat, lng }] · 같은 역은 노선을 합칩니다 */
export function parseStations(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) throw new Error('빈 파일입니다');
  const header = splitCsvLine(lines[0]);
  const col = pickColumns(header);
  if (col.name < 0 || col.lat < 0 || col.lng < 0) {
    throw new Error(`머리글에서 역사명·위도·경도 칸을 못 찾았습니다 — 받은 머리글: ${header.slice(0, 12).join(' / ')}`);
  }
  const by = new Map();
  for (const raw of lines.slice(1)) {
    const c = splitCsvLine(raw);
    const name = String(c[col.name] || '').trim().replace(/역$/, '');
    const lat = Number(c[col.lat]), lng = Number(c[col.lng]);
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) continue;
    const line = col.line >= 0 ? String(c[col.line] || '').trim().replace(/^서울-/, '') : '';
    const key = name;
    const hit = by.get(key);
    if (hit) { if (line && !hit.lines.includes(line)) hit.lines.push(line); continue; }
    by.set(key, { name, lines: line ? [line] : [], lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 });
  }
  return [...by.values()];
}

export function sourceFile() {
  for (const f of CANDIDATES) {
    const p = path.join(DATA, f);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

export function buildAll() {
  const src = sourceFile();
  if (!src) {
    throw new Error(`표준데이터 파일이 없습니다. 아래를 한 번 해 주세요 —
  1) https://www.data.go.kr/data/15013205/standard.do 에서 「내려받기」
  2) 엑셀로 열어 「다른 이름으로 저장 → CSV UTF-8」
  3) data/stations.csv 로 저장한 뒤 다시 npm run stations

  (이 데이터셋은 오픈API 가 없어 파일로만 받을 수 있습니다. 역사 정보는 연 1회 갱신입니다.)`);
  }
  if (/\.xlsx$/i.test(src)) {
    throw new Error(`${path.basename(src)} 은 XLSX 입니다 — 엑셀에서 「CSV UTF-8」로 다시 저장해 data/stations.csv 로 두세요.`);
  }
  const all = parseStations(fs.readFileSync(src, 'utf8'));
  const out = [];
  for (const [region, box] of Object.entries(BOXES)) {
    const rows = all.filter(s => s.lat >= box.lat[0] && s.lat <= box.lat[1] && s.lng >= box.lng[0] && s.lng <= box.lng[1]);
    if (rows.length < box.min) throw new Error(`${box.label} 역이 ${rows.length}곳뿐입니다(최소 ${box.min}) — 받은 파일이 전국 자료인지 보세요`);
    const data = {
      generatedAt: new Date().toISOString(),
      region, regionLabel: box.label,
      source: SOURCE,
      srcFile: path.basename(src),
      note: '좌표는 역사 대표 좌표입니다. 출입구 위치가 아니라서 역까지의 실제 도보 거리와는 차이가 납니다.',
      fields: ['name', 'lines', 'lat', 'lng'],
      count: rows.length,
      // jinga-reco.mjs 가 읽는 꼴과 같게 — [이름, '1호선|7호선', 위도, 경도]
      stations: rows.sort((a, b) => (a.name < b.name ? -1 : 1)).map(s => [s.name, s.lines.join('|'), s.lat, s.lng]),
    };
    const p = path.join(PUB, box.out);
    fs.writeFileSync(p, JSON.stringify(data));
    out.push({ region, path: p, count: rows.length });
  }
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    for (const r of buildAll()) {
      console.log(`${BOXES[r.region].label} 역 ${r.count.toLocaleString('ko-KR')}곳 → ${path.basename(r.path)} (${(fs.statSync(r.path).size / 1024).toFixed(0)}KB)`);
    }
    console.log('\n다음: npm run kb:slope / kb:sangga 를 이 좌표로 다시 돌려 slope-*·sangga-* 를 되살립니다.');
  } catch (e) { console.error(`\n${e.message}\n`); process.exit(1); }
}
