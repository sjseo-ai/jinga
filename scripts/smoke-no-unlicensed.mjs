// 무허가 원천이 새어 나가지 않는지 — **배포될 파일을 직접 열어 봅니다**(T011).
//   node --test scripts/smoke-no-unlicensed.mjs
//
// 사람의 기억과 문서는 틀립니다. 11월에만 세 번 겪었습니다 —
//   · legal.html 은 「대량 재배포하지 않습니다」라고 적고 있었는데 전수 엑셀 버튼이 있었습니다.
//   · 로컬 배치의 KB 수집만 끄고 **서버 크론**이 매주 도는 것을 못 봤습니다.
//   · 로컬 보고서의 엑셀 첨부만 끄고 **서버 발송 경로**의 첨부를 못 봤습니다.
// 그래서 「없앴다」를 말이 아니라 **파일을 뒤져서** 확인합니다.
//
// 허용하는 것(대표 판단 2026-11-19) — 이용자 브라우저가 자기 화면을 그리려고 KB 를 직접 조회하는 경로.
// 그 예외는 index.html·jinga-kb.mjs 에만 있어야 하고, 그 밖의 어디에도 없어야 합니다.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUB = path.join(ROOT, 'site', 'public');

/** 배포되는 파일 모으기(node_modules·빌드 사본 제외) */
function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p, acc); }
    else acc.push(p);
  }
  return acc;
}
const rel = p => path.relative(PUB, p).replace(/\\/g, '/');
const sample = (list, n = 40) => (list.length <= n ? list : list.filter((_, i) => i % Math.ceil(list.length / n) === 0));

/** 이용자 조회 경로 — 여기에만 KB 호출이 있어야 합니다 */
const KB_ALLOWED = new Set(['index.html', 'jinga-kb.mjs', 'sw.js', 'legal.html', 'admin.html']);

test('공개 페이지에 KB 호출이 들어가지 않는다', () => {
  const pages = walk(path.join(PUB, 'apt')).concat(walk(path.join(PUB, 'gu'))).filter(p => p.endsWith('.html'));
  assert.ok(pages.length > 100, `만들어진 페이지가 있어야 합니다(지금 ${pages.length}장) — npm run build:pages 먼저`);
  for (const p of sample(pages)) {
    const s = fs.readFileSync(p, 'utf8');
    assert.ok(!/kbland|api\.kbland|data-api\.kbland/i.test(s), `${rel(p)} 에 KB 호출 주소가 있습니다`);
  }
});

test('공개 페이지에 KB 시세가 실리지 않는다', () => {
  const pages = walk(path.join(PUB, 'gu')).filter(p => p.endsWith('.html'));
  for (const p of pages) {
    const s = fs.readFileSync(p, 'utf8');
    // 평당가는 실거래 기반만 허용 — KB 표기가 함께 있으면 안 됩니다
    assert.ok(!/KB시세|KB부동산 시세|KB 일반거래가/.test(s), `${rel(p)} 에 KB 시세 표기가 있습니다`);
    if (/평당 [\d,]+만원/.test(s)) {
      assert.match(s, /국토교통부 실거래가/, `${rel(p)} — 평당가를 실으려면 출처가 국토교통부 실거래가여야 합니다`);
    }
  }
});

test('공개 자료 파일에 KB 가격이 남아 있지 않다', () => {
  const data = fs.readdirSync(PUB).filter(f => f.endsWith('.json'));
  const priceLike = data.filter(f => /^kb-.*-(gu|price|types)\.json$/.test(f));
  assert.deepEqual(priceLike, [], `배포 폴더에 KB 가격 집계 파일이 있습니다: ${priceLike.join(', ')}`);
});

// ── 2026-11-24 에 뚫려 있던 구멍 ────────────────────────────────────────────
// 위 테스트는 **가격만** 봤습니다. 그래서 KB 꿀세권(입지)·주차·단지 좌표 1.5MB 가
// 다섯 달 동안 공개 배포되고 있었는데도 테스트가 초록이었습니다.
// 이제 **원천 표기 자체**를 봅니다 — 가격이든 아니든, 공개되는 자료 파일이 KB 를 출처로
// 적고 있으면 실패합니다. 「무엇을 금지할지」를 미리 다 떠올리지 못해도 걸리도록 하려는 것입니다.
/** 대표 판단으로 남겨 둔 예외 — 늘릴 때는 이 목록에 적고 왜 남기는지 함께 적습니다 */
const KB_DATA_ALLOWED = new Map([
  // 단지 목록(id·이름·동) — 이용자 브라우저가 KB시세를 조회하려면 KB 단지 id 가 필요합니다.
  // 좌표·용적률까지 함께 들어 있는 것은 **교체 대기 중**입니다(지오코딩 키 대기, docs/mitigation-plan.md 6절).
  ['kb-seoul-complexes.json', '검색 기능의 KB 단지 id 대조표 — 대표 판단 2026-11-19, 좌표 교체 대기'],
  ['kb-gyeonggi-complexes.json', '같음'],
]);

/** 배포되는 자료 파일 전부 — **하위 폴더까지**(PUB 바로 아래만 보다가 annual/ 을 놓쳤습니다) */
const dataFiles = () => walk(PUB)
  .filter(p => /\.(json|csv|xlsx)$/i.test(p))
  .map(rel)
  // 설정 파일은 자료가 아닙니다 — 숨은 폴더(.vercel 등)와 아래 목록은 뺍니다
  .filter(f => !f.split('/').some(seg => seg.startsWith('.')))
  .filter(f => !['package.json', 'manifest.json', 'map-key.json', 'vercel.json'].includes(f));

test('공개 자료 파일에 KB 출처 표기가 없다 — 가격이 아니어도', () => {
  const data = dataFiles();
  assert.ok(data.length > 5, `자료 파일을 못 찾았습니다(${data.length}개) — 경로를 보세요`);
  const offenders = [];
  for (const f of data) {
    if (KB_DATA_ALLOWED.has(f)) continue;
    const body = fs.readFileSync(path.join(PUB, f), 'utf8');
    // ① 이름이 kb- 로 시작 ② 안에 KB 를 원천으로 적음 ③ **출처를 아예 적지 않은 자료 파일**
    // ③ 이 들어간 이유 — annual/infra-2026.json 은 KB 꿀세권으로 만든 거리·학원 수인데
    //    출처를 적지 않아 ①②를 둘 다 빠져나갔습니다. 출처 없는 자료는 그 자체로 걸립니다.
    const base = f.split('/').pop();
    if (base.startsWith('kb-') || /KB부동산|kbland|KB시세|KB데이터허브|꿀세권/i.test(body)) { offenders.push(f); continue; }
    let j = null;
    try { j = JSON.parse(body); } catch { continue; }                       // JSON 이 아니면 아래 검사 생략
    // 출처는 source(한 원천) · sources(여러 원천) · notice(규칙집의 고지문) 중 하나로 적습니다
    const hasProvenance = j && typeof j === 'object' && !Array.isArray(j) && (j.source || j.sources || j.notice);
    if (j && typeof j === 'object' && !Array.isArray(j) && !hasProvenance) offenders.push(`${f}(출처 표기 없음)`);
  }
  assert.deepEqual(offenders.sort(), [],
    `KB 를 원천으로 하는 공개 자료 파일이 있습니다(대장은 cache:false·redistribute:false 입니다): ${offenders.join(', ')}`);
});

// KB 에서 배운 것을 **KB 에만** 적용하면 또 같은 일이 납니다.
// 2026-11-24 교체 중에 학교알리미 좌표를 공개 폴더에 넣었다가 빼냈습니다 —
// 그 API 는 공공누리 제3유형(출처표시·**변경금지**)으로 표기돼 있어, 가공물 공개 배포가
// 걸릴 수 있습니다. 「허용 범위를 확인하지 못한 원천은 공개 폴더에 두지 않는다」를 규칙으로 못박습니다.
test('이용허락을 확인하지 못한 원천은 공개 폴더에 없다', () => {
  const p = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'source-policy.json'), 'utf8'));
  const files = dataFiles();
  const bad = [];
  const hit = (pre, why) => {
    for (const f of files) {
      const base = f.split('/').pop();
      if ((f.startsWith(pre) || base.startsWith(pre)) && !KB_DATA_ALLOWED.has(f)) bad.push(`${f} — ${why}`);
    }
  };
  for (const s of p.sources) {
    // 원자료를 그대로 내보내려면 재배포 권리가 **확인돼** 있어야 합니다(null 은 「모른다」이고 「된다」가 아닙니다)
    if (s.allows.redistribute !== true) {
      for (const pre of s.publicPrefixes || []) hit(pre, `${s.key}: 원자료 배포인데 redistribute=${s.allows.redistribute}`);
    }
    // 집계·파생값만 내보내는 것은 파생 권리로 갑니다 — 대신 **무엇을 뺐는지** 적혀 있어야 합니다
    for (const pre of s.publicDerivedPrefixes || []) {
      if (s.allows.derive !== true) hit(pre, `${s.key}: 파생값 배포인데 derive=${s.allows.derive}`);
      else if (!s.derivedNote) hit(pre, `${s.key}: 파생값만 배포한다면서 무엇을 뺐는지(derivedNote) 적혀 있지 않습니다`);
    }
  }
  assert.deepEqual(bad.sort(), [], `재배포 권리가 확인되지 않은 원천의 파일이 배포 폴더에 있습니다: ${bad.join(', ')}`);
});

test('입지·주차 자료는 공공 원천으로 적혀 있다', () => {
  // 바꿔 넣었다는 말만으로는 모릅니다 — **바뀐 파일을 열어** 원천 표기를 확인합니다.
  for (const [f, want] of [
    ['kapt-seoul-infra.json', /국토교통부.*K-apt/],
    ['kapt-gyeonggi-infra.json', /국토교통부.*K-apt/],
  ]) {
    const p = path.join(PUB, f);
    assert.ok(fs.existsSync(p), `${f} 이 없습니다 — npm run kapt:infra / npm run schools 로 먼저 만드세요`);
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    assert.match(j.source, want, `${f}: 원천 표기`);
    assert.ok(!/KB|kbland|꿀세권/i.test(JSON.stringify(j.source)), `${f}: 원천에 KB 가 남아 있습니다`);
  }
  // 도보시간 구간은 **거리로 환산해 싣지 않습니다** — 없는 정밀도를 꾸미지 않기로 했습니다
  const k = JSON.parse(fs.readFileSync(path.join(PUB, 'kapt-seoul-infra.json'), 'utf8'));
  assert.equal(k.basis, 'kapt-walk-band');
  assert.deepEqual(k.bands, ['5분이내', '5~10분이내', '10~15분이내', '15~20분이내', '20분초과']);
  const one = Object.values(k.byComplex).find(v => v.sw != null);
  assert.ok(one.sw >= 0 && one.sw <= 4, '도보 구간은 0~4 번호');
  assert.ok(!('m' in one) && !('stM' in one), '구간 자료에 미터 값을 만들어 넣지 않습니다');
});

test('교체로 빠진 KB 파생 파일이 되살아나지 않았다', () => {
  // slope-*·sangga-* 는 **KB 역 좌표를 기준으로** 계산한 파생물이라 2026-11-24 에 함께 뺐습니다.
  // 공공 역 좌표를 붙인 뒤 같은 이름으로 다시 만들 예정이고, 그때는 원천 표기가 KB 가 아니어야 합니다.
  for (const f of ['kb-seoul-infra.json', 'kb-gyeonggi-infra.json', 'kb-seoul-parking.json', 'kb-gyeonggi-parking.json']) {
    assert.ok(!fs.existsSync(path.join(PUB, f)), `${f} 이 다시 생겼습니다`);
  }
  for (const f of ['slope-seoul.json', 'slope-gyeonggi.json', 'sangga-seoul.json', 'sangga-gyeonggi.json']) {
    const p = path.join(PUB, f);
    if (!fs.existsSync(p)) continue;                 // 아직 다시 만들지 않았으면 그걸로 됐습니다
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    assert.ok(!/KB|kbland|꿀세권/i.test(String(j.source || '') + String(j.note || '')),
      `${f}: 다시 만들 때 원천이 KB 로 되돌아갔습니다`);
  }
});

test('추정 시세는 출처·기준월·등급을 달고 나간다', () => {
  const f = path.join(PUB, 'trade-price-seoul.json');
  if (!fs.existsSync(f)) return;                       // 아직 안 만들었으면 건너뜁니다
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  assert.match(j.source, /국토교통부/, '출처');
  assert.ok(/추정치이며 실거래가가 아닙니다|추정치/.test(j.source), '추정임을 밝혀야');
  assert.ok(/^\d{6}$/.test(String(j.asOfYM)), '기준월');
  const one = Object.values(j.byComplex)[0];
  for (const a of one.areas) {
    assert.ok(['A', 'B', 'C', 'D'].includes(a.grade), '등급');
    assert.ok(a.n >= 1, '거래 건수');
    if (a.grade === 'D') assert.equal(a.amount, null, '등급 D 는 대표값을 내지 않습니다');
  }
});

test('KB 호출은 이용자 조회 경로에만 있다', () => {
  const files = fs.readdirSync(PUB).filter(f => /\.(mjs|js|html)$/.test(f))
    .concat(walk(path.join(PUB, 'api')).map(rel));
  const offenders = [];
  for (const f of files) {
    const p = path.join(PUB, f);
    if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) continue;
    const s = fs.readFileSync(p, 'utf8');
    if (/api\.kbland|data-api\.kbland/.test(s) && !KB_ALLOWED.has(path.basename(f))) offenders.push(f);
  }
  // 서버 쪽(api/_job.mjs, api/_flow.mjs)은 **알고 남겨 둔 것**이라 여기 목록에 그대로 적습니다.
  // 새로 늘어나면 이 테스트가 깨집니다 — 늘어난 것을 모르고 지나가지 않도록.
  // 서버 쪽에 남은 KB 호출은 **알고 남겨 둔 것**이라 여기 그대로 적습니다. 늘어나면 테스트가 깨집니다.
  //   api/_flow.mjs — 시장 흐름(KB데이터허브 집계 통계, 저장 안 함). 법률 질의 대상(T004).
  //   주간 작업(_job·_weekly)은 jinga-kb.mjs 를 거치므로 여기 주소로는 잡히지 않습니다.
  assert.deepEqual(offenders.sort(), ['api/_flow.mjs'],
    `KB 호출이 있는 파일이 달라졌습니다: ${offenders.join(', ')}`);
});

test('주간 작업은 전수 수집 스위치가 꺼진 채로 배포된다', () => {
  const job = fs.readFileSync(path.join(PUB, 'api', '_job.mjs'), 'utf8');
  assert.match(job, /JINGA_KB_BULK/, '스위치가 있어야');
  assert.match(job, /kbBulkAllowed/, '스위치를 실제로 보는 코드가 있어야');
  assert.ok(!/buildXlsx\(buildReportSheets/.test(job), '구독자 메일용 전수 엑셀을 다시 만들면 안 됩니다');
  assert.match(job, /xlsx: null/, '메일 첨부는 비워 둡니다');
});

// ── 이용허락 대장 (㉯ 계획서 T004) ─────────────────────────────────────────
// 대장은 적어 두는 것만으로는 쓸모가 없습니다. **칸이 비면 테스트가 깨져야** 비어 있다는 걸 압니다.
test('모든 원천에 소유자·원문URL·검토일·허용범위·캐시·재배포 권리가 적혀 있다', () => {
  const p = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'source-policy.json'), 'utf8'));
  assert.match(p.checkedAt, /^\d{4}-\d{2}-\d{2}$/, '언제 검토했는지');
  assert.ok(p.recheckEvery, '언제 다시 볼지');
  assert.ok(p.sources.length >= 10, `원천 ${p.sources.length}건`);

  for (const s of p.sources) {
    assert.ok(s.key && s.name, `이름: ${s.key}`);
    assert.ok(s.org, `${s.key}: 소유자(org)가 비었습니다`);
    assert.ok(s.checkedUrl && s.checkedUrl.startsWith('http'), `${s.key}: 원문 URL 이 없습니다`);
    assert.ok(s.license, `${s.key}: 이용허락 내용이 없습니다`);
    assert.ok(s.role, `${s.key}: 무엇에 쓰는지 적혀 있어야`);
    for (const k of ['commercial', 'redistribute', 'derive', 'cache']) {
      assert.ok(k in s.allows, `${s.key}: allows.${k} 칸이 없습니다`);
      assert.ok([true, false, null].includes(s.allows[k]), `${s.key}: allows.${k} 는 true/false/null`);
    }
    // 모르면 모른다고 적되, **왜 모르는지**는 적어야 합니다
    if (s.allows.cache === null) assert.ok(s.cacheNote, `${s.key}: 캐시 권리를 모르면 그 사정을 적어야`);
  }
});

test('KB 는 대장에서도 전면 금지로 못박혀 있다', () => {
  const p = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'source-policy.json'), 'utf8'));
  const kb = p.sources.find(s => s.key === 'kb');
  assert.ok(kb, 'KB 가 대장에 있어야 합니다 — 빼면 「검토 안 한 원천」이 됩니다');
  assert.equal(kb.allows.commercial, false);
  assert.equal(kb.allows.redistribute, false);
  assert.equal(kb.allows.cache, false, '저장도 금지입니다');
  assert.equal(kb.allows.derive, false);
  assert.ok(kb.license.includes('이용허락 없음'));
});
