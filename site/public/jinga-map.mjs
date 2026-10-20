// 추천 단지 지도 — 단지 검색 BEST 5 · 매물 추천 TOP 5 의 위치를 한 화면에 찍습니다.
// 지도는 두 가지 중 하나로 그립니다.
//   · 카카오맵 — map-key.json(= scripts/kakao-key.mjs 로 저장한 JavaScript 키)이 있으면 이쪽. 한글 지명·건물 표기가 가장 정확
//   · Leaflet + OpenStreetMap — 키가 없을 때(기본). 계정 없이 바로 동작
// 좌표는 KB 단지 상세에서 받아 둔 위경도(kb-*-complexes.json 의 lat·lng)를 씁니다 — 지오코딩 호출이 없습니다.

const LEAFLET_JS = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js';
const LEAFLET_CSS = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css';
const TILE = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTR = '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> 기여자';

// ── 카카오맵(키가 있을 때) ───────────────────────────────────
let keyPromise = null;
/** map-key.json 읽기 — 없으면 null(그러면 OpenStreetMap 으로) */
export function loadMapKey() {
  if (!keyPromise) {
    keyPromise = fetch('map-key.json', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(j => (j && j.provider === 'kakao' && j.key ? j.key : null))
      .catch(() => null);
  }
  return keyPromise;
}

let kakaoLoading = null;
export function loadKakao(key) {
  if (window.kakao && window.kakao.maps && window.kakao.maps.Map) return Promise.resolve(window.kakao);
  if (kakaoLoading) return kakaoLoading;
  kakaoLoading = new Promise((resolve, reject) => {
    const js = Object.assign(document.createElement('script'), {
      src: `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(key)}&autoload=false`, async: true,
    });
    js.onload = () => {
      if (!window.kakao || !window.kakao.maps) return reject(new Error('카카오 지도 SDK 를 읽지 못했습니다'));
      window.kakao.maps.load(() => resolve(window.kakao));   // autoload=false 라 여기서 실제 로딩
    };
    js.onerror = () => reject(new Error('카카오 지도 SDK 를 내려받지 못했습니다(도메인 등록을 확인해 주세요)'));
    document.head.appendChild(js);
  });
  return kakaoLoading;
}

/** 카카오맵으로 그리기 — 번호 마커 + 말풍선 */
async function drawKakao(el, pts, key, { maxLevel = 6, extras = [], radiusM = 0 } = {}) {
  const kakao = await loadKakao(key);
  el.innerHTML = '';
  const first = new kakao.maps.LatLng(Number(pts[0].lat), Number(pts[0].lng));
  const map = new kakao.maps.Map(el, { center: first, level: 5 });
  const bounds = new kakao.maps.LatLngBounds();
  let open = null;
  pts.forEach(p => {
    const pos = new kakao.maps.LatLng(Number(p.lat), Number(p.lng));
    bounds.extend(pos);
    // CustomOverlay 는 클릭 이벤트가 따로 없어, 내용을 DOM 요소로 만들어 거기에 직접 답니다
    const box = document.createElement('div');
    box.innerHTML = pinHtml(p.label, p.kind);
    const info = new kakao.maps.InfoWindow({ position: pos, content: popupHtml(p), removable: true });
    box.addEventListener('click', () => { if (open) open.close(); info.open(map); open = info; });
    new kakao.maps.CustomOverlay({ position: pos, yAnchor: 1, zIndex: p.kind === 'top' ? 3 : 2, content: box }).setMap(map);
  });
  if (radiusM > 0) pts.filter(p => p.showRadius !== false).forEach(p => {
    new kakao.maps.Circle({
      center: new kakao.maps.LatLng(Number(p.lat), Number(p.lng)), radius: radiusM,
      strokeWeight: 1, strokeColor: '#1E5FCC', strokeOpacity: 0.45, fillColor: '#1E5FCC', fillOpacity: 0.05,
    }).setMap(map);
  });
  (extras || []).forEach(f => {
    const pos = new kakao.maps.LatLng(Number(f.lat), Number(f.lng));
    bounds.extend(pos);
    const box = document.createElement('div');
    box.innerHTML = chipHtml(f);
    const info = new kakao.maps.InfoWindow({ position: pos, content: chipPopup(f), removable: true });
    box.addEventListener('click', () => { if (open) open.close(); info.open(map); open = info; });
    new kakao.maps.CustomOverlay({ position: pos, yAnchor: 0.5, zIndex: 1, content: box }).setMap(map);
  });

  if (pts.length === 1) map.setLevel(4);
  else { map.setBounds(bounds); if (map.getLevel() > maxLevel) map.setLevel(maxLevel); }

  wheelGate(el, v => map.setZoomable(v));

  // 거리 재기 — 카카오는 Polyline.getLength() 가 실제 지구 거리를 돌려줍니다
  let pins = [], line = null, dots = [], tools = null, clickHandler = null;
  const redraw = () => {
    if (line) line.setMap(null);
    line = null;
    if (pins.length >= 2) {
      line = new kakao.maps.Polyline({ path: pins, strokeWeight: 3, strokeColor: '#D14343', strokeOpacity: 0.85, strokeStyle: 'shortdash' });
      line.setMap(map);
    }
    const total = line ? line.getLength() : 0;
    if (tools) tools.show(pins.length < 2 ? '한 점 더 찍으면 거리가 나옵니다' : `${pins.length}점 · ${distText(total)}`);
  };
  const clear = () => {
    if (line) line.setMap(null);
    dots.forEach(d => d.setMap(null));
    pins = []; dots = []; line = null;
  };
  tools = toolbar(el, {
    toggle(on) {
      tools.setOn(on);
      if (on) {
        clickHandler = e => {
          pins.push(e.latLng);
          const dot = new kakao.maps.CustomOverlay({ position: e.latLng, yAnchor: 0.5, zIndex: 5,
            content: '<span style="display:block;width:9px;height:9px;border-radius:50%;background:#fff;border:2px solid #D14343"></span>' });
          dot.setMap(map); dots.push(dot);
          redraw();
        };
        kakao.maps.event.addListener(map, 'click', clickHandler);
      } else if (clickHandler) {
        kakao.maps.event.removeListener(map, 'click', clickHandler);
        clickHandler = null;
        clear();
      }
    },
    clear,
  });

  setTimeout(() => map.relayout(), 60);
  return { map, remove: () => { el.innerHTML = ''; } };
}

let loading = null;
/** Leaflet 을 한 번만 불러옴 — CDN 이 막히면 그대로 실패시키고 부르는 쪽에서 안내 */
export function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    if (!document.querySelector(`link[href="${LEAFLET_CSS}"]`)) {
      const css = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: LEAFLET_CSS });
      document.head.appendChild(css);
    }
    const js = Object.assign(document.createElement('script'), { src: LEAFLET_JS, async: true });
    js.onload = () => (window.L ? resolve(window.L) : reject(new Error('Leaflet 을 읽지 못했습니다')));
    js.onerror = () => reject(new Error('지도 라이브러리를 내려받지 못했습니다'));
    document.head.appendChild(js);
  });
  return loading;
}

/** 두 위경도 사이 직선거리(m) */
export function distM(lat1, lng1, lat2, lng2) {
  const k = Math.PI / 180, x = (lng2 - lng1) * k * Math.cos(((lat1 + lat2) / 2) * k), y = (lat2 - lat1) * k;
  return Math.sqrt(x * x + y * y) * 6371e3;
}
export const WALK_M_PER_MIN = 70;
/** 340m → '340m · 도보 5분' · 1,240m → '1.24km · 도보 18분' */
export function distText(m) {
  const min = Math.max(1, Math.round(m / WALK_M_PER_MIN));
  return `${m >= 1000 ? (m / 1000).toFixed(2) + 'km' : Math.round(m) + 'm'} · 도보 ${min}분`;
}

/**
 * 지도 위 도구 막대 — 「거리 재기」와 휠 확대 안내.
 * ctrl: { start(), addPoint 는 지도 쪽에서 부름, clear(), setZoom(on) } 를 받아 버튼만 그립니다.
 */
function toolbar(el, ctrl) {
  const bar = document.createElement('div');
  bar.className = 'jg-tools';
  bar.innerHTML = `<button type="button" class="jg-tool" data-act="measure">거리 재기</button>
    <button type="button" class="jg-tool" data-act="clear" hidden>지우기</button>
    <span class="jg-tool-out" hidden></span>`;
  const btn = bar.querySelector('[data-act="measure"]');
  const clearBtn = bar.querySelector('[data-act="clear"]');
  const out = bar.querySelector('.jg-tool-out');
  const api = {
    on: false,
    setOn(v, { keep = false } = {}) {
      api.on = v;
      btn.classList.toggle('on', v);
      btn.textContent = v ? '재는 중 — 그만' : '거리 재기';
      el.classList.toggle('jg-measuring', v);
      clearBtn.hidden = !v && !keep;         // 재기를 끝내도 결과가 남아 있으면 「지우기」는 남겨 둠
      out.hidden = !v && !keep;
      if (v) out.textContent = '지도를 눌러 점을 찍으세요(두 번 누르면 끝)';
    },
    show(text) { out.hidden = false; out.textContent = text; },
  };
  bar.addEventListener('click', e => {
    const b = e.target.closest('.jg-tool');
    if (!b) return;
    if (b.dataset.act === 'measure') { ctrl.toggle(!api.on); }
    else { ctrl.clear(); api.show('지도를 눌러 점을 찍으세요(두 번 누르면 끝)'); }
  });
  // 도구 막대는 지도 위에 얹혀 있어, 버튼을 누르면 지도 클릭으로도 전달돼 점이 하나 더 찍힙니다 → 여기서 막음
  ['click', 'mousedown', 'dblclick', 'wheel', 'touchstart'].forEach(t => bar.addEventListener(t, e => e.stopPropagation()));
  el.appendChild(bar);
  return api;
}

/** 휠 확대 안내막 — 지도를 한 번 누르면 휠 확대가 켜지고, 지도 밖으로 나가면 다시 꺼져 페이지 스크롤을 방해하지 않습니다 */
function wheelGate(el, setZoom) {
  const veil = document.createElement('div');
  veil.className = 'jg-wheel-hint';
  veil.textContent = '지도를 한 번 누르면 휠로 확대·축소';
  el.appendChild(veil);
  let on = false;
  const set = v => { if (on === v) return; on = v; setZoom(v); veil.hidden = v; };
  set(false);
  el.addEventListener('mousedown', () => set(true));
  el.addEventListener('touchstart', () => set(true), { passive: true });
  el.addEventListener('mouseleave', () => set(false));
  return { set };
}

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const hasCoords = p => Number.isFinite(Number(p && p.lat)) && Number.isFinite(Number(p && p.lng));

/** 여러 지점을 모두 담는 중심·줌 — 지점이 하나면 그 지점 */
export function boundsOf(points) {
  const pts = points.filter(hasCoords);
  if (!pts.length) return null;
  const lats = pts.map(p => Number(p.lat)), lngs = pts.map(p => Number(p.lng));
  return [[Math.min(...lats), Math.min(...lngs)], [Math.max(...lats), Math.max(...lngs)]];
}

/** 번호가 찍힌 마커 모양(1등은 진한 파랑, 기준 집은 회색) — 두 지도가 같이 씁니다 */
function pinHtml(label, kind) {
  const bg = kind === 'target' ? '#5A6B7D' : kind === 'top' ? '#1E5FCC' : '#2C7BE5';
  return `<span class="jg-pin" style="display:grid;place-items:center;width:30px;height:30px;border-radius:50% 50% 50% 4px;transform:rotate(-45deg);cursor:pointer;
    background:${bg};color:#fff;font:700 13px/1 system-ui,-apple-system,'Malgun Gothic',sans-serif;box-shadow:0 2px 6px rgba(0,0,0,.35);border:2px solid #fff">
    <b style="transform:rotate(45deg)">${esc(label)}</b></span>`;
}
/** 역·초등학교처럼 곁들여 찍는 시설 — 이름과 도보 분을 바로 읽을 수 있게 알약 모양으로 */
function chipHtml(f) {
  const st = f.kind === 'station';
  const bg = st ? '#0F9D58' : '#E8820C';
  return `<span class="jg-chip" style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:999px;white-space:nowrap;cursor:pointer;
    background:${bg};color:#fff;font:700 11px/1.35 system-ui,-apple-system,'Malgun Gothic',sans-serif;box-shadow:0 1px 4px rgba(0,0,0,.3);border:1.5px solid #fff">
    ${st ? '🚇' : '🏫'} ${esc(f.short || f.name)} ${esc(String(f.min))}분</span>`;
}
const chipPopup = f => `<div style="padding:8px 11px;font-size:12.5px;line-height:1.6;min-width:150px">
  <b>${esc(f.name)}</b>${f.lines && f.lines.length ? ` <span style="color:#5A6B7D">${esc(f.lines.join('·'))}</span>` : ''}
  <br><span style="color:#5A6B7D">${esc(f.from || '')} 기준 ${esc(String(f.m))}m · 도보 ${esc(String(f.min))}분${f.zone ? ' · 배정 초등학교' : ''}</span>
  <br><span style="color:#8A97A6;font-size:11px">직선거리 기준(분당 70m) — 실제 길은 더 깁니다</span></div>`;

const popupHtml = p => `<div style="padding:9px 12px;font-size:13px;line-height:1.6;min-width:160px">
  <b>${esc(p.title)}</b>${p.sub ? `<br><span style="color:#5A6B7D">${esc(p.sub)}</span>` : ''}
  <br><a href="https://map.kakao.com/?q=${encodeURIComponent(p.query || p.title)}" target="_blank" rel="noopener">카카오맵에서 보기</a></div>`;

/** 번호가 찍힌 동그란 마커(Leaflet 용) */
function markerIcon(L, label, kind) {
  return L.divIcon({ className: 'jg-pin-wrap', html: pinHtml(label, kind), iconSize: [30, 30], iconAnchor: [15, 28], popupAnchor: [0, -26] });
}

/**
 * 지도 그리기
 * extras: 곁들여 찍을 시설 [{ lat, lng, kind:'station'|'elem', name, short, m, min, lines, from, zone }]
 * radiusM: 각 추천 단지에 그릴 도보 반경(m) — 0이면 안 그림
 */
export async function drawMap(el, points, { padding = 40, maxZoom = 17, extras = [], radiusM = 0 } = {}) {
  const pts = (points || []).filter(hasCoords);
  if (!el) return null;
  if (el._jgMap) { if (el._jgKind !== 'kakao' && el._jgMap.remove) el._jgMap.remove(); el.innerHTML = ''; el._jgMap = null; }
  if (!pts.length) { el.innerHTML = '<div class="jg-map-empty">좌표를 아는 단지가 없어 지도를 그리지 못했습니다.</div>'; return null; }

  const key = await loadMapKey();
  if (key) {
    try { const r = await drawKakao(el, pts, key, { extras, radiusM }); el._jgMap = r.map; el._jgKind = 'kakao'; return r; }
    catch (e) { console.warn('카카오맵을 쓰지 못해 OpenStreetMap 으로 그립니다:', e.message); }
  }

  const L = await loadLeaflet();
  el.innerHTML = '';
  const map = L.map(el, { scrollWheelZoom: false, attributionControl: true });
  L.tileLayer(TILE, { maxZoom: 19, attribution: TILE_ATTR }).addTo(map);
  const layer = L.featureGroup().addTo(map);
  pts.forEach(p => {
    const m = L.marker([Number(p.lat), Number(p.lng)], { icon: markerIcon(L, p.label, p.kind), title: p.title, alt: p.title });
    m.bindPopup(popupHtml(p));
    m.addTo(layer);
  });
  // 역·초등학교 알약 마커
  (extras || []).forEach(f => {
    const icon = L.divIcon({ className: 'jg-chip-wrap', html: chipHtml(f), iconSize: null, iconAnchor: [0, 10] });
    L.marker([Number(f.lat), Number(f.lng)], { icon, title: f.name, zIndexOffset: -100 }).bindPopup(chipPopup(f)).addTo(layer);
  });

  // 화면 범위는 좌표에서 직접 — 원은 지도 뷰가 정해진 뒤에야 그릴 수 있어 여기서는 빼고 셈합니다
  const all = [...pts, ...(extras || [])].map(p => [Number(p.lat), Number(p.lng)]);
  const b = L.latLngBounds(all);
  if (pts.length === 1 && !(extras || []).length) map.setView(b.getCenter(), 16);
  else map.fitBounds(b, { padding: [padding, padding], maxZoom });

  // 도보 반경(옅은 원) — 뷰가 정해진 뒤에 올립니다
  if (radiusM > 0) pts.filter(p => p.showRadius !== false).forEach(p => {
    L.circle([Number(p.lat), Number(p.lng)], { radius: radiusM, color: '#1E5FCC', weight: 1, opacity: .45, fillColor: '#1E5FCC', fillOpacity: .05, interactive: false }).addTo(layer);
  });
  // 마우스 휠 확대 — 지도를 누르기 전까지는 꺼 두어 페이지 스크롤을 가로채지 않음
  wheelGate(el, v => (v ? map.scrollWheelZoom.enable() : map.scrollWheelZoom.disable()));

  // 거리 재기 — 지도를 눌러 점을 찍으면 선과 누적 거리를 보여 줌
  const mLayer = L.layerGroup().addTo(map);
  let pins = [], line = null, tools = null;
  const redraw = () => {
    if (line) { mLayer.removeLayer(line); line = null; }
    if (pins.length >= 2) line = L.polyline(pins, { color: '#D14343', weight: 3, opacity: .85, dashArray: '6 4' }).addTo(mLayer);
    let total = 0;
    for (let i = 1; i < pins.length; i++) total += distM(pins[i - 1][0], pins[i - 1][1], pins[i][0], pins[i][1]);
    if (tools) tools.show(pins.length < 2 ? '한 점 더 찍으면 거리가 나옵니다' : `${pins.length}점 · ${distText(total)}`);
    return total;
  };
  const onClick = e => {
    pins.push([e.latlng.lat, e.latlng.lng]);
    L.circleMarker(e.latlng, { radius: 4, color: '#D14343', fillColor: '#fff', fillOpacity: 1, weight: 2 }).addTo(mLayer);
    redraw();
  };
  const clear = () => { mLayer.clearLayers(); pins = []; line = null; };
  const stop = () => {                        // 두 번 누르면 재기 끝 — 선은 남겨 둡니다
    map.off('click', onClick);
    map.off('dblclick', stop);
    map.doubleClickZoom.enable();
    tools.setOn(false, { keep: true });
  };
  tools = toolbar(el, {
    toggle(on) {
      if (on) {
        clear();
        tools.setOn(true);
        map.on('click', onClick);
        map.on('dblclick', stop);
        map.doubleClickZoom.disable();       // 점 찍는 중에는 두 번 눌러도 확대되지 않게
      } else {
        stop();
        clear();
      }
    },
    clear,
  });

  // 지도가 숨겨진 상태로 만들어지면 크기를 못 잡아 회색으로 보임 → 다음 프레임에 한 번 다시 계산
  setTimeout(() => map.invalidateSize(), 60);
  el._jgMap = map;
  return { map, remove: () => { map.remove(); el._jgMap = null; } };
}
