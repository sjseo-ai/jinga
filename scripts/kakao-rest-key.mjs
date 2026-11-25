// 카카오 REST API 키 입력 → .secrets/kakao-rest.json (깃 제외)
//   .\scripts\kakao-rest-key.cmd   (또는 node scripts/kakao-rest-key.mjs)
//
// 지도 표시에 쓰는 **JavaScript 키와 다른 키**입니다. 같은 카카오 앱 안에 둘 다 있습니다.
//   https://developers.kakao.com → 내 애플리케이션 → 앱 선택 → 앱 키 → 「REST API 키」
// 이 키는 서버에서만 씁니다(단지 주소 → 좌표 변환, npm run geocode). 화면에도 배포물에도 나가지 않습니다.
// 그래서 JavaScript 키와 달리 **공개하면 안 되는 키**입니다 — .secrets/ 에만 둡니다.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRET = path.join(ROOT, '.secrets', 'kakao-rest.json');

/** REST API 키 모양 — 32자리 소문자·숫자 */
export const looksLikeKey = k => /^[0-9a-f]{32}$/.test(String(k || '').trim());

/** 실제로 주소 검색이 되는지 확인 — 키가 맞으면 서울시청 좌표가 돌아옵니다 */
export async function checkKey(key, fetchImpl = (...a) => fetch(...a)) {
  try {
    const r = await fetchImpl('https://dapi.kakao.com/v2/local/search/address.json?query=' + encodeURIComponent('서울특별시 중구 세종대로 110'), {
      headers: { Authorization: `KakaoAK ${key}` }, signal: AbortSignal.timeout(15000),
    });
    if (r.status === 401) return { ok: false, reason: '카카오가 키를 거부했습니다(401) — JavaScript 키를 넣으신 게 아닌지 확인해 주세요' };
    if (r.status === 403) return { ok: false, reason: '카카오가 권한을 거부했습니다(403) — 앱 관리 페이지에서 [카카오맵] → [사용 설정] → [상태] 를 ON 으로 바꿔 주세요(이걸 켜야 주소 검색이 열립니다)' };
    if (!r.ok) return { ok: false, reason: `카카오 응답 HTTP ${r.status}` };
    const j = await r.json();
    const d = j && j.documents && j.documents[0];
    if (!d) return { ok: false, reason: '응답은 왔지만 주소를 찾지 못했습니다' };
    return { ok: true, note: `확인됨 — 서울시청 좌표 ${Number(d.y).toFixed(4)}, ${Number(d.x).toFixed(4)}` };
  } catch (e) {
    return { ok: false, reason: `카카오에 연결하지 못했습니다: ${e.message}` };
  }
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  return new Promise(resolve => {
    // 화면에 키가 찍히지 않도록(어깨너머·화면 공유 대비)
    const onData = ch => { if (ch.toString() !== '\r' && ch.toString() !== '\n') rl.output.write(''); };
    rl.output.write(question);
    rl.input.on('data', onData);
    rl._writeToOutput = () => {};
    rl.question('', answer => { rl.input.off('data', onData); rl.output.write('\n'); rl.close(); resolve(answer.trim()); });
  });
}

async function run() {
  console.log(`
카카오 REST API 키를 넣습니다 — 단지 주소를 좌표로 바꾸는 데만 씁니다(npm run geocode).

  아직 카카오 앱이 없으면 먼저 —
    1) https://developers.kakao.com 로그인 → 개발자 계정 「회원가입」
    2) https://developers.kakao.com/console/app → 「앱 생성」
    3) 그 앱에서 [카카오맵] → [사용 설정] → [상태] ON   ← 켜야 주소 검색이 열립니다

  키 보는 곳 —
    [앱] → [플랫폼 키] → 「REST API 키」
    (지도에 쓰는 JavaScript 키와 다른 키입니다. 같은 화면에 나란히 있습니다)
`);
  const key = await ask('REST API 키 (입력해도 화면에 보이지 않습니다): ');
  if (!looksLikeKey(key)) {
    console.error('\n키 모양이 아닙니다 — 32자리 소문자·숫자여야 합니다. 다시 실행해 주세요.');
    process.exit(1);
  }
  process.stdout.write('카카오에 물어보는 중...');
  const r = await checkKey(key);
  console.log('');
  if (!r.ok) { console.error(`\n저장하지 않았습니다 — ${r.reason}`); process.exit(1); }
  console.log(r.note);
  fs.mkdirSync(path.dirname(SECRET), { recursive: true });
  fs.writeFileSync(SECRET, JSON.stringify({ restKey: key, verified: true, savedAt: new Date().toISOString() }, null, 2));
  console.log(`\n저장했습니다 → .secrets/kakao-rest.json (깃에 올라가지 않음)\n이제 npm run geocode 로 단지 좌표를 만들 수 있습니다.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().catch(e => { console.error(`실패: ${e.message}`); process.exit(1); });
}
