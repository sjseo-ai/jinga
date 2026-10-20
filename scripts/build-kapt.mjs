// 공동주택 공식 정보 모으기 — 국토교통부 K-apt 공개 API(data.go.kr)
//
//   node scripts/build-kapt.mjs                   서울
//   node scripts/build-kapt.mjs gyeonggi          경기
//   node scripts/build-kapt.mjs --min=300         이 세대수 이상만
//   node scripts/build-kapt.mjs --hours=3         이번에 돌릴 시간(기본 3시간)
//   node scripts/build-kapt.mjs --limit=4000      이번에 쓸 호출 수 상한
//
// **이어 받습니다** — 이미 받은 단지는 건너뛰고, 50곳마다 파일에 적어 둡니다.
// 중간에 멈춰도 받은 것은 남고, 같은 명령을 다시 실행하면 그 다음부터 갑니다.
//
// ── 겪은 일: 두 번 막혔습니다 ──────────────────────────────────────────
// 처음에는 159초에 2,214번(초당 14번) 부르다 HTTP_ERROR(reasonCode 04)로 차단됐습니다.
// 간격을 350ms 로 늘려(초당 1번 꼴) 다시 돌렸더니 **217번째쯤에서 또 막혔습니다** — 속도가 아니라
// **구간별 호출 한도**로 보입니다. 10분쯤 지나면 저절로 풀립니다.
// 그래서 막히면 포기하지 않고 **쉬었다 이어 갑니다**. 오래 걸리는 것이 정상입니다.
//
// 더 나빴던 것은 그 오류를 **성공으로 처리한 쪽**이었습니다 — 오류 응답은 모양이 통째로 달라
// ({ OpenAPI_ServiceResponse: { cmmMsgHeader } }) response.body 가 없을 뿐인 정상 응답처럼 보였고,
// 1,000곳 넘게 호출만 쓰고 「짝 못 찾음」으로 조용히 버려졌습니다. 지금은 그 봉투를 오류로 봅니다.
//
// 짝 맞추기 — KB 단지와 K-apt 단지를 법정동+이름으로 맞추고, **세대수로 되짚어** 어긋나면 버립니다.
// 예전에 조합 단지를 맞출 때 느슨하게 했다가 더 나빠진 적이 있어(23%→21%→15%), 애매하면 포기합니다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SIDO, matchComplex, householdsAgree, parseBasis, parseDetail } from '../site/public/api/_kapt.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIST = 'https://apis.data.go.kr/1613000/AptListService4/getSidoAptList4';
const BASIS = 'https://apis.data.go.kr/1613000/AptBasisInfoServiceV5/getAphusBassInfoV5';
const DETAIL = 'https://apis.data.go.kr/1613000/AptBasisInfoServiceV5/getAphusDtlInfoV5';

const PAUSE_MS = 350;           // 단지 사이 — 초당 1번 꼴
const RETRY = 2;                // 한 번 부를 때 다시 해 보는 횟수(막힌 것이면 어차피 쉬어야 합니다)
const BLOCKED_RUN = 4;          // 이만큼 잇따라 막히면 「구간 한도에 닿았다」로 봅니다
const COOLDOWN_MS = 300000;     // 그때 쉬는 시간(5분) — 10분쯤이면 풀렸습니다
const COOLDOWN_MAX = 500;      // 사실상 제한 없음 — 언제 멈출지는 --hours 가 정합니다
const SAVE_EVERY = 50;          // 이만큼 받을 때마다 파일에 적어 둡니다

const log = m => console.log(`[${new Date().toLocaleTimeString('ko-KR', { hour12: false })}] ${m}`);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const arg = (name, dflt) => {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};

function loadKey() {
  const p = path.join(ROOT, '.secrets', 'sangga.json');
  if (!fs.existsSync(p)) throw new Error('.secrets/sangga.json 에 data.go.kr 인증키가 없습니다');
  const k = JSON.parse(fs.readFileSync(p, 'utf8')).key;
  if (!k) throw new Error('인증키가 비어 있습니다');
  // 포털이 주는 키는 Encoding/Decoding 두 가지입니다 — 이미 인코딩된 것을 또 인코딩하면 틀립니다
  return /%[0-9A-Fa-f]{2}/.test(k) ? k : encodeURIComponent(k);
}

let calls = 0;
async function api(url, key, params) {
  const q = new URLSearchParams({ serviceKey: 'X', ...params, _type: 'json' }).toString().replace('serviceKey=X', `serviceKey=${key}`);
  let last;
  for (let i = 0; i < RETRY; i++) {
    try {
      calls++;
      const r = await fetch(`${url}?${q}`, { signal: AbortSignal.timeout(20000) });
      const t = await r.text();
      if (/LIMITED_NUMBER_OF_SERVICE_REQUESTS/.test(t)) throw Object.assign(new Error('하루 호출 한도를 다 썼습니다'), { quota: true });
      const j = JSON.parse(t);
      // 오류일 때는 응답 모양이 통째로 다릅니다 — 「값이 없는 정상 응답」으로 보면 안 됩니다
      const env = j?.OpenAPI_ServiceResponse?.cmmMsgHeader;
      if (env) throw Object.assign(new Error(`${env.errMsg || '서비스 오류'}(${env.returnReasonCode || '?'})`), { blocked: true });
      const code = j?.response?.header?.resultCode;
      if (code !== undefined && !/^0+$/.test(String(code))) throw new Error(j?.response?.header?.resultMsg || `resultCode ${code}`);
      return j?.response?.body || {};
    } catch (e) {
      if (e.quota) throw e;
      last = e;
      if (i + 1 < RETRY) await sleep(e.blocked ? 2000 : 800);
    }
  }
  throw last;
}

const asArray = v => (Array.isArray(v) ? v : v ? [v] : []);

/** 시도 전체 단지 목록 — 1000행씩. 막혀 있으면 풀릴 때까지 기다립니다(여기서 못 받으면 시작도 못 합니다) */
async function fetchList(key, sidoCode) {
  const out = [];
  for (let page = 1; page <= 40; page++) {
    let b;
    for (let tries = 0; ; tries++) {
      try { b = await api(LIST, key, { sidoCode, pageNo: page, numOfRows: 1000 }); break; }
      catch (e) {
        if (!e.blocked || tries >= COOLDOWN_MAX) throw e;
        log(`목록을 받지 못했습니다(${e.message}) — ${COOLDOWN_MS / 60000}분 쉬었다 다시 해 봅니다`);
        await sleep(COOLDOWN_MS);
      }
    }
    out.push(...asArray(b.items));
    if (out.length >= (Number(b.totalCount) || 0)) break;
    await sleep(PAUSE_MS);
  }
  return out;
}

async function main() {
  const regionKey = (process.argv[2] && !process.argv[2].startsWith('--')) ? process.argv[2] : 'seoul';
  const region = SIDO[regionKey];
  if (!region) throw new Error(`지역은 ${Object.keys(SIDO).join('·')} 중 하나여야 합니다`);
  const limit = Number(arg('limit', 100000));
  const minHh = Number(arg('min', 300));
  const deadline = Date.now() + Number(arg('hours', 3)) * 3600000;
  const key = loadKey();
  const t0 = Date.now();

  const dirFile = path.join(ROOT, 'site', 'public', `kb-${regionKey}-complexes.json`);
  const dir = JSON.parse(fs.readFileSync(dirFile, 'utf8'));
  const mine = dir.complexes
    .map(c => ({ id: c[0], name: c[1], gu: c[2], dong: c[3], households: c[12] }))
    .filter(c => (c.households || 0) >= minHh);
  log(`${region.label} — 우리 단지 ${dir.count}곳 중 ${minHh}세대 이상 ${mine.length}곳이 대상`);

  const outFile = path.join(ROOT, 'site', 'public', `kapt-${regionKey}.json`);
  const prev = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, 'utf8')) : { byComplex: {}, unmatched: [], mismatched: [] };
  const byComplex = prev.byComplex || {};
  // 세대수가 어긋나 버린 단지 — **다시 받아도 또 버립니다.** 기억해 두지 않으면 실행마다 호출만 축냅니다
  const rejected = prev.rejected || {};
  log(`이미 받아 둔 단지 ${Object.keys(byComplex).length}곳 · 세대수가 어긋나 버린 단지 ${Object.keys(rejected).length}곳 — 나머지만 이어서 받습니다`);

  const rows = await fetchList(key, region.code);
  log(`K-apt 등록 단지 ${rows.length}곳 (목록 호출 ${calls}번)`);

  const unmatched = [], mismatched = [], failed = [];
  let done = 0, stopped = '', blockedRun = 0, cooldowns = 0;

  const save = () => {
    const out = {
      generatedAt: new Date().toISOString(),
      region: regionKey, regionLabel: region.label,
      minHouseholds: Math.min(minHh, prev.minHouseholds || minHh),
      source: '국토교통부 공동주택 단지 목록·기본·상세 정보(data.go.kr 공개 API) — K-apt 의무관리대상 단지만 등록되어 있습니다',
      targets: mine.length,
      count: Object.keys(byComplex).length,
      unmatched: [...new Set([...(prev.unmatched || []), ...unmatched])].slice(0, 600),
      mismatched: [...new Set([...(prev.mismatched || []), ...mismatched])].slice(0, 300),
      rejected,                       // 다시 받아도 또 버릴 단지 — 건너뜁니다
      failed: failed.slice(0, 200),   // byComplex 에 없으므로 다음 실행에서 다시 시도합니다
      byComplex,
    };
    fs.writeFileSync(outFile, JSON.stringify(out));
    return out;
  };

  for (const c of mine) {
    if (byComplex[c.id] || rejected[c.id]) continue;
    const hit = matchComplex(c, rows);
    if (!hit) { unmatched.push(c.name); continue; }
    if (calls + 2 > limit) { stopped = '호출 상한'; break; }
    if (Date.now() > deadline) { stopped = '정해 둔 시간'; break; }
    try {
      const b = await api(BASIS, key, { kaptCode: hit.kaptCode });
      const d = await api(DETAIL, key, { kaptCode: hit.kaptCode });
      await sleep(PAUSE_MS);
      const basis = parseBasis(b.item || {});
      // 짝은 찾았는데 자료가 비어 있는 것 — 「짝 못 찾음」과 구분합니다(다음 실행에서 다시 시도)
      if (!basis) { failed.push(`${c.name}(자료 없음)`); continue; }
      blockedRun = 0;
      // 이름이 비슷해도 세대수가 크게 다르면 다른 단지입니다 — 틀린 짝은 없느니만 못합니다
      if (!householdsAgree(c.households, basis.households)) {
        rejected[c.id] = `${hit.kaptName}(우리 ${c.households} / K-apt ${basis.households})`;
        mismatched.push(`${c.name}(우리 ${c.households} / K-apt ${basis.households})`);
        continue;
      }
      byComplex[c.id] = { ...basis, ...parseDetail(d.item || {}), kaptName: hit.kaptName };
      done++;
      if (done % SAVE_EVERY === 0) { save(); log(`  ${done}곳 받음 · 호출 ${calls}번 · 적어 뒀습니다`); }
    } catch (e) {
      if (e.quota) { stopped = '하루 한도'; break; }
      failed.push(`${c.name}(${e.message})`);
      if (!e.blocked) continue;
      if (++blockedRun < BLOCKED_RUN) continue;
      // 구간 한도에 닿았습니다 — 받은 것을 적어 두고, 풀릴 때까지 쉽니다
      blockedRun = 0;
      save();
      if (++cooldowns > COOLDOWN_MAX) { stopped = '쉬어 가기 상한'; break; }
      if (Date.now() + COOLDOWN_MS > deadline) { stopped = '정해 둔 시간'; break; }
      log(`막혔습니다 — ${done}곳까지 적어 두고 ${COOLDOWN_MS / 60000}분 쉽니다 (${cooldowns}번째 · 지금까지 호출 ${calls}번)`);
      await sleep(COOLDOWN_MS);
    }
  }

  const out = save();
  const withPark = Object.values(byComplex).filter(k => k.parkUnder != null).length;
  const withSub = Object.values(byComplex).filter(k => k.subwayStation).length;
  log(`${region.label} 저장 ${out.count}곳 / 대상 ${mine.length}곳 (${(out.count / mine.length * 100).toFixed(1)}%) → ${path.relative(process.cwd(), outFile)} (${(fs.statSync(outFile).size / 1024).toFixed(0)}KB)`);
  log(`  주차 정보 있음 ${withPark} · 지하철역 있음 ${withSub} · 짝 못 찾음 ${out.unmatched.length} · 세대수 어긋나 버림 ${out.mismatched.length} · 조회 못 함 ${failed.length}(다음에 다시 시도)`);
  log(`  호출 ${calls}번 · 쉬어 가기 ${cooldowns}번 · ${Math.round((Date.now() - t0) / 60000)}분${stopped ? ` · ${stopped}에 닿아 멈췄습니다 — 같은 명령을 다시 실행하면 이어집니다` : ' · 끝까지 돌았습니다'}`);
  if (out.mismatched.length) log(`  어긋난 예: ${out.mismatched.slice(0, 3).join(' / ')}`);
  return out;
}

main().catch(e => { console.error('실패:', e.message); process.exit(1); });
