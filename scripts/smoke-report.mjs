// 진가 점수·BEST 5·엑셀·주간 비교 스모크 테스트 (네트워크 없음)
//   node --test scripts/smoke-report.mjs   (npm test 에 포함)
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, compactKbTypes, buildSearchSheets, complexOk, listingCandidates, criteriaText } from '../site/public/jinga-kb.mjs';
import { buildXlsx } from '../site/public/xlsx-lite.mjs';
import { makeSnapshot, diffSnapshots, parseNewsRss, classifyNews, isSameStory, planGroups, toKbCriteria, groupDirName, snapshotView } from './weekly-report.mjs';
import { aggregate, attachChange, compactForCompare } from './build-kb-gu.mjs';

test('KB 구·동 집계: 세대수 가중 평당가와 주간 변동률', () => {
  const t = (excl, price, hh, provided = true) => ({ excl, price, hh, provided });
  const data = aggregate([
    { gu: '강동구', dong: '명일동', types: [t(84.9, 200000, 300), t(59.9, 150000, 100)] },
    { gu: '강동구', dong: '고덕동', types: [t(84.9, 170000, 500), t(84.9, 0, 50, false)] },
    { gu: '송파구', dong: '잠실동', types: [t(84.9, 300000, 1000)] },
  ]);
  assert.equal(data.seoul.count, 3);
  const gd = data.gu['강동구'];
  assert.equal(gd.count, 2);
  assert.equal(gd.households, 900, '시세 미제공 타입 세대는 빼고 합산');
  const pp = (p, a) => p / (a / 3.3058);
  const expected = Math.round((pp(200000, 84.9) * 300 + pp(150000, 59.9) * 100 + pp(170000, 84.9) * 500) / 900);
  assert.equal(gd.avgPerPyeong, expected);
  assert.equal(gd.dongs[0].name, '고덕동', '동은 세대수 많은 순');

  const base = compactForCompare({ asOf: '2026.09.04', gu: data.gu });
  const next = aggregate([
    { gu: '강동구', dong: '명일동', types: [t(84.9, 202000, 300), t(59.9, 150000, 100)] },
    { gu: '강동구', dong: '고덕동', types: [t(84.9, 170000, 500)] },
    { gu: '송파구', dong: '잠실동', types: [t(84.9, 297000, 1000)] },
  ]);
  attachChange(next, base);
  assert.equal(next.prevAsOf, '2026.09.04');
  assert.ok(next.gu['강동구'].pct > 0);
  assert.equal(next.gu['송파구'].pct, -1);
  assert.equal(next.gu['강동구'].dongs.find(d => d.name === '고덕동').pct, 0);
});

test('뉴스 분류: 제목 키워드로만 분류하고 무관·중복 기사는 거름', () => {
  assert.equal(classifyNews('광진구 자양4동 A구역, 재개발 조합설립인가 완료'), '정비사업');
  assert.equal(classifyNews('이대한 의원 "강동하남남양주선 2031년 개통 위해 대책 서둘러야"'), '교통');
  assert.equal(classifyNews('강동구, 추석 앞두고 강동사랑상품권 60억 발행'), null);
  assert.equal(classifyNews('동작구, 청소년이 만드는 환경마라톤 오투런 개최'), null);
  assert.equal(classifyNews('李대통령 지지율 38%…부동산 정책 부정 평가 1위'), null);
  assert.equal(classifyNews('이번 주말 강동구 천호공원서 가을축제…가족 단위 즐길 거리 가득'), null);
  assert.equal(classifyNews('강동경희대병원 조대진·배성수 교수팀, 척추기초연구회 최우수상'), null);
  assert.equal(classifyNews('비에스성동피에프브이, 보성산업개발로부터 주식 담보 32억 수취'), null);
  assert.equal(classifyNews('명일동 상업지역 용적률 상향…대규모 개발 가능해져'), '개발·생활환경');
  assert.equal(classifyNews('광진구, 동서울터미널 현대화 사업 추진…2031년 준공 목표'), '개발·생활환경');
  assert.equal(classifyNews('동작구, 폭염·한파 피하는 우리동네 쉼터 2곳 조성'), '개발·생활환경');
  assert.ok(isSameStory('광진구 자양4동 A구역, 재개발 조합설립인가 완료', '광진구 \'자양4동 A구역\' 재개발 조합설립인가…2천999세대 규모'));
  assert.ok(!isSameStory('광진구 자양4동 A구역 재개발 조합설립인가', '고덕주공9단지 재건축 추진위원회 승인'));
});

const type = (excl, price, extra = {}) => ({ excl, supPy: '', price, lo: price - 5000, hi: price + 5000, jeonse: Math.round(price * 0.5), hh: 300, provided: true, areaId: 1, ...extra });
const brief = (built, households, extra = {}) => ({ built, builtYm: `${built}.01`, households, rebuild: false, interest: 100, forSale: 5, ...extra });

const complexes = [
  { id: 1, name: '신축대단지', gu: '강동구', dong: '고덕동', brief: brief(2021, 3000), types: [type(84.9, 128000), type(59.9, 110000)] },
  { id: 2, name: '예산초과', gu: '강동구', dong: '명일동', brief: brief(2019, 1900), types: [type(84.9, 214000)] },
  { id: 3, name: '구축중형', gu: '송파구', dong: '가락동', brief: brief(1988, 800), types: [type(84.0, 125000)] },
  { id: 4, name: '소규모', gu: '송파구', dong: '문정동', brief: brief(2015, 120), types: [type(84.0, 129000)] },
  { id: 5, name: '시세미제공', gu: '송파구', dong: '문정동', brief: brief(2015, 900), types: [type(84.0, 120000, { provided: false })] },
];

test('evaluate: 예산·면적·규모 조건과 단지당 1개 BEST 5', () => {
  const r = evaluate(complexes, { budget: 130000, minArea: 59, minHh: 300 }, 2026);
  const names = r.best5.map(e => e.c.name);
  assert.deepEqual(names, ['신축대단지', '구축중형'], '예산 초과·소규모·시세 미제공은 빠지고 신축대단지가 1위');
  assert.equal(r.best5.filter(e => e.c.id === 1).length, 1, '한 단지는 BEST 5에 한 번만');
  assert.equal(r.qualifying.length, 3, '신축대단지 2개 면적 + 구축중형 1개');
  assert.equal(r.complexCount, 2);
  assert.ok(r.best5[0].score.total > r.best5[1].score.total);
});

test('evaluate: 예산·면적 상하한(10~11억, 59~84㎡)', () => {
  const cs = [
    { id: 11, name: '범위단지', gu: '강동구', dong: '명일동', brief: brief(2015, 1000),
      types: [type(84.97, 105000), type(59.5, 99000), type(114.9, 108000), type(59.9, 100000)] },
    { id: 12, name: '상한초과', gu: '강동구', dong: '명일동', brief: brief(2015, 1000), types: [type(84.9, 112000)] },
  ];
  const crit = { budgetMin: 100000, budget: 110000, minArea: 59, maxArea: 84, minHh: 0 };
  const r = evaluate(cs, crit, 2026);
  assert.deepEqual(r.qualifying.map(e => e.t.excl).sort(), [59.9, 84.97],
    '9.9억(하한 미달)·114.9㎡(면적 상한 초과)·11.2억(상한 초과)은 빠지고, 84.97㎡는 84㎡형으로 포함');
  const low = r.qualifying.find(e => e.t.price === 100000);
  assert.equal(low.score.parts.budget, 0, '예산 하한 가격은 예산 활용 0점');
  const hi = r.qualifying.find(e => e.t.price === 105000);
  assert.equal(hi.score.parts.budget, 25, '상한의 95%(10.45억) 이상은 만점');
});

test('호가 기준: 매물 호가 평균으로 예산을 판단하고, 매물 없으면 KB시세로', () => {
  const withAsk = (t, askAvg, askCount) => ({ ...t, listing: { askAvg, askCount, jeonseAskAvg: 0, recentDeal: null } });
  const cs = [
    { id: 21, name: '호가높음', gu: '강동구', dong: '강일동', brief: brief(2021, 900), types: [withAsk(type(59.5, 119500), 142000, 6)] },
    { id: 22, name: '호가근접', gu: '강동구', dong: '길동', brief: brief(1994, 800), types: [withAsk(type(84.7, 120000), 127000, 9)] },
    { id: 23, name: '매물없음', gu: '강동구', dong: '명일동', brief: brief(2000, 700), types: [withAsk(type(59.8, 121000), 0, 0)] },
  ];
  const base = { budget: 130000, minArea: 59, minHh: 0 };
  const ask = evaluate(cs, { ...base, basis: 'ask' }, 2026);
  // 매물없음은 KB 12.1억이지만 호가 괴리 중앙값(+18.8%·+5.8% → +12.3%)을 적용한 추정 호가 13.59억이라 빠짐
  assert.deepEqual(ask.qualifying.map(e => e.c.name), ['호가근접'], '호가 14.2억·추정 호가 13.59억은 13억 예산에서 빠짐');
  const near = ask.qualifying[0].score;
  assert.equal(near.judge, 127000);
  assert.equal(near.useAsk, true);
  assert.equal(near.askGap, 5.8);
  assert.ok(near.parts.safety < 10, '호가가 상한의 95%(12.35억)를 넘으면 가격 안전 감점');

  const wide = evaluate(cs, { ...base, budget: 140000, basis: 'ask' }, 2026);
  const none = wide.qualifying.find(e => e.c.name === '매물없음').score;
  assert.equal(none.useEst, true);
  assert.equal(none.judge, Math.round(121000 * (1 + ((142000 / 119500 - 1) + (127000 / 120000 - 1)) / 2)));
  assert.ok(none.reasons.some(r => r.includes('추정')));
  assert.match(none.basisLabel, /^추정 호가/);

  const kb = evaluate(cs, { ...base, basis: 'kb' }, 2026);
  assert.equal(kb.qualifying.length, 3, 'KB시세 기준이면 세 곳 모두 13억 이하');
  assert.ok(kb.qualifying.find(e => e.c.name === '호가높음').score.altLabel.includes('호가 평균'));
});

test('호가 이상치: 매물 1건이거나 KB 대비 +50% 초과면 호가 평균을 쓰지 않고 추정', () => {
  const mk = (id, askAvg, askCount) => ({ id, name: 'n' + id, gu: '광진구', dong: '구의동', brief: brief(2000, 500),
    types: [{ ...type(84.7, 100500), listing: { askAvg, askCount, jeonseAskAvg: 0, recentDeal: null } }] });
  const cs = [mk(31, 190000, 1), mk(32, 190000, 5), mk(33, 110000, 4), mk(34, 108000, 6)];
  const r = evaluate(cs, { budget: 200000, minArea: 0, minHh: 0, basis: 'ask' }, 2026);
  const s = id => r.qualifying.find(e => e.c.id === id).score;
  assert.equal(s(31).useAsk, false, '매물 1건');
  assert.equal(s(32).useAsk, false, '+89% 이상치');
  assert.equal(s(33).useAsk, true);
  assert.equal(s(31).useEst, true);
});

test('scoreEntry: 상위가가 예산을 넘으면 가격 안전 감점', () => {
  const r = evaluate([{ id: 9, name: 'x', gu: 'g', dong: 'd', brief: brief(2020, 1000), types: [type(84, 128000)] }], { budget: 130000, minArea: 0, minHh: 0 }, 2026);
  assert.ok(r.best5[0].score.parts.safety < 10);
  const r2 = evaluate([{ id: 9, name: 'x', gu: 'g', dong: 'd', brief: brief(2020, 1000), types: [type(84, 120000)] }], { budget: 130000, minArea: 0, minHh: 0 }, 2026);
  assert.equal(r2.best5[0].score.parts.safety, 10);
});

test('compactKbTypes: 같은 면적·시세 타입 묶기와 전세가', () => {
  const rows = [
    { 전용면적: '49.66', 매매일반거래가: 157333, 매매하한가: 151000, 매매상한가: 162667, 전세일반거래가: 73333, 세대수: 116, 시세제공여부: '1', 면적일련번호: 1 },
    { 전용면적: '49.68', 매매일반거래가: 157333, 매매하한가: 151000, 매매상한가: 162667, 전세일반거래가: 73333, 세대수: 53, 시세제공여부: '1', 면적일련번호: 2 },
    { 전용면적: '84.97', 매매일반거래가: 0, 세대수: 10, 시세제공여부: '0', 면적일련번호: 3 },
  ];
  const t = compactKbTypes(rows);
  assert.equal(t.length, 2);
  assert.equal(t[0].hh, 169);
  assert.equal(t[0].jeonse, 73333);
  assert.equal(t[1].provided, false);
});

test('엑셀: 시트 4개가 들어간 xlsx(ZIP) 생성', () => {
  const r = evaluate(complexes, { budget: 130000, minArea: 59, minHh: 300 }, 2026);
  const sheets = buildSearchSheets({ criteria: { budget: 130000, minArea: 59, minHh: 300 }, gus: ['강동구', '송파구'], asOf: '2026.09.11', complexes, result: r });
  assert.deepEqual(sheets.map(s => s.name), ['진가 BEST 5', '조건 충족 전체', '조회 전수(KB)', '점수 산식·출처']);
  assert.equal(sheets[2].rows.length - 3, 6, '조회 전수 시트는 모든 단지×주택형(6행)');
  const bytes = buildXlsx(sheets);
  assert.equal(String.fromCharCode(bytes[0], bytes[1]), 'PK');
  assert.ok(new TextDecoder().decode(bytes).includes('신축대단지'));
});

test('주간 비교: 시세 변동·신규 편입/이탈·구별 평균', () => {
  const crit = { budget: 130000, minArea: 59, minHh: 300 };
  const r1 = evaluate(complexes, crit, 2026);
  const prev = makeSnapshot('2026-09-07', '2026.09.04', crit, ['강동구'], complexes, r1);
  const moved = complexes.map(c => c.id === 3 ? { ...c, types: [type(84.0, 132000)] } : c.id === 1 ? { ...c, types: [type(84.9, 129000), type(59.9, 110000)] } : c);
  const r2 = evaluate(moved, crit, 2026);
  const cur = makeSnapshot('2026-09-14', '2026.09.11', crit, ['강동구'], moved, r2);
  const d = diffSnapshots(prev, cur);
  assert.equal(d.prevDate, '2026-09-07');
  assert.equal(d.changed, 2);
  assert.equal(d.up[0].name, '구축중형', '가장 많이 오른 곳(12.5억→13.2억)');
  assert.deepEqual(d.exited.map(x => x.name), ['구축중형'], '예산을 넘어 이탈');
  assert.equal(d.entered.length, 0);
  assert.ok(d.guAvg.find(g => g.gu === '송파구').pct > 0);
  assert.equal(diffSnapshots(null, cur).prevDate, null);
});

test('구독자 조건별 보고서 묶음: 같은 조건은 하나로, 조건 없는 구독자는 기본 조건', () => {
  const cfg = { gus: ['송파구', '강동구'], budgetMinEok: 0, budgetEok: 13, minArea: 59, maxArea: 0, minHouseholds: 300, priceBasis: 'ask' };
  const mapo = { gus: ['마포구'], budgetEok: 11, minArea: 59, maxArea: 84, minHouseholds: 500, priceBasis: 'kb' };
  const { groups, skipped } = planGroups(cfg, [
    { status: 'confirmed', criteria: null },
    { status: 'confirmed', criteria: { ...cfg, gus: ['강동구', '송파구'] } },
    { status: 'confirmed', criteria: mapo },
    { status: 'confirmed', criteria: { ...mapo } },
    { status: 'pending', criteria: { ...mapo, budgetEok: 20 } },
  ]);
  assert.equal(skipped, 0);
  assert.equal(groups.length, 2, '기본 조건 + 마포구 조건(확인 전 구독자는 제외)');
  assert.equal(groups[0].isDefault, true);
  assert.equal(groups[0].subscribers, 2, '조건 없는 구독자 + 기본과 같은 조건(자치구 순서만 다름)');
  assert.equal(groups[1].subscribers, 2);
  assert.deepEqual(toKbCriteria(groups[1].criteria), { budget: 110000, budgetMin: 0, minArea: 59, maxArea: 84, minHh: 500, basis: 'kb', maxRentPct: 0 });
  assert.notEqual(groupDirName(groups[0].key), groupDirName(groups[1].key));
});

test('조건별 스냅샷 비교: 예전 형식 기본 조건 호환, 새 조건은 시세 변동만', () => {
  const crit = { budget: 130000, minArea: 59, minHh: 300, basis: 'ask' };
  const r1 = evaluate(complexes, crit, 2026);
  const legacy = makeSnapshot('2026-09-07', '2026.09.04', crit, ['강동구', '송파구'], complexes, r1);   // 예전 파일 형식
  const baseKey = planGroups({ gus: ['강동구', '송파구'], budgetEok: 13, minArea: 59, minHouseholds: 300, priceBasis: 'ask' }).groups[0].key;
  const view = snapshotView(legacy, baseKey, ['강동구', '송파구']);
  assert.deepEqual(view.qualifying, legacy.qualifying, '예전 스냅샷의 조건이 같으면 편입·이탈 비교에 사용');
  const other = snapshotView(legacy, 'other-key', ['강동구']);
  assert.equal(other.qualifying, undefined);
  assert.ok(Object.values(other.complexes).every(c => c.gu === '강동구'), '보고서 자치구만 남김');
  const cur = snapshotView({ date: '2026-09-14', asOf: '2026.09.11', complexes: legacy.complexes, groups: { 'other-key': { qualifying: [], best5: [], complexCount: 0 } } }, 'other-key', ['강동구']);
  const d = diffSnapshots(other, cur);
  assert.equal(d.rankCompared, false);
  assert.equal(d.prevDate, '2026-09-07', '시세 변동 비교는 그대로');
  assert.deepEqual([d.entered, d.exited, d.prevBest, d.prevCount], [[], [], [], null]);
});

test('보고서 HTML: 핵심이 위, 세부 탭이 아래 · 스크립트 없음 · 탭 CSS가 없어도 내용 유지', async () => {
  const { renderReportHtml, TABS } = await import('./report-html.mjs');
  const crit = { budget: 130000, minArea: 59, minHh: 300, basis: 'kb' };
  const result = evaluate(complexes, crit, 2026);
  const diff = diffSnapshots(null, makeSnapshot('2026-09-14', '2026.09.11', crit, ['강동구', '송파구'], complexes, result));
  const html = renderReportHtml({
    cfg: { gus: ['강동구', '송파구'] }, criteria: crit, today: '2026-09-14', asOf: '2026.09.11', result, diff,
    macro: { housing: { error: 'x' }, mortgage: { data: { band: { min: 3.9, max: 5.1 }, month: '202608' } }, base: { error: 'x' } },
    news: { byGu: { '강동구': [{ tag: '정비사업', title: '고덕 <재건축> 승인', src: 'A', link: 'https://e.x/1', date: new Date('2026-09-10T03:00:00Z') }] }, policy: [], errors: [] },
    ask: { rows: [], count: 0, medGap: null, excluded: 0 },
  });
  assert.ok(!/<script/i.test(html), '메일 앱이 막는 스크립트를 쓰지 않음');
  assert.ok(html.includes('<!--MAIL_TOP-->') && html.includes('<!--MAIL_BOTTOM-->'));
  const body = html.slice(html.indexOf('JINGA WEEKLY'));   // 메일 목록 미리보기 문구(숨김) 뒤 본문
  assert.ok(body.indexOf('조건 충족 단지') < body.indexOf('신축대단지'), '지표 카드 → BEST 5 순서');
  assert.ok(body.indexOf('신축대단지') < body.indexOf('class="jg-tabs"'), 'BEST 1위는 세부 탭보다 위');
  for (const [, label] of TABS) assert.ok(html.includes(`>${label}</label>`), `탭 ${label}`);
  assert.match(html, /class="jg-bar" style="display:none/, '탭 막대는 기본 숨김 — 탭 CSS를 지우는 메일 앱에선 섹션이 차례로 펼쳐짐');
  assert.equal((html.match(/class="jg-panel jg-p\d" style="display:block"/g) || []).length, TABS.length, '패널은 기본 표시');
  assert.ok(html.includes('고덕 &lt;재건축&gt; 승인'), '뉴스 제목 이스케이프');
});

test('용적률 조건: 범위 밖·용적률을 모르는 단지는 조건을 줄 때만 제외, 조건 문구·엑셀에 반영', () => {
  const withFar = complexes.map(c => ({ ...c, far: c.id === 1 ? 280 : c.id === 3 ? 170 : null, bcr: c.id === 1 ? 18 : null }));
  const base = { budget: 130000, minArea: 59, minHh: 300 };
  assert.deepEqual(evaluate(withFar, base, 2026).best5.map(e => e.c.name), ['신축대단지', '구축중형'], '조건이 없으면 그대로');
  assert.deepEqual(evaluate(withFar, { ...base, farMax: 200 }, 2026).best5.map(e => e.c.name), ['구축중형']);
  assert.deepEqual(evaluate(withFar, { ...base, farMin: 250 }, 2026).best5.map(e => e.c.name), ['신축대단지']);
  assert.equal(complexOk({ far: null }, { farMax: 200 }), false, '용적률을 모르면 조건이 있을 때 제외');
  assert.equal(complexOk({ far: null }, {}), true);
  assert.match(criteriaText({ ...base, farMax: 200 }, ['강동구']), /용적률 200% 이하 · 아파트만/);
  assert.ok(listingCandidates(withFar, { ...base, farMax: 200 }).every(x => x.c.id === 3), '호가 조회도 조건 안 단지만');
  const sheets = buildSearchSheets({ criteria: { ...base, farMin: 250 }, gus: ['강동구'], asOf: '', complexes: withFar, result: evaluate(withFar, { ...base, farMin: 250 }, 2026) });
  const head = sheets[0].rows[2].map(h => h.v);
  assert.ok(head.includes('용적률(%)') && head.includes('건폐율(%)'));
  assert.equal(sheets[0].rows[3][head.indexOf('용적률(%)')].v, 280);
});

test('뉴스 RSS 파싱: 제목·언론사·날짜', () => {
  const xml = `<rss><channel><item><title>고덕주공9단지 재건축 추진위 승인 - 한국주택경제</title><link>https://news.google.com/a</link><pubDate>Thu, 10 Sep 2026 03:00:00 GMT</pubDate><source url="x">한국주택경제</source></item></channel></rss>`;
  const [it] = parseNewsRss(xml);
  assert.equal(it.title, '고덕주공9단지 재건축 추진위 승인');
  assert.equal(it.src, '한국주택경제');
  assert.equal(it.date.toISOString().slice(0, 10), '2026-09-10');
});

test('보고서: 임대세대 조건이 실제로 빠지고, 조건 칩에도 드러남', async () => {
  const { renderReportHtml } = await import('./report-html.mjs');
  // toKbCriteria 가 구독 조건 → KB 조건으로 그대로 넘기는지
  const k = toKbCriteria({ gus: ['강동구'], budgetEok: 13, minArea: 59, maxArea: 0, minHouseholds: 300, priceBasis: 'ask', maxRentPct: 30 });
  assert.equal(k.maxRentPct, 30);
  assert.equal(toKbCriteria({ gus: ['강동구'], budgetEok: 13, minHouseholds: 0 }).maxRentPct, 0, '없으면 제한 없음');

  // 임대 비중이 큰 단지가 보고서 대상에서 빠지는지
  const withRent = complexes.map(c => (c === complexes[0] ? { ...c, households: 943, rentUnits: 532 } : { ...c, households: 900, rentUnits: 0 }));
  const crit = { budget: 130000, minArea: 0, minHh: 0, basis: 'kb' };
  const all = evaluate(withRent, crit, 2026);
  const cut = evaluate(withRent, { ...crit, maxRentPct: 30 }, 2026);
  assert.ok(all.complexCount > cut.complexCount, '조건을 주면 줄어듦');
  assert.equal(cut.rentExcluded.length, 1);
  assert.equal(cut.rentExcluded[0].pct, 56.4);

  const html = renderReportHtml({
    cfg: { gus: ['강동구'] }, criteria: { ...crit, maxRentPct: 30 }, today: '2026-09-21', asOf: '2026.09.18',
    result: cut, diff: diffSnapshots(null, makeSnapshot('2026-09-21', '2026.09.18', crit, ['강동구'], withRent, cut)),
    macro: { housing: { error: 'x' }, mortgage: { error: 'x' }, base: { error: 'x' } },
    news: { byGu: {}, policy: [], errors: [] }, ask: { rows: [], count: 0, medGap: null, excluded: 0 },
  });
  assert.match(html, /임대세대 30% 이하/, '보고서 맨 위 조건 칩에 표시');
  assert.doesNotMatch(
    renderReportHtml({
      cfg: { gus: ['강동구'] }, criteria: crit, today: '2026-09-21', asOf: '2026.09.18',
      result: all, diff: diffSnapshots(null, makeSnapshot('2026-09-21', '2026.09.18', crit, ['강동구'], withRent, all)),
      macro: { housing: { error: 'x' }, mortgage: { error: 'x' }, base: { error: 'x' } },
      news: { byGu: {}, policy: [], errors: [] }, ask: { rows: [], count: 0, medGap: null, excluded: 0 },
    }), /임대세대/, '조건이 없으면 칩도 없음');
});
