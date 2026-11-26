// 국토교통부 아파트 **전월세** 실거래 — 받아 온 XML 을 쓸 수 있는 모양으로 (㉮ T010 / 전세가율).
// 네트워크도 파일도 건드리지 않는 **순수 함수들**입니다. 받아 오는 일은 build-rents.mjs 가 합니다.
//
// 쓰는 API: 국토교통부_아파트 전월세 실거래가 자료(15126474, RTMSDataSvcAptRent) — 이용허락범위 제한 없음
//   매매(15126468)와 같은 `aptSeq` 를 주므로 **단지가 그대로 맞물립니다.**
//
// ── 실제 응답 한 건 (2026-10 강동구, 2026-11-26 확인) ────────────────────────
//   aptSeq 11740-91 · aptNm 선사현대아파트 · umdNm 암사동 · jibun 509 · buildYear 2000
//   deposit "25,000"(만원) · monthlyRent "160"(만원) · excluUseAr 58 · floor 24
//   dealYear/Month/Day 2026/10/24 · contractType 갱신 · contractTerm "26.12~28.12"
//   preDeposit·preMonthlyRent — **갱신 건에만** 들어 있습니다(종전 조건)
//   useRRRight "사용" — 계약갱신요구권을 쓴 건
//
// ── 반드시 지킬 것 셋 ───────────────────────────────────────────────────────
// ① **전세와 월세를 섞지 않습니다.** monthlyRent 가 0 이면 전세, 0보다 크면 월세입니다.
//    월세의 보증금(25,000)을 전세 보증금과 같이 평균하면 전세 시세가 반 토막으로 나옵니다.
// ② **갱신 계약을 시세로 쓰지 않습니다.** 갱신은 전월세상한제(5%)에 묶여 시세보다 낮습니다.
//    2026-11-26 표본 3,290건에서 전세 보증금 중앙값이 신규 65,000 · 갱신 57,000 — **12% 차이**입니다.
//    섞으면 전세가율이 그만큼 낮게 나옵니다. 그래서 시세는 **신규 계약만** 씁니다.
// ③ **면적은 소수입니다.** 59.785 처럼 셋째 자리까지 옵니다. 정수로만 오는 것처럼 보이는 단지
//    (신축은 49·84 처럼 딱 떨어짐)에 속지 않도록, 묶을 때만 반올림하고 원값은 남깁니다.
//
// ── 매매와 다른 점 ─────────────────────────────────────────────────────────
// **해제(취소) 칸이 없습니다.** 이 API 응답에는 cdealType·cdealDay 가 아예 들어오지 않습니다
// (2026-11-26 확인). 그래서 매매처럼 「해제된 건을 빼는」 일은 없지만, 늦은 신고·수정은 있으므로
// 갱신할 때 달을 통째로 갈아 끼우는 규칙은 그대로 지킵니다.
import { items, fields } from './_trades.mjs';

const num = v => {
  if (v === null || v === undefined) return null;
  const t = String(v).replace(/,/g, '').trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};
const str = v => String(v === null || v === undefined ? '' : v).trim();

/** 전용면적(㎡) → 평 — 매매 쪽과 같은 상수를 씁니다 */
export const pyeong = m2 => (m2 > 0 ? m2 / 3.3058 : null);

/** 묶을 때 쓰는 면적 — 매매 집계(build-trade-prices 의 mainAreas)와 같은 반올림이어야 짝이 맞습니다 */
export const areaKey = m2 => (m2 > 0 ? Math.round(m2) : null);

/** 전세인가 — 월세가 0 이면 전세입니다. 월세를 모르면(null) 판단하지 않습니다. */
export const isJeonse = r => r != null && r.monthly === 0;
/** 월세인가 */
export const isWolse = r => r != null && r.monthly != null && r.monthly > 0;
/** 시세로 쓸 수 있는 계약인가 — 신규 전세만. 갱신은 상한제에 묶여 시세가 아닙니다. */
export const isMarketJeonse = r => isJeonse(r) && r.type === '신규';

/**
 * 한 건을 우리 모양으로. 쓸 수 없는 건은 null.
 * 금액 단위는 **만원**입니다(API 가 그렇게 줍니다). 바꾸지 않습니다.
 */
export function toRent(f, gu = null) {
  const deposit = num(f.deposit);
  const monthly = num(f.monthlyRent);
  const area = num(f.excluUseAr);
  const y = num(f.dealYear), m = num(f.dealMonth), d = num(f.dealDay);
  // 보증금이 없거나 월세를 모르면 전세·월세를 가를 수 없어 버립니다.
  if (!(deposit > 0) || monthly === null || !(area > 0) || !(y > 1900) || !(m >= 1 && m <= 12)) return null;
  const type = str(f.contractType) || null;          // 신규 | 갱신 | null(모름)
  return {
    seq: str(f.aptSeq) || null,                      // 매매와 같은 단지 열쇠
    name: str(f.aptNm),
    gu, dong: str(f.umdNm), jibun: str(f.jibun), sggCd: str(f.sggCd),
    date: `${y}-${String(m).padStart(2, '0')}-${String(d || 1).padStart(2, '0')}`,
    deposit,                                         // 보증금(만원)
    monthly,                                         // 월세(만원) — 0 이면 전세
    area: Math.round(area * 100) / 100,              // ㎡ (원값 보존)
    floor: num(f.floor),
    year: num(f.buildYear),
    type,
    renewRight: str(f.useRRRight) === '사용' ? true : null,   // 갱신요구권 — 안 쓴 건은 빈 값이라 false 로 단정하지 않습니다
    preDeposit: num(f.preDeposit),                   // 갱신 건의 종전 보증금(없으면 null)
    preMonthly: num(f.preMonthlyRent),
  };
}

/** XML → 전월세 배열. 버린 건수를 함께 돌려줍니다. */
export function parseRents(xml, gu = null) {
  const raw = items(xml);
  const out = [];
  let broken = 0;
  for (const it of raw) {
    const r = toRent(fields(it), gu);
    if (r) out.push(r); else broken++;
  }
  return { rents: out, total: raw.length, broken };
}

/** 합치기(mergeRefresh)에 넘길 열쇠 — 보증금과 월세가 **둘 다** 들어가야 같은 건으로 셉니다 */
export const rentKey = r => [r.seq, r.date, r.deposit, r.monthly, r.area, r.floor].join('|');

const median = arr => {
  const v = arr.filter(x => x > 0).sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : null;
};
/** 아래 백분위 — 범위를 보일 때 씁니다(매매 쪽과 같은 식) */
const pct = (arr, p) => {
  const v = arr.filter(x => x > 0).sort((a, b) => a - b);
  if (!v.length) return null;
  return v[Math.min(v.length - 1, Math.max(0, Math.round((v.length - 1) * p)))];
};

/**
 * 단지 × 면적대별 **전세 시세**.
 * 시세로 쓰는 것은 **신규 전세만**이고, 갱신·월세는 세어서 함께 돌려줍니다 —
 * 「몇 건 중 몇 건을 썼는지」를 보여야 숫자를 따질 수 있습니다.
 */
export function jeonseByArea(rents, { months = null, asOfYM = null } = {}) {
  const cut = months && asOfYM ? cutYM(asOfYM, months) : null;
  const map = new Map();
  for (const r of rents) {
    if (!r.seq) continue;
    const a = areaKey(r.area);
    if (a == null) continue;
    if (cut && ymOf(r) < cut) continue;
    const k = `${r.seq}|${a}`;
    if (!map.has(k)) map.set(k, { seq: r.seq, area: a, used: [], renew: 0, wolse: 0, unknown: 0, last: null });
    const c = map.get(k);
    if (isMarketJeonse(r)) c.used.push(r);
    else if (isJeonse(r) && r.type === '갱신') c.renew++;
    else if (isJeonse(r)) c.unknown++;
    else c.wolse++;
    if (!c.last || r.date > c.last) c.last = r.date;
  }
  const out = [];
  for (const c of map.values()) {
    const dep = c.used.map(r => r.deposit);
    out.push({
      seq: c.seq, area: c.area,
      n: dep.length,                                 // 시세에 **쓴** 건수(신규 전세)
      med: median(dep),                              // 보증금 중앙값(만원)
      lo: pct(dep, 0.25), hi: pct(dep, 0.75),
      lastJeonse: c.used.length ? c.used.map(r => r.date).sort().pop() : null,
      renew: c.renew, wolse: c.wolse, unknown: c.unknown,   // 쓰지 않은 건수 — 숨기지 않습니다
      last: c.last,
    });
  }
  return out.sort((a, b) => b.n - a.n || a.seq.localeCompare(b.seq) || a.area - b.area);
}

const ymOf = r => String(r.date || '').slice(0, 7).replace('-', '');
/** asOfYM 에서 months 개월 전의 YYYYMM — 포함 범위를 자르는 기준 */
export function cutYM(asOfYM, months) {
  const y = Number(String(asOfYM).slice(0, 4)), m = Number(String(asOfYM).slice(4, 6));
  const d = new Date(Date.UTC(y, m - 1 - (months - 1), 1));
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * 전세가율 = 전세 보증금 ÷ 매매가.
 * **둘 중 하나라도 없으면 null** 입니다 — 0 이 아닙니다. 모르는 것을 0% 로 적으면
 * 「전세가 아주 싸다」는 거짓말이 됩니다.
 * 단위는 둘 다 만원이어야 합니다. 섞으면 100배가 어긋나므로, 말이 되는 범위(10~100%)를
 * 벗어나면 **버리고 왜 버렸는지 함께 돌려줍니다.**
 */
export const RATIO_MIN = 0.10, RATIO_MAX = 1.00;
export function jeonseRatio(deposit, salePrice) {
  if (!(deposit > 0) || !(salePrice > 0)) return { ratio: null, why: '한쪽 값이 없습니다' };
  const r = deposit / salePrice;
  if (r < RATIO_MIN) return { ratio: null, why: `전세가율 ${(r * 100).toFixed(1)}% — 너무 낮아 단위가 어긋난 것으로 봅니다` };
  if (r > RATIO_MAX) return { ratio: null, why: `전세가율 ${(r * 100).toFixed(1)}% — 보증금이 매매가를 넘습니다` };
  return { ratio: Math.round(r * 1000) / 1000, why: null };
}
