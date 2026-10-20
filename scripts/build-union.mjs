// 서울시 정비사업 정보몽땅 → 「조합이 설립된」 재건축·소규모재건축·리모델링 사업장 목록(site/public/seoul-union.json)
//   npm run kb:union      (요청 3번, 10초 남짓)
//
// 왜 필요한가 — 재건축·리모델링은 법적으로 조합이 설립돼야 사업이 굴러갑니다.
//   · 재건축·소규모재건축: 「도시 및 주거환경정비법」·「빈집 및 소규모주택 정비에 관한 특례법」의 조합설립인가
//   · 리모델링: 「주택법」 제11조의 리모델링주택조합 설립인가
// 정보몽땅 사업장검색(lscrMainIndx.do)의 「운영단계 = 조합」이 이 조합들입니다. 키 없이 조회되지만 공식 API가 아니라
// 형식이 예고 없이 바뀔 수 있어, 받은 행이 너무 적으면 기존 파일을 그대로 둡니다.
//
// 한계(파일에도 적어 둡니다)
//   · 서울만 있습니다. 경기는 시·군마다 흩어져 있어 같은 방식으로 한 번에 모을 수 없습니다.
//   · 구역·지구 단위 사업(압구정 특별계획구역, 미아제4-1구역 등)과 연립·빌라는 KB 아파트 단지와 1:1로 맞지 않습니다.
//   · 그래서 KB 단지에 붙은 것만 검색 필터로 쓰고, 붙지 않은 사업장도 목록에는 남겨 둡니다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LIST_URL = 'https://cleanup.seoul.go.kr/cleanup/bsnssttus/lscrMainIndx.do';
const H = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  Accept: '*/*', Referer: 'https://cleanup.seoul.go.kr/',
};
// 사업구분 코드(정보몽땅) — 우리가 쓰는 두 유형에 해당하는 것만
export const KINDS = [
  { code: '100', kind: '재건축', law: '도시 및 주거환경정비법', mode: 'rebuild' },
  { code: '104', kind: '소규모재건축', law: '빈집 및 소규모주택 정비에 관한 특례법', mode: 'rebuild' },
  { code: '106', kind: '리모델링', law: '주택법(리모델링주택조합)', mode: 'remodel' },
];
export const OPER_UNION = '102';           // 운영단계 = 조합
// 단지가 아직 서 있는 단계 — 철거·착공부터는 건물이 없어져 KB 시세도 사라집니다
export const LIVE_STEPS = ['조합설립인가', '사업시행인가', '관리처분인가', '주민대표회의구성통지', '안전진단(1차)', '도시계획심의', '사업계획승인(리모델링 허가)', ''];
const MIN_ROWS = 100;

const log = msg => console.log(`[${new Date().toLocaleTimeString('ko-KR', { hour12: false })}] ${msg}`);
const text = s => String(s).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

/** 사업장검색 HTML → [{ gu, kind, name, addr, step, opened }] */
export function parseList(html) {
  return [...String(html).matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)]
    .map(m => [...m[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map(c => text(c[1])))
    .filter(r => r.length >= 6 && /^\d+$/.test(r[0]))
    .map(r => ({ gu: r[1], kind: r[2], name: r[3], addr: r[4], step: r[5] || '' }));
}

// ── 조합명 ↔ KB 단지명 맞추기 ────────────────────────────────
// 「개포우성6차아파트 재건축정비사업조합」과 KB의 「개포6차우성」처럼 어순·표기가 달라서,
// 사업 종류 표기를 떼고 남은 글자를 어순 없이 견주고 차수(6차·2단지)가 어긋나면 다른 단지로 봅니다.
const SUFFIX = /(주택)?(재)?(건축|개발|정비)[^ ]*사업.*$|리모델링.*$|소규모재건축.*$|가로주택.*$|정비사업.*$|조합.*$|추진위원회.*$/;
const FILLER = /(아파트|아파트단지|맨션|맨숀|빌라|연립|주택|단지|일대|번지|차|지구|구역)/g;
/** 이름 → { core: 글자를 정렬한 문자열, len, nums: 차수·단지 번호 } */
export function nameKey(name) {
  const s = String(name || '').replace(SUFFIX, '').replace(/맨숀/g, '맨션');
  const nums = [...s.matchAll(/(\d+)\s*(차|단지)/g)].map(m => m[1]);
  const body = s.replace(/(\d+)\s*(차|단지)/g, ' ').replace(FILLER, ' ').replace(/[^가-힣A-Za-z0-9]/g, '');
  return { core: [...body].sort().join(''), len: body.length, nums };
}
/** 글자 다중집합 포함 비율(0~1) */
export function containRatio(a, b) {
  if (!a.length || !b.length) return 0;
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  const pool = [...l];
  let n = 0;
  for (const ch of s) { const i = pool.indexOf(ch); if (i >= 0) { pool.splice(i, 1); n++; } }
  return n / s.length;
}
export const MATCH_MIN = 0.85, LEN_MIN = 0.6;
/** 두 이름이 같은 단지일 가능성(0~1). 길이가 너무 차이 나면(대성 ↔ 대치주성) 0 */
export function similarity(A, B) {
  if (!A.len || !B.len) return 0;
  if (A.nums.length && B.nums.length && !A.nums.some(n => B.nums.includes(n))) return 0;   // 차수가 다르면 다른 단지
  const lenRatio = Math.min(A.len, B.len) / Math.max(A.len, B.len);
  if (lenRatio < LEN_MIN) return 0;
  return containRatio(A.core, B.core) * (0.7 + 0.3 * lenRatio);
}

/** 사업장 하나를 KB 단지에 맞춤 — 같은 법정동 먼저, 없으면 같은 자치구 */
export function matchSite(site, index) {
  const dong = String(site.addr || '').split(/\s+/)[0];
  const K = nameKey(site.name);
  if (!K.len) return null;
  for (const pool of [index.byDong[dong] || [], index.byGu[site.gu] || []]) {
    let top = null;
    for (const c of pool) {
      const sc = similarity(K, c.key);
      if (sc >= MATCH_MIN && (!top || sc > top.score)) top = { id: c.id, name: c.name, dong: c.dong, score: Math.round(sc * 100) / 100 };
    }
    if (top) return top;
  }
  return null;
}

/** KB 단지 디렉터리 → 매칭용 색인 */
export function buildIndex(dir) {
  const byDong = {}, byGu = {};
  for (const c of dir.complexes) {
    const row = { id: c[0], name: c[1], gu: c[2], dong: c[3], key: nameKey(c[1]) };
    (byDong[c[3]] = byDong[c[3]] || []).push(row);
    (byGu[c[2]] = byGu[c[2]] || []).push(row);
  }
  return { byDong, byGu };
}

export async function main({ fetchImpl = (...a) => fetch(...a) } = {}) {
  const t0 = Date.now();
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'site', 'public');
  const dest = path.join(root, 'seoul-union.json');

  const sites = [];
  for (const k of KINDS) {
    const url = `${LIST_URL}?bsnsSeCodeList=${k.code}&operSeCodeList=${OPER_UNION}&cpage=1&pageSize=500`;
    const r = await fetchImpl(url, { headers: H, signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error(`정보몽땅 ${k.kind} HTTP ${r.status}`);
    const rows = parseList(await r.text());
    rows.forEach(s => sites.push({ ...s, kind: k.kind, law: k.law, mode: k.mode }));
    log(`${k.kind} 조합 ${rows.length}곳`);
  }
  if (sites.length < MIN_ROWS) throw new Error(`사업장이 너무 적습니다(${sites.length}곳) — 기존 파일을 그대로 둡니다`);

  const dir = JSON.parse(fs.readFileSync(path.join(root, 'kb-seoul-complexes.json'), 'utf8'));
  const index = buildIndex(dir);
  const live = new Set(LIVE_STEPS);
  const byComplex = {};
  let matched = 0;
  for (const s of sites) {
    s.live = live.has(s.step);
    if (!s.live) continue;                          // 철거·착공 이후는 살 수 있는 단지가 아니라 붙이지 않음
    const m = matchSite(s, index);
    if (!m) continue;
    s.complexId = m.id; s.complexName = m.name; s.matchScore = m.score;
    matched++;
    const prev = byComplex[m.id];
    // 한 단지에 사업장이 여럿이면 더 진척된 단계를 남김
    if (!prev || LIVE_STEPS.indexOf(s.step) > LIVE_STEPS.indexOf(prev.step)) {
      byComplex[m.id] = { kind: s.kind, law: s.law, mode: s.mode, name: s.name, complexName: m.name, step: s.step, gu: s.gu, addr: s.addr, score: m.score };
    }
  }

  const liveCount = sites.filter(s => s.live).length;
  const out = {
    generatedAt: new Date().toISOString(),
    source: '서울시 정비사업 정보몽땅(cleanup.seoul.go.kr) 사업장검색 — 운영단계 「조합」. 공식 API가 아닌 웹 조회이며 형식이 바뀔 수 있습니다.',
    scope: '서울 25개 자치구만. 경기는 시·군별로 흩어져 있어 포함하지 못했습니다.',
    note: '조합설립인가를 받아 조합이 있는 사업장입니다. 구역·지구 단위 사업과 연립·빌라는 KB 아파트 단지와 1:1로 맞지 않아 단지에 붙지 않습니다.',
    liveSteps: LIVE_STEPS.filter(Boolean),
    counts: {
      total: sites.length, live: liveCount, matched,
      byKind: Object.fromEntries(KINDS.map(k => [k.kind, sites.filter(s => s.kind === k.kind).length])),
      byKindLive: Object.fromEntries(KINDS.map(k => [k.kind, sites.filter(s => s.kind === k.kind && s.live).length])),
    },
    byComplex,
    sites: sites.map(({ gu, kind, law, mode, name, addr, step, live: l, complexId, complexName, matchScore }) =>
      ({ gu, kind, law, mode, name, addr, step, live: l, complexId: complexId || null, complexName: complexName || null, matchScore: matchScore || null })),
  };
  fs.writeFileSync(dest, JSON.stringify(out));
  log(`조합 사업장 ${sites.length}곳(단지 현존 ${liveCount}곳) · KB 단지 연결 ${matched}곳 → ${path.relative(process.cwd(), dest)} (${(fs.statSync(dest).size / 1024).toFixed(0)}KB) · ${Math.round((Date.now() - t0) / 1000)}초`);
  return out;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (invokedDirectly) main().catch(e => { console.error('[조합 목록] 실패:', e); process.exit(1); });
