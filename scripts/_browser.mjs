// 브라우저 점검 뼈대 — 임시 정적 서버 + headless Chrome(CDP) 붙이기 (T009 검수 도구).
//
// 왜 따로 있나 — `npm test` 는 HTML 글자와 계산 엔진만 봅니다. **고른 값이 화면에 흘러가는지,
// 자료가 실제로 내려오는지, 눌렀을 때 숫자가 나오는지는 브라우저가 아니면 알 수 없습니다.**
// Chrome 이 필요하므로 `npm test` 에는 넣지 않습니다(CI 에서 깨지면 안 되니까).
//
// 이 파일에는 **점검 내용이 없습니다** — 서버·브라우저를 붙였다 떼는 일만 합니다.
// 실제 점검은 `check-decision.mjs`(/decision), `check-home.mjs`(첫 화면) 가 각각 적습니다.
// 두 점검기가 같은 뼈대를 쓰므로, 한쪽에서 고친 붙이기 방식이 다른 쪽에도 그대로 적용됩니다.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';

export const wait = ms => new Promise(r => setTimeout(r, ms));

export const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(p => fs.existsSync(p));

const TYPE = {
  '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json; charset=utf-8', '.ico': 'image/x-icon',
};

/**
 * 폴더를 그대로 내주는 임시 서버 — 배포 환경과 같은 절대경로(`/decision-index.json`)를 쓰기 위해.
 * 밖으로 새 나가지 않도록 폴더 밖 경로는 404 로 막습니다.
 */
export function serve(dir) {
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (!path.extname(p) && !p.endsWith('/')) p += '/';
    if (p.endsWith('/')) p += 'index.html';
    const f = path.join(dir, p);
    if (!f.startsWith(dir) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('no'); return; }
    res.writeHead(200, { 'content-type': TYPE[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r({ srv, port: srv.address().port })));
}

/**
 * Chrome 을 띄워 CDP 로 붙습니다.
 * `logs` 에 **콘솔 오류와 예외를 모읍니다** — 화면은 멀쩡해 보이면서 반쪽만 도는 일이 흔해서,
 * 하나라도 놓치면 점검이 거짓 통과를 냅니다.
 * 점검기를 동시에 돌릴 수 있도록 `port`·`profile` 을 받습니다(같이 쓰면 서로 물립니다).
 */
export async function connect({ headless = true, port = 9333, profile = 'jinga-check' } = {}) {
  if (!CHROME) throw new Error('Chrome 을 찾지 못했습니다');
  const chrome = spawn(CHROME, [...(headless ? ['--headless=new'] : []), `--remote-debugging-port=${port}`,
    '--disable-gpu', '--hide-scrollbars', '--window-size=1200,1000',
    '--user-data-dir=' + (process.env.TEMP || '/tmp') + '/' + profile, '--no-first-run', 'about:blank'],
    { stdio: 'ignore' });
  const get = async p => {
    for (let i = 0; i < 60; i++) { try { return await (await fetch(`http://127.0.0.1:${port}${p}`)).json(); } catch { await wait(300); } }
    throw new Error('Chrome 에 붙지 못했습니다');
  };
  const target = (await get('/json/list')).find(t => t.type === 'page');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(r => { ws.onopen = r; });
  let id = 0; const pending = new Map(); const logs = [];
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) {
      logs.push(`[${m.params.type}] ${(m.params.args || []).map(a => a.value ?? a.description ?? '').join(' ')}`);
    }
    if (m.method === 'Runtime.exceptionThrown') {
      logs.push(`[예외] ${m.params.exceptionDetails.text} ${m.params.exceptionDetails.exception?.description || ''}`);
    }
  };
  const send = (method, params = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Page.enable'); await send('Runtime.enable');
  return { send, logs, close: () => { try { ws.close(); } catch { /* 이미 닫힘 */ } chrome.kill(); } };
}

/** 페이지에서 식을 실행해 값을 가져옵니다. 스크립트가 터지면 조용히 null 을 주지 않고 던집니다. */
export const ev = async (send, expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result && r.result.exceptionDetails) throw new Error(`스크립트 오류: ${r.result.exceptionDetails.text}`);
  return r.result && r.result.result ? r.result.result.value : null;
};

/** 어떤 식이 참이 될 때까지 기다립니다(최대 tries × gap). 끝내 안 되면 마지막 값을 돌려줍니다. */
export async function until(send, expr, { tries = 50, gap = 200 } = {}) {
  let last = null;
  for (let i = 0; i < tries; i++) {
    last = await ev(send, expr);
    if (last) return last;
    await wait(gap);
  }
  return last;
}

/** 점검 결과 모으기 — 한 줄씩 찍고, 끝에 몇 개 통과했는지 셉니다. */
export function tally() {
  const checks = [];
  const ok = (name, pass, detail = '') => {
    checks.push({ name, pass: !!pass, detail });
    console.log(`  ${pass ? '✔' : '✘'} ${name}${detail ? ` — ${detail}` : ''}`);
  };
  const done = () => {
    const pass = checks.filter(c => c.pass).length;
    console.log(`\n${pass}/${checks.length} 통과`);
    const bad = checks.filter(c => !c.pass);
    if (bad.length) console.log('안 된 것: ' + bad.map(c => c.name).join(' · '));
    return { pass, total: checks.length, failed: bad };
  };
  return { ok, checks, done };
}
