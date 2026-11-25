// /decision 페이지와 그 자료의 계약 (계획서 T009).
//
// 이 파일이 지키는 약속은 셋입니다.
//   1) **복사본이 원본과 같다** — 브라우저가 쓰는 엔진·규칙집이 저장소의 원본과 한 글자도 다르지 않아야 합니다.
//      사람이 손으로 복사하면 반드시 어긋나고, 어긋난 줄 아무도 모릅니다. 그래서 테스트가 봅니다.
//   2) **숫자마다 출처 배지가 붙어 있다** — 공공데이터·공식목록·추정·가정을 섞어 보여 주지 않습니다.
//   3) **화면 규격을 지킨다** — 본문 14px 아래 금지, 제목 20~44px, 모바일 분기 760px.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildIndex, ENGINE_HEADER, SRC, OUT, rewriteImports } from './build-decision.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = path.join(ROOT, 'site', 'public', 'decision', 'index.html');
const read = p => fs.readFileSync(p, 'utf8');

test('브라우저가 쓰는 계산 엔진은 저장소 원본과 똑같다', () => {
  assert.ok(fs.existsSync(OUT.engine), 'site/public/jinga-finance.mjs 가 없습니다 — npm run build:decision');
  const copy = read(OUT.engine);
  const origin = read(SRC.engine);
  assert.ok(copy.startsWith(ENGINE_HEADER), '복사본임을 알리는 머리말이 있어야 합니다');
  assert.equal(copy.slice(ENGINE_HEADER.length), origin,
    '복사본이 scripts/_finance.mjs 와 다릅니다 — npm run build:decision 을 다시 돌리십시오');
});

test('보고서 모듈 복사본도 원본과 똑같다 — import 주소만 다름', () => {
  for (const [srcKey, outKey] of [['report', 'report'], ['compose', 'compose']]) {
    assert.ok(fs.existsSync(OUT[outKey]), `${OUT[outKey]} 가 없습니다 — npm run build:decision`);
    const copy = read(OUT[outKey]);
    assert.ok(copy.startsWith(ENGINE_HEADER), `${outKey}: 복사본 머리말이 없습니다`);
    assert.equal(copy.slice(ENGINE_HEADER.length), rewriteImports(read(SRC[srcKey])),
      `${outKey}: 복사본이 원본과 다릅니다 — npm run build:decision 을 다시 돌리십시오`);
  }
  // 복사본이 형제 파일을 부르는지 — 원본 이름(_report.mjs)을 그대로 두면 브라우저에서 404 입니다
  const compose = read(OUT.compose);
  assert.ok(compose.includes("from './jinga-report.mjs'"), '복사본이 형제 파일을 불러야 합니다');
  assert.ok(!compose.includes("from './_report.mjs'"), '원본 이름이 남아 있으면 브라우저에서 404 입니다');
});

test('보고서 모듈도 브라우저에서 돌 수 있어야 한다 — node 전용 기능 금지', () => {
  for (const key of ['report', 'compose']) {
    const src = read(SRC[key]);
    assert.ok(!src.includes("from " + String.fromCharCode(39) + "node:"), key + ": node: 모듈을 import 하면 브라우저에서 깨집니다");
    assert.ok(!src.includes("require("), key + ": require 를 쓰면 브라우저에서 깨집니다");
    assert.ok(!src.includes("process."), key + ": process 를 쓰면 브라우저에서 깨집니다");
  }
});

test('화면이 보고서를 쓰고, 출처 없는 주장은 내보내지 않는다', () => {
  const html = read(PAGE);
  assert.ok(html.includes("/jinga-report-compose.mjs"), "보고서 모듈을 불러야 합니다");
  assert.ok(html.includes("composeReport("), "보고서를 짜는 호출이 있어야 합니다");
  // 인쇄(PDF)는 위반이 있으면 막아야 합니다 — 내보내면 안 되는 보고서입니다
  assert.ok(html.includes("REPORT.violations.length"), "위반이 있을 때 막는 코드가 있어야 합니다");
  assert.ok(html.includes("window.print()"), "인쇄로 PDF 를 저장합니다");
  assert.ok(html.includes("@media print"), "인쇄용 스타일이 있어야 합니다");
  // 성격 배지 네 종류가 주장 줄에 쓰이는지
  assert.ok(html.includes("BASIS_BADGE"), "성격 배지를 쓰는 코드가 있어야 합니다");
  for (const b of ['bq-official', 'bq-real', 'bq-est', 'bq-assume']) assert.ok(html.includes(b), b);
});

test('엔진은 브라우저에서 돌 수 있어야 한다 — node 전용 기능 금지', () => {
  const src = read(SRC.engine);
  assert.ok(!/from\s+['"]node:/.test(src), 'node: 모듈을 import 하면 브라우저에서 깨집니다');
  assert.ok(!/\brequire\s*\(/.test(src), 'require 를 쓰면 브라우저에서 깨집니다');
  assert.ok(!/\bprocess\./.test(src), 'process 를 쓰면 브라우저에서 깨집니다');
  assert.ok(!/\b__dirname\b/.test(src));
});

test('규칙집 복사본도 원본과 똑같다', () => {
  assert.ok(fs.existsSync(OUT.rules), 'site/public/finance-rules.json 이 없습니다');
  assert.equal(read(OUT.rules), read(SRC.rules));
  const r = JSON.parse(read(OUT.rules));
  assert.match(r.version, /^\d{4}\.\d{2}\.\d{2}$/);
  assert.ok(r.notice.includes('자문이 아닙니다'), '배포본에도 주의문이 살아 있어야 합니다');
});

test('검색 색인 — 이름 없는 단지는 넣지 않는다', () => {
  const idx = buildIndex({
    prices: {
      asOfYM: '202611', source: '국토교통부', model: 'docs/model-card.md',
      region: { months: 3, seoul: { perPyeong: 4595, n: 100 }, gu: {} },
      byComplex: {
        '1': { seq: 'S1', kaptCode: 'A1', areas: [{ area: 84, perPyeong: 5000, amount: 120000, low: 110000, high: 130000, n: 7, grade: 'A', last: '202610' }] },
        '2': { seq: 'S2', kaptCode: 'A9', areas: [{ area: 59, perPyeong: 4000, amount: 70000, low: 65000, high: 75000, n: 4, grade: 'B', last: '202609' }] },
        '3': { seq: 'S3', kaptCode: 'A1', areas: [] },
      },
    },
    kapt: { source: 'K-apt', byCode: { A1: { name: '가나아파트', gu: '강동구', dong: '명일동' } } },
  });
  assert.equal(idx.complexes.length, 1, '공식 단지목록에 없는 A9, 면적이 빈 곳은 빠집니다');
  assert.equal(idx.counts.skippedNoName, 1, '몇 곳을 뺐는지 세어 둡니다');
  assert.equal(idx.complexes[0].name, '가나아파트');
  assert.deepEqual(idx.complexes[0].areas[0], { m2: 84, pp: 5000, amt: 120000, lo: 110000, hi: 130000, n: 7, g: 'A', last: '202610' });
  assert.ok(idx.source.includes('국토교통부'), '출처 문구를 색인에 함께 담습니다');
});

test('실제 색인이 만들어져 있고 모양이 맞다', () => {
  assert.ok(fs.existsSync(OUT.index), 'site/public/decision-index.json 이 없습니다');
  const idx = JSON.parse(read(OUT.index));
  assert.ok(idx.counts.complexes > 100, `단지 ${idx.counts.complexes}곳`);
  assert.match(idx.asOfYM, /^\d{6}$/);
  assert.ok(idx.source.includes('추정치이며 실거래가가 아닙니다'), '색인 자체가 추정임을 밝혀야 합니다');
  assert.ok(idx.region && idx.region.gu && Object.keys(idx.region.gu).length >= 20, '자치구 집계가 들어 있어야');
  for (const c of idx.complexes.slice(0, 50)) {
    assert.ok(c.id && c.name && c.gu, `단지 칸이 비었습니다: ${JSON.stringify(c)}`);
    assert.ok(c.areas.length > 0);
    for (const a of c.areas) {
      assert.ok(a.m2 > 0 && a.lo > 0 && a.hi >= a.lo, `면적 칸이 이상합니다: ${JSON.stringify(a)}`);
      assert.ok(['A', 'B', 'C', 'D', 'none'].includes(a.g));
      // 대표값을 안 내는 등급(D)은 amt 가 없어야 합니다 — 없는 값을 0 으로 채우면 「0원」으로 읽힙니다
      if (a.g === 'D' || a.g === 'none') assert.ok(!a.amt, 'D등급에 대표값이 들어 있습니다');
    }
  }
});

test('페이지에 여덟 칸이 모두 있다', () => {
  const html = read(PAGE);
  // 계획서 screen_design.components
  for (const id of ['h-legend', 'h-search', 'h-metric', 'h-cands', 'h-break', 'h-report', 'h-meth', 'h-src']) {
    assert.ok(html.includes(`id="${id}"`), `${id} 칸이 없습니다`);
  }
  for (const hook of ['#gu', '#name', '#area', '#floor', '#cands', '#breakdown', '#toc']) {
    assert.ok(html.includes(hook), `${hook} 를 쓰는 자리가 없습니다`);
  }
});

test('숫자 출처를 구분하는 배지가 네 종류 다 있다', () => {
  const html = read(PAGE);
  for (const [cls, label] of [['bq-real', '실거래'], ['bq-official', '공식'], ['bq-est', '추정'], ['bq-assume', '가정']]) {
    assert.ok(html.includes(cls), `${cls} 배지 모양이 없습니다`);
    assert.ok(html.includes(label), `${label} 배지 글자가 없습니다`);
  }
  assert.ok(html.includes('숫자 읽는 법'), '배지 설명이 화면에 있어야 합니다');
});

test('추정임을 숨기지 않는다', () => {
  const html = read(PAGE);
  assert.ok(html.includes('추정치이며 실거래가가 아닙니다'));
  assert.ok(html.includes('자문'), '세무·금융 자문이 아니라는 문구');
  assert.ok(html.includes('예측이 아니라 가정'), '미래 가격은 가정이라고 못박아야 합니다');
  assert.ok(html.includes('준비 중'), '안 된 것은 안 됐다고 적어야 합니다');
  // 민간 유료 시세를 끌어다 쓰지 않습니다 — P0 에서 끊은 것이 되살아나면 안 됩니다
  assert.ok(!/kb-seoul-gu|api\/kb-gu|kbland|KB시세/i.test(html), '무허가 시세 자료를 다시 쓰고 있습니다');
  assert.ok(html.includes('민간 유료 시세 자료는 쓰지 않습니다'));
});

test('화면 규격 — 본문 14px 아래 금지, 제목 20~44px, 모바일 760px', () => {
  const html = read(PAGE);
  assert.ok(html.includes('font:400 16px/1.65'), '본문 기본 16px');
  assert.ok(html.includes('clamp(28px,5vw,44px)'), 'h1 은 28~44px');
  assert.ok(html.includes('clamp(20px,2.6vw,27px)'), 'h2 는 20px 아래로 내려가지 않습니다');
  assert.ok(html.includes('@media (max-width:760px)'), '모바일 분기 760px');
  // 13px 는 배지·태그(장식)에만 허용하고, 본문·표에 쓰면 안 됩니다
  const smalls = [...html.matchAll(/font(?:-size)?:\s*(?:\d+\s+)?(\d+)px/g)].map(m => Number(m[1]));
  const tooSmall = smalls.filter(v => v < 13);
  assert.equal(tooSmall.length, 0, `13px 아래 글씨: ${tooSmall.join(',')}`);
});

test('손가락이 닿는 크기 — 입력·단추는 44px 이상', () => {
  const html = read(PAGE);
  assert.ok(html.includes('min-height:44px'), '입력칸·단추 최소 높이 44px');
  assert.ok(/\.check\{[^}]*min-height:44px/.test(html.replace(/\s+/g, '')) || html.includes('min-height:44px'));
  assert.ok(html.includes('outline:3px solid'), '키보드로 옮겨 다닐 때 보이는 테두리');
  assert.ok(html.includes('aria-current="page"'), '지금 보고 있는 메뉴 표시');
  assert.ok(html.includes('lang="ko"'));
});

test('입력값은 기기 안에만 — 서버로 보내지 않는다', () => {
  const html = read(PAGE);
  assert.ok(html.includes('localStorage'), '입력값은 이 기기에만 저장');
  assert.ok(html.includes('서버로 보내지 않습니다'), '그렇다고 화면에 적어야 합니다');
  // 입력값을 바깥으로 보내는 코드가 있으면 안 됩니다
  const fetches = [...html.matchAll(/fetch\(\s*['"]([^'"]+)['"]/g)].map(m => m[1]);
  assert.deepEqual(fetches.sort(), ['/decision-index.json', '/finance-rules.json'],
    `읽기만 해야 하는데 다른 곳을 부릅니다: ${fetches.join(', ')}`);
  assert.ok(!/method:\s*['"]POST/i.test(html), 'POST 로 무언가 올리고 있습니다');
});

test('기존 페이지를 건드리지 않았다 — /decision 은 따로 산다', () => {
  const v = JSON.parse(read(path.join(ROOT, 'site', 'public', 'vercel.json')));
  assert.ok(v.rewrites.some(r => r.source === '/decision' && r.destination === '/decision/index.html'),
    '/decision 길이 열려 있어야 합니다');
  // 검색·추천·커뮤니티가 쓰는 파일을 /decision 이 가져가거나 덮지 않았는지
  for (const f of ['index.html', 'jinga-kb.mjs', 'jinga-reco.mjs', 'jinga-flow.mjs', 'pages.css']) {
    assert.ok(fs.existsSync(path.join(ROOT, 'site', 'public', f)), `${f} 가 사라졌습니다`);
  }
});

// ── 끝까지 한 번 돌려 보기 ──────────────────────────────────────────────────
// 화면 코드가 색인의 칸 이름(m2·amt·lo·hi…)을 잘못 읽어도 위 테스트는 다 통과합니다.
// 그래서 **배포되는 엔진 복사본으로, 실제 색인의 단지 하나를** 끝까지 계산해 봅니다.
test('실제 단지 하나로 계산이 끝까지 돌아간다', async () => {
  const { scenarios } = await import(pathToFileURL(OUT.engine).href);
  const RULES = JSON.parse(read(OUT.rules));
  const idx = JSON.parse(read(OUT.index));

  const c = idx.complexes.find(x => x.areas.some(a => a.amt > 0));
  assert.ok(c, '대표값이 있는 단지가 하나도 없습니다');
  const a = c.areas.find(x => x.amt > 0);

  // 화면이 하는 것과 똑같이: 만원 → 원
  const out = scenarios({
    price: a.amt * 10000, areaM2: a.m2, cash: 7e8, annualIncome: 1e8,
    annualRate: 0.04, years: 30, holdYears: 5, method: 'equal',
    monthlyMaintenance: 250000, publicPriceRatio: 0.7, regulated: true, houses: 1, liveYears: 5,
  }, RULES, undefined, '2026-11-23');

  const b = out.base;
  assert.ok(b.acquisition.total > 0, '취득비용이 0 입니다');
  assert.ok(b.acquisition.items.every(i => i.label && Number.isFinite(i.amount)), '취득비용 칸 이름·금액');
  assert.ok(b.loanLimit.candidates.length === 3, '대출 한도 세 기준');
  assert.ok(b.loanLimit.candidates.some(x => x.key === b.loanLimit.binding));
  assert.equal(b.holding.rows.length, 5);
  assert.equal(b.yearly.length, 5);
  assert.ok(Number.isFinite(b.cashNeeded) && Number.isFinite(b.outflowDuringHold));
  assert.equal(out.cases.length, 3);
  for (const k of out.cases) {
    assert.equal(k.assumed, true);
    assert.ok(Number.isFinite(k.sellPrice) && Number.isFinite(k.profit));
    assert.ok(k.capitalGains && Number.isFinite(k.capitalGains.total));
  }
  assert.ok(out.warnings.length > 0, '경고가 하나도 없으면 경고 전달이 끊긴 것입니다');
  assert.ok(out.warnings.every(w => w.label && w.message && w.confidence));
  // 화면이 쓰는 한글 표기 함수가 NaN 을 만들지 않는지
  assert.ok(!String(Math.round(b.acquisition.total / 10000)).includes('NaN'));
});
