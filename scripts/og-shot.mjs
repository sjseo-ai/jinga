// 공유 카드 전용 캡처 — 창 크기와 상관없이 정확히 원하는 픽셀로 잘라 찍습니다
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
                'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(p => fs.existsSync(p));
if (!CHROME) { console.error('Chrome 을 찾지 못했습니다'); process.exit(1); }

const [URL_, OUT, W = 1200, H = 630] = process.argv.slice(2);
const PORT = 9341;
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, '--disable-gpu',
  '--window-size=1400,900', '--hide-scrollbars',
  '--user-data-dir=' + process.env.TEMP + '/jinga-og', '--no-first-run', URL_], { stdio: 'ignore' });

const wait = ms => new Promise(r => setTimeout(r, ms));
const get = async path => { for (let i = 0; i < 40; i++) { try { return await (await fetch(`http://127.0.0.1:${PORT}${path}`)).json(); } catch { await wait(300); } } throw new Error('CDP 연결 실패'); };
const target = (await get('/json/list')).find(t => t.type === 'page');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(r => { ws.onopen = r; });
let id = 0; const pending = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });

// 보이는 영역을 카드 크기로 못박아 두면 레이아웃이 창 크기에 흔들리지 않습니다
await send('Emulation.setDeviceMetricsOverride', { width: +W, height: +H, deviceScaleFactor: 1, mobile: false });
await send('Page.enable');
await send('Page.navigate', { url: URL_ });
await wait(3000);   // 웹폰트가 내려올 시간

const shot = await send('Page.captureScreenshot', {
  format: 'png',
  clip: { x: 0, y: 0, width: +W, height: +H, scale: 1 },
  captureBeyondViewport: true,
});
fs.writeFileSync(OUT, Buffer.from(shot.result.data, 'base64'));
const b = fs.readFileSync(OUT);
console.log(`저장 ${OUT} — ${b.readUInt32BE(16)}×${b.readUInt32BE(20)} · ${(b.length / 1024).toFixed(0)}KB`);
ws.close(); chrome.kill();
