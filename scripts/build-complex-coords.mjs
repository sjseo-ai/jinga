// 단지 좌표(site/public/complex-coords-<지역>.json) — KB 단지 상세 좌표의 대체본
//   npm run geocode            서울·경기 (K-apt 주소 → 좌표. 중간 결과를 쌓아 두고 이어서 돕니다)
//   npm run geocode -- seoul --limit 50     조금만 시험해 보기
//
// ■ 사람이 한 번 해 주셔야 하는 것 — 카카오 REST API 키 (2026-11-25 절차 확인)
//   1) https://developers.kakao.com 카카오계정 로그인 → 개발자 계정 「회원가입」
//   2) https://developers.kakao.com/console/app → 「앱 생성」(앱 이름·회사명·카테고리·앱 대표 도메인)
//   3) 그 앱에서 **[카카오맵] → [사용 설정] → [상태] ON** ← **이걸 켜야 주소 검색이 됩니다**
//   4) [앱] → [플랫폼 키] → **[REST API 키]** 복사
//   넣기:  .\scripts\kakao-rest-key.cmd     → .secrets/kakao-rest.json (깃 제외)
//
//   무료 한도: 「주소로 좌표 변환」 **100,000건/일**(전체 API 월 300만건). 서울+경기 2,000곳이라 한 번에 끝납니다.
//   단, 무료 쿼터는 **개발자 계정에서 처음 활성화한 앱 하나**에만 줍니다 — 두 번째 앱부터는 유료(0.5원/건)입니다.
//   (2026-07-21 로 카카오맵 API 사용 방법·무료 쿼터 제공 방식이 바뀌었습니다.)
//   지도 표시에 쓰는 JavaScript 키와 **다른 키**입니다. 같은 앱의 [플랫폼 키]에 나란히 있습니다.
//
// 왜 필요한가 — 2026-11-24 이용허락 검토에서 KB 단지 상세(좌표 포함)를 공개 배포하던 것이 드러났습니다.
//   좌표는 추천 지도·「도보 10분 안 역·학교」·경사·길상권이 모두 쓰는 뿌리 값입니다. 그래서
//   **공개 주소(K-apt 도로명주소) → 공개 지오코더** 로 다시 만듭니다.
//
// 주소는 어디서 — 국토교통부 K-apt 기본정보(AptBasisInfoServiceV2)의 도로명주소입니다.
//   site/public/kapt-<지역>.json 에는 주소가 담겨 있지 않아(필요한 칸만 골라 저장했음) 여기서 다시 받습니다.
//   키는 이미 있는 .secrets/molit.json 을 씁니다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUB = path.join(ROOT, 'site', 'public');
const KAKAO_SECRET = path.join(ROOT, '.secrets', 'kakao-rest.json');
const MOLIT_SECRET = path.join(ROOT, '.secrets', 'molit.json');

export const SOURCE = '주소: 국토교통부 K-apt 공동주택 기본정보(도로명주소) · 좌표: 카카오 로컬 주소검색 API';
export const REGIONS = {
  seoul: { label: '서울', src: 'kapt-seoul.json', out: 'complex-coords-seoul.json', lat: [37.40, 37.72], lng: [126.73, 127.28] },
  gyeonggi: { label: '경기', src: 'kapt-gyeonggi.json', out: 'complex-coords-gyeonggi.json', lat: [37.05, 37.85], lng: [126.55, 127.50] },
};

const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = msg => console.log(`[${new Date().toLocaleTimeString('ko-KR', { hour12: false })}] ${msg}`);

function readKey(file, field, how) {
  if (!fs.existsSync(file)) throw new Error(`${path.relative(ROOT, file)} 이 없습니다 — ${how}`);
  const k = JSON.parse(fs.readFileSync(file, 'utf8'))[field];
  if (!k) throw new Error(`${path.relative(ROOT, file)} 에 ${field} 가 비어 있습니다 — ${how}`);
  return k;
}

/** K-apt 기본정보에서 도로명주소 한 건 */
export async function kaptAddress(serviceKey, kaptCode, fetchImpl = fetch) {
  const url = `https://apis.data.go.kr/1613000/AptBasisInfoServiceV2/getAphusBassInfoV2?${new URLSearchParams({
    serviceKey, kaptCode, _type: 'json',
  })}`;
  const r = await fetchImpl(url, { signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json();
  const item = j && j.response && j.response.body && j.response.body.item;
  if (!item) return null;
  const road = String(item.doroJuso || '').trim();
  const jibun = [item.kaptAddr, item.bjdCode].filter(Boolean)[0];
  return { road, legacy: String(jibun || '').trim(), name: String(item.kaptName || '').trim() };
}

/** 카카오 주소검색 — 도로명주소가 안 되면 지번주소로 한 번 더 */
export async function geocode(restKey, address, fetchImpl = fetch) {
  if (!address) return null;
  const url = `https://dapi.kakao.com/v2/local/search/address.json?${new URLSearchParams({ query: address, size: '1' })}`;
  const r = await fetchImpl(url, { headers: { Authorization: `KakaoAK ${restKey}` }, signal: AbortSignal.timeout(20000) });
  if (r.status === 401 || r.status === 403) throw new Error('카카오 키가 거부되었습니다(401/403) — REST API 키인지 확인해 주세요');
  if (!r.ok) throw new Error(`카카오 HTTP ${r.status}`);
  const j = await r.json();
  const d = j && j.documents && j.documents[0];
  if (!d) return null;
  const lat = Number(d.y), lng = Number(d.x);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6, matched: d.address_name || address };
}

export async function main(regionKey = 'seoul', { limit = 0, fetchImpl = fetch } = {}) {
  const region = REGIONS[regionKey];
  if (!region) throw new Error('모르는 지역: ' + regionKey);
  const restKey = readKey(KAKAO_SECRET, 'restKey', '.\\scripts\\kakao-rest-key.cmd 로 카카오 REST API 키를 넣어 주세요');
  const molit = readKey(MOLIT_SECRET, 'apiKey', '.\\scripts\\molit-key.cmd 로 국토교통부 키를 넣어 주세요');

  const src = JSON.parse(fs.readFileSync(path.join(PUB, region.src), 'utf8'));
  const dest = path.join(PUB, region.out);
  // 중간에 끊겨도 이어서 — 이미 받은 좌표는 다시 받지 않습니다
  const prev = fs.existsSync(dest) ? JSON.parse(fs.readFileSync(dest, 'utf8')) : null;
  const byComplex = (prev && prev.byComplex) || {};

  const todo = Object.entries(src.byComplex || {}).filter(([id]) => !byComplex[id]);
  const list = limit ? todo.slice(0, limit) : todo;
  log(`${region.label} — 좌표를 받을 단지 ${list.length.toLocaleString('ko-KR')}곳(이미 있는 ${Object.keys(byComplex).length}곳은 건너뜀)`);

  let ok = 0, noAddr = 0, noCoord = 0, outBox = 0;
  for (const [id, v] of list) {
    try {
      const a = await kaptAddress(molit, v.code, fetchImpl);
      await sleep(120);
      if (!a || !(a.road || a.legacy)) { noAddr += 1; continue; }
      const g = (await geocode(restKey, a.road, fetchImpl)) || (await geocode(restKey, a.legacy, fetchImpl));
      await sleep(80);
      if (!g) { noCoord += 1; continue; }
      // 지역 사각을 벗어난 좌표는 **버립니다** — 엉뚱한 곳을 지도에 찍는 것보다 비어 있는 게 낫습니다
      if (g.lat < region.lat[0] || g.lat > region.lat[1] || g.lng < region.lng[0] || g.lng > region.lng[1]) { outBox += 1; continue; }
      byComplex[id] = { lat: g.lat, lng: g.lng, addr: a.road || a.legacy };
      ok += 1;
      if (ok % 100 === 0) log(`  ${ok.toLocaleString('ko-KR')}곳 받음`);
    } catch (e) {
      if (/카카오 키가 거부/.test(e.message)) throw e;        // 키 문제는 바로 멈춥니다
      noCoord += 1;
    }
  }

  const data = {
    generatedAt: new Date().toISOString(),
    region: regionKey, regionLabel: region.label,
    source: SOURCE,
    note: '도로명주소를 지오코딩한 좌표입니다. 단지 출입구가 아니라 주소 대표점이라 단지 안 어느 지점인지는 보장하지 않습니다.',
    count: Object.keys(byComplex).length,
    byComplex,
  };
  fs.writeFileSync(dest, JSON.stringify(data));
  log(`${region.label} 좌표 ${data.count.toLocaleString('ko-KR')}곳 → ${region.out} · 새로 ${ok} · 주소 없음 ${noAddr} · 좌표 못 찾음 ${noCoord} · 범위 밖 ${outBox}`);
  return data;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const only = args.filter(a => !a.startsWith('-'));
  const li = args.indexOf('--limit');
  const limit = li >= 0 ? Number(args[li + 1]) || 0 : 0;
  (async () => {
    for (const r of (only.length ? only : Object.keys(REGIONS))) await main(r, { limit });
  })().catch(e => { console.error(`\n실패: ${e.message}\n`); process.exit(1); });
}
