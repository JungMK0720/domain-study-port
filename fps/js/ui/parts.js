// ⚓ 항만 작전 UI — 화면 공통 부품(화면 골격, 모달 시트, 맵 카드, 키캡)
import { h, btn } from './dom.js';
import { mapIcon } from './icons.js';

/**
 * 화면 골격. show(props)는 props를 통째로 바꾸고(생략 시 유지), update(props)는 합친다.
 * render(props, { fresh, first, patch })
 */
export function makeScreen(el, { render, onShow, onHide, onDispose } = {}) {
  let props = {};
  const api = {
    el,
    visible: false,
    get props() { return props; },
    show(p) {
      if (p !== undefined) props = { ...(p || {}) };
      const first = !api.visible;
      if (first) { api.visible = true; el.hidden = false; }
      if (render) render(props, { fresh: true, first, patch: props });
      if (first && onShow) onShow(props);
    },
    update(p) {
      if (p) props = { ...props, ...p };
      if (render) render(props, { fresh: false, first: false, patch: p || {} });
    },
    hide() {
      if (!api.visible) return;
      api.visible = false;
      el.hidden = true;
      if (onHide) onHide();
    },
    dispose() {
      if (onDispose) onDispose();
      el.remove();
    },
  };
  return api;
}

/** 강판 시트(모달 내용물) */
export function sheet({ title, body, foot, onClose, cls = '' }) {
  return h('div', { class: 'po-sheet po-steel po-rivets' + (cls ? ' ' + cls : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': title, tabindex: '-1' },
    h('div', { class: 'po-hazard', 'aria-hidden': 'true' }),
    h('header', { class: 'po-sheet-head' },
      h('h2', { class: 'po-sheet-title po-stencil', text: title }),
      btn('✕', onClose, 'po-btn--icon', { 'aria-label': '닫기' })),
    h('div', { class: 'po-sheet-body' }, body),
    foot ? h('footer', { class: 'po-sheet-foot' }, foot) : null);
}

/** 화면 안의 모달 레이어. 배경 클릭·Esc로 닫힌다. */
export function createModal() {
  let opener = null;
  let onClosed = null;
  const el = h('div', { class: 'po-modal', hidden: true });
  el.addEventListener('pointerdown', (e) => { if (e.target === el) close(); });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
  });
  function open(content, cb) {
    opener = document.activeElement;
    onClosed = cb || null;
    el.replaceChildren(content);
    el.hidden = false;
    const target = content.querySelector('[data-autofocus]') || content;
    if (target.focus) target.focus({ preventScroll: true });
  }
  function close() {
    if (el.hidden) return;
    el.hidden = true;
    el.replaceChildren();
    const cb = onClosed;
    onClosed = null;
    if (cb) cb();
    if (opener && opener.isConnected && opener.focus) opener.focus({ preventScroll: true });
    opener = null;
  }
  return { el, open, close, get isOpen() { return !el.hidden; } };
}

/** 맵 선택 카드(라디오처럼 동작). onPick이 없으면 보기 전용. */
export function mapCard(m, { selected = false, onPick, small = false } = {}) {
  const kids = [
    mapIcon(m.id),
    h('span', { class: 'po-mapcard-text' },
      h('span', { class: 'po-mapcard-name', text: m.name }),
      m.nameEn ? h('span', { class: 'po-mapcard-en', text: m.nameEn }) : null,
      m.desc && !small ? h('span', { class: 'po-mapcard-desc', text: m.desc }) : null),
  ];
  const cls = 'po-mapcard' + (selected ? ' is-on' : '') + (small ? ' po-mapcard--sm' : '');
  if (!onPick) return h('div', { class: cls + ' is-static' }, kids);
  return h('button', {
    type: 'button', class: cls, role: 'radio', 'aria-checked': selected ? 'true' : 'false',
    title: m.desc || m.name, onclick: () => onPick(m.id),
  }, kids);
}

export function keycap(label) {
  return h('kbd', { class: 'po-key', text: label });
}
