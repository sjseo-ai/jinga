// 출처를 따라갈 수 있는 보고서 — ㉯ 계획서 T011 합격 기준 검사
//   node --test scripts/smoke-report-source.mjs
//
// 계획서 원문: "No unsourced AI-produced claims in final report"
//
// 이 테스트가 지키려는 것은 **「출처를 잘 달았는지」가 아니라 「출처 없이는 만들 수 없는지」** 입니다.
// 그래서 통과 쪽만 보지 않고, **일부러 출처를 빼고 던져지는지**를 함께 검사합니다.
// 막는 장치는 「막혔다」고 확인해야 막힌 것입니다 — 11월에 세 번 겪었습니다(KB 가격만 보던 검사).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { claim, validateReport, sourceList, basisCounts, BASIS_KEYS, numbersIn } from './_report.mjs';
import { composeReport, ruleSource, PENDING } from './_report-compose.mjs';
import { plan, scenarios } from './_finance.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));

const RULES = read('data/finance-rules.json');
const INDEX = read('site/public/decision-index.json');

/** 실제 자료로 보고서 한 건 — 붙박이 숫자를 쓰지 않고 배포될 파일을 그대로 씁니다 */
function realReport({ withInfra = true, holdYears = 5 } = {}) {
  const complex = INDEX.complexes.find(c => c.areas.some(a => a.amt != null));
  const area = complex.areas.find(a => a.amt != null);
  const price = area.amt * 1e4;
  const input = { price, cash: price * 0.4, annualRate: 0.04, years: 30, holdYears, income: 80000000, method: 'equal' };
  const finance = plan(input, RULES);
  const scen = scenarios(input, RULES);
  let infra = null, infraSource = null;
  if (withInfra) {
    const kapt = read('site/public/kapt-seoul-infra.json');
    const v = kapt.byComplex[complex.id];
    if (v) {
      infraSource = kapt.source;
      infra = {
        station: v.sw != null || v.st ? { name: v.st || '', lines: v.lines || [], m: null, band: v.sw ?? null } : null,
        parking: v.pk != null ? { total: v.pk, per: v.pkPer ?? null } : null,
        elem: v.el ? { name: v.el[0], zone: true, m: null } : null,
        mid: v.mid ? { name: v.mid[0], zone: true, m: null } : null,
        academies: null,
      };
    }
  }
  return composeReport({ complex, area, index: INDEX, finance, scen, rules: RULES, infra, infraSource });
}

test('합격 기준 — 실제 자료로 짠 보고서에 출처 없는 주장이 0건', () => {
  const rep = realReport();
  const lines = rep.sections.reduce((s, x) => s + x.claims.length, 0);
  assert.ok(rep.sections.length >= 8, `칸이 ${rep.sections.length}개뿐입니다`);
  assert.ok(lines >= 30, `주장이 ${lines}줄뿐입니다`);
  assert.deepEqual(rep.violations, [], `위반: ${rep.violations.map(v => `${v.where} — ${v.reason}`).join(' / ')}`);
  // 한 줄도 빠짐없이 — validateReport 를 믿지 말고 여기서 다시 셉니다
  for (const s of rep.sections) {
    for (const c of s.claims) {
      assert.ok(c.source && c.source.trim(), `${s.title} › ${c.label}: 출처 없음`);
      assert.ok(BASIS_KEYS.includes(c.basis), `${s.title} › ${c.label}: basis ${c.basis}`);
    }
  }
});

test('출처를 빼면 주장이 **만들어지지 않는다**(깜빡해서 새는 길을 막음)', () => {
  assert.throws(() => claim({ label: '취득세', value: 1, basis: 'official' }), /출처/);
  assert.throws(() => claim({ label: '취득세', value: 1, basis: 'official', source: '   ' }), /출처/);
  assert.throws(() => claim({ label: '', basis: 'fact', source: 'x' }), /label/);
  assert.throws(() => claim({ label: 'x', basis: '아무거나', source: 'y' }), /basis/);
  // 추정은 기준일 없이 못 만듭니다 — 「언제 기준이냐」가 빠진 추정은 쓸 수 없습니다
  assert.throws(() => claim({ label: '추정 시세', value: 1, basis: 'estimate', source: 'y' }), /기준일/);
  // 가정은 「가정」이라고 적어야 합니다 — 추정으로 읽히면 안 됩니다
  assert.throws(() => claim({ label: '3년 뒤 매도가', value: 1, basis: 'assumption', source: 'y' }), /가정/);
  // 제대로 주면 만들어집니다
  const ok = claim({ label: '취득세', value: 27000000, unit: '원', basis: 'official', source: '규칙집' });
  assert.equal(ok.basisLabel, '법·규칙 계산');
});

test('자유 문장 칸이 있으면 위반 — 보고서는 주장 목록만으로 짠다', () => {
  const base = { meta: { generatedAt: 'now', notice: '자문이 아닙니다' }, sections: [] };
  for (const banned of ['text', 'prose', 'body', 'html', 'summary']) {
    const v = validateReport({ ...base, sections: [{ title: '요약', claims: [], [banned]: '대치동은 학군이 좋습니다' }] });
    assert.ok(v.some(x => new RegExp(banned).test(x.reason)), `${banned} 칸을 못 잡았습니다`);
  }
});

test('글에 숫자를 몰래 넣으면 위반 — 숫자는 값으로만', () => {
  const mk = label => ({
    meta: { generatedAt: 'now', notice: '자문이 아닙니다' },
    sections: [{ title: '시세', claims: [{ label, value: 500000000, unit: '원', basis: 'fact', source: '국토교통부' }] }],
  });
  // value 에서 나오는 숫자는 괜찮습니다(5억 = 500000000/1e8)
  assert.deepEqual(validateReport(mk('추정 시세 5억')), []);
  // value 와 무관한 숫자는 잡힙니다 — 이게 「3년 뒤 20% 오릅니다」를 막는 자리입니다
  const bad = validateReport(mk('3년 뒤 20% 오릅니다'));
  assert.ok(bad.length >= 1, '값에 없는 숫자를 못 잡았습니다');
  assert.match(bad[0].reason, /글의 숫자/);
  assert.deepEqual(numbersIn('3년 뒤 1,234.5원'), ['3', '1234.5']);
});

test('주의문과 생성 시각이 없으면 위반 — 고지는 빼지 않는다', () => {
  const s = [{ title: 'x', claims: [] }];
  assert.ok(validateReport({ meta: { notice: '있음' }, sections: s }).some(v => /generatedAt/.test(v.reason)));
  assert.ok(validateReport({ meta: { generatedAt: 'now' }, sections: s }).some(v => /주의문/.test(v.reason)));
  assert.ok(validateReport({ sections: s }).length >= 2);
  assert.ok(validateReport(null).length >= 1);
});

test('성격을 섞어 적지 않는다 — 추정·가정이 사실로 올라가지 않음', () => {
  const rep = realReport();
  const byKey = Object.fromEntries(rep.sections.map(s => [s.key, s]));
  // 추정 시세는 estimate 로만, 기준월을 달고
  for (const c of byKey.price.claims.filter(x => /추정/.test(x.label))) {
    assert.equal(c.basis, 'estimate', `${c.label} 이 추정이 아닙니다`);
    assert.ok(c.asOf, `${c.label} 에 기준일이 없습니다`);
  }
  // 시나리오는 한 줄도 빠짐없이 가정
  assert.ok(byKey.scenarios.claims.length >= 6);
  for (const c of byKey.scenarios.claims) {
    assert.equal(c.basis, 'assumption', `${c.label} 이 가정이 아닙니다`);
    assert.match(c.label + c.note, /가정/);
  }
  // 입지는 공공 신고값이고 출처가 K-apt 여야 합니다
  if (byKey.location) {
    for (const c of byKey.location.claims) {
      assert.equal(c.basis, 'fact');
      assert.match(c.source, /K-apt|국토교통부/);
    }
  }
  const counts = basisCounts(rep);
  assert.ok(counts.estimate >= 3 && counts.assumption >= 6 && counts.official >= 5 && counts.fact >= 3,
    `성격 분포가 치우쳤습니다: ${JSON.stringify(counts)}`);
});

test('규칙 출처는 규칙집이 들고 있는 것을 그대로 쓴다 — 두 군데 적지 않음', () => {
  for (const key of ['acquisitionTax', 'brokerage', 'propertyTax', 'loan', 'capitalGainsTax']) {
    const s = ruleSource(RULES, key);
    assert.ok(s, `${key}: 출처 문구가 비었습니다`);
    assert.ok(s.includes(RULES.version), `${key}: 규칙집 버전이 안 들어갔습니다`);
    const urls = (RULES.rules[key].sources || []).filter(Boolean);
    for (const u of urls) assert.ok(s.includes(u), `${key}: 규칙집의 출처 ${u} 가 보고서 문구에 없습니다`);
  }
  assert.equal(ruleSource(RULES, '없는규칙'), null);
});

test('확신도가 낮은 규칙은 보고서에도 낮다고 적힌다', () => {
  const rep = realReport();
  const all = rep.sections.flatMap(s => s.claims);
  // 규칙집에 uncertain 으로 적힌 규칙이 보고서에서 confirmed 로 바뀌면 안 됩니다
  const loanClaim = all.find(c => c.label === '대출 한도');
  assert.ok(loanClaim, '대출 한도 주장이 없습니다');
  assert.equal(loanClaim.confidence, RULES.rules.loan.confidence);
  assert.ok(['uncertain', 'likely', 'confirmed'].includes(loanClaim.confidence));
  // 경고 칸이 규칙의 경고를 그대로 싣는지
  const warn = rep.sections.find(s => s.key === 'warnings');
  assert.ok(warn && warn.claims.length >= 1, '경고 칸이 비었습니다');
  for (const c of warn.claims) assert.ok(c.note, `${c.label}: 경고 내용이 비었습니다`);
});

test('못 채우는 칸은 **못 채운다고** 적는다 — 빈칸을 문장으로 메우지 않음', () => {
  const rep = realReport();
  assert.ok(rep.pending.length >= 3);
  for (const p of rep.pending) {
    assert.ok(p.title && p.why, `${p.key}: 왜 못 채우는지 적혀 있어야 합니다`);
    assert.ok(p.why.length >= 10, `${p.key}: 이유가 너무 짧습니다`);
  }
  // 체크리스트는 인터뷰 전에는 짐작으로 만들지 않습니다
  const cl = rep.pending.find(p => p.key === 'checklist');
  assert.match(cl.why, /인터뷰/);
  // 못 채운 칸이 sections 에 섞여 들어가 「채운 것처럼」 보이면 안 됩니다
  const keys = new Set(rep.sections.map(s => s.key));
  for (const p of PENDING) assert.ok(!keys.has(p.key), `${p.key} 가 채운 칸에 섞여 있습니다`);
});

test('출처 목록 — 보고서에 쓰인 출처를 모아 셈한다(각주용)', () => {
  const rep = realReport();
  assert.ok(rep.sources.length >= 5, `출처가 ${rep.sources.length}종뿐입니다`);
  const total = rep.sources.reduce((s, x) => s + x.count, 0);
  assert.equal(total, rep.sections.reduce((s, x) => s + x.claims.length, 0), '출처 합계가 주장 수와 다릅니다');
  for (const s of rep.sources) {
    assert.ok(s.count >= 1 && s.basis.length >= 1);
  }
  // 실거래 추정 출처는 반드시 「추정치이며 실거래가가 아닙니다」를 달고 나갑니다
  const est = rep.sources.find(s => s.basis.includes('estimate'));
  assert.match(est.source, /추정치이며 실거래가가 아닙니다|추정/);
  assert.deepEqual(sourceList({ sections: [] }), []);
});

test('등급 D 는 보고서에서도 대표값을 내지 않는다', () => {
  const dComplex = INDEX.complexes.find(c => c.areas.some(a => a.g === 'D'));
  if (!dComplex) return;                                  // 지금 자료에 D 가 없으면 건너뜁니다
  const area = dComplex.areas.find(a => a.g === 'D');
  assert.equal(area.amt, null, '색인부터 D 는 대표값이 없어야 합니다');
  const price = (area.lo + area.hi) / 2 * 1e4;            // 셈을 돌리려고 범위 가운데를 씀
  const finance = plan({ price, cash: price * 0.5, annualRate: 0.04, years: 30, holdYears: 5, income: 80000000 }, RULES);
  const rep = composeReport({ complex: dComplex, area, index: INDEX, finance, rules: RULES });
  assert.deepEqual(rep.violations, []);
  const priceSec = rep.sections.find(s => s.key === 'price');
  const rep1 = priceSec.claims.find(c => /대표값/.test(c.label));
  assert.ok(rep1, '대표값에 관한 줄이 있어야 합니다');
  assert.match(rep1.label, /내지 않습니다/, 'D 는 대표값을 냈다고 적으면 안 됩니다');
  assert.equal(rep1.value, null);
});

test('quoted 예외는 좁다 — 숫자 검사를 피하려면 값을 포기해야 한다', () => {
  // 출처가 그렇게 적어 둔 이름은 그대로 옮길 수 있습니다
  const ok = claim({ label: '강남신동아파밀리에1단지 강남구 세곡동', basis: 'fact', quoted: true, source: '국토교통부' });
  assert.equal(ok.quoted, true);
  assert.equal(ok.value, null);
  // 그러나 값이 있으면 안 됩니다 — 값이 있으면 셈한 주장이고, 숫자 검사를 받아야 합니다
  assert.throws(() => claim({ label: '시세 3억', value: 300000000, basis: 'fact', quoted: true, source: 'x' }), /value/);
  // 추정·가정·법계산에는 쓸 수 없습니다 — 「추정 3년 뒤 20%」를 quoted 로 빠져나가는 길을 막습니다
  for (const basis of ['estimate', 'assumption', 'official']) {
    assert.throws(() => claim({ label: '3년 뒤 20%', basis, quoted: true, source: 'x', asOf: '2026-11', note: '가정' }), /fact/);
  }
  // claim() 을 거치지 않고 손으로 엮어도 검사가 잡습니다
  const hand = {
    meta: { generatedAt: 'now', notice: '자문이 아닙니다' },
    sections: [{ title: 'x', claims: [{ label: '3년 뒤 20% 오릅니다', value: 500000000, basis: 'fact', source: 'y', quoted: true }] }],
  };
  assert.ok(validateReport(hand).some(v => /quoted/.test(v.reason)), '손으로 엮은 quoted 남용을 못 잡았습니다');
});

test('「출처 미기재」는 출처가 아니다 — 빈칸을 「없음」으로 채워 검사를 속일 수 없다', async () => {
  const { looksSourceless, NO_SOURCE_RE } = await import('./_report.mjs');
  for (const s of ['출처 미기재', '출처 없음', '출처미상', '근거 없음', '미확인', 'unknown', 'N/A', '', '   ']) {
    assert.ok(looksSourceless(s), `「${s}」 를 출처로 치면 안 됩니다`);
  }
  assert.ok(!looksSourceless('국토교통부 실거래가(15126468)'));
  assert.ok(NO_SOURCE_RE instanceof RegExp);
  // 사실·법계산에는 쓸 수 없고, 가정으로는 낼 수 있습니다(모른다고 밝히는 것은 허용)
  assert.throws(() => claim({ label: '법무비', value: 1, basis: 'official', source: '출처 미기재(규칙집 x)' }), /출처가 아닙니다/);
  assert.throws(() => claim({ label: '시세', value: 1, basis: 'estimate', asOf: '2026-11', source: '미확인' }), /출처가 아닙니다/);
  const ok = claim({ label: '법무비(가정)', value: 1, basis: 'assumption', source: '출처를 아직 달지 못했습니다', note: '가정값' });
  assert.equal(ok.basis, 'assumption');
  // 손으로 엮어도 검사가 잡습니다
  const hand = {
    meta: { generatedAt: 'now', notice: '자문이 아닙니다' },
    sections: [{ title: 'x', claims: [{ label: '법무비', value: 1, basis: 'official', source: '출처 미기재' }] }],
  };
  assert.ok(validateReport(hand).some(v => /출처가 아닙니다/.test(v.reason)));
});

test('출처 없는 규칙은 법계산이 아니라 가정으로 내려간다', () => {
  // 규칙집에 sources 가 빈 규칙이 실제로 있습니다(법무·등기 실비). 그 항목이 「법·규칙 계산」으로
  // 올라가면 근거가 있는 것처럼 읽힙니다 — 2026-11-25 에 실제로 그렇게 나가고 있었습니다.
  const sourceless = Object.entries(RULES.rules).filter(([, r]) => !(r.sources || []).filter(Boolean).length);
  assert.ok(sourceless.length >= 1, '출처 없는 규칙이 하나도 없다면 이 검사는 의미가 없습니다(규칙집 확인)');
  for (const [key] of sourceless) assert.equal(ruleSource(RULES, key), null, `${key}: 출처 없으면 null 이어야 합니다`);

  const rep = realReport();
  const all = rep.sections.flatMap(s => s.claims);
  for (const [key, r] of sourceless) {
    const label = r.label || key;
    const hits = all.filter(c => c.label.startsWith(label));
    for (const c of hits) {
      // 경고 줄은 엔진이 낸 경고라 official 로 남습니다 — 금액을 주장하는 줄만 봅니다
      if (/주의$/.test(c.label)) continue;
      assert.equal(c.basis, 'assumption', `${c.label}: 출처 없는 규칙인데 ${c.basis} 로 나갑니다`);
      assert.match(c.label + c.note, /가정/);
    }
  }
});
