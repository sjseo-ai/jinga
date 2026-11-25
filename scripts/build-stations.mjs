// 지하철역 좌표(site/public/station-<지역>.json) — KB 꿀세권 역 좌표의 대체본
//   npm run stations            data/ 에 떨어뜨린 표준데이터 파일을 읽어 만듭니다(네트워크 호출 없음)
//
// ■ 사람이 한 번 해 주셔야 하는 것 — 파일 하나 내려받아 두기(엑셀 변환은 필요 없습니다)
//   공공데이터포털 「전국도시철도역사정보표준데이터」(데이터셋 15013205)는 **오픈API 가 아니라 파일(XLSX) 제공**입니다.
//   https://www.data.go.kr/data/15013205/standard.do → 「내려받기」 → 받은 파일을 그대로
//   저장소 폴더나 그 위 폴더, 또는 data/ 에 두면 이 스크립트가 **이름으로 알아서 찾습니다**
//   (전체_도시철도역사정보_*.xlsx · stations.xlsx · stations.csv 등).
//   제공기관 국가철도공단 · 소관 국토교통부 · 이용허락범위 **제한 없음**(2026-11-24 포털 확인) · 갱신 연 1회.
//
// 왜 파일인가 — 자동 수집을 붙이고 싶었지만 이 데이터셋에는 호출할 API 가 없습니다.
//   레일포털·서울 열린데이터광장에 비슷한 API 가 있지만 각각 별도 키·활용신청이 필요해,
//   **키를 늘리지 않고 끝나는 쪽**을 골랐습니다. 역 좌표가 들어오면 slope-*·sangga-* 재생성과
//   추천 지도의 역 핀이 함께 되살아납니다.
//   XLSX 는 scripts/_xlsx-read.mjs 로 직접 읽습니다 — 사람에게 CSV 변환을 떠넘기면 그 단계에서
//   인코딩·따옴표가 틀어지고, 「변환했는데 안 돼요」가 됩니다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readXlsx } from './_xlsx-read.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUB = path.join(ROOT, 'site', 'public');
const DATA = path.join(ROOT, 'data');

export const SOURCE = '국가철도공단 전국도시철도역사정보표준데이터(공공데이터포털 15013205, 소관 국토교통부)';
// 받은 파일 이름을 그대로 두어도 찾도록 — 포털이 날짜를 붙여 줍니다(전체_도시철도역사정보_20260630.xlsx)
export const NAME_RE = /^(stations|전체[_ ]?도시철도역사정보.*|전국도시철도역사정보.*|국가철도공단.*역사정보.*)\.(xlsx|csv)$/i;
// 찾아볼 폴더 — data/ · 저장소 뿌리 · 그 위 폴더(대표가 보통 여기에 둡니다)
export const SEARCH_DIRS = [DATA, ROOT, path.resolve(ROOT, '..')];
/**
 * 지역별 좌표 사각 — 표준데이터는 전국이라 쓰는 범위만 잘라 담습니다.
 *
 * **경기 사각은 서울을 품고 있습니다.** 일부러 그렇습니다 — 경기 단지가 서울 역을 걸어서 가는
 * 경우(광명·과천·하남)가 흔해서, 경계에서 잘라 내면 그 단지들의 역이 사라집니다.
 * 두 파일을 함께 불러 쓰므로 겹친 역은 jinga-reco.mjs 의 attachStations() 가 이름·좌표로 한 번만 남깁니다.
 * 그래서 경기 파일의 개수는 「경기에 있는 역 수」가 아닙니다.
 */
export const BOXES = {
  seoul: { label: '서울', lat: [37.40, 37.72], lng: [126.73, 127.28], out: 'station-seoul.json', min: 250 },
  gyeonggi: { label: '경기(서울 포함)', lat: [37.10, 37.80], lng: [126.60, 127.45], out: 'station-gyeonggi.json', min: 150 },
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

/**
 * 표준데이터 머리글은 기관마다 조금씩 다릅니다 — 뜻으로 찾습니다.
 *
 * 패턴을 **우선순위 순으로** 시도합니다. 「머리글을 하나씩 보며 아무 패턴이나 맞으면 채택」하면
 * 「노선번호」가 「노선명」보다 앞에 있어서 /^노선/ 에 먼저 걸립니다 — 실제로 그래서 노선명 대신
 * 노선번호(I11D1·S1102)가 들어갔습니다. 앞 패턴을 **모든 머리글에 대해** 먼저 찾아야 합니다.
 */
export function pickColumns(header) {
  const find = (...pats) => {
    for (const p of pats) {
      const i = header.findIndex(h => p.test(h));
      if (i >= 0) return i;
    }
    return -1;
  };
  return {
    name: find(/^역사명$/, /^역명$/, /역사?명$/),
    line: find(/^노선명$/, /노선명/, /^노선/),
    lat: find(/위도/, /^lat/i),
    lng: find(/경도/, /^lon/i, /^lng/i),
    transfer: find(/환승.*노선명/, /환승.*노선/, /환승역/),
  };
}

/**
 * 역 이름 정리 — 「잠실(송파구청)」 → 「잠실」 · 「강남역」 → 「강남」
 * 표준데이터는 병기역명을 괄호로 붙여 적습니다. 그대로 두면 K-apt 가 「잠실」로 신고한 역과
 * 이름이 달라지고, 지도 범례에도 괄호가 그대로 찍힙니다. 괄호 안은 버리고 대표 이름만 남깁니다.
 */
export const cleanStationName = s => String(s || '')
  .replace(/[（(][^)）]*[)）]/g, '')
  .trim()
  .replace(/역$/, '')
  .trim();

/**
 * 행 배열(머리글 포함) → [{ name, lines:[], lat, lng }]
 * CSV 와 XLSX 가 **같은 코드**를 지나가게 합니다 — 읽는 방식만 다르고 해석은 하나여야 합니다.
 *
 * 같은 역 이름이 노선마다 한 줄씩 옵니다(강남: 2호선·신분당선). 이름으로 묶어 노선을 합치고,
 * 좌표는 **처음 나온 것**을 씁니다. 환승역은 호선별 출입구 좌표가 조금씩 다르지만 수십 m 차이라
 * 역세권 판정에는 영향이 없고, 평균을 내면 어느 쪽도 아닌 지점이 됩니다.
 *
 * 이름이 같아도 **다른 역**인 경우가 있습니다(서울 양평역 ↔ 경기 양평역). 1km 넘게 떨어져 있으면
 * 합치지 않고 따로 둡니다 — 합쳐 버리면 둘 중 한 곳이 엉뚱한 좌표를 갖게 됩니다.
 */
export function parseRows(rows) {
  if (!rows || !rows.length) throw new Error('빈 파일입니다');
  const header = rows[0].map(h => String(h || '').trim());
  const col = pickColumns(header);
  if (col.name < 0 || col.lat < 0 || col.lng < 0) {
    throw new Error(`머리글에서 역사명·위도·경도 칸을 못 찾았습니다 — 받은 머리글: ${header.slice(0, 15).join(' / ')}`);
  }
  const out = [];
  for (const c of rows.slice(1)) {
    const name = cleanStationName(c[col.name]);
    const lat = Number(c[col.lat]), lng = Number(c[col.lng]);
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) continue;
    const line = col.line >= 0 ? String(c[col.line] || '').trim().replace(/^서울-/, '') : '';
    const hit = out.find(o => o.name === name && distM(o.lat, o.lng, lat, lng) <= 1000);
    if (hit) { if (line && !hit.lines.includes(line)) hit.lines.push(line); continue; }
    out.push({ name, lines: line ? [line] : [], lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 });
  }
  return out;
}

/** 두 좌표 사이 직선거리(m) — 같은 이름의 다른 역을 가르는 데만 씁니다 */
function distM(lat1, lng1, lat2, lng2) {
  const k = Math.PI / 180, x = (lng2 - lng1) * k * Math.cos(((lat1 + lat2) / 2) * k), y = (lat2 - lat1) * k;
  return Math.round(Math.sqrt(x * x + y * y) * 6371e3);
}

/** CSV 본문 → 같은 결과 */
export function parseStations(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
  return parseRows(lines.map(splitCsvLine));
}

export function sourceFile() {
  const hits = [];
  for (const dir of SEARCH_DIRS) {
    let names = [];
    try { names = fs.readdirSync(dir); } catch { continue; }
    for (const n of names) if (NAME_RE.test(n)) hits.push(path.join(dir, n));
  }
  if (!hits.length) return null;
  // 여러 개면 가장 최근에 받은 것 — 포털이 연 1회 갱신하므로 날짜가 붙은 새 파일이 맞습니다
  hits.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return hits[0];
}

export function buildAll() {
  const src = sourceFile();
  if (!src) {
    throw new Error(`표준데이터 파일이 없습니다. 아래를 한 번 해 주세요 —
  1) https://www.data.go.kr/data/15013205/standard.do 에서 「내려받기」
  2) 받은 파일을 **그대로** 아래 어느 폴더에든 두기(엑셀로 변환할 필요 없습니다)
${SEARCH_DIRS.map(d => `       ${d}`).join('\n')}
  3) 다시 npm run stations

  (이 데이터셋은 오픈API 가 없어 파일로만 받을 수 있습니다. 역사 정보는 연 1회 갱신입니다.)`);
  }
  const all = /\.xlsx$/i.test(src) ? parseRows(readXlsx(src)) : parseStations(fs.readFileSync(src, 'utf8'));
  const out = [];
  for (const [region, box] of Object.entries(BOXES)) {
    const rows = all.filter(s => s.lat >= box.lat[0] && s.lat <= box.lat[1] && s.lng >= box.lng[0] && s.lng <= box.lng[1]);
    if (rows.length < box.min) throw new Error(`${box.label} 역이 ${rows.length}곳뿐입니다(최소 ${box.min}) — 받은 파일이 전국 자료인지 보세요`);
    const data = {
      generatedAt: new Date().toISOString(),
      region, regionLabel: box.label,
      source: SOURCE,
      srcFile: path.basename(src),
      note: `좌표는 역사 대표 좌표입니다. 출입구 위치가 아니라서 역까지의 실제 도보 거리와는 차이가 납니다. 환승역은 호선별로 한 줄씩 와서 이름으로 묶었고(좌표는 처음 나온 것), 병기역명은 떼어 대표 이름만 남겼습니다(「잠실(송파구청)」→「잠실」).${region === 'gyeonggi' ? ' 이 파일의 사각은 서울을 품고 있습니다 — 경기 단지가 서울 역을 걸어가는 경우가 흔해서 일부러 겹쳐 담았습니다. 개수는 「경기에 있는 역 수」가 아닙니다.' : ''}`,
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
