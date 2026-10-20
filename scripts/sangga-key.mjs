// 소상공인시장진흥공단 상가(상권)정보 API 인증키 입력 → .secrets/sangga.json 에 저장(git 제외)
//   scripts\sangga-key.cmd   (또는 node scripts/sangga-key.mjs)
//
// 키 받는 곳 — 공공데이터포털 data.go.kr
//   1) 로그인 → 「소상공인시장진흥공단_상가(상권)정보」 검색
//   2) 오픈 API 탭 → 활용신청(자동 승인, 무료)
//   3) 마이페이지 > 데이터활용 > 개발계정 > 일반 인증키(Decoding) 복사
// 이 키는 서버에서만 쓰고(수집 스크립트), 사이트에는 결과 숫자만 올라갑니다.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRET = path.join(ROOT, '.secrets', 'sangga.json');
export const BASE = 'https://apis.data.go.kr/B553077/api/open/sdsc2';

/**
 * 인증키를 주소에 넣을 형태로 — 포털이 Decoding·Encoding 두 가지를 주는데 어느 쪽을 붙여넣어도 되게 맞춥니다.
 * 이미 %2B 처럼 인코딩된 키를 또 인코딩하면 %252B 가 돼 「등록되지 않은 키」로 거부당합니다.
 */
export function encodeKey(key) {
  const k = String(key || '').trim();
  try { return encodeURIComponent(decodeURIComponent(k)); } catch { return encodeURIComponent(k); }
}

/** 반경 안 상가 목록 주소 — 소상공인 상가정보 storeListInRadius */
export const radiusUrl = (key, { lat, lng, radius = 300, page = 1, rows = 1000 }) =>
  `${BASE}/storeListInRadius?serviceKey=${encodeKey(key)}&radius=${radius}&cx=${lng}&cy=${lat}&type=json&numOfRows=${rows}&pageNo=${page}`;

/** 키가 실제로 동작하는지 — 서울시청 둘레 100m 로 한 번 불러 봅니다 */
export async function checkKey(key, fetchImpl = (...a) => fetch(...a)) {
  try {
    const r = await fetchImpl(radiusUrl(key, { lat: 37.5663, lng: 126.9779, radius: 100, rows: 10 }), { signal: AbortSignal.timeout(20000) });
    const text = await r.text();
    if (/SERVICE_KEY_IS_NOT_REGISTERED|SERVICE_KEY_IS_NULL|등록되지 않은/.test(text)) return { ok: false, reason: '등록되지 않은 키입니다(활용신청 승인 여부 확인)' };
    if (/LIMITED_NUMBER_OF_SERVICE_REQUESTS/.test(text)) return { ok: false, reason: '오늘 호출 한도를 다 썼습니다' };
    let j;
    try { j = JSON.parse(text); } catch { return { ok: false, reason: `응답이 JSON 이 아닙니다: ${text.slice(0, 80)}` }; }
    const items = j && j.body && j.body.items;
    if (!Array.isArray(items)) return { ok: false, reason: `형식이 예상과 다릅니다: ${text.slice(0, 120)}` };
    return { ok: true, note: `서울시청 둘레 100m 에서 ${items.length}곳 확인`, sample: items[0] || null };
  } catch (e) {
    return { ok: false, reason: `연결하지 못했습니다: ${e.message}` };
  }
}

function ask(question, { hidden = false } = {}) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  return new Promise(resolve => {
    if (hidden) {
      const onData = () => { rl.output.write('\x1B[2K\x1B[200D' + question); };
      rl.input.on('data', onData);
      rl.question(question, a => { rl.input.off('data', onData); rl.output.write('\n'); rl.close(); resolve(a.trim()); });
    } else {
      rl.question(question, a => { rl.close(); resolve(a.trim()); });
    }
  });
}

export async function main() {
  console.log('\n── 소상공인 상가(상권)정보 인증키 등록 ──────────────────');
  console.log('공공데이터포털(data.go.kr) 로그인 → 「소상공인시장진흥공단_상가(상권)정보」');
  console.log('  → 오픈 API 활용신청(자동 승인) → 마이페이지 > 개발계정 > 「일반 인증키(Decoding)」 복사');
  console.log('입력한 키는 화면에 보이지 않습니다.\n');

  const key = await ask('인증키(Decoding): ', { hidden: true });
  if (!key) { console.log('입력이 없어 그만둡니다.'); return; }
  process.stdout.write('공공데이터포털에 확인하는 중… ');
  const check = await checkKey(key);
  console.log(check.ok ? `확인됨(${check.note})` : `확인 실패 — ${check.reason}`);
  if (check.ok && check.sample) {
    const s = check.sample;
    console.log(`  예: ${s.bizesNm || '(상호 없음)'} · ${s.indsLclsNm || ''} > ${s.indsMclsNm || ''}`);
  }
  if (!check.ok) {
    const go = await ask('그래도 저장할까요? (y/N): ');
    if (go.toLowerCase() !== 'y') { console.log('그만둡니다.'); return; }
  }
  fs.mkdirSync(path.dirname(SECRET), { recursive: true });
  fs.writeFileSync(SECRET, JSON.stringify({ key, savedAt: new Date().toISOString() }, null, 2));
  console.log('\n저장했습니다 — .secrets/sangga.json (깃 제외)');
  console.log('이제 수집하면 됩니다:  npm run kb:sangga   그리고  npm run kb:sangga:gyeonggi\n');
}

/** 저장해 둔 키 읽기 — 수집 스크립트가 씁니다 */
export function loadKey() {
  try { return JSON.parse(fs.readFileSync(SECRET, 'utf8')).key || null; } catch { return null; }
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (invokedDirectly) main().catch(e => { console.error('[상가 키] 실패:', e.message); process.exit(1); });
