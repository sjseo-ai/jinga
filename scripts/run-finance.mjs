// 대표 시나리오를 사람이 읽을 수 있게 찍어 주는 도구 — 위택스·홈택스·은행 계산기와 눈으로 대조하기 위한 것.
//   node scripts/run-finance.mjs
//   node scripts/run-finance.mjs --price 12 --cash 7 --income 1 --rate 4.0 --years 30 --hold 5 --area 84 --regulated
//   node scripts/run-finance.mjs --json          (기계가 읽을 형태)
// 금액 단위: --price/--cash/--income 은 **억원**, --rate 는 **%**.
import { readFileSync } from 'node:fs';
import { plan, scenarios } from './_finance.mjs';

const RULES = JSON.parse(readFileSync(new URL('../data/finance-rules.json', import.meta.url), 'utf8'));

const argv = process.argv.slice(2);
const flag = name => argv.includes(`--${name}`);
const opt = (name, d) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] != null ? Number(argv[i + 1]) : d;
};

const input = {
  price: opt('price', 12) * 1e8,
  cash: opt('cash', 7) * 1e8,
  annualIncome: opt('income', 1) * 1e8,
  annualRate: opt('rate', 4) / 100,
  years: opt('years', 30),
  holdYears: opt('hold', 5),
  areaM2: opt('area', 84),
  houses: opt('houses', 1),
  monthlyMaintenance: opt('maintenance', 25) * 10000,
  method: argv.includes('--principal') ? 'principal' : argv.includes('--bullet') ? 'bullet' : 'equal',
  regulated: flag('regulated'),
  firstHome: flag('first-home'),
  adjusted: flag('adjusted'),
};

const today = new Date().toISOString().slice(0, 10);
const out = scenarios(input, RULES, undefined, today);

if (flag('json')) {
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}

const 억 = n => `${(Math.round(n / 1e7) / 10).toLocaleString()}억`;
const 만 = n => `${Math.round(n / 10000).toLocaleString()}만원`;
const line = s => console.log(s);
const rule = () => line('─'.repeat(64));

const p = out.base;
line('');
line(`진가 · 대출/비용 시뮬레이션   규칙집 ${p.rules.version} (기준일 ${p.rules.asOf}${p.rules.stale ? ' · 묵었음!' : ''})`);
line(RULES.notice);
rule();
line(`집값 ${억(input.price)} · 전용 ${input.areaM2}㎡ · 보유 ${input.holdYears}년 · ${input.regulated ? '규제지역' : '비규제지역'}`);
line(`가진 현금 ${억(input.cash)} · 연소득 ${억(input.annualIncome)} · 금리 ${(input.annualRate * 100).toFixed(2)}% · ${input.years}년 ${{ equal: '원리금균등', principal: '원금균등', bullet: '만기일시' }[input.method]}`);
rule();

line('■ 살 때 드는 돈');
for (const i of p.acquisition.items) line(`   ${i.label.padEnd(18, ' ')} ${만(i.amount).padStart(12, ' ')}   ${i.note || ''}`);
line(`   ${'합계'.padEnd(18, ' ')} ${만(p.acquisition.total).padStart(12, ' ')}`);
line('');

line('■ 대출');
for (const c of p.loanLimit.candidates) {
  line(`   ${c.key === p.loanLimit.binding ? '▶' : ' '} ${c.label.padEnd(36, ' ')} ${억(c.amount).padStart(8, ' ')}`);
}
line(`   한도 ${억(p.loanLimit.limit)} · 필요 ${억(p.loan.requested)}${p.loan.shortfall > 0 ? ` · ${억(p.loan.shortfall)} 모자람` : ''}`);
line(`   실행액 ${억(p.loan.principal)} · 첫 달 ${만(p.loan.firstPayment)} · 총이자 ${억(p.loan.totalInterest)}`);
line('');

line('■ 가지고 있는 동안 (해마다)');
line(`   ${'해'.padEnd(4)} ${'재산세'.padStart(10)} ${'종부세'.padStart(10)} ${'관리비'.padStart(10)} ${'대출'.padStart(12)} ${'합계'.padStart(12)}`);
p.holding.rows.forEach((h, i) => {
  const l = p.yearly[i];
  line(`   ${String(h.year).padEnd(4)} ${만(h.propertyTax).padStart(10)} ${만(h.comprehensiveTax).padStart(10)} ${만(h.maintenance).padStart(10)} ${만(l.loan).padStart(12)} ${만(l.total).padStart(12)}`);
});
line(`   처음 들어가는 현금 ${억(p.cashNeeded)}${p.cashShort > 0 ? ` (가진 돈보다 ${억(p.cashShort)} 모자람)` : ''} · ${input.holdYears}년간 추가 지출 ${억(p.outflowDuringHold)}`);
line('');

rule();
line('■ 팔 때 — 아래는 전부 가정입니다 (예측 아님)');
line(`   ${out.disclaimer.replace(/\*\*/g, '')}`);
line(`   ${'경우'.padEnd(12)} ${'매도가'.padStart(9)} ${'양도세'.padStart(11)} ${'대출잔액'.padStart(10)} ${'손에 남는 돈'.padStart(12)} ${'총투입'.padStart(10)} ${'손익'.padStart(11)}`);
for (const c of out.cases) {
  const g = `${c.yearlyGrowth > 0 ? '+' : ''}${(c.yearlyGrowth * 100).toFixed(0)}%/년`;
  line(`   ${`${c.label}(${g})`.padEnd(12)} ${억(c.sellPrice).padStart(9)} ${만(c.capitalGains.total).padStart(11)} ${억(c.loanBalance).padStart(10)} ${억(c.proceeds).padStart(12)} ${억(c.invested).padStart(10)} ${억(c.profit).padStart(11)}`);
}
line('');

rule();
line(`■ 믿지 말아야 할 것 (${out.warnings.length}건)`);
for (const w of out.warnings) line(`   [${w.confidence}] ${w.label} — ${w.message}`);
line('');
