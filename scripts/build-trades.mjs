// 국토교통부 아파트 매매 실거래가 수집 — 서울 25개 자치구 × 최근 N개월 → data/trades-seoul.json
//   npm run trades:seoul              최근 12개월
//   node scripts/build-trades.mjs --months=24 --gu=강동구,노원구,관악구
//
// 인증키는 .secrets/molit.json 에서 읽습니다(git 제외). 화면·파일에 키를 쓰지 않습니다.
// 정규화는 scripts/_trades.mjs — 해제 거래 제외, 만원 단위 유지.
//
// **빈 달과 실패한 달을 구분해 기록합니다.** 거래가 0건인 달과 조회가 막힌 달을 같이 적으면
// 「이 동네는 거래가 없다」는 거짓말이 됩니다. months 배열에 달마다 ok/err 를 남깁니다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTrades, totalCount, errorOf, byComplex } from './_trades.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 'trades-seoul.json');
const BASE = 'https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const log = m => console.log(`[${new Date().toLocaleTimeString('ko-KR', { hour12: false })}] ${m}`);
const sleep = ms => new Promise(r => setTimeout(r, ms));

export const GU_CODES = {
  종로구: '11110', 중구: '11140', 용산구: '11170', 성동구: '11200', 광진구: '11215',
  동대문구: '11230', 중랑구: '11260', 성북구: '11290', 강북구: '11305', 도봉구: '11320',
  노원구: '11350', 은평구: '11380', 서대문구: '11410', 마포구: '11440', 양천구: '11470',
  강서구: '11500', 구로구: '11530', 금천구: '11545', 영등포구: '11560', 동작구: '11590',
  관악구: '11620', 서초구: '11650', 강남구: '11680', 송파구: '11710', 강동구: '11740',
};

/** 최근 n개월(YYYYMM) — 이번 달 포함. 이번 달은 신고가 덜 들어와 건수가 적은 것이 정상입니다. */
export function recentMonths(n, now = new Date()) {
  const kst = new Date(now.getTime() + 9 * 3600e3);
  const out = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth() - i, 1));
    out.push(`${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

function readKey() {
  const p = path.join(ROOT, '.secrets', 'molit.json');
  if (!fs.existsSync(p)) throw new Error('인증키가 없습니다 — npm run molit:key 로 먼저 넣어 주세요');
  const k = JSON.parse(fs.readFileSync(p, 'utf8')).apiKey;
  if (!k) throw new Error('.secrets/molit.json 에 apiKey 가 없습니다');
  return k;
}

/** 한 자치구·한 달을 전부(여러 쪽) 가져옵니다 → { trades, stat } */
export async function fetchGuMonth(key, gu, code, ym, fetchImpl = fetch) {
  const rows = 1000;
  let page = 1, got = [], total = null, cancelled = 0, broken = 0;
  for (;;) {
    const url = `${BASE}?serviceKey=${key}&LAWD_CD=${code}&DEAL_YMD=${ym}&pageNo=${page}&numOfRows=${rows}`;
    const r = await fetchImpl(url, { headers: { 'User-Agent': UA, Accept: '*/*' }, signal: AbortSignal.timeout(40000) });
    const xml = await r.text();
    const err = errorOf(xml);
    if (err) return { trades: [], stat: { gu, ym, ok: false, error: err } };
    if (total === null) total = totalCount(xml);
    const p = parseTrades(xml, gu);
    got = got.concat(p.trades);
    cancelled += p.cancelled; broken += p.broken;
    const seen = page * rows;
    if (total === null || seen >= total || p.total === 0) break;
    page++;
    await sleep(120);
  }
  return { trades: got, stat: { gu, ym, ok: true, total, kept: got.length, cancelled, broken } };
}

export async function main(argv = process.argv.slice(2)) {
  const t0 = Date.now();
  const months = Number((argv.find(a => a.startsWith('--months=')) || '').slice(9)) || 12;
  const only = (argv.find(a => a.startsWith('--gu=')) || '').slice(5).split(',').map(s => s.trim()).filter(Boolean);
  const gus = only.length ? only.filter(g => GU_CODES[g]) : Object.keys(GU_CODES);
  if (only.length && gus.length !== only.length) throw new Error(`모르는 자치구: ${only.filter(g => !GU_CODES[g]).join(' ')}`);

  const key = readKey();
  const ymList = recentMonths(months);
  log(`실거래 수집 — ${gus.length}개 자치구 × ${months}개월(${ymList[ymList.length - 1]}~${ymList[0]}) = ${gus.length * months}회 조회`);

  const all = [];
  const stats = [];
  for (const gu of gus) {
    let n = 0;
    for (const ym of ymList) {
      const { trades, stat } = await fetchGuMonth(key, gu, GU_CODES[gu], ym);
      all.push(...trades); stats.push(stat); n += trades.length;
      await sleep(80);
    }
    log(`  ${gu} — ${n.toLocaleString('ko-KR')}건`);
  }

  const failed = stats.filter(s => !s.ok);
  const complexes = byComplex(all);
  const data = {
    generatedAt: new Date().toISOString(),
    source: '국토교통부_아파트 매매 실거래가 상세 자료(공공데이터포털 15126468, RTMSDataSvcAptTradeDev) — 이용허락범위 제한 없음',
    months: ymList, gus,
    counts: { trades: all.length, complexes: complexes.length, cancelled: stats.reduce((n, s) => n + (s.cancelled || 0), 0), failedQueries: failed.length },
    stats,            // 달마다 ok/err — 0건과 실패를 구분하려고 통째로 남깁니다
    trades: all,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(data));
  const mb = (fs.statSync(OUT).size / 1048576).toFixed(1);
  log(`완료 — 거래 ${all.length.toLocaleString('ko-KR')}건 · 단지 ${complexes.length.toLocaleString('ko-KR')}곳 · 해제 제외 ${data.counts.cancelled}건`
    + ` · 실패 ${failed.length}회 · ${mb}MB · ${Math.round((Date.now() - t0) / 1000)}초`);
  if (failed.length) log(`  실패한 조회: ${failed.slice(0, 5).map(f => `${f.gu} ${f.ym}(${f.error})`).join(', ')}${failed.length > 5 ? ' …' : ''}`);
  return data;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error('실패:', e.message); process.exit(1); });
}
