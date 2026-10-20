// 지역 지도용 KB시세 구·동 집계 — 서버 주간 작업이 갱신한 weekly/kb-seoul-gu.json (없으면 404 → 페이지가 정적 kb-seoul-gu.json 사용)
import { blobStore } from './_blob.mjs';

export async function GET() {
  const text = await blobStore().getText('weekly/kb-seoul-gu.json');
  if (!text) return new Response(JSON.stringify({ ok: false, error: 'not yet' }), { status: 404, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
  return new Response(text, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=300, s-maxage=600' } });
}
