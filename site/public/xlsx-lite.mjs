// ess-xlsx-lite.mjs — 의존성 0 .xlsx 작성기 (excel-export-spec.md 계층 1·2).
//
// 이 파일은 도메인(ESS·재무)을 전혀 모른다. 시트 배열 [{ name, rows, colWidths, freeze, merges, tabColor, fit, printTitles }]
// 을 받아 ZIP(무압축) 바이트를 돌려줄 뿐이다. 계층 3(도메인 → 시트)은 ess-bidprice-xlsx.mjs 에 있다.
//   · 계층 1 — ZIP: CRC32 + 로컬 헤더 + 중앙디렉터리 + EOCD (타임스탬프 고정 → 같은 입력이면 같은 바이트)
//   · 계층 2 — OOXML: [Content_Types] · rels 2개 · workbook · styles · worksheets, sharedStrings 없이 inlineStr
// 셀은 원시값 또는 { v, s } — s 는 STYLES 이름표의 이름(도메인 코드는 스타일 번호를 다루지 않는다).

// ── 계층 1: CRC32 ─────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0; // >>> 0 — 부호 없는 32비트로(없으면 음수가 헤더에 기록된다)
}

// ── 계층 1: ZIP (store, 무압축) ───────────────────────────────
const utf8 = (s) => new TextEncoder().encode(s);
function pushU16(out, v) { out.push(v & 0xff, (v >>> 8) & 0xff); }
function pushU32(out, v) { out.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff); }
function pushBytes(out, bytes) { for (let i = 0; i < bytes.length; i++) out.push(bytes[i]); }

/** @param {Array<{name:string, data:Uint8Array}>} files @returns {Uint8Array} */
export function zipStore(files) {
  const out = [];
  const central = [];
  const time = 0;        // 고정 타임스탬프 — 같은 입력이면 같은 바이트(골든 파일 비교 가능)
  const date = 0x2821;   // 2000-01-01 (DOS)
  for (const f of files) {
    const nameBytes = utf8(f.name);
    const crc = crc32(f.data);
    const offset = out.length; // ★ 로컬 헤더를 쓰기 "전"에 기록 — 늦으면 중앙디렉터리 오프셋이 밀려 손상 파일이 된다
    pushU32(out, 0x04034b50);
    pushU16(out, 20);
    pushU16(out, 0x0800);      // bit 11 — 파일명 UTF-8
    pushU16(out, 0);           // store
    pushU16(out, time);
    pushU16(out, date);
    pushU32(out, crc);
    pushU32(out, f.data.length);
    pushU32(out, f.data.length);
    pushU16(out, nameBytes.length);
    pushU16(out, 0);
    pushBytes(out, nameBytes);
    pushBytes(out, f.data);

    pushU32(central, 0x02014b50);
    pushU16(central, 20);      // 만든 버전
    pushU16(central, 20);      // 필요 버전
    pushU16(central, 0x0800);
    pushU16(central, 0);
    pushU16(central, time);
    pushU16(central, date);
    pushU32(central, crc);
    pushU32(central, f.data.length);
    pushU32(central, f.data.length);
    pushU16(central, nameBytes.length);
    pushU16(central, 0);       // extra
    pushU16(central, 0);       // 주석
    pushU16(central, 0);       // 시작 디스크
    pushU16(central, 0);       // 내부 속성
    pushU32(central, 0);       // 외부 속성
    pushU32(central, offset);  // ★ 로컬 헤더 오프셋
    pushBytes(central, nameBytes);
  }
  const cdOffset = out.length;
  pushBytes(out, Uint8Array.from(central));
  pushU32(out, 0x06054b50);
  pushU16(out, 0);
  pushU16(out, 0);
  pushU16(out, files.length);
  pushU16(out, files.length);
  pushU32(out, central.length);
  pushU32(out, cdOffset);
  pushU16(out, 0);
  return Uint8Array.from(out);
}

// ── 계층 2: OOXML 유틸 ────────────────────────────────────────
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

export function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;') // ★ 반드시 첫 번째 — 나중에 하면 &lt; 가 &amp;lt; 가 된다
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ''); // 엑셀이 '복구 불가'로 거부하는 C0 제어문자 제거(탭·줄바꿈은 허용)
}

/** 0 → A, 25 → Z, 26 → AA (이중 알파벳 — (n-1) 보정이 없으면 26이 BA가 된다) */
export function colName(index) {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** 시트 이름 제약: 31자, : \ / ? * [ ] 금지, 빈 이름 불가 */
export function safeSheetName(name, fallback = 'Sheet') {
  const cleaned = String(name).replace(/[:\\/?*[\]]/g, ' ').trim().slice(0, 31);
  return cleaned || fallback;
}

// ── 스타일 — 화면 CSS 토큰과 같은 색(AARRGGBB 8자리) ─────────────
export const COLORS = {
  ACCENT: 'FF0F6B4A',      // --accent
  ACCENT_SOFT: 'FFE7F2ED', // --accent-soft
  ZEBRA: 'FFF4F6F8',       // --bg
  LINE: 'FFD5DBE1',
  MUTED: 'FF7B8794',       // --muted
  INK2: 'FF4A5462',        // --ink-2
  REV: 'FF2F8F6B',         // 차트 매출색
  OPEX: 'FFD98324',        // 차트 운영비색
  NEG: 'FFB3261E',         // --neg
  WARN: 'FF8A4B08',        // --warn-ink
  HEAT5: 'FFD7EDE2', HEAT4: 'FFE9F4EE', HEAT2: 'FFFDECEB', HEAT1: 'FFF9D9D6', // 화면 히트맵 5단계(중간은 무색)
  BAD_SOFT: 'FFFDECEA',
};
const FONT_NAME = '맑은 고딕';

// ⚠ 커스텀 numFmt ID 는 164 이상(0~163은 엑셀 내장 예약)
const NUM_FMTS = [
  { id: 164, code: '#,##0.0' },                          // 억원 1자리 — 읽는 값
  { id: 165, code: '#,##0.00' },                         // 2자리 — 단가·검산
  { id: 166, code: '0.00%' },                            // 비율(원값 0~1)
  { id: 167, code: '#,##0.0;[Red]-#,##0.0' },            // 음수 빨강(현금흐름)
  { id: 168, code: '0.000' },                            // DSCR·대당 용량
  { id: 169, code: '#,##0' },                            // 정수(MWh·대수)
  { id: 170, code: '0' },                                // 연도(천 단위 쉼표 없이)
  { id: 171, code: '#,##0.0000' },                       // 4자리 — 원/kWh 환산분·한계가격
  { id: 172, code: '#,##0.000' },                        // 3자리 — 부록 검산용
  { id: 173, code: '#,##0.00;[Red]-#,##0.00' },          // 2자리 음수 빨강
  { id: 174, code: '#,##0.000;[Red]-#,##0.000' },        // 3자리 음수 빨강(부록)
  { id: 175, code: '+0;-0;0' },                          // Δ점
  { id: 176, code: '+#,##0.00;-#,##0.00;0.00' },         // 가격 변동(부호만 — 인하·인상은 좋고 나쁨이 아니라 빨강 없음, 화면과 같게)
];

const FONTS = [
  `<font><sz val="10"/><color theme="1"/><name val="${FONT_NAME}"/></font>`,                       // 0 기본
  `<font><b/><sz val="10"/><color theme="1"/><name val="${FONT_NAME}"/></font>`,                    // 1 굵게
  `<font><b/><sz val="15"/><color rgb="${COLORS.ACCENT}"/><name val="${FONT_NAME}"/></font>`,        // 2 제목
  `<font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="${FONT_NAME}"/></font>`,               // 3 헤더(흰 글씨)
  `<font><sz val="9"/><color rgb="${COLORS.MUTED}"/><name val="${FONT_NAME}"/></font>`,             // 4 주석·비고
  `<font><b/><sz val="10.5"/><color rgb="${COLORS.ACCENT}"/><name val="${FONT_NAME}"/></font>`,      // 5 섹션
  `<font><b/><sz val="12"/><color theme="1"/><name val="${FONT_NAME}"/></font>`,                    // 6 KPI
  `<font><b/><sz val="15"/><color rgb="${COLORS.ACCENT}"/><name val="${FONT_NAME}"/></font>`,        // 7 KPI 대표값(적정 입찰단가)
  `<font><b/><sz val="10"/><color rgb="${COLORS.NEG}"/><name val="${FONT_NAME}"/></font>`,           // 8 경고(빨강 굵게)
  `<font><sz val="10"/><color rgb="${COLORS.WARN}"/><name val="${FONT_NAME}"/></font>`,             // 9 확인 필요 문구
];

const solid = (rgb) => `<fill><patternFill patternType="solid"><fgColor rgb="${rgb}"/><bgColor indexed="64"/></patternFill></fill>`;
// ⚠ fills[0]=none, fills[1]=gray125 는 엑셀이 요구하는 예약 슬롯 — 건너뛰면 모든 채우기가 한 칸씩 밀린다
const FILLS = [
  '<fill><patternFill patternType="none"/></fill>',     // 0
  '<fill><patternFill patternType="gray125"/></fill>',  // 1
  solid(COLORS.ACCENT),      // 2 헤더
  solid(COLORS.ACCENT_SOFT), // 3 섹션
  solid(COLORS.ZEBRA),       // 4 연도·합계·축
  solid(COLORS.HEAT5),       // 5
  solid(COLORS.HEAT4),       // 6
  solid(COLORS.HEAT2),       // 7
  solid(COLORS.HEAT1),       // 8
  solid(COLORS.BAD_SOFT),    // 9 게이트 미충족
];

// ⚠ <diagonal/> 이 없으면 엑셀이 파일을 거부한다
const THIN = `<border><left style="thin"><color rgb="${COLORS.LINE}"/></left><right style="thin"><color rgb="${COLORS.LINE}"/></right>` +
  `<top style="thin"><color rgb="${COLORS.LINE}"/></top><bottom style="thin"><color rgb="${COLORS.LINE}"/></bottom><diagonal/></border>`;
const BORDERS = ['<border><left/><right/><top/><bottom/><diagonal/></border>', THIN];

/**
 * 이름 → cellXfs 인덱스. 배열 순서가 곧 인덱스이고, 도메인 코드는 이름으로만 조회한다.
 * 추가할 때는 끝에 붙인다(이름 조회라 중간에 끼워도 동작하지만 기존 파일과의 바이트 비교에 유리).
 * height 를 가진 스타일로 시작하는 행은 그 높이를 갖는다(행 높이를 도메인 코드가 신경 쓰지 않게).
 */
const STYLE_DEFS = [
  ['DEFAULT', { font: 0 }],
  ['TITLE', { font: 2, align: 'left', height: 24 }],
  ['SUBTITLE', { font: 4, align: 'left' }],
  ['SECTION', { font: 5, fill: 3, border: 1, align: 'left', height: 20 }],
  ['HEADER', { font: 3, fill: 2, border: 1, align: 'center', wrap: true, height: 30 }],
  ['LABEL', { font: 0, border: 1, align: 'left' }],
  ['LABEL_B', { font: 1, border: 1, align: 'left' }],
  ['LABEL_IN', { font: 0, border: 1, align: 'left', indent: 1 }],
  ['NUM1', { font: 0, border: 1, align: 'right', fmt: 164 }],
  ['NUM2', { font: 0, border: 1, align: 'right', fmt: 165 }],
  ['PCT', { font: 0, border: 1, align: 'right', fmt: 166 }],
  ['SIGNED', { font: 0, border: 1, align: 'right', fmt: 167 }],
  ['DEC3', { font: 0, border: 1, align: 'right', fmt: 168 }],
  ['INT', { font: 0, border: 1, align: 'right', fmt: 169 }],
  ['TEXT', { font: 0, border: 1, align: 'left' }],
  ['NOTE', { font: 4, align: 'left' }],                       // 줄바꿈 없음 — 빈 오른쪽 칸으로 흘러 한 줄로 읽힌다
  ['YEAR', { font: 1, fill: 4, border: 1, align: 'center', fmt: 170 }],
  ['TOTAL_LABEL', { font: 1, fill: 4, border: 1, align: 'left' }],
  ['TOTAL_NUM', { font: 1, fill: 4, border: 1, align: 'right', fmt: 164 }],
  ['TOTAL_PCT', { font: 1, fill: 4, border: 1, align: 'right', fmt: 166 }],
  ['KPI_LABEL', { font: 1, border: 1, align: 'left', height: 22 }],
  ['KPI_PCT', { font: 6, border: 1, align: 'right', fmt: 166 }],
  ['KPI_NUM', { font: 6, border: 1, align: 'right', fmt: 167 }],
  ['CENTER', { font: 0, border: 1, align: 'center' }],
  // ── 여기부터 이 모델용 확장(끝에 붙임) ──
  ['REMARK', { font: 4, align: 'left' }],                     // 표 오른쪽 비고 — 테두리 없이 흘려 쓴다
  ['YEAR_V', { font: 0, border: 1, align: 'right', fmt: 170 }],
  ['NUM3', { font: 0, border: 1, align: 'right', fmt: 172 }],
  ['NUM4', { font: 0, border: 1, align: 'right', fmt: 171 }],
  ['SIGNED2', { font: 0, border: 1, align: 'right', fmt: 173 }],
  ['SIGNED3', { font: 0, border: 1, align: 'right', fmt: 174 }],
  ['KPI_PRICE', { font: 7, border: 1, align: 'right', fmt: 165 }],
  ['KPI_NUM2', { font: 6, border: 1, align: 'right', fmt: 165 }],
  ['TOTAL_INT', { font: 1, fill: 4, border: 1, align: 'right', fmt: 169 }],
  ['TOTAL_SIGNED', { font: 1, fill: 4, border: 1, align: 'right', fmt: 167 }],
  ['TOTAL_NUM2', { font: 1, fill: 4, border: 1, align: 'right', fmt: 165 }],
  ['TOTAL_NUM3', { font: 1, fill: 4, border: 1, align: 'right', fmt: 172 }],
  ['TOTAL_SIGNED3', { font: 1, fill: 4, border: 1, align: 'right', fmt: 174 }],
  ['TOTAL_DELTA', { font: 1, fill: 4, border: 1, align: 'right', fmt: 175 }],
  ['TOTAL_SIGNED_PRICE', { font: 1, fill: 4, border: 1, align: 'right', fmt: 176 }],
  ['DELTA', { font: 0, border: 1, align: 'right', fmt: 175 }],
  ['SIGNED_PRICE', { font: 0, border: 1, align: 'right', fmt: 176 }],
  ['AXIS_LABEL', { font: 1, fill: 4, border: 1, align: 'left' }],
  ['AXIS_PCT', { font: 4, fill: 4, border: 1, align: 'right', fmt: 166 }],
  ['AXIS_NUM1', { font: 4, fill: 4, border: 1, align: 'right', fmt: 164 }],
  ['PCT_H5', { font: 0, fill: 5, border: 1, align: 'right', fmt: 166 }],
  ['PCT_H4', { font: 0, fill: 6, border: 1, align: 'right', fmt: 166 }],
  ['PCT_H2', { font: 0, fill: 7, border: 1, align: 'right', fmt: 166 }],
  ['PCT_H1', { font: 0, fill: 8, border: 1, align: 'right', fmt: 166 }],
  ['NUM1_H5', { font: 0, fill: 5, border: 1, align: 'right', fmt: 164 }],
  ['NUM1_H4', { font: 0, fill: 6, border: 1, align: 'right', fmt: 164 }],
  ['NUM1_H2', { font: 0, fill: 7, border: 1, align: 'right', fmt: 164 }],
  ['NUM1_H1', { font: 0, fill: 8, border: 1, align: 'right', fmt: 164 }],
  ['CENTER_BAD', { font: 8, fill: 9, border: 1, align: 'center' }],
  ['WARN', { font: 9, align: 'left' }],
  ['GOOD_TEXT', { font: 5, border: 1, align: 'left' }],
];

export const STYLES = Object.fromEntries(STYLE_DEFS.map(([name], i) => [name, i]));
const ROW_HEIGHT = Object.fromEntries(STYLE_DEFS.filter(([, d]) => d.height).map(([n, d]) => [n, d.height]));

function xfXml(def) {
  const fmt = def.fmt || 0;
  const parts = [`numFmtId="${fmt}"`, `fontId="${def.font || 0}"`, `fillId="${def.fill || 0}"`, `borderId="${def.border || 0}"`, 'xfId="0"'];
  // ⚠ apply* 플래그가 없으면 엑셀이 "상속"으로 해석해 서식을 무시할 수 있다
  if (fmt) parts.push('applyNumberFormat="1"');
  if (def.font) parts.push('applyFont="1"');
  if (def.fill) parts.push('applyFill="1"');
  if (def.border) parts.push('applyBorder="1"');
  const align = def.align || def.wrap || def.indent
    ? `<alignment horizontal="${def.align || 'general'}" vertical="center"${def.wrap ? ' wrapText="1"' : ''}${def.indent ? ` indent="${def.indent}"` : ''}/>`
    : '';
  if (align) parts.push('applyAlignment="1"');
  return align ? `<xf ${parts.join(' ')}>${align}</xf>` : `<xf ${parts.join(' ')}/>`;
}

// 요소 순서 고정: numFmts → fonts → fills → borders → cellStyleXfs → cellXfs → cellStyles. count 는 배열 길이로.
const STYLES_XML = `${XML_HEAD}<styleSheet xmlns="${NS_MAIN}">` +
  `<numFmts count="${NUM_FMTS.length}">${NUM_FMTS.map((f) => `<numFmt numFmtId="${f.id}" formatCode="${escapeXml(f.code)}"/>`).join('')}</numFmts>` +
  `<fonts count="${FONTS.length}">${FONTS.join('')}</fonts>` +
  `<fills count="${FILLS.length}">${FILLS.join('')}</fills>` +
  `<borders count="${BORDERS.length}">${BORDERS.join('')}</borders>` +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  `<cellXfs count="${STYLE_DEFS.length}">${STYLE_DEFS.map(([, d]) => xfXml(d)).join('')}</cellXfs>` +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  '</styleSheet>';

// ── 셀·워크시트 ──────────────────────────────────────────────
function normalizeCell(cell) {
  if (cell == null) return { v: null, s: 0 };
  if (typeof cell === 'object') {
    if (typeof cell.s === 'string' && !(cell.s in STYLES)) throw new Error(`알 수 없는 스타일 이름: ${cell.s}`);
    const idx = typeof cell.s === 'string' ? STYLES[cell.s] : cell.s;
    return { v: cell.v == null ? null : cell.v, s: idx == null ? 0 : idx, name: cell.s };
  }
  return { v: cell, s: 0 };
}

function cellXml(ref, cell) {
  const { v, s } = cell;
  const st = s ? ` s="${s}"` : '';
  if (v == null || v === '') return s ? `<c r="${ref}"${st}/>` : ''; // 빈 셀도 서식은 남긴다(배경색이 끊기지 않게)
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return s ? `<c r="${ref}"${st}/>` : ''; // NaN/Infinity 를 <v> 에 넣으면 엑셀이 거부 → 빈 셀
    return `<c r="${ref}"${st}><v>${v}</v></c>`;
  }
  return `<c r="${ref}"${st} t="inlineStr"><is><t xml:space="preserve">${escapeXml(v)}</t></is></c>`;
}

function sheetXml(sheet) {
  const f = sheet.freeze;
  let views;
  if (f && (f.row || f.col)) {
    const pane = f.row && f.col ? 'bottomRight' : f.row ? 'bottomLeft' : 'topRight';
    views = `<sheetViews><sheetView workbookViewId="0" showGridLines="0"${sheet.selected ? ' tabSelected="1"' : ''}><pane` +
      `${f.col ? ` xSplit="${f.col}"` : ''}${f.row ? ` ySplit="${f.row}"` : ''}` +
      ` topLeftCell="${colName(f.col || 0)}${(f.row || 0) + 1}" activePane="${pane}" state="frozen"/>` +
      `<selection pane="${pane}"/></sheetView></sheetViews>`;
  } else {
    views = `<sheetViews><sheetView workbookViewId="0" showGridLines="0"${sheet.selected ? ' tabSelected="1"' : ''}/></sheetViews>`;
  }
  const widths = sheet.colWidths || [];
  const cols = widths.length ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
  const body = (sheet.rows || []).map((row, r) => {
    const cells = (row || []).map(normalizeCell);
    const h = cells.length && cells[0].name && ROW_HEIGHT[cells[0].name];
    const attrs = h ? ` ht="${h}" customHeight="1"` : '';
    const xml = cells.map((c, i) => cellXml(`${colName(i)}${r + 1}`, c)).join('');
    return `<row r="${r + 1}"${attrs}>${xml}</row>`;
  }).join('');
  const merges = (sheet.merges || []).length
    ? `<mergeCells count="${sheet.merges.length}">${sheet.merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : '';
  const fitWidth = sheet.fit === 'width';
  const prParts = `${sheet.tabColor ? `<tabColor rgb="${sheet.tabColor}"/>` : ''}${fitWidth ? '<pageSetUpPr fitToPage="1"/>' : ''}`;
  const sheetPr = prParts ? `<sheetPr>${prParts}</sheetPr>` : '';
  // 인쇄: A4(9) 가로. fit=width 는 폭 1쪽에 맞추고 세로는 자연 분할, 그 외는 자연 분할 + 인쇄 제목 반복(printTitles)
  const pageSetup = `<pageSetup paperSize="9" orientation="landscape"${fitWidth ? ' fitToWidth="1" fitToHeight="0"' : ''}/>`;
  // 순서가 스키마로 고정: sheetPr → sheetViews → sheetFormatPr → cols → sheetData → mergeCells → pageMargins → pageSetup
  return `${XML_HEAD}<worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">` +
    sheetPr + views + '<sheetFormatPr defaultRowHeight="16.5"/>' + cols +
    `<sheetData>${body}</sheetData>` + merges +
    '<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>' + pageSetup +
    '</worksheet>';
}

/** 시트 배열 → .xlsx 바이트 */
export function buildXlsx(sheets) {
  const used = new Set();
  const named = sheets.map((s, i) => {
    let name = safeSheetName(s.name, `Sheet${i + 1}`);
    let n = 2;
    while (used.has(name)) name = safeSheetName(`${name.slice(0, 28)}(${n++})`, `Sheet${i + 1}`); // 중복 이름은 엑셀이 아예 못 연다
    used.add(name);
    return { ...s, name, selected: i === 0 };
  });
  const contentTypes = `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    named.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
    '</Types>';
  const rootRels = `${XML_HEAD}<Relationships xmlns="${NS_PKG_REL}">` +
    `<Relationship Id="rId1" Type="${NS_REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  // 규약: 시트 rId1..rIdN, 스타일 rId(N+1) — 같은 루프 변수로 만들어 workbook.xml 의 r:id 와 어긋날 수 없다
  const workbookRels = `${XML_HEAD}<Relationships xmlns="${NS_PKG_REL}">` +
    named.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${NS_REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
    `<Relationship Id="rId${named.length + 1}" Type="${NS_REL}/styles" Target="styles.xml"/></Relationships>`;
  // 인쇄 제목(매 쪽 반복할 행·열) — 넓은 원자료 시트용. 이름 정의는 sheets 뒤에 온다.
  const defined = named.map((s, i) => {
    if (!s.printTitles) return '';
    const q = `'${s.name.replace(/'/g, "''")}'`;
    const refs = [s.printTitles.cols && `${q}!$${s.printTitles.cols.replace(':', ':$')}`, s.printTitles.rows && `${q}!$${s.printTitles.rows.replace(':', ':$')}`].filter(Boolean).join(',');
    return refs ? `<definedName name="_xlnm.Print_Titles" localSheetId="${i}">${escapeXml(refs)}</definedName>` : '';
  }).join('');
  const workbook = `${XML_HEAD}<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}"><bookViews><workbookView activeTab="0"/></bookViews><sheets>` +
    named.map((s, i) => `<sheet name="${escapeXml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
    `</sheets>${defined ? `<definedNames>${defined}</definedNames>` : ''}</workbook>`;
  const files = [
    { name: '[Content_Types].xml', data: utf8(contentTypes) },
    { name: '_rels/.rels', data: utf8(rootRels) },
    { name: 'xl/workbook.xml', data: utf8(workbook) },
    { name: 'xl/_rels/workbook.xml.rels', data: utf8(workbookRels) },
    { name: 'xl/styles.xml', data: utf8(STYLES_XML) },
    ...named.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: utf8(sheetXml(s)) })),
  ];
  return zipStore(files);
}
