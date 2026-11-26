// /decision 페이지가 **진짜 브라우저에서 도는지** 확인합니다 (계획서 T009 검수).
//   node scripts/check-decision.mjs                 창을 띄워서
//   node scripts/check-decision.mjs --headless      조용히
//   node scripts/check-decision.mjs --shot          사진까지 남기기
//
// 왜 따로 있나 — `npm test` 는 HTML 글자와 계산 엔진만 봅니다. 고른 값이 화면에 흘러가는지,
// 자료가 실제로 내려오는지, 눌렀을 때 숫자가 나오는지는 **브라우저가 아니면 알 수 없습니다.**
// Chrome 이 필요하므로 `npm test` 에는 넣지 않았습니다(CI 에서 깨지면 안 되니까).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// 서버·Chrome 붙이기는 check-home.mjs 와 **같은 뼈대**를 씁니다 — 붙이는 방식을 한 곳에서 고치도록.
import { serve, connect, ev, wait, CHROME } from './_browser.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUB = path.join(ROOT, 'site', 'public');
const PORT_CDP = 9333;
const HEADLESS = process.argv.includes('--headless');
const SHOT = process.argv.includes('--shot');


const checks = [];
const ok = (name, pass, detail = '') => { checks.push({ name, pass, detail }); console.log(`  ${pass ? '✔' : '✘'} ${name}${detail ? ` — ${detail}` : ''}`); };

async function main() {
  // --live 를 주면 **배포된 사이트**를 봅니다. 로컬 사본이 멀쩡해도 배포 과정에서
  // 압축·복사 누락으로 깨지는 일이 있어, 올린 뒤에 한 번 더 같은 점검을 돌립니다.
  const live = process.argv.includes('--live');
  const { srv, port } = live ? { srv: { close() {} }, port: 0 } : await serve(PUB);
  const url = live ? 'https://jinga-retech.vercel.app/decision/' : `http://127.0.0.1:${port}/decision/`;
  console.log(`\n/decision 점검 — ${url}${HEADLESS ? ' (headless)' : ''}\n`);
  const cdp = await connect({ headless: HEADLESS, port: PORT_CDP, profile: 'jinga-checkdecision' });
  const { send } = cdp;

  try {
    await send('Page.navigate', { url });
    // 자료가 다 내려와 머리말이 채워질 때까지
    let booted = false;
    for (let i = 0; i < 50; i++) {
      const t = await ev(send, `document.querySelector('#countComplex')?.textContent || ''`);
      if (t && !t.includes('…')) { booted = true; break; }
      await wait(200);
    }
    ok('자료를 내려받아 화면이 떴다', booted, await ev(send, `document.querySelector('#countComplex').textContent`));
    if (!booted) {
      // 「안 떴다」만 보면 원인을 못 찾습니다 — 콘솔을 함께 찍습니다
      const why = cdp.logs.length
        ? ['', '  브라우저 콘솔:', ...cdp.logs.map(l => `    ${l}`)].join('\n')
        : '\n  (콘솔에 아무것도 없습니다 — 자료 파일 404 를 보세요)';
      throw new Error(`첫 화면이 뜨지 않았습니다${why}`);
    }

    ok('실거래 기준월 표시', !!(await ev(send, `!document.querySelector('#asofTrade').textContent.includes('…')`)),
      await ev(send, `document.querySelector('#asofTrade').textContent`));
    ok('규칙집 기준일 표시', !!(await ev(send, `!document.querySelector('#asofRules').textContent.includes('…')`)),
      await ev(send, `document.querySelector('#asofRules').textContent`));

    // 자치구 → 단지 → 면적을 사람처럼 고릅니다
    const guCount = await ev(send, `document.querySelector('#gu').options.length - 1`);
    ok('자치구 목록', guCount >= 20, `${guCount}곳`);

    await ev(send, `(() => { const s=document.querySelector('#gu'); s.value='강동구'; s.dispatchEvent(new Event('change')); })()`);
    const names = await ev(send, `document.querySelector('#name').options.length - 1`);
    ok('강동구 단지 목록이 채워졌다', names > 0, `${names}곳`);

    await ev(send, `(() => { const s=document.querySelector('#name'); s.selectedIndex=1; s.dispatchEvent(new Event('change')); })()`);
    const picked = await ev(send, `document.querySelector('#name').selectedOptions[0].textContent`);
    const areas = await ev(send, `document.querySelector('#area').options.length`);
    ok('면적 목록이 채워졌다', areas > 0, `${picked} · ${areas}칸`);

    // ③ MetricSummary
    const metric = await ev(send, `document.querySelector('#metric').textContent.replace(/\\s+/g,' ').trim().slice(0,150)`);
    ok('추정 시세가 나왔다', /억|범위/.test(metric), metric);
    const hasRange = await ev(send, `/범위/.test(document.querySelector('#metric').textContent)`);
    ok('범위를 함께 보여 준다', !!hasRange);
    const hasGrade = await ev(send, `/등급/.test(document.querySelector('#metric').textContent)`);
    ok('등급·표본을 함께 보여 준다', !!hasGrade);

    // 층을 넣으면 값이 내려가야 합니다 (1층 −6.2%)
    const before = await ev(send, `document.querySelector('#metric .big').textContent`);
    await ev(send, `(() => { const f=document.querySelector('#floor'); f.value='1'; f.dispatchEvent(new Event('input')); })()`);
    const after = await ev(send, `document.querySelector('#metric .big').textContent`);
    const chip = await ev(send, `[...document.querySelectorAll('#metric .chip')].map(c=>c.textContent).find(t=>t.includes('보정'))||''`);
    ok('1층을 넣으면 값이 내려간다', before !== after, `${before} → ${after} · ${chip}`);
    await ev(send, `(() => { const f=document.querySelector('#floor'); f.value=''; f.dispatchEvent(new Event('input')); })()`);

    // ④ 후보
    await ev(send, `document.querySelector('#add').click()`);
    const cands = await ev(send, `document.querySelectorAll('#cands .cand').length`);
    ok('후보에 담긴다', cands === 1, `${cands}곳`);

    // ⑤ 계산
    await ev(send, `document.querySelector('#calc').click()`);
    await wait(400);
    const bd = await ev(send, `document.querySelector('#breakdown').textContent.replace(/\\s+/g,' ').trim()`);
    ok('살 때 드는 돈이 나왔다', bd.includes('취득세'), bd.slice(0, 90));
    ok('대출 한도 세 기준이 나왔다', bd.includes('LTV') && bd.includes('DSR') && bd.includes('총액 상한'));
    ok('보유 연차표가 나왔다', bd.includes('1년차') && bd.includes('재산세'));
    ok('시나리오 세 갈래가 나왔다', bd.includes('내릴 때') && bd.includes('그대로일 때') && bd.includes('오를 때'));
    ok('미래는 가정이라고 못박았다', bd.includes('예측이 아니라 가정'));
    const warnN = await ev(send, `document.querySelectorAll('#breakdown .warns > div').length`);
    ok('믿지 말아야 할 것이 함께 나왔다', warnN > 0, `${warnN}건`);
    ok('숫자에 NaN·undefined 가 없다', !/NaN|undefined|Infinity/.test(bd), /NaN|undefined|Infinity/.test(bd) ? bd.slice(0, 200) : '');

    // ⑥ 보고서 미리보기
    // 2026-11-25: 손으로 쓴 목차가 **실제 보고서**로 바뀌었습니다(㉯ T011).
    // 이제 #report 에 주장이 줄줄이 들어가고, #toc 에는 **못 채우는 칸만** 남습니다.
    const claims = await ev(send, `document.querySelectorAll('#report .claims li').length`);
    const badges = await ev(send, `new Set([...document.querySelectorAll('#report .claims .bq')].map(e=>e.className)).size`);
    const fns = await ev(send, `document.querySelectorAll('#report .fns li').length`);
    ok('보고서에 주장이 줄마다 성격 배지를 달고 들어갔다', claims >= 25 && badges >= 3, `주장 ${claims}줄 · 배지 ${badges}종`);
    ok('출처 각주가 붙었다', fns >= 5, `출처 ${fns}종`);

    // 「출처 없는 주장 0건」이 화면에 그대로 적혀야 합니다 — 숨기면 지키는 의미가 없습니다
    const rsum = await ev(send, `document.querySelector('#report .rsum')?.textContent || ''`);
    ok('출처 없는 주장 수를 화면에 적는다', /출처 없는 주장 0건/.test(rsum), rsum);
    const bad = await ev(send, `document.querySelectorAll('#report .rsum.bad').length`);
    ok('위반이 0건이라 빨간 표시가 없다', bad === 0, `${bad}건`);

    // 전세가율(2026-11-26) — 분모가 매매 **추정**가이므로 전세가율도 추정입니다.
    // 그래서 「안 보이는 것」보다 「공공 신고값처럼 보이는 것」이 위험합니다. 둘을 따로 봅니다.
    const jCells = (() => {
      try {
        const idx = JSON.parse(fs.readFileSync(path.join(PUB, 'decision-index.json'), 'utf8'));
        return idx.counts?.withJeonse ?? 0;
      } catch { return -1; }
    })();
    ok('색인에 전세가율이 실렸다', jCells > 0, `전세가율 실린 면적 칸 ${jCells}칸`);

    const jBadge = await ev(send, `(() => {
      const lis = [...document.querySelectorAll('#report .claims li')].filter(e => e.textContent.includes('전세가율'));
      if (!lis.length) return 'none';
      for (const e of lis) {
        const b = e.querySelector('.bq');
        if (!b) return 'no-badge';
        if (/건수/.test(e.textContent)) continue;            // 건수는 공공 신고값이 맞습니다
        if (!b.className.includes('bq-est')) return 'not-est:' + b.className;
      }
      return 'ok:' + lis.length;
    })()`);
    ok('전세가율은 추정으로만 적힌다', String(jBadge).startsWith('ok:') || jBadge === 'none',
      jBadge === 'none' ? '이 단지에는 전세가율이 없습니다(표본 부족)' : String(jBadge));

    // 각주마다 출처 원문이 붙어 있고, 번호가 아래 출처 목록 안을 가리키는지.
    // 글자 수로 재면 안 됩니다 — 「이용자 입력값」처럼 짧고 정당한 출처가 있습니다.
    const fnOk = await ev(send, `(() => {
      const fns = [...document.querySelectorAll('#report .claims .fn')];
      const n = document.querySelectorAll('#report .fns li').length;
      if (!fns.length || !n) return 'none';
      for (const e of fns) {
        if (!(e.title || '').trim()) return 'empty:' + e.textContent;
        const num = Number((e.textContent.match(/\\d+/) || [])[0]);
        if (!(num >= 1 && num <= n)) return 'range:' + e.textContent;
      }
      return 'ok';
    })()`);
    ok('각주마다 출처 원문이 붙고 번호가 출처 목록을 가리킨다', fnOk === 'ok', String(fnOk));

    const toc = await ev(send, `document.querySelectorAll('#toc li').length`);
    const wip = await ev(send, `document.querySelectorAll('#toc .st-wip').length`);
    const why = await ev(send, `[...document.querySelectorAll('#toc .note')].every(e=>e.textContent.trim().length >= 10)`);
    ok('못 채우는 칸은 왜 못 채우는지 함께 적는다', toc >= 3 && wip === toc && !!why, `${toc}칸 전부 준비 중`);

    // 모바일 폭에서 가로 스크롤이 생기지 않아야 합니다
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await wait(300);
    const over = await ev(send, `document.documentElement.scrollWidth - document.documentElement.clientWidth`);
    ok('휴대전화 폭(390px)에서 가로로 밀리지 않는다', over <= 1, `넘침 ${over}px`);
    const minFont = await ev(send, `Math.min(...[...document.querySelectorAll('p,td,th,dd,dt,span,label,li')].filter(e=>e.textContent.trim()).map(e=>parseFloat(getComputedStyle(e).fontSize)))`);
    ok('가장 작은 글씨가 13px 이상', minFont >= 13, `${minFont}px`);
    await send('Emulation.clearDeviceMetricsOverride');

    if (SHOT) {
      await send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 1400, deviceScaleFactor: 1, mobile: false });
      await wait(300);
      const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
      const out = path.join(process.env.TEMP || '/tmp', 'jinga-decision.png');
      fs.writeFileSync(out, Buffer.from(r.result.data, 'base64'));
      console.log(`\n  사진: ${out}`);
    }

    if (cdp.logs.length) { console.log('\n  브라우저 콘솔:'); for (const l of cdp.logs) console.log(`    ${l}`); }
    ok('콘솔 오류 없음', cdp.logs.length === 0, cdp.logs.length ? `${cdp.logs.length}건` : '');
  } finally {
    cdp.close();
    srv.close();
  }

  const bad = checks.filter(c => !c.pass);
  console.log(`\n${checks.length - bad.length}/${checks.length} 통과${bad.length ? ` · 실패 ${bad.length}건` : ''}\n`);
  process.exit(bad.length ? 1 : 0);
}

main().catch(e => { console.error(`\n점검 실패: ${e.message}\n`); process.exit(1); });
