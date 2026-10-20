// 진가 커뮤니티 + 임장동행 — 하나의 서버 함수가 둘을 함께 맡습니다
//   (Vercel Hobby 는 서버 함수를 12개까지만 둘 수 있어, 구독 3개를 1개로 합쳐 자리를 만들고 여기에 모았습니다)
//
//  GET  ?area=rating&id=<단지>            단지별 이웃 평가(집계 + 최근 글)
//  GET  ?area=visit&id=<단지>             단지별 임장 후기·체크리스트
//  GET  ?area=ratings&ids=1,2,3           여러 단지 집계만(카드·지도에 한 줄 붙일 때, 최대 30곳)
//  GET  ?area=hosts&region=강동구          동행자 목록
//  GET  ?area=requests&region=강동구       동행 요청 목록
//  GET  ?area=outside&id=<단지>           다른 곳에서 본 이야기(자기 말 요약 + 원문 링크)
//  GET  ?area=album&id=<단지>             단지 사진·현장 정보(베이·지하주차장 연결 등)
//  GET  ?area=photo&c=<단지>&id=<사진>     사진 한 장(비공개 저장소에서 읽어 내보냄)
//  GET  ?area=me                          지금 로그인한 사람(쿠키)
//  POST { action: 'login', email }        확인 메일 보내기(이 메일이 신원 확인)
//  GET  ?area=verify&t=<토큰>              메일 링크 — 쿠키를 심고 사이트로 돌려보냄
//  POST { action: 'rating'|'visit'|'report'|'host'|'request'|'apply'|'accept', … }
//
//  ── 의견·문의 게시판(_board.mjs) — 점수 산식을 열어 둔 것과 짝이 되는 자리 ──
//  GET  ?area=board&kind=&status=&page=   글 목록(누구나)
//  GET  ?area=post&id=<글>                 글 하나 + 답글(누구나)
//  POST { action: 'boardPost'|'boardReply'|'boardReport', … }   쓰기는 메일 확인을 마친 사람만
//
//  ── 방문 집계(_stats.mjs) — 「어느 홍보가 먹혔나」만 봅니다. 사람을 식별하지 않습니다 ──
//  POST { action: 'hit', ref, url, w }    화면이 한 번 보내는 발자국(봇은 세지 않음)
//  GET  ?area=stats                       운영자만 — 날짜별·유입처별 집계
//
//  ── 커뮤니티 모아 보기(_hub.mjs) — 「커뮤니티」 탭에서 단지별로 나눠 보기 ──
//  GET  ?area=hub&q=&kind=&region=&sort=&page=   글이 있는 단지 목록(누구나)
//       평가·후기를 올릴 때마다 community/index.json 의 그 단지 한 줄을 고칩니다.
//
// 신원 — 따로 회원가입을 만들지 않고 **이메일 확인**만 씁니다. 확인되면 그 브라우저에 12시간짜리 쿠키를 둡니다.
//        저장할 때 이메일 원문은 두지 않고 해시(memberId)만 남깁니다.
import { waitUntil } from '@vercel/functions';
import { blobStore } from './_blob.mjs';
import { adminAuth } from './_auth.mjs';
import { createLimiter, clientIp, mailRules } from './_ratelimit.mjs';   // 확인 메일은 로그인 없이 보내는 길목이라 횟수를 셉니다
import { mailConfigFromEnv, canSend, createTransport, fromHeader } from './_mail.mjs';
import {
  parseRating, parseVisit, aggregate, aggregateChecks, upsert, applyReport,
  memberId, displayName, publicRow, ASPECTS, CHECKLIST, digest, outsideLinks,
} from './_community.mjs';
import {
  parseHost, parseRequest, matchHosts, applyTo, accept, publicHost, publicRequest, HOST_RULES, KINDS,
} from './_companion.mjs';
import {
  parsePost, parseReply, addPost, addReply, report as boardReport, adminOp as boardAdmin,
  publicPost, listPosts, counts as boardCounts,
  KINDS as BOARD_KINDS, TARGETS as BOARD_TARGETS, STATUSES as BOARD_STATUSES,
} from './_board.mjs';
import { hubEntry, putEntry, searchHub, cleanMeta, idFromPath, INDEX_PATH, HUB_KINDS, HUB_SORTS } from './_hub.mjs';
import { isBot, dayKey, refHost, utmSource, deviceKind, bump, summarize, statsPath, recentMonths } from './_stats.mjs';
import {
  parseOutside, addOutside, reportOutside, publicOutside, outsideDigest,
  RULES as OUTSIDE_RULES, SOURCES as OUTSIDE_SOURCES, SUMMARY_MAX as OUTSIDE_MAX,
} from './_outside.mjs';
import {
  parseFacts, upsertFacts, aggregateFacts, factsDigest,
  parsePhoto, addPhoto, reportPhoto, publicPhoto, livePhotos, photoPath,
  FACTS, PHOTO_KINDS, RULES as ALBUM_RULES, PHOTO_MAX_BYTES,
} from './_album.mjs';

const COOKIE = 'jinga_member';
const TTL_S = 12 * 3600;
const LOGIN_TTL_MS = 30 * 60e3;         // 메일 링크 유효 시간
const MAX_IDS = 30;

const P = {
  ratings: id => `community/ratings/${id}.json`,
  visits: id => `community/visits/${id}.json`,
  outside: id => `community/outside/${id}.json`,
  facts: id => `album/facts/${id}.json`,
  photos: id => `album/list/${id}.json`,
  member: uid => `community/members/${uid}.json`,
  login: token => `community/logins/${token}.json`,
  posts: 'board/posts.json',
  hosts: 'companion/hosts.json',
  requests: 'companion/requests.json',
};

const json = (body, status = 200, cache = 'no-store', headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': cache, ...headers } });
const bad = (msg, status = 400) => json({ ok: false, error: msg }, status);
const rid = () => crypto.randomUUID().replace(/-/g, '').slice(0, 24);
const originOf = request => String(process.env.JINGA_SITE_URL || new URL(request.url).origin).replace(/\/+$/, '');

// ── 신원 ──────────────────────────────────────────────────────
const readCookie = (request, name) => {
  const raw = request.headers.get('cookie') || '';
  const hit = raw.split(';').map(s => s.trim()).find(s => s.startsWith(name + '='));
  return hit ? decodeURIComponent(hit.slice(name.length + 1)) : null;
};
const setCookie = (token, maxAge = TTL_S) =>
  `${COOKIE}=${encodeURIComponent(token)}; Path=/api; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

/** 쿠키 → 회원. 없거나 만료면 null */
async function whoami(request, store) {
  const token = readCookie(request, COOKIE);
  if (!token) return null;
  const rec = await store.get(P.member(token.slice(0, 24))).catch(() => null);
  if (!rec || !rec.uid) return null;
  if (rec.sessionToken !== token || Date.parse(rec.sessionAt || 0) + TTL_S * 1000 < Date.now()) return null;
  return rec;
}

// ── 모아 보기 색인 ────────────────────────────────────────────
/** 단지 한 곳의 평가·후기를 다시 읽어 색인 한 줄을 고칩니다(쓰기·신고 뒤에 부름) */
async function refreshIndex(store, id, meta = {}) {
  try {
    const [ratings, visits, outside, index] = await Promise.all([
      store.get(P.ratings(id)).catch(() => null),
      store.get(P.visits(id)).catch(() => null),
      store.get(P.outside(id)).catch(() => null),
      store.get(INDEX_PATH).catch(() => null),
    ]);
    const idx = index || {};
    await store.put(INDEX_PATH, putEntry(idx, hubEntry(id, { ratings: ratings || [], visits: visits || [], outside: outside || [], meta, prev: idx[id] || null })));
  } catch (e) {
    console.error('[community] 모아 보기 색인 갱신 실패:', e.message);   // 색인은 부가 기능 — 글쓰기는 막지 않음
  }
}

/** 색인이 아직 없을 때(예전 글만 있을 때) 한 번 모아서 만듭니다. 이름은 비어 있어 화면이 KB 목록에서 채웁니다 */
async function buildIndex(store) {
  const paths = [
    ...((await store.list('community/ratings/').catch(() => [])) || []),
    ...((await store.list('community/visits/').catch(() => [])) || []),
    ...((await store.list('community/outside/').catch(() => [])) || []),
  ];
  const ids = [...new Set(paths.map(x => idFromPath(typeof x === 'string' ? x : x.pathname)).filter(Boolean))];
  let idx = {};
  for (const id of ids) {
    const [ratings, visits, outside] = await Promise.all([
      store.get(P.ratings(id)).catch(() => null), store.get(P.visits(id)).catch(() => null), store.get(P.outside(id)).catch(() => null)]);
    idx = putEntry(idx, hubEntry(id, { ratings: ratings || [], visits: visits || [], outside: outside || [] }));
  }
  await store.put(INDEX_PATH, idx);
  return idx;
}

const loginMail = (siteUrl, token) => ({
  subject: '[진가] 커뮤니티 참여 확인',
  text: `아래 링크를 누르면 진가 커뮤니티에 글을 쓸 수 있습니다(30분 안에 눌러 주세요).\n${siteUrl}/api/community?area=verify&t=${token}\n\n본인이 신청하지 않았다면 이 메일을 지워 주세요.`,
  html: `<p>아래 버튼을 누르면 진가 커뮤니티에 글을 쓸 수 있습니다(30분 안에 눌러 주세요).</p>
    <p><a href="${siteUrl}/api/community?area=verify&t=${token}" style="display:inline-block;padding:11px 18px;background:#1E5FCC;color:#fff;border-radius:8px;text-decoration:none;font-weight:700">커뮤니티 참여하기</a></p>
    <p style="color:#5A6B7D;font-size:13px">본인이 신청하지 않았다면 이 메일을 지워 주세요.</p>`,
});

export async function GET(request) {
  const store = blobStore();
  const u = new URL(request.url);
  const area = u.searchParams.get('area') || '';

  // 메일 링크 — 쿠키를 심고 사이트로 돌려보냄
  if (area === 'verify') {
    const t = u.searchParams.get('t') || '';
    const rec = t ? await store.get(P.login(t)).catch(() => null) : null;
    const site = originOf(request);
    if (!rec || Date.parse(rec.at) + LOGIN_TTL_MS < Date.now()) {
      return new Response(null, { status: 302, headers: { Location: `${site}/#community?verify=expired` } });
    }
    const uid = memberId(rec.email, process.env.JINGA_ADMIN_SECRET || '');
    const session = uid + rid().slice(0, 8);
    const prev = (await store.get(P.member(uid)).catch(() => null)) || {};
    await store.put(P.member(uid), {
      ...prev, uid, name: prev.name || displayName('', rec.email),
      sessionToken: session, sessionAt: new Date().toISOString(), verifiedAt: prev.verifiedAt || new Date().toISOString(),
    });
    await store.del(P.login(t)).catch(() => {});
    return new Response(null, { status: 302, headers: { Location: `${site}/#community?verify=ok`, 'Set-Cookie': setCookie(session) } });
  }

  if (area === 'album') {
    const id = Number(u.searchParams.get('id'));
    if (!Number.isInteger(id) || id <= 0) return bad('단지 번호가 필요합니다');
    const [facts, photos] = await Promise.all([
      store.get(P.facts(id)).catch(() => null),
      store.get(P.photos(id)).catch(() => null),
    ]);
    const me = await whoami(request, store);
    const agg = aggregateFacts(facts || []);
    return json({
      ok: true, id,
      facts: agg, digest: factsDigest(agg), answered: (facts || []).length,
      mine: me ? (facts || []).find(r => r.uid === me.uid) || null : null,
      photos: livePhotos(photos || []).map(r => publicPhoto(r, me ? me.uid : null)),
      questions: FACTS, kinds: PHOTO_KINDS, rules: ALBUM_RULES, maxBytes: PHOTO_MAX_BYTES,
    }, 200, 'public, max-age=30');
  }

  // 사진은 비공개 저장소에 있어 바로 열 수 없습니다 — 여기서 읽어 내보냅니다.
  // 주소에 단지·사진 번호만 있으므로 누구나 볼 수 있고(공개 글), 브라우저가 오래 보관합니다.
  if (area === 'photo') {
    const c = Number(u.searchParams.get('c'));
    const id = String(u.searchParams.get('id') || '');
    if (!Number.isInteger(c) || c <= 0 || !/^[0-9a-f]{14}$/.test(id)) return bad('사진 번호가 올바르지 않습니다');
    const rows = (await store.get(P.photos(c)).catch(() => null)) || [];
    const hit = rows.find(r => r.id === id && !r.hidden);
    if (!hit) return bad('사진을 찾지 못했습니다', 404);
    const bytes = await store.getBytes(photoPath(c, hit.id, hit.ext)).catch(() => null);
    if (!bytes) return bad('사진을 읽지 못했습니다', 404);
    return new Response(bytes, {
      headers: {
        'Content-Type': hit.type || 'image/jpeg',
        'Cache-Control': 'public, max-age=86400, immutable',
        'Content-Disposition': 'inline',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }

  if (area === 'outside') {
    const id = Number(u.searchParams.get('id'));
    if (!Number.isInteger(id) || id <= 0) return bad('단지 번호가 필요합니다');
    const rows = (await store.get(P.outside(id)).catch(() => null)) || [];
    const me = await whoami(request, store);
    return json({
      ok: true, id,
      digest: outsideDigest(rows),
      rows: rows.filter(r => !r.hidden).map(r => publicOutside(r, me ? me.uid : null)),
      rules: OUTSIDE_RULES, sources: OUTSIDE_SOURCES, max: OUTSIDE_MAX,
    }, 200, 'public, max-age=30');
  }

  if (area === 'me') {
    const me = await whoami(request, store);
    return json({ ok: true, me: me ? { uid: me.uid, name: me.name } : null });
  }

  if (area === 'meta') {
    return json({ ok: true, aspects: ASPECTS, checklist: CHECKLIST, kinds: KINDS, rules: HOST_RULES,
      outsideRules: OUTSIDE_RULES, outsideMax: OUTSIDE_MAX }, 200, 'public, max-age=600');
  }

  if (area === 'rating' || area === 'visit') {
    const id = Number(u.searchParams.get('id'));
    if (!Number.isInteger(id) || id <= 0) return bad('단지 번호가 필요합니다');
    const rows = (await store.get(area === 'rating' ? P.ratings(id) : P.visits(id)).catch(() => null)) || [];
    const live = rows.filter(r => !r.hidden);
    const agg = area === 'rating' ? aggregate(rows) : aggregateChecks(rows);
    return json({
      ok: true, id, agg,
      // 「진가 커뮤니티(22명) : 4.1/5 · 좋음 …」 한 줄 요약(평가 탭에서만)
      digest: area === 'rating' ? digest(agg, live) : null,
      // 다른 사이트 글은 옮겨 싣지 않고 바로가기만 — 각 사이트가 크롤링을 막고 있고 글마다 저작권이 있습니다
      outside: outsideLinks({
        name: u.searchParams.get('name') || '',
        gu: u.searchParams.get('gu') || '', dong: u.searchParams.get('dong') || '',
        lat: u.searchParams.get('lat'), lng: u.searchParams.get('lng'),
      }),
      rows: live.slice(-30).reverse().map(publicRow),
    }, 200, 'public, max-age=30');
  }

  if (area === 'hub') {
    const [index0, requests] = await Promise.all([store.get(INDEX_PATH).catch(() => null), store.get(P.requests).catch(() => null)]);
    const index = index0 || await buildIndex(store);
    const out = searchHub(index, requests || [], {
      q: String(u.searchParams.get('q') || '').slice(0, 40),
      kind: String(u.searchParams.get('kind') || ''),
      region: String(u.searchParams.get('region') || ''),
      sort: String(u.searchParams.get('sort') || 'recent'),
      page: Number(u.searchParams.get('page') || 1),
    });
    return json({ ok: true, ...out, kinds: HUB_KINDS, sorts: HUB_SORTS }, 200, 'public, max-age=20');
  }

  if (area === 'board') {
    const posts = (await store.get(P.posts).catch(() => null)) || [];
    const me = await whoami(request, store);
    const out = listPosts(posts, {
      kind: String(u.searchParams.get('kind') || ''),
      status: String(u.searchParams.get('status') || ''),
      page: Number(u.searchParams.get('page') || 1),
      me: me ? me.uid : null,
    });
    return json({ ok: true, ...out, counts: boardCounts(posts), kinds: BOARD_KINDS, targets: BOARD_TARGETS, statuses: BOARD_STATUSES });
  }

  if (area === 'post') {
    const posts = (await store.get(P.posts).catch(() => null)) || [];
    const hit = posts.find(x => x.id === String(u.searchParams.get('id') || ''));
    if (!hit) return bad('글을 찾지 못했습니다', 404);
    const me = await whoami(request, store);
    return json({ ok: true, post: publicPost(hit, me ? me.uid : null) });
  }

  if (area === 'ratings') {
    const ids = (u.searchParams.get('ids') || '').split(',').map(x => Number(x.trim())).filter(x => Number.isInteger(x) && x > 0).slice(0, MAX_IDS);
    if (!ids.length) return bad('ids 가 필요합니다');
    const out = {};
    await Promise.all(ids.map(async id => {
      const rows = (await store.get(P.ratings(id)).catch(() => null)) || [];
      const agg = aggregate(rows);
      if (agg.n) out[id] = { ...agg, digest: digest(agg, rows.filter(r => !r.hidden)) };
    }));
    return json({ ok: true, byComplex: out }, 200, 'public, max-age=60');
  }

  if (area === 'hosts') {
    const region = (u.searchParams.get('region') || '').trim();
    const hosts = (await store.get(P.hosts).catch(() => null)) || [];
    const live = hosts.filter(h => h.status === 'active' && (!region || (h.regions || []).includes(region)));
    return json({ ok: true, hosts: live.map(publicHost), rules: HOST_RULES }, 200, 'public, max-age=30');
  }

  if (area === 'requests') {
    const region = (u.searchParams.get('region') || '').trim();
    const me = await whoami(request, store);
    const reqs = (await store.get(P.requests).catch(() => null)) || [];
    const live = reqs.filter(r => r.status === 'open' && (!region || r.region === region));
    return json({ ok: true, requests: live.slice(-50).reverse().map(r => publicRequest(r, { forUid: me && me.uid })) }, 200, 'public, max-age=30');
  }

  // 방문 집계 보기 — 운영자만(숫자 자체는 민감하지 않지만 운영 정보입니다)
  if (area === 'stats') {
    if (!(await adminAuth(request, store, process.env))) return bad('unauthorized', 401);
    const months = await Promise.all(recentMonths(3).map(m => store.get(statsPath(m)).catch(() => null)));
    return json({ ok: true, ...summarize(months.filter(Boolean)) }, 200, 'no-store');
  }

  return bad('area 가 필요합니다');
}

export async function POST(request) {
  const store = blobStore();
  const body = await request.json().catch(() => ({}));
  const action = body.action;

  // 0) 방문 발자국 — 화면이 열릴 때 한 번. 답은 바로 돌려주고 저장은 뒤에서 합니다(화면을 붙잡지 않게).
  //    남기는 것은 날짜·유입처·utm·휴대폰여부뿐입니다. IP 도 UA 도 저장하지 않습니다.
  if (action === 'hit') {
    if (isBot(request.headers.get('user-agent'))) return json({ ok: true });
    const self = (() => { try { return new URL(originOf(request)).hostname; } catch { return null; } })();
    const ref = refHost(body.ref, self);
    if (ref === null) return json({ ok: true });            // 사이트 안에서 넘어온 것
    const hit = { day: dayKey(), ref, utm: utmSource(body.url), device: deviceKind(body.w) };
    waitUntil((async () => {
      try {
        const path = statsPath(hit.day.slice(0, 7));
        const cur = await store.get(path).catch(() => null);
        await store.put(path, bump(cur, hit));
      } catch (e) { console.error('[stats] 집계 실패:', e.message); }
    })());
    return json({ ok: true });
  }

  // 1) 확인 메일 보내기 — 여기까지는 로그인 없이
  if (action === 'login') {
    const email = String(body.email || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return bad('메일 주소를 확인해 주세요');
    if (body.website) return json({ ok: true });                 // 봇 함정 칸
    // 이 길목은 로그인 없이 **우리 계정에서 남의 주소로** 메일을 보냅니다.
    // 막지 않으면 남의 주소를 넣고 반복 호출해 메일 폭탄을 만들 수 있고, 발신 계정이 정지됩니다.
    const gate = await createLimiter(store).check(mailRules('login', clientIp(request), email));
    if (!gate.ok) return json({ ok: false, error: `${gate.label}. ${Math.ceil(gate.retryAfterS / 60)}분 뒤에 다시 시도해 주세요.` }, 429, 'no-store', { 'Retry-After': String(gate.retryAfterS) });
    const token = rid();
    await store.put(P.login(token), { email, at: new Date().toISOString() });
    const cfg = mailConfigFromEnv();
    if (!cfg.siteUrl) cfg.siteUrl = originOf(request);
    if (canSend(cfg)) {
      waitUntil((async () => {
        try {
          const tx = await createTransport(cfg);
          await tx.sendMail({ from: fromHeader(cfg), to: email, ...loginMail(cfg.siteUrl, token) });
        } catch (e) { console.error('[community] 확인 메일 실패:', e.message); }
      })());
    }
    return json({ ok: true, sent: canSend(cfg), note: canSend(cfg) ? null : '메일 설정이 없어 보내지 못했습니다(관리자 확인 필요)' });
  }

  // 2) 관리자 — 공인중개사 등록번호 확인·거절. 관리자는 커뮤니티 회원 가입을 하지 않으므로
  //    아래 「확인된 회원만」 검사보다 **먼저** 처리해야 합니다(그렇지 않으면 관리자도 401을 받습니다).
  if (action === 'admin') {
    if (!(await adminAuth(request, store, process.env))) return bad('unauthorized', 401);

    // 게시판 — 목록 보기, 상태 바꾸기, 감추기/되살리기/지우기, 운영자 답글
    if (String(body.op || '').startsWith('post')) {
      const posts = (await store.get(P.posts).catch(() => null)) || [];
      if (body.op === 'postList') {
        return json({ ok: true, posts: posts.map(x => publicPost(x, null)), counts: boardCounts(posts), statuses: BOARD_STATUSES, kinds: BOARD_KINDS });
      }
      if (body.op === 'postReply') {
        const parsed = parseReply(body, { admin: true });
        if (!parsed.ok) return bad(parsed.error);
        const r = addReply(posts, String(body.postId || ''), parsed.value, 'admin');
        if (!r.ok) return bad(r.error, 404);
        await store.put(P.posts, r.value);
        return json({ ok: true });
      }
      const op = { postStatus: 'status', postHide: 'hide', postShow: 'show', postRemove: 'remove' }[body.op];
      if (!op) return bad('op 가 필요합니다');
      const r = boardAdmin(posts, { op, postId: String(body.postId || ''), status: String(body.status || '') });
      if (!r.ok) return bad(r.error, 404);
      await store.put(P.posts, r.value);
      return json({ ok: true });
    }

    const hosts = (await store.get(P.hosts).catch(() => null)) || [];
    if (body.op === 'listHosts') return json({ ok: true, hosts });
    const h = hosts.find(x => x.id === String(body.hostId || ''));
    if (!h) return bad('동행자를 찾지 못했습니다', 404);
    if (body.op === 'verify') { h.verified = true; h.status = 'active'; h.verifiedAt = new Date().toISOString(); }
    else if (body.op === 'reject') { h.status = 'rejected'; h.verified = false; }
    else return bad('op 가 필요합니다');
    await store.put(P.hosts, hosts);
    return json({ ok: true });
  }

  // 3) 여기서부터는 메일 확인을 마친 사람만
  const me = await whoami(request, store);
  if (!me) return bad('메일 확인이 필요합니다', 401);
  const now = () => new Date();

  if (action === 'rating' || action === 'visit') {
    const parsed = action === 'rating' ? parseRating(body, { now }) : parseVisit(body, { now });
    if (!parsed.ok) return bad(parsed.error);
    const path = action === 'rating' ? P.ratings(parsed.value.complexId) : P.visits(parsed.value.complexId);
    const rows = (await store.get(path).catch(() => null)) || [];
    const next = upsert(rows, { ...parsed.value, name: me.name }, me.uid);
    await store.put(path, next);
    await refreshIndex(store, parsed.value.complexId, cleanMeta(body.meta || {}));
    return json({ ok: true, agg: action === 'rating' ? aggregate(next) : aggregateChecks(next) });
  }

  // ── 의견·문의 게시판 ──
  if (action === 'boardPost' || action === 'boardReply' || action === 'boardReport') {
    // 글쓰기도 남용될 수 있어 횟수를 셉니다(메일 확인을 했더라도 쏟아붓는 것은 막습니다)
    const gate = await createLimiter(store).check([
      { key: `board:ip:${clientIp(request)}`, max: 10, windowMs: 10 * 60e3, label: '글을 너무 자주 올렸습니다' },
      { key: `board:uid:${me.uid}`, max: 20, windowMs: 60 * 60e3, label: '한 시간에 올릴 수 있는 수를 넘었습니다' },
    ]);
    if (!gate.ok) return json({ ok: false, error: `${gate.label}. ${Math.ceil(gate.retryAfterS / 60)}분 뒤에 다시 시도해 주세요.` }, 429, 'no-store', { 'Retry-After': String(gate.retryAfterS) });

    const posts = (await store.get(P.posts).catch(() => null)) || [];

    if (action === 'boardPost') {
      const parsed = parsePost({ ...body, name: body.name || me.name }, () => Date.now());
      if (!parsed.ok) return bad(parsed.error);
      await store.put(P.posts, addPost(posts, parsed.value, me.uid));
      return json({ ok: true, id: parsed.value.id });
    }

    if (action === 'boardReply') {
      const parsed = parseReply({ ...body, name: body.name || me.name }, { admin: false });
      if (!parsed.ok) return bad(parsed.error);
      const r = addReply(posts, String(body.postId || ''), parsed.value, me.uid);
      if (!r.ok) return bad(r.error, 404);
      await store.put(P.posts, r.value);
      return json({ ok: true });
    }

    const r = boardReport(posts, { postId: String(body.postId || ''), replyId: body.replyId ? String(body.replyId) : null, uid: me.uid });
    if (!r.ok) return bad(r.error, 404);
    await store.put(P.posts, r.value);
    return json({ ok: true });
  }

  // ── 단지 사진·현장 정보 — 가 봐야 아는 것(베이·지하주차장 연결 등) ──
  if (action === 'albumFacts') {
    const parsed = parseFacts(body);
    if (!parsed.ok) return bad(parsed.error);
    const path = P.facts(parsed.value.complexId);
    const rows = (await store.get(path).catch(() => null)) || [];
    const next = upsertFacts(rows, parsed.value, me.uid);
    await store.put(path, next);
    await refreshIndex(store, parsed.value.complexId, cleanMeta(body.meta || {}));
    const agg = aggregateFacts(next);
    return json({ ok: true, facts: agg, digest: factsDigest(agg), answered: next.length });
  }

  if (action === 'albumPhoto') {
    const parsed = parsePhoto(body);
    if (!parsed.ok) return bad(parsed.error);
    const gate = await createLimiter(store).check([
      { key: `photo:ip:${clientIp(request)}`, max: 10, windowMs: 10 * 60e3, label: '사진을 너무 자주 올렸습니다' },
      { key: `photo:uid:${me.uid}`, max: 20, windowMs: 60 * 60e3, label: '한 시간에 올릴 수 있는 수를 넘었습니다' },
    ]);
    if (!gate.ok) return json({ ok: false, error: `${gate.label}. ${Math.ceil(gate.retryAfterS / 60)}분 뒤에 다시 시도해 주세요.` }, 429, 'no-store', { 'Retry-After': String(gate.retryAfterS) });

    // 화면이 줄여서 data URL 로 보냅니다 — 다시 한 번 형식·크기를 보고 저장합니다
    const m = String(body.data || '').match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
    if (!m || m[1] !== parsed.value.type) return bad('사진 데이터를 읽지 못했습니다');
    let bin;
    try { bin = Buffer.from(m[2], 'base64'); } catch { return bad('사진 데이터를 읽지 못했습니다'); }
    if (!bin.length || bin.length > PHOTO_MAX_BYTES) return bad('사진이 너무 큽니다 — 화면에서 줄여 올려 주세요');

    const v = parsed.value;
    await store.putRaw(photoPath(v.complexId, v.id, v.ext), bin, v.type);
    const path = P.photos(v.complexId);
    const rows = (await store.get(path).catch(() => null)) || [];
    await store.put(path, addPhoto(rows, { ...v, bytes: bin.length, name: me.name }, me.uid));
    await refreshIndex(store, v.complexId, cleanMeta(body.meta || {}));
    return json({ ok: true, id: v.id });
  }

  // ── 다른 곳에서 본 이야기 — 옮겨 적기가 아니라 자기 말 요약 + 원문 링크 ──
  if (action === 'outside') {
    const parsed = parseOutside(body, () => Date.now());
    if (!parsed.ok) return bad(parsed.error);
    const gate = await createLimiter(store).check([
      { key: `outside:ip:${clientIp(request)}`, max: 10, windowMs: 10 * 60e3, label: '너무 자주 올렸습니다' },
      { key: `outside:uid:${me.uid}`, max: 20, windowMs: 60 * 60e3, label: '한 시간에 올릴 수 있는 수를 넘었습니다' },
    ]);
    if (!gate.ok) return json({ ok: false, error: `${gate.label}. ${Math.ceil(gate.retryAfterS / 60)}분 뒤에 다시 시도해 주세요.` }, 429, 'no-store', { 'Retry-After': String(gate.retryAfterS) });

    const path = P.outside(parsed.value.complexId);
    const rows = (await store.get(path).catch(() => null)) || [];
    const next = addOutside(rows, { ...parsed.value, name: me.name }, me.uid);
    await store.put(path, next);
    await refreshIndex(store, parsed.value.complexId, cleanMeta(body.meta || {}));
    return json({ ok: true, digest: outsideDigest(next) });
  }

  if (action === 'report') {
    const id = String(body.id || '');
    const complexId = Number(body.complexId);
    const kind = ['visit', 'outside', 'photo'].includes(body.kind) ? body.kind : 'rating';
    const path = kind === 'rating' ? P.ratings(complexId)
      : kind === 'visit' ? P.visits(complexId)
      : kind === 'photo' ? P.photos(complexId) : P.outside(complexId);
    const rows = (await store.get(path).catch(() => null)) || [];
    // 다른 곳 이야기·사진은 저장 모양이 달라(reports 가 배열) 각자 신고 함수를 씁니다
    const r = kind === 'outside' ? reportOutside(rows, id, me.uid)
      : kind === 'photo' ? reportPhoto(rows, id, me.uid)
      : applyReport(rows, id, me.uid);
    if (!r.ok) return bad('글을 찾지 못했습니다', 404);
    await store.put(path, kind === 'rating' || kind === 'visit' ? r.rows : r.value);
    await refreshIndex(store, complexId);
    return json({ ok: true });
  }

  if (action === 'host') {
    const parsed = parseHost(body, { now });
    if (!parsed.ok) return bad(parsed.error);
    const hosts = (await store.get(P.hosts).catch(() => null)) || [];
    const next = hosts.filter(h => h.uid !== me.uid);
    const row = { ...parsed.value, uid: me.uid, id: rid().slice(0, 10), contact: String(body.contact || '').trim().slice(0, 60) };
    next.push(row);
    await store.put(P.hosts, next);
    return json({ ok: true, host: publicHost(row), pending: row.status === 'pending' });
  }

  if (action === 'request') {
    const parsed = parseRequest(body, { now });
    if (!parsed.ok) return bad(parsed.error);
    const reqs = (await store.get(P.requests).catch(() => null)) || [];
    const row = { ...parsed.value, uid: me.uid, id: rid().slice(0, 10), contact: String(body.contact || '').trim().slice(0, 60) };
    reqs.push(row);
    await store.put(P.requests, reqs);
    const hosts = (await store.get(P.hosts).catch(() => null)) || [];
    return json({ ok: true, request: publicRequest(row, { forUid: me.uid }), hosts: matchHosts(row, hosts).map(publicHost) });
  }

  if (action === 'apply' || action === 'accept') {
    const reqs = (await store.get(P.requests).catch(() => null)) || [];
    const idx = reqs.findIndex(r => r.id === String(body.requestId || ''));
    if (idx < 0) return bad('요청을 찾지 못했습니다', 404);
    const hosts = (await store.get(P.hosts).catch(() => null)) || [];

    if (action === 'apply') {
      const host = hosts.find(h => h.uid === me.uid && h.status === 'active');
      if (!host) return bad('활동 중인 동행자만 지원할 수 있습니다', 403);
      const r = applyTo(reqs[idx], host.id);
      if (!r.ok) return bad(r.error);
      reqs[idx] = r.value;
      await store.put(P.requests, reqs);
      return json({ ok: true });
    }

    if (reqs[idx].uid !== me.uid) return bad('요청을 올린 사람만 수락할 수 있습니다', 403);
    const r = accept(reqs[idx], String(body.hostId || ''), { now });
    if (!r.ok) return bad(r.error);
    reqs[idx] = r.value;
    await store.put(P.requests, reqs);
    // 수락한 순간부터 서로 연락처를 봅니다(제3자 제공 동의는 올릴 때 받았습니다)
    const host = hosts.find(h => h.id === r.value.matchedHostId) || null;
    if (host) { host.done = (host.done || 0) + 1; await store.put(P.hosts, hosts); }
    return json({ ok: true, contact: host ? { name: host.name, kind: host.kind, contact: host.contact || '' } : null });
  }

  return bad('action 이 필요합니다');
}
