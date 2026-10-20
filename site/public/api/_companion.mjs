// 진가 임장동행 매칭 — 순수 계산(네트워크·저장소 없음)
//
// 무엇을 하는 서비스인가 — 「혼자 임장 가기 부담스러운 사람」과 「같이 가 줄 사람」을 연결합니다.
// 플랫폼은 **연결만** 하고 수수료를 받지 않습니다(사례는 당사자끼리).
//
// ── 법적 선(이 파일이 지키는 것) ─────────────────────────────
// 공인중개사법 제2조의 「중개」는 거래를 **알선**하는 행위이고, 무등록 중개업은 제48조로 처벌됩니다.
// 그래서 동행자를 두 종류로 나누고 할 수 있는 일을 다르게 둡니다.
//   · neighbor(이웃·경험자) — 같이 가서 **체크리스트를 봐 주는 것까지**. 매물 추천·계약 유도·보수 요구는 금지.
//   · agent(개업공인중개사) — 등록번호를 받아 관리자가 확인한 뒤에만 표시. 중개는 이쪽만 할 수 있습니다.
// 연락처는 양쪽이 수락했을 때만 서로에게 보입니다(개인정보 제3자 제공 동의를 받고 나서).
// 이 규칙은 화면 문구와 약관에도 같은 말로 들어갑니다.
import { randomUUID } from 'node:crypto';

export const KINDS = {
  neighbor: {
    key: 'neighbor', label: '이웃·임장 경험자',
    can: '같이 가서 체크리스트를 봐 주고, 살아 본 경험을 이야기해 줍니다',
    cannot: '매물 추천·계약 유도·중개보수 요구는 할 수 없습니다(공인중개사법 제2조·제48조)',
    needsLicense: false,
  },
  agent: {
    key: 'agent', label: '개업공인중개사',
    can: '중개대상물 설명과 알선까지 할 수 있습니다',
    cannot: '중개보수는 법정 상한을 넘을 수 없습니다',
    needsLicense: true,
  },
};
export const KIND_KEYS = Object.keys(KINDS);

export const REGION_MAX = 5;           // 한 사람이 맡는 지역 수
export const INTRO_MAX = 300;
export const NAME_MAX = 20;
export const STATUS = ['pending', 'active', 'paused', 'rejected'];
/** 요청 상태 — 올림 → 동행자 지원 → 요청자 수락(이때 연락처 공개) → 끝 */
export const REQ_STATUS = ['open', 'matched', 'done', 'canceled'];

const clean = (s, max) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, max);
const uniq = a => [...new Set(a)];

/** 중개사무소 등록번호 — 시군구마다 형식이 조금씩 달라 「숫자-숫자」 꼴만 확인하고 진위는 관리자가 봅니다 */
export const looksLikeLicense = v => /^\d{4,5}-\d{4,5}$/.test(String(v || '').trim());

/**
 * 동행자 프로필 다듬기
 * → { ok, value } | { ok:false, error }
 */
export function parseHost(input = {}, { now = () => new Date() } = {}) {
  const kind = KIND_KEYS.includes(input.kind) ? input.kind : null;
  if (!kind) return { ok: false, error: '동행자 종류를 골라 주세요' };
  const name = clean(input.name, NAME_MAX);
  if (name.length < 2) return { ok: false, error: '표시할 이름을 2자 이상 적어 주세요' };
  const regions = uniq((Array.isArray(input.regions) ? input.regions : []).map(r => clean(r, 12)).filter(Boolean)).slice(0, REGION_MAX);
  if (!regions.length) return { ok: false, error: '함께 갈 수 있는 지역을 하나 이상 고르세요' };
  const intro = clean(input.intro, INTRO_MAX);
  const license = clean(input.license, 20);
  if (KINDS[kind].needsLicense && !looksLikeLicense(license)) {
    return { ok: false, error: '개업공인중개사는 중개사무소 등록번호가 필요합니다(예: 11680-2024-00123 형식의 앞 두 마디)' };
  }
  if (input.agree !== true && input.agree !== 'true') return { ok: false, error: '동행자 수칙에 동의해야 등록할 수 있습니다' };
  return {
    ok: true,
    value: {
      kind, name, regions, intro,
      license: KINDS[kind].needsLicense ? license : '',
      // 이웃·경험자는 바로 활동, 공인중개사는 등록번호를 관리자가 확인한 뒤 활동
      status: KINDS[kind].needsLicense ? 'pending' : 'active',
      verified: false, at: now().toISOString(), done: 0,
    },
  };
}

/** 동행 요청 다듬기 */
export function parseRequest(input = {}, { now = () => new Date() } = {}) {
  const region = clean(input.region, 12);
  if (!region) return { ok: false, error: '가려는 지역을 골라 주세요' };
  const complexId = Number(input.complexId) || null;
  const complexName = clean(input.complexName, 40);
  const when = clean(input.when, 40);
  if (!when) return { ok: false, error: '언제 가고 싶은지 적어 주세요(예: 이번 주 토요일 오전)' };
  const note = clean(input.note, INTRO_MAX);
  const wantKind = KIND_KEYS.includes(input.wantKind) ? input.wantKind : null;   // 비우면 상관없음
  if (input.agree !== true && input.agree !== 'true') return { ok: false, error: '개인정보 제공에 동의해야 요청을 올릴 수 있습니다' };
  return {
    ok: true,
    value: {
      region, complexId, complexName, when, note, wantKind,
      status: 'open', applicants: [], matchedHostId: null, at: now().toISOString(),
    },
  };
}

/**
 * 요청에 맞는 동행자 고르기 — 지역이 같고 활동 중인 사람만.
 * 요청자가 종류를 지정했으면 그 종류만, 아니면 공인중개사를 앞에 놓되 둘 다 보여 줍니다.
 */
export function matchHosts(request, hosts = [], { limit = 10 } = {}) {
  const want = request && request.wantKind;
  const pool = (hosts || []).filter(h => h && h.status === 'active' && (h.regions || []).includes(request.region));
  const fit = want ? pool.filter(h => h.kind === want) : pool;
  const rank = h => (h.kind === 'agent' && h.verified ? 0 : h.kind === 'agent' ? 1 : 2);
  return fit
    .slice()
    .sort((a, b) => rank(a) - rank(b) || (b.done || 0) - (a.done || 0) || String(a.at).localeCompare(String(b.at)))
    .slice(0, limit);
}

/** 동행자가 요청에 지원 — 같은 사람이 여러 번 눌러도 한 번만 */
export function applyTo(req, hostId) {
  if (!req || req.status !== 'open') return { ok: false, error: '이미 마감된 요청입니다' };
  const applicants = uniq([...(req.applicants || []), hostId]);
  return { ok: true, value: { ...req, applicants } };
}

/**
 * 요청자가 한 사람을 수락 — 이때부터 서로 연락처를 볼 수 있습니다.
 * 지원하지 않은 사람은 수락할 수 없습니다.
 */
export function accept(req, hostId, { now = () => new Date() } = {}) {
  if (!req || req.status !== 'open') return { ok: false, error: '이미 마감된 요청입니다' };
  if (!(req.applicants || []).includes(hostId)) return { ok: false, error: '지원하지 않은 동행자입니다' };
  return { ok: true, value: { ...req, status: 'matched', matchedHostId: hostId, matchedAt: now().toISOString() } };
}

/** 화면에 내보낼 동행자 — 등록번호·연락처는 빼고 */
export const publicHost = h => ({
  id: h.id, kind: h.kind, kindLabel: KINDS[h.kind].label, name: h.name, regions: h.regions,
  intro: h.intro, verified: !!h.verified, done: h.done || 0, at: h.at,
  can: KINDS[h.kind].can, cannot: KINDS[h.kind].cannot,
});

/** 화면에 내보낼 요청 — 연락처는 수락된 뒤에만(그것도 당사자에게만) */
export const publicRequest = (r, { forUid = null } = {}) => ({
  id: r.id, region: r.region, complexName: r.complexName || '', when: r.when, note: r.note || '',
  wantKind: r.wantKind || null, status: r.status, applicants: (r.applicants || []).length,
  at: r.at, mine: !!forUid && r.uid === forUid,
});

export const HOST_RULES = [
  '같이 가서 봐 주는 서비스입니다 — 매물을 고르거나 계약을 권하는 자리가 아닙니다.',
  '이웃·경험자는 **중개를 할 수 없습니다**. 매물 알선·계약 유도·중개보수 요구는 공인중개사법 제2조·제48조에 걸립니다(무등록 중개업은 3년 이하 징역 또는 3천만원 이하 벌금).',
  '중개대상물 설명과 알선은 등록번호가 확인된 개업공인중개사만 할 수 있습니다.',
  '진가는 연결만 하고 수수료를 받지 않습니다. 사례·교통비는 당사자끼리 정하세요.',
  '연락처는 요청자가 수락한 뒤에만 서로에게 보입니다.',
  '처음 만나는 사람과의 약속입니다 — 낮 시간, 사람이 있는 곳에서 만나기를 권합니다.',
];
