// 공동주택관리정보시스템(K-apt) — 국토교통부 공개 API 로 받는 **공식 단지 정보**.
//   · 단지 목록   AptListService4/getSidoAptList4      시도 단위로 kaptCode·단지명·법정동
//   · 기본 정보   AptBasisInfoServiceV5/getAphusBassInfoV5   동수·세대수·난방·복도유형·지하층·승강기·면적대별 세대수
//   · 상세 정보   AptBasisInfoServiceV5/getAphusDtlInfoV5    지상/지하 주차대수·CCTV·구조·지하철역·도보시간
//
// 왜 필요한가 — 「지하주차장이 있는지(몇 대 규모인지)」, 「동수·승강기」, 「어떤 면적이 몇 세대인지」는
// KB 에 없고 가 보지 않으면 알 수 없던 값입니다. 여기서는 **공식 자료로** 받습니다.
// 다만 **「몇 베이」와 「지하주차장에서 엘리베이터로 바로 가는지」는 이 API 에도 없습니다** —
// 그 둘은 끝까지 가 보신 분이 알려 주셔야 합니다(사진·현장 정보 탭).
//
// 덮이는 범위 — K-apt 는 **의무관리대상 공동주택만** 등록합니다(대체로 300세대 이상 등).
// 실측(2026-10-12 강동구): K-apt 151곳 / 우리 401곳. 그래서 작은 단지는 짝이 아예 없습니다.
//   300세대 이상으로 좁히면 66곳 중 59곳(89%)이 맞습니다 — 검색 기본값이 300세대 이상이라 쓸 만합니다.
//
// 짝 맞추기가 어려운 이유 — 같은 단지를 KB 는 「삼익그린맨션(2차)」, K-apt 는 「명일삼익그린2차」로 적습니다.
// 예전에 조합 단지를 맞출 때 느슨한 비슷함 점수로 하다가 오히려 나빠진 적이 있어(23%→21%→15%),
// 여기서는 **글자 포함관계 + 애매하면 포기**로 갑니다. 틀린 짝은 없는 것보다 나쁩니다.

export const SIDO = { seoul: { code: '11', label: '서울' }, gyeonggi: { code: '41', label: '경기' } };
export const HOUSEHOLD_TOLERANCE = 0.2;   // 세대수가 이만큼 넘게 다르면 잘못 맞춘 것으로 보고 버립니다
export const MIN_NAME_LEN = 3;            // 이보다 짧은 이름으로는 포함관계를 따지지 않습니다(「삼익」이 다 걸립니다)

// 값이 없을 때(null·undefined·'')를 Number() 에 그냥 넘기면 **0** 이 되어
// 「모름」이 「0대」로 둔갑합니다 — 지하주차장을 모르는 단지가 「지하주차장 없음」이 되어 버립니다.
// 숫자가 실제로 왔을 때만 숫자로 봅니다.
const num = v => {
  if (v === null || v === undefined) return null;
  const t = String(v).replace(/[,\s]/g, '');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};
const text = v => { const s = String(v ?? '').replace(/\s+/g, ' ').trim(); return s && s !== '-' ? s : ''; };

/** 이름 다듬기 — 띄어쓰기·괄호·「아파트」 꼬리·「제2차」의 제 를 떼어 견줍니다 */
export function normName(s) {
  return String(s || '')
    .replace(/\s+/g, '')
    .replace(/[()（）\[\]·,.\-_'"’”]/g, '')
    .replace(/아파트$/, '')
    .replace(/제(\d)/g, '$1')
    .toLowerCase();
}

/** 「명일동」 → 「명일」. K-apt 가 이름 앞에 붙이는 동 이름을 떼어 내려고 씁니다 */
export const dongStem = d => String(d || '').replace(/\s+/g, '').replace(/[동가리]$/, '');

/**
 * K-apt 이름에서 앞에 붙은 동 이름을 뗍니다 — 「명일삼익그린2차」 → 「삼익그린2차」.
 * 떼고 나서 너무 짧아지면(그 이름이 곧 동 이름이면) 떼지 않습니다.
 */
export function stripDong(name, dong) {
  const n = normName(name), stem = normName(dongStem(dong));
  if (!stem || !n.startsWith(stem)) return n;
  const cut = n.slice(stem.length);
  return cut.length >= MIN_NAME_LEN ? cut : n;
}

/** 두 이름이 같은 단지를 가리키는가 — 같거나, 한쪽이 다른 쪽을 통째로 품고 있으면 */
export function sameName(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  return s.length >= MIN_NAME_LEN && l.includes(s);
}

/**
 * 우리 단지 한 곳 → K-apt 단지 찾기.
 * 같은 법정동에서 먼저 찾고, 없으면 같은 구 전체에서 찾습니다.
 * **후보가 둘 이상이면 아무것도 고르지 않습니다** — 틀린 짝은 없느니만 못합니다.
 */
export function matchComplex(c, kaptRows) {
  const mine = normName(c.name);
  const myDong = normName(c.dong);
  const pools = [
    kaptRows.filter(r => normName(r.as3) === myDong),
    kaptRows,
  ];
  for (const pool of pools) {
    if (!pool.length) continue;
    for (const variant of [r => normName(r.kaptName), r => stripDong(r.kaptName, r.as3)]) {
      const hits = pool.filter(r => sameName(mine, variant(r)));
      if (hits.length === 1) return hits[0];
      if (hits.length > 1) {
        // 여럿이면 글자가 가장 비슷한 하나만 — 길이 차이가 뚜렷하면 애매한 것으로 보고 포기
        const sorted = hits.slice().sort((x, y) => Math.abs(variant(x).length - mine.length) - Math.abs(variant(y).length - mine.length));
        const d0 = Math.abs(variant(sorted[0]).length - mine.length);
        const d1 = Math.abs(variant(sorted[1]).length - mine.length);
        if (d0 < d1) return sorted[0];
        return null;
      }
    }
  }
  return null;
}

/**
 * 맞춘 짝이 진짜인지 세대수로 되짚기 — 이름이 비슷해도 다른 단지면 세대수가 크게 다릅니다.
 * 우리 세대수(KB 총세대수)와 K-apt 세대수가 20% 넘게 벌어지면 버립니다.
 */
export function householdsAgree(mine, theirs, tolerance = HOUSEHOLD_TOLERANCE) {
  const a = num(mine), b = num(theirs);
  if (!(a > 0) || !(b > 0)) return true;      // 한쪽을 모르면 되짚을 수 없으니 통과
  return Math.abs(a - b) / Math.max(a, b) <= tolerance;
}

/** 기본 정보 응답 → 우리가 쓸 항목만 */
export function parseBasis(d) {
  if (!d || !d.kaptCode) return null;
  return {
    code: text(d.kaptCode),
    dongs: num(d.kaptDongCnt),                 // 동수
    households: num(d.kaptdaCnt),              // 세대수
    heat: text(d.codeHeatNm),                  // 난방방식
    hall: text(d.codeHallNm),                  // 복도유형(계단식·복도식·혼합식)
    sale: text(d.codeSaleNm),                  // 분양형태(분양·임대·혼합)
    aptType: text(d.codeAptNm),                // 아파트·주상복합
    manage: text(d.codeMgrNm),                 // 관리방식
    usedAt: text(d.kaptUsedate),               // 사용승인일(YYYYMMDD)
    topFloor: num(d.kaptTopFloor),
    baseFloor: num(d.kaptBaseFloor),           // 지하층수
    lifts: num(d.kaptdEcntp),                  // 승용 승강기 대수
    totalArea: num(d.kaptTarea),
    // 면적대별 세대수 — 「어떤 평형이 몇 세대인지」
    area60: num(d.kaptMparea60), area85: num(d.kaptMparea85),
    area135: num(d.kaptMparea135), area136: num(d.kaptMparea136),
  };
}

/** 상세 정보 응답 → 우리가 쓸 항목만 */
export function parseDetail(d) {
  if (!d || !d.kaptCode) return null;
  return {
    parkGround: num(d.kaptdPcnt),              // 지상 주차대수
    parkUnder: num(d.kaptdPcntu),              // 지하 주차대수 — 지하주차장 규모
    lifts: num(d.kaptdEcnt),
    cctv: num(d.kaptdCccnt),
    struct: text(d.codeStr),
    subwayLine: text(d.subwayLine),
    subwayStation: text(d.subwayStation),
    subwayWalk: text(d.kaptdWtimesub),         // 지하철역까지 도보
    busWalk: text(d.kaptdWtimebus),
    welfare: text(d.welfareFacility).slice(0, 200),
    education: text(d.educationFacility).slice(0, 200),
    evGround: num(d.groundElChargerCnt),
    evUnder: num(d.undergroundElChargerCnt),
  };
}

/** 「지하주차 1,427대 · 지상 20대」 — 없으면 「지하주차장 없음」 */
export function parkingText(k) {
  if (!k) return '';
  const u = num(k.parkUnder), g = num(k.parkGround);
  if (u == null && g == null) return '';
  if (!u) return g ? `지하주차장 없음 · 지상 ${g.toLocaleString('ko-KR')}대` : '지하주차장 없음';
  return `지하주차 ${u.toLocaleString('ko-KR')}대${g ? ` · 지상 ${g.toLocaleString('ko-KR')}대` : ''}`;
}

/** 세대당 주차 대수 — 1대가 안 되면 저녁에 자리가 없다는 뜻이라 따로 셈합니다 */
export function parkingPerHouse(k, households) {
  const total = (num(k && k.parkUnder) || 0) + (num(k && k.parkGround) || 0);
  const hh = num(households);
  if (!(total > 0) || !(hh > 0)) return null;
  return Math.round((total / hh) * 100) / 100;
}

/** 「전용 60㎡ 이하 48세대 · 85㎡ 이하 137세대」 */
export function areaMixText(k) {
  if (!k) return '';
  const parts = [
    [k.area60, '60㎡ 이하'], [k.area85, '60~85㎡'],
    [k.area135, '85~135㎡'], [k.area136, '135㎡ 초과'],
  ].filter(([n]) => num(n) > 0).map(([n, label]) => `${label} ${Number(n).toLocaleString('ko-KR')}세대`);
  return parts.join(' · ');
}

/** 화면으로 내보낼 한 묶음 */
export const publicKapt = k => (k ? {
  code: k.code, dongs: k.dongs, households: k.households, heat: k.heat, hall: k.hall,
  sale: k.sale, aptType: k.aptType, usedAt: k.usedAt, topFloor: k.topFloor, baseFloor: k.baseFloor,
  lifts: k.lifts, parkGround: k.parkGround, parkUnder: k.parkUnder, cctv: k.cctv, struct: k.struct,
  subwayLine: k.subwayLine, subwayStation: k.subwayStation, subwayWalk: k.subwayWalk, busWalk: k.busWalk,
  welfare: k.welfare, education: k.education, evUnder: k.evUnder, evGround: k.evGround,
  area60: k.area60, area85: k.area85, area135: k.area135, area136: k.area136,
} : null);
