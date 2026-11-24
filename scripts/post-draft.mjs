// 자치구 연재 초안 만들기 — 블로그에 주 2회 올릴 「오늘은 OO구」
//
//   node scripts/post-draft.mjs 강남구            한 구 초안을 화면에 찍기
//   node scripts/post-draft.mjs 강남구 --save     바탕화면 「진가 블로그 발행본/연재」에 저장
//   node scripts/post-draft.mjs --all             25개 구 전부 저장
//   node scripts/post-draft.mjs --calendar 2026-10-14   화·금 연재 일정표
//   node scripts/post-draft.mjs --calendar 2026-10-20 --first=노원구,강서구,성북구
//                                                 먼저 다룰 구를 앞으로 끌어올린 일정표
//
// 나오는 것은 **초안**입니다. 숫자와 뼈대는 자료에서 뽑았으니, 사장님은
// 「살아 보니 어떻더라」 같은 사람 얘기만 얹으면 됩니다. 숫자는 고치지 마세요(틀리면 신뢰를 잃습니다).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GU_ORDER, guFacts, schedule, orderWithFirst, man, rentPct } from './_post.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUB = path.join(ROOT, 'site', 'public');
const SITE = 'https://jinga-retech.vercel.app';
const OUT_DIR = path.join(process.env.USERPROFILE || process.env.HOME || ROOT,
  'OneDrive', '바탕 화면', '진가 블로그 발행본', '연재');

const read = f => JSON.parse(fs.readFileSync(path.join(PUB, f), 'utf8'));

/**
 * 시세 원천 고르기 — 기본은 KB, --source=trade 를 주면 **국토교통부 실거래**로 바꿉니다.
 * 실거래로 바꾸면 KB 자료를 블로그에 다시 싣지 않게 되고, 사이트 자치구 페이지와 숫자가 맞습니다.
 * 다만 **같은 「평당가」라도 재는 것이 다릅니다** — KB 는 전 단지 시세 조사값, 실거래는 실제 팔린 것의 중앙값입니다.
 * 거래는 상대적으로 싼 물건에서 더 자주 일어나므로 실거래 쪽이 낮게 나옵니다. 글에도 그렇게 적습니다.
 */
function loadData(source = 'kb') {
  const kb = read('kb-seoul-complexes.json');
  const gu = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'kb-seoul-gu.json'), 'utf8'));
  let kapt = { byComplex: {} }, union = { sites: [] };
  try { kapt = read('kapt-seoul.json'); } catch { /* 아직 없으면 그 꼭지만 빠집니다 */ }
  // 사업장 원자료(sites)는 배포본에서 빠졌습니다(이용허락 확인 전) — 내부본을 먼저 봅니다
  try { union = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'work', 'seoul-union.json'), 'utf8')); }
  catch { try { union = read('seoul-union.json'); } catch { /* 없으면 그 꼭지만 빠집니다 */ } }
  // KB 가 보는 주차 — 국토부 신고값과 자주 다릅니다. 이름을 짚는 목록은 둘이 일치할 때만 올립니다
  let kbPark = { byComplex: {} };
  try { kbPark = read('kb-seoul-parking.json'); } catch { /* 없으면 그 대조만 빠집니다 */ }
  return {
    complexes: kb.complexes,
    ...(source === 'trade' ? (() => {
      const tp = read('trade-price-seoul.json');
      const r = tp.region;
      const toRow = v => ({ avgPerPyeong: v.perPyeong, count: v.n, households: null,
        dongs: (v.dongs || []).map(d => ({ name: d.name, avgPerPyeong: d.perPyeong, count: d.n })) });
      return { gu: Object.fromEntries(Object.entries(r.gu).map(([g, v]) => [g, toRow(v)])),
        seoul: { avgPerPyeong: r.seoul.perPyeong, count: r.seoul.n },
        asOf: `${String(tp.asOfYM).slice(0, 4)}.${String(tp.asOfYM).slice(4)}`,
        priceNote: `최근 ${r.months}개월 실거래 ${r.seoul.n.toLocaleString('ko-KR')}건의 중앙값`,
        dongUnit: '건',
        priceSource: '국토교통부 실거래가' };
    })() : { gu: gu.gu, seoul: gu.seoul, asOf: gu.asOf, priceSource: 'KB시세' }),
    kapt: kapt.byComplex || {},
    kbPark: kbPark.byComplex || {},
    union,
  };
}

const nm = c => `${c.name}(${c.dong})`;
const 억 = v => (v == null ? null : `${man(v)}만원`);

/** 숫자가 없으면 그 꼭지를 통째로 빼기 위해, 문단을 배열로 모았다가 빈 것을 거릅니다 */
function draft(f) {
  const L = [];
  const add = (...lines) => L.push(lines.filter(Boolean).join('\n'));
  const G = f.gu;
  const year = f.asOf ? f.asOf.split('.')[0] : new Date().getFullYear();

  // ── 제목 후보
  const titles = [
    f.price ? `${G} 아파트 평당 ${man(f.price.perPyeong)}만원 — ${year}년 ${f.asOf ? f.asOf.split('.')[1] : ''}월 ${f.priceSource}로 본 ${G}` : `${G} 아파트, 숫자로 보기`,
    f.parking && f.parking.best.length ? `${G}에서 주차 걱정 없는 아파트 ${f.parking.best.length}곳 — 국토부·KB 두 자료로 교차 확인` : null,
    f.rebuild.lowFarCount ? `${G} 재건축 여력 있는 단지 — 용적률 180% 이하 ${f.rebuild.lowFarCount}곳` : null,
    `오늘은 ${G}입니다 — 아파트 ${man(f.scale.total)}곳을 숫자로 훑어봤습니다`,
  ].filter(Boolean);

  L.push(`【제목 후보】\n${titles.map((t, i) => `  ${i + 1}. ${t}`).join('\n')}`);
  L.push('═══════════════ 여기서부터 본문 ═══════════════');

  // ── 들머리
  add(`오늘은 **${G}**입니다.`, '',
    `${G}에는 아파트 단지가 **${man(f.scale.total)}곳**, 세대로는 **${man(f.scale.households)}세대**가 있습니다.`
    + (f.scale.big ? ` 이 중 ${man(f.minHouseholds)}세대 이상 되는 단지가 ${man(f.scale.big)}곳입니다.` : ''),
    '', '하나씩 숫자로 보겠습니다.');

  // ── 1. 시세
  if (f.price) {
    const p = f.price;
    const vs = p.vsSeoul != null
      ? (p.vsSeoul >= 100 ? `서울 평균(평당 ${man(p.seoulAvg)}만원)의 **${p.vsSeoul}%**` : `서울 평균의 **${p.vsSeoul}%**`)
      : null;
    add('■ 평당 얼마인가', '',
      `${G} 아파트 평당가는 **${man(p.perPyeong)}만원**입니다.` + (vs ? ` ${vs} 수준입니다.` : ''),
      '',
      p.topDongs.length >= 2 ? `동네별로 보면 이렇습니다. ${f.dongUnit === '건' ? '(거래가 10건 이상인 동만 셉니다)' : '(단지가 2곳 이상인 동만 셉니다)'}\n`
        + p.topDongs.map((d, i) => `  ${i + 1}. ${d.name} ${man(d.avgPerPyeong)}만원 (${man(d.count)}${f.dongUnit})`).join('\n') : null,
      '',
      p.spread && p.spread >= 1.3
        ? `가장 비싼 동과 가장 싼 동이 **${p.spread}배** 차이 납니다. 같은 "${G}"라도 어디냐에 따라 전혀 다른 동네입니다.`
        : (p.spread ? `동네별 차이는 ${p.spread}배 정도로, 구 안에서 비교적 고른 편입니다.` : null),
      p.lowDongs.length && p.spread >= 1.3
        ? `\n싼 쪽은 ${p.lowDongs.map(d => `${d.name} ${man(d.avgPerPyeong)}만원`).join(' · ')} 입니다.` : null,
      // 실거래로 쓸 때는 **무엇을 잰 값인지** 한 줄 적습니다 — 시세표와 같은 말이 아닙니다.
      f.priceNote ? `\n※ ${f.priceNote}입니다. 시세 조사값이 아니라 **실제로 팔린 집들의 평당가**라,`
        + ' 매물 호가나 시세표의 숫자와는 다릅니다. 거래가 드문 동네일수록 흔들립니다.' : null);
  }

  // ── 2. 나이
  if (f.age) {
    const now = new Date().getFullYear();
    add('■ 얼마나 오래됐나', '',
      `${man(f.minHouseholds)}세대 이상 단지의 **준공 연도 중간값이 ${f.age.median}년**입니다. 올해 기준 ${now - f.age.median}년 차입니다.`,
      '',
      `· 지은 지 30년 넘은 단지 **${f.age.old30}곳** — 재건축 연한에 들어갑니다`,
      `· 10년 안쪽 새 단지 **${f.age.new10}곳**`,
      '',
      f.age.oldest.length ? `가장 오래된 곳: ${f.age.oldest.map(c => `${nm(c)} ${c.year}년`).join(' · ')}` : null,
      f.age.newest.length ? `가장 새 곳: ${f.age.newest.map(c => `${nm(c)} ${c.year}년`).join(' · ')}` : null);
  }

  // ── 3. 큰 단지
  if (f.scale.biggest.length) {
    add('■ 큰 단지', '',
      '대단지는 관리비가 분산되고 거래가 잦아 값이 잘 매겨집니다.', '',
      f.scale.biggest.map((c, i) => `  ${i + 1}. ${nm(c)} ${man(c.households)}세대${c.year ? ` · ${c.year}년` : ''}`).join('\n'));
  }

  // ── 4. 주차 (국토부 공식) — 이게 이 연재의 무기입니다
  if (f.parking) {
    const p = f.parking;
    add('■ 주차', '',
      '시세표에는 안 나오지만 살아 보면 매일 겪는 것이 주차입니다.',
      p.under1
        ? `${G}에서 공식 주차 자료가 있는 단지 **${p.count}곳** 중 **세대당 1대가 안 되는 곳이 ${p.under1}곳**입니다. 저녁에 자리 찾기 어렵다는 뜻입니다.`
        : `${G}에서 공식 주차 자료가 있는 단지 **${p.count}곳**은 **모두 세대당 1대 이상**입니다. 이 구는 주차로 고생할 일은 적어 보입니다.`,
      '',
      p.best.length ? `넉넉한 곳\n` + p.best.map((c, i) =>
        `  ${i + 1}. ${nm(c)} 세대당 ${c.per}대${c.under ? ` (지하 ${man(c.under)}대)` : ''}`).join('\n') : null,
      '',
      p.worst.length ? `빠듯한 곳\n` + p.worst.map((c, i) =>
        `  ${i + 1}. ${nm(c)} 세대당 ${c.per}대`).join('\n') : null,
      p.noUnder ? `\n지하주차장이 아예 없는 단지도 **${p.noUnder}곳** 있습니다. 비 오는 날을 생각하면 큰 차이입니다.` : null,
      '',
      '',
      '※ 국토교통부 공동주택관리정보시스템(K-apt)에 관리주체가 신고한 숫자입니다.',
      '※ 같은 단지라도 **KB부동산 단지정보와 주차 대수가 다른 경우가 많습니다**(서울 기준 절반 이상).',
      '  어느 쪽이 맞다고 저희가 고르지 않습니다. 그래서 위 두 목록에는 **두 자료가 모두 같은 쪽을 가리키는 단지만** 올렸습니다.',
      p.disputed ? `  ${G}에서 두 자료가 엇갈리는 단지 ${p.disputed}곳은 목록에서 뺐습니다. 단지별 두 숫자는 진가 단지 페이지에서 나란히 보실 수 있습니다.` : null);
  }

  // ── 5. 재건축 여력
  if (f.rebuild.lowFarCount || f.rebuild.unions.length) {
    const r = f.rebuild;
    add('■ 재건축 이야기', '',
      r.lowFarCount
        ? `용적률이 180% 이하이면서 지은 지 25년 넘은 단지가 **${r.lowFarCount}곳**입니다. 용적률이 낮을수록 새로 지을 때 더 올릴 여지가 큽니다.`
        : null,
      '',
      r.lowFar.length ? r.lowFar.map((c, i) =>
        `  ${i + 1}. ${nm(c)} 용적률 ${c.far}%${c.year ? ` · ${c.year}년` : ''}${c.households ? ` · ${man(c.households)}세대` : ''}`).join('\n') : null,
      '',
      r.unions.length
        ? `실제로 조합이 돌아가는 사업장은 ${G}에 **${r.unions.length}곳**입니다.\n`
          + r.unions.slice(0, 6).map(s => `  · ${s.name.replace(/정비사업\s*조합$/, '').trim()} — ${s.step}`).join('\n')
          + '\n\n(서울시 정비사업 정보몽땅 기준. 조합이 섰다고 다 되는 건 아니고, 단계가 어디까지 왔는지가 중요합니다.)'
        : '아직 조합이 선 사업장은 확인되지 않습니다.');
  }

  // ── 6. 임대세대 비율
  if (f.rent && f.rent.over30) {
    add('■ 임대세대 비율이 높은 단지', '',
      '임대 비중이 큰 단지는 사고팔리는 세대가 적어 거래가 드뭅니다. 그래서 주변이 올라도 시세가 그만큼 안 따라가는 일이 잦습니다.',
      '**좋고 나쁨이 아니라 성격이 다른 단지**라고 보시면 됩니다.',
      '',
      `${G}에서 임대 비율 30%가 넘는 단지가 **${f.rent.over30}곳**입니다.`,
      '',
      f.rent.highest.slice(0, 5).map((c, i) =>
        `  ${i + 1}. ${nm(c)} ${c.pct}% (${man(c.households)}세대 중 ${man(c.rentUnits)}세대)`).join('\n'));
  }

  // ── 7. 지하철
  if (f.subway && f.subway.lines.length) {
    add('■ 지하철', '',
      `공식 자료에 지하철역이 적힌 단지가 ${f.subway.count}곳이고, 지나는 노선은 ${f.subway.lines.join(' · ')} 입니다.`);
  }

  // ── 닫기
  add('■ 직접 조건 넣어 보기', '',
    `위 숫자는 제가 만든 사이트에서 뽑았습니다. ${G}를 골라 예산·면적·세대수를 넣으면`,
    '조건에 맞는 단지를 점수순으로 5곳 추려 주고, 전체 데이터는 엑셀로 받을 수 있습니다.',
    '',
    `${SITE}/?utm_source=naverblog_${guSlug(f.gu)}`,
    '',
    '무료고 로그인도 없습니다. 점수를 어떻게 매기는지도 사이트 안에 전부 적어 뒀습니다.',
    '',
    `다음 글은 **${nextGu(f.gu) || '마지막 구'}**입니다.`);

  // ── 꼬리말(발행 도움말)
  L.push('═══════════════ 본문 끝 ═══════════════');
  L.push([`【사진】 같은 폴더의 「사진_${G}」 안에 있습니다 — 아래 자리에 차례로 넣으세요`,
    '  2_주차.png       → "■ 주차" 바로 아래',
    '  3_단지.png       → "빠듯한 곳" 목록 바로 아래 (그 구에서 주차가 가장 빠듯한 단지)',
    '  4_검색결과.png   → "■ 직접 조건 넣어 보기" 바로 위',
    `  ※ 폴더가 없으면:  node scripts/shot-gu.mjs ${G}`,
    '  ※ 가로 882px 이라 네이버에서 줄어들지 않습니다. 정렬은 「문서 너비」로.',
    '',
    '【올릴 때는 .txt 말고 같은 이름의 .html 을 쓰세요】',
    '  이 .txt 를 그대로 복사하면 굵게 표시하려던 **별표가 글자로 나옵니다**(1회차에서 겪었습니다).',
    '  같은 폴더의 .html 을 브라우저로 열어 복사하면 굵게·소제목·목록이 그대로 넘어갑니다.',
    '  .html 이 없으면:  node scripts/build-post-html.mjs',
    '',
    '【태그】',
    `  ${f.gu}, ${f.gu}아파트, ${f.gu}아파트시세, 아파트시세, ${f.priceSource}, 부동산, 아파트비교, 내집마련, 임장, 재건축, 서울아파트`,
    '',
    '【확인】',
    f.kaptCoverage ? `  · 국토부 공식 자료는 ${f.minHouseholds}세대 이상 ${f.kaptCoverage.of}곳 중 ${f.kaptCoverage.have}곳(${f.kaptCoverage.pct}%)에 있습니다.` : null,
    f.asOf ? `  · ${f.priceSource} 기준 시점: ${f.asOf}` : null,
    '  · 숫자는 자료에서 뽑은 것이라 고치지 마세요. 느낌·경험만 보태시면 됩니다.',
  ].filter(Boolean).join('\n'));

  return L.filter(Boolean).join('\n\n');
}

const guSlug = g => ({
  강남구: 'gangnam', 강동구: 'gangdong', 강북구: 'gangbuk', 강서구: 'gangseo', 관악구: 'gwanak',
  광진구: 'gwangjin', 구로구: 'guro', 금천구: 'geumcheon', 노원구: 'nowon', 도봉구: 'dobong',
  동대문구: 'dongdaemun', 동작구: 'dongjak', 마포구: 'mapo', 서대문구: 'seodaemun', 서초구: 'seocho',
  성동구: 'seongdong', 성북구: 'seongbuk', 송파구: 'songpa', 양천구: 'yangcheon', 영등포구: 'yeongdeungpo',
  용산구: 'yongsan', 은평구: 'eunpyeong', 종로구: 'jongno', 중구: 'junggu', 중랑구: 'jungnang',
}[g] || 'gu');

const nextGu = g => GU_ORDER[GU_ORDER.indexOf(g) + 1] || null;

function main() {
  const args = process.argv.slice(2);

  if (args[0] === '--calendar') {
    const start = args[1] && !args[1].startsWith('--') ? args[1] : new Date().toISOString().slice(0, 10);
    // --first 노원구,강서구,성북구  → 그 셋을 앞으로, 나머지는 가나다순
    const firstArg = args.find(a => a.startsWith('--first='));
    // --done 노원구:2026-10-20,강서구:2026-10-23  → 이미 올린 회차. 남은 구만 새 날짜에 배치하고,
    // 올린 회차는 올린 날짜 그대로 위에 남깁니다. 번호가 이어져야 알림창의 「n회차 / 25」가 맞습니다.
    // (일정이 한 번 밀리면 앞 회차까지 날짜가 통째로 다시 잡혀, 올린 글과 일정표가 어긋났습니다)
    const doneArg = args.find(a => a.startsWith('--done='));
    const done = doneArg ? doneArg.slice(7).split(',').map(s => s.trim()).filter(Boolean)
      .map(s => { const [gu, date] = s.split(':'); return { gu: gu.trim(), date: (date || '').trim() }; }) : [];
    const unknown = done.map(d => d.gu).filter(g => !GU_ORDER.includes(g));
    if (unknown.length) throw new Error(`자치구 이름이 아닙니다: ${unknown.join(' ')}`);
    const doneSet = new Set(done.map(d => d.gu));
    const order = (firstArg ? orderWithFirst(firstArg.slice(8).split(',').map(s => s.trim())) : GU_ORDER)
      .filter(g => !doneSet.has(g));
    const rows = schedule(start, order);
    console.log(`주 2회(화·금) 연재 일정 — ${done.length ? `${done.length}편은 올렸고 남은 ${rows.length}편은 ` : ''}${start} 부터\n`);
    const W = ['일', '월', '화', '수', '목', '금', '토'];
    const line = (n, date, gu, mark) => {
      const d = date ? new Date(date + 'T00:00:00Z') : null;
      const when = d && !Number.isNaN(d.getTime()) ? `${date}(${W[d.getUTCDay()]})` : '(날짜 모름)  ';
      console.log(`${String(n).padStart(2)}. ${when}  ${gu}${mark || ''}`);
    };
    done.forEach((d, i) => line(i + 1, d.date, d.gu, '   ← 올림'));
    rows.forEach((r, i) => line(done.length + i + 1, r.date, r.gu));
    console.log(`\n모두 ${done.length + rows.length}편 · 마지막 ${rows[rows.length - 1].date}`);
    return;
  }

  const source = args.find(a => a.startsWith('--source='))?.slice(9) || 'kb';
  const data = loadData(source);
  const save = args.includes('--save') || args[0] === '--all';
  const list = args[0] === '--all' ? GU_ORDER : [args[0]];

  if (!args.length) {
    console.log('쓰는 법: node scripts/post-draft.mjs <자치구> [--save] | --all | --calendar [시작일]');
    console.log('자치구: ' + GU_ORDER.join(' '));
    return;
  }
  if (args[0] !== '--all' && !GU_ORDER.includes(args[0])) {
    throw new Error(`자치구 이름이 아닙니다: ${args[0]}\n  ${GU_ORDER.join(' ')}`);
  }

  if (save) fs.mkdirSync(OUT_DIR, { recursive: true });

  for (const g of list) {
    const f = guFacts(g, data);
    if (!f) { console.error(`${g}: 자료가 없습니다 — 건너뜁니다`); continue; }
    const text = draft(f);
    if (save) {
      const i = String(GU_ORDER.indexOf(g) + 1).padStart(2, '0');
      const file = path.join(OUT_DIR, `${i}_${g}.txt`);
      fs.writeFileSync(file, text);
      console.log(`${g} → ${path.relative(process.cwd(), file)} (${(text.length / 1024).toFixed(1)}KB)`);
    } else {
      console.log(text);
    }
  }
  if (save) console.log(`\n저장 위치: ${OUT_DIR}`);
}

try { main(); } catch (e) { console.error('실패:', e.message); process.exit(1); }
