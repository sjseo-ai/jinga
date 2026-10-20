// 공개 API 남용 막기 — 메일을 보내는 길목(커뮤니티 확인 메일·보고서 구독)에 씁니다.
//
// 왜 필요한가 — 이 두 곳은 로그인 없이 부를 수 있고, 부르면 **우리 메일 계정에서** 남의 주소로 메일이 나갑니다.
// 막지 않으면 남의 주소를 넣고 반복 호출해 스팸을 뿌릴 수 있고(메일 폭탄), 그 피해는 받는 사람과
// **우리 발신 계정**(하루 한도 초과 → 정지, 발신 평판 하락) 양쪽에 옵니다.
//
// 세는 방법 — 관리자 로그인 잠금(_auth.mjs)과 같은 방식으로 Blob 에 창(window) 단위 횟수를 둡니다.
// 완벽한 동시성 보장은 없지만(같은 순간 들어온 요청은 서로를 못 봄) 이 규모에서는 충분하고,
// 무엇보다 **한 대의 기계가 초당 수십 번 때리는** 전형적인 남용을 막습니다.
//
// 개인정보 — 접속 주소(IP)·메일 주소는 원문으로 저장하지 않고 해시 열쇠로만 셉니다(아래 idKey).
import { createHash } from 'node:crypto';
/**
 * 프록시를 거쳐 오므로 x-real-ip → x-forwarded-for 첫 칸 순으로 봅니다.
 * 헤더는 보내는 쪽이 마음대로 적을 수 있으니 **주소에 쓰이는 글자(숫자·a~f·점·콜론)만** 남깁니다.
 * 그대로 두면 지어낸 값이 저장 열쇠에 섞여 들어갑니다.
 */
export const clientIp = request => {
  const real = request.headers.get('x-real-ip');
  const fwd = String(request.headers.get('x-forwarded-for') || '').split(',')[0];
  const raw = String(real || fwd || '').trim().toLowerCase().slice(0, 45);   // IPv6 최대 45자
  // 글자를 골라내는 것으로는 부족합니다(예: '<script>1.2.3.4' 에서 c 가 살아남음).
  // 주소 모양이 아니면 전부 한 칸('unknown')에 몰아넣어, 헤더를 지어내 칸을 바꿔 가며 피하지 못하게 합니다.
  const v4 = /^\d{1,3}(\.\d{1,3}){3}$/;
  const v6 = /^[0-9a-f:]{2,45}$/;
  return v4.test(raw) || (v6.test(raw) && raw.includes(':')) ? raw : 'unknown';
};

export const RATE_PATH = 'guard/rate.json';
const KEEP_MS = 24 * 3600e3;          // 오래된 칸은 지워 파일이 계속 커지지 않게
const MAX_KEYS = 5000;                // 그래도 커지면 오래된 것부터 버림

/**
 * 규칙 하나 = { key, max, windowMs, label }
 *   key      — 무엇마다 셀지(예: `login:ip:1.2.3.4` · `login:mail:<해시>` · `login:all`)
 *   max      — 그 창 안에서 허용할 횟수
 *   windowMs — 창 길이
 * 규칙 여럿을 한 번에 검사하고, 하나라도 넘치면 막습니다(넘긴 규칙은 세지 않고 그대로 둡니다).
 */
export function createLimiter(store, { path = RATE_PATH, now = () => Date.now() } = {}) {
  const load = async () => (await store.get(path).catch(() => null)) || {};

  const sweep = (g, t) => {
    for (const [k, v] of Object.entries(g)) if (t - (v.first || 0) > KEEP_MS) delete g[k];
    const keys = Object.keys(g);
    if (keys.length > MAX_KEYS) {
      keys.sort((a, b) => (g[a].first || 0) - (g[b].first || 0));
      for (const k of keys.slice(0, keys.length - MAX_KEYS)) delete g[k];
    }
  };

  /**
   * → { ok: true } | { ok: false, retryAfterS, label }
   * 통과하면 규칙마다 1씩 올려 저장합니다(막혔을 때는 올리지 않습니다 — 계속 때려도 잠금이 늘어나지만 않게).
   */
  async function check(rules = []) {
    const list = rules.filter(r => r && r.key && r.max > 0 && r.windowMs > 0);
    if (!list.length) return { ok: true };
    const t = now();
    const g = await load();

    for (const r of list) {
      const e = g[r.key];
      if (e && t - e.first < r.windowMs && e.n >= r.max) {
        return { ok: false, retryAfterS: Math.max(1, Math.ceil((e.first + r.windowMs - t) / 1000)), label: r.label || '' };
      }
    }
    for (const r of list) {
      const e = g[r.key];
      g[r.key] = e && t - e.first < r.windowMs ? { n: e.n + 1, first: e.first } : { n: 1, first: t };
    }
    sweep(g, t);
    await store.put(path, g).catch(() => {});      // 세기를 못 해도 서비스는 계속
    return { ok: true };
  }

  return { check, load };
}

/**
 * 열쇠는 해시로 만듭니다 — **접속 주소(IP)와 메일 주소는 개인정보**라서, 횟수를 세려고
 * 원문을 저장해 두지 않습니다. 같은 사람인지만 알면 되므로 되돌릴 수 없는 값으로 충분합니다.
 * 소금(salt)은 운영 키에서 가져와, 파일을 보더라도 주소를 거꾸로 맞혀 볼 수 없게 합니다.
 */
const salt = () => String(process.env.JINGA_ADMIN_SECRET || 'jinga-rate');
export const idKey = (prefix, kind, value) =>
  `${prefix}:${kind}:${createHash('sha256').update(`${kind}|${String(value).trim().toLowerCase()}|${salt()}`).digest('hex').slice(0, 16)}`;

export const mailKey = (prefix, email) => idKey(prefix, 'mail', email);

/** 메일을 보내는 길목에 쓰는 기본 규칙 — 한 사람(IP)·한 주소·전체 세 겹 */
export const mailRules = (prefix, ip, email) => [
  { key: idKey(prefix, 'ip', ip), max: 5, windowMs: 15 * 60e3, label: '같은 곳에서 너무 자주 신청했습니다' },
  { key: mailKey(prefix, email), max: 3, windowMs: 60 * 60e3, label: '같은 주소로 너무 자주 보냈습니다' },
  { key: `${prefix}:all`, max: 120, windowMs: 60 * 60e3, label: '지금 신청이 몰리고 있습니다' },
];
