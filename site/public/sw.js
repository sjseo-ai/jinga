/* ============================================================================
 *  sw.js — 진가(JINGA) 재테크 PWA 서비스워커
 * ----------------------------------------------------------------------------
 *  · 설치 시 앱 셸(HTML·매니페스트·아이콘)을 프리캐시
 *  · 페이지(HTML)는 네트워크 우선 — 새로 배포하면 바로 반영되고, 오프라인일 때만 캐시본을 보여줌
 *  · CDN 라이브러리(Leaflet·Chart.js·폰트)와 지도 타일은 캐시 우선 + 백그라운드 갱신
 *  · 데이터 API(*.workers.dev 프록시, 환율 API)는 서비스워커가 관여하지 않음 — 캐시된 옛 시세가
 *    "실시간"처럼 보이는 일이 없도록 항상 브라우저가 직접 네트워크로 조회
 *  버전을 올리면(CACHE 값 변경) 이전 캐시는 activate 단계에서 정리됩니다.
 * ========================================================================== */
const CACHE = 'jinga-v6';

const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      // 일부 항목이 없어도 설치가 실패하지 않도록 개별 추가
      .then((c) => Promise.allSettled(SHELL.map((u) => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isDataApi(url) {
  if (url.origin === self.location.origin) return false;
  return url.hostname.endsWith('.workers.dev') || url.hostname.startsWith('api.frankfurter.') || url.hostname === 'api.kbland.kr';
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;          // POST /quotes 등은 그대로 네트워크로

  const url = new URL(req.url);
  if (isDataApi(url)) return;                // 시세·거시지표·뉴스 API는 관여하지 않음
  // 구독 API(확인·해지 안내 페이지 포함)와 관리자 페이지는 캐시하지 않음 — 구독자 정보가 브라우저 캐시에 남지 않게
  if (url.origin === self.location.origin && (url.pathname.startsWith('/api/') || /^\/admin(\.html)?$/.test(url.pathname))) return;

  // 같은 출처의 데이터 파일(KB 단지 목록·구별 집계 JSON)과 앱 코드(.js/.mjs) → 네트워크 우선, 오프라인이면 캐시
  // (앱 코드를 캐시 우선으로 주면, 새 index.html 이 옛 jinga-kb.mjs 를 받아 "…is not a function" 오류가 났음 — 2026-09-11)
  if (url.origin === self.location.origin && /\.(json|m?js)$/.test(url.pathname) && !url.pathname.endsWith('manifest.json')) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // 페이지 이동(HTML) → 네트워크 우선, 실패 시 캐시. 오프라인용 사본은 첫 화면(/, /index.html)일 때만 저장
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok && (url.pathname === '/' || url.pathname === '/index.html')) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put('./index.html', copy));
          }
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match('./index.html')))
    );
    return;
  }

  // 앱 셸·CDN·폰트·지도 타일 → 캐시 우선 + 백그라운드 갱신(stale-while-revalidate)
  e.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          // 200 또는 opaque(교차출처 CDN/타일) 응답은 캐시에 저장
          if (res && (res.status === 200 || res.type === 'opaque')) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
