// 검색엔진 소유 확인 코드 넣기 — 네이버 서치어드바이저 · 구글 서치콘솔
//
//   node scripts/verify-tag.mjs naver <코드>     네이버가 준 content 값
//   node scripts/verify-tag.mjs google <코드>    구글이 준 content 값
//   node scripts/verify-tag.mjs --show           지금 들어 있는 것 보기
//   node scripts/verify-tag.mjs --remove naver   빼기
//
// 두 곳 모두 「HTML 태그」 방식을 고르면 이런 줄을 줍니다.
//   <meta name="naver-site-verification" content="abc123..." />
//   <meta name="google-site-verification" content="xyz789..." />
// content 안의 값만 넘기면 됩니다(태그 전체를 붙여 넣어도 값만 뽑아 씁니다).
//
// 넣은 뒤에는 반드시 다시 배포해야 합니다 — `node scripts/deploy-vercel.mjs`.
// 확인이 끝나도 태그는 **빼지 마세요.** 지우면 소유 확인이 풀립니다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, 'site', 'public', 'index.html');
const NAMES = { naver: 'naver-site-verification', google: 'google-site-verification' };
const MARK = '<!-- 검색엔진 소유 확인 -->';

const tagRe = name => new RegExp(`\\s*<meta name="${name}" content="[^"]*"\\s*/?>`, 'g');

function show(html) {
  let any = false;
  for (const [who, name] of Object.entries(NAMES)) {
    const m = html.match(new RegExp(`<meta name="${name}" content="([^"]*)"`));
    if (m) { console.log(`${who.padEnd(7)} 들어 있음 — ${m[1].slice(0, 8)}…(${m[1].length}자)`); any = true; }
    else console.log(`${who.padEnd(7)} 없음`);
  }
  if (!any) console.log('\n아직 아무것도 없습니다. 위 사용법대로 넣어 주세요.');
}

function main() {
  const args = process.argv.slice(2);
  let html = fs.readFileSync(FILE, 'utf8');

  if (!args.length || args[0] === '--show') return show(html);

  if (args[0] === '--remove') {
    const who = args[1];
    if (!NAMES[who]) throw new Error(`naver 또는 google 이어야 합니다 — 받은 것: ${who}`);
    if (!tagRe(NAMES[who]).test(html)) return console.log(`${who}: 들어 있지 않습니다`);
    html = html.replace(tagRe(NAMES[who]), '');
    fs.writeFileSync(FILE, html);
    return console.log(`${who} 뺐습니다. 배포해야 실제로 사라집니다.`);
  }

  const who = args[0];
  if (!NAMES[who]) throw new Error(`naver 또는 google 이어야 합니다 — 받은 것: ${who}`);
  // 태그 전체를 붙여 넣었어도 content 안의 값만 뽑습니다
  const raw = args.slice(1).join(' ').trim();
  const code = (raw.match(/content=["']([^"']+)["']/) || [, raw])[1].trim();
  if (!/^[A-Za-z0-9_.:-]{10,200}$/.test(code)) {
    throw new Error(`확인 코드가 이상합니다(영문·숫자 10~200자여야 합니다): ${code.slice(0, 30)}`);
  }

  const name = NAMES[who];
  const tag = `<meta name="${name}" content="${code}" />`;
  if (tagRe(name).test(html)) {
    html = html.replace(tagRe(name), '\n' + tag);
    console.log(`${who}: 이미 있던 코드를 새 것으로 바꿨습니다`);
  } else if (html.includes(MARK)) {
    html = html.replace(MARK, `${MARK}\n${tag}`);
    console.log(`${who}: 넣었습니다`);
  } else {
    const anchor = '</title>';
    if (html.split(anchor).length - 1 !== 1) throw new Error('index.html 에서 </title> 를 찾지 못했습니다');
    html = html.replace(anchor, `${anchor}\n${MARK}\n${tag}`);
    console.log(`${who}: 넣었습니다`);
  }

  fs.writeFileSync(FILE, html);
  console.log('\n다음 할 일:');
  console.log('  1) node scripts/deploy-vercel.mjs      — 배포해야 검색엔진이 볼 수 있습니다');
  console.log('  2) 서치콘솔 화면으로 돌아가 「확인」 누르기');
}

try { main(); } catch (e) { console.error('실패:', e.message); process.exit(1); }
