/**
 * ⚓ Port Ops — 부트스트랩 · 화면 상태 머신 · 플러그인 로더
 *
 * 화면: menu | sandbox | lobby | room | match | results
 *   - core가 구현: menu(기본 메뉴), sandbox(연습장)
 *   - 나머지는 플러그인이 ctx.registerScreen(name, { enter(params, from), exit(to) })로 등록한다.
 *     등록되지 않은 화면으로 가려 하면 'screen:unavailable' {name}을 발행하고 그대로 머문다.
 *
 * 플러그인: js/{ui,net,game}/index.js 가 `export function install(ctx)`를 내보내면 부팅 때 순서대로 호출.
 *   (무기·FX·UI·연습장·멀티 연결은 game/index.js 한곳에서 한다 — game/WORLD_API.md)
 *   install(ctx) → { provides?: string[], dispose?() } (Promise 가능)
 *   provides: 'weapons'(임시 총 끔) · 'menu'(기본 메뉴·오버레이 끔) · 'hud'(기본 HUD 끔)
 *   다른 이름으로 된 진입점(createUI, connect …)은 자동으로 부르지 않는다 — 접착 코드는 install 안에서.
 *
 * URL: ?sandbox=<mapId>  메뉴 없이 연습장 · &debug=1  window.__portops = ctx, 성능 표시
 *      &plugins=0  플러그인 끄기 · &autoplay=1  (자동 테스트용) 포인터 잠금 없이도 입력·화면 진행
 */
import * as THREE from 'three';
import * as consts from './core/consts.js';
import { bus } from './core/bus.js';
import { createSettings } from './core/settings.js';
import * as physics from './engine/physics.js';
import * as materials from './engine/materials.js';
import { createRenderer } from './engine/renderer.js';
import { createInput } from './engine/input.js';
import { createLoop } from './engine/loop.js';
import { createLocalPlayer } from './engine/player.js';
import { createAvatars } from './engine/avatars.js';
import { createSandbox } from './engine/sandbox.js';
import { createDevGun } from './engine/devgun.js';
import { createFallbackMenu, createFallbackHud } from './engine/fallback-ui.js';
import { buildMap } from './maps/builder.js';

const params = new URLSearchParams(location.search);
const FLAGS = {
  debug: params.has('debug') && params.get('debug') !== '0',
  autoplay: params.has('autoplay') && params.get('autoplay') !== '0',
  plugins: params.get('plugins') !== '0',
  sandbox: params.get('sandbox') || null,
  devgun: false
};
// weapons·fx는 index.js 없이 game/index.js(World)가 직접 엮는다 → 여기서 불러 보면 404만 남고, 나중에 install이 생기면 두 번 엮인다
const PLUGIN_NAMES = ['ui', 'net', 'game'];
const GAME_SCREENS = new Set(['sandbox', 'match']);

function sessionId() {
  const make = () => 'p' + Math.random().toString(36).slice(2, 10);
  try {
    let id = sessionStorage.getItem('portops.pid');
    if (!id || !/^[A-Za-z0-9_-]{1,40}$/.test(id)) { id = make(); sessionStorage.setItem('portops.pid', id); }
    return id;
  } catch (e) { return make(); }
}

function resolveName(settings) {
  const lb = window.Leaderboard;
  let n = '';
  try { const s = lb && lb.getSession && lb.getSession(); n = (s && s.name) || ''; } catch (e) { /* ignore */ }
  if (!n) n = settings.get('name') || '';
  if (!n) { try { n = (lb && lb.getLastName && lb.getLastName()) || ''; } catch (e) { /* ignore */ } }
  if (!n) n = '작업자' + Math.floor(100 + Math.random() * 900);
  return String(n).trim().slice(0, 12);
}

const nextFrame = () => new Promise((res) => {
  let done = false;
  const fin = () => { if (!done) { done = true; res(); } };
  requestAnimationFrame(fin);
  setTimeout(fin, 60);
});

function fatal(msg, err) {
  console.error('[portops]', msg, err || '');
  const ui = document.getElementById('pc-ui') || document.body;
  const box = document.createElement('div');
  box.className = 'core-fatal';
  const h = document.createElement('h2');
  h.textContent = '⚓ 항만 작전을 시작할 수 없어요';
  const p = document.createElement('p');
  p.textContent = msg;
  box.append(h, p);
  if (err) { const pre = document.createElement('pre'); pre.textContent = String((err && err.stack) || err); box.append(pre); }
  ui.append(box);
}

async function boot() {
  const app = document.getElementById('pc-app');
  const view = document.getElementById('pc-view');
  const uiRoot = document.getElementById('pc-ui');
  const settings = createSettings(bus);

  let renderer;
  try { renderer = createRenderer({ container: view, settings, bus }); }
  catch (err) { fatal('3D(WebGL)를 쓸 수 없어요. 브라우저의 하드웨어 가속을 켜거나 다른 브라우저로 열어 주세요.', err); return; }

  const input = createInput({ element: renderer.domElement, bus, settings });
  input.setEnabled(false);
  const loop = createLoop({ tickRate: consts.TICK_RATE, bus });
  const avatars = createAvatars({ scene: renderer.scene, camera: renderer.camera });
  let map = null;
  const player = createLocalPlayer({ bus, input, camera: renderer.camera, getWorld: () => (map ? map.world : null) });
  const session = { id: sessionId(), name: resolveName(settings) };
  player.state.id = session.id;
  player.state.name = session.name;

  const maps = await import('./maps/index.js');

  const screens = new Map();
  const plugins = [];
  const provided = new Set();
  const targetProviders = new Set();
  let screen = null;
  let queue = Promise.resolve();
  let loading = false;
  let rendering = false;
  let sandbox = null, devgun = null;

  /* ---------------- 맵 ---------------- */
  function unloadMap() {
    if (!map) return;
    const id = map.id;
    map.dispose();
    map = null;
    bus.emit('map:unload', { id });
  }

  async function loadMap(id) {
    const data = maps.getMap(id) || maps.TEST_MAP;
    loading = true;
    bus.emit('map:loading', { id });
    unloadMap();
    await nextFrame();
    await nextFrame();
    try {
      const t0 = performance.now();
      const built = buildMap(data, renderer.scene, { onWarn: (m) => console.warn(`[map:${id}]`, m) });
      renderer.setTheme(built.theme);
      map = built;
      try { if (renderer.three.compileAsync) await renderer.three.compileAsync(renderer.scene, renderer.camera); } catch (e) { /* 미지원 브라우저 */ }
      loading = false;
      console.info(`[map:${id}] built in ${Math.round(performance.now() - t0)} ms`, built.stats, built.warnings.length ? built.warnings : '');
      bus.emit('map:loaded', { id, data, map: built });
      return built;
    } catch (err) {
      loading = false;
      bus.emit('map:error', { id, message: (err && err.message) || String(err), error: err });
      throw err;
    }
  }

  /* ---------------- 사격 판정 도우미 ---------------- */
  function getTargets() {
    const out = avatars.getTargets();
    for (const fn of targetProviders) {
      try { const extra = fn(); if (extra && extra.length) out.push(...extra); } catch (e) { console.error('[targets]', e); }
    }
    return out;
  }
  function addTargets(fn) { targetProviders.add(fn); return () => targetProviders.delete(fn); }
  function traceShot(origin, dir, maxDist = 1000, opts = null) {
    return physics.traceShot(map ? map.world : null, origin, dir, maxDist, getTargets(), opts);
  }
  function raycastWorld(origin, dir, maxDist = 1000, opts = null) {
    return map ? physics.raycastWorld(map.world, origin, dir, maxDist, opts) : null;
  }

  function setPlayerName(name) {
    const n = String(name || '').trim().slice(0, 12);
    if (!n) return session.name;
    session.name = n;
    player.state.name = n;
    settings.set('name', n);
    bus.emit('player:name', { id: session.id, name: n });
    return n;
  }

  /* ---------------- 화면 상태 머신 ---------------- */
  function registerScreen(name, handler) {
    if (!consts.SCREENS.includes(name)) throw new Error('unknown screen: ' + name);
    screens.set(name, handler || {});
    return () => { if (screens.get(name) === handler) screens.delete(name); };
  }

  async function doSetScreen(name, params = {}) {
    if (!consts.SCREENS.includes(name)) throw new Error('unknown screen: ' + name);
    const handler = screens.get(name);
    if (!handler) { bus.emit('screen:unavailable', { name, params }); return false; }
    const from = screen;
    const prev = from ? screens.get(from) : null;
    if (prev && prev.exit) {
      try { await prev.exit(name); } catch (err) { console.error(`[screen] ${from}.exit`, err); }
    }
    screen = name;
    bus.emit('screen:change', { from, to: name, params });
    if (handler.enter) {
      try { await handler.enter(params, from); }
      catch (err) {
        console.error(`[screen] ${name}.enter 실패`, err);
        bus.emit('app:error', { message: `${name} 화면을 열지 못했어요: ${(err && err.message) || err}` });
        if (name !== 'menu') await doSetScreen('menu');
        return false;
      }
    }
    return true;
  }
  /** 화면 전환(직렬화: 연타해도 순서대로 하나씩) */
  function setScreen(name, params) {
    const p = queue.then(() => doSetScreen(name, params));
    queue = p.catch(() => {});
    return p;
  }

  registerScreen('menu', {
    enter() {
      input.exitLock();
      input.setEnabled(false);
      rendering = false;
    }
  });

  registerScreen('sandbox', {
    async enter(params = {}) {
      const mapId = params.mapId || 'testyard';
      await loadMap(mapId);
      player.state.team = 'owner';
      player.state.kills = player.state.deaths = 0;
      avatars.setLocalTeam('owner');
      const spawns = map.spawns.owner;
      player.spawn(spawns[params.spawn | 0] || spawns[0]);
      renderer.setFov(renderer.baseFov);
      input.setLookScale(1);
      sandbox = createSandbox(ctx);
      if (!provided.has('weapons')) { devgun = createDevGun(ctx); FLAGS.devgun = true; }
      input.setEnabled(input.locked || FLAGS.autoplay); // 잠금 전(클릭 전)·일시정지 중에는 조작 안 받음
      rendering = true;
      bus.emit('sandbox:start', { mapId, map });
    },
    exit() {
      bus.emit('sandbox:end', {});
      if (devgun) { devgun.dispose(); devgun = null; FLAGS.devgun = false; }
      if (sandbox) { sandbox.dispose(); sandbox = null; }
      avatars.clear();
      input.exitLock();
      input.setEnabled(false);
      input.setLookScale(1);
      renderer.setFov(renderer.baseFov);
      rendering = false;
      unloadMap();
    }
  });

  /** 전체 화면(Fullscreen API). 들어가면 input이 Keyboard Lock을 걸어 Ctrl+W 같은 조합도 게임이 받는다(크로뮴). 클릭 핸들러 안에서 부를 것 */
  function enterFullscreen() {
    const el = app || document.documentElement;
    if (document.fullscreenElement) return Promise.resolve(true);
    if (!el.requestFullscreen) return Promise.resolve(false);
    try { return el.requestFullscreen({ navigationUI: 'hide' }).then(() => true, () => false); }
    catch (err) { return Promise.resolve(false); }
  }
  function exitFullscreen() {
    if (!document.fullscreenElement || !document.exitFullscreen) return Promise.resolve();
    return document.exitFullscreen().catch(() => {});
  }

  /* ---------------- ctx ---------------- */
  const ctx = {
    version: consts.VERSION,
    THREE, bus, consts, settings, physics, materials,
    renderer, input, loop, player, avatars, maps,
    flags: FLAGS,
    session,
    ui: { root: uiRoot, app },
    plugins, provided,
    get map() { return map; },
    get world() { return map ? map.world : null; },
    get screen() { return screen; },
    get loading() { return loading; },
    get sandbox() { return sandbox; },
    get devgun() { return devgun; },
    get rendering() { return rendering; },
    setRendering(v) { rendering = !!v; },
    setScreen, registerScreen,
    loadMap, unloadMap, buildMap,
    getTargets, addTargets, traceShot, raycastWorld,
    setPlayerName,
    enterFullscreen, exitFullscreen,
    onTick: (fn, order) => loop.onTick(fn, order),
    onFrame: (fn, order) => loop.onFrame(fn, order)
  };

  /* ---------------- 루프 ---------------- */
  loop.onTick((dt) => { if (map) player.tick(dt); }, -100);
  loop.onFrame((dt, alpha) => { if (rendering && map) player.frame(dt, alpha); }, -100);
  loop.onFrame((dt, alpha, now) => {
    if (!rendering || !map) return;
    avatars.update(now, dt);
    map.update(dt, now / 1000);
  }, -50);
  loop.onFrame((dt) => {
    if (!rendering || !map) return;
    const p = player.state.pos;
    renderer.setShadowFocus(p[0], p[1], p[2]);
    renderer.update(dt);
    renderer.render();
  }, 1000);

  // 캔버스 클릭 → 포인터 잠금 (게임 화면에서)
  renderer.domElement.addEventListener('click', () => {
    if (GAME_SCREENS.has(screen) && !input.locked) input.requestLock();
  });
  // 게임 화면에서는 포인터 잠금 = 조작 가능 (autoplay 테스트 모드는 잠금 없이도 허용)
  bus.on('input:lock', (e) => { if (GAME_SCREENS.has(screen)) input.setEnabled(e.locked || FLAGS.autoplay); });
  // Ctrl+W(탭 닫기)는 페이지가 막을 수 없다(앉기 = Ctrl) → 연습장·경기 화면에 있는 동안은 닫기 전에 확인을 받는다
  window.addEventListener('beforeunload', (e) => {
    if (!GAME_SCREENS.has(screen) || FLAGS.autoplay) return undefined;
    e.preventDefault();
    e.returnValue = '';
    return '';
  });

  /* ---------------- 플러그인 ---------------- */
  if (FLAGS.plugins) {
    const results = await Promise.allSettled(PLUGIN_NAMES.map((n) => import(`./${n}/index.js`)));
    for (let i = 0; i < PLUGIN_NAMES.length; i++) {
      const name = PLUGIN_NAMES[i], r = results[i];
      if (r.status !== 'fulfilled') { console.info(`[plugin] ${name}/index.js 없음 → core 기본 동작`); continue; }
      const mod = r.value;
      if (typeof mod.install !== 'function') { console.info(`[plugin] ${name}/index.js에 install(ctx)가 없어 건너뜀`); continue; }
      try {
        const res = (await mod.install(ctx)) || {};
        const provides = Array.isArray(res.provides) ? res.provides.map(String) : [];
        provides.forEach((p) => provided.add(p));
        plugins.push({ name, api: res, provides });
        bus.emit('plugin:loaded', { name, provides });
      } catch (err) {
        console.error(`[plugin] ${name} install 실패 → 건너뜀`, err);
        bus.emit('plugin:failed', { name, message: String((err && err.message) || err) });
      }
    }
  }
  const fallback = [];
  if (!provided.has('menu')) fallback.push(createFallbackMenu(ctx));
  if (!provided.has('hud')) fallback.push(createFallbackHud(ctx));

  if (FLAGS.debug) window.__portops = ctx;

  window.addEventListener('pagehide', (e) => {
    if (e.persisted) return;
    try { if (screen && screens.get(screen) && screens.get(screen).exit) screens.get(screen).exit(null); } catch (err) { /* ignore */ }
    for (const p of plugins) { try { p.api && p.api.dispose && p.api.dispose(); } catch (err) { /* ignore */ } }
    fallback.forEach((f) => f.dispose());
    loop.dispose();
    input.dispose();
    player.dispose();
    avatars.dispose();
    renderer.dispose();
  });

  loop.start();
  bus.emit('app:ready', { ctx });
  await setScreen('menu');
  if (FLAGS.sandbox) await setScreen('sandbox', { mapId: FLAGS.sandbox });
  return ctx;
}

boot().catch((err) => fatal('초기화 중 오류가 났어요.', err));
