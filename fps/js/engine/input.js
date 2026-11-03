/**
 * ⚓ Port Ops — 입력 (Pointer Lock · 키보드 · 마우스 · 휠)
 *
 *   const input = createInput({ element: canvas, bus, settings });
 *   input.state.forward / back / left / right / jump / walk / crouch / fire / aim / scoreboard   (boolean, 폴링용)
 *   input.consumeLook() → { dx, dy }  // 라디안 (감도·lookScale 적용됨, invertY 반영). 프레임마다 1번 호출
 *   input.requestLock() / exitLock() / isLocked()
 *   input.setLookScale(s)  // 줌 중 감도 배율 (무기 모듈)
 *   input.resetAim()       // 토글 모드 줌을 강제로 해제 (예: 저격 후 자동 줌 해제)
 *   input.setEnabled(bool) // 메뉴 등에서 게임 입력 끄기
 *
 * 키는 e.code 기준(한/영 상태와 무관): WASD(+화살표) · Space · Shift · Ctrl/C(앉기) · R · 1~4 · Tab · Esc
 * bus 이벤트: input:lock{locked} · input:fire{down} · input:aim{active,source} · input:reload · input:slot{slot}
 *            input:cycle{dir} · input:jump · input:walk{down} · input:crouch{down} · input:scoreboard{open} · input:menu{reason}
 *            input:key{code,down} (모든 키, 반복 제외)
 *
 * 앉기: 왼·오른 Ctrl 또는 C를 누르고 있는 동안. Pointer Lock 중에는 Ctrl 조합 키의 브라우저 기본 동작
 * (Ctrl+S·D·R·A·Space·휠 확대 등)을 막는다. Ctrl+W·T·N·Tab은 브라우저가 먼저 가져가서 막을 수 없다
 * → C 키를 권장하고, main.js가 경기 중 beforeunload 확인을 건다. 전체 화면(Fullscreen API)에서는
 * navigator.keyboard.lock()으로 게임 키를 잠가 Ctrl 조합도 게임이 받는다(크로뮴 계열).
 */
import { MOUSE } from '../core/consts.js';

const MOVE_KEYS = {
  KeyW: 'forward', ArrowUp: 'forward',
  KeyS: 'back', ArrowDown: 'back',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right'
};
const SLOT_KEYS = { Digit1: 1, Digit2: 2, Digit3: 3, Digit4: 4, Numpad1: 1, Numpad2: 2, Numpad3: 3, Numpad4: 4 };
const CROUCH_KEYS = new Set(['ControlLeft', 'ControlRight', 'KeyC']);
/** 전체 화면에서 Keyboard Lock으로 잡을 키(Esc는 빼서 전체 화면·잠금 해제가 그대로 되게) */
const LOCK_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyC', 'KeyR', 'Space', 'Tab', 'Digit1', 'Digit2', 'Digit3', 'Digit4',
  'ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];

function isTyping(e) {
  const t = e.target;
  if (!t || t === document.body) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
}

export function createInput({ element, bus, settings } = {}) {
  const el = element || document.body;
  const state = { forward: false, back: false, left: false, right: false, jump: false, walk: false, crouch: false, fire: false, aim: false, scoreboard: false };
  const crouchDown = new Set(); // 눌린 앉기 키(Ctrl·C 중 하나라도 눌려 있으면 앉음)
  let lookX = 0, lookY = 0;
  let locked = false;
  let enabled = true;
  let lookScale = 1;
  let lastWheel = 0;
  const emit = (evt, data) => { if (bus) bus.emit(evt, data); };
  const zoomMode = () => (settings && settings.get('zoomMode')) || 'hold';

  function setAim(active, source = 'user') {
    if (state.aim === active) return;
    state.aim = active;
    emit('input:aim', { active, source });
  }

  function syncCrouch() {
    const v = crouchDown.size > 0;
    if (state.crouch === v) return;
    state.crouch = v;
    emit('input:crouch', { down: v });
  }

  function releaseAll() {
    for (const k of ['forward', 'back', 'left', 'right', 'jump', 'walk']) state[k] = false;
    crouchDown.clear();
    syncCrouch();
    if (state.fire) { state.fire = false; emit('input:fire', { down: false }); }
    if (state.aim) setAim(false, 'release');
    if (state.scoreboard) { state.scoreboard = false; emit('input:scoreboard', { open: false }); }
    lookX = lookY = 0;
  }

  function onKeyDown(e) {
    if (isTyping(e)) return;
    const code = e.code;
    if (!e.repeat) emit('input:key', { code, down: true });
    if (code === 'Escape') {
      if (!locked) emit('input:menu', { reason: 'esc' });
      return;
    }
    if (code === 'Tab') {
      e.preventDefault();
      if (enabled && !state.scoreboard) { state.scoreboard = true; emit('input:scoreboard', { open: true }); }
      return;
    }
    if (!enabled) return;
    // 게임 중 Ctrl 조합(앉아서 움직이기 등)은 브라우저 기본 동작을 막는다(막을 수 있는 것만: Ctrl+W·T·N·Tab은 불가)
    if (locked && e.ctrlKey) e.preventDefault();
    if (CROUCH_KEYS.has(code)) { crouchDown.add(code); syncCrouch(); return; }
    const mv = MOVE_KEYS[code];
    if (mv) { state[mv] = true; if (locked) e.preventDefault(); return; }
    if (e.repeat) { if (code === 'Space') e.preventDefault(); return; }
    if (code === 'Space') { e.preventDefault(); state.jump = true; emit('input:jump', {}); return; }
    if (code === 'ShiftLeft' || code === 'ShiftRight') { state.walk = true; emit('input:walk', { down: true }); return; }
    if (code === 'KeyR') { emit('input:reload', {}); return; }
    const slot = SLOT_KEYS[code];
    if (slot) { emit('input:slot', { slot }); return; }
  }

  function onKeyUp(e) {
    const code = e.code;
    emit('input:key', { code, down: false });
    if (code === 'Tab') {
      e.preventDefault();
      if (state.scoreboard) { state.scoreboard = false; emit('input:scoreboard', { open: false }); }
      return;
    }
    if (CROUCH_KEYS.has(code)) { crouchDown.delete(code); syncCrouch(); return; }
    const mv = MOVE_KEYS[code];
    if (mv) { state[mv] = false; return; }
    if (code === 'Space') { state.jump = false; return; }
    if (code === 'ShiftLeft' || code === 'ShiftRight') {
      if (state.walk) { state.walk = false; emit('input:walk', { down: false }); }
    }
  }

  function onMouseMove(e) {
    if (!locked || !enabled) return;
    const mx = e.movementX || 0, my = e.movementY || 0;
    // 일부 브라우저의 Pointer Lock 튐 현상 무시
    if (Math.abs(mx) > 400 || Math.abs(my) > 400) return;
    lookX += mx; lookY += my;
  }

  function onMouseDown(e) {
    if (!locked || !enabled) return;
    if (e.button === 0) {
      if (!state.fire) { state.fire = true; emit('input:fire', { down: true }); }
    } else if (e.button === 2) {
      if (zoomMode() === 'toggle') setAim(!state.aim);
      else setAim(true);
    }
    e.preventDefault();
  }

  function onMouseUp(e) {
    if (e.button === 0) {
      if (state.fire) { state.fire = false; emit('input:fire', { down: false }); }
    } else if (e.button === 2) {
      if (zoomMode() !== 'toggle') setAim(false);
    }
  }

  function onWheel(e) {
    if (!locked || !enabled) return;
    e.preventDefault();
    const now = performance.now();
    if (now - lastWheel < 110 || Math.abs(e.deltaY) < 1) return;
    lastWheel = now;
    emit('input:cycle', { dir: e.deltaY > 0 ? 1 : -1 });
  }

  function onContextMenu(e) { e.preventDefault(); }

  function onLockChange() {
    const now = document.pointerLockElement === el;
    if (now === locked) return;
    locked = now;
    if (!locked) releaseAll();
    emit('input:lock', { locked });
    if (!locked) emit('input:menu', { reason: 'unlock' });
  }
  function onLockError() {
    emit('input:lock-error', {});
  }

  function onBlur() { releaseAll(); }

  // 전체 화면(Fullscreen API)일 때만 Keyboard Lock 사용 가능 → Ctrl+W 같은 조합도 게임이 받는다
  function onFullscreenChange() {
    const kb = navigator.keyboard;
    if (!kb || typeof kb.lock !== 'function') return;
    if (document.fullscreenElement) {
      try { const p = kb.lock(LOCK_KEYS); if (p && p.catch) p.catch(() => {}); } catch (err) { /* 미지원 */ }
    } else {
      try { kb.unlock(); } catch (err) { /* ignore */ }
    }
  }

  /** 사용자 제스처(클릭) 안에서 호출해야 한다. 결과는 pointerlockchange → input:lock 으로도 온다 */
  function requestLock() {
    if (locked) return Promise.resolve(true);
    if (!el.requestPointerLock) return Promise.resolve(false);
    let p;
    try { p = el.requestPointerLock({ unadjustedMovement: true }); }
    catch (err) {
      try { p = el.requestPointerLock(); } catch (err2) { return Promise.resolve(false); }
    }
    if (p && typeof p.then === 'function') {
      return p.then(() => true, (err) => {
        // unadjustedMovement 미지원 → 일반 모드로 재시도
        if (err && err.name === 'NotSupportedError') {
          try {
            const p2 = el.requestPointerLock();
            if (p2 && typeof p2.then === 'function') return p2.then(() => true, () => false);
          } catch (e3) { /* ignore */ }
        }
        return false;
      });
    }
    return Promise.resolve(false);
  }

  function exitLock() {
    if (document.pointerLockElement === el && document.exitPointerLock) document.exitPointerLock();
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mouseup', onMouseUp);
  document.addEventListener('wheel', onWheel, { passive: false });
  el.addEventListener('contextmenu', onContextMenu);
  document.addEventListener('contextmenu', onContextMenuIfLocked);
  document.addEventListener('pointerlockchange', onLockChange);
  document.addEventListener('pointerlockerror', onLockError);
  window.addEventListener('blur', onBlur);
  document.addEventListener('fullscreenchange', onFullscreenChange);

  function onContextMenuIfLocked(e) { if (locked) e.preventDefault(); }

  return {
    state,
    get locked() { return locked; },
    isLocked: () => locked,
    isDown: (name) => !!state[name],
    /** 누적된 마우스 이동(라디안)을 꺼내고 0으로 */
    consumeLook() {
      const sens = MOUSE.BASE_SENS * ((settings && settings.get('sensitivity')) || 1) * lookScale;
      const inv = settings && settings.get('invertY') ? -1 : 1;
      const out = { dx: lookX * sens, dy: lookY * sens * inv };
      lookX = lookY = 0;
      return out;
    },
    /** 테스트·봇용: 인위적으로 시점 이동(픽셀 단위) */
    addLook(px, py) { lookX += px; lookY += py; },
    setLookScale(s) { lookScale = Number.isFinite(s) && s > 0 ? s : 1; },
    getLookScale: () => lookScale,
    resetAim() { setAim(false, 'reset'); },
    setAim,
    requestLock,
    exitLock,
    setEnabled(v) { enabled = !!v; if (!enabled) releaseAll(); },
    get enabled() { return enabled; },
    releaseAll,
    dispose() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('wheel', onWheel);
      el.removeEventListener('contextmenu', onContextMenu);
      document.removeEventListener('contextmenu', onContextMenuIfLocked);
      document.removeEventListener('pointerlockchange', onLockChange);
      document.removeEventListener('pointerlockerror', onLockError);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      exitLock();
    }
  };
}
