/**
 * ⚓ Port Ops — 로컬 플레이어
 *
 *   const player = createLocalPlayer({ bus, input, camera, getWorld: () => map && map.world });
 *   player.state            // PlayerState (아래)
 *   player.spawn({ x, y, z, rotY })
 *   player.tick(dt)         // 고정 틱: 입력 → 물리 이동
 *   player.frame(dt, alpha) // 렌더 프레임: 마우스 시점 + 카메라(보간·흔들림)
 *   player.addRecoil(pitchRad, yawRad)  // 조준 자체를 움직이는 반동(무기 담당)
 *   player.kick(pitchRad, yawRad)       // 화면만 튀었다 돌아오는 반동
 *   player.addShake(0..1)               // 폭발 등 화면 흔들림(트라우마)
 *   player.damage(amount, { from, part, weapon, dir }) → { hp, killed }
 *   player.getEye(out?) / player.getAimDir(out?)   // 사격 원점·방향 (카메라 기준, 흔들림 제외)
 *   player.snapshot()       // 네트워크 전송용 작은 객체
 *
 * PlayerState = { id, name, team, pos:[x,y,z](발), vel:[x,y,z], yaw, pitch, onGround, hp, alive,
 *                 slot, weapon, moving, walking, aiming, speedScale, frozen, kills, deaths }
 */
import { PLAYER } from '../core/consts.js';
import { moveCharacter, raycastWorld } from './physics.js';

export function createPlayerState(init = {}) {
  return Object.assign({
    id: 'local',
    name: '',
    team: 'owner',
    pos: [0, 0, 0],
    vel: [0, 0, 0],
    yaw: 0,
    pitch: 0,
    onGround: true,
    hp: PLAYER.HP,
    alive: true,
    slot: 1,
    weapon: null,
    moving: false,
    walking: false,
    aiming: false,
    speedScale: 1,
    frozen: false,
    kills: 0,
    deaths: 0
  }, init);
}

const PITCH_LIMIT = (89 * Math.PI) / 180;

export function createLocalPlayer({ bus, input, camera, getWorld, state: initState } = {}) {
  const state = createPlayerState(initState);
  const prev = [0, 0, 0];
  let jumpBuffer = 0;
  let spawnPoint = { x: 0, y: 0, z: 0, rotY: 0 };
  // 카메라 효과
  let bobPhase = 0, bobAmp = 0;
  let landDip = 0, landVel = 0;
  let stepOffset = 0;
  let trauma = 0, shakeT = 0;
  let kickP = 0, kickY = 0;
  let deathT = 0;
  let stepDist = 0;
  let time = 0;
  const emit = (e, d) => { if (bus) bus.emit(e, d); };
  const offs = [];
  if (bus) offs.push(bus.on('input:jump', () => { jumpBuffer = 0.12; }));
  if (bus) offs.push(bus.on('camera:shake', (e) => addShake((e && e.amount) || 0.3)));
  if (bus) offs.push(bus.on('camera:kick', (e) => kick((e && e.pitch) || 0, (e && e.yaw) || 0)));

  function spawn(sp = {}) {
    spawnPoint = { x: +sp.x || 0, y: +sp.y || 0, z: +sp.z || 0, rotY: +sp.rotY || 0 };
    state.pos[0] = spawnPoint.x; state.pos[1] = spawnPoint.y; state.pos[2] = spawnPoint.z;
    prev[0] = state.pos[0]; prev[1] = state.pos[1]; prev[2] = state.pos[2];
    state.vel[0] = state.vel[1] = state.vel[2] = 0;
    state.yaw = spawnPoint.rotY;
    state.pitch = 0;
    state.onGround = true;
    state.hp = PLAYER.HP;
    state.alive = true;
    state.moving = false;
    landDip = landVel = stepOffset = trauma = kickP = kickY = 0;
    deathT = 0;
    jumpBuffer = 0;
    emit('player:spawn', { state, point: spawnPoint });
  }

  function forward(out = [0, 0, 0]) {
    out[0] = -Math.sin(state.yaw); out[1] = 0; out[2] = -Math.cos(state.yaw);
    return out;
  }

  function groundMat(world) {
    const h = raycastWorld(world, [state.pos[0], state.pos[1] + 0.2, state.pos[2]], [0, -1, 0], 0.6);
    return h ? h.mat : null;
  }

  const wish = { x: 0, z: 0, jump: false };
  function tick(dt) {
    time += dt;
    prev[0] = state.pos[0]; prev[1] = state.pos[1]; prev[2] = state.pos[2];
    if (jumpBuffer > 0) jumpBuffer -= dt;
    const world = getWorld && getWorld();
    if (!world) return;
    const inp = (input && input.state) || {};
    const canMove = state.alive && !state.frozen && (!input || input.enabled !== false);
    let f = 0, s = 0;
    if (canMove) {
      f = (inp.forward ? 1 : 0) - (inp.back ? 1 : 0);
      s = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    }
    const len = Math.hypot(f, s);
    state.walking = !!inp.walk && canMove;
    state.aiming = !!inp.aim && canMove;
    const speed = (state.walking ? PLAYER.SLOW_WALK : PLAYER.WALK) * (state.speedScale || 1);
    if (len > 0) { f /= len; s /= len; }
    const sy = Math.sin(state.yaw), cy = Math.cos(state.yaw);
    // 전방 (-sin, -cos), 오른쪽 (cos, -sin)
    wish.x = (-sy * f + cy * s) * speed;
    wish.z = (-cy * f - sy * s) * speed;
    wish.jump = canMove && jumpBuffer > 0 && state.onGround;
    if (wish.jump) jumpBuffer = 0;

    const wasGround = state.onGround;
    const y0 = state.pos[1];
    const ev = moveCharacter(world, state, wish, dt);
    if (ev.stepUp > 0.05 && wasGround) stepOffset -= state.pos[1] - y0;
    if (ev.jumped) emit('player:jump', { pos: state.pos.slice() });
    if (ev.landed) {
      landVel -= Math.min(2.2, ev.impact * 0.13);
      emit('player:land', { pos: state.pos.slice(), speed: ev.impact, mat: groundMat(world) });
    }
    const hs = Math.hypot(state.vel[0], state.vel[2]);
    state.moving = hs > 0.3;
    if (state.onGround && hs > 0.5) {
      stepDist += hs * dt;
      const stride = state.walking ? 1.5 : 1.95;
      if (stepDist >= stride) {
        stepDist -= stride;
        emit('player:step', { pos: state.pos.slice(), speed: hs, quiet: state.walking, mat: groundMat(world) });
      }
    }
    // 월드 밖으로 떨어지면 마지막 스폰으로
    if (state.pos[1] < -40) {
      emit('player:fell', { pos: state.pos.slice() });
      const keepHp = state.hp;
      spawn(spawnPoint);
      state.hp = keepHp;
    }
  }

  function addRecoil(pitch = 0, yaw = 0) {
    state.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, state.pitch + pitch));
    state.yaw += yaw;
  }
  function kick(pitch = 0, yaw = 0) { kickP += pitch; kickY += yaw; }
  function addShake(amount = 0.3) { trauma = Math.min(1, trauma + amount); }

  function damage(amount, info = {}) {
    if (!state.alive) return { hp: state.hp, killed: false };
    const a = Math.max(0, Math.round(+amount || 0));
    state.hp = Math.max(0, state.hp - a);
    addShake(Math.min(0.5, a / 120));
    emit('player:damage', Object.assign({ amount: a, hp: state.hp }, info));
    if (state.hp <= 0) { kill(info); return { hp: 0, killed: true }; }
    return { hp: state.hp, killed: false };
  }

  function kill(info = {}) {
    if (!state.alive) return;
    state.alive = false;
    state.hp = 0;
    state.deaths++;
    state.vel[0] = state.vel[2] = 0;
    deathT = 0;
    emit('player:death', Object.assign({ id: state.id }, info));
  }

  // 시점 + 카메라
  function noise(t, seed) { return Math.sin(t * 1.0 + seed) * 0.6 + Math.sin(t * 2.3 + seed * 1.7) * 0.3 + Math.sin(t * 5.1 + seed * 0.3) * 0.1; }

  function frame(dt, alpha = 1) {
    if (input && state.alive) {
      const look = input.consumeLook();
      state.yaw -= look.dx;
      state.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, state.pitch - look.dy));
    } else if (input) input.consumeLook();
    if (state.yaw > Math.PI * 4 || state.yaw < -Math.PI * 4) state.yaw %= Math.PI * 2;
    if (!camera) return;

    const x = prev[0] + (state.pos[0] - prev[0]) * alpha;
    const y = prev[1] + (state.pos[1] - prev[1]) * alpha;
    const z = prev[2] + (state.pos[2] - prev[2]) * alpha;

    // 걷기 흔들림
    const hs = Math.hypot(state.vel[0], state.vel[2]);
    const targetAmp = state.onGround && state.alive ? Math.min(1, hs / PLAYER.WALK) * (state.walking ? 0.45 : 1) * (state.aiming ? 0.35 : 1) : 0;
    bobAmp += (targetAmp - bobAmp) * Math.min(1, dt * 8);
    bobPhase += dt * (4 + hs * 1.25);
    const bobY = Math.sin(bobPhase * 2) * 0.03 * bobAmp;
    const bobX = Math.cos(bobPhase) * 0.018 * bobAmp;
    // 착지 출렁임(스프링)
    landVel += (-landDip * 90 - landVel * 14) * dt;
    landDip += landVel * dt;
    if (landDip < -0.3) { landDip = -0.3; landVel = 0; }
    stepOffset *= Math.exp(-dt * 14);
    // 반동 복귀 · 트라우마 흔들림
    const kd = Math.exp(-dt * 11);
    kickP *= kd; kickY *= kd;
    trauma = Math.max(0, trauma - dt * 1.4);
    shakeT += dt * 22;
    const sh = trauma * trauma;
    const shP = sh * 0.035 * noise(shakeT, 1.3), shY = sh * 0.035 * noise(shakeT, 7.1), shR = sh * 0.05 * noise(shakeT, 4.2);

    let eye = PLAYER.EYE + bobY + landDip + stepOffset;
    let roll = Math.cos(bobPhase) * 0.0035 * bobAmp + shR;
    if (!state.alive) {
      deathT = Math.min(1, deathT + dt / 0.7);
      const k = deathT * deathT * (3 - 2 * deathT);
      eye = PLAYER.EYE + (0.35 - PLAYER.EYE) * k;
      roll += 0.55 * k;
    }
    const sy = Math.sin(state.yaw), cy = Math.cos(state.yaw);
    camera.position.set(x + cy * bobX, y + eye, z - sy * bobX);
    camera.rotation.set(state.pitch + kickP + shP, state.yaw + kickY + shY, roll, 'YXZ');
  }

  /** 사격 원점 = 현재 카메라 위치(보이는 그대로) */
  function getEye(out = [0, 0, 0]) {
    if (camera) { out[0] = camera.position.x; out[1] = camera.position.y; out[2] = camera.position.z; }
    else { out[0] = state.pos[0]; out[1] = state.pos[1] + PLAYER.EYE; out[2] = state.pos[2]; }
    return out;
  }
  /** 조준 방향(반동 kick·흔들림 제외, yaw/pitch만) */
  function getAimDir(out = [0, 0, 0]) {
    const cp = Math.cos(state.pitch);
    out[0] = -Math.sin(state.yaw) * cp;
    out[1] = Math.sin(state.pitch);
    out[2] = -Math.cos(state.yaw) * cp;
    return out;
  }

  function snapshot() {
    const p = state.pos;
    return {
      id: state.id,
      pos: [Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100, Math.round(p[2] * 100) / 100],
      yaw: Math.round(state.yaw * 1000) / 1000,
      pitch: Math.round(state.pitch * 1000) / 1000,
      moving: state.moving,
      walking: state.walking,
      aiming: state.aiming,
      onGround: state.onGround,
      alive: state.alive,
      hp: state.hp,
      slot: state.slot,
      team: state.team
    };
  }

  return {
    state,
    spawn,
    tick,
    frame,
    addRecoil,
    kick,
    addShake,
    damage,
    kill,
    getEye,
    getAimDir,
    forward,
    snapshot,
    setFrozen(v) { state.frozen = !!v; },
    setSpeedScale(s) { state.speedScale = Number.isFinite(s) && s > 0 ? s : 1; },
    get spawnPoint() { return spawnPoint; },
    dispose() { offs.forEach((o) => o()); offs.length = 0; }
  };
}
