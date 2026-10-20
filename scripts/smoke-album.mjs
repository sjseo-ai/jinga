// 단지 사진·현장 정보(_album.mjs) 스모크 테스트 — 순수 계산, 네트워크 없음
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseFacts, upsertFacts, aggregateFacts, factsDigest,
  parsePhoto, addPhoto, reportPhoto, publicPhoto, livePhotos, photoPath,
  FACTS, PHOTO_KINDS, RULES, PHOTO_MAX_BYTES, PHOTOS_PER_COMPLEX, HIDE_REPORTS, MIME,
} from '../site/public/api/_album.mjs';

test('고른 답 다듬기 — 모르는 항목은 아예 빼서 「모름」이 쌓이지 않게', () => {
  const r = parseFacts({ complexId: 1001, bay: '3bay', parkLift: 'direct' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, { complexId: 1001, bay: '3bay', parkLift: 'direct' });
  assert.equal('parkEase' in r.value, false, '안 고른 항목은 들어가지 않음');

  assert.match(parseFacts({ complexId: 0, bay: '3bay' }).error, /단지/);
  assert.match(parseFacts({ complexId: 1001 }).error, /하나 이상/);
  assert.match(parseFacts({ complexId: 1001, bay: '' }).error, /하나 이상/);
  assert.equal(parseFacts({ complexId: 1001, bay: '없는값', parkLift: 'none' }).value.bay, undefined, '보기에 없는 값은 버림');

  // 「모름」을 보기로 두지 않습니다 — 모르면 비워 두면 됩니다
  for (const f of FACTS) assert.ok(!f.options.some(o => /모름/.test(o.label)), `${f.key} 에 모름 보기가 있음`);
  assert.deepEqual(FACTS.map(f => f.key), ['bay', 'parkLift', 'parkEase']);
});

test('같은 사람이 다시 올리면 예전 답을 덮음', () => {
  let rows = upsertFacts([], parseFacts({ complexId: 1, bay: '2bay' }).value, 'u1', () => 0);
  rows = upsertFacts(rows, parseFacts({ complexId: 1, bay: '3bay' }).value, 'u1', () => 1000);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].bay, '3bay');
  rows = upsertFacts(rows, parseFacts({ complexId: 1, bay: '4bay' }).value, 'u2', () => 2000);
  assert.equal(rows.length, 2);
});

test('모은 답 집계 — 가장 많은 답과 「몇 명 중 몇 명」', () => {
  const rows = [
    { uid: 'a', bay: '3bay', parkLift: 'direct' },
    { uid: 'b', bay: '3bay', parkLift: 'direct' },
    { uid: 'c', bay: '3bay', parkLift: 'partial' },
    { uid: 'd', bay: '2bay' },
  ];
  const agg = aggregateFacts(rows);
  assert.equal(agg.bay.value, '3bay');
  assert.equal(agg.bay.label, '3베이');
  assert.equal(agg.bay.n, 3);
  assert.equal(agg.bay.total, 4);
  assert.equal(agg.bay.agreed, false, '답이 갈렸으면 표시');
  assert.deepEqual(agg.bay.others, [{ value: '2bay', label: '2베이', n: 1 }]);

  assert.equal(agg.parkLift.value, 'direct');
  assert.equal(agg.parkLift.total, 3, '그 항목을 고른 사람만 셈');
  assert.equal(agg.parkEase, null, '아무도 안 고른 항목은 없음');

  // 모두 같은 답이면 agreed
  const same = aggregateFacts([{ uid: 'a', bay: '4bay' }, { uid: 'b', bay: '4bay' }]);
  assert.equal(same.bay.agreed, true);
  assert.deepEqual(same.bay.others, []);
  assert.deepEqual(aggregateFacts([]).bay, null);
});

test('한 줄 요약 — 갈린 답은 「몇 명 중 몇 명」으로', () => {
  const agreed = factsDigest(aggregateFacts([{ uid: 'a', bay: '3bay' }, { uid: 'b', bay: '3bay' }]));
  assert.equal(agreed, '3베이(2명)');
  const split = factsDigest(aggregateFacts([{ uid: 'a', bay: '3bay' }, { uid: 'b', bay: '2bay' }]));
  assert.match(split, /2명 중 1명/);
  assert.equal(factsDigest(aggregateFacts([])), '');
  const two = factsDigest(aggregateFacts([{ uid: 'a', bay: '3bay', parkLift: 'direct' }]));
  assert.match(two, /3베이\(1명\) · 모든 동 바로 연결\(1명\)/);
});

const PH = { complexId: 1001, kind: 'parking', type: 'image/jpeg', bytes: 240 * 1024, own: true, caption: '지하 2층에서 엘리베이터 바로' };

test('사진 — 직접 찍은 것 확인·크기·형식을 모두 봄', () => {
  const r = parsePhoto(PH, () => Date.parse('2026-10-11T00:00:00Z'));
  assert.equal(r.ok, true);
  assert.equal(r.value.ext, 'jpg');
  assert.equal(r.value.kind, 'parking');
  assert.equal(r.value.hidden, false);
  assert.equal(r.value.id.length, 14);
  assert.equal(r.value.at, '2026-10-11T00:00:00.000Z');

  assert.match(parsePhoto({ ...PH, complexId: 0 }).error, /단지/);
  assert.match(parsePhoto({ ...PH, type: 'image/gif' }).error, /JPG·PNG·WEBP/);
  assert.match(parsePhoto({ ...PH, type: '' }).error, /JPG·PNG·WEBP/);
  assert.match(parsePhoto({ ...PH, bytes: 0 }).error, /고르지 않았습니다/);
  assert.match(parsePhoto({ ...PH, bytes: PHOTO_MAX_BYTES + 1 }).error, /너무 큽니다/);
  // 「직접 찍었다」를 사람이 한 번 짚고 가게 — 평면도·남의 사진을 막는 첫 관문
  assert.match(parsePhoto({ ...PH, own: false }).error, /직접 찍은 사진/);
  assert.match(parsePhoto({ ...PH, own: undefined }).error, /직접 찍은 사진/);

  assert.equal(parsePhoto({ ...PH, kind: '없는것' }).value.kind, 'etc');
  // 평면도는 보기에 없습니다 — 남의 저작물이라 아예 받지 않습니다
  assert.ok(!PHOTO_KINDS.some(k => /평면도|도면/.test(k.label)));
  assert.deepEqual(Object.values(MIME).sort(), ['jpg', 'png', 'webp']);
});

test('사진 저장 자리와 보관 상한', () => {
  const v = parsePhoto(PH).value;
  assert.equal(photoPath(1001, v.id, v.ext), `album/1001/${v.id}.jpg`);

  let rows = [];
  for (let i = 0; i < PHOTOS_PER_COMPLEX + 3; i++) rows = addPhoto(rows, parsePhoto({ ...PH, caption: '사진 ' + i }).value, 'u');
  assert.equal(rows.length, PHOTOS_PER_COMPLEX);
  assert.equal(rows[0].caption, `사진 ${PHOTOS_PER_COMPLEX + 2}`, '새 사진이 앞에');
});

test('사진 신고 — 세 명이면 감춤, 감춘 것은 목록에서 빠짐', () => {
  let rows = addPhoto([], parsePhoto(PH).value, 'writer');
  const id = rows[0].id;
  rows = reportPhoto(rows, id, 'a').value;
  rows = reportPhoto(rows, id, 'a').value;
  assert.equal(rows[0].reports.length, 1, '같은 사람은 한 번');
  assert.equal(livePhotos(rows).length, 1);
  rows = reportPhoto(rows, id, 'b').value;
  rows = reportPhoto(rows, id, 'c').value;
  assert.equal(rows[0].reports.length, HIDE_REPORTS);
  assert.equal(rows[0].hidden, true);
  assert.equal(livePhotos(rows).length, 0);
  assert.match(reportPhoto(rows, '없는id', 'a').error, /찾지 못/);
});

test('내보내는 값 — 올린 사람·신고자는 나가지 않음', () => {
  let rows = addPhoto([], parsePhoto(PH).value, 'uid-me');
  rows = reportPhoto(rows, rows[0].id, 'spy').value;
  const pub = publicPhoto(rows[0], 'uid-me');
  assert.equal(pub.mine, true);
  assert.equal(pub.kindLabel, '지하주차장');
  assert.doesNotMatch(JSON.stringify(pub), /uid-me|spy/);
  assert.equal(publicPhoto(rows[0], 'other').mine, false);
});

test('규칙 문구 — 왜 안 되는지와 무엇이 지워지는지를 밝힘', () => {
  assert.ok(RULES.some(r => /직접 찍은 사진만/.test(r)));
  assert.ok(RULES.some(r => /평면도/.test(r)), '평면도 금지를 분명히');
  assert.ok(RULES.some(r => /저작물/.test(r)));
  assert.ok(RULES.some(r => /위치 정보가 지워집니다/.test(r)), 'EXIF 가 사라진다는 것을 알림');
  assert.ok(RULES.some(r => /얼굴|번호판/.test(r)));
  for (const r of RULES) assert.doesNotMatch(r, /<[a-z/]/i, '화면이 **굵게**만 알아보므로 태그를 넣지 않음');
});
