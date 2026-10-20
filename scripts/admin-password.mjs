// 관리자 페이지 비밀번호 정하기 — 직접 입력(화면에 표시되지 않음). 서버에는 비밀번호가 아니라 scrypt 해시만 저장됩니다.
//   .\scripts\admin-password.cmd   (VS Code 터미널, jinga-project 폴더)
// 새로 정하면 이전 로그인(다른 기기 포함)은 모두 풀립니다. 비밀번호를 잊었을 때도 이걸로 다시 정하면 됩니다.
import readline from 'node:readline';
import { readMailConfig } from './mail-lib.mjs';

function ask(question) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = s => { if (s.includes(question)) process.stdout.write(question); };   // 입력 글자를 화면에 표시하지 않음
    rl.question(question, answer => { rl.close(); process.stdout.write('\n'); resolve(answer); });
  });
}

const cfg = readMailConfig();
if (!cfg.adminSecret || !cfg.siteUrl) {
  console.log('관리 키가 없습니다(.secrets/jinga-mail.json) — 진가 담당자에게 요청하세요.');
  process.exit(1);
}
console.log('=== 진가 관리자 페이지 비밀번호 정하기 ===');
console.log(`관리자 페이지: ${cfg.siteUrl}/admin`);
console.log('8자 이상으로 정하세요. 입력해도 화면에 보이지 않습니다(붙여넣기는 마우스 오른쪽 클릭).');
console.log('');
const pw = await ask('새 비밀번호: ');
if (pw.length < 8) { console.log('8자 이상이어야 합니다. 설정하지 않았습니다.'); process.exit(1); }
if (pw.trim() !== pw) console.log('(참고: 앞뒤에 띄어쓰기가 들어 있습니다 — 로그인할 때도 똑같이 입력해야 합니다)');
const again = await ask('한 번 더 입력: ');
if (again !== pw) { console.log('두 번 입력한 비밀번호가 다릅니다. 설정하지 않았습니다.'); process.exit(1); }

try {
  const r = await fetch(`${cfg.siteUrl}/api/admin-login`, {
    method: 'POST', signal: AbortSignal.timeout(30000),
    headers: { Authorization: `Bearer ${cfg.adminSecret}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'set', password: pw }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) throw new Error(j.error || `서버 응답 ${r.status}`);
  console.log(`\n설정 완료 — ${cfg.siteUrl}/admin 에서 이 비밀번호로 로그인하세요. 이전 로그인은 모두 풀렸습니다.`);
} catch (e) {
  console.log(`\n설정하지 못했습니다: ${e.message}`);
  process.exit(1);
}
