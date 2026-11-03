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
  function nonNegInt(v, def) {
    const n = Number(v);
    return (v !== null && v !== '' && Number.isFinite(n) && n >= 0) ? Math.round(n) : def;
  }
  // ⏳ 오래 버텨라 (서바이벌) 규칙 — 초 단위
  const SV_CFG = (CFG.survival && typeof CFG.survival === 'object') ? CFG.survival : {};
  const SURV = {
    start: posInt(SV_CFG.startSeconds, 60),
    bonus: nonNegInt(SV_CFG.correctBonusSeconds, 10),
    wrong: nonNegInt(SV_CFG.wrongPenaltySeconds, 30),
    pass: nonNegInt(SV_CFG.passPenaltySeconds, 10)
  };
  const QUIZ_LEN = posInt(CFG.quizLength, 10);
  const MIXED_LEN = posInt(CFG.mixedLength, 20);

  const LB = (window.Leaderboard &&
    typeof window.Leaderboard.submit === 'function' &&
    typeof window.Leaderboard.getTop === 'function') ? window.Leaderboard : null;

  const BASE_TITLE = 'Port Quiz · 탱커 체선료 최적화 도메인 스터디';
  const MODE_KEYS = ['survival', 'runner', 'shooter', 'sniper', 'ox', 'mc', 'short', 'mixed']; // 랭킹 탭 순서
  const QUIZ_MODES = ['ox', 'mc', 'short', 'mixed'];
  const GAME_KEYS = ['runner', 'shooter', 'sniper'];
  const POINT_MODES = { runner: true, shooter: true, sniper: true }; // 점수제(게임) 모드: score=획득 점수, total=시도 수
  // 'glossary' 는 용어집 연습용 내부 모드 (랭킹에 쓰지 않음 — MODE_KEYS 에 없음)
  const DEFAULT_MODE_LABELS = { survival: '오래 버텨라', runner: '항로 질주', shooter: '슈팅해운', sniper: '스나이퍼해운', ox: 'OX 퀴즈', mc: '객관식', short: '주관식', mixed: '종합 모의고사', glossary: '용어집 연습' };
  const MODE_ICONS = { survival: '⏳', runner: '🚢', shooter: '🎯', sniper: '🔭', ox: '⭕', mc: '🔢', short: '✍️', mixed: '🌊', glossary: '📖' };
  const LEVELS = [1, 2, 3];
  const LEVEL_LABELS = { 1: '하 · 빈출', 2: '중 · 실무', 3: '상 · 심화' };
  const MODE_DESC = {
    ox: 'O / X 로 핵심 개념을 빠르게 점검',
    mc: '4지선다로 헷갈리는 개념 정확히 구분',
    short: '용어를 직접 입력해 확실하게 암기',
    mixed: 'OX·객관식·주관식을 섞은 실전 모의고사'
  };
  const TYPE_LABELS = { ox: 'OX', mc: '객관식', short: '주관식' };
  const MEDALS = ['🥇', '🥈', '🥉'];
  const PASS = { pass: true }; // 오래 버텨라 '패스' 표식

  function modeLabel(mode) {
    const m = (LB && LB.MODES && typeof LB.MODES === 'object') ? LB.MODES[mode] : null;
    return (typeof m === 'string' && m) ? m : (DEFAULT_MODE_LABELS[mode] || mode);
  }
  const SURV_LABEL = MODE_ICONS.survival + ' ' + modeLabel('survival');
  function survRuleText() {
    return SURV.start + '초로 시작 · 정답 +' + SURV.bonus + '초 · 오답 -' + SURV.wrong + '초 · 패스 -' + SURV.pass + '초 · 버틸수록 하→중→상';
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
  function fmtNum(n) { return String(Math.floor(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); } // 1240 → "1,240"
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
  // 난이도: 1=하, 2=중, 3=상 — 없거나 이상하면 2(중)
  function coerceLevel(v) {
    if (typeof v === 'string') {
      const t = v.trim();
      if (t === '하') return 1;
      if (t === '중') return 2;
      if (t === '상') return 3;
    }
    const n = (typeof v === 'number' || typeof v === 'string') ? Number(v) : NaN;
    return (n === 1 || n === 2 || n === 3) ? n : 2;
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
        level: coerceLevel(q.level),
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

  function countBy(list, fn) {
    const m = {};
    list.forEach(function (x) { const k = fn(x); m[k] = (m[k] || 0) + 1; });
    return m;
  }
  const LEVEL_COUNTS = countBy(BANK, function (q) { return q.level; });
  const LEVELS_PRESENT = LEVELS.filter(function (l) { return LEVEL_COUNTS[l] > 0; });

  const state = {
    selectedCats: new Set(CATEGORIES),
    selectedLevels: new Set(LEVELS),
    lastSubmitted: null, // { mode, id } — 방금 등록한 기록 하이라이트용
    glossary: { query: '', cat: '', scrollY: 0, restore: false } // 용어집 검색·필터 상태 (돌아오면 복원)
  };
  function isAllCats() {
    return CATEGORIES.every(function (c) { return state.selectedCats.has(c); });
  }
  // 문제가 있는 난이도가 모두 선택돼 있으면 '전체'
  function isAllLevels() {
    return LEVELS_PRESENT.every(function (l) { return state.selectedLevels.has(l); });
  }
  function isFullScope() { return isAllCats() && isAllLevels(); }
  function selectedCatList() {
    return CATEGORIES.filter(function (c) { return state.selectedCats.has(c); });
  }
  function selectedLevelList() {
    return LEVELS_PRESENT.filter(function (l) { return state.selectedLevels.has(l); });
  }
  function noneSelected() {
    return (CATEGORIES.length > 0 && selectedCatList().length === 0) || (LEVELS_PRESENT.length > 0 && selectedLevelList().length === 0);
  }
  // 일반 퀴즈 출제 풀: 카테고리 ∩ 난이도 ∩ 유형
  function poolFor(mode) {
    return BANK.filter(function (q) {
      return state.selectedCats.has(q.category) && state.selectedLevels.has(q.level) && (mode === 'mixed' || q.type === mode);
    });
  }

  // ===========================================================================
  // 용어집 (window.GLOSSARY — 없거나 비어 있어도 동작)
  // ===========================================================================
  function strField(v) {
    if (typeof v === 'string') return v.trim();
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
    return '';
  }
  function sanitizeGlossary(raw) {
    const out = [];
    (Array.isArray(raw) ? raw : []).forEach(function (g) {
      if (!g || typeof g !== 'object') return;
      const term = strField(g.term);
      if (!term) return;
      const ko = strField(g.ko);
      let keywords = Array.isArray(g.keywords) ? g.keywords.map(strField).filter(Boolean) : [];
      if (!keywords.length) keywords = [term, ko].filter(Boolean); // 키워드가 없으면 용어·한글명으로 매칭
      const item = {
        idx: out.length,
        term: term,
        ko: ko,
        full: strField(g.full),
        category: strField(g.category) || '기타',
        meaning: strField(g.meaning),
        analogy: strField(g.analogy),
        caution: strField(g.caution),
        keywords: keywords,
        related: []
      };
      item.search = [term, ko, item.full, item.meaning].concat(keywords).join('\n').normalize('NFC').toLowerCase();
      item.searchNs = item.search.replace(/\s+/g, '');
      out.push(item);
    });
    return out;
  }
  const GLOSSARY = sanitizeGlossary(window.GLOSSARY);

  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  // 영문/숫자가 섞인 키워드: 영숫자로 끝나는 쪽에 단어 경계 적용 ("NOR" ≠ "NORMAL").
  // 전부 대문자인 약어(NOR, ETA …)는 대소문자 구분, 그 밖의 영문은 무시. 한글 키워드는 단순 포함.
  function keywordMatcher(kw) {
    const k = kw.normalize('NFC').trim();
    if (!k) return null;
    if (/[A-Za-z0-9]/.test(k)) {
      const body = k.split(/\s+/).map(escapeRe).join('\\s+');
      const pre = /^[A-Za-z0-9]/.test(k) ? '(?:^|[^A-Za-z0-9])' : '';
      const post = /[A-Za-z0-9]$/.test(k) ? '(?![A-Za-z0-9])' : '';
      const acronym = /[A-Z]/.test(k) && !/[a-z]/.test(k);
      let re;
      try { re = new RegExp(pre + body + post, acronym ? '' : 'i'); } catch (e) { return null; }
      return function (text) { return re.test(text); };
    }
    const low = k.toLowerCase();
    return function (text, lower) { return lower.indexOf(low) !== -1; };
  }
  // 매칭 대상: 문제·정답·인정 답안·보기 (해설 제외)
  function questionHaystack(q) {
    const parts = [q.question];
    if (q.type === 'short') parts.push(q.answer);
    q.accept.forEach(function (a) { parts.push(a); });
    if (q.choices) q.choices.forEach(function (c) { parts.push(c); });
    return parts.join('\n').normalize('NFC');
  }
  let glossaryIndexed = false;
  function ensureGlossaryIndex() {
    if (glossaryIndexed) return;
    glossaryIndexed = true;
    const hay = BANK.map(function (q) {
      const t = questionHaystack(q);
      return { q: q, text: t, lower: t.toLowerCase() };
    });
    GLOSSARY.forEach(function (g) {
      const ms = g.keywords.map(keywordMatcher).filter(Boolean);
      g.related = hay.filter(function (x) {
        return ms.some(function (m) { return m(x.text, x.lower); });
      }).map(function (x) { return x.q; });
    });
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
  function cancelLater(id) {
    if (id === undefined || id === null) return;
    clearTimeout(id);
    timeouts.delete(id);
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
    document.body.classList.remove('is-game');
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
    // 모달이 열려 있으면 키 입력을 모달만 받음 (게임 모듈의 window 키 리스너로도 전달하지 않음)
    if (Modal.isOpen()) { Modal.handleKey(e); e.stopImmediatePropagation(); return; }
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
    if (p[0] === 'survival' && p.length === 1) return renderSurvivalIntro();
    if (p[0] === 'timeattack') return redirect('#/survival'); // 옛 링크 호환
    if (p[0] === 'game') {
      if (p.length === 2 && GAME_KEYS.indexOf(p[1]) !== -1) return renderGameIntro(p[1]);
      return redirect('#/');
    }
    if (p[0] === 'glossary') {
      if (p.length === 1) return renderGlossary();
      if (p.length === 3 && p[1] === 'quiz' && /^\d+$/.test(p[2])) return startGlossaryPractice(Number(p[2]));
      return redirect('#/glossary');
    }
    if (p[0] === 'ranking') {
      if (p.length === 2 && MODE_KEYS.indexOf(p[1]) !== -1) return renderRanking(p[1]);
      return redirect('#/ranking/survival'); // 기본 탭 (옛 timeattack 탭 포함)
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
  function levelBadge(level) {
    return h('span', { class: 'lv-badge lv-' + level }, LEVEL_LABELS[level]);
  }
  function tagRow(q) {
    return h('div', { class: 'q-tags' },
      h('span', { class: 'tag tag-cat' }, q.category),
      h('span', { class: 'badge badge-' + q.type }, TYPE_LABELS[q.type]),
      levelBadge(q.level));
  }

  // ===========================================================================
  // 홈
  // ===========================================================================
  function renderHeroContent() {
    if (!heroEl) return;
    const types = countBy(BANK, function (q) { return q.type; });
    clear(heroEl);
    heroEl.appendChild(h('div', { class: 'hero-inner' },
      h('p', { class: 'hero-emoji', 'aria-hidden': 'true' }, '🚢  🛢️  ⚓'),
      h('h1', { class: 'hero-title' }, '⚓ Port Quiz'),
      h('p', { class: 'hero-sub' }, '탱커 체선료 최적화 프로젝트 도메인 스터디 — 레이타임·NOR·SOF부터 부이·부두·접안까지'),
      h('ul', { class: 'hero-stats', 'aria-label': '문제 은행 통계' },
        h('li', { class: 'stat-pill is-total' }, '📚 전체 ', h('b', null, String(BANK.length)), '문제'),
        h('li', { class: 'stat-pill' }, '⭕ OX ', h('b', null, String(types.ox || 0))),
        h('li', { class: 'stat-pill' }, '🔢 객관식 ', h('b', null, String(types.mc || 0))),
        h('li', { class: 'stat-pill' }, '✍️ 주관식 ', h('b', null, String(types.short || 0)))),
      h('ul', { class: 'hero-stats hero-levels', 'aria-label': '난이도별 문항 수' },
        LEVELS.map(function (l) {
          return h('li', { class: 'stat-pill' },
            h('span', { class: 'lv-dot lv-' + l, 'aria-hidden': 'true' }),
            LEVEL_LABELS[l] + ' ', h('b', null, String(LEVEL_COUNTS[l] || 0)));
        }))));
  }

  function renderHome() {
    beginScreen('');
    showHero(true);
    const catCounts = countBy(BANK, function (q) { return q.category; });
    const wrap = h('div', { class: 'home' });

    if (!BANK.length) {
      wrap.appendChild(h('p', { class: 'notice notice-error' }, '⚠️ 문제 데이터를 불러오지 못했어요. data 폴더의 문제 파일을 확인해 주세요.'));
    }

    // 대표 기능: ⏳ 오래 버텨라
    wrap.appendChild(h('button', { type: 'button', class: 'mode-hero', disabled: !BANK.length, onclick: function () { go('#/survival'); } },
      h('span', { class: 'mode-hero-badge' }, '대표 모드 · 랭킹 도전'),
      h('span', { class: 'mode-hero-icon', 'aria-hidden': 'true' }, MODE_ICONS.survival),
      h('span', { class: 'mode-hero-title' }, SURV_LABEL),
      h('span', { class: 'mode-hero-desc' }, survRuleText()),
      h('span', { class: 'mode-hero-cta' }, '도전하기 →')));

    // 🎮 게임
    wrap.appendChild(h('section', { class: 'games', 'aria-labelledby': 'games-title' },
      h('h2', { class: 'section-title', id: 'games-title' }, '🎮 게임'),
      h('div', { class: 'game-grid' }, GAME_KEYS.map(gameCard))));

    // 출제 범위 필터: 카테고리 ∩ 난이도 (칩은 한 번만 만들고 상태만 갱신 → 키보드 포커스 유지)
    const catChips = h('div', { class: 'chips', role: 'group', 'aria-label': '카테고리 선택' });
    const lvChips = h('div', { class: 'chips', role: 'group', 'aria-label': '난이도 선택' });
    const filterNote = h('p', { class: 'filter-note', 'aria-live': 'polite' });
    const grid = h('div', { class: 'mode-grid' });
    const chipList = [];

    function makeChip(parent, label, count, isOn, onClick, opts) {
      const o = opts || {};
      const check = h('span', { class: 'chip-check', 'aria-hidden': 'true' });
      const btn = h('button', { type: 'button', class: 'chip' + (o.cls ? ' ' + o.cls : ''), disabled: !!o.disabled, onclick: onClick },
        check, o.lead || null, label + ' ', h('span', { class: 'chip-count' }, String(count)));
      chipList.push({ btn: btn, check: check, isOn: isOn });
      parent.appendChild(btn);
    }
    function toggleIn(set, v) {
      if (set.has(v)) set.delete(v); else set.add(v);
      refresh();
    }
    if (CATEGORIES.length) {
      makeChip(catChips, '전체', BANK.length, isAllCats, function () {
        state.selectedCats = isAllCats() ? new Set() : new Set(CATEGORIES);
        refresh();
      }, { cls: 'chip-all' });
      CATEGORIES.forEach(function (c) {
        makeChip(catChips, c, catCounts[c] || 0, function () { return state.selectedCats.has(c); }, function () { toggleIn(state.selectedCats, c); });
      });
      makeChip(lvChips, '전체', BANK.length, isAllLevels, function () {
        state.selectedLevels = isAllLevels() ? new Set() : new Set(LEVELS);
        refresh();
      }, { cls: 'chip-all' });
      LEVELS.forEach(function (l) {
        const n = LEVEL_COUNTS[l] || 0;
        makeChip(lvChips, LEVEL_LABELS[l], n,
          function () { return n > 0 && state.selectedLevels.has(l); },
          function () { toggleIn(state.selectedLevels, l); },
          { cls: 'chip-lv', lead: h('span', { class: 'lv-dot lv-' + l, 'aria-hidden': 'true' }), disabled: n === 0 });
      });
    }
    function renderChips() {
      chipList.forEach(function (ch) {
        const on = !!ch.isOn();
        ch.btn.setAttribute('aria-pressed', String(on));
        ch.check.textContent = on ? '✓' : '';
      });
      const full = isFullScope();
      if (!CATEGORIES.length) filterNote.textContent = '';
      else if (noneSelected()) filterNote.textContent = '⚠️ 카테고리와 난이도를 각각 하나 이상 선택해 주세요.';
      else if (!full) filterNote.textContent = '🔎 필터 적용 중 · 카테고리·난이도가 모두 \'전체\'일 때만 랭킹 등록 가능';
      else filterNote.textContent = '✅ 전체 범위 출제 · 랭킹 등록 가능';
      filterNote.className = 'filter-note' + (full ? '' : ' is-warn');
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
      grid.appendChild(h('button', { type: 'button', class: 'mode-card mode-ranking', onclick: function () { go('#/ranking/survival'); } },
        h('span', { class: 'mode-icon', 'aria-hidden': 'true' }, '🏆'),
        h('span', { class: 'mode-title' }, '랭킹'),
        h('span', { class: 'mode-desc' }, '모드별 Top 20 · 명예의 전당'),
        h('span', { class: 'mode-meta' }, LB ? (lbShared() ? '🌐 온라인 공유 랭킹' : '💾 이 브라우저 기록') : '⚠️ 랭킹 비활성')));
      grid.appendChild(h('button', { type: 'button', class: 'mode-card mode-glossary', onclick: function () { go('#/glossary'); } },
        h('span', { class: 'mode-icon', 'aria-hidden': 'true' }, '📖'),
        h('span', { class: 'mode-title' }, '용어집'),
        h('span', { class: 'mode-desc' }, '핵심 용어 · 비유 · 헷갈림 주의, 관련 문제 바로 풀기'),
        h('span', { class: 'mode-meta' + (GLOSSARY.length ? '' : ' is-empty') }, GLOSSARY.length ? GLOSSARY.length + '개 용어' : '준비 중')));
    }
    function refresh() { renderChips(); renderCards(); }

    wrap.appendChild(h('section', { class: 'card filter-card', 'aria-labelledby': 'filter-title' },
      h('div', { class: 'section-head' },
        h('h2', { class: 'section-title', id: 'filter-title' }, '🎯 출제 범위'),
        h('span', { class: 'section-hint' }, 'OX·객관식·주관식·종합 모의고사에 적용 (오래 버텨라는 항상 전체)')),
      h('h3', { class: 'filter-label' }, '📚 카테고리'),
      catChips,
      h('h3', { class: 'filter-label' }, '📶 난이도'),
      lvChips,
      filterNote));

    wrap.appendChild(h('section', { class: 'modes', 'aria-labelledby': 'modes-title' },
      h('h2', { class: 'section-title', id: 'modes-title' }, '🧭 학습 모드'),
      grid));

    refresh();
    app.appendChild(wrap);
  }

  // ===========================================================================
  // 문제 카드 (일반 퀴즈·오래 버텨라 공용)
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
  // opts(선택, 용어집 연습용): { pool, length, label, practice: true, back: fn, backLabel, emptyMsg }
  function startQuiz(mode, opts) {
    const o = opts || {};
    const label = o.label || modeLabel(mode);
    const gen = beginScreen(label);
    const len = o.length || (mode === 'mixed' ? MIXED_LEN : QUIZ_LEN);
    const picked = shuffle(o.pool || poolFor(mode)).slice(0, len);
    const goBack = o.back || function () { go('#/'); };
    if (!picked.length) {
      app.appendChild(h('section', { class: 'card notice-card' },
        stateBox('🔍', '출제할 문제가 없어요',
          o.emptyMsg || (noneSelected() ? '홈에서 카테고리와 난이도를 각각 하나 이상 선택해 주세요.' : '선택한 카테고리·난이도에 이 유형의 문제가 없어요. 홈에서 출제 범위를 바꿔 보세요.'),
          o.back ? h('button', { type: 'button', class: 'btn btn-primary', onclick: goBack }, o.backLabel || '돌아가기') : homeButton('btn-primary'))));
      return;
    }

    const s = {
      mode: mode,
      opts: o,
      label: label,
      practice: !!o.practice,
      goBack: goBack,
      items: picked.map(prepareItem),
      index: 0,
      results: [],
      startAt: 0,
      endAt: 0,
      filtered: !o.practice && !isFullScope(),
      cats: (o.practice || isAllCats()) ? null : selectedCatList(),
      levels: (o.practice || isAllLevels()) ? null : selectedLevelList(),
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
      h('h1', { class: 'sr-only' }, label),
      h('div', { class: 'quiz-top' },
        h('div', { class: 'quiz-meta' },
          h('span', { class: 'mode-pill' }, MODE_ICONS[mode] + ' ' + label),
          countEl,
          elapsedEl,
          h('button', { type: 'button', class: 'btn btn-quit', onclick: quit }, '그만두기')),
        progress),
      stage));

    function quit() {
      if (s.finished) return;
      confirmQuit('퀴즈를 그만둘까요?', '지금까지 푼 기록은 저장되지 않아요.').then(function (ok) {
        if (gen !== screenGen || s.finished) return;
        if (ok) s.goBack();
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
  function resultActions(onRetry, retryLabel, extra) {
    return h('div', { class: 'result-actions' },
      h('button', { type: 'button', class: 'btn btn-primary', onclick: onRetry }, retryLabel || '🔄 다시 하기'),
      extra || null,
      homeButton('btn-ghost'));
  }

  function renderQuizResult(s) {
    const gen = beginScreen(s.label + ' 결과');
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
      h('p', { class: 'result-mode' }, MODE_ICONS[s.mode] + ' ' + s.label + ' 결과'),
      title,
      h('p', { class: 'result-score', 'aria-label': total + '문제 중 ' + score + '문제 정답' },
        h('span', { class: 'big' }, String(score)), h('span', { class: 'of' }, ' / ' + total)),
      h('dl', { class: 'result-stats' },
        statItem('정답률', acc + '%'),
        statItem('소요 시간', fmtClock(timeMs)),
        statItem('오답', wrongs.length + '문제')),
      s.filtered ? h('p', { class: 'result-filter' }, '🔎 출제 범위 — ' + [
        s.cats ? '카테고리: ' + s.cats.join(', ') : null,
        s.levels ? '난이도: ' + s.levels.map(function (l) { return LEVEL_LABELS[l]; }).join(', ') : null
      ].filter(Boolean).join(' / ')) : null,
      resultActions(function () { startQuiz(s.mode, s.opts); }, '🔄 다시 하기',
        s.practice ? h('button', { type: 'button', class: 'btn btn-ghost', onclick: s.goBack }, s.opts.backLabel || '돌아가기') : null)));
    if (s.practice) {
      // 용어집 연습은 랭킹에 반영하지 않음 → 등록 폼 대신 안내
      wrap.appendChild(h('p', { class: 'notice practice-note' }, '📖 용어집 연습 — 랭킹 미반영 · 관련 문제로 개념을 다지는 연습이에요.'));
    } else {
      wrap.appendChild(rankSection(gen, {
        mode: s.mode, score: score, total: total, timeMs: timeMs,
        blockReason: s.filtered ? '카테고리·난이도 필터를 쓰면 랭킹에 등록할 수 없어요 — 둘 다 \'전체\'로 풀면 등록할 수 있어요.' : ''
      }));
    }
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
      if (e.accuracy === undefined || e.accuracy === null || !Number.isFinite(acc)) {
        const hit = POINT_MODES[e.mode] ? (Number(e.correct) || 0) : score; // 점수제 모드는 맞힌 수 기준
        acc = total > 0 ? hit / total : 0;
      }
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
  function scoreText(mode, e) {
    if (POINT_MODES[mode]) return fmtNum(e.score) + '점';
    return mode === 'survival' ? e.score + '개' : e.score + '/' + e.total;
  }
  function timeHeader(mode) { return mode === 'survival' ? '버틴 시간' : (POINT_MODES[mode] ? '플레이 시간' : '시간'); }
  function accText(e) { return Math.round(Math.max(0, Math.min(1, e.accuracy)) * 100) + '%'; }
  // 오래 버텨라: 버틴 시간 / 그 외: 소요 시간
  function timeText(mode, e) { return Number.isFinite(e.timeMs) ? fmtClock(e.timeMs) : '-'; }
  function medalEl(rank, cls) {
    return h('span', { class: cls || 'medal', role: 'img', 'aria-label': rank + '위' }, MEDALS[rank - 1]);
  }

  function rankTable(list, mode, myId, compact) {
    const showTime = !compact || mode === 'survival' || !!POINT_MODES[mode]; // 미니 랭킹에서도 버틴/플레이 시간 표시
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
        showTime ? h('td', { class: 'c-time' }, timeText(mode, e)) : null,
        compact ? null : h('td', { class: 'c-date' }, fmtDate(e.createdAt))));
    });
    return h('div', { class: 'table-wrap' },
      h('table', { class: 'rank-table' + (compact ? ' is-compact' : '') },
        h('thead', null, h('tr', null,
          h('th', { scope: 'col', class: 'c-rank' }, '순위'),
          h('th', { scope: 'col', class: 'c-name' }, '이름'),
          h('th', { scope: 'col', class: 'c-score' }, '점수'),
          h('th', { scope: 'col', class: 'c-acc' }, '정답률'),
          showTime ? h('th', { scope: 'col', class: 'c-time' }, timeHeader(mode)) : null,
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
          e ? h('span', { class: 'podium-acc' }, '정답률 ' + accText(e) + (((mode === 'survival' || POINT_MODES[mode]) && Number.isFinite(e.timeMs)) ? ' · ⏱ ' + fmtClock(e.timeMs) : '')) : null,
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
        const payload = { mode: r.mode, name: name, score: r.score, total: r.total, timeMs: r.timeMs };
        if (typeof r.correct === 'number') payload.correct = r.correct; // 점수제 모드: 정답률 = correct / total
        return LB.submit(payload);
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
    const playHash = mode === 'survival' ? '#/survival' : (POINT_MODES[mode] ? '#/game/' + mode : '#/quiz/' + mode);
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
  // 📖 용어집 — 검색·카테고리 필터, 용어별 관련 문제 연습(랭킹 미반영)
  // ===========================================================================
  function glossaryCategories() {
    const cats = CATEGORIES.slice(); // 퀴즈 카테고리 순서 우선, 용어집에만 있는 카테고리는 뒤에
    GLOSSARY.forEach(function (g) { if (cats.indexOf(g.category) === -1) cats.push(g.category); });
    return cats;
  }
  function backToGlossary() {
    state.glossary.restore = true; // 돌아가면 검색어·카테고리·스크롤 위치 복원
    go('#/glossary');
  }

  function startGlossaryPractice(idx) {
    ensureGlossaryIndex();
    const g = GLOSSARY[idx];
    if (!g) { redirect('#/glossary'); return; }
    startQuiz('glossary', {
      pool: g.related,
      length: 10,
      label: '용어집 연습 · ' + g.term,
      practice: true,
      back: backToGlossary,
      backLabel: '📖 용어집으로 돌아가기',
      emptyMsg: '「' + g.term + '」 관련 문제를 준비 중이에요.'
    });
  }

  function termCard(g) {
    const n = g.related.length;
    const titleId = 'term-' + g.idx;
    return h('article', { class: 'term-card', 'aria-labelledby': titleId },
      h('div', { class: 'term-head' },
        h('h2', { class: 'term-title', id: titleId },
          h('span', { class: 'term-en' }, g.term),
          (g.ko && g.ko !== g.term) ? h('span', { class: 'term-ko' }, g.ko) : null),
        g.full ? h('p', { class: 'term-full' }, g.full) : null),
      g.meaning ? h('p', { class: 'term-meaning' }, g.meaning) : null,
      g.analogy ? h('p', { class: 'term-note is-analogy' }, h('span', { class: 'term-note-label' }, '✈️ 비유: '), g.analogy) : null,
      g.caution ? h('p', { class: 'term-note is-caution' }, h('span', { class: 'term-note-label' }, '⚠️ 헷갈림 주의: '), g.caution) : null,
      h('div', { class: 'term-foot' },
        h('span', { class: 'tag tag-cat' }, g.category),
        h('button', {
          type: 'button', class: 'btn btn-sm term-quiz ' + (n ? 'btn-primary' : 'btn-ghost'), disabled: !n,
          onclick: function () {
            state.glossary.scrollY = window.pageYOffset || (document.documentElement && document.documentElement.scrollTop) || 0;
            go('#/glossary/quiz/' + g.idx);
          }
        }, n ? '📝 관련 문제 ' + n + '개 풀기' : '관련 문제 준비 중')));
  }

  function renderGlossary() {
    beginScreen('용어집');
    const gs = state.glossary;
    const restore = gs.restore;
    gs.restore = false;
    const wrap = h('section', { class: 'glossary' });
    const countEl = h('span', { class: 'gl-count', 'aria-live': 'polite' });
    wrap.appendChild(h('div', { class: 'page-head' }, h('h1', { class: 'page-title' }, '📖 용어집'), countEl));
    app.appendChild(wrap);

    if (!GLOSSARY.length) {
      wrap.appendChild(h('div', { class: 'card' },
        stateBox('📖', '용어집을 준비 중이에요', '용어집 데이터(data/glossary.js)를 불러오지 못했거나 아직 비어 있어요.', homeButton('btn-primary'))));
      return;
    }
    ensureGlossaryIndex();
    const cats = glossaryCategories();
    const catCount = countBy(GLOSSARY, function (g) { return g.category; });
    if (gs.cat && !catCount[gs.cat]) gs.cat = '';

    const input = h('input', {
      type: 'search', class: 'text-input gl-search', value: gs.query, autocomplete: 'off', spellcheck: 'false',
      placeholder: '용어·한글명·풀네임·뜻 검색 (예: NOR, 선석)', 'aria-label': '용어 검색'
    });
    const chips = h('div', { class: 'chips', role: 'group', 'aria-label': '용어 카테고리' });
    const chipBtns = [];
    function chip(label, value, n) {
      const check = h('span', { class: 'chip-check', 'aria-hidden': 'true' });
      const b = h('button', {
        type: 'button', class: 'chip' + (value ? '' : ' chip-all'), disabled: n === 0,
        onclick: function () { gs.cat = value; sync(); }
      }, check, label + ' ', h('span', { class: 'chip-count' }, String(n)));
      chipBtns.push({ b: b, check: check, value: value });
      chips.appendChild(b);
    }
    chip('전체', '', GLOSSARY.length);
    cats.forEach(function (c) { chip(c, c, catCount[c] || 0); });

    const grid = h('div', { class: 'term-grid' });
    wrap.appendChild(h('div', { class: 'gl-tools' },
      h('div', { class: 'gl-search-row' }, h('span', { class: 'gl-search-ico', 'aria-hidden': 'true' }, '🔍'), input),
      chips));
    wrap.appendChild(grid);

    function matches(g, qv, qns) {
      if (gs.cat && g.category !== gs.cat) return false;
      if (!qv) return true;
      return g.search.indexOf(qv) !== -1 || (qns !== '' && g.searchNs.indexOf(qns) !== -1);
    }
    function resetFilters() {
      gs.query = '';
      gs.cat = '';
      input.value = '';
      sync();
      focusQuiet(input);
    }
    // 칩은 그대로 두고 상태만 갱신(포커스 유지), 카드 목록만 다시 그림
    function sync() {
      chipBtns.forEach(function (c) {
        const on = c.value === gs.cat;
        c.b.setAttribute('aria-pressed', String(on));
        c.check.textContent = on ? '✓' : '';
      });
      const qv = String(gs.query || '').normalize('NFC').trim().toLowerCase();
      const qns = qv.replace(/\s+/g, '');
      const list = GLOSSARY.filter(function (g) { return matches(g, qv, qns); });
      countEl.textContent = (list.length === GLOSSARY.length ? '' : list.length + ' / ') + GLOSSARY.length + '개 용어';
      clear(grid);
      if (!list.length) {
        grid.appendChild(h('div', { class: 'card gl-empty' },
          stateBox('🔍', '검색 결과가 없어요', '다른 검색어나 카테고리를 골라 보세요.',
            h('button', { type: 'button', class: 'btn btn-ghost', onclick: resetFilters }, '필터 초기화'))));
        return;
      }
      list.forEach(function (g) { grid.appendChild(termCard(g)); });
    }
    input.addEventListener('input', function () { gs.query = input.value; sync(); });
    input.addEventListener('keydown', function (e) {
      if ((e.key === 'Escape' || e.key === 'Esc') && input.value) { e.preventDefault(); gs.query = ''; input.value = ''; sync(); }
    });
    sync();
    if (restore && gs.scrollY) { try { window.scrollTo(0, gs.scrollY); } catch (e) { /* noop */ } }
  }

  // ===========================================================================
  // 🎮 게임 (🚢 항로 질주 · 🎯 슈팅해운) — 모듈 계약: window.PortGames[key].mount(container, ctx)
  // ===========================================================================
  const MUTE_KEY = 'portquiz.muted';
  const GAME_INFO = {
    runner: {
      icon: '🚢', title: '항로 질주',
      line: 'O/X 진술을 읽고 맞는 항로(왼쪽 O · 오른쪽 X)로 배를 몰아 게이트를 통과!',
      rules: [
        ['🚢', '왼쪽 레인은 O, 오른쪽 레인은 X. 게이트에 닿는 순간 배가 있는 레인으로 판정해요.'],
        ['⏱', '문장이 길수록 읽을 시간이 늘어나요. 난이도가 오를수록 조금씩 빨라져요.'],
        ['💡', '틀리면 정답과 해설을 잠깐 보여 줘요 (그동안 게임 정지).']
      ],
      controls: [
        ['⌨️', '키보드: ← / → 또는 A / D 로 레인 이동 · Esc 또는 P 로 일시정지'],
        ['🖱️', '마우스: 화면 아래 큰 [O] [X] 버튼'],
        ['📱', '터치: 좌우로 스와이프하거나 [O] [X] 버튼']
      ]
    },
    shooter: {
      icon: '🎯', title: '슈팅해운',
      line: '정의문을 읽고, 떠오르는 과녁 중 알맞은 용어를 쏴서 맞히세요!',
      rules: [
        ['🎯', '정의문에 맞는 용어 과녁을 명중시키세요. 오답 과녁을 맞히거나 제한 시간 안에 못 맞히면 목숨이 줄어요.'],
        ['💡', '틀리거나 놓친 문제는 결과 화면의 오답 노트에서 다시 볼 수 있어요.']
      ],
      controls: [
        ['🖱️', '마우스: 과녁을 클릭해서 사격'],
        ['📱', '터치: 과녁을 탭해서 사격'],
        ['⌨️', '키보드: 과녁 번호 1~6 으로 사격 · Esc 또는 P 로 일시정지']
      ]
    },
    sniper: {
      icon: '🔭', title: '스나이퍼해운',
      line: '틀린 진술을 단 위장 적선은 저격, 맞는 진술의 아군은 통과! 스코프로 항만을 지켜라.',
      rules: [
        ['🔭', '탱커 터미널 경비 초소에서 스코프로 항만을 감시해요. 멀리 지나가는 배마다 O/X 진술이 적혀 있어요.'],
        ['💥', '진술이 틀리면 위장한 적선 → 저격! 맞으면 아군 → 쏘지 말고 통과시키세요.'],
        ['🏅', '적선 격침 +100 × 콤보 배율 · 아군 무사 통과 +50 × 콤보 배율'],
        ['💔', '아군 오인 사격, 적선 놓침은 목숨 -1 · 사격 후 재장전 0.7초']
      ],
      controls: [
        ['🖱️', '데스크톱: 마우스로 조준 · 우클릭을 누르고 있으면 스코프 줌 · 좌클릭으로 사격'],
        ['⌨️', '키보드: 방향키/WASD 조준 · Z 또는 Shift 줌 토글 · Space/Enter 사격 · Esc/P 일시정지'],
        ['📱', '모바일: 드래그로 조준 · 하단 [🔭 줌] [🎯 발사] 버튼']
      ],
      livesNote: '오인 사격·놓침마다 하나씩 줄고',
      scoreLine: ['🔥', '콤보 배율 = 1 + 0.1 × 콤보 (최대 3배) — 저격·통과 판단을 연속으로 맞히면 올라가요']
    }
  };
  function gameModule(key) {
    const pg = window.PortGames;
    const m = (pg && typeof pg === 'object') ? pg[key] : null;
    return (m && typeof m.mount === 'function') ? m : null;
  }
  function gameCfg(key) {
    const gs = (CFG.games && typeof CFG.games === 'object') ? CFG.games : {};
    return (gs[key] && typeof gs[key] === 'object') ? gs[key] : {};
  }
  function gameLives(key) { return posInt(gameCfg(key).lives, 3); }
  function gameTitle(key) {
    const m = gameModule(key);
    return (m && typeof m.title === 'string' && m.title) ? m.title : GAME_INFO[key].title;
  }
  function gameAvailable(key) {
    if (!gameModule(key)) return false;
    if (key === 'runner' || key === 'sniper') return BANK.some(function (q) { return q.type === 'ox'; }); // O/X 진술 기반
    return BANK.length > 0 || !!window.SHOOTER_CARDS;
  }
  function isMuted() { try { return window.localStorage.getItem(MUTE_KEY) === '1'; } catch (e) { return false; } }
  function setMuted(v) { try { window.localStorage.setItem(MUTE_KEY, v ? '1' : '0'); } catch (e) { /* noop */ } }
  // 모듈이 rules/controls(문자열 배열)를 제공하면 그것을 우선 사용
  function moduleLines(m, field) {
    const v = m ? m[field] : null;
    return Array.isArray(v) ? v.filter(function (x) { return typeof x === 'string' && x.trim(); }).map(function (x) { return ['•', x.trim()]; }) : null;
  }

  function gameCard(key) {
    const info = GAME_INFO[key];
    const ok = gameAvailable(key);
    return h('button', { type: 'button', class: 'game-card game-card-' + key, disabled: !ok, onclick: function () { go('#/game/' + key); } },
      h('span', { class: 'game-card-icon', 'aria-hidden': 'true' }, info.icon),
      h('span', { class: 'game-card-body' },
        h('span', { class: 'game-card-title' }, gameTitle(key)),
        h('span', { class: 'game-card-desc' }, info.line),
        h('span', { class: 'game-card-meta' + (ok ? '' : ' is-empty') }, ok ? '목숨 ' + gameLives(key) + ' · 콤보 최대 3배 · 랭킹 도전' : '준비 중')));
  }

  function renderGameIntro(key) {
    const info = GAME_INFO[key];
    const title = gameTitle(key);
    beginScreen(title);
    const mod = gameModule(key);
    const ok = gameAvailable(key);
    function rule(r) {
      return h('li', null, h('span', { class: 'rule-ico', 'aria-hidden': 'true' }, r[0]), h('span', null, r[1]));
    }
    const common = [
      ['❤️', '목숨 ' + gameLives(key) + '개 — ' + (info.livesNote || '틀리면 하나씩 줄고') + ', 0이 되면 게임 오버'],
      info.scoreLine || ['🔥', '정답 100점 × 콤보 배율 (1 + 0.1 × 콤보, 최대 3배)'],
      ['📈', '하 → 중 → 상 순서로 출제, 같은 문제는 다시 나오지 않아요. 다 풀면 완주!']
    ];
    const soundBtn = h('button', { type: 'button', class: 'btn btn-ghost sound-toggle' });
    function renderSound() {
      const m = isMuted();
      soundBtn.textContent = m ? '🔇 효과음 꺼짐' : '🔊 효과음 켜짐';
      soundBtn.setAttribute('aria-pressed', String(!m));
    }
    soundBtn.addEventListener('click', function () { setMuted(!isMuted()); renderSound(); });
    renderSound();
    const startBtn = h('button', { type: 'button', class: 'btn btn-primary btn-xl', disabled: !ok, onclick: function () { startGame(key); } }, '🚀 시작');
    app.appendChild(h('section', { class: 'card game-intro' },
      h('div', { class: 'game-intro-icon game-intro-' + key, 'aria-hidden': 'true' }, info.icon),
      h('h1', { class: 'page-title' }, title),
      h('p', { class: 'game-intro-lead' }, (mod && typeof mod.desc === 'string' && mod.desc) ? mod.desc : info.line),
      h('h2', { class: 'game-sub' }, '📜 규칙'),
      h('ul', { class: 'rules' }, (moduleLines(mod, 'rules') || info.rules).concat(common).map(rule)),
      h('h2', { class: 'game-sub' }, '🕹️ 조작법'),
      h('ul', { class: 'rules' }, (moduleLines(mod, 'controls') || info.controls).map(rule)),
      ok ? null : h('p', { class: 'notice notice-warn' }, mod ? '⚠️ 출제할 문제가 없어 시작할 수 없어요.' : '⚠️ 게임을 준비 중이에요 (게임 파일을 불러오지 못했어요).'),
      h('div', { class: 'game-intro-actions' }, soundBtn, startBtn, homeButton('btn-ghost'))));
    if (ok) focusQuiet(startBtn);
  }

  // 시작 버튼 클릭(사용자 입력) 안에서 mount → 모듈이 AudioContext 를 바로 쓸 수 있음
  function startGame(key) {
    const mod = gameModule(key);
    if (!mod || !gameAvailable(key)) { renderGameIntro(key); return; }
    const title = gameTitle(key);
    const gen = beginScreen(title);
    document.body.classList.add('is-game');
    const container = h('div', { class: 'game-stage game-stage-' + key });
    app.appendChild(h('section', { class: 'game-page' }, h('h1', { class: 'sr-only' }, title), container));
    let handle = null;
    let done = false;
    function destroyGame() {
      const hd = handle;
      handle = null;
      if (hd && typeof hd.destroy === 'function') {
        try { hd.destroy(); } catch (e) { if (window.console) console.error('[Port Quiz] 게임 해제 실패', e); }
      }
    }
    // 라우트 이탈(beginScreen)·새로고침/페이지 닫기 모두 destroy
    onCleanup(destroyGame);
    const onPageHide = function () { destroyGame(); };
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('beforeunload', onPageHide);
    onCleanup(function () {
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('beforeunload', onPageHide);
    });
    // 헤더 링크로 떠나려 하면: 모듈을 일시정지시키고 확인 모달
    // (handle.pause 가 있으면 사용, 없으면 계약상 'window blur 시 자동 일시정지'를 이용)
    leaveGuard = function () {
      if (done || !handle) return false;
      try {
        if (typeof handle.pause === 'function') handle.pause();
        else window.dispatchEvent(new Event('blur'));
      } catch (e) { /* noop */ }
      return true;
    };
    const ctx = {
      bank: Array.isArray(window.QUESTION_BANK) ? window.QUESTION_BANK : [],
      cards: window.SHOOTER_CARDS || null,
      config: gameCfg(key),
      muted: isMuted(),
      onEnd: function (result) {
        if (done || gen !== screenGen) return;
        done = true;
        later(function () { if (gen === screenGen) renderGameResult(key, result); }, 0);
      },
      onQuit: function () {
        if (done || gen !== screenGen) return;
        done = true;
        later(function () { if (gen === screenGen) renderGameIntro(key); }, 0);
      }
    };
    try {
      handle = mod.mount(container, ctx) || null;
    } catch (e) {
      if (window.console) console.error('[Port Quiz] 게임 시작 실패', e);
      destroyGame();
      done = true;
      clear(container);
      container.appendChild(h('div', { class: 'card' },
        stateBox('⚠️', '게임을 시작하지 못했어요', errMsg(e),
          h('button', { type: 'button', class: 'btn btn-primary', onclick: function () { renderGameIntro(key); } }, '돌아가기'))));
    }
  }

  function sanitizeGameResult(raw) {
    const r = (raw && typeof raw === 'object') ? raw : {};
    const nn = function (v) { const n = Number(v); return (Number.isFinite(n) && n > 0) ? Math.floor(n) : 0; };
    const attempts = nn(r.attempts);
    const review = (Array.isArray(r.review) ? r.review : []).slice(0, 500).filter(function (x) { return x && typeof x === 'object'; }).map(function (x) {
      return {
        prompt: strField(x.prompt), answer: strField(x.answer), userAnswer: strField(x.userAnswer),
        explanation: strField(x.explanation), category: strField(x.category), level: coerceLevel(x.level)
      };
    });
    const lv = Number(r.maxLevel);
    return {
      score: nn(r.score),
      correct: Math.min(attempts, nn(r.correct)),
      attempts: attempts,
      timeMs: nn(r.timeMs),
      maxCombo: nn(r.maxCombo),
      maxLevel: (lv === 1 || lv === 2 || lv === 3) ? lv : 1,
      reason: r.reason === 'cleared' ? 'cleared' : 'lives',
      review: review
    };
  }

  function gameReviewSection(review) {
    const sec = h('section', { class: 'card review', 'aria-labelledby': 'review-title' });
    sec.appendChild(h('div', { class: 'section-head' },
      h('h2', { class: 'section-title', id: 'review-title' }, '📝 오답 노트 ', h('span', { class: 'count-pill' }, String(review.length)))));
    if (!review.length) {
      sec.appendChild(h('p', { class: 'empty' }, '🎉 틀리거나 놓친 문제가 없어요. 완벽해요!'));
      return sec;
    }
    const ol = h('ol', { class: 'review-list' });
    review.forEach(function (w) {
      ol.appendChild(h('li', { class: 'review-item' },
        h('div', { class: 'q-tags' }, w.category ? h('span', { class: 'tag tag-cat' }, w.category) : null, levelBadge(w.level)),
        h('p', { class: 'review-q' }, w.prompt || '(문제 정보 없음)'),
        h('p', { class: 'review-line is-wrong' },
          h('span', { class: 'mk', 'aria-hidden': 'true' }, '✗'), h('span', { class: 'lbl' }, '내 답'), h('span', { class: 'val' }, w.userAnswer || '(놓침)')),
        h('p', { class: 'review-line is-correct' },
          h('span', { class: 'mk', 'aria-hidden': 'true' }, '✓'), h('span', { class: 'lbl' }, '정답'), h('span', { class: 'val' }, w.answer || '-')),
        w.explanation ? h('p', { class: 'review-expl' }, h('span', { class: 'fb-expl-label' }, '💡 해설'), w.explanation) : null));
    });
    sec.appendChild(ol);
    return sec;
  }

  function renderGameResult(key, raw) {
    const r = sanitizeGameResult(raw);
    const title = gameTitle(key);
    const gen = beginScreen(title + ' 결과');
    const cleared = r.reason === 'cleared';
    const acc = pct(r.correct, r.attempts);
    const head = h('h1', { class: 'result-title', tabindex: '-1' }, cleared ? '🏆 완주!' : '💥 목숨 소진!');
    const wrap = h('section', { class: 'result' });
    wrap.appendChild(h('div', { class: 'card result-hero is-game' + (cleared ? ' is-complete' : '') },
      h('p', { class: 'result-mode' }, GAME_INFO[key].icon + ' ' + title + ' 결과'),
      head,
      h('p', { class: 'result-score', 'aria-label': '점수 ' + r.score + '점' },
        h('span', { class: 'big' }, fmtNum(r.score)), h('span', { class: 'of' }, '점')),
      h('dl', { class: 'result-stats' },
        statItem('맞힌 수', r.correct + ' / ' + r.attempts),
        statItem('정답률', acc + '%'),
        statItem('최고 콤보', r.maxCombo + (r.maxCombo >= 3 ? ' 🔥' : '')),
        statItem('플레이 시간', fmtClock(r.timeMs)),
        statItem('도달 난이도', levelBadge(r.maxLevel)),
        statItem('종료 사유', cleared ? '🏆 완주' : '💔 목숨 소진')),
      resultActions(function () { startGame(key); }, '🔄 다시 하기')));
    wrap.appendChild(rankSection(gen, {
      mode: key, score: r.score, total: r.attempts, correct: r.correct, timeMs: r.timeMs, blockReason: ''
    }));
    wrap.appendChild(gameReviewSection(r.review));
    app.appendChild(wrap);
    focusQuiet(head);
    announce((cleared ? '완주! ' : '목숨 소진! ') + '점수 ' + r.score + '점, ' + r.attempts + '문제 중 ' + r.correct + '개 정답.');
  }

  // ===========================================================================
  // ⏳ 오래 버텨라 (서바이벌)
  //   남은 시간이 0 이하가 되면 게임 오버. 정답 +bonus, 오답 -wrong, 패스 -pass (초).
  //   피드백 표시 중에는 시계 정지. 출제 순서: 하 셔플 → 중 셔플 → 상 셔플 (재출제 없음).
  // ===========================================================================
  const LV_SHORT = { 1: '하', 2: '중', 3: '상' };

  function survivalDeck() {
    let deck = [];
    LEVELS.forEach(function (l) {
      deck = deck.concat(shuffle(BANK.filter(function (q) { return q.level === l; })));
    });
    return deck;
  }

  function renderSurvivalIntro() {
    beginScreen(modeLabel('survival'));
    const empty = !BANK.length;
    const startBtn = h('button', { type: 'button', class: 'btn btn-primary btn-xl', disabled: empty, onclick: startSurvival }, '🚀 시작');
    function rule(icon, text) {
      return h('li', null, h('span', { class: 'rule-ico', 'aria-hidden': 'true' }, icon), h('span', null, text));
    }
    app.appendChild(h('section', { class: 'card sv-intro' },
      h('div', { class: 'sv-intro-icon', 'aria-hidden': 'true' }, MODE_ICONS.survival),
      h('h1', { class: 'page-title' }, modeLabel('survival')),
      h('p', { class: 'sv-intro-lead' }, '시간이 바닥나기 전까지 최대한 오래 버티세요! 맞히면 시간이 늘고, 틀리면 줄어들어요.'),
      h('ul', { class: 'rules' },
        rule('⏳', SURV.start + '초로 시작해요. 남은 시간이 0이 되면 바로 게임 오버!'),
        rule('✅', '정답 +' + SURV.bonus + '초 · 오답 -' + SURV.wrong + '초 · 패스 -' + SURV.pass + '초 (시간 상한 없음)'),
        rule('⏸️', '정답·오답 피드백이 보이는 동안에는 시계가 멈춰요.'),
        rule('📈', '하(빈출) → 중(실무) → 상(심화) 순서로 점점 어려워져요. 같은 문제는 다시 나오지 않아요.'),
        rule('🏆', '모든 문제를 풀면 완주! 맞힌 개수가 많을수록, 같으면 정답률이 높을수록 상위예요.'),
        rule('⌨️', '키보드: OX는 O/1 · X/2, 객관식은 1~4, 주관식은 Enter로 제출')),
      h('p', { class: 'sv-intro-meta' }, '📚 문제 은행 ' + BANK.length + '문제 (' +
        LEVELS.map(function (l) { return LV_SHORT[l] + ' ' + (LEVEL_COUNTS[l] || 0); }).join(' · ') +
        ') · 전체 카테고리 · 해설은 결과 화면의 오답 노트에서 확인'),
      empty ? h('p', { class: 'notice notice-error' }, '⚠️ 문제 데이터를 불러오지 못해 시작할 수 없어요.') : null,
      h('div', { class: 'sv-intro-actions' }, startBtn, homeButton('btn-ghost'))));
    if (!empty) focusQuiet(startBtn); // Enter 로 바로 시작
  }

  function startSurvival() {
    const gen = beginScreen(modeLabel('survival'));
    if (!BANK.length) { renderSurvivalIntro(); return; }

    const s = {
      phase: 'countdown',          // countdown → playing → finished | aborted
      deck: survivalDeck(),
      ptr: 0,
      current: null,
      view: null,
      flash: null,
      locked: false,
      remainMs: SURV.start * 1000, // 시계가 마지막으로 멈춘/다시 돈 시점의 남은 시간
      runningSince: null,          // 시계가 도는 중이면 그 시작 시각(Date.now), 멈춰 있으면 null
      survivedMs: 0,               // 시계가 실제로 돈 시간의 합 = 버틴 시간 (피드백 정지 시간 제외)
      endTimer: null,
      correct: 0,
      attempts: 0,
      combo: 0,
      best: 0,
      maxLevel: 0,
      wrongs: [],
      reason: ''
    };
    leaveGuard = function () { return s.phase === 'playing'; };

    const root = h('section', { class: 'sv' });
    app.appendChild(root);

    // --- 3·2·1 카운트다운 ---
    const cd = h('div', { class: 'countdown', role: 'status', 'aria-live': 'assertive' });
    root.appendChild(h('div', { class: 'card countdown-card' },
      h('p', { class: 'countdown-label' }, SURV_LABEL + ' — 준비하세요!'),
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

    // --- 게임 시계 (Date.now 기반, 피드백 중 정지) ---
    function remaining(now) {
      return s.runningSince === null ? s.remainMs : s.remainMs - (now - s.runningSince);
    }
    function survivedAt(now) {
      if (s.runningSince === null) return s.survivedMs;
      return s.survivedMs + Math.max(0, Math.min(now - s.runningSince, s.remainMs));
    }
    function pauseClock(now) {
      if (s.runningSince === null) return;
      const ran = Math.max(0, Math.min(now - s.runningSince, s.remainMs)); // 0 이하로는 흐르지 않음
      s.survivedMs += ran;
      s.remainMs -= ran;
      s.runningSince = null;
      cancelLater(s.endTimer);
      s.endTimer = null;
    }
    function resumeClock() {
      if (s.runningSince !== null) return;
      s.runningSince = Date.now();
      s.endTimer = later(tick, Math.max(0, s.remainMs) + 20); // 마감 순간 정밀 종료
    }

    // --- 플레이 화면 요소 ---
    let timeEl, timerBox, correctEl, attemptsEl, comboEl, comboBox, lvHud, survEl, stage, passBtn;

    function buildPlayUI() {
      clear(root);
      timeEl = h('span', { class: 'hud-time' }, fmtClock(s.remainMs));
      timerBox = h('div', { class: 'hud-timer', role: 'timer', 'aria-label': '남은 시간' },
        h('span', { class: 'hud-label' }, '남은 시간'), timeEl);
      correctEl = h('span', { class: 'hud-correct-num' }, '0');
      attemptsEl = h('b', null, '0');
      comboEl = h('b', null, '0');
      comboBox = h('span', { class: 'hud-combo' }, h('span', { class: 'fire', 'aria-hidden': 'true' }, '🔥'), '콤보 ', comboEl);
      lvHud = h('span', { class: 'lv-badge lv-1' }, LEVEL_LABELS[1]);
      survEl = h('b', null, '00:00');
      stage = h('div', { class: 'stage' });
      passBtn = h('button', { type: 'button', class: 'btn btn-ghost btn-pass', onclick: function () { answer(PASS); } }, '⏭️ 패스 (-' + SURV.pass + '초)');
      root.appendChild(h('div', { class: 'sv-hud' },
        timerBox,
        h('div', { class: 'hud-correct' }, h('span', { class: 'hud-label' }, '맞힌 개수'), correctEl),
        h('div', { class: 'hud-side' },
          h('span', { class: 'hud-lv' }, '난이도 ', lvHud),
          h('span', { class: 'hud-surv' }, '버틴 시간 ', survEl),
          h('span', { class: 'hud-attempts' }, '시도 ', attemptsEl),
          comboBox)));
      root.appendChild(stage);
      root.appendChild(h('div', { class: 'sv-actions' },
        passBtn,
        h('button', { type: 'button', class: 'btn btn-quit', onclick: quit }, '그만두기')));
    }

    function renderClock(rem, now) {
      timeEl.textContent = fmtClock(Math.max(0, Math.ceil(rem / 1000) * 1000));
      timerBox.classList.toggle('is-danger', rem <= 10000);
      survEl.textContent = fmtClock(survivedAt(now));
    }

    function play() {
      if (gen !== screenGen || s.phase !== 'countdown') return;
      s.phase = 'playing';
      buildPlayUI();
      every(tick, 100);
      const onVis = function () { if (!document.hidden) tick(); };
      document.addEventListener('visibilitychange', onVis);
      onCleanup(function () { document.removeEventListener('visibilitychange', onVis); });
      nextQ();
      resumeClock();
      tick();
    }

    function tick() {
      if (s.phase !== 'playing') return;
      const now = Date.now();
      const rem = remaining(now);
      if (s.runningSince !== null && rem <= 0) { timeOut(); return; }
      renderClock(rem, now);
    }

    function timeOut() {
      if (s.phase !== 'playing') return;
      pauseClock(Date.now());
      s.remainMs = 0;
      finish('timeout');
    }

    function nextQ() {
      const q = s.deck[s.ptr++];
      const prevLevel = s.current ? s.current.q.level : 0;
      s.current = prepareItem(q);
      if (q.level > s.maxLevel) s.maxLevel = q.level;
      s.locked = false;
      s.view = questionView(s.current, answer);
      lvHud.className = 'lv-badge lv-' + q.level;
      lvHud.textContent = LEVEL_LABELS[q.level];
      if (prevLevel && q.level > prevLevel) {
        s.view.el.insertBefore(h('p', { class: 'level-up' }, '📈 난이도 상승! ', levelBadge(q.level)), s.view.el.firstChild);
        announce('난이도 상승! ' + LEVEL_LABELS[q.level]);
        bump(lvHud);
      }
      s.flash = h('div', { class: 'sv-flash', hidden: true });
      s.view.el.appendChild(s.flash);
      clear(stage);
      stage.appendChild(s.view.el);
      passBtn.classList.remove('is-locked');
      if (s.view.input && !Modal.isOpen()) focusQuiet(s.view.input); // 확인 모달 뒤로 포커스를 뺏지 않음
    }

    function showDelta(sec, isPass) {
      if (!sec) return;
      const el = h('span', { class: 'time-delta ' + (sec > 0 ? 'is-plus' : (isPass ? 'is-pass' : 'is-minus')), 'aria-hidden': 'true' },
        (sec > 0 ? '+' : '-') + Math.abs(sec) + '초');
      timerBox.appendChild(el);
      later(function () { detach(el); }, 1300);
    }

    function answer(value) {
      if (s.phase !== 'playing' || s.locked || !s.current) return;
      const now = Date.now();
      if (remaining(now) <= 0) { timeOut(); return; } // 시간이 다 된 뒤의 입력은 무효
      pauseClock(now); // 피드백 동안 시계 정지 (보너스·페널티만 반영)
      s.locked = true;
      passBtn.classList.add('is-locked');
      const item = s.current;
      const isPass = value === PASS;
      const correct = !isPass && grade(item, value);
      const delta = correct ? SURV.bonus : -(isPass ? SURV.pass : SURV.wrong);
      s.remainMs += delta * 1000;
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
      showDelta(delta, isPass);
      renderClock(s.remainMs, now);

      revealView(s.view, value, correct);
      const f = s.flash;
      const dead = s.remainMs <= 0;
      clear(f);
      f.className = 'sv-flash ' + (correct ? 'is-correct' : 'is-wrong');
      f.hidden = false;
      f.appendChild(h('span', { class: 'fl-icon', 'aria-hidden': 'true' }, correct ? '✓' : '✗'));
      if (correct) {
        f.appendChild(h('span', null, '정답! +' + SURV.bonus + '초' + (s.combo >= 3 ? ' · 🔥 ' + s.combo + '콤보' : '')));
      } else {
        f.appendChild(h('span', null, (isPass ? '패스 -' + SURV.pass + '초' : '오답 -' + SURV.wrong + '초') + ' · 정답: '));
        f.appendChild(h('strong', null, correctText(item.q)));
        if (dead) f.appendChild(h('span', { class: 'fl-dead' }, '⌛ 시간이 모두 소진됐어요'));
      }
      announce(correct
        ? '정답. ' + SURV.bonus + '초 추가'
        : (isPass ? '패스. ' : '오답. ') + '정답은 ' + correctText(item.q) + (dead ? '. 시간이 모두 소진됐어요' : ''));
      later(afterFeedback, correct ? 500 : 1200);
    }

    function afterFeedback() {
      if (s.phase !== 'playing') return;
      if (s.remainMs <= 0) { s.remainMs = 0; finish('timeout'); return; } // 오답·패스로 0 이하 → 피드백 후 종료
      if (s.ptr >= s.deck.length) { finish('complete'); return; }       // 전부 소진 → 완주
      nextQ();
      resumeClock();
      tick();
    }

    function finish(reason) {
      if (s.phase !== 'playing') return;
      pauseClock(Date.now());
      s.phase = 'finished';
      s.reason = reason;
      renderSurvivalResult(s); // beginScreen 에서 interval·timeout·리스너·모달 모두 정리
    }

    function quit() {
      if (s.phase !== 'playing') return;
      confirmQuit('오래 버텨라를 그만둘까요?', '기록은 저장되지 않아요. (확인 창이 떠 있는 동안에도 시계는 계속 흘러요)').then(function (ok) {
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

  function survHeadline(n) {
    if (n >= 60) return '🏆 전설의 항해사! 엄청나게 버텼어요';
    if (n >= 30) return '🚢 대단해요! 거친 파도도 문제없어요';
    if (n >= 15) return '⚓ 좋아요! 꾸준히 버텼어요';
    if (n >= 1) return '🌊 다음엔 더 오래 버텨 봐요';
    return '💪 다시 도전해 봐요';
  }

  function renderSurvivalResult(s) {
    const gen = beginScreen(modeLabel('survival') + ' 결과');
    const acc = pct(s.correct, s.attempts);
    const complete = s.reason === 'complete';
    const title = h('h1', { class: 'result-title', tabindex: '-1' }, complete ? '🏆 완주!' : '⌛ 시간 종료!');
    const wrap = h('section', { class: 'result' });
    wrap.appendChild(h('div', { class: 'card result-hero is-sv' + (complete ? ' is-complete' : '') },
      h('p', { class: 'result-mode' }, SURV_LABEL + ' 결과'),
      title,
      h('p', { class: 'result-sub' }, complete ? '모든 문제를 풀어냈어요. 진정한 체선료 마스터!' : survHeadline(s.correct)),
      h('p', { class: 'result-score', 'aria-label': '맞힌 개수 ' + s.correct + '개' },
        h('span', { class: 'big' }, String(s.correct)), h('span', { class: 'of' }, '개 정답')),
      h('dl', { class: 'result-stats' },
        statItem('버틴 시간', fmtClock(s.survivedMs)),
        statItem('시도', s.attempts + '문제'),
        statItem('정답률', acc + '%'),
        statItem('최고 콤보', s.best + (s.best >= 3 ? ' 🔥' : '')),
        statItem('도달 난이도', s.maxLevel ? levelBadge(s.maxLevel) : '-'),
        statItem('완주 여부', complete ? '🏆 완주' : '⌛ 시간 종료')),
      resultActions(startSurvival, '🔄 다시 도전')));
    wrap.appendChild(rankSection(gen, {
      mode: 'survival', score: s.correct, total: s.attempts, timeMs: s.survivedMs, blockReason: ''
    }));
    wrap.appendChild(reviewSection(s.wrongs, s.attempts ? '🎉 틀린 문제가 없어요. 완벽해요!' : '푼 문제가 없어요.'));
    app.appendChild(wrap);
    focusQuiet(title);
    announce((complete ? '완주! ' : '시간 종료! ') + s.attempts + '문제 중 ' + s.correct + '개 정답, 버틴 시간 ' + fmtClock(s.survivedMs) + '.');
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
