// 입지 파일(site/public/kapt-<지역>-infra.json) — KB 꿀세권(kb-*-infra.json)·KB 주차(kb-*-parking.json) 대체본
//   npm run kapt:infra             서울·경기 둘 다 (네트워크 호출 없음 — 이미 받아 둔 K-apt 파일만 읽습니다)
//
// 왜 만드나 — 2026-11-24 발견: KB 입지·주차 파일 1.5MB 가 아직 공개 배포 중이었습니다.
// 우리 이용허락 대장(data/source-policy.json)의 KB 항목은 cache:false·redistribute:false 입니다.
// 같은 지표를 **국토교통부 K-apt(이용허락범위 제한 없음, 데이터셋 15058453)** 신고값으로 다시 만듭니다.
//
// 바뀌는 것 — KB 는 직선거리(m)를 주고, K-apt 는 **도보시간 구간**을 줍니다.
//   · 구간은 5분이내 / 5~10분이내 / 10~15분이내 / 15~20분이내 / 20분초과 다섯 가지뿐입니다.
//   · 분 단위 정밀도가 없어졌습니다. 대신 **실제 걷는 시간**이고 **공식 신고값**입니다
//     (직선거리는 길을 따라 걷는 거리가 아니라 지도 위 직선이라, 더 정밀해 보이지만 더 정확하지는 않습니다).
//   · 그래서 이 파일은 거리(m)를 **만들어 내지 않습니다.** 구간을 분 단위로 환산해 적는 것도 하지 않습니다 —
//     있지도 않은 정밀도를 꾸미는 일이기 때문입니다. 점수는 jinga-reco.mjs 가 구간 자체로 냅니다.
//
// 학교 — K-apt 교육시설 신고값에서 **배정 초등·중학교 이름**을 뽑습니다. 거리는 없습니다.
//   이름 표기가 제각각입니다(「신구초등교」·「청담초등학교」·「한신」·「도봉여중」). 학교알리미 좌표와
//   맞추려고 어미를 떼어 비교용 키(stem)를 함께 넣습니다. 좌표는 scripts/build-school-coords.mjs 가 맡습니다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUB = path.join(ROOT, 'site', 'public');

export const SOURCE = '국토교통부 공동주택 기본·상세 정보(K-apt, 공공데이터포털 15058453) — 이용허락범위 제한 없음';
export const BASIS = 'kapt-walk-band';
/** K-apt 가 쓰는 도보시간 구간 — 순서가 점수입니다(0 이 가장 가까움) */
export const BANDS = ['5분이내', '5~10분이내', '10~15분이내', '15~20분이내', '20분초과'];
export const REGIONS = {
  seoul: { label: '서울', src: 'kapt-seoul.json', out: 'kapt-seoul-infra.json', min: 900 },
  gyeonggi: { label: '경기', src: 'kapt-gyeonggi.json', out: 'kapt-gyeonggi-infra.json', min: 700 },
};

const num = v => { const n = Number(v); return v != null && v !== '' && Number.isFinite(n) ? n : null; };

/** 도보시간 구간 문자열 → 0~4, 모르면 null. K-apt 표기가 조금씩 달라 공백·물결을 맞춰 봅니다 */
export function bandIndex(s) {
  const t = String(s || '').replace(/\s/g, '').replace(/[〜～~]/g, '~');
  if (!t) return null;
  const i = BANDS.indexOf(t);
  if (i >= 0) return i;
  if (/^5분/.test(t)) return 0;
  if (/^5~10/.test(t)) return 1;
  if (/^10~15/.test(t)) return 2;
  if (/^15~20/.test(t)) return 3;
  if (/20분(초과|이상)/.test(t)) return 4;
  return null;
}

/**
 * 학교 이름 비교용 키 — 「서울」 접두어와 학교 종류 어미를 떼어 냅니다.
 * 「신구초등교」·「신구초등학교」·「신구초」 가 같은 학교로 맞물리게 하려는 것이고,
 * 「도봉여중」·「도봉여자중학교」 처럼 여자/여 표기가 섞이는 것도 함께 맞춥니다.
 */
export function schoolStem(name) {
  let t = String(name || '').trim();
  if (!t) return '';
  t = t.replace(/\s/g, '').replace(/^서울/, '');
  t = t.replace(/(여자|여)?(초등학교|초등교|초교|초)$/, (m, g) => (g ? '여' : ''));
  t = t.replace(/(여자|여)?(중학교|중등교|중교|중)$/, (m, g) => (g ? '여' : ''));
  return t;
}

/**
 * 비교용 키 후보 — 앞이 정확한 것, 뒤가 느슨한 것입니다.
 * K-apt 가 「숙명」이라고만 적은 곳의 실제 학교는 「숙명여자중학교」(stem 「숙명여」)입니다.
 * 성별 표기를 뗀 키를 **보조 키로만** 함께 두어, 정확한 키가 안 맞을 때만 쓰게 합니다.
 */
export function schoolStemKeys(name) {
  const s = schoolStem(name);
  if (!s) return [];
  const loose = s.replace(/여$/, '');
  return loose && loose !== s ? [s, loose] : [s];
}

/**
 * K-apt 교육시설 문자열 → { elem: [이름…], mid: [이름…] }
 * 「초등학교(한신, 숭미) 중학교(도봉여중) 고등학교(정의) 대학교(덕성여대)」 꼴입니다.
 * 괄호가 비어 있는 「초등학교()」 는 **모른다**로 봅니다(없다가 아닙니다 — 배정 학교 없는 단지는 없습니다).
 */
export function parseEducation(s) {
  const out = { elem: [], mid: [] };
  const text = String(s || '');
  // 괄호가 닫히지 않은 신고값이 있습니다 — 「초등학교(오남초교(031-575-3987」 처럼 전화번호가 섞입니다.
  // 그래서 닫는 괄호가 없으면 다음 학교 종류 표기나 줄 끝까지를 내용으로 봅니다.
  const pick = key => {
    const m = text.match(new RegExp(key + '\\(([^)]*)\\)')) ||
      text.match(new RegExp(key + '\\(([^)]*?)(?=(초등학교|중학교|고등학교|대학교)\\(|$)'));
    if (!m) return [];
    return m[1]
      .split(/[,·/\s]+/)                                   // 쉼표·가운뎃점·빗금뿐 아니라 공백으로도 나눠 적습니다
      .map(x => x.trim().replace(/[()]/g, ''))
      .filter(x => x && x !== '등' && !/\d/.test(x) && x.length >= 2)   // 「등」·전화번호 조각은 학교가 아닙니다
      .filter((x, i, a) => a.indexOf(x) === i);
  };
  out.elem = pick('초등학교');
  out.mid = pick('중학교');
  return out;
}

/** 주차 — 지상+지하 신고값. 둘 다 모르면 null(0 과 구분합니다) */
export function parkingOf(v) {
  const g = num(v.parkGround), u = num(v.parkUnder);
  if (g == null && u == null) return { total: null, per: null };
  const total = (g || 0) + (u || 0);
  const hh = num(v.households);
  return { total, per: hh > 0 ? Math.round((total / hh) * 100) / 100 : null };
}

export function buildRegion(region) {
  const cfg = REGIONS[region];
  if (!cfg) throw new Error(`모르는 지역: ${region}`);
  const src = JSON.parse(fs.readFileSync(path.join(PUB, cfg.src), 'utf8'));
  const byComplex = {};
  const cov = { subwayWalk: 0, subwayStation: 0, subwayLine: 0, busWalk: 0, elem: 0, mid: 0, parking: 0, parkingPer: 0 };
  let n = 0;

  for (const [id, v] of Object.entries(src.byComplex || {})) {
    n += 1;
    const sw = bandIndex(v.subwayWalk), bw = bandIndex(v.busWalk);
    const edu = parseEducation(v.education);
    const pk = parkingOf(v);
    const st = String(v.subwayStation || '').trim().replace(/역$/, '');
    const lines = String(v.subwayLine || '').split(/[,·]/).map(x => x.trim()).filter(Boolean);

    const row = {};
    if (sw != null) { row.sw = sw; cov.subwayWalk += 1; }
    if (bw != null) { row.bw = bw; cov.busWalk += 1; }
    if (st) { row.st = st; cov.subwayStation += 1; }
    if (lines.length) { row.lines = lines; cov.subwayLine += 1; }
    if (edu.elem.length) { row.el = edu.elem; row.elStem = edu.elem.map(schoolStem); cov.elem += 1; }
    if (edu.mid.length) { row.mid = edu.mid; row.midStem = edu.mid.map(schoolStem); cov.mid += 1; }
    if (pk.total != null) { row.pk = pk.total; cov.parking += 1; }
    if (pk.per != null) { row.pkPer = pk.per; cov.parkingPer += 1; }
    byComplex[id] = row;
  }

  const pct = k => (n ? Math.round((cov[k] / n) * 1000) / 10 : 0);
  const coverage = {};
  for (const k of Object.keys(cov)) coverage[k] = { n: cov[k], pct: pct(k) };

  return {
    generatedAt: new Date().toISOString(),
    region, regionLabel: cfg.label,
    source: SOURCE,
    srcGeneratedAt: src.generatedAt || null,
    basis: BASIS,
    bands: BANDS,
    note: '지하철·버스는 K-apt 신고 도보시간 구간입니다. 직선거리(m)가 아니라 걸어서 걸리는 시간이며, 구간값이라 분 단위 정밀도는 없습니다. 거리(m)로 환산하지 않습니다. 배정 초등·중학교는 K-apt 교육시설 신고 이름이고 거리는 들어 있지 않습니다(좌표는 school-<지역>.json).',
    count: n,
    coverage,
    byComplex,
  };
}

export function writeRegion(region) {
  const cfg = REGIONS[region];
  const data = buildRegion(region);
  if (data.count < cfg.min) throw new Error(`${cfg.label} 단지가 ${data.count}곳뿐입니다(최소 ${cfg.min}) — ${cfg.src} 를 먼저 만드세요`);
  const out = path.join(PUB, cfg.out);
  fs.writeFileSync(out, JSON.stringify(data));
  return { out, data };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const only = process.argv.slice(2).filter(a => !a.startsWith('-'));
  const list = only.length ? only : Object.keys(REGIONS);
  for (const region of list) {
    const { out, data } = writeRegion(region);
    const c = data.coverage;
    console.log(`${data.regionLabel} ${data.count.toLocaleString('ko-KR')}곳 → ${path.basename(out)} (${(fs.statSync(out).size / 1024).toFixed(0)}KB)`);
    console.log(`  지하철 도보구간 ${c.subwayWalk.pct}% · 역명 ${c.subwayStation.pct}% · 버스 도보구간 ${c.busWalk.pct}%`);
    console.log(`  배정 초등 ${c.elem.pct}% · 배정 중학 ${c.mid.pct}% · 주차 ${c.parking.pct}% · 세대당 주차 ${c.parkingPer.pct}%`);
  }
}
