// 구독 확인 메일 발송 — Windows 작업 스케줄러가 10분마다 실행(scripts/mail-confirm.bat)
// 새 신청(pending, 확인 메일 미발송)에 확인 메일을, 구독 중인 주소의 조건 변경 신청에 변경 확인 메일을 보내고,
// 7일 동안 확인하지 않은 신청은 삭제합니다. 할 일이 없으면 아무것도 기록하지 않습니다(로그가 10분마다 쌓이지 않게).
import { readMailConfig, mailReady, createTransport, listSubscribers, markSubscriber, deleteSubscriber, confirmMail, changeMail, fromHeader, maskEmail, log } from './mail-lib.mjs';

const PENDING_TTL_MS = 7 * 24 * 3600e3;
const cfg = readMailConfig();
if (!mailReady(cfg)) process.exit(0);   // 메일 설정 전 — 조용히 건너뜀

try {
  const subs = await listSubscribers(cfg);
  const now = Date.now();
  const stale = subs.filter(s => s.status === 'pending' && now - Date.parse(s.createdAt) > PENDING_TTL_MS);
  for (const s of stale) await deleteSubscriber(cfg, s.id);
  const todo = subs.filter(s => s.status === 'pending' && !s.confirmMailSentAt && !stale.includes(s));
  const changes = subs.filter(s => s.status === 'confirmed' && s.pendingCriteria && !s.changeMailSentAt && now - Date.parse(s.changeRequestedAt) <= PENDING_TTL_MS);
  if (todo.length || changes.length) {
    const tx = await createTransport(cfg);
    const run = async (list, build, field, label) => {
      if (!list.length) return;
      let sent = 0;
      for (const s of list) {
        try {
          await tx.sendMail({ from: fromHeader(cfg), to: s.email, ...build(cfg, s) });
          await markSubscriber(cfg, s.id, field);
          sent++;
        } catch (e) {
          log(`${label} 실패(${maskEmail(s.email)}): ${e.message}`);
        }
      }
      log(`${label} ${sent}/${list.length}건 발송`);
    };
    await run(todo, confirmMail, 'confirmMailSentAt', '확인 메일');
    await run(changes, changeMail, 'changeMailSentAt', '조건 변경 확인 메일');
  }
  if (stale.length) log(`확인하지 않은 7일 지난 신청 ${stale.length}건 삭제`);
} catch (e) {
  log(`확인 메일 작업 실패: ${e.message}`);
}
process.exit(0);
