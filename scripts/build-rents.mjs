// 국토교통부 아파트 **전월세** 실거래 수집 — 서울 25개 자치구 × 최근 N개월 → data/rents-seoul.json
//   npm run rents:seoul                 최근 12개월(전체 수집)
//   npm run rents:refresh               최근 3개월만 갈아 끼움
//   node scripts/build-rents.mjs --months=24 --gu=강동구,노원구
//   node scripts/build-rents.mjs --refresh --months=3 --dry
//
// 매매 쪽(build-trades.mjs / refresh-trades.mjs)과 같은 규칙을 지킵니다 —
//   · 빈 달과 실패한 달을 구분해 stats 에 남깁니다. 0건과 모름은 다릅니다.
//   · 다시 받은 달은 **통째로 교체**합니다. 늦은 신고·수정이 양쪽으로 반영되게.
//   · 실패한 달은 **손대지 않습니다.** 실패를 0건으로 치면 멀쩡한 달이 지워집니다.
// 합치기 규칙 자체는 `_trades.mjs` 의 `mergeRefresh` 를 그대로 씁니다(열쇠만 전월세용으로 바꿔서).
//
// 인증키는 `.secrets/molit.json` 에서 읽습니다(git 제외). 화면·파일에 키를 쓰지 않습니다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { totalCount, errorOf, mergeRefresh } from './_trades.mjs';
import { parseRents, rentKey, isJeonse, isMarketJeonse } from './_rents.mjs';
import { GU_CODES, recentMonths } from './build-trades.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 'rents-seoul.json');
const BASE = 'https://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const log = m => console.log(`[${new Date().toLocaleTimeString('ko-KR', { hour12: false })}] ${m}`);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const n = v => Number(v).toLocaleString('ko-KR');

export const SOURCE = '국토교통부_아파트 전월세 실거래가 자료(공공데이터포털 15126474, RTMSDataSvcAptRent) — 이용허락범위 제한 없음';
export const DEFAULT_WINDOW = 3;
export const HISTORY_KEEP = 30;

function readKey() {
  const p = path.join(ROOT, '.secrets', 'molit.json');
  if (!fs.existsSync(p)) throw new Error('인증키가 없습니다 — npm run molit:key 로 먼저 넣어 주세요');
  const k = JSON.parse(fs.readFileSync(p, 'utf8')).apiKey;
  if (!k) throw new Error('.secrets/molit.json 에 apiKey 가 없습니다');
  return k;
}

/** 한 자치구·한 달을 전부(여러 쪽) → { rents, stat } */
export async function fetchGuMonth(key, gu, code, ym, fetchImpl = fetch) {
  const rows = 1000;
  let page = 1, got = [], total = null, broken = 0;
  for (;;) {
    const url = `${BASE}?serviceKey=${key}&LAWD_CD=${code}&DEAL_YMD=${ym}&pageNo=${page}&numOfRows=${rows}`;
    const r = await fetchImpl(url, { headers: { 'User-Agent': UA, Accept: '*/*' }, signal: AbortSignal.timeout(40000) });
    const xml = await r.text();
    const err = errorOf(xml);
    if (err) return { rents: [], stat: { gu, ym, ok: false, error: err } };
    if (total === null) total = totalCount(xml);
    const p = parseRents(xml, gu);
    got = got.concat(p.rents);
    broken += p.broken;
    const seen = page * rows;
    if (total === null || seen >= total || p.total === 0) break;
    page++;
    await sleep(120);
  }
  const jeonse = got.filter(isJeonse).length;
  return { rents: got, stat: { gu, ym, ok: true, total, kept: got.length, jeonse, market: got.filter(isMarketJeonse).length, broken } };
}

/** 갱신 이력 한 줄을 앞에 붙이고 오래된 것을 잘라 냅니다. */
export function pushHistory(prev, entry, keep = HISTORY_KEEP) {
  const list = Array.isArray(prev && prev.history) ? prev.history : [];
  return { lastRunAt: entry.at, window: entry.window, history: [entry, ...list].slice(0, keep) };
}

/** 모은 것으로 셈을 냅니다 — 전세/월세/신규를 **따로** 셉니다. 섞인 수치는 쓸 데가 없습니다. */
export function countsOf(rents, stats) {
  return {
    rents: rents.length,
    complexes: new Set(rents.map(r => r.seq).filter(Boolean)).size,
    jeonse: rents.filter(isJeonse).length,
    wolse: rents.filter(r => !isJeonse(r)).length,
    marketJeonse: rents.filter(isMarketJeonse).length,     // 신규 전세 — 시세에 쓰는 것
    renewJeonse: rents.filter(r => isJeonse(r) && r.type === '갱신').length,
    failedQueries: stats.filter(s => !s.ok).length,
  };
}

export async function main(argv = process.argv.slice(2)) {
  const t0 = Date.now();
  const refresh = argv.includes('--refresh');
  const dry = argv.includes('--dry');
  const months = Number((argv.find(a => a.startsWith('--months=')) || '').slice(9)) || (refresh ? DEFAULT_WINDOW : 12);
  const only = (argv.find(a => a.startsWith('--gu=')) || '').slice(5).split(',').map(s => s.trim()).filter(Boolean);
  const gus = only.length ? only.filter(g => GU_CODES[g]) : Object.keys(GU_CODES);
  if (only.length && gus.length !== only.length) throw new Error(`모르는 자치구: ${only.filter(g => !GU_CODES[g]).join(' ')}`);

  let prev = null;
  if (refresh) {
    if (!fs.existsSync(OUT)) {
      console.error('data/rents-seoul.json 이 없습니다 — 갱신은 기존 파일을 고치는 일입니다.');
      console.error('처음이라면 전체 수집부터: npm run rents:seoul');
      process.exit(1);
    }
    prev = JSON.parse(fs.readFileSync(OUT, 'utf8'));
    if (!Array.isArray(prev.rents) || !Array.isArray(prev.stats)) {
      throw new Error('기존 파일에 rents·stats 가 없습니다 — npm run rents:seoul 로 다시 만드십시오');
    }
  }

  const key = readKey();
  const ymList = recentMonths(months);
  log(`전월세 ${refresh ? '갱신' : '수집'} — ${gus.length}개 자치구 × ${months}개월(${ymList[ymList.length - 1]}~${ymList[0]}) = ${gus.length * months}회 조회`);
  if (prev) log(`  기존: ${n(prev.rents.length)}건 · 수집 시각 ${prev.generatedAt || '(모름)'}`);

  const results = [];
  for (const gu of gus) {
    for (const ym of ymList) {
      const { rents, stat } = await fetchGuMonth(key, gu, GU_CODES[gu], ym);
      results.push({ gu, ym, trades: rents, stat });     // mergeRefresh 는 `trades` 라는 이름으로 받습니다
      await sleep(80);
    }
    const mine = results.filter(r => r.gu === gu);
    const bad = mine.filter(r => !r.stat.ok).length;
    const cnt = mine.reduce((s, r) => s + r.trades.length, 0);
    const mk = mine.reduce((s, r) => s + (r.stat.market || 0), 0);
    log(`  ${gu} — ${n(cnt)}건(신규 전세 ${n(mk)})${bad ? ` · 실패 ${bad}회` : ''}`);
  }

  const fetchedAt = new Date().toISOString();
  const merged = mergeRefresh({
    trades: prev ? prev.rents : [],
    stats: prev ? prev.stats : [],
    results, fetchedAt, keyOf: rentKey,
  });
  const s = merged.summary;
  const counts = countsOf(merged.trades, merged.stats);

  if (refresh) {
    log(`합치기 — 갈아 끼운 칸 ${s.cells}개 · 새 ${n(s.added)}건 · 사라진 ${n(s.removed)}건 · 그대로 ${n(s.same)}건`);
  }
  if (s.failures.length) {
    log(`  실패 ${s.failures.length}회 — 그 달은 **손대지 않았습니다**(이전 자료 그대로):`);
    for (const f of s.failures.slice(0, 5)) log(`    ${f.gu} ${f.ym} — ${f.error}`);
    if (s.failures.length > 5) log(`    … 그 밖 ${s.failures.length - 5}회`);
  }

  if (dry) {
    log(`--dry 이므로 파일을 쓰지 않았습니다. 쓰면 ${n(prev ? prev.rents.length : 0)} → ${n(counts.rents)}건이 됩니다`);
    return { ...merged, counts, written: false };
  }

  const data = {
    generatedAt: fetchedAt,
    source: SOURCE,
    months: merged.months, gus: merged.gus,
    counts, stats: merged.stats,
    refresh: pushHistory(prev && prev.refresh, {
      at: fetchedAt, window: months, gus: gus.length, cells: s.cells,
      added: s.added, removed: s.removed, same: s.same, failed: s.failures.length, full: !refresh,
    }),
    rents: merged.trades,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(data));
  const mb = (fs.statSync(OUT).size / 1048576).toFixed(1);
  log(`완료 — ${n(counts.rents)}건 · 단지 ${n(counts.complexes)}곳 · ${merged.months.length}개월 · ${mb}MB · ${Math.round((Date.now() - t0) / 1000)}초`);
  log(`  전세 ${n(counts.jeonse)} · 월세 ${n(counts.wolse)} · 그중 시세로 쓰는 신규 전세 ${n(counts.marketJeonse)}건`
    + ` (갱신 전세 ${n(counts.renewJeonse)}건은 상한제에 묶여 시세로 쓰지 않습니다)`);
  log('  다음: npm run rents:prices');
  return { ...merged, counts, written: true };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error('실패:', e.message); process.exit(1); });
}

export { OUT };
