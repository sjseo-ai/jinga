// 단지 → 가장 가까운 지하철역 — 경사(build-kb-slope)·길상권(build-kb-sangga) 이 함께 씁니다.
//
// 2026-11-24 이전에는 KB 꿀세권 파일이 「가장 가까운 역 번호와 거리」를 **이미 계산해** 담고 있었습니다.
// 그 파일을 쓰지 않게 되면서, 공공 역 좌표 목록(station-<지역>.json)에서 **우리가 직접** 가장 가까운 역을 찾습니다.
// 두 생성기가 같은 답을 봐야 하므로 한곳에 둡니다 — 복사해 두면 한쪽만 고쳐질 때 조용히 갈라집니다.
import fs from 'node:fs';
import path from 'node:path';

/** 두 위경도 사이 직선거리(m) — 서울·경기 범위에서는 평면 근사로 충분합니다 */
export function distM(lat1, lng1, lat2, lng2) {
  const k = Math.PI / 180, x = (lng2 - lng1) * k * Math.cos(((lat1 + lat2) / 2) * k), y = (lat2 - lat1) * k;
  return Math.round(Math.sqrt(x * x + y * y) * 6371e3);
}

/**
 * station-<지역>.json 을 읽어 [{ name, lines, lat, lng }] 로.
 * 파일이 없으면 **무엇을 해야 하는지 적어** 던집니다(조용히 0곳으로 돌면 결과가 빈 채로 덮어씌워집니다).
 */
export function loadStations(publicDir, region) {
  const p = path.join(publicDir, `station-${region}.json`);
  if (!fs.existsSync(p)) {
    throw new Error(`station-${region}.json 이 없습니다 — 역 좌표를 먼저 넣어 주세요(npm run stations, 안내가 나옵니다).
  2026-11-24 에 KB 꿀세권 역 좌표를 빼면서 이 생성기도 공공 역 좌표를 쓰도록 바뀌었습니다.`);
  }
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  return (j.stations || []).map(s => ({ name: s[0], lines: s[1] ? String(s[1]).split('|') : [], lat: s[2], lng: s[3] }));
}

/** 가장 가까운 역 → { name, lines, lat, lng, m } · 목록이 비면 null */
export function nearestStation(lat, lng, stations) {
  let best = null;
  for (const s of stations) {
    const m = distM(lat, lng, s.lat, s.lng);
    if (m == null) continue;
    if (!best || m < best.m) best = { ...s, m };
  }
  return best;
}
