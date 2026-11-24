// 국토교통부 실거래가 인증키 저장 — 직접 입력(화면에 표시되지 않음) → .secrets/molit.json (git 제외)
//   .\scripts\molit-key.cmd        (또는 node scripts/molit-key.mjs)
//
// 저장 전에 **세 가지 서비스를 각각 한 번씩 호출해** 어디까지 활용신청이 승인됐는지 확인합니다.
//   15126469 아파트 매매 실거래가        RTMSDataSvcAptTrade
//   15126468 아파트 매매 실거래가 상세   RTMSDataSvcAptTradeDev
//   15126474 아파트 전월세 실거래가      RTMSDataSvcAptRent
// 서비스마다 활용신청이 따로라, 키가 맞아도 신청 안 한 서비스는 「등록되지 않은 서비스키」가 납니다.
// 그래서 셋을 나눠 확인합니다 — 「키가 틀렸다」와 「그 서비스만 신청이 안 됐다」는 완전히 다른 문제입니다.
//
// 키 값은 화면·로그·커밋 어디에도 남기지 않습니다(길이와 앞뒤 몇 자만 표시).
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEST = path.join(ROOT, '.secrets', 'molit.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

export const SERVICES = [
  { id: '15126469', name: '아파트 매매 실거래가', svc: 'RTMSDataSvcAptTrade', op: 'getRTMSDataSvcAptTrade', required: true },
  { id: '15126468', name: '아파트 매매 실거래가 상세', svc: 'RTMSDataSvcAptTradeDev', op: 'getRTMSDataSvcAptTradeDev', required: false },
  { id: '15126474', name: '아파트 전월세 실거래가', svc: 'RTMSDataSvcAptRent', op: 'getRTMSDataSvcAptRent', required: false },
];

/** 지난달 — 이번 달 자료는 아직 안 올라와 있을 수 있어 비어 있는 것과 거부를 헷갈리지 않으려고 */
export function lastMonth(now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

const tag = (xml, name) => { const m = new RegExp(`<${name}>([^<]*)</${name}>`).exec(xml); return m ? m[1].trim() : ''; };

/**
 * data.go.kr 인증키는 Decoding(원문)과 Encoding(%2B·%3D 로 이미 바뀐 것) 두 형태로 나옵니다.
 * 이미 인코딩된 키를 또 인코딩하면 %252B 가 되어 「등록되지 않은 키」로 거부당합니다(상가 API 에서 겪음).
 * 그래서 **있는 그대로** 한 번, **인코딩해서** 한 번 — 둘 중 되는 쪽을 찾습니다.
 */
export function keyVariants(key) {
  const out = [{ label: 'raw', value: key }];
  const enc = encodeURIComponent(key);
  if (enc !== key) out.push({ label: 'encoded', value: enc });
  return out;
}

/** 한 서비스 확인 → { ok, how, code, message, rows } */
export async function verifyService(key, s, fetchImpl = fetch, ym = lastMonth()) {
  let last = { ok: false, code: '', message: '응답 없음' };
  for (const v of keyVariants(key)) {
    const url = `https://apis.data.go.kr/1613000/${s.svc}/${s.op}`
      + `?serviceKey=${v.value}&LAWD_CD=11680&DEAL_YMD=${ym}&pageNo=1&numOfRows=5`;
    let text = '';
    try {
      const r = await fetchImpl(url, { headers: { 'User-Agent': UA, Accept: '*/*' }, signal: AbortSignal.timeout(30000) });
      text = await r.text();
    } catch (e) { last = { ok: false, code: 'NET', message: `연결 실패: ${e.message}` }; continue; }

    const code = tag(text, 'resultCode') || tag(text, 'returnReasonCode');
    const msg = tag(text, 'resultMsg') || tag(text, 'returnAuthMsg') || tag(text, 'errMsg');
    if (/<resultCode>0*0<\/resultCode>/.test(text)) {
      const rows = (text.match(/<item>/g) || []).length;
      return { ok: true, how: v.label, code, message: msg || '정상', rows };
    }
    last = { ok: false, how: v.label, code, message: msg || text.replace(/\s+/g, ' ').slice(0, 120) };
  }
  return last;
}

function ask(question, hidden = true) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) rl._writeToOutput = s => { if (s.includes(question)) process.stdout.write(question); };
    rl.question(question, a => { rl.close(); if (hidden) process.stdout.write('\n'); resolve(a); });
  });
}

const mask = k => (k.length > 8 ? `${k.slice(0, 4)}…${k.slice(-2)} (${k.length}자)` : `(${k.length}자)`);

async function main() {
  console.log('=== 국토교통부 실거래가 인증키 저장 ===');
  console.log('공공데이터포털(data.go.kr) → 마이페이지 → 데이터활용 → 인증키 발급현황 의');
  console.log('**일반 인증키(Decoding)** 를 붙여넣으세요. Encoding 키를 넣어도 알아서 맞춰 봅니다.');
  console.log('입력해도 화면에 보이지 않습니다(붙여넣기 Ctrl+V 또는 마우스 오른쪽).');
  if (fs.existsSync(DEST)) console.log('(이미 저장된 키가 있습니다 — 새로 입력하면 바꿔 씁니다)');
  console.log('');
  const key = (await ask('인증키: ')).trim();
  if (!key) { console.log('입력이 없어 저장하지 않았습니다.'); return 1; }
  if (/\s/.test(key)) { console.log('키 중간에 띄어쓰기가 있습니다. 다시 복사해 주세요. 저장하지 않았습니다.'); return 1; }

  const ym = lastMonth();
  console.log(`\n받은 키 ${mask(key)} — 서울 강남구(11680) ${ym} 자료로 서비스 세 개를 확인합니다…\n`);
  const results = [];
  for (const s of SERVICES) {
    const r = await verifyService(key, s, fetch, ym);
    results.push({ ...s, ...r });
    console.log(r.ok
      ? `  ✔ ${s.name} (${s.id}) — ${r.rows}건 조회${r.how === 'encoded' ? ' · 인코딩해서 보냄' : ''}`
      : `  ✖ ${s.name} (${s.id}) — ${r.message}`);
  }

  const must = results.find(r => r.required);
  console.log('');
  if (!must.ok) {
    if (/등록되지 않은|NOT_REGISTERED/i.test(must.message)) {
      console.log('「등록되지 않은 서비스키」입니다. 키가 틀렸다기보다 **그 서비스에 활용신청이 안 된 것**일 때가 많습니다.');
      console.log(`  → https://www.data.go.kr/data/${must.id}/openapi.do 에서 [활용신청]을 누르셨는지 확인해 주세요.`);
      console.log('  → 방금 신청하셨다면 반영까지 시간이 걸립니다(보통 1시간 안팎).');
    }
    const yes = (await ask('그래도 저장할까요? (y/N): ', false)).trim().toLowerCase();
    if (yes !== 'y') { console.log('저장하지 않았습니다.'); return 1; }
  }

  fs.mkdirSync(path.dirname(DEST), { recursive: true });
  fs.writeFileSync(DEST, JSON.stringify({
    apiKey: key,
    savedAt: new Date().toISOString(),
    verified: Object.fromEntries(results.map(r => [r.id, { name: r.name, ok: r.ok, message: r.ok ? `${r.rows}건` : r.message }])),
  }, null, 2));
  console.log('\n저장했습니다 → .secrets/molit.json (git 에 올라가지 않습니다)');
  console.log('다음 단계 — 워커에도 같은 키를 넣습니다(값은 화면에 안 보입니다):');
  console.log('  npx wrangler secret put MOLIT_API_KEY --config workers/jinga-korea-macro/wrangler.toml');
  console.log('  npm run deploy:macro');
  return must.ok ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(c => process.exit(c || 0)).catch(e => { console.error('실패:', e.message); process.exit(1); });
}
