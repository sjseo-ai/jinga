// Vercel 환경변수 등록 — 서버(Vercel 함수)가 구독 확인·주간 보고서 메일을 보내는 데 필요한 값
//   node scripts/vercel-env.mjs      (npm run vercel:env)
// 값은 이 PC의 .secrets/jinga-mail.json 에서 읽어 Vercel(암호화 저장)에 넣고, 화면·로그에는 이름만 남깁니다.
//   JINGA_MAIL_USER · JINGA_MAIL_PASS · JINGA_MAIL_PROVIDER · JINGA_MAIL_AUTH_USER  보내는 메일 계정(mail-setup.cmd 로 확인된 값)
//   JINGA_SITE_URL                                                                메일 링크에 쓰는 사이트 주소
//   CRON_SECRET                                                                   Vercel 크론이 api/weekly 를 부를 때 쓰는 키(없으면 새로 만듦)
// 비밀번호를 바꾸면 mail-setup.cmd → 이 스크립트 → 재배포 순서로 다시 실행하세요.
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readMailConfig, writeMailConfig } from './mail-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = path.join(ROOT, 'site', 'public');   // vercel link 가 된 폴더
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const HOST_PATCH = path.join(ROOT, 'scripts', 'ascii-hostname.cjs').split(path.sep).join('/');
const env = { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --require "${HOST_PATCH}"`.trim() };
const run = (args, input = '') => spawnSync(npx, ['--yes', 'vercel@latest', ...args], { cwd: SITE, env, encoding: 'utf8', input, timeout: 180000, windowsHide: true, shell: process.platform === 'win32' });

const cfg = readMailConfig();
if (!cfg.senderUser || !cfg.senderPass || !cfg.provider) {
  console.log('보내는 메일 설정이 없습니다 — 먼저 .\\scripts\\mail-setup.cmd 를 실행하세요.');
  process.exit(1);
}
if (!cfg.cronSecret) {
  cfg.cronSecret = crypto.randomBytes(32).toString('hex');
  writeMailConfig(cfg);
}
const vars = {
  JINGA_MAIL_USER: cfg.senderUser,
  JINGA_MAIL_PASS: cfg.senderPass,
  JINGA_MAIL_PROVIDER: cfg.provider,
  JINGA_MAIL_AUTH_USER: cfg.smtpAuthUser || cfg.senderUser,
  JINGA_SITE_URL: cfg.siteUrl || 'https://jinga-retech.vercel.app',
  CRON_SECRET: cfg.cronSecret,
};
const secrets = Object.values(vars).filter(v => String(v).length >= 6);
const clean = s => secrets.reduce((acc, v) => acc.split(v).join('***'), String(s || '')).trim().split(/\r?\n/).filter(Boolean).slice(-2).join(' / ');

let failed = 0;
for (const [name, value] of Object.entries(vars)) {
  run(['env', 'rm', name, 'production', '--yes']);   // 있으면 지우고(없으면 오류 — 무시) 새 값으로
  const r = run(['env', 'add', name, 'production'], String(value));
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  const ok = r.status === 0 && !/Error/i.test(out);
  if (!ok) failed++;
  console.log(`${ok ? '등록' : '실패'} ${name}${ok ? '' : ` — ${clean(out)}`}`);
}
console.log(failed ? `${failed}개 실패 — 위 메시지를 확인하세요.` : '환경변수 등록 완료 — 다음 배포부터 적용됩니다.');
process.exit(failed ? 1 : 0);
