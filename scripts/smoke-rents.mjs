// 전월세·전세가율 스모크 테스트 — 네트워크 없이, 실제 응답 모양 그대로.
//
// 전세가율은 **틀려도 그럴싸해 보이는** 숫자입니다. 그래서 「틀리면 조용히 거짓말이 되는 지점」만
// 골라 걸었습니다 — 전세와 월세를 섞는 것, 갱신을 시세로 쓰는 것, 단위가 어긋난 것,
// 모르는 것을 0으로 적는 것, 표본 한 건으로 시세를 말하는 것.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  toRent, parseRents, isJeonse, isWolse, isMarketJeonse, rentKey, areaKey,
  jeonseByArea, jeonseRatio, cutYM, RATIO_MIN, RATIO_MAX,
} from './_rents.mjs';
import { mergeRefresh } from './_trades.mjs';
import { build, MIN_N } from './build-rent-prices.mjs';
import { countsOf } from './build-rents.mjs';

/** 2026-10 강동구 실제 응답에서 옮긴 한 건 */
const item = (over = {}) => {
  const f = {
    aptNm: '선사현대아파트', aptSeq: '11740-91', buildYear: '2000', contractTerm: '26.12~28.12',
    contractType: '갱신', dealDay: '24', dealMonth: '10', dealYear: '2026', deposit: '25,000',
    excluUseAr: '58.46', floor: '24', jibun: '509', monthlyRent: '160',
    preDeposit: '22,000', preMonthlyRent: '150', sggCd: '11740', umdNm: '암사동', useRRRight: '사용', ...over,
  };
  return `<item>${Object.entries(f).map(([k, v]) => `<${k}>${v}</${k}>`).join('')}</item>`;
};
const wrap = (...its) => `<response><header><resultCode>000</resultCode><resultMsg>OK</resultMsg></header>`
  + `<body><items>${its.join('')}</items><totalCount>${its.length}</totalCount></body></response>`;

/** 전세 한 건 (월세 0) */
const 전세 = (over = {}) => item({ monthlyRent: '0', contractType: '신규', preDeposit: '', preMonthlyRent: '', useRRRight: '', ...over });

test('한 건을 제대로 읽는다 — 금액 단위는 만원 그대로', () => {
  const { rents, total, broken } = parseRents(wrap(item()), '강동구');
  assert.equal(total, 1); assert.equal(broken, 0);
  const r = rents[0];
  assert.equal(r.seq, '11740-91');
  assert.equal(r.deposit, 25000, '쉼표를 떼고 숫자로 — 만원을 원으로 바꾸지 않습니다');
  assert.equal(r.monthly, 160);
  assert.equal(r.area, 58.46, '면적은 소수로 보존');
  assert.equal(r.date, '2026-10-24');
  assert.equal(r.floor, 24);
  assert.equal(r.gu, '강동구');
  assert.equal(r.type, '갱신');
  assert.equal(r.renewRight, true);
  assert.equal(r.preDeposit, 22000, '갱신 건에는 종전 보증금이 있습니다');
});

// 가장 위험한 섞임 — 월세의 보증금(2.5억)을 전세 보증금과 같이 평균하면 전세 시세가 반 토막이 됩니다.
test('전세와 월세를 가른다 — 월세 0 이 전세', () => {
  assert.equal(isJeonse({ monthly: 0 }), true);
  assert.equal(isJeonse({ monthly: 160 }), false);
  assert.equal(isJeonse({ monthly: null }), false, '월세를 모르면 전세라고 단정하지 않습니다');
  assert.equal(isWolse({ monthly: 160 }), true);
  assert.equal(isWolse({ monthly: 0 }), false);
  // 반전세(보증금 크고 월세 조금)도 월세입니다 — 전세 시세에 넣으면 안 됩니다
  assert.equal(isJeonse({ monthly: 30 }), false, '반전세는 월세로 봅니다');
});

// 갱신은 전월세상한제(5%)에 묶여 시세가 아닙니다. 2026-11-26 서울 12개월에서
// 전세 112,077건 중 갱신이 56,488건 — 절반이 넘습니다. 섞으면 전세가율이 그만큼 낮아집니다.
test('시세로 쓰는 것은 신규 전세만', () => {
  assert.equal(isMarketJeonse({ monthly: 0, type: '신규' }), true);
  assert.equal(isMarketJeonse({ monthly: 0, type: '갱신' }), false, '갱신은 시세가 아닙니다');
  assert.equal(isMarketJeonse({ monthly: 0, type: null }), false, '계약구분을 모르면 쓰지 않습니다');
  assert.equal(isMarketJeonse({ monthly: 160, type: '신규' }), false, '월세는 전세 시세가 아닙니다');
});

test('쓸 수 없는 건은 버리되 몇 건인지 센다', () => {
  const r = parseRents(wrap(
    item(),
    item({ deposit: '0' }),            // 보증금 없음
    item({ monthlyRent: '' }),         // 월세를 몰라 전세·월세를 가를 수 없음
    item({ excluUseAr: '0' }),
    item({ dealYear: '' }),
  ), '강동구');
  assert.equal(r.rents.length, 1);
  assert.equal(r.broken, 4, '버린 건수를 셉니다 — 조용히 사라지면 자료가 준 것을 눈치채지 못합니다');
  assert.equal(toRent({ deposit: '10,000', monthlyRent: '', excluUseAr: '58', dealYear: '2026', dealMonth: '10', dealDay: '1' }), null,
    '월세가 빈 값이면 버립니다 — 0 으로 치면 월세 계약이 전세가 됩니다');
});

// 전월세는 59.785 처럼 소수로 옵니다. 매매 집계는 반올림한 정수로 묶으므로 같은 기준이어야 짝이 맞습니다.
test('면적은 반올림해 짝을 맞춘다', () => {
  assert.equal(areaKey(59.785), 60);
  assert.equal(areaKey(84.81), 85);
  assert.equal(areaKey(58.46), 58);
  assert.equal(areaKey(0), null);
  assert.equal(areaKey(null), null);
});

test('단지·면적대별 전세 시세 — 안 쓴 건수도 함께 센다', () => {
  const xml = wrap(
    전세({ deposit: '60,000', dealDay: '05' }),
    전세({ deposit: '70,000', dealDay: '20' }),
    전세({ deposit: '65,000', dealDay: '12' }),
    전세({ deposit: '99,000', contractType: '갱신' }),       // 갱신 — 시세에 안 씀
    item({ deposit: '25,000', monthlyRent: '160' }),          // 월세 — 시세에 안 씀
    전세({ excluUseAr: '84.2', deposit: '90,000' }),          // 다른 면적대
  );
  const { rents } = parseRents(xml, '강동구');
  const cells = jeonseByArea(rents);
  const c58 = cells.find(c => c.area === 58);
  assert.equal(c58.n, 3, '신규 전세 3건만 썼습니다');
  assert.equal(c58.med, 65000, '평균이 아니라 중앙값 — 한 건의 특이 계약에 끌려가지 않게');
  assert.equal(c58.renew, 1, '쓰지 않은 갱신 건수를 숨기지 않습니다');
  assert.equal(c58.wolse, 1, '쓰지 않은 월세 건수도');
  assert.ok(c58.med < 99000, '갱신 99,000 이 중앙값을 밀어 올리지 않았는지');
  const c84 = cells.find(c => c.area === 84);
  assert.equal(c84.n, 1);
  assert.equal(c84.med, 90000);
});

// 전세가율 = 보증금 ÷ 매매가. 둘 다 만원이어야 합니다. 한쪽을 원으로 넣으면 100배가 어긋납니다.
test('전세가율 — 단위가 어긋난 값은 버리고 왜 버렸는지 말한다', () => {
  assert.equal(jeonseRatio(65000, 116190).ratio, 0.559);
  assert.equal(jeonseRatio(65000, 116190).why, null);

  // 분모를 원으로 넣은 경우 — 터무니없이 낮게 나오므로 버립니다
  const unit = jeonseRatio(65000, 1161900000);
  assert.equal(unit.ratio, null, '0.006% 같은 값을 그대로 쓰면 「전세가 공짜」가 됩니다');
  assert.ok(unit.why.includes('너무 낮아'));

  // 보증금이 매매가를 넘는 경우
  const over = jeonseRatio(200000, 116190);
  assert.equal(over.ratio, null);
  assert.ok(over.why.includes('넘습니다'));

  assert.ok(jeonseRatio(RATIO_MIN * 100000 + 1, 100000).ratio > 0, '경계 바로 안쪽은 받습니다');
  assert.equal(jeonseRatio(RATIO_MAX * 100000 + 1, 100000).ratio, null, '경계 바로 바깥은 버립니다');
});

// 모르는 것을 0% 로 적으면 「전세가 아주 싸다」는 거짓말이 됩니다.
test('전세가율을 모르면 null — 0 이 아니다', () => {
  assert.equal(jeonseRatio(null, 116190).ratio, null);
  assert.equal(jeonseRatio(65000, null).ratio, null);
  assert.equal(jeonseRatio(0, 116190).ratio, null);
  assert.equal(jeonseRatio(65000, 0).ratio, null);
  for (const v of [null, 0, undefined]) {
    assert.notEqual(jeonseRatio(v, 116190).ratio, 0, 'null 을 0 으로 떨어뜨리면 안 됩니다');
  }
});

test('기간 자르기', () => {
  assert.equal(cutYM('202611', 3), '202609');
  assert.equal(cutYM('202601', 3), '202511', '해를 넘어가도 맞아야 합니다');
  assert.equal(cutYM('202611', 1), '202611');
});

// ── 집계 파일(build-rent-prices.mjs) ────────────────────────────────────────

const saleFile = (over = {}) => ({
  asOfYM: '202611', source: '매매 원천', generatedAt: 'x',
  byComplex: { '62': { seq: 'S1', kaptCode: 'A1', areas: [{ area: 58, amount: 116190, grade: 'B' }] } },
  ...over,
});
const rentRows = (n, over = {}) => Array.from({ length: n }, (_, i) => ({
  seq: 'S1', gu: '강동구', dong: '암사동', date: `2026-10-${String(i + 1).padStart(2, '0')}`,
  deposit: 65000, monthly: 0, area: 58.46, floor: 3, type: '신규', ...over,
}));

test('표본이 적으면 대표값을 내지 않는다', () => {
  const thin = build({ rents: rentRows(MIN_N - 1), sale: saleFile() });
  assert.equal(thin.counts.withRatio, 0, `신규 전세 ${MIN_N}건 미만이면 비웁니다`);
  assert.equal(thin.counts.thinSample, 1);
  assert.equal(Object.keys(thin.byComplex).length, 0, '한 건으로 「이 단지 전세 시세」를 말할 수 없습니다');

  const ok = build({ rents: rentRows(MIN_N), sale: saleFile() });
  assert.equal(ok.counts.withRatio, 1);
  assert.equal(ok.byComplex['62'].areas[0].ratio, 0.559);
  assert.equal(ok.byComplex['62'].areas[0].n, MIN_N);
});

test('갱신·월세만 있는 단지는 전세가율이 안 나온다', () => {
  const renew = build({ rents: rentRows(10, { type: '갱신' }), sale: saleFile() });
  assert.equal(renew.counts.withRatio, 0, '갱신만으로는 시세를 못 냅니다');
  const wolse = build({ rents: rentRows(10, { monthly: 120 }), sale: saleFile() });
  assert.equal(wolse.counts.withRatio, 0, '월세만으로는 전세 시세를 못 냅니다');
});

test('분모가 된 매매 추정가와 그 등급을 함께 남긴다', () => {
  const d = build({ rents: rentRows(5), sale: saleFile() });
  const a = d.byComplex['62'].areas[0];
  assert.equal(a.sale, 116190, '분모를 적어 둬야 나중에 따질 수 있습니다');
  assert.equal(a.saleGrade, 'B', '전세가율의 믿음은 매매 추정 등급에 묶입니다');
  assert.ok(d.model.ratio.includes('추정'), '전세가율이 추정임을 모델 설명에 적습니다');
});

test('매매 자료에 없는 단지는 넣지 않는다', () => {
  const d = build({ rents: rentRows(5, { seq: '없는단지' }), sale: saleFile() });
  assert.equal(Object.keys(d.byComplex).length, 0);
  assert.equal(d.counts.noRentData, 1, '그 면적에 전월세가 없던 칸으로 셉니다');
});

test('자치구 전세가율은 칸들의 중앙값', () => {
  const sale = saleFile({
    byComplex: {
      '1': { seq: 'S1', kaptCode: 'A1', areas: [{ area: 58, amount: 100000, grade: 'B' }] },
      '2': { seq: 'S2', kaptCode: 'A2', areas: [{ area: 58, amount: 200000, grade: 'B' }] },
    },
  });
  const rents = [...rentRows(5), ...rentRows(5, { seq: 'S2' })];
  const d = build({ rents, sale });
  assert.equal(d.byComplex['1'].areas[0].ratio, 0.65);
  assert.equal(d.byComplex['2'].areas[0].ratio, 0.325);
  assert.equal(d.region['강동구'].cells, 2);
  assert.equal(d.region['강동구'].ratio, 0.65, '두 칸이면 위쪽 — 중앙값 규칙 그대로');
});

test('셈은 전세·월세·신규를 따로 센다', () => {
  const rents = [...rentRows(3), ...rentRows(2, { type: '갱신' }), ...rentRows(4, { monthly: 100 })];
  const c = countsOf(rents, [{ gu: '강동구', ym: '202610', ok: true }]);
  assert.equal(c.rents, 9);
  assert.equal(c.jeonse, 5);
  assert.equal(c.wolse, 4);
  assert.equal(c.marketJeonse, 3, '시세에 쓰는 것은 신규 전세뿐');
  assert.equal(c.renewJeonse, 2);
  assert.equal(c.complexes, 1);
  assert.equal(c.failedQueries, 0);
});

// 매매와 같은 합치기 규칙을 쓰지만, 열쇠는 보증금·월세를 **둘 다** 봐야 합니다.
test('합치기 열쇠는 보증금과 월세를 둘 다 본다', () => {
  const a = { seq: 'S1', date: '2026-10-01', deposit: 65000, monthly: 0, area: 58.46, floor: 3 };
  const b = { ...a, monthly: 100 };
  assert.notEqual(rentKey(a), rentKey(b), '보증금이 같고 월세만 달라도 다른 계약입니다');

  const before = { trades: [{ ...a, gu: '강동구' }], stats: [{ gu: '강동구', ym: '202610', ok: true }] };
  const after = mergeRefresh({
    ...before, keyOf: rentKey,
    results: [{ gu: '강동구', ym: '202610', trades: [{ ...b, gu: '강동구' }], stat: { gu: '강동구', ym: '202610', ok: true, kept: 1 } }],
  });
  assert.equal(after.trades.length, 1, '달을 통째로 갈아 끼웁니다');
  assert.equal(after.summary.added, 1);
  assert.equal(after.summary.removed, 1);
  assert.equal(after.trades[0].monthly, 100);
});

test('전월세 갱신도 실패한 달은 손대지 않는다', () => {
  const keep = [{ seq: 'S1', gu: '강동구', date: '2026-10-01', deposit: 65000, monthly: 0, area: 58.46, floor: 3 }];
  const after = mergeRefresh({
    trades: keep, stats: [{ gu: '강동구', ym: '202610', ok: true }], keyOf: rentKey,
    results: [{ gu: '강동구', ym: '202610', trades: [], stat: { gu: '강동구', ym: '202610', ok: false, error: '서비스 일시 중단' } }],
  });
  assert.equal(after.trades.length, 1);
  assert.equal(after.summary.failures.length, 1);
});
