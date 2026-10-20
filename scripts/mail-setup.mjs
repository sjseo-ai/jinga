// 보내는 메일 설정 — Gmail(앱 비밀번호) 또는 네이버 메일. 로그인 확인·시험 메일 발송 후 .secrets/jinga-mail.json 에 저장
//   .\scripts\mail-setup.cmd  (VS Code 터미널)
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { ROOT, readMailConfig, writeMailConfig, createTransport, fromHeader, providerFor, PROVIDERS, SECRET_FILE } from './mail-lib.mjs';

// 진행 기록 — 실패 원인을 화면을 옮겨 적지 않아도 확인할 수 있게 reports/mail-setup.log 에 남김(비밀번호 값은 절대 기록하지 않고 길이만)
const SETUP_LOG = path.join(ROOT, 'reports', 'mail-setup.log');
function note(msg) {
  try {
    fs.mkdirSync(path.dirname(SETUP_LOG), { recursive: true });
    fs.appendFileSync(SETUP_LOG, `[${new Date().toLocaleString('ko-KR', { hour12: false })}] ${msg}\n`);
  } catch { /* 기록 실패는 설정 진행에 영향 없음 */ }
}
const errText = e => [e && e.code, e && e.responseCode, (e && (e.response || e.message)) || String(e)].filter(Boolean).join(' · ');
note('===== 메일 설정 시작');

function ask(question, { mute = false } = {}) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (mute) rl._writeToOutput = s => { if (s.includes(question)) process.stdout.write(question); };   // 입력 글자를 화면에 표시하지 않음
    rl.question(question, answer => {
      rl.close();
      if (mute) process.stdout.write('\n');
      resolve(answer);
    });
  });
}

const GUIDE = {
  gmail: [
    '[Gmail 준비]',
    ' 1) https://myaccount.google.com/security 에서 "2단계 인증"을 켭니다.',
    ' 2) https://myaccount.google.com/apppasswords 에서 앱 이름(예: 진가)을 넣고 16자리 앱 비밀번호를 만듭니다.',
    '    (브라우저 오른쪽 위 프로필이 보내는 Gmail 계정과 같은지 확인)',
  ],
  naver: [
    '[네이버 메일 준비]',
    ' 1) 네이버 메일 → 환경설정 → POP3/IMAP 설정 → "IMAP/SMTP 사용"을 "사용함"으로 저장합니다.',
    ' 2) 네이버 2단계 인증을 쓴다면: 네이버 내정보 → 보안설정 → 2단계 인증 → "애플리케이션 비밀번호"를 새로 만들어 입력합니다.',
    '    2단계 인증을 쓰지 않는다면: 네이버 로그인 비밀번호를 입력합니다.',
  ],
};
const FAIL_HINTS = {
  gmail: [
    ' 1) 앱 비밀번호를 만든 Google 계정과 위 주소가 같은지',
    ' 2) "2단계 인증"이 켜져 있는지',
    ' 3) Google 비밀번호를 바꾼 적이 있다면 앱 비밀번호를 새로 만들기',
    ' 4) 회사(Google Workspace) 주소라면 관리자가 앱 비밀번호를 막았을 수 있음',
  ],
  naver: [
    ' 1) 네이버 메일 환경설정의 "IMAP/SMTP 사용"(또는 POP3/SMTP 사용)이 "사용함"으로 저장됐는지',
    ' 2) 2단계 인증을 쓰면 로그인 비밀번호가 아니라 "애플리케이션 비밀번호"를 넣었는지',
    ' 3) 네이버에서 "새로운 기기/해외 로그인 차단" 알림이 왔다면 허용 후 다시 시도',
    ' 4) 비밀번호를 최근 바꿨다면 새 비밀번호(또는 새 애플리케이션 비밀번호)로',
  ],
};

const cfg = readMailConfig();
console.log('=== 진가 주간 보고서 메일 설정 ===');
console.log('보내는 메일은 Gmail(@gmail.com) 또는 네이버(@naver.com) 주소를 쓸 수 있습니다.');
console.log('');
const user = ((await ask(`보내는 메일 주소${cfg.senderUser ? ` [${cfg.senderUser}]` : ''}: `)).trim() || cfg.senderUser || '').toLowerCase();
const provider = providerFor(user);
note(`입력 주소: ${user || '(빈칸)'} → 서비스: ${provider || '지원 안 함'}`);
if (!provider) { console.log('Gmail(@gmail.com) 또는 네이버(@naver.com) 주소만 지원합니다.'); process.exit(1); }
console.log('');
GUIDE[provider].forEach(l => console.log(l));
console.log('');
const label = provider === 'gmail' ? '앱 비밀번호 16자리' : '비밀번호(2단계 인증 사용 시 애플리케이션 비밀번호)';
const raw = await ask(`${label} — 입력해도 화면에 보이지 않습니다: `, { mute: true });
let pass = provider === 'gmail' ? raw.replace(/\s+/g, '') : raw.trim();
if (!pass && cfg.senderUser === user) pass = cfg.senderPass;   // 같은 계정이면 Enter 만 눌러 기존 비밀번호 유지
note(`비밀번호 입력 길이: 원문 ${raw.length}자 → 사용 ${pass ? pass.length : 0}자${/\s/.test(raw.trim()) ? ' (중간 띄어쓰기 있음)' : ''}`);
if (!pass) {
  console.log('비밀번호가 비어 있습니다. 붙여넣기가 안 됐을 수 있어요 — 입력 칸에서 마우스 오른쪽 클릭으로 붙여넣은 뒤 Enter 를 눌러 주세요.');
  process.exit(1);
}
if (provider === 'gmail' && pass.length !== 16) { console.log('Gmail 앱 비밀번호는 16자리입니다(띄어쓰기는 넣어도 되고 빼도 됩니다).'); process.exit(1); }
if (!cfg.adminSecret) { console.log('관리 키가 없습니다(.secrets/jinga-mail.json) — 진가 담당자에게 요청하세요.'); process.exit(1); }

// 네이버 SMTP는 로그인 아이디를 전체 주소로 받는 경우와 아이디만 받는 경우가 있어 둘 다 시도
const authUsers = provider === 'naver' ? [user, user.split('@')[0]] : [user];
let next = null, lastErr = null;
for (const authUser of authUsers) {
  const candidate = {
    siteUrl: cfg.siteUrl || 'https://jinga-retech.vercel.app', adminSecret: cfg.adminSecret,
    provider, senderUser: user, senderPass: pass, smtpAuthUser: authUser,
  };
  try {
    console.log(`${PROVIDERS[provider].label} 로그인 확인 중… (로그인 아이디: ${authUser})`);
    const tx = await createTransport(candidate);
    await tx.verify();
    note(`로그인 성공 — 로그인 아이디 ${authUser}`);
    next = candidate;
    break;
  } catch (e) {
    note(`로그인 실패 — 로그인 아이디 ${authUser}: ${errText(e)}`);
    lastErr = e;
  }
}
if (!next) {
  console.log(`\n${PROVIDERS[provider].label} 로그인 실패: ${lastErr && lastErr.message}`);
  console.log(`로그인 시도 계정: ${user} (입력한 비밀번호 ${pass.length}자리)`);
  console.log('아래를 확인해 주세요.');
  FAIL_HINTS[provider].forEach(l => console.log(l));
  console.log('설정은 저장하지 않았습니다. 확인 후 .\\scripts\\mail-setup.cmd 를 다시 실행하세요.');
  process.exit(1);
}
try {
  const tx = await createTransport(next);
  await tx.sendMail({ from: fromHeader(next), to: user, subject: '[진가] 메일 발송 설정 완료', text: `진가 주간 보고서 메일 발송이 설정되었습니다.\n보내는 계정: ${user} (${PROVIDERS[provider].label})\n사이트: ${next.siteUrl}` });
} catch (e) {
  note(`시험 메일 발송 실패: ${errText(e)}`);
  console.log(`로그인은 됐지만 시험 메일 발송에 실패했습니다: ${e.message}`);
  console.log('설정은 저장하지 않았습니다.');
  process.exit(1);
}
note('시험 메일 발송 성공 — 설정 저장');
writeMailConfig(next);
console.log(`\n설정 저장 완료 (${SECRET_FILE}) — ${user} 로 시험 메일을 보냈습니다. 받은편지함을 확인해 주세요.`);
