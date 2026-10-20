// KB부동산 전국 단지 목록 → 「아파트」 단지 디렉터리 생성
//   npm run kb:complexes              서울 25개 자치구 → site/public/kb-seoul-complexes.json (약 7~10분)
//   npm run kb:complexes:gyeonggi     경기 주요 8개 지역 → site/public/kb-gyeonggi-complexes.json (약 4~6분)
//                                     남양주 · 구리 · 하남 · 성남 · 용인 · 수원 · 안양 · 동탄(화성 동탄구)
// KB부동산 웹이 내부적으로 쓰는 비공식 엔드포인트(api.kbland.kr)라 형식이 예고 없이 바뀔 수 있습니다.
// 단지 목록은 신규 단지가 생길 때만 바뀌므로 가끔(예: 분기 1회) 다시 만들면 됩니다. 시세 자체는 페이지가 조회 시점에 받아옵니다.
//
// 2026-09-15 — 아파트만 남김(검색에 오피스텔이 섞이고, 주상복합은 상품성이 달라 제외 요청)
//   · 목록의 시세물건식별자 앞글자: KBA = 아파트·주상복합, KBO = 오피스텔 → KBO는 바로 제외
//   · KBA는 단지 상세(/land-complex/complex/main)의 매물종별구분으로 01 아파트만 남기고 02 주상복합 등은 제외
//   · 같은 상세에서 용적률·건폐율(%)을 받아 디렉터리에 넣음 → 단지 검색의 용적률 조건
// 2026-09-15 — 같은 상세의 좌표(wgs84)·최고층수·현관구조도 저장 → 매물 추천의 역세권·학군 계산(scripts/build-kb-infra.mjs)과 카드 표시
// 2026-09-16 — 사용승인일(준공년월일) 저장. KB 단지 요약(brif)은 준공년월(YYYY.MM)까지만 줘서 날짜는 이 상세에서만 받을 수 있습니다.
//              건축물대장의 사용승인일과 같은 값이며, 여기에 담아 두면 검색할 때 따로 조회하지 않아도 됩니다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 지역 = { 라벨: [법정동코드 앞 5자리, …] }. 한 라벨에 여러 구가 묶이면(성남·용인·수원·안양) 법정동 앞에 구 이름을 붙여 둡니다.
const SEOUL_CODES = {
  11110: '종로구', 11140: '중구', 11170: '용산구', 11200: '성동구', 11215: '광진구',
  11230: '동대문구', 11260: '중랑구', 11290: '성북구', 11305: '강북구', 11320: '도봉구',
  11350: '노원구', 11380: '은평구', 11410: '서대문구', 11440: '마포구', 11470: '양천구',
  11500: '강서구', 11530: '구로구', 11545: '금천구', 11560: '영등포구', 11590: '동작구',
  11620: '관악구', 11650: '서초구', 11680: '강남구', 11710: '송파구', 11740: '강동구',
};
const GYEONGGI_CODES = {
  41360: '남양주', 41310: '구리', 41450: '하남',
  41131: '성남', 41133: '성남', 41135: '성남',
  41461: '용인', 41463: '용인', 41465: '용인',
  41111: '수원', 41113: '수원', 41115: '수원', 41117: '수원',
  41171: '안양', 41173: '안양',
  41597: '동탄',                                   // 화성시 동탄구(2026년 구 전환) — 동탄1·2신도시
};
export const REGIONS = {
  seoul: { codes: SEOUL_CODES, file: 'kb-seoul-complexes.json', label: '서울', order: Object.values(SEOUL_CODES) },
  gyeonggi: { codes: GYEONGGI_CODES, file: 'kb-gyeonggi-complexes.json', label: '경기', order: ['남양주', '구리', '하남', '성남', '용인', '수원', '안양', '동탄'] },
};

/** KB 주소 → 법정동(구가 있으면 「구 법정동」). '경기도 성남시 분당구 야탑동 391' → '분당구 야탑동' */
export function dongOf(addr, region) {
  const p = String(addr || '').split(/\s+/);
  if (region === 'seoul') return p[2] || '';
  const gu = p[2] && /(구|시)$/.test(p[2]) ? p[2] : '';
  const rest = p.slice(gu ? 3 : 2).filter(x => /[가-힣]$/.test(x));
  const dong = rest[0] || '';
  if (gu === '동탄구') return dong;                 // 지역 이름이 이미 「동탄」이라 구를 또 붙이지 않음
  return gu && /구$/.test(gu) && p[1] !== gu ? `${gu} ${dong}`.trim() : dong;
}
export const TYPE_NAMES = { '01': '아파트', '02': '주상복합', '04': '오피스텔' };
const H = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36', Referer: 'https://kbland.kr/', Accept: 'application/json' };
const log = msg => console.log(`[${new Date().toLocaleTimeString('ko-KR', { hour12: false })}] ${msg}`);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const num = v => { const n = Number(v); return v != null && v !== '' && Number.isFinite(n) && n > 0 ? n : null; };
// 0과 「모름」을 구분해야 하는 값에 씁니다 — num() 은 0을 null 로 바꿔 버려서
// 임대가 없는 단지(0)와 값을 못 받은 단지(null)가 뒤섞입니다. 임대 조건이 거꾸로 걸리게 됩니다.
const num0 = v => { const n = Number(v); return v != null && v !== '' && Number.isFinite(n) && n >= 0 ? n : null; };

const coord = v => { const n = num(v); return n == null ? null : Math.round(n * 1e6) / 1e6; };

/** 'YYYY.MM.DD' → 'YYYYMMDD'(8자리). 형식이 다르면 null */
export function ymd8(v) {
  const m = String(v || '').match(/(\d{4})\D?(\d{2})\D?(\d{2})/);
  return m ? m[1] + m[2] + m[3] : null;
}

/** 단지 상세 → { type: '01'|'02'|…, far: 용적률(%), bcr: 건폐율(%), lat·lng(wgs84), maxFloor: 최고층수, hall: 현관구조, approved: 사용승인일(YYYYMMDD) } */
export function parseComplexMain(d) {
  if (!d || typeof d !== 'object') return null;
  return {
    type: d.매물종별구분 ? String(d.매물종별구분) : null, far: num(d.용적률내용), bcr: num(d.건폐율내용),
    lat: coord(d.wgs84위도), lng: coord(d.wgs84경도), maxFloor: num(d.최고층수) || num(d.건물최고층수), hall: d.현관구조 ? String(d.현관구조) : null,
    approved: ymd8(d.준공년월일) || (d.준공년 && d.준공월 ? ymd8(`${d.준공년}.${d.준공월}.01`) : null),
    // 임대세대 — 임대 비율이 높은 단지는 거래가 적고 시세가 잘 오르지 않아 투자 관점에서 따로 가려낼 수 있게 받아 둡니다.
    // (예: 강동리엔파크14단지 943세대 중 임대 532세대 = 56%. 고덕그라시움은 4,932 중 140 = 3%)
    // 총세대수는 KB 기준이라 주택형별 세대수 합계와 다를 수 있습니다 — 비율은 같은 출처끼리만 견줍니다.
    households: num(d.총세대수), rentUnits: num0(d.임대세대수),
  };
}

async function kbMain(id) {
  let last;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(`https://api.kbland.kr/land-complex/complex/main?${new URLSearchParams({ 단지기본일련번호: id })}`, { headers: H, signal: AbortSignal.timeout(20000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const info = parseComplexMain((await r.json())?.dataBody?.data);
      if (!info) throw new Error('형식');
      return info;
    } catch (e) { last = e; await sleep(1500 * (i + 1)); }
  }
  throw last;
}

async function pool(items, n, fn, onProgress) {
  let next = 0, done = 0;
  const out = new Array(items.length);
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const k = next++;
      try { out[k] = await fn(items[k]); } catch { out[k] = null; }
      onProgress(++done);
    }
  }));
  return out;
}

export async function main(regionKey = 'seoul') {
  const region = REGIONS[regionKey];
  if (!region) throw new Error('모르는 지역: ' + regionKey);
  const t0 = Date.now();
  const res = await fetch('https://api.kbland.kr/land-price/price/fastPriceComplexName?' + new URLSearchParams({ 단지명: '' }), { headers: H });
  if (!res.ok) throw new Error('KB 단지 목록 HTTP ' + res.status);
  const all = (await res.json())?.dataBody?.data;
  if (!Array.isArray(all) || all.length < 1000) throw new Error('KB 단지 목록 형식이 예상과 다릅니다(엔드포인트 변경 가능성)');

  const seoul = [];
  let officeByPrefix = 0;
  for (const d of all) {
    const gu = region.codes[String(d.법정동코드 || '').slice(0, 5)];
    if (!gu || !d.단지기본일련번호 || !d.단지명) continue;
    if (String(d.시세물건식별자 || '').startsWith('KBO')) { officeByPrefix++; continue; }   // 오피스텔
    seoul.push({ id: d.단지기본일련번호, name: d.단지명, gu, dong: dongOf(d.주소, regionKey), under50: d['50세대미만여부'] === '1' ? 1 : 0 });
  }
  log(`${region.label} 단지 ${seoul.length + officeByPrefix}개 중 오피스텔(KBO) ${officeByPrefix}개 제외 → 단지 상세 ${seoul.length}건 조회`);

  // KB는 요청이 몰리면 일시 거부 — 동시 3건 + 짧은 간격 + 건별 재시도, 실패분은 잠시 쉰 뒤 한 건씩 다시
  const fetchOne = async c => { await sleep(40); return kbMain(c.id); };
  const infos = await pool(seoul, 3, fetchOne, done => { if (done % 500 === 0 || done === seoul.length) log(`  ${done}/${seoul.length}`); });
  const miss = infos.map((v, i) => (v ? -1 : i)).filter(i => i >= 0);
  if (miss.length) {
    log(`  1차 실패 ${miss.length}건 — 10초 뒤 한 건씩 재조회`);
    await sleep(10000);
    const retry = await pool(miss.map(i => seoul[i]), 1, async c => { await sleep(250); return kbMain(c.id); }, () => {});
    miss.forEach((idx, j) => { if (retry[j]) infos[idx] = retry[j]; });
  }
  const failed = infos.filter(v => !v).length;
  if (failed > seoul.length * 0.1) throw new Error(`단지 상세 조회 실패가 너무 많습니다(${failed}건) — 기존 파일을 그대로 둡니다`);

  const excluded = {};
  const complexes = [];
  seoul.forEach((c, i) => {
    const info = infos[i];
    // 상세를 못 받은 단지는 유형을 알 수 없어 남기되(목록상 KBA = 아파트·주상복합) 용적률은 비움
    if (info && info.type !== '01') { const k = TYPE_NAMES[info.type] || `기타(${info.type})`; excluded[k] = (excluded[k] || 0) + 1; return; }
    // [단지기본일련번호, 단지명, 자치구, 법정동, 50세대 미만 여부(1/0), 용적률(%), 건폐율(%), 위도, 경도, 최고층수, 현관구조, 사용승인일(YYYYMMDD), 총세대수, 임대세대수]
    complexes.push([c.id, c.name, c.gu, c.dong, c.under50,
      ...(info ? [info.far, info.bcr, info.lat, info.lng, info.maxFloor, info.hall, info.approved, info.households, info.rentUnits]
               : [null, null, null, null, null, null, null, null, null])]);
  });
  const rank = g => { const i = region.order.indexOf(g); return i < 0 ? 999 : i; };
  complexes.sort((a, b) => rank(a[2]) - rank(b[2]) || a[1].localeCompare(b[1], 'ko'));

  const out = {
    generatedAt: new Date().toISOString(),
    region: regionKey, regionLabel: region.label, areas: region.order,
    source: 'KB부동산(kbland.kr) 단지 목록·단지 상세 — 비공식 엔드포인트. 아파트(매물종별 01)만, 오피스텔·주상복합 제외',
    fields: ['id', 'name', 'gu', 'dong', 'under50', 'far', 'bcr', 'lat', 'lng', 'maxFloor', 'hall', 'approved', 'households', 'rentUnits'],
    excluded: { 오피스텔: officeByPrefix + (excluded.오피스텔 || 0), ...Object.fromEntries(Object.entries(excluded).filter(([k]) => k !== '오피스텔')) },
    detailFailed: failed,
    count: complexes.length,
    complexes,
  };
  const dest = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'site', 'public', region.file);
  fs.writeFileSync(dest, JSON.stringify(out));
  const byGu = {};
  complexes.forEach(c => { byGu[c[2]] = (byGu[c[2]] || 0) + 1; });
  const withFar = complexes.filter(c => c[5] != null).length;
  const withApproved = complexes.filter(c => c[11] != null).length;
  const withHouseholds = complexes.filter(c => c[12] > 0).length;
  const withRent = complexes.filter(c => c[13] > 0).length;
  log(`${region.label} 아파트 ${complexes.length}개 → ${path.relative(process.cwd(), dest)} (${(fs.statSync(dest).size / 1024).toFixed(0)}KB) · 제외 ${JSON.stringify(out.excluded)} · 용적률 있음 ${withFar} · 사용승인일 있음 ${withApproved} · 총세대수 있음 ${withHouseholds} · 임대세대 있음 ${withRent} · 상세 실패 ${failed} · ${Math.round((Date.now() - t0) / 1000)}초`);
  log(Object.entries(byGu).map(([g, n]) => `${g} ${n}`).join(' · '));
  return out;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (invokedDirectly) {
  const arg = process.argv.slice(2).find(a => !a.startsWith('-')) || 'seoul';
  main(arg).catch(e => { console.error('[KB 단지 목록] 실패:', e); process.exit(1); });
}
