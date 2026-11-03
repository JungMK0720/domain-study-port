/**
 * ⚓ Port Ops — game 플러그인: UI · World(무기·FX·오디오) · 연습장 봇전 · 멀티 세션을 한곳에서 엮는다.
 *
 * main.js가 부팅 때 install(ctx)를 부른다(CORE_API 3절). provides로 core 임시 총·기본 메뉴·기본 HUD를 끈다.
 *   - UI: createUI(ctx.ui.root, { settings: ctx.settings }) — 앱에 하나. 메뉴는 core 'menu' 화면에 맞춰 띄운다.
 *   - World: createWorld({ ctx, ui }) — 연습장과 멀티가 같은 것을 쓴다(./WORLD_API.md).
 *   - 연습장: core 'sandbox' 화면을 practice.js로 바꿔 등록한다(?sandbox=<mapId>도 그대로 동작).
 *   - 멀티: '🌐 멀티플레이'를 처음 누를 때 ./session.js를 불러 createSession({ ctx, ui, world, settings, bus })를 만든다.
 */
import { createUI } from '../ui/index.js';
import { WEAPONS } from '../weapons/defs.js';
import { createWorld, setWorldContext } from './world.js';
import { createPractice, createPracticeSetup } from './practice.js';

const SCREEN_LABEL = { lobby: '로비', room: '대기실', match: '멀티 경기', results: '결과' };

export async function install(ctx) {
  const { bus } = ctx;
  setWorldContext(ctx);
  const ui = createUI(ctx.ui.root, { settings: ctx.settings });
  ui.setMaps(ctx.maps.MAP_LIST).setWeapons(WEAPONS);
  const world = await createWorld({ ctx, ui });
  const practice = createPractice({ ctx, world, ui });
  const offs = [];

  /* ---------- 알림(오류·준비 중) ---------- */
  const toast = document.createElement('div');
  toast.className = 'po-game-toast';
  toast.setAttribute('role', 'alert');
  Object.assign(toast.style, {
    position: 'fixed', left: '50%', bottom: '28px', transform: 'translateX(-50%)', zIndex: '9', maxWidth: '80vw',
    padding: '10px 16px', borderRadius: '10px', background: 'rgba(150, 30, 20, 0.92)', color: '#fff',
    fontWeight: '700', fontSize: '14px', pointerEvents: 'auto'
  });
  toast.hidden = true;
  ui.el.append(toast);
  let toastTimer = 0;
  function notify(text, ms = 5000) {
    toast.textContent = String(text || '');
    toast.hidden = !text;
    clearTimeout(toastTimer);
    if (text) toastTimer = setTimeout(() => { toast.hidden = true; }, ms);
  }
  toast.addEventListener('click', () => { toast.hidden = true; });

  /* ---------- 연습장 ---------- */
  offs.push(ctx.registerScreen('sandbox', {
    enter: (params) => practice.enter(params || {}),
    exit: () => practice.exit()
  }));
  const setup = createPracticeSetup({
    ui, maps: ctx.maps,
    onStart: (o) => { ctx.setScreen('sandbox', o); }
  });

  /* ---------- 멀티 세션 ----------
   * core 화면 상태가 세션을 따라가게(lobby/room/match/results) 얇은 화면을 등록한다.
   * 'match'에서만 캔버스 클릭 → 포인터 잠금 → 조작(main.js GAME_SCREENS)이 켜진다. 맵·액터는 세션이 world로 다룬다.
   * 세션은 '🌐 멀티플레이'를 누를 때 만들고, 로비에서 메뉴로 나오면 정리한다(연습장과 UI 이벤트가 섞이지 않게). */
  for (const name of ['lobby', 'room', 'match', 'results']) {
    offs.push(ctx.registerScreen(name, {
      enter() {
        if (name === 'match') { ctx.input.setEnabled(ctx.input.locked || !!(ctx.flags && ctx.flags.autoplay)); return; }
        ctx.input.exitLock();
        ctx.input.setEnabled(false);
      }
    }));
  }
  let sessionP = null;
  function closeSession() {
    const p = sessionP;
    sessionP = null;
    if (p) p.then((s) => { try { if (s && s.dispose) s.dispose(); } catch (err) { /* ignore */ } }, () => {});
  }
  function loadSession() {
    if (!sessionP) {
      sessionP = import('./session.js').then(async (mod) => {
        const make = mod.createSession || mod.default;
        if (typeof make !== 'function') throw new Error('session.js에 createSession이 없어요');
        const s = await make({ ctx, ui, world, settings: ctx.settings, bus, playerName: ctx.session.name, setScreens: true });
        if (s && typeof s.on === 'function') {
          s.on('exit', () => { closeSession(); ctx.setScreen('menu'); });
          s.on('error', (e) => console.warn('[game] session', e && e.where, e && e.error));
        }
        return s;
      });
      sessionP.catch(() => { sessionP = null; });
    }
    return sessionP;
  }
  async function openMulti() {
    try {
      const s = await loadSession();
      if (s && typeof s.open === 'function') await s.open();
      else await ctx.setScreen('lobby');
    } catch (err) {
      console.warn('[game] 멀티플레이를 열 수 없어요', err);
      closeSession();
      ui.update('menu', { multiDisabled: '멀티플레이를 열 수 없어요. 잠시 뒤 다시 시도해 주세요.' });
    }
  }

  /* ---------- 메뉴 ---------- */
  const showMenu = () => ui.show('menu', { name: ctx.session.name });
  offs.push(bus.on('screen:change', (e) => { if (e && e.to === 'menu') showMenu(); }));
  if (ctx.screen === 'menu') showMenu();
  offs.push(ui.on('menu:name', (e) => { if (e && e.name) ctx.setPlayerName(e.name); }));
  offs.push(ui.on('menu:sandbox', (e) => {
    if (e && e.name) ctx.setPlayerName(e.name);
    closeSession();
    setup.open();
  }));
  offs.push(ui.on('menu:multi', (e) => {
    if (e && e.name) ctx.setPlayerName(e.name);
    openMulti();
  }));

  offs.push(bus.on('app:error', (e) => notify((e && e.message) || '오류가 났어요')));
  offs.push(bus.on('map:error', (e) => notify(`맵을 불러오지 못했어요: ${(e && (e.message || e.id)) || ''}`)));
  offs.push(bus.on('screen:unavailable', (e) => notify(`${SCREEN_LABEL[e && e.name] || (e && e.name) || ''} 화면은 아직 준비 중이에요.`)));

  return {
    provides: ['weapons', 'menu', 'hud'],
    ui, world, practice,
    dispose() {
      offs.forEach((o) => { try { o(); } catch (err) { /* ignore */ } });
      offs.length = 0;
      clearTimeout(toastTimer);
      setup.dispose();
      if (practice.active) { try { practice.exit(); } catch (err) { /* ignore */ } }
      closeSession();
      world.dispose();
      ui.dispose();
    }
  };
}

export default install;
