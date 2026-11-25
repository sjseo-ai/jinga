// ⚠ 이 파일은 `npm run build:decision` 이 `scripts/` 의 원본에서 복사한 것입니다.
//   직접 고치지 마십시오 — 원본을 고치고 다시 빌드하십시오.
//   `scripts/smoke-decision.mjs` 가 원본과 다르면 테스트를 깨뜨립니다.
// 보고서 짜기 — ㉯ 계획서 T011. 숫자마다 **어느 자료에서 왔는지**를 붙여 칸을 채웁니다.
//
// 이 파일은 「무엇을 보고서에 담을지」를 정하고, `_report.mjs` 의 claim() 으로 담습니다.
// claim() 은 출처가 없으면 던지므로, 여기서 출처를 빠뜨리면 **보고서가 만들어지지 않습니다.**
//
// ── 아직 정해지지 않은 것 ────────────────────────────────────────────────────
// 계획서는 T011 이 T008(요구사항 동결)에 걸려 있다고 적어 두었고, T008 은 고객 인터뷰 20건을
// 기다립니다. 그래서 **어떤 칸을 담을지는 아직 확정이 아닙니다.** 다만 합격 기준
// (「출처 없는 주장이 없다」)은 칸 목록과 무관하므로, 그 기계장치를 먼저 세웁니다.
// 인터뷰가 끝나면 SECTION_PLAN 의 칸만 갈아 끼우면 됩니다 — 출처 규칙은 그대로 갑니다.
//
// 출처 문구는 **자료 파일이 스스로 적어 둔 source 를 그대로 가져옵니다.** 여기서 다시 쓰지 않습니다 —
// 두 군데 적으면 한쪽만 고쳐지고, 그때 보고서가 거짓말을 하게 됩니다.
import { claim, validateReport, sourceList, basisCounts } from './jinga-report.mjs';

const KRW = v => Math.round(Number(v) || 0);
const pct = v => Math.round((Number(v) || 0) * 1000) / 10;
const ymKr = ym => (String(ym || '').length === 6 ? `${String(ym).slice(0, 4)}년 ${Number(String(ym).slice(4, 6))}월` : String(ym || ''));

/**
 * 규칙집의 한 규칙 → 출처 문구. 규칙이 스스로 들고 있는 sources 를 씁니다.
 * sources 가 비어 있으면 **null** 을 돌려줍니다 — 「출처 미기재」라고 적어 넘기면
 * 검사를 속이게 됩니다(2026-11-25 에 실제로 그랬습니다). 부르는 쪽이 가정으로 내야 합니다.
 */
export function ruleSource(rules, key) {
  const r = rules && rules.rules && rules.rules[key];
  if (!r) return null;
  const urls = (r.sources || []).filter(Boolean);
  if (!urls.length) return null;
  const label = r.label || key;
  return `${label} — ${urls.join(' · ')} (규칙집 ${rules.version} 기준 ${rules.asOf})`;
}

/**
 * 규칙으로 셈한 금액 한 줄. **출처가 있으면 법계산, 없으면 가정**으로 냅니다.
 * 출처 없는 숫자를 「법·규칙 계산」으로 적는 것이 가장 위험합니다 — 근거가 있는 것처럼 읽힙니다.
 */
function ruleClaim({ label, value, rules, ruleKey, note = '' }) {
  const r = (rules.rules && rules.rules[ruleKey]) || null;
  const src = ruleSource(rules, ruleKey);
  if (src) {
    return claim({
      label, value: KRW(value), unit: '원', basis: 'official', source: src,
      confidence: r && r.confidence ? r.confidence : null,
      note: note || (r && r.warn) || '',
    });
  }
  return claim({
    label: `${label}(가정)`, value: KRW(value), unit: '원', basis: 'assumption',
    source: `규칙집 ${rules.version} 의 기본값 — 법령·고시 출처를 아직 달지 못했습니다. 실제 견적으로 바꿔 쓰십시오`,
    confidence: 'uncertain',
    note: `가정값입니다. ${note || (r && r.warn) || ''}`.trim(),
  });
}

/**
 * ① 요약 — 무엇을 보고 있는지. 단지 이름·주소는 공식 단지목록에서 온 사실입니다.
 */
function sectionSummary({ complex, area, index }) {
  const claims = [];
  // 단지 이름에 「…1단지」처럼 숫자가 들어갑니다. 우리가 셈한 숫자가 아니라 출처가 그렇게
  // 적어 둔 이름이므로 quoted 로 올립니다(값 없이, 공공 신고값으로만 허용되는 좁은 예외).
  claims.push(claim({
    label: `${complex.name} ${complex.gu} ${complex.dong}`,
    basis: 'fact', quoted: true,
    source: index.source,
    note: '단지 이름·소재지',
  }));
  claims.push(claim({
    label: '전용면적', value: area.m2, unit: '㎡',
    basis: 'fact', source: index.source,
  }));
  return { key: 'summary', title: '① 무엇을 보고 있나', claims };
}

/**
 * ② 추정 시세 — **여기가 가장 조심할 칸입니다.** 추정값이므로 기준월·표본수·등급·범위를
 * 한 줄도 빼지 않고 함께 냅니다. 등급 D 는 대표값을 내지 않으므로 범위만 적습니다.
 */
function sectionPrice({ area, index, model }) {
  const claims = [];
  const asOf = ymKr(index.asOfYM);
  if (area.amt != null) {
    claims.push(claim({
      label: '추정 시세(대표값)', value: KRW(area.amt * 1e4), unit: '원',
      basis: 'estimate', asOf, source: index.source,
      note: '실거래가가 아니라 진가의 추정치입니다',
      extra: { grade: area.g, model },
    }));
  } else {
    claims.push(claim({
      label: '추정 시세 — 등급 D 라 대표값을 내지 않습니다', basis: 'estimate', asOf,
      source: index.source, note: '표본이 적어 한 숫자로 말하지 않고 범위만 냅니다',
    }));
  }
  claims.push(claim({
    label: '추정 범위 아래', value: KRW(area.lo * 1e4), unit: '원',
    basis: 'estimate', asOf, source: index.source, extra: { grade: area.g },
  }));
  claims.push(claim({
    label: '추정 범위 위', value: KRW(area.hi * 1e4), unit: '원',
    basis: 'estimate', asOf, source: index.source, extra: { grade: area.g },
  }));
  claims.push(claim({
    label: '쓰인 실거래 건수', value: area.n, unit: '건',
    basis: 'fact', source: index.source, asOf,
  }));
  claims.push(claim({
    label: `등급 ${area.g}`, basis: 'estimate', asOf,
    source: `${index.source} · 등급·범위 산정 근거는 ${model}`,
    note: '표본 수와 최근성으로 매긴 등급입니다',
  }));
  if (area.last) {
    claims.push(claim({
      label: '가장 최근 거래 월', basis: 'fact', source: index.source,
      note: ymKr(area.last), asOf,
    }));
  }
  return { key: 'price', title: '② 추정 시세와 그 근거', claims };
}

/**
 * ③ 가정과 기준일 — 어떤 규칙집·어떤 입력으로 셈했는지. 이 칸이 없으면 아래 숫자들을
 * 나중에 재현할 수 없습니다.
 */
function sectionAssumptions({ finance, rules }) {
  const claims = [];
  claims.push(claim({
    label: '규칙집 기준일', basis: 'official',
    source: `data/finance-rules.json ${rules.version}`,
    note: `${rules.asOf} 기준 · 적용 ${finance.rules.ageDays}일 경과`,
    confidence: finance.rules.stale ? 'uncertain' : 'confirmed',
  }));
  for (const [label, value, unit] of [
    ['매수가(입력)', finance.input.price, '원'],
    ['보유 현금(입력)', finance.input.cash, '원'],
    ['보유 기간(입력)', finance.input.holdYears, '년'],
  ]) {
    claims.push(claim({ label, value: KRW(value), unit, basis: 'fact', source: '이용자 입력값' }));
  }
  return { key: 'assumptions', title: '③ 가정과 기준일', claims };
}

/** ④ 취득 비용 — 규칙마다 출처와 확신도를 따로 붙입니다(출처가 엇갈리는 규칙이 있습니다) */
function sectionAcquisition({ finance, rules }) {
  const a = finance.acquisition;
  const claims = [];
  // 엔진이 항목을 items 로 내므로 **그대로** 돕니다 — 여기서 항목 목록을 다시 적으면
  // 엔진에 항목이 늘어도 보고서에는 안 나오고, 합계와 안 맞게 됩니다.
  // 지방교육세·농어촌특별세는 취득세 규칙 안에 있어 규칙 키가 겹칩니다(RULE_OF 로 이어 줍니다).
  const RULE_OF = {
    acquisitionTax: 'acquisitionTax', localEducationTax: 'acquisitionTax', ruralTax: 'acquisitionTax',
    brokerage: 'brokerage', registration: 'registration',
  };
  for (const it of a.items || []) {
    claims.push(ruleClaim({
      label: it.label || it.key, value: it.amount, rules,
      ruleKey: RULE_OF[it.key] || it.key, note: it.note || '',
    }));
  }
  claims.push(claim({
    label: '취득 비용 합계', value: KRW(a.total), unit: '원', basis: 'official',
    source: `위 항목의 합 — 규칙집 ${rules.version} 기준 ${rules.asOf}`,
  }));
  return { key: 'acquisition', title: '④ 취득할 때 드는 돈', claims };
}

/** ⑤ 대출 — 한도에 걸린 이유까지 적습니다. LTV·스트레스DSR 은 출처가 엇갈려 uncertain 입니다 */
function sectionLoan({ finance, rules }) {
  const l = finance.loanLimit, loan = finance.loan;
  const claims = [];
  claims.push(ruleClaim({
    label: '대출 한도', value: l.limit, rules, ruleKey: 'loan',
    note: l.bindingLabel ? `${l.bindingLabel}에 걸립니다` : '',
  }));
  claims.push(ruleClaim({ label: '실제 대출액', value: loan.principal, rules, ruleKey: 'loan' }));
  if (loan.firstPayment != null) {
    claims.push(claim({
      label: '첫 달 상환액', value: KRW(loan.firstPayment), unit: '원', basis: 'official',
      source: `${loan.method === 'equal' ? '원리금 균등' : loan.method === 'principal' ? '원금 균등' : '만기 일시'} 상환 공식 — 규칙집 ${rules.version}`,
      note: loan.method === 'equal' ? '매달 같습니다' : '달마다 달라집니다(첫 달 기준)',
    }));
  }
  if (loan.totalInterest != null) {
    claims.push(claim({
      label: '총 이자', value: KRW(loan.totalInterest), unit: '원', basis: 'official',
      source: `상환 일정의 이자 합 — 규칙집 ${rules.version}`,
      note: `${loan.years}년 전체 기준`,
    }));
  }
  claims.push(claim({
    label: '처음에 필요한 현금', value: KRW(finance.cashNeeded), unit: '원', basis: 'official',
    source: `매수가 + 취득비용 − 대출액 — 규칙집 ${rules.version}`,
  }));
  return { key: 'loan', title: '⑤ 대출과 필요한 현금', claims };
}

/** ⑥ 보유 비용 — 재산세·종부세는 공시가격 가정에 걸려 있으므로 그 가정을 함께 냅니다 */
function sectionHolding({ finance, rules }) {
  const h = finance.holding;
  const claims = [];
  claims.push(claim({
    label: '보유 기간 총 지출', value: KRW(finance.outflowDuringHold), unit: '원', basis: 'official',
    source: `대출 상환 + 보유세·관리비의 합 — 규칙집 ${rules.version} 기준 ${rules.asOf}`,
    note: `${finance.input.holdYears}년 기준`,
  }));
  const first = (h.rows && h.rows[0]) || null;
  if (first && first.publicPrice != null) {
    claims.push(claim({
      label: '셈에 쓴 공시가격(가정)', value: KRW(first.publicPrice), unit: '원', basis: 'assumption',
      source: '매수가 × 공시가격 비율 — 실제 공시가격을 조회한 값이 아닙니다',
      note: '가정입니다. 실제 공시가격을 넣으면 보유세가 달라집니다',
    }));
  }
  for (const [label, value, ruleKey] of [
    ['재산세(첫해)', first ? first.propertyTax : null, 'propertyTax'],
    ['종합부동산세(첫해)', first ? first.comprehensiveTax : null, 'comprehensiveTax'],
    ['관리비 등(첫해)', first ? first.maintenance : null, 'propertyTax'],
  ]) {
    if (value == null) continue;
    claims.push(ruleClaim({ label, value, rules, ruleKey }));
  }
  return { key: 'holding', title: '⑥ 가지고 있는 동안 드는 돈', claims };
}

/**
 * ⑦ 시나리오 — **전부 가정입니다.** 진가는 미래 가격을 예측하지 않습니다.
 * claim() 이 basis 'assumption' 에 「가정」이라는 글자를 요구하므로, 여기서 빼먹을 수 없습니다.
 */
function sectionScenarios({ scen, rules }) {
  const claims = [];
  const NOT_FORECAST = '예측이 아니라 가정입니다 — 진가는 미래 가격을 예측하지 않고 갈래를 나란히 보여 줍니다';
  for (const c of scen.cases || []) {
    const name = c.label || c.key;
    // 성장률을 **매도가 주장의 글에 적지 않습니다.** 검사가 「글의 숫자가 value 에서 안 나왔다」고
    // 잡아 주었습니다 — 맞는 지적입니다. 가정한 비율은 그 자체로 하나의 주장이어야 합니다.
    claims.push(claim({
      label: `${name} — 가정한 해마다 변동률`, value: c.yearlyGrowth, unit: '',
      basis: 'assumption', source: NOT_FORECAST, note: `${pct(c.yearlyGrowth)}% 로 움직인다고 가정`,
    }));
    claims.push(claim({
      label: `${name} — 가정 매도가`, value: KRW(c.sellPrice), unit: '원',
      basis: 'assumption', source: NOT_FORECAST, note: '위 변동률 가정에서 나온 값',
    }));
    if (c.proceeds != null) {
      claims.push(claim({
        label: `${name} — 세금까지 낸 뒤 손에 남는 돈(가정)`, value: KRW(c.proceeds), unit: '원',
        basis: 'assumption',
        source: `위 가정 매도가에 양도소득세 규칙을 적용 — ${ruleSource(rules, 'capitalGainsTax')}`,
        note: '가정에서 나온 값입니다',
      }));
    }
    if (c.profit != null) {
      claims.push(claim({
        label: `${name} — 투입금 대비 손익(가정)`, value: KRW(c.profit), unit: '원',
        basis: 'assumption', source: NOT_FORECAST, note: '가정에서 나온 값입니다',
      }));
    }
  }
  return { key: 'scenarios', title: '⑦ 시나리오 (전부 가정)', claims };
}

/** ⑧ 입지 — K-apt 신고값. 도보시간은 구간이고 거리로 환산하지 않습니다 */
function sectionLocation({ infra, infraSource }) {
  const claims = [];
  if (!infra) return { key: 'location', title: '⑧ 입지', claims };
  if (infra.station && infra.station.band != null) {
    // 역 이름에 「3호선」처럼 숫자가 섞인 노선명이 들어오는 경우가 있어 검사가 잡았습니다.
    // 역 이름과 노선은 **다른 주장**이므로 따로 올립니다 — 섞어 적으면 어느 쪽 출처인지도 흐려집니다.
    const BANDS = ['5분이내', '5~10분이내', '10~15분이내', '15~20분이내', '20분초과'];
    claims.push(claim({
      label: '지하철 도보 구간', basis: 'fact', source: infraSource,
      note: `${BANDS[infra.station.band]} — 구간값이라 분 단위 정밀도는 없습니다`,
      extra: { band: infra.station.band, station: infra.station.name || null, lines: infra.station.lines || [] },
    }));
    if (infra.station.name) {
      claims.push(claim({ label: '가까운 역', basis: 'fact', source: infraSource, note: `${infra.station.name}역` }));
    }
    if (infra.station.lines && infra.station.lines.length) {
      claims.push(claim({
        label: '노선 수', value: infra.station.lines.length, unit: '개',
        basis: 'fact', source: infraSource, extra: { lines: infra.station.lines },
      }));
    }
  }
  if (infra.parking && infra.parking.per != null) {
    claims.push(claim({
      label: '세대당 주차', value: infra.parking.per, unit: '대',
      basis: 'fact', source: infraSource,
    }));
  }
  if (infra.elem && infra.elem.name) {
    claims.push(claim({ label: '배정 초등학교', basis: 'fact', source: infraSource, note: infra.elem.name }));
  }
  if (infra.mid && infra.mid.name) {
    claims.push(claim({ label: '배정 중학교', basis: 'fact', source: infraSource, note: infra.mid.name }));
  }
  return { key: 'location', title: '⑧ 입지 (공공 신고값)', claims };
}

/** ⑨ 경고 — 엔진이 낸 경고를 그대로. 확신도가 낮은 규칙은 여기 모입니다 */
function sectionWarnings({ finance, rules }) {
  const claims = [];
  for (const w of finance.warnings || []) {
    const src = w.rule ? ruleSource(rules, w.rule) : null;
    claims.push(claim({
      label: `${w.label || w.rule} 주의`, basis: 'official',
      source: src || `진가 계산 엔진이 낸 경고 — 규칙집 ${rules.version} 기준 ${rules.asOf}`,
      confidence: w.confidence || null,
      note: w.message,
    }));
  }
  return { key: 'warnings', title: '⑨ 짚어 둘 것', claims };
}

/**
 * 아직 못 채우는 칸 — **빈칸을 그럴듯한 문장으로 메우지 않습니다.**
 * 왜 못 채우는지와 무엇이 있어야 채워지는지를 적습니다.
 */
export const PENDING = [
  { key: 'checklist', title: '⑩ 현장 체크리스트', why: '고객 인터뷰 20건(㉮ T006)에서 항목을 정한 뒤 넣습니다 — 우리가 짐작해서 만들 칸이 아닙니다' },
  { key: 'academy', title: '학원가', why: 'KB 자료였고 대체 공공 원천을 아직 붙이지 않았습니다' },
  { key: 'pdf', title: 'PDF 조판·출처 각주', why: '㉮ T017 — 칸 목록이 동결된 뒤 조판합니다' },
  { key: 'review', title: '사람 검수', why: '유료로 넘기기 전에는 사람이 한 번 봅니다(㉮ T018)' },
];

/**
 * 보고서 한 건. 자료를 넘기면 칸을 채우고, **검사 결과를 함께** 돌려줍니다.
 * violations 가 비어 있지 않으면 부르는 쪽이 보고서를 내보내지 않아야 합니다.
 */
export function composeReport({ complex, area, index, finance, scen = null, rules, infra = null, infraSource = null, now = new Date() }) {
  const model = index.model || 'docs/model-card.md';
  const sections = [
    sectionSummary({ complex, area, index }),
    sectionPrice({ area, index, model }),
    sectionAssumptions({ finance, rules }),
    sectionAcquisition({ finance, rules }),
    sectionLoan({ finance, rules }),
    sectionHolding({ finance, rules }),
  ];
  if (scen) sections.push(sectionScenarios({ scen, rules }));
  if (infra && infraSource) sections.push(sectionLocation({ infra, infraSource }));
  sections.push(sectionWarnings({ finance, rules }));

  const report = {
    meta: {
      generatedAt: now.toISOString(),
      notice: rules.notice,
      rulesVersion: rules.version,
      rulesAsOf: rules.asOf,
      priceAsOfYM: index.asOfYM,
      model,
    },
    sections: sections.filter(s => s.claims.length),
    pending: PENDING,
  };
  report.sources = sourceList(report);
  report.counts = basisCounts(report);
  report.violations = validateReport(report);
  return report;
}
