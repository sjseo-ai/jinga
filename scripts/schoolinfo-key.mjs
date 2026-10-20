// 학교알리미 Open API 인증키 저장 — 직접 입력(화면에 표시되지 않음) → .secrets/schoolinfo.json (git 제외)
//   .\scripts\schoolinfo-key.cmd   (또는 node scripts/schoolinfo-key.mjs)
// 저장 전에 학교알리미에 한 번 호출해(서울 종로구 중학교 기본정보) 키가 정상인지 확인합니다. 키 값은 화면·로그에 남기지 않습니다.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEST = path.join(ROOT, '.secrets', 'schoolinfo.json');

function ask(question, hidden = true) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) rl._writeToOutput = s => { if (s.includes(question)) process.stdout.write(question); };   // 입력 글자를 화면에 표시하지 않음
    rl.question(question, answer => { rl.close(); if (hidden) process.stdout.write('\n'); resolve(answer); });
  });
}

/** 학교알리미 호출로 키 확인 → { ok, count, message } */
export async function verifyKey(apiKey, fetchImpl = fetch) {
  const url = `https://www.schoolinfo.go.kr/openApi.do?${new URLSearchParams({ apiKey, apiType: '0', sidoCode: '11', sggCode: '11110', schulKndCode: '03' })}`;
  const r = await fetchImpl(url, { signal: AbortSignal.timeout(30000), headers: { Accept: 'application/json' } });
  const text = await r.text();
  let j = null;
  try { j = JSON.parse(text); } catch { /* HTML 오류 페이지 등 */ }
  const list = j && Array.isArray(j.list) ? j.list : null;
  if (j && String(j.resultCode).toLowerCase() === 'success' && list) return { ok: true, count: list.length, message: j.resultMsg || '성공' };
  return { ok: false, count: 0, message: (j && (j.resultMsg || j.resultCode)) || `응답 ${r.status}: ${text.replace(/\s+/g, ' ').slice(0, 120)}` };
}

const mask = k => (k.length > 8 ? `${k.slice(0, 4)}…${k.slice(-2)} (${k.length}자)` : `(${k.length}자)`);

async function main() {
  console.log('=== 학교알리미 Open API 인증키 저장 ===');
  console.log('학교알리미 → 알리미 소식 → OpenAPI → 나의 정보 조회 에 있는 인증키를 붙여넣으세요.');
  console.log('입력해도 화면에 보이지 않습니다(붙여넣기는 마우스 오른쪽 클릭 또는 Ctrl+V).');
  if (fs.existsSync(DEST)) console.log('(이미 저장된 키가 있습니다 — 새로 입력하면 바꿔 씁니다)');
  console.log('');
  const key = (await ask('인증키: ')).trim();
  if (!key) { console.log('입력이 없어 저장하지 않았습니다.'); return 1; }
  if (/\s/.test(key)) { console.log('키 중간에 띄어쓰기가 있습니다. 다시 복사해 주세요. 저장하지 않았습니다.'); return 1; }

  console.log(`\n받은 키 ${mask(key)} — 학교알리미에 확인 중…`);
  let check;
  try { check = await verifyKey(key); }
  catch (e) { check = { ok: false, count: 0, message: `연결 실패: ${e.message}`, network: true }; }

  if (!check.ok) {
    console.log(`확인 실패: ${check.message}`);
    console.log('공공데이터포털(data.go.kr)에서 받은 키라면 학교알리미 주소로는 확인되지 않을 수 있습니다.');
    const yes = (await ask('그래도 저장할까요? (y/N): ', false)).trim().toLowerCase();
    if (yes !== 'y') { console.log('저장하지 않았습니다.'); return 1; }
  } else {
    console.log(`확인 완료 — 서울 종로구 중학교 ${check.count}곳 조회됨`);
  }

  fs.mkdirSync(path.dirname(DEST), { recursive: true });
  fs.writeFileSync(DEST, JSON.stringify({ apiKey: key, verified: !!check.ok, savedAt: new Date().toISOString() }, null, 2));
  console.log(`\n저장했습니다 → .secrets/schoolinfo.json (git에 올라가지 않음)`);
  console.log('이제 이 창은 닫고, Claude에게 「저장했어」라고만 알려 주세요.');
  return 0;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (invokedDirectly) {
  main().then(code => { process.exitCode = code; }).catch(e => { console.error('실패:', e.message); process.exitCode = 1; });
}
