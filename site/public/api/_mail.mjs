// 진가 메일 공용 — 보내는 계정(SMTP) 설정 · 구독 확인 / 조건 변경 확인 / 주간 보고서 메일 내용
// Vercel 함수(구독 신청 즉시 확인 메일, 주간 발송 작업)와 운영 PC 스크립트(scripts/mail-lib.mjs)가 같이 씀 — fs·path 없음
import { criteriaLabel } from './_core.mjs';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// 보내는 메일 계정 — Gmail(앱 비밀번호) 또는 네이버 메일(IMAP/SMTP 사용 설정 + 비밀번호/애플리케이션 비밀번호)
export const PROVIDERS = {
  gmail: { label: 'Gmail', host: 'smtp.gmail.com', port: 465, domains: ['gmail.com', 'googlemail.com'] },
  naver: { label: '네이버 메일', host: 'smtp.naver.com', port: 465, domains: ['naver.com'] },
};
export function providerFor(email) {
  const domain = String(email || '').split('@')[1];
  return Object.keys(PROVIDERS).find(k => PROVIDERS[k].domains.includes(String(domain || '').toLowerCase())) || null;
}

/** Vercel 환경변수 → 메일 설정(비밀번호는 Vercel 암호화 환경변수에만) */
export function mailConfigFromEnv(env = process.env) {
  const senderUser = String(env.JINGA_MAIL_USER || '').trim().toLowerCase();
  return {
    provider: env.JINGA_MAIL_PROVIDER || providerFor(senderUser),
    senderUser,
    senderPass: env.JINGA_MAIL_PASS || '',
    smtpAuthUser: env.JINGA_MAIL_AUTH_USER || senderUser,
    siteUrl: String(env.JINGA_SITE_URL || '').replace(/\/+$/, ''),
  };
}
export const canSend = cfg => !!(cfg && cfg.senderUser && cfg.senderPass && PROVIDERS[cfg.provider] && cfg.siteUrl);
export const fromHeader = cfg => `"진가 주간 보고서" <${cfg.senderUser}>`;   // 네이버는 보낸사람이 로그인 계정과 같아야 발송됨

export function smtpOptions(cfg) {
  const p = PROVIDERS[cfg.provider];
  if (!p) throw new Error(`지원하지 않는 메일 서비스입니다: ${cfg.provider || '(없음)'}`);
  const pass = cfg.provider === 'gmail' ? String(cfg.senderPass).replace(/\s+/g, '') : String(cfg.senderPass);
  return { host: p.host, port: p.port, secure: true, auth: { user: cfg.smtpAuthUser || cfg.senderUser, pass } };
}
export async function createTransport(cfg) {
  const { default: nodemailer } = await import('nodemailer');
  return nodemailer.createTransport(smtpOptions(cfg));
}

export const linksFor = (cfg, r) => ({
  confirm: `${cfg.siteUrl}/api/confirm?id=${r.id}&token=${r.token}`,
  unsubscribe: `${cfg.siteUrl}/api/unsubscribe?id=${r.id}&token=${r.token}`,
});

/** 사이트 구독 칸에 조건을 미리 채워 여는 링크(메일 주소는 넣지 않음) — 같은 주소로 다시 신청하면 조건 변경 확인 메일이 감 */
export function changeLinkFor(cfg, c) {
  if (!c) return `${cfg.siteUrl}/#mail-sec`;
  const q = new URLSearchParams({
    sub_gus: c.gus.join(','), sub_budget: `${c.budgetMinEok || ''}-${c.budgetEok}`, sub_area: `${c.minArea || ''}-${c.maxArea || ''}`,
    sub_hh: String(c.minHouseholds || 0), sub_basis: c.priceBasis === 'kb' ? 'kb' : 'ask',
  });
  return `${cfg.siteUrl}/?${q}#mail-sec`;
}

const btn = (href, label) => `<a href="${href}" style="display:inline-block;background:#0E1C2B;color:#fff;text-decoration:none;padding:11px 22px;border-radius:9px;font-weight:700">${label}</a>`;
const criteriaBox = (title, c) => `<div style="background:#F4F6F9;border:1px solid #D7DEE6;border-radius:9px;padding:10px 14px;margin:10px 0;font-size:14px"><b>${esc(title)}</b><br>${esc(criteriaLabel(c))}</div>`;

export function confirmMail(cfg, r) {
  const { confirm, unsubscribe } = linksFor(cfg, r);
  return {
    subject: '[진가] 주간 보고서 구독 확인',
    html: `<div style="font:15px/1.7 'Malgun Gothic',sans-serif;color:#13212F;max-width:520px">
<h2 style="font-size:19px;margin:0 0 10px">진가 주간 보고서 구독 확인</h2>
<p>${esc(r.email)} 주소로 진가(${esc(cfg.siteUrl)}) 주간 보고서 구독이 신청되었습니다. 아래 버튼을 눌러야 구독이 시작됩니다.</p>
${r.criteria ? criteriaBox('보고서 조건', r.criteria) : ''}
<p>${btn(confirm, '구독 확인')}</p>
<p style="font-size:12.5px;color:#6B7A89">본인이 신청하지 않았다면 이 메일을 무시하세요. 확인하지 않은 신청은 7일 뒤 자동으로 삭제됩니다.
구독 후에는 매주 월요일 아침 이 조건으로 만든 보고서가 발송되며, 모든 메일의 <a href="${unsubscribe}">수신 거부</a> 링크로 언제든 해지할 수 있습니다.</p></div>`,
    text: `진가 주간 보고서 구독 확인\n\n${r.criteria ? `보고서 조건: ${criteriaLabel(r.criteria)}\n\n` : ''}아래 링크를 열어야 구독이 시작됩니다.\n${confirm}\n\n본인이 신청하지 않았다면 무시하세요(7일 뒤 자동 삭제).\n수신 거부: ${unsubscribe}`,
  };
}

export function changeMail(cfg, r) {
  const { confirm, unsubscribe } = linksFor(cfg, r);
  return {
    subject: '[진가] 주간 보고서 조건 변경 확인',
    html: `<div style="font:15px/1.7 'Malgun Gothic',sans-serif;color:#13212F;max-width:520px">
<h2 style="font-size:19px;margin:0 0 10px">주간 보고서 조건 변경 확인</h2>
<p>${esc(r.email)} 주소의 진가 주간 보고서 조건을 바꾸는 신청이 들어왔습니다. 아래 버튼을 눌러야 바뀝니다.</p>
${r.criteria ? criteriaBox('지금 조건', r.criteria) : ''}${criteriaBox('바꿀 조건', r.pendingCriteria)}
<p>${btn(confirm, '조건 변경 확인')}</p>
<p style="font-size:12.5px;color:#6B7A89">본인이 신청하지 않았다면 이 메일을 무시하세요 — 지금 조건 그대로 계속 발송됩니다(7일 뒤 요청 만료).
더 받지 않으려면 <a href="${unsubscribe}">수신 거부</a>를 누르세요.</p></div>`,
    text: `진가 주간 보고서 조건 변경 확인\n\n${r.criteria ? `지금 조건: ${criteriaLabel(r.criteria)}\n` : ''}바꿀 조건: ${criteriaLabel(r.pendingCriteria)}\n\n아래 링크를 열어야 바뀝니다.\n${confirm}\n\n본인이 신청하지 않았다면 무시하세요.\n수신 거부: ${unsubscribe}`,
  };
}

/** 주간 보고서 메일 — xlsxPath(운영 PC 파일) 또는 xlsx { filename, content }(서버에서 만든 바이트) 첨부 */
export function weeklyMail(cfg, r, { today, reportHtml, xlsxPath = null, xlsx = null, criteria = null, webUrl = null }) {
  const { unsubscribe } = linksFor(cfg, r);
  const change = changeLinkFor(cfg, criteria);
  const hasXlsx = !!(xlsxPath || xlsx);
  let html;
  if (reportHtml.includes('<!--MAIL_TOP-->')) {
    // 새 보고서 양식(_report-html.mjs) — 보고서 카드와 같은 폭·글꼴로 위(조건·웹 보기)·아래(수신 거부) 안내를 끼움
    const F = "font-family:'Apple SD Gothic Neo','Malgun Gothic',sans-serif";
    const link = (href, text, color = '#1E5FCC') => `<a href="${esc(href)}" style="color:${color};text-decoration:none;font-weight:700">${text}</a>`;
    const top = `<tr><td style="padding:0 4px 12px;${F}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td style="${F};font-size:12.5px;line-height:1.6;color:#6B7A89">${criteria ? `받는 조건 · ${esc(criteriaLabel(criteria))} · ${link(change, '조건 바꾸기')}` : `기본 조건 보고서 · ${link(change, '내 조건을 정해 받기')}`}</td>
${webUrl ? `<td align="right" valign="top" style="white-space:nowrap;padding-left:10px"><a href="${esc(webUrl)}" style="display:inline-block;background:#1E5FCC;color:#fff;text-decoration:none;font-weight:700;font-size:12.5px;border-radius:8px;padding:7px 12px;${F}">웹에서 탭으로 보기</a></td>` : ''}
</tr></table></td></tr>`;
    const bottom = `<tr><td style="padding:14px 8px 0;${F};font-size:12px;line-height:1.8;color:#8A97A5;text-align:center">
이 메일은 진가 사이트에서 주간 보고서를 구독하신 ${esc(r.email)} 주소로 발송되었습니다.${hasXlsx ? ' 전체 데이터는 첨부한 엑셀 파일에 있습니다.' : ''}<br>
${link(cfg.siteUrl, '사이트에서 단지 검색하기', '#6B7A89')} · ${link(change, '조건 바꾸기', '#6B7A89')}${webUrl ? ` · ${link(webUrl, '웹에서 보기', '#6B7A89')}` : ''} · <a href="${unsubscribe}" style="color:#8A97A5">수신 거부</a></td></tr>`;
    html = reportHtml.replace('<!--MAIL_TOP-->', () => top).replace('<!--MAIL_BOTTOM-->', () => bottom);
  } else {
    // 예전 보고서 파일(자리 표시 없음) — 본문 위아래에 안내 줄
    const cond = criteria ? ` · 받는 조건: ${esc(criteriaLabel(criteria))} (<a href="${esc(change)}">조건 바꾸기</a>)` : ` · <a href="${esc(change)}">조건을 정해 받기</a>`;
    const banner = `<div style="max-width:1080px;margin:16px auto 0;padding:10px 38px;font:13px/1.6 'Malgun Gothic',sans-serif;color:#13212F">진가 주간 보고서 ${esc(today)} · <a href="${esc(cfg.siteUrl)}">사이트에서 단지 검색하기</a>${hasXlsx ? ' · 전체 데이터는 첨부 엑셀' : ''}${cond}</div>`;
    const footer = `<div style="max-width:1080px;margin:0 auto 30px;padding:14px 38px;font:12px/1.6 'Malgun Gothic',sans-serif;color:#6B7A89">이 메일은 진가 사이트에서 주간 보고서를 구독하신 ${esc(r.email)} 주소로 발송되었습니다. 조건을 바꾸려면 <a href="${esc(change)}">사이트 구독 칸</a>에서 같은 주소로 다시 신청하세요(확인 메일 후 반영). 더 받지 않으려면 <a href="${unsubscribe}">수신 거부</a>를 누르세요.</div>`;
    html = reportHtml.replace('<body>', () => `<body>${banner}`).replace('</body>', () => `${footer}</body>`);
  }
  const attachments = xlsx ? [{ filename: xlsx.filename, content: xlsx.content }]
    : xlsxPath ? [{ filename: String(xlsxPath).split(/[\\/]/).pop(), path: xlsxPath }] : [];
  return {
    subject: `[진가] 주간 보고서 ${today}${criteria ? ` · ${criteria.gus.join('·')}` : ''}`,
    html,
    text: `진가 주간 보고서 ${today}\n${criteria ? `받는 조건: ${criteriaLabel(criteria)}\n조건 바꾸기: ${change}\n` : ''}${webUrl ? `웹에서 보기: ${webUrl}\n` : ''}사이트: ${cfg.siteUrl}\n수신 거부: ${unsubscribe}`,
    attachments,
    headers: { 'List-Unsubscribe': `<${unsubscribe}>` },
  };
}
