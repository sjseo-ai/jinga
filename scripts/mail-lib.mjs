// 진가 메일 발송 공용(운영 PC) — 설정 파일(.secrets/jinga-mail.json) · 구독 관리 API(/api/admin) 호출
// 메일 계정(SMTP)·메일 내용은 Vercel 서버와 같이 쓰도록 site/public/api/_mail.mjs 에 있고, 여기서 다시 내보냅니다.
// 설정은 이 PC의 .secrets/jinga-mail.json 에만(git·배포 제외): { provider, senderUser, senderPass, smtpAuthUser, adminSecret, siteUrl, cronSecret }
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { providerFor } from '../site/public/api/_mail.mjs';

export { PROVIDERS, providerFor, fromHeader, smtpOptions, createTransport, linksFor, changeLinkFor, confirmMail, changeMail, weeklyMail } from '../site/public/api/_mail.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SECRET_FILE = path.join(ROOT, '.secrets', 'jinga-mail.json');
export const log = m => console.log(`[${new Date().toLocaleString('ko-KR', { hour12: false })}] ${m}`);
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const maskEmail = e => { const [u, d] = String(e).split('@'); return `${u.slice(0, 2)}***@${d}`; };

// 예전 설정 키(gmailUser·gmailAppPassword)도 그대로 읽음
export function normalizeMailConfig(c = {}) {
  const senderUser = c.senderUser || c.gmailUser || '';
  return {
    ...c,
    senderUser,
    senderPass: c.senderPass || c.gmailAppPassword || '',
    provider: c.provider || providerFor(senderUser),
    smtpAuthUser: c.smtpAuthUser || senderUser,
  };
}

export function readMailConfig() {
  return normalizeMailConfig(fs.existsSync(SECRET_FILE) ? JSON.parse(fs.readFileSync(SECRET_FILE, 'utf8')) : {});
}
export function writeMailConfig(cfg) {
  const { gmailUser, gmailAppPassword, ...clean } = cfg;   // 예전 키는 저장하지 않음
  fs.mkdirSync(path.dirname(SECRET_FILE), { recursive: true });
  fs.writeFileSync(SECRET_FILE, JSON.stringify(clean, null, 2));
}
export const mailReady = cfg => !!(cfg.senderUser && cfg.senderPass && cfg.provider && cfg.adminSecret && cfg.siteUrl);

async function adminApi(cfg, init = {}) {
  const r = await fetch(`${cfg.siteUrl}/api/admin`, {
    ...init,
    headers: { Authorization: `Bearer ${cfg.adminSecret}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(30000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) throw new Error(`구독 관리 API ${r.status} ${j.error || ''}`.trim());
  return j;
}
export const listSubscribers = cfg => adminApi(cfg).then(j => j.subscribers);
export const markSubscriber = (cfg, id, field) => adminApi(cfg, { method: 'POST', body: JSON.stringify({ action: 'mark', id, field }) });
export const deleteSubscriber = (cfg, id) => adminApi(cfg, { method: 'POST', body: JSON.stringify({ action: 'delete', id }) });
