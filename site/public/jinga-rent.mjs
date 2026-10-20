// 임대세대 비율 — 단지 검색(jinga-kb.mjs)과 매물 추천(jinga-reco.mjs)이 **같은 값을 써야 해서** 따로 뺀 모듈입니다.
//
// 왜 굳이 파일을 나눴나 — 두 곳에 같은 산식을 복사해 두면 한쪽만 고쳐져 같은 단지가
// 검색에서는 빠지고 추천에는 남는 일이 생깁니다. 그렇다고 추천이 단지 검색 모듈을 통째로
// 가져다 쓰면(38KB), 화면은 `jinga-kb.mjs?v=…` 로 불러오는데 모듈 안에서는 `./jinga-kb.mjs` 로
// 불러오게 되어 **브라우저가 서로 다른 모듈로 보고 두 번 내려받습니다.**
// 여기처럼 둘 다 버전 없는 같은 주소를 가리키면 한 번만 받고 한 벌만 씁니다.
//
// 이 값이 왜 필요한가 — 임대 비중이 큰 단지는 실제로 사고팔리는 세대가 적어 거래가 드물고,
// 시세가 주변 분양 단지만큼 움직이지 않는 일이 잦습니다(예: 강동리엔파크14단지 943세대 중 임대 532세대 = 56%).
// 좋고 나쁨을 말하는 값이 아니라 **투자 관점에서 성격이 다른 단지**를 가려내는 값입니다.
// 출처는 KB 단지 상세의 총세대수·임대세대수라 같은 출처끼리만 견줍니다.

/** 임대세대 비율(%) — 알 수 없으면 null */
export function rentPct(c) {
  const total = Number(c && c.households);
  // 값이 없을 때(null·undefined·'')를 Number() 에 그냥 넘기면 0 이 되어 「임대 없음」으로 단정해 버립니다.
  // 모르는 것과 0인 것은 다르므로, 숫자가 실제로 왔을 때만 셈합니다.
  const raw = c ? c.rentUnits : null;
  if (raw === null || raw === undefined || raw === '') return null;
  const rent = Number(raw);
  if (!(total > 0) || !Number.isFinite(rent) || rent < 0) return null;
  return Math.round((rent / total) * 1000) / 10;
}

/** 「임대 56.4%(532/943세대)」 — 카드·엑셀에 붙일 한 줄. 값이 없으면 빈 문자열 */
export function rentText(c) {
  const pct = rentPct(c);
  if (pct == null) return '';
  if (!pct) return '임대 없음';
  return `임대 ${pct}%(${Number(c.rentUnits).toLocaleString('ko-KR')}/${Number(c.households).toLocaleString('ko-KR')}세대)`;
}

/**
 * 임대 비율 조건 — maxRentPct(%)를 넘는 단지를 뺍니다. 0·null 이면 제한 없음.
 * 비율을 알 수 없는 단지는 **빼지 않습니다**(모른다고 버리면 멀쩡한 단지가 사라집니다).
 * 굳이 빼고 싶으면 requireKnown 을 켭니다.
 */
export function rentOk(c, maxRentPct = 0, requireKnown = false) {
  if (!(maxRentPct > 0)) return true;
  const pct = rentPct(c);
  if (pct == null) return !requireKnown;
  return pct <= maxRentPct;
}
