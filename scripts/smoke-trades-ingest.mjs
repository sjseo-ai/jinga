// 실거래 정규화(scripts/_trades.mjs) 스모크 테스트 — 네트워크 없이 실제 응답 모양 그대로 시험합니다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTrades, toTrade, fields, isCancelled, byComplex, totalCount, errorOf, pyeong } from './_trades.mjs';

/** 2026-10 강동구 실제 응답에서 옮긴 한 건(값만 바꿔 씀) */
const item = (over = {}) => {
  const f = {
    aptDong: '', aptNm: '늘푸른아파트', aptSeq: '11740-2609', bonbun: '0052', bubun: '0016',
    buildYear: '2006', buyerGbn: '개인', cdealDay: '', cdealType: '', dealAmount: '60,700',
    dealDay: '31', dealMonth: '10', dealYear: '2026', dealingGbn: '중개거래', excluUseAr: '74.41',
    floor: '2', jibun: '52-16', sggCd: '11740', slerGbn: '개인', umdNm: '천호동', ...over,
  };
  return `<item>${Object.entries(f).map(([k, v]) => `<${k}>${v}</${k}>`).join('')}</item>`;
};
const wrap = (...its) => `<response><header><resultCode>000</resultCode><resultMsg>OK</resultMsg></header>`
  + `<body><items>${its.join('')}</items><totalCount>${its.length}</totalCount></body></response>`;

test('한 건을 제대로 읽는다 — 금액 단위는 만원 그대로', () => {
  const { trades, total, cancelled, broken } = parseTrades(wrap(item()), '강동구');
  assert.equal(total, 1); assert.equal(cancelled, 0); assert.equal(broken, 0);
  const t = trades[0];
  assert.equal(t.seq, '11740-2609');
  assert.equal(t.amount, 60700, '쉼표를 떼고 숫자로 — 만원 단위를 원으로 바꾸지 않습니다');
  assert.equal(t.area, 74.41);
  assert.equal(t.date, '2026-10-31');
  assert.equal(t.floor, 2);
  assert.equal(t.year, 2006);
  assert.equal(t.gu, '강동구');
  assert.equal(t.perPyeong, Math.round(60700 / (74.41 / 3.3058)), '평당가 = 금액 ÷ (전용면적÷3.3058)');
});

// 해제 거래를 빼지 않으면 허위 고가 거래가 평균에 그대로 들어갑니다.
// 2026-02 에 신고하고 2026-03 에 해제한 건은 2026-02 응답에 해제 표시가 붙어 다시 나옵니다.
test('해제된 거래는 뺀다 — 두 가지 표시 모두', () => {
  assert.equal(isCancelled({ cdealType: '해제', cdealDay: '' }), true);
  assert.equal(isCancelled({ cdealType: '', cdealDay: '26.03.15' }), true, '해제일만 있어도 해제');
  assert.equal(isCancelled({ cdealType: '', cdealDay: '' }), false);
  assert.equal(isCancelled({ cdealType: '', cdealDay: '   ' }), false, '공백은 빈 값으로');

  const xml = wrap(item(), item({ dealAmount: '999,999', cdealType: '해제' }), item({ dealAmount: '888,888', cdealDay: '26.11.01' }));
  const r = parseTrades(xml, '강동구');
  assert.equal(r.trades.length, 1, '살아 있는 거래만');
  assert.equal(r.cancelled, 2);
  assert.ok(!r.trades.some(t => t.amount > 100000), '허위 고가가 들어오지 않았는지');
});

test('쓸 수 없는 건은 버리되 몇 건인지 센다', () => {
  const r = parseTrades(wrap(item(), item({ dealAmount: '' }), item({ excluUseAr: '0' }), item({ dealYear: '' })), '강동구');
  assert.equal(r.trades.length, 1);
  assert.equal(r.broken, 3, '버린 건수를 셉니다 — 조용히 사라지면 자료가 준 것을 눈치채지 못합니다');
  assert.equal(toTrade(fields(item({ dealAmount: '0' }))), null);
});

test('단지로 묶으면 중앙값과 최근 거래일이 나온다', () => {
  const xml = wrap(
    item({ dealAmount: '60,000', dealDay: '05' }),
    item({ dealAmount: '70,000', dealDay: '20' }),
    item({ dealAmount: '65,000', dealDay: '12' }),
    item({ aptSeq: '11740-9999', aptNm: '다른단지', dealAmount: '90,000' }),
  );
  const list = byComplex(parseTrades(xml, '강동구').trades);
  assert.equal(list.length, 2);
  assert.equal(list[0].seq, '11740-2609');
  assert.equal(list[0].n, 3, '거래가 많은 단지가 앞');
  assert.equal(list[0].last, '2026-10-20', '최근 거래일');
  // 평균이 아니라 중앙값 — 한 건의 특이 거래에 끌려가지 않게
  const mid = Math.round(65000 / (74.41 / 3.3058));
  assert.equal(list[0].medPerPyeong, mid);
});

// 거래가 없는 달과 조회에 실패한 달은 다릅니다. 둘을 같게 다루면 「이 단지는 거래가 없다」는 거짓말이 됩니다.
test('빈 달과 오류를 구분한다', () => {
  const empty = `<response><header><resultCode>000</resultCode></header><body><items></items><totalCount>0</totalCount></body></response>`;
  assert.equal(errorOf(empty), null, '정상 응답인데 0건일 뿐');
  assert.equal(totalCount(empty), 0);
  assert.deepEqual(parseTrades(empty).trades, []);

  const bad = `<OpenAPI_ServiceResponse><cmmMsgHeader><returnAuthMsg>등록되지 않은 서비스키</returnAuthMsg></cmmMsgHeader></OpenAPI_ServiceResponse>`;
  assert.match(errorOf(bad), /등록되지 않은/);
  assert.equal(totalCount(bad), null, '모르는 것은 0 이 아니라 null');
});

test('평 환산', () => {
  assert.equal(Math.round(pyeong(84.9) * 100) / 100, 25.68);
  assert.equal(pyeong(0), null);
  assert.equal(pyeong(null), null);
});

// ── 단지 맞추기(match-trades.mjs) ────────────────────────────────────────────
// 실거래에는 K-apt 단지코드가 없어 이름+법정동으로 맞춥니다. **틀리게 붙이면 남의 단지 가격이 나갑니다.**
// 그래서 「못 맞춤」은 괜찮지만 「잘못 맞춤」은 안 됩니다 — 애매하면 포기하는 쪽을 지킵니다.
import { normName, looseName, buildIndex, matchOne } from './match-trades.mjs';

test('이름 고르기 — 실제로 어긋났던 것들', () => {
  assert.equal(normName('상계주공7(고층)'), normName('상계주공7단지'));
  assert.equal(normName('에스케이북한산시티'), normName('SK북한산시티아파트'));
  assert.equal(normName('래미안 강동(1단지)'), '래미안강동1');
  assert.notEqual(normName('중계건영2차'), normName('중계건영3차'), '차수가 다르면 다른 단지');
  assert.equal(looseName('중계그린1'), '중계그린');
});

test('애매하면 붙이지 않는다', () => {
  const kapt = {
    '1': { code: 'A1', kaptName: '중계그린', households: 500 },
    '2': { code: 'A2', kaptName: '한신1차', households: 300 },
    '3': { code: 'A3', kaptName: '한신2차', households: 300 },
  };
  const kb = [[1, '중계그린', '노원구', '중계동'], [2, '한신1차', '노원구', '중계동'], [3, '한신2차', '노원구', '중계동']];
  const index = buildIndex(kapt, kb);

  assert.equal(matchOne({ name: '중계그린', dong: '중계동' }, index).hit.code, 'A1', '그대로 맞는 경우');
  assert.equal(matchOne({ name: '중계그린1단지', dong: '중계동' }, index).status, 'loose', '후보가 하나뿐이면 느슨하게 허용');
  // 한신1차·한신2차가 둘 다 있으면 느슨한 열쇠로는 둘 다 걸립니다 → 찍지 않고 포기
  assert.equal(matchOne({ name: '한신', dong: '중계동' }, index).status, 'ambiguous', '후보가 여럿이면 포기');
  assert.equal(matchOne({ name: '없는단지', dong: '중계동' }, index).status, 'miss');
  assert.equal(matchOne({ name: '중계그린', dong: '상계동' }, index).status, 'miss', '법정동이 다르면 다른 단지');
});

// ── 일별 갱신(refresh-trades.mjs) ────────────────────────────────────────────
// 갱신은 **조용히 자료를 망가뜨리기 쉬운** 일입니다. 셋을 못 지키면 눈에 띄지 않게 틀립니다.
//   ① 다시 받은 달을 통째로 갈지 않으면 그동안 해제된 허위 고가가 영원히 남습니다.
//   ② 실패한 조회를 0건으로 치면 멀쩡한 달이 지워집니다.
//   ③ stats 가 trades 와 어긋나면 「몇 건이 왜 없는지」를 더는 알 수 없습니다.
import { monthOf, cellOf, tradeKey, diffTrades, mergeRefresh } from './_trades.mjs';
import { pushHistory, DEFAULT_WINDOW } from './refresh-trades.mjs';

const tr = (over = {}) => ({
  seq: '11740-2609', name: '늘푸른아파트', gu: '강동구', dong: '천호동', jibun: '52-16', sggCd: '11740',
  date: '2026-10-31', amount: 60700, area: 74.41, perPyeong: 2697, floor: 2, year: 2006, kind: '중개거래', ...over,
});
const okStat = (gu, ym, kept, over = {}) => ({ gu, ym, ok: true, total: kept, kept, cancelled: 0, broken: 0, ...over });
const errStat = (gu, ym, error) => ({ gu, ym, ok: false, error });

test('달 열쇠', () => {
  assert.equal(monthOf(tr()), '202610');
  assert.equal(monthOf({ date: '2026-01-05' }), '202601');
  assert.equal(monthOf({}), '');
  assert.equal(cellOf('강동구', '202610'), '강동구||202610');
  assert.equal(tradeKey(tr()), '11740-2609|2026-10-31|60700|74.41|2');
});

// 가장 중요한 한 가지 — 해제된 건이 사라지지 않으면 허위 고가가 평균에 남습니다.
test('다시 받은 달은 통째로 교체 — 그동안 해제된 건이 사라진다', () => {
  const fake = tr({ amount: 999999, date: '2026-10-15', perPyeong: 44420 });
  const real = tr();
  const before = { trades: [fake, real], stats: [okStat('강동구', '202610', 2)] };
  // 다시 받으니 해제된 fake 는 응답에서 빠져 있습니다(parseTrades 가 걸러 냄)
  const after = mergeRefresh({ ...before, results: [{ gu: '강동구', ym: '202610', trades: [real], stat: okStat('강동구', '202610', 1) }] });

  assert.equal(after.trades.length, 1, '교체했으니 한 건');
  assert.ok(!after.trades.some(t => t.amount > 100000), '허위 고가가 남지 않았는지');
  assert.equal(after.summary.removed, 1);
  assert.equal(after.summary.added, 0);
  assert.equal(after.summary.same, 1);
  assert.equal(after.counts.trades, 1, 'counts 도 같이 고쳐집니다');
});

// 실패를 0건으로 치면 API 가 한 번 흔들릴 때마다 한 달이 지워집니다.
test('조회가 실패한 달은 손대지 않는다 — 이전 자료 그대로', () => {
  const keep = [tr({ date: '2026-10-05' }), tr({ date: '2026-10-20', amount: 61000 })];
  const before = { trades: keep, stats: [okStat('강동구', '202610', 2)] };
  const after = mergeRefresh({ ...before, results: [{ gu: '강동구', ym: '202610', trades: [], stat: errStat('강동구', '202610', '서비스 일시 중단') }] });

  assert.equal(after.trades.length, 2, '실패했으니 지우지 않습니다');
  assert.equal(after.summary.cells, 0, '갈아 끼운 칸이 없습니다');
  assert.equal(after.summary.removed, 0);
  assert.equal(after.summary.failures.length, 1);
  assert.equal(after.summary.failures[0].error, '서비스 일시 중단');
  assert.equal(after.stats.length, 1);
  assert.equal(after.stats[0].ok, true, 'stats 는 trades 에 실제로 든 것을 설명합니다 — 실패로 덮지 않습니다');
  assert.equal(after.counts.failedQueries, 0);
});

test('갱신 창 밖의 달은 건드리지 않는다', () => {
  const old = tr({ date: '2026-08-11', amount: 58000 });
  const now = tr({ date: '2026-10-31' });
  const before = { trades: [old, now], stats: [okStat('강동구', '202608', 1), okStat('강동구', '202610', 1)] };
  const after = mergeRefresh({ ...before, results: [{ gu: '강동구', ym: '202610', trades: [tr({ date: '2026-10-31', amount: 62000 })], stat: okStat('강동구', '202610', 1) }] });

  assert.equal(after.trades.length, 2);
  assert.ok(after.trades.some(t => t.date === '2026-08-11'), '8월은 그대로');
  assert.ok(after.trades.some(t => t.amount === 62000), '10월은 새 값으로');
  assert.ok(!after.trades.some(t => t.amount === 60700), '10월 옛 값은 없어야');
  assert.deepEqual(after.months, ['202610', '202608'], '최근 달이 앞 — build-trade-prices 가 months[0] 을 기준월로 씁니다');
});

// 0건과 모름은 다릅니다. 정상 응답에 0건이면 그 달은 **정말로** 비어야 합니다.
test('정상인데 0건이면 그 달을 비운다', () => {
  const before = { trades: [tr()], stats: [okStat('강동구', '202610', 1)] };
  const after = mergeRefresh({ ...before, results: [{ gu: '강동구', ym: '202610', trades: [], stat: okStat('강동구', '202610', 0, { total: 0 }) }] });
  assert.equal(after.trades.length, 0);
  assert.equal(after.summary.removed, 1);
  assert.equal(after.stats[0].kept, 0);
});

test('여러 자치구를 한 번에 갱신해도 서로 섞이지 않는다', () => {
  const gangdong = tr({ gu: '강동구' });
  const nowon = tr({ gu: '노원구', seq: '11350-1', dong: '중계동', sggCd: '11350', amount: 55000 });
  const before = { trades: [gangdong, nowon], stats: [okStat('강동구', '202610', 1), okStat('노원구', '202610', 1)] };
  const after = mergeRefresh({
    ...before,
    results: [{ gu: '강동구', ym: '202610', trades: [tr({ gu: '강동구', amount: 63000 })], stat: okStat('강동구', '202610', 1) }],
  });
  assert.equal(after.trades.length, 2);
  assert.ok(after.trades.some(t => t.gu === '노원구' && t.amount === 55000), '노원구는 손대지 않았습니다');
  assert.ok(after.trades.some(t => t.gu === '강동구' && t.amount === 63000));
  assert.deepEqual(after.gus, ['강동구', '노원구']);
});

test('같은 거래가 여러 벌이어도 개수로 센다', () => {
  const a = tr(), b = tr();                       // 열쇠가 같은 두 건
  assert.deepEqual(diffTrades([a, b], [a]), { added: 0, removed: 1, same: 1 });
  assert.deepEqual(diffTrades([a], [a, b]), { added: 1, removed: 0, same: 1 });
  assert.deepEqual(diffTrades([], []), { added: 0, removed: 0, same: 0 });
});

test('갱신 이력은 최근 것만 남긴다', () => {
  let r = { history: [] };
  for (let i = 0; i < 35; i++) r = pushHistory(r, { at: `t${i}`, window: 3, added: i }, 30);
  assert.equal(r.history.length, 30, '파일이 이력으로 부풀지 않게 잘라 냅니다');
  assert.equal(r.history[0].at, 't34', '최근 것이 앞');
  assert.equal(r.lastRunAt, 't34');
  assert.equal(pushHistory(undefined, { at: 'x', window: 3 }).history.length, 1, '이력이 없던 파일도 됩니다');
  assert.equal(DEFAULT_WINDOW, 3, '기본 창 3개월 — 신고 기한 30일을 감싸는 길이');
});
