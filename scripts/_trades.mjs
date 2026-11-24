// 국토교통부 아파트 실거래가 — 받아 온 XML 을 쓸 수 있는 모양으로 바꾸는 **순수 함수들**(T010).
// 네트워크도 파일도 건드리지 않습니다. 받아 오는 일은 build-trades.mjs 가 합니다.
//
// 쓰는 API: 국토교통부_아파트 매매 실거래가 **상세** 자료(15126468, RTMSDataSvcAptTradeDev)
//   상세 쪽을 쓰는 이유 — 쪽수 나눠 받기(pageNo/numOfRows)가 되고, **aptSeq**(단지 일련번호)가 들어 있습니다.
//
// ── 실제 응답 한 건 (2026-10 강동구, 2026-11-19 확인) ────────────────────────
//   aptSeq 11740-2609 · aptNm 늘푸른아파트 · umdNm 천호동 · jibun 52-16 · buildYear 2006
//   dealAmount "60,700"(만원) · excluUseAr 74.41 · floor 2 · dealYear/Month/Day 2026/10/31
//   cdealType·cdealDay 빈 값(= 해제되지 않은 거래) · aptDong 빈 값(등기 완료 건만 공개)
//
// **반드시 지킬 것 두 가지**
//   ① 해제된 거래를 빼지 않으면 허위 고가 거래가 평균에 그대로 들어갑니다.
//   ② 거래가 없는 달과 조회에 실패한 달을 같은 것으로 치면 안 됩니다 — 0건과 모름은 다릅니다.

/** XML 한 덩이에서 <item>…</item> 들을 꺼냅니다 */
export const items = xml => String(xml || '').match(/<item>[\s\S]*?<\/item>/g) || [];

/** <태그>값</태그> → { 태그: 값 } */
export function fields(itemXml) {
  const out = {};
  for (const m of String(itemXml).matchAll(/<([A-Za-z][\w]*)>([^<]*)<\/\1>/g)) out[m[1]] = m[2].trim();
  return out;
}

const num = v => {
  if (v === null || v === undefined) return null;
  const t = String(v).replace(/,/g, '').trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

/**
 * 해제(취소)된 거래인가.
 * cdealType 이 '해제' 이거나 cdealDay 에 날짜가 있으면 해제입니다. 둘 다 빈 값이면 살아 있는 거래.
 * 2026-02 에 신고했다가 2026-03 에 해제한 건은 **2026-02 응답에 해제 표시가 붙어** 다시 나옵니다.
 */
export const isCancelled = f => String(f.cdealType || '').includes('해제') || !!String(f.cdealDay || '').trim();

/** 전용면적(㎡) → 평 */
export const pyeong = m2 => (m2 > 0 ? m2 / 3.3058 : null);

/**
 * 한 건을 우리 모양으로. 쓸 수 없는 건(금액·면적·날짜가 없거나 해제)은 null 을 돌려줍니다.
 * 금액 단위는 **만원**입니다(API 가 그렇게 줍니다). 바꾸지 않습니다 — 단위를 섞으면 0 하나로 10배가 틀립니다.
 */
export function toTrade(f, gu = null) {
  if (isCancelled(f)) return null;
  const amount = num(f.dealAmount);
  const area = num(f.excluUseAr);
  const y = num(f.dealYear), m = num(f.dealMonth), d = num(f.dealDay);
  if (!(amount > 0) || !(area > 0) || !(y > 1900) || !(m >= 1 && m <= 12)) return null;
  const p = pyeong(area);
  return {
    seq: String(f.aptSeq || '').trim() || null,     // 단지 일련번호 — 같은 단지를 묶는 열쇠
    name: String(f.aptNm || '').trim(),
    gu, dong: String(f.umdNm || '').trim(), jibun: String(f.jibun || '').trim(),
    sggCd: String(f.sggCd || '').trim(),
    date: `${y}-${String(m).padStart(2, '0')}-${String(d || 1).padStart(2, '0')}`,
    amount,                                          // 만원
    area: Math.round(area * 100) / 100,              // ㎡
    perPyeong: p ? Math.round(amount / p) : null,    // 만원/평
    floor: num(f.floor),
    year: num(f.buildYear),
    kind: String(f.dealingGbn || '').trim() || null, // 중개거래 / 직거래
  };
}

/** XML → 거래 배열. 해제·결손 건은 빠지고, 몇 건이 왜 빠졌는지 함께 돌려줍니다. */
export function parseTrades(xml, gu = null) {
  const raw = items(xml);
  const out = [];
  let cancelled = 0, broken = 0;
  for (const it of raw) {
    const f = fields(it);
    if (isCancelled(f)) { cancelled++; continue; }
    const t = toTrade(f, gu);
    if (t) out.push(t); else broken++;
  }
  return { trades: out, total: raw.length, cancelled, broken };
}

/** 응답의 totalCount — 쪽을 더 받아야 하는지 판단용. 없으면 null(모름) */
export const totalCount = xml => {
  const m = /<totalCount>(\d+)<\/totalCount>/.exec(String(xml || ''));
  return m ? Number(m[1]) : null;
};

/** 오류 응답이면 사람이 읽을 메시지, 정상이면 null */
export function errorOf(xml) {
  const s = String(xml || '');
  if (/<resultCode>0*0<\/resultCode>/.test(s)) return null;
  const msg = /<(?:returnAuthMsg|resultMsg|errMsg)>([^<]*)</.exec(s);
  return msg ? msg[1].trim() : (s.trim() ? s.replace(/\s+/g, ' ').slice(0, 120) : '빈 응답');
}

/**
 * 단지별로 묶기 — aptSeq 가 열쇠입니다.
 * 중앙값을 쓰는 이유: 한 단지에 59㎡와 134㎡가 섞여 있어 평균은 큰 평형에 끌려갑니다.
 * 면적대별로 나누는 것은 다음 단계(J-AVM)의 일이고, 여기서는 **단지에 거래가 몇 건 있나**를 봅니다.
 */
export function byComplex(trades) {
  const map = new Map();
  for (const t of trades) {
    if (!t.seq) continue;
    if (!map.has(t.seq)) map.set(t.seq, { seq: t.seq, name: t.name, gu: t.gu, dong: t.dong, jibun: t.jibun, year: t.year, trades: [] });
    map.get(t.seq).trades.push(t);
  }
  for (const c of map.values()) {
    c.trades.sort((a, b) => (a.date < b.date ? 1 : -1));   // 최근 거래가 앞
    c.n = c.trades.length;
    c.last = c.trades[0].date;
    const pp = c.trades.map(t => t.perPyeong).filter(v => v > 0).sort((a, b) => a - b);
    c.medPerPyeong = pp.length ? pp[Math.floor(pp.length / 2)] : null;
  }
  return [...map.values()].sort((a, b) => b.n - a.n);
}
