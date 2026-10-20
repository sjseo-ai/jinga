// 주요 지수 구성종목 히트맵 데이터 — GET /api/market-map?index=KOSPI|KOSDAQ|DJI|SPX|NDX
// 응답은 CDN이 1분 보관(그동안은 원천을 다시 부르지 않음), 구성종목 목록은 함수 메모리에 12시간 보관 — api/_market.mjs
import { createMarketSource, INDEXES } from './_market.mjs';

const source = createMarketSource();

const json = (body, status, cache) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': cache },
});

export async function GET(request) {
  const index = String(new URL(request.url).searchParams.get('index') || '').toUpperCase();
  if (!INDEXES[index]) return json({ ok: false, error: `index 는 ${Object.keys(INDEXES).join('·')} 중 하나여야 합니다` }, 400, 'no-store');
  try {
    const data = await source.load(index);
    return json({ ok: true, ...data }, 200, 'public, max-age=30, s-maxage=60, stale-while-revalidate=300');
  } catch (e) {
    return json({ ok: false, index, error: `${INDEXES[index].label} 구성종목을 불러오지 못했습니다: ${e.message}` }, 502, 'no-store');
  }
}
