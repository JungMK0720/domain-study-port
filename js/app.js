/*!
 * Port Quiz — 항만물류 도메인 스터디 퀴즈 (앱 UI/로직)
 * 순수 바닐라 JS (ES2019, 일반 <script>). 빌드 도구·외부 라이브러리 없음 — file:// 로 열어도 동작.
 * 의존(선택): window.APP_CONFIG, window.Leaderboard, window.QUESTION_BANK
 */
(function () {
  'use strict';

  // ===========================================================================
  // 설정 & 외부 모듈
  // ===========================================================================
  const CFG = (window.APP_CONFIG && typeof window.APP_CONFIG === 'object') ? window.APP_CONFIG : {};
  function posInt(v, def) {
    const n = Number(v);
    return (Number.isFinite(n) && n >= 1) ? Math.floor(n) : def;
  }
  const TA_SECONDS = posInt(CFG.timeAttackSeconds, 300);
  const TA_MS = TA_SECONDS * 1000;
  const QUIZ_LEN = posInt(CFG.quizLength, 10);
  const MIXED_LEN = posInt(CFG.mixedLength, 20);

  const LB = (window.Leaderboard &&
    typeof window.Leaderboard.submit === 'function' &&
    typeof window.Leaderboard.getTop === 'function') ? window.Leaderboard : null;

  const BASE_TITLE = 'Port Quiz · 항만물류 도메인 스터디';
  const MODE_KEYS = ['timeattack', 'ox', 'mc', 'short', 'mixed'];
  const QUIZ_MODES = ['ox', 'mc', 'short', 'mixed'];
  const DEFAULT_MODE_LABELS = { timeattack: '5분 타임어택', ox: 'OX 퀴즈', mc: '객관식', short: '주관식', mixed: '종합 모의고사' };
  const MODE_ICONS = { timeattack: '⏱', ox: '⭕', mc: '🔢', short: '✍️', mixed: '🌊' };
  const MODE_DESC = {
    ox: 'O / X 로 핵심 개념을 빠르게 점검',
    mc: '4지선다로 헷갈리는 개념 정확히 구분',
    short: '용어를 직접 입력해 확실하게 암기',
    mixed: 'OX·객관식·주관식을 섞은 실전 모의고사'
  };
  const TYPE_LABELS = { ox: 'OX', mc: '객관식', short: '주관식' };
  const MEDALS = ['🥇', '🥈', '🥉'];
  const PASS = { pass: true }; // 타임어택 '패스' 표식

  function durationText(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    if (m && s) return m + '분 ' + s + '초';
    return m ? m + '분' : s + '초';
  }
  const TA_LABEL = durationText(TA_SECONDS) + ' 타임어택';

  function modeLabel(mode) {
    if (mode === 'timeattack' && TA_SECONDS !== 300) return TA_LABEL;
    const m = (LB && LB.MODES && typeof LB.MODES === 'object') ? LB.MODES[mode] : null;
    return (typeof m === 'string' && m) ? m : (DEFAULT_MODE_LABELS[mode] || mode);
  }
  function lbShared() {
    try { return !!(LB && typeof LB.isShared === 'function' && LB.isShared()); } catch (e) { return false; }
  }
  function errMsg(e) {
    if (e && typeof e.message === 'string' && e.message) return e.message;
    return (e === undefined || e === null || e === '') ? '알 수 없는 오류' : String(e);
  }

  // ===========================================================================
  // 유틸
  // ===========================================================================
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function fmtClock(ms) {
    const total = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
    return pad2(Math.floor(total / 60)) + ':' + pad2(total % 60);
  }
  function fmtDate(v) {
    if (v === undefined || v === null || v === '') return '-';
    const d = new Date(v);
    if (isNaN(d.getTime())) return '-';
    return d.getFullYear() + '.' + pad2(d.getMonth() + 1) + '.' + pad2(d.getDate());
  }
  function pct(score, total) { return total > 0 ? Math.round((score / total) * 100) : 0; }
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  const normalize = s => String(s).normalize('NFC').toLowerCase().replace(/[\s\-_.·・\/()'"`,]/g, '');
  function sameId(a, b) {
    return a !== undefined && a !== null && b !== undefined && b !== null && String(a) === String(b);
  }
  function prefersReducedMotion() {
    try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; }
  }

  // DOM 헬퍼 — 문자열 자식은 항상 텍스트 노드(textContent)로만 들어간다 (XSS 방지)
  function h(tag, props) {
    const el = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function (k) {
        const v = props[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k === 'value') el.value = v;
        else if (k === 'disabled' || k === 'hidden') el[k] = !!v;
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? '' : String(v));
      });
    }
    for (let i = 2; i < arguments.length; i++) add(el, arguments[i]);
    return el;
  }
  function add(parent, child) {
    if (child === null || child === undefined || child === false) return parent;
    if (Array.isArray(child)) { child.forEach(function (c) { add(parent, c); }); return parent; }
    parent.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
    return parent;
  }
  function clear(el) { while (el && el.firstChild) el.removeChild(el.firstChild); return el; }
  function detach(el) { if (el && el.parentNode) el.parentNode.removeChild(el); }
  function focusQuiet(el) {
    if (!el || typeof el.focus !== 'function') return;
    try { el.focus({ preventScroll: true }); } catch (e) { try { el.focus(); } catch (e2) { /* noop */ } }
  }
  function bump(el, cls) {
    const c = cls || 'bump';
    el.classList.remove(c);
    void el.offsetWidth; // 애니메이션 재시작
    el.classList.add(c);
  }

  // ===========================================================================
  // 문제 은행
  // ===========================================================================
  function coerceOX(a) {
    if (typeof a === 'boolean') return a;
    if (typeof a === 'string') {
      const t = a.trim().toUpperCase();
      if (t === 'O' || t === 'TRUE') return true;
      if (t === 'X' || t === 'FALSE') return false;
    }
    return null;
  }
  function sanitizeBank(raw) {
    const out = [];
    const seen = new Set();
    let dropped = 0;
    (Array.isArray(raw) ? raw : []).forEach(function (q, i) {
      if (!q || typeof q !== 'object') { dropped++; return; }
      const type = q.type;
      const question = typeof q.question === 'string' ? q.question.trim() : '';
      const item = {
        id: (q.id !== undefined && q.id !== null && q.id !== '') ? String(q.id) : ('q' + i),
        type: type,
        category: (typeof q.category === 'string' && q.category.trim()) ? q.category.trim() : '기타',
        question: question,
        explanation: typeof q.explanation === 'string' ? q.explanation.trim() : '',
        answer: null,
        choices: null,
        accept: []
      };
      let ok = question !== '';
      if (ok && type === 'ox') {
        item.answer = coerceOX(q.answer);
        ok = item.answer !== null;
      } else if (ok && type === 'mc') {
        const choices = Array.isArray(q.choices) ? q.choices.map(function (c) { return String(c); }) : [];
        const rawAns = q.answer;
        const ans = (typeof rawAns === 'number' || (typeof rawAns === 'string' && rawAns.trim() !== '')) ? Number(rawAns) : NaN;
        ok = choices.length >= 2 && choices.length <= 9 && Number.isInteger(ans) && ans >= 0 && ans < choices.length;
        item.choices = choices;
        item.answer = ans;
      } else if (ok && type === 'short') {
        item.answer = (q.answer === undefined || q.answer === null) ? '' : String(q.answer).trim();
        item.accept = Array.isArray(q.accept)
          ? q.accept.filter(function (a) { return a !== undefined && a !== null && String(a).trim() !== ''; }).map(function (a) { return String(a).trim(); })
          : [];
        ok = normalize(item.answer) !== '';
      } else {
        ok = false;
      }
      if (!ok) { dropped++; return; }
      const key = item.id + '|' + question;
      if (seen.has(key)) return; // 같은 파일이 두 번 로드된 경우 등 완전 중복만 제거
      seen.add(key);
      out.push(item);
    });
    if (dropped) console.warn('[Port Quiz] 형식이 올바르지 않은 문제 ' + dropped + '개를 건너뛰었습니다.');
    return out;
  }

  const BANK = sanitizeBank(window.QUESTION_BANK);
  const CATEGORIES = [];
  BANK.forEach(function (q) { if (CATEGORIES.indexOf(q.category) === -1) CATEGORIES.push(q.category); });

  const state = {
    selectedCats: new Set(CATEGORIES),
    lastSubmitted: null // { mode, id } — 방금 등록한 기록 하이라이트용
  };
  function isAllCats() {
    return CATEGORIES.every(function (c) { return state.selectedCats.has(c); });
  }
  function selectedCatList() {
    return CATEGORIES.filter(function (c) { return state.selectedCats.has(c); });
  }
  function poolFor(mode) {
    return BANK.filter(function (q) {
      return state.selectedCats.has(q.category) && (mode === 'mixed' || q.type === mode);
    });
  }
  function countBy(list, fn) {
    const m = {};
    list.forEach(function (x) { const k = fn(x); m[k] = (m[k] || 0) + 1; });
    return m;
  }

  // 문제 1회 출제 단위(객관식 보기 셔플 + 정답 index 재매핑)
  function prepareItem(q) {
    const item = { q: q, choices: null, correctIndex: -1 };
    if (q.type === 'mc') {
      const order = shuffle(q.choices.map(function (_, i) { return i; }));
      item.choices = order.map(function (i) { return q.choices[i]; });
      item.correctIndex = order.indexOf(q.answer);
    }
    return item;
  }
  function grade(item, value) {
    if (value === PASS) return false;
    const q = item.q;
    if (q.type === 'ox') return value === q.answer;
    if (q.type === 'mc') return value === item.correctIndex;
    const n = normalize(value);
    if (!n) return false;
    return [q.answer].concat(q.accept).some(function (a) { return normalize(a) === n; });
  }
  function correctText(q) {
    if (q.type === 'ox') return q.answer ? 'O' : 'X';
    if (q.type === 'mc') return q.choices[q.answer];
    return q.answer;
  }
  function userText(item, value) {
    if (value === PASS) return '(패스)';
    if (item.q.type === 'ox') return value ? 'O' : 'X';
    if (item.q.type === 'mc') return item.choices[value];
    return String(value).trim();
  }

  // ===========================================================================
  // 화면 수명주기 (타이머/리스너 정리, 비동기 결과 무효화)
  // ===========================================================================
  let app = null;
  let heroEl = null;
  let liveEl = null;

  const timeouts = new Set();
  const intervals = new Set();
  function later(fn, ms) {
    const id = setTimeout(function () { timeouts.delete(id); fn(); }, ms);
    timeouts.add(id);
    return id;
  }
  function every(fn, ms) {
    const id = setInterval(fn, ms);
    intervals.add(id);
    return id;
  }
  function cancelEvery(id) {
    if (id === undefined || id === null) return;
    clearInterval(id);
    intervals.delete(id);
  }
  function clearAllTimers() {
    timeouts.forEach(function (id) { clearTimeout(id); });
    timeouts.clear();
    intervals.forEach(function (id) { clearInterval(id); });
    intervals.clear();
  }

  let screenGen = 0;     // 화면이 바뀔 때마다 증가 → 늦게 도착한 비동기 결과 무시
  let keyHandler = null; // 현재 화면의 키보드 핸들러
  let leaveGuard = null; // true 반환 시 헤더 링크 이동 전에 확인 모달
  let cleanups = [];
  function onCleanup(fn) { cleanups.push(fn); }

  function beginScreen(title) {
    clearAllTimers();
    const fns = cleanups;
    cleanups = [];
    fns.forEach(function (fn) { try { fn(); } catch (e) { /* noop */ } });
    Modal.close(false);
    keyHandler = null;
    leaveGuard = null;
    screenGen++;
    clear(app);
    showHero(false);
    document.title = title ? title + ' · ' + BASE_TITLE : BASE_TITLE;
    try { window.scrollTo(0, 0); } catch (e) { /* noop */ }
    return screenGen;
  }
  function showHero(on) {
    if (heroEl) heroEl.hidden = !on;
    document.body.classList.toggle('is-home', !!on);
  }
  function announce(msg) {
    if (!liveEl) return;
    liveEl.textContent = '';
    setTimeout(function () { liveEl.textContent = msg; }, 40);
  }

  // ===========================================================================
  // 앱 내 확인 모달 (alert/confirm/prompt 사용 안 함)
  // ===========================================================================
  const Modal = (function () {
    let cur = null;
    let seq = 0;
    function open(opts) {
      close(false);
      return new Promise(function (resolve) {
        seq++;
        const titleId = 'modal-title-' + seq;
        const descId = 'modal-desc-' + seq;
        const prevFocus = document.activeElement;
        const cancelBtn = h('button', { type: 'button', class: 'btn btn-ghost', onclick: function () { close(false); } }, opts.cancelText || '취소');
        const okBtn = h('button', { type: 'button', class: 'btn ' + (opts.danger ? 'btn-danger' : 'btn-primary'), onclick: function () { close(true); } }, opts.confirmText || '확인');
        const dialog = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId, 'aria-describedby': opts.message ? descId : null },
          h('p', { class: 'modal-icon', 'aria-hidden': 'true' }, opts.icon || '⚓'),
          h('h2', { class: 'modal-title', id: titleId }, opts.title || ''),
          opts.message ? h('p', { class: 'modal-msg', id: descId }, opts.message) : null,
          h('div', { class: 'modal-actions' }, cancelBtn, okBtn));
        const backdrop = h('div', { class: 'modal-backdrop' }, dialog);
        backdrop.addEventListener('click', function (e) { if (e.target === backdrop) close(false); });
        document.body.appendChild(backdrop);
        document.body.classList.add('modal-open');
        cur = { backdrop: backdrop, resolve: resolve, prevFocus: prevFocus, buttons: [cancelBtn, okBtn] };
        focusQuiet(cancelBtn);
      });
    }
    function close(result) {
      if (!cur) return;
      const c = cur;
      cur = null;
      detach(c.backdrop);
      document.body.classList.remove('modal-open');
      if (c.prevFocus && c.prevFocus !== document.body && document.body.contains(c.prevFocus)) focusQuiet(c.prevFocus);
      c.resolve(!!result);
    }
    function isOpen() { return !!cur; }
    function handleKey(e) {
      if (!cur) return;
      if (e.key === 'Escape' || e.key === 'Esc') { e.preventDefault(); close(false); return; }
      if (e.key === 'Tab') { // 포커스 트랩
        e.preventDefault();
        const b = cur.buttons;
        const i = b.indexOf(document.activeElement);
        const n = e.shiftKey ? (i <= 0 ? b.length - 1 : i - 1) : (i === -1 || i === b.length - 1 ? 0 : i + 1);
        focusQuiet(b[n]);
      }
      // Enter/Space 는 포커스된 버튼의 기본 동작에 맡김. 그 외 단축키는 모달 뒤로 전달하지 않음.
    }
    return { open: open, close: close, isOpen: isOpen, handleKey: handleKey };
  })();

  function confirmQuit(title, message) {
    return Modal.open({ icon: '🚢', title: title, message: message, confirmText: '그만두기', cancelText: '계속하기', danger: true });
  }

  // ===========================================================================
  // 키보드
  // ===========================================================================
  function isTypingTarget(t) {
    if (!t || !t.tagName) return false;
    const tag = t.tagName;
    if (tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable) return true;
    if (tag !== 'INPUT') return false;
    const type = (t.getAttribute('type') || 'text').toLowerCase();
    return ['button', 'checkbox', 'radio', 'submit', 'reset', 'range', 'color', 'file', 'image'].indexOf(type) === -1;
  }
  function isActivator(t) {
    if (!t || !t.tagName) return false;
    return t.tagName === 'BUTTON' || t.tagName === 'A' || t.tagName === 'SUMMARY' || (t.tagName === 'INPUT' && !isTypingTarget(t));
  }
  function keyDigit(e) {
    if (/^[1-9]$/.test(e.key)) return Number(e.key);
    const m = /^(?:Digit|Numpad)([1-9])$/.exec(e.code || '');
    return m ? Number(m[1]) : 0;
  }
  function isOKey(e) { return e.key === 'o' || e.key === 'O' || e.key === 'ㅐ' || e.code === 'KeyO' || keyDigit(e) === 1; }
  function isXKey(e) { return e.key === 'x' || e.key === 'X' || e.key === 'ㅌ' || e.code === 'KeyX' || keyDigit(e) === 2; }

  // 공통: 아직 답하지 않은 문제에 대한 OX(O/1, X/2)·객관식(1~n) 단축키
  function answerHotkey(e, item, onAnswer) {
    if (item.q.type === 'ox') {
      if (isOKey(e)) { e.preventDefault(); onAnswer(true); return true; }
      if (isXKey(e)) { e.preventDefault(); onAnswer(false); return true; }
    } else if (item.q.type === 'mc') {
      const d = keyDigit(e);
      if (d >= 1 && d <= item.choices.length) { e.preventDefault(); onAnswer(d - 1); return true; }
    }
    return false;
  }

  document.addEventListener('keydown', function (e) {
    if (Modal.isOpen()) { Modal.handleKey(e); return; }
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    if (typeof keyHandler === 'function') keyHandler(e);
  });

  // ===========================================================================
  // 라우팅 (해시 기반)
  // ===========================================================================
  function parseHash() {
    return (location.hash || '').replace(/^#\/?/, '').split('/').filter(Boolean);
  }
  function normHash(x) { return '#/' + String(x || '').replace(/^#\/?/, ''); }
  function go(hash) {
    const target = normHash(hash);
    if (normHash(location.hash) === target) route();
    else location.hash = target;
  }
  function redirect(hash) {
    const target = normHash(hash);
    if (normHash(location.hash) === target) route();
    else location.replace(target);
  }
  function route() {
    const p = parseHash();
    if (p.length === 0) return renderHome();
    if (p[0] === 'quiz' && p.length === 2 && QUIZ_MODES.indexOf(p[1]) !== -1) return startQuiz(p[1]);
    if (p[0] === 'timeattack' && p.length === 1) return renderTAIntro();
    if (p[0] === 'ranking') {
      if (p.length === 1) return redirect('#/ranking/timeattack');
      if (p.length === 2 && MODE_KEYS.indexOf(p[1]) !== -1) return renderRanking(p[1]);
    }
    return redirect('#/');
  }

  // 진행 중 퀴즈에서 헤더 링크를 누르면 확인 후 이동
  document.addEventListener('click', function (e) {
    const a = (e.target && e.target.closest) ? e.target.closest('a[data-nav]') : null;
    if (!a || !leaveGuard || !leaveGuard()) return;
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    const href = a.getAttribute('href') || '#/';
    const gen = screenGen;
    confirmQuit('진행 중인 퀴즈를 그만둘까요?', '지금까지의 진행 상황과 기록은 저장되지 않아요.').then(function (ok) {
      if (ok && gen === screenGen) go(href);
    });
  });

  // ===========================================================================
  // 공통 조각
  // ===========================================================================
  function storageBadge() {
    if (!LB) return h('span', { class: 'storage-badge is-off' }, '⚠️ 랭킹 기능 비활성');
    return lbShared()
      ? h('span', { class: 'storage-badge is-shared' }, '🌐 온라인 공유 랭킹')
      : h('span', { class: 'storage-badge is-local' }, '💾 이 브라우저에 저장된 랭킹 (기기별 기록)');
  }
  function stateBox(icon, title, msg, extra) {
    return h('div', { class: 'state-box' },
      h('div', { class: 'state-icon', 'aria-hidden': 'true' }, icon),
      h('p', { class: 'state-title' }, title),
      msg ? h('p', { class: 'state-msg' }, msg) : null,
      extra || null);
  }
  function homeButton(cls) {
    return h('button', { type: 'button', class: 'btn ' + (cls || 'btn-ghost'), onclick: function () { go('#/'); } }, '🏠 홈으로');
  }
  function tagRow(q) {
    return h('div', { class: 'q-tags' },
      h('span', { class: 'tag tag-cat' }, q.category),
      h('span', { class: 'badge badge-' + q.type }, TYPE_LABELS[q.type]));
  }

  // ===========================================================================
  // 홈
  // ===========================================================================
  function renderHeroContent() {
    if (!heroEl) return;
    const types = countBy(BANK, function (q) { return q.type; });
    clear(heroEl);
    heroEl.appendChild(h('div', { class: 'hero-inner' },
      h('p', { class: 'hero-emoji', 'aria-hidden': 'true' }, '🚢  ⚓  🏗️'),
      h('h1', { class: 'hero-title' }, '⚓ Port Quiz'),
      h('p', { class: 'hero-sub' }, '항만물류 도메인 스터디 — 부이·부두·선석·접안부터 터미널·물류까지'),
      h('ul', { class: 'hero-stats', 'aria-label': '문제 은행 통계' },
        h('li', { class: 'stat-pill is-total' }, '📚 전체 ', h('b', null, String(BANK.length)), '문제'),
        h('li', { class: 'stat-pill' }, '⭕ OX ', h('b', null, String(types.ox || 0))),
        h('li', { class: 'stat-pill' }, '🔢 객관식 ', h('b', null, String(types.mc || 0))),
        h('li', { class: 'stat-pill' }, '✍️ 주관식 ', h('b', null, String(types.short || 0))))));
  }

  function renderHome() {
    beginScreen('');
    showHero(true);
    const catCounts = countBy(BANK, function (q) { return q.category; });
    const wrap = h('div', { class: 'home' });

    if (!BANK.length) {
      wrap.appendChild(h('p', { class: 'notice notice-error' }, '⚠️ 문제 데이터를 불러오지 못했어요. data 폴더의 문제 파일을 확인해 주세요.'));
    }

    // 대표 기능: 타임어택
    wrap.appendChild(h('button', { type: 'button', class: 'mode-hero', disabled: !BANK.length, onclick: function () { go('#/timeattack'); } },
      h('span', { class: 'mode-hero-badge' }, '대표 모드 · 랭킹 도전'),
      h('span', { class: 'mode-hero-icon', 'aria-hidden': 'true' }, '⏱'),
      h('span', { class: 'mode-hero-title' }, TA_LABEL),
      h('span', { class: 'mode-hero-desc' }, durationText(TA_SECONDS) + ' 동안 OX·객관식·주관식을 최대한 많이 맞혀 보세요. 전체 카테고리에서 무작위 출제!'),
      h('span', { class: 'mode-hero-cta' }, '도전하기 →')));

    // 카테고리 필터
    const chips = h('div', { class: 'chips', role: 'group', 'aria-label': '카테고리 선택' });
    const filterNote = h('p', { class: 'filter-note', 'aria-live': 'polite' });
    const grid = h('div', { class: 'mode-grid' });

    function toggleCat(c) {
      if (state.selectedCats.has(c)) state.selectedCats.delete(c);
      else state.selectedCats.add(c);
      refresh();
    }
    function toggleAll() {
      state.selectedCats = isAllCats() ? new Set() : new Set(CATEGORIES);
      refresh();
    }
    // 칩은 한 번만 만들고 상태만 갱신 (클릭한 칩의 키보드 포커스 유지)
    const chipList = [];
    function makeChip(label, count, isOn, onClick, extraCls) {
      const check = h('span', { class: 'chip-check', 'aria-hidden': 'true' });
      const btn = h('button', { type: 'button', class: 'chip' + (extraCls ? ' ' + extraCls : ''), onclick: onClick },
        check, label + ' ', h('span', { class: 'chip-count' }, String(count)));
      chipList.push({ btn: btn, check: check, isOn: isOn });
      chips.appendChild(btn);
    }
    if (CATEGORIES.length) {
      makeChip('전체', BANK.length, function () { return isAllCats(); }, toggleAll, 'chip-all');
      CATEGORIES.forEach(function (c) {
        makeChip(c, catCounts[c] || 0, function () { return state.selectedCats.has(c); }, function () { toggleCat(c); });
      });
    }
    function renderChips() {
      chipList.forEach(function (ch) {
        const on = !!ch.isOn();
        ch.btn.setAttribute('aria-pressed', String(on));
        ch.check.textContent = on ? '✓' : '';
      });
      if (!CATEGORIES.length) filterNote.textContent = '';
      else if (state.selectedCats.size === 0) filterNote.textContent = '⚠️ 카테고리를 하나 이상 선택해 주세요.';
      else if (!isAllCats()) filterNote.textContent = '🔎 ' + state.selectedCats.size + '개 카테고리만 출제 · 카테고리 필터 사용 시 랭킹 등록 불가';
      else filterNote.textContent = '✅ 전체 카테고리 출제 · 랭킹 등록 가능';
      filterNote.className = 'filter-note' + (isAllCats() ? '' : ' is-warn');
    }
    function renderCards() {
      clear(grid);
      QUIZ_MODES.forEach(function (mode) {
        const len = mode === 'mixed' ? MIXED_LEN : QUIZ_LEN;
        const avail = poolFor(mode).length;
        let meta;
        if (!avail) meta = '출제 가능한 문제 없음';
        else if (avail < len) meta = avail + '문제 (선택 범위 문제 부족)';
        else meta = len + '문제 · 출제 범위 ' + avail + '문제';
        grid.appendChild(h('button', { type: 'button', class: 'mode-card mode-' + mode, disabled: !avail, onclick: function () { go('#/quiz/' + mode); } },
          h('span', { class: 'mode-icon', 'aria-hidden': 'true' }, MODE_ICONS[mode]),
          h('span', { class: 'mode-title' }, modeLabel(mode)),
          h('span', { class: 'mode-desc' }, MODE_DESC[mode]),
          h('span', { class: 'mode-meta' + (avail ? '' : ' is-empty') }, meta)));
      });
      grid.appendChild(h('button', { type: 'button', class: 'mode-card mode-ranking', onclick: function () { go('#/ranking/timeattack'); } },
        h('span', { class: 'mode-icon', 'aria-hidden': 'true' }, '🏆'),
        h('span', { class: 'mode-title' }, '랭킹'),
        h('span', { class: 'mode-desc' }, '모드별 Top 20 · 명예의 전당'),
        h('span', { class: 'mode-meta' }, LB ? (lbShared() ? '🌐 온라인 공유 랭킹' : '💾 이 브라우저 기록') : '⚠️ 랭킹 비활성')));
    }
    function refresh() { renderChips(); renderCards(); }

    wrap.appendChild(h('section', { class: 'card filter-card', 'aria-labelledby': 'filter-title' },
      h('div', { class: 'section-head' },
        h('h2', { class: 'section-title', id: 'filter-title' }, '📚 카테고리'),
        h('span', { class: 'section-hint' }, 'OX·객관식·주관식·종합 모의고사에 적용 (타임어택은 항상 전체)')),
      chips, filterNote));

    wrap.appendChild(h('section', { class: 'modes', 'aria-labelledby': 'modes-title' },
      h('h2', { class: 'section-title', id: 'modes-title' }, '🧭 학습 모드'),
      grid));

    refresh();
    app.appendChild(wrap);
  }

  // ===========================================================================
  // 문제 카드 (일반 퀴즈·타임어택 공용)
  // ===========================================================================
  function questionView(item, onAnswer) {
    const q = item.q;
    const textEl = h('h2', { class: 'q-text', tabindex: '-1' }, q.question);
    const area = h('div', { class: 'answer-area answer-' + q.type });
    const card = h('article', { class: 'q-card' }, tagRow(q), textEl, area);
    const view = { el: card, textEl: textEl, area: area, item: item, buttons: [], input: null, submitBtn: null, shortRow: null, locked: false };

    if (q.type === 'ox') {
      [true, false].forEach(function (val) {
        const btn = h('button', {
          type: 'button',
          class: 'ox-btn ' + (val ? 'ox-o' : 'ox-x'),
          'aria-label': val ? 'O, 맞다 (단축키 O 또는 1)' : 'X, 틀리다 (단축키 X 또는 2)',
          onclick: function () { onAnswer(val); }
        },
          h('span', { class: 'ox-glyph', 'aria-hidden': 'true' }, val ? 'O' : 'X'),
          h('span', { class: 'ox-label', 'aria-hidden': 'true' }, val ? '맞다' : '틀리다'),
          h('span', { class: 'key-hint', 'aria-hidden': 'true' }, val ? 'O · 1' : 'X · 2'),
          h('span', { class: 'mark', 'aria-hidden': 'true' }));
        btn._val = val;
        view.buttons.push(btn);
        area.appendChild(btn);
      });
    } else if (q.type === 'mc') {
      item.choices.forEach(function (c, i) {
        const btn = h('button', { type: 'button', class: 'choice', 'aria-label': (i + 1) + '번: ' + c, onclick: function () { onAnswer(i); } },
          h('span', { class: 'choice-num', 'aria-hidden': 'true' }, String(i + 1)),
          h('span', { class: 'choice-text' }, c),
          h('span', { class: 'mark', 'aria-hidden': 'true' }));
        btn._val = i;
        view.buttons.push(btn);
        area.appendChild(btn);
      });
    } else {
      const input = h('input', {
        type: 'text', class: 'text-input short-input', autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off',
        spellcheck: 'false', enterkeyhint: 'done', maxlength: '80', placeholder: '정답을 입력하세요', 'aria-label': '정답 입력'
      });
      const submit = h('button', { type: 'button', class: 'btn btn-primary short-submit', disabled: true }, '제출');
      const doSubmit = function () {
        if (view.locked) return;
        if (input.value.trim() === '') { focusQuiet(input); return; } // 빈 입력은 제출 불가
        onAnswer(input.value);
      };
      input.addEventListener('input', function () { submit.disabled = view.locked || input.value.trim() === ''; });
      input.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return; // 한글 조합 중 Enter 무시
        e.preventDefault();
        doSubmit();
      });
      submit.addEventListener('click', doSubmit);
      view.input = input;
      view.submitBtn = submit;
      view.shortRow = h('div', { class: 'short-row' }, h('span', { class: 'short-mark', 'aria-hidden': 'true' }), input, submit);
      area.appendChild(view.shortRow);
      area.appendChild(h('p', { class: 'short-hint' }, '띄어쓰기·대소문자·기호(-, ·, 괄호 등)는 무시하고 채점해요 · Enter로 제출'));
    }
    return view;
  }

  // 정오 표시: 정답 보기 하이라이트(✓), 내가 고른 오답(✗), 입력 잠금
  function revealView(view, value, correct) {
    view.locked = true;
    const item = view.item;
    const q = item.q;
    if (q.type === 'short') {
      view.input.disabled = true;
      view.submitBtn.disabled = true;
      view.shortRow.classList.add(correct ? 'is-correct' : 'is-wrong');
      view.shortRow.querySelector('.short-mark').textContent = correct ? '✓' : '✗';
      return;
    }
    const answerVal = q.type === 'ox' ? q.answer : item.correctIndex;
    view.buttons.forEach(function (btn) {
      btn.disabled = true;
      const isAnswer = btn._val === answerVal;
      const isChosen = value !== PASS && btn._val === value;
      const mark = btn.querySelector('.mark');
      if (isAnswer) { btn.classList.add('is-answer'); mark.textContent = '✓'; }
      if (isChosen) {
        btn.classList.add('is-chosen', correct ? 'is-correct' : 'is-wrong');
        if (!correct) mark.textContent = '✗';
      }
      if (!isAnswer && !isChosen) btn.classList.add('is-dim');
    });
  }

  // ===========================================================================
  // 일반 퀴즈 (ox / mc / short / mixed)
  // ===========================================================================
  function startQuiz(mode) {
    const gen = beginScreen(modeLabel(mode));
    const len = mode === 'mixed' ? MIXED_LEN : QUIZ_LEN;
    const picked = shuffle(poolFor(mode)).slice(0, len);
    if (!picked.length) {
      app.appendChild(h('section', { class: 'card notice-card' },
        stateBox('🔍', '출제할 문제가 없어요',
          state.selectedCats.size ? '선택한 카테고리에 이 유형의 문제가 없어요. 홈에서 카테고리를 바꿔 보세요.' : '홈에서 카테고리를 하나 이상 선택해 주세요.',
          homeButton('btn-primary'))));
      return;
    }

    const s = {
      mode: mode,
      items: picked.map(prepareItem),
      index: 0,
      results: [],
      startAt: 0,
      endAt: 0,
      filtered: !isAllCats(),
      cats: selectedCatList(),
      answered: false,
      finished: false,
      view: null,
      elapsedId: null
    };
    leaveGuard = function () { return !s.finished && s.results.length > 0; };

    const countEl = h('span', { class: 'q-count' });
    const elapsedEl = h('span', { class: 'elapsed', title: '경과 시간' }, '⏱ 00:00');
    const bar = h('div', { class: 'progress-bar' });
    const progress = h('div', { class: 'progress', role: 'progressbar', 'aria-label': '진행률', 'aria-valuemin': '0', 'aria-valuemax': String(s.items.length), 'aria-valuenow': '0' }, bar);
    const stage = h('div', { class: 'stage' });
    app.appendChild(h('section', { class: 'quiz' },
      h('h1', { class: 'sr-only' }, modeLabel(mode)),
      h('div', { class: 'quiz-top' },
        h('div', { class: 'quiz-meta' },
          h('span', { class: 'mode-pill' }, MODE_ICONS[mode] + ' ' + modeLabel(mode)),
          countEl,
          elapsedEl,
          h('button', { type: 'button', class: 'btn btn-quit', onclick: quit }, '그만두기')),
        progress),
      stage));

    function quit() {
      if (s.finished) return;
      confirmQuit('퀴즈를 그만둘까요?', '지금까지 푼 기록은 저장되지 않아요.').then(function (ok) {
        if (gen !== screenGen || s.finished) return;
        if (ok) go('#/');
        else if (!s.answered && s.view && s.view.input) focusQuiet(s.view.input);
      });
    }
    function setProgress() {
      const done = s.results.length;
      bar.style.width = (done / s.items.length * 100) + '%';
      progress.setAttribute('aria-valuenow', String(done));
    }
    function show() {
      s.answered = false;
      const item = s.items[s.index];
      countEl.textContent = (s.index + 1) + ' / ' + s.items.length;
      setProgress();
      const view = questionView(item, answer);
      view.fb = h('div', { class: 'feedback', hidden: true });
      view.el.appendChild(view.fb);
      s.view = view;
      clear(stage);
      stage.appendChild(view.el);
      if (stage.getBoundingClientRect().top < 0) { try { window.scrollTo(0, 0); } catch (e) { /* noop */ } }
      focusQuiet(view.input || view.textEl);
    }
    function answer(value) {
      if (s.answered || s.finished || !s.view) return;
      s.answered = true;
      const view = s.view;
      const item = view.item;
      const correct = grade(item, value);
      const isLast = s.index === s.items.length - 1;
      if (isLast) {
        s.endAt = Date.now();
        cancelEvery(s.elapsedId);
        elapsedEl.textContent = '⏱ ' + fmtClock(s.endAt - s.startAt);
      }
      const mine = userText(item, value);
      s.results.push({ item: item, correct: correct, userText: mine });
      setProgress();
      revealView(view, value, correct);

      const fb = view.fb;
      clear(fb);
      fb.className = 'feedback ' + (correct ? 'is-correct' : 'is-wrong');
      fb.hidden = false;
      fb.appendChild(h('p', { class: 'fb-head' },
        h('span', { class: 'fb-icon', 'aria-hidden': 'true' }, correct ? '✓' : '✗'),
        correct ? '정답이에요!' : '아쉬워요, 오답이에요'));
      if (!correct && item.q.type === 'short') fb.appendChild(h('p', { class: 'fb-mine' }, '내 답: ', h('span', null, mine)));
      fb.appendChild(h('p', { class: 'fb-answer' }, '정답: ', h('strong', null, correctText(item.q))));
      if (item.q.type === 'short' && item.q.accept.length) {
        fb.appendChild(h('p', { class: 'fb-accept' }, '인정 답안: ' + item.q.accept.join(', ')));
      }
      if (item.q.explanation) {
        fb.appendChild(h('p', { class: 'fb-expl' }, h('span', { class: 'fb-expl-label' }, '💡 해설'), item.q.explanation));
      }
      const nextBtn = h('button', { type: 'button', class: 'btn btn-primary btn-next', onclick: next }, isLast ? '결과 보기 →' : '다음 문제 →');
      fb.appendChild(h('div', { class: 'fb-actions' }, nextBtn, h('span', { class: 'key-hint', 'aria-hidden': 'true' }, 'Enter')));
      announce((correct ? '정답입니다. ' : '오답입니다. ') + '정답은 ' + correctText(item.q) + '.');
      focusQuiet(nextBtn);
      try { nextBtn.scrollIntoView({ block: 'nearest' }); } catch (e) { /* noop */ }
    }
    function next() {
      if (!s.answered || s.finished) return;
      if (s.index >= s.items.length - 1) { finish(); return; }
      s.index++;
      show();
    }
    function finish() {
      if (s.finished) return;
      s.finished = true;
      if (!s.endAt) s.endAt = Date.now();
      renderQuizResult(s);
    }

    keyHandler = function (e) {
      if (!s.view || s.finished) return;
      if (isTypingTarget(e.target)) return; // 입력창의 Enter 는 입력창이 직접 처리
      if (e.key === 'Enter') {
        if (isActivator(e.target)) return;   // 포커스된 버튼은 기본 동작(click)에 맡김
        if (s.answered) { e.preventDefault(); next(); }
        return;
      }
      if (!s.answered) answerHotkey(e, s.view.item, answer);
    };

    s.startAt = Date.now();
    s.elapsedId = every(function () {
      if (!s.endAt) elapsedEl.textContent = '⏱ ' + fmtClock(Date.now() - s.startAt);
    }, 500);
    show();
  }

  function accHeadline(acc) {
    if (acc >= 100) return '🏆 만점! 완벽한 항만 전문가';
    if (acc >= 80) return '🚢 훌륭해요! 순항 중이에요';
    if (acc >= 60) return '⚓ 좋아요! 조금만 더 다듬어요';
    if (acc >= 40) return '🌊 파도를 넘는 중이에요';
    return '💪 다시 도전해 봐요';
  }
  function statItem(label, value) {
    return h('div', { class: 'stat' }, h('dt', null, label), h('dd', null, value));
  }
  function resultActions(onRetry, retryLabel) {
    return h('div', { class: 'result-actions' },
      h('button', { type: 'button', class: 'btn btn-primary', onclick: onRetry }, retryLabel || '🔄 다시 하기'),
      homeButton('btn-ghost'));
  }

  function renderQuizResult(s) {
    const gen = beginScreen(modeLabel(s.mode) + ' 결과');
    const total = s.items.length;
    const score = s.results.filter(function (r) { return r.correct; }).length;
    const timeMs = Math.max(0, s.endAt - s.startAt);
    const acc = pct(score, total);
    const wrongs = s.results.filter(function (r) { return !r.correct; }).map(function (r) {
      return { q: r.item.q, userText: r.userText };
    });
    const title = h('h1', { class: 'result-title', tabindex: '-1' }, accHeadline(acc));
    const wrap = h('section', { class: 'result' });
    wrap.appendChild(h('div', { class: 'card result-hero' },
      h('p', { class: 'result-mode' }, MODE_ICONS[s.mode] + ' ' + modeLabel(s.mode) + ' 결과'),
      title,
      h('p', { class: 'result-score', 'aria-label': total + '문제 중 ' + score + '문제 정답' },
        h('span', { class: 'big' }, String(score)), h('span', { class: 'of' }, ' / ' + total)),
      h('dl', { class: 'result-stats' },
        statItem('정답률', acc + '%'),
        statItem('소요 시간', fmtClock(timeMs)),
        statItem('오답', wrongs.length + '문제')),
      s.filtered ? h('p', { class: 'result-filter' }, '🔎 카테고리 필터: ' + s.cats.join(', ')) : null,
      resultActions(function () { startQuiz(s.mode); }, '🔄 다시 하기')));
    wrap.appendChild(rankSection(gen, {
      mode: s.mode, score: score, total: total, timeMs: timeMs,
      blockReason: s.filtered ? '카테고리 필터 사용 시 랭킹 등록 불가 — 전체 카테고리로 풀면 등록할 수 있어요.' : ''
    }));
    wrap.appendChild(reviewSection(wrongs, '🎉 틀린 문제가 없어요. 완벽해요!'));
    app.appendChild(wrap);
    focusQuiet(title);
  }

  function reviewSection(wrongs, emptyText) {
    const sec = h('section', { class: 'card review', 'aria-labelledby': 'review-title' });
    sec.appendChild(h('div', { class: 'section-head' },
      h('h2', { class: 'section-title', id: 'review-title' }, '📝 오답 노트 ', h('span', { class: 'count-pill' }, String(wrongs.length)))));
    if (!wrongs.length) {
      sec.appendChild(h('p', { class: 'empty' }, emptyText));
      return sec;
    }
    const ol = h('ol', { class: 'review-list' });
    wrongs.forEach(function (w) {
      const q = w.q;
      ol.appendChild(h('li', { class: 'review-item' },
        tagRow(q),
        h('p', { class: 'review-q' }, q.question),
        h('p', { class: 'review-line is-wrong' },
          h('span', { class: 'mk', 'aria-hidden': 'true' }, '✗'),
          h('span', { class: 'lbl' }, '내 답'),
          h('span', { class: 'val' }, w.userText || '(무응답)')),
        h('p', { class: 'review-line is-correct' },
          h('span', { class: 'mk', 'aria-hidden': 'true' }, '✓'),
          h('span', { class: 'lbl' }, '정답'),
          h('span', { class: 'val' }, correctText(q))),
        q.explanation ? h('p', { class: 'review-expl' }, h('span', { class: 'fb-expl-label' }, '💡 해설'), q.explanation) : null));
    });
    sec.appendChild(ol);
    return sec;
  }

  // ===========================================================================
  // 랭킹 공용: 데이터 정리·표·포디움·컨페티
  // ===========================================================================
  function sanitizeEntries(list) {
    return (Array.isArray(list) ? list : []).filter(function (e) { return e && typeof e === 'object'; }).map(function (e) {
      const score = Number(e.score) || 0;
      const total = Number(e.total) || 0;
      let acc = Number(e.accuracy);
      if (e.accuracy === undefined || e.accuracy === null || !Number.isFinite(acc)) acc = total > 0 ? score / total : 0;
      return {
        id: e.id,
        name: (e.name === undefined || e.name === null) ? '' : String(e.name),
        score: score,
        total: total,
        accuracy: acc,
        timeMs: (e.timeMs === undefined || e.timeMs === null) ? NaN : Number(e.timeMs),
        createdAt: e.createdAt
      };
    });
  }
  function scoreText(mode, e) { return mode === 'timeattack' ? e.score + '개' : e.score + '/' + e.total; }
  function accText(e) { return Math.round(Math.max(0, Math.min(1, e.accuracy)) * 100) + '%'; }
  function timeText(mode, e) { return (mode === 'timeattack' || !Number.isFinite(e.timeMs)) ? '-' : fmtClock(e.timeMs); }
  function medalEl(rank, cls) {
    return h('span', { class: cls || 'medal', role: 'img', 'aria-label': rank + '위' }, MEDALS[rank - 1]);
  }

  function rankTable(list, mode, myId, compact) {
    const tbody = h('tbody');
    list.forEach(function (e, i) {
      const rank = i + 1;
      const mine = sameId(e.id, myId);
      tbody.appendChild(h('tr', { class: (rank <= 3 ? 'top-' + rank : '') + (mine ? ' is-me' : '') },
        h('td', { class: 'c-rank' }, rank <= 3 ? medalEl(rank) : String(rank)),
        h('td', { class: 'c-name' },
          h('span', { class: 'name-text' }, e.name),
          mine ? h('span', { class: 'me-badge' }, '나') : null),
        h('td', { class: 'c-score' }, scoreText(mode, e)),
        h('td', { class: 'c-acc' }, accText(e)),
        compact ? null : h('td', { class: 'c-time' }, timeText(mode, e)),
        compact ? null : h('td', { class: 'c-date' }, fmtDate(e.createdAt))));
    });
    return h('div', { class: 'table-wrap' },
      h('table', { class: 'rank-table' + (compact ? ' is-compact' : '') },
        h('thead', null, h('tr', null,
          h('th', { scope: 'col', class: 'c-rank' }, '순위'),
          h('th', { scope: 'col', class: 'c-name' }, '이름'),
          h('th', { scope: 'col', class: 'c-score' }, '점수'),
          h('th', { scope: 'col', class: 'c-acc' }, '정답률'),
          compact ? null : h('th', { scope: 'col', class: 'c-time' }, '시간'),
          compact ? null : h('th', { scope: 'col', class: 'c-date' }, '날짜'))),
        tbody));
  }

  function podium(top, mode, myId) {
    // DOM 순서는 1·2·3위(스크린리더), 화면 배치는 CSS order 로 2·1·3
    const ol = h('ol', { class: 'podium', 'aria-label': '상위 3명' });
    [0, 1, 2].forEach(function (i) {
      const e = top[i];
      const place = i + 1;
      const mine = !!e && sameId(e.id, myId);
      ol.appendChild(h('li', { class: 'podium-col place-' + place + (e ? '' : ' is-empty') + (mine ? ' is-me' : '') },
        h('div', { class: 'podium-person' },
          medalEl(place, 'podium-medal'),
          h('span', { class: 'podium-name' }, e ? e.name : '—'),
          e ? h('span', { class: 'podium-score' }, scoreText(mode, e)) : h('span', { class: 'podium-score' }, '비어 있음'),
          e ? h('span', { class: 'podium-acc' }, '정답률 ' + accText(e)) : null,
          mine ? h('span', { class: 'me-badge' }, '나') : null),
        h('div', { class: 'podium-base', 'aria-hidden': 'true' }, h('span', { class: 'podium-num' }, String(place)))));
    });
    return ol;
  }

  function burstConfetti() {
    if (prefersReducedMotion()) return;
    const layer = h('div', { class: 'confetti', 'aria-hidden': 'true' });
    const colors = ['#f5c542', '#0fa3b1', '#1b6ca8', '#ef476f', '#06d6a0', '#ffd166', '#8ecae6'];
    for (let i = 0; i < 60; i++) {
      const p = document.createElement('span');
      p.className = 'confetti-piece' + (i % 3 === 0 ? ' is-round' : '');
      p.style.left = (Math.random() * 100).toFixed(2) + '%';
      p.style.background = colors[i % colors.length];
      p.style.animationDelay = (Math.random() * 0.7).toFixed(2) + 's';
      p.style.animationDuration = (2 + Math.random() * 1.6).toFixed(2) + 's';
      p.style.setProperty('--drift', ((Math.random() * 2 - 1) * 120).toFixed(0) + 'px');
      p.style.setProperty('--spin', ((Math.random() * 2 - 1) * 900).toFixed(0) + 'deg');
      layer.appendChild(p);
    }
    app.appendChild(layer);
    later(function () { detach(layer); }, 4500);
  }

  // ===========================================================================
  // 결과 화면 공통: 랭킹 등록 폼 + 미니 랭킹
  // ===========================================================================
  function rankSection(gen, r) {
    // r: { mode, score, total, timeMs, blockReason }
    const sec = h('section', { class: 'card rank-card', 'aria-labelledby': 'rank-title' });
    sec.appendChild(h('div', { class: 'section-head' },
      h('h2', { class: 'section-title', id: 'rank-title' }, '🏆 랭킹 등록'),
      storageBadge()));
    const mini = h('div', { class: 'mini-rank' });
    function fullBtn() {
      return h('button', { type: 'button', class: 'btn btn-ghost btn-block', onclick: function () { go('#/ranking/' + r.mode); } }, '🏆 ' + modeLabel(r.mode) + ' 전체 랭킹 보기');
    }

    if (!LB) {
      sec.appendChild(h('p', { class: 'notice notice-warn' }, '⚠️ 랭킹 모듈(leaderboard.js)을 불러오지 못해 랭킹 기능을 사용할 수 없어요.'));
      return sec;
    }

    const blocked = !!r.blockReason;
    if (blocked) sec.appendChild(h('p', { class: 'notice notice-warn' }, '⚠️ ' + r.blockReason));

    let lastName = '';
    try { lastName = String(LB.getLastName ? (LB.getLastName() || '') : ''); } catch (e) { lastName = ''; }
    const input = h('input', {
      type: 'text', id: 'rank-name', class: 'text-input', maxlength: '12', autocomplete: 'nickname',
      placeholder: '이름 (1~12자)', value: lastName.slice(0, 12), disabled: blocked, 'aria-describedby': 'rank-error'
    });
    const btn = h('button', { type: 'button', class: 'btn btn-primary', disabled: blocked }, '랭킹 등록');
    const err = h('p', { class: 'field-error', id: 'rank-error', role: 'alert' });
    const success = h('div', { class: 'rank-success', hidden: true });
    sec.appendChild(h('div', { class: 'rank-form' + (blocked ? ' is-disabled' : '') },
      h('label', { class: 'sr-only', for: 'rank-name' }, '랭킹에 표시할 이름'),
      input, btn));
    sec.appendChild(err);
    sec.appendChild(success);
    sec.appendChild(mini);
    mini.appendChild(fullBtn());
    if (blocked) return sec;

    let busy = false;
    let done = false;
    function showErr(m) {
      err.textContent = m;
      input.classList.toggle('is-invalid', !!m);
      if (m) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
    }
    function submit() {
      if (busy || done) return;
      const name = input.value.trim();
      if (!name) { showErr('이름을 입력해 주세요.'); focusQuiet(input); return; }
      if (name.length > 12) { showErr('이름은 12자 이하로 입력해 주세요.'); focusQuiet(input); return; }
      showErr('');
      busy = true;
      btn.disabled = true;
      input.disabled = true;
      btn.textContent = '등록 중…';
      Promise.resolve().then(function () {
        return LB.submit({ mode: r.mode, name: name, score: r.score, total: r.total, timeMs: r.timeMs });
      }).then(function (res) {
        busy = false;
        done = true;
        try { if (typeof LB.setLastName === 'function') LB.setLastName(name); } catch (e) { /* noop */ }
        const id = (res && res.id !== undefined && res.id !== null) ? res.id : null;
        const rankNum = res ? Number(res.rank) : NaN;
        const rank = (res && res.rank !== null && res.rank !== undefined && Number.isFinite(rankNum) && rankNum >= 1) ? Math.floor(rankNum) : null;
        if (id !== null) state.lastSubmitted = { mode: r.mode, id: id };
        if (gen !== screenGen) return;
        btn.textContent = '등록 완료 ✓';
        const medal = (rank && rank <= 3) ? MEDALS[rank - 1] : '';
        clear(success);
        success.className = 'rank-success' + (medal ? ' is-podium place-' + rank : '');
        success.hidden = false;
        success.appendChild(h('p', { class: 'rank-success-main' },
          medal ? h('span', { class: 'rank-success-medal', 'aria-hidden': 'true' }, medal) : null,
          h('span', null, rank ? '🎉 ' + rank + '위!' : '🎉 등록 완료!')));
        success.appendChild(h('p', { class: 'rank-success-sub' },
          name + ' 님의 기록이 ' + modeLabel(r.mode) + ' 랭킹에 등록됐어요.' + (medal ? ' 시상대에 올랐어요!' : '')));
        announce(rank ? '랭킹 ' + rank + '위로 등록됐어요.' : '랭킹에 등록됐어요.');
        if (medal) burstConfetti();
        loadMini(id, rank);
      }, function (e) {
        busy = false;
        if (gen !== screenGen) return;
        btn.disabled = false;
        input.disabled = false;
        btn.textContent = '랭킹 등록';
        showErr('등록에 실패했어요: ' + errMsg(e));
      });
    }
    function loadMini(myId, myRank) {
      clear(mini);
      mini.appendChild(h('p', { class: 'loading' }, '⏳ 랭킹을 불러오는 중…'));
      Promise.resolve().then(function () { return LB.getTop(r.mode, 10); }).then(function (raw) {
        if (gen !== screenGen) return;
        const list = sanitizeEntries(raw).slice(0, 10);
        clear(mini);
        mini.appendChild(h('h3', { class: 'mini-title' }, MODE_ICONS[r.mode] + ' ' + modeLabel(r.mode) + ' Top 10'));
        if (!list.length) mini.appendChild(h('p', { class: 'empty' }, '아직 기록이 없어요.'));
        else mini.appendChild(rankTable(list, r.mode, myId, true));
        if (myId !== null && myRank && !list.some(function (e) { return sameId(e.id, myId); })) {
          mini.appendChild(h('p', { class: 'mini-note' }, '내 기록은 ' + myRank + '위 — Top 10까지 조금만 더!'));
        }
        mini.appendChild(fullBtn());
      }, function (e) {
        if (gen !== screenGen) return;
        clear(mini);
        mini.appendChild(h('p', { class: 'notice notice-error' }, '⚠️ 랭킹을 불러오지 못했어요: ' + errMsg(e)));
        mini.appendChild(fullBtn());
      });
    }
    btn.addEventListener('click', submit);
    input.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
      e.preventDefault();
      submit();
    });
    input.addEventListener('input', function () { if (err.textContent) showErr(''); });
    return sec;
  }

  // ===========================================================================
  // 🏆 랭킹 화면
  // ===========================================================================
  function renderRanking(mode) {
    const gen = beginScreen('랭킹');
    const wrap = h('section', { class: 'ranking' });
    wrap.appendChild(h('div', { class: 'page-head' },
      h('h1', { class: 'page-title' }, '🏆 랭킹'),
      storageBadge()));

    const tabs = h('div', { class: 'tabs', role: 'tablist', 'aria-label': '모드 선택' });
    MODE_KEYS.forEach(function (m) {
      const sel = m === mode;
      tabs.appendChild(h('button', {
        type: 'button', role: 'tab', id: 'tab-' + m, class: 'tab' + (sel ? ' is-active' : ''),
        'aria-selected': String(sel), 'aria-controls': 'rank-panel',
        onclick: function () { if (m !== mode) redirect('#/ranking/' + m); }
      }, h('span', { class: 'tab-ico', 'aria-hidden': 'true' }, MODE_ICONS[m]), modeLabel(m)));
    });
    wrap.appendChild(tabs);

    const panel = h('div', { class: 'rank-panel', id: 'rank-panel', role: 'tabpanel', 'aria-labelledby': 'tab-' + mode });
    wrap.appendChild(panel);
    const playHash = mode === 'timeattack' ? '#/timeattack' : '#/quiz/' + mode;
    wrap.appendChild(h('div', { class: 'page-actions' },
      h('button', { type: 'button', class: 'btn btn-primary', onclick: function () { go(playHash); } }, MODE_ICONS[mode] + ' ' + modeLabel(mode) + ' 도전하기'),
      homeButton('btn-ghost')));
    app.appendChild(wrap);

    if (!LB) {
      panel.appendChild(stateBox('⚠️', '랭킹 기능을 사용할 수 없어요', '랭킹 모듈(leaderboard.js)을 불러오지 못했어요.'));
      return;
    }
    function load() {
      clear(panel);
      panel.setAttribute('aria-busy', 'true');
      panel.appendChild(stateBox('⏳', '랭킹을 불러오는 중…', '', h('span', { class: 'spinner', 'aria-hidden': 'true' })));
      Promise.resolve().then(function () { return LB.getTop(mode, 20); }).then(function (raw) {
        if (gen !== screenGen) return;
        panel.setAttribute('aria-busy', 'false');
        clear(panel);
        const list = sanitizeEntries(raw).slice(0, 20);
        if (!list.length) {
          panel.appendChild(stateBox('🌊', '아직 등록된 기록이 없어요', '첫 번째 기록의 주인공이 되어 보세요!'));
          return;
        }
        const myId = (state.lastSubmitted && state.lastSubmitted.mode === mode) ? state.lastSubmitted.id : null;
        panel.appendChild(podium(list.slice(0, 3), mode, myId));
        panel.appendChild(h('h2', { class: 'section-title rank-list-title' }, 'Top ' + Math.min(20, list.length)));
        panel.appendChild(rankTable(list, mode, myId, false));
      }, function (e) {
        if (gen !== screenGen) return;
        panel.setAttribute('aria-busy', 'false');
        clear(panel);
        panel.appendChild(stateBox('⚠️', '랭킹을 불러오지 못했어요', errMsg(e),
          h('button', { type: 'button', class: 'btn btn-primary', onclick: load }, '🔄 다시 시도')));
      });
    }
    load();
  }

  // ===========================================================================
  // ⏱ 타임어택
  // ===========================================================================
  function renderTAIntro() {
    beginScreen(TA_LABEL);
    const empty = !BANK.length;
    const startBtn = h('button', { type: 'button', class: 'btn btn-primary btn-xl', disabled: empty, onclick: startTimeAttack }, '🚀 시작');
    function rule(icon, text) {
      return h('li', null, h('span', { class: 'rule-ico', 'aria-hidden': 'true' }, icon), h('span', null, text));
    }
    app.appendChild(h('section', { class: 'card ta-intro' },
      h('div', { class: 'ta-intro-icon', 'aria-hidden': 'true' }, '⏱'),
      h('h1', { class: 'page-title' }, TA_LABEL),
      h('p', { class: 'ta-intro-lead' }, '항만물류 전 범위에서 무작위로 출제돼요. 제한 시간 안에 최대한 많이 맞혀 보세요!'),
      h('ul', { class: 'rules' },
        rule('⏱', durationText(TA_SECONDS) + ' 동안 OX · 객관식 · 주관식 문제가 섞여서 계속 나와요.'),
        rule('🏆', '많이 맞힐수록 상위! 맞힌 개수가 같으면 정답률이 높은 순이에요.'),
        rule('⚡', '정답이면 곧바로, 오답이면 정답을 잠깐 보여 준 뒤 다음 문제로 넘어가요.'),
        rule('⏭️', '모르면 패스! 오답으로 처리되고 콤보가 끊겨요.'),
        rule('🔥', '연속으로 맞히면 콤보! 3콤보부터 불타올라요.'),
        rule('⌨️', '키보드: OX는 O/1 · X/2, 객관식은 1~4, 주관식은 Enter로 제출')),
      h('p', { class: 'ta-intro-meta' }, '📚 문제 은행 ' + BANK.length + '문제 · 전체 카테고리 · 해설은 결과 화면의 오답 노트에서 확인'),
      empty ? h('p', { class: 'notice notice-error' }, '⚠️ 문제 데이터를 불러오지 못해 시작할 수 없어요.') : null,
      h('div', { class: 'ta-intro-actions' }, startBtn, homeButton('btn-ghost'))));
    if (!empty) focusQuiet(startBtn); // Enter 로 바로 시작
  }

  function startTimeAttack() {
    const gen = beginScreen(TA_LABEL);
    if (!BANK.length) { renderTAIntro(); return; }

    const s = {
      phase: 'countdown', // countdown → playing → finished | aborted
      deadline: 0,
      deck: [],
      ptr: 0,
      current: null,
      view: null,
      flash: null,
      locked: false,
      correct: 0,
      attempts: 0,
      combo: 0,
      best: 0,
      wrongs: []
    };
    leaveGuard = function () { return s.phase === 'playing'; };

    const root = h('section', { class: 'ta' });
    app.appendChild(root);

    // --- 3·2·1 카운트다운 ---
    const cd = h('div', { class: 'countdown', role: 'status', 'aria-live': 'assertive' });
    root.appendChild(h('div', { class: 'card countdown-card' },
      h('p', { class: 'countdown-label' }, '⏱ ' + TA_LABEL + ' — 준비하세요!'),
      cd,
      h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: function () { s.phase = 'aborted'; go('#/'); } }, '취소')));
    let n = 3;
    (function step() {
      if (gen !== screenGen || s.phase !== 'countdown') return;
      clear(cd);
      if (n > 0) {
        cd.appendChild(h('span', { class: 'countdown-num' }, String(n)));
        n--;
        later(step, 1000);
      } else {
        cd.appendChild(h('span', { class: 'countdown-num is-go' }, 'GO!'));
        later(play, 450);
      }
    })();

    // --- 플레이 화면 요소 ---
    let timeEl, timerBox, correctEl, attemptsEl, comboEl, comboBox, stage, passBtn;

    function buildPlayUI() {
      clear(root);
      timeEl = h('span', { class: 'hud-time' }, fmtClock(TA_MS));
      timerBox = h('div', { class: 'hud-timer', role: 'timer', 'aria-label': '남은 시간' },
        h('span', { class: 'hud-label' }, '남은 시간'), timeEl);
      correctEl = h('span', { class: 'hud-correct-num' }, '0');
      attemptsEl = h('b', null, '0');
      comboEl = h('b', null, '0');
      comboBox = h('span', { class: 'hud-combo' }, h('span', { class: 'fire', 'aria-hidden': 'true' }, '🔥'), '콤보 ', comboEl);
      stage = h('div', { class: 'stage' });
      passBtn = h('button', { type: 'button', class: 'btn btn-ghost btn-pass', onclick: function () { answer(PASS); } }, '⏭️ 패스');
      root.appendChild(h('div', { class: 'ta-hud' },
        timerBox,
        h('div', { class: 'hud-correct' }, h('span', { class: 'hud-label' }, '맞힌 개수'), correctEl),
        h('div', { class: 'hud-side' }, h('span', { class: 'hud-attempts' }, '시도 ', attemptsEl), comboBox)));
      root.appendChild(stage);
      root.appendChild(h('div', { class: 'ta-actions' },
        passBtn,
        h('button', { type: 'button', class: 'btn btn-quit', onclick: quit }, '그만두기')));
    }

    function play() {
      if (gen !== screenGen || s.phase !== 'countdown') return;
      s.phase = 'playing';
      s.deadline = Date.now() + TA_MS; // Date.now() 기반 마감 시각 — 백그라운드 탭/드리프트에도 정확
      s.deck = shuffle(BANK);
      s.ptr = 0;
      buildPlayUI();
      every(tick, 200);
      later(tick, TA_MS + 25); // 마감 순간 정밀 종료
      const onVis = function () { if (!document.hidden) tick(); };
      document.addEventListener('visibilitychange', onVis);
      onCleanup(function () { document.removeEventListener('visibilitychange', onVis); });
      nextQ();
      tick();
    }

    function tick() {
      if (s.phase !== 'playing') return;
      const remain = s.deadline - Date.now();
      if (remain <= 0) { timeEl.textContent = '00:00'; finish(); return; }
      timeEl.textContent = fmtClock(Math.ceil(remain / 1000) * 1000);
      timerBox.classList.toggle('is-danger', remain <= 30000);
    }

    function nextQ() {
      if (s.phase !== 'playing') return;
      if (Date.now() >= s.deadline) { finish(); return; }
      if (s.ptr >= s.deck.length) { // 소진 → 재셔플 (직전 문제가 바로 반복되지 않게)
        const last = s.current ? s.current.q : null;
        s.deck = shuffle(BANK);
        s.ptr = 0;
        if (s.deck.length > 1 && s.deck[0] === last) {
          const j = 1 + Math.floor(Math.random() * (s.deck.length - 1));
          const t = s.deck[0]; s.deck[0] = s.deck[j]; s.deck[j] = t;
        }
      }
      s.current = prepareItem(s.deck[s.ptr++]);
      s.locked = false;
      s.view = questionView(s.current, answer);
      s.flash = h('div', { class: 'ta-flash', hidden: true });
      s.view.el.appendChild(s.flash);
      clear(stage);
      stage.appendChild(s.view.el);
      passBtn.classList.remove('is-locked');
      if (s.view.input && !Modal.isOpen()) focusQuiet(s.view.input); // 확인 모달 뒤로 포커스를 뺏지 않음
    }

    function answer(value) {
      if (s.phase !== 'playing' || s.locked || !s.current) return;
      if (Date.now() >= s.deadline) { finish(); return; } // 마감 이후 입력은 무효
      s.locked = true;
      passBtn.classList.add('is-locked');
      const item = s.current;
      const correct = grade(item, value);
      s.attempts++;
      if (correct) {
        s.correct++;
        s.combo++;
        if (s.combo > s.best) s.best = s.combo;
      } else {
        s.combo = 0;
        s.wrongs.push({ q: item.q, userText: userText(item, value) });
      }
      correctEl.textContent = String(s.correct);
      attemptsEl.textContent = String(s.attempts);
      comboEl.textContent = String(s.combo);
      comboBox.classList.toggle('is-hot', s.combo >= 3);
      if (correct) bump(correctEl);
      if (correct && s.combo >= 3) bump(comboBox);

      revealView(s.view, value, correct);
      const f = s.flash;
      clear(f);
      f.className = 'ta-flash ' + (correct ? 'is-correct' : 'is-wrong');
      f.hidden = false;
      f.appendChild(h('span', { class: 'fl-icon', 'aria-hidden': 'true' }, correct ? '✓' : '✗'));
      if (correct) {
        f.appendChild(h('span', null, s.combo >= 3 ? '정답! 🔥 ' + s.combo + '콤보' : '정답! +1'));
      } else {
        f.appendChild(h('span', null, (value === PASS ? '패스 · ' : '오답 · ') + '정답: '));
        f.appendChild(h('strong', null, correctText(item.q)));
      }
      announce(correct ? '정답' : (value === PASS ? '패스. ' : '오답. ') + '정답은 ' + correctText(item.q));
      later(nextQ, correct ? 500 : 1200); // 피드백 중 입력 잠금, 타이머는 계속 진행
    }

    function finish() {
      if (s.phase !== 'playing') return;
      s.phase = 'finished';
      renderTAResult(s); // beginScreen 에서 진행 중 피드백 타임아웃·interval·리스너·모달 모두 정리
    }

    function quit() {
      if (s.phase !== 'playing') return;
      confirmQuit('타임어택을 그만둘까요?', '기록은 저장되지 않아요. (확인 창이 떠 있는 동안에도 시간은 계속 흘러요)').then(function (ok) {
        if (gen !== screenGen || s.phase !== 'playing') return;
        if (ok) { s.phase = 'aborted'; go('#/'); }
        else if (s.view && s.view.input && !s.locked) focusQuiet(s.view.input);
      });
    }

    keyHandler = function (e) {
      if (s.phase !== 'playing' || s.locked || !s.current) return;
      if (isTypingTarget(e.target) || e.key === 'Enter') return; // Enter 는 입력창/포커스 버튼이 처리
      answerHotkey(e, s.current, answer);
    };
  }

  function taHeadline(n) {
    if (n >= 40) return '🏆 항만 마스터! 엄청난 속도예요';
    if (n >= 25) return '🚢 대단해요! 거침없는 항해';
    if (n >= 12) return '⚓ 좋아요! 꾸준히 순항 중';
    if (n >= 1) return '🌊 다음엔 더 많이 맞혀 봐요';
    return '💪 다시 도전해 봐요';
  }

  function renderTAResult(s) {
    const gen = beginScreen(TA_LABEL + ' 결과');
    const acc = pct(s.correct, s.attempts);
    const title = h('h1', { class: 'result-title', tabindex: '-1' }, '⏰ 타임 오버!');
    const wrap = h('section', { class: 'result' });
    wrap.appendChild(h('div', { class: 'card result-hero is-ta' },
      h('p', { class: 'result-mode' }, '⏱ ' + TA_LABEL + ' 결과'),
      title,
      h('p', { class: 'result-sub' }, taHeadline(s.correct)),
      h('p', { class: 'result-score', 'aria-label': '맞힌 개수 ' + s.correct + '개' },
        h('span', { class: 'big' }, String(s.correct)), h('span', { class: 'of' }, '개 정답')),
      h('dl', { class: 'result-stats' },
        statItem('시도', s.attempts + '문제'),
        statItem('정답률', acc + '%'),
        statItem('최고 콤보', s.best + (s.best >= 3 ? ' 🔥' : ''))),
      resultActions(startTimeAttack, '🔄 다시 도전')));
    wrap.appendChild(rankSection(gen, {
      mode: 'timeattack', score: s.correct, total: s.attempts, timeMs: TA_MS, blockReason: ''
    }));
    wrap.appendChild(reviewSection(s.wrongs, s.attempts ? '🎉 틀린 문제가 없어요. 완벽해요!' : '푼 문제가 없어요.'));
    app.appendChild(wrap);
    focusQuiet(title);
    announce('타임 오버! ' + s.attempts + '문제 중 ' + s.correct + '개 정답.');
  }

  // ===========================================================================
  // 시작
  // ===========================================================================
  function init() {
    app = document.getElementById('app');
    heroEl = document.getElementById('hero');
    liveEl = document.getElementById('sr-live');
    if (!app) return;
    renderHeroContent();
    window.addEventListener('hashchange', route);
    route();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
