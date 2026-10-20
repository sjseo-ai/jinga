// 저장소 — Vercel Blob(비공개 스토어 jinga-subscribers)
//   subs/<id>.json           구독자 한 명
//   weekly/…                  주간 보고서 서버 작업(작업 상태·KB시세 조각·스냅샷·보고서 HTML/엑셀·지역 지도 집계) — api/_job.mjs
// BLOB_READ_WRITE_TOKEN 은 스토어를 프로젝트에 연결할 때 Vercel 환경변수로 자동 등록됨.
import { put, get, del, list } from '@vercel/blob';

const notFound = e => /not.?found/i.test(String(e && (e.name || e.message)));

async function readStream(pathname) {
  try {
    const r = await get(pathname, { access: 'private', useCache: false });
    if (!r || r.statusCode !== 200 || !r.stream) return null;
    return new Response(r.stream);
  } catch (e) {
    if (notFound(e)) return null;
    throw e;
  }
}

export function blobStore() {
  return {
    async get(pathname) {
      const r = await readStream(pathname);
      return r ? JSON.parse(await r.text()) : null;
    },
    async put(pathname, obj) {
      await put(pathname, JSON.stringify(obj), { access: 'private', allowOverwrite: true, addRandomSuffix: false, contentType: 'application/json' });
    },
    /** 문자열·바이트 그대로 */
    async getText(pathname) {
      const r = await readStream(pathname);
      return r ? r.text() : null;
    },
    async getBytes(pathname) {
      const r = await readStream(pathname);
      return r ? new Uint8Array(await r.arrayBuffer()) : null;
    },
    async putRaw(pathname, body, contentType) {
      await put(pathname, body, { access: 'private', allowOverwrite: true, addRandomSuffix: false, contentType });
    },
    async del(pathname) {
      await del(pathname);
    },
    async list(prefix) {
      const out = [];
      let cursor;
      do {
        const r = await list({ prefix, cursor, limit: 1000 });
        r.blobs.forEach(b => out.push(b.pathname));
        cursor = r.hasMore ? r.cursor : undefined;
      } while (cursor);
      return out;
    },
  };
}
