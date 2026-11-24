// 학교 좌표 파일(site/public/school-<지역>.json) — KB 꿀세권의 학교 좌표(kb-*-infra.json) 대체본
//   npm run schools            서울·경기 둘 다 (약 2분 — 시군구마다 한 번씩 조회합니다)
//   npm run schools seoul      서울만
//
// 출처: 교육부 학교알리미 Open API(www.schoolinfo.go.kr/openApi.do, apiType=0 학교 기본정보).
//   공시 정보를 공개 API 로 내려주며 좌표(LTTUD·LGTUD)·도로명주소·학교종류코드가 함께 옵니다.
//   키는 .secrets/schoolinfo.json(깃 제외)에 있고 화면·파일 어디에도 찍지 않습니다.
//
// ■ 결과물을 **배포하지 않습니다** — data/work/ 에만 씁니다(2026-11-24 이용허락 확인 결과)
//   학교알리미 공시정보 OpenAPI 는 공공데이터포털(15098092, 제공 한국교육학술정보원) 기준
//   **공공누리 제3유형 = 출처표시 + 변경금지** 입니다. 받은 자료를 [이름, 위도, 경도] 꼴로 다시 엮어
//   공개 배포하는 것은 「변경금지」와 부딪칠 수 있습니다. KB 때와 **같은 종류의 실수**이므로,
//   확인되기 전에는 공개 폴더에 두지 않습니다(data/work/ 는 .gitignore 에도 들어 있습니다).
//
//   배포까지 가려면 둘 중 하나입니다 —
//     ① 교육부 「학교알리미 학교기본정보」 파일데이터(공공데이터포털 15106331, **공공누리 제1유형**,
//        제공 교육부)로 바꿔 받기. 제1유형은 출처표시만 요구해 가공·재배포·상업적 이용이 열려 있습니다.
//        학교좌표가 포함된다고 적혀 있습니다. 파일(CSV) 제공이라 사람이 한 번 내려받아야 합니다.
//     ② KERIS 에 제3유형 가공·공개 가능 여부를 문의(legal/questions-to-counsel.md 에 함께 묶기).
//   그래서 이 스크립트의 결과는 **지금은 확인·계산용**이고, 화면에 나가는 배정 학교 이름은
//   K-apt 신고값(이용허락 제한 없음)을 그대로 씁니다.
//
// 왜 — KB 꿀세권에서 받던 초·중학교 좌표를 더는 쓰지 않습니다(2026-11-24 이용허락 검토).
//   KB 가 함께 주던 **통학구역 경계(GeoJSON)** 는 이 API 에 없습니다. 그래서 「단지가 통학구역 안에
//   드는가」는 더 이상 우리가 계산하지 않고, **K-apt 가 신고한 배정 학교 이름**을 그대로 믿습니다
//   (kapt-<지역>-infra.json 의 el·mid). 추정을 공식 신고값으로 바꾼 것이라 오히려 근거가 셉니다.
//
// 이름 맞추기 — K-apt 는 「신구초등교」·「한신」처럼 줄여 적고 학교알리미는 「서울신구초등학교」로 적습니다.
//   build-kapt-infra.mjs 의 schoolStem() 과 **같은 규칙**으로 키를 만들어 stem 색인을 함께 싣습니다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { schoolStem, schoolStemKeys } from './build-kapt-infra.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// 공개 폴더가 아닙니다 — 위 「결과물을 배포하지 않습니다」 참고
const OUT_DIR = path.join(ROOT, 'data', 'work');
const SECRET = path.join(ROOT, '.secrets', 'schoolinfo.json');

export const SOURCE = '교육부 학교알리미 학교 기본정보(schoolinfo.go.kr Open API, apiType=0) — 공시 정보 공개 API';
/** 학교알리미 학교종류코드 */
export const KIND = { elem: '02', mid: '03' };

// 학교알리미는 시군구 코드를 반드시 받습니다(시 단위 코드는 거부 — 성남시 41130 은 fail, 수정구 41131 은 성공).
export const SGG = {
  seoul: {
    sido: '11',
    list: [['종로구', '11110'], ['중구', '11140'], ['용산구', '11170'], ['성동구', '11200'], ['광진구', '11215'],
      ['동대문구', '11230'], ['중랑구', '11260'], ['성북구', '11290'], ['강북구', '11305'], ['도봉구', '11320'],
      ['노원구', '11350'], ['은평구', '11380'], ['서대문구', '11410'], ['마포구', '11440'], ['양천구', '11470'],
      ['강서구', '11500'], ['구로구', '11530'], ['금천구', '11545'], ['영등포구', '11560'], ['동작구', '11590'],
      ['관악구', '11620'], ['서초구', '11650'], ['강남구', '11680'], ['송파구', '11710'], ['강동구', '11740']],
  },
  gyeonggi: {
    sido: '41',
    // 사이트가 다루는 경기 8곳 — 구가 있는 시는 구마다 따로 조회해야 합니다
    list: [['수원 장안구', '41111'], ['수원 권선구', '41113'], ['수원 팔달구', '41115'], ['수원 영통구', '41117'],
      ['성남 수정구', '41131'], ['성남 중원구', '41133'], ['성남 분당구', '41135'],
      ['안양 만안구', '41171'], ['안양 동안구', '41173'],
      ['용인 처인구', '41461'], ['용인 기흥구', '41463'], ['용인 수지구', '41465'],
      ['구리시', '41310'], ['남양주시', '41360'], ['하남시', '41450'], ['화성시', '41590']],
  },
};
export const REGIONS = {
  seoul: { label: '서울', out: 'school-seoul.json', min: { elem: 400, mid: 200 } },
  gyeonggi: { label: '경기', out: 'school-gyeonggi.json', min: { elem: 200, mid: 100 } },
};

const sleep = ms => new Promise(r => setTimeout(r, ms));
const num = v => { const n = Number(v); return v != null && v !== '' && Number.isFinite(n) ? n : null; };

function apiKey() {
  if (!fs.existsSync(SECRET)) throw new Error('.secrets/schoolinfo.json 이 없습니다 — .\\scripts\\schoolinfo-key.cmd 로 키를 먼저 넣으세요');
  const k = JSON.parse(fs.readFileSync(SECRET, 'utf8')).apiKey;
  if (!k) throw new Error('.secrets/schoolinfo.json 에 apiKey 가 비어 있습니다');
  return k;
}

async function fetchSgg(key, sido, sgg, kind) {
  const url = `https://www.schoolinfo.go.kr/openApi.do?${new URLSearchParams({ apiKey: key, apiType: '0', sidoCode: sido, sggCode: sgg, schulKndCode: kind })}`;
  let last;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      if (j.resultCode !== 'success') throw new Error(`응답 ${j.resultCode}: ${j.resultMsg || ''}`);
      return Array.isArray(j.list) ? j.list : [];
    } catch (e) { last = e; await sleep(900 * (i + 1)); }
  }
  throw last;
}

/** 응답 한 건 → [이름, 위도, 경도, stem] · 좌표가 없거나 폐교면 버립니다 */
export function toRow(s) {
  const name = String(s.SCHUL_NM || '').trim();
  const lat = num(s.LTTUD), lng = num(s.LGTUD);
  if (!name || lat == null || lng == null) return null;
  if (String(s.CLOSE_YN || '').toUpperCase() === 'Y') return null;
  // 서울 37.4~37.72 · 경기 36.9~38.0 바깥 좌표는 잘못 들어온 값으로 보고 버립니다
  if (lat < 36.8 || lat > 38.3 || lng < 126.4 || lng > 127.8) return null;
  return [name, Math.round(lat * 1e6) / 1e6, Math.round(lng * 1e6) / 1e6, schoolStem(name)];
}

/** 같은 학교가 두 번(구 경계 겹침) 오면 하나만 남깁니다 */
export function dedupe(rows) {
  const by = new Map();
  for (const r of rows) if (r && !by.has(r[0])) by.set(r[0], r);
  return [...by.values()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
}

/**
 * stem → 행 번호 색인. 같은 stem 이 여럿이면(「한신초」가 여러 구에) 전부 담아 둡니다.
 * 정확한 키를 먼저 전부 넣고, 성별 표기를 뗀 느슨한 키는 **그 자리가 비어 있을 때만** 넣습니다
 * (K-apt 가 「숙명」이라고만 적은 곳을 「숙명여자중학교」로 찾아 주되, 「숙명중학교」가 따로 있으면 그쪽이 이깁니다).
 */
export function stemIndex(rows) {
  const out = {};
  rows.forEach((r, i) => { const s = r[3]; if (!s) return; (out[s] = out[s] || []).push(i); });
  rows.forEach((r, i) => {
    for (const k of schoolStemKeys(r[0]).slice(1)) if (!out[k]) out[k] = [i];
  });
  return out;
}

export async function buildRegion(region, { log = () => {} } = {}) {
  const cfg = REGIONS[region], scope = SGG[region];
  if (!cfg || !scope) throw new Error(`모르는 지역: ${region}`);
  const key = apiKey();
  const got = { elem: [], mid: [] };
  const failed = [];
  for (const [label, sgg] of scope.list) {
    for (const [k, code] of Object.entries(KIND)) {
      try {
        const list = await fetchSgg(key, scope.sido, sgg, code);
        got[k].push(...list.map(toRow));
        log(`  ${label} ${k === 'elem' ? '초등' : '중학'} ${list.length}곳`);
      } catch (e) { failed.push(`${label}/${k}: ${e.message}`); }
      await sleep(250);
    }
  }
  const elems = dedupe(got.elem), mids = dedupe(got.mid);
  return {
    generatedAt: new Date().toISOString(),
    region, regionLabel: cfg.label,
    source: SOURCE,
    license: '공공누리 제3유형(출처표시·변경금지)으로 표기됨 — 공공데이터포털 15098092. **가공물 공개 배포 전 확인 필요**',
    publish: false,
    note: '학교알리미 학교 기본정보의 좌표입니다. 이용허락(제3유형 변경금지)이 확인되기 전까지 배포하지 않습니다. 통학구역 경계는 이 자료에 없어 「통학구역 안」 판정은 하지 않습니다 — 배정 학교는 K-apt 신고값(kapt-<지역>-infra.json)을 따릅니다.',
    fields: ['name', 'lat', 'lng', 'stem'],
    counts: { elems: elems.length, mids: mids.length },
    failed,
    elems, mids,
    elemStems: stemIndex(elems), midStems: stemIndex(mids),
  };
}

export async function writeRegion(region, opts) {
  const cfg = REGIONS[region];
  const data = await buildRegion(region, opts);
  if (data.elems.length < cfg.min.elem) throw new Error(`${cfg.label} 초등학교가 ${data.elems.length}곳뿐입니다(최소 ${cfg.min.elem}) — 조회가 막혔는지 보세요: ${data.failed.join(' / ')}`);
  if (data.mids.length < cfg.min.mid) throw new Error(`${cfg.label} 중학교가 ${data.mids.length}곳뿐입니다(최소 ${cfg.min.mid})`);
  const out = path.join(OUT_DIR, cfg.out);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(out, JSON.stringify(data));
  return { out, data };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const only = process.argv.slice(2).filter(a => !a.startsWith('-'));
  const list = only.length ? only : Object.keys(REGIONS);
  const verbose = process.argv.includes('--verbose');
  (async () => {
    for (const region of list) {
      const { out, data } = await writeRegion(region, { log: verbose ? console.log : () => {} });
      console.log(`${data.regionLabel} 초등 ${data.elems.length.toLocaleString('ko-KR')}곳 · 중학 ${data.mids.length.toLocaleString('ko-KR')}곳 → ${path.basename(out)} (${(fs.statSync(out).size / 1024).toFixed(0)}KB)`);
      if (data.failed.length) console.log(`  조회 실패 ${data.failed.length}건: ${data.failed.slice(0, 5).join(' / ')}`);
    }
  })().catch(e => { console.error(`실패: ${e.message}`); process.exit(1); });
}
