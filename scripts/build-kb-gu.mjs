// KB시세 서울 25개 구·법정동 전용 평당가 집계 → site/public/kb-seoul-gu.json (웹페이지 지역 지도가 읽음)
//   npm run kb:gu        (scripts/weekly-report.bat 이 매주 보고서보다 먼저 실행)
// 국토부 실거래 API 키가 거부되는 동안 지역 지도를 KB시세로 채우기 위한 집계입니다.
// 평당가 = KB 일반거래가 ÷ (전용면적 ÷ 3.3058)를 주택형 세대수로 가중평균. 50세대 미만 단지는 제외.
// 직전 집계(다른 KB 기준일)와 비교한 주간 변동률(%)을 구·동마다 붙입니다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createKbClient, runPool } from '../site/public/jinga-kb.mjs';
import { aggregate, compactForCompare, attachChange, withRetry } from '../site/public/api/_weekly.mjs';
// 구·동 집계·비교는 Vercel 서버 작업과 같이 쓰는 _weekly.mjs 에 있음(테스트·예전 경로 호환용으로 다시 내보냄)
export { aggregate, compactForCompare, attachChange, withRetry } from '../site/public/api/_weekly.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'site', 'public', 'kb-seoul-gu.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const log = msg => console.log(`[${new Date().toLocaleTimeString('ko-KR', { hour12: false })}] ${msg}`);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 조회한 단지·주택형 시세를 주간 보고서가 다시 쓰도록 남김(구독자 조건별 보고서가 같은 날 KB에 또 수천 건을 요청하지 않게)
export const KB_TYPES_CACHE = path.join(ROOT, 'reports', 'cache', 'kb-types.json');

export async function main() {
  const t0 = Date.now();
  const dir = JSON.parse(fs.readFileSync(path.join(ROOT, 'site', 'public', 'kb-seoul-complexes.json'), 'utf8')).complexes.filter(c => !c[4]);
  const kb = createKbClient({ headers: { 'User-Agent': UA, Referer: 'https://kbland.kr/', Accept: 'application/json' } });
  log(`KB 지역시세 집계 — 서울 50세대 이상 ${dir.length}개 단지`);
  // KB는 짧은 시간에 요청이 몰리면 일시적으로 거부함(2026-09-11: 4천여 건을 4건 동시로 보내자 3천여 건 실패, 직후 단건은 정상)
  // → 동시 3건 + 요청 간 짧은 간격 + 건별 재시도, 그래도 실패한 단지는 잠시 쉰 뒤 한 건씩 다시
  const errors = {};
  const fetchOne = async c => {
    try {
      await sleep(40);
      return { id: c[0], name: c[1], gu: c[2], dong: c[3], types: await withRetry(() => kb.types(c[0])) };
    } catch (e) {
      const k = String(e.message || e).slice(0, 60);
      errors[k] = (errors[k] || 0) + 1;
      throw e;
    }
  };
  const results = await runPool(dir, 3, fetchOne, done => { if (done % 500 === 0 || done === dir.length) log(`  ${done}/${dir.length}`); });
  const missIdx = results.map((r, i) => (r ? -1 : i)).filter(i => i >= 0);
  if (missIdx.length) {
    log(`  1차 실패 ${missIdx.length}곳 (${Object.entries(errors).map(([k, v]) => `${k} ×${v}`).join(', ')}) — 10초 뒤 한 건씩 재조회`);
    await sleep(10000);
    const retry = await runPool(missIdx.map(i => dir[i]), 1, async c => { await sleep(200); return fetchOne(c); },
      done => { if (done % 200 === 0 || done === missIdx.length) log(`  재조회 ${done}/${missIdx.length}`); });
    missIdx.forEach((idx, j) => { if (retry[j]) results[idx] = retry[j]; });
  }
  const complexes = results.filter(Boolean);
  const failed = dir.length - complexes.length;
  if (complexes.length < dir.length * 0.8) throw new Error(`조회 실패가 너무 많습니다(${failed}곳) — 기존 파일을 그대로 둡니다`);

  let asOf = '';
  const sample = complexes.find(c => c.types.some(t => t.provided));
  try { if (sample) asOf = await kb.asOf(sample.id, sample.types.find(t => t.provided).areaId); } catch { /* 기준일 없이 진행 */ }

  const data = { asOf, generatedAt: new Date().toISOString(), source: 'KB부동산 KB시세(단지·주택형별 매매 일반거래가) 서울 50세대 이상 아파트 집계 — 비공식 조회', ...aggregate(complexes) };
  const old = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : null;
  // 같은 KB 기준일에 다시 돌리면 이전 비교 기준을 그대로 유지(주간 변동률이 0으로 덮이지 않게)
  const base = old ? (old.asOf && old.asOf !== asOf ? compactForCompare(old) : old.previous || null) : null;
  attachChange(data, base);
  data.previous = base;
  fs.writeFileSync(OUT, JSON.stringify(data));
  fs.mkdirSync(path.dirname(KB_TYPES_CACHE), { recursive: true });
  fs.writeFileSync(KB_TYPES_CACHE, JSON.stringify({ generatedAt: data.generatedAt, asOf, complexes }));

  const top = Object.entries(data.gu).sort((a, b) => b[1].avgPerPyeong - a[1].avgPerPyeong);
  log(`완료 — KB ${asOf} 기준 · ${data.seoul.count}개 단지 · 서울 평균 평당 ${data.seoul.avgPerPyeong.toLocaleString('ko-KR')}만 · 실패 ${failed}곳 · ${Math.round((Date.now() - t0) / 1000)}초`);
  log(`  평당가 상위: ${top.slice(0, 3).map(([g, v]) => `${g} ${v.avgPerPyeong.toLocaleString('ko-KR')}만`).join(', ')} / 하위: ${top.slice(-2).map(([g, v]) => `${g} ${v.avgPerPyeong.toLocaleString('ko-KR')}만`).join(', ')}`);
  if (data.prevAsOf) log(`  비교 기준 ${data.prevAsOf}`);
  return data;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (invokedDirectly) {
  main().catch(e => { console.error('[KB 지역시세] 실패:', e); process.exit(1); });
}
