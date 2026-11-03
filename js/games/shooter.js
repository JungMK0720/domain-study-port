/*!
 * Port Quiz — 🎯 슈팅해운 (용어 사격 게임 모듈)
 * 순수 바닐라 JS (ES2019, IIFE). 외부 라이브러리·이미지·폰트 없음. 전역은 window.PortGames 만 사용한다.
 *
 * 계약
 *   window.PortGames.shooter = { key: 'shooter', title: '슈팅해운', mount(container, ctx) → { destroy, pause, resume } }
 *   ctx    = { bank, cards, config, muted, onEnd(result), onQuit() }
 *   result = { score, correct, attempts, timeMs, maxCombo, maxLevel, reason: 'lives' | 'cleared',
 *              review: [{ prompt, answer, userAnswer, explanation, category, level }] }   ← 틀리거나 놓친 문제만
 *
 * 설정 (APP_CONFIG.games.shooter — 모두 선택. 없거나 이상한 값이면 아래 기본값)
 *   lives 3 · roundSeconds {1: 9, 2: 8, 3: 7} · promptCharsPerSecond 25 · maxPromptBonusSeconds 4
 *   distractors {1: 2, 2: 3, 3: 4} · maxDistractors 5 · comboStep 3 (연속 정답 N개마다 오답 과녁 +1)
 *   revealMs 1600 · hitSlop 12 · baseScore 100 · timeBonus 100 · comboRate 0.1 · maxMultiplier 3
 */
(function () {
  'use strict';

  const PG = window.PortGames = window.PortGames || {};

  // ===========================================================================
  // 상수 · 유틸
  // ===========================================================================
  const TAU = Math.PI * 2;
  const LEVELS = [1, 2, 3];
  const LEVEL_LABELS = { 1: '하 · 빈출', 2: '중 · 실무', 3: '상 · 심화' };
  const MISS_TEXT = '놓침';
  const COUNTDOWN_MS = 3000;     // 3·2·1
  const GO_MS = 500;             // 'GO!' 표시 시간
  const LEAD_MS = 400;           // 라운드 시작(정의문 표시) → 첫 과녁 등장
  const MAX_STAGGER_MS = 1800;   // 첫 과녁 ~ 마지막 과녁 등장 간격 상한
  const MAX_GAP_MS = 550;        // 과녁 사이 등장 간격 상한
  const WIN_DELAY_MS = 750;      // 정답 명중 → 다음 카드
  const CLEAR_DELAY_MS = 1300;   // 마지막 카드 정답 → 종료 화면
  const ANIM_MS = { pop: 280, burst: 380, fade: 420 };
  const FONT = '"Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif';
  const FW_COLORS = ['#ffd43b', '#0fa3b1', '#ff922b', '#ffffff', '#63e6be', '#74c0fc', '#f783ac'];
  const BAD_COLORS = ['#ff6b6b', '#e03131', '#ffa8a8', '#c92a2a'];
  const HINT_RE = /\s*[(（]([^()（）]*)[)）]\s*$/;
  const HINT_WORDS = /글자|약어|약칭|단어|영문|한글|숫자|자리|또는/;
  let uid = 0;

  const normalize = function (s) { return String(s).normalize('NFC').toLowerCase().replace(/[\s\-_.·・\/()'"`,]/g, ''); };
  function str(v) {
    if (typeof v === 'string') return v.trim();
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
    return '';
  }
  function strList(v) { return Array.isArray(v) ? v.map(str).filter(Boolean) : []; }
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function num(v, def, lo, hi) {
    if (v === null || v === undefined || v === '' || typeof v === 'boolean') return def;
    const n = Number(v);
    return Number.isFinite(n) ? clamp(n, lo, hi) : def;
  }
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function range(n) { const a = []; for (let i = 0; i < n; i++) a.push(i); return a; }
  function fmtInt(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function perfNow() {
    const p = window.performance;
    return (p && typeof p.now === 'function') ? p.now() : Date.now();
  }
  function prefersReducedMotion() {
    try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; }
  }
  // 난이도: 1=하, 2=중, 3=상 — 없거나 이상하면 2(중) (app.js 와 같은 규칙)
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
  function charCount(s) { return Array.from(String(s).replace(/\s+/g, ' ').trim()).length; }
  function fontOf(px, weight) { return (weight || 800) + ' ' + Math.max(1, Math.round(px)) + 'px ' + FONT; }

  // ===========================================================================
  // 설정
  // ===========================================================================
  function levelMap(v, def, lo, hi, round) {
    const out = {};
    LEVELS.forEach(function (l, i) {
      let raw;
      if (Array.isArray(v)) raw = v[i];
      else if (v && typeof v === 'object') raw = v[l];
      else raw = v; // 숫자 하나면 모든 난이도에 적용
      const n = num(raw, def[l], lo, hi);
      out[l] = round ? Math.round(n) : n;
    });
    return out;
  }
  function readConfig(raw) {
    const c = (raw && typeof raw === 'object') ? raw : {};
    return {
      lives: Math.round(num(c.lives, 3, 1, 99)),
      roundSec: levelMap(c.roundSeconds, { 1: 9, 2: 8, 3: 7 }, 2, 60, false),
      charsPerSec: num(c.promptCharsPerSecond, 25, 1, 1000),
      maxPromptBonus: num(c.maxPromptBonusSeconds, 4, 0, 30),
      distractors: levelMap(c.distractors, { 1: 2, 2: 3, 3: 4 }, 1, 5, true),
      maxDistractors: Math.round(num(c.maxDistractors, 5, 1, 5)), // 정답 1 + 오답 5 = 숫자키 1~6
      comboStep: Math.round(num(c.comboStep, 3, 1, 1000)),
      revealMs: num(c.revealMs, 1600, 300, 15000),
      hitSlop: num(c.hitSlop, 12, 0, 80),
      baseScore: num(c.baseScore, 100, 0, 100000),
      timeBonus: num(c.timeBonus, 100, 0, 100000),
      comboRate: num(c.comboRate, 0.1, 0, 10),
      maxMult: num(c.maxMultiplier, 3, 1, 100)
    };
  }

  // ===========================================================================
  // 카드 — window.SHOOTER_CARDS 정리, 없으면 문제 은행(주관식)에서 폴백 생성
  // ===========================================================================
  function keySet(answer, accept) {
    const set = new Set();
    [answer].concat(accept).forEach(function (a) { const k = normalize(a); if (k) set.add(k); });
    return set;
  }
  // 정규화 기준으로 정답(accept)과 겹치거나 서로 중복되는 용어를 뺀다
  function distinctTerms(list, blocked) {
    const seen = new Set(blocked);
    const out = [];
    list.forEach(function (t) {
      const s = str(t);
      const k = s ? normalize(s) : '';
      if (!k || seen.has(k)) return;
      seen.add(k);
      out.push(s);
    });
    return out;
  }
  function sanitizeCards(raw) {
    const out = [];
    const ids = new Set();
    (Array.isArray(raw) ? raw : []).forEach(function (c, i) {
      if (!c || typeof c !== 'object') return;
      const prompt = str(c.prompt);
      const answer = str(c.answer);
      if (!prompt || !answer || !normalize(answer)) return;
      const id = str(c.id) || ('card-' + i);
      if (ids.has(id)) return;
      const distractors = distinctTerms(strList(c.distractors), keySet(answer, strList(c.accept)));
      if (!distractors.length) return;
      ids.add(id);
      out.push({
        id: id,
        level: coerceLevel(c.level),
        category: str(c.category) || '기타',
        prompt: prompt,
        answer: answer,
        distractors: distractors,
        explanation: str(c.explanation)
      });
    });
    return out;
  }
  // 문제 끝의 형태 힌트 괄호 제거: "…영문 약어는? (영문 약어 3글자)" → "…영문 약어는?"
  function stripHint(q) {
    const s = str(q);
    const m = HINT_RE.exec(s);
    if (!m || !HINT_WORDS.test(m[1])) return s;
    return s.slice(0, m.index).trim() || s;
  }
  function isHangul(s) { return /[ᄀ-ᇿ㄰-㆏가-힯]/.test(s); }
  function fallbackCards(bank) {
    const pool = [];
    const ids = new Set();
    (Array.isArray(bank) ? bank : []).forEach(function (q, i) {
      if (!q || typeof q !== 'object' || q.type !== 'short') return;
      const answer = str(q.answer);
      const question = str(q.question);
      if (!question || !answer || answer.length > 16 || !normalize(answer)) return;
      const id = str(q.id) || ('q' + i);
      if (ids.has(id)) return;
      ids.add(id);
      pool.push({ id: id, q: q, answer: answer, category: str(q.category) || '기타', keys: keySet(answer, strList(q.accept)) });
    });
    const out = [];
    pool.forEach(function (p) {
      const ko = isHangul(p.answer);
      // 같은 카테고리의 다른 주관식 정답 — 글자 종류(한글/영문)가 같은 것을 먼저 고른다
      const same = shuffle(pool.filter(function (o) { return o !== p && o.category === p.category; }).map(function (o) { return o.answer; }))
        .sort(function (a, b) { return (isHangul(a) === ko ? 0 : 1) - (isHangul(b) === ko ? 0 : 1); });
      let ds = distinctTerms(same, p.keys).slice(0, 4);
      if (ds.length < 4) { // 같은 카테고리가 모자라면 다른 카테고리에서 채운다
        const others = shuffle(pool.filter(function (o) { return o.category !== p.category; }).map(function (o) { return o.answer; }));
        ds = distinctTerms(ds.concat(others), p.keys).slice(0, 4);
      }
      const prompt = stripHint(p.q.question);
      if (!prompt || !ds.length) return;
      out.push({
        id: p.id,
        level: coerceLevel(p.q.level),
        category: p.category,
        prompt: prompt,
        answer: p.answer,
        distractors: ds,
        explanation: str(p.q.explanation)
      });
    });
    return out;
  }
  // 출제 순서: 하 셔플 → 중 셔플 → 상 셔플 (한 판에서 같은 카드는 한 번만)
  function buildDeck(cards) {
    const deck = [];
    LEVELS.forEach(function (l) {
      shuffle(cards.filter(function (c) { return c.level === l; })).forEach(function (c) { deck.push(c); });
    });
    return deck;
  }

  // ===========================================================================
  // 캔버스 도형
  // ===========================================================================
  // 캡슐(알약) 경로 — hw <= r 이면 원
  function pill(c, x, y, hw, r) {
    c.beginPath();
    if (hw <= r + 0.01) { c.arc(x, y, r, 0, TAU); c.closePath(); return; }
    const L = x - hw + r;
    const R = x + hw - r;
    c.moveTo(L, y - r);
    c.lineTo(R, y - r);
    c.arc(R, y, r, -Math.PI / 2, Math.PI / 2);
    c.lineTo(L, y + r);
    c.arc(L, y, r, Math.PI / 2, Math.PI * 1.5);
    c.closePath();
  }

  // ===========================================================================
  // mount
  // ===========================================================================
  function mount(container, ctx) {
    if (!container || typeof container.appendChild !== 'function') throw new Error('[슈팅해운] container 가 필요합니다.');
    const opts = (ctx && typeof ctx === 'object') ? ctx : {};
    const cfg = readConfig(opts.config);
    const muted = !!opts.muted;
    let cards = sanitizeCards(opts.cards);
    if (!cards.length) cards = fallbackCards(opts.bank);
    const deck = buildDeck(cards);
    const reduced = prefersReducedMotion();
    const hasRaf = typeof window.requestAnimationFrame === 'function' && typeof window.cancelAnimationFrame === 'function';
    const id = ++uid;

    // ---- 상태 ----
    let destroyed = false;
    let phase = deck.length ? 'countdown' : 'empty'; // countdown → playing → ending → over | quit
    let paused = false;
    let clock = 0;            // 게임 시계(ms) — 일시정지 중에는 멈춤
    let lastNow = 0;
    let rafId = 0;
    let cdLabel = '';
    let playStart = null;     // 플레이 시작 시각(performance.now)
    let pausedTotal = 0;      // 플레이 중 일시정지한 시간 합
    let pauseStart = 0;
    let finalTimeMs = 0;
    let endAt = 0;
    let endReason = '';
    let lives = cfg.lives;
    let score = 0;
    let correct = 0;
    let attempts = 0;
    let combo = 0;
    let maxCombo = 0;
    let maxLevel = 0;
    let idx = 0;
    let round = null;
    const review = [];
    // 캔버스
    let g = null;
    let W = 0, H = 0, dpr = 1;
    let horizon = 0, laneTop = 0, laneBottom = 0, baseR = 22;
    let bg = null;            // 정적 배경(하늘·항만 실루엣·바다) 캐시
    // 오디오 · 리사이즈 관찰자
    let audio = null, master = null, noiseBuf = null;
    let ro = null;
    // 이펙트
    const parts = [];
    const rings = [];
    const texts = [];
    const pending = [];
    let flash = null;
    let shakeT = 0;
    // HUD · 시간 바 캐시
    const cache = {};
    let barValue = -1;
    let barCls = '';

    // ---- 정리 대상(리스너) ----
    const listeners = [];
    function on(target, type, fn, options) {
      if (!target || typeof target.addEventListener !== 'function') return;
      target.addEventListener(type, fn, options);
      listeners.push([target, type, fn, options]);
    }
    function offAll() {
      listeners.splice(0).forEach(function (l) {
        try { l[0].removeEventListener(l[1], l[2], l[3]); } catch (e) { /* noop */ }
      });
    }

    // =========================================================================
    // DOM
    // =========================================================================
    function el(tag, cls, text) {
      const e = document.createElement(tag);
      if (cls) e.className = cls;
      if (text !== undefined && text !== null) e.textContent = String(text);
      return e;
    }
    function append(parent) {
      for (let i = 1; i < arguments.length; i++) if (arguments[i]) parent.appendChild(arguments[i]);
      return parent;
    }
    function button(cls, text, label, fn) {
      const b = el('button', cls, text);
      b.type = 'button';
      if (label) b.setAttribute('aria-label', label);
      on(b, 'click', function () { unlockAudio(); fn(); });
      return b;
    }
    function focusQuiet(node) {
      if (!node || typeof node.focus !== 'function') return;
      try { node.focus({ preventScroll: true }); } catch (e) { try { node.focus(); } catch (e2) { /* noop */ } }
    }
    function bump(node) {
      node.classList.remove('sh-bump');
      void node.offsetWidth; // 애니메이션 재시작
      node.classList.add('sh-bump');
    }

    ensureStyles();
    while (container.firstChild) container.removeChild(container.firstChild);
    const root = el('div', 'shooter');
    root.setAttribute('tabindex', '-1');
    root.setAttribute('role', 'region');
    root.setAttribute('aria-label', '슈팅해운 게임');

    // HUD: 목숨 · 점수 · 콤보 배율 · 난이도 · 맞힌 수/시도 수 · 일시정지
    const livesFull = el('span', 'sh-lives-full');
    const livesEmpty = el('span', 'sh-lives-empty');
    const livesEl = append(el('span', 'sh-pill sh-lives'), livesFull, livesEmpty);
    const scoreNum = el('b', null, '0');
    const scoreEl = append(el('span', 'sh-pill sh-score'), el('span', 'sh-hud-label', '점수'), scoreNum);
    const multNum = el('b', null, '×1.0');
    const multEl = append(el('span', 'sh-pill sh-mult'), el('span', 'sh-fire', '🔥'), el('span', 'sh-hud-label', '콤보'), multNum);
    multEl.title = '콤보 배율 (연속 정답마다 +0.1, 최대 ×' + cfg.maxMult + ')';
    const lvEl = el('span', 'lv-badge lv-1 sh-lv', LEVEL_LABELS[1]);
    const accNum = el('b', null, '0/0');
    const accEl = append(el('span', 'sh-pill sh-acc'), el('span', 'sh-hud-label', '맞힘'), accNum);
    accEl.title = '맞힌 수 / 시도 수';
    const pauseBtn = button('sh-pause-btn', '⏸', '일시정지 (Esc 또는 P)', function () { pause(true); });
    const hud = append(el('div', 'sh-hud'), livesEl, scoreEl, multEl, lvEl, accEl, pauseBtn);

    // 정의문 배너 + 라운드 남은 시간 바 + 놓침 해설
    const catEl = el('span', 'sh-cat', '🎯 슈팅해운');
    const progEl = el('span', 'sh-prog', '카드 0 / ' + deck.length);
    const promptEl = el('p', 'sh-prompt', '곧 시작해요! 정의문을 읽고 알맞은 용어 과녁을 쏘세요.');
    promptEl.setAttribute('aria-live', 'polite');
    const barFill = el('div', 'sh-timebar-fill');
    const bar = append(el('div', 'sh-timebar'), barFill);
    bar.setAttribute('aria-hidden', 'true');
    const revealHead = el('p', 'sh-reveal-head');
    const revealAnswer = el('strong', 'sh-reveal-term');
    const revealExpl = el('p', 'sh-reveal-expl');
    const reveal = append(el('div', 'sh-reveal'), revealHead,
      append(el('p', 'sh-reveal-answer'), el('span', 'sh-reveal-label', '정답:'), revealAnswer), revealExpl);
    reveal.hidden = true;
    const banner = append(el('div', 'sh-banner'), append(el('div', 'sh-meta'), catEl, progEl), promptEl, bar, reveal);

    // 무대(캔버스) + 카운트다운
    const canvas = el('canvas', 'sh-canvas');
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', '사격장: 정의문에 맞는 용어 과녁을 클릭·탭하거나 과녁 번호(1~6) 키로 쏘세요.');
    const cdNumWrap = el('div', 'sh-countdown-num-wrap');
    const countdown = append(el('div', 'sh-countdown'), cdNumWrap, el('p', 'sh-countdown-sub', '정의문에 맞는 용어 과녁을 쏘세요!'));
    countdown.setAttribute('role', 'status');
    countdown.setAttribute('aria-live', 'assertive');
    const stage = append(el('div', 'sh-stage'), canvas, countdown);

    // 일시정지 오버레이 (게임 전체를 덮어 정의문·과녁을 가린다)
    const pauseTitleId = 'sh-pause-title-' + id;
    const pauseStats = el('p', 'sh-overlay-stats');
    const resumeBtn = button('btn btn-primary btn-block sh-btn', '▶ 계속하기', null, function () { resume(); });
    const quitBtn = button('btn btn-ghost btn-block sh-btn sh-btn-quit', '그만두기', '그만두기 (기록은 저장되지 않아요)', function () { quit(); });
    const pauseTitle = el('h2', 'sh-overlay-title', '일시정지');
    pauseTitle.id = pauseTitleId;
    const overlay = append(el('div', 'sh-overlay'),
      append(el('div', 'sh-overlay-card'),
        el('p', 'sh-overlay-icon', '⏸'),
        pauseTitle,
        pauseStats,
        append(el('div', 'sh-overlay-actions'), resumeBtn, quitBtn),
        el('p', 'sh-overlay-hint', 'Esc 또는 P 키로도 계속할 수 있어요 · 그만두면 기록은 저장되지 않아요')));
    overlay.hidden = true;
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', pauseTitleId);

    const help = el('p', 'sh-help', '클릭·탭(우클릭도 가능) 또는 숫자키 1~6으로 사격 · 오답 과녁을 쏘거나 정답 과녁을 놓치면 ♥ -1 · Esc/P 일시정지');
    const live = el('p', 'sh-sr');
    live.setAttribute('aria-live', 'polite');

    if (phase === 'empty') {
      const back = button('btn btn-primary', '돌아가기', null, function () { quit(); });
      append(root, append(el('div', 'sh-empty'),
        el('p', 'sh-empty-icon', '🎯'),
        el('p', 'sh-empty-title', '출제할 카드가 없어요'),
        el('p', 'sh-empty-msg', '카드·문제 데이터를 불러오지 못해 슈팅해운을 시작할 수 없어요.'),
        back));
      container.appendChild(root);
      focusQuiet(back);
      return { destroy: destroy, pause: function () {}, resume: function () {} };
    }

    append(root, hud, banner, stage, help, live, overlay);
    container.appendChild(root);

    // =========================================================================
    // 캔버스 크기 (container 너비 · devicePixelRatio 대응)
    // =========================================================================
    try { g = canvas.getContext('2d'); } catch (e) { g = null; }

    function layout() {
      const cw = Math.floor(stage.clientWidth || root.clientWidth || container.clientWidth || 0);
      const w = cw > 0 ? Math.max(240, cw) : (W || 360);
      const vh = window.innerHeight || 720;
      let h = clamp(Math.round(w * (w < 560 ? 1.0 : 0.58)), 280, 460);
      h = Math.round(Math.min(h, Math.max(260, vh - 250)));
      const ratio = clamp(Number(window.devicePixelRatio) || 1, 1, 3);
      if (w === W && h === H && ratio === dpr) return false;
      W = w; H = h; dpr = ratio;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      canvas.style.height = H + 'px';
      horizon = Math.round(H * 0.24);
      baseR = clamp(Math.round(W * 0.042), 19, 28);
      laneTop = horizon + baseR + 8;
      laneBottom = H - baseR - 8;
      buildBackground();
      if (round) refitRound();
      return true;
    }

    function measure(text, fs) {
      if (g && typeof g.measureText === 'function') {
        g.font = fontOf(fs, 800);
        const m = g.measureText(text);
        if (m && Number.isFinite(m.width) && m.width > 0) return m.width;
      }
      let w = 0;
      Array.from(text).forEach(function (ch) { w += /[ᄀ-ᇿ　-鿿가-힯＀-￯]/.test(ch) ? fs * 0.95 : fs * 0.6; });
      return w;
    }
    // 라벨이 길면 캡슐형으로 넓히고, 화면을 넘으면 글자를 줄이고 마지막엔 말줄임
    function fitTarget(t) {
      const r = round.r;
      const pad = r * 0.46 + 4;
      const maxHalf = W * 0.45;
      let fs = clamp(Math.round(r * 0.68), 11, 17);
      let text = t.label;
      let tw = measure(text, fs);
      while (fs > 10 && tw / 2 + pad > maxHalf) { fs--; tw = measure(text, fs); }
      if (tw / 2 + pad > maxHalf) {
        const chars = Array.from(text);
        while (chars.length > 1 && measure(chars.join('') + '…', fs) / 2 + pad > maxHalf) chars.pop();
        text = chars.join('') + '…';
        tw = measure(text, fs);
      }
      t.fs = fs;
      t.text = text;
      t.r = r;
      t.hw = Math.max(r, tw / 2 + pad);
    }
    function roundGeometry(n) {
      const spacing = Math.max(1, laneBottom - laneTop) / n;
      return { spacing: spacing, r: clamp(Math.min(baseR, spacing / 2 - 1), 15, baseR) };
    }
    function refitRound() {
      const geo = roundGeometry(round.n);
      round.spacing = geo.spacing;
      round.r = geo.r;
      round.wave = clamp(geo.spacing * 0.45, 8, 26);
      round.targets.forEach(function (t) { fitTarget(t); if (t.state === 'live' || t.state === 'fade') positionTarget(t); });
    }

    // =========================================================================
    // 효과음 (WebAudio 합성 · 첫 사용자 입력 때 생성/resume · muted 면 무음)
    // =========================================================================
    function unlockAudio() {
      if (muted || destroyed) return;
      if (!audio) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (typeof AC !== 'function') return;
        try {
          audio = new AC();
          master = audio.createGain();
          master.gain.value = 0.5;
          master.connect(audio.destination);
        } catch (e) { audio = null; master = null; return; }
      }
      if (audio.state === 'suspended' && typeof audio.resume === 'function') {
        try { const p = audio.resume(); if (p && typeof p.catch === 'function') p.catch(function () {}); } catch (e) { /* noop */ }
      }
    }
    function tone(f0, f1, dur, type, vol, delay) {
      const t0 = audio.currentTime + (delay || 0);
      const o = audio.createOscillator();
      const gn = audio.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f0, t0);
      if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
      gn.gain.setValueAtTime(0.0001, t0);
      gn.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
      gn.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(gn);
      gn.connect(master);
      o.start(t0);
      o.stop(t0 + dur + 0.03);
    }
    function noise(dur, vol, hp) {
      if (!noiseBuf) {
        const len = Math.max(1, Math.floor(audio.sampleRate * 0.25));
        noiseBuf = audio.createBuffer(1, len, audio.sampleRate);
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      }
      const t0 = audio.currentTime;
      const src = audio.createBufferSource();
      src.buffer = noiseBuf;
      const f = audio.createBiquadFilter();
      f.type = 'highpass';
      f.frequency.value = hp;
      const gn = audio.createGain();
      gn.gain.setValueAtTime(vol, t0);
      gn.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(f);
      f.connect(gn);
      gn.connect(master);
      src.start(t0);
      src.stop(t0 + dur + 0.03);
    }
    function sound(name) {
      if (muted || destroyed || !audio || audio.state !== 'running') return;
      try {
        if (name === 'shot') { noise(0.07, 0.25, 1500); tone(760, 170, 0.09, 'square', 0.06, 0); }
        else if (name === 'hit') { tone(660, 660, 0.09, 'triangle', 0.22, 0); tone(880, 880, 0.09, 'triangle', 0.22, 0.07); tone(1320, 1320, 0.18, 'triangle', 0.2, 0.14); }
        else if (name === 'wrong') { tone(240, 105, 0.3, 'sawtooth', 0.14, 0); tone(180, 80, 0.3, 'square', 0.07, 0.03); }
        else if (name === 'miss') { tone(560, 170, 0.48, 'sine', 0.22, 0); }
        else if (name === 'tick') { tone(660, 660, 0.08, 'sine', 0.12, 0); }
        else if (name === 'go') { tone(990, 990, 0.16, 'triangle', 0.16, 0); }
      } catch (e) { /* 오디오 실패는 게임에 영향 없음 */ }
    }

    // =========================================================================
    // 이펙트 (폭죽 · 붉은 파편 · 물보라 · 떠오르는 글자 · 흔들림)
    // =========================================================================
    function burst(x, y, colors, count, speed, gravity, life) {
      if (reduced) return; // 모션 최소화: 파티클 생략
      for (let i = 0; i < count && parts.length < 420; i++) {
        const a = Math.random() * TAU;
        const s = speed * (0.35 + Math.random() * 0.75);
        const l = life * (0.7 + Math.random() * 0.5);
        parts.push({ x: x, y: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - speed * 0.18, g: gravity, life: l, max: l, c: colors[i % colors.length], sz: 1.5 + Math.random() * 1.8 });
      }
    }
    function ring(x, y, color, r0, r1, life, width) { rings.push({ x: x, y: y, c: color, r0: r0, r1: r1, life: life, max: life, w: width }); }
    function floatText(x, y, text, color, size) {
      texts.push({ x: clamp(x, 40, W - 40), y: clamp(y, 24, H - 16), text: text, c: color, size: size || 18, life: 1, max: 1 });
    }
    function fireworks(x, y) {
      ring(x, y, 'rgba(255, 224, 102, 0.95)', 6, 56, 0.45, 3);
      burst(x, y, FW_COLORS, 46, 270, 260, 1.1);
      if (!reduced) {
        pending.push({ at: clock + 130, x: W * (0.15 + Math.random() * 0.3), y: horizon * (0.35 + Math.random() * 0.4) });
        pending.push({ at: clock + 290, x: W * (0.55 + Math.random() * 0.3), y: horizon * (0.3 + Math.random() * 0.4) });
      }
    }
    function redBurst(x, y) {
      ring(x, y, 'rgba(255, 107, 107, 0.95)', 4, 42, 0.38, 3);
      burst(x, y, BAD_COLORS, 22, 200, 320, 0.7);
      flash = { c: '224, 49, 49', life: 0.25, max: 0.25 };
      if (!reduced) shakeT = 0.3;
    }
    function splash(x, y) {
      ring(x, y, 'rgba(255, 255, 255, 0.75)', 2, 16, 0.3, 2);
      burst(x, y, ['#e7f5ff', '#a5d8ff', '#ffffff'], 7, 90, 300, 0.45);
    }
    function updateEffects(dts) {
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.life -= dts;
        if (p.life <= 0) { parts[i] = parts[parts.length - 1]; parts.pop(); continue; }
        const drag = Math.pow(0.4, dts);
        p.vx *= drag;
        p.vy = p.vy * drag + p.g * dts;
        p.x += p.vx * dts;
        p.y += p.vy * dts;
      }
      for (let i = rings.length - 1; i >= 0; i--) { rings[i].life -= dts; if (rings[i].life <= 0) rings.splice(i, 1); }
      for (let i = texts.length - 1; i >= 0; i--) { texts[i].life -= dts; if (texts[i].life <= 0) texts.splice(i, 1); }
      for (let i = pending.length - 1; i >= 0; i--) {
        const f = pending[i];
        if (clock >= f.at) {
          pending.splice(i, 1);
          ring(f.x, f.y, 'rgba(255, 255, 255, 0.7)', 2, 34, 0.5, 2);
          burst(f.x, f.y, FW_COLORS, 30, 190, 150, 1.2);
        }
      }
      if (flash) { flash.life -= dts; if (flash.life <= 0) flash = null; }
      if (shakeT > 0) shakeT = Math.max(0, shakeT - dts);
    }

    // =========================================================================
    // HUD · 배너
    // =========================================================================
    function setText(node, key, value) {
      if (cache[key] === value) return;
      cache[key] = value;
      node.textContent = value;
    }
    function multiplier() { return Math.min(cfg.maxMult, 1 + cfg.comboRate * combo); }
    function updateHud() {
      if (cfg.lives <= 10) {
        setText(livesFull, 'lf', '♥'.repeat(lives));
        setText(livesEmpty, 'le', '♡'.repeat(Math.max(0, cfg.lives - lives)));
      } else {
        setText(livesFull, 'lf', '♥ ' + lives);
        setText(livesEmpty, 'le', '');
      }
      const lifeLabel = '목숨 ' + lives + '개';
      if (cache.la !== lifeLabel) { cache.la = lifeLabel; livesEl.setAttribute('aria-label', lifeLabel); livesEl.title = lifeLabel; }
      setText(scoreNum, 'sc', fmtInt(score));
      setText(multNum, 'mu', '×' + (Math.round(multiplier() * 10) / 10).toFixed(1));
      multEl.classList.toggle('is-hot', combo >= 3);
      setText(accNum, 'ac', correct + '/' + attempts);
      const lv = round ? round.card.level : 1;
      if (cache.lv !== lv) {
        cache.lv = lv;
        lvEl.className = 'lv-badge lv-' + lv + ' sh-lv';
        lvEl.textContent = LEVEL_LABELS[lv];
      }
    }
    function announce(msg) { live.textContent = msg; }
    function barRatio() {
      if (!round) return 1;
      if (round.state !== 'active') return round.frozen;
      return clamp(1 - (clock - round.start) / round.duration, 0, 1);
    }
    function updateBar() {
      const v = barRatio();
      if (Math.abs(v - barValue) < 0.002 && !(v === 0 && barValue !== 0) && !(v === 1 && barValue !== 1)) return;
      barValue = v;
      barFill.style.transform = 'scaleX(' + v.toFixed(4) + ')';
      const cls = v > 0.5 ? '' : (v > 0.25 ? ' is-low' : ' is-critical');
      if (cls !== barCls) { barCls = cls; barFill.className = 'sh-timebar-fill' + cls; }
    }
    function showReveal(head, card) {
      revealHead.textContent = head;
      revealAnswer.textContent = card.answer;
      revealExpl.textContent = card.explanation;
      revealExpl.hidden = !card.explanation;
      reveal.hidden = false;
    }
    function hideReveal() { reveal.hidden = true; }
    function setCountdown(label) {
      while (cdNumWrap.firstChild) cdNumWrap.removeChild(cdNumWrap.firstChild);
      if (!label) { countdown.hidden = true; return; }
      countdown.hidden = false;
      cdNumWrap.appendChild(el('span', 'sh-countdown-num' + (label === 'GO!' ? ' is-go' : ''), label));
    }

    // =========================================================================
    // 라운드
    // =========================================================================
    function startPlay() {
      phase = 'playing';
      playStart = perfNow();
      pausedTotal = 0;
      setCountdown('');
      startRound();
    }

    function startRound() {
      const card = deck[idx++];
      if (card.level > maxLevel) maxLevel = card.level;
      const extra = Math.min(cfg.maxPromptBonus, charCount(card.prompt) / cfg.charsPerSec);
      const T = (cfg.roundSec[card.level] + extra) * 1000; // 정답 과녁이 화면을 가로지르는 시간
      const nd = Math.max(1, Math.min(cfg.maxDistractors, card.distractors.length,
        cfg.distractors[card.level] + Math.floor(combo / cfg.comboStep)));
      const labels = [{ label: card.answer, correct: true }].concat(shuffle(card.distractors).slice(0, nd).map(function (d) {
        return { label: d, correct: false };
      }));
      const n = labels.length;
      const order = shuffle(labels);              // 등장 순서 = 과녁 번호
      const lanes = shuffle(range(n));
      const dirs = order.map(function () { return Math.random() < 0.5 ? 1 : -1; });
      if (n >= 2 && dirs.every(function (d) { return d === dirs[0]; })) dirs[Math.floor(Math.random() * n)] *= -1; // 양옆에서 모두 등장
      const gap = n > 1 ? Math.min(MAX_GAP_MS, MAX_STAGGER_MS / (n - 1)) : 0;
      const geo = roundGeometry(n);
      round = {
        card: card, n: n, start: clock, T: T, state: 'active', frozen: 1, nextAt: 0,
        spacing: geo.spacing, r: geo.r, wave: clamp(geo.spacing * 0.45, 8, 26), targets: [], duration: T
      };
      order.forEach(function (o, i) {
        const t = {
          label: o.label, correct: o.correct, num: i + 1, lane: lanes[i], dir: dirs[i],
          spawnAt: clock + LEAD_MS + i * gap + Math.random() * 80,
          style: Math.floor(Math.random() * 3), phase: Math.random() * TAU,
          bobF: 0.55 + Math.random() * 0.35, waveF: 0.3 + Math.random() * 0.22,
          state: 'wait', p: 0, x: -9999, y: -9999, anim: 0, fs: 14, text: o.label, r: geo.r, hw: geo.r
        };
        fitTarget(t);
        round.targets.push(t);
      });
      const ct = round.targets.filter(function (t) { return t.correct; })[0];
      round.duration = (ct.spawnAt - clock) + T; // 라운드 = 정답 과녁이 빠져나갈 때까지

      hideReveal();
      setText(catEl, 'cat', card.category);
      setText(progEl, 'prog', '카드 ' + idx + ' / ' + deck.length);
      promptEl.textContent = card.prompt;
      promptEl.classList.toggle('is-long', charCount(card.prompt) > 70);
      updateHud();
      updateBar();
    }

    function positionTarget(t) {
      const sx = -t.hw;
      const ex = W + t.hw;
      t.x = t.dir > 0 ? sx + (ex - sx) * t.p : ex - (ex - sx) * t.p;
      const base = laneTop + round.spacing * (t.lane + 0.5);
      const ts = clock / 1000;
      let y = base + Math.sin(ts * TAU * t.bobF + t.phase) * (reduced ? 1.2 : 3.5); // 위아래 출렁
      if (round.card.level === 3) y += Math.sin(ts * TAU * t.waveF + t.phase * 1.7) * round.wave; // 상: 사인파
      t.y = clamp(y, horizon + t.r * 0.8, H - t.r - 4);
    }

    function updateRound() {
      const rd = round;
      for (let i = 0; i < rd.targets.length; i++) {
        const t = rd.targets[i];
        if (t.state === 'wait') {
          if (rd.state !== 'active') { t.state = 'dead'; continue; }
          if (clock < t.spawnAt) continue;
          t.state = 'live';
        }
        if (t.state === 'live' || t.state === 'fade') {
          t.p = (clock - t.spawnAt) / rd.T;
          if (t.state === 'live' && t.p >= 1) {
            t.p = 1;
            t.state = 'gone';
            if (t.correct && rd.state === 'active') missRound(t);
            continue;
          }
          positionTarget(t);
        }
        if ((t.state === 'pop' || t.state === 'burst' || t.state === 'fade') && clock - t.anim >= ANIM_MS[t.state]) t.state = 'dead';
      }
      if (phase === 'playing' && rd.state !== 'active' && rd.nextAt && clock >= rd.nextAt) startRound();
    }

    function fadeOthers(except) {
      round.targets.forEach(function (t) {
        if (t === except) return;
        if (t.state === 'live') { t.state = 'fade'; t.anim = clock; }
        else if (t.state === 'wait') t.state = 'dead';
      });
    }

    function reviewEntry(card, userAnswer) {
      return { prompt: card.prompt, answer: card.answer, userAnswer: userAnswer, explanation: card.explanation, category: card.category, level: card.level };
    }

    // 라운드가 끝났을 때(정답 명중 또는 놓침): 다음 카드 · 종료 결정
    function afterResolve(delay, isWin) {
      if (lives <= 0) { beginEnding('lives', delay); return; }
      if (idx >= deck.length) { beginEnding('cleared', isWin ? CLEAR_DELAY_MS : delay); return; }
      round.nextAt = clock + delay;
    }
    function beginEnding(reason, delay) {
      if (phase !== 'playing') return;
      finalTimeMs = playTime();
      endReason = reason;
      phase = 'ending';
      endAt = clock + delay;
      pauseBtn.disabled = true;
      if (reason === 'cleared') {
        fireworks(W * 0.5, H * 0.45);
        announce('모든 카드를 해결했어요! 최종 점수 ' + score + '점');
      }
    }

    function hitTarget(t) {
      const rd = round;
      if (phase !== 'playing' || paused || !rd || rd.state !== 'active' || t.state !== 'live') return;
      attempts++;
      if (t.correct) {
        const ratio = barRatio();
        const pts = Math.round((cfg.baseScore + ratio * cfg.timeBonus) * multiplier());
        score += pts;
        correct++;
        combo++;
        if (combo > maxCombo) maxCombo = combo;
        rd.state = 'won';
        rd.frozen = ratio;
        t.state = 'pop';
        t.anim = clock;
        fadeOthers(t);
        fireworks(t.x, t.y);
        floatText(t.x, t.y - t.r - 14, '+' + pts, '#ffe066', 22);
        if (combo >= 3) floatText(t.x, t.y - t.r - 38, combo + '콤보! ×' + (Math.round(multiplier() * 10) / 10).toFixed(1), '#ffd8a8', 15);
        sound('hit');
        bump(scoreEl);
        if (combo >= 3) bump(multEl);
        announce('정답! ' + rd.card.answer + ' +' + pts + '점');
        afterResolve(WIN_DELAY_MS, true);
      } else {
        lives = Math.max(0, lives - 1);
        combo = 0;
        review.push(reviewEntry(rd.card, t.label));
        t.state = 'burst';
        t.anim = clock;
        redBurst(t.x, t.y);
        floatText(t.x, t.y - t.r - 14, '-♥', '#ff8787', 22);
        sound('wrong');
        bump(livesEl);
        if (lives <= 0) {
          rd.state = 'lost';
          rd.frozen = barRatio();
          fadeOthers(t);
          showReveal('💥 오답! 목숨을 모두 잃었어요', rd.card);
          announce('오답. 목숨을 모두 잃었어요. 정답은 ' + rd.card.answer);
          beginEnding('lives', cfg.revealMs);
        } else {
          announce('오답 ' + t.label + '. 목숨 ' + lives + '개 남음');
        }
      }
      updateHud();
      updateBar();
    }

    function missRound(t) {
      const rd = round;
      attempts++;
      lives = Math.max(0, lives - 1);
      combo = 0;
      review.push(reviewEntry(rd.card, MISS_TEXT));
      rd.state = 'reveal';
      rd.frozen = 0;
      fadeOthers(null);
      showReveal(lives <= 0 ? '😢 놓쳤어요 — 목숨을 모두 잃었어요' : '😢 놓쳤어요!', rd.card);
      floatText(t.dir > 0 ? W - 48 : 48, laneTop + rd.spacing * (t.lane + 0.5), '놓침!', '#ffc9c9', 18);
      flash = { c: '11, 37, 69', life: 0.3, max: 0.3 };
      sound('miss');
      bump(livesEl);
      announce('놓쳤어요. 정답은 ' + rd.card.answer);
      afterResolve(cfg.revealMs, false);
      updateHud();
      updateBar();
    }

    // 좌표 사격: 판정 범위 = 과녁 반경 + hitSlop(12px). 겹치면 가장 가까운(앞쪽) 과녁
    function shootAt(x, y) {
      if (phase !== 'playing' || paused || !round || round.state !== 'active') return;
      sound('shot');
      let best = null;
      let bestD = Infinity;
      round.targets.forEach(function (t) {
        if (t.state !== 'live' || t.p <= 0 || t.p >= 1) return;
        const dx = Math.max(0, Math.abs(x - t.x) - (t.hw - t.r));
        const dy = y - t.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d <= t.r + cfg.hitSlop && (d < bestD || (d === bestD && best && t.y > best.y))) { best = t; bestD = d; }
      });
      if (best) hitTarget(best);
      else splash(x, y); // 허공 사격: 벌점 없음
    }
    // 숫자키 사격: 화면에 보이는 과녁 번호
    function shootNumber(n) {
      if (phase !== 'playing' || paused || !round || round.state !== 'active') return;
      const t = round.targets.filter(function (x) { return x.num === n && x.state === 'live' && x.p > 0 && x.p < 1; })[0];
      if (!t) return;
      sound('shot');
      hitTarget(t);
    }

    // =========================================================================
    // 시간 · 루프
    // =========================================================================
    function playTime() {
      if (playStart === null) return 0;
      const end = paused ? pauseStart : perfNow();
      return Math.max(0, end - playStart - pausedTotal);
    }
    function running() { return !destroyed && !paused && (phase === 'countdown' || phase === 'playing' || phase === 'ending'); }
    function requestFrame() {
      if (rafId || !running()) return;
      rafId = hasRaf ? window.requestAnimationFrame(frame) : window.setTimeout(frame, 16);
    }
    function cancelFrame() {
      if (!rafId) return;
      if (hasRaf) window.cancelAnimationFrame(rafId); else window.clearTimeout(rafId);
      rafId = 0;
    }
    function frame() {
      rafId = 0;
      if (!running()) return;
      const t = perfNow();
      const dt = lastNow ? clamp(t - lastNow, 0, 100) : 0;
      lastNow = t;
      clock += dt;
      update(dt / 1000);
      if (destroyed) return; // onEnd 안에서 destroy 됐을 수 있음
      render();
      requestFrame();
    }
    function update(dts) {
      updateEffects(dts);
      if (phase === 'countdown') {
        const remain = COUNTDOWN_MS - clock;
        let label;
        if (remain > 0) label = String(Math.ceil(remain / 1000));
        else if (remain > -GO_MS) label = 'GO!';
        else { cdLabel = ''; startPlay(); return; }
        if (label !== cdLabel) {
          cdLabel = label;
          setCountdown(label);
          sound(label === 'GO!' ? 'go' : 'tick');
        }
        return;
      }
      if (round && (phase === 'playing' || phase === 'ending')) updateRound();
      if (phase === 'playing') updateBar();
      if (phase === 'ending' && clock >= endAt) finish();
    }
    function finish() {
      if (phase !== 'ending') return;
      phase = 'over';
      cancelFrame();
      render(); // 마지막 장면을 남겨 둔다
      const result = {
        score: score,
        correct: correct,
        attempts: attempts,
        timeMs: Math.round(finalTimeMs),
        maxCombo: maxCombo,
        maxLevel: maxLevel || 1,
        reason: endReason === 'cleared' ? 'cleared' : 'lives',
        review: review.slice()
      };
      if (typeof opts.onEnd === 'function') {
        try { opts.onEnd(result); } catch (e) { if (window.console) console.error('[슈팅해운] onEnd 오류', e); }
      }
    }

    // =========================================================================
    // 일시정지 · 그만두기
    // =========================================================================
    function pause(focusResume) {
      if (destroyed || paused || (phase !== 'countdown' && phase !== 'playing')) return;
      paused = true;
      pauseStart = perfNow();
      cancelFrame();
      pauseStats.textContent = phase === 'countdown'
        ? '곧 시작해요 · 카드 ' + deck.length + '장 · 목숨 ' + lives + '개'
        : '카드 ' + idx + ' / ' + deck.length + ' · 점수 ' + fmtInt(score) + ' · 목숨 ' + lives + '개';
      overlay.hidden = false;
      root.classList.add('is-paused');
      if (focusResume) focusQuiet(resumeBtn);
      announce('일시정지');
    }
    function resume() {
      if (destroyed || !paused || (phase !== 'countdown' && phase !== 'playing')) return;
      paused = false;
      if (playStart !== null) pausedTotal += Math.max(0, perfNow() - pauseStart);
      overlay.hidden = true;
      root.classList.remove('is-paused');
      focusQuiet(root);
      lastNow = 0;
      requestFrame();
    }
    function quit() {
      if (destroyed || phase === 'over' || phase === 'quit') return;
      phase = 'quit';
      paused = false;
      cancelFrame();
      if (typeof opts.onQuit === 'function') {
        try { opts.onQuit(); } catch (e) { if (window.console) console.error('[슈팅해운] onQuit 오류', e); }
      }
    }

    // =========================================================================
    // 그리기
    // =========================================================================
    function buildBackground() {
      bg = null;
      if (!g) return;
      try {
        const cv = document.createElement('canvas');
        cv.width = canvas.width;
        cv.height = canvas.height;
        const b = cv.getContext('2d');
        if (!b) return;
        b.setTransform(dpr, 0, 0, dpr, 0, 0);
        paintStatic(b);
        bg = cv;
      } catch (e) { bg = null; }
    }
    function paintStatic(c) {
      // 하늘
      let gr = c.createLinearGradient(0, 0, 0, horizon);
      gr.addColorStop(0, '#0b2545');
      gr.addColorStop(0.55, '#1d5482');
      gr.addColorStop(1, '#8fd0dc');
      c.fillStyle = gr;
      c.fillRect(0, 0, W, horizon + 1);
      // 해 + 노을빛
      const sx = W * 0.8;
      gr = c.createRadialGradient(sx, horizon, 0, sx, horizon, Math.max(W, H) * 0.38);
      gr.addColorStop(0, 'rgba(255, 228, 168, 0.85)');
      gr.addColorStop(0.2, 'rgba(255, 196, 120, 0.35)');
      gr.addColorStop(1, 'rgba(255, 196, 120, 0)');
      c.fillStyle = gr;
      c.fillRect(0, 0, W, horizon);
      c.fillStyle = 'rgba(255, 241, 205, 0.95)';
      c.beginPath();
      c.arc(sx, horizon, Math.max(9, W * 0.024), Math.PI, 0);
      c.fill();
      // 별 몇 개
      c.fillStyle = 'rgba(255, 255, 255, 0.55)';
      [[0.08, 0.18], [0.22, 0.08], [0.41, 0.22], [0.57, 0.1], [0.69, 0.3], [0.93, 0.14]].forEach(function (s) {
        c.fillRect(Math.round(W * s[0]), Math.round(horizon * s[1]), 1.5, 1.5);
      });
      paintSkyline(c);
      // 바다
      gr = c.createLinearGradient(0, horizon, 0, H);
      gr.addColorStop(0, '#2f86b5');
      gr.addColorStop(0.35, '#1b6ca8');
      gr.addColorStop(1, '#0b2a4d');
      c.fillStyle = gr;
      c.fillRect(0, horizon, W, H - horizon);
      // 수평선 안개
      gr = c.createLinearGradient(0, horizon, 0, horizon + 14);
      gr.addColorStop(0, 'rgba(200, 236, 243, 0.45)');
      gr.addColorStop(1, 'rgba(200, 236, 243, 0)');
      c.fillStyle = gr;
      c.fillRect(0, horizon, W, 14);
    }
    // 수평선 위 실루엣: 원유 탱크 팜 · 묘박 중인 탱커 · 부두와 하역 크레인
    function paintSkyline(c) {
      const base = horizon;
      const ink = 'rgba(11, 37, 69, 0.8)';
      c.fillStyle = ink;
      c.strokeStyle = ink;
      const tw = Math.max(14, W * 0.042);
      const th = Math.max(8, H * 0.04);
      for (let i = 0; i < 4; i++) {
        const x = W * 0.025 + i * tw * 1.22;
        const hh = th * (i % 2 ? 0.78 : 1);
        c.fillRect(x, base - hh, tw, hh + 1);
        c.beginPath();
        c.ellipse(x + tw / 2, base - hh, tw / 2, tw * 0.16, 0, Math.PI, TAU);
        c.fill();
      }
      const tx = W * 0.3;
      const len = Math.max(56, W * 0.17);
      const hh2 = Math.max(4, H * 0.016);
      c.beginPath();
      c.moveTo(tx, base - hh2);
      c.lineTo(tx + len, base - hh2);
      c.lineTo(tx + len - hh2 * 1.1, base + 1);
      c.lineTo(tx + hh2 * 0.7, base + 1);
      c.closePath();
      c.fill();
      c.fillRect(tx + len * 0.78, base - hh2 * 3.1, len * 0.12, hh2 * 2.2);
      c.fillRect(tx + len * 0.83, base - hh2 * 4.1, len * 0.035, hh2 * 1.1);
      c.fillRect(tx + len * 0.12, base - hh2 * 1.6, len * 0.6, Math.max(1, hh2 * 0.35));
      c.fillRect(W * 0.56, base - Math.max(3, H * 0.012), W * 0.44, Math.max(3, H * 0.012) + 1);
      c.lineWidth = Math.max(1.5, W * 0.0032);
      c.lineCap = 'round';
      [0.63, 0.75, 0.87].forEach(function (f) {
        const x = W * f;
        const hh = H * 0.125;
        const leg = Math.max(7, W * 0.02);
        c.beginPath();
        c.moveTo(x - leg, base); c.lineTo(x - leg * 0.6, base - hh);
        c.moveTo(x + leg, base); c.lineTo(x + leg * 0.6, base - hh);
        c.moveTo(x - leg * 0.85, base - hh * 0.42); c.lineTo(x + leg * 0.85, base - hh * 0.42);
        c.moveTo(x - leg * 2.6, base - hh * 0.86); c.lineTo(x + leg * 1.3, base - hh * 0.86);
        c.moveTo(x, base - hh * 1.05); c.lineTo(x - leg * 2.6, base - hh * 0.86);
        c.moveTo(x, base - hh * 1.05); c.lineTo(x + leg * 1.3, base - hh * 0.86);
        c.stroke();
        c.fillRect(x - leg * 0.7, base - hh - leg * 0.45, leg * 1.4, leg * 0.45);
      });
    }
    function paintWaves(c, ts) {
      const t = reduced ? 0 : ts;
      for (let i = 0; i < 6; i++) {
        const k = i / 5;
        const y0 = horizon + 8 + (H - horizon - 14) * (0.04 + k * k * 0.92);
        const amp = 1 + k * 3.5;
        const len = 40 + k * 90;
        const spd = (i % 2 ? -1 : 1) * (10 + k * 24);
        c.strokeStyle = 'rgba(255, 255, 255, ' + (0.07 + k * 0.08).toFixed(3) + ')';
        c.lineWidth = 1 + k * 1.2;
        c.beginPath();
        for (let x = 0; x <= W + 12; x += 12) {
          const y = y0 + Math.sin(((x + t * spd) / len) * TAU) * amp;
          if (x === 0) c.moveTo(x, y); else c.lineTo(x, y);
        }
        c.stroke();
      }
      // 햇빛 윤슬
      const sx = W * 0.8;
      c.fillStyle = 'rgba(255, 226, 160, 0.35)';
      for (let j = 0; j < 7; j++) {
        const yy = horizon + 6 + j * (H - horizon) * 0.06;
        const ww = (10 + j * 6) * (0.6 + 0.4 * Math.sin(t * 2.4 + j * 1.3));
        c.fillRect(sx - ww / 2 + Math.sin(t * 1.2 + j) * 4, yy, ww, 1.5);
      }
      // 갈매기 두 마리
      c.strokeStyle = 'rgba(240, 248, 255, 0.8)';
      c.lineWidth = 1.5;
      [[0.16, 0.42, 18], [0.47, 0.3, 13]].forEach(function (b, i) {
        const span = W + 80;
        const x = ((b[0] * span + t * b[2] * (i ? -1 : 1)) % span + span) % span - 40;
        const y = horizon * b[1] + Math.sin(t * 1.6 + i) * 3;
        const wing = 5 + Math.sin(t * 6 + i) * 1.5;
        c.beginPath();
        c.moveTo(x - 7, y);
        c.quadraticCurveTo(x - 3.5, y - wing, x, y);
        c.quadraticCurveTo(x + 3.5, y - wing, x + 7, y);
        c.stroke();
      });
    }

    // 과녁 몸체: 0 구명부환(주황·흰 띠) · 1 등부표(노랑 + 등불) · 2 드럼통 뚜껑(파랑)
    function paintBody(c, t, x, y, hw, r) {
      if (t.state === 'burst') {
        pill(c, x, y, hw, r);
        c.fillStyle = '#e03131';
        c.fill();
      } else if (t.style === 0) {
        pill(c, x, y, hw, r);
        c.fillStyle = '#f2622e';
        c.fill();
        c.save();
        pill(c, x, y, hw, r);
        c.clip();
        c.fillStyle = '#fff7ec';
        const L = x - Math.max(0, hw - r);
        const R = x + Math.max(0, hw - r);
        [[R, 0.785], [L, 2.356], [L, 3.927], [R, 5.498]].forEach(function (w) {
          c.beginPath();
          c.moveTo(w[0], y);
          c.arc(w[0], y, r * 1.3, w[1] - 0.3, w[1] + 0.3);
          c.closePath();
          c.fill();
        });
        c.restore();
      } else if (t.style === 1) {
        const mh = r * 0.6;
        c.strokeStyle = '#2b2f36';
        c.lineWidth = Math.max(2, r * 0.12);
        c.beginPath();
        c.moveTo(x, y - r + 2);
        c.lineTo(x, y - r - mh);
        c.stroke();
        const blink = Math.floor(clock / 450 + t.phase) % 2 === 0;
        c.fillStyle = blink ? '#fff3bf' : '#fab005';
        c.beginPath();
        c.arc(x, y - r - mh, Math.max(3, r * 0.17), 0, TAU);
        c.fill();
        const gr = c.createLinearGradient(0, y - r, 0, y + r);
        gr.addColorStop(0, '#ffe066');
        gr.addColorStop(1, '#f08c00');
        pill(c, x, y, hw, r);
        c.fillStyle = gr;
        c.fill();
        c.save();
        pill(c, x, y, hw, r);
        c.clip();
        c.fillStyle = 'rgba(33, 37, 41, 0.85)';
        c.fillRect(x - hw, y + r * 0.66, hw * 2, r * 0.5);
        c.restore();
      } else {
        const gr = c.createLinearGradient(0, y - r, 0, y + r);
        gr.addColorStop(0, '#4dabf7');
        gr.addColorStop(1, '#1c4f8a');
        pill(c, x, y, hw, r);
        c.fillStyle = gr;
        c.fill();
        pill(c, x, y, Math.max(r * 0.88, hw - r * 0.12), r * 0.88);
        c.strokeStyle = 'rgba(208, 235, 255, 0.85)';
        c.lineWidth = Math.max(1.5, r * 0.08);
        c.stroke();
      }
      pill(c, x, y, hw, r);
      c.lineWidth = 1.5;
      c.strokeStyle = 'rgba(7, 26, 51, 0.45)';
      c.stroke();
    }
    function paintTarget(c, t) {
      let alpha = 1, scale = 1, sink = 0;
      const age = clock - t.anim;
      if (t.state === 'pop') { const k = clamp(age / ANIM_MS.pop, 0, 1); scale = 1 + 0.35 * k; alpha = 1 - k; }
      else if (t.state === 'burst') { const k = clamp(age / ANIM_MS.burst, 0, 1); scale = 1 - 0.4 * k; alpha = 1 - k; }
      else if (t.state === 'fade') { const k = clamp(age / ANIM_MS.fade, 0, 1); alpha = 1 - k; sink = 10 * k; }
      if (alpha <= 0.02) return;
      const x = t.x;
      const y = t.y + sink;
      const r = t.r * scale;
      const hw = t.hw * scale;
      c.globalAlpha = alpha;
      c.fillStyle = 'rgba(4, 18, 36, 0.28)'; // 물그림자
      c.beginPath();
      c.ellipse(x, y + r * 0.95, hw * 0.92, r * 0.24, 0, 0, TAU);
      c.fill();
      paintBody(c, t, x, y, hw, r);
      // 라벨 판
      const pr = r * 0.64;
      pill(c, x, y, Math.max(pr, hw - r * 0.36), pr);
      c.fillStyle = t.state === 'burst' ? '#ffe3e3' : '#fffdf6';
      c.fill();
      c.lineWidth = 1;
      c.strokeStyle = 'rgba(11, 37, 69, 0.18)';
      c.stroke();
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillStyle = t.state === 'burst' ? '#c92a2a' : '#0b2545';
      c.font = fontOf(t.fs * scale, 800);
      c.fillText(t.text, x, y + 0.5);
      if (t.state === 'live') { // 숫자키 번호
        const br = Math.max(8, r * 0.38);
        const bx = x - hw + r * 0.25;
        const by = y - r * 0.82;
        c.beginPath();
        c.arc(bx, by, br, 0, TAU);
        c.fillStyle = '#0b2545';
        c.fill();
        c.lineWidth = 2;
        c.strokeStyle = '#ffffff';
        c.stroke();
        c.fillStyle = '#ffffff';
        c.font = fontOf(br * 1.15, 900);
        c.fillText(String(t.num), bx, by + 0.5);
      }
      c.globalAlpha = 1;
    }
    function paintEffects(c) {
      rings.forEach(function (o) {
        const k = 1 - o.life / o.max;
        c.globalAlpha = clamp(1 - k, 0, 1);
        c.strokeStyle = o.c;
        c.lineWidth = o.w;
        c.beginPath();
        c.arc(o.x, o.y, o.r0 + (o.r1 - o.r0) * k, 0, TAU);
        c.stroke();
      });
      parts.forEach(function (p) {
        c.globalAlpha = clamp(p.life / p.max, 0, 1);
        c.fillStyle = p.c;
        c.fillRect(p.x - p.sz / 2, p.y - p.sz / 2, p.sz, p.sz);
      });
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      texts.forEach(function (o) {
        const k = 1 - o.life / o.max;
        c.globalAlpha = clamp(o.life / o.max * 1.6, 0, 1);
        c.font = fontOf(o.size, 900);
        c.lineWidth = 3;
        c.strokeStyle = 'rgba(7, 26, 51, 0.6)';
        const yy = o.y - (reduced ? 0 : 26 * k);
        c.strokeText(o.text, o.x, yy);
        c.fillStyle = o.c;
        c.fillText(o.text, o.x, yy);
      });
      c.globalAlpha = 1;
    }
    function paintEnd(c) {
      const cleared = endReason === 'cleared';
      c.fillStyle = 'rgba(7, 26, 51, 0.55)';
      c.fillRect(0, H * 0.36, W, H * 0.26);
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillStyle = '#ffffff';
      c.font = fontOf(clamp(W * 0.06, 20, 32), 900);
      c.fillText(cleared ? '🎉 모든 카드 완료!' : '⚓ 게임 종료', W / 2, H * 0.455);
      c.fillStyle = '#c9e7f0';
      c.font = fontOf(clamp(W * 0.035, 13, 17), 700);
      c.fillText('점수 ' + fmtInt(score) + ' · 맞힘 ' + correct + '/' + attempts, W / 2, H * 0.545);
    }
    function render() {
      if (destroyed || !g) return;
      try {
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.globalAlpha = 1;
        if (bg) g.drawImage(bg, 0, 0, W, H);
        else paintStatic(g);
        paintWaves(g, clock / 1000);
        let ox = 0, oy = 0;
        if (shakeT > 0 && !reduced) {
          const m = 7 * (shakeT / 0.3);
          ox = (Math.random() * 2 - 1) * m;
          oy = (Math.random() * 2 - 1) * m;
        }
        g.setTransform(dpr, 0, 0, dpr, ox * dpr, oy * dpr);
        if (round && phase !== 'countdown') {
          round.targets.filter(function (t) { return t.state === 'live' || t.state === 'pop' || t.state === 'burst' || t.state === 'fade'; })
            .sort(function (a, b) { return a.y - b.y; })
            .forEach(function (t) { paintTarget(g, t); });
        }
        paintEffects(g);
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        if (flash) {
          g.fillStyle = 'rgba(' + flash.c + ', ' + (0.3 * flash.life / flash.max).toFixed(3) + ')';
          g.fillRect(0, 0, W, H);
        }
        if (phase === 'ending' || phase === 'over') paintEnd(g);
      } catch (e) { /* 그리기 실패는 게임 진행에 영향 없음 */ }
    }

    // =========================================================================
    // 입력
    // =========================================================================
    function toCanvas(clientX, clientY) {
      const r = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : null;
      const rw = r && r.width > 0 ? r.width : W;
      const rh = r && r.height > 0 ? r.height : H;
      return {
        x: (clientX - (r ? r.left : 0)) * (W / rw),
        y: (clientY - (r ? r.top : 0)) * (H / rh)
      };
    }
    function onPointerDown(e) {
      if (destroyed) return;
      if (typeof e.button === 'number' && e.button !== 0 && e.button !== 2) return; // 좌·우클릭(터치는 0)
      unlockAudio();
      if (e.cancelable) e.preventDefault();
      focusQuiet(root);
      const pt = toCanvas(e.clientX, e.clientY);
      shootAt(pt.x, pt.y);
    }
    function onTouchStart(e) {
      if (destroyed) return;
      unlockAudio();
      if (e.cancelable) e.preventDefault(); // 뒤따르는 mousedown 중복 방지
      const list = e.changedTouches || [];
      for (let i = 0; i < list.length; i++) {
        const pt = toCanvas(list[i].clientX, list[i].clientY);
        shootAt(pt.x, pt.y);
      }
    }
    function keyDigit(e) {
      if (/^[1-9]$/.test(e.key || '')) return Number(e.key);
      const m = /^(?:Digit|Numpad)([1-9])$/.exec(e.code || '');
      return m ? Number(m[1]) : 0;
    }
    function isTyping(t) {
      if (!t || !t.tagName) return false;
      const tag = t.tagName;
      if (tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable) return true;
      if (tag !== 'INPUT') return false;
      const type = (t.getAttribute('type') || 'text').toLowerCase();
      return ['button', 'checkbox', 'radio', 'submit', 'reset', 'range', 'color', 'file', 'image'].indexOf(type) === -1;
    }
    // 게임 밖(헤더 링크·확인 모달 등)에 포커스가 있을 때의 키 입력은 무시
    function ownsKeyTarget(t) {
      if (!t || t === document || t === window || t === document.body || t === document.documentElement) return true;
      if (t.nodeType !== 1) return true;
      return root.contains(t) || (typeof t.contains === 'function' && t.contains(root));
    }
    function onKeyDown(e) {
      if (destroyed || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTyping(e.target) || !ownsKeyTarget(e.target)) return;
      const k = e.key;
      if (k === 'Escape' || k === 'Esc' || k === 'p' || k === 'P' || k === 'ㅔ' || e.code === 'KeyP') {
        if (phase !== 'countdown' && phase !== 'playing') return;
        e.preventDefault();
        unlockAudio();
        if (paused) resume(); else pause(true);
        return;
      }
      if (paused && k === 'Tab') { // 오버레이 안에서 포커스 순환
        e.preventDefault();
        focusQuiet(document.activeElement === resumeBtn ? quitBtn : resumeBtn);
        return;
      }
      const d = keyDigit(e);
      if (d >= 1 && d <= 6 && phase === 'playing' && !paused) {
        e.preventDefault();
        unlockAudio();
        shootNumber(d);
      }
    }
    function autoPause() { pause(false); }
    function onVisibility() { if (document.hidden) autoPause(); }
    function onFocusIn(e) {
      if (phase !== 'playing') return; // 카운트다운 중 앱이 다른 요소에 포커스를 줘도 멈추지 않는다
      const t = e.target;
      if (!t || t.nodeType !== 1 || t === document.body || root.contains(t) || (typeof t.contains === 'function' && t.contains(root))) return;
      autoPause(); // 플레이 중 게임 밖으로 포커스가 나가면(헤더 링크·확인 모달 등) 일시정지
    }

    if (typeof window.PointerEvent === 'function') {
      on(canvas, 'pointerdown', onPointerDown);
    } else {
      on(canvas, 'mousedown', onPointerDown);
      on(canvas, 'touchstart', onTouchStart, { passive: false });
    }
    on(canvas, 'contextmenu', function (e) { e.preventDefault(); });
    on(document, 'keydown', onKeyDown);
    on(document, 'visibilitychange', onVisibility);
    on(document, 'focusin', onFocusIn);
    on(window, 'blur', autoPause);
    on(window, 'resize', onResize);
    if (typeof window.ResizeObserver === 'function') {
      try { ro = new window.ResizeObserver(onResize); ro.observe(stage); } catch (e) { ro = null; }
    }
    function onResize() {
      if (destroyed) return;
      if (layout() && !running()) render(); // 멈춘 상태에서도 화면을 다시 그린다
    }

    // =========================================================================
    // 정리
    // =========================================================================
    function destroy() {
      if (destroyed) return;
      destroyed = true;
      cancelFrame();
      offAll();
      if (ro) { try { ro.disconnect(); } catch (e) { /* noop */ } ro = null; }
      if (audio) {
        try { const p = audio.close(); if (p && typeof p.catch === 'function') p.catch(function () {}); } catch (e) { /* noop */ }
        audio = null; master = null; noiseBuf = null;
      }
      parts.length = 0; rings.length = 0; texts.length = 0; pending.length = 0;
      round = null;
      bg = null;
      while (container.firstChild) container.removeChild(container.firstChild);
    }

    // ---- 시작: 3·2·1 카운트다운 ----
    layout();
    updateHud();
    updateBar();
    setCountdown('3');
    cdLabel = '3';
    render();
    focusQuiet(root);
    requestFrame();

    return {
      destroy: destroy,
      pause: function () { pause(false); },
      resume: function () { resume(); }
    };
  }

  // 게임 모듈이 스스로 스타일시트를 보장한다 (index.html 에 링크가 없을 때만 추가)
  function ensureStyles() {
    try {
      if (!document.head || document.querySelector('link[href*="shooter.css"]')) return;
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'css/shooter.css';
      document.head.appendChild(link);
    } catch (e) { /* noop */ }
  }

  PG.shooter = { key: 'shooter', title: '슈팅해운', mount: mount };
})();
