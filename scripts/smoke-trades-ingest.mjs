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
