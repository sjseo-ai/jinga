// 진가 보고서 구성 — ㉯ 계획서 T011 「출처를 따라갈 수 있는 보고서」
//   합격 기준(계획서 원문): "No unsourced AI-produced claims in final report"
//                           — 최종 보고서에 **출처 없는, 기계가 지어낸 주장이 없다**
//
// ── 어떻게 지키나 ────────────────────────────────────────────────────────────
// 「출처를 잘 달자」는 다짐으로는 못 지킵니다. 사람도 기계도 바쁘면 빠뜨립니다.
// 그래서 **구조를 바꿉니다** — 이 모듈이 만드는 보고서에는 자유 문장을 담을 자리가 없습니다.
// 보고서는 `claim`(주장) 의 목록일 뿐이고, `claim()` 은 출처가 없으면 **만들어지지 않습니다**(throw).
// 그러면 「출처 없는 문장」은 깜빡해서 새는 것이 아니라 **애초에 들어갈 데가 없습니다.**
//
// 숫자를 말로 몰래 넣는 길도 막습니다. 주장의 글(label·note)에 들어간 숫자는
// 그 주장의 value 에서 나온 것이어야 합니다(validateReport 가 검사). 그래서
// 「대치동은 학군이 좋아 3년 뒤 20% 오를 것」 같은 문장은 **구조적으로 쓸 수 없습니다.**
//
// ── 네 가지 성격(basis) ─────────────────────────────────────────────────────
//  fact        공공기관이 신고·공시한 값 그대로 (K-apt 주차, 실거래 건수)
//  official    법·규칙에 따라 계산한 값 (취득세 — 규칙집 출처와 확신도를 함께)
//  estimate    우리가 추정한 값 (J-AVM 시세 — 기준월·표본수·등급·범위를 반드시)
//  assumption  **가정** (시나리오의 미래 가격 — 예측이 아니라고 못박음)
// 성격을 섞어 적지 않습니다. 추정을 사실처럼, 가정을 추정처럼 적는 것이 이 바닥의 흔한 거짓말입니다.
//
// 이 모듈은 순수합니다 — 파일·네트워크·DOM 을 읽지 않습니다. 부르는 쪽이 자료를 넘깁니다.

/** 주장의 성격 — 화면·PDF 에 그대로 찍히는 이름입니다 */
export const BASIS = {
  fact: { key: 'fact', label: '공공 신고값', badge: 'bq-official' },
  official: { key: 'official', label: '법·규칙 계산', badge: 'bq-real' },
  estimate: { key: 'estimate', label: '추정', badge: 'bq-est' },
  assumption: { key: 'assumption', label: '가정', badge: 'bq-assume' },
};
export const BASIS_KEYS = Object.keys(BASIS);

const isNum = v => v != null && v !== '' && Number.isFinite(Number(v));
const trim = s => String(s == null ? '' : s).trim();

/**
 * 「출처가 없다」고 적어 둔 것은 출처가 아닙니다.
 *
 * 2026-11-25 에 실제로 통과했습니다 — 규칙집의 법무·등기 실비에 sources 가 비어 있어서
 * 출처 문구가 「법무·등기 실비 — 출처 미기재(규칙집 2026.11.23)」로 나갔고, 글자가 비어 있지는
 * 않으니 검사를 지나갔습니다. **빈칸을 「없음」이라고 채우면 검사를 속일 수 있습니다.**
 * 그런 값은 출처 없음으로 봅니다. 출처가 없으면 그 숫자는 사실·법계산이 아니라 **가정**입니다.
 */
export const NO_SOURCE_RE = /출처\s*(미기재|없음|불명|미상)|근거\s*없음|미확인|unknown|n\/?a$/i;
export const looksSourceless = s => !trim(s) || NO_SOURCE_RE.test(trim(s));

/**
 * 주장 하나. **출처가 없으면 만들어지지 않습니다.**
 * 던지는 쪽을 택한 이유 — 조용히 null 을 돌려주면 보고서에서 그 줄만 사라지고,
 * 「왜 안 나오지」를 한참 뒤에 알게 됩니다. 만들 때 바로 터지는 쪽이 낫습니다.
 */
export function claim({ label, value = null, unit = '', basis, source, asOf = null, note = '', confidence = null, extra = null, quoted = false }) {
  const L = trim(label);
  if (!L) throw new Error('claim: label 이 비었습니다');
  if (!BASIS[basis]) throw new Error(`claim(${L}): basis 는 ${BASIS_KEYS.join('|')} 중 하나여야 합니다 — 받은 값 ${JSON.stringify(basis)}`);
  const S = trim(source);
  if (!S) throw new Error(`claim(${L}): 출처(source)가 없습니다. 출처 없는 주장은 보고서에 넣지 않습니다`);
  // 「출처 미기재」처럼 없다고 적어 둔 것도 없는 것으로 봅니다. 그런 숫자는 가정으로 내야 합니다.
  if (looksSourceless(S) && basis !== 'assumption') {
    throw new Error(`claim(${L}): 출처가 「${S}」 입니다 — 없다고 적은 것은 출처가 아닙니다. 출처가 없으면 basis 를 assumption 으로 내십시오`);
  }
  if (basis === 'estimate' && !trim(asOf)) throw new Error(`claim(${L}): 추정값은 기준일(asOf)을 반드시 적습니다`);
  if (basis === 'assumption' && !/가정/.test(L + note)) throw new Error(`claim(${L}): 가정은 글에 「가정」이라고 적어야 합니다 — 추정으로 읽히면 안 됩니다`);
  // quoted 는 **좁은 예외**입니다 — 「강남신동아파밀리에1단지」처럼 출처가 그렇게 적어 둔 이름을
  // 그대로 옮기는 자리. 이름 속 숫자까지 「우리가 셈한 값이냐」고 물으면 이름을 쓸 수 없습니다.
  // 넓게 열리지 않도록 둘을 요구합니다: 공공 신고값(fact)이어야 하고, 셈한 값(value)이 없어야 합니다.
  // 그래서 quoted 를 붙여 숫자 검사를 피하려면 **값을 포기해야** 하고, 값이 없으면 셈한 주장이 아닙니다.
  if (quoted) {
    if (basis !== 'fact') throw new Error(`claim(${L}): quoted 는 공공 신고값(fact)에만 씁니다 — 받은 basis ${basis}`);
    if (value != null) throw new Error(`claim(${L}): quoted 에는 value 를 두지 않습니다 — 셈한 값이라면 그대로 숫자 검사를 받아야 합니다`);
  }
  return {
    label: L, value, unit: trim(unit), basis,
    basisLabel: BASIS[basis].label,
    source: S, asOf: trim(asOf) || null,
    note: trim(note), confidence: confidence || null,
    extra: extra || null,
    quoted: !!quoted,
  };
}

/** 글에서 숫자만 뽑기 — 천단위 쉼표·소수점은 한 덩어리로 봅니다 */
export function numbersIn(text) {
  return (String(text || '').match(/\d[\d,]*(?:\.\d+)?/g) || []).map(s => s.replace(/,/g, ''));
}

/**
 * 보고서 검사 — 위반을 **목록으로** 돌려줍니다(throw 하지 않음).
 * 테스트와 화면이 같은 함수를 쓰게 하려는 것입니다. 화면은 위반을 빨갛게 보여 주고,
 * 테스트는 위반이 0건이어야 통과합니다.
 */
export function validateReport(report) {
  const v = [];
  const add = (where, reason) => v.push({ where, reason });

  if (!report || !Array.isArray(report.sections)) return [{ where: '보고서', reason: 'sections 가 없습니다' }];
  if (!report.meta || !trim(report.meta.generatedAt)) add('보고서', 'meta.generatedAt 이 없습니다');
  if (!trim(report.meta && report.meta.notice)) add('보고서', '주의문(meta.notice)이 없습니다 — 자문이 아니라는 고지는 빼지 않습니다');

  for (const s of report.sections) {
    const at = trim(s.title) || '(제목 없음)';
    // 자유 문장을 담을 자리가 있으면 그 자체로 위반입니다 — 구조로 막는다는 약속이 깨집니다
    for (const banned of ['text', 'prose', 'body', 'html', 'summary']) {
      if (banned in s) add(at, `자유 문장 칸(${banned})이 있습니다 — 보고서는 주장 목록만으로 짭니다`);
    }
    if (!Array.isArray(s.claims)) { add(at, 'claims 가 배열이 아닙니다'); continue; }
    for (const c of s.claims) {
      const where = `${at} › ${trim(c.label) || '(이름 없음)'}`;
      if (!trim(c.source)) add(where, '출처가 없습니다');
      else if (looksSourceless(c.source) && c.basis !== 'assumption') add(where, `출처가 「${c.source}」 입니다 — 없다고 적은 것은 출처가 아닙니다(가정으로 내십시오)`);
      if (!BASIS[c.basis]) add(where, `성격(basis)이 이상합니다: ${JSON.stringify(c.basis)}`);
      if (c.basis === 'estimate' && !trim(c.asOf)) add(where, '추정값인데 기준일이 없습니다');
      if (c.basis === 'assumption' && !/가정/.test(trim(c.label) + trim(c.note))) add(where, '가정인데 「가정」이라고 적혀 있지 않습니다');
      if (c.quoted) {
        // 좁은 예외라는 조건을 여기서도 확인합니다 — claim() 을 거치지 않고 손으로 엮은 보고서도 걸러야 합니다
        if (c.basis !== 'fact') add(where, 'quoted 는 공공 신고값(fact)에만 씁니다');
        if (isNum(c.value)) add(where, 'quoted 에 셈한 값(value)이 있습니다 — 값이 있으면 숫자 검사를 받아야 합니다');
        continue;
      }
      // 글에 적힌 숫자가 value 에서 나온 것인지 — 말로 숫자를 몰래 넣는 길을 막습니다
      const own = new Set();
      if (isNum(c.value)) {
        const n = Number(c.value);
        own.add(String(n));
        own.add(String(Math.round(n)));
        own.add(String(Math.abs(Math.round(n))));
        for (const d of [1, 2]) own.add(n.toFixed(d));
        for (const unitDiv of [1e4, 1e8]) {            // 만원·억원으로 적는 경우
          own.add(String(Math.round(n / unitDiv)));
          own.add((n / unitDiv).toFixed(1));
          own.add((n / unitDiv).toFixed(2));
        }
        own.add(String(Math.round(n * 100)));           // 비율을 %로 적는 경우
        own.add((n * 100).toFixed(1));
      }
      for (const got of numbersIn(c.label)) {
        if (!own.has(got)) add(where, `글의 숫자 ${got} 가 value(${c.value}) 에서 나오지 않았습니다 — 숫자는 값으로 넣고 글로 적지 않습니다`);
      }
    }
  }
  return v;
}

/** 출처를 한눈에 — 보고서에 쓰인 출처를 모아 셈합니다(각주·출처 쪽을 만들 때 씁니다) */
export function sourceList(report) {
  const by = new Map();
  for (const s of report.sections || []) {
    for (const c of s.claims || []) {
      const cur = by.get(c.source) || { source: c.source, count: 0, asOf: c.asOf, basis: new Set() };
      cur.count += 1;
      cur.basis.add(c.basis);
      if (!cur.asOf && c.asOf) cur.asOf = c.asOf;
      by.set(c.source, cur);
    }
  }
  return [...by.values()]
    .map(x => ({ ...x, basis: [...x.basis].sort() }))
    .sort((a, b) => b.count - a.count || (a.source < b.source ? -1 : 1));
}

/** 성격별 주장 수 — 「이 보고서에서 사실은 몇 줄, 가정은 몇 줄인가」 */
export function basisCounts(report) {
  const out = Object.fromEntries(BASIS_KEYS.map(k => [k, 0]));
  for (const s of report.sections || []) for (const c of s.claims || []) if (out[c.basis] != null) out[c.basis] += 1;
  return out;
}
