// 진가 주간 보고서 HTML — 메일 본문 · 웹 보기(/r/…) · 보관 파일 공용 (Vercel 서버 발송 작업과 운영 PC 스크립트가 같이 씀)
// 메일 앱은 스크립트를 막고 CSS 지원이 제각각이라:
//   · 모양은 전부 인라인 스타일 + 표 레이아웃 — <style>이 지워져도 디자인이 유지됨
//   · 위: 핵심(지표 카드 4개 · 이번 주 핵심 · 진가 BEST 5) / 아래: 세부 내용 탭(가격 동향 · 호가 vs KB · 시장 지표 · 지역 뉴스)
//   · 탭은 라디오 버튼 + :checked CSS(스크립트 없음). 입력 요소·<style>·id를 지우는 메일 앱(Gmail 등)에서는
//     탭 막대가 숨고(인라인 display:none) 네 섹션이 제목과 함께 차례로 펼쳐짐 — 어느 경우에도 내용이 가려지지 않음
//   · 메일 발송 때 <!--MAIL_TOP--> · <!--MAIL_BOTTOM--> 자리에 조건·웹 보기·수신 거부 안내를 넣음(_mail.mjs weeklyMail)
import { SCORE_RULES, ASK_MIN_COUNT, ASK_MAX_GAP, fmtEok, fmtDateTime, builtText } from '../jinga-kb.mjs';

const C = {
  ink: '#0E1C2B', text: '#1B2A38', muted: '#6B7A89', faint: '#8A97A5', line: '#E3E8EE', soft: '#F4F6F9', bg: '#EEF1F5',
  blue: '#1E5FCC', blueSoft: '#E9F0FB', up: '#D6333A', down: '#2D6FE0', green: '#16805A', greenSoft: '#E3F3EC', amber: '#B26A00', amberSoft: '#FFF3DF',
};
const FONT = "'Apple SD Gothic Neo','Malgun Gothic','맑은 고딕',Pretendard,sans-serif";
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const signPct = (v, digits = 2) => v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(digits)}%`;
const tone = v => v > 0 ? C.up : v < 0 ? C.down : C.muted;
const fmtD = d => `${d.getMonth() + 1}/${d.getDate()}`;
const won = man => `${Math.round(man).toLocaleString('ko-KR')}만`;

export const TABS = [['price', '가격 동향'], ['ask', '호가 vs KB'], ['market', '시장 지표'], ['news', '지역 뉴스']];

const TAB_CSS = [
  '#jg-on:checked ~ .jg-tabs .jg-bar{display:block !important}',
  '#jg-on:checked ~ .jg-tabs .jg-panel{display:none !important}',
  '#jg-on:checked ~ .jg-tabs .jg-ph{display:none !important}',
  TABS.map((_, i) => `#jg-t${i + 1}:checked ~ .jg-tabs .jg-p${i + 1}`).join(',') + '{display:block !important}',
  TABS.map((_, i) => `#jg-t${i + 1}:checked ~ .jg-tabs .jg-l${i + 1}`).join(',') + `{background:${C.ink} !important;color:#fff !important;border-color:${C.ink} !important}`,
  '.jg-l{cursor:pointer}',
  'a{color:inherit}',
  '@media (max-width:540px){.jg-card{padding-left:16px !important;padding-right:16px !important}.jg-big{font-size:22px !important}}',
].join('\n');

// ── 작은 부품 ────────────────────────────────────────────────
const chip = (text, bg = 'rgba(255,255,255,.12)', color = '#fff') =>
  `<span style="display:inline-block;background:${bg};color:${color};font-size:12px;font-weight:700;border-radius:999px;padding:3px 10px;margin:0 4px 6px 0;white-space:nowrap">${text}</span>`;
const tag = (text, bg, color) =>
  `<span style="display:inline-block;background:${bg};color:${color};font-size:11px;font-weight:800;border-radius:6px;padding:1px 7px;white-space:nowrap">${text}</span>`;
const subTitle = (text, first = false) =>
  `<div style="font-size:14px;font-weight:800;color:${C.ink};margin:${first ? '4px' : '22px'} 0 8px">${text}</div>`;
const note = text => `<div style="font-size:12px;line-height:1.6;color:${C.muted};margin:6px 0 0">${text}</div>`;

function table(head, rows, align = [], empty = '자료가 없습니다') {
  const th = head ? `<tr>${head.map((h, i) => `<td style="padding:8px 6px;border-bottom:2px solid ${C.ink};font-size:12px;font-weight:700;color:${C.muted};text-align:${align[i] || 'left'};white-space:nowrap">${h}</td>`).join('')}</tr>` : '';
  const body = rows.length
    ? rows.map(r => `<tr>${r.map((c, i) => `<td style="padding:9px 6px;border-bottom:1px solid ${C.line};font-size:13px;line-height:1.5;text-align:${align[i] || 'left'};vertical-align:top">${c}</td>`).join('')}</tr>`).join('')
    : `<tr><td colspan="${head ? head.length : 1}" style="padding:12px 6px;font-size:13px;color:${C.muted}">${empty}</td></tr>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">${th}${body}</table>`;
}

function moveTag(diff, id, i) {
  if (!diff.rankCompared) return '';
  const prevI = diff.prevBest.findIndex(b => b.id === id);
  if (prevI < 0) return tag('NEW', C.greenSoft, C.green);
  if (prevI === i) return tag('유지', C.soft, C.muted);
  return prevI > i ? tag(`▲${prevI - i}`, '#FDECEC', C.up) : tag(`▼${i - prevI}`, C.blueSoft, C.down);
}

function kpi(label, value, sub, color = C.ink) {
  return `<div style="background:${C.soft};border-radius:12px;padding:14px 16px">
<div style="font-size:12px;font-weight:700;color:${C.muted}">${label}</div>
<div class="jg-big" style="font-size:26px;font-weight:800;color:${color};letter-spacing:-.02em;line-height:1.3;margin-top:2px">${value}</div>
<div style="font-size:12px;color:${C.muted};margin-top:2px">${sub}</div></div>`;
}

function criteriaChips(criteria, gus) {
  const { budget, budgetMin = 0, minArea = 0, maxArea = 0, minHh = 0, basis = 'kb', maxRentPct = 0 } = criteria;
  const money = budgetMin ? `${fmtEok(budgetMin)} ~ ${fmtEok(budget)}` : `${fmtEok(budget)} 이하`;
  const area = maxArea ? (minArea ? `${minArea}~${maxArea}㎡` : `${maxArea}㎡ 이하`) : (minArea ? `${minArea}㎡ 이상` : '면적 무관');
  return [...gus.map(g => chip(esc(g), C.blue)), chip(`예산 ${money}`), chip(`전용 ${area}`),
    chip(minHh ? `${minHh.toLocaleString('ko-KR')}세대 이상` : '규모 무관'), chip(basis === 'ask' ? '매물 호가 기준' : 'KB시세 기준'),
    maxRentPct > 0 ? chip(maxRentPct === 1 ? '임대세대 없는 단지만' : `임대세대 ${maxRentPct}% 이하`) : ''].join('');
}

// ── 위: 핵심 ─────────────────────────────────────────────────
function kpiGrid({ result, diff, macro, ask }) {
  const cnt = result.complexCount;
  const d = diff.prevCount != null ? cnt - diff.prevCount : null;
  const k1 = kpi('조건 충족 단지', `${cnt.toLocaleString('ko-KR')}<span style="font-size:15px">곳</span>`,
    `${result.qualifying.length}개 면적${d != null ? ` · 지난주 대비 <b style="color:${tone(d)}">${d > 0 ? '+' : ''}${d}곳</b>` : ''}`);
  const k2 = ask && ask.count
    ? kpi('호가 괴리 (중앙값)', signPct(ask.medGap, 1), `KB시세 대비 · ${ask.count}개 면적`, tone(ask.medGap))
    : kpi('호가 괴리 (중앙값)', '—', '믿을 만한 호가 표본 없음');
  const seoul = macro.housing.data?.regions?.['서울'];
  const k3 = seoul && typeof seoul.wowChangePct === 'number'
    ? kpi('서울 아파트 매매지수', signPct(seoul.wowChangePct), `전주 대비 · ${esc(seoul.asOf)}`, tone(seoul.wowChangePct))
    : kpi('서울 아파트 매매지수', '—', '조회 실패');
  const band = macro.mortgage.data?.band;
  const k4 = band
    ? kpi('주담대 금리', `${band.min.toFixed(2)}<span style="font-size:15px">~</span>${band.max.toFixed(2)}<span style="font-size:15px">%</span>`, `4대 은행 · ${String(macro.mortgage.data.month || '').replace(/(\d{4})(\d{2})/, '$1.$2')} 공시`)
    : kpi('주담대 금리', '—', '조회 실패');
  const cell = (html, left) => `<td width="50%" valign="top" style="padding:0 ${left ? '6px' : '0'} 12px ${left ? '0' : '6px'}">${html}</td>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${cell(k1, true)}${cell(k2, false)}</tr><tr>${cell(k3, true)}${cell(k4, false)}</tr></table>`;
}

function keyPoints({ result, diff, news }) {
  const pts = [];
  const top = result.best5[0];
  if (top) {
    const prevIdx = diff.prevBest.findIndex(b => b.id === top.c.id);
    const move = !diff.rankCompared ? '' : prevIdx === 0 ? ' · 지난주에 이어 1위' : prevIdx > 0 ? ` · 지난주 ${prevIdx + 1}위에서 상승` : ' · 새로 1위';
    pts.push(`BEST 1위 <b>${esc(top.c.name)}</b> 전용 ${top.t.excl.toFixed(1)}㎡ · ${esc(top.score.basisLabel)} <b>${fmtEok(top.score.judge)}</b>${move}`);
  } else {
    pts.push('이번 주 조건을 충족하는 단지가 없습니다. 예산·면적 범위를 넓혀 보세요.');
  }
  if (diff.prevDate) {
    const ranked = diff.guAvg.filter(g => g.pct != null).sort((a, b) => b.pct - a.pct);
    if (ranked.length && ranked.every(g => g.pct === 0)) pts.push(`지난 보고서(${esc(diff.prevDate)})와 KB시세가 같아 구별 평당가 변동이 없습니다 — KB는 매주 금요일 전후로 시세를 갱신합니다.`);
    else if (ranked.length) pts.push(`KB 평당가 주간 변동 ${ranked.map(g => `${esc(g.gu)} <b style="color:${tone(g.pct)}">${signPct(g.pct)}</b>`).join(' · ')}`);
    if (diff.rankCompared) pts.push(`예산 조건 신규 편입 <b>${diff.entered.length}</b> · 이탈 <b>${diff.exited.length}</b>개 면적 · KB시세가 바뀐 면적 ${diff.changed.toLocaleString('ko-KR')}개`);
  } else {
    pts.push('첫 보고서라 주간 변동은 다음 보고서부터 표시됩니다.');
  }
  const total = Object.values(news.byGu).reduce((s, l) => s + l.length, 0);
  const redevel = Object.values(news.byGu).reduce((s, l) => s + l.filter(n => n.tag === '정비사업').length, 0);
  pts.push(`최근 7일 지역 뉴스 <b>${total}건</b>${redevel ? ` · 정비사업 ${redevel}건` : ''} · 정책 뉴스 ${news.policy.length}건`);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${pts.map(p =>
    `<tr><td width="16" valign="top" style="padding:7px 0 0"><span style="display:inline-block;width:7px;height:7px;border-radius:4px;background:${C.blue}"></span></td><td style="padding:3px 0;font-size:14px;line-height:1.65;color:${C.text}">${p}</td></tr>`).join('')}</table>`;
}

function bestOne(e, diff) {
  const b = e.c.brief || {};
  const s = e.score;
  const metric = (label, value, sub = '') => `<td valign="top" style="padding:12px 8px 0 0"><div style="font-size:11.5px;font-weight:700;color:${C.muted}">${label}</div><div style="font-size:17px;font-weight:800;color:${C.ink};margin-top:2px;white-space:nowrap">${value}</div>${sub ? `<div style="font-size:11.5px;color:${C.muted}">${sub}</div>` : ''}</td>`;
  return `<div style="border:2px solid ${C.blue};border-radius:14px;padding:18px 20px;background:#fff">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td valign="top">${tag('BEST 1', C.blue, '#fff')} ${moveTag(diff, e.c.id, 0)}
<div style="font-size:21px;font-weight:800;color:${C.ink};letter-spacing:-.02em;margin-top:8px">${esc(e.c.name)}</div>
<div style="font-size:13px;color:${C.muted};margin-top:2px">${esc(e.c.gu)} ${esc(e.c.dong)}${builtText(e.c, b) ? ` · ${esc(builtText(e.c, b))}` : ''} · ${e.hh.toLocaleString('ko-KR')}세대 · 전용 ${e.t.excl.toFixed(2)}㎡</div></td>
<td valign="top" align="right" style="white-space:nowrap;padding-left:10px"><div style="font-size:32px;font-weight:800;color:${C.blue};line-height:1.1">${s.total.toFixed(1)}</div><div style="font-size:11.5px;color:${C.muted};font-weight:700">진가 점수</div></td>
</tr></table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;border-top:1px solid ${C.line}"><tr>
${metric('판단 가격', fmtEok(s.judge), esc(s.basisLabel))}${metric(esc(s.altLabel), esc(s.altValue))}${metric('전세가율', s.jeonseRatio ? `${Math.round(s.jeonseRatio * 100)}%` : '—')}
</tr></table>
<div style="margin-top:12px">${s.reasons.map(r => chip(esc(r), C.soft, C.text)).join('')}</div></div>`;
}

function bestRest(list, diff) {
  if (!list.length) return '';
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px">${list.map((e, j) => {
    const i = j + 1;
    const pct = Math.max(4, Math.min(100, e.score.total));
    return `<tr>
<td width="34" valign="top" style="padding:14px 0;border-bottom:1px solid ${C.line}"><span style="display:inline-block;width:24px;height:24px;line-height:24px;text-align:center;border-radius:12px;background:${C.ink};color:#fff;font-size:12px;font-weight:800">${i + 1}</span></td>
<td valign="top" style="padding:12px 8px 12px 0;border-bottom:1px solid ${C.line}">
<div style="font-size:15px;font-weight:800;color:${C.ink}">${esc(e.c.name)} ${moveTag(diff, e.c.id, i)}</div>
<div style="font-size:12.5px;color:${C.muted};margin-top:1px">${esc(e.c.gu)} ${esc(e.c.dong)} · 전용 ${e.t.excl.toFixed(1)}㎡ · ${e.hh.toLocaleString('ko-KR')}세대</div>
<div style="font-size:13px;color:${C.text};margin-top:3px">${esc(e.score.basisLabel)} <b>${fmtEok(e.score.judge)}</b>${e.score.jeonseRatio ? ` <span style="color:${C.muted}">· 전세가율 ${Math.round(e.score.jeonseRatio * 100)}%</span>` : ''}</div></td>
<td width="96" valign="top" align="right" style="padding:12px 0;border-bottom:1px solid ${C.line};white-space:nowrap">
<div style="font-size:19px;font-weight:800;color:${C.blue}">${e.score.total.toFixed(1)}<span style="font-size:11px;color:${C.muted};font-weight:700">점</span></div>
<div style="width:88px;height:5px;background:#E3E9F1;border-radius:3px;margin-top:6px;overflow:hidden"><div style="width:${pct}%;height:5px;background:${C.blue};border-radius:3px"></div></div></td></tr>`;
  }).join('')}</table>`;
}

// ── 아래: 세부 내용 탭 ─────────────────────────────────────────
function pricePanel({ diff }) {
  const guRows = diff.guAvg.slice().sort((a, b) => b.cur - a.cur).map(g => [
    `<b>${esc(g.gu)}</b>`, won(g.cur), g.prev != null ? won(g.prev) : '—', `<b style="color:${tone(g.pct)}">${signPct(g.pct)}</b>`]);
  const keyList = list => list.length
    ? list.slice(0, 12).map(k => `${esc(k.name)} <span style="color:${C.muted}">${esc(k.gu)} ${k.excl}㎡</span>`).join(', ') + (list.length > 12 ? ` 외 ${list.length - 12}개` : '')
    : '없음';
  const movers = list => list.map(m => [
    `<b>${esc(m.name)}</b><div style="font-size:11.5px;color:${C.muted}">${esc(m.gu)} · 전용 ${Number(m.excl).toFixed(1)}㎡</div>`,
    `${fmtEok(m.from)} → <b>${fmtEok(m.to)}</b>`, `<b style="color:${tone(m.pct)}">${signPct(m.pct)}</b>`]);
  const pending = diff.prevDate ? '변동 없음' : '다음 보고서부터 표시';
  return subTitle('구별 KB 평균 평당가 (전용 기준)', true)
    + table(['자치구', '이번', '지난', '변동'], guRows, ['left', 'right', 'right', 'right'])
    + subTitle('예산 조건 편입 · 이탈')
    + (diff.rankCompared
      ? `<div style="font-size:13px;line-height:1.7">${tag(`신규 편입 ${diff.entered.length}`, C.greenSoft, C.green)} ${keyList(diff.entered)}</div><div style="font-size:13px;line-height:1.7;margin-top:6px">${tag(`이탈 ${diff.exited.length}`, '#FDECEC', C.up)} ${keyList(diff.exited)}</div>`
      : note('이 조건의 지난 보고서가 없어 다음 보고서부터 표시합니다.'))
    + subTitle('KB시세 상승 상위') + table(['단지', 'KB 일반가', '변동'], movers(diff.up), ['left', 'right', 'right'], pending)
    + subTitle('KB시세 하락 상위') + table(['단지', 'KB 일반가', '변동'], movers(diff.down), ['left', 'right', 'right'], pending);
}

function askPanel({ ask }) {
  const rows = ask.rows.slice(0, 10).map(r => [
    `<b>${esc(r.c.name)}</b><div style="font-size:11.5px;color:${C.muted}">${esc(r.c.gu)} ${esc(r.c.dong)} · ${r.t.excl.toFixed(1)}㎡</div>`,
    fmtEok(r.t.price), `<b>${fmtEok(r.t.listing.askAvg)}</b><div style="font-size:11.5px;color:${C.muted}">매물 ${r.t.listing.askCount}건</div>`,
    `<b style="color:${tone(r.gap)}">${signPct(r.gap, 1)}</b>`]);
  return note(`예산 근처 면적 중 KB 매물 호가를 믿을 수 있는(매물 ${ASK_MIN_COUNT}건 이상 · KB 대비 +${ASK_MAX_GAP}% 이하) <b>${ask.count}개 면적</b>의 호가 평균과 KB 일반거래가 비교${ask.count ? ` — 괴리 중앙값 <b>${signPct(ask.medGap, 1)}</b>` : ''}${ask.excluded ? ` · 표본 부족·이상치 ${ask.excluded}개 면적 제외` : ''}. 괴리가 큰 순서입니다.`)
    + `<div style="margin-top:10px">${table(['단지', 'KB 일반가', '호가 평균', '괴리'], rows, ['left', 'right', 'right', 'right'], '호가 데이터가 없습니다.')}</div>`
    + note('KB에 등록된 매물만 집계하므로 네이버 등 다른 곳의 매물과 차이가 있을 수 있습니다.');
}

function marketPanel({ cfg, macro }) {
  const h = macro.housing.data?.regions;
  const rows = [];
  if (h) {
    for (const r of ['서울', ...cfg.gus, '전국'].filter(x => h[x])) {
      rows.push([`주간 매매가격지수 · <b>${esc(r)}</b>`, h[r].index.toFixed(2), `<b style="color:${tone(h[r].wowChangePct)}">${signPct(h[r].wowChangePct)}</b>`, `<span style="color:${C.muted}">${esc(h[r].asOf)} · 한국부동산원</span>`]);
    }
  } else {
    rows.push(['주간 아파트 매매가격지수', '—', '—', `<span style="color:${C.muted}">조회 실패: ${esc(macro.housing.error)}</span>`]);
  }
  rows.push(macro.mortgage.data
    ? ['4대 은행 주담대 금리<div style="font-size:11.5px;color:#6B7A89">아파트 · 분할상환</div>', `${macro.mortgage.data.band.min.toFixed(2)}~${macro.mortgage.data.band.max.toFixed(2)}%`, '', `<span style="color:${C.muted}">${String(macro.mortgage.data.month || '').replace(/(\d{4})(\d{2})/, '$1.$2')} 공시 · 금감원</span>`]
    : ['4대 은행 주담대 금리', '—', '', `<span style="color:${C.muted}">조회 실패: ${esc(macro.mortgage.error)}</span>`]);
  return table(['지표', '값', '전주 대비', '기준 · 출처'], rows, ['left', 'right', 'right', 'left']);
}

const NEWS_TAG = { '정비사업': [C.amberSoft, C.amber], '교통': [C.blueSoft, C.blue], '개발·생활환경': [C.greenSoft, C.green] };
function newsList(list) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${list.map(n => {
    const [bg, fg] = NEWS_TAG[n.tag] || [C.soft, C.muted];
    return `<tr><td style="padding:8px 0;border-bottom:1px solid ${C.line};font-size:13.5px;line-height:1.55">${tag(esc(n.tag || '정책'), bg, fg)}
<a href="${esc(n.link)}" target="_blank" rel="noopener" style="color:${C.text};text-decoration:none;font-weight:600">${esc(n.title)}</a>
<div style="font-size:11.5px;color:${C.muted};margin-top:2px">${esc(n.src)} · ${fmtD(n.date)}</div></td></tr>`;
  }).join('')}</table>`;
}

function newsPanel({ cfg, news }) {
  const blocks = cfg.gus.map((gu, i) => subTitle(`${esc(gu)} <span style="font-size:12px;color:${C.muted};font-weight:700">${(news.byGu[gu] || []).length}건</span>`, i === 0)
    + ((news.byGu[gu] || []).length ? newsList(news.byGu[gu]) : note('최근 7일 관련 뉴스 없음'))).join('');
  return note('정비사업(재건축·재개발) · 교통(지하철·GTX·도로) · 개발·생활환경(학교·공원·상권) 키워드로 구글 뉴스를 찾아, 자치구·법정동 이름이 제목에 들어간 최근 7일 기사만 모았습니다.')
    + `<div style="margin-top:6px">${blocks}</div>`
    + subTitle('부동산 정책 뉴스') + (news.policy.length ? newsList(news.policy) : note('최근 7일 정책 뉴스를 찾지 못했습니다.'));
}

function detailTabs(ctx) {
  const panels = [pricePanel(ctx), askPanel(ctx), marketPanel(ctx), newsPanel(ctx)];
  const inputs = `<input type="checkbox" id="jg-on" checked style="display:none">`
    + TABS.map((_, i) => `<input type="radio" name="jg-tab" id="jg-t${i + 1}"${i === 0 ? ' checked' : ''} style="display:none">`).join('');
  const bar = `<div class="jg-bar" style="display:none;margin:14px 0 6px">${TABS.map(([, label], i) =>
    `<label for="jg-t${i + 1}" class="jg-l jg-l${i + 1}" style="display:inline-block;background:#fff;color:${C.text};border:1px solid ${C.line};border-radius:999px;padding:7px 14px;margin:0 6px 6px 0;font-size:13px;font-weight:700">${label}</label>`).join('')}</div>`;
  const body = panels.map((html, i) => `<div class="jg-panel jg-p${i + 1}" style="display:block">
<div class="jg-ph" style="font-size:16px;font-weight:800;color:${C.ink};margin:${i ? '30px' : '16px'} 0 6px;padding-top:${i ? '18px' : '0'};border-top:${i ? `2px solid ${C.ink}` : '0'}">${TABS[i][1]}</div>
<div style="padding-top:6px">${html}</div></div>`).join('');
  return `${inputs}<div class="jg-tabs">${bar}${body}</div>`;
}

// ── 전체 ─────────────────────────────────────────────────────
export function renderReportHtml({ cfg, criteria, today, asOf, result, diff, macro, news, t0 = Date.now(), ask }) {
  const top = result.best5[0];
  const preheader = `조건 충족 ${result.complexCount}곳${top ? ` · BEST 1위 ${top.c.name} ${top.score.total.toFixed(1)}점` : ''} · ${cfg.gus.join('·')}`;
  const card = (inner, extra = '') => `<tr><td class="jg-card" style="background:#fff;border-radius:16px;padding:22px 24px;${extra}">${inner}</td></tr>`;
  const gap = h => `<tr><td style="height:${h}px;line-height:${h}px;font-size:0">&nbsp;</td></tr>`;
  const sectionTitle = (text, sub = '') => `<div style="font-size:16px;font-weight:800;color:${C.ink};margin:0 0 ${sub ? '2px' : '10px'}">${text}</div>${sub ? `<div style="font-size:12px;color:${C.muted};margin-bottom:10px">${sub}</div>` : ''}`;
  const ctx = { cfg, diff, macro, news, ask };

  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><meta name="x-apple-disable-message-reformatting">
<title>진가 주간 보고서 ${esc(today)}</title>
<style>
${TAB_CSS}
</style></head>
<body style="margin:0;padding:0;background:${C.bg};font-family:${FONT};color:${C.text};-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg}"><tr><td align="center" style="padding:24px 12px 32px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:680px;width:100%;font-family:${FONT};color:${C.text};text-align:left">
<!--MAIL_TOP-->
<tr><td class="jg-card" style="background:${C.ink};border-radius:16px 16px 0 0;padding:26px 24px 20px">
<div style="font-size:11.5px;letter-spacing:.12em;color:#9FB3C8;font-weight:800">JINGA WEEKLY REPORT</div>
<div style="font-size:25px;font-weight:800;color:#fff;letter-spacing:-.02em;margin-top:4px">진가 주간 보고서 <span style="font-weight:600;color:#C9D6E3">${esc(today)}</span></div>
<div style="margin-top:14px">${criteriaChips(criteria, cfg.gus)}</div>
<div style="font-size:12px;color:#9FB3C8;margin-top:6px">KB시세 ${esc(asOf || '기준일 미확인')} 기준${diff.prevDate ? ` · 비교 기준 ${esc(diff.prevDate)}` : ''}</div>
</td></tr>
${card(`${kpiGrid({ result, diff, macro, ask })}
<div style="margin-top:8px">${sectionTitle('이번 주 핵심')}${keyPoints({ result, diff, news })}</div>`, 'border-radius:0 0 16px 16px')}
${gap(14)}
${card(`${sectionTitle('진가 BEST 5', `예산에 맞는 단지 중 진가 점수 상위 — 단지마다 점수가 가장 높은 면적 하나${diff.rankCompared ? ' · 표시는 지난주 대비 순위' : ''}`)}
${top ? bestOne(top, diff) + bestRest(result.best5.slice(1), diff) : note('조건을 충족하는 단지가 없습니다. 예산·면적 범위를 넓혀 보세요.')}`)}
${gap(14)}
${card(`${sectionTitle('세부 내용', '탭을 눌러 항목별로 볼 수 있습니다. 메일 앱에 따라 탭 대신 아래로 이어서 보일 수 있어요.')}
${detailTabs(ctx)}`)}
${gap(14)}
<tr><td style="padding:4px 8px;font-size:11.5px;line-height:1.7;color:${C.faint}">
<b style="color:${C.muted}">진가 점수(100점)</b> ${SCORE_RULES.map(r => `${r.label} ${r.max}`).join(' · ')} — KB시세·단지 정보만으로 계산한 참고 점수이며 역세권·학군·향 같은 개별 요인은 반영하지 않습니다.<br>
<b style="color:${C.muted}">출처</b> KB부동산(kbland.kr, 비공식 조회) · 한국부동산원 R-ONE · 금융감독원 금융상품 한눈에 · Google 뉴스. KB시세는 조사 시세로 실제 거래가·호가와 다를 수 있으며, 이 보고서는 투자 판단의 근거가 아닌 참고 자료입니다.<br>
생성 ${fmtDateTime(new Date())} · 소요 ${Math.round((Date.now() - t0) / 1000)}초${news.errors.length ? ` · 뉴스 조회 일부 실패 ${news.errors.length}건` : ''}
</td></tr>
<!--MAIL_BOTTOM-->
</table></td></tr></table>
</body></html>`;
}
