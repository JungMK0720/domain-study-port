/**
 * ⚓ Port Ops — 원격 아바타 (저폴리 항만 작업자: 작업복 + 안전모 + 반사띠, 팀색 선주 남색 / 용선자 주황)
 *
 *   const avatars = createAvatars({ scene, camera });
 *   avatars.add(id, { name, team })          // 이미 있으면 갱신
 *   avatars.push(id, t, state)               // 스냅샷 { pos:[x,y,z], yaw, pitch, moving, walking, crouch, alive, ... }, t = ms
 *   avatars.update(now, dt)                  // 매 프레임: now − delay(100 ms) 시점으로 보간 → 메시·히트박스 갱신
 *   avatars.getTargets()                     // raycastPlayers용 [{ id, pos, yaw, alive, crouch(0..1), team, name }] (보간된 화면 위치·자세)
 *   avatars.get(id).kill({ dir:[x,z] }) / .revive() / .setHeld(object3d) / .setName() / .setTeam()
 *   avatars.setLocalTeam(team)               // 아군 이름표는 벽 너머로도 보임
 *   avatars.remove(id) / clear() / dispose()
 *
 * 모델 좌표: 발바닥 원점, 정면 = 로컬 -Z (yaw 0이면 -Z를 봄). 히트박스(consts HITBOX)와 같은 치수.
 * 앉기: state.crouch → 0.12초에 걸쳐 쪼그려 앉은 자세(엉덩이를 뒤로 낮추고 무릎 굽힘, 상체 앞으로)
 *       머리 중심 ≈ 1.13 m = HITBOX_CROUCH.HEAD. getTargets().crouch가 같은 비율이라 히트박스도 자세와 맞는다.
 */
import * as THREE from 'three';
import { TEAMS, NET, HITBOX, PLAYER } from '../core/consts.js';
import { SnapshotBuffer, lerpAngle } from './interp.js';

const FONT = "'Pretendard','Noto Sans KR','Malgun Gothic','Apple SD Gothic Neo',system-ui,sans-serif";

/* ---------------- 공유 지오메트리 (정점색) ---------------- */

function colored(geo, hex) {
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}
function box(w, h, d, x, y, z, hex) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return colored(g, hex);
}
function merge(geos) {
  let vc = 0, ic = 0;
  for (const g of geos) { vc += g.attributes.position.count; ic += g.index.count; }
  const pos = new Float32Array(vc * 3), nor = new Float32Array(vc * 3), col = new Float32Array(vc * 3), idx = new Uint16Array(ic);
  let vo = 0, io = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, vo * 3);
    nor.set(g.attributes.normal.array, vo * 3);
    col.set(g.attributes.color.array, vo * 3);
    for (let i = 0; i < g.index.count; i++) idx[io++] = g.index.getX(i) + vo;
    vo += g.attributes.position.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}

/** 손(무기 소켓) 위치: 어깨 피벗 기준 */
const HAND = [0.1, -0.22, -0.32];
/** 앉은 자세: 허벅지 앞으로 α, 정강이 뒤로 β, 엉덩이 높이·뒤로 뺀 거리, 상체 숙임 */
const SQUAT = { thigh: 1.35, shin: 0.75, hipY: 0.51, hipZ: 0.2, lean: 0.4 };
const STAND_HIP = 0.95;
const SKIN = 0xd9a77e, BOOT = 0x2b2622, GLOVE = 0x3a3a36, TAPE = 0xd8dee2, BELT = 0x25211d, GLASS = 0x1d2730, GUN = 0x2c3034;

const geoCache = new Map();
/** team → { upper(몸통+머리), legL, legR, armsGun(두 팔+기본 총), armsOnly } (팀 색이 정점색으로 들어감) */
function teamGeometry(team) {
  if (geoCache.has(team)) return geoCache.get(team);
  const T = TEAMS[team] || TEAMS.owner;
  const suit = new THREE.Color(T.color).getHex();
  const hat = new THREE.Color(T.light).getHex();
  // 상체(엉덩이 피벗 y=0.95 기준)
  let torso = merge([
    box(0.5, 0.56, 0.3, 0, 0.27, 0, suit),                 // 몸통 0.95~1.51
    box(0.505, 0.045, 0.305, 0, 0.16, 0, TAPE),            // 반사띠 1
    box(0.505, 0.045, 0.305, 0, 0.36, 0, TAPE),            // 반사띠 2
    box(0.52, 0.07, 0.32, 0, 0.02, 0, BELT),               // 벨트
    box(0.12, 0.1, 0.02, -0.13, 0.43, -0.16, 0xf2f2f2),    // 가슴 명찰
    box(0.16, 0.16, 0.06, 0.12, 0.08, 0.18, 0x3b3b3b),     // 허리 무전기(뒤)
    box(0.13, 0.06, 0.14, 0, 0.58, 0, SKIN)                // 목
  ]);
  // 머리(목 위 피벗 y=1.5 기준) + 안전모
  const dome = new THREE.SphereGeometry(0.155, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  dome.scale(1, 0.82, 1.08); dome.translate(0, 0.215, 0); colored(dome, hat);
  const brim = new THREE.CylinderGeometry(0.175, 0.175, 0.02, 16); brim.translate(0, 0.215, 0); colored(brim, hat);
  const peak = new THREE.BoxGeometry(0.2, 0.018, 0.09); peak.translate(0, 0.21, -0.19); colored(peak, hat);
  const ridge = new THREE.BoxGeometry(0.04, 0.03, 0.3); ridge.translate(0, 0.335, 0); colored(ridge, 0xf4f4f4);
  let head = merge([
    box(0.22, 0.25, 0.24, 0, 0.12, 0, SKIN),               // 머리 1.5~1.75 (히트박스 구 중심 1.62)
    box(0.205, 0.045, 0.02, 0, 0.15, -0.125, GLASS),       // 보안경
    box(0.05, 0.04, 0.03, 0, 0.07, -0.13, 0xc28f6a),       // 코
    dome, brim, peak, ridge
  ]);
  // 다리(엉덩이 피벗, 아래로) + 장화
  const leg = () => merge([
    box(0.17, 0.83, 0.2, 0, -0.415, 0, suit),
    box(0.175, 0.045, 0.205, 0, -0.5, 0, TAPE),
    box(0.17, 0.13, 0.28, 0, -0.885, -0.035, BOOT)
  ]);
  // 팔(어깨 피벗 기준, 아래로) + 장갑
  const arm = () => merge([
    box(0.13, 0.5, 0.14, 0, -0.25, 0, suit),
    box(0.135, 0.04, 0.145, 0, -0.33, 0, TAPE),
    box(0.11, 0.12, 0.12, 0, -0.55, 0, GLOVE)
  ]);
  // 기본 소지 무기(무기 담당 모델이 오면 setHeld로 교체)
  const gun = () => merge([
    box(0.06, 0.09, 0.62, 0, 0, -0.18, GUN),
    box(0.05, 0.14, 0.06, 0, -0.1, -0.05, GUN),
    box(0.04, 0.05, 0.2, 0, 0.065, -0.2, 0x3e4448),
    box(0.05, 0.1, 0.16, 0, -0.03, 0.18, 0x5a4632)
  ]);
  // 드로우콜 절약: 머리는 몸통에, 두 팔 + 총은 '어깨 피벗' 메시 하나로 굽는다(아바타당 메시 4개)
  const place = (g, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1));
    g.applyMatrix4(m);
    return g;
  };
  head.translate(0, 0.55, 0);
  const upper = merge([torso, head]);
  // 어깨 피벗(상체 기준 y=0.5)에서 본 좌표. +X 회전 = 팔이 앞(-Z)으로 들림, Z 회전 = 몸 안쪽으로
  const armsOnly = () => merge([place(arm(), 0.31, 0, 0, 1.25, 0, -0.12), place(arm(), -0.31, 0, 0, 1.15, 0, 0.55)]);
  const armsGun = merge([armsOnly(), place(gun(), HAND[0], HAND[1], HAND[2])]);
  // 앉은 다리(엉덩이 피벗): 허벅지 0.45 m를 앞으로 굽히고 정강이 0.38 m를 뒤로, 장화는 바닥과 평평하게
  const legBent = () => {
    const a = SQUAT.thigh, b = SQUAT.shin;
    const thigh = place(merge([box(0.17, 0.45, 0.2, 0, -0.225, 0, suit)]), 0, 0, 0, a);
    const kneeY = -0.45 * Math.cos(a), kneeZ = -0.45 * Math.sin(a);
    const shin = place(merge([box(0.17, 0.38, 0.2, 0, -0.19, 0, suit), box(0.175, 0.045, 0.205, 0, -0.08, 0, TAPE)]), 0, kneeY, kneeZ, -b);
    const ankleY = kneeY - 0.38 * Math.cos(b), ankleZ = kneeZ + 0.38 * Math.sin(b);
    const boot = box(0.17, 0.13, 0.28, 0, ankleY - 0.065, ankleZ - 0.035, BOOT);
    return merge([thigh, shin, boot]);
  };
  const set = { upper, legL: leg(), legR: leg(), legBent: legBent(), armsGun, armsOnly: armsOnly() };
  geoCache.set(team, set);
  return set;
}

let sharedMat = null;
function bodyMaterial() {
  if (!sharedMat) sharedMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  return sharedMat;
}

/* ---------------- 이름표 ---------------- */

function makeNameTexture(name, team) {
  const T = TEAMS[team] || TEAMS.owner;
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.font = `700 30px ${FONT}`;
  const text = String(name || '').slice(0, 16);
  const tw = Math.min(236, g.measureText(text).width + 28);
  const x0 = (256 - tw) / 2;
  g.fillStyle = 'rgba(8,14,24,0.62)';
  g.beginPath();
  if (g.roundRect) g.roundRect(x0, 10, tw, 44, 12); else g.rect(x0, 10, tw, 44);
  g.fill();
  g.fillStyle = T.light;
  g.fillRect(x0 + 10, 47, tw - 20, 3);
  g.fillStyle = '#ffffff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 128, 31, 228);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* ---------------- 아바타 ---------------- */

class Avatar {
  constructor(id, opts, mgr) {
    this.id = id;
    this.mgr = mgr;
    this.name = opts.name || String(id);
    this.team = TEAMS[opts.team] ? opts.team : 'charterer';
    this.buffer = new SnapshotBuffer({ maxExtrapolate: 150 });
    this.sample = { pos: [0, 0, 0], yaw: 0, pitch: 0, alive: true, moving: false };
    this.pos = [0, 0, 0];          // 화면(보간) 위치 = 히트박스 위치
    this.yaw = 0;
    this.pitch = 0;
    this.alive = true;
    this.visible = true;
    this.walkPhase = 0;
    this.walkAmp = 0;
    this.crouch = 0;               // 앉은 자세 비율 0..1 (0.12초 전환) — 히트박스도 이 값
    this.crouchTarget = false;
    this.death = null;             // { t, dirX, dirZ }
    this.lastPos = null;
    this.data = opts.data || {};   // 자유 메타데이터(무기 등)
    this.root = new THREE.Group();
    this.root.name = 'avatar:' + id;
    this.body = new THREE.Group();  // 쓰러질 때 회전
    this.root.add(this.body);
    this.build();
    mgr.scene.add(this.root);
  }

  build() {
    const G = teamGeometry(this.team);
    const mat = bodyMaterial();
    const mk = (geo) => { const m = new THREE.Mesh(geo, mat); m.castShadow = true; return m; };
    this.body.clear();
    this.hips = new THREE.Group(); this.hips.position.set(0, 0.95, 0);
    this.upper = new THREE.Group();          // 상체(조준 pitch로 살짝 젖힘/숙임)
    this.hips.add(this.upper);
    this.upper.add(mk(G.upper));
    this.armsPivot = new THREE.Group(); this.armsPivot.position.set(0, 0.5, 0); // 어깨선
    this.upper.add(this.armsPivot);
    this.arms = mk(this.held ? G.armsOnly : G.armsGun);
    this.armsPivot.add(this.arms);
    this.hand = new THREE.Group(); this.hand.position.set(HAND[0], HAND[1], HAND[2]);
    this.armsPivot.add(this.hand);
    if (this.held) this.hand.add(this.held);
    this.legL = mk(G.legL); this.legL.position.set(-0.11, 0, 0); this.hips.add(this.legL);
    this.legR = mk(G.legR); this.legR.position.set(0.11, 0, 0); this.hips.add(this.legR);
    this.body.add(this.hips);
    // 이름표
    if (this.tag) { this.tag.material.map.dispose(); this.tag.material.dispose(); this.root.remove(this.tag); }
    const tex = makeNameTexture(this.name, this.team);
    const smat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false });
    this.tag = new THREE.Sprite(smat);
    this.tag.scale.set(1.1, 0.275, 1);
    this.tag.position.set(0, 2.18, 0);
    this.tag.renderOrder = 10;
    this.root.add(this.tag);
    this.applyTagMode();
  }

  applyTagMode() {
    const ally = this.mgr.localTeam && this.mgr.localTeam === this.team;
    this.tag.material.depthTest = !ally;  // 아군은 벽 너머로도
    this.tag.userData.ally = ally;
  }

  setName(name) { if (name && name !== this.name) { this.name = String(name); this.build(); } }
  setTeam(team) { if (TEAMS[team] && team !== this.team) { this.team = team; this.build(); } }

  /** 무기 담당의 3인칭 모델로 교체(null이면 기본 모양). obj는 손 소켓 기준(총구 = -Z) */
  setHeld(obj) {
    if (this.held) this.hand.remove(this.held);
    this.held = obj || null;
    if (this.held) this.hand.add(this.held);
    this.arms.geometry = teamGeometry(this.team)[this.held ? 'armsOnly' : 'armsGun'];
  }

  /** 즉시 쓰러짐 (피 없음). dir: 쓰러질 방향 [x, z] (총알 진행 방향 등) */
  kill(opt = {}) {
    if (this.death) return;
    this.alive = false;
    let dx = 0, dz = 1;
    if (opt.dir) { dx = opt.dir[0]; dz = opt.dir[opt.dir.length === 3 ? 2 : 1]; }
    const l = Math.hypot(dx, dz) || 1;
    this.death = { t: 0, dirX: dx / l, dirZ: dz / l };
    this.tag.visible = false;
  }

  revive() {
    this.alive = true;
    this.death = null;
    this.crouch = 0;
    this.crouchTarget = false;
    this.body.rotation.set(0, 0, 0);
    this.body.position.set(0, 0, 0);
    this.tag.visible = true;
  }

  update(renderTime, dt) {
    const s = this.buffer.sample(renderTime, this.sample);
    if (s) {
      this.pos[0] = s.pos[0]; this.pos[1] = s.pos[1]; this.pos[2] = s.pos[2];
      this.yaw = s.yaw; this.pitch = s.pitch || 0;
      if (s.alive === false && !this.death) this.kill({ dir: s.deathDir || null });
      else if (s.alive !== false && this.death && this.death.t > 0.05 && s.respawned) this.revive();
      if (s.name && s.name !== this.name) this.setName(s.name);
      if (s.team && s.team !== this.team && TEAMS[s.team]) this.setTeam(s.team);
      this.crouchTarget = !!s.crouch && s.alive !== false;
    }
    // 앉기 자세 전환
    const ct = this.crouchTarget ? 1 : 0, cstep = dt / PLAYER.CROUCH_TIME;
    if (!this.death) this.crouch = this.crouch < ct ? Math.min(ct, this.crouch + cstep) : Math.max(ct, this.crouch - cstep);
    const ck = this.crouch * this.crouch * (3 - 2 * this.crouch);
    this.root.position.set(this.pos[0], this.pos[1], this.pos[2]);
    this.root.rotation.y = this.yaw;

    // 걷기 애니메이션: 실제 이동 거리로 위상 진행
    let speed = 0;
    if (this.lastPos && dt > 0) speed = Math.hypot(this.pos[0] - this.lastPos[0], this.pos[2] - this.lastPos[2]) / dt;
    if (!this.lastPos) this.lastPos = [0, 0, 0];
    this.lastPos[0] = this.pos[0]; this.lastPos[1] = this.pos[1]; this.lastPos[2] = this.pos[2];
    speed = Math.min(speed, 8);
    const moving = this.alive && speed > 0.35;
    this.walkAmp += ((moving ? Math.min(1, speed / 5) : 0) - this.walkAmp) * Math.min(1, dt * 10);
    this.walkPhase += speed * dt * 3.9;
    const sw = Math.sin(this.walkPhase) * (0.62 - 0.4 * ck) * this.walkAmp;
    this.legL.rotation.x = sw;
    this.legR.rotation.x = -sw;
    // 엉덩이: 서 있으면 0.95 / 앉으면 0.51로 낮추고 뒤로. 다리는 반쯤 앉으면 굽은 모양으로 바꾸고, 발이 바닥에 닿게 늘이고 줄인다
    const hipY = STAND_HIP + (SQUAT.hipY - STAND_HIP) * ck;
    this.hips.position.set(0, hipY + Math.abs(Math.cos(this.walkPhase)) * 0.025 * this.walkAmp * (1 - ck), SQUAT.hipZ * ck);
    const bent = ck >= 0.5;
    const G = teamGeometry(this.team);
    const legGeo = bent ? G.legBent : null;
    if (this.legL.geometry !== (legGeo || G.legL)) { this.legL.geometry = legGeo || G.legL; this.legR.geometry = legGeo || G.legR; }
    const ls = hipY / (bent ? SQUAT.hipY : STAND_HIP);
    this.legL.scale.y = this.legR.scale.y = ls;
    // 총을 든 자세 + 조준 pitch (상체가 조금, 팔·총이 더). 앉으면 상체를 숙이고 팔은 그만큼 들어 총을 수평으로
    const aim = Math.max(-0.9, Math.min(0.9, this.pitch));
    this.upper.rotation.x = aim * 0.35 - SQUAT.lean * ck;
    this.armsPivot.rotation.x = aim * 0.6 + sw * 0.03 + SQUAT.lean * ck;
    this.tag.position.y = 2.18 - 0.5 * ck;

    // 쓰러짐: 발을 축으로 총알 방향으로 넘어짐
    if (this.death) {
      const d = this.death;
      d.t = Math.min(1, d.t + dt / 0.65);
      const k = d.t * d.t; // 가속하며 넘어짐
      const ang = k * (Math.PI / 2) * 0.96;
      // 월드 방향 → 로컬(아바타 yaw 기준)
      const cy = Math.cos(-this.yaw), sy = Math.sin(-this.yaw);
      const lx = d.dirX * cy + d.dirZ * sy, lz = -d.dirX * sy + d.dirZ * cy;
      this.body.rotation.set(lz * ang, 0, -lx * ang);
      this.body.position.y = Math.sin(ang) * 0.12;
      this.walkAmp = 0;
    }

    // 이름표: 적은 35 m 넘으면 숨김
    if (this.tag.visible !== (this.alive && this.visible)) this.tag.visible = this.alive && this.visible;
    if (this.tag.visible && !this.tag.userData.ally && this.mgr.camera) {
      const cp = this.mgr.camera.position;
      const dist = Math.hypot(cp.x - this.pos[0], cp.z - this.pos[2]);
      this.tag.visible = dist < 35;
    }
    this.root.visible = this.visible;
  }

  dispose() {
    this.mgr.scene.remove(this.root);
    if (this.tag) { this.tag.material.map.dispose(); this.tag.material.dispose(); }
  }
}

export function createAvatars({ scene, camera, delay = NET.INTERP_DELAY_MS } = {}) {
  const map = new Map();
  const mgr = { scene, camera, localTeam: null };
  let interpDelay = delay;
  let lastNow = 0;

  function add(id, opts = {}) {
    let a = map.get(id);
    if (a) {
      if (opts.name) a.setName(opts.name);
      if (opts.team) a.setTeam(opts.team);
      return a;
    }
    a = new Avatar(id, opts, mgr);
    map.set(id, a);
    return a;
  }

  function remove(id) {
    const a = map.get(id);
    if (!a) return;
    a.dispose();
    map.delete(id);
  }

  return {
    add,
    remove,
    get: (id) => map.get(id) || null,
    has: (id) => map.has(id),
    list: () => Array.from(map.values()),
    get size() { return map.size; },
    clear() { for (const id of Array.from(map.keys())) remove(id); },
    /** 스냅샷 넣기. 아바타가 없으면 자동 생성 */
    push(id, t, state) {
      const a = map.get(id) || add(id, { name: state && state.name, team: state && state.team });
      a.buffer.push(t, state);
      return a;
    },
    /** 순간이동(보간 없이) — 스폰 등 */
    teleport(id, state, t = performance.now()) {
      const a = map.get(id);
      if (!a) return;
      a.buffer.clear();
      a.buffer.push(t - 1000, state);
      a.buffer.push(t, state);
      a.lastPos = null;
      if (state && state.alive !== false) a.revive();
    },
    update(now = performance.now(), dt = 0) {
      lastNow = now;
      const rt = now - interpDelay;
      for (const a of map.values()) a.update(rt, dt);
    },
    /** raycastPlayers 대상 — 화면에 보이는(보간된) 위치·방향과 같다 */
    getTargets(out = []) {
      out.length = 0;
      for (const a of map.values()) {
        if (!a.alive || !a.visible) continue;
        out.push({ id: a.id, pos: a.pos, yaw: a.yaw, alive: true, crouch: a.crouch, team: a.team, name: a.name });
      }
      return out;
    },
    setLocalTeam(team) {
      mgr.localTeam = team;
      for (const a of map.values()) a.applyTagMode();
    },
    setCamera(cam) { mgr.camera = cam; },
    setDelay(ms) { interpDelay = Math.max(0, +ms || 0); },
    get delay() { return interpDelay; },
    get lastUpdate() { return lastNow; },
    HITBOX,
    lerpAngle,
    dispose() {
      for (const id of Array.from(map.keys())) remove(id);
    }
  };
}
