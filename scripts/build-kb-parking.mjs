// KB부동산이 보는 주차 대수 모으기 → site/public/kb-{지역}-parking.json
//
//   node scripts/build-kb-parking.mjs            서울
//   node scripts/build-kb-parking.mjs gyeonggi   경기
//
// 왜 필요한가 — 주차는 국토부 K-apt 신고값만 써 왔는데, 독자가 KB부동산 앱을 켜면 다른 숫자가 나옵니다.
// 2026-11-12 에 명일 신동아(570세대)로 지적을 받았습니다. K-apt 355대(세대당 0.62), KB 600대(1.05).
// 강동구 K-apt 보유 56곳을 맞춰 보니 30곳(54%)이 수치가 달랐고, 한쪽이 일방적으로 큰 것도 아니었습니다
// (고덕주공9단지는 거꾸로 K-apt 1.21 · KB 0.51).
//
// 어느 쪽이 맞는지는 우리가 가릴 수 없습니다. 그래서 **두 숫자를 나란히 싣고 읽는 사람이 판단하도록** 합니다.
// 단지 이름을 짚는 목록(「주차 빠듯한 곳」)은 두 출처가 같은 쪽을 가리킬 때만 올립니다 — _pages.mjs 참고.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createKbClient, runPool } from '../site/public/jinga-kb.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUB = path.join(ROOT, 'site', 'public');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const log = m => console.log(`[${new Date().toLocaleTimeString('ko-KR', { hour12: false })}] ${m}`);
const sleep = ms => new Promise(r => setTimeout(r, ms));

export const REGIONS = {
  seoul: { label: '서울', complexes: 'kb-seoul-complexes.json', kapt: 'kapt-seoul.json', out: 'kb-seoul-parking.json' },
  gyeonggi: { label: '경기', complexes: 'kb-gyeonggi-complexes.json', kapt: 'kapt-gyeonggi.json', out: 'kb-gyeonggi-parking.json' },
};

/** 두 출처를 한 줄로 — 어느 쪽도 고르지 않고, 엇갈리는지만 알려 줍니다 */
export function compare(kaptPer, kbPer) {
  if (kaptPer == null && kbPer == null) return { agree: null, both: false };
  if (kaptPer == null || kbPer == null) return { agree: null, both: false };
  // 「세대당 1대」를 두 출처가 같은 쪽으로 보는가 — 명단에 이름을 올릴 수 있는지의 기준입니다
  return { agree: (kaptPer < 1) === (kbPer < 1), both: true };
}

async function main() {
  const key = (process.argv[2] || 'seoul').toLowerCase();
  const R = REGIONS[key];
  if (!R) { console.error(`모르는 지역: ${key} (${Object.keys(REGIONS).join(' | ')})`); process.exit(1); }

  const read = f => JSON.parse(fs.readFileSync(path.join(PUB, f), 'utf8'));
  const dir = read(R.complexes).complexes;
  const kapt = read(R.kapt).byComplex || {};
  // K-apt 자료가 있는 단지만 — 대조할 짝이 없으면 받아 와도 쓸 데가 없습니다
  const targets = dir.filter(c => kapt[String(c[0])]);
  log(`${R.label} — K-apt 자료가 있는 ${targets.length}개 단지의 KB 주차를 받습니다`);

  const kb = createKbClient({ headers: { 'User-Agent': UA, Referer: 'https://kbland.kr/', Accept: 'application/json' } });
  const t0 = Date.now();
  const rows = await runPool(targets, 3, async c => {
    await sleep(60);
    const p = await kb.parking(c[0]);
    return p.total == null && p.per == null ? null : { id: c[0], ...p };
  }, done => { if (done % 300 === 0 || done === targets.length) log(`  ${done}/${targets.length}`); });

  const got = rows.filter(Boolean);
  if (got.length < targets.length * 0.8) {
    throw new Error(`조회 실패가 너무 많습니다(${targets.length - got.length}곳) — 기존 파일을 그대로 둡니다`);
  }

  const byComplex = {};
  for (const r of got) byComplex[r.id] = { total: r.total, per: r.per };

  // 얼마나 엇갈리는지 세어 둡니다 — 나중에 「이 숫자 믿어도 되나」를 되물을 때 근거가 됩니다
  let both = 0, differ = 0, flip = 0;
  for (const c of targets) {
    const k = kapt[String(c[0])], b = byComplex[c[0]];
    if (!b) continue;
    const hh = k.households;
    const kTotal = (k.parkUnder == null && k.parkGround == null) ? null : (k.parkUnder || 0) + (k.parkGround || 0);
    const kPer = kTotal != null && hh > 0 ? Math.round(kTotal / hh * 100) / 100 : null;
    const cmp = compare(kPer, b.per);
    if (!cmp.both) continue;
    both++;
    if (kTotal !== b.total) differ++;
    if (!cmp.agree) flip++;
  }

  const out = {
    generatedAt: new Date().toISOString(),
    region: key, regionLabel: R.label,
    source: 'KB부동산 단지정보(총주차대수·세대당주차대수비율) — 비공식 조회',
    note: '국토부 K-apt 신고값과 다를 수 있습니다. 어느 쪽도 고르지 않고 두 숫자를 함께 싣습니다.',
    count: got.length,
    compared: { both, differ, flip },
    byComplex,
  };
  fs.writeFileSync(path.join(PUB, R.out), JSON.stringify(out));

  log(`완료 — ${got.length}곳 · 실패 ${targets.length - got.length}곳 · ${Math.round((Date.now() - t0) / 1000)}초`);
  log(`  두 출처 다 있는 ${both}곳 중 대수가 다른 곳 ${differ}곳(${Math.round(differ / both * 100)}%), 「세대당 1대」 판정이 엇갈리는 곳 ${flip}곳`);
  log(`  → ${R.out}`);
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error('실패:', e.message); process.exit(1); });
}
