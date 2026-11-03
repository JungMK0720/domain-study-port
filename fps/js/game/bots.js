/**
 * ⚓ Port Ops — 봇 AI (연습장·빈자리 채우기)
 *
 * 순수 ES 모듈: three.js·DOM 의존 없음. 엔진이 매 프레임 brain.think(dt, view)를 부르고,
 * 돌려받은 입력을 사람 입력과 똑같이 처리한다(이동·시점·무기). 자세한 계약은 BOTS_API.md.
 *
 * 각도 규약(core/consts.js와 같음): yaw 0 → -Z, yaw + = 왼쪽(반시계), 전방 = (-sin yaw, 0, -cos yaw),
 * 오른쪽 = (cos yaw, 0, -sin yaw), pitch + = 위.
 *
 * 공정성: 봇은 view.enemies 전체를 받지만, '시야각 100° 안 + view.los(눈, 몸/머리) 통과'일 때만
 * 위치를 기억에 넣는다. 그 밖에는 hearShot(pos)로 들은 소리, 피격 사실만 쓴다(벽 너머를 모른다).
 */

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const EYE = 1.6;              // 눈높이 (consts PLAYER.EYE)
const HEAD_Y = 1.62;          // 머리 구 중심 (consts HITBOX.HEAD.y)
const BODY_Y = 1.2;           // 몸통 조준점 (몸통 박스 1.0~1.5의 가운데보다 조금 아래)
const WALK_SPEED = 5.2;
const FOV_H = 100 * DEG;      // 수평 시야각
const FOV_V = 70 * DEG;       // 수직 시야각(여유 포함)

/** 난이도 표 — 반응 시간·헤드샷 비율은 과제 명세값 */
export const BOT_DIFFICULTY = Object.freeze({
  easy: Object.freeze({
    reaction: 0.60, headshot: 0.05,
    aimRate: 4.5, maxTurn: 4.0, idleTurn: 2.2,       // 조준 수렴 속도(1/s), 최대 회전(rad/s)
    aimErr: 0.40, aimErrPerM: 0.011, settle: 0.9,     // 조준 오차 표준편차(m) = aimErr + 거리×aimErrPerM, 첫 조준 흔들림 감쇠(s)
    fireTol: 1.8, burst: [2, 4], burstGap: [0.35, 0.7], strafe: 0.35, counterStrafe: 0.15,
    grenade: 0, lowHp: 30, sightRange: 60, farReact: 0.008, maxEngage: 45, hearRange: 45, sniperSettle: 0.5, pistolGap: 0.45,
    lead: 0, recoilComp: 0.3, perceiveHz: 6, chasePredict: 0, advance: 0.4
  }),
  normal: Object.freeze({
    reaction: 0.38, headshot: 0.15,
    aimRate: 7, maxTurn: 6.5, idleTurn: 3.0,
    aimErr: 0.26, aimErrPerM: 0.007, settle: 0.6,
    fireTol: 1.3, burst: [3, 5], burstGap: [0.22, 0.45], strafe: 0.65, counterStrafe: 0.6,
    grenade: 0.3, lowHp: 35, sightRange: 80, farReact: 0.005, maxEngage: 60, hearRange: 60, sniperSettle: 0.32, pistolGap: 0.3,
    lead: 0.5, recoilComp: 0.6, perceiveHz: 10, chasePredict: 0.6, advance: 0.6
  }),
  hard: Object.freeze({
    reaction: 0.22, headshot: 0.30,
    aimRate: 11, maxTurn: 9.5, idleTurn: 4.0,
    aimErr: 0.15, aimErrPerM: 0.0045, settle: 0.4,
    fireTol: 1.0, burst: [4, 7], burstGap: [0.15, 0.3], strafe: 0.9, counterStrafe: 0.9,
    grenade: 0.5, lowHp: 40, sightRange: 100, farReact: 0.003, maxEngage: 75, hearRange: 75, sniperSettle: 0.2, pistolGap: 0.22,
    lead: 0.9, recoilComp: 0.85, perceiveHz: 12, chasePredict: 1.2, advance: 0.8
  })
});

/** 봇이 아는 무기 타이밍 (weapons/defs.js 값과 같게 맞춤. createBot({weaponInfo})로 덮어쓰기 가능) */
export const BOT_WEAPON_INFO = Object.freeze({
  nor1: Object.freeze({ slot: 1, kind: 'sniper', mag: 5, interval: 1.2, bolt: 1.2, zoomIn: 0.16, accurateAt: 0.5, reload: 3.0, draw: 0.8, kick: 3.2 * DEG, recover: 5, recoverDelay: 0.06 }),
  dwt47: Object.freeze({ slot: 1, kind: 'rifle', mag: 30, interval: 0.1, zoomIn: 0.18, reload: 2.3, draw: 0.65, kick: 0.5 * DEG, recover: 7, recoverDelay: 0.12 }),
  sof9: Object.freeze({ slot: 2, kind: 'pistol', mag: 12, interval: 0.16, reload: 1.6, draw: 0.45, kick: 1.2 * DEG, recover: 9, recoverDelay: 0.08 }),
  hawser: Object.freeze({ slot: 3, kind: 'melee', range: 1.8, interval: 0.45, draw: 0.4 }),
  bunker: Object.freeze({ slot: 4, kind: 'grenade', speed: 16, pitchUp: 6 * DEG, gravity: 12, fuse: 2.5, prime: 0.25, draw: 0.5, radius: 6 })
});

/* ---------------- 작은 도구들 ---------------- */
const wrap = (a) => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const num = (v, d) => (isNum(v) ? v : d);
/** {x,y,z} 또는 [x,y,z] → {x,y,z} (복사) */
function rv(p, out) {
  const o = out || { x: 0, y: 0, z: 0 };
  if (!p) { o.x = 0; o.y = 0; o.z = 0; return o; }
  o.x = num(p.x !== undefined ? +p.x : +p[0], 0);
  o.y = num(p.y !== undefined ? +p.y : +p[1], 0);
  o.z = num(p.z !== undefined ? +p.z : +p[2], 0);
  return o;
}
const yawOf = (dx, dz) => Math.atan2(-dx, -dz);
const hyp2 = (dx, dz) => Math.sqrt(dx * dx + dz * dz);
const dist3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const dist2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** los 반환값 정규화: boolean | {clear} | {visible} | {hit} */
function losClear(r) {
  if (typeof r === 'boolean') return r;
  if (r && typeof r === 'object') {
    if ('clear' in r) return !!r.clear;
    if ('visible' in r) return !!r.visible;
    if ('hit' in r) return !r.hit;
  }
  return !!r;
}
/** 배열과 {x,y,z}를 겸하는 점 (physics.lineOfSight(a,b)처럼 배열을 받는 함수에도 바로 넘길 수 있게) */
function dualPoint() { const p = [0, 0, 0]; p.x = 0; p.y = 0; p.z = 0; return p; }
function setDual(p, x, y, z) { p[0] = p.x = x; p[1] = p.y = y; p[2] = p.z = z; return p; }

/** 수류탄 발사각(낮은 포물선): 수평거리 d, 높이차 h, 속력 v, 중력 g → 상승각(rad) 또는 NaN */
export function lobAngle(d, h, v, g) {
  if (!(d > 0.1)) return 45 * DEG;
  const v2 = v * v, disc = v2 * v2 - g * (g * d * d + 2 * h * v2);
  if (disc < 0) return NaN;
  return Math.atan((v2 - Math.sqrt(disc)) / (g * d));
}

const LANE_TABLE = { 1: ['center'], 2: ['left', 'right'], 3: ['left', 'center', 'right'], 4: ['left', 'center', 'right', 'center'] };

/**
 * 봇 두뇌 하나를 만든다.
 * @param {object} opts
 * @param {string|number} opts.id
 * @param {'owner'|'charterer'} opts.team
 * @param {'easy'|'normal'|'hard'} [opts.difficulty='normal']
 * @param {'nor1'|'dwt47'} [opts.primary='dwt47']
 * @param {'left'|'center'|'right'} [opts.lane]  지정하지 않으면 아군 id 순서로 자동 배정
 * @param {number} [opts.seed]                   난수 씨앗(같은 값이면 같은 행동)
 * @param {object} [opts.tuning]                 BOT_DIFFICULTY 항목 덮어쓰기
 * @param {object} [opts.weaponInfo]             BOT_WEAPON_INFO 항목 덮어쓰기 ({ nor1: {bolt: 1.0}, ... })
 */
export function createBot(opts = {}) {
  const o = opts || {};
  const id = o.id ?? 'bot';
  const team = o.team || 'owner';
  const difficulty = Object.prototype.hasOwnProperty.call(BOT_DIFFICULTY, o.difficulty) ? o.difficulty : 'normal';
  const D = Object.assign({}, BOT_DIFFICULTY[difficulty], o.tuning || {});
  const primary = o.primary === 'nor1' ? 'nor1' : 'dwt47';
  const isSniper = primary === 'nor1';
  const W = {};
  for (const k of Object.keys(BOT_WEAPON_INFO)) W[k] = Object.assign({}, BOT_WEAPON_INFO[k], (o.weaponInfo && o.weaponInfo[k]) || {});
  const slotWeapon = (s) => (s === 1 ? primary : s === 2 ? 'sof9' : s === 3 ? 'hawser' : s === 4 ? 'bunker' : primary);
  const rng = mulberry32(o.seed != null ? (+o.seed >>> 0) : hashStr(String(id) + ':' + team + ':' + difficulty));
  const rand = (a, b) => a + (b - a) * rng();
  let spare = null;
  const gauss = () => {
    if (spare !== null) { const v = spare; spare = null; return v; }
    let u = 0, v = 0;
    while (u < 1e-12) u = rng();
    v = rng();
    const m = Math.sqrt(-2 * Math.log(u));
    spare = m * Math.sin(TAU * v);
    return m * Math.cos(TAU * v);
  };

  /* ---------------- 상태 ---------------- */
  const stats = { stuck: 0, recovered: 0, abandoned: 0, shots: 0, pathFails: 0, grenades: 0, covers: 0, thinkMs: 0, thinks: 0 };
  let clock = 0, alive = false, roundId = 0;
  const pos = { x: 0, y: 0, z: 0 }, lastPos = { x: 0, y: 0, z: 0 }, vel = { x: 0, y: 0, z: 0 }, eye = { x: 0, y: 0, z: 0 };
  let yaw = 0, pitch = 0, hp = 100, lastHp = 100, curSlot = 1, haveLast = false;
  let nav = null, view = null;
  const LA = dualPoint(), LB = dualPoint();
  let losCalls = 0;

  let mode = 'patrol', modeSince = 0;
  const mem = new Map();          // enemyId → {id, pos, vel, seenAt, visible, acquiredAt, lostAt, grenadeRolled}
  let targetId = null;
  let nextPerceive = rng() * 0.1;
  let nextTrack = 0;
  const sounds = [];              // {x,y,z,t}
  const alliesKnown = [];         // [{x,y,z}] 이번 프레임 아군 위치(아군 사격 소리 거르기)
  let alert = null;               // {x,y,z,until} — 피격 등으로 돌아볼 곳
  let damagedAt = -99;

  // 경로
  const P = { pts: null, idx: 0, goal: null, purpose: '', plannedAt: -99, failAt: -99, wpBest: Infinity, wpT: 0, shortcutT: 0 };
  // 순찰 계획
  const plan = { lane: o.lane || null, route: [], routeIdx: 0, ownC: null, enemyC: null, holdUntil: 0, holdSpot: null, holdYaw: 0, scanT: 0, visited: [] , ready: false };
  // 끼임
  const stk = { ring: [], sampleT: 0, moveT: 0, level: 0, at: null, lastEvent: -99, recoverUntil: 0, side: 1, escape: null, escapeUntil: 0 };
  // 조준
  const aim = { ex: 0, ey: 0, head: false, rollT: 0, reactUntil: 0, lastTarget: null };
  // 무기
  const wpn = {
    wantSlot: 1, drawUntil: 0, prevSlot: 1,
    boltUntil: 0, zoomStart: -1, lastFire: -99, pulse: false, prevFire: false,
    burstEnd: -1, nextBurst: 0, burstStop: false, preStop: -1,
    reloadUntil: 0, nextTap: 0,
    estMag: { 1: W[primary].mag, 2: W.sof9.mag }, grenades: 1,
    gr: null                       // 수류탄 시퀀스 {phase, t, target}
  };
  // 반동 (엔진이 self.recoil을 주면 그것을, 아니면 내부 추정)
  const rk = { yaw: 0, pitch: 0, ext: false, lastShot: -99, kickCfg: null };
  // 교전 이동
  const eng = { strafeDir: 0, strafeUntil: 0, spaceT: 0, advance: false };
  // 엄폐
  let cover = null;                 // {pt, threat, phase, until}
  let lastCoverTry = -99;
  // 추적·조사
  let chase = null;                 // {goal, lookAt, arrivedAt, until}
  let investigate = null;           // {goal, until, t}
  let search = null;                // {until, nextLook, lookYaw}

  function setMode(m) { if (m !== mode) { mode = m; modeSince = clock; } }

  /* ---------------- 시야 ---------------- */
  function los(ax, ay, az, bx, by, bz) {
    losCalls++;
    setDual(LA, ax, ay, az); setDual(LB, bx, by, bz);
    if (view && typeof view.los === 'function') {
      try { return losClear(view.los(LA, LB)); } catch (e) { return false; }
    }
    if (nav && typeof nav.raycast === 'function') return nav.raycast(LA, LB);
    return true;
  }
  /** 적 하나가 지금 보이는가 (시야각 + 시선) */
  function sightRange() {
    let r = D.sightRange * (isSniper ? 1.5 : 1);
    const fog = nav && nav.fog;
    if (fog && isNum(fog[1]) && fog[1] > 10) r = Math.min(r, fog[1] * 0.8);
    return r;
  }
  /** 적이 보이는가: 0 = 안 보임, 1 = 몸통 보임, 2 = 머리만 보임 */
  function canSee(ep) {
    const dx = ep.x - eye.x, dz = ep.z - eye.z, dXZ = hyp2(dx, dz);
    if (dXZ > sightRange()) return 0;
    if (dXZ > 0.8) {
      const ang = Math.abs(wrap(yawOf(dx, dz) - yaw));
      if (ang > FOV_H / 2) return 0;
      const elev = Math.atan2(ep.y + BODY_Y - eye.y, dXZ);
      if (Math.abs(elev - pitch) > FOV_V / 2 + 0.25) return 0;
    }
    if (los(eye.x, eye.y, eye.z, ep.x, ep.y + BODY_Y, ep.z)) return 1;
    return los(eye.x, eye.y, eye.z, ep.x, ep.y + HEAD_Y, ep.z) ? 2 : 0;
  }
  const _ep = { x: 0, y: 0, z: 0 };
  function perceive(enemies, full) {
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (!e) continue;
      const eid = e.id ?? i;
      let m = mem.get(eid);
      if (e.alive === false) { if (m) mem.delete(eid); if (targetId === eid) targetId = null; continue; } // 사망은 킬로그로 공개
      if (!full && eid !== targetId) continue;
      rv(e.pos, _ep);
      const vis = canSee(_ep);
      if (!vis) {
        if (m && m.visible) { m.visible = false; m.lostAt = clock; }
        continue;
      }
      if (!m) { m = { id: eid, pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, seenAt: -99, visible: false, part: 1, acquiredAt: clock, react: D.reaction, lostAt: -99, grenadeRolled: false, chased: false }; mem.set(eid, m); }
      m.part = vis;
      if (!m.visible) {
        const gap = clock - m.seenAt;
        // 처음 보거나 오래 놓쳤으면 반응 시간 전부(멀수록 조금 더), 잠깐 가려졌다 나오면 일부만
        if (gap > 1.2) {
          const far = Math.max(0, dist3(eye, _ep) - 25) * D.farReact;
          m.acquiredAt = clock; m.react = (D.reaction + far) * rand(0.9, 1.15);
        }
        else if (gap > 0.35) m.acquiredAt = Math.max(m.acquiredAt, clock - m.react * 0.5);
        m.grenadeRolled = false;
      }
      const dt = clock - m.seenAt;
      if (m.seenAt > -98 && dt > 0.02 && dt < 1) {
        const k = 0.5;
        m.vel.x = m.vel.x * (1 - k) + ((_ep.x - m.pos.x) / dt) * k;
        m.vel.y = 0;
        m.vel.z = m.vel.z * (1 - k) + ((_ep.z - m.pos.z) / dt) * k;
      } else if (dt >= 1) { m.vel.x = 0; m.vel.z = 0; }
      m.pos.x = _ep.x; m.pos.y = _ep.y; m.pos.z = _ep.z;
      m.seenAt = clock; m.visible = true;
    }
    // 오래된 기억 정리
    for (const [k, m] of mem) if (!m.visible && clock - m.seenAt > 25) mem.delete(k);
  }
  /** 보이는 적의 '지금' 위치 (보일 때만) */
  function livePos(m) {
    if (!m || !m.visible || !view || !Array.isArray(view.enemies)) return m ? m.pos : null;
    for (let i = 0; i < view.enemies.length; i++) {
      const e = view.enemies[i];
      if (e && (e.id ?? i) === m.id) { rv(e.pos, m.pos); return m.pos; }
    }
    return m.pos;
  }
  function pickTarget() {
    let best = null, bestS = Infinity;
    for (const m of mem.values()) {
      if (!m.visible) continue;
      const d = dist3(eye, m.pos);
      const ang = Math.abs(wrap(yawOf(m.pos.x - eye.x, m.pos.z - eye.z) - yaw));
      let s = d * (1 + ang * 0.7);
      if (m.id === targetId) s *= 0.55;
      if (s < bestS) { bestS = s; best = m; }
    }
    return best;
  }
  function recentLost() {
    let best = null;
    for (const m of mem.values()) if (!m.visible && clock - m.seenAt < 10 && (!best || m.seenAt > best.seenAt)) best = m;
    return best;
  }

  /* ---------------- 경로 ---------------- */
  /**
   * goal까지 경로를 준비한다. 같은 목적·비슷한 목표의 경로가 있으면 그대로 쓴다.
   * @returns 경로가 있으면 true, 없으면(실패·방금 실패한 목표) false
   */
  function planTo(goal, purpose, force) {
    if (!goal) return false;
    const gy = num(goal.y, pos.y);
    if (!nav || typeof nav.findPath !== 'function') {
      P.pts = [{ x: goal.x, y: gy, z: goal.z }]; P.idx = 0; P.goal = { x: goal.x, y: gy, z: goal.z }; P.purpose = purpose;
      return true;
    }
    const same = P.pts && P.goal && P.purpose === purpose && dist2(P.goal, goal) < 1.5 && Math.abs(P.goal.y - gy) < 1.2;
    if (same && !force) return true;
    // 방금 실패한 목표는 1초 동안 다시 찾지 않는다(매 프레임 A* 방지)
    if (!force && P.failGoal && P.failPurpose === purpose && dist2(P.failGoal, goal) < 1.5 && clock - P.failAt < 1.0) return false;
    // 움직이는 목표: 기존 경로를 잠깐 유지 (0.25초에 한 번만 다시 계획)
    if (!force && P.pts && P.purpose === purpose && clock - P.plannedAt < 0.25) return true;
    P.plannedAt = clock;
    let pts = null;
    try { pts = nav.findPath(pos, goal); } catch (e) { pts = null; }
    P.goal = { x: goal.x, y: gy, z: goal.z }; P.purpose = purpose;
    if (!pts || !pts.length) {
      P.pts = null; P.failAt = clock; P.failGoal = { x: goal.x, y: gy, z: goal.z }; P.failPurpose = purpose; stats.pathFails++;
      return false;
    }
    P.pts = pts; P.idx = 0; P.wpBest = Infinity; P.wpT = clock; P.shortcutT = clock;
    return true;
  }
  function clearPath() { P.pts = null; P.goal = null; P.idx = 0; }
  /** 현재 위치에서 q까지 곧장 걸어갈 수 있는가 (navgrid.walkStraight 정밀 검사, 없으면 칸 단위 losWalk) */
  let cutCache = { t: -1, q: null, ok: false };
  function canCut(q, fresh) {
    if (!q || q.jump || q.drop) return false;
    if (!nav) return true;
    if (!fresh && cutCache.q === q && clock - cutCache.t < 0.1) return cutCache.ok;
    let ok;
    if (typeof nav.walkStraight === 'function') ok = nav.walkStraight(pos, q);
    else ok = typeof nav.losWalk === 'function' ? nav.losWalk(pos, q) : true;
    cutCache = { t: clock, q, ok };
    return ok;
  }
  const pathDone = () => !P.pts || P.idx >= P.pts.length;
  /** 현재 경로를 따라갈 방향을 mv에 넣는다. 경로가 끝났으면 false */
  function followPath(mv) {
    const pts = P.pts;
    if (!pts || P.idx >= pts.length) return false;
    let wp = pts[P.idx];
    for (let guard = 0; guard < pts.length + 1; guard++) {
      const dx = wp.x - pos.x, dz = wp.z - pos.z, d = hyp2(dx, dz);
      const last = P.idx === pts.length - 1;
      const rad = last ? 0.55 : (wp.jump || wp.drop ? 0.45 : 0.65);
      let passed = d < rad && Math.abs(wp.y - pos.y) < 0.9;
      if (!passed && !last && !wp.jump && !wp.drop && Math.abs(wp.y - pos.y) < 0.6) {
        const prev = P.idx > 0 ? pts[P.idx - 1] : null;
        if (prev) {
          const sx = wp.x - prev.x, sz = wp.z - prev.z, sl = hyp2(sx, sz);
          if (sl > 0.1 && ((pos.x - wp.x) * sx + (pos.z - wp.z) * sz) / sl > 0.05 && d < 2.0) passed = true;
        }
      }
      // 모서리 자르기 확인: 지금 자리에서 다음 경유점까지 실제로 걸어갈 수 있을 때만 일찍 넘긴다
      if (passed && !last && d > 0.18 && !canCut(pts[P.idx + 1])) passed = false;
      if (!passed) break;
      P.idx++; P.wpBest = Infinity; P.wpT = clock;
      if (P.idx >= pts.length) return false;
      wp = pts[P.idx];
    }
    // 가끔 다음 경유점이 바로 걸어갈 수 있으면 건너뛰기 (교전 중 밀려났을 때 등)
    if (nav && clock - P.shortcutT > 0.5 && P.idx + 1 < pts.length) {
      P.shortcutT = clock;
      const nx = pts[P.idx + 1];
      if (!wp.jump && !wp.drop && !nx.jump && !nx.drop && Math.abs(nx.y - pos.y) < 0.5 && canCut(nx, true)) { P.idx++; wp = nx; P.wpBest = Infinity; P.wpT = clock; }
    }
    const dx = wp.x - pos.x, dz = wp.z - pos.z, d = hyp2(dx, dz) || 1;
    mv.x = dx / d; mv.z = dz / d; mv.on = true;
    if (wp.jump && d < 1.25) mv.jump = true;
    if (wp.drop && d < 1.6) mv.walk = true;
    if (d < P.wpBest - 0.3) { P.wpBest = d; P.wpT = clock; }
    return true;
  }
  /** 경로 앞쪽(바라볼 곳) */
  function lookAhead() {
    const pts = P.pts;
    if (!pts || P.idx >= pts.length) return null;
    let i = P.idx, acc = 0, px = pos.x, pz = pos.z;
    for (; i < pts.length; i++) {
      acc += hyp2(pts[i].x - px, pts[i].z - pz);
      px = pts[i].x; pz = pts[i].z;
      if (acc > 5) break;
    }
    const q = pts[Math.min(i, pts.length - 1)];
    return { x: q.x, y: q.y + EYE, z: q.z };
  }
  function snap(p, maxD) {
    if (!nav || !nav.nearestWalkable) return p;
    const q = nav.nearestWalkable(p, maxD || 6);
    return q ? { x: q.x, y: q.y, z: q.z } : p;
  }

  /* ---------------- 순찰 계획 ---------------- */
  function centroid(list) {
    if (!list || !list.length) return null;
    let x = 0, y = 0, z = 0;
    for (const s of list) { x += num(s.x, 0); y += num(s.y, 0); z += num(s.z, 0); }
    return { x: x / list.length, y: y / list.length, z: z / list.length };
  }
  function laneName() {
    if (o.lane) return o.lane;
    const ids = [String(id)];
    if (view && Array.isArray(view.allies)) for (const a of view.allies) if (a && a.id != null && String(a.id) !== String(id)) ids.push(String(a.id));
    ids.sort();
    const n = ids.length, i = ids.indexOf(String(id));
    const t = LANE_TABLE[n] || ['left', 'center', 'right'];
    return t[i % t.length];
  }
  function setupPlan() {
    plan.ready = true;
    plan.route = []; plan.routeIdx = 0; plan.holdUntil = 0; plan.holdSpot = null; plan.visited = [];
    const sp = nav && nav.spawns ? nav.spawns : null;
    const other = team === 'owner' ? 'charterer' : 'owner';
    plan.ownC = centroid(sp && sp[team]) || { x: pos.x, y: pos.y, z: pos.z };
    plan.enemyC = centroid(sp && sp[other]) || { x: -pos.x, y: pos.y, z: -pos.z };
    plan.lane = laneName();
    if (!nav) { plan.route = [plan.enemyC]; return; }
    if (isSniper) {
      const spot = pickSniperSpot(0.08, 0.55);
      if (spot) plan.route.push(spot);
      return;
    }
    const lanes = nav.lanes ? nav.lanes(plan.ownC, plan.enemyC) : null;
    const via = lanes && lanes[plan.lane] ? lanes[plan.lane] : [];
    for (const p of via) plan.route.push({ x: p.x, y: p.y, z: p.z });
    const end = nav.randomPoint ? nav.randomPoint({ x: plan.enemyC.x, z: plan.enemyC.z, r: 10 }, rng) : null;
    plan.route.push(end || plan.enemyC);
  }
  /** 맵 축(우리 스폰 → 적 스폰) 위 진행도 0..1, 옆 방향 부호 */
  function axisInfo(p) {
    const a = plan.ownC, b = plan.enemyC;
    const ax = b.x - a.x, az = b.z - a.z, L2 = ax * ax + az * az || 1;
    const t = ((p.x - a.x) * ax + (p.z - a.z) * az) / L2;
    const side = ((p.x - a.x) * (-az) + (p.z - a.z) * ax) / Math.sqrt(L2); // + = 오른쪽
    return { t, side };
  }
  function pickSniperSpot(t0, t1) {
    if (!nav || !Array.isArray(nav.points) || !nav.points.length) return null;
    const dirx = plan.enemyC.x - plan.ownC.x, dirz = plan.enemyC.z - plan.ownC.z, L = hyp2(dirx, dirz) || 1;
    const scored = [];
    for (const p of nav.points) {
      const ai = axisInfo(p);
      if (ai.t < t0 || ai.t > t1) continue;
      if (plan.lane === 'left' && ai.side > 4) continue;
      if (plan.lane === 'right' && ai.side < -4) continue;
      if (plan.visited.some((v) => dist2(v, p) < 6)) continue;
      const look = nav.sightToward ? nav.sightToward(p, dirx / L, dirz / L) : p.open;
      const s = look * 1.0 + p.far * 0.25 + p.open * 0.3 + (p.elev ? 12 : 0) - p.cover * 5 + rng() * 6;
      scored.push({ p, s });
    }
    if (!scored.length) return null;
    scored.sort((a, b) => b.s - a.s);
    const pick = scored[Math.min(scored.length - 1, Math.floor(rng() * Math.min(3, scored.length)))].p;
    return { x: pick.x, y: pick.y, z: pick.z, spot: pick };
  }
  function bestSightYaw(spot) {
    const toE = yawOf(plan.enemyC.x - spot.x, plan.enemyC.z - spot.z);
    if (!spot.spot || !spot.spot.dist || !nav.sightToward) return toE;
    let best = toE, bestS = -1;
    for (let k = -4; k <= 4; k++) {
      const y = toE + k * 12 * DEG;
      const fx = -Math.sin(y), fz = -Math.cos(y);
      const s = nav.sightToward(spot.spot, fx, fz) * (1 - Math.abs(k) * 0.06);
      if (s > bestS) { bestS = s; best = y; }
    }
    return best;
  }
  function nextRoamGoal() {
    if (!nav) return plan.enemyC;
    if (isSniper && rng() < 0.7) {
      const s = pickSniperSpot(0.25, 0.85);
      if (s) return s;
    }
    const pts = Array.isArray(nav.points) ? nav.points : [];
    for (let t = 0; t < 12 && pts.length; t++) {
      const p = pts[Math.floor(rng() * pts.length)];
      const d = dist2(p, pos);
      if (d < 12 || d > 70) continue;
      if (plan.visited.some((v) => dist2(v, p) < 8)) continue;
      return { x: p.x, y: p.y, z: p.z };
    }
    return nav.randomPoint ? nav.randomPoint(null, rng) : plan.enemyC;
  }

  /* ---------------- 끼임 감지·복구 ---------------- */
  function stuckEvent() {
    stats.stuck++;
    stk.level++;
    stk.at = { x: pos.x, z: pos.z };
    stk.lastEvent = clock;
    stk.moveT = 0;
    stk.ring.length = 0;
    P.wpT = clock; P.wpBest = Infinity;
    if (stk.level === 1) {
      stk.recoverUntil = clock + 0.6; stk.side = rng() < 0.5 ? -1 : 1;
    } else if (stk.level === 2) {
      if (P.goal) planTo(P.goal, P.purpose, true);
      stk.recoverUntil = clock + 0.4; stk.side = -stk.side;
    } else if (stk.level === 3) {
      let e = null;
      for (let t = 0; t < 8 && nav && nav.randomPoint; t++) {
        const q = nav.randomPoint({ x: pos.x, z: pos.z, r: 6, minR: 2 }, rng);
        if (q && Math.abs(q.y - pos.y) < 0.6 && (!nav.losWalk || nav.losWalk(pos, q))) { e = q; break; }
      }
      if (e) { stk.escape = e; stk.escapeUntil = clock + 2.2; }
      else { stk.recoverUntil = clock + 0.8; stk.side = -stk.side; }
    } else {
      stats.abandoned++;
      stk.level = 0; stk.escape = null;
      clearPath();
      if (mode === 'patrol') { plan.routeIdx++; plan.holdUntil = 0; }
      else if (mode === 'chase') chase = null;
      else if (mode === 'investigate') investigate = null;
      else if (mode === 'cover') cover = null;
    }
  }
  function stuckUpdate(dt, wantsMove) {
    if (clock - stk.sampleT >= 0.25) {
      stk.ring.push({ x: pos.x, z: pos.z, t: clock });
      if (stk.ring.length > 10) stk.ring.shift();
      stk.sampleT = clock;
    }
    stk.moveT = wantsMove ? stk.moveT + dt : 0;
    if (stk.level > 0 && stk.at && (hyp2(pos.x - stk.at.x, pos.z - stk.at.z) > 3 || clock - stk.lastEvent > 8)) {
      if (hyp2(pos.x - stk.at.x, pos.z - stk.at.z) > 3) stats.recovered++;
      stk.level = 0; stk.escape = null;
    }
    if (!wantsMove || clock < stk.recoverUntil) return;
    let old = null;
    for (let i = stk.ring.length - 1; i >= 0; i--) if (clock - stk.ring[i].t >= 1.0) { old = stk.ring[i]; break; }
    if (stk.moveT > 1.2 && old && hyp2(pos.x - old.x, pos.z - old.z) < 0.35) { stuckEvent(); return; }
    if (P.pts && P.idx < P.pts.length && clock - P.wpT > 3.2 && stk.moveT > 3) stuckEvent();
  }

  /* ---------------- 무기 상태 읽기 ---------------- */
  function readWeapon(self) {
    const a = self.ammo;
    let mag = null, reserve = null, reloading = null;
    if (isNum(a)) mag = a;
    else if (a && typeof a === 'object') {
      mag = num(a.mag ?? a.clip ?? a.current ?? a.inMag, null);
      reserve = num(a.reserve ?? a.spare ?? a.total, null);
      if (typeof a.reloading === 'boolean') reloading = a.reloading;
    }
    if (mag === null) mag = wpn.estMag[curSlot] ?? null;
    else if (curSlot === 1 || curSlot === 2) wpn.estMag[curSlot] = mag;
    let state = null;
    const w = self.weapon;
    if (w && typeof w === 'object' && typeof w.state === 'string') state = w.state;
    if (reloading === null && state) reloading = state === 'reload';
    if (reloading === null) reloading = clock < wpn.reloadUntil;
    let zoomP = null;
    if (isNum(self.zoom)) zoomP = self.zoom;
    else if (self.zoom && typeof self.zoom === 'object' && isNum(self.zoom.progress)) zoomP = self.zoom.progress;
    let gren = isNum(self.grenades) ? self.grenades : wpn.grenades;
    return { mag, reserve, reloading, state, zoomP, gren };
  }

  /* ---------------- 조준 ---------------- */
  /** 목표 방향으로 지수 수렴 (rate 1/s, maxTurn rad/s) */
  function turnToward(out, tYaw, tPitch, rate, maxTurn, dt) {
    const k = 1 - Math.exp(-rate * dt);
    let dy = wrap(tYaw - yaw) * k, dp = (clamp(tPitch, -1.45, 1.45) - pitch) * k;
    const lim = maxTurn * dt;
    const m = Math.max(Math.abs(dy), Math.abs(dp));
    if (m > lim) { dy *= lim / m; dp *= lim / m; }
    out.yawDelta = dy; out.pitchDelta = dp;
  }
  function lookAtPoint(out, p, rate, maxTurn, dt) {
    const dx = p.x - eye.x, dz = p.z - eye.z;
    if (hyp2(dx, dz) < 0.05) return;
    turnToward(out, yawOf(dx, dz), Math.atan2(p.y - eye.y, hyp2(dx, dz)), rate, maxTurn, dt);
  }
  /** 사람처럼 흔들리는 조준점(오차는 Ornstein-Uhlenbeck 과정) */
  function aimPoint(m, tp, dt, selfSpeed) {
    const d = dist3(eye, tp);
    if (aim.lastTarget !== m.id) { aim.lastTarget = m.id; aim.ex = gauss() * 0.6; aim.ey = gauss() * 0.3; }
    const since = clock - m.acquiredAt;
    const settle = 1 + 1.0 * Math.exp(-since / Math.max(0.05, D.settle));
    const tSpeed = hyp2(m.vel.x, m.vel.z);
    const moveMul = 1 + 0.45 * Math.min(1.2, selfSpeed / WALK_SPEED) + 0.35 * Math.min(1.2, tSpeed / WALK_SPEED);
    const head = aim.head || m.part === 2;          // 머리만 보이면 머리를 겨눈다
    const scoped = isSniper && curSlot === 1 && wpn.zoomStart >= 0;
    const sigma = (D.aimErr + D.aimErrPerM * d) * settle * moveMul * (head ? 0.7 : 1) * (scoped ? 0.65 : 1);
    const th = 2.5;
    const sq = Math.sqrt(2 * th * dt);
    aim.ex += -aim.ex * th * dt + sigma * sq * gauss();
    aim.ey += -aim.ey * th * dt + sigma * 0.55 * sq * gauss();
    const baseY = head ? HEAD_Y : BODY_Y;
    const ey = head ? aim.ey : clamp(aim.ey, -0.2, 0.18);
    // 이동 예측(난이도별 일부만)
    const lead = D.lead * Math.min(0.25, d / 400);
    const dx = tp.x - eye.x, dz = tp.z - eye.z, l = hyp2(dx, dz) || 1;
    const px = -dz / l, pz = dx / l; // 시선에 수직인 수평 방향
    return {
      x: tp.x + px * aim.ex + m.vel.x * lead,
      y: tp.y + baseY + ey,
      z: tp.z + pz * aim.ex + m.vel.z * lead,
      d
    };
  }
  /** 실제 총구 방향(시선 + 반동)과 조준점 사이 각도 */
  function aimError(p) {
    const dx = p.x - eye.x, dz = p.z - eye.z, dy = p.y - eye.y;
    const ty = yawOf(dx, dz), tp = Math.atan2(dy, hyp2(dx, dz));
    const ey = wrap(ty - (yaw + rk.yaw)) * Math.cos(pitch), ep = tp - (pitch + rk.pitch);
    return Math.sqrt(ey * ey + ep * ep);
  }
  function recoilUpdate(self, dt) {
    const r = self.recoil;
    if (r && (isNum(r.pitch) || isNum(r[1]))) {
      rk.ext = true;
      rk.yaw = num(r.yaw ?? r[0], 0); rk.pitch = num(r.pitch ?? r[1], 0);
      return;
    }
    rk.ext = false;
    const c = rk.kickCfg;
    if (c && clock - rk.lastShot > c.recoverDelay) {
      const k = Math.exp(-c.recover * dt);
      rk.yaw *= k; rk.pitch *= k;
    }
  }
  function recoilShot(info, n) {
    if (rk.ext || !info || !info.kick) return;
    rk.kickCfg = info; rk.lastShot = clock;
    rk.pitch = Math.min(10 * DEG, rk.pitch + info.kick * n);
  }
  function allyInLine(tp) {
    if (!view || !Array.isArray(view.allies)) return false;
    const dx = tp.x - eye.x, dy = tp.y - eye.y, dz = tp.z - eye.z, L = Math.hypot(dx, dy, dz) || 1;
    for (const a of view.allies) {
      if (!a || a.alive === false || String(a.id) === String(id)) continue;
      const q = rv(a.pos);
      const qx = q.x - eye.x, qy = q.y + 1.1 - eye.y, qz = q.z - eye.z;
      const t = (qx * dx + qy * dy + qz * dz) / L;
      if (t <= 0 || t >= L - 0.5) continue;
      const cx = qx - dx / L * t, cy = qy - dy / L * t, cz = qz - dz / L * t;
      if (cx * cx + cz * cz < 0.45 * 0.45 && Math.abs(cy) < 1.0) return true;
    }
    return false;
  }

  /* ---------------- 엄폐 ---------------- */
  function findCover(threat) {
    if (!nav || typeof nav.coverCandidates !== 'function') return null;
    let cands;
    try { cands = nav.coverCandidates(pos, 14, 16); } catch (e) { return null; }
    const dNow = dist2(pos, threat);
    let checks = 0;
    for (const c of cands) {
      if (dist2(c, threat) < Math.min(dNow - 1.5, 6)) continue; // 적 쪽으로 다가가는 엄폐는 피한다
      if (checks++ >= 10) break;
      if (!los(c.x, c.y + EYE, c.z, threat.x, threat.y + EYE, threat.z) && !los(c.x, c.y + 1.0, c.z, threat.x, threat.y + EYE, threat.z)) return c;
    }
    return null;
  }

  /* ---------------- 리셋 ---------------- */
  function resetRound() {
    roundId++;
    mem.clear(); targetId = null; sounds.length = 0; alert = null;
    clearPath(); chase = null; investigate = null; search = null; cover = null;
    plan.ready = false; plan.lane = o.lane || null;
    stk.ring.length = 0; stk.level = 0; stk.escape = null; stk.moveT = 0;
    wpn.wantSlot = 1; wpn.boltUntil = 0; wpn.zoomStart = -1; wpn.burstEnd = -1; wpn.gr = null; wpn.grenades = 1;
    wpn.estMag = { 1: W[primary].mag, 2: W.sof9.mag }; wpn.reloadUntil = 0;
    eng.strafeDir = 0; lastCoverTry = -99; damagedAt = -99;
    setMode('patrol');
  }

  /* ---------------- 메인 ---------------- */
  const IDLE = () => ({ forward: 0, strafe: 0, jump: false, walk: false, yawDelta: 0, pitchDelta: 0, fire: false, zoom: false, reload: false, slot: null });

  function think(dtIn, v) {
    const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
    const out = thinkInner(dtIn, v);
    if (t0) { stats.thinkMs += performance.now() - t0; stats.thinks++; }
    return out;
  }

  function thinkInner(dtIn, v) {
    const dt = clamp(num(dtIn, 1 / 60), 0, 0.1);
    clock += dt;
    view = v || {};
    nav = view.nav || null;
    const self = view.self || {};
    const out = IDLE();
    if (self.alive === false) { if (alive) { alive = false; } return out; }
    rv(self.pos, pos);
    if (!alive || (haveLast && dist2(pos, lastPos) > 12)) { if (alive || haveLast) resetRound(); alive = true; haveLast = false; }
    yaw = num(self.yaw, 0); pitch = num(self.pitch, 0);
    hp = num(self.hp, 100);
    if (isNum(self.slot)) { if (self.slot !== curSlot) { wpn.drawUntil = clock + (W[slotWeapon(self.slot)].draw || 0.5); } curSlot = self.slot; }
    eye.x = pos.x; eye.y = pos.y + EYE; eye.z = pos.z;
    if (haveLast && dt > 0) {
      const k = Math.min(1, dt * 12);
      vel.x += ((pos.x - lastPos.x) / dt - vel.x) * k;
      vel.z += ((pos.z - lastPos.z) / dt - vel.z) * k;
    }
    if (self.vel) { const q = rv(self.vel); vel.x = q.x; vel.z = q.z; }
    lastPos.x = pos.x; lastPos.y = pos.y; lastPos.z = pos.z; haveLast = true;
    const speed = hyp2(vel.x, vel.z);
    if (!plan.ready) setupPlan();
    alliesKnown.length = 0;
    if (Array.isArray(view.allies)) for (const a of view.allies) if (a && a.alive !== false) alliesKnown.push(rv(a.pos));

    // 피격 감지
    if (hp < lastHp - 0.5) {
      damagedAt = clock;
      if (!pickTarget()) {
        const s = sounds.length ? sounds[sounds.length - 1] : null;
        if (s && clock - s.t < 3) alert = { x: s.x, y: s.y + 1.2, z: s.z, until: clock + 1.5 };
        else { const by = yaw + Math.PI + rand(-0.6, 0.6); alert = { x: eye.x - Math.sin(by) * 10, y: eye.y, z: eye.z - Math.cos(by) * 10, until: clock + 1.5 }; }
      }
    }
    lastHp = hp;

    // 지각
    const enemies = Array.isArray(view.enemies) ? view.enemies : [];
    if (clock >= nextPerceive) { perceive(enemies, true); nextPerceive = clock + (1 / D.perceiveHz) * rand(0.85, 1.15); nextTrack = clock + 0.05; }
    else if (targetId != null && clock >= nextTrack) { perceive(enemies, false); nextTrack = clock + 0.05; }
    while (sounds.length && clock - sounds[0].t > 12) sounds.shift();

    const W0 = readWeapon(self);
    recoilUpdate(self, dt);
    const tgt = pickTarget();
    if (tgt) { if (targetId !== tgt.id) { targetId = tgt.id; aim.rollT = 0; } }
    else if (targetId != null && !(mem.get(targetId) && mem.get(targetId).visible)) targetId = null;

    /* ---- 상태 전이 ---- */
    if (tgt) {
      const tp = livePos(tgt);
      const lowHp = hp <= D.lowHp;
      const needReload = W0.mag === 0 && curSlot === 1;
      if (mode !== 'cover' && clock - lastCoverTry > 6 && (lowHp || (needReload && difficulty !== 'easy' && dist3(eye, tp) > 10))) {
        lastCoverTry = clock;
        const c = findCover(tp);
        if (c) { cover = { pt: c, threat: { x: tp.x, y: tp.y, z: tp.z }, phase: 'move', until: clock + 6 }; stats.covers++; setMode('cover'); planTo(c, 'cover', true); }
        else setMode('engage');
      } else if (mode !== 'cover') setMode('engage');
      chase = null; search = null;
      if (mode === 'cover' && cover) { cover.threat.x = tp.x; cover.threat.y = tp.y; cover.threat.z = tp.z; }
    } else {
      const lost = recentLost();
      if (mode === 'engage') {
        if (lost) startChase(lost);
        else setMode('patrol');
      }
      if (mode === 'cover' && !cover) setMode('patrol');
      if (mode === 'chase' && (!chase || clock > chase.until)) { chase = null; setMode('patrol'); }
      if (mode === 'investigate' && (!investigate || clock > investigate.until)) { investigate = null; setMode('patrol'); }
      if (mode === 'patrol' || mode === 'investigate') {
        const s = sounds.length ? sounds[sounds.length - 1] : null;
        if (s && clock - s.t < 6 && (!investigate || investigate.t < s.t)) startInvestigate(s);
        else if (mode === 'patrol' && lost && clock - lost.seenAt < 6 && !lost.chased) startChase(lost);
      }
    }

    /* ---- 이동·시점 결정 ---- */
    const mv = { x: 0, z: 0, on: false, jump: false, walk: false, stop: false };
    let look = null;                 // {x,y,z} 바라볼 곳
    let lookRate = D.aimRate * 0.6, lookMax = D.idleTurn;
    let combat = null;               // {m, tp, ap}

    if (mode === 'engage' && tgt) {
      const tp = livePos(tgt);
      const ap = aimPoint(tgt, tp, dt, speed);
      combat = { m: tgt, tp, ap };
      look = ap; lookRate = D.aimRate; lookMax = D.maxTurn;
      engageMove(mv, tgt, tp, ap.d, W0);
    } else if (mode === 'cover' && cover) {
      if (tgt) {
        const tp = livePos(tgt);
        const ap = aimPoint(tgt, tp, dt, speed);
        combat = { m: tgt, tp, ap };
        look = ap; lookRate = D.aimRate; lookMax = D.maxTurn;
      } else look = { x: cover.threat.x, y: cover.threat.y + EYE, z: cover.threat.z };
      if (cover.phase === 'move') {
        const ok = planTo(cover.pt, 'cover', false);
        if (!ok || !followPath(mv) || dist2(pos, cover.pt) < 0.8 || clock - modeSince > 7) {
          cover.phase = 'wait'; cover.until = clock + (ok ? rand(1.5, 3.0) : 1.0); clearPath();
        }
      } else {
        mv.stop = true;
        if (clock > cover.until && !W0.reloading) {
          const th = cover.threat;
          cover = null;
          const lost = recentLost();
          if (tgt) setMode('engage');
          else if (lost) startChase(lost);
          else setMode('patrol');
          if (!lost && !tgt) { investigate = { goal: snap(th, 6), src: { x: th.x, y: th.y, z: th.z }, until: clock + 10, t: clock }; clearPath(); setMode('investigate'); }
        }
      }
    } else if (mode === 'chase' && chase) {
      look = chase.lookAt;
      if (!search) {
        if (isSniper && clock - modeSince < chase.holdFor) mv.stop = true; // 저격수: 잠시 그 각을 계속 겨눈다
        else {
          const ok = planTo(chase.goal, 'chase', false);
          const moving = ok && followPath(mv);
          if (!moving || dist2(pos, chase.goal) < 1.2) { search = { until: clock + rand(1.6, 2.8), nextLook: 0, lookYaw: yaw }; clearPath(); }
          else if (difficulty === 'hard' && dist2(pos, chase.goal) < 8) mv.walk = true; // 마지막 위치 근처는 천천히(탄퍼짐↓)
        }
      } else {
        mv.stop = true;
        if (clock >= search.nextLook) { search.nextLook = clock + rand(0.5, 0.9); search.lookYaw = yaw + rand(-2.2, 2.2); }
        look = { x: eye.x - Math.sin(search.lookYaw) * 10, y: eye.y, z: eye.z - Math.cos(search.lookYaw) * 10 };
        if (clock > search.until) { search = null; chase = null; setMode('patrol'); }
      }
    } else if (mode === 'investigate' && investigate) {
      const s = investigate.goal;
      look = { x: investigate.src.x, y: investigate.src.y + 1.2, z: investigate.src.z };
      const holdSniper = isSniper && plan.holdSpot && dist2(pos, s) > 22;
      if (holdSniper) { mv.stop = true; if (clock - investigate.t > 5) { investigate = null; setMode('patrol'); } }
      else {
        const src = investigate.src, heardAt = investigate.t;
        const ok = planTo(s, 'investigate', false);
        if (!ok || !followPath(mv) || dist2(pos, s) < 1.5) { investigate = null; setMode('patrol'); search = null; clearPath(); }
        else if (dist2(pos, src) > 6 && clock - heardAt >= 1.2) look = lookAhead() || look; // 처음엔 소리 쪽을 보고, 이동 중엔 앞을 본다
      }
    } else {
      // 순찰
      setMode('patrol');
      patrolMove(mv);
      look = plan.holdSpot && clock < plan.holdUntil ? holdLook() : (lookAhead() || null);
    }
    if (alert && clock < alert.until && !combat) { look = alert; lookRate = D.aimRate; lookMax = D.maxTurn; }
    else if (alert && clock >= alert.until) alert = null;

    /* ---- 끼임 복구 덮어쓰기 ---- */
    if (stk.escape && clock < stk.escapeUntil && mode !== 'engage') {
      const dx = stk.escape.x - pos.x, dz = stk.escape.z - pos.z, l = hyp2(dx, dz);
      if (l > 0.5) { mv.x = dx / l; mv.z = dz / l; mv.on = true; mv.stop = false; mv.jump = false; }
      else stk.escapeUntil = clock;
    }
    if (stk.escape && clock >= stk.escapeUntil) {
      stk.escape = null;
      if (P.goal) planTo(P.goal, P.purpose, true); // 탈출 뒤 현재 위치에서 다시 계획
    }
    if (clock < stk.recoverUntil) {
      const bx = mv.on ? mv.x : -Math.sin(yaw), bz = mv.on ? mv.z : -Math.cos(yaw);
      mv.x = -bz * stk.side - bx * 0.3; mv.z = bx * stk.side - bz * 0.3;
      const l = hyp2(mv.x, mv.z) || 1; mv.x /= l; mv.z /= l; mv.on = true; mv.stop = false;
      mv.jump = stk.level === 1 && clock < stk.recoverUntil - 0.35;
    }

    /* ---- 시점 ---- */
    if (look) {
      if (combat) {
        // 반동 보정: 총구(시선+반동)가 조준점을 향하도록 시선을 반동만큼(난이도 비율) 내린다
        const dx = look.x - eye.x, dz = look.z - eye.z, h = hyp2(dx, dz);
        if (h > 0.05) turnToward(out, yawOf(dx, dz) - rk.yaw * D.recoilComp, Math.atan2(look.y - eye.y, h) - rk.pitch * D.recoilComp, lookRate, lookMax, dt);
      } else lookAtPoint(out, look, lookRate, lookMax, dt);
    }

    /* ---- 무기 ---- */
    weapons(out, mv, combat, W0, dt, speed);

    /* ---- 이동 출력 ---- */
    const wantsMove = mv.on && !mv.stop;
    if (wantsMove) {
      const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
      let f = mv.x * fx + mv.z * fz, s = mv.x * rx + mv.z * rz;
      const m = Math.max(Math.abs(f), Math.abs(s));
      const len = hyp2(f, s);
      if (len > 1e-6) { f /= len; s /= len; }
      out.forward = clamp(f, -1, 1); out.strafe = clamp(s, -1, 1);
      if (m < 1e-6) { out.forward = 0; out.strafe = 0; }
    }
    out.jump = !!mv.jump;
    out.walk = !!mv.walk;
    if (!isNum(self.slot) && out.slot) { curSlot = out.slot; wpn.drawUntil = clock + (W[slotWeapon(out.slot)].draw || 0.5); }
    stuckUpdate(dt, wantsMove && !mv.small);
    return out;
  }

  function startChase(m) {
    m.chased = true;
    const pr = D.chasePredict;
    let g = { x: m.pos.x + m.vel.x * pr, y: m.pos.y, z: m.pos.z + m.vel.z * pr };
    g = snap(g, 5);
    chase = { goal: g, lookAt: { x: m.pos.x, y: m.pos.y + EYE * 0.9, z: m.pos.z }, until: clock + 14, holdFor: isSniper ? rand(2.5, 4.5) : 0 };
    search = null;
    clearPath();
    setMode('chase');
    maybeGrenade(m);
  }
  function startInvestigate(s) {
    const g = snap({ x: s.x, y: s.y, z: s.z }, 6);
    investigate = { goal: g, src: { x: s.x, y: s.y, z: s.z }, until: clock + 12, t: s.t };
    clearPath();
    setMode('investigate');
  }

  function holdLook() {
    if (clock >= plan.scanT) { plan.scanT = clock + rand(1.2, 2.6); plan.scanOff = rand(-0.35, 0.35); }
    const y = plan.holdYaw + (plan.scanOff || 0);
    return { x: eye.x - Math.sin(y) * 30, y: eye.y + rand(-0.02, 0.02), z: eye.z - Math.cos(y) * 30 };
  }
  function patrolMove(mv) {
    // 저격수: 자리 잡고 버티기
    if (plan.holdSpot && clock < plan.holdUntil) {
      if (dist2(pos, plan.holdSpot) > 2.0) { // 교전·추적 뒤 자리로 돌아간다
        if (planTo(plan.holdSpot, 'hold', false) && followPath(mv)) return;
      }
      mv.stop = true; return;
    }
    if (plan.holdSpot && clock >= plan.holdUntil) { plan.visited.push(plan.holdSpot); plan.holdSpot = null; clearPath(); }
    let goal = plan.route[plan.routeIdx];
    if (!goal) {
      const g = nextRoamGoal();
      if (g) { plan.route.push(g); goal = g; }
    }
    if (!goal) { mv.stop = true; return; }
    if (!planTo(goal, 'patrol', false)) { plan.routeIdx++; clearPath(); mv.stop = true; return; } // 못 가는 목표는 건너뛴다
    const moving = followPath(mv);
    if (!moving || dist2(pos, goal) < 1.4) {
      plan.visited.push({ x: goal.x, z: goal.z });
      if (plan.visited.length > 12) plan.visited.shift();
      plan.routeIdx++;
      clearPath();
      if (isSniper && goal.spot) {
        plan.holdSpot = goal; plan.holdUntil = clock + rand(14, 26); plan.holdYaw = bestSightYaw(goal); plan.scanT = 0;
      }
    }
  }

  function engageMove(mv, m, tp, d, W0) {
    const active = slotWeapon(curSlot);
    const scoping = isSniper && active === 'nor1';
    // 저격: 조준 중에는 멈춘다(이동 탄퍼짐). 볼트 동안만 조금 옆걸음
    if (scoping) {
      if (clock < wpn.boltUntil - 0.25 && difficulty !== 'easy') strafeStep(mv, 0.5);
      else mv.stop = true;
      return;
    }
    // 너무 멀면 다가간다(경로)
    const far = d > (active === 'sof9' ? 22 : Math.min(40, D.maxEngage * 0.8));
    if (far && rng() < D.advance * 0.02 + (eng.advance ? 1 : 0)) eng.advance = true;
    if (!far) eng.advance = false;
    let moved = false;
    if (eng.advance) {
      moved = planTo(snap(tp, 4), 'advance', false) && followPath(mv);
      if (!moved) eng.advance = false;
    }
    if (!moved) strafeStep(mv, D.strafe);
    // 사격 중·직전 멈추기(카운터 스트레이프) — 전진 중이어도 쏠 때는 선다
    if (wpn.burstStop && (clock < wpn.burstEnd || wpn.preStop >= 0)) { mv.on = false; mv.stop = true; }
  }
  function strafeStep(mv, p) {
    if (clock >= eng.strafeUntil) {
      eng.strafeDir = rng() < p ? (rng() < 0.5 ? -1 : 1) : 0;
      eng.strafeUntil = clock + rand(0.35, 1.0);
      eng.spaceT = 0;
    }
    if (!eng.strafeDir) { mv.stop = true; return; }
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);
    if (nav && nav.losWalk && clock - eng.spaceT > 0.2) {
      eng.spaceT = clock;
      const tx = pos.x + rx * eng.strafeDir * 1.6, tz = pos.z + rz * eng.strafeDir * 1.6;
      if (!nav.losWalk(pos, { x: tx, y: pos.y, z: tz })) {
        eng.strafeDir = -eng.strafeDir;
        const ux = pos.x + rx * eng.strafeDir * 1.6, uz = pos.z + rz * eng.strafeDir * 1.6;
        if (!nav.losWalk(pos, { x: ux, y: pos.y, z: uz })) eng.strafeDir = 0;
      }
    }
    if (!eng.strafeDir) { mv.stop = true; return; }
    mv.x = rx * eng.strafeDir; mv.z = rz * eng.strafeDir; mv.on = true; mv.small = true;
  }

  /* ---------------- 수류탄 ---------------- */
  function maybeGrenade(m) {
    if (!(D.grenade > 0) || wpn.gr || m.grenadeRolled) return;
    m.grenadeRolled = true;
    const gren = view && view.self && isNum(view.self.grenades) ? view.self.grenades : wpn.grenades;
    if (!(gren > 0)) return;
    const d = dist2(pos, m.pos), dy = m.pos.y - pos.y;
    if (d < 7 || d > 26 || Math.abs(dy) > 4) return;
    for (const a of alliesKnown) if (dist2(a, m.pos) < 6.5) return;
    if (rng() >= D.grenade) return;
    wpn.gr = { phase: 'switch', t: clock, target: { x: m.pos.x + m.vel.x * 0.5, y: m.pos.y, z: m.pos.z + m.vel.z * 0.5 } };
  }
  /** 수류탄 시퀀스 진행. 처리 중이면 true */
  function grenadeStep(out, dt) {
    const g = wpn.gr;
    if (!g) return false;
    const B = W.bunker;
    const age = clock - g.t;
    if (age > 4) { wpn.gr = null; wpn.wantSlot = 1; return false; }
    // 조준: 낮은 포물선(목표의 85% 지점에 떨어지게 해서 굴러 들어가게)
    const dx = g.target.x - eye.x, dz = g.target.z - eye.z, dXZ = hyp2(dx, dz);
    const elev = lobAngle(dXZ * 0.85, g.target.y + 0.2 - eye.y, B.speed, B.gravity);
    const tYaw = yawOf(dx, dz);
    const tPitch = clamp((Number.isFinite(elev) ? elev : 40 * DEG) - B.pitchUp, -0.6, 1.2);
    turnToward(out, tYaw, tPitch, D.aimRate, D.maxTurn, dt);
    if (g.phase === 'switch') {
      wpn.wantSlot = 4;
      if (curSlot === 4 && clock >= wpn.drawUntil) { g.phase = 'aim'; g.t2 = clock; }
      return true;
    }
    if (g.phase === 'aim') {
      wpn.wantSlot = 4;
      const err = Math.abs(wrap(tYaw - yaw)) + Math.abs(tPitch - pitch);
      if (err < 0.06 || clock - g.t2 > 0.8) { g.phase = 'prime'; g.t3 = clock; }
      return true;
    }
    if (g.phase === 'prime') {
      wpn.wantSlot = 4;
      out.fire = true;
      if (clock - g.t3 >= B.prime + 0.08) { g.phase = 'release'; g.t4 = clock; }
      return true;
    }
    if (g.phase === 'release') {
      out.fire = false;
      if (clock - g.t4 > 0.45) {
        wpn.gr = null; wpn.grenades = Math.max(0, wpn.grenades - 1); stats.grenades++;
        wpn.wantSlot = 1;
        return false;
      }
      return true;
    }
    return false;
  }

  /* ---------------- 무기 운용 ---------------- */
  function weapons(out, mv, combat, W0, dt, speed) {
    const active = slotWeapon(curSlot);
    const drawn = clock >= wpn.drawUntil && W0.state !== 'draw';
    let fire = false, zoom = false;

    if (grenadeStep(out, dt)) {
      mv.stop = true;
      out.zoom = false;
      out.slot = wpn.wantSlot !== curSlot ? wpn.wantSlot : null;
      wpn.prevFire = out.fire;
      return;
    }

    if (combat) {
      const { tp, ap } = combat;
      const d = ap.d;
      const reactOk = clock >= combat.m.acquiredAt + combat.m.react;
      // 무기 선택
      let want = 1;
      const primMag = wpn.estMag[1];
      if (isSniper && difficulty !== 'easy' && (d < 9 || (curSlot === 2 && d < 14))) want = 2;
      if (curSlot === 1 && W0.mag === 0 && d < 15) want = 2;
      if (curSlot === 2 && W0.mag === 0 && primMag > 0) want = 1;
      if (want === 2 && wpn.estMag[2] === 0 && primMag > 0) want = 1;
      if (want === 1 && primMag === 0 && wpn.estMag[2] === 0 && d < 4) want = 3;
      wpn.wantSlot = want;
      // 오차·허용치
      const err = aimError(ap);
      const half = aim.head ? 0.12 : 0.24;
      const tol = Math.atan2(half, Math.max(1, d)) * D.fireTol + 0.004;
      const clear = !allyInLine(ap);
      const ready = drawn && curSlot === want && reactOk && clear && !W0.reloading;

      if (active === 'nor1' && curSlot === 1) {
        // 저격: 줌 → 반샷 이상 → 멈춘 뒤 한 방 → 볼트 대기(줌 해제)
        if (clock < wpn.boltUntil || W0.reloading || W0.mag === 0) { zoom = false; wpn.zoomStart = -1; }
        else if (drawn) {
          zoom = true;
          if (wpn.zoomStart < 0) { wpn.zoomStart = clock; aim.head = rng() < D.headshot; }
          const zoomed = W0.zoomP !== null ? W0.zoomP >= 0.55 : clock - wpn.zoomStart >= W[primary].zoomIn * 0.6;
          if (zoomed && ready && clock - wpn.zoomStart >= D.sniperSettle && speed < 0.5 && err < tol && !wpn.prevFire) {
            fire = true; wpn.boltUntil = clock + W[primary].bolt + 0.05; wpn.zoomStart = -1; stats.shots++; recoilShot(W[primary], 1);
            wpn.estMag[1] = Math.max(0, (wpn.estMag[1] ?? 5) - 1);
          }
        }
      } else if (active === 'dwt47' && curSlot === 1) {
        zoom = drawn && d > (difficulty === 'easy' ? 22 : 12);
        if (wpn.burstEnd > 0) {
          if (clock < wpn.burstEnd && ready && err < tol * 2.2 && W0.mag !== 0) fire = true;
          else { // 점사 끝(또는 중단) → 반동 회복 간격
            wpn.burstEnd = -1;
            wpn.nextBurst = clock + rand(D.burstGap[0], D.burstGap[1]) * (d > 30 ? 1.4 : d < 10 ? 0.6 : 1);
          }
        } else if (ready && clock >= wpn.nextBurst && err < tol && W0.mag !== 0 && d <= D.maxEngage) {
          // 카운터 스트레이프: 쏘기 전에 멈춘다(이동 탄퍼짐 제거)
          if (wpn.preStop < 0) { wpn.preStop = clock; wpn.burstStop = d > 12 ? rng() < D.counterStrafe : rng() < D.counterStrafe * 0.4; }
          if (wpn.burstStop && speed > 1.0 && clock - wpn.preStop < 0.3) { /* 멈추는 중 */ }
          else {
          wpn.preStop = -1;
          let n = Math.round(rand(D.burst[0], D.burst[1]));
          if (d < 10) n += 3; else if (d > 40) n = Math.max(2, n - 2);
          wpn.burstEnd = clock + n * W.dwt47.interval - 0.02;
          aim.head = rng() < D.headshot;
          fire = true;
          }
        } else if (wpn.preStop >= 0 && !(ready && err < tol * 1.5)) wpn.preStop = -1;
        if (fire) { stats.shots += dt / W.dwt47.interval; wpn.estMag[1] = Math.max(0, (wpn.estMag[1] ?? 30) - dt / W.dwt47.interval); recoilShot(W.dwt47, dt / W.dwt47.interval); }
      } else if (active === 'sof9' && curSlot === 2) {
        if (ready && clock >= wpn.nextTap && err < tol * 1.1 && W0.mag !== 0 && !wpn.prevFire && d < 40) {
          fire = true; wpn.nextTap = clock + Math.max(W.sof9.interval + 0.01, D.pistolGap * rand(0.85, 1.3));
          aim.head = rng() < D.headshot; stats.shots++; recoilShot(W.sof9, 1);
          wpn.estMag[2] = Math.max(0, (wpn.estMag[2] ?? 12) - 1);
        }
      } else if (active === 'hawser' && curSlot === 3) {
        if (ready && d < W.hawser.range + 0.2) fire = !wpn.prevFire;
        // 칼: 다가간다
        if (d > 1.2) { const dx = tp.x - pos.x, dz = tp.z - pos.z, l = hyp2(dx, dz) || 1; mv.x = dx / l; mv.z = dz / l; mv.on = true; mv.stop = false; }
      }
      // 빈 탄창
      if (W0.mag === 0 && (curSlot === 1 || curSlot === 2) && !W0.reloading && wpn.wantSlot === curSlot && (W0.reserve === null || W0.reserve > 0)) pressReload(out);
    } else {
      // 비교전: 줌 해제, 주무기로, 틈나면 재장전
      wpn.burstEnd = -1; wpn.zoomStart = -1;
      if (curSlot !== 1 && clock - (mem.size ? latestSeen() : -99) > 1.5) wpn.wantSlot = 1;
      else if (curSlot === 1) wpn.wantSlot = 1;
      const info = W[active];
      if (info && info.mag && W0.mag !== null && !W0.reloading && curSlot === wpn.wantSlot && drawn) {
        const quiet = clock - latestSeen() > 1.5;
        const frac = W0.mag / info.mag;
        if ((W0.mag === 0 || (quiet && frac < (isSniper ? 0.61 : 0.5))) && (W0.reserve === null || W0.reserve > 0) && clock >= wpn.boltUntil) pressReload(out);
      }
      // 저격수 대기 중: 가끔 줌으로 살펴보기
      if (isSniper && curSlot === 1 && plan.holdSpot && clock < plan.holdUntil && clock >= wpn.boltUntil && !W0.reloading && mode === 'patrol') {
        zoom = ((clock * 0.37 + (hashStr(String(id)) % 7)) % 3) > 1.7;
      }
    }
    out.fire = fire;
    out.zoom = zoom;
    out.slot = wpn.wantSlot !== curSlot ? wpn.wantSlot : null;
    if (out.slot) { wpn.burstEnd = -1; wpn.zoomStart = -1; out.fire = false; out.zoom = false; }
    wpn.prevFire = out.fire;
  }
  function pressReload(out) {
    if (clock < wpn.reloadUntil) return;
    out.reload = true;
    const info = W[slotWeapon(curSlot)];
    wpn.reloadUntil = clock + (info && info.reload ? info.reload + 0.1 : 2);
    if (curSlot === 1 || curSlot === 2) setTimeoutMag(curSlot, info);
  }
  function setTimeoutMag(slot, info) { wpn.pendingReload = { slot, at: wpn.reloadUntil, size: info ? info.mag : 0 }; }
  function latestSeen() { let t = -99; for (const m of mem.values()) if (m.seenAt > t) t = m.seenAt; return t; }

  /* ---------------- 공개 API ---------------- */
  const brain = {
    id, team, difficulty, primary,
    role: isSniper ? 'sniper' : 'rifle',
    stats,
    /** 매 프레임 호출 → 입력 */
    think(dt, v) {
      const out = think(dt, v);
      // 내부 탄 추정(엔진이 ammo를 안 줄 때만 쓰임): 재장전 완료 처리
      const pr = wpn.pendingReload;
      if (pr && clock >= pr.at) { wpn.estMag[pr.slot] = pr.size; wpn.pendingReload = null; }
      return out;
    },
    /** 총소리(사격 이벤트 위치). info: { team?, id? } — 아군·자기 소리는 무시 */
    hearShot(p, info) {
      if (!alive || !p) return;
      const q = rv(p);
      if (info && info.id != null && String(info.id) === String(id)) return;
      if (info && info.team != null && info.team === team) return;
      if (hyp2(q.x - pos.x, q.z - pos.z) < 1.5) return;
      for (const a of alliesKnown) if (hyp2(a.x - q.x, a.z - q.z) < 2.5 && Math.abs(a.y - q.y) < 2.5) return;
      const range = info && isNum(info.range) ? info.range : D.hearRange;
      if (Math.hypot(q.x - pos.x, q.y - pos.y, q.z - pos.z) > range) return;
      sounds.push({ x: q.x, y: q.y, z: q.z, t: clock });
      if (sounds.length > 6) sounds.shift();
    },
    /** 피격 알림(선택). from이 있으면 그쪽을 돌아본다(화면 피격 방향 표시와 같은 정보) */
    onDamage(info) {
      if (!alive) return;
      damagedAt = clock;
      const f = info && (info.from || info.pos);
      if (f) {
        const q = rv(f);
        if (!pickTarget()) alert = { x: q.x, y: q.y + 1.2, z: q.z, until: clock + 1.6 };
        sounds.push({ x: q.x, y: q.y, z: q.z, t: clock });
      }
    },
    /** 라운드 시작 등에서 기억·계획 초기화 */
    reset() { resetRound(); alive = false; haveLast = false; },
    /** 디버그·HUD용 상태 */
    debug() {
      return {
        mode, target: targetId, hp, lane: plan.lane, slot: curSlot, wantSlot: wpn.wantSlot,
        goal: P.goal, path: P.pts ? P.pts.slice(P.idx).map((p) => ({ x: p.x, y: p.y, z: p.z })) : null,
        memory: [...mem.values()].map((m) => ({ id: m.id, visible: m.visible, age: +(clock - m.seenAt).toFixed(2), pos: { ...m.pos } })),
        sounds: sounds.length, stuckLevel: stk.level, holding: !!(plan.holdSpot && clock < plan.holdUntil), losCalls
      };
    },
    dispose() { mem.clear(); sounds.length = 0; clearPath(); view = null; nav = null; }
  };
  return brain;
}

export default createBot;
