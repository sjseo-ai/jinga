// Vercel 재배포 — 주간 작업(weekly-report.bat)이 KB 지역시세 집계를 갱신한 뒤 사이트를 다시 올릴 때 씁니다.
//   node scripts/deploy-vercel.mjs        (npm run deploy:vercel:auto)
// 로그인이 안 돼 있으면 건너뜁니다(주간 작업을 실패로 만들지 않음). 배포에 성공하면 주소를 기록합니다.
// 사이트는 정적 파일이라, 매주 만들어지는 site/public/kb-seoul-gu.json 을 반영하려면 이 재배포가 필요합니다.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSite } from './build-site.mjs';   // 올리기 전에 계산 모듈을 압축한 사본을 만듭니다

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const log = m => console.log(`[${new Date().toLocaleTimeString('ko-KR', { hour12: false })}] ${m}`);
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

// 이 PC 이름("서신준PC")이 한글이라 Vercel CLI가 로그인·토큰 갱신 헤더에서 오류를 냄 → 영문 이름 패치를 먼저 불러옴
// NODE_OPTIONS 는 큰따옴표 안의 역슬래시를 이스케이프로 해석하므로 Windows 경로도 슬래시로 넘김
const HOST_PATCH = path.join(ROOT, 'scripts', 'ascii-hostname.cjs').split(path.sep).join('/');
const env = { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --require "${HOST_PATCH}"`.trim() };
const run = (args, timeout) => spawnSync(npx, ['--yes', 'vercel@latest', ...args], {
  cwd: ROOT, env, encoding: 'utf8', input: '', timeout, windowsHide: true, shell: process.platform === 'win32',
});

export function isLoggedOut(out, status, error) {
  return !!error || status !== 0 || /Logged out|No existing credentials|not authenticated/i.test(out);
}

// whoami 출력에는 CLI 버전 줄·안내 줄이 섞여 있어, 계정 이름으로 보이는 줄(> 없이 공백 없는 한 단어)만 고름
export function accountFrom(out) {
  const lines = out.split(/\r?\n/).map(l => l.trim()).filter(l => l && !/^Vercel CLI|^>|\s/.test(l));
  return lines.pop() || '(계정 확인 불가)';
}

const who = run(['whoami'], 120000);
const whoOut = `${who.stdout || ''}${who.stderr || ''}`;
if (isLoggedOut(whoOut, who.status, who.error)) {
  log('Vercel 로그인 상태가 아니라 재배포를 건너뜁니다 — VS Code 터미널에서 `.\scripts\vercel-login.cmd` 로 한 번 로그인하면 다음 주부터 자동 배포됩니다.');
  process.exit(0);
}
// 소스가 아니라 **압축한 사본**을 올립니다 — 브라우저로 내려가는 계산 모듈에서 주석·내부 이름을 없앤 것
let target = 'site/public';
try {
  await buildSite();
  target = path.relative(ROOT, (await import('./build-site.mjs')).BUILD_DIR).split(path.sep).join('/');
} catch (e) {
  log(`배포본을 만들지 못해 소스를 그대로 올립니다(보호 미적용): ${e.message}`);
}
log(`Vercel 계정 ${accountFrom(whoOut)} — ${target} 재배포`);
const dep = run(['deploy', target, '--prod', '--yes'], 900000);
const out = `${dep.stdout || ''}${dep.stderr || ''}`;
// 출력에는 배포별 주소(…-해시-계정.vercel.app)와 운영 별칭(Aliased)이 함께 나옴 → 별칭을 우선 기록
const urls = out.match(/https:\/\/[^\s\]]+\.vercel\.app/g) || [];
const url = (out.match(/Aliased:?\s+(https:\/\/[^\s\]]+)/) || [])[1] || urls.find(u => !/-[a-z0-9]{9}-/.test(u)) || urls.pop();
if (dep.status === 0 && url) log(`재배포 완료 — ${url}`);
else log(`재배포 실패(주간 작업은 계속 진행): ${out.trim().split(/\r?\n/).slice(-3).join(' / ')}`);
process.exit(0);
