/**
 * ⚓ Port Ops — World: 게임 화면의 공용 무대 (연습장·멀티 공통). 계약: ./WORLD_API.md
 *
 * core(renderer·input·loop·player·avatars)는 그대로 쓰고, 여기서는 그 위에
 *   오디오(fx/audio) · 이펙트(fx/effects) · 1인칭 뷰모델 · 로컬 arsenal · 수류탄 시스템 · HUD/스코프/일시정지 연결
 * 을 얹는다. 점수·피해 확정은 하지 않는다 — 판정 결과는 이벤트('hitClaim'·'explosion')로 내보내고 match가 정한다.
 *
 * 앱에 World는 하나다: createWorld()를 여러 번 불러도 같은 World를 가리키는 핸들을 돌려준다.
 * 루프 순서: 틱 -90(core 플레이어 이동 -100 다음) · 프레임 -40(아바타 -50 다음, 카메라 보정) · 500(FX, 렌더 1000 전)
 */
import * as THREE from 'three';
import { PLAYER } from '../core/consts.js';
import { traceShot, raycastWorld, raycastPlayers, lineOfSight, findFloor } from '../engine/physics.js';
import { lerpAngle } from '../engine/interp.js';
import { WEAPONS, getDef, PRIMARY_IDS, vec3 } from '../weapons/defs.js';
import { createArsenal, shotDirection } from '../weapons/logic.js';
import { createGrenadeSystem, stepGrenade, GRENADE_PHYSICS } from '../weapons/grenade.js';
import { createViewmodel } from '../weapons/viewmodel.js';
import { createAudio } from '../fx/audio.js';
import { createEffects } from '../fx/effects.js';
import { relativeAngle } from '../ui/dom.js';

/** 무기 → 총성 이름(fx/audio) · 이펙트 종류(fx/effects) */
export const FIRE_SOUND = Object.freeze({ nor1: 'sniper', dwt47: 'rifle', sof9: 'pistol' });
const FX_KIND = Object.freeze({ nor1: 'sniper', dwt47: 'rifle', sof9: 'pistol' });
const STEEL_MATS = new Set(['steel', 'rust', 'deck', 'tank', 'pipe', 'container_red', 'yellow', 'white', 'glass']);
const SPECTATE_DELAY_MS = 1600;
const LOCK_HINT = '🖱️ 화면을 클릭하면 조작을 시작해요';
const BODY_R = 0.3;
const CROUCH_H = PLAYER.CROUCH_HEIGHT || 1.25;   // 앉은 키(core consts)
const FFA_KEYS = Object.freeze(['kills', 'rank', 'total', 'leaderName', 'leaderKills', 'target', 'killTarget']);

const num = (v, d = 0) => (Number.isFinite(+v) && v !== null && v !== '' ? +v : d);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const r3 = (v) => [Math.round(v[0] * 1000) / 1000, Math.round(v[1] * 1000) / 1000, Math.round(v[2] * 1000) / 1000];
const round2 = (v) => Math.round(v * 100) / 100;
/** [x,y,z] 배열이나 {x,y,z} → 새 배열 */
function arr3(v) {
  if (!v) return [0, 0, 0];
  if (Array.isArray(v)) return [num(v[0]), num(v[1]), num(v[2])];
  return [num(v.x), num(v.y), num(v.z)];
}
function norm3(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
const stepSound = (mat) => (STEEL_MATS.has(mat) ? 'footstep_steel' : 'footstep_concrete');

/**
 * 근접(칼) 판정: 정확한 레이가 먼저, 없으면 시선 원뿔(arc) 안 + 사거리 안 + 벽에 안 가린 가장 가까운 대상.
 * @returns {{ id, part, dist, point } | null}  dist = 몸 표면까지 거리(m)
 */
export function meleeTrace(world, eye, fwd, range = 1.8, arc = 0.6, targets = [], ignoreId) {
  const f = norm3(arr3(fwd));
  const ray = raycastPlayers(eye, f, range, targets, ignoreId != null ? { ignoreId } : null);
  if (ray && (!world || lineOfSight(world, eye, ray.point))) {
    return { id: ray.id, part: ray.part, dist: round2(ray.dist), point: r3(ray.point) };
  }
  let best = null, bestScore = Infinity;
  for (const tg of targets) {
    if (!tg || tg.alive === false || (ignoreId != null && tg.id === ignoreId)) continue;
    const p = arr3(tg.pos);
    const top = tg.crouch ? 1.5 - 0.45 * Math.min(1, +tg.crouch || 0) : 1.5;   // 앉으면 몸통 윗면 1.05 m
    const cy = clamp(eye[1], p[1] + 0.5, p[1] + top);      // 눈높이에 가장 가까운 몸 높이
    const dx = p[0] - eye[0], dy = cy - eye[1], dz = p[2] - eye[2];
    const dist = Math.hypot(dx, dy, dz);
    const surf = Math.max(0, dist - BODY_R);
    if (surf > range) continue;
    const cos = dist > 1e-6 ? (dx * f[0] + dy * f[1] + dz * f[2]) / dist : 1;
    const ang = Math.acos(clamp(cos, -1, 1));
    if (ang > arc + Math.atan2(BODY_R, Math.max(BODY_R, dist))) continue;
    const pt = [p[0], cy, p[2]];
    if (world && !lineOfSight(world, eye, pt)) continue;
    const score = ang * 2 + surf;
    if (score < bestScore) { bestScore = score; best = { id: tg.id, part: 'body', dist: round2(surf), point: r3(pt) }; }
  }
  return best;
}

/* ============================================================ 공유 World */

let defaultCtx = null;
let shared = null;

/** game/index.js가 install(ctx)에서 등록한다 → createWorld({ ... })에 ctx를 안 줘도 된다 */
export function setWorldContext(ctx) { defaultCtx = ctx || null; }

/**
 * @param {{ ctx?, ui?, settings?, root? }} opts
 * @returns {Promise<object>} World 핸들 (WORLD_API.md 1절)
 */
export async function createWorld(opts = {}) {
  const ctx = (opts && opts.ctx) || defaultCtx;
  if (!ctx || !ctx.renderer || !ctx.player) throw new Error('createWorld: core ctx가 필요해요(game/index.js install 이후에 부르세요)');
  if (!shared || shared.dead || shared.ctx !== ctx) shared = buildWorld(ctx, opts || {});
  else if (opts && opts.ui && shared.ui !== opts.ui) console.warn('[world] 이미 만든 World가 있어 새 ui는 쓰지 않아요(앱에 UI는 하나)');
  return shared.handle();
}

function buildWorld(ctx, opts) {
  const { bus, renderer: R, input, player, avatars } = ctx;
  const settings = opts.settings || ctx.settings;
  const ui = opts.ui || null;
  const W = { ctx, ui, dead: false, refs: 0, handle: null };
  const listeners = new Map();
  const offs = [];

  /* ---------- 효과 · 소리 · 뷰모델 · 무기 ---------- */
  const fx = createEffects(R.scene, R.camera, { renderer: R.three });
  fx.setApplyShake(false);                       // 흔들림은 frame()에서 한 번에 더한다
  const audio = createAudio({ volume: num(settings.get('volume'), 0.8) });
  const vm = createViewmodel(R.viewCamera, { lookCamera: R.camera, muzzleFlash: true });
  try { vm.preload(); } catch (e) { /* 첫 교체 때 만든다 */ }
  vm.setVisible(false);
  const zoomModeOf = () => (settings.get('zoomMode') === 'toggle' ? 'toggle' : 'hold');
  const arsenal = createArsenal({ primary: 'dwt47', zoomMode: zoomModeOf() });
  const prevDelay = avatars.delay;
  avatars.setDelay(0);                           // setActorState는 이미 보간된 상태 → 그대로 그린다

  // 수류탄 모형(풀)
  const nadeGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.13, 10);
  const nadeMat = new THREE.MeshLambertMaterial({ color: 0xe2b52a });
  const nadeMeshes = [];
  function nadeMesh(i) {
    while (nadeMeshes.length <= i) {
      const m = new THREE.Mesh(nadeGeo, nadeMat);
      m.name = 'world:grenade';
      m.visible = false;
      R.scene.add(m);
      nadeMeshes.push(m);
    }
    return nadeMeshes[i];
  }

  /* ---------- 상태 ---------- */
  const local = { id: String(ctx.session.id), name: String(ctx.session.name || ''), team: 'owner', alive: false, spawned: false, deadAt: 0, loadout: 'dwt47' };
  const spec = { id: null, idx: 0, yaw: 0, name: '' };
  const actors = new Map();
  const rnd = { phase: null, round: 0, score: { owner: 0, charterer: 0 }, timeLeftMs: null, elapsed: 0, alive: null, teamSize: null, target: 3, bestOf: 5, ffa: null };
  let map = null, nades = null, active = false, simPaused = false, uiPaused = false, controls = true;
  // 개인전(FFA): 모든 액터가 적. 부활 대기·보호 표시는 World가 HUD에 그린다(MODES.md 3.4)
  let mode = 'team';
  let respawn = null;                             // { at(ms), killer, weaponName } — 내 부활 대기
  let protectUntil = 0;                           // 내 보호(무적) 표시가 끝나는 시각(ms)
  let customHint = '';
  let pauseOpts = { leaveLabel: '나가기', note: undefined };
  let scoreboardProvider = null, scoreboardOpen = false, sbRefresh = 0;
  let clock = 0;                                  // World 시뮬레이션 시각(초, 일시정지 중 멈춤)
  const scheduled = [];                           // { at, name, opts, tag }
  let heartbeatAt = 0, grenadeSeq = 0;
  let loadingEl = null, loadingText = null;
  const tmpV = new THREE.Vector3();
  const latch = { fire: false, rmb: false, reload: false, slot: null, wheel: 0 };
  let rmbDown = false;

  function emit(evt, data) {
    const set = listeners.get(evt);
    if (!set) return;
    for (const fn of Array.from(set)) {
      try { fn(data); } catch (err) { console.error(`[world] '${evt}' 리스너 오류`, err); }
    }
  }
  function on(evt, fn) {
    if (typeof fn !== 'function') return () => {};
    let set = listeners.get(evt);
    if (!set) { set = new Set(); listeners.set(evt, set); }
    set.add(fn);
    return () => { const s = listeners.get(evt); if (s) s.delete(fn); };
  }

  /* ---------- 소리 ---------- */
  function play(name, o) { try { return audio.play(name, o); } catch (e) { return null; } }
  function schedule(delaySec, name, o, tag) { scheduled.push({ at: clock + Math.max(0, delaySec), name, opts: o || null, tag: tag || '' }); }
  function cancelScheduled(tag) { for (let i = scheduled.length - 1; i >= 0; i--) if (scheduled[i].tag === tag) scheduled.splice(i, 1); }
  function runScheduled() {
    for (let i = scheduled.length - 1; i >= 0; i--) {
      const s = scheduled[i];
      if (clock >= s.at) { scheduled.splice(i, 1); play(s.name, s.opts || undefined); }
    }
  }
  function footstep(p, gain) {
    let mat = null;
    if (map) { const h = raycastWorld(map.world, [p[0], p[1] + 0.3, p[2]], [0, -1, 0], 0.8); if (h) mat = h.mat; }
    play(stepSound(mat), { pos: p, gain });
  }
  // 첫 사용자 입력에서 AudioContext 언락(메뉴에서 미리 풀리면 게임 중 끊김이 없다)
  let unlocked = false;
  const unlock = () => {
    if (unlocked) return;
    audio.unlock().then((ok) => { if (ok) { unlocked = true; removeUnlock(); } }, () => {});
  };
  const removeUnlock = () => {
    window.removeEventListener('pointerdown', unlock, true);
    window.removeEventListener('keydown', unlock, true);
  };
  window.addEventListener('pointerdown', unlock, true);
  window.addEventListener('keydown', unlock, true);

  /* ---------- 입력 래치 ---------- */
  const onMouseDown = (e) => { if (e.button === 2 && input.locked && input.enabled && !emoteBusy()) { rmbDown = true; latch.rmb = true; } };
  const onMouseUp = (e) => { if (e.button === 2) rmbDown = false; };
  document.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mouseup', onMouseUp);
  offs.push(() => { document.removeEventListener('mousedown', onMouseDown); document.removeEventListener('mouseup', onMouseUp); });
  offs.push(bus.on('input:fire', (e) => {
    if (!e || !e.down) return;
    if (active && local.spawned && !local.alive) { spec.idx++; spec.id = null; }  // 관전 대상 바꾸기
    // 이모트 중·휠이 열린 동안의 좌클릭은 이모트 취소/선택에만 쓴다(사격 안 함, MODES.md 4.2·4.3)
    if (emoteBusy()) return;
    latch.fire = true;
  }));
  offs.push(bus.on('player:emote', () => { if (active) syncLocalEmote(); }));
  offs.push(bus.on('input:emoteWheel', (e) => onEmoteWheel(e)));
  // core 3인칭 전환: 'third'가 되는 즉시 뷰모델을 숨긴다(매 프레임 thirdPerson 확인과 같은 결과, 첫 프레임부터)
  offs.push(bus.on('player:view', (e) => { if (active && e && e.mode === 'third') vm.setVisible(false); }));
  offs.push(bus.on('player:emote-denied', (e) => onEmoteDenied(e)));
  offs.push(bus.on('input:aim', (e) => { if (e && e.active && e.source === 'user' && !input.locked) latch.rmb = true; }));  // autoplay 테스트용
  offs.push(bus.on('input:reload', () => { latch.reload = true; }));
  offs.push(bus.on('input:slot', (e) => { latch.slot = e && e.slot; }));
  offs.push(bus.on('input:cycle', (e) => { latch.wheel = (e && e.dir) || 0; }));
  offs.push(bus.on('input:lock', (e) => { if (e && !e.locked) rmbDown = false; }));

  offs.push(bus.on('settings:change', (e) => {
    const k = e && e.key;
    if (k === 'volume' || k === '*') audio.setVolume(num(settings.get('volume'), 0.8));
    if (k === 'zoomMode' || k === '*') arsenal.setZoomMode(zoomModeOf());
  }));
  offs.push(bus.on('renderer:quality', (e) => {
    const low = e && e.level === 'low';
    fx.setQuality(low ? 'low' : 'high');
    audio.setQuality(low ? 'low' : 'high');
  }));
  offs.push(bus.on('player:step', (e) => {
    if (!active || !local.alive) return;
    const quiet = (e && e.quiet) || player.state.crouch;   // Shift 걷기·앉아 걷기는 작게
    play(stepSound(e && e.mat), { gain: player.state.crouch ? 0.2 : quiet ? 0.3 : 0.6 });
  }));
  offs.push(bus.on('player:land', (e) => { if (active && local.alive && e && e.speed > 3) play(stepSound(e.mat), { gain: Math.min(1, e.speed / 9) }); }));

  /* ---------- UI: 커서 · 일시정지 · 로드아웃 · 점수판 ---------- */
  function openPause() {
    if (!ui) return;
    ui.show('pause', { leaveLabel: pauseOpts.leaveLabel, note: pauseOpts.note });
    if (!uiPaused) { uiPaused = true; emit('pause', { paused: true }); }
  }
  function closePause() {
    if (uiPaused) { uiPaused = false; emit('pause', { paused: false }); }
  }
  if (ui) {
    offs.push(ui.on('needCursor', (need) => { if (need && input.locked) input.exitLock(); }));
    offs.push(ui.on('pause:resume', () => {
      if (!active) return;
      closePause();
      input.requestLock();                       // 사용자 클릭 안 → 바로 다시 잠금(실패하면 '클릭해서 시작' 안내)
    }));
    offs.push(ui.on('pause:leave', () => {
      if (!active) return;
      closePause();
      emit('leave', {});
    }));
    offs.push(ui.on('loadout:pick', (e) => {
      if (!active) return;
      const id = e && e.id;
      if (PRIMARY_IDS.includes(id)) setLocalLoadout(id);
      if (e && !e.auto && !input.locked) input.requestLock();
      emit('loadoutPick', { id, auto: !!(e && e.auto) });
    }));
  }
  offs.push(bus.on('input:menu', () => {
    if (!active || !ui || ui.needsCursor() || ui.isVisible('pause')) return;
    openPause();                                 // Esc·창 전환으로 잠금이 풀림
  }));
  offs.push(bus.on('input:scoreboard', (e) => {
    if (!active || !ui) return;
    scoreboardOpen = !!(e && e.open) && !!scoreboardProvider;
    if (scoreboardOpen) { sbRefresh = 0; showScoreboard(); } else ui.hide('scoreboard');
  }));
  function showScoreboard() {
    if (!ui || !scoreboardProvider) return;
    try { const d = scoreboardProvider(); if (d) ui.show('scoreboard', d); } catch (err) { console.error('[world] scoreboard', err); }
  }

  function showLoading(on, text) {
    if (!ui) return;
    if (!loadingEl) {
      loadingEl = document.createElement('div');
      loadingEl.className = 'po-world-loading';
      Object.assign(loadingEl.style, {
        position: 'fixed', inset: '0', zIndex: '8', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px',
        background: 'rgba(4, 12, 24, 0.78)', color: '#d8e6f5', fontWeight: '800', fontSize: '16px', pointerEvents: 'auto'
      });
      const sp = document.createElement('div');
      sp.className = 'po-spinner';
      loadingText = document.createElement('span');
      loadingEl.append(sp, loadingText);
      ui.el.append(loadingEl);
    }
    loadingText.textContent = text || '';
    loadingEl.hidden = !on;
  }

  /* ---------- 맵 ---------- */
  async function loadMap(mapId, opt = {}) {
    const data = ctx.maps && ctx.maps.getMap ? ctx.maps.getMap(mapId) : null;
    showLoading(true, `🗺️ ${(data && data.name) || mapId} 불러오는 중…`);
    let built;
    try { built = await ctx.loadMap(mapId); }
    finally { showLoading(false); }
    map = built;
    if (nades) nades.dispose();
    nades = createGrenadeSystem({ world: built.world });
    active = true;
    simPaused = false; uiPaused = false; scoreboardOpen = false;
    controls = true; customHint = '';            // 이전 모드(멀티 teardown 등)가 남긴 설정을 지운다
    local.spawned = false; local.alive = false;
    rnd.phase = null; rnd.timeLeftMs = null; rnd.alive = null; rnd.teamSize = null; rnd.score = { owner: 0, charterer: 0 }; rnd.round = 0; rnd.ffa = null;
    respawn = null; protectUntil = 0;
    setMode(opt && opt.mode);
    fx.clear(false);
    scheduled.length = 0;
    R.setFov(R.baseFov);
    input.setLookScale(1);
    ctx.setRendering(true);
    input.setEnabled(input.locked || !!(ctx.flags && ctx.flags.autoplay));
    if (ui) { ui.show('hud', { crosshair: false, hp: 100 }); ui.hud.reset(); ui.scope.set(0); }
    return { spawns: built.spawns, mapName: built.name, mapId: built.id, map: built, data: built.data, fallback: !!(built.data && built.data.fallback) };
  }

  function unloadMap() {
    const was = active || !!map;
    active = false;
    simPaused = false; uiPaused = false; scoreboardOpen = false;
    clearActors();
    if (nades) { nades.dispose(); nades = null; }
    for (const m of nadeMeshes) m.visible = false;
    fx.clear(false);
    try { audio.stopAll(0.05); } catch (e) { /* ignore */ }
    scheduled.length = 0;
    vm.setVisible(false);
    stopSound(emoteSnd); emoteSnd = null; emoteLocal = 0; emoteBlockUntil = 0;
    closeWheel();
    local.spawned = false; local.alive = false;
    customHint = '';
    rnd.phase = null; rnd.timeLeftMs = null; rnd.ffa = null;
    respawn = null; protectUntil = 0;
    mode = 'team';
    player.setFrozen(false);
    player.setSpeedScale(1);
    if (ui) { for (const s of ['hud', 'scoreboard', 'pause', 'loadout']) ui.hide(s); ui.scope.set(0); }
    R.setFov(R.baseFov);
    input.setLookScale(1);
    input.exitLock();
    input.setEnabled(false);
    ctx.setRendering(false);
    map = null;
    if (was && ctx.map) ctx.unloadMap();
  }

  /** 라운드 전환: 투사체·이펙트·예약 소리·관전 정리(액터는 유지) */
  function reset() {
    if (nades) nades.clear();
    for (const m of nadeMeshes) m.visible = false;
    fx.clear(false);
    scheduled.length = 0;
    spec.id = null; spec.name = '';
    if (ui) { ui.hud.reset(); ui.hide('scoreboard'); scoreboardOpen = false; }
  }

  /* ---------- 로컬 플레이어 ---------- */
  function spawnLocal(o = {}) {
    if (!map) throw new Error('spawnLocal: 먼저 loadMap()을 부르세요');
    cancelLocalEmote('spawn');
    if (o.id != null && String(o.id)) { local.id = String(o.id); player.state.id = local.id; }
    if (o.name) { local.name = String(o.name); player.state.name = local.name; }
    // 팀전: owner/charterer. 개인전: 팀 없음(null) — 아군 이름표 없음, 뷰모델 소매는 남색
    const team = o.team === 'charterer' || o.team === 'owner' ? o.team : mode === 'ffa' ? null : local.team;
    local.team = team;
    player.state.team = team;
    avatars.setLocalTeam(mode === 'ffa' ? null : team);
    vm.setTeam(team || 'owner');
    const sp = o.spawn || (team && map.spawns[team] && map.spawns[team][0]) || (map.spawns.owner && map.spawns.owner[0]) || { x: 0, z: 0, rotY: 0 };
    const x = num(sp.x), z = num(sp.z);
    const y = Number.isFinite(sp.y) ? sp.y : findFloor(map.world, x, z);
    player.spawn({ x, y, z, rotY: num(sp.rotY) });
    const primary = PRIMARY_IDS.includes(o.loadout) ? o.loadout : arsenal.getPrimary();
    arsenal.resetRound({ primary, draw: true });
    local.loadout = primary;
    local.alive = true;
    local.spawned = true;
    spec.id = null; spec.name = '';
    latch.fire = latch.rmb = latch.reload = false; latch.slot = null; latch.wheel = 0;
    vm.setVisible(true);
    player.setSpeedScale(arsenal.getMoveMul());
    R.setFov(R.baseFov);
    input.setLookScale(1);
    respawn = null;
    protectUntil = num(o.protectMs) > 0 ? performance.now() + num(o.protectMs) : 0;
    return player.state;
  }

  /* ---------- 모드 · 부활 · 보호 (개인전) ---------- */
  const avatarTeam = (a) => (mode === 'ffa' ? 'charterer' : a.team || 'charterer');   // 개인전: 다른 사람은 모두 한 가지 '적' 색
  const avatarName = (a) => (a.protectUntil > performance.now() ? `🛡 ${a.name}` : a.name);
  function refreshAvatar(a) { avatars.add(a.id, { name: avatarName(a), team: avatarTeam(a) }); }

  /** 'team' | 'ffa' — loadMap 직후 한 번(loadMap(mapId, { mode })도 같다). unloadMap은 'team'으로 되돌린다 */
  function setMode(m) {
    mode = m === 'ffa' ? 'ffa' : 'team';
    avatars.setLocalTeam(mode === 'ffa' ? null : local.team);
    for (const a of actors.values()) refreshAvatar(a);
    return mode;
  }
  /** 내 부활 대기 표시: { inMs, killer?, weaponName? } | null. spawnLocal이 지운다 */
  function setRespawn(o) {
    if (!o) { respawn = null; return; }
    respawn = { at: performance.now() + Math.max(0, num(o.inMs, num(o.ms, 0))), killer: o.killer ? String(o.killer) : '', weaponName: o.weaponName ? String(o.weaponName) : '' };
  }
  /** 내 보호(무적) 표시: ms(>0) 동안 · true = 끌 때까지 · false/0 = 끔 */
  function setProtect(v) {
    protectUntil = v === true ? Infinity : num(v) > 0 ? performance.now() + num(v) : 0;
  }
  /** 다른 사람 보호 표시(이름표 🛡): ms(>0) 동안 · true = 끌 때까지 · false/0 = 끔 */
  function setActorProtect(id, v) {
    const a = actors.get(String(id));
    if (!a) return;
    const until = v === true ? Infinity : num(v) > 0 ? performance.now() + num(v) : 0;
    const was = a.protectUntil > performance.now();
    a.protectUntil = until;
    if (was !== (until > performance.now())) refreshAvatar(a);
  }

  /* ---------- 이모트 (MODES.md 4절) ----------
   * 목록·입력·3인칭 카메라·아바타 리그는 core, 휠 화면·hud.emote는 UI, 소리는 fx. World는 이들을 잇는다.
   * 전송값 = 이모트 번호(code 1~15, 0 = 없음). player.state.emote·원격 state.emote는 번호 또는 id를 모두 받는다. */
  let emoteLocal = 0;              // 지금 내 이모트 번호
  let emoteSnd = null;             // 내 이모트 소리(2D)
  let emoteBlockUntil = 0;         // 이모트가 끝난 직후(취소 클릭 등) 사격 막기
  const wheel = { open: false };
  let emoteSrc = null, emoteCache = [];
  function emoteList() {
    const E = ctx.consts && ctx.consts.EMOTES;
    if (E === emoteSrc) return emoteCache;
    emoteSrc = E;
    const arr = Array.isArray(E) ? E : E && typeof E === 'object' ? Object.values(E) : [];
    return (emoteCache = arr.filter(Boolean).map((e, i) => ({
      id: String(e.id), code: num(e.code ?? e.num ?? e.n, i + 1) | 0, name: e.name || e.id, icon: e.icon || '',
      loop: e.loop != null ? !!e.loop : !(num(e.duration ?? e.durationMs, 0) > 0), duration: num(e.duration, 0)
    })));
  }
  function emoteInfo(v) {
    if (v == null || v === 0 || v === '' || v === false) return null;
    const list = emoteList();
    return typeof v === 'number' ? list.find((e) => e.code === v) || null : list.find((e) => e.id === String(v)) || null;
  }
  const emoteCode = (v) => { if (typeof v === 'number') return v | 0; const e = emoteInfo(v); return e ? e.code : 0; };
  const localEmoteNow = () => emoteCode(player.state.emote);
  function emoteBusy() { return wheel.open || !!localEmoteNow() || performance.now() < emoteBlockUntil; }
  /** core 3인칭 정도(0..1) — 이모트 시작·끝 0.15초 전환 동안에도 뷰모델·크로스헤어를 숨긴다 */
  function thirdAmount() {
    const t = typeof player.thirdPerson === 'function' ? player.thirdPerson() : player.thirdPerson;
    return num(t, emoteLocal ? 1 : 0);
  }
  /** 이모트 소리: pos가 있으면 3D(원격, 작게), 없으면 2D(나). fx API(playEmote)가 없으면 이름 규칙으로 재생 */
  /** fx audio.emote(idOrCode, { pos? }) → { stop(fadeMs), setPos(pos) }. pos가 있으면 원격 3D(작게), 없으면 내 2D.
   *  반복형은 stop()까지 루프, 경례·손 흔들기는 한 번 재생하고 저절로 정리된다 */
  function emoteSound(code, pos) {
    const e = emoteInfo(code);
    if (!e || typeof audio.emote !== 'function') return null;
    try { return audio.emote(e.code, pos ? { pos } : {}) || null; } catch (err) { return null; }
  }
  function stopSound(h) {
    if (!h || typeof h.stop !== 'function') return;
    try { h.stop(150); } catch (err) { /* ignore */ }            // fadeMs
  }
  /** 내 이모트를 취소(피해·죽음·스폰). core가 player.cancelEmote를 준다 */
  function cancelLocalEmote(reason) {
    if (localEmoteNow() && typeof player.cancelEmote === 'function') { try { player.cancelEmote(reason); } catch (err) { /* ignore */ } }
    syncLocalEmote();
  }
  /** 내 이모트 상태가 바뀌었으면 소리·뷰모델을 맞춘다(매 틱 + core 'player:emote' 이벤트) */
  function syncLocalEmote() {
    const code = local.spawned && local.alive ? localEmoteNow() : 0;
    if (code === emoteLocal) return;
    stopSound(emoteSnd);
    emoteSnd = null;
    if (emoteLocal && !code) emoteBlockUntil = performance.now() + 150;   // 취소 클릭이 곧바로 사격이 되지 않게
    emoteLocal = code;
    if (code) {
      emoteSnd = emoteSound(code, null);
      latch.fire = false;
    }
    vm.setVisible(local.spawned && local.alive && !code);
  }

  /* 이모트 휠(배틀그라운드식, MODES.md 4.2) — 커서·강조 칸 계산과 B를 뗄 때의 시작은 core(input·player)가 한다.
   * World는 core 'input:emoteWheel' {open, cursor, selected, ...}를 UI 'emotes' 화면에 그대로 옮기고,
   * 시작이 거절되면('player:emote-denied') 안내를 띄운다. */
  const NOT_STILL = '멈춘 상태에서만 할 수 있어요';
  function wheelItems() { return emoteList().slice(0, 8).map((e) => ({ id: e.id, code: e.code, name: e.name, icon: e.icon, loop: e.loop })); }
  function onEmoteWheel(e) {
    if (!active || !ui || !e) return;
    const open = !!e.open && local.spawned && local.alive;
    const props = { selected: e.selected == null ? null : e.selected, cursor: e.cursor || { x: 0, y: 0 } };
    if (open) {
      latch.fire = false; rmbDown = false;
      if (!wheel.open) { wheel.open = true; ui.show('emotes', Object.assign({ items: wheelItems() }, props)); }
      else ui.update('emotes', props);
    } else closeWheel();
  }
  function closeWheel() {
    if (!wheel.open) return;
    wheel.open = false;
    emoteBlockUntil = performance.now() + 150;      // 휠을 닫은 클릭·뗌이 곧바로 사격이 되지 않게
    if (ui) ui.hide('emotes');
  }
  function onEmoteDenied(e) {
    if (!active || !ui) return;
    const r = e && e.reason;
    if (r === 'moving' || r === 'air' || r === 'crouch') ui.hud.center(NOT_STILL, 1600, { tone: 'warn' });
  }
  /** (API·시험용) 내 이모트를 바로 시작. 보통은 core가 휠 선택으로 시작한다 */
  function startLocalEmote(id) {
    if (!local.spawned || !local.alive || typeof player.startEmote !== 'function') return false;
    let ok = false;
    try { const r = player.startEmote(id); ok = r && typeof r === 'object' ? !!r.ok : r !== false; } catch (err) { ok = false; }   // core: { ok, reason }
    syncLocalEmote();
    return ok && !!emoteLocal;
  }

  function setLocalLoadout(id) {
    if (!PRIMARY_IDS.includes(id)) return false;
    local.loadout = id;
    if (arsenal.getPrimary() !== id) arsenal.setPrimary(id);
    return true;
  }

  function setLocalHp(hp) {
    const v = Math.max(0, Math.round(num(hp, player.state.hp)));
    const before = player.state.hp;
    if (v < before && local.alive) { player.addShake(Math.min(0.4, (before - v) / 150)); cancelLocalEmote('damage'); }
    player.state.hp = v;
  }

  function killLocal(info = {}) {
    if (!local.spawned || !local.alive) return;
    cancelLocalEmote('death');
    local.alive = false;
    local.deadAt = performance.now();
    if (ctx.renderer.applyPendingQuality) ctx.renderer.applyPendingQuality();   // 미뤄 둔 자동 품질 변경은 죽었을 때 치른다
    player.kill(info || {});
    vm.setVisible(false);
    if (ui) ui.scope.set(0);
    spec.id = null; spec.idx = 0; spec.name = '';
    spec.yaw = player.state.yaw;
    emit('localDeath', { id: local.id, info: info || {} });
  }

  /* ---------- 로컬 무기 ---------- */
  function onWeaponEvent(ev) {
    vm.play(ev);
    switch (ev.type) {
      case 'fire': localFire(ev); break;
      case 'melee': localMelee(ev); break;
      case 'throw': localThrow(ev); break;
      case 'swing': {
        play('knife_slash');
        const eye = player.getEye();
        emit('fire', { id: local.id, weaponId: 'hawser', origin: r3(eye), dir: r3(player.getAimDir()), hitPoint: null, hitKind: 'none', dist: 0, t: performance.now(), kind: ev.kind, quickscope: false, noscope: false });
        break;
      }
      case 'dryFire': play('dry_fire'); break;
      case 'reloadStart':
        cancelScheduled('reload');
        play('reload_mag_out');
        schedule(num(ev.duration, 2) * 0.62, 'reload_mag_in', null, 'reload');
        break;
      case 'reloadCancel': cancelScheduled('reload'); break;
      case 'boltCycle': schedule(0.18, 'bolt', null, 'bolt'); break;
      case 'switch':
        cancelScheduled('reload'); cancelScheduled('bolt');
        player.state.slot = ev.slot;
        player.state.weapon = ev.to;
        if (!ev.reset) play('switch', { gain: 0.7 });
        break;
      case 'prime': play('grenade_pin'); break;
      case 'zoomChange':
        if (!ev.zoomed && arsenal.getZoomMode() === 'toggle') input.resetAim();
        break;
      default: break;
    }
  }

  /** 사격 대상 = core getTargets(+앉은 상태). core 아바타가 crouch를 안 실어 주면 액터 상태에서 채운다 */
  function targets() {
    const list = ctx.getTargets();
    for (const t of list) {
      if (t.crouch !== undefined) continue;
      const a = actors.get(String(t.id));
      if (a && a.state && a.state.crouch) t.crouch = true;
    }
    return list;
  }

  function localFire(ev) {
    const st = player.state;
    const eye = player.getEye();
    // 앉아 있을 때 탄퍼짐 ×0.8은 arsenal이 한다(motion.crouch) — ev.pellets에 이미 반영돼 있다
    const dv = shotDirection(st.yaw, st.pitch, ev, 0);
    const d = [dv[0], dv[1], dv[2]];
    const range = num(ev.maxRange, 300);
    const hit = traceShot(map.world, eye, d, range, targets());
    const kind = FX_KIND[ev.weaponId] || 'rifle';
    const m = vm.getMuzzleWorld(tmpV, R.camera);
    const muzzle = m ? [m.x, m.y, m.z] : [eye[0] + d[0] * 0.6, eye[1] + d[1] * 0.6 - 0.1, eye[2] + d[2] * 0.6];
    fx.tracer(muzzle, hit.point, kind);
    if (hit.kind === 'world') fx.impact(hit.point, hit.normal, hit.mat);
    else if (hit.kind === 'player') fx.impact(hit.point, [-d[0], -d[1], -d[2]], 'player');
    if (kind !== 'sniper') fx.shellEject(muzzle, d, { groundY: st.pos[1] });
    play(FIRE_SOUND[ev.weaponId] || 'rifle');
    const t = performance.now();
    const payload = {
      id: local.id, weaponId: ev.weaponId, origin: r3(eye), dir: r3(d),
      hitPoint: hit.kind === 'none' ? null : r3(hit.point), hitKind: hit.kind, dist: round2(hit.dist), t,
      quickscope: !!ev.quickscope, noscope: !!ev.noscope, spread: Math.round(num(ev.spreadDeg) * 100) / 100
    };
    if (hit.kind === 'player') { payload.victimId = hit.id; payload.part = hit.part; }
    if (hit.kind === 'world') { payload.normal = r3(hit.normal); payload.mat = hit.mat; }
    emit('fire', payload);
    if (hit.kind === 'player') {
      protectUntil = 0;                          // 먼저 공격하면 보호 끝(match 규칙과 같게 표시)
      emit('hitClaim', { victimId: hit.id, part: hit.part, weaponId: ev.weaponId, dist: round2(hit.dist), kind: 'shot', t, point: r3(hit.point), origin: r3(eye) });
    }
  }

  function localMelee(ev) {
    const eye = player.getEye();
    const fwd = player.getAimDir();
    const hit = meleeTrace(map.world, eye, fwd, num(ev.range, 1.8), num(ev.arc, 0.6), targets(), local.id);
    if (!hit) return;
    play('knife_hit');
    fx.impact(hit.point, [-fwd[0], -fwd[1], -fwd[2]], 'player');
    protectUntil = 0;
    emit('hitClaim', { victimId: hit.id, part: hit.part, weaponId: 'hawser', dist: hit.dist, kind: ev.kind === 'stab' ? 'stab' : 'slash', t: performance.now(), point: hit.point, origin: r3(eye) });
  }

  function localThrow(ev) {
    if (!nades) return;
    const st = player.state;
    const eye = player.getEye();
    const fwd = player.getAimDir();
    const gid = `${local.id}#${++grenadeSeq}`;
    const g0 = nades.throwFrom({ eye, forward: fwd, speed: ev.speed, pitchUp: ev.pitchUp, fuse: ev.fuse, owner: local.id, inherit: st.vel, inheritScale: 0.5, id: gid });
    // 보낼 값(반올림)과 내가 시뮬레이션하는 값을 똑같이 → 모든 클라이언트가 같은 궤적
    const pos = r3(g0.pos), vel = r3(g0.vel);
    nades.remove(gid);
    nades.spawn(pos, vel, { owner: local.id, fuse: g0.fuse, id: gid });
    emit('grenade', { id: local.id, grenadeId: gid, pos, vel, fuse: g0.fuse, t: performance.now(), kind: ev.kind });
  }

  /* ---------- 수류탄 ---------- */
  function onGrenadeEvent(e) {
    if (e.type === 'bounce') { play('grenade_bounce', { pos: e.pos, gain: Math.min(1, num(e.speed, 2) / 6) }); return; }
    if (e.type !== 'explode') return;
    const c = arr3(e.pos);
    fx.explosion(c, { radius: WEAPONS.bunker.explosion.radius });
    play('explosion', { pos: c });
    const targets = [];
    // 앉은 사람은 판정점(다리·몸·머리)도 낮다 → height = 앉은 키 1.25 m
    if (local.spawned && local.alive) targets.push({ id: local.id, pos: player.state.pos, height: player.state.crouch ? CROUCH_H : PLAYER.HEIGHT });
    for (const a of actors.values()) if (a.alive && a.state) targets.push({ id: a.id, pos: a.state.pos, height: a.state.crouch ? CROUCH_H : PLAYER.HEIGHT });
    const res = nades ? nades.explosionDamage(c, targets) : [];
    const victims = [];
    for (const r of res) if (r.damage > 0) victims.push({ id: r.id, dmg: r.damage, dist: round2(r.dist) });
    if (e.owner === local.id) protectUntil = 0;   // 수류탄 피해 주장도 '먼저 공격' → 보호 끝(match 규칙과 같게)
    emit('explosion', { ownerId: e.owner, local: e.owner === local.id, grenadeId: e.id, center: { x: c[0], y: c[1], z: c[2] }, pos: r3(c), victims });
  }

  function actorGrenade(o = {}) {
    if (!nades || !o) return null;
    const gid = o.grenadeId != null ? String(o.grenadeId) : `${o.id}#r${++grenadeSeq}`;
    if (nades.list().some((g) => g.id === gid)) return null;   // 중복 수신
    const fuse = num(o.fuse, WEAPONS.bunker.fuse);
    const g = nades.spawn(arr3(o.pos), arr3(o.vel), { owner: o.id != null ? String(o.id) : null, fuse, id: gid });
    // 늦게 받은 만큼 앞당기기(폭발 직전까지만)
    const lag = Number.isFinite(o.t) ? (performance.now() - o.t) / 1000 : 0;
    if (g && lag > 0.02) {
      let left = Math.min(lag, Math.max(0, fuse - 0.1));
      const sweep = map && map.world ? map.world.sphereSweep : null;
      while (left > 1e-4) {
        const h = Math.min(0.25, left);
        stepGrenade(g, h, sweep, { style: nades.sweepStyle, physics: GRENADE_PHYSICS, floorY: 0 });
        left -= h;
      }
    }
    return gid;
  }

  function drawGrenades() {
    const list = nades ? nades.list() : [];
    for (let i = 0; i < list.length; i++) {
      const g = list[i], m = nadeMesh(i);
      m.visible = true;
      m.position.set(g.pos[0], g.pos[1], g.pos[2]);
      if (!g.sleeping) m.rotation.set(g.age * 9, 0, g.age * 5.5);
    }
    for (let i = list.length; i < nadeMeshes.length; i++) nadeMeshes[i].visible = false;
  }

  /* ---------- 액터(원격·봇) ---------- */
  function addActor(o = {}) {
    const id = o.id != null ? String(o.id) : '';
    if (!id || id === local.id) return null;
    const team = o.team === 'owner' || o.team === 'charterer' ? o.team : mode === 'ffa' ? null : 'charterer';
    let a = actors.get(id);
    if (!a) {
      a = { id, name: String(o.name || id), team, kind: o.kind === 'bot' ? 'bot' : 'remote', alive: true, state: null, step: 0, last: null, protectUntil: 0 };
      actors.set(id, a);
    } else {
      if (o.name) a.name = String(o.name);
      a.team = team;
      if (o.kind) a.kind = o.kind === 'bot' ? 'bot' : 'remote';
    }
    refreshAvatar(a);
    return a;
  }
  function removeActor(id) {
    const k = String(id);
    const old = actors.get(k);
    if (old) stopSound(old.emoteSnd);
    actors.delete(k);
    avatars.remove(k);
    if (spec.id === k) spec.id = null;
  }
  function clearActors() { for (const id of Array.from(actors.keys())) removeActor(id); }

  function setActorState(id, s) {
    if (!s || !s.pos) return;
    const a = actors.get(String(id)) || addActor({ id, name: s.name, team: s.team });
    if (!a) return;
    const p = arr3(s.pos);
    const alive = s.alive !== false;
    const crouch = !!s.crouch;
    const emote = alive ? emoteCode(s.emote) : 0;
    // crouch → core 아바타가 앉은 자세로 그리고, 히트 대상(getTargets)에도 실린다. emote → core 아바타 리그가 재생
    const snap = { pos: p, yaw: num(s.yaw), pitch: num(s.pitch), alive, moving: !!s.moving, crouch, emote };
    const av = avatars.get(a.id);
    const now = performance.now();
    if (alive && (s.teleport || !a.alive || (av && av.death))) {
      avatars.teleport(a.id, snap, now);
      a.last = null; a.step = 0;
    } else {
      avatars.push(a.id, now, snap);
    }
    a.alive = alive;
    if (s.protect !== undefined) {
      const on = !!s.protect && alive;
      if (on !== (a.protectUntil > now)) { a.protectUntil = on ? Infinity : 0; refreshAvatar(a); }
    }
    // 3D 발소리: 걷는 중(Shift 걷기는 조용, 앉아 걷기는 작게), 바닥에 있을 때
    if (alive && a.last && s.onGround !== false && !s.walking) {
      const d = Math.hypot(p[0] - a.last[0], p[2] - a.last[2]);
      const stride = crouch ? 1.6 : 2.1;
      if (d < 2.5) { a.step += d; if (a.step >= stride) { a.step = 0; footstep(p, crouch ? 0.35 : 0.9); } }
    }
    a.last = p;
    a.state = { pos: p, yaw: snap.yaw, pitch: snap.pitch, alive, moving: snap.moving, walking: !!s.walking, crouch, emote, onGround: s.onGround !== false, hp: s.hp };
    if (emote !== (a.emote || 0)) {                // 원격 이모트 소리(3D, 작게): 바뀔 때만 시작·정지
      stopSound(a.emoteSnd);
      a.emoteSnd = emote ? emoteSound(emote, [p[0], p[1] + 1.2, p[2]]) : null;
      a.emote = emote;
    } else if (a.emoteSnd && typeof a.emoteSnd.setPos === 'function') {
      a.emoteSnd.setPos([p[0], p[1] + 1.2, p[2]]);  // 보간 위치를 따라간다(fx 권장)
    }
  }

  function actorDeath(id, info = {}) {
    const a = actors.get(String(id));
    if (!a) return;
    a.alive = false;
    stopSound(a.emoteSnd); a.emoteSnd = null; a.emote = 0;
    let dir = null;
    if (info && info.dir) { const d = info.dir; dir = [num(d[0]), num(d[d.length === 3 ? 2 : 1])]; }
    const av = avatars.get(a.id);
    if (av) av.kill({ dir });
    if (a.state) {
      a.state.alive = false;
      avatars.push(a.id, performance.now(), { pos: a.state.pos, yaw: a.state.yaw, pitch: 0, alive: false, deathDir: dir });
    }
    if (spec.id === a.id) spec.id = null;
  }

  function actorFire(o = {}) {
    if (!active || !o) return;
    const w = o.weaponId;
    const origin = arr3(o.origin);
    const d = norm3(arr3(o.dir));
    if (w === 'hawser') { play('knife_slash', { pos: origin }); return; }
    const kind = FX_KIND[w] || 'rifle';
    const yaw = Math.atan2(-d[0], -d[2]);
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);
    const muzzle = [origin[0] + d[0] * 0.75 + rx * 0.12, origin[1] + d[1] * 0.75 - 0.2, origin[2] + d[2] * 0.75 + rz * 0.12];
    fx.muzzleFlash(muzzle, d, kind);
    const def = getDef(w);
    const range = (def && def.maxRange) || 250;
    const end = o.hitPoint ? arr3(o.hitPoint) : [origin[0] + d[0] * range, origin[1] + d[1] * range, origin[2] + d[2] * range];
    fx.tracer(muzzle, end, kind);
    if (o.hitPoint) {
      if (o.hitKind === 'player') {
        // 내가 맞은 탄은 퍼프를 생략(눈앞을 가린다). victimId가 없으면 카메라와의 거리로 판단
        const cp = R.camera.position;
        const nearMe = Math.hypot(end[0] - cp.x, end[1] - cp.y, end[2] - cp.z) < 1.5;
        if (String(o.victimId) !== local.id && !nearMe) fx.impact(end, [-d[0], -d[1], -d[2]], 'player');
      } else {
        let n = o.normal ? arr3(o.normal) : null, mat = o.mat || null;
        if ((!n || !mat) && map) {
          const h = raycastWorld(map.world, [end[0] - d[0] * 0.3, end[1] - d[1] * 0.3, end[2] - d[2] * 0.3], d, 0.6);
          if (h) { n = n || h.normal; mat = mat || h.mat; }
        }
        if (n) fx.impact(end, n, mat || 'concrete');
      }
    }
    play(FIRE_SOUND[w] || 'rifle', { pos: muzzle });
  }

  /* ---------- 피드백 · 라운드 ---------- */
  function feedbackDamage(o = {}) {
    if (!o) return;
    const incoming = o.incoming === true || (o.incoming !== false && o.attackerPos != null);
    if (incoming) {
      if (ui && o.attackerPos) {
        const a = arr3(o.attackerPos), s = player.state;
        ui.hud.damageFrom(relativeAngle({ x: s.pos[0], z: s.pos[2] }, s.yaw, { x: a[0], z: a[2] }));
      }
      return;
    }
    if (ui) ui.hud.hitmarker(!!o.head, !!o.kill);
    play(o.kill ? 'kill' : o.head ? 'headshot' : 'hit_marker');
  }

  function setRound(o = {}) {
    if (!o) return;
    if (o.phase !== undefined) rnd.phase = o.phase;
    // 교전 중이 아닐 때(로드아웃·라운드 끝 등) 미뤄 둔 자동 그래픽 품질 변경을 적용한다
    if (o.phase !== undefined && o.phase !== 'live' && ctx.renderer.applyPendingQuality) ctx.renderer.applyPendingQuality();
    if (o.round !== undefined) rnd.round = num(o.round) | 0;
    if ((o.mode === 'ffa' || o.mode === 'team') && o.mode !== mode) setMode(o.mode);
    if (mode === 'ffa') {
      // 개인전 점수: 평평한 필드 또는 score:{...} — { kills, rank, total, leaderName, leaderKills, target }
      const src = o.score && typeof o.score === 'object' ? o.score : o;
      if (FFA_KEYS.some((k) => src[k] !== undefined)) {
        const f = rnd.ffa || {};
        const pick = (k, conv, d) => (src[k] !== undefined ? conv(src[k]) : f[k] !== undefined ? f[k] : d);
        const int = (v) => Math.max(0, num(v) | 0);
        rnd.ffa = {
          mode: 'ffa', kills: pick('kills', int, 0), rank: pick('rank', int, undefined), total: pick('total', int, undefined),
          leaderName: pick('leaderName', (v) => String(v == null ? '' : v), ''), leaderKills: pick('leaderKills', int, 0),
          target: src.target !== undefined || src.killTarget !== undefined ? int(src.target ?? src.killTarget) || 20 : f.target || 20
        };
      }
    } else if (o.score) rnd.score = { owner: num(o.score.owner) | 0, charterer: num(o.score.charterer) | 0 };
    if (o.timeLeftMs !== undefined) { rnd.timeLeftMs = o.timeLeftMs == null ? null : Math.max(0, num(o.timeLeftMs)); rnd.elapsed = 0; }
    if (o.alive) rnd.alive = { owner: num(o.alive.owner) | 0, charterer: num(o.alive.charterer) | 0 };
    if (o.teamSize) rnd.teamSize = { owner: num(o.teamSize.owner) | 0, charterer: num(o.teamSize.charterer) | 0 };
    if (o.roundsToWin) rnd.target = num(o.roundsToWin, 3);
    if (o.maxRounds) rnd.bestOf = num(o.maxRounds, 5);
  }

  /* ---------- 루프 ---------- */
  function tick(dt) {
    if (!active || !map || simPaused) return;
    clock += dt;
    runScheduled();
    const st = player.state;
    const phaseFrozen = rnd.phase === 'loadout' || rnd.phase === 'matchEnd';
    const canMove = controls && !phaseFrozen && local.spawned && local.alive;
    player.setFrozen(!canMove);
    syncLocalEmote();
    const canAct = canMove && input.enabled && !(ui && ui.needsCursor()) && !emoteLocal && !wheel.open;
    const wi = {
      fireDown: canAct && !!input.state.fire,
      firePressed: canAct && latch.fire,
      zoomDown: canAct && (rmbDown || (!input.locked && !!input.state.aim)),
      zoomToggle: canAct && latch.rmb,
      reloadPressed: canAct && latch.reload,
      slot: canAct ? latch.slot : null,
      wheel: canAct ? latch.wheel : 0
    };
    latch.fire = latch.rmb = latch.reload = false; latch.slot = null; latch.wheel = 0;
    if (local.spawned && local.alive) {
      // crouch → 탄퍼짐 ×0.8(arsenal, 크로스헤어 getHud도 같이)
      const evs = arsenal.update(dt, wi, { speed: Math.hypot(st.vel[0], st.vel[2]), onGround: st.onGround, walking: st.walking, crouch: !!st.crouch });
      for (const ev of evs) onWeaponEvent(ev);
      player.setSpeedScale(arsenal.getMoveMul());
    }
    if (nades) for (const ge of nades.update(dt)) onGrenadeEvent(ge);
  }

  function updateSpectate(dt) {
    const cam = R.camera;
    if (mode === 'ffa') { spec.name = ''; return; }   // 개인전: 아군이 없다 → 쓰러진 시점 그대로 부활 대기
    if (performance.now() - local.deadAt < SPECTATE_DELAY_MS) { spec.name = ''; return; }
    const list = [];
    for (const a of actors.values()) if (a.alive && a.state && a.team === local.team) list.push(a);
    if (!list.length) { spec.id = null; spec.name = ''; return; }
    let a = spec.id ? actors.get(spec.id) : null;
    if (!a || !a.alive || a.team !== local.team) {
      a = list[((spec.idx % list.length) + list.length) % list.length];
      spec.id = a.id;
      const av0 = avatars.get(a.id);
      spec.yaw = av0 ? av0.yaw : a.state.yaw;
    }
    spec.name = a.name;
    const av = avatars.get(a.id);
    const p = av ? av.pos : a.state.pos;
    const yaw = av ? av.yaw : a.state.yaw;
    spec.yaw = lerpAngle(spec.yaw, yaw, 1 - Math.exp(-dt * 6));
    const head = [p[0], p[1] + 1.65, p[2]];
    const bx = Math.sin(spec.yaw), bz = Math.cos(spec.yaw);       // 뒤쪽 = -전방
    const want = [bx * 3.2, 0.75, bz * 3.2];
    const L = Math.hypot(want[0], want[1], want[2]);
    const h = raycastWorld(map.world, head, want, L);
    const k = h ? Math.max(0.12, (h.dist - 0.25) / L) : 1;
    cam.position.set(head[0] + want[0] * k, head[1] + want[1] * k, head[2] + want[2] * k);
    cam.lookAt(head[0] - bx * 5, head[1] - 0.35, head[2] - bz * 5);
  }

  function frame(dt) {
    // core가 렌더를 끈 프레임에는 player.frame이 카메라를 다시 세우지 않는다 → 반동·흔들림을 더하면 누적되므로 건너뜀
    if (!active || !map || !ctx.rendering) return;
    const cam = R.camera;
    const baseFov = R.baseFov;
    syncLocalEmote();
    const third = thirdAmount();
    if (local.spawned && local.alive) vm.setVisible(!emoteLocal && third < 0.01);
    if (local.spawned && local.alive && (emoteLocal || third > 0.01)) {
      // 이모트(3인칭): 카메라는 core(player.frame)가 세운다 — 반동·줌·스코프·뷰모델 없이 기본 FOV
      if (Math.abs(cam.fov - baseFov) > 1e-3) R.setFov(baseFov);
      input.setLookScale(1);
      if (ui) ui.scope.set(0);
    } else if (local.spawned && local.alive) {
      const k = arsenal.getRecoilKick();
      cam.rotation.x += k.pitch;
      cam.rotation.y += k.yaw;
      const z = arsenal.getZoom(baseFov);
      if (Math.abs(cam.fov - z.fov) > 1e-3) R.setFov(z.fov);
      input.setLookScale(z.progress > 0 ? (z.fov / baseFov) * num(settings.get('zoomSensitivity'), 1) : 1);
      if (ui) ui.scope.set(z.scopeAmount, z.overlay === 'scope' ? z.mag : undefined);
      vm.update(dt, arsenal.getViewState(baseFov));
    } else {
      if (Math.abs(cam.fov - baseFov) > 1e-3) R.setFov(baseFov);
      input.setLookScale(1);
      if (ui) ui.scope.set(0);
      if (local.spawned) updateSpectate(dt);
    }
    const sh = fx.getShake();
    cam.rotation.x += sh.pitch;
    cam.rotation.y += sh.yaw;
    cam.rotation.z += sh.roll;
    audio.setListener(cam.position, cam.rotation.y, cam.rotation.x);
    drawGrenades();
    // 체력 낮음: 심장 박동
    const nowMs = performance.now();
    if (local.alive && player.state.hp > 0 && player.state.hp <= 25 && nowMs >= heartbeatAt) { heartbeatAt = nowMs + 900; play('low_hp_heartbeat'); }
    // 다른 사람 보호 표시(🛡) 만료
    for (const a of actors.values()) if (a.protectUntil && a.protectUntil !== Infinity && a.protectUntil <= nowMs) { a.protectUntil = 0; refreshAvatar(a); }
    hudFrame(dt);
    if (scoreboardOpen) { sbRefresh -= dt; if (sbRefresh <= 0) { sbRefresh = 0.5; showScoreboard(); } }
  }

  function lockHint() {
    if (!active || input.locked || (ctx.flags && ctx.flags.autoplay) || (ui && ui.needsCursor())) return '';
    return LOCK_HINT;
  }

  function hudFrame(dt) {
    if (!ui) return;
    if (!simPaused && rnd.timeLeftMs != null) rnd.elapsed += dt * 1000;   // 멀티는 일시정지 화면이 떠도 시간이 흐른다
    const alive = local.spawned && local.alive;
    const p = alive ? arsenal.getHud(R.baseFov) : { crosshair: false };
    // 이모트 중: 크로스헤어 숨김 + hud.emote(이름·아이콘). 휠 화면은 UI 'emotes'
    const em = alive && emoteLocal ? emoteInfo(emoteLocal) : null;
    if (em || (alive && thirdAmount() > 0.01)) p.crosshair = false;
    p.emote = em ? { id: em.id, name: em.name, icon: em.icon, loop: em.loop } : null;
    p.hp = local.spawned ? player.state.hp : 100;
    p.team = local.team;
    p.roundTime = rnd.timeLeftMs == null ? null : Math.max(0, rnd.timeLeftMs - rnd.elapsed) / 1000;
    const now = performance.now();
    if (mode === 'ffa') {
      p.score = rnd.ffa || { mode: 'ffa', kills: 0, target: 20 };
      p.respawn = respawn && !alive ? { seconds: Math.max(0, Math.ceil((respawn.at - now) / 1000)), killer: respawn.killer || undefined, weaponName: respawn.weaponName || undefined } : null;
      p.protect = alive && protectUntil > now;
    } else {
      p.score = { owner: rnd.score.owner, charterer: rnd.score.charterer, target: rnd.target, bestOf: rnd.bestOf, round: rnd.round || undefined };
      if (rnd.alive) p.alive = rnd.alive;
      if (rnd.teamSize) p.teamSize = rnd.teamSize;
      p.respawn = null;
      p.protect = false;
    }
    p.hint = lockHint() || customHint || '';
    p.spectate = !alive && local.spawned ? spec.name : '';
    ui.hud.set(p);
  }

  offs.push(ctx.onTick(tick, -90));
  offs.push(ctx.onFrame(frame, -40));
  offs.push(ctx.onFrame((dt) => { if (active) fx.update(dt); }, 500));

  /* ---------- 공개 API ---------- */
  function getLocalState() {
    const st = player.state;
    const s = player.snapshot();
    s.alive = local.spawned && local.alive && st.alive;
    s.vel = [round2(st.vel[0]), round2(st.vel[1]), round2(st.vel[2])];
    s.name = local.name;
    s.weaponId = arsenal.getWeapon().id;
    s.weapon = arsenal.serialize();
    s.kills = st.kills;
    s.deaths = st.deaths;
    s.crouch = !!st.crouch;                        // sync → protocol FLAG.crouch
    s.emote = s.alive ? emoteCode(st.emote) : 0;   // 이모트 번호(0 = 없음) → protocol 상태 플래그 6~9번 비트
    return s;
  }

  function destroy() {
    if (W.dead) return;
    W.dead = true;
    if (active) { try { unloadMap(); } catch (e) { /* ignore */ } }
    offs.forEach((o) => { try { o(); } catch (e) { /* ignore */ } });
    offs.length = 0;
    removeUnlock();
    try { vm.dispose(); } catch (e) { /* ignore */ }
    try { fx.dispose(); } catch (e) { /* ignore */ }
    try { audio.dispose(); } catch (e) { /* ignore */ }
    if (nades) nades.dispose();
    for (const m of nadeMeshes) R.scene.remove(m);
    nadeGeo.dispose(); nadeMat.dispose();
    avatars.setDelay(prevDelay);
    if (loadingEl) loadingEl.remove();
    listeners.clear();
    if (shared === W) shared = null;
  }

  const api = {
    loadMap,
    unloadMap,
    reset,
    spawnLocal,
    setLocalLoadout,
    setLocalHp,
    killLocal,
    addActor,
    removeActor,
    clearActors,
    setActorState,
    actorFire,
    actorGrenade,
    actorDeath,
    feedbackDamage,
    setRound,
    setMode,
    setRespawn,
    setProtect,
    setActorProtect,
    /** 이모트(MODES.md 4절): 휠 열기/커서/닫기(commit=시작), 내 이모트 시작·취소, 목록 */
    startEmote: startLocalEmote,
    cancelEmote: (reason) => cancelLocalEmote(reason || 'api'),
    get emotes() { return emoteList().map((e) => ({ ...e })); },
    get emoteWheelOpen() { return wheel.open; },
    get localEmote() { return emoteLocal; },
    setControlsEnabled(v) { controls = !!v; },
    setPaused(v) { simPaused = !!v; },
    setPauseOptions(o = {}) { pauseOpts = { leaveLabel: (o && o.leaveLabel) || '나가기', note: o ? o.note : undefined }; },
    setScoreboard(fn) { scoreboardProvider = typeof fn === 'function' ? fn : null; },
    setHint(text) { customHint = text ? String(text) : ''; },
    sound: (name, o) => play(name, o),
    getLocalState,
    getActor(id) { const a = actors.get(String(id)); return a ? { id: a.id, name: a.name, team: a.team, kind: a.kind, alive: a.alive, state: a.state } : null; },
    getActors() { return Array.from(actors.values(), (a) => ({ id: a.id, name: a.name, team: a.team, kind: a.kind, alive: a.alive, state: a.state })); },
    getMap: () => map,
    get active() { return active; },
    get mode() { return mode; },
    get localId() { return local.id; },
    get localTeam() { return local.team; },
    get localAlive() { return local.spawned && local.alive; },
    get paused() { return uiPaused; },
    /** 디버그·테스트용 내부 객체(읽기 전용으로 쓸 것) */
    get internals() { return { arsenal, vm, fx, audio, nades, actors, local, rnd }; }
  };

  W.handle = function handle() {
    const mine = new Set();
    let closed = false;
    W.refs++;
    return Object.assign(Object.create(api), {
      on(evt, fn) {
        const off = on(evt, fn);
        mine.add(off);
        return () => { off(); mine.delete(off); };
      },
      dispose() {
        if (closed) return;
        closed = true;
        mine.forEach((o) => o());
        mine.clear();
        W.refs--;
        if (W.refs <= 0) destroy();
      }
    });
  };
  return W;
}

export default createWorld;
