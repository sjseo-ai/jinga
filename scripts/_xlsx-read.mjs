// XLSX 읽기 — 의존성 없이 첫 시트를 [[셀,…],…] 로 돌려줍니다.
//
// 왜 직접 쓰나 — 공공데이터포털 표준데이터는 오픈API 없이 **XLSX 파일로만** 주는 것이 많습니다
// (전국도시철도역사정보 15013205 가 그렇습니다). 「엑셀로 열어 CSV 로 다시 저장하세요」라고
// 사람에게 떠넘기면 그 단계에서 인코딩·따옴표·셀 서식이 틀어집니다. 받은 파일을 그대로 읽는 게 낫습니다.
// 이 저장소는 npm 의존성을 두지 않으므로 Node 내장 zlib 만 씁니다.
//
// 한계(알고 쓰는 것) — 읽기 전용이고, 수식은 **계산값**을 읽습니다(<v>). 날짜는 엑셀 일련번호로
// 그대로 나옵니다(이 자료에는 날짜 칸을 쓰지 않습니다). 시트 하나만 읽습니다.
import zlib from 'node:zlib';
import fs from 'node:fs';

/** zip 중앙 디렉터리를 훑어 { 이름: 압축해제된 Buffer } */
export function unzip(buf) {
  const out = {};
  for (let i = 0; i < buf.length - 4; i++) {
    if (buf.readUInt32LE(i) !== 0x02014b50) continue;          // 중앙 디렉터리 항목
    const method = buf.readUInt16LE(i + 10);
    const csize = buf.readUInt32LE(i + 20);
    const nlen = buf.readUInt16LE(i + 28);
    const offset = buf.readUInt32LE(i + 42);
    const name = buf.slice(i + 46, i + 46 + nlen).toString('utf8');
    // 지역 헤더에서 실제 데이터 시작 위치를 다시 구합니다(여기 길이가 중앙 것과 다를 수 있음)
    if (buf.readUInt32LE(offset) !== 0x04034b50) continue;
    const lnlen = buf.readUInt16LE(offset + 26), lelen = buf.readUInt16LE(offset + 28);
    const start = offset + 30 + lnlen + lelen;
    const raw = buf.slice(start, start + csize);
    try {
      out[name] = method === 0 ? raw : zlib.inflateRawSync(raw);
    } catch { /* 못 푸는 항목은 건너뜁니다 — 필요한 것만 쓰면 됩니다 */ }
  }
  return out;
}

const unescapeXml = s => String(s)
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(Number(d)))
  .replace(/&#x([0-9a-fA-F]+);/g, (m, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&amp;/g, '&');                                     // amp 는 **마지막에** — 먼저 풀면 이중 복원됩니다

/** sharedStrings.xml → 문자열 배열. <si> 안에 <t> 가 여러 개(서식 조각)면 이어 붙입니다 */
export function parseSharedStrings(xml) {
  if (!xml) return [];
  const out = [];
  for (const m of String(xml).matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    let s = '';
    for (const t of m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) s += unescapeXml(t[1]);
    out.push(s);
  }
  return out;
}

/** 'BC12' → 열 번호(0부터) */
export function colIndex(ref) {
  const letters = String(ref).match(/^[A-Z]+/);
  if (!letters) return 0;
  let n = 0;
  for (const ch of letters[0]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** sheet1.xml + 공유문자열 → 행 배열. 빈 셀은 '' 로 채워 열 위치가 밀리지 않게 합니다 */
export function parseSheet(xml, shared) {
  const rows = [];
  for (const r of String(xml).matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = [];
    for (const c of r[1].matchAll(/<c([^>]*)>([\s\S]*?)<\/c>|<c([^>]*)\/>/g)) {
      const attrs = c[1] ?? c[3] ?? '';
      const body = c[2] ?? '';
      const ref = (attrs.match(/r="([A-Z]+\d+)"/) || [])[1];
      const type = (attrs.match(/t="(\w+)"/) || [])[1];
      let v = '';
      if (type === 'inlineStr') {
        const t = body.match(/<t[^>]*>([\s\S]*?)<\/t>/);
        v = t ? unescapeXml(t[1]) : '';
      } else {
        const vm = body.match(/<v[^>]*>([\s\S]*?)<\/v>/);
        const raw = vm ? unescapeXml(vm[1]) : '';
        v = type === 's' ? (shared[Number(raw)] ?? '') : raw;     // t="s" 는 공유문자열 번호
      }
      const at = ref ? colIndex(ref) : row.length;
      while (row.length < at) row.push('');
      row[at] = v;
    }
    rows.push(row);
  }
  return rows;
}

/** 파일 경로 → 첫 시트의 행 배열 */
export function readXlsx(file) {
  const files = unzip(fs.readFileSync(file));
  const sheetName = Object.keys(files).find(n => /^xl\/worksheets\/sheet1\.xml$/.test(n))
    || Object.keys(files).find(n => /^xl\/worksheets\/.*\.xml$/.test(n));
  if (!sheetName) throw new Error(`${file} 에서 시트를 찾지 못했습니다 — xlsx 가 맞는지 보세요`);
  const shared = parseSharedStrings(files['xl/sharedStrings.xml'] && files['xl/sharedStrings.xml'].toString('utf8'));
  return parseSheet(files[sheetName].toString('utf8'), shared);
}
