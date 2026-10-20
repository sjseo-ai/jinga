// 주간 보고서 메일 발송 — 주간 작업(weekly-report.bat) 마지막 단계
//   node scripts/send-weekly-mail.mjs          구독 확인된 모든 주소로, 각자 조건으로 만든 가장 최근 보고서 발송
//   node scripts/send-weekly-mail.mjs --test   보내는 메일 주소(본인)로만 시험 발송 — 본인이 구독자면 본인 조건 보고서, 아니면 기본 조건 보고서
// 조건별 보고서 목록은 weekly-report.mjs 가 만든 reports/<날짜>/groups.json. 조건이 없는 구독자는 기본 조건(reports/config.json) 보고서.
// 웹 보기 사본(site/public/r/…)이 사이트에 올라가 있으면 메일에 「웹에서 탭으로 보기」 버튼을 넣음(재배포가 건너뛰어졌으면 버튼 없이 발송).
// 받는 사람마다 한 통씩(다른 구독자 주소가 보이지 않게), 1초 간격. 같은 보고서를 이미 받은 주소는 건너뜀(재실행 안전).
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, readMailConfig, mailReady, createTransport, listSubscribers, markSubscriber, weeklyMail, fromHeader, maskEmail, log, sleep } from './mail-lib.mjs';
import { criteriaKey, normalizeCriteria } from '../site/public/api/_core.mjs';

const cfg = readMailConfig();
if (!mailReady(cfg)) {
  log('메일 설정이 없어 주간 보고서 메일을 건너뜁니다 — scripts\\mail-setup.cmd 로 설정');
  process.exit(0);
}
const reportsDir = path.join(ROOT, 'reports');
const latest = fs.existsSync(reportsDir) ? fs.readdirSync(reportsDir).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().pop() : null;
if (!latest) { log('보낼 보고서가 없습니다'); process.exit(0); }
const dayDir = path.join(reportsDir, latest);
const manifestFile = path.join(dayDir, 'groups.json');
const manifest = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : null;
const testOnly = process.argv.includes('--test');

// 구독자 → 보낼 보고서(폴더·조건·웹 사본). 조건 보고서가 없으면(보고서를 만든 뒤 신청·변경) null
const loaded = new Map();
function reportFor(sub) {
  const n = sub.criteria ? normalizeCriteria(sub.criteria) : null;
  const key = n && n.criteria ? criteriaKey(n.criteria) : null;
  let g = null;
  if (manifest) g = key ? manifest.groups[key] : manifest.groups[manifest.defaultKey];
  else if (!key) g = { dir: '.', criteria: null };   // groups.json 이전 보고서 — 기본 보고서만 있음
  if (!g) return null;
  const dir = path.join(dayDir, g.dir);
  if (!loaded.has(dir)) {
    const xlsx = path.join(dir, '진가_주간데이터.xlsx');
    loaded.set(dir, { reportHtml: fs.readFileSync(path.join(dir, '주간보고서.html'), 'utf8'), xlsxPath: fs.existsSync(xlsx) ? xlsx : null });
  }
  return { ...loaded.get(dir), criteria: key ? g.criteria : null, web: g.web || null };
}

// 웹 사본이 실제로 배포돼 있을 때만 링크(조건마다 한 번 확인)
const webChecked = new Map();
async function webUrlFor(web) {
  if (!web) return null;
  if (!webChecked.has(web)) {
    const url = `${cfg.siteUrl}/${web}`;
    let ok = false;
    try { ok = (await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(15000) })).ok; } catch { /* 네트워크 실패 — 버튼 없이 */ }
    webChecked.set(web, ok ? url : null);
  }
  return webChecked.get(web);
}

try {
  const reportStart = Date.parse(`${latest}T00:00:00+09:00`);
  let targets;
  if (testOnly) {
    let me = null;
    try { me = (await listSubscribers(cfg)).find(s => s.email === cfg.senderUser && s.status === 'confirmed'); } catch { /* 구독자 조회 실패 — 기본 보고서로 시험 */ }
    targets = [{ id: '0'.repeat(32), token: 'test', email: cfg.senderUser, status: 'confirmed', criteria: me ? me.criteria : null }];
  } else {
    targets = (await listSubscribers(cfg)).filter(s => s.status === 'confirmed' && !(s.lastWeeklySentAt && Date.parse(s.lastWeeklySentAt) >= reportStart));
  }
  if (!targets.length) { log(`보낼 구독자가 없습니다(${latest} 보고서)`); process.exit(0); }
  const tx = await createTransport(cfg);
  let sent = 0, missing = 0;
  for (const s of targets) {
    const rep = reportFor(s);
    if (!rep) { missing++; continue; }
    try {
      const webUrl = await webUrlFor(rep.web);
      await tx.sendMail({ from: fromHeader(cfg), to: s.email, ...weeklyMail(cfg, s, { today: latest, ...rep, webUrl }) });
      if (!testOnly) await markSubscriber(cfg, s.id, 'lastWeeklySentAt');
      sent++;
      await sleep(1000);
    } catch (e) {
      log(`발송 실패(${maskEmail(s.email)}): ${e.message}`);
    }
  }
  log(`주간 보고서 메일 ${sent}/${targets.length}건 발송 — ${latest}${testOnly ? ' (시험 발송)' : ''}${missing ? ` · 조건 보고서가 아직 없어 다음 주로 넘긴 구독자 ${missing}명(보고서 생성 뒤 신청·변경)` : ''}`);
} catch (e) {
  log(`주간 보고서 메일 작업 실패: ${e.message}`);
}
process.exit(0);
