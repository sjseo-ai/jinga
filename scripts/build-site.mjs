// 배포용 사본 만들기 — 소스(site/public)는 그대로 두고, 올리는 사본에만 손을 댑니다.
//
// 무엇을 열고 무엇을 줄이는가
//   · 계산 모듈(jinga-*.mjs) — **그대로 올립니다.** 점수를 어떻게 매기는지는 감출 것이 아니라
//     보고 따질 수 있어야 하는 값입니다. 주석의 「왜 이렇게 셈하는가」가 의견을 받는 데 쓰이므로 남깁니다.
//   · index.html·admin.html 안의 <script> — 화면을 잇는 배선이라 압축합니다. 내려받는 양이 줄고,
//     데이터 출처를 적어 둔 개발 메모가 공개 페이지에 남지 않습니다.
//   · HTML 마크업·CSS — 건드리지 않습니다(공백 하나에 배치가 달라질 수 있어서).
//
// 저작권은 배너와 이용약관(/legal.html 제4조)으로 지킵니다 — 읽고 따지는 것은 환영, 베껴 쓰는 것은 금지.
//
//   node scripts/build-site.mjs            → site/.build 에 배포본 생성
//   node scripts/build-site.mjs --raw      → 손대지 않고 그대로 복사(문제 생겼을 때 견주어 보려고)
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(process.argv[2] || 'site/public');
const OUT = path.resolve('site/.build');
const RAW = process.argv.includes('--raw');

// 압축하지 **않는** 것 — 점수 산식이 든 계산 모듈.
//   점수를 어떻게 매기는지는 감출 것이 아니라 **보고 따질 수 있어야 하는 것**입니다.
//   주석에 적어 둔 「왜 이렇게 셈하는가」가 오히려 의견을 받는 데 필요한 부분이라 원문 그대로 올립니다.
//   (저작권은 배너와 이용약관으로 지키고, 베끼는 것을 막는 대신 고칠 곳을 알려 받는 쪽을 택했습니다.)
const MINIFY = /^$/;
// 페이지 안에 직접 적은 스크립트는 화면을 잇는 배선이라 압축합니다 — 내려받는 양도 줄어듭니다.
// 산식은 여기가 아니라 jinga-kb.mjs · jinga-reco.mjs 에 있습니다.
const MINIFY_HTML = /^(index|admin)\.html$/;
// 복사하지 않을 것 — 비밀 값과 빌드 산출물
//   .vercel 은 **복사해야 합니다**. 어느 프로젝트로 올릴지 적힌 연결 파일이라, 빼면
//   Vercel 이 폴더 이름으로 **새 프로젝트를 만들어** 사이트가 통째로 다른 주소에 하나 더 생깁니다.
//   (업로드에서는 site/public/.vercelignore 가 다시 걸러 줍니다.)
const SKIP = new Set(['.env', 'node_modules', '.build']);

const YEAR = new Date().getFullYear();
const BANNER = `/*! 진가(JINGA) — © ${YEAR}. 점수 산식은 일부러 읽을 수 있게 두었습니다.
 * 셈하는 방식이 틀렸거나 고칠 곳이 보이면 알려 주세요 — tjtlswns95@gmail.com
 * 읽고 따지는 것은 환영하지만, 무단 복제·배포·상업적 이용은 금합니다. 이용약관: /legal.html */\n`;
const HTML_BANNER = `<!-- 진가(JINGA) — © ${YEAR}. 점수 산식은 jinga-kb.mjs · jinga-reco.mjs 에서 그대로 읽을 수 있습니다.
     고칠 곳이 보이면 알려 주세요 — tjtlswns95@gmail.com · 이용약관: /legal.html -->\n`;

const bytes = n => (n < 1024 ? `${n}B` : `${(n / 1024).toFixed(1)}KB`);

/**
 * 페이지 안에 직접 적은 <script> 만 압축합니다(HTML 자체는 건드리지 않습니다 — 공백 하나에 배치가 달라질 수 있어서).
 *   · src= 로 불러오는 것, JSON-LD 같은 자바스크립트가 아닌 것은 그대로 둡니다.
 *   · 여러 <script> 가 전역 변수를 함께 씁니다. esbuild 는 **모듈이 아닌 코드의 최상위 이름은 바꾸지 않아** 그대로 이어집니다.
 *   · 압축 결과에 '</script' 가 들어가면 태그가 거기서 끊기므로 escape 합니다.
 */
async function minifyInlineScripts(html, esbuild, where) {
  const re = /(<script\b([^>]*)>)([\s\S]*?)(<\/script>)/gi;
  let out = '', last = 0, done = 0, m;
  while ((m = re.exec(html))) {
    const [all, open, attrs, body, close] = m;
    const type = (attrs.match(/\btype\s*=\s*["']?([^"'\s>]+)/i) || [])[1] || '';
    const isModule = /^module$/i.test(type);
    const isJs = !type || isModule || /^(text\/javascript|application\/javascript)$/i.test(type);
    if (/\bsrc\s*=/i.test(attrs) || !isJs || !body.trim()) continue;
    let code;
    try {
      ({ code } = await esbuild.transform(body, {
        minify: true, loader: 'js', target: 'es2022', legalComments: 'none',
        ...(isModule ? { format: 'esm' } : {}),
      }));
    } catch (e) {
      throw new Error(`${where} 의 <script> 를 압축하지 못했습니다: ${e.message}`);
    }
    out += html.slice(last, m.index) + open + '\n' + code.replace(/<\/script/gi, '<\\/script') + close;
    last = m.index + all.length;
    done++;
  }
  return { html: out + html.slice(last), count: done };
}

async function main() {
  const esbuild = RAW ? null : await import('esbuild').catch(() => null);
  if (!RAW && !esbuild) {
    console.error('esbuild 를 찾지 못해 그대로 복사합니다(인라인 스크립트가 압축되지 않습니다).');
  }

  // 단지·자치구 정적 페이지를 먼저 찍습니다(저장소에는 두지 않고 배포본에만 들어갑니다)
  try {
    const { buildPages } = await import('./build-pages.mjs');
    const r = await buildPages({ quiet: true });
    if (r.apt) console.log(`  정적 페이지 단지 ${r.apt}장 · 자치구 ${r.gu}장`);
  } catch (e) {
    console.warn('  정적 페이지를 만들지 못했습니다:', e.message);
  }

  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  const done = [];
  let copied = 0;

  async function walk(dir, rel = '') {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP.has(ent.name)) continue;
      const from = path.join(dir, ent.name);
      const to = path.join(OUT, rel, ent.name);
      if (ent.isDirectory()) {
        fs.mkdirSync(to, { recursive: true });
        await walk(from, path.join(rel, ent.name));
        continue;
      }
      // (지금은 MINIFY 가 비어 있어 여기로 오지 않습니다 — 계산 모듈을 열어 두기로 했으므로)
      if (esbuild && rel === '' && MINIFY.test(ent.name)) {
        const src = fs.readFileSync(from, 'utf8');
        const { code } = await esbuild.transform(src, {
          minify: true, loader: 'js', format: 'esm', target: 'es2022', legalComments: 'none',
        });
        fs.writeFileSync(to, BANNER + code);
        // 글자 수가 아니라 실제 바이트로 — 한글은 한 글자가 3바이트라 글자 수로 세면 줄어든 양이 부풀려 보입니다
        done.push({ name: ent.name, before: Buffer.byteLength(src), after: Buffer.byteLength(BANNER + code) });
      } else if (esbuild && rel === '' && MINIFY_HTML.test(ent.name)) {
        const src = fs.readFileSync(from, 'utf8');
        const r = await minifyInlineScripts(src, esbuild, ent.name);
        const html = r.html.replace('</head>', `${HTML_BANNER}</head>`);
        fs.writeFileSync(to, html);
        done.push({ name: `${ent.name}(script ${r.count})`, before: Buffer.byteLength(src), after: Buffer.byteLength(html) });
      } else {
        fs.copyFileSync(from, to);
        copied++;
      }
    }
  }

  await walk(ROOT);

  // 눈으로 확인 — 압축한 파일이 그대로 돌아가는지(문법이 깨지지 않았는지) 한 번 더 읽어 봅니다
  for (const d of done.filter(x => x.name.endsWith('.mjs'))) {   // HTML 은 브라우저 검사로 확인합니다
    const p = path.join(OUT, d.name);
    try {
      await import(pathToFileURL(p).href);
    } catch (e) {
      throw new Error(`압축한 ${d.name} 를 불러오지 못했습니다 — 배포를 멈춥니다: ${e.message}`);
    }
  }

  const saved = done.reduce((a, d) => a + d.before - d.after, 0);
  for (const d of done) {
    console.log(`  ${d.name.padEnd(18)} ${bytes(d.before).padStart(8)} → ${bytes(d.after).padStart(8)}  (${Math.round((1 - d.after / d.before) * 100)}% 줄임)`);
  }
  console.log(`배포본 ${OUT}`);
  console.log(`  압축 ${done.length}개(${bytes(saved)} 줄임) · 그대로 복사 ${copied}개`);
  console.log('  계산 모듈(jinga-*.mjs)은 일부러 압축하지 않습니다 — 점수 산식을 읽고 따질 수 있도록.');
  return OUT;
}

// 윈도우 경로는 file:///C:/… 라 문자열을 손으로 맞추면 어긋납니다
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(e => { console.error(e.message); process.exit(1); });
}

export { main as buildSite, OUT as BUILD_DIR, MINIFY, BANNER };
