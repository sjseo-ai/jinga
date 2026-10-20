// 연간 누적 기록 조회 — api/_annual.mjs (주간 운영 실행이 annual/<연도>.json 에 쌓음)
//   GET /api/annual               → { years, area: 가장 최근 연도의 서울·구·동 요약 }
//   GET /api/annual?year=2026     → 그해 서울·구·동 요약
//   GET /api/annual?ids=1293,32148 → 단지별 연도별 주택형 변동(최대 30곳)
// KB시세 집계라 공개해도 되는 값만 담김(구독자 정보 없음)
import { blobStore } from './_blob.mjs';
import { ANNUAL_PREFIX, annualPath, annualAreaView, complexYearView } from './_annual.mjs';

const json = (body, status, cache) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': cache },
});
const CACHE = 'public, max-age=600, s-maxage=3600, stale-while-revalidate=86400';

export async function GET(request) {
  const store = blobStore();
  const q = new URL(request.url).searchParams;
  try {
    const years = (await store.list(ANNUAL_PREFIX))
      .map(p => Number(p.slice(ANNUAL_PREFIX.length).replace(/\.json$/, '')))
      .filter(y => Number.isInteger(y) && y > 2000)
      .sort((a, b) => a - b);
    if (!years.length) return json({ ok: true, years: [], note: '아직 쌓인 연간 기록이 없습니다 — 매주 운영 실행이 끝나면 생깁니다' }, 200, 'public, max-age=300');

    const ids = [...new Set(String(q.get('ids') || '').split(',').map(s => Number(s.trim())).filter(n => Number.isInteger(n) && n > 0))].slice(0, 30);
    if (ids.length) {
      const complexes = {};
      for (const y of years) {
        const rec = await store.get(annualPath(y));
        for (const id of ids) {
          const v = complexYearView(rec, id);
          if (v) (complexes[id] = complexes[id] || {})[y] = v;
        }
      }
      return json({ ok: true, years, complexes }, 200, CACHE);
    }

    const year = Number(q.get('year')) || years[years.length - 1];
    if (!years.includes(year)) return json({ ok: false, years, error: `${year}년 기록이 없습니다` }, 404, 'no-store');
    return json({ ok: true, years, area: annualAreaView(await store.get(annualPath(year))) }, 200, CACHE);
  } catch (e) {
    return json({ ok: false, error: `연간 기록을 읽지 못했습니다: ${e.message}` }, 502, 'no-store');
  }
}
