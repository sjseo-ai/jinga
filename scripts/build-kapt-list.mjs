// 국토교통부 공동주택 단지 목록 — 단지명·법정동을 **공식 자료로** 받아 둡니다(T011).
//   npm run kapt:list            서울
//   node scripts/build-kapt-list.mjs gyeonggi
//
// 왜 — 지금 단지 페이지의 이름·자치구·법정동은 **KB 수집물**에서 옵니다.
// 그런데 페이지에는 「국토교통부 공식 자료」라고 적혀 있습니다. 그 말이 사실이 되게 하는 작업입니다.
//   공공데이터포털 15057332 · AptListService4 · 이용허락범위 제한 없음(2026-11-19 확인)
//
// **주소(URL)는 바꾸지 않습니다.** 이름이 조금씩 달라서(「논현(신동아)」 ↔ 「논현신동아」) 주소까지 바꾸면
// 2,000장이 한꺼번에 새 주소가 되고, 이제 막 색인되기 시작한 것이 전부 끊깁니다.
// 주소는 그대로 두고 **화면에 보이는 이름과 법정동만** 공식 값으로 바꿉니다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'https://apis.data.go.kr/1613000/AptListService4/getSidoAptList4';
const log = m => console.log(`[${new Date().toLocaleTimeString('ko-KR', { hour12: false })}] ${m}`);
const sleep = ms => new Promise(r => setTimeout(r, ms));

export const REGIONS = {
  seoul: { sido: '11', label: '서울' },
  gyeonggi: { sido: '41', label: '경기' },
};

function readKey() {
  for (const f of ['molit.json', 'sangga.json']) {
    const p = path.join(ROOT, '.secrets', f);
    if (!fs.existsSync(p)) continue;
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    const k = j.apiKey || j.key;
    if (k) return k;
  }
  throw new Error('인증키가 없습니다 — npm run molit:key');
}

/** 한 쪽 받기. 포털 키는 이미 인코딩된 형태라 **다시 인코딩하지 않습니다**(%252B 가 되어 거부당합니다) */
async function page(key, sido, pageNo, rows = 1000) {
  const url = `${BASE}?serviceKey=${key}&sidoCode=${sido}&pageNo=${pageNo}&numOfRows=${rows}&_type=json`;
  const r = await fetch(url, { signal: AbortSignal.timeout(40000) });
  const text = await r.text();
  if (/NOT_REGISTERED|등록되지 않은/.test(text)) throw new Error('인증키가 이 서비스(15057332)에 등록돼 있지 않습니다 — 활용신청 확인');
  let j;
  try { j = JSON.parse(text); } catch { throw new Error(`응답을 읽지 못했습니다: ${text.replace(/\s+/g, ' ').slice(0, 120)}`); }
  const b = j.response && j.response.body;
  if (!b) throw new Error('본문이 없습니다');
  const items = Array.isArray(b.items) ? b.items : (b.items && b.items.item) || [];
  return { items: Array.isArray(items) ? items : [items], total: Number(b.totalCount) || 0 };
}

export async function main(argv = process.argv.slice(2)) {
  const key = argv.find(a => !a.startsWith('--')) || 'seoul';
  const R = REGIONS[key];
  if (!R) { console.error(`모르는 지역: ${key} (${Object.keys(REGIONS).join(' | ')})`); process.exit(1); }
  const apiKey = readKey();
  const out = path.join(ROOT, 'site', 'public', `kapt-list-${key}.json`);

  const first = await page(apiKey, R.sido, 1);
  const all = [...first.items];
  const pages = Math.ceil(first.total / 1000);
  for (let p = 2; p <= pages; p++) { await sleep(120); all.push(...(await page(apiKey, R.sido, p)).items); }

  const byCode = {};
  for (const it of all) {
    if (!it || !it.kaptCode) continue;
    byCode[it.kaptCode] = { name: String(it.kaptName || '').trim(), gu: String(it.as2 || '').trim(), dong: String(it.as3 || '').trim(), bjd: String(it.bjdCode || '').trim() };
  }
  const data = {
    generatedAt: new Date().toISOString(),
    source: '국토교통부_공동주택 단지 목록제공 서비스(공공데이터포털 15057332, AptListService4) — 이용허락범위 제한 없음',
    region: key, count: Object.keys(byCode).length, byCode,
  };
  fs.writeFileSync(out, JSON.stringify(data));
  log(`${R.label} 단지 ${data.count.toLocaleString('ko-KR')}곳 → site/public/kapt-list-${key}.json (${(fs.statSync(out).size / 1024).toFixed(0)}KB)`);
  return data;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error('실패:', e.message); process.exit(1); });
}
