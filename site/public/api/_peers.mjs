// 진가 유사 종목 추천 — 검색한 종목과 같은 테마(업종)에서 「비슷하되 추천할 만한」 종목 TOP 5 고르기
// 순수 계산(네트워크 없음) — api/_peers-api.mjs 가 시세(_market.mjs)·재무(_fundamentals.mjs)·분석(_analysis.mjs) 결과를 넣어 부릅니다.
// 국내는 네이버 업종 이름, 미국은 GICS 세부 업종(S&P 500 목록)을 같은 테마로 이어 붙여 국내·미국을 섞어 추천합니다(예: 삼성전자 → SK하이닉스·마이크론).

/** 테마 — kr: 네이버 업종 이름, us: 미국 업종 이름. 위에서부터 먼저 맞는 규칙이 이깁니다.
 *  미국 업종은 두 가지 표기를 같이 받습니다 — 지수 구성종목은 GICS 세부 업종(예: Semiconductors),
 *  그 밖의 전 종목은 나스닥 스크리너 업종(예: Biotechnology: Pharmaceutical Preparations · Major Banks · EDP Services). */
export const THEMES = [
  { key: 'semi', label: '반도체', kr: /반도체|디스플레이패널|디스플레이장비/, us: /Semiconductor/i },
  { key: 'hw', label: '전자·하드웨어', kr: /전자장비와기기|전자제품|통신장비|컴퓨터와주변기기|핸드셋|사무용전자제품/,
    us: /Technology Hardware|Electronic (Equipment|Components|Manufacturing|Instruments)|Electronics Distribution|Technology Distributors|(Tele)?[Cc]ommunications Equipment|Computer (peripheral|Manufacturing|Communications)|Consumer Electronics(?!\/Video)|Precision Instruments|Office Equipment|professional and commerical equipment/i },
  { key: 'sw', label: '소프트웨어·IT서비스', kr: /소프트웨어|IT서비스/,
    us: /Software|IT Consulting|Internet Services|Data Processing|EDP Services|Computer Services/i },
  { key: 'game', label: '게임', kr: /게임엔터테인먼트/, us: /Interactive Home Entertainment/i },
  { key: 'net', label: '인터넷·미디어·광고', kr: /양방향미디어와서비스|광고|출판|방송과엔터테인먼트/,
    us: /Interactive Media|Advertising|Publishing|Newspapers|Magazines|Books|Movies|Broadcasting|Cable|Satellite|Entertainment/i },
  { key: 'auto', label: '자동차·부품', kr: /^자동차$|자동차부품/,
    us: /Automobile|Automotive|Auto (Manufacturing|Parts|& Home)|Motor Vehicles|Tires/i },
  { key: 'battery', label: '전기장비·2차전지', kr: /전기장비|전기제품/, us: /Electrical (Components|Products|Equipment)|Heavy Electrical|Batter/i },
  { key: 'medtech', label: '의료기기·헬스케어서비스', kr: /건강관리장비와용품|건강관리업체및서비스|건강관리기술/,
    us: /Health Care (Equipment|Supplies|Providers|Services|Facilities|Distributors|Technology|REIT)|Managed Health Care|Medical\/Dental|Medical Special|Medical Electronics|Medical\/Nursing|Hospital\/Nursing|Electromedical|Laboratory Analytical|In Vitro & In Vivo|Diagnostic|Ophthalmic|Misc Health/i },
  { key: 'pharma', label: '제약·바이오', kr: /제약|생물공학|생명과학도구및서비스/,
    us: /Pharmaceutical|Biotechnolog|Biological Products|Medicinal Chemicals|Life Sciences/i },
  { key: 'insure', label: '보험', kr: /손해보험|생명보험/, us: /Insurance|Insurers|Reinsurance/i },
  { key: 'broker', label: '증권·자산운용', kr: /증권|기타금융|창업투자/,
    us: /Capital Markets|Asset Management|Investment (Bank|Manager)|Financial Exchange|Diversified Financial|Finance\/Investors|Brokers?\b|Brokerage|Trusts Except|Rental\/Leasing|Corporate Leasing/i },
  { key: 'bank', label: '은행', kr: /은행/, us: /Banks?\b|Thrifts|Savings Institutions/i },
  { key: 'card', label: '카드·결제', kr: /카드/, us: /Consumer Finance|Transaction & Payment|Finance: Consumer Services|Finance Companies/i },
  { key: 'chem', label: '화학·소재', kr: /화학|포장재|종이와목재|건축자재/,
    us: /Chemicals|Industrial (Specialties|Gases)|Paints|Coatings|Plastic|Containers|Packaging|Paper|Forest Products|Fertilizers|Building (Products|Materials)(?!.*RETAIL)|Construction Materials/i },
  { key: 'steel', label: '철강·비철금속', kr: /철강|비철금속/,
    us: /Steel|Iron Ore|Aluminum|Copper|Gold|Precious Metals|Metal (Mining|Fabrications)|Metals and Minerals|Mining & Quarrying|Diversified Metals/i },
  { key: 'energy', label: '정유·에너지', kr: /석유와가스|에너지장비및서비스/,
    us: /Oil ?[&/]? ?(and )?Gas|Oilfield|Integrated oil|Oil Refining|Energy Equipment|Coal/i },
  { key: 'util', label: '유틸리티', kr: /전기유틸리티|가스유틸리티|복합유틸리티/,
    us: /Utilities|Water (Supply|Utilities)|Natural Gas Distribution|Power Generation|Independent Power/i },
  { key: 'telco', label: '통신서비스', kr: /무선통신서비스|다각화된통신서비스/, us: /Telecommunication/i },
  { key: 'defense', label: '항공우주·방산', kr: /우주항공과국방/, us: /Aerospace|Military\/Government|Ordnance/i },
  { key: 'machine', label: '기계·복합기업', kr: /기계|건축제품|복합기업/,
    us: /Machinery|Industrial Conglomerates|Trading Companies|Multi-Sector|Miscellaneous manufacturing|Fluid Controls|Tools\/Hardware|Pollution Control|Construction\/Ag Equipment|Durable Goods/i },
  { key: 'ship', label: '조선·해운', kr: /조선|해운사/, us: /Marine|Shipbuilding/i },
  { key: 'construct', label: '건설·인프라', kr: /건설|운송인프라|도로와철도운송/,
    us: /Construction & Engineering|Engineering & Construction|Homebuilding|Bldg Contractors|Line Construction|Highways|Rail/i },
  { key: 'air', label: '항공·물류', kr: /항공사|항공화물운송과물류/,
    us: /Airlines|Air Freight|Cargo|Trucking|Freight|Logistics|Transportation Services|Ground Transportation|Other Transportation/i },
  { key: 'retail', label: '유통·소매', kr: /백화점과일반상점|전문소매|식품과기본식료품소매|판매업체|다각화된소비자서비스|인터넷과카탈로그소매/,
    us: /Retail|Stores|Distributors|Distribution|Food Chains|Wholesale|Consumer Staples Merchandise|Catalog/i },
  { key: 'food', label: '음식료·담배', kr: /^식품$|음료|담배|농산물/,
    us: /Packaged Foods|Specialty Foods|Beverages|Tobacco|Agricultural Products|Farming|Meat\/Poultry|Brewers|Distillers|Soft Drinks/i },
  { key: 'consumer', label: '화장품·생활용품·의류', kr: /화장품|가정용품|섬유,의류,신발,호화품|가구|가정용기기와용품/,
    us: /Personal Care|Household (Products|Durables)|Package Goods\/Cosmetics|Apparel|Garments|Textiles|Shoe|Footwear|Luxury|Home Furnishings|Consumer Specialties|Leisure Products/i },
  { key: 'hotel', label: '호텔·레저·외식', kr: /호텔,레스토랑,레저|레저용장비와제품/,
    us: /Hotels|Restaurants|Leisure|Casinos|Resorts|Amusement & Recreation|Recreational Games|Consumer Services/i },
  { key: 'realestate', label: '부동산·리츠', kr: /부동산/, us: /Real Estate|REIT|Building operators/i },
  { key: 'edu', label: '교육', kr: /교육서비스/, us: /Education/i },
  { key: 'service', label: '상업서비스', kr: /상업서비스와공급품|무역회사와판매업체|문구류/,
    us: /Commercial Services|Business Services|Professional Services|Research & Consulting|Human Resource|Environmental|Support Services/i },
  { key: 'spac', label: '기업인수목적(SPAC)', kr: /기업인수목적/, us: /Blank Check/i },
];

/** row: { market, industry(국내 네이버 업종), sub(미국 GICS 세부 업종) } → { key, label } | null */
export function themeOf(row) {
  const text = row && (row.market === 'KR' ? row.industry : row.sub);
  if (!text) return null;
  const hit = THEMES.find(t => (row.market === 'KR' ? t.kr : t.us).test(text));
  return hit ? { key: hit.key, label: hit.label } : null;
}

// 국내에서 흔히 부르는 미국 종목 이름 → 티커(「마이크론」처럼 한글로 찾을 때)
export const US_ALIAS = {
  애플: 'AAPL', 마이크로소프트: 'MSFT', 엔비디아: 'NVDA', 아마존: 'AMZN', 알파벳: 'GOOGL', 구글: 'GOOGL', 메타: 'META', 페이스북: 'META',
  테슬라: 'TSLA', 마이크론: 'MU', 인텔: 'INTC', 브로드컴: 'AVGO', 퀄컴: 'QCOM', 넷플릭스: 'NFLX', 오라클: 'ORCL', 세일즈포스: 'CRM', 어도비: 'ADBE',
  에이엠디: 'AMD', 램리서치: 'LRCX', 어플라이드머티리얼즈: 'AMAT', 텍사스인스트루먼트: 'TXN', 시스코: 'CSCO', 아이비엠: 'IBM', 팔란티어: 'PLTR',
  코카콜라: 'KO', 펩시: 'PEP', 펩시코: 'PEP', 맥도날드: 'MCD', 스타벅스: 'SBUX', 나이키: 'NKE', 월마트: 'WMT', 코스트코: 'COST', 홈디포: 'HD',
  존슨앤존슨: 'JNJ', 화이자: 'PFE', 머크: 'MRK', 일라이릴리: 'LLY', 애브비: 'ABBV', 유나이티드헬스: 'UNH',
  버크셔: 'BRK.B', 제이피모간: 'JPM', 뱅크오브아메리카: 'BAC', 비자: 'V', 마스터카드: 'MA', 골드만삭스: 'GS',
  보잉: 'BA', 캐터필러: 'CAT', 록히드마틴: 'LMT', 엑슨모빌: 'XOM', 셰브론: 'CVX', 디즈니: 'DIS',
  소니: 'SONY', 도요타: 'TM', 토요타: 'TM', 알리바바: 'BABA', 티에스엠씨: 'TSM', 타이완반도체: 'TSM', 에이에스엠엘: 'ASML',
  로켓랩: 'RKLB', 팔로알토: 'PANW', 크라우드스트라이크: 'CRWD', 스노우플레이크: 'SNOW', 코인베이스: 'COIN', 로블록스: 'RBLX',
  유니티: 'U', 우버: 'UBER', 에어비앤비: 'ABNB', 스타벅스코리아: 'SBUX', 노보노디스크: 'NVO', 아스트라제네카: 'AZN',
  버티브: 'VRT', 마이크로스트래티지: 'MSTR', 리비안: 'RIVN', 루시드: 'LCID', 제너럴모터스: 'GM', 포드: 'F',
};

export const normKey = s => String(s || '').toLowerCase().replace(/[\s.,'()\-&]/g, '');

/** 검색어와 가까운 종목 — universe: [{ s, n, market, sec, industry, sub, cap }] */
export function searchStocks(universe, query, limit = 8) {
  const raw = String(query || '').trim();
  if (!raw) return [];
  const q = normKey(raw);
  const alias = US_ALIAS[raw.replace(/\s/g, '')] || US_ALIAS[raw.toUpperCase()] || null;
  const out = [];
  for (const row of universe) {
    const sym = normKey(row.s), name = normKey(row.n);
    let sc = -1;
    if (alias && row.s === alias) sc = 105;
    else if (sym === q) sc = 100;
    else if (name === q) sc = 95;
    else if (name.startsWith(q)) sc = 90 - Math.min(8, name.length - q.length) * 0.5;
    else if (q.length >= 2 && name.includes(q)) sc = 80 - Math.min(10, name.length - q.length) * 0.3;
    else if (q.length >= 2 && sym.startsWith(q)) sc = 75;
    if (sc < 0) continue;
    out.push({ row, sc: sc + Math.min(4, Math.log10(Math.max(row.cap || 1, 1)) / 4) });   // 같은 점수면 큰 종목 먼저
  }
  out.sort((a, b) => b.sc - a.sc);
  return out.slice(0, limit).map(x => x.row);
}

const isNum = v => typeof v === 'number' && Number.isFinite(v);

/** 추천 점수 — 진가 점수에 기대 상승여력을 더하고, 신뢰도 낮음·일회성 영향은 감점
    적정가가 상한(현재가 2배)에 걸린 종목(clamped)은 기대 상승여력이 서로 똑같이 나와 순위에 쓰지 않음 */
export function peerScore(row) {
  if (!isNum(row.score)) return null;
  let v = row.score;
  if (isNum(row.expUpside) && !row.clamped) v += Math.max(-8, Math.min(10, row.expUpside * 20));
  if (row.confidence === '낮음') v -= 5;
  if (row.oneOff) v -= 3;
  return Math.round(v * 10) / 10;
}

const pct = v => `${v > 0 ? '+' : ''}${(v * 100).toFixed(1)}%`;

/** 추천 이유 — 기준 종목과 비교해 눈에 띄는 점 */
export function whyPeer(row, target) {
  const out = [row.tier === 'theme' ? `같은 테마 ${row.theme.label}` : `같은 섹터 ${row.sec}`];
  if (row.market !== target.market) out.push(row.market === 'US' ? '미국 상장' : '국내 상장');
  if (isNum(row.expUpside) && !row.clamped) out.push(`기대 상승여력 ${pct(row.expUpside)}`);
  else if (row.clamped) out.push('적정가 상한 적용(상승여력 비교 제외)');
  const m = row.metrics || {}, tm = target.metrics || {};
  if (isNum(m.per) && isNum(tm.per) && m.per < tm.per * 0.85) out.push(`PER ${m.per.toFixed(1)}배(기준 ${tm.per.toFixed(1)}배)`);
  if (isNum(m.niG) && isNum(tm.niG) && m.niG > tm.niG) out.push(`이익 성장 ${pct(m.niG)}`);
  if (isNum(m.roe) && m.roe >= 0.15) out.push(`ROE ${(m.roe * 100).toFixed(0)}%`);
  if (row.confidence === '낮음') out.push('적정가 신뢰도 낮음');
  if (row.oneOff) out.push('일회성·인수합병 영향 가능');
  return out.slice(0, 5);
}

/**
 * 기준 종목과 같은 테마(없으면 같은 섹터)에서 추천 TOP — 국내·미국을 섞어 줌
 * target: universe 행(분석 결과 포함) · candidates: 나머지 전체
 * → [{ …row, tier: 'theme'|'sector', rec, why:[] }]
 */
export function rankPeers(target, candidates, { limit = 5, minOther = 2 } = {}) {
  const th = target.theme && target.theme.key;
  const pool = [];
  for (const row of candidates) {
    if (row.s === target.s && row.market === target.market) continue;
    if (row.na || !isNum(row.score)) continue;
    const sameTheme = !!(th && row.theme && row.theme.key === th);
    const sameSector = !!(row.sec && row.sec === target.sec);
    if (!sameTheme && !sameSector) continue;
    const rec = peerScore(row);
    if (rec == null) continue;
    pool.push({ ...row, tier: sameTheme ? 'theme' : 'sector', rec });
  }
  const order = (a, b) => (a.tier === b.tier ? 0 : a.tier === 'theme' ? -1 : 1) || b.rec - a.rec;
  pool.sort(order);
  const picked = pool.slice(0, limit);
  // 다른 시장(국내↔미국) 종목이 minOther 개 미만이면, 뒤쪽 같은 시장 종목을 다른 시장 상위와 바꿈
  const other = pool.filter(r => r.market !== target.market);
  for (const cand of other) {
    if (picked.filter(r => r.market !== target.market).length >= minOther) break;
    if (picked.includes(cand)) continue;
    const drop = picked.map((r, idx) => ({ r, idx })).filter(x => x.r.market === target.market).pop();
    if (!drop) break;
    picked[drop.idx] = cand;
  }
  picked.sort(order);
  return picked.map(r => ({ ...r, why: whyPeer(r, target) }));
}
