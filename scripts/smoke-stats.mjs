// 방문 집계(_stats.mjs) 스모크 테스트 — 순수 계산, 네트워크 없음
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isBot, dayKey, refHost, utmSource, deviceKind, emptyMonth, bump, summarize,
  statsPath, recentMonths, MAX_REFS,
} from '../site/public/api/_stats.mjs';

test('봇은 세지 않습니다 — 사람 수가 부풀면 홍보 판단이 틀립니다', () => {
  assert.equal(isBot('Mozilla/5.0 (compatible; Googlebot/2.1)'), true);
  assert.equal(isBot('facebookexternalhit/1.1'), true);
  assert.equal(isBot('kakaotalk-scrap/1.0'), true, '카톡 링크 미리보기');
  assert.equal(isBot('Mozilla/5.0 (compatible; Yeti/1.1)'), true, '네이버 크롤러');
  assert.equal(isBot('curl/8.4.0'), true);
  assert.equal(isBot('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari/605.1'), false);
  assert.equal(isBot(''), false);
  assert.equal(isBot(null), false);
});

test('날짜는 한국 시간 기준 — 새벽 글이 어제로 잡히면 안 됩니다', () => {
  // 2026-10-12 23:30 UTC = 한국 10-13 08:30
  assert.equal(dayKey(new Date('2026-10-12T23:30:00Z')), '2026-10-13');
  // 2026-10-12 00:30 UTC = 한국 09:30 같은 날
  assert.equal(dayKey(new Date('2026-10-12T00:30:00Z')), '2026-10-12');
});

test('어디서 왔는지 — 호스트만, 사이트 안 이동은 세지 않음', () => {
  assert.equal(refHost('https://blog.naver.com/tjtlswns95/12345', 'jinga-retech.vercel.app'), 'blog.naver.com');
  assert.equal(refHost('https://www.google.com/search?q=x', 'jinga-retech.vercel.app'), 'google.com', 'www 는 뗍니다');
  assert.equal(refHost('', 'jinga-retech.vercel.app'), '직접');
  assert.equal(refHost(null, 'jinga-retech.vercel.app'), '직접');
  assert.equal(refHost('https://jinga-retech.vercel.app/legal.html', 'jinga-retech.vercel.app'), null, '우리 사이트 안');
  assert.equal(refHost('어쩌구저쩌구', 'jinga-retech.vercel.app'), '기타', '주소가 아니면');
});

test('utm_source 꼬리표', () => {
  assert.equal(utmSource('https://jinga-retech.vercel.app/?utm_source=naverblog'), 'naverblog');
  assert.equal(utmSource('https://jinga-retech.vercel.app/?utm_source=GeekNews'), 'geeknews', '대소문자 안 가림');
  assert.equal(utmSource('https://jinga-retech.vercel.app/'), null);
  assert.equal(utmSource('/?utm_source='), null, '빈 값은 없는 것');
  assert.equal(utmSource(null), null);
});

test('휴대폰인지는 화면 폭으로만', () => {
  assert.equal(deviceKind(390), 'mobile');
  assert.equal(deviceKind(767), 'mobile');
  assert.equal(deviceKind(768), 'desktop');
  assert.equal(deviceKind(1920), 'desktop');
  assert.equal(deviceKind(0), 'desktop', '모르면 PC 로 둡니다');
  assert.equal(deviceKind(null), 'desktop');
});

test('한 번 더하기 — 원본을 바꾸지 않습니다', () => {
  const a = emptyMonth('2026-10');
  const b = bump(a, { day: '2026-10-12', ref: 'blog.naver.com', utm: 'naverblog', device: 'mobile' });
  assert.equal(a.total, 0, '원본 그대로');
  assert.equal(b.total, 1);
  assert.equal(b.days['2026-10-12'], 1);
  assert.equal(b.refs['blog.naver.com'], 1);
  assert.equal(b.utm.naverblog, 1);
  assert.equal(b.device.mobile, 1);

  const c = bump(b, { day: '2026-10-12', ref: 'blog.naver.com', device: 'desktop' });
  assert.equal(c.total, 2);
  assert.equal(c.days['2026-10-12'], 2);
  assert.equal(c.refs['blog.naver.com'], 2);
  assert.equal(c.device.desktop, 1);
  assert.equal(c.utm.naverblog, 1, 'utm 없는 방문은 utm 을 늘리지 않음');
});

test('빈 통에도 더할 수 있어야 합니다(첫 방문)', () => {
  const s = bump(null, { day: '2026-10-12', ref: '직접', device: 'desktop' });
  assert.equal(s.month, '2026-10');
  assert.equal(s.total, 1);
  assert.equal(s.refs['직접'], 1);
});

test('유입처가 너무 많아지면 「기타」로 모읍니다', () => {
  let s = emptyMonth('2026-10');
  for (let i = 0; i < MAX_REFS + 20; i++) s = bump(s, { day: '2026-10-12', ref: `site${i}.com`, device: 'desktop' });
  assert.equal(Object.keys(s.refs).length, MAX_REFS + 1, `${MAX_REFS}개 + 기타`);
  assert.equal(s.refs['기타'], 20);
  assert.equal(s.total, MAX_REFS + 20, '합계는 그대로');
});

test('운영자 화면용 묶기 — 날짜는 순서대로, 유입처는 많은 것부터', () => {
  let a = emptyMonth('2026-09');
  a = bump(a, { day: '2026-09-30', ref: 'google.com', device: 'desktop' });
  let b = emptyMonth('2026-10');
  for (let i = 0; i < 5; i++) b = bump(b, { day: '2026-10-12', ref: 'blog.naver.com', device: 'mobile' });
  b = bump(b, { day: '2026-10-11', ref: 'google.com', device: 'desktop' });

  const s = summarize([b, a]);
  assert.equal(s.total, 7);
  assert.deepEqual(s.months, ['2026-09', '2026-10']);
  assert.deepEqual(s.days.map(d => d.day), ['2026-09-30', '2026-10-11', '2026-10-12'], '오래된 것부터');
  assert.deepEqual(s.refs[0], { key: 'blog.naver.com', n: 5 }, '많은 것이 앞');
  assert.deepEqual(s.refs[1], { key: 'google.com', n: 2 }, '두 달치가 합쳐집니다');
  assert.deepEqual(s.device, [{ key: 'mobile', n: 5 }, { key: 'desktop', n: 2 }]);
  assert.deepEqual(summarize([]), { total: 0, months: [], days: [], refs: [], utm: [], device: [] });
  assert.deepEqual(summarize(null).days, []);
});

test('파일 이름과 최근 달 목록', () => {
  assert.equal(statsPath('2026-10'), 'stats/2026-10.json');
  assert.deepEqual(recentMonths(3, new Date('2026-10-12T05:00:00Z')), ['2026-10', '2026-09', '2026-08']);
  assert.deepEqual(recentMonths(3, new Date('2026-01-15T05:00:00Z')), ['2026-01', '2025-12', '2025-11'], '해를 넘길 때');
  // 한국 시간으로 달이 바뀌는 경계 — 10-31 20:00 UTC = 한국 11-01
  assert.equal(recentMonths(1, new Date('2026-10-31T20:00:00Z'))[0], '2026-11');
});
