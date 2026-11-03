/**
 * ⚓ 항만 작전(Port Ops) — 무기 상태 머신 (weapons 담당)
 *
 * three.js·엔진·DOM 비의존 순수 모듈. 매 프레임 update(dt, input, motion)을 부르면
 * 이번 프레임에 일어난 일을 이벤트 배열로 돌려준다. 레이캐스트·피해 적용은 엔진이 한다.
 *
 * 각도 규약: 모두 라디안, three.js 카메라 Euler('YXZ')와 같다.
 *   yaw + = 왼쪽으로 돌기(rotation.y),  pitch + = 위로 보기(rotation.x).
 * 자세한 API는 README.md 참고.
 */
import {
  WEAPONS, WEAPON_IDS, PRIMARY_IDS, SLOT_DEFAULTS, DEG, WALK_SPEED, BASE_FOV,
  getDef, zoomFov, vec3, toVec3,
} from './defs.js';

export { damage, getDef, WEAPONS, WEAPON_IDS, PRIMARY_IDS, vec3 } from './defs.js';

const EPS = 1e-9;
const SEMI_BUFFER = 0.1;        // 반자동: 쿨다운이 끝나기 0.1초 전까지 누른 클릭은 기억했다가 쏜다
const MAX_SHOTS_PER_UPDATE = 4; // 긴 프레임에서도 한 번에 너무 많이 쏘지 않게
const MAX_DT = 0.25;
const CROUCH_SPREAD = 0.8;      // 앉아 있으면 탄퍼짐 ×0.8 (core consts.CROUCH_SPREAD_MUL와 같은 값)

/** serialize().s 값 목록 */
export const STATES = Object.freeze(['idle', 'draw', 'reload', 'bolt', 'swing', 'prime', 'throw']);

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const approach = (cur, target, rate, dt) => (dt > 0 ? target + (cur - target) * Math.exp(-rate * dt) : cur);
const easeOutQuad = (t) => 1 - (1 - t) * (1 - t);

/**
 * yaw/pitch(라디안, three.js YXZ 규약)를 단위 방향 벡터로(vec3: 배열 겸 {x,y,z}).
 * 오프셋에 쓰면 '카메라 로컬' 방향이 된다(−z가 정면).
 */
export function dirFromYawPitch(yaw, pitch) {
  const cp = Math.cos(pitch);
  return vec3(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);
}

/** 벡터 v([x,y,z] 또는 {x,y,z})를 Euler(pitch, yaw, 0, 'YXZ')로 회전(카메라 로컬 → 월드). */
export function rotateYXZ(v, yaw, pitch) {
  const p = toVec3(v);
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const y1 = p.y * cp - p.z * sp;
  const z1 = p.y * sp + p.z * cp;
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  return vec3(p.x * cy + z1 * sy, y1, -p.x * sy + z1 * cy);
}

/**
 * fire 이벤트의 탄 방향(월드 단위 벡터). 엔진이 시점을 yaw/pitch 숫자로 관리할 때 쓴다.
 * lookYaw/lookPitch = 반동을 더하기 전 플레이어 시점.
 */
export function shotDirection(lookYaw, lookPitch, ev, pellet = 0) {
  const p = (ev && ev.pellets && ev.pellets[pellet]) || ev || { dir: { x: 0, y: 0, z: -1 } };
  const r = (ev && ev.recoil) || { yaw: 0, pitch: 0 };
  return rotateYXZ(p.dir || dirFromYawPitch(p.yaw || 0, p.pitch || 0), lookYaw + r.yaw, lookPitch + r.pitch);
}

/**
 * 방장(host)용 간단 검증: 거리와 연사 간격만 본다.
 * @param {string} weaponId
 * @param {{dist?:number, interval?:number, kind?:string, tolerance?:number}} info
 *   interval = 같은 사수의 직전 사격(또는 타격)과의 시간 차(초). tolerance = 간격 허용 비율(기본 0.6).
 * @returns {{ok:boolean, reason?:'weapon'|'range'|'rate'}}
 */
export function validateHit(weaponId, info = {}) {
  const d = getDef(weaponId);
  if (!d) return { ok: false, reason: 'weapon' };
  const dist = Number.isFinite(info.dist) ? info.dist : 0;
  const interval = Number.isFinite(info.interval) ? info.interval : Infinity;
  const tol = Number.isFinite(info.tolerance) ? info.tolerance : 0.6;
  if (d.melee) {
    const m = d.melee[info.kind === 'stab' ? 'stab' : 'slash'];
    if (dist > m.range + 1.2) return { ok: false, reason: 'range' };  // 지연 보간 여유
    const minCd = Math.min(d.melee.slash.cooldown, d.melee.stab.cooldown);
    if (interval < minCd * tol) return { ok: false, reason: 'rate' };
    return { ok: true };
  }
  if (d.explosion) return dist <= d.explosion.radius + 0.5 ? { ok: true } : { ok: false, reason: 'range' };
  if (dist > d.maxRange) return { ok: false, reason: 'range' };
  if (interval < d.fireInterval * tol) return { ok: false, reason: 'rate' };
  return { ok: true };
}

/**
 * 플레이어 한 명의 무기 세트.
 * @param {object} [opts]
 * @param {'nor1'|'dwt47'} [opts.primary='dwt47']  슬롯 1 주무기
 * @param {'hold'|'toggle'} [opts.zoomMode='hold'] 우클릭 줌 방식
 * @param {() => number} [opts.rng=Math.random]     탄퍼짐 난수(테스트에서 고정 가능)
 * @param {number} [opts.walkSpeed=5.2]            이동 탄퍼짐 기준 속도
 * @param {boolean} [opts.draw=false]              true면 첫 무기를 꺼내는 동작부터 시작
 */
export function createArsenal(opts = {}) {
  const rng = typeof opts.rng === 'function' ? opts.rng : Math.random;
  const walkSpeed = opts.walkSpeed > 0 ? +opts.walkSpeed : WALK_SPEED;
  let zoomMode = opts.zoomMode === 'toggle' ? 'toggle' : 'hold';
  let primaryId = PRIMARY_IDS.includes(opts.primary) ? opts.primary : 'dwt47';

  const fresh = (id) => {
    const d = WEAPONS[id];
    return {
      mag: d.mag ?? null, reserve: d.reserve ?? null, count: d.count ?? null,
      nextFireAt: 0, lastShotAt: -1e9, boltUntil: 0, bloom: 0, shotIndex: 0, swingIndex: 0,
    };
  };
  const inv = Object.create(null);
  for (const id of WEAPON_IDS) inv[id] = fresh(id);

  let time = 0;
  let cur = primaryId;
  let prev = SLOT_DEFAULTS[2];
  let state = 'idle', stateT = 0, stateDur = 0;
  let swing = null;   // { kind, windup, hit, index }
  let prime = null;   // { kind, released }
  let reloadQueued = false;
  let reloadEmpty = false;
  let semiAt = -1e9;

  let zoomP = 0, zoomTarget = 0, zoomToggleOn = false, zoomLatch = false;
  let moveF = 0, airF = 0;
  const motion = { speed: 0, onGround: true, walking: false, crouch: false };
  const recoil = { yaw: 0, pitch: 0 };
  let recoilCfg = null, lastShotAt = -1e9;

  let prevFire = false, prevZoom = false, prevToggle = false;
  let queue = [];

  const def = () => WEAPONS[cur];
  const wst = () => inv[cur];
  const slotWeapon = (slot) => (slot === 1 ? primaryId : SLOT_DEFAULTS[slot] || null);

  function emit(type, data) {
    const ev = { type, weaponId: cur, t: time };
    if (data) Object.assign(ev, data);
    queue.push(ev);
  }
  function setState(s, dur = 0) { state = s; stateT = 0; stateDur = dur; }
  function available(id) {
    const d = getDef(id);
    if (!d) return false;
    if (d.count != null) return inv[id].count > 0;
    return true;
  }
  function bolting(id = cur) { return WEAPONS[id].fire === 'bolt' && time + EPS < inv[id].boltUntil; }
  function publicState() { return state === 'idle' && bolting() ? 'bolt' : state; }

  /** 조준 계수 0~1. 저격은 반샷 경계(accurateAt)에서 0→1로 끊긴다. */
  function aimFactor(d = def()) {
    const z = d.zoom;
    if (!z) return 0;
    if (z.accurateAt != null) return zoomP + 1e-6 >= z.accurateAt ? 1 : 0;
    return zoomP;
  }

  function spreadDeg(d = def(), w = wst()) {
    const s = d.spread;
    if (!s) return 0;
    const a = aimFactor(d);
    const base = lerp(s.hip, s.ads ?? s.hip, a);
    const mv = lerp(s.move ?? 0, s.adsMove ?? s.move ?? 0, a) * moveF;
    const air = lerp(s.air ?? 0, s.adsAir ?? s.air ?? 0, a) * airF;
    const bloom = (w.bloom || 0) * lerp(1, s.adsBloomMul ?? 1, a);
    return clamp((base + mv + air + bloom) * (motion.crouch ? CROUCH_SPREAD : 1), 0, s.max ?? 45);
  }

  // ── 입력 정규화 ───────────────────────────────────────────────
  function normInput(i) {
    i = i || {};
    const fireDown = !!i.fireDown;
    const zoomDown = !!i.zoomDown;
    const firePressed = i.firePressed === undefined ? fireDown && !prevFire : !!i.firePressed;
    const zoomPressed = zoomDown && !prevZoom;
    const zoomToggleRaw = !!i.zoomToggle;
    // zoomToggle은 '이번 프레임에 눌림' 신호. 계속 true로 와도 처음 한 번만 센다.
    const zoomTogglePressed = i.zoomToggle === undefined ? zoomPressed : zoomToggleRaw && !prevToggle;
    let slot = i.slot == null || i.slot === false ? null : Number(i.slot);
    if (!(Number.isInteger(slot) && slot >= 1 && slot <= 4)) slot = null;
    const wheelN = Number(i.wheel);
    const wheel = Number.isFinite(wheelN) ? Math.sign(wheelN) : 0;
    return { fireDown, firePressed, zoomDown, zoomPressed, zoomToggleRaw, zoomTogglePressed,
      reloadPressed: !!i.reloadPressed, slot, wheel };
  }

  function readMotion(m, dt) {
    m = m || {};
    const speed = Number.isFinite(m.speed) ? Math.max(0, m.speed) : 0;
    motion.speed = speed;
    motion.onGround = m.onGround !== false;
    motion.walking = !!m.walking;
    motion.crouch = !!m.crouch;
    let target = clamp((speed - 0.25) / Math.max(0.1, walkSpeed - 0.25), 0, 1.5);
    if (motion.walking) target *= 0.5;
    moveF = approach(moveF, target, 14, dt);
    airF = approach(airF, motion.onGround ? 0 : 1, motion.onGround ? 10 : 20, dt);
  }

  // ── 반동·탄퍼짐 회복 ───────────────────────────────────────────
  function recover(dt) {
    if (recoilCfg && time - lastShotAt > recoilCfg.recoverDelay) {
      const k = Math.exp(-recoilCfg.recoverRate * dt);
      recoil.yaw *= k;
      recoil.pitch *= k;
      if (Math.abs(recoil.yaw) < 1e-6) recoil.yaw = 0;
      if (Math.abs(recoil.pitch) < 1e-6) recoil.pitch = 0;
    }
    for (const id of WEAPON_IDS) {
      const d = WEAPONS[id], w = inv[id];
      const delay = d.recoil ? d.recoil.recoverDelay : 0.1;
      if (time - w.lastShotAt <= delay) continue;
      if (d.recoil && w.shotIndex > 0) w.shotIndex = Math.max(0, w.shotIndex - dt * (d.recoil.patternRecover ?? 20));
      if (d.spread && w.bloom > 0) w.bloom = Math.max(0, w.bloom - dt * (d.spread.bloomDecay ?? 5));
    }
  }

  function kickRecoil(d, w, a) {
    const r = d.recoil;
    if (!r || !r.pattern || !r.pattern.length) return { yaw: 0, pitch: 0 };
    const pat = r.pattern, n = pat.length;
    let i = Math.floor(w.shotIndex + EPS);
    if (i >= n) {
      const lf = clamp(r.loopFrom ?? n - 1, 0, n - 1);
      i = lf + ((i - lf) % (n - lf));
    }
    const mul = lerp(1, r.adsMul ?? 1, a);
    const kYaw = -pat[i][0] * DEG * mul;   // 패턴 x(오른쪽 +) → yaw는 왼쪽이 +
    const kPitch = pat[i][1] * DEG * mul;
    recoil.yaw = clamp(recoil.yaw + kYaw, -r.maxYaw * DEG, r.maxYaw * DEG);
    recoil.pitch = clamp(recoil.pitch + kPitch, -r.maxPitch * DEG, r.maxPitch * DEG);
    recoilCfg = r;
    w.shotIndex = Math.floor(w.shotIndex + EPS) + 1;
    return { yaw: kYaw, pitch: kPitch };
  }

  // ── 줌 ────────────────────────────────────────────────────────
  function dropZoom(instant) {
    if (zoomTarget) { zoomTarget = 0; emit('zoomChange', { zoomed: false }); }
    zoomToggleOn = false;
    zoomLatch = false;
    if (instant) zoomP = 0;
  }

  function updateZoom(dt, inp) {
    const z = def().zoom;
    if (!z) { zoomP = 0; zoomTarget = 0; return; }
    let want;
    if (zoomMode === 'hold') {
      if (!inp.zoomDown) zoomLatch = false;   // 저격 사격 후 줌은 버튼을 뗐다가 다시 눌러야 한다
      want = inp.zoomDown && !zoomLatch;
    } else {
      if (inp.zoomTogglePressed) zoomToggleOn = !zoomToggleOn;
      want = zoomToggleOn;
    }
    const can = state === 'idle' && !bolting();
    const target = want && can ? 1 : 0;
    if (target !== zoomTarget) { zoomTarget = target; emit('zoomChange', { zoomed: target === 1 }); }
    zoomP = target ? Math.min(1, zoomP + dt / z.inTime) : Math.max(0, zoomP - dt / z.outTime);
  }

  // ── 무기 교체 ──────────────────────────────────────────────────
  function cancelAction() {
    if (state === 'reload') emit('reloadCancel', {});
    else if (state === 'prime') emit('primeCancel', { kind: prime ? prime.kind : null });
    else if (state === 'swing' && swing && !swing.hit) emit('swingCancel', { kind: swing.kind });
    swing = null;
    prime = null;
  }

  function switchTo(id) {
    if (!getDef(id) || !available(id) || state === 'throw' || id === cur) return false;
    cancelAction();
    dropZoom(true);
    const from = cur;
    prev = from;
    cur = id;
    reloadQueued = false;
    semiAt = -1e9;
    setState('draw', WEAPONS[id].drawTime);
    emit('switch', { from, to: id, slot: WEAPONS[id].slot, drawTime: WEAPONS[id].drawTime });
    return true;
  }

  function cycleTarget(dir) {
    const list = [1, 2, 3, 4].map(slotWeapon).filter((id) => id && available(id));
    if (list.length < 2) return null;
    const i = list.indexOf(cur);
    if (i < 0) {
      const s = WEAPONS[cur].slot;
      let j = list.findIndex((id) => WEAPONS[id].slot > s);
      if (j < 0) j = 0;
      return dir > 0 ? list[j] : list[(j - 1 + list.length) % list.length];
    }
    return list[(i + dir + list.length) % list.length];
  }

  function handleSwitch(inp) {
    if (state === 'throw') return;
    let target = null;
    if (inp.slot) {
      const id = slotWeapon(inp.slot);
      if (id && id !== cur && available(id)) target = id;
    } else if (inp.wheel) {
      target = cycleTarget(inp.wheel);
    }
    if (target && target !== cur) switchTo(target);
  }

  // ── 상태 타이머 ────────────────────────────────────────────────
  function advance(dt, inp) {
    stateT += dt;
    const d = def();
    switch (state) {
      case 'draw':
        if (stateT + EPS >= stateDur) setState('idle');
        break;
      case 'reload':
        if (stateT + EPS >= stateDur) finishReload();
        break;
      case 'swing': {
        if (swing && !swing.hit && stateT + EPS >= swing.windup) {
          swing.hit = true;
          const m = d.melee[swing.kind];
          emit('melee', { kind: swing.kind, damage: m.damage, range: m.range, arc: m.arc * DEG, index: swing.index });
        }
        if (stateT + EPS >= stateDur) { swing = null; setState('idle'); }
        break;
      }
      case 'prime': {
        if (!prime) { setState('idle'); break; }
        const held = prime.kind === 'underhand' ? inp.zoomDown : inp.fireDown;
        if (!held) prime.released = true;
        if (prime.released && stateT + EPS >= d.primeTime) doThrow();
        break;
      }
      case 'throw':
        if (stateT + EPS >= stateDur) finishThrow();
        break;
      default:
        break;
    }
  }

  // ── 재장전 ────────────────────────────────────────────────────
  function startReload() {
    const d = def(), w = wst();
    reloadEmpty = w.mag === 0;
    const dur = reloadEmpty && d.reloadEmpty ? d.reloadEmpty : d.reload;
    reloadQueued = false;
    if (zoomTarget) { zoomTarget = 0; emit('zoomChange', { zoomed: false }); }
    zoomToggleOn = false;
    setState('reload', dur);
    emit('reloadStart', { duration: dur, empty: reloadEmpty, mag: w.mag, reserve: w.reserve });
  }

  function finishReload() {
    const d = def(), w = wst();
    const take = Math.min(d.mag - w.mag, w.reserve);
    w.mag += take;
    w.reserve -= take;
    setState('idle');
    emit('reloadEnd', { mag: w.mag, reserve: w.reserve });
  }

  function handleReload(inp) {
    const d = def(), w = wst();
    if (d.mag == null) { reloadQueued = false; return; }
    if (inp.reloadPressed) reloadQueued = true;
    if (w.mag >= d.mag || w.reserve <= 0) { reloadQueued = false; return; }
    if (!reloadQueued && w.mag !== 0) return;        // 탄창이 비면 자동 재장전
    if (state !== 'idle' || bolting() || time + EPS < w.nextFireAt) return;
    startReload();
  }

  // ── 사격 ─────────────────────────────────────────────────────
  function shoot() {
    const d = def(), w = wst();
    const a = aimFactor(d);
    const sd = spreadDeg(d, w);
    const sr = sd * DEG;
    const pellets = [];
    const count = Math.max(1, d.pellets | 0);
    for (let i = 0; i < count; i++) {
      const r = sr * rng();                  // 가운데로 몰리는 분포(원뿔 안)
      const th = rng() * Math.PI * 2;
      const yaw = r * Math.cos(th), pitch = r * Math.sin(th);
      pellets.push({ yaw, pitch, dir: dirFromYawPitch(yaw, pitch) });
    }
    const recoilAtShot = { yaw: recoil.yaw, pitch: recoil.pitch };
    w.mag -= 1;
    w.lastShotAt = time;
    lastShotAt = time;
    const shotIndex = Math.floor(w.shotIndex + EPS);
    const kick = kickRecoil(d, w, a);
    if (d.spread && d.spread.bloomPerShot) w.bloom = Math.min(d.spread.bloomMax ?? Infinity, w.bloom + d.spread.bloomPerShot);
    if (d.fire !== 'auto') w.nextFireAt = time + d.fireInterval;
    const isScope = !!(d.zoom && d.zoom.accurateAt != null);
    const scoped = d.zoom ? (isScope ? a >= 1 : zoomP >= 0.5) : false;
    const p0 = pellets[0];
    emit('fire', {
      slot: d.slot, yaw: p0.yaw, pitch: p0.pitch, dir: p0.dir, pellets,
      spread: sr, spreadDeg: sd, aim: a, zoom: zoomP, scoped,
      quickscope: isScope && scoped && zoomP < 1, noscope: isScope && !scoped,
      recoil: recoilAtShot, kick, shotIndex,
      mag: w.mag, reserve: w.reserve, maxRange: d.maxRange,
    });
    if (d.fire === 'bolt') {
      if (d.zoom && d.zoom.unzoomOnFire) {
        if (zoomTarget) { zoomTarget = 0; emit('zoomChange', { zoomed: false }); }
        zoomToggleOn = false;
        zoomLatch = zoomMode === 'hold';
      }
      if (w.mag > 0) {
        w.boltUntil = time + d.bolt;
        w.nextFireAt = w.boltUntil;
        emit('boltCycle', { duration: d.bolt });
      } else {
        w.boltUntil = 0;
        w.nextFireAt = time + (d.emptyShotRecover ?? 0.3);
      }
    }
  }

  function tryShoot(inp) {
    const w = wst();
    if (state !== 'idle' || bolting() || time + EPS < w.nextFireAt) return 'busy';
    if (w.mag <= 0) {
      if (w.reserve > 0) { reloadQueued = true; return 'reload'; }
      if (inp.firePressed) emit('dryFire', {});
      return 'dry';
    }
    shoot();
    return 'fired';
  }

  function fireAuto(inp, dt) {
    const d = def(), w = wst();
    if (state !== 'idle') return;
    if (w.mag <= 0) {
      if (inp.firePressed && w.reserve <= 0) emit('dryFire', {});
      return;
    }
    let n = 0;
    while (w.mag > 0 && time + EPS >= w.nextFireAt && n < MAX_SHOTS_PER_UPDATE) {
      // 계속 누르고 있었다면 예약 시각 기준으로 박자를 유지, 새로 눌렀다면 지금부터
      const continuous = (n > 0 || prevFire) && w.nextFireAt >= time - dt - EPS;
      const base = continuous ? w.nextFireAt : time;
      shoot();
      w.nextFireAt = base + d.fireInterval;
      n++;
      if (state !== 'idle') break;
    }
  }

  function tryMelee(inp) {
    const d = def(), w = wst();
    if (state !== 'idle' || time + EPS < w.nextFireAt) return;
    let kind = null;
    if (inp.fireDown || inp.firePressed) kind = 'slash';
    else if (inp.zoomDown || inp.zoomTogglePressed) kind = 'stab';
    if (!kind) return;
    const m = d.melee[kind];
    swing = { kind, windup: m.windup, hit: false, index: w.swingIndex++ };
    w.nextFireAt = time + m.cooldown;
    w.lastShotAt = time;
    setState('swing', m.cooldown);
    emit('swing', { kind, duration: m.cooldown, windup: m.windup, index: swing.index, damage: m.damage, range: m.range });
  }

  function tryPrime(inp) {
    const d = def(), w = wst();
    if (state !== 'idle' || !(w.count > 0)) return;
    let kind = null;
    if (inp.firePressed) kind = 'overhand';
    else if (inp.zoomPressed || inp.zoomTogglePressed) kind = 'underhand';
    if (!kind) return;
    const held = kind === 'overhand' ? inp.fireDown : inp.zoomDown;
    prime = { kind, released: !held };
    setState('prime', Infinity);
    emit('prime', { kind, primeTime: d.primeTime });
  }

  function doThrow() {
    const d = def(), w = wst();
    const kind = prime.kind;
    const t = kind === 'underhand' ? d.lob : d.throw;
    w.count = Math.max(0, w.count - 1);
    w.lastShotAt = time;
    prime = null;
    setState('throw', d.throwRecover);
    emit('throw', { kind, speed: t.speed, pitchUp: t.pitchUp * DEG, fuse: d.fuse, count: w.count });
  }

  function finishThrow() {
    setState('idle');
    if (available(cur)) {           // 여러 개를 들 수 있게 바뀌면 다시 꺼낸다
      setState('draw', def().drawTime);
      emit('switch', { from: cur, to: cur, slot: def().slot, drawTime: def().drawTime });
      return;
    }
    let back = prev && prev !== cur && available(prev) ? prev : null;
    if (!back) back = [primaryId, SLOT_DEFAULTS[2], SLOT_DEFAULTS[3]].find(available);
    switchTo(back);
  }

  function handleAttack(inp, dt) {
    const d = def();
    switch (d.fire) {
      case 'auto':
        if (inp.fireDown || inp.firePressed) fireAuto(inp, dt);
        break;
      case 'semi': {
        if (inp.firePressed) semiAt = time;
        if (time - semiAt <= SEMI_BUFFER + EPS) {
          if (tryShoot(inp) !== 'busy') semiAt = -1e9;
        }
        break;
      }
      case 'bolt':
        if (inp.firePressed) tryShoot(inp);
        break;
      case 'melee':
        tryMelee(inp);
        break;
      case 'throw':
        tryPrime(inp);
        break;
      default:
        break;
    }
  }

  // ── 공개 API ─────────────────────────────────────────────────
  /**
   * 한 프레임 진행.
   * @param {number} dt 초
   * @param {{fireDown?:boolean, firePressed?:boolean, zoomDown?:boolean, zoomToggle?:boolean,
   *          reloadPressed?:boolean, slot?:number|null, wheel?:number}} input
   * @param {{speed?:number, onGround?:boolean, walking?:boolean, crouch?:boolean}} motion  speed = 수평 속력(m/s), crouch = 앉음(탄퍼짐 ×0.8)
   * @returns {object[]} 이벤트 배열(새 배열)
   */
  function update(dt, input, motionIn) {
    dt = Number.isFinite(dt) ? clamp(dt, 0, MAX_DT) : 0;
    time += dt;
    const inp = normInput(input);
    readMotion(motionIn, dt);
    recover(dt);
    advance(dt, inp);
    handleSwitch(inp);
    updateZoom(dt, inp);
    handleReload(inp);
    handleAttack(inp, dt);
    prevFire = inp.fireDown;
    prevZoom = inp.zoomDown;
    prevToggle = inp.zoomToggleRaw;
    const out = queue;
    queue = [];
    return out;
  }

  function getZoom(baseFov = BASE_FOV) {
    const z = def().zoom;
    const base = Number.isFinite(baseFov) && baseFov > 0 ? baseFov : BASE_FOV;
    if (!z) {
      return { progress: 0, target: 0, zoomed: false, mag: 1, curMag: 1, fov: base, targetFov: base,
        overlay: null, scopeAmount: 0, hideViewmodel: false, accurate: false };
    }
    const curMag = lerp(1, z.mag, easeOutQuad(zoomP));
    return {
      progress: zoomP, target: zoomTarget, zoomed: zoomTarget === 1,
      mag: z.mag, curMag, fov: zoomFov(base, curMag), targetFov: zoomFov(base, z.mag),
      overlay: z.overlay || null,
      // 스코프 오버레이 불투명도: 0.55부터 나타나 0.9(모형이 숨는 시점)에 완전히 덮는다
      scopeAmount: z.overlay === 'scope' ? clamp((zoomP - 0.55) / 0.35, 0, 1) : 0,
      hideViewmodel: !!z.overlay && z.hideViewmodelAt != null && zoomP > z.hideViewmodelAt,
      accurate: z.accurateAt != null ? aimFactor() >= 1 : zoomP >= 1,
    };
  }

  function getSpread() {
    const deg = spreadDeg();
    const d = def();
    return { rad: deg * DEG, deg, accurate: !!(d.spread && d.zoom && d.zoom.accurateAt != null && aimFactor(d) >= 1) };
  }

  function getAmmo(id = cur) {
    const d = getDef(id);
    if (!d) return null;
    const w = inv[id];
    if (d.count != null) return { weaponId: id, kind: 'count', mag: w.count, magSize: d.count, reserve: 0, infinite: false, reloading: false };
    if (d.mag == null) return { weaponId: id, kind: 'none', mag: null, magSize: null, reserve: null, infinite: true, reloading: false };
    return { weaponId: id, kind: 'mag', mag: w.mag, magSize: d.mag, reserve: w.reserve, infinite: false,
      reloading: id === cur && state === 'reload' };
  }

  function stateProgress() {
    return stateDur > 0 && Number.isFinite(stateDur) ? clamp(stateT / stateDur, 0, 1) : 0;
  }

  function getWeapon() {
    const d = def();
    let progress = stateProgress();
    const s = publicState();
    if (s === 'bolt') progress = clamp(1 - (inv[cur].boltUntil - time) / d.bolt, 0, 1);
    return { id: cur, slot: d.slot, name: d.name, nameEn: d.nameEn, short: d.short, def: d,
      state: s, progress, elapsed: stateT, duration: Number.isFinite(stateDur) ? stateDur : 0, previous: prev };
  }

  function getSlots() {
    return [1, 2, 3, 4].map((slot) => {
      const id = slotWeapon(slot);
      const d = WEAPONS[id];
      return { slot, id, name: d.name, short: d.short, icon: d.icon, empty: !available(id), active: id === cur };
    });
  }

  function getMoveMul() {
    const d = def();
    return d.moveMul * (d.zoom ? lerp(1, d.zoom.moveMul ?? 1, zoomP) : 1);
  }

  /** viewmodel.update(dt, state)에 그대로 넘기는 표시용 상태 */
  function getViewState(baseFov) {
    const d = def(), w = wst();
    const z = getZoom(baseFov);
    const s = publicState();
    return {
      weaponId: cur, phase: s, phaseT: s === 'bolt' ? getWeapon().progress : stateProgress(),
      phaseDur: Number.isFinite(stateDur) ? stateDur : 0,
      zoom: zoomP, curMag: z.curMag, overlay: z.overlay, hideViewmodel: z.hideViewmodel, aim: aimFactor(d),
      speed: motion.speed, onGround: motion.onGround, walking: motion.walking,
      mag: w.mag, count: w.count, reloadEmpty: state === 'reload' && reloadEmpty,
      swingKind: swing ? swing.kind : null, primeKind: prime ? prime.kind : null,
    };
  }

  /** UI hud.set()에 그대로 넣는 값(ammo·reserve·mag·reloading·reload·slots·slot·spread·fov·crosshair) */
  function getHud(baseFov) {
    const d = def();
    const a = getAmmo();
    const z = getZoom(baseFov);
    return {
      ammo: a.kind === 'none' ? null : a.mag,
      reserve: a.kind === 'mag' ? a.reserve : null,
      mag: a.kind === 'none' ? null : a.magSize,
      reloading: state === 'reload',
      reload: state === 'reload' ? stateProgress() : null,
      slots: [1, 2, 3, 4].map((s) => { const id = slotWeapon(s); return id && available(id) ? id : null; }),
      slot: d.slot,
      spread: getSpread().rad,
      fov: z.fov,
      crosshair: !(d.zoom && zoomP > 0.5),
    };
  }

  function resetRound(o = {}) {
    if (o.primary && PRIMARY_IDS.includes(o.primary)) primaryId = o.primary;
    for (const id of WEAPON_IDS) inv[id] = fresh(id);
    recoil.yaw = 0; recoil.pitch = 0; recoilCfg = null; lastShotAt = -1e9;
    zoomP = 0; zoomTarget = 0; zoomToggleOn = false; zoomLatch = false;
    swing = null; prime = null; reloadQueued = false; semiAt = -1e9;
    moveF = 0; airF = 0;
    const from = cur;
    cur = primaryId;
    prev = SLOT_DEFAULTS[2];
    const drawDur = o.draw ? def().drawTime : 0;
    setState(o.draw ? 'draw' : 'idle', drawDur);
    emit('switch', { from, to: cur, slot: 1, drawTime: drawDur, reset: true });
  }

  if (opts.draw) {
    setState('draw', def().drawTime);
    emit('switch', { from: null, to: cur, slot: 1, drawTime: def().drawTime });
  }

  function setPrimary(id) {
    if (!PRIMARY_IDS.includes(id)) return false;
    if (id === primaryId) return true;
    const old = primaryId;
    primaryId = id;
    inv[id] = fresh(id);
    if (prev === old) prev = id;
    if (cur === old) {
      cancelAction();
      dropZoom(true);
      cur = id;
      setState('draw', def().drawTime);
      emit('switch', { from: old, to: id, slot: 1, drawTime: def().drawTime });
    }
    return true;
  }

  return {
    update,
    getZoom,
    getSpread,
    /** 카메라에 '더할' 반동 오프셋(누적값, 라디안). 매 프레임 내 각도에 누적하지 말 것. */
    getRecoilKick: () => ({ yaw: recoil.yaw, pitch: recoil.pitch }),
    getAmmo,
    getWeapon,
    getSlots,
    getMoveMul,
    getViewState,
    getHud,
    /** 네트워크 표시용 최소 상태 { w: 무기 id, s: 상태, z: 줌 0|1 } */
    serialize: () => ({ w: cur, s: publicState(), z: zoomTarget ? 1 : 0 }),
    /** 슬롯 번호(1~4) 또는 무기 id로 교체. 이벤트는 다음 update()에서 나온다. */
    select: (slotOrId) => switchTo(typeof slotOrId === 'number' ? slotWeapon(slotOrId) : slotOrId),
    setPrimary,
    getPrimary: () => primaryId,
    setZoomMode: (m) => { zoomMode = m === 'toggle' ? 'toggle' : 'hold'; zoomToggleOn = false; zoomLatch = false; },
    getZoomMode: () => zoomMode,
    resetRound,
    giveGrenade: (n = 1) => {
      const max = WEAPONS.bunker.count;
      inv.bunker.count = clamp((inv.bunker.count || 0) + (n | 0), 0, max);
      return inv.bunker.count;
    },
    getTime: () => time,
    dispose: () => { queue = []; },
  };
}
