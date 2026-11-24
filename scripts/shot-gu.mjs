// 자치구 연재용 사진 찍기 — 블로그에 바로 올릴 수 있게 네이버 본문 폭(882px)으로
//
//   node scripts/shot-gu.mjs 노원구
//   node scripts/shot-gu.mjs 노원구 강서구 성북구      여러 곳
//   node scripts/shot-gu.mjs --all                   25개 구 전부(오래 걸립니다)
//
// 저장 위치 — 바탕화면 「진가 블로그 발행본\연재\사진_<자치구>\」
//   2_주차.png       주차 넉넉한 / 빠듯한 단지 (국토부 공식 자료)
//   3_단지.png       그 구에서 주차가 가장 빠듯한 단지 한 곳
//   4_검색결과.png   앱에서 그 구로 검색한 BEST 5 + 지도
//
// 왜 882px 인가 — 네이버 본문이 쓸 수 있는 폭이 최대 966px 입니다. 더 크게 찍으면
// 네이버가 줄여서 글씨가 뭉개집니다(처음에 1,180px 로 찍었다가 다시 찍었습니다).
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { GU_ORDER } from './_post.mjs';
import { guPath, aptPath, parkPerHouse, sourcesAgree } from './_pages.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUB = path.join(ROOT, 'site', 'public');
const SITE = 'https://jinga-retech.vercel.app';
const OUT_BASE = path.join(process.env.USERPROFILE || process.env.HOME || ROOT,
  'OneDrive', '바탕 화면', '진가 블로그 발행본', '연재');
const W = 882;
const PORT = 9352;

const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
                'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(p => fs.existsSync(p));
const wait = ms => new Promise(r => setTimeout(r, ms));
const log = m => console.log(`[${new Date().toLocaleTimeString('ko-KR', { hour12: false })}] ${m}`);

/** 그 구에서 주차가 가장 빠듯한 단지 — 글의 「빠듯한 곳」과 같은 단지를 보여 주려고 */
export function tightestApt(gu) {
  const kb = JSON.parse(fs.readFileSync(path.join(PUB, 'kb-seoul-complexes.json'), 'utf8'));
  const kapt = JSON.parse(fs.readFileSync(path.join(PUB, 'kapt-seoul.json'), 'utf8')).byComplex || {};
  // 글의 「빠듯한 곳」과 같은 규칙으로 고릅니다 — 두 자료가 엇갈리는 단지는 사진으로도 짚지 않습니다
  let kbPark = {};
  try { kbPark = JSON.parse(fs.readFileSync(path.join(PUB, 'kb-seoul-parking.json'), 'utf8')).byComplex || {}; } catch { /* 없으면 K-apt 만 */ }
  const rows = kb.complexes
    .filter(c => c[2] === gu)
    .map(c => ({ id: c[0], name: c[1], k: kapt[String(c[0])], kbPer: (kbPark[String(c[0])] || {}).per }))
    .filter(r => r.k)
    .map(r => ({ ...r, per: parkPerHouse(r.k, r.k.households) }))
    .filter(r => r.per != null && sourcesAgree(r.per, r.kbPer) !== false)
    .sort((a, b) => a.per - b.per);
  return rows[0] || null;
}

async function connect() {
  if (!CHROME) throw new Error('Chrome 을 찾지 못했습니다');
  // 창을 띄우고 씁니다(--headless 를 붙이면 안 띄웁니다).
  // KB(api.kbland.kr)가 헤드리스 크롬 연결을 끊어 버립니다 — net::ERR_CONNECTION_RESET.
  // 그래서 4_검색결과.png 만 조용히 실패했습니다(2026-10-30 에 확인). 진짜 창이면 그대로 됩니다.
  // 사람이 쓰는 화면과 같은 경로라, 창이 잠깐 떠 있는 동안 건드리지 마세요.
  const headless = process.argv.includes('--headless');
  const chrome = spawn(CHROME, [...(headless ? ['--headless=new'] : []), `--remote-debugging-port=${PORT}`, '--disable-gpu',
    '--hide-scrollbars', '--window-size=1200,1000',
    '--user-data-dir=' + (process.env.TEMP || '/tmp') + '/jinga-shotgu', '--no-first-run', 'about:blank'],
    { stdio: 'ignore' });
  const get = async p => {
    for (let i = 0; i < 60; i++) { try { return await (await fetch(`http://127.0.0.1:${PORT}${p}`)).json(); } catch { await wait(300); } }
    throw new Error('Chrome 에 붙지 못했습니다');
  };
  const target = (await get('/json/list')).find(t => t.type === 'page');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(r => { ws.onopen = r; });
  let id = 0; const pending = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: 1200, deviceScaleFactor: 1, mobile: false });
  return { send, close: () => { try { ws.close(); } catch {} chrome.kill(); } };
}

const evaluate = async (send, expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  return r.result && r.result.result ? r.result.result.value : null;
};

/** 페이지의 한 구간만 잘라 찍기 — rect 는 문서 기준 좌표 */
async function shotRect(send, rect, file, pad = 14) {
  if (!rect || !(rect.height > 0)) return false;
  const clip = {
    x: 0, y: Math.max(0, rect.top - pad),
    // 아래쪽에는 여백을 더하지 않습니다 — 더하면 다음 제목 윗부분이 잘려 들어옵니다(실제로 그랬습니다)
    width: W, height: Math.min(rect.height + pad, 4200), scale: 1,
  };
  const r = await send('Page.captureScreenshot', { format: 'png', clip, captureBeyondViewport: true });
  if (!r.result || !r.result.data) return false;
  fs.writeFileSync(file, Buffer.from(r.result.data, 'base64'));
  return true;
}

/** 제목(h1/h2) 글자로 구간을 찾습니다 — 정적 페이지에는 id 가 없어서 */
const RANGE_FN = `(function(from, to){
  var hs = Array.prototype.slice.call(document.querySelectorAll('h1,h2'));
  var a = null, b = null, i;
  for (i = 0; i < hs.length; i++) { if (!a && hs[i].textContent.indexOf(from) >= 0) { a = hs[i]; continue; } if (a && to && !b && hs[i].textContent.indexOf(to) >= 0) b = hs[i]; }
  if (!a) return null;
  var top = a.getBoundingClientRect().top + window.scrollY;
  var end = b ? b.getBoundingClientRect().top + window.scrollY
              : document.querySelector('main').getBoundingClientRect().bottom + window.scrollY;
  return { top: top, height: end - top };
})`;

/** 앱에서 그 구로 검색해 결과+지도를 찍습니다 */
const SEARCH_FN = gu => `(async function(){
  document.querySelectorAll('.quicknav').forEach(function(e){ e.style.display='none'; });
  var clear = document.querySelector('.clear');
  if (clear) clear.click();
  var chip = Array.prototype.slice.call(document.querySelectorAll('[data-v]'))
    .find(function(b){ return b.dataset.v === ${JSON.stringify(gu)}; });
  if (!chip) return 'chip-missing';
  if (!chip.classList.contains('on')) chip.click();
  await new Promise(function(r){ setTimeout(r, 400); });
  document.getElementById('sSearchBtn').click();
  for (var i = 0; i < 120; i++) {
    await new Promise(function(r){ setTimeout(r, 500); });
    if (document.querySelectorAll('#sAlbumRow .al-card').length) break;
  }
  await new Promise(function(r){ setTimeout(r, 3500); });
  var res = document.getElementById('sResults');
  var box = res.getBoundingClientRect();
  return { top: box.top + window.scrollY, height: box.height };
})()`;

async function shootGu(send, gu) {
  const outDir = path.join(OUT_BASE, `사진_${gu}`);
  fs.mkdirSync(outDir, { recursive: true });
  const made = [];

  // ── 1·2) 구 페이지
  await send('Page.navigate', { url: `${SITE}${guPath(gu)}` });
  await wait(2200);
  const title = await evaluate(send, 'document.title');
  if (!title || /404|not found/i.test(title)) { log(`  ${gu}: 구 페이지가 없습니다`); return made; }

  // 1_평당가.png — 2026-11-19 에 KB 평당가를 내리면서 찍을 것이 없어 뺐다가,
  // 2026-11-20 에 **국토교통부 실거래 평당가**로 그 자리가 되살아나 다시 찍습니다.
  // 사진에 찍히는 숫자는 이제 **실거래 중앙값**입니다 — 글 본문이 KB 시세를 쓰고 있으면 둘이 어긋나 보입니다.
  const r1 = await evaluate(send, `${RANGE_FN}(${JSON.stringify(gu)}, '주차가')`);
  if (await shotRect(send, r1, path.join(outDir, '1_평당가.png'))) made.push('1_평당가.png');

  const r2 = await evaluate(send, `${RANGE_FN}('주차가', '세대수가 많은')`);
  if (await shotRect(send, r2, path.join(outDir, '2_주차.png'))) made.push('2_주차.png');

  // ── 3) 그 구에서 주차가 가장 빠듯한 단지
  const apt = tightestApt(gu);
  if (apt) {
    await send('Page.navigate', { url: SITE + aptPath(apt) });
    await wait(2000);
    const r3 = await evaluate(send, `${RANGE_FN}(${JSON.stringify(apt.name)}, '면적대별')`);
    if (await shotRect(send, r3, path.join(outDir, '3_단지.png'))) made.push(`3_단지.png (${apt.name} 세대당 ${apt.per}대)`);
  }

  // ── 4) 앱에서 그 구로 검색 (느립니다 — KB 조회를 실제로 합니다)
  await send('Page.navigate', { url: SITE + '/' });
  await wait(4000);
  const r4 = await evaluate(send, SEARCH_FN(gu));
  if (r4 && r4.height) {
    if (await shotRect(send, r4, path.join(outDir, '4_검색결과.png'))) made.push('4_검색결과.png');
  } else {
    log(`  ${gu}: 검색 결과를 못 찍었습니다(${r4 || '응답 없음'}) — 나머지는 찍혔습니다`);
  }

  return made;
}

async function main() {
  const args = process.argv.slice(2);
  const list = args.includes('--all') ? GU_ORDER : args.filter(a => GU_ORDER.includes(a));
  if (!list.length) {
    console.log('쓰는 법: node scripts/shot-gu.mjs <자치구…> | --all');
    console.log('자치구: ' + GU_ORDER.join(' '));
    const bad = args.filter(a => !GU_ORDER.includes(a) && a !== '--all' && a !== '--headless');
    if (bad.length) console.log('모르는 이름: ' + bad.join(' '));
    return;
  }

  const t0 = Date.now();
  const { send, close } = await connect();
  try {
    for (const gu of list) {
      log(`${gu} 찍는 중…`);
      const made = await shootGu(send, gu);
      log(`  → ${made.length}장: ${made.join(' · ') || '없음'}`);
    }
  } finally { close(); }
  log(`끝 — ${list.length}개 구 · ${Math.round((Date.now() - t0) / 1000)}초`);
  log(`저장 위치: ${OUT_BASE}\\사진_<자치구>\\`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error('실패:', e.message); process.exit(1); });
}
