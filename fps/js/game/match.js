/**
 * ⚓ Port Ops — 경기 규칙 엔진 (방장 권위 · 5판 3선승 팀 섬멸전)
 *
 * three.js · DOM · 네트워크에 의존하지 않는 순수 ES 모듈이다(node에서 그대로 테스트 가능).
 * 방장 클라이언트가 이 모듈로 경기를 돌리고, 메서드가 돌려준 이벤트 배열을 네트워크로 뿌린다.
 * 다른 클라이언트는 방장이 보낸 snapshot()을 applySnapshot()으로 풀어 화면에 쓴다.
 *
 *   const m = createMatch({ rules, players, spawns });
 *   send(m.start());                       // warmup → 1라운드 loadout
 *   send(m.tick(dtMs));                    // 매 프레임, ms
 *   send(m.claimHit({ attackerId, victimId, weaponId, part, dist, kind, t }));
 *   broadcast(m.snapshot());               // 이벤트가 나왔을 때 + 1 Hz 정도
 *   // 클라이언트: const view = applySnapshot(snap);   (m.state와 같은 모양)
 *
 * 모드: rules.mode 'team'(기본, 5판 3선승 팀 섬멸전) / 'ffa'(개인전, 20킬·5분·부활) — FFA 계약은 fps/MODES.md 3.1
 * 계약서: fps/js/game/MATCH_API.md
 */

export const SNAPSHOT_VERSION = 1;
export const TEAM_IDS = Object.freeze(['owner', 'charterer']);
export const PHASES = Object.freeze(['warmup', 'loadout', 'live', 'roundEnd', 'matchEnd']);
export const PARTS = Object.freeze(['head', 'body', 'legs']);
export const PRIMARY_IDS = Object.freeze(['nor1', 'dwt47']);
export const DEFAULT_LOADOUT = 'dwt47';
/** 수류탄 자해 배율 */
export const SELF_EXPLOSION_SCALE = 0.5;

/** roundEnd/matchEnd reason → 화면 문구 */
export const REASON_LABELS = Object.freeze({
  elimination: '전멸',
  time: '시간 종료 · 생존자 수',
  hp: '시간 종료 · 남은 체력',
  draw: '무승부',
  wins: '선승',
  maxRounds: '최대 라운드 도달',
  roundCap: '라운드 상한 도달',
  forfeit: '상대 팀 전원 퇴장',
  abandoned: '전원 퇴장'
});

export const DEFAULT_RULES = Object.freeze({
  roundsToWin: 3,        // 3선승
  maxRounds: 5,          // 승부가 난 라운드 최대 수(무승부 제외)
  maxTotalRounds: 9,     // 무승부 재경기 포함 총 라운드 상한(안전장치)
  roundTimeMs: 120000,   // live 2:00
  loadoutMs: 5000,       // 주무기 선택
  roundEndMs: 4000,      // 라운드 결과 표시
  hp: 100,
  maxPlayers: 8,
  maxPerTeam: 4
});
const RULE_KEYS = Object.freeze(Object.keys(DEFAULT_RULES));

export const MODES = Object.freeze(['team', 'ffa']);
/** 개인전(FFA) 규칙 기본값 — createMatch({ rules: { mode: 'ffa', ... } }). 팀전 규칙 키는 쓰지 않는다 */
export const DEFAULT_FFA_RULES = Object.freeze({
  mode: 'ffa',
  killTarget: 20,        // 먼저 닿으면 우승(5~50)
  timeLimitMs: 300000,   // 5분. 끝나면 킬↓ → 데스↑ → 헤드샷↓, 그래도 같으면 무승부
  respawnMs: 3000,       // 죽고 나서 부활까지
  spawnProtectMs: 1500,  // 부활 직후 무적(그 사람이 먼저 공격하면 바로 끝)
  loadoutMs: 5000,       // 처음 출격 전 무기 선택
  hp: 100,
  maxPlayers: 8
});
const FFA_RULE_KEYS = Object.freeze(['killTarget', 'timeLimitMs', 'respawnMs', 'spawnProtectMs', 'loadoutMs', 'hp', 'maxPlayers']);
/** FFA matchEnd reason → 화면 문구(팀전 REASON_LABELS와 'time'·'draw' 뜻이 달라 따로 둔다) */
export const FFA_REASON_LABELS = Object.freeze({
  kills: '목표 킬 달성',
  time: '시간 종료 · 킬 순위',
  forfeit: '상대가 모두 나감',
  draw: '무승부'
});
/** 부활 직후 이 시간 동안은 그 사람 위치를 스폰 지점으로 본다(월드·네트워크가 아직 옮기기 전) */
const SPAWN_FRESH_MS = 1000;

/** 방장 시계로 연사 간격을 잴 때(claim.t 생략) 네트워크 지터 몫으로 더 주는 허용오차 */
const HOST_JITTER_MS = 250;
/** 사수 시계가 이만큼 넘게 되돌아가면(새로고침·단위 변경) 연사 기록을 새로 시작한다 */
const CLOCK_RESET_MS = 10000;
/** claim.t 단위 추정: |t| < 1e4 이면 초(무기 모듈 ev.t), 아니면 ms(performance.now/Date.now) */
const SECONDS_GUESS_MAX = 1e4;
const MAX_NAME = 24;
const MAX_ECHO_ID = 64;
const MAX_VICTIMS = 16;
/** 스냅샷 바이트 예산(UTF-8). protocol.encodeMatch가 덧붙이는 키를 2048B에서 자르므로 그보다 작게 */
const SNAPSHOT_BUDGET = 1800;
/** matchEnd.stats 최대 줄 수(protocol.encodeMatchEvent 1024B 한도 안에 들게) */
const MAX_STATS_ROWS = 12;
const REASON_CODE = Object.freeze({ elimination: 'e', time: 't', hp: 'h', draw: 'd' });
const REASON_FROM_CODE = Object.freeze({ e: 'elimination', t: 'time', h: 'hp', d: 'draw' });
/** defs.maxRange → 방장 사거리 허용치 배율 / 근접 사거리 여유(m) */
const RANGE_SLACK = 1.05;
const MELEE_SLACK_M = 0.7;

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const k of Object.keys(o)) deepFreeze(o[k]);
  }
  return o;
}

/**
 * 무기별 판정 표 — fps/js/weapons/defs.js 값과 맞춘다(MATCH_API.md 4절).
 *   intervalMs  : 연사 간격(defs.fireInterval, 칼은 kinds[].cooldown)
 *   toleranceMs : 연사 간격 허용오차(프레임 몰림·타임스탬프 흔들림 흡수)
 *   rangeM      : 방장 사거리 허용치 = defs.maxRange × 1.05 (칼 1.8 + 0.7 = 2.5)
 *   damage/falloff : defs와 같은 표·거리 감쇠. NOR-1은 oneShotKill(남은 체력 전부)
 */
export const WEAPON_RULES = deepFreeze({
  nor1: {
    slot: 1, primary: true, oneShotKill: true,
    intervalMs: 1200, toleranceMs: 250, rangeM: 420,
    damage: { head: 150, body: 120, legs: 100 }, falloff: null
  },
  dwt47: {
    slot: 1, primary: true,
    intervalMs: 100, toleranceMs: 150, rangeM: 262.5,
    damage: { head: 100, body: 30, legs: 22 }, falloff: { start: 30, end: 80, min: 0.75 }
  },
  sof9: {
    slot: 2,
    intervalMs: 160, toleranceMs: 170, rangeM: 157.5,
    damage: { head: 70, body: 28, legs: 20 }, falloff: { start: 15, end: 45, min: 0.6 }
  },
  hawser: {
    slot: 3, melee: true,
    toleranceMs: 300, rangeM: 2.5,
    kinds: { slash: { damage: 50, intervalMs: 450 }, stab: { damage: 100, intervalMs: 1000 } }
  },
  bunker: {
    slot: 4, explosive: true,
    maxDamage: 100, radiusM: 6, perRound: 1
  }
});

const WEAPON_ALIASES = new Map([
  ['nor1', 'nor1'], ['nor', 'nor1'], ['sniper', 'nor1'],
  ['dwt47', 'dwt47'], ['dwt', 'dwt47'], ['rifle', 'dwt47'], ['ar', 'dwt47'], ['assaultrifle', 'dwt47'],
  ['sof9', 'sof9'], ['sof', 'sof9'], ['pistol', 'sof9'],
  ['hawser', 'hawser'], ['hawsercutter', 'hawser'], ['cutter', 'hawser'], ['knife', 'hawser'], ['melee', 'hawser'],
  ['bunker', 'bunker'], ['bunkergrenade', 'bunker'], ['grenade', 'bunker'], ['nade', 'bunker'], ['frag', 'bunker']
]);

const PART_ALIASES = new Map([
  ['head', 'head'], ['neck', 'head'], ['helmet', 'head'],
  ['body', 'body'], ['chest', 'body'], ['torso', 'body'], ['arm', 'body'], ['arms', 'body'],
  ['legs', 'legs'], ['leg', 'legs'], ['foot', 'legs'], ['feet', 'legs']
]);

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
function toNum(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '') return Number(v);
  return NaN;
}
const round2 = (v) => Math.round(v * 100) / 100;
const echoId = (id) => (id ? String(id).slice(0, MAX_ECHO_ID) : null);
function utf8Len(str) {
  let n = 0;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i++; }
    else n += 3;
  }
  return n;
}

/** 'NOR-1' · 'cutter' · 'grenade' 등 → 'nor1' | 'dwt47' | 'sof9' | 'hawser' | 'bunker' | null */
export function normalizeWeaponId(id) {
  if (id == null) return null;
  return WEAPON_ALIASES.get(String(id).toLowerCase().replace(/[^a-z0-9]/g, '')) || null;
}

/** 부위 정규화(defs.normalizePart와 같음): 모르는 값은 body */
function normPart(part) {
  return PART_ALIASES.get(String(part == null ? '' : part).trim().toLowerCase()) || 'body';
}
/** 칼 공격 종류(defs.damage와 같음): 'stab'만 찌르기, 나머지는 베기 */
function normKind(kind) {
  return String(kind == null ? '' : kind).trim().toLowerCase() === 'stab' ? 'stab' : 'slash';
}
function normTeam(team) {
  const s = typeof team === 'string' ? team.trim().toLowerCase() : '';
  return TEAM_IDS.includes(s) ? s : null;
}
function normId(id) {
  if (id == null) return '';
  return String(id).trim();
}
function normName(name, fallback) {
  const clean = (v) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MAX_NAME);
  return clean(name) || clean(fallback) || '선원';
}
function normVec(v) {
  if (!v || typeof v !== 'object') return null;
  const a = Array.isArray(v) ? v : [v.x, v.y, v.z];
  const x = toNum(a[0]), y = toNum(a[1]), z = toNum(a[2]);
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  return { x: round2(x), y: Number.isFinite(y) ? round2(y) : 0, z: round2(z) };
}

function falloffMul(f, dist) {
  if (!f || !(dist > f.start)) return 1;
  if (dist >= f.end) return f.min;
  return 1 + (f.min - 1) * ((dist - f.start) / (f.end - f.start));
}

/** 총·칼의 표 데미지(정수, 체력 상한 적용 전). defs.damage()와 같은 계산 */
function tableDamage(w, part, dist, kind) {
  if (w.melee) return w.kinds[kind].damage;
  return Math.max(1, Math.round(w.damage[part] * falloffMul(w.falloff, dist)));
}

/**
 * 방장이 적용할 데미지 미리 계산(클라이언트 히트마커·예측용). 수류탄은 0.
 * @returns {number} min(표 데미지, victimHp). NOR-1은 victimHp(1발 킬)
 */
export function damageFor(weaponId, part, dist = 0, kind, victimHp = DEFAULT_RULES.hp) {
  const id = normalizeWeaponId(weaponId);
  const w = id ? WEAPON_RULES[id] : null;
  if (!w || w.explosive) return 0;
  const hp = Math.max(0, Number.isFinite(+victimHp) ? +victimHp : DEFAULT_RULES.hp);
  if (w.oneShotKill) return hp;
  const d = Number.isFinite(+dist) ? Math.max(0, +dist) : 0;
  return Math.min(hp, tableDamage(w, normPart(part), d, normKind(kind)));
}

/**
 * fps/js/weapons/defs.js의 WEAPONS 표 → createMatch({ weaponRules })에 넣을 덮어쓰기 값.
 * 이 모듈은 defs를 import하지 않는다(독립 유지). 방장 쪽에서 원하면 이렇게 묶는다:
 *   import { WEAPONS } from '../weapons/defs.js';
 *   createMatch({ ..., weaponRules: weaponRulesFromDefs(WEAPONS) });
 * 허용오차(toleranceMs)·1발 킬 여부는 defs에 없으므로 이 모듈 값을 유지한다.
 */
export function weaponRulesFromDefs(defs) {
  const out = {};
  if (!defs || typeof defs !== 'object') return out;
  const ms = (s) => (isNum(s) && s > 0 ? Math.round(s * 1000) : undefined);
  for (const id of ['nor1', 'dwt47', 'sof9']) {
    const d = defs[id];
    if (!d || typeof d !== 'object') continue;
    const o = {};
    if (ms(d.fireInterval)) o.intervalMs = ms(d.fireInterval);
    if (isNum(d.maxRange) && d.maxRange > 0) o.rangeM = round2(d.maxRange * RANGE_SLACK);
    if (d.damage && typeof d.damage === 'object') o.damage = { head: d.damage.head, body: d.damage.body, legs: d.damage.legs };
    if ('falloff' in d) o.falloff = d.falloff ? { start: d.falloff.start, end: d.falloff.end, min: d.falloff.min } : null;
    out[id] = o;
  }
  const m = defs.hawser;
  if (m && m.melee && typeof m.melee === 'object') {
    const o = { kinds: {} };
    let reach = 0;
    for (const k of ['slash', 'stab']) {
      const mk = m.melee[k];
      if (!mk) continue;
      o.kinds[k] = { damage: mk.damage, intervalMs: ms(mk.cooldown) };
      if (isNum(mk.range)) reach = Math.max(reach, mk.range);
    }
    if (reach > 0) o.rangeM = round2(reach + MELEE_SLACK_M);
    out.hawser = o;
  }
  const g = defs.bunker;
  if (g && typeof g === 'object') {
    const o = {};
    if (g.explosion && isNum(g.explosion.max)) o.maxDamage = g.explosion.max;
    if (g.explosion && isNum(g.explosion.radius)) o.radiusM = g.explosion.radius;
    if (isNum(g.count)) o.perRound = g.count;
    out.bunker = o;
  }
  return out;
}

/** WEAPON_RULES에 부분 덮어쓰기를 얹는다(숫자 검증, 모르는 무기·필드는 무시) */
function mergeWeaponRules(over) {
  const src = over && typeof over === 'object' ? over : {};
  const okNum = (v) => isNum(v) && v >= 0;
  const out = {};
  for (const id of Object.keys(WEAPON_RULES)) {
    const b = WEAPON_RULES[id];
    const o = src[id] && typeof src[id] === 'object' ? src[id] : null;
    const w = { ...b };
    if (b.damage) w.damage = { ...b.damage };
    if (b.falloff) w.falloff = { ...b.falloff };
    if (b.kinds) w.kinds = { slash: { ...b.kinds.slash }, stab: { ...b.kinds.stab } };
    if (o) {
      for (const k of ['intervalMs', 'toleranceMs', 'rangeM', 'maxDamage', 'radiusM', 'perRound']) {
        if (k in b && okNum(o[k])) w[k] = o[k];
      }
      if (b.damage && o.damage && typeof o.damage === 'object') {
        for (const p of PARTS) if (okNum(o.damage[p])) w.damage[p] = o.damage[p];
      }
      if ('falloff' in b && 'falloff' in o) {
        const f = o.falloff;
        if (f === null) w.falloff = null;
        else if (f && isNum(f.start) && isNum(f.end) && isNum(f.min) && f.end > f.start && f.min >= 0) {
          w.falloff = { start: f.start, end: f.end, min: f.min };
        }
      }
      if (b.kinds && o.kinds && typeof o.kinds === 'object') {
        for (const k of ['slash', 'stab']) {
          const ok = o.kinds[k];
          if (!ok || typeof ok !== 'object') continue;
          if (okNum(ok.damage)) w.kinds[k].damage = ok.damage;
          if (okNum(ok.intervalMs)) w.kinds[k].intervalMs = ok.intervalMs;
        }
      }
    }
    out[id] = w;
  }
  return deepFreeze(out);
}

const isFfaMode = (m) => typeof m === 'string' && m.trim().toLowerCase() === 'ffa';

function sanitizeFfaRules(src) {
  const pick = (k, min, max) => {
    const n = toNum(src[k]);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : DEFAULT_FFA_RULES[k];
  };
  return Object.freeze({
    mode: 'ffa',
    killTarget: pick('killTarget', 5, 50),
    timeLimitMs: pick('timeLimitMs', 1, 3600000),
    respawnMs: pick('respawnMs', 0, 60000),
    spawnProtectMs: pick('spawnProtectMs', 0, 10000),
    loadoutMs: pick('loadoutMs', 0, 60000),
    hp: pick('hp', 1, 10000),
    maxPlayers: pick('maxPlayers', 2, 16)
  });
}

function sanitizeRules(r) {
  const src = r && typeof r === 'object' ? r : {};
  if (isFfaMode(src.mode)) return sanitizeFfaRules(src);
  const pick = (k, min) => {
    const n = toNum(src[k]);
    return Number.isFinite(n) && n >= min ? Math.floor(n) : DEFAULT_RULES[k];
  };
  const out = {
    roundsToWin: pick('roundsToWin', 1),
    maxRounds: pick('maxRounds', 1),
    maxTotalRounds: pick('maxTotalRounds', 1),
    roundTimeMs: pick('roundTimeMs', 1),
    loadoutMs: pick('loadoutMs', 0),
    roundEndMs: pick('roundEndMs', 0),
    hp: pick('hp', 1),
    maxPlayers: pick('maxPlayers', 2),
    maxPerTeam: pick('maxPerTeam', 1)
  };
  if (out.maxTotalRounds < out.maxRounds) out.maxTotalRounds = out.maxRounds;
  return Object.freeze(out);
}

function sanitizeSpawns(sp) {
  const out = { owner: [], charterer: [], ffa: [] };
  if (!sp || typeof sp !== 'object') return out;
  for (const team of [...TEAM_IDS, 'ffa']) {
    for (const s of Array.isArray(sp[team]) ? sp[team] : []) {
      if (!s || typeof s !== 'object') continue;
      const x = toNum(s.x), z = toNum(s.z), r = toNum(s.rotY), y = toNum(s.y);
      if (!Number.isFinite(x) || !Number.isFinite(z)) continue;
      const o = { x: round2(x), z: round2(z), rotY: Number.isFinite(r) ? Math.round(r * 1000) / 1000 : 0 };
      if (Number.isFinite(y)) o.y = round2(y);
      out[team].push(o);
    }
  }
  return out;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function makeRng(o) {
  if (typeof o.rng === 'function') {
    const f = o.rng;
    return () => { const r = Number(f()); return r >= 0 && r < 1 ? r : 0; };
  }
  if (o.seed != null && Number.isFinite(Number(o.seed))) return mulberry32(Number(o.seed));
  return Math.random;
}
function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(rng() * (i + 1)));
    const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
  }
  return arr;
}

const isTimed = (ph) => ph === 'loadout' || ph === 'live' || ph === 'roundEnd';
const isActive = (p) => p.connected && p.playing && p.alive;
const teamIndex = (t) => TEAM_IDS.indexOf(t);

/** MVP 순서: 킬 → 헤드샷 → 데미지 (동률이면 데스 적은 순 → 먼저 들어온 순) */
function mvpOrder(a, b) {
  return (b.kills - a.kills) || (b.headshots - a.headshots) || (b.damage - a.damage) ||
    (a.deaths - b.deaths) || (a.seq - b.seq);
}

/** FFA 순위: 킬↓ → 데스↑ → 헤드샷↓ (그다음 입장 순은 표시 순서일 뿐, 등수는 같다) */
function ffaOrder(a, b) {
  return (b.kills - a.kills) || (a.deaths - b.deaths) || (b.headshots - a.headshots) || (a.seq - b.seq);
}
/** ffaOrder로 정렬된 목록 → [{ rank, id, name, kills, deaths, headshots, bot }] (공동 등수: 1, 2, 2, 4) */
function rankRows(sorted) {
  const out = [];
  sorted.forEach((p, i) => {
    const q = sorted[i - 1];
    const tie = !!q && q.kills === p.kills && q.deaths === p.deaths && q.headshots === p.headshots;
    out.push({ rank: tie ? out[i - 1].rank : i + 1, id: p.id, name: p.name, kills: p.kills, deaths: p.deaths, headshots: p.headshots, bot: !!p.bot });
  });
  return out;
}
/** FFA 스폰 후보 = owner + charterer + ffa. 하나도 없으면 원점 둘레 8곳(가운데를 바라봄) */
function ffaSpawnList(spawns) {
  const list = [...spawns.owner, ...spawns.charterer, ...spawns.ffa].map((s) => ({ ...s }));
  if (list.length) return list;
  return Array.from({ length: 8 }, (_, i) => {
    const t = (i / 8) * Math.PI * 2;
    return { x: round2(12 * Math.cos(t)), z: round2(12 * Math.sin(t)), rotY: Math.round((Math.PI / 2 - t) * 1000) / 1000 };
  });
}

/**
 * 경기를 만든다(방장 전용).
 * @param {object} [opts]
 * @param {object} [opts.rules]        DEFAULT_RULES 일부 덮어쓰기
 * @param {Array<{id:string,name?:string,team?:string,bot?:boolean}>} [opts.players]
 * @param {{owner?:Array<{x:number,z:number,rotY?:number}>, charterer?:Array}} [opts.spawns]
 * @param {object} [opts.weaponRules]  WEAPON_RULES 부분 덮어쓰기(weaponRulesFromDefs 결과 등)
 * @param {number} [opts.seed]         스폰 섞기 난수 시드(테스트용)
 * @param {() => number} [opts.rng]    난수 함수(seed보다 우선)
 * @param {() => Object<string,{x:number,z:number}|number[]>} [opts.getPositions]  FFA 스폰 선택용 현재 위치
 * @param {Object<string,{kills?,deaths?,headshots?,damage?,name?,team?,bot?,loadout?}>} [opts.carry]
 *        이어받을 기록(방장 이전). players에 없는 id는 접속 끊김 기록으로 남는다
 */
export function createMatch(opts = {}) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const rules = sanitizeRules(o.rules);
  const weapons = mergeWeaponRules(o.weaponRules);
  const rng = makeRng(o);
  const spawns = sanitizeSpawns(o.spawns);
  const ffa = rules.mode === 'ffa';
  const getPositions = typeof o.getPositions === 'function' ? o.getPositions : null;
  const ffaSpots = ffa ? ffaSpawnList(spawns) : [];
  const spotUsed = [];       // FFA: 스폰 지점별 마지막 사용 시각(방장 시계)
  let recentSpots = [];      // FFA: 최근에 쓴 지점 번호(마지막 2곳)
  let liveStartAt = 0;       // FFA: live가 시작된 방장 시각

  /** 입장 순서를 유지한다. 경기 중 나간 사람은 connected:false로 남는다(기록 유지). */
  const players = new Map();
  const score = { owner: 0, charterer: 0 };
  const history = [];        // 끝난 라운드 [{ round, winner, reason }]
  let phase = 'warmup';
  let round = 0;             // 현재(마지막) 라운드 번호, 무승부 재경기 포함 1부터
  let timeLeft = 0;          // 현재 페이즈 남은 시간(ms)
  let now = 0;               // 방장 시계(ms, tick 누적)
  let decided = null;        // 승부가 정해진 뒤 마지막 roundEnd 동안 { winner, reason }
  let finalRound = 0;        // 승부를 가른 라운드 번호(forfeit이면 0)
  let result = null;         // matchEnd 뒤 { winner, reason, mvpId }
  let seq = 0;
  let disposed = false;

  // ── 조회 ───────────────────────────────────────────────
  function connectedCount(team, exceptId) {
    let n = 0;
    for (const p of players.values()) {
      if (p.connected && (!team || p.team === team) && p.id !== exceptId) n++;
    }
    return n;
  }
  function teamAlive(team) {
    let alive = 0, hp = 0;
    for (const p of players.values()) {
      if (p.team === team && isActive(p)) { alive++; hp += p.hp; }
    }
    return { alive, hp };
  }
  function leader() {
    return score.owner > score.charterer ? 'owner' : score.charterer > score.owner ? 'charterer' : null;
  }
  function reject(action, reason, by, extra) {
    const ev = { type: 'reject', action, reason, by: echoId(by) };
    if (extra) Object.assign(ev, extra);
    return [ev];
  }
  function pickTeam(pref, exceptId) {
    const n = { owner: connectedCount('owner', exceptId), charterer: connectedCount('charterer', exceptId) };
    if (pref && n[pref] < rules.maxPerTeam) return pref;
    const order = n.charterer < n.owner ? ['charterer', 'owner'] : ['owner', 'charterer'];
    for (const t of order) if (n[t] < rules.maxPerTeam) return t;
    return null;
  }
  function freshClock(p) {
    p.gates = Object.create(null);
    p.clock = { scale: 0, fixed: false, anchor: null };
  }
  function newRecord(id, name, team, bot) {
    return {
      id, name, team, bot: !!bot, seq: ++seq,
      connected: true, playing: false, alive: false, hp: 0, loadout: DEFAULT_LOADOUT,
      kills: 0, deaths: 0, headshots: 0, damage: 0, grenades: 0, gates: null, clock: null,
      respawnAt: null, protectUntil: 0, lastSpawn: null     // FFA 전용
    };
  }

  // ── 페이즈 ─────────────────────────────────────────────
  function setPhase(ph, durationMs, events, extra) {
    phase = ph;
    timeLeft = durationMs == null ? 0 : durationMs;
    const ev = { type: 'phase', phase: ph, round, durationMs: durationMs == null ? null : durationMs };
    if (extra) Object.assign(ev, extra);
    events.push(ev);
  }

  function spawnFor(pool, i, team) {
    if (pool.length) {
      const s = { ...pool[i % pool.length] };
      const k = Math.floor(i / pool.length);
      if (k > 0) s.x = round2(s.x + 1.2 * k);   // 스폰보다 인원이 많을 때만: 옆으로 비켜 세운다
      return s;
    }
    const side = team === 'owner' ? -1 : 1;     // 맵 스폰이 없을 때 대체값(겹치지 않게 줄 세움)
    return { x: side * (8 + 1.5 * i), z: 0, rotY: side < 0 ? -Math.PI / 2 : Math.PI / 2 };
  }

  function startRound(events) {
    round += 1;
    const prev = history[history.length - 1];
    const assigned = {};
    for (const p of players.values()) {
      const inRound = p.connected && !!p.team;
      p.playing = inRound;
      p.alive = inRound;
      p.hp = inRound ? rules.hp : 0;
      p.gates = Object.create(null);
      p.grenades = 0;
    }
    for (const team of TEAM_IDS) {
      const pool = shuffle(spawns[team].map((s) => ({ ...s })), rng);
      let i = 0;
      for (const p of players.values()) {
        if (p.playing && p.team === team) assigned[p.id] = spawnFor(pool, i++, team);
      }
    }
    events.push({ type: 'roundStart', round, replay: !!prev && prev.winner === null, spawns: assigned, score: { ...score } });
    setPhase('loadout', rules.loadoutMs, events);
  }

  function beginLive(events) {
    const loadouts = {};
    for (const p of players.values()) if (p.playing && p.connected) loadouts[p.id] = p.loadout;
    setPhase('live', rules.roundTimeMs, events, { loadouts });
    checkElimination(events);
  }

  function endRound(events, winner, reason) {
    if (winner) score[winner] += 1;
    history.push({ round, winner, reason });
    const decisive = score.owner + score.charterer;
    if (winner && score[winner] >= rules.roundsToWin) decided = { winner, reason: 'wins' };
    else if (decisive >= rules.maxRounds) decided = { winner: leader(), reason: 'maxRounds' };
    else if (history.length >= rules.maxTotalRounds) decided = { winner: leader(), reason: 'roundCap' };
    if (decided) finalRound = round;
    const ow = teamAlive('owner'), ch = teamAlive('charterer');
    events.push({
      type: 'roundEnd', round, winner, reason, score: { ...score }, final: !!decided,
      alive: { owner: ow.alive, charterer: ch.alive }, hp: { owner: ow.hp, charterer: ch.hp }
    });
    setPhase('roundEnd', rules.roundEndMs, events);
  }

  function checkElimination(events) {
    if (phase !== 'live' && phase !== 'loadout') return false;
    const a = teamAlive('owner').alive, b = teamAlive('charterer').alive;
    if (a > 0 && b > 0) return false;
    if (a > 0) endRound(events, 'owner', 'elimination');
    else if (b > 0) endRound(events, 'charterer', 'elimination');
    else endRound(events, null, 'draw');   // 동시 전멸(수류탄 등)
    return true;
  }

  function timeUp(events) {
    const ow = teamAlive('owner'), ch = teamAlive('charterer');
    if (ow.alive !== ch.alive) endRound(events, ow.alive > ch.alive ? 'owner' : 'charterer', 'time');
    else if (ow.hp !== ch.hp) endRound(events, ow.hp > ch.hp ? 'owner' : 'charterer', 'hp');
    else endRound(events, null, 'draw');
  }

  function finishMatch(events, winner, reason) {
    if (!decided) decided = { winner, reason };
    const ranked = [...players.values()].sort(mvpOrder);
    const top = ranked[0];
    const mvp = top && (top.kills > 0 || top.headshots > 0 || top.damage > 0) ? top : null;
    result = { winner, reason, mvpId: mvp ? mvp.id : null };
    // 압축형 [id, kills, deaths, headshots, damage] (MVP 순, 최대 12줄). 이름·팀이 붙은 표는 standings(view)
    const stats = ranked.slice(0, MAX_STATS_ROWS).map((p) => [p.id, p.kills, p.deaths, p.headshots, p.damage]);
    events.push({ type: 'matchEnd', winner, reason, score: { ...score }, mvpId: result.mvpId, stats });
    setPhase('matchEnd', null, events);
  }

  function checkForfeit(events) {
    if (!isTimed(phase) || decided) return false;
    const a = connectedCount('owner'), b = connectedCount('charterer');
    if (a > 0 && b > 0) return false;
    const winner = a > 0 ? 'owner' : b > 0 ? 'charterer' : null;
    finishMatch(events, winner, winner ? 'forfeit' : 'abandoned');
    return true;
  }

  function onTimeout(events) {
    if (phase === 'loadout') beginLive(events);
    else if (phase === 'live') timeUp(events);
    else if (phase === 'roundEnd') {
      if (decided) finishMatch(events, decided.winner, decided.reason);
      else startRound(events);
    }
  }

  // ── 피해 적용 ──────────────────────────────────────────
  function hurt(events, a, v, weaponId, raw, info) {
    const dmg = Math.min(v.hp, Math.max(0, Math.round(raw)));
    if (!(dmg > 0)) return;
    v.hp -= dmg;
    const enemy = a !== v && (ffa || a.team !== v.team);
    if (enemy) a.damage += dmg;
    const ev = { type: 'damage', attacker: a.id, victim: v.id, amount: dmg, part: info.part, hp: v.hp, weaponId, kind: info.kind };
    if (info.self) ev.self = true;
    if (info.center) ev.center = info.center;
    events.push(ev);
    if (v.hp > 0) return;
    v.hp = 0;
    v.alive = false;
    v.deaths += 1;
    if (ffa) { v.respawnAt = now + rules.respawnMs; v.protectUntil = 0; }
    const head = enemy && !!info.head;
    if (enemy) {
      a.kills += 1;
      if (head) a.headshots += 1;
    }
    events.push({
      type: 'kill', killer: a.id, victim: v.id, weaponId, part: info.part, head,
      killerName: a.name, victimName: v.name, killerTeam: a.team, victimTeam: v.team
    });
  }

  /** claim.t → { ms, host }. ms 권장, 초(무기 모듈 ev.t)는 자동 인식, 생략하면 방장 시계 */
  function claimTime(p, rawT) {
    const t = toNum(rawT);
    if (!Number.isFinite(t)) return { ms: now, host: true };
    const ck = p.clock;
    if (!ck.anchor) {
      ck.anchor = { t, h: now };
    } else if (!ck.fixed) {
      // 방장 시계가 2초 이상 흐른 뒤 두 시계의 진행 비율로 단위를 확정한다(크기 추정이 틀린 경우 보정)
      const dh = now - ck.anchor.h, dc = t - ck.anchor.t;
      if (dh >= 2000 && dc > 0) {
        const r = dc / dh;
        const scale = r < 0.01 ? 1000 : r > 0.1 ? 1 : 0;
        if (scale) {
          ck.fixed = true;
          if (ck.scale && ck.scale !== scale) {
            for (const k of Object.keys(p.gates)) if (!k.endsWith('@h')) delete p.gates[k];
          }
          ck.scale = scale;
        }
      }
    }
    if (!ck.scale) ck.scale = Math.abs(t) < SECONDS_GUESS_MAX ? 1000 : 1;
    return { ms: t * ck.scale, host: false };
  }

  /**
   * 연사 간격 검사(GCRA). due = 이 무기로 다음 발이 가능한 가장 이른 시각.
   * t < due − 허용오차 → 거절. 통과하면 due = max(due, t) + 간격.
   * 순간 흔들림은 허용오차가 흡수하고, 평균 연사 속도는 간격을 넘지 못한다.
   */
  function gate(p, weaponId, w, kind, time) {
    const key = time.host ? weaponId + '@h' : weaponId;
    const interval = w.melee ? w.kinds[kind].intervalMs : w.intervalMs;
    const tol = (w.toleranceMs || 0) + (time.host ? HOST_JITTER_MS : 0);
    const due = p.gates[key];
    let base = time.ms;
    if (due != null) {
      if (time.ms < due - tol) {
        if (due - time.ms <= CLOCK_RESET_MS) return false;
        // 사수 시계가 크게 되돌아감 → 기록을 새로 시작
      } else {
        base = Math.max(due, time.ms);
      }
    }
    p.gates[key] = base + interval;
    return true;
  }

  // ── 공개 API ───────────────────────────────────────────
  function tick(dtMs) {
    if (disposed) return [];
    const dt = toNum(dtMs);
    if (!(dt > 0) || !Number.isFinite(dt)) return [];
    if (ffa) return tickFfa(dt);
    now += dt;
    const events = [];
    let rem = dt;
    // 큰 dt는 다음 페이즈로 넘겨 이어서 소비한다. 라운드 상한이 있어 반드시 끝난다(가드는 이중 안전장치).
    for (let guard = 0; guard < 200 && isTimed(phase); guard++) {
      if (timeLeft > rem) { timeLeft -= rem; break; }
      rem -= timeLeft;
      timeLeft = 0;
      onTimeout(events);
      if (!(rem > 0)) break;
    }
    return events;
  }

  function addPlayer(info) {
    if (disposed) return [];
    const src = info && typeof info === 'object' ? info : { id: info };
    const id = normId(src.id);
    if (!id) return reject('addPlayer', 'bad_id', null);
    const existing = players.get(id);
    if (existing && existing.connected) {
      if (src.name != null) existing.name = normName(src.name, existing.name);   // 멱등: 이름만 갱신
      return [];
    }
    if (connectedCount() >= rules.maxPlayers) return reject('addPlayer', 'room_full', id);
    const team = ffa ? null : pickTeam(existing ? existing.team : normTeam(src.team));
    if (!team && !ffa) return reject('addPlayer', 'room_full', id);
    let p = existing;
    if (p) {
      p.connected = true;
      p.team = team;
      if (src.name != null) p.name = normName(src.name, p.name);
    } else {
      p = newRecord(id, normName(src.name, id), team, src.bot);
      players.set(id, p);
    }
    freshClock(p);
    if (ffa) return joinFfa(p, !!existing);
    // warmup이면 바로 참여, 경기가 시작된 뒤면 다음 roundStart까지 관전
    const joinNow = phase === 'warmup';
    p.playing = joinNow;
    p.alive = joinNow;
    p.hp = joinNow ? rules.hp : 0;
    return [{ type: 'join', id, name: p.name, team, playing: joinNow, rejoin: !!existing }];
  }

  function removePlayer(idRaw) {
    if (disposed) return [];
    const id = normId(idRaw);
    const p = players.get(id);
    if (!p || !p.connected) return [];
    if (phase === 'warmup') {
      players.delete(id);
      return [{ type: 'leave', id, name: p.name, team: p.team, wasAlive: false }];
    }
    const wasAlive = isActive(p);
    p.connected = false;
    p.alive = false;
    p.hp = 0;
    if (ffa) { p.respawnAt = null; p.protectUntil = 0; }
    const events = [{ type: 'leave', id, name: p.name, team: p.team, wasAlive }];
    if (phase === 'matchEnd') return events;
    if (ffa) { checkFfaForfeit(events); return events; }
    if (checkForfeit(events)) return events;
    if (wasAlive) checkElimination(events);
    return events;
  }

  function setTeam(idRaw, team) {
    if (disposed) return [];
    const id = normId(idRaw);
    if (ffa) return reject('setTeam', 'ffa_mode', id);
    if (phase !== 'warmup') return reject('setTeam', 'not_warmup', id);
    const p = players.get(id);
    if (!p || !p.connected) return reject('setTeam', 'unknown_player', id);
    const t = normTeam(team);
    if (!t) return reject('setTeam', 'bad_team', id);
    if (p.team === t) return [];
    if (connectedCount(t, id) >= rules.maxPerTeam) return reject('setTeam', 'team_full', id, { team: t });
    p.team = t;
    return [{ type: 'team', id, team: t }];
  }

  function setLoadout(idRaw, weaponId) {
    if (disposed) return [];
    const id = normId(idRaw);
    if (phase !== 'loadout' && !(ffa && phase === 'live')) return reject('setLoadout', 'not_loadout', id);
    const p = players.get(id);
    if (!p || !p.connected) return reject('setLoadout', 'unknown_player', id);
    const w = normalizeWeaponId(weaponId);
    if (!w || !PRIMARY_IDS.includes(w)) return reject('setLoadout', 'bad_weapon', id);
    if (p.loadout === w) return [];
    p.loadout = w;
    return [{ type: 'loadout', id, weaponId: w }];
  }

  function start() {
    if (disposed) return [];
    if (phase !== 'warmup') return reject('start', phase === 'matchEnd' ? 'match_over' : 'already_started', null);
    if (ffa) return startFfa();
    if (!connectedCount('owner') || !connectedCount('charterer')) return reject('start', 'need_both_teams', null);
    const events = [];
    startRound(events);
    return events;
  }

  function claimHit(claim) {
    if (disposed) return [];
    const c = claim && typeof claim === 'object' ? claim : {};
    const aId = normId(c.attackerId), vId = normId(c.victimId);
    const wid = normalizeWeaponId(c.weaponId);
    const no = (reason) => reject('claimHit', reason, aId, {
      victim: echoId(vId), weaponId: wid || (c.weaponId == null ? null : String(c.weaponId).slice(0, 24))
    });
    if (phase !== 'live') return no('not_live');
    const a = players.get(aId);
    if (!a) return no('unknown_attacker');
    const v = players.get(vId);
    if (!v) return no('unknown_victim');
    if (a === v) return no('self_hit');
    const w = wid ? weapons[wid] : null;
    if (!w) return no('bad_weapon');
    if (w.explosive) return no('use_explosion');
    if (!isActive(a)) return no('attacker_dead');
    if (ffa) a.protectUntil = 0;   // FFA: 먼저 공격하면 부활 보호가 끝난다
    if (!isActive(v)) return no('victim_dead');
    if (!ffa && a.team === v.team) return no('friendly_fire');
    const dist = toNum(c.dist);
    if (!Number.isFinite(dist) || dist < 0) return no('bad_dist');
    if (dist > w.rangeM) return no('out_of_range');
    const kind = w.melee ? normKind(c.kind) : null;
    const part = w.melee ? null : normPart(c.part);
    if (ffa && v.protectUntil > now) return no('protected');
    if (!gate(a, wid, w, kind, claimTime(a, c.t))) return no('too_fast');
    const raw = w.oneShotKill ? v.hp : tableDamage(w, part, dist, kind);
    const events = [];
    hurt(events, a, v, wid, raw, { part, kind, head: part === 'head' });
    if (ffa) checkKillTarget(events);
    else checkElimination(events);
    return events;
  }

  function claimExplosion(claim) {
    if (disposed) return [];
    const c = claim && typeof claim === 'object' ? claim : {};
    const aId = normId(c.attackerId);
    const wid = c.weaponId == null ? 'bunker' : normalizeWeaponId(c.weaponId);
    const no = (reason) => reject('claimExplosion', reason, aId, { weaponId: wid || null });
    if (phase !== 'live') return no('not_live');
    const a = players.get(aId);
    if (!a) return no('unknown_attacker');
    const w = wid ? weapons[wid] : null;
    if (!w || !w.explosive) return no('bad_weapon');
    if (!a.connected || !a.playing) return no('not_playing');   // 던지고 죽은 뒤 터진 것은 인정
    if (!Array.isArray(c.victims)) return no('bad_victims');
    if (a.grenades >= w.perRound) return no('grenade_limit');
    a.grenades += 1;
    if (ffa) a.protectUntil = 0;   // FFA: 던지면 부활 보호가 끝난다(자폭 피해도 받는다)
    const center = normVec(c.center);
    const events = [];
    const seen = new Set();
    for (const vic of c.victims.slice(0, MAX_VICTIMS)) {
      const vId = normId(vic && vic.id);
      if (!vId || seen.has(vId)) continue;
      seen.add(vId);
      const v = players.get(vId);
      if (!v || !isActive(v)) continue;
      const self = v === a;
      if (!self && !ffa && v.team === a.team) continue;      // 아군 사격 꺼짐(팀전)
      if (ffa && !self && v.protectUntil > now) continue;    // FFA 부활 보호
      let dmg = toNum(vic.dmg);
      if (!Number.isFinite(dmg) || dmg <= 0) continue;
      dmg = Math.min(dmg, w.maxDamage);
      if (self) dmg *= SELF_EXPLOSION_SCALE;                 // 자해 50%
      dmg = Math.round(dmg);
      if (dmg <= 0) continue;
      hurt(events, a, v, wid, dmg, { part: null, kind: null, head: false, center, self });
    }
    if (ffa) checkKillTarget(events);
    else checkElimination(events);   // 모든 피해를 동시에 적용한 뒤 한 번만 판정(동시 전멸 = 무승부)
    return events;
  }

  function rowOf(x) {
    const flags = (x.connected ? 1 : 0) | (x.playing ? 2 : 0) | (x.alive ? 4 : 0) | (x.bot ? 8 : 0);
    return [x.id, x.name, teamIndex(x.team), flags, x.hp, x.loadout, x.kills, x.deaths, x.headshots, x.damage];
  }

  /** 접속자는 모두 싣고, 나간 사람은 기록 좋은 순으로 SNAPSHOT_BUDGET 안에서만 싣는다(줄 순서는 입장 순) */
  function snapshot() {
    if (ffa) return snapshotFfa();
    const head = {
      v: SNAPSHOT_VERSION,
      ph: phase,
      rn: round,
      tl: isTimed(phase) ? Math.max(0, Math.ceil(timeLeft)) : null,
      sc: [score.owner, score.charterer],
      ru: RULE_KEYS.map((k) => rules[k]),
      h: history.map((r) => [teamIndex(r.winner), REASON_CODE[r.reason] || r.reason]),
      fin: finalRound,
      res: result ? [teamIndex(result.winner), result.reason, result.mvpId] : null
    };
    const all = [...players.values()];
    const keep = new Set();
    const rows = [];
    for (const x of all) if (x.connected) { keep.add(x); rows.push(rowOf(x)); }
    if (keep.size < all.length) {
      let size = utf8Len(JSON.stringify({ ...head, p: rows }));
      for (const x of all.filter((y) => !y.connected).sort(mvpOrder)) {
        const add = utf8Len(JSON.stringify(rowOf(x))) + 1;
        if (size + add <= SNAPSHOT_BUDGET) { keep.add(x); size += add; }
      }
    }
    return { ...head, p: all.filter((x) => keep.has(x)).map(rowOf) };
  }

  // ── 개인전(FFA) ────────────────────────────────────────
  function startFfa() {
    if (connectedCount() < 2) return reject('start', 'need_players', null);
    round = 1;
    for (const p of players.values()) {
      p.playing = p.connected;
      p.alive = false;
      p.hp = 0;
      p.respawnAt = null;
      p.protectUntil = 0;
      p.gates = Object.create(null);
      p.grenades = 0;
    }
    const events = [];
    setPhase('loadout', rules.loadoutMs, events);
    return events;
  }

  /** warmup: 바로 참가 / loadout: live 시작 때 함께 출격 / live: respawnMs 뒤 출격 / matchEnd: 관전 */
  function joinFfa(p, rejoin) {
    const inMatch = phase === 'loadout' || phase === 'live';
    p.playing = phase === 'warmup' || inMatch;
    p.alive = phase === 'warmup';
    p.hp = p.alive ? rules.hp : 0;
    p.protectUntil = 0;
    p.respawnAt = phase === 'live' ? now + rules.respawnMs : null;
    const ev = { type: 'join', id: p.id, name: p.name, team: null, playing: p.playing, rejoin };
    if (inMatch) ev.respawnIn = phase === 'live' ? rules.respawnMs : Math.max(0, Math.ceil(timeLeft));
    return [ev];
  }

  function tickFfa(dt) {
    const events = [];
    let cursor = now;          // 이번 tick이 시작된 방장 시각
    now += dt;
    let wentLive = false;
    if (phase === 'loadout') {
      if (timeLeft > dt) { timeLeft -= dt; return events; }
      cursor += timeLeft;      // loadout이 끝난 시각 = live 시작
      liveStartAt = cursor;
      setPhase('live', rules.timeLimitMs, events);
      for (const p of players.values()) if (p.connected && p.playing) p.respawnAt = cursor;
      wentLive = true;
    }
    if (phase === 'live') {
      const endAt = cursor + timeLeft;
      spawnDue(events, Math.min(now, endAt));
      if (wentLive && checkKillTarget(events)) return events;   // 이어받은 기록이 이미 목표 이상인 경우
      if (now >= endAt) { timeLeft = 0; finishFfaByTime(events); }
      else timeLeft = endAt - now;
    }
    return events;
  }

  function readPositions() {
    if (!getPositions) return null;
    let raw = null;
    try { raw = getPositions(); } catch (_) { raw = null; }
    return raw && typeof raw === 'object' ? raw : {};
  }

  function spawnDue(events, until) {
    const due = [];
    for (const p of players.values()) {
      if (p.connected && p.playing && !p.alive && p.respawnAt != null && p.respawnAt <= until) due.push(p);
    }
    if (!due.length) return;
    due.sort((a, b) => (a.respawnAt - b.respawnAt) || (a.seq - b.seq));
    const raw = readPositions();
    for (const p of due) spawnPlayer(events, p, Math.max(p.respawnAt, liveStartAt), raw);
  }

  /**
   * 스폰 지점 고르기. 위치를 알면 살아 있는 다른 사람과의 최소 거리가 큰 순 상위 3곳 중 무작위,
   * 모르면 최근에 쓴 2곳(과 방금 쓴 곳)을 피한 무작위.
   */
  function pickSpot(p, at, raw) {
    const order = shuffle([...Array(ffaSpots.length).keys()], rng);   // 동점이 한쪽으로 몰리지 않게 먼저 섞는다
    if (raw) {
      const others = [];
      for (const q of players.values()) {
        if (q === p || !isActive(q)) continue;
        const fresh = q.lastSpawn && at - q.lastSpawn.at < SPAWN_FRESH_MS;
        const pos = fresh ? q.lastSpawn : normVec(raw[q.id]);
        if (pos) others.push(pos);
      }
      if (others.length) {
        const far = order.map((i) => {
          const c = ffaSpots[i];
          let d = Infinity;
          for (const q of others) d = Math.min(d, (c.x - q.x) ** 2 + (c.z - q.z) ** 2);
          return { i, d };
        }).sort((a, b) => b.d - a.d);
        const top = far.slice(0, 3);
        return top[Math.min(top.length - 1, Math.floor(rng() * top.length))].i;
      }
    }
    const free = order.filter((i) => !recentSpots.includes(i) && !(spotUsed[i] != null && at - spotUsed[i] < SPAWN_FRESH_MS));
    return (free.length ? free : order)[0];
  }

  function spawnPlayer(events, p, at, raw) {
    const idx = pickSpot(p, at, raw);
    const base = ffaSpots[idx];
    let k = 0;   // 같은 지점을 방금 쓴 사람이 있으면(지점보다 사람이 많을 때만) 옆으로 비켜 세운다
    for (const q of players.values()) if (q !== p && q.lastSpawn && q.lastSpawn.idx === idx && at - q.lastSpawn.at < SPAWN_FRESH_MS) k++;
    const spawn = { x: k ? round2(base.x + 1.2 * k) : base.x, z: base.z, rotY: base.rotY };
    if (base.y != null) spawn.y = base.y;
    spotUsed[idx] = at;
    recentSpots = recentSpots.filter((i) => i !== idx).concat(idx).slice(-2);
    p.alive = true;
    p.playing = true;
    p.hp = rules.hp;
    p.respawnAt = null;
    p.protectUntil = at + rules.spawnProtectMs;
    p.gates = Object.create(null);   // 새 목숨: 무기 시계·연사 기록 새로
    p.grenades = 0;                  // 수류탄은 목숨마다 1개
    p.lastSpawn = { idx, x: spawn.x, z: spawn.z, at };
    events.push({ type: 'spawn', id: p.id, spawn, loadout: p.loadout, protectMs: Math.max(0, Math.round(p.protectUntil - now)) });
  }

  function ffaRanking() {
    return rankRows([...players.values()].filter((q) => q.connected).sort(ffaOrder));
  }

  function finishFfa(events, winner, reason) {
    if (!decided) decided = { winner, reason };
    result = { winner, reason, mvpId: winner };
    for (const q of players.values()) { q.respawnAt = null; q.protectUntil = 0; }
    events.push({ type: 'matchEnd', mode: 'ffa', winner, reason, ranking: ffaRanking() });
    setPhase('matchEnd', null, events);
  }

  function finishFfaByTime(events) {
    const r = ffaRanking();
    if (!r.length || (r[1] && r[1].rank === 1)) finishFfa(events, null, 'draw');
    else finishFfa(events, r[0].id, 'time');
  }

  function checkKillTarget(events) {
    if (phase !== 'live') return false;
    let best = null;
    for (const q of players.values()) if (q.connected && q.kills >= rules.killTarget && (!best || ffaOrder(q, best) < 0)) best = q;
    if (!best) return false;
    finishFfa(events, best.id, 'kills');
    return true;
  }

  function checkFfaForfeit(events) {
    if (phase !== 'loadout' && phase !== 'live') return false;
    if (connectedCount() > 1) return false;
    let last = null;
    for (const q of players.values()) if (q.connected) last = q;
    finishFfa(events, last ? last.id : null, 'forfeit');
    return true;
  }

  /** FFA 행 = 팀전 행 10칸(팀 칸은 -1) + [respawnIn ms, protect ms] */
  function rowOfFfa(x) {
    const r = rowOf(x);
    let respawnIn = 0;
    if (x.connected && x.playing && !x.alive) {
      if (phase === 'loadout') respawnIn = Math.max(0, Math.ceil(timeLeft));
      else if (phase === 'live' && x.respawnAt != null) respawnIn = Math.max(0, Math.ceil(x.respawnAt - now));
    }
    const protect = phase === 'live' && x.alive && x.protectUntil > now ? Math.ceil(x.protectUntil - now) : 0;
    r.push(respawnIn, protect);
    return r;
  }

  function snapshotFfa() {
    const head = {
      v: SNAPSHOT_VERSION,
      mo: 'ffa',
      ph: phase,
      rn: round,
      tl: isTimed(phase) ? Math.max(0, Math.ceil(timeLeft)) : null,
      ru: FFA_RULE_KEYS.map((k) => rules[k]),
      res: result ? [result.winner, result.reason] : null
    };
    const all = [...players.values()];
    const keep = new Set();
    const rows = [];
    for (const x of all) if (x.connected) { keep.add(x); rows.push(rowOfFfa(x)); }
    if (keep.size < all.length) {
      let size = utf8Len(JSON.stringify({ ...head, p: rows }));
      for (const x of all.filter((y) => !y.connected).sort(ffaOrder)) {
        const add = utf8Len(JSON.stringify(rowOfFfa(x))) + 1;
        if (size + add <= SNAPSHOT_BUDGET) { keep.add(x); size += add; }
      }
    }
    return { ...head, p: all.filter((x) => keep.has(x)).map(rowOfFfa) };
  }

  /** 이어받을 기록 채우기: 있는 사람은 기록만, 없는 id는 접속 끊김 줄로 남긴다 */
  function applyCarry(carry) {
    if (!carry || typeof carry !== 'object') return;
    const n = (v) => { const x = toNum(v); return Number.isFinite(x) && x > 0 ? Math.floor(x) : 0; };
    for (const key of Object.keys(carry)) {
      const c = carry[key];
      const id = normId(key);
      if (!id || !c || typeof c !== 'object') continue;
      let p = players.get(id);
      if (!p) {
        p = newRecord(id, normName(c.name, id), ffa ? null : normTeam(c.team), c.bot);
        p.connected = false;
        players.set(id, p);
      }
      p.kills = n(c.kills);
      p.deaths = n(c.deaths);
      p.headshots = n(c.headshots);
      p.damage = n(c.damage);
      const w = normalizeWeaponId(c.loadout);
      if (w && PRIMARY_IDS.includes(w)) p.loadout = w;
    }
  }

  function dispose() {
    disposed = true;
    players.clear();
  }

  for (const p of Array.isArray(o.players) ? o.players : []) addPlayer(p);
  applyCarry(o.carry);

  return {
    tick, addPlayer, removePlayer, setTeam, setLoadout, start, claimHit, claimExplosion, snapshot, dispose,
    /** 읽기 전용 뷰. 접근할 때마다 새 복사본(= applySnapshot(snapshot())) */
    get state() { return applySnapshot(snapshot()); },
    get rules() { return rules; },
    get weaponRules() { return weapons; }
  };
}

/**
 * 방장 snapshot()을 화면용 상태로 푼다. m.state와 같은 모양. 잘못된 입력이면 null.
 * @returns {null | {
 *   phase:string, round:number, roundsPlayed:number, timeLeftMs:number|null,
 *   score:{owner:number, charterer:number}, rules:object,
 *   players:Array<{id,name,team,bot,connected,playing,alive,hp,loadout,kills,deaths,headshots,damage}>,
 *   teams:{owner:{players,alive,hp}, charterer:{players,alive,hp}},
 *   history:Array<{round,winner,reason}>, lastRound:null|{round,winner,reason,final},
 *   result:null|{winner,reason,mvpId}
 * }}
 */
export function applySnapshot(snap) {
  if (!snap || typeof snap !== 'object' || snap.v !== SNAPSHOT_VERSION || !Array.isArray(snap.p)) return null;
  if (snap.mo === 'ffa') return applyFfaSnapshot(snap);
  const int = (v, d = 0) => { const n = toNum(v); return Number.isFinite(n) ? Math.trunc(n) : d; };
  const teamAt = (i) => TEAM_IDS[int(i, -1)] || null;
  const rules = {};
  RULE_KEYS.forEach((k, i) => {
    const n = toNum(Array.isArray(snap.ru) ? snap.ru[i] : undefined);
    rules[k] = Number.isFinite(n) ? n : DEFAULT_RULES[k];
  });
  const players = [];
  for (const row of snap.p) {
    if (!Array.isArray(row) || row[0] == null) continue;
    const f = int(row[3]);
    players.push({
      id: String(row[0]),
      name: String(row[1] == null ? '' : row[1]),
      team: teamAt(row[2]),
      bot: !!(f & 8),
      connected: !!(f & 1),
      playing: !!(f & 2),
      alive: !!(f & 4),
      hp: Math.max(0, int(row[4])),
      loadout: typeof row[5] === 'string' ? row[5] : DEFAULT_LOADOUT,
      kills: int(row[6]),
      deaths: int(row[7]),
      headshots: int(row[8]),
      damage: int(row[9])
    });
  }
  const teams = {};
  for (const t of TEAM_IDS) {
    let n = 0, alive = 0, hp = 0;
    for (const p of players) {
      if (p.team !== t) continue;
      if (p.connected) n++;
      if (p.connected && p.playing && p.alive) { alive++; hp += p.hp; }
    }
    teams[t] = { players: n, alive, hp };
  }
  const history = (Array.isArray(snap.h) ? snap.h : []).map((r, i) => {
    const code = String(Array.isArray(r) && r[1] != null ? r[1] : '');
    return { round: i + 1, winner: teamAt(Array.isArray(r) ? r[0] : -1), reason: REASON_FROM_CODE[code] || code };
  });
  const last = history[history.length - 1];
  const sc = Array.isArray(snap.sc) ? snap.sc : [];
  const res = Array.isArray(snap.res) ? snap.res : null;
  const tl = toNum(snap.tl);
  return {
    phase: PHASES.includes(snap.ph) ? snap.ph : 'warmup',
    round: Math.max(0, int(snap.rn)),
    roundsPlayed: history.length,
    timeLeftMs: snap.tl == null || !Number.isFinite(tl) ? null : Math.max(0, tl),
    score: { owner: int(sc[0]), charterer: int(sc[1]) },
    rules,
    players,
    teams,
    history,
    lastRound: last ? { ...last, final: last.round === int(snap.fin) } : null,
    result: res ? { winner: teamAt(res[0]), reason: String(res[1] == null ? '' : res[1]), mvpId: res[2] == null ? null : String(res[2]) } : null
  };
}

/**
 * FFA 스냅샷 → 화면용 상태. 팀전 뷰와 같은 키(score·teams·history·lastRound는 비어 있음) +
 * mode:'ffa', killTarget, 플레이어별 respawnIn·protect·protectMs. result.winner는 플레이어 id.
 */
function applyFfaSnapshot(snap) {
  const int = (v, d = 0) => { const n = toNum(v); return Number.isFinite(n) ? Math.trunc(n) : d; };
  const rules = { mode: 'ffa' };
  FFA_RULE_KEYS.forEach((k, i) => {
    const n = toNum(Array.isArray(snap.ru) ? snap.ru[i] : undefined);
    rules[k] = Number.isFinite(n) ? n : DEFAULT_FFA_RULES[k];
  });
  const players = [];
  for (const row of snap.p) {
    if (!Array.isArray(row) || row[0] == null) continue;
    const f = int(row[3]);
    const protectMs = Math.max(0, int(row[11]));
    players.push({
      id: String(row[0]),
      name: String(row[1] == null ? '' : row[1]),
      team: null,
      bot: !!(f & 8),
      connected: !!(f & 1),
      playing: !!(f & 2),
      alive: !!(f & 4),
      hp: Math.max(0, int(row[4])),
      loadout: typeof row[5] === 'string' ? row[5] : DEFAULT_LOADOUT,
      kills: int(row[6]),
      deaths: int(row[7]),
      headshots: int(row[8]),
      damage: int(row[9]),
      respawnIn: Math.max(0, int(row[10])),
      protect: protectMs > 0,
      protectMs
    });
  }
  const res = Array.isArray(snap.res) ? snap.res : null;
  const winner = res && res[0] != null ? String(res[0]) : null;
  const tl = toNum(snap.tl);
  return {
    mode: 'ffa',
    phase: PHASES.includes(snap.ph) ? snap.ph : 'warmup',
    round: Math.max(0, int(snap.rn)),
    roundsPlayed: 0,
    timeLeftMs: snap.tl == null || !Number.isFinite(tl) ? null : Math.max(0, tl),
    score: { owner: 0, charterer: 0 },
    rules,
    killTarget: rules.killTarget,
    players,
    teams: { owner: { players: 0, alive: 0, hp: 0 }, charterer: { players: 0, alive: 0, hp: 0 } },
    history: [],
    lastRound: null,
    result: res ? { winner, reason: String(res[1] == null ? '' : res[1]), mvpId: winner } : null
  };
}

/** FFA 순위표: stats(전원, 킬↓·데스↑·헤드샷↓), ranking(접속자, 공동 등수), winnerId, leader, mvp(=우승자) */
function ffaStandings(view) {
  const list = Array.isArray(view.players) ? view.players : [];
  const n = (v) => (Number.isFinite(+v) ? Math.trunc(+v) : 0);
  const rows = list.map((p, i) => ({
    id: p.id, name: p.name, team: null, bot: !!p.bot, connected: !!p.connected,
    kills: n(p.kills), deaths: n(p.deaths), headshots: n(p.headshots), damage: n(p.damage), seq: i
  }));
  rows.sort(ffaOrder);
  const stats = rows.map(({ seq, ...r }) => r);
  const ranking = rankRows(rows.filter((r) => r.connected));
  const winnerId = view.result && view.result.winner != null ? String(view.result.winner) : null;
  const mvp = winnerId ? stats.find((s) => s.id === winnerId) || null : null;
  return { stats, mvp, ranking, winnerId, leader: ranking[0] || null };
}

/**
 * 화면용 순위표. view = m.state 또는 applySnapshot(snap).
 * @returns {{ stats: Array<{id,name,team,bot,connected,kills,deaths,headshots,damage}>, mvp: object|null }}
 *   FFA 뷰면 { stats, mvp, ranking:[{rank,id,name,kills,deaths,headshots,bot}], winnerId, leader }.
 *   stats는 MVP 순(킬 → 헤드샷 → 데미지 → 데스 적은 순 → 입장 순).
 *   matchEnd 뒤에는 방장이 정한 result.mvpId를 따른다(그 전에는 지금 기록 기준).
 */
export function standings(view) {
  if (view && view.mode === 'ffa') return ffaStandings(view);
  const list = view && Array.isArray(view.players) ? view.players : [];
  const n = (v) => (Number.isFinite(+v) ? Math.trunc(+v) : 0);
  const rows = list.map((p, i) => ({
    id: p.id, name: p.name, team: p.team, bot: !!p.bot, connected: !!p.connected,
    kills: n(p.kills), deaths: n(p.deaths), headshots: n(p.headshots), damage: n(p.damage), seq: i
  }));
  rows.sort(mvpOrder);
  const stats = rows.map(({ seq, ...r }) => r);
  let mvp;
  if (view && view.result) mvp = view.result.mvpId == null ? null : stats.find((s) => s.id === view.result.mvpId) || null;
  else {
    const top = stats[0];
    mvp = top && (top.kills > 0 || top.headshots > 0 || top.damage > 0) ? top : null;
  }
  return { stats, mvp };
}
