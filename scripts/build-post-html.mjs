// 연재 초안(.txt) → 네이버 붙여넣기용 HTML
//
//   node scripts/build-post-html.mjs            연재 폴더의 .txt 전부
//   node scripts/build-post-html.mjs 노원구      한 편만
//
// 왜 만드나 — 첫 회차(노원구)를 .txt 에서 복사해 올렸더니 굵게 표시하려던 **별표가
// 그대로 글자로 나왔습니다**(32개). 네이버 편집기는 마크다운을 모릅니다.
// 브라우저에 띄운 HTML 에서 복사하면 굵게·소제목·목록이 서식 그대로 넘어갑니다.
//
// 사진은 미리보기에 끼워 넣어 **어디에 들어갈지 보여 주기만** 합니다.
// 네이버는 붙여넣기로 사진을 받지 않으므로, 올릴 때는 「사진_<자치구>」 폴더에서 직접 끌어다 놓아야 합니다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(process.env.USERPROFILE || process.env.HOME || ROOT,
  'OneDrive', '바탕 화면', '진가 블로그 발행본', '연재');

const H = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => H[c]);

/** **굵게** 와 주소를 서식으로 */
function inline(t) {
  let h = esc(t);
  h = h.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  h = h.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>');
  return h;
}

/** 어느 소제목 끝에 어떤 사진이 들어가는지 */
const PHOTOS = [
  { after: '평당 얼마인가', file: '1_평당가.png', cap: '구 페이지 — 평당가와 동네별 시세' },
  { after: '주차', file: '2_주차.png', cap: '주차가 넉넉한 단지 / 빠듯한 단지 (국토교통부 공식 자료)' },
  { after: '주차', file: '3_단지.png', cap: '그 구에서 주차가 가장 빠듯한 단지' },
  { after: '직접 조건 넣어 보기', file: '4_검색결과.png', cap: '앱에서 그 구로 검색한 결과 — 진가 BEST 5와 지도' },
];

/** 들여쓴 「1. 」·「· 」 묶음을 목록으로 */
function listBlock(lines) {
  const ordered = /^\s*\d+\./.test(lines[0]);
  const items = lines.map(l => inline(l.replace(/^\s*(?:\d+\.|·)\s*/, '')));
  return `<${ordered ? 'ol' : 'ul'}>${items.map(i => `<li>${i}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>`;
}

function bodyToHtml(body, gu) {
  const out = [];
  const blocks = body.split(/\n\s*\n/);
  let section = '';
  const pending = [];

  const flushPhotos = () => {
    while (pending.length) {
      const p = pending.shift();
      out.push(`<figure><img src="사진_${gu}/${p.file}" alt="${esc(p.cap)}">`
        + `<figcaption><b>↑ 여기에 ${esc(p.file)} 넣기</b> — ${esc(p.cap)}<br><span class="del">※ 이 줄은 네이버에 붙여넣은 뒤 지우세요</span></figcaption></figure>`);
    }
  };

  for (const raw of blocks) {
    const block = raw.replace(/\s+$/, '');
    if (!block.trim()) continue;
    const lines = block.split('\n').filter(l => l.trim());

    // 새 소제목을 만나면, 앞 구간에 걸린 사진을 먼저 내보냅니다
    if (lines[0].startsWith('■ ')) {
      flushPhotos();
      section = lines[0].slice(2).trim();
      out.push(`<h2>${inline(section)}</h2>`);
      for (const p of PHOTOS) if (section.includes(p.after)) pending.push(p);
      // 소제목 줄 뒤에 같은 묶음으로 붙은 글이 있으면 이어서 처리
      lines.shift();
      if (!lines.length) continue;
    }

    if (/^\s*(?:\d+\.|·)\s/.test(lines[0])) { out.push(listBlock(lines)); continue; }
    if (lines[0].startsWith('※')) { out.push(`<p class="note">${lines.map(inline).join('<br>')}</p>`); continue; }
    out.push(`<p>${lines.map(inline).join('<br>')}</p>`);
  }
  flushPhotos();
  return out.join('\n');
}

const page = (gu, titles, body, tail) => `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(gu)} 연재 — 네이버 붙여넣기용</title>
<style>
  body{margin:0;padding:36px 16px 72px;background:#f4f5f7;color:#1c1f23;line-height:1.85;font-size:16px;
    font-family:"맑은 고딕","Malgun Gothic",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
  .how,article{max-width:820px;margin:0 auto}
  .how{background:#fffbe6;border:1px solid #f0d98c;border-radius:10px;padding:16px 20px;margin-bottom:24px;
    font-size:14px;line-height:1.75;color:#5c4813}
  .how b{color:#3d2f06}
  .how ol,.how ul{margin:6px 0 0;padding-left:20px}
  .how .t{margin:10px 0 0;padding-top:10px;border-top:1px solid #ecdca4}
  article{background:#fff;border:1px solid #e3e5e9;border-radius:12px;padding:40px 44px 52px}
  h2{font-size:21px;margin:38px 0 12px;padding-top:20px;border-top:2px solid #eceef1;letter-spacing:-.3px}
  h2:first-of-type{border-top:0;padding-top:0;margin-top:0}
  p{margin:0 0 15px}
  ol,ul{margin:0 0 16px;padding-left:22px}
  li{margin-bottom:6px}
  .note{font-size:14.5px;color:#5a5f66;background:#f6f7f9;border-left:3px solid #c9ced6;padding:11px 15px;border-radius:0 6px 6px 0}
  figure{margin:20px 0 24px}
  figure img{display:block;width:100%;height:auto;border:1px solid #e3e5e9;border-radius:8px}
  figcaption{font-size:12.5px;color:#b06a00;text-align:center;margin-top:7px;background:#fff6e5;border:1px dashed #f0c98c;border-radius:6px;padding:7px 10px}
  figcaption .del{color:#c0392b;font-weight:700}
  a{color:#1b64da}
</style>
</head>
<body>

<div class="how">
  <b>${esc(gu)} 연재 — 네이버에 올릴 때 쓰는 미리보기입니다.</b>
  <ol>
    <li>이 안내 상자 <b>아래부터</b> 드래그해 선택 → <b>Ctrl+C</b> → 네이버 글쓰기 본문에 <b>Ctrl+V</b>.
        굵은 글씨·소제목·목록이 그대로 넘어갑니다. (.txt 를 복사하면 <b>별표(**)가 글자로 보입니다</b>)</li>
    <li><b>사진은 따라가지 않습니다.</b> 아래 보이는 자리에 「사진_${esc(gu)}」 폴더의 파일을 끌어다 놓으세요.</li>
    <li><b style="color:#c0392b">주황색 점선 줄은 꼭 지우세요.</b> 사진 자리를 알려 주려고 넣은 것이라, 남겨 두면 독자에게 파일 이름이 그대로 보입니다(1·2회차에서 실제로 그랬습니다).</li>
  </ol>
  <div class="t"><b>제목 후보</b>
    <ol>${titles.map(t => `<li>${esc(t)}</li>`).join('')}</ol>
  </div>
  ${tail}
</div>

<article>
${body}
</article>
</body>
</html>
`;

function convert(file) {
  const txt = fs.readFileSync(file, 'utf8');
  const gu = (path.basename(file, '.txt').split('_')[1]) || path.basename(file, '.txt');

  const start = txt.indexOf('여기서부터 본문');
  const end = txt.indexOf('본문 끝');
  if (start < 0 || end < 0) return null;
  const body = txt.slice(txt.indexOf('\n', start) + 1, txt.lastIndexOf('\n', end)).trim();

  const titles = (txt.slice(0, start).match(/^\s*\d+\.\s*(.+)$/gm) || [])
    .map(l => l.replace(/^\s*\d+\.\s*/, '').trim());

  // 꼬리(태그·확인)는 노란 상자에 넣습니다 — 본문에 들어가면 안 됩니다
  const tagLine = (txt.match(/【태그】\s*\n\s*(.+)/) || [])[1] || '';
  const checks = (txt.slice(txt.indexOf('【확인】')).split('\n').slice(1).map(l => l.trim()).filter(l => l.startsWith('·')));
  const tail = `<div class="t"><b>태그</b><br>${esc(tagLine)}</div>`
    + (checks.length ? `<div class="t"><b>확인</b><ul>${checks.map(c => `<li>${esc(c.replace(/^·\s*/, ''))}</li>`).join('')}</ul></div>` : '');

  const html = page(gu, titles, bodyToHtml(body, gu), tail);
  const out = file.replace(/\.txt$/, '.html');
  fs.writeFileSync(out, html);
  return { gu, out, size: html.length };
}

function main() {
  const only = process.argv[2];
  if (!fs.existsSync(DIR)) { console.error(`연재 폴더가 없습니다: ${DIR}`); process.exit(1); }
  const files = fs.readdirSync(DIR)
    .filter(f => f.endsWith('.txt') && f !== '00_연재일정.txt')
    .filter(f => !only || f.includes(only))
    .map(f => path.join(DIR, f));
  if (!files.length) { console.error(only ? `${only} 초안을 찾지 못했습니다` : '초안이 없습니다'); process.exit(1); }

  let n = 0;
  for (const f of files) {
    const r = convert(f);
    if (r) { n++; console.log(`  ${path.basename(r.out)}  (${(r.size / 1024).toFixed(1)}KB)`); }
    else console.log(`  ${path.basename(f)} — 본문 표시를 찾지 못해 건너뜀`);
  }
  console.log(`\n${n}편 만들었습니다 → ${DIR}`);
}

main();
