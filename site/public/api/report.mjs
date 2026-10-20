// 서버가 만든 주간 보고서 웹 보기 — /r/<날짜>/<base|조건ID>.html (vercel.json 이 이 함수로 넘김, 운영 PC가 올린 정적 사본이 있으면 그게 먼저)
// 시세·뉴스만 담긴 보고서라 공개 링크로 두되 검색 노출은 막음. 시험 실행 보고서는 /r/test-<날짜>/…
import { blobStore } from './_blob.mjs';
import { page } from './_core.mjs';

export async function GET(request) {
  const u = new URL(request.url);
  const m = /^(test-)?(\d{4}-\d{2}-\d{2})$/.exec(u.searchParams.get('date') || '');
  const file = u.searchParams.get('file') || '';
  const notFound = () => new Response(page('보고서를 찾을 수 없습니다', '보관 기간(8주)이 지났거나 잘못된 주소입니다.', false), {
    status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' },
  });
  if (!m || !/^(base|[0-9a-f]{10})\.html$/.test(file)) return notFound();
  const html = await blobStore().getText(`weekly/${m[1] ? 'test/' : ''}reports/${m[2]}/${file}`);
  if (!html) return notFound();
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300', 'X-Robots-Tag': 'noindex, nofollow' } });
}
