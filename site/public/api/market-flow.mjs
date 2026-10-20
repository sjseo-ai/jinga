// 시장 흐름 대시보드 데이터 — GET /api/market-flow
// KB 주택가격동향(주간·월간)과 시장금리를 한 번에 돌려줌. CDN이 3시간 보관, 함수 메모리도 3시간 — api/_flow.mjs
import { createFlowSource } from './_flow.mjs';

const source = createFlowSource();

const json = (body, status, cache) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': cache },
});

export async function GET() {
  try {
    const data = await source.get();
    return json({ ok: true, ...data }, 200, 'public, max-age=900, s-maxage=10800, stale-while-revalidate=86400');
  } catch (e) {
    return json({ ok: false, error: `시장 지표를 불러오지 못했습니다: ${e.message}` }, 502, 'no-store');
  }
}
