// 조합 사업장 목록(scripts/build-union.mjs) · 조합 필터(jinga-kb.mjs) 스모크 테스트 — 네트워크는 가짜 응답
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseList, nameKey, similarity, containRatio, matchSite, buildIndex, LIVE_STEPS, KINDS } from '../scripts/build-union.mjs';
import { evaluate, modeEligible, unionText } from '../site/public/jinga-kb.mjs';

const row = (no, gu, kind, name, addr, step) =>
  `<tr><td>${no}</td><td>${gu}</td><td>${kind}</td><td><a href="#">${name}</a></td><td>${addr}</td><td>${step}</td><td>526건</td><td>100.0%</td></tr>`;

test('정보몽땅 사업장검색 표 읽기', () => {
  const html = `<table><thead><tr><th>번호</th><th>자치구</th><th>사업구분</th><th>사업장명</th><th>대표지번</th><th>진행단계</th><th>공개자료수</th><th>충실도</th></tr></thead><tbody>
    ${row(261, '강남구', '재건축', '개포우성6차아파트 재건축정비사업조합', '개포동 658-1', '조합설립인가')}
    ${row(10, '송파구', '리모델링', '가락쌍용1차아파트 리모델링주택조합', '가락동 140', '안전진단(1차)')}
    </tbody></table>`;
  const rows = parseList(html);
  assert.equal(rows.length, 2, '머리글 줄은 빼고 본문만');
  assert.deepEqual(rows[0], { gu: '강남구', kind: '재건축', name: '개포우성6차아파트 재건축정비사업조합', addr: '개포동 658-1', step: '조합설립인가' });
  assert.equal(rows[1].kind, '리모델링');
  assert.deepEqual(KINDS.map(k => k.kind), ['재건축', '소규모재건축', '리모델링']);
  assert.ok(LIVE_STEPS.includes('조합설립인가') && !LIVE_STEPS.includes('착공'), '철거·착공 이후는 단지가 없어 제외');
});

test('조합명 ↔ KB 단지명 — 어순·표기가 달라도 맞추고, 비슷하기만 한 이름은 안 맞춤', () => {
  const same = (a, b) => similarity(nameKey(a), nameKey(b)) >= 0.85;
  assert.ok(same('개포우성6차아파트 재건축정비사업조합', '개포6차우성'), '차수 위치가 달라도 같은 단지');
  assert.ok(same('대치쌍용1차아파트 주택재건축정비사업조합', '쌍용대치(1차)'), '어순이 달라도 같은 단지');
  assert.ok(same('은마아파트 재건축정비사업조합', '은마'));
  assert.ok(same('삼익맨숀아파트 재건축정비사업조합', '삼익맨션'), '맨숀·맨션 표기 차이');
  assert.ok(same('가락쌍용1차아파트 리모델링주택조합', '가락쌍용1차'));

  assert.equal(same('대치쌍용1차아파트 주택재건축정비사업조합', '쌍용2차'), false, '차수가 다르면 다른 단지');
  assert.equal(same('대성연립주택재건축정비사업조합', '대치주성'), false, '글자가 겹쳐도 길이가 크게 다르면 제외');
  assert.equal(same('개포주공5단지아파트 재건축정비사업 조합', '개포주공7단지'), false, '단지 번호가 다르면 제외');
  assert.equal(containRatio('', 'abc'), 0);
});

test('사업장 → KB 단지 찾기(같은 법정동 먼저)', () => {
  const dir = { complexes: [
    [141, '개포6차우성', '강남구', '개포동', 0], [999, '개포6차우성', '서초구', '반포동', 0],
    [186, '은마', '강남구', '대치동', 0], [200, '래미안블레스티지', '강남구', '개포동', 0],
  ] };
  const index = buildIndex(dir);
  const m = matchSite({ gu: '강남구', name: '개포우성6차아파트 재건축정비사업조합', addr: '개포동 658-1' }, index);
  assert.equal(m.id, 141, '같은 법정동 것을 고름');
  assert.equal(m.score, 1);
  assert.equal(matchSite({ gu: '강남구', name: '없는단지아파트 재건축정비사업조합', addr: '개포동 1' }, index), null);
});

test('조합 필터: 켜면 조합 있는 단지만 · 유형이 맞아야 함 · 끄면 예전 기준', () => {
  const type = { excl: 84, supPy: '34', price: 200000, lo: 190000, hi: 210000, jeonse: 90000, hh: 900, provided: true, areaId: 1 };
  const brief = { built: 1980, households: 900, rebuild: true, interest: 100 };
  const withUnion = { id: 1, name: '은마', gu: '강남구', dong: '대치동', far: 179, hall: '계단식', types: [{ ...type }], brief,
    union: { kind: '재건축', law: '도시 및 주거환경정비법', mode: 'rebuild', name: '은마아파트 재건축정비사업조합', step: '사업시행인가' } };
  const noUnion = { id: 2, name: '옆단지', gu: '강남구', dong: '대치동', far: 180, hall: '계단식', types: [{ ...type }], brief, union: null };
  const crit = { budget: 300000, budgetMin: 0, minArea: 0, maxArea: 0, minHh: 0, basis: 'kb', mode: 'rebuild' };

  const off = evaluate([withUnion, noUnion], crit, 2026);
  assert.equal(new Set(off.qualifying.map(e => e.c.id)).size, 2, '필터를 끄면 준공 30년 기준으로 둘 다');
  const on = evaluate([withUnion, noUnion], { ...crit, unionOnly: true }, 2026);
  assert.deepEqual([...new Set(on.qualifying.map(e => e.c.id))], [1], '켜면 조합 있는 단지만');
  assert.ok(on.qualifying[0].score.reasons[0].includes('재건축 사업시행인가'), '근거 첫 줄에 조합 단계');

  const remodel = evaluate([withUnion], { ...crit, mode: 'remodel', unionOnly: true }, 2026);
  assert.equal(remodel.qualifying.length, 0, '재건축 조합은 리모델링 검색에 안 나옴');
  assert.equal(modeEligible(withUnion, brief, 2026, 'sale', true), true, '매매·전세는 조합과 무관');
  assert.equal(unionText({ kind: '리모델링', step: '' }), '리모델링 조합 설립');
});
