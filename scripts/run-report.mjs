// 보고서 한 건을 글로 찍어 봅니다 — ㉯ T011 을 눈으로 확인하는 용도
//   npm run report                       첫 단지로
//   npm run report -- 은마                단지 이름으로 찾기
//   npm run report -- 은마 --sources     출처 목록까지
//   npm run report -- 은마 --json        구조 그대로(다른 도구에 넘길 때)
//
// 화면에 찍히는 모든 숫자 뒤에 [성격]과 출처가 붙습니다. 하나라도 출처가 없으면
// 보고서가 **만들어지지 않습니다**(scripts/_report.mjs 의 claim() 이 던집니다).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { plan, scenarios } from './_finance.mjs';
import { composeReport } from './_report-compose.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const won = v => (v == null ? '—' : Number(v).toLocaleString('ko-KR'));

const args = process.argv.slice(2);
const want = args.filter(a => !a.startsWith('--')).join(' ').trim();
const showSources = args.includes('--sources');
const asJson = args.includes('--json');

const RULES = read('data/finance-rules.json');
const INDEX = read('site/public/decision-index.json');
let KAPT = null;
try { KAPT = read('site/public/kapt-seoul-infra.json'); } catch { /* 없으면 입지 칸만 빠집니다 */ }

const complex = want
  ? INDEX.complexes.find(c => c.name.includes(want) && c.areas.some(a => a.amt != null))
  : INDEX.complexes.find(c => c.areas.some(a => a.amt != null));
if (!complex) {
  console.error(`「${want}」 로 찾은 단지가 없습니다(대표값이 있는 단지만 찾습니다). 예: npm run report -- 은마`);
  process.exit(1);
}
const area = complex.areas.find(a => a.amt != null);
const price = area.amt * 1e4;
const input = { price, cash: Math.round(price * 0.4), annualRate: 0.04, years: 30, holdYears: 5, income: 80000000, method: 'equal' };

let infra = null, infraSource = null;
const v = KAPT && KAPT.byComplex[complex.id];
if (v) {
  infraSource = KAPT.source;
  infra = {
    station: v.sw != null || v.st ? { name: v.st || '', lines: v.lines || [], m: null, band: v.sw ?? null } : null,
    parking: v.pk != null ? { total: v.pk, per: v.pkPer ?? null } : null,
    elem: v.el ? { name: v.el[0], zone: true, m: null } : null,
    mid: v.mid ? { name: v.mid[0], zone: true, m: null } : null,
    academies: null,
  };
}

const report = composeReport({
  complex, area, index: INDEX,
  finance: plan(input, RULES), scen: scenarios(input, RULES),
  rules: RULES, infra, infraSource,
});

if (asJson) { console.log(JSON.stringify(report, null, 1)); process.exit(report.violations.length ? 1 : 0); }

console.log(`\n${complex.name} · ${complex.gu} ${complex.dong} · 전용 ${area.m2}㎡`);
console.log(`입력: 매수가 ${won(price)}원 · 현금 ${won(input.cash)}원 · 금리 ${input.annualRate * 100}% · ${input.years}년 · ${input.holdYears}년 보유`);
console.log(`${'─'.repeat(78)}`);
for (const s of report.sections) {
  console.log(`\n${s.title}`);
  for (const c of s.claims) {
    const val = c.value != null ? ` = ${won(c.value)}${c.unit}` : '';
    const conf = c.confidence ? ` {${c.confidence}}` : '';
    console.log(`  [${c.basisLabel}]${conf} ${c.label}${val}`);
    if (c.note) console.log(`      · ${c.note}`);
    console.log(`      ← ${c.source}`);
  }
}
console.log(`\n${'─'.repeat(78)}`);
console.log(`주장 ${report.sections.reduce((a, s) => a + s.claims.length, 0)}줄 · 출처 ${report.sources.length}종`);
console.log(`성격별: ${Object.entries(report.counts).map(([k, n]) => `${k} ${n}`).join(' · ')}`);
console.log(`출처 없는 주장: ${report.violations.length}건${report.violations.length ? ' ← 내보내면 안 됩니다' : ' ✓'}`);
for (const x of report.violations) console.log(`  ✖ ${x.where} — ${x.reason}`);
console.log(`\n아직 못 채우는 칸 ${report.pending.length}개 — 빈칸을 문장으로 메우지 않습니다`);
for (const p of report.pending) console.log(`  · ${p.title} — ${p.why}`);
console.log(`\n${report.meta.notice}`);

if (showSources) {
  console.log(`\n출처 목록(각주용)`);
  report.sources.forEach((s, i) => console.log(`  [${i + 1}] ${s.count}줄 (${s.basis.join(',')})${s.asOf ? ` · ${s.asOf}` : ''}\n      ${s.source}`));
}
process.exit(report.violations.length ? 1 : 0);
