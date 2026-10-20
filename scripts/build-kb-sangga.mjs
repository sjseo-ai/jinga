// 역까지 가는 길의 상가 — site/public/sangga-<지역>.json
//   npm run kb:sangga            서울
//   npm run kb:sangga:gyeonggi   경기
//   (먼저 scripts\sangga-key.cmd 로 공공데이터포털 인증키를 넣어 두세요)
//
// 무엇을 재나 — 단지에서 가장 가까운 역까지 가는 길을 **모두 덮는 원**(가운데 기준 반경 = 거리÷2+150m) 안의 점포를 세어
//   · n        원 안 점포 수
//   · dens     ㎢당 점포 수 — 원 크기가 단지마다 달라 **넓이로 나눠야** 견줄 수 있습니다(이 값으로 점수)
//   · mix      업종 대분류 비율(음식·소매·교육·의료·생활·여가 …)
//   · top      가장 많은 업종 중분류 3개
// 반경을 250m 로 고정해 봤더니 원이 단지 안쪽에 들어가면 값이 급변했습니다(은마 250m 31곳 → 300m 196곳).
// 길 전체를 덮고 넓이로 나누는 편이 훨씬 안정적이라 이 방식으로 했습니다.
// 호출은 **단지당 1회**(첫 쪽 1,000곳) — 점포 수는 totalCount 를 쓰고, 업종 구성은 받은 1,000곳으로 셈합니다.
// 원천: 소상공인시장진흥공단 상가(상권)정보(공공데이터포털) — 분기마다 갱신되는 실제 점포 목록입니다.
//
// 한계 — 직선 경로 둘레라 실제 걷는 길과 다를 수 있고, 점포 수·업종은 「상권이 있는지」를 보여 줄 뿐
//        간판·보도·건물 상태 같은 「정비 상태」를 재는 값이 아닙니다. 화면에도 그렇게 적습니다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadKey, radiusUrl } from './sangga-key.mjs';

const GAP_MS = 120;                 // 개발계정 한도(보통 일 10,000회)를 생각해 부드럽게
const MAX_ROWS = 1000;
export const PAD_M = 150;           // 길 양 끝을 덮으려고 더하는 여유
export const REGIONS = {
  seoul: { label: '서울', infra: 'kb-seoul-infra.json', dir: 'kb-seoul-complexes.json', out: 'sangga-seoul.json' },
  gyeonggi: { label: '경기', infra: 'kb-gyeonggi-infra.json', dir: 'kb-gyeonggi-complexes.json', out: 'sangga-gyeonggi.json' },
};
// 소상공인 업종 대분류(실제 값 10종) → 화면에 쓰는 짧은 이름
export const CATEGORIES = {
  음식: '음식', 소매: '소매', 교육: '교육', 보건의료: '의료', '수리·개인': '생활',
  '예술·스포츠': '여가', '과학·기술': '전문', 부동산: '부동산', 숙박: '숙박', '시설관리·임대': '시설',
};
export const shortCat = name => {
  const k = String(name || '').trim();
  return CATEGORIES[k] || (k ? '기타' : null);
};

const log = msg => console.log(`[${new Date().toLocaleTimeString('ko-KR', { hour12: false })}] ${msg}`);
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** 길 가운데와, 길 전체를 덮는 반경(거리÷2 + 여유) */
export function corridor(aLat, aLng, bLat, bLng, distM) {
  return {
    lat: (aLat + bLat) / 2, lng: (aLng + bLng) / 2,
    radius: Math.min(1000, Math.max(150, Math.round((Number(distM) || 0) / 2 + PAD_M))),
  };
}
/** 원 넓이(㎢) */
export const areaKm2 = radius => Math.PI * (radius / 1000) ** 2;

/**
 * 상가 목록 → { n, dens, mix, top }
 * total: 원 안 전체 점포 수(totalCount) · items: 받은 목록(첫 쪽 1,000곳까지) — 업종 구성은 이 표본으로 셈합니다.
 */
export function summarize(items, { radius = 300, total = null } = {}) {
  const rows = (items || []).filter(x => x && (x.indsLclsNm || x.indsMclsNm));
  const n = Number.isFinite(Number(total)) ? Number(total) : rows.length;
  const dens = Math.round(n / areaKm2(radius));
  if (!rows.length) return { n, dens, mix: {}, top: [] };
  const byL = {}, byM = {};
  for (const r of rows) {
    const c = shortCat(r.indsLclsNm);
    if (c) byL[c] = (byL[c] || 0) + 1;
    const m = String(r.indsMclsNm || '').trim();
    if (m) byM[m] = (byM[m] || 0) + 1;
  }
  const mix = {};
  Object.entries(byL).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => { mix[k] = Math.round((v / rows.length) * 1000) / 10; });
  const top = Object.entries(byM).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => [k, v]);
  return { n, dens, mix, top };
}

/** 한 줄 설명 — '길 상권 238곳(㎢당 679곳) · 소매 29%·음식 23%' */
export function sanggaText(s) {
  if (!s || !s.n) return '';
  const mix = Object.entries(s.mix || {}).slice(0, 2).map(([k, v]) => `${k} ${v}%`).join('·');
  return `길 상권 ${s.n.toLocaleString('ko-KR')}곳(㎢당 ${s.dens.toLocaleString('ko-KR')}곳)${mix ? ' · ' + mix : ''}`;
}

/** 첫 쪽만 받아 옵니다 — 단지 1곳당 정확히 1회 호출(한도를 아끼려고) */
async function fetchStores(key, spot, fetchImpl) {
  let j = null;
  for (let t = 0; t < 3; t++) {
    try {
      const r = await fetchImpl(radiusUrl(key, { ...spot, page: 1, rows: MAX_ROWS }), { signal: AbortSignal.timeout(30000) });
      const text = await r.text();
      if (/LIMITED_NUMBER_OF_SERVICE_REQUESTS/.test(text)) throw Object.assign(new Error('오늘 호출 한도를 다 썼습니다'), { fatal: true });
      j = JSON.parse(text);
      break;
    } catch (e) { if (e.fatal) throw e; if (t === 2) throw e; await sleep(1500 * (t + 1)); }
  }
  const body = (j && j.body) || {};
  return { items: body.items || [], total: Number(body.totalCount) || (body.items || []).length };
}

export async function main(regionKey = 'seoul', { fetchImpl = (...a) => fetch(...a), all = false, limit = 0 } = {}) {
  const region = REGIONS[regionKey];
  if (!region) throw new Error('모르는 지역: ' + regionKey);
  const key = loadKey();
  if (!key) throw new Error('인증키가 없습니다 — scripts\\sangga-key.cmd 를 먼저 실행하세요');
  const t0 = Date.now();
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'site', 'public');
  const infra = JSON.parse(fs.readFileSync(path.join(root, region.infra), 'utf8'));
  const dir = JSON.parse(fs.readFileSync(path.join(root, region.dir), 'utf8'));
  const dest = path.join(root, region.out);
  const prev = !all && fs.existsSync(dest) ? JSON.parse(fs.readFileSync(dest, 'utf8')) : null;
  const byId = (prev && prev.byId) || {};

  const jobs = [];
  for (const c of dir.complexes) {
    const id = c[0], lat = c[7], lng = c[8];
    const v = infra.byId && infra.byId[id];
    if (lat == null || lng == null || !v) continue;
    const [st, stM] = v;
    const s = infra.stations[st];
    if (!s || !(stM > 0)) continue;
    if (byId[id] && !all) continue;
    jobs.push({ id, ...corridor(lat, lng, s[2], s[3], stM) });
  }
  const todo = limit ? jobs.slice(0, limit) : jobs;
  log(`${region.label} — 상가를 셀 단지 ${todo.length}곳(이미 있는 ${Object.keys(byId).length}곳은 건너뜀) · 단지당 1회 호출`);
  if (!todo.length) { log('새로 셀 단지가 없습니다'); return prev; }

  let done = 0, failed = 0;
  for (const j of todo) {
    try {
      const { items, total } = await fetchStores(key, { lat: j.lat, lng: j.lng, radius: j.radius }, fetchImpl);
      const s = summarize(items, { radius: j.radius, total });
      byId[j.id] = [s.n, s.dens, s.mix, s.top];
    } catch (e) {
      if (e.fatal) { log(`중단 — ${e.message}. 지금까지 받은 것만 저장합니다`); break; }
      failed++;
    }
    if (++done % 200 === 0) log(`  ${done}/${todo.length}`);
    await sleep(GAP_MS);
  }

  const out = {
    generatedAt: new Date().toISOString(),
    region: regionKey, regionLabel: region.label,
    source: `소상공인시장진흥공단 상가(상권)정보(공공데이터포털) — 단지에서 가장 가까운 역까지 가는 길을 덮는 원(반경 = 거리÷2+${PAD_M}m) 안의 점포. dens 는 ㎢당 점포 수. 상권의 유무·구성이며 간판·보도 같은 정비 상태를 재는 값이 아닙니다.`,
    padM: PAD_M,
    fields: ['n', 'dens', 'mix', 'top'],
    count: Object.keys(byId).length,
    byId,
  };
  fs.writeFileSync(dest, JSON.stringify(out));
  const ds = Object.values(byId).map(v => v[1]).sort((a, b) => a - b);
  log(`${done - failed}곳 계산(실패 ${failed}) → ${path.relative(process.cwd(), dest)} (${(fs.statSync(dest).size / 1024).toFixed(0)}KB) · 전체 ${out.count}곳 · ㎢당 점포 중앙값 ${ds[ds.length >> 1]}곳 · ${Math.round((Date.now() - t0) / 1000)}초`);
  return out;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (invokedDirectly) {
  const args = process.argv.slice(2);
  const region = args.find(a => !a.startsWith('-')) || 'seoul';
  const lim = Number((args.find(a => a.startsWith('--limit=')) || '').split('=')[1]) || 0;
  main(region, { all: args.includes('--all'), limit: lim }).catch(e => { console.error('[상가] 실패:', e.message); process.exit(1); });
}
