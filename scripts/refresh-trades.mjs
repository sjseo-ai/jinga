// 실거래 **일별 갱신** — 최근 몇 달만 다시 받아 data/trades-seoul.json 을 갱신합니다 (T010).
//   npm run trades:refresh                      최근 3개월 · 25개 자치구 = 75회 조회
//   node scripts/refresh-trades.mjs --months=6
//   node scripts/refresh-trades.mjs --gu=강동구,노원구
//   node scripts/refresh-trades.mjs --dry        받아만 보고 파일은 건드리지 않음
//
// 전체 수집(`npm run trades:seoul`)은 25개구 × 12개월 = 300회입니다. 하루 한 번 돌릴 것이 아닙니다.
//
// ── 왜 「통째로 교체」인가 ──────────────────────────────────────────────────
// 2026-02 에 신고하고 2026-03 에 해제한 건은 **2026-02 응답에 해제 표시가 붙어 다시 나옵니다**
// (`_trades.mjs` 머리말). 새로 들어온 건만 더하는 방식이면 그 해제 건이 우리 파일에 영원히 남아
// 허위 고가로 평균을 올립니다. 그래서 다시 받은 달은 **버리고 새로 깝니다.**
//
// ── 못 잡는 것 ─────────────────────────────────────────────────────────────
// 갱신 창(기본 3개월) **밖에서 해제된 건은 이 갱신으로 사라지지 않습니다.**
// 한 달에 한 번은 `npm run trades:seoul` 로 전체를 다시 받으십시오 — docs/schema.md 에 적어 두었습니다.
//
// 인증키는 `.secrets/molit.json` 에서 읽습니다(git 제외). 화면·파일에 키를 쓰지 않습니다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeRefresh } from './_trades.mjs';
import { GU_CODES, recentMonths, fetchGuMonth } from './build-trades.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, 'data', 'trades-seoul.json');
const log = m => console.log(`[${new Date().toLocaleTimeString('ko-KR', { hour12: false })}] ${m}`);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const n = v => Number(v).toLocaleString('ko-KR');

/** 기본 3개월 — 신고 기한이 계약일로부터 30일이라, 두 달 전 계약이 이번 달에 들어오기도 합니다. */
export const DEFAULT_WINDOW = 3;
/** 갱신 이력은 최근 30회만 남깁니다 — 파일이 이력으로 부풀면 안 됩니다. */
export const HISTORY_KEEP = 30;

function readKey() {
  const p = path.join(ROOT, '.secrets', 'molit.json');
  if (!fs.existsSync(p)) throw new Error('인증키가 없습니다 — npm run molit:key 로 먼저 넣어 주세요');
  const k = JSON.parse(fs.readFileSync(p, 'utf8')).apiKey;
  if (!k) throw new Error('.secrets/molit.json 에 apiKey 가 없습니다');
  return k;
}

/** 갱신 이력 한 줄을 앞에 붙이고 오래된 것을 잘라 냅니다. */
export function pushHistory(prev, entry, keep = HISTORY_KEEP) {
  const list = Array.isArray(prev && prev.history) ? prev.history : [];
  return { lastRunAt: entry.at, window: entry.window, history: [entry, ...list].slice(0, keep) };
}

export async function main(argv = process.argv.slice(2)) {
  const t0 = Date.now();
  const months = Number((argv.find(a => a.startsWith('--months=')) || '').slice(9)) || DEFAULT_WINDOW;
  const dry = argv.includes('--dry');
  const only = (argv.find(a => a.startsWith('--gu=')) || '').slice(5).split(',').map(s => s.trim()).filter(Boolean);
  const gus = only.length ? only.filter(g => GU_CODES[g]) : Object.keys(GU_CODES);
  if (only.length && gus.length !== only.length) throw new Error(`모르는 자치구: ${only.filter(g => !GU_CODES[g]).join(' ')}`);

  if (!fs.existsSync(FILE)) {
    console.error('data/trades-seoul.json 이 없습니다 — 갱신은 기존 파일을 고치는 일입니다.');
    console.error('처음이라면 전체 수집부터: npm run trades:seoul');
    process.exit(1);
  }
  const prev = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  if (!Array.isArray(prev.trades) || !Array.isArray(prev.stats)) {
    throw new Error('기존 파일에 trades·stats 가 없습니다 — 모양이 다릅니다. npm run trades:seoul 로 다시 만드십시오');
  }

  const key = readKey();
  const ymList = recentMonths(months);
  log(`일별 갱신 — ${gus.length}개 자치구 × ${months}개월(${ymList[ymList.length - 1]}~${ymList[0]}) = ${gus.length * months}회 조회`);
  log(`  기존: 거래 ${n(prev.trades.length)}건 · 수집 시각 ${prev.generatedAt || '(모름)'}`);

  const results = [];
  for (const gu of gus) {
    for (const ym of ymList) {
      const { trades, stat } = await fetchGuMonth(key, gu, GU_CODES[gu], ym);
      results.push({ gu, ym, trades, stat });
      await sleep(80);
    }
    const mine = results.filter(r => r.gu === gu);
    const bad = mine.filter(r => !r.stat.ok).length;
    log(`  ${gu} — ${n(mine.reduce((s, r) => s + r.trades.length, 0))}건${bad ? ` · 실패 ${bad}회` : ''}`);
  }

  const fetchedAt = new Date().toISOString();
  const merged = mergeRefresh({ trades: prev.trades, stats: prev.stats, results, fetchedAt });
  const s = merged.summary;

  log(`합치기 — 갈아 끼운 칸 ${s.cells}개 · 새 거래 ${n(s.added)}건 · 사라진 거래 ${n(s.removed)}건 · 그대로 ${n(s.same)}건`);
  if (s.removed) log(`  사라진 ${n(s.removed)}건은 해제되었거나 신고가 고쳐진 건입니다 — 남겨 두면 허위 고가가 됩니다`);
  if (s.failures.length) {
    log(`  실패 ${s.failures.length}회 — 그 달은 **손대지 않았습니다**(이전 자료 그대로):`);
    for (const f of s.failures.slice(0, 5)) log(`    ${f.gu} ${f.ym} — ${f.error}`);
    if (s.failures.length > 5) log(`    … 그 밖 ${s.failures.length - 5}회`);
  }

  if (dry) {
    log(`--dry 이므로 파일을 쓰지 않았습니다. 쓰면 거래 ${n(prev.trades.length)} → ${n(merged.counts.trades)}건이 됩니다`);
    return { ...merged, written: false };
  }

  const data = {
    ...prev,
    generatedAt: fetchedAt,
    months: merged.months, gus: merged.gus,
    counts: merged.counts,
    stats: merged.stats,
    refresh: pushHistory(prev.refresh, {
      at: fetchedAt, window: months, gus: gus.length, cells: s.cells,
      added: s.added, removed: s.removed, same: s.same, failed: s.failures.length,
    }),
    trades: merged.trades,
  };
  fs.writeFileSync(FILE, JSON.stringify(data));
  const mb = (fs.statSync(FILE).size / 1048576).toFixed(1);
  log(`완료 — 거래 ${n(merged.counts.trades)}건 · 단지 ${n(merged.counts.complexes)}곳 · ${merged.months.length}개월`
    + ` · ${mb}MB · ${Math.round((Date.now() - t0) / 1000)}초`);
  log('  다음: npm run trades:match → npm run trades:prices → npm run build:decision');
  return { ...merged, written: true };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error('실패:', e.message); process.exit(1); });
}
