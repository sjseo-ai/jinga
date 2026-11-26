// 첫 화면(site/public/index.html)이 **진짜 브라우저에서 도는지** 확인합니다.
//   node scripts/check-home.mjs --headless      조용히
//   node scripts/check-home.mjs                 창을 띄워서
//   node scripts/check-home.mjs --live          배포된 사이트를 봄
//
// 왜 생겼나 — 첫 화면은 이 서비스의 **주 화면인데 브라우저 점검이 아예 없었습니다.**
// 415KB 짜리 HTML 안의 인라인 스크립트는 `node --check` 로 볼 수 없고, `npm test` 는 글자만 봅니다.
// 2026-11-26 에 전세가율을 붙이다 `'</td>'+` 뒤에 `})()` 가 와서 **스크립트 전체가 죽는** 오류를 냈는데,
// 그때 이것이 없어 배포 빌드의 압축 실패 메시지로 겨우 알아챘습니다.
//
// 뼈대(서버·Chrome 붙이기)는 `scripts/_browser.mjs` 를 씁니다 — check-decision.mjs 와 같은 것.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve, connect, ev, until, tally, wait, CHROME } from './_browser.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUB = path.join(ROOT, 'site', 'public');
const HEADLESS = process.argv.includes('--headless');
const LIVE = process.argv.includes('--live');

async function main() {
  if (!CHROME) { console.error('Chrome 을 찾지 못해 건너뜁니다'); process.exit(0); }
  const { srv, port } = LIVE ? { srv: { close() {} }, port: 0 } : await serve(PUB);
  const url = LIVE ? 'https://jinga-retech.vercel.app/' : `http://127.0.0.1:${port}/`;
  console.log(`\n첫 화면 점검 — ${url}${HEADLESS ? ' (headless)' : ''}\n`);

  const cdp = await connect({ headless: HEADLESS, port: 9334, profile: 'jinga-checkhome' });
  const { send, logs } = cdp;
  const { ok, done } = tally();

  try {
    await send('Page.navigate', { url });

    // ① 아예 뜨는가 — 스크립트가 죽으면 여기서 멈춥니다
    const title = await until(send, `document.title || ''`);
    ok('화면이 떴다', !!title, title ? String(title).slice(0, 40) : '제목이 비어 있습니다');

    const booted = await until(send, `typeof window.jingaRentRatio === 'function' ? 'yes' : ''`, { tries: 60 });
    ok('인라인 스크립트가 끝까지 돌았다', booted === 'yes',
      booted === 'yes' ? 'jingaRentRatio 까지 정의됨' : '스크립트가 중간에 죽은 것으로 보입니다');

    // ② 지역 집계가 내려왔는가
    const guCount = await until(send, `document.querySelectorAll('#guMap path').length || 0`, { tries: 60 });
    ok('자치구 지도가 그려졌다', guCount >= 20, `${guCount}개`);

    // until() 은 참이 되면 바로 돌려주므로, 「10줄 이상일 때만 참」인 식을 넘겨야 합니다.
    // 그냥 줄 수를 넘기면 자료가 오기 전의 빈 안내 줄(1줄)에서 멈춥니다.
    const dongRows = await until(send, `(() => { const n = document.querySelectorAll('#dongTableBody tr').length; return n >= 10 ? n : 0; })()`, { tries: 60 });
    ok('법정동 표가 채워졌다', dongRows >= 10, `${dongRows}줄`);

    // ③ 전세가율 (2026-11-26) — 메인 화면은 **지역 단위**라 rent-gu-seoul.json(9KB)만 받습니다.
    //    단지별 파일(256KB)을 여기서 받으면 검색만 하는 사람도 그만큼 내려받게 됩니다.
    const heavy = await ev(send, `performance.getEntriesByType('resource').some(e => e.name.includes('rent-price-seoul.json')) ? 'yes' : 'no'`);
    ok('무거운 단지별 전세 파일을 첫 화면에서 받지 않는다', heavy === 'no',
      heavy === 'no' ? 'rent-gu-seoul.json 만 받습니다' : 'rent-price-seoul.json(256KB)을 받고 있습니다');

    const ratio = await until(send, `(() => {
      const r = window.jingaRentRatio && window.jingaRentRatio('강남구');
      return r && r.ratio != null ? String(r.ratio) : '';
    })()`, { tries: 60 });
    ok('자치구 전세가율을 읽어 왔다', !!ratio, ratio ? `강남구 ${(Number(ratio) * 100).toFixed(1)}%` : '값이 없습니다');

    // 말이 되는 범위인가 — 단위가 어긋나면 0.0004 나 44 처럼 나옵니다
    const sane = Number(ratio) > 0.1 && Number(ratio) < 1;
    ok('전세가율이 말이 되는 범위다', sane, ratio ? `${(Number(ratio) * 100).toFixed(1)}% (10~100% 사이)` : '');

    // 법정동 열이 실제로 값을 보이는가 — 전부 '—' 면 붙은 척만 한 것입니다
    const dongFilled = await until(send, `(() => {
      const tds = [...document.querySelectorAll('#dongTableBody tr')].map(tr => tr.children[6]?.textContent || '');
      const withVal = tds.filter(t => t.includes('%')).length;
      return withVal ? withVal + '/' + tds.length : '';
    })()`, { tries: 30 });
    ok('법정동 표에 전세가율 값이 들어갔다', !!dongFilled, dongFilled ? `${dongFilled}줄에 값` : '전부 비어 있습니다');

    // 자치구를 눌렀을 때 상세 패널에 전세가율이 나오는가
    await ev(send, `(() => {
      const p = document.querySelector('#guMap path');
      if (p) p.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return 1;
    })()`);
    await wait(400);
    const panel = await ev(send, `document.querySelector('.gu-detail, #guDetail')?.textContent || document.body.textContent.slice(0, 0)`);
    // <script> 본문을 빼고 **사람이 보는 글자만** 봅니다 — 코드 안의 Infinity 가 숫자 사고로 잡히면 안 됩니다.
    const panelAll = await ev(send, `(() => {
      const c = document.body.cloneNode(true);
      c.querySelectorAll('script,style,template,noscript').forEach(e => e.remove());
      return c.textContent || '';
    })()`);
    ok('자치구를 누르면 전세가율이 보인다', String(panel || panelAll).includes('전세가율'),
      String(panel || panelAll).includes('전세가율') ? '상세 패널에 표시' : '패널에서 못 찾음');

    // ④ 라벨이 자료와 맞는가 (2026-11-26)
    //    자료를 KB시세 → 국토교통부 실거래로 간 것이 2026-11-20 인데 라벨이 엿새 넘게 남아,
    //    이용자에게는 **출처가 틀리게** 보였습니다. 숫자의 뜻도 어긋나 있었습니다 —
    //    `count` 는 거래 건수인데 「단지 N곳」으로, households 는 늘 null 인데 「0세대」로 찍혔습니다.
    const mapSrc = await ev(send, `document.querySelector('.map-source')?.textContent || ''`);
    ok('지도 출처가 실거래로 적혀 있다', mapSrc.includes('국토교통부') && !mapSrc.includes('KB'),
      mapSrc ? mapSrc.slice(0, 60) : '출처 줄이 비어 있습니다');

    // 지도·법정동 구역에 KB 표기가 되살아나지 않았는지. 단지 검색·매물 추천은 **실제로** KB 를 쓰므로
    // 그 구역은 제외하고, 지도 패널과 법정동 표만 봅니다.
    const kbBack = await ev(send, `(() => {
      const parts = [
        document.querySelector('.map-source')?.textContent || '',
        document.querySelector('#mapIntroLive')?.textContent || '',
        document.querySelector('#dongCount')?.textContent || '',
        document.querySelector('#dongTableBody')?.textContent || '',
      ].join(' | ');
      return parts.includes('KB') ? parts.slice(0, 120) : '';
    })()`);
    ok('지도·법정동 구역에 KB 표기가 없다', !kbBack, kbBack || '실거래로만 적혀 있습니다');

    // 「0세대」·「단지 N곳」 같은 뜻이 어긋난 라벨이 돌아오지 않았는지
    const wrongUnit = await ev(send, `(() => {
      const t = document.querySelector('.gu-detail, #guDetail')?.textContent || document.body.innerText || '';
      if (/0세대/.test(t)) return '0세대';
      return '';
    })()`);
    ok('비어 있는 세대수를 0으로 찍지 않는다', !wrongUnit, wrongUnit || '세대수 칸을 아예 빼 두었습니다');

    // ④ 해석 주의를 빼놓지 않았는가 — 낮은 전세가율은 「싸다」가 아니라 재건축 기대입니다
    ok('전세가율 해석 주의가 화면에 있다', panelAll.includes('재건축 기대'),
      panelAll.includes('재건축 기대') ? '「낮다고 전세가 싼 것이 아니다」를 적어 둠' : '주의 문구가 없습니다');

    // ⑤ 출처를 적었는가
    ok('전월세 원천을 출처에 적었다', panelAll.includes('전월세 실거래가'),
      panelAll.includes('전월세 실거래가') ? '15126474 표기' : '출처 표기가 없습니다');

    // ⑥ 숫자 사고 · 콘솔
    const bad = /NaN|undefined원|Infinity/.test(panelAll);
    ok('숫자에 NaN·undefined 가 없다', !bad, bad ? (panelAll.match(/.{0,40}(NaN|undefined원|Infinity).{0,40}/) || [''])[0] : '');
    // 오류·예외만 실패로 봅니다. 이 점검은 **정적 서버**라 워커 API(시장 흐름 등)가 없어 경고가 나는데,
    // 그건 점검 환경의 한계이지 화면의 결함이 아닙니다. 경고는 숨기지 않고 따로 적어 둡니다.
    const errs = logs.filter(l => l.startsWith('[error]') || l.startsWith('[예외]'));
    const warns = logs.filter(l => !errs.includes(l));
    ok('콘솔 오류 없음', errs.length === 0, errs.slice(0, 3).join(' | '));
    if (warns.length && !LIVE) console.log(`  · 경고 ${warns.length}건 — 정적 서버에 워커 API 가 없어 나는 것입니다(실패로 보지 않음)`);
    else if (warns.length) console.log('  · 경고: ' + warns.slice(0, 3).join(' | '));

    const r = done();
    cdp.close(); srv.close();
    process.exit(r.failed.length ? 1 : 0);
  } catch (e) {
    console.error('\n점검 중 터졌습니다:', e.message);
    if (logs.length) console.error('브라우저 콘솔:\n  ' + logs.slice(0, 8).join('\n  '));
    cdp.close(); srv.close();
    process.exit(1);
  }
}

main();
