// 진가 종목 분석 — 섹터 가중·개별 특성·성장성·재무지표 점수(100점) → 적정가격 → 시나리오(강세·기준·약세) 확률 가중 → 유망 섹터·종목 TOP 3
// 순수 계산(네트워크 없음) — api/stock-analysis 가 시세(_market.mjs)·재무(_fundamentals.mjs)·시장 상황(VIX·지수 추세)을 넣어 부름.
// 적정가격은 감정평가 3방식에 대응: 수익가치(순이익 × 섹터 PER) · 비교방식(EBITDA × 섹터 EV/EBITDA) · 자산가치(자본 × 섹터 PBR, ROE 보정)
// 모든 가정은 응답(methodology)으로 함께 내보내 화면에 공개합니다. 투자 권유가 아닌 참고용 모델입니다.
// 2026-09-15 실데이터 점검 후 보정: 적정가 제한 0.4~2배, PEG형 성장 보정, 3~5종목 섹터는 지수 중앙값과 섞음, 우선주 제외, 일회성 성장 경고

export const SCORE_WEIGHTS = [
  { key: 'sector', label: '섹터 전망', max: 20, desc: '섹터 이익 모멘텀(매출·이익 성장 중앙값) 40% · 성장 대비 상대 PER 30% · 시나리오 기대값(확률 × 경기민감도) 20% · 약세 방어력 10%의 섹터 간 순위' },
  { key: 'value', label: '밸류에이션', max: 25, desc: 'PER·PBR·EV/EBITDA가 같은 섹터 종목보다 낮을수록 가점(적자·자본잠식은 0)' },
  { key: 'growth', label: '성장성', max: 25, desc: '매출 성장률·순이익 성장률의 섹터 내 순위(국내는 증권사 컨센서스 전망 우선)' },
  { key: 'quality', label: '수익성·재무', max: 20, desc: 'ROE·영업이익률은 높을수록, 순부채/EBITDA(국내는 부채비율)는 낮을수록 가점(금융은 ROE만)' },
  { key: 'traits', label: '개별 특성', max: 10, desc: '시가총액 규모(안정성·유동성)와 주주환원(미국 FCF 수익률 · 국내 배당수익률)' },
];

// 경기민감도(β) — 시나리오에서 멀티플·이익이 움직이는 크기. 경기민감 섹터 1 초과, 방어 섹터 1 미만(일반적인 섹터 베타 범위를 단순화)
export const SECTOR_BETA = {
  정보기술: 1.25, 경기소비재: 1.2, 소재: 1.15, 커뮤니케이션: 1.1, 금융: 1.1, 산업재: 1.05, 에너지: 1.0,
  부동산: 0.9, 헬스케어: 0.75, 필수소비재: 0.6, 유틸리티: 0.55, 기타: 1.0,
};

// 시나리오별 적정가 = 기준 적정가 × (1 + multK × β) × (1 + earnK × β)
export const SCENARIOS = [
  { key: 'bull', label: '강세', desc: '금리 인하·경기 확장 — 이익 전망 상향과 위험 선호로 멀티플 확대(경기민감 섹터일수록 크게)', multK: 0.12, earnK: 0.06 },
  { key: 'base', label: '기준', desc: '현재 이익 수준과 섹터 평균 멀티플이 유지되는 경우', multK: 0, earnK: 0 },
  { key: 'bear', label: '약세', desc: '경기 둔화·고금리 지속 — 이익 하향과 멀티플 축소(방어 섹터는 덜 빠짐)', multK: -0.15, earnK: -0.1 },
];
export const PROB_RULE = 'VIX 14 미만이면 강세 +10%p·약세 −8%p, 18 미만 +5%p·−3%p, 24 이상 −7%p·+10%p, 30 이상 −12%p·+18%p. 지수 연초 대비 +10% 초과면 강세 +5%p·약세 −3%p, −10% 미만이면 −5%p·+7%p (기본 강세 25%·기준 50%·약세 25%)';
export const SECTOR_OUTLOOK_WEIGHTS = { momentum: 0.4, valuation: 0.3, scenario: 0.2, defense: 0.1 };

export const METHOD_WEIGHTS = { per: 0.45, ev: 0.35, pbr: 0.2 };
export const METHOD_WEIGHTS_FIN = { per: 0.55, pbr: 0.45 };
export const MIN_PEERS = 3;          // 이보다 적은 섹터는 지수 전체와 비교
export const FULL_PEERS = 6;         // 이보다 적은 섹터는 섹터 중앙값을 지수 중앙값과 종목 수 비율로 섞음
export const FAIR_RANGE = [0.4, 2];  // 적정가 = 현재가의 0.4~2배로 제한(넘으면 신뢰도 낮음)
export const METHODS_TEXT = [
  '① 수익가치(PER 비교): 순이익 × 섹터 PER 중앙값 × 성장 보정 — ((1+회사 이익 성장) ÷ (1+섹터 이익 성장))^0.75, 0.6~1.6배(성장률은 −50%~+150%로 잘라 일회성 영향 완화)',
  '② 비교방식(EV/EBITDA): EBITDA × 섹터 EV/EBITDA 중앙값 − 순부채(금융 섹터 제외)',
  '③ 자산가치(PBR·ROE): 자본총계 × 섹터 PBR 중앙값 × √(ROE ÷ 섹터 ROE, 0.5~2배)',
  `가중: 수익가치 45% · EV/EBITDA 35% · 자산가치 20%(금융은 55% · 45%) — 계산할 수 있는 방식끼리 다시 나눔. 적정가는 현재가의 ${FAIR_RANGE[0]}~${FAIR_RANGE[1]}배로 제한`,
  '신뢰도: 방식 3개·방식 간 차이 1.6배 미만이면 높음, 2개 이상·2배 미만이면 보통, 그 외(제한에 걸린 경우 포함) 낮음',
  `비교 대상: 같은 섹터 ${FULL_PEERS}종목 이상이면 그 섹터 중앙값, ${MIN_PEERS}~${FULL_PEERS - 1}종목이면 섹터·지수 중앙값을 종목 수 비율로 섞음, ${MIN_PEERS}종목 미만이면 지수 전체. 멀티플 중앙값은 PER 3~80배 · PBR 0.3~15배 · EV/EBITDA 2~60배 안에서`,
  '유망 종목 TOP 3: 확률가중 기대 상승여력이 플러스이고 점수 요소가 절반 이상 계산된 종목 중 진가 점수 순, 섹터당 1종목. 신뢰도 낮음·일회성 성장 경고(매출 ±100% 또는 이익 +100% 초과) 종목은 후보가 모자랄 때만',
  `유망 섹터 TOP 3: ${MIN_PEERS}종목 이상 분석된 섹터를 전망 점수 순으로 — 이익 모멘텀 40% · 성장 대비 상대 PER(섹터 PER 중앙값 ÷ 지수 PER 중앙값 ÷ (1+이익 성장)) 30% · 시나리오 기대값 20% · 약세 방어력 10%`,
  '국내 우선주는 보통주와 재무를 같이 써 적정가가 왜곡되므로 분석에서 제외',
];

const FIN = '금융';
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const rnd = (v, d) => (isNum(v) ? Math.round(v * 10 ** d) / 10 ** d : null);
const mean = arr => { const x = arr.filter(isNum); return x.length ? x.reduce((s, v) => s + v, 0) / x.length : null; };
const mapValues = (o, fn) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, fn(v)]));
const growthClamp = v => clamp(v, -0.9, 3);
/** 국내 우선주 — 이름 끝 「우」「우B」 등 또는 코드 끝자리가 0이 아님 */
export const isPreferredKr = it => /우[A-Z]?$|우\(전환\)$/.test(String(it.n || '')) || !/0$/.test(String(it.s || ''));

export function median(arr) {
  const s = arr.filter(isNum).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
/** v 의 백분위(0~1) — 같은 값은 가운데로 */
export function pctRank(values, v) {
  const s = values.filter(isNum);
  if (!isNum(v) || !s.length) return null;
  if (s.length === 1) return 0.5;
  let lo = 0, eq = 0;
  for (const x of s) { if (x < v) lo++; else if (x === v) eq++; }
  return clamp((lo + Math.max(0, eq - 1) / 2) / (s.length - 1), 0, 1);
}

/** 시장 상황 → 시나리오 확률 */
export function scenarioProbabilities({ vix = null, trendPct = null } = {}) {
  let bull = 0.25, bear = 0.25;
  if (isNum(vix)) {
    if (vix < 14) { bull += 0.1; bear -= 0.08; } else if (vix < 18) { bull += 0.05; bear -= 0.03; } else if (vix >= 30) { bull -= 0.12; bear += 0.18; } else if (vix >= 24) { bull -= 0.07; bear += 0.1; }
  }
  if (isNum(trendPct)) {
    if (trendPct > 10) { bull += 0.05; bear -= 0.03; } else if (trendPct < -10) { bull -= 0.05; bear += 0.07; }
  }
  bull = clamp(bull, 0.1, 0.45); bear = clamp(bear, 0.08, 0.5);
  const base = Math.max(0.3, 1 - bull - bear);
  const sum = bull + base + bear;
  const out = { bull: rnd(bull / sum, 2), bear: rnd(bear / sum, 2) };
  out.base = rnd(1 - out.bull - out.bear, 2);
  return out;
}

/** 경기민감도 β인 섹터의 시나리오 배율 */
export const scenarioFactor = (s, beta) => (1 + s.multK * beta) * (1 + s.earnK * beta);

/** 시세 항목 + 재무 → 회사 단위 지표(주식 종류가 여러 개여도 시가총액 기준이라 같게 계산됨) */
export function stockMetrics(it, f, market) {
  if (!f || !(it.cap > 0) || !(it.p > 0)) return null;
  if (market === 'US') {
    const ebitda = isNum(f.oi) ? f.oi + (isNum(f.da) ? f.da : 0) : null;
    const netDebt = isNum(f.debt) || isNum(f.cash) ? (f.debt || 0) - (f.cash || 0) : null;
    const ev = it.cap + (netDebt || 0);
    return {
      ni: f.ni, equity: f.equity, ebitda, netDebt, ev,
      per: f.ni > 0 ? it.cap / f.ni : null, loss: isNum(f.ni) && f.ni <= 0,
      pbr: f.equity > 0 ? it.cap / f.equity : null,
      evEbitda: ebitda > 0 ? ev / ebitda : null,
      roe: isNum(f.ni) && f.equity > 0 ? f.ni / f.equity : null,
      opm: isNum(f.oi) && f.rev > 0 ? f.oi / f.rev : null,
      revG: f.rev > 0 && f.rev0 > 0 ? f.rev / f.rev0 - 1 : null,
      niG: f.ni0 > 0 && isNum(f.ni) ? f.ni / f.ni0 - 1 : null,
      lev: ebitda > 0 && isNum(netDebt) ? netDebt / ebitda : null,
      cashY: isNum(f.ocf) && isNum(f.capex) ? (f.ocf - f.capex) / it.cap : null,
      labels: { ev: 'EV/EBITDA', growth: '순이익 성장', cash: 'FCF 수익률', lev: '순부채/EBITDA' },
    };
  }
  // 국내 — PER·PBR은 최근 4분기(네이버), 연간 재무는 억원
  const E = 1e8;
  const ni = f.per > 0 ? it.cap / f.per : isNum(f.ni) ? f.ni * E : null;
  const equity = f.pbr > 0 ? it.cap / f.pbr : null;
  const ebit = isNum(f.oi) ? f.oi * E : null;
  const niFwd = f.cnsPer > 0 ? it.cap / f.cnsPer : isNum(f.niFwd) ? f.niFwd * E : null;
  const loss = isNum(f.per) ? f.per <= 0 : isNum(f.ni) && f.ni <= 0;
  return {
    ni: loss ? Math.min(ni ?? 0, 0) : ni, equity, ebitda: ebit, netDebt: null, ev: it.cap,
    per: f.per > 0 ? f.per : null, loss,
    pbr: f.pbr > 0 ? f.pbr : null,
    evEbitda: ebit > 0 ? it.cap / ebit : null,
    roe: f.pbr > 0 && f.per > 0 ? f.pbr / f.per : isNum(f.roe) ? f.roe / 100 : null,
    opm: isNum(f.opm) ? f.opm / 100 : null,
    revG: f.revFwd > 0 && f.rev > 0 ? f.revFwd / f.rev - 1 : f.rev > 0 && f.rev0 > 0 ? f.rev / f.rev0 - 1 : null,
    niG: isNum(niFwd) && ni > 0 && !loss ? niFwd / ni - 1 : f.ni0 > 0 && isNum(f.ni) ? f.ni / f.ni0 - 1 : null,
    lev: isNum(f.debtRatio) ? f.debtRatio / 100 : null,
    cashY: isNum(f.divYield) ? f.divYield / 100 : null,
    labels: { ev: 'EV/EBIT', growth: '순이익 성장(전망)', cash: '배당수익률', lev: '부채비율' },
  };
}

export function analyzeIndex({ market, fund, regime = {} }) {
  const US = market.market === 'US';
  const rows = market.items.map(it => {
    const f = fund && fund.bySymbol ? fund.bySymbol[it.s] : null;
    const sector = US ? it.sec || '기타' : (f && f.sector) || '기타';
    const preferred = !US && isPreferredKr(it);
    return { it, f, sector, preferred, m: preferred ? null : stockMetrics(it, f, market.market) };
  });
  const valid = rows.filter(r => r.m);
  const groups = new Map();
  valid.forEach(r => { if (!groups.has(r.sector)) groups.set(r.sector, []); groups.get(r.sector).push(r); });

  const sizeOf = r => (groups.get(r.sector) || []).length;
  const peerKey = r => (sizeOf(r) >= MIN_PEERS ? r.sector : '*');
  const peerLabel = r => (sizeOf(r) >= FULL_PEERS ? r.sector : sizeOf(r) >= MIN_PEERS ? `${r.sector}·지수 보정` : '지수 전체');
  const statsCache = new Map();
  const stats = key => {
    if (statsCache.has(key)) return statsCache.get(key);
    const list = key === '*' ? valid : groups.get(key);
    const nonFin = list.filter(r => r.sector !== FIN);
    const col = (arr, k, fn = v => v) => arr.map(r => r.m[k]).filter(isNum).map(fn);
    const s = {
      per: median(col(list, 'per').filter(v => v >= 3 && v <= 80)),
      pbr: median(col(list, 'pbr').filter(v => v >= 0.3 && v <= 15)),
      ev: median(col(nonFin, 'evEbitda').filter(v => v >= 2 && v <= 60)),
      roe: median(col(list, 'roe').filter(v => v > -0.5 && v < 1)),
      revG: median(col(list, 'revG', growthClamp)),
      niG: median(col(list, 'niG', growthClamp)),
      cols: { per: col(list, 'per'), pbr: col(list, 'pbr'), ev: col(nonFin, 'evEbitda'), revG: col(list, 'revG', growthClamp), niG: col(list, 'niG', growthClamp), roe: col(list, 'roe'), opm: col(nonFin, 'opm'), lev: col(nonFin, 'lev') },
    };
    // 종목 수가 적은 섹터는 중앙값이 흔들리므로 지수 중앙값과 섞음(점수 순위는 섹터 안에서)
    if (key !== '*' && list.length < FULL_PEERS) {
      const all = stats('*');
      const w = list.length / FULL_PEERS;
      for (const k of ['per', 'pbr', 'ev', 'roe', 'revG', 'niG']) {
        if (isNum(s[k]) && isNum(all[k])) s[k] = w * s[k] + (1 - w) * all[k];
        else if (!isNum(s[k])) s[k] = all[k];
      }
    }
    statsCache.set(key, s);
    return s;
  };
  const low = (arr, v) => { const p = pctRank(arr, v); return p == null ? null : 1 - p; };
  const high = (arr, v) => pctRank(arr, v);
  const capLogs = valid.map(r => Math.log(r.it.cap));
  const cashYs = valid.map(r => r.m.cashY).filter(isNum);
  const probs = scenarioProbabilities(regime);
  const expFactor = beta => SCENARIOS.reduce((a, s) => a + probs[s.key] * scenarioFactor(s, beta), 0);

  // 1) 점수 요소 · 적정가 · 시나리오
  for (const r of valid) {
    const { m, it } = r;
    const fin = r.sector === FIN;
    const st = stats(peerKey(r));
    const niG = isNum(m.niG) ? growthClamp(m.niG) : null;
    const revG = isNum(m.revG) ? growthClamp(m.revG) : null;
    // 매출이 두 배 넘게 변했거나 이익이 두 배 넘게 늘면 인수합병·전년 손상차손 같은 일회성 영향일 가능성이 큼(2026-09 ES 이익 +107%·적정가 +94% 사례)
    r.oneOff = (isNum(m.revG) && Math.abs(m.revG) > 1) || (isNum(m.niG) && m.niG > 1);
    r.sub = {
      value: mean([m.loss ? 0 : low(st.cols.per, m.per), isNum(m.equity) && m.equity <= 0 ? 0 : low(st.cols.pbr, m.pbr), fin ? null : isNum(m.ebitda) && m.ebitda <= 0 ? 0 : low(st.cols.ev, m.evEbitda)]),
      growth: mean([high(st.cols.revG, revG), high(st.cols.niG, niG)]),
      quality: mean([high(st.cols.roe, m.roe), fin ? null : high(st.cols.opm, m.opm), fin ? null : low(st.cols.lev, m.lev)]),
      traits: mean([high(capLogs, Math.log(it.cap)), high(cashYs, m.cashY)]),
    };
    r.peer = { per: st.per, pbr: st.pbr, ev: fin ? null : st.ev, roe: st.roe, group: peerLabel(r) };

    const methods = {};
    const gAdj = isNum(m.niG) && isNum(st.niG) ? clamp(((1 + clamp(m.niG, -0.5, 1.5)) / (1 + clamp(st.niG, -0.5, 1.5))) ** 0.75, 0.6, 1.6) : 1;
    if (m.ni > 0 && st.per) methods.per = m.ni * st.per * gAdj;
    if (!fin && m.ebitda > 0 && st.ev) { const eq = m.ebitda * st.ev - (m.netDebt || 0); if (eq > 0) methods.ev = eq; }
    if (m.equity > 0 && st.pbr) methods.pbr = m.equity * st.pbr * (isNum(m.roe) && st.roe > 0 ? Math.sqrt(clamp(m.roe / st.roe, 0.5, 2)) : 1);
    const w = fin ? METHOD_WEIGHTS_FIN : METHOD_WEIGHTS;
    let sw = 0, sv = 0;
    for (const [k, v] of Object.entries(methods)) if (w[k]) { sw += w[k]; sv += w[k] * v; }
    r.beta = SECTOR_BETA[r.sector] ?? 1;
    if (!sw) continue;
    const ratio = sv / sw / it.cap;
    r.clamped = ratio < FAIR_RANGE[0] || ratio > FAIR_RANGE[1];
    r.fair = it.p * clamp(ratio, FAIR_RANGE[0], FAIR_RANGE[1]);
    r.methodPrices = Object.fromEntries(Object.entries(methods).filter(([k]) => w[k]).map(([k, v]) => [k, it.p * v / it.cap]));
    const mp = Object.values(r.methodPrices);
    const spread = Math.max(...mp) / Math.min(...mp);
    r.confidence = mp.length >= 3 && spread < 1.6 && !r.clamped ? '높음' : mp.length >= 2 && spread < 2 && !r.clamped ? '보통' : '낮음';
    r.scen = Object.fromEntries(SCENARIOS.map(s => [s.key, r.fair * scenarioFactor(s, r.beta)]));
    r.expFair = SCENARIOS.reduce((a, s) => a + probs[s.key] * r.scen[s.key], 0);
    r.expUpside = r.expFair / it.p - 1;
  }

  // 2) 섹터 전망 — 이익 모멘텀 · 성장 대비 상대 PER · 시나리오 기대값 · 약세 방어력의 섹터 간 순위
  const indexPer = median(valid.map(r => r.m.per).filter(v => isNum(v) && v >= 3 && v <= 80));
  const bearScen = SCENARIOS.find(s => s.key === 'bear');
  const sectorRows = [...groups.entries()].map(([name, list]) => {
    const withFair = list.filter(r => isNum(r.expUpside));
    const beta = SECTOR_BETA[name] ?? 1;
    const medRevG = median(list.map(r => r.m.revG).filter(isNum).map(growthClamp));
    const medNiG = median(list.map(r => r.m.niG).filter(isNum).map(growthClamp));
    const medPer = median(list.map(r => r.m.per).filter(v => isNum(v) && v >= 3 && v <= 80));
    return {
      name, list, withFair, beta, medRevG, medNiG, medPer,
      momentum: mean([medRevG, medNiG]),
      relVal: isNum(medPer) && indexPer ? medPer / indexPer / (1 + Math.max(medNiG ?? 0, -0.5)) : null,
      scenario: expFactor(beta) - 1,
      defense: scenarioFactor(bearScen, beta) - 1,
      medUpside: median(withFair.map(r => r.expUpside)),
      medBear: median(withFair.map(r => r.scen.bear / r.it.p - 1)),
      medBull: median(withFair.map(r => r.scen.bull / r.it.p - 1)),
    };
  });
  const eligible = sectorRows.filter(s => s.list.length >= MIN_PEERS);
  const colOf = k => eligible.map(s => s[k]);
  for (const s of eligible) {
    s.drivers = {
      momentum: eligible.length > 1 ? pctRank(colOf('momentum'), s.momentum) : 0.5,
      valuation: eligible.length > 1 && isNum(s.relVal) ? 1 - pctRank(colOf('relVal'), s.relVal) : null,
      scenario: eligible.length > 1 ? pctRank(colOf('scenario'), s.scenario) : 0.5,
      defense: eligible.length > 1 ? pctRank(colOf('defense'), s.defense) : 0.5,
    };
    let sw = 0, sv = 0;
    for (const [k, w] of Object.entries(SECTOR_OUTLOOK_WEIGHTS)) if (isNum(s.drivers[k])) { sw += w; sv += w * s.drivers[k]; }
    s.outlook = sw ? sv / sw : 0.5;
  }

  // 3) 종합 점수
  for (const r of valid) {
    const sec = sectorRows.find(s => s.name === r.sector);
    r.outlook = sec && isNum(sec.outlook) ? sec.outlook : 0.5;
    const sub = r.sub;
    r.parts = { sector: 20 * r.outlook, value: 25 * (sub.value ?? 0.35), growth: 25 * (sub.growth ?? 0.35), quality: 20 * (sub.quality ?? 0.35), traits: 10 * (sub.traits ?? 0.35) };
    r.score = Object.values(r.parts).reduce((a, v) => a + v, 0);
    r.completeness = ['value', 'growth', 'quality', 'traits'].filter(k => sub[k] != null).length / 4;
  }

  // 4) 추천
  const sgn = v => `${v > 0 ? '+' : ''}${(v * 100).toFixed(1)}%`;
  const reasons = r => {
    const { m, peer } = r;
    const out = [];
    if (r.sub.value != null && r.sub.value >= 0.6) {
      if (isNum(m.per) && peer.per) out.push(`PER ${m.per.toFixed(1)}배 · 섹터 ${peer.per.toFixed(1)}배`);
      else if (isNum(m.pbr) && peer.pbr) out.push(`PBR ${m.pbr.toFixed(2)}배 · 섹터 ${peer.pbr.toFixed(2)}배`);
    }
    if (r.sub.growth != null && r.sub.growth >= 0.6) {
      const g = [isNum(m.revG) ? `매출 ${sgn(m.revG)}` : null, isNum(m.niG) ? `이익 ${sgn(m.niG)}` : null].filter(Boolean).join(' · ');
      if (g) out.push(`성장 ${g}`);
    }
    if (r.sub.quality != null && r.sub.quality >= 0.6 && isNum(m.roe)) out.push(`ROE ${(m.roe * 100).toFixed(1)}%`);
    if (r.outlook >= 0.66) out.push(`${r.sector} 섹터 전망 상위`);
    if (isNum(r.expUpside)) out.push(`기대 상승여력 ${sgn(r.expUpside)}`);
    if (m.loss) out.push('최근 적자');
    if (r.oneOff) out.push('일회성·인수합병 영향 가능');
    if (r.confidence === '낮음') out.push('적정가 신뢰도 낮음');
    return out.slice(0, 6);
  };
  const cand = valid.filter(r => isNum(r.expUpside) && r.expUpside > 0 && r.completeness >= 0.5).sort((a, b) => b.score - a.score);
  const pickTop = (list, oneSector) => {
    const out = [], used = new Set();
    for (const r of list) {
      if (oneSector && used.has(r.sector)) continue;
      out.push(r); used.add(r.sector);
      if (out.length === 3) break;
    }
    return out;
  };
  const trusted = cand.filter(r => r.confidence !== '낮음' && !r.oneOff);
  let top = pickTop(trusted, true);
  if (top.length < 3) top = pickTop(trusted, false);
  if (top.length < 3) top = pickTop(cand, false);

  const sectors = sectorRows.map(s => ({
    name: s.name, count: s.list.length, analyzed: s.withFair.length, beta: s.beta,
    outlook: isNum(s.outlook) ? Math.round(s.outlook * 100) : null,
    drivers: s.drivers ? mapValues(s.drivers, v => (isNum(v) ? Math.round(v * 100) : null)) : null,
    medRevG: rnd(s.medRevG, 4), medNiG: rnd(s.medNiG, 4), medPer: rnd(s.medPer, 2), relVal: rnd(s.relVal, 3),
    scenario: rnd(s.scenario, 4), defense: rnd(s.defense, 4),
    medUpside: rnd(s.medUpside, 4), medBear: rnd(s.medBear, 4), medBull: rnd(s.medBull, 4),
    avgScore: rnd(mean(s.list.map(r => r.score)), 1),
    picks: s.list.slice().sort((a, b) => b.score - a.score).slice(0, 3).map(r => r.it.s),
  })).sort((a, b) => (b.outlook ?? -1) - (a.outlook ?? -1) || (b.avgScore ?? 0) - (a.avgScore ?? 0));

  const withScen = valid.filter(r => r.scen);
  const capSum = withScen.reduce((a, r) => a + r.it.cap, 0);
  const scenarios = SCENARIOS.map(s => ({
    key: s.key, label: s.label, desc: s.desc, prob: probs[s.key], multK: s.multK, earnK: s.earnK,
    medImpact: rnd(median(withScen.map(r => r.scen[s.key] / r.it.p - 1)), 4),
    capImpact: capSum ? rnd(withScen.reduce((a, r) => a + r.it.cap * (r.scen[s.key] / r.it.p - 1), 0) / capSum, 4) : null,
  }));

  const dec = US ? 2 : 0;
  const stocks = rows.map(r => {
    const base = { s: r.it.s, n: r.it.n, sec: r.sector, industry: (r.f && r.f.industry) || null, p: r.it.p, cap: r.it.cap };
    if (!r.m) return { ...base, na: true, naReason: r.preferred ? '우선주' : '재무 없음' };
    const m = r.m;
    return {
      ...base,
      score: rnd(r.score, 1), parts: mapValues(r.parts, v => rnd(v, 1)), completeness: r.completeness,
      fair: rnd(r.fair, dec), expFair: rnd(r.expFair, dec),
      fairBear: r.scen ? rnd(r.scen.bear, dec) : null, fairBull: r.scen ? rnd(r.scen.bull, dec) : null,
      upside: r.fair ? rnd(r.fair / r.it.p - 1, 4) : null, expUpside: rnd(r.expUpside, 4),
      bearUpside: r.scen ? rnd(r.scen.bear / r.it.p - 1, 4) : null, bullUpside: r.scen ? rnd(r.scen.bull / r.it.p - 1, 4) : null,
      confidence: r.confidence || null, clamped: !!r.clamped, oneOff: !!r.oneOff,
      methods: r.methodPrices ? mapValues(r.methodPrices, v => rnd(v, dec)) : {},
      metrics: { per: rnd(m.per, 2), pbr: rnd(m.pbr, 2), ev: rnd(m.evEbitda, 2), roe: rnd(m.roe, 4), opm: rnd(m.opm, 4), revG: rnd(m.revG, 4), niG: rnd(m.niG, 4), cashY: rnd(m.cashY, 4), lev: rnd(m.lev, 3), loss: !!m.loss },
      labels: m.labels,
      peer: { per: rnd(r.peer.per, 2), pbr: rnd(r.peer.pbr, 2), ev: rnd(r.peer.ev, 2), roe: rnd(r.peer.roe, 4), group: r.peer.group },
      reasons: reasons(r),
    };
  });

  const fundLabel = !fund ? ''
    : US ? `FY${fund.periods ? fund.periods.fy : ''} 연간 실적 · ${fund.periods ? fund.periods.inst[0].replace(/^CY(\d{4})Q(\d)I$/, '$1년 $2분기말') : ''} 재무상태(SEC)`
    : 'PER·PBR 최근 4분기 · 연간 실적·컨센서스(네이버)';
  const notes = US ? [
    'SEC EDGAR XBRL(frames) — 회계연도 연간 실적(매출·영업이익·순이익·감가상각·영업현금흐름·설비투자)과 최근 분기말 재무상태(자본·장기부채·현금). 해외 상장사(20-F 등)와 일부 금융사는 항목이 없어 빠질 수 있음',
    'EBITDA = 영업이익 + 감가상각, 순부채 = 장기부채 − 현금, 순이익 성장 = 최근 회계연도 ÷ 직전 회계연도',
    '시세·시가총액: 나스닥 제공 지연 시세. 애널리스트 목표가(나스닥)는 TOP 3에만 참고로 표시하고 점수에는 넣지 않음',
    '섹터 멀티플 중앙값과 비교하는 상대가치 모델이라, 섹터 평균보다 높은 멀티플을 받는 초대형 성장주는 적정가가 현재가보다 낮게 나오기 쉬움',
  ] : [
    '네이버 금융 — PER·PBR은 최근 4분기, 매출·영업이익·영업이익률·부채비율은 최근 연간, 성장률은 증권사 컨센서스(없으면 최근 연간 증감)',
    'EV/EBIT = 시가총액 ÷ 영업이익(순부채 자료가 없어 반영하지 않음), 업종은 네이버 업종을 GICS 섹터로 묶음, 우선주는 제외',
    '시세: 네이버 금융 시가총액 상위 100종목(ETF 제외)',
  ];
  notes.push('재무 데이터는 하루 한 번 새로 모으고, 점수·적정가는 시세가 바뀔 때마다 다시 계산', '공개 데이터로 계산한 참고용 모델이며 투자 권유가 아닙니다. 개별 기업의 일회성 손익·사업 변화·지배구조는 반영하지 못합니다');

  return {
    index: market.index, label: market.label, market: market.market, currency: market.currency, asOf: market.asOf, fetchedAt: market.fetchedAt,
    fundamentals: { builtAt: fund ? fund.builtAt : null, source: fund ? fund.source : null, label: fundLabel },
    regime: { vix: isNum(regime.vix) ? rnd(regime.vix, 2) : null, trendPct: isNum(regime.trendPct) ? rnd(regime.trendPct, 2) : null, trendLabel: regime.trendLabel || null },
    indexPer: rnd(indexPer, 2),
    scenarios, weights: SCORE_WEIGHTS, sectors, topSectors: sectors.filter(s => s.outlook != null).slice(0, 3).map(s => s.name), top: top.map(r => r.it.s),
    coverage: { total: rows.length, analyzed: valid.length, withFair: valid.filter(r => r.fair).length, preferred: rows.filter(r => r.preferred).length },
    methodology: { methods: METHODS_TEXT, probRule: PROB_RULE, betas: SECTOR_BETA, sectorWeights: SECTOR_OUTLOOK_WEIGHTS, notes },
    stocks,
  };
}
