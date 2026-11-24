// 인벤토리 — 「진가가 지금 무엇으로 이루어져 있는가」를 **코드에서 직접 뽑습니다**(T001).
//   node scripts/build-inventory.mjs          → artifacts/inventory.json
//   node scripts/build-inventory.mjs --print   화면으로만
//
// 왜 손으로 안 적는가 — 손으로 적은 목록은 다음 주면 틀립니다. 그런데 이 목록이 틀리면
// 「이 기능이 아직 KB 를 부르나」 같은 질문에 코드를 다시 읽어야 합니다. 그래서 세는 일은 기계가 합니다.
//
// **비밀값은 담지 않습니다.** 환경변수는 **이름만** 모읍니다(값·토큰·키는 어디에도 쓰지 않음).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'artifacts', 'inventory.json');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = p => fs.existsSync(path.join(ROOT, p));
const ls = (p, re) => (exists(p) ? fs.readdirSync(path.join(ROOT, p)).filter(f => !re || re.test(f)).sort() : []);

/** 소스에서 긁어모으기 — 중복 없이 정렬된 목록으로 */
const grabAll = (files, re, pick = m => m[0]) => {
  const out = new Set();
  for (const f of files) {
    let s; try { s = read(f); } catch { continue; }
    for (const m of s.matchAll(re)) out.add(pick(m));
  }
  return [...out].sort();
};

const walk = (dir, re, acc = []) => {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return acc;
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(rel, re, acc); }
    else if (!re || re.test(e.name)) acc.push(rel);
  }
  return acc;
};

export function buildInventory() {
  const pkg = JSON.parse(read('package.json'));
  const vercel = JSON.parse(read('site/public/vercel.json'));

  // 소스 전체 — 바깥으로 나가는 주소와 환경변수 이름을 여기서 찾습니다
  const sources = [
    ...walk('site/public/api', /\.mjs$/), ...walk('workers', /\.js$/), ...walk('scripts', /\.mjs$/),
    'site/public/index.html', ...ls('site/public', /^jinga-.*\.mjs$/).map(f => `site/public/${f}`),
  ].filter(f => exists(f));

  const hosts = grabAll(sources, /https:\/\/([a-zA-Z0-9.-]+\.[a-z]{2,})/g, m => m[1])
    .filter(h => !/^(jinga\.example|last-good\.jinga\.internal|some-forum\.co\.kr|myaccount\.google\.com|schema\.org|www\.w3\.org|openapi\.vercel\.sh)$/.test(h));

  const workers = ls('workers').map(name => {
    const toml = `workers/${name}/wrangler.toml`;
    const t = exists(toml) ? read(toml) : '';
    const cron = /crons\s*=\s*\[([^\]]*)\]/.exec(t);
    return { name, crons: cron ? cron[1].split(',').map(s => s.trim().replace(/"/g, '')).filter(Boolean) : [] };
  });

  const pub = p => `site/public/${p}`;
  const count = d => (exists(pub(d)) ? fs.readdirSync(path.join(ROOT, pub(d))).length : 0);

  return {
    generatedAt: new Date().toISOString(),
    note: '코드에서 뽑은 현황. 비밀값은 담지 않으며 환경변수는 이름만 모읍니다.',
    deploy: {
      site: 'Vercel — site/.build (scripts/deploy-vercel.mjs)',
      url: 'https://jinga-retech.vercel.app',
      repo: 'https://github.com/sjseo-ai/jinga',
      regions: vercel.regions || [],
      vercelCrons: vercel.crons || [],
      functions: ls('site/public/api', /^[^_].*\.mjs$/).map(f => `/api/${f.replace(/\.mjs$/, '')}`),
      functionCount: ls('site/public/api', /^[^_].*\.mjs$/).length,
      sharedModules: ls('site/public/api', /^_.*\.mjs$/).length,
      workers,
    },
    storage: {
      server: exists('site/public/api/_blob.mjs')
        ? ['Vercel Blob(비공개) — subs/<id>.json 구독자, weekly/… 주간 작업·보고서·KB 조각']
        : [],
      client: grabAll(['site/public/index.html', ...ls('site/public', /^jinga-.*\.mjs$/).map(f => `site/public/${f}`)],
        /(?:localStorage|sessionStorage)\.(?:get|set)Item\('([^']+)'/g, m => m[1]),
      repoDataFiles: ls('site/public', /\.json$/).map(f => ({
        file: f, kb: /^kb-/.test(f), kbytes: Math.round(fs.statSync(path.join(ROOT, pub(f))).size / 1024),
      })),
    },
    staticPages: { apt: count('apt') - 1, gu: count('gu'), note: '단지·자치구 페이지(입구 index 제외)' },
    externalHosts: hosts,
    envVarNames: grabAll(sources, /env\.([A-Z][A-Z0-9_]{2,})/g, m => m[1])
      .filter(n => !['HOME', 'TEMP', 'USERPROFILE', 'NODE_OPTIONS', 'LIVE'].includes(n)),
    npmScripts: Object.keys(pkg.scripts || {}),
    tests: { files: ls('scripts', /^smoke-.*\.mjs$/).length, command: 'npm test' },
    localSchedulers: [
      { name: '진가 블로그 연재 알림', what: '화·금 17:00 — 연재 일정 알림창(KB 호출 없음)', state: '켜짐' },
      { name: '진가 주간보고서', what: 'scripts/weekly-report.bat', state: '꺼짐' },
      { name: 'scripts/serial-refresh.bat', what: '연재 회차 자료 최신화(수동)', state: '예약 없음' },
    ],
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const inv = buildInventory();
  if (process.argv.includes('--print')) { console.log(JSON.stringify(inv, null, 2)); }
  else {
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(inv, null, 2));
    console.log(`artifacts/inventory.json — 함수 ${inv.deploy.functionCount}개 · 워커 ${inv.deploy.workers.length}개 ·`
      + ` 바깥 주소 ${inv.externalHosts.length}곳 · 환경변수 이름 ${inv.envVarNames.length}개 · 정적 페이지 ${inv.staticPages.apt + inv.staticPages.gu}장`);
  }
}
