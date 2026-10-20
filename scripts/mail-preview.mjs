// 메일 예시안 만들기 — 실제 발송 없이, 구독자가 받게 될 주간 보고서 메일·구독 확인 메일을 브라우저로 볼 수 있는 HTML로 저장
//   node scripts/mail-preview.mjs   (npm run mail:preview) → reports/<최신 보고서 날짜>/메일예시.html
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, readMailConfig, weeklyMail, confirmMail, fromHeader } from './mail-lib.mjs';

const cfg = { siteUrl: 'https://jinga-retech.vercel.app', ...readMailConfig() };
if (!cfg.senderUser) cfg.senderUser = 'your.account@naver.com';   // 메일 설정 전이면 자리 표시용 주소
const reportsDir = path.join(ROOT, 'reports');
const latest = fs.readdirSync(reportsDir).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().pop();
if (!latest) { console.log('보고서가 없습니다 — npm run report:weekly 먼저 실행'); process.exit(1); }
const dir = path.join(reportsDir, latest);
const reportHtml = fs.readFileSync(path.join(dir, '주간보고서.html'), 'utf8');
const xlsx = path.join(dir, '진가_주간데이터.xlsx');
const xlsxPath = fs.existsSync(xlsx) ? xlsx : null;
const sample = { id: '0'.repeat(32), token: 'preview', email: 'subscriber@example.com' };

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const weekly = weeklyMail(cfg, sample, { today: latest, reportHtml, xlsxPath });
const confirm = confirmMail(cfg, sample);
const size = xlsxPath ? `${(fs.statSync(xlsxPath).size / 1024 / 1024).toFixed(1)}MB` : '';

const mailBox = (label, m, extra = '') => `
<section class="mail">
  <div class="tag">${esc(label)}</div>
  <table class="head">
    <tr><th>보낸사람</th><td>${esc(fromHeader(cfg))}</td></tr>
    <tr><th>받는사람</th><td>${esc(sample.email)} <span class="muted">(구독자마다 한 통씩 — 다른 구독자 주소는 보이지 않음)</span></td></tr>
    <tr><th>제목</th><td><b>${esc(m.subject)}</b></td></tr>
    ${extra}
  </table>
  <iframe title="${esc(label)} 본문" srcdoc="${esc(m.html)}"></iframe>
</section>`;

const page = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>진가 메일 예시안 ${latest}</title>
<style>
  body{margin:0;background:#E6E9EE;font:14px/1.6 "Pretendard","Malgun Gothic",sans-serif;color:#13212F}
  .wrap{max-width:1180px;margin:24px auto;padding:0 16px}
  h1{font-size:20px;margin:0 0 4px} .muted{color:#6B7A89;font-size:12.5px}
  .mail{background:#fff;border:1px solid #D7DEE6;border-radius:12px;margin:18px 0 28px;overflow:hidden}
  .tag{background:#0E1C2B;color:#fff;font-weight:700;padding:8px 16px;font-size:13px}
  .head{width:100%;border-collapse:collapse;font-size:13px} .head th{width:90px;text-align:left;color:#6B7A89;font-weight:600;padding:6px 16px;vertical-align:top}
  .head td{padding:6px 16px 6px 0} .head tr+tr{border-top:1px solid #EEF1F4}
  .att{display:inline-block;border:1px solid #D7DEE6;border-radius:8px;padding:3px 10px;background:#F6F8FA}
  iframe{display:block;width:100%;height:1500px;border:0;border-top:1px solid #D7DEE6;background:#EBEEF2}
  .confirm iframe{height:360px;background:#fff}
</style></head><body><div class="wrap">
<h1>진가 메일 예시안 — ${latest} 보고서 기준</h1>
<div class="muted">실제 발송 없이 만든 미리보기입니다. 수신 거부·구독 확인 링크는 예시 값이라 눌러도 동작하지 않습니다. 보낸사람 주소는 메일 설정(Gmail 또는 네이버) 후 실제 주소로 바뀝니다.</div>
${mailBox('① 매주 월요일 — 주간 보고서 메일', weekly, xlsxPath ? `<tr><th>첨부</th><td><span class="att">📎 ${esc(path.basename(xlsxPath))} · ${size}</span></td></tr>` : '')}
<div class="confirm">${mailBox('② 사이트에서 신청 직후 — 구독 확인 메일', confirm)}</div>
</div></body></html>`;

const out = path.join(dir, '메일예시.html');
fs.writeFileSync(out, page);
console.log(`메일 예시안 저장: ${path.relative(ROOT, out)}`);
