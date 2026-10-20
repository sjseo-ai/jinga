// 종목 분석용 재무 데이터 수집 — 하루 한 번 모아 Blob(stocks/fund-US.json · stocks/fund-KR.json)에 보관, api/stock-analysis 가 씀
//   미국: SEC EDGAR XBRL frames — 항목·기간마다 전 상장사 값을 한 번에 주는 공식 API(요청 수십 건으로 S&P 500 전체)
//         회계연도 연간 실적(매출·영업이익·순이익·감가상각·영업현금흐름·설비투자) + 최근 분기말 재무상태(자본·장기부채·현금)
//   국내: 네이버 금융 — 종목 정보(PER·PBR 최근 4분기, 추정 PER, BPS, 배당수익률, 업종) + 연간 재무(매출·영업이익·순이익·ROE·부채비율, 컨센서스)
// 금액 단위: 미국 달러, 국내 억원(연간 재무) — 분석 모듈(_analysis.mjs)이 원 단위로 바꿔 씀
import { runPool } from '../jinga-kb.mjs';

export const SEC_UA = 'jinga-retech/1.0 (+https://jinga-retech.vercel.app)';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
export const SEC_TICKERS_URL = 'https://www.sec.gov/files/company_tickers.json';
export const secFrameUrl = (concept, unit, period) => `https://data.sec.gov/api/xbrl/frames/us-gaap/${concept}/${unit}/${period}.json`;

// 회사마다 쓰는 XBRL 항목 이름이 달라 앞에서부터 있는 값을 씀(2026-09 S&P 500 커버리지 확인: 순이익 494·매출 466·자본 499/500)
export const US_DURATION = {
  revenue: ['RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues', 'RevenuesNetOfInterestExpense'],
  netIncome: ['NetIncomeLoss', 'ProfitLoss'],
  opIncome: ['OperatingIncomeLoss'],
  da: ['DepreciationDepletionAndAmortization', 'DepreciationAndAmortization', 'DepreciationAmortizationAndAccretionNet', 'Depreciation'],
  ocf: ['NetCashProvidedByUsedInOperatingActivities'],
  capex: ['PaymentsToAcquirePropertyPlantAndEquipment', 'PaymentsToAcquireProductiveAssets'],
};
export const US_INSTANT = {
  equity: ['StockholdersEquity', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest'],
  debt: ['LongTermDebt', 'LongTermDebtNoncurrent', 'LongTermDebtAndCapitalLeaseObligations'],
  cash: ['CashAndCashEquivalentsAtCarryingValue', 'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents'],
};

/** 쓸 기간 — 연간은 5월부터 전년도(대부분 공시 완료), 재무상태는 분기말 뒤 75일 지난 가장 최근 분기(+ 그 회계연도 4분기말) */
export function secPeriods(now = new Date()) {
  const y = now.getUTCFullYear();
  const fy = now.getUTCMonth() >= 4 ? y - 1 : y - 2;
  const ends = [];
  for (let yy = y; yy >= y - 2; yy--) for (let q = 4; q >= 1; q--) ends.push({ yy, q, end: Date.UTC(yy, q * 3, 0) });
  const latest = ends.find(x => now.getTime() - x.end >= 75 * 86400e3);
  const inst = [`CY${latest.yy}Q${latest.q}I`];
  if (!(latest.yy === fy && latest.q === 4)) inst.push(`CY${fy}Q4I`);
  return { fy, cur: `CY${fy}`, prev: `CY${fy - 1}`, inst };
}

/** 우선순위 순서의 frames 응답들 → cik별 첫 값 */
export function mergeFrames(frames, ciks) {
  const out = new Map();
  for (const j of frames) {
    if (!j || !Array.isArray(j.data)) continue;
    for (const d of j.data) if (ciks.has(d.cik) && !out.has(d.cik) && Number.isFinite(d.val)) out.set(d.cik, { val: d.val, end: d.end || null });
  }
  return out;
}

/** symbols: 페이지 표기 티커(BRK.B 등) 목록 */
export async function buildUsFundamentals({ symbols, fetchImpl = (...a) => fetch(...a), now = new Date() }) {
  const secJson = async url => {
    const r = await fetchImpl(url, { headers: { 'User-Agent': SEC_UA, Accept: 'application/json' }, signal: AbortSignal.timeout(40000) });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`SEC HTTP ${r.status}`);
    return r.json();
  };
  const tickers = await secJson(SEC_TICKERS_URL);
  if (!tickers) throw new Error('SEC 티커 목록을 받지 못했습니다');
  const cikOf = new Map(Object.values(tickers).map(t => [String(t.ticker).toUpperCase(), Number(t.cik_str)]));
  const symCik = {};
  for (const s of symbols) { const c = cikOf.get(s.replace('.', '-')) ?? cikOf.get(s); if (c) symCik[s] = c; }
  const ciks = new Set(Object.values(symCik));
  const per = secPeriods(now);

  const flat = [];
  for (const [key, list] of Object.entries(US_DURATION)) {
    for (const [slot, period] of [['cur', per.cur], ['prev', per.prev]]) list.forEach(concept => flat.push({ id: `${key}.${slot}`, concept, period }));
  }
  for (const [key, list] of Object.entries(US_INSTANT)) {
    per.inst.forEach(period => list.forEach(concept => flat.push({ id: `${key}.inst`, concept, period })));   // 최근 분기 먼저
  }
  let failures = 0;
  const got = await runPool(flat, 4, async x => {
    try { return await secJson(secFrameUrl(x.concept, 'USD', x.period)); } catch { failures++; return null; }
  });
  const grouped = new Map();
  flat.forEach((x, i) => { if (!grouped.has(x.id)) grouped.set(x.id, []); grouped.get(x.id).push(got[i]); });
  const vals = Object.fromEntries([...grouped].map(([id, frames]) => [id, mergeFrames(frames, ciks)]));
  const pick = (id, cik) => { const v = vals[id] && vals[id].get(cik); return v ? v.val : null; };

  const bySymbol = {};
  for (const [s, cik] of Object.entries(symCik)) {
    const f = {
      cik, rev: pick('revenue.cur', cik), rev0: pick('revenue.prev', cik), ni: pick('netIncome.cur', cik), ni0: pick('netIncome.prev', cik),
      oi: pick('opIncome.cur', cik), da: pick('da.cur', cik), ocf: pick('ocf.cur', cik), capex: pick('capex.cur', cik),
      equity: pick('equity.inst', cik), debt: pick('debt.inst', cik), cash: pick('cash.inst', cik),
      fyEnd: ((vals['netIncome.cur'] && vals['netIncome.cur'].get(cik)) || {}).end || null,
    };
    if (f.ni == null && f.rev == null && f.equity == null) continue;
    bySymbol[s] = f;
  }
  if (!Object.keys(bySymbol).length) throw new Error(`SEC 재무 데이터를 한 건도 받지 못했습니다(요청 실패 ${failures}건)`);
  return { market: 'US', builtAt: now.toISOString(), source: 'SEC EDGAR XBRL frames', periods: per, requested: symbols.length, count: Object.keys(bySymbol).length, failures, bySymbol };
}

// ── 국내(네이버) ──────────────────────────────────────────────
const naverNum = v => {
  if (v == null) return null;
  const s = String(v).replace(/[,배원%\s]/g, '');
  if (s === '' || s === '-' || s === 'N/A') return null;
  const x = Number(s);
  return Number.isFinite(x) ? x : null;
};

/** 연간 재무 → 최근 실적 연도·직전 연도·컨센서스(E) 값(억원, 비율은 %) */
export function parseNaverAnnual(json) {
  const info = json && json.financeInfo;
  if (!info) return null;
  const cols = info.trTitleList || [];
  const actual = cols.filter(c => c.isConsensus !== 'Y').map(c => c.key).sort();
  const cns = cols.filter(c => c.isConsensus === 'Y').map(c => c.key).sort();
  const last = actual[actual.length - 1], prev = actual[actual.length - 2], fwd = cns[0];
  const row = t => (info.rowList || []).find(r => r.title === t);
  const val = (t, k) => { const r = row(t); return r && k && r.columns && r.columns[k] ? naverNum(r.columns[k].value) : null; };
  return {
    fy: last || null, fwdKey: fwd || null,
    rev: val('매출액', last), rev0: val('매출액', prev), revFwd: val('매출액', fwd),
    oi: val('영업이익', last), oi0: val('영업이익', prev), oiFwd: val('영업이익', fwd),
    ni: val('지배주주순이익', last) ?? val('당기순이익', last), ni0: val('지배주주순이익', prev) ?? val('당기순이익', prev), niFwd: val('당기순이익', fwd),
    opm: val('영업이익률', last), roe: val('ROE', last), debtRatio: val('부채비율', last), dps: val('주당배당금', last),
  };
}

/** 종목 정보 → PER·PBR(최근 4분기)·추정 PER·BPS·배당수익률·52주 범위·업종 코드 */
export function parseNaverIntegration(json) {
  const m = {};
  ((json && json.totalInfos) || []).forEach(x => { m[x.code] = x.value; });
  return {
    per: naverNum(m.per), eps: naverNum(m.eps), cnsPer: naverNum(m.cnsPer), cnsEps: naverNum(m.cnsEps),
    pbr: naverNum(m.pbr), bps: naverNum(m.bps), divYield: naverNum(m.dividendYieldRatio),
    high52: naverNum(m.highPriceOf52Weeks), low52: naverNum(m.lowPriceOf52Weeks),
    industryCode: json && json.industryCode != null ? Number(json.industryCode) : null,
  };
}

// 네이버 업종 → GICS 섹터(미국 지수와 같은 섹터 이름·경기민감도를 쓰기 위해). 위에서부터 먼저 맞는 규칙
export const KR_SECTOR_RULES = [
  [/유틸리티|전력|가스공사|지역난방/, '유틸리티'],
  [/은행|증권|보험|카드|창업투자|금융|손해|생명|저축/, '금융'],
  [/제약|바이오|생명과학|건강관리|의료/, '헬스케어'],
  [/반도체|디스플레이|IT서비스|소프트웨어|컴퓨터|핸드셋|통신장비|전자장비|전자제품|전자부품|사무용|전기장비/, '정보기술'],
  [/양방향미디어|미디어|엔터|방송|광고|게임|인터넷|출판|통신서비스|무선통신|다각화된통신/, '커뮤니케이션'],
  [/식품|음료|담배|생활용품|화장품|가정용품|식품과기본식료품|농산물/, '필수소비재'],
  [/자동차|호텔|레저|섬유|의류|백화점|판매|교육|가구|가정용기기|레저용|소매|전문소매|유통/, '경기소비재'],
  [/석유|에너지|정유/, '에너지'],
  [/화학|철강|비철|금속|종이|목재|포장재|건축자재|광물|소재/, '소재'],
  [/조선|기계|전기제품|건설|항공|운송|해운|방산|우주|상사|복합기업|무역|도로|철도|상업서비스|인프라|건축제품|판매업체/, '산업재'],
  [/부동산|리츠/, '부동산'],
];
export function krSectorOf(industry) {
  if (!industry) return '기타';
  const hit = KR_SECTOR_RULES.find(([re]) => re.test(industry));
  return hit ? hit[1] : '기타';
}

/** codes: 종목 코드 목록(코스피·코스닥 시가총액 상위) */
export async function buildKrFundamentals({ codes, fetchImpl = (...a) => fetch(...a), now = new Date() }) {
  const H = { 'User-Agent': UA, Accept: 'application/json', Referer: 'https://m.stock.naver.com/' };
  const getJson = async url => {
    const r = await fetchImpl(url, { headers: H, signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error(`naver HTTP ${r.status}`);
    return r.json();
  };
  const industries = {};
  for (const page of [1, 2]) {
    try { ((await getJson(`https://m.stock.naver.com/api/stocks/industry?page=${page}&pageSize=100`)).groups || []).forEach(g => { industries[g.no] = g.name; }); } catch { /* 업종 이름 없이 진행 */ }
  }
  let failures = 0;
  const bySymbol = {};
  await runPool(codes, 6, async code => {
    try {
      const [ig, fa] = await Promise.all([
        getJson(`https://m.stock.naver.com/api/stock/${code}/integration`),
        getJson(`https://m.stock.naver.com/api/stock/${code}/finance/annual`).catch(() => null),
      ]);
      const a = parseNaverIntegration(ig);
      const b = (fa && parseNaverAnnual(fa)) || {};
      const industry = a.industryCode != null ? industries[a.industryCode] || null : null;
      bySymbol[code] = { ...a, ...b, industry, sector: krSectorOf(industry) };
    } catch { failures++; }
  });
  if (!Object.keys(bySymbol).length) throw new Error(`네이버 재무 데이터를 한 건도 받지 못했습니다(실패 ${failures}건)`);
  return { market: 'KR', builtAt: now.toISOString(), source: '네이버 금융(종목 정보·연간 재무·컨센서스)', requested: codes.length, count: Object.keys(bySymbol).length, failures, industries, bySymbol };
}
