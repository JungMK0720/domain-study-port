// ⚓ 항만 작전 UI — 메인 메뉴
import { h, setText } from './dom.js';
import { makeScreen, createModal } from './parts.js';
import { skyline } from './icons.js';
import { createSettingsPanel, cleanName, NAME_MAX } from './settings.js';
import { createControlsPanel } from './controls.js';

function quizSessionName() {
  try {
    const lb = window.Leaderboard;
    const s = lb && typeof lb.getSession === 'function' ? lb.getSession() : null;
    return s && s.name ? cleanName(s.name) : '';
  } catch { return ''; }
}
function quizLastName() {
  try {
    const lb = window.Leaderboard;
    return lb && typeof lb.getLastName === 'function' ? cleanName(lb.getLastName()) : '';
  } catch { return ''; }
}
const randomName = () => `선원${Math.floor(1000 + Math.random() * 9000)}`;
const safeHref = (v) => (typeof v === 'string' && v && !/^\s*javascript:/i.test(v) ? v : '../index.html');

function menuBtn(icon, label, sub, onClick, cls = '') {
  return h('button', { type: 'button', class: 'po-menu-btn' + (cls ? ' ' + cls : ''), onclick: onClick },
    h('span', { class: 'po-menu-ico', text: icon, 'aria-hidden': 'true' }),
    h('span', { class: 'po-menu-txt' },
      h('span', { class: 'po-menu-label', text: label }),
      h('span', { class: 'po-menu-sub', text: sub })));
}

export function createMenu(ctx) {
  let accountName = '';
  const modal = createModal();
  const settingsPanel = createSettingsPanel(ctx, { onClose: () => modal.close() });
  const controlsPanel = createControlsPanel({ onClose: () => modal.close() });

  // 플레이어 이름
  const nameText = h('strong', { class: 'po-name-text' });
  const nameView = h('div', { class: 'po-name-view' },
    h('span', { class: 'po-name-ico', text: '👤', 'aria-hidden': 'true' }), nameText,
    h('span', { class: 'po-badge po-badge--ok', text: '퀴즈 계정' }));
  const nameInput = h('input', {
    class: 'po-input', type: 'text', maxlength: NAME_MAX, placeholder: `닉네임 (1~${NAME_MAX}자)`,
    autocomplete: 'off', spellcheck: 'false', 'aria-label': '닉네임',
  });
  const nameErr = h('p', { class: 'po-field-err', role: 'alert' });
  const nameField = h('div', { class: 'po-name-field' }, nameInput,
    h('p', { class: 'po-field-hint', text: '퀴즈 사이트에 로그인하면 계정 이름이 그대로 쓰여요.' }), nameErr);
  nameInput.addEventListener('input', () => {
    setText(nameErr, '');
    ctx.setPlayerName(cleanName(nameInput.value));
  });
  nameInput.addEventListener('change', () => {
    const name = cleanName(nameInput.value);
    if (!name) return;
    ctx.saveNickname(name);
    ctx.setPlayerName(name);
    ctx.emit('menu:name', { name, account: false });
  });

  const currentName = () => accountName || cleanName(nameInput.value);
  function start(action) {
    const name = currentName();
    if (!name) {
      setText(nameErr, `닉네임을 1~${NAME_MAX}자로 입력해 주세요.`);
      nameInput.focus();
      return;
    }
    if (!accountName) ctx.saveNickname(name);
    ctx.setPlayerName(name);
    ctx.emit(action, { name, account: !!accountName });
  }

  const multiBtn = menuBtn('🌐', '멀티플레이', '방을 만들거나 참가해요', () => start('menu:multi'));
  const multiNote = h('p', { class: 'po-menu-note', role: 'status' });
  const settingsBtn = menuBtn('⚙️', '설정', '감도 · 줌 · 시야각 · 볼륨', () => {
    settingsPanel.refresh();
    modal.open(settingsPanel.el);
  }, 'po-menu-btn--sub');
  const controlsBtn = menuBtn('🎮', '조작법', '키 배치와 규칙', () => modal.open(controlsPanel.el), 'po-menu-btn--sub');
  const back = h('a', { class: 'po-back', href: '../index.html' }, '← 퀴즈 사이트로 돌아가기');

  const el = h('section', { class: 'po-screen po-page po-menu', hidden: true, 'aria-label': '메인 메뉴' },
    skyline(),
    h('div', { class: 'po-menu-wrap' },
      h('header', { class: 'po-brand' },
        h('div', { class: 'po-brand-mark', text: '⚓', 'aria-hidden': 'true' }),
        h('h1', { class: 'po-brand-title' }, h('span', { class: 'po-stencil-cut', text: '항만 작전' })),
        h('p', { class: 'po-brand-en po-stencil', text: 'PORT OPS' }),
        h('p', { class: 'po-brand-tag', text: '울산 탱커 터미널 · 선주 vs 용선자 · 5판 3선승' })),
      h('section', { class: 'po-card po-steel po-rivets po-player', 'aria-label': '플레이어' },
        h('h2', { class: 'po-card-label', text: '플레이어' }), nameView, nameField),
      h('nav', { class: 'po-menu-nav', 'aria-label': '메뉴' },
        menuBtn('🎯', '연습장 (봇)', '혼자 봇과 실전 연습', () => start('menu:sandbox'), 'po-menu-btn--main'),
        multiBtn, settingsBtn, controlsBtn),
      multiNote,
      back),
    modal.el);

  function render(p, { fresh }) {
    accountName = p.account === true ? cleanName(p.name) : p.account === false ? '' : quizSessionName();
    nameView.hidden = !accountName;
    nameField.hidden = !!accountName;
    if (accountName) {
      setText(nameText, accountName);
    } else if (fresh && document.activeElement !== nameInput) {
      nameInput.value = cleanName(p.name) || ctx.getNickname() || quizLastName() || randomName();
    }
    ctx.setPlayerName(currentName());
    multiBtn.disabled = !!p.multiDisabled;
    setText(multiNote, typeof p.multiDisabled === 'string' ? p.multiDisabled : '');
    multiNote.hidden = !multiNote.textContent;
    back.setAttribute('href', safeHref(p.backHref));
  }

  return makeScreen(el, {
    render,
    onHide: () => modal.close(),
  });
}
