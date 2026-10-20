// 카카오맵 JavaScript 키 입력 → .secrets/kakao.json 에 보관하고 site/public/map-key.json 으로 내보냄
//   scripts\kakao-key.cmd  (또는 node scripts/kakao-key.mjs)
//
// 카카오맵 JavaScript 키는 브라우저가 직접 들고 지도를 부르는 「공개용」 키입니다(숨길 수 없습니다).
// 대신 카카오 콘솔에 등록한 도메인에서만 동작하므로, 반드시 플랫폼 > Web 에 아래 주소를 등록하세요.
//   https://jinga-retech.vercel.app      (운영)
//   http://localhost:5173                (로컬에서 열어 볼 때, 쓰는 포트로)
// 키 자체는 깃에 올리지 않으려고 .secrets/(git 제외)에 두고, 배포되는 site/public/map-key.json 으로만 내보냅니다.
// 이 파일도 .gitignore 에 넣어 두었습니다 — 키를 바꾸면 이 명령을 다시 실행하고 재배포하면 됩니다.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRET = path.join(ROOT, '.secrets', 'kakao.json');
const PUBLIC = path.join(ROOT, 'site', 'public', 'map-key.json');
const SDK = key => `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(key)}&autoload=false`;

/** 입력한 값이 JavaScript 키 모양인지 — 32자리 소문자·숫자 */
export const looksLikeKey = k => /^[0-9a-f]{32}$/.test(String(k || '').trim());

/** 키가 실제로 동작하는지 — SDK 주소를 불러 봅니다(도메인 제한 때문에 여기서는 형식만 확인 가능) */
export async function checkKey(key, fetchImpl = (...a) => fetch(...a)) {
  try {
    const r = await fetchImpl(SDK(key), { headers: { Referer: 'https://jinga-retech.vercel.app/' }, signal: AbortSignal.timeout(15000) });
    const body = await r.text();
    if (!r.ok) return { ok: false, reason: `카카오 응답 HTTP ${r.status}` };
    if (/app_key|not exist|invalid/i.test(body) && !/kakao\.maps/.test(body)) return { ok: false, reason: '카카오가 키를 인정하지 않습니다(키 확인 필요)' };
    return { ok: true, note: body.length > 1000 ? 'SDK 스크립트를 정상으로 받았습니다' : '응답을 받았습니다' };
  } catch (e) {
    return { ok: false, reason: `카카오에 연결하지 못했습니다: ${e.message}` };
  }
}

function ask(question, { hidden = false } = {}) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  return new Promise(resolve => {
    if (hidden) {
      // 화면에 키가 찍히지 않도록(어깨너머·화면 공유 대비)
      const onData = () => { rl.output.write('\x1B[2K\x1B[200D' + question); };
      rl.input.on('data', onData);
      rl.question(question, a => { rl.input.off('data', onData); rl.output.write('\n'); rl.close(); resolve(a.trim()); });
    } else {
      rl.question(question, a => { rl.close(); resolve(a.trim()); });
    }
  });
}

export async function main() {
  console.log('\n── 카카오맵 JavaScript 키 등록 ──────────────────────────');
  console.log('먼저 developers.kakao.com 에서 앱을 만들고,');
  console.log('  [앱 설정] > [앱 키] 의 JavaScript 키를 복사한 뒤');
  console.log('  [앱 설정] > [플랫폼] > Web 에 https://jinga-retech.vercel.app 을 등록해 주세요.');
  console.log('입력한 키는 화면에 보이지 않습니다.\n');

  const key = await ask('JavaScript 키(32자리): ', { hidden: true });
  if (!key) { console.log('입력이 없어 그만둡니다.'); return; }
  if (!looksLikeKey(key)) {
    console.log('⚠ JavaScript 키는 보통 32자리 소문자·숫자입니다. REST API 키나 네이티브 키를 넣지 않았는지 확인해 주세요.');
    const go = await ask('그래도 저장할까요? (y/N): ');
    if (go.toLowerCase() !== 'y') { console.log('그만둡니다.'); return; }
  }
  process.stdout.write('카카오에 확인하는 중… ');
  const check = await checkKey(key);
  console.log(check.ok ? `확인됨(${check.note})` : `확인 실패 — ${check.reason}`);
  if (!check.ok) {
    const go = await ask('그래도 저장할까요? (y/N): ');
    if (go.toLowerCase() !== 'y') { console.log('그만둡니다.'); return; }
  }

  fs.mkdirSync(path.dirname(SECRET), { recursive: true });
  const saved = { key, savedAt: new Date().toISOString(), domains: ['https://jinga-retech.vercel.app'] };
  fs.writeFileSync(SECRET, JSON.stringify(saved, null, 2));
  fs.writeFileSync(PUBLIC, JSON.stringify({ provider: 'kakao', key, savedAt: saved.savedAt }));
  console.log(`\n저장했습니다 — .secrets/kakao.json (깃 제외) · site/public/map-key.json (배포용)`);
  console.log('이제 배포하면 지도가 카카오맵으로 바뀝니다:  node scripts/deploy-vercel.mjs');
  console.log('지도가 안 보이면 카카오 콘솔의 플랫폼 > Web 도메인이 https://jinga-retech.vercel.app 인지 확인해 주세요.\n');
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (invokedDirectly) main().catch(e => { console.error('[카카오 키] 실패:', e.message); process.exit(1); });
