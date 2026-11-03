/*!
 * Port Quiz — 🔭 스나이퍼해운 (줌 저격 O/X 게임 모듈)
 * 순수 바닐라 JS (ES2019, IIFE). 외부 라이브러리·이미지·폰트 없음. 전역은 window.PortGames 만 사용한다.
 *
 * 탱커 터미널 경비 초소에서 스코프로 항만을 감시한다. 지나가는 배마다 전광판·깃발에 O/X 진술이 하나씩 적혀 있다.
 *   틀린 진술 = 위장한 적선 → 저격해 격침(정답)        맞는 진술 = 아군 → 쏘지 말고 통과(정답)
 *   아군을 쏘면 오인 사격, 적선을 놓치면 적선 통과 — 둘 다 ♥ -1 · 콤보 0 · 오답 노트(review)에 기록
 *
 * 계약
 *   window.PortGames.sniper = { key: 'sniper', title: '스나이퍼해운', mount(container, ctx) → { destroy, pause, resume } }
 *   ctx    = { bank, cards(쓰지 않음), config, muted, onEnd(result), onQuit() }
 *   result = { score, correct, attempts, timeMs, maxCombo, maxLevel, reason: 'lives' | 'cleared',
 *              review: [{ prompt, answer, userAnswer, explanation, category, level }] }   ← 오인 사격·적선 통과만
 *
 * 설정 (APP_CONFIG.games.sniper — 모두 선택. 없거나 이상한 값이면 아래 기본값)
 *   lives 3 · zoom 2.7 (폭 560px 미만 화면은 -0.2) · reloadMs 700 · freezeMs 1600 · baseScore 100 · passScore 50 · comboRate 0.1 · maxMultiplier 3
 *   maxShips {1: 2, 2: 2, 3: 3} (동시에 떠 있는 배) · timeFactor {1: 1.0, 2: 0.9, 3: 0.8} (화면을 건너는 시간 계수)
 */
(function () {
  'use strict';

  const PG = window.PortGames = window.PortGames || {};

  // ===========================================================================
  // 상수
  // ===========================================================================
  const TAU = Math.PI * 2;
  const LEVELS = [1, 2, 3];
  const LEVEL_LABELS = { 1: '하 · 빈출', 2: '중 · 실무', 3: '상 · 심화' };
  const COUNTDOWN_MS = 3000;     // 3·2·1
  const GO_MS = 500;             // 'GO!'
  const FIRST_SPAWN_MS = 300;    // GO 뒤 첫 배
  const SPAWN_GAP_MS = 1500;     // 배와 배 사이 최소 등장 간격
  const EMPTY_GAP_MS = 700;      // 바다가 비었을 때 다음 배까지
  const STAGGER = { 1: 0.5, 2: 0.3, 3: 0.25 }; // 직전 배가 이만큼 건너간 뒤에 다음 배 (시차)
  const SINK_MS = 1600;          // 격침 연출
  const RETREAT_MS = 900;        // 오인 사격 뒤 아군이 물러나는 연출
  const CLEAR_DELAY_MS = 1400;   // 마지막 배 처리 → 종료
  const MIN_END_DELAY_MS = 1200; // 목숨 소진 → 종료 (최소)
  const BANNER_GOOD_MS = 3500;
  const BANNER_BAD_MS = 5500;
  const TOAST_MS = 1600;
  const RECOIL_MS = 170;
  const MUZZLE_MS = 90;
  const MAX_DT = 100;            // 프레임 dt 상한
  const KEY_AIM_SPEED = 0.3;     // 방향키 조준 속도 (px/ms)
  const TOUCH_ZOOM_GAIN = 1.5;   // 줌 중 드래그 감도 (÷ 배율)
  const HIT_PAD = 3;             // 판정 여유 (px)
  const BASE_FS = 8;             // 진술 글자 크기(px) — 먼 항로 7 · 가운데 8 · 가까운 항로 9
  const LANE_SCALE = [0.875, 1, 1.125];
  const NARROW = 560;            // 이보다 좁은 화면(모바일): 줌 2.5배 · 진술 글자 7 / 7.5 / 8px
  const NARROW_FS = [0.875, 0.9375, 1];
  const LANE_POS = [0.25, 0.56, 0.87];       // 바다(수평선 ~ 초소 난간) 안에서 항로 높이
  const FONT = '"Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif';
  const ANSWER_ENEMY = '적선(틀린 진술)';
  const ANSWER_FRIEND = '아군(맞는 진술)';
  const USER_SHOT = '저격';
  const USER_PASS = '통과시킴';
  // 배 종류 — 진술의 참·거짓과 무관하게 무작위 (생김새로 적·아군을 알 수 없게)
  // L 길이 · top 판정 높이 · foot 돛대 밑동 · mast 전광판 아래끝 (모두 수면 기준, 항로 배율 1일 때 px)
  const SHIPS = {
    tug: { L: 40, top: 17, foot: 17, mast: 26 },    // 예선
    launch: { L: 32, top: 11, foot: 11, mast: 19 }, // 통선(소형 보트)
    drone: { L: 36, top: 10, foot: 6.5, mast: 20 }, // 드론 보트(무인)
    pilot: { L: 36, top: 14, foot: 14, mast: 22 },  // 도선선
    oilrec: { L: 42, top: 15, foot: 6, mast: 25 }   // 방제선
  };
  const SHIP_KEYS = Object.keys(SHIPS);
  const STARS = [[0.06, 0.16], [0.18, 0.07], [0.29, 0.26], [0.4, 0.12], [0.53, 0.05], [0.64, 0.21], [0.75, 0.09], [0.88, 0.18], [0.95, 0.06]];
  const CLOUDS = [[0.14, 0.44, 120, 5], [0.6, 0.3, 160, 6], [0.86, 0.56, 110, 4]];
  const BANNER = {
    sink: { head: '💥 적선 격침!', verdict: '틀린 진술 — 위장한 적선이었어요' },
    pass: { head: '✅ 아군 무사 통과', verdict: '맞는 진술 — 아군이었어요' },
    ff: { head: '⚠️ 아군 오인 사격!', verdict: '아군입니다 — 맞는 진술' },
    escape: { head: '🚨 적선 통과!', verdict: '틀린 진술이었습니다' }
  };
  const WIDE_CHAR = /[ᄀ-ᇿ㄰-㆏가-힯　-鿿＀-￯]/;
  let uid = 0;

  // ===========================================================================
  // 유틸
  // ===========================================================================
  function str(v) {
    if (typeof v === 'string') return v.trim();
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
    return '';
  }
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
  function pick(arr) { return arr[Math.min(arr.length - 1, Math.floor(Math.random() * arr.length))]; }
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
  function coerceOX(a) {
    if (typeof a === 'boolean') return a;
    if (typeof a === 'string') {
      const t = a.trim().toUpperCase();
      if (t === 'O' || t === 'TRUE') return true;
      if (t === 'X' || t === 'FALSE') return false;
    }
    return null;
  }
  function fontOf(px, weight) { return (weight || 700) + ' ' + (Math.round(Math.max(1, px) * 10) / 10) + 'px ' + FONT; }
  function smooth(k) { return k * k * (3 - 2 * k); }
  function rrect(c, x, y, w, h, r) {
    const rr = Math.max(0, Math.min(r, w / 2, h / 2));
    c.beginPath();
    c.moveTo(x + rr, y);
    c.arcTo(x + w, y, x + w, y + h, rr);
    c.arcTo(x + w, y + h, x, y + h, rr);
    c.arcTo(x, y + h, x, y, rr);
    c.arcTo(x, y, x + w, y, rr);
    c.closePath();
  }

  // ===========================================================================
  // 설정 · 문제
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
      zoom: num(c.zoom, 2.7, 1.5, 4),
      reloadMs: num(c.reloadMs, 700, 100, 5000),
      freezeMs: num(c.freezeMs, 1600, 0, 10000),
      baseScore: num(c.baseScore, 100, 0, 100000),
      passScore: num(c.passScore, 50, 0, 100000),
      comboRate: num(c.comboRate, 0.1, 0, 10),
      maxMult: num(c.maxMultiplier, 3, 1, 100),
      maxShips: levelMap(c.maxShips, { 1: 2, 2: 2, 3: 3 }, 1, 3, true), // 항로가 3개
      timeFactor: levelMap(c.timeFactor, { 1: 1.0, 2: 0.9, 3: 0.8 }, 0.2, 5, false)
    };
  }
  // O/X 문항만 · 하 셔플 → 중 셔플 → 상 셔플 · 같은 진술은 한 번만
  function buildDeck(bank) {
    const seen = new Set();
    const items = [];
    (Array.isArray(bank) ? bank : []).forEach(function (q) {
      if (!q || typeof q !== 'object' || q.type !== 'ox') return;
      const text = str(q.question).replace(/\s+/g, ' ');
      const answer = coerceOX(q.answer);
      if (!text || answer === null || seen.has(text)) return;
      seen.add(text);
      items.push({
        text: text, answer: answer, level: coerceLevel(q.level),
        explanation: str(q.explanation), category: str(q.category), chars: Array.from(text).length
      });
    });
    const deck = [];
    LEVELS.forEach(function (l) {
      shuffle(items.filter(function (x) { return x.level === l; })).forEach(function (x) { deck.push(x); });
    });
    return deck;
  }
  // 화면을 다 건너는 시간 = clamp(5 + 글자 수/12, 7, 15)초 × 레벨 계수
  function crossMs(chars, level, cfg) {
    return clamp(5 + chars / 12, 7, 15) * (cfg.timeFactor[level] || 1) * 1000;
  }

  // ===========================================================================
  // mount
  // ===========================================================================
  function mount(container, ctx) {
    if (!container || typeof container.appendChild !== 'function') throw new Error('[스나이퍼해운] container 가 필요합니다.');
    const opts = (ctx && typeof ctx === 'object') ? ctx : {};
    const cfg = readConfig(opts.config);
    const muted = !!opts.muted;
    const deck = buildDeck(opts.bank);
    const reduced = prefersReducedMotion();
    const hasRaf = typeof window.requestAnimationFrame === 'function' && typeof window.cancelAnimationFrame === 'function';
    const id = ++uid;
    const reloadLabel = (Math.round(cfg.reloadMs / 100) / 10) + '초';

    // ---- 상태 ----
    let destroyed = false;
    let phase = deck.length ? 'countdown' : 'empty'; // countdown → play → ending → over | quit
    let paused = false;
    let endCalled = false;
    let clock = 0;          // 게임 시계(ms) — 일시정지 중에는 멈춤
    let playMs = 0;         // 플레이 시간(카운트다운 제외) → result.timeMs
    let seaMs = 0;          // 배가 실제로 움직인 시간(오인 사격 정지 제외) — 등장 간격 기준
    let lastNow = 0;
    let rafId = 0;
    let cdLabel = '';
    let freezeLeft = 0;     // 오인 사격 뒤 게임 정지 남은 시간
    let endAt = 0;
    let endReason = '';
    let finalTimeMs = 0;
    let lives = cfg.lives;
    let score = 0;
    let correct = 0;
    let attempts = 0;
    let combo = 0;
    let maxCombo = 0;
    let maxLevel = 0;
    let ptr = 0;            // 다음에 낼 문제
    let shipSeq = 0;
    let nextSpawnAt = FIRST_SPAWN_MS;
    const ships = [];
    const review = [];
    // 조준 · 줌 · 장전
    const aim = { x: 0, y: 0 };
    let aimReady = false;
    let zoomHeld = false;   // 우클릭을 누르고 있는 동안
    let zoomToggle = false; // Z · Shift · [🔭 줌] 버튼
    let mouseButtons = 0;
    let rmbUpAt = -1e9;
    let reloadUntil = 0;
    let recoilT = 0;
    let muzzleT = 0;
    const keys = { up: false, down: false, left: false, right: false };
    let touch = null;       // 조준 중인 손가락 { id, x, y, t, moved }
    // 캔버스
    let g = null;
    let W = 0, H = 0, dpr = 1;
    let horizonY = 0, footY = 0, scopeR = 0;
    let zoomZ = cfg.zoom;   // 실제 줌 배율 (좁은 화면은 조금 낮춰 진술판이 스코프 원에 들어오게)
    let scene = null;
    let bg = null;          // 기본 시야용 정적 배경 캐시
    let drawFailed = false;
    // 이펙트
    const parts = [];
    const plumes = [];
    const rings = [];
    const texts = [];
    const edges = [];
    let flash = null;
    // 배너 · 토스트
    let bannerKind = '';
    let bannerUntil = 0;
    let toastUntil = 0;
    // 오디오 · 리사이즈 관찰자
    let audio = null, master = null, noiseBuf = null;
    let ro = null;
    const cache = {};

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
      node.classList.remove('sn-bump');
      void node.offsetWidth; // 애니메이션 재시작
      node.classList.add('sn-bump');
    }

    const styleLink = ensureStyles();
    while (container.firstChild) container.removeChild(container.firstChild);
    const root = el('div', 'sniper');
    root.setAttribute('tabindex', '-1');
    root.setAttribute('role', 'region');
    root.setAttribute('aria-label', '스나이퍼해운 게임');

    // HUD: 목숨 · 점수 · 콤보 배율 · 난이도 · 맞은 판단/전체 판단 · 재장전 · 일시정지
    const livesFull = el('span', 'sn-lives-full');
    const livesEmpty = el('span', 'sn-lives-empty');
    const livesEl = append(el('span', 'sn-pill sn-lives'), livesFull, livesEmpty);
    const scoreNum = el('b', null, '0');
    const scoreEl = append(el('span', 'sn-pill sn-score'), el('span', 'sn-hud-label', '점수'), scoreNum);
    const comboNum = el('b', null, '0');
    const multNum = el('span', 'sn-mult-x', '×1.0');
    const multEl = append(el('span', 'sn-pill sn-mult'), el('span', 'sn-fire', '🔥'), el('span', 'sn-hud-label', '콤보'), comboNum, multNum);
    multEl.title = '콤보 배율 (연속 정답마다 +' + cfg.comboRate + ', 최대 ×' + cfg.maxMult + ')';
    const lvEl = el('span', 'lv-badge lv-1 sn-lv', LEVEL_LABELS[1]);
    const accNum = el('b', null, '0/0');
    const accEl = append(el('span', 'sn-pill sn-acc'), el('span', 'sn-hud-label', '판단'), accNum);
    accEl.title = '맞은 판단 / 전체 판단';
    const ammoText = el('span', 'sn-ammo-text', '장전 완료');
    const ammoFill = el('span', 'sn-ammo-fill');
    const ammoEl = append(el('span', 'sn-pill sn-ammo is-ready'), el('span', 'sn-ammo-ico', '🎯'), ammoText, append(el('span', 'sn-ammo-bar'), ammoFill));
    ammoEl.title = '볼트액션 재장전 ' + reloadLabel + ' — 그동안은 쏠 수 없어요';
    const pauseBtn = button('sn-pause-btn', '⏸', '일시정지 (Esc 또는 P)', function () { pause(true); });
    const hud = append(el('div', 'sn-hud'), livesEl, scoreEl, multEl, lvEl, accEl, ammoEl, pauseBtn);

    // 피드백 배너 (높이 고정 — 내용이 바뀌어도 캔버스가 움직이지 않게)
    const fbHead = el('p', 'sn-fb-head');
    const fbSub = el('p', 'sn-fb-sub');
    const fbExpl = el('p', 'sn-fb-expl');
    const banner = append(el('div', 'sn-banner is-idle'), fbHead, fbSub, fbExpl);

    // 무대: 캔버스 + 토스트 + 카운트다운
    const canvas = el('canvas', 'sn-canvas');
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', '항만 감시 화면: 지나가는 배마다 진술이 적혀 있어요. 틀린 진술을 단 배(적선)는 저격하고, 맞는 진술을 단 배(아군)는 통과시키세요.');
    const cdNumWrap = el('div', 'sn-countdown-num-wrap');
    const countdown = append(el('div', 'sn-countdown'), cdNumWrap,
      el('p', 'sn-countdown-sub', '틀린 진술 = 위장한 적선 → 저격 · 맞는 진술 = 아군 → 통과'));
    countdown.setAttribute('role', 'status');
    countdown.setAttribute('aria-live', 'assertive');
    const toast = el('div', 'sn-toast');
    toast.hidden = true;
    const stage = append(el('div', 'sn-stage'), canvas, toast, countdown);

    // 모바일: 큰 [🔭 줌](토글) · [🎯 발사] 버튼
    const zoomBtn = button('sn-ctrl sn-ctrl-zoom', '🔭 줌', '스코프 줌 켜기·끄기 (Z 또는 Shift)', function () { toggleZoom(); focusQuiet(root); });
    zoomBtn.setAttribute('aria-pressed', 'false');
    const fireBtn = button('sn-ctrl sn-ctrl-fire', '🎯 발사', '발사 (Space 또는 Enter)', function () { fire(); focusQuiet(root); });
    const controls = append(el('div', 'sn-controls'), zoomBtn, fireBtn);

    // 하단 안내: 조작법
    const help = append(el('div', 'sn-help'),
      el('p', 'sn-help-desk', '🖱️ 마우스 이동 조준 · 우클릭 누른 채 줌 · 좌클릭 사격  ⌨️ Z/Shift 줌 · Space/Enter 사격 · 방향키/WASD 조준 · Esc/P 일시정지'),
      el('p', 'sn-help-touch', '📱 화면을 드래그해 조준 · [🔭 줌]으로 확대 · [🎯 발사]로 사격'),
      el('p', 'sn-help-rule', '재장전 ' + reloadLabel + ' 동안은 쏠 수 없어요 · 허공 사격은 벌점 없음'));
    const live = el('p', 'sn-sr');
    live.setAttribute('aria-live', 'polite');

    // 일시정지 오버레이 (게임 전체를 덮어 배의 진술을 미리 읽을 수 없게)
    const pauseTitleId = 'sn-pause-title-' + id;
    const pauseStats = el('p', 'sn-overlay-stats');
    const resumeBtn = button('btn btn-primary btn-block sn-btn', '▶ 계속하기', null, function () { resume(); });
    const quitBtn = button('btn btn-ghost btn-block sn-btn sn-btn-quit', '그만두기', '그만두기 (기록은 저장되지 않아요)', function () { quit(); });
    const pauseTitle = el('h2', 'sn-overlay-title', '일시정지');
    pauseTitle.id = pauseTitleId;
    const overlay = append(el('div', 'sn-overlay'),
      append(el('div', 'sn-overlay-card'),
        el('p', 'sn-overlay-icon', '⏸'),
        pauseTitle,
        pauseStats,
        append(el('div', 'sn-overlay-actions'), resumeBtn, quitBtn),
        el('p', 'sn-overlay-hint', 'Esc 또는 P 키로도 계속할 수 있어요 · 그만두면 기록은 저장되지 않아요')));
    overlay.hidden = true;
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', pauseTitleId);

    if (phase === 'empty') {
      const back = button('btn btn-primary', '돌아가기', null, function () { quit(); });
      append(root, append(el('div', 'sn-empty'),
        el('p', 'sn-empty-icon', '🔭'),
        el('p', 'sn-empty-title', '출제할 O/X 문제가 없어요'),
        el('p', 'sn-empty-msg', '문제 데이터를 불러오지 못해 스나이퍼해운을 시작할 수 없어요.'),
        back));
      container.appendChild(root);
      focusQuiet(back);
      return { destroy: destroy, pause: function () {}, resume: function () {} };
    }

    append(root, hud, banner, stage, controls, help, live, overlay);
    container.appendChild(root);
    try { g = canvas.getContext('2d'); } catch (e) { g = null; }

    // =========================================================================
    // 캔버스 크기 (container 너비 · 화면 높이 · devicePixelRatio)
    // =========================================================================
    function layout() {
      const cw = Math.floor(stage.clientWidth || root.clientWidth || container.clientWidth || 0);
      const w = cw > 0 ? Math.max(240, cw) : (W || 360);
      const vh = window.innerHeight || 720;
      let h = clamp(Math.round(w * (w < 560 ? 1.1 : 0.56)), 280, 560);
      let top = 0;
      try { top = stage.getBoundingClientRect().top + (window.pageYOffset || 0); } catch (e) { top = 0; }
      if (!Number.isFinite(top) || top < 0) top = 0;
      const below = (controls.offsetHeight || 0) + (help.offsetHeight || 0) + 28;
      const fit = Math.floor(vh - top - below);
      if (Number.isFinite(fit)) h = Math.max(280, Math.min(h, fit));
      const ratio = clamp(Number(window.devicePixelRatio) || 1, 1, 3);
      if (w === W && h === H && ratio === dpr) return false;
      const ow = W, oh = H;
      W = w; H = h; dpr = ratio;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      canvas.style.height = H + 'px';
      horizonY = Math.round(H * (W < NARROW ? 0.33 : 0.37));
      footY = H - clamp(Math.round(H * 0.06), 14, 30);
      // 세로로 긴 화면에서는 원이 좌우로 살짝 넘쳐도 되게 (보이는 영역을 넓힌다)
      scopeR = Math.max(60, Math.round(Math.min(W * 0.53, H * 0.47)));
      zoomZ = W < NARROW ? Math.max(1.5, cfg.zoom - 0.2) : cfg.zoom;
      if (!aimReady || !ow || !oh) { aim.x = W / 2; aim.y = laneY(1) - 30; aimReady = true; }
      else { aim.x = clamp(aim.x * W / ow, 0, W); aim.y = clamp(aim.y * H / oh, 0, H); }
      buildScene();
      buildBackground();
      ships.forEach(function (s) { layoutBoard(s); placeShip(s); });
      return true;
    }
    function laneY(i) { return horizonY + (footY - horizonY) * LANE_POS[i]; }
    function depthScale(y) { return clamp(0.8 + 0.4 * (y - horizonY) / Math.max(1, footY - horizonY), 0.7, 1.25); }

    // =========================================================================
    // 전광판 글자 배치 (월드 px · 확대 시에도 같은 줄바꿈)
    // =========================================================================
    function measure(text, fs) {
      if (g && typeof g.measureText === 'function') {
        try {
          g.font = fontOf(fs, 700);
          const m = g.measureText(text);
          if (m && Number.isFinite(m.width) && m.width > 0) return m.width;
        } catch (e) { /* 추정값 사용 */ }
      }
      let w = 0;
      Array.from(text).forEach(function (ch) {
        if (ch === ' ') w += fs * 0.3;
        else w += WIDE_CHAR.test(ch) ? fs * 0.95 : fs * 0.56;
      });
      return w;
    }
    function wrapText(text, maxW, fs) {
      const lines = [];
      let cur = '';
      function startWith(word) { // 한 줄보다 긴 단어는 글자 단위로 자른다
        if (measure(word, fs) <= maxW) { cur = word; return; }
        let piece = '';
        Array.from(word).forEach(function (ch) {
          if (piece && measure(piece + ch, fs) > maxW) { lines.push(piece); piece = ch; } else piece += ch;
        });
        cur = piece;
      }
      text.split(' ').forEach(function (word) {
        if (!word) return;
        if (!cur) { startWith(word); return; }
        const cand = cur + ' ' + word;
        if (measure(cand, fs) <= maxW) cur = cand;
        else { lines.push(cur); cur = ''; startWith(word); }
      });
      if (cur) lines.push(cur);
      return lines.length ? lines : [text];
    }
    function layoutBoard(s) {
      const sc = LANE_SCALE[s.lane];
      const spec = SHIPS[s.type];
      const fs = Math.round(BASE_FS * (W < NARROW ? NARROW_FS[s.lane] : sc) * 10) / 10;
      const lh = Math.round(fs * 1.3 * 10) / 10;
      const pad = Math.round(fs * 0.7 * 10) / 10;
      const view = (2 * scopeR) / zoomZ; // 스코프 안에 보이는 폭(월드 px) — 진술판이 원 안에 들어오게
      const maxW = Math.max(52 * sc, Math.min(168 * sc, W * 0.44, view * 0.8 - pad * 2));
      const minW = Math.min(maxW, 60 * sc);
      const full = measure(s.q.text, fs);
      const wrapW = clamp(Math.sqrt(full * lh * 2.2), minW, maxW);
      const lines = wrapText(s.q.text, wrapW, fs);
      let tw = 0;
      lines.forEach(function (ln) { tw = Math.max(tw, measure(ln, fs)); });
      s.fs = fs; s.lh = lh; s.pad = pad; s.lines = lines;
      s.bw = Math.ceil(Math.max(tw, 24) + pad * 2);
      s.bh = Math.ceil(lines.length * lh + pad * 2);
      s.hullL = spec.L * sc;
      s.topH = spec.top * sc;
      s.footH = spec.foot * sc;
      s.mastH = spec.mast * sc;
      s.hw = Math.max(s.bw / 2, s.hullL / 2 + 16 * sc) + 2; // 화면 밖으로 완전히 나갈 때까지의 반폭
    }
    function placeShip(s) {
      const span = W + 2 * s.hw;
      s.x = s.dir > 0 ? -s.hw + span * s.p : W + s.hw - span * s.p;
    }
    // 현재 모습: 위치·출렁임·기울기·가라앉은 깊이·투명도
    function pose(s) {
      const sc = LANE_SCALE[s.lane];
      const base = laneY(s.lane);
      let bob = reduced ? 0 : Math.sin(clock / 1000 * TAU * s.bobF + s.ph) * 0.8 * sc;
      let tilt = 0, depth = 0, alpha = 1;
      if (s.state === 'sink') {
        const k = clamp((clock - s.anim) / SINK_MS, 0, 1);
        const e = smooth(clamp((k - 0.18) / 0.82, 0, 1));
        tilt = -s.dir * 0.32 * e; // 선미부터 가라앉으며 뱃머리가 들린다
        depth = e * (s.mastH + s.bh + 8);
        alpha = k > 0.85 ? clamp((1 - k) / 0.15, 0, 1) : 1;
        if (k < 0.18 && !reduced) bob += Math.sin(k * 90) * 1.2 * sc; // 피격 진동
      } else if (s.state === 'retreat') {
        alpha = 1 - clamp((clock - s.anim) / RETREAT_MS, 0, 1);
      }
      return { x: s.x, y: base + bob, base: base, tilt: tilt, depth: depth, alpha: alpha };
    }
    // 판정: 선체 · 돛대 · 전광판(깃발) 사각형
    function hits(s, x, y) {
      if (s.state !== 'sail') return false;
      const P = pose(s);
      const half = s.hullL / 2;
      if (x >= P.x - half - HIT_PAD && x <= P.x + half + HIT_PAD && y >= P.y - s.topH - HIT_PAD && y <= P.y + 2 + HIT_PAD) return true;
      if (Math.abs(x - P.x) <= 1.5 + HIT_PAD && y >= P.y - s.mastH - HIT_PAD && y <= P.y) return true;
      const top = P.y - s.mastH - s.bh;
      return x >= P.x - s.bw / 2 - HIT_PAD && x <= P.x + s.bw / 2 + HIT_PAD && y >= top - HIT_PAD && y <= top + s.bh + HIT_PAD;
    }
    // 겹치면 앞(가까운 항로·나중에 나온 배)이 맞는다 — 그리는 순서와 같다
    function shipAt(x, y) {
      let best = null;
      for (let i = 0; i < ships.length; i++) {
        const s = ships[i];
        if (!hits(s, x, y)) continue;
        if (!best || s.lane > best.lane || (s.lane === best.lane && s.seq > best.seq)) best = s;
      }
      return best;
    }

    // =========================================================================
    // 효과음 (WebAudio 합성 · muted 면 만들지 않음 · 사용자 입력 때 resume)
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
      gn.gain.exponentialRampToValueAtTime(vol, t0 + 0.008);
      gn.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(gn);
      gn.connect(master);
      o.start(t0);
      o.stop(t0 + dur + 0.03);
    }
    function noise(dur, vol, filter, freq, delay) {
      if (!noiseBuf) {
        const len = Math.max(1, Math.floor(audio.sampleRate * 0.5));
        noiseBuf = audio.createBuffer(1, len, audio.sampleRate);
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      }
      const t0 = audio.currentTime + (delay || 0);
      const src = audio.createBufferSource();
      src.buffer = noiseBuf;
      const f = audio.createBiquadFilter();
      f.type = filter;
      f.frequency.value = freq;
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
        if (name === 'shot') { // 총성(노이즈 버스트) + 볼트액션 재장전 클릭 두 번
          const r = cfg.reloadMs / 1000;
          noise(0.18, 0.5, 'lowpass', 2400, 0);
          noise(0.05, 0.28, 'highpass', 3200, 0);
          tone(150, 45, 0.16, 'sine', 0.32, 0);
          noise(0.03, 0.14, 'highpass', 2600, r * 0.38);
          tone(2100, 1500, 0.025, 'square', 0.05, r * 0.38);
          noise(0.03, 0.14, 'highpass', 2000, r * 0.8);
          tone(1500, 1000, 0.03, 'square', 0.055, r * 0.8);
        } else if (name === 'hit') { // 명중: 둔탁한 폭음 + 물기둥
          noise(0.5, 0.36, 'lowpass', 650, 0);
          tone(300, 80, 0.4, 'triangle', 0.2, 0);
          tone(660, 990, 0.12, 'triangle', 0.12, 0.08);
        } else if (name === 'alarm') { // 오인 사격 경보
          for (let i = 0; i < 4; i++) tone(i % 2 ? 620 : 880, i % 2 ? 620 : 880, 0.12, 'square', 0.07, i * 0.13);
        } else if (name === 'chime') { // 아군 통과 차임
          tone(784, 784, 0.18, 'sine', 0.16, 0);
          tone(1175, 1175, 0.28, 'sine', 0.14, 0.11);
        } else if (name === 'escape') { // 적선 통과
          tone(330, 110, 0.5, 'sawtooth', 0.12, 0);
          tone(220, 90, 0.5, 'square', 0.05, 0.05);
        } else if (name === 'splash') {
          noise(0.14, 0.1, 'highpass', 1300, 0.05);
        } else if (name === 'tick') {
          tone(660, 660, 0.08, 'sine', 0.12, 0);
        } else if (name === 'go') {
          tone(990, 990, 0.16, 'triangle', 0.16, 0);
        } else if (name === 'level') {
          [523, 659, 784].forEach(function (f, i) { tone(f, f, 0.12, 'triangle', 0.1, i * 0.07); });
        } else if (name === 'fanfare') {
          [523, 659, 784, 1047].forEach(function (f, i) { tone(f, f, 0.14, 'triangle', 0.11, i * 0.08); });
        }
      } catch (e) { /* 오디오 실패는 게임에 영향 없음 */ }
    }

    // =========================================================================
    // 이펙트 (물기둥 · 연기 · 물보라 · 떠오르는 글자 · 가장자리 신호)
    // =========================================================================
    function addPart(p) { if (parts.length < 420) parts.push(p); }
    function ring(x, y, r0, r1, life, color, width, flat) {
      rings.push({ x: x, y: y, r0: r0, r1: r1, life: life, max: life, c: color, w: width, flat: !!flat });
    }
    function floatText(x, y, text, color, size) {
      texts.push({ x: x, y: y, text: text, c: color, size: size || 16, life: 1100, max: 1100 });
    }
    function splash(x, y, s) {
      ring(x, y, 1, 10 * s, 420, 'rgba(255, 255, 255, 0.8)', 1.2, true);
      if (reduced) return;
      for (let i = 0; i < 7; i++) {
        addPart({ k: 'drop', x: x, y: y, vx: (Math.random() - 0.5) * 0.06 * s, vy: -(0.05 + Math.random() * 0.07) * s,
          g: 0.00035 * s, life: 420, max: 420, r: (0.7 + Math.random() * 0.8) * s, c: i % 2 ? '#e7f5ff' : '#a5d8ff' });
      }
    }
    function smokePuff(x, y, sc, n) {
      for (let i = 0; i < n; i++) {
        const life = 1300 + Math.random() * 600;
        addPart({ k: 'smoke', x: x + (Math.random() - 0.5) * 12 * sc, y: y, vx: (Math.random() - 0.5) * 0.01, vy: -(0.012 + Math.random() * 0.012),
          g: 0, life: life, max: life, r: (2.5 + Math.random() * 2) * sc, grow: 0.006 * sc, c: i % 2 ? '120, 128, 140' : '150, 156, 166' });
      }
    }
    function sinkFx(s, P) {
      const sc = LANE_SCALE[s.lane];
      plumes.push({ x: P.x, y: P.base, h: s.mastH + s.bh * 0.5 + 18 * sc, w: 7 * sc, life: 1150, max: 1150 });
      ring(P.x, P.base, 4 * sc, 34 * sc, 900, 'rgba(255, 255, 255, 0.75)', 1.6, true);
      ring(P.x, P.base, 2 * sc, 22 * sc, 1300, 'rgba(210, 236, 255, 0.6)', 1.2, true);
      if (reduced) return;
      for (let i = 0; i < 16; i++) {
        addPart({ k: 'drop', x: P.x + (Math.random() - 0.5) * 8 * sc, y: P.base - s.topH * 0.5, vx: (Math.random() - 0.5) * 0.12 * sc,
          vy: -(0.08 + Math.random() * 0.12) * sc, g: 0.0004 * sc, life: 700, max: 700, r: (0.8 + Math.random()) * sc, c: i % 3 ? '#ffffff' : '#a5d8ff' });
      }
      smokePuff(P.x, P.y - s.topH, sc, 6);
    }
    function friendlyFx(s, P, pt) {
      const sc = LANE_SCALE[s.lane];
      ring(pt.x, pt.y, 2, 16, 520, 'rgba(255, 201, 201, 0.95)', 2, false);
      splash(clamp(pt.x, P.x - s.hullL / 2, P.x + s.hullL / 2), P.base, sc);
      if (!reduced) smokePuff(pt.x, pt.y, sc * 0.6, 2);
    }
    function celebrate() {
      ring(W * 0.5, H * 0.45, 6, 60, 600, 'rgba(255, 224, 102, 0.95)', 3, false);
      if (reduced) return;
      const colors = ['#ffd43b', '#63e6be', '#74c0fc', '#ffffff', '#ff922b'];
      [[0.22, 0.18], [0.5, 0.1], [0.78, 0.2]].forEach(function (p) {
        for (let i = 0; i < 26; i++) {
          const a = Math.random() * TAU;
          const v = 0.05 + Math.random() * 0.12;
          addPart({ k: 'drop', x: W * p[0], y: H * p[1], vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 0.00012, life: 1100, max: 1100, r: 1.2 + Math.random(), c: colors[i % colors.length] });
        }
      });
    }
    function updateEffects(dt) {
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.life -= dt;
        if (p.life <= 0) { parts[i] = parts[parts.length - 1]; parts.pop(); continue; }
        p.vy += p.g * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.grow) p.r += p.grow * dt;
      }
      age(plumes, dt);
      age(rings, dt);
      age(texts, dt);
      age(edges, dt);
      if (flash) { flash.life -= dt; if (flash.life <= 0) flash = null; }
      if (recoilT > 0) recoilT = Math.max(0, recoilT - dt);
      if (muzzleT > 0) muzzleT = Math.max(0, muzzleT - dt);
    }
    function age(list, dt) {
      for (let i = list.length - 1; i >= 0; i--) { list[i].life -= dt; if (list[i].life <= 0) list.splice(i, 1); }
    }

    // =========================================================================
    // HUD · 배너 · 토스트 · 카운트다운
    // =========================================================================
    function setText(node, key, value) {
      if (cache[key] === value) return;
      cache[key] = value;
      node.textContent = value;
    }
    function multiplier() { return Math.min(cfg.maxMult, 1 + cfg.comboRate * combo); }
    function fmtMult(m) { return (Math.round(m * 10) / 10).toFixed(1); }
    function reloadRatio() { return reloadUntil > clock ? clamp(1 - (reloadUntil - clock) / cfg.reloadMs, 0, 1) : 1; }
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
      setText(comboNum, 'cb', String(combo));
      setText(multNum, 'mu', '×' + fmtMult(multiplier()));
      multEl.classList.toggle('is-hot', combo >= 3);
      setText(accNum, 'ac', correct + '/' + attempts);
      const lv = maxLevel || (deck[0] ? deck[0].level : 1);
      if (cache.lv !== lv) {
        cache.lv = lv;
        lvEl.className = 'lv-badge lv-' + lv + ' sn-lv';
        lvEl.textContent = LEVEL_LABELS[lv];
      }
      updateAmmo();
    }
    function updateAmmo() {
      const ready = clock >= reloadUntil;
      const r = Math.round(reloadRatio() * 40) / 40;
      if (cache.am !== r) { cache.am = r; ammoFill.style.transform = 'scaleX(' + r.toFixed(3) + ')'; }
      if (cache.ar !== ready) {
        cache.ar = ready;
        ammoEl.classList.toggle('is-ready', ready);
        ammoText.textContent = ready ? '장전 완료' : '재장전…';
      }
    }
    function updateZoomUi() {
      const z = isZoomed();
      if (cache.zm !== z) { cache.zm = z; root.classList.toggle('is-zoomed', z); }
      if (cache.zt !== zoomToggle) {
        cache.zt = zoomToggle;
        zoomBtn.setAttribute('aria-pressed', String(zoomToggle));
        zoomBtn.classList.toggle('is-on', zoomToggle);
      }
    }
    function showBanner(kind, q, pts) {
      const b = BANNER[kind];
      bannerKind = kind;
      bannerUntil = clock + (kind === 'ff' || kind === 'escape' ? BANNER_BAD_MS : BANNER_GOOD_MS);
      banner.className = 'sn-banner is-' + kind;
      fbHead.textContent = b.head + (pts ? ' +' + fmtInt(pts) + '점' : '');
      fbSub.textContent = b.verdict + ' · “' + q.text + '”';
      fbExpl.textContent = q.explanation ? '💡 ' + q.explanation : '';
      fbExpl.hidden = !q.explanation;
    }
    function idleBanner() {
      bannerKind = '';
      banner.className = 'sn-banner is-idle';
      fbHead.textContent = '🔭 틀린 진술을 단 배 = 위장한 적선 → 저격!';
      fbSub.textContent = '맞는 진술을 단 배는 아군 — 쏘지 말고 그대로 통과시키세요.';
      fbExpl.textContent = '글씨가 작아요. 우클릭을 누르고 있거나 Z(모바일은 [🔭 줌])로 스코프를 당겨 읽으세요. 재장전 ' + reloadLabel + ' · 허공 사격은 벌점 없음.';
      fbExpl.hidden = false;
    }
    function showToast(text) {
      toast.textContent = text;
      toast.hidden = false;
      toast.classList.remove('is-on');
      void toast.offsetWidth;
      toast.classList.add('is-on');
      toastUntil = clock + TOAST_MS;
    }
    function setCountdown(label) {
      while (cdNumWrap.firstChild) cdNumWrap.removeChild(cdNumWrap.firstChild);
      if (!label) { countdown.hidden = true; return; }
      countdown.hidden = false;
      cdNumWrap.appendChild(el('span', 'sn-countdown-num' + (label === 'GO!' ? ' is-go' : ''), label));
    }
    function announce(msg) { live.textContent = msg; }

    // =========================================================================
    // 진행: 배 등장 · 항해 · 판정
    // =========================================================================
    function startPlay() {
      phase = 'play';
      setCountdown('');
      updateHud();
    }
    function maybeSpawn() {
      if (ptr >= deck.length || seaMs < nextSpawnAt) return;
      const lv = deck[ptr].level;
      let sailing = 0;
      let newest = null;
      for (let i = 0; i < ships.length; i++) {
        const s = ships[i];
        if (s.state !== 'sail') continue;
        sailing++;
        if (!newest || s.seq > newest.seq) newest = s;
      }
      if (sailing >= cfg.maxShips[lv]) return;
      if (newest && newest.p < STAGGER[lv]) return; // 시차를 두고 등장
      spawnShip(newest);
    }
    // 항로: 떠 있는 배와 되도록 먼 항로 (진술판이 서로 덜 겹치게)
    function chooseLane() {
      const busy = [false, false, false];
      const shown = [false, false, false];
      ships.forEach(function (s) { if (s.state === 'sail') busy[s.lane] = true; else shown[s.lane] = true; });
      let free = [0, 1, 2].filter(function (l) { return !busy[l]; });
      if (!free.length) return pick([0, 1, 2]);
      const taken = [0, 1, 2].filter(function (l) { return busy[l]; });
      if (!taken.length) return Math.random() < 0.75 ? pick([0, 2]) : 1;
      let best = -1;
      free.forEach(function (l) {
        let d = 9;
        taken.forEach(function (t) { d = Math.min(d, Math.abs(l - t)); });
        if (shown[l]) d -= 0.5; // 아직 가라앉는 중인 배가 있는 항로는 덜 선호
        best = Math.max(best, d);
      });
      free = free.filter(function (l) {
        let d = 9;
        taken.forEach(function (t) { d = Math.min(d, Math.abs(l - t)); });
        if (shown[l]) d -= 0.5;
        return d === best;
      });
      return pick(free);
    }
    function spawnShip(newest) {
      const q = deck[ptr++];
      const s = {
        seq: ++shipSeq, q: q, lane: chooseLane(),
        dir: newest ? -newest.dir : (Math.random() < 0.5 ? 1 : -1), // 좌우에서 번갈아
        type: pick(SHIP_KEYS), board: Math.random() < 0.5 ? 'led' : 'flag',
        t: 0, T: crossMs(q.chars, q.level, cfg), p: 0, x: 0,
        state: 'sail', anim: 0, ph: Math.random() * TAU, bobF: 0.3 + Math.random() * 0.25
      };
      layoutBoard(s);
      placeShip(s);
      ships.push(s);
      nextSpawnAt = seaMs + SPAWN_GAP_MS;
      if (q.level > maxLevel) {
        const up = maxLevel > 0;
        maxLevel = q.level;
        if (up) { showToast('📈 난이도 상승 · ' + LEVEL_LABELS[q.level]); sound('level'); }
      }
      updateHud();
    }
    function sail(dt) {
      for (let i = 0; i < ships.length; i++) {
        const s = ships[i];
        if (s.state !== 'sail') continue;
        s.t += dt;
        s.p = Math.min(1, s.t / s.T);
        placeShip(s);
        if (s.t >= s.T) {
          exitShip(s);
          if (phase !== 'play') return; // 목숨 소진·완주 → 장면 정지
        }
      }
    }
    function sweepShips() {
      for (let i = ships.length - 1; i >= 0; i--) {
        const s = ships[i];
        if (s.state === 'gone' || (s.state === 'sink' && clock - s.anim >= SINK_MS) ||
          (s.state === 'retreat' && clock - s.anim >= RETREAT_MS)) ships.splice(i, 1);
      }
    }
    function reviewEntry(q, userAnswer) {
      return {
        prompt: q.text, answer: q.answer ? ANSWER_FRIEND : ANSWER_ENEMY, userAnswer: userAnswer,
        explanation: q.explanation, category: q.category, level: q.level
      };
    }
    function gain(points) { // 정답: 이번 정답 직전까지의 콤보로 배율 적용
      const pts = Math.round(points * multiplier());
      score += pts;
      correct++;
      combo++;
      if (combo > maxCombo) maxCombo = combo;
      return pts;
    }
    function lose() {
      lives = Math.max(0, lives - 1);
      combo = 0;
      bump(livesEl);
    }
    // 저격 명중
    function strike(s, pt) {
      attempts++;
      const P = pose(s);
      const boardTop = P.y - s.mastH - s.bh;
      if (!s.q.answer) { // 틀린 진술 = 적선 → 격침
        const pts = gain(cfg.baseScore);
        s.state = 'sink';
        s.anim = clock;
        sinkFx(s, P);
        floatText(P.x, boardTop - 8, '+' + fmtInt(pts), '#ffe066', 18);
        if (combo >= 3) floatText(P.x, boardTop - 28, combo + '콤보! ×' + fmtMult(multiplier()), '#ffd8a8', 13);
        showBanner('sink', s.q, pts);
        sound('hit');
        bump(scoreEl);
        if (combo >= 3) bump(multEl);
        announce('적선 격침! ' + fmtInt(pts) + '점. 틀린 진술이었어요.');
      } else { // 맞는 진술 = 아군 → 오인 사격 (게임 정지하고 해설)
        lose();
        review.push(reviewEntry(s.q, USER_SHOT));
        s.state = 'retreat';
        s.anim = clock + cfg.freezeMs;
        friendlyFx(s, P, pt);
        floatText(P.x, boardTop - 8, '⚠ 아군!', '#ffc9c9', 16);
        showBanner('ff', s.q, 0);
        freezeLeft = cfg.freezeMs;
        flash = { c: '224, 49, 49', life: 280, max: 280 };
        sound('alarm');
        announce('아군 오인 사격! 맞는 진술이었어요. 목숨 ' + lives + '개 남음.');
      }
      afterResolve();
      updateHud();
    }
    // 화면 밖으로 빠져나감
    function exitShip(s) {
      s.state = 'gone';
      s.p = 1;
      attempts++;
      const side = s.dir > 0 ? 1 : -1;
      const ex = side > 0 ? W - 64 : 64;
      const ey = laneY(s.lane) - s.mastH - 12;
      if (!s.q.answer) { // 적선 통과 = 놓침
        lose();
        review.push(reviewEntry(s.q, USER_PASS));
        edges.push({ side: side, c: '255, 82, 82', life: 900, max: 900 });
        floatText(ex, ey, '🚨 적선 통과!', '#ffc9c9', 15);
        showBanner('escape', s.q, 0);
        sound('escape');
        announce('적선 통과! 틀린 진술이었어요. 목숨 ' + lives + '개 남음.');
      } else { // 아군 무사 통과 = 올바른 판단
        const pts = gain(cfg.passScore);
        edges.push({ side: side, c: '81, 207, 102', life: 700, max: 700 });
        floatText(ex, ey, '✓ 아군 통과 +' + fmtInt(pts), '#b2f2bb', 14);
        showBanner('pass', s.q, pts);
        sound('chime');
        bump(scoreEl);
        announce('아군 무사 통과 ' + fmtInt(pts) + '점.');
      }
      afterResolve();
      updateHud();
    }
    function afterResolve() {
      if (phase !== 'play') return;
      if (lives <= 0) { beginEnding('lives', Math.max(cfg.freezeMs, MIN_END_DELAY_MS)); return; }
      for (let i = 0; i < ships.length; i++) if (ships[i].state === 'sail') return;
      if (ptr >= deck.length) { beginEnding('cleared', Math.max(CLEAR_DELAY_MS, freezeLeft)); return; }
      nextSpawnAt = Math.max(nextSpawnAt, seaMs + EMPTY_GAP_MS);
    }
    function beginEnding(reason, delay) {
      if (phase !== 'play') return;
      phase = 'ending';
      endReason = reason;
      finalTimeMs = playMs;
      endAt = clock + delay;
      zoomHeld = false;
      zoomToggle = false;
      keys.up = keys.down = keys.left = keys.right = false;
      pauseBtn.disabled = true;
      zoomBtn.disabled = true;
      fireBtn.disabled = true;
      updateZoomUi();
      if (reason === 'cleared') {
        celebrate();
        sound('fanfare');
        announce('모든 배를 처리했어요! 최종 점수 ' + score + '점');
      } else {
        announce('목숨을 모두 잃었어요. 최종 점수 ' + score + '점');
      }
    }
    function finish() {
      if (phase !== 'ending') return;
      phase = 'over';
      cancelFrame();
      root.classList.add('is-over');
      render(); // 마지막 장면을 남겨 둔다
      if (endCalled) return;
      endCalled = true;
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
        try { opts.onEnd(result); } catch (e) { if (window.console) console.error('[스나이퍼해운] onEnd 오류', e); }
      }
    }

    // =========================================================================
    // 조준 · 줌 · 사격
    // =========================================================================
    function isZoomed() { return zoomHeld || zoomToggle; }
    function aimable() { return !destroyed && !paused && (phase === 'countdown' || phase === 'play'); }
    function setZoomHeld(v) {
      if (zoomHeld === v) return;
      zoomHeld = v;
      updateZoomUi();
      if (!running() && !destroyed) render();
    }
    function toggleZoom() {
      if (!aimable()) return;
      zoomToggle = !zoomToggle;
      updateZoomUi();
    }
    // 브레스 스웨이: 줌 중 조준점이 미세하게 흔들린다 (모션 최소화면 끔)
    function swayOffset() {
      if (reduced || !isZoomed()) return { x: 0, y: 0 };
      const t = clock / 1000;
      return {
        x: Math.sin(t * 0.9) * 1.8 + Math.sin(t * 2.3 + 1.1) * 0.5,
        y: Math.sin(t * 1.3 + 0.7) * 1.3 + Math.sin(t * 3.1 + 2) * 0.35
      };
    }
    function shotPoint() {
      const sw = swayOffset();
      return { x: clamp(aim.x + sw.x, 0, W), y: clamp(aim.y + sw.y, 0, H) };
    }
    function viewCenter() { // 스코프 중심에 보이는 월드 좌표 (반동으로 잠깐 위로 튄다)
      const sw = swayOffset();
      const kick = recoilT > 0 ? recoilT / RECOIL_MS : 0;
      return { x: aim.x + sw.x, y: aim.y + sw.y - kick * 7 / zoomZ };
    }
    function scopeCenter() { // 스코프 원은 조준점을 따라가되 캔버스 밖으로 잘리지 않게
      const R = scopeR;
      return {
        x: W > 2 * R ? clamp(aim.x, R, W - R) : W / 2,
        y: H > 2 * R ? clamp(aim.y, R, H - R) : H / 2
      };
    }
    function fire() {
      if (destroyed || paused || phase !== 'play' || freezeLeft > 0) return false;
      if (clock < reloadUntil) { bump(ammoEl); return false; } // 볼트액션 재장전 중: 무시
      const pt = shotPoint();
      reloadUntil = clock + cfg.reloadMs;
      muzzleT = MUZZLE_MS;
      if (!reduced) recoilT = RECOIL_MS;
      sound('shot');
      const s = shipAt(pt.x, pt.y);
      if (s) strike(s, pt);
      else missShot(pt);
      updateHud();
      return true;
    }
    function missShot(pt) { // 허공 사격: 벌점 없음
      if (pt.y > horizonY + 1 && pt.y < footY) { splash(pt.x, pt.y, depthScale(pt.y)); sound('splash'); }
      else ring(pt.x, pt.y, 1, 6, 300, 'rgba(255, 255, 255, 0.6)', 1, false);
    }
    function moveAimByKeys(dt) {
      const dx = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
      const dy = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
      if (!dx && !dy) return;
      const v = KEY_AIM_SPEED * dt * (isZoomed() ? 1.5 / zoomZ : 1);
      aim.x = clamp(aim.x + dx * v, 0, W);
      aim.y = clamp(aim.y + dy * v, 0, H);
    }
    function releaseInputs() {
      zoomHeld = false;
      mouseButtons = 0;
      keys.up = keys.down = keys.left = keys.right = false;
      touch = null;
      updateZoomUi();
    }

    // =========================================================================
    // 시간 · 루프
    // =========================================================================
    function running() { return !destroyed && !paused && (phase === 'countdown' || phase === 'play' || phase === 'ending'); }
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
      const dt = clamp(t - lastNow, 0, MAX_DT); // 프레임이 오래 멈췄다면 최대 0.1초만 진행
      lastNow = t;
      update(dt);
      if (destroyed) return; // onEnd 안에서 destroy 됐을 수 있음
      render();
      requestFrame();
    }
    function update(dt) {
      clock += dt;
      updateEffects(dt);
      if (phase === 'countdown' || phase === 'play') moveAimByKeys(dt);
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
      if (phase === 'play') {
        playMs += dt;
        if (freezeLeft > 0) {
          freezeLeft = Math.max(0, freezeLeft - dt); // 오인 사격: 배·등장 모두 정지
        } else {
          seaMs += dt;
          sail(dt);
          if (phase === 'play') maybeSpawn();
        }
      }
      sweepShips();
      if (bannerKind && clock >= bannerUntil) idleBanner();
      if (toastUntil && clock >= toastUntil) { toastUntil = 0; toast.hidden = true; }
      updateAmmo();
      if (phase === 'ending' && clock >= endAt) finish();
    }

    // =========================================================================
    // 일시정지 · 그만두기
    // =========================================================================
    function pause(focusResume) {
      if (destroyed || paused || (phase !== 'countdown' && phase !== 'play')) return;
      paused = true;
      cancelFrame();
      releaseInputs();
      pauseStats.textContent = phase === 'countdown'
        ? '곧 시작해요 · 배 ' + deck.length + '척 · 목숨 ' + lives + '개'
        : '처리 ' + attempts + ' / ' + deck.length + '척 · 점수 ' + fmtInt(score) + ' · 목숨 ' + lives + '개';
      overlay.hidden = false;
      root.classList.add('is-paused');
      render(); // 캔버스에서도 배를 지운 화면으로 (오버레이 아래에서 미리 읽기 방지)
      if (focusResume) focusQuiet(resumeBtn);
      announce('일시정지');
    }
    function resume() {
      if (destroyed || !paused || (phase !== 'countdown' && phase !== 'play')) return;
      paused = false;
      overlay.hidden = true;
      root.classList.remove('is-paused');
      focusQuiet(root);
      unlockAudio();
      lastNow = perfNow(); // 일시정지한 시간은 게임 시계에 넣지 않는다
      requestFrame();
    }
    function quit() {
      if (destroyed || phase === 'over' || phase === 'quit') return;
      phase = 'quit';
      paused = false;
      cancelFrame();
      if (typeof opts.onQuit === 'function') {
        try { opts.onQuit(); } catch (e) { if (window.console) console.error('[스나이퍼해운] onQuit 오류', e); }
      }
    }

    // =========================================================================
    // 그리기 — 항만 파노라마 (도형·그라디언트로 직접)
    // =========================================================================
    function buildScene() {
      const s = clamp(Math.min(W / 900, H / 500), 0.42, 1.3);
      const hz = horizonY;
      const seaH = footY - hz;
      const tanks = [];
      [[0.03, 30, 15], [0.1, 34, 17], [0.17, 28, 14], [0.235, 32, 16]].forEach(function (b) {
        tanks.push({ x: W * b[0] + 8 * s, w: b[1] * s, h: b[2] * s, base: hz - 5 * s, back: true });
      });
      [[0, 46, 22], [0.085, 52, 25], [0.175, 44, 21], [0.255, 40, 19]].forEach(function (f) {
        tanks.push({ x: W * f[0] + 4 * s, w: f[1] * s, h: f[2] * s, base: hz, back: false });
      });
      const tall = tanks[5];
      const tankerX0 = W * 0.565;
      const tanker = { x0: tankerX0, x1: tankerX0 + Math.max(90, W * 0.21), y: hz + 11 * s, hh: 7 * s };
      tanker.deckY = tanker.y - tanker.hh;
      const spm = { x: W * 0.415, y: hz + seaH * 0.11 };
      const jettyX0 = W * 0.575;
      scene = {
        s: s,
        tanks: tanks,
        landR: W * 0.34,
        flareX: W * 0.325,
        flareH: 64 * s,
        sunX: W * 0.47,
        shoreL: W * 0.84,
        jetty: { x0: jettyX0, y: hz + 3 * s },
        arms: [W * 0.6, W * 0.645, W * 0.69],
        tanker: tanker,
        spm: spm,
        lights: [
          { x: tall.x + tall.w / 2, y: tall.base - tall.h - tall.w * 0.08 - 1.5 * s, c: '255, 90, 90' },
          { x: spm.x, y: spm.y - 12.5 * s, c: '255, 214, 90' },
          { x: jettyX0 + 1 * s, y: hz - 4 * s, c: '120, 255, 150' }
        ]
      };
    }
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
    // 정적 풍경. 확대 시야에서도 같은 함수로 다시 그린다(픽셀 확대 아님) — 그래서 화면 밖까지 넉넉히 칠한다
    function paintStatic(c) {
      const S = scene;
      if (!S) return;
      const s = S.s;
      const hz = horizonY;
      const XL = -W, XR = W * 2, YT = -H, YB = H * 2;
      // 하늘 (해 질 녘)
      let gr = c.createLinearGradient(0, 0, 0, hz);
      gr.addColorStop(0, '#0a1a33');
      gr.addColorStop(0.5, '#22487a');
      gr.addColorStop(0.84, '#b4876f');
      gr.addColorStop(1, '#eebc86');
      c.fillStyle = gr;
      c.fillRect(XL, YT, XR - XL, hz - YT + 1);
      c.fillStyle = 'rgba(255, 255, 255, 0.6)';
      for (let i = 0; i < STARS.length; i++) c.fillRect(W * STARS[i][0], hz * STARS[i][1], 1.3, 1.3);
      gr = c.createRadialGradient(S.sunX, hz, 0, S.sunX, hz, Math.max(W, H) * 0.45);
      gr.addColorStop(0, 'rgba(255, 212, 150, 0.7)');
      gr.addColorStop(0.3, 'rgba(255, 172, 120, 0.22)');
      gr.addColorStop(1, 'rgba(255, 172, 120, 0)');
      c.fillStyle = gr;
      c.fillRect(XL, YT, XR - XL, hz - YT);
      c.fillStyle = 'rgba(255, 238, 205, 0.95)';
      c.beginPath();
      c.arc(S.sunX, hz, Math.max(7, 14 * s), Math.PI, TAU);
      c.fill();
      c.fillStyle = 'rgba(255, 224, 205, 0.1)';
      CLOUDS.forEach(function (k) {
        c.beginPath();
        c.ellipse(W * k[0], hz * k[1], k[2] * s, k[3] * s, 0, 0, TAU);
        c.fill();
      });
      // 왼쪽 육지: 언덕 · 원유 탱크 단지(Tank farm) · 플레어 스택
      c.fillStyle = '#26364f';
      c.beginPath();
      c.moveTo(XL, hz);
      for (let x = XL; x <= S.landR; x += 10) {
        const f = clamp((S.landR - x) / (W * 0.08), 0, 1);
        c.lineTo(x, hz - (4 + 7 * (0.5 + 0.5 * Math.sin(x * 0.012 + 0.7)) + 2.5 * Math.sin(x * 0.041)) * s * f);
      }
      c.lineTo(S.landR, hz);
      c.closePath();
      c.fill();
      S.tanks.forEach(function (t) { if (t.back) paintTank(c, t, s); });
      c.fillStyle = '#1d2a40';
      c.fillRect(XL, hz - 3 * s, S.landR + 6 * s - XL, 3 * s + 1); // 방유제 둑
      S.tanks.forEach(function (t) { if (!t.back) paintTank(c, t, s); });
      c.strokeStyle = 'rgba(150, 165, 185, 0.55)';
      c.lineWidth = Math.max(0.8, 1.2 * s);
      c.beginPath();
      c.moveTo(XL, hz - 4.5 * s);
      c.lineTo(S.landR, hz - 4.5 * s);
      c.stroke();
      c.strokeStyle = '#4a5a72';
      c.lineWidth = Math.max(1, 2 * s);
      c.beginPath();
      c.moveTo(S.flareX, hz - 2 * s);
      c.lineTo(S.flareX, hz - S.flareH);
      c.stroke();
      c.lineWidth = Math.max(0.6, 0.8 * s);
      c.beginPath();
      c.moveTo(S.flareX - 6 * s, hz - 2 * s);
      c.lineTo(S.flareX, hz - S.flareH * 0.55);
      c.lineTo(S.flareX + 6 * s, hz - 2 * s);
      c.stroke();
      // 오른쪽 육지: 낮은 해안 + 터미널 제어동
      c.fillStyle = '#243450';
      c.beginPath();
      c.moveTo(S.shoreL, hz);
      c.lineTo(S.shoreL + 26 * s, hz - 6 * s);
      c.lineTo(XR, hz - 6 * s);
      c.lineTo(XR, hz);
      c.closePath();
      c.fill();
      c.fillStyle = '#1c2940';
      c.fillRect(S.shoreL + 40 * s, hz - 15 * s, 24 * s, 9.5 * s);
      c.fillRect(S.shoreL + 70 * s, hz - 11 * s, 16 * s, 5.5 * s);
      c.fillStyle = 'rgba(255, 214, 140, 0.75)';
      for (let i = 0; i < 4; i++) c.fillRect(S.shoreL + (43 + i * 5.5) * s, hz - 12.5 * s, 2.2 * s, 1.8 * s);
      // 바다
      gr = c.createLinearGradient(0, hz, 0, footY);
      gr.addColorStop(0, '#5a7d9c');
      gr.addColorStop(0.18, '#2f5f88');
      gr.addColorStop(0.6, '#1a456c');
      gr.addColorStop(1, '#0d2b47');
      c.fillStyle = gr;
      c.fillRect(XL, hz, XR - XL, YB - hz);
      gr = c.createRadialGradient(S.sunX, hz, 0, S.sunX, hz, (footY - hz) * 1.1);
      gr.addColorStop(0, 'rgba(255, 200, 140, 0.35)');
      gr.addColorStop(1, 'rgba(255, 200, 140, 0)');
      c.fillStyle = gr;
      c.fillRect(XL, hz, XR - XL, footY - hz);
      gr = c.createLinearGradient(0, hz - 2, 0, hz + 10);
      gr.addColorStop(0, 'rgba(255, 228, 196, 0.35)');
      gr.addColorStop(1, 'rgba(255, 228, 196, 0)');
      c.fillStyle = gr;
      c.fillRect(XL, hz - 2, XR - XL, 12);
      // 부두(제티) · 로딩암 · 접안 중인 탱커 · SPM 부이
      paintJetty(c, S, s, XR);
      paintTanker(c, S, s);
      paintSpm(c, S, s);
      // 맨 앞: 경비 초소 난간
      gr = c.createLinearGradient(0, footY, 0, H);
      gr.addColorStop(0, '#2b3543');
      gr.addColorStop(1, '#131921');
      c.fillStyle = gr;
      c.fillRect(XL, footY, XR - XL, YB - footY);
      c.fillStyle = 'rgba(255, 255, 255, 0.16)';
      c.fillRect(XL, footY, XR - XL, 1.5);
      c.fillStyle = 'rgba(0, 0, 0, 0.28)';
      for (let x = Math.floor(XL / 90) * 90; x < XR; x += 90) c.fillRect(x, footY + 2, 1.5, YB - footY);
    }
    function paintTank(c, t, s) {
      const x = t.x, w = t.w, h = t.h, b = t.base;
      const gr = c.createLinearGradient(x, 0, x + w, 0);
      gr.addColorStop(0, t.back ? '#56667d' : '#76869c');
      gr.addColorStop(0.6, t.back ? '#76869c' : '#a7b4c5');
      gr.addColorStop(1, t.back ? '#8a99ad' : '#d3dbe5'); // 해가 있는 오른쪽이 밝다
      c.fillStyle = gr;
      c.fillRect(x, b - h, w, h);
      c.beginPath();
      c.ellipse(x + w / 2, b - h, w / 2, Math.max(1.2, w * 0.08), 0, Math.PI, TAU);
      c.fill();
      c.strokeStyle = 'rgba(30, 42, 60, 0.35)';
      c.lineWidth = Math.max(0.5, 0.7 * s);
      c.beginPath();
      c.moveTo(x, b - h * 0.36); c.lineTo(x + w, b - h * 0.36);
      c.moveTo(x, b - h * 0.68); c.lineTo(x + w, b - h * 0.68);
      c.stroke();
      c.strokeStyle = 'rgba(30, 42, 60, 0.6)';
      c.beginPath();
      c.moveTo(x + w * 0.12, b);
      c.lineTo(x + w * 0.62, b - h); // 나선 계단
      c.stroke();
    }
    function paintJetty(c, S, s, XR) {
      const j = S.jetty;
      c.fillStyle = '#26334a';
      for (let x = j.x0 + 4 * s; x < S.shoreL + 24 * s; x += 14 * s) c.fillRect(x, j.y - 1, 1.6 * s, 5 * s); // 말뚝
      c.fillStyle = '#334259';
      c.fillRect(j.x0, j.y - 2.5 * s, XR - j.x0, 2.5 * s);                    // 잔교(배관 다리)
      c.fillStyle = '#3c4c66';
      c.fillRect(j.x0, j.y - 4.5 * s, S.arms[2] - j.x0 + 16 * s, 4.5 * s);   // 부두 머리(하역 플랫폼)
      c.strokeStyle = 'rgba(160, 176, 198, 0.6)';
      c.lineWidth = Math.max(0.6, 0.8 * s);
      c.beginPath();
      c.moveTo(j.x0, j.y - 6.5 * s);
      c.lineTo(S.arms[2] + 16 * s, j.y - 6.5 * s); // 난간
      c.stroke();
      // 마린 로딩암: 라이저 → 안쪽 팔(위로) → 바깥 팔(탱커 매니폴드로) + 평형추
      S.arms.forEach(function (ax) {
        c.strokeStyle = '#e8b33f';
        c.lineWidth = Math.max(1, 1.8 * s);
        c.lineCap = 'round';
        c.lineJoin = 'round';
        c.beginPath();
        c.moveTo(ax, j.y - 4.5 * s);
        c.lineTo(ax, j.y - 16 * s);
        c.lineTo(ax - 6 * s, j.y - 26 * s);
        c.lineTo(ax - 10 * s, S.tanker.deckY);
        c.stroke();
        c.lineCap = 'butt';
        c.lineJoin = 'miter';
        c.fillStyle = '#c99a2e';
        c.fillRect(ax + 0.5 * s, j.y - 19 * s, 4 * s, 3 * s);
        const jr = Math.max(0.8, 1.1 * s);
        c.fillStyle = '#f4f1e6'; // 스위블 조인트 (관절식 팔)
        c.beginPath();
        c.arc(ax, j.y - 16 * s, jr, 0, TAU);
        c.moveTo(ax - 6 * s + jr, j.y - 26 * s);
        c.arc(ax - 6 * s, j.y - 26 * s, jr, 0, TAU);
        c.fill();
      });
    }
    function paintTanker(c, S, s) {
      const t = S.tanker;
      const y = t.y, hh = t.hh;
      c.fillStyle = '#3b2d35';
      c.beginPath();
      c.moveTo(t.x0 - 3 * s, y - hh - 1.5 * s); // 뱃머리(왼쪽)
      c.lineTo(t.x1, y - hh);
      c.lineTo(t.x1 - 2 * s, y);
      c.lineTo(t.x0 + 2 * s, y);
      c.closePath();
      c.fill();
      c.fillStyle = '#8f2d2d';
      c.fillRect(t.x0 + 2 * s, y - 1.2 * s, t.x1 - t.x0 - 4 * s, 1.2 * s);   // 흘수선 띠
      c.strokeStyle = 'rgba(190, 200, 214, 0.55)';
      c.lineWidth = Math.max(0.5, 0.7 * s);
      c.beginPath();
      c.moveTo(t.x0 + 4 * s, y - hh - 1.4 * s);
      c.lineTo(t.x1 - 22 * s, y - hh - 1.4 * s); // 갑판 배관
      c.stroke();
      c.fillStyle = '#d9dee5';
      c.fillRect(t.x1 - 20 * s, y - hh - 10 * s, 15 * s, 10 * s);             // 선미 거주구역
      c.fillStyle = '#c9ced6';
      c.fillRect(t.x1 - 18 * s, y - hh - 13 * s, 9 * s, 3 * s);
      c.fillStyle = '#2b2f36';
      c.fillRect(t.x1 - 9 * s, y - hh - 15 * s, 3.5 * s, 5 * s);              // 연돌
      c.fillStyle = 'rgba(255, 214, 140, 0.8)';
      for (let i = 0; i < 3; i++) c.fillRect(t.x1 - (18 - i * 4.5) * s, y - hh - 7 * s, 2 * s, 1.5 * s);
    }
    function paintSpm(c, S, s) {
      const b = S.spm;
      const r = 7 * s;
      c.lineWidth = Math.max(1, 1.6 * s);
      for (let i = 0; i < 8; i++) { // 떠 있는 하역 호스
        c.strokeStyle = i % 2 ? '#f1f3f5' : '#e8590c';
        const xa = b.x - r - i * 7 * s;
        c.beginPath();
        c.moveTo(xa, b.y + Math.sin(i * 0.9) * 1.2 * s);
        c.lineTo(xa - 7 * s, b.y + Math.sin((i + 1) * 0.9) * 1.2 * s);
        c.stroke();
      }
      c.fillStyle = '#e67700';
      c.fillRect(b.x - r, b.y - 3.5 * s, 2 * r, 3.5 * s);
      c.fillStyle = '#ffd43b';
      c.beginPath();
      c.ellipse(b.x, b.y - 3.5 * s, r, 1.8 * s, 0, 0, TAU);
      c.fill();
      c.fillStyle = '#495057';
      c.fillRect(b.x - 2.5 * s, b.y - 7 * s, 5 * s, 3.5 * s); // 회전 테이블
      c.strokeStyle = '#343a40';
      c.lineWidth = Math.max(0.6, 0.9 * s);
      c.beginPath();
      c.moveTo(b.x, b.y - 7 * s);
      c.lineTo(b.x, b.y - 12 * s);
      c.stroke();
      c.strokeStyle = 'rgba(255, 255, 255, 0.35)';
      c.beginPath();
      c.ellipse(b.x, b.y + 0.3 * s, r * 1.25, 1.3 * s, 0, 0, TAU);
      c.stroke();
    }
    // 움직이는 것: 물결 · 윤슬 · 불빛 · 배 · 이펙트 (x0~x1: 보이는 범위)
    function paintDynamic(c, x0, x1, zoomed) {
      const S = scene;
      if (!S) return;
      const t = reduced ? 0 : clock / 1000;
      const seaH = footY - horizonY;
      const xa = Math.floor(x0 / 10) * 10 - 10;
      const xb = x1 + 10;
      for (let i = 0; i < 8; i++) {
        const k = i / 7;
        const y0 = horizonY + 3 + seaH * (0.02 + k * k * 0.95);
        const amp = 0.5 + k * 2.4;
        const len = 26 + k * 80;
        const spd = (i % 2 ? -1 : 1) * (6 + k * 18);
        c.strokeStyle = 'rgba(220, 235, 250, ' + (0.06 + k * 0.08).toFixed(3) + ')';
        c.lineWidth = 0.6 + k * 1.1;
        c.beginPath();
        for (let x = xa; x <= xb; x += 10) {
          const y = y0 + Math.sin(((x + t * spd) / len) * TAU) * amp;
          if (x === xa) c.moveTo(x, y); else c.lineTo(x, y);
        }
        c.stroke();
      }
      c.fillStyle = 'rgba(255, 214, 160, 0.4)';
      for (let j = 0; j < 7; j++) {
        const ww = (8 + j * 5) * S.s * (0.6 + 0.4 * Math.sin(t * 2.2 + j * 1.4));
        const xx = S.sunX - ww / 2 + Math.sin(t * 1.1 + j) * 3;
        if (xx + ww < x0 || xx > x1) continue;
        c.fillRect(xx, horizonY + 4 + j * seaH * 0.045, ww, 1.2);
      }
      // 항공장애등 · 부이등 · 부두등 (깜빡임) + 플레어 불꽃
      const blink = reduced || Math.floor(clock / 800) % 2 === 0;
      if (blink) {
        S.lights.forEach(function (L) {
          c.fillStyle = 'rgba(' + L.c + ', 0.28)';
          c.beginPath();
          c.arc(L.x, L.y, 3.2 * S.s + 1, 0, TAU);
          c.fill();
          c.fillStyle = 'rgba(' + L.c + ', 1)';
          c.beginPath();
          c.arc(L.x, L.y, 1.1 * S.s + 0.4, 0, TAU);
          c.fill();
        });
      }
      const fl = reduced ? 1 : 0.85 + 0.15 * Math.sin(t * 13) + 0.08 * Math.sin(t * 29);
      const fx = S.flareX;
      const fy = horizonY - S.flareH;
      const fh = 9 * S.s * fl;
      const fw = 3.2 * S.s;
      c.fillStyle = 'rgba(255, 170, 80, 0.25)';
      c.beginPath();
      c.arc(fx, fy - fh * 0.4, fh * 0.9, 0, TAU);
      c.fill();
      c.fillStyle = '#ffb347';
      c.beginPath();
      c.moveTo(fx - fw, fy);
      c.quadraticCurveTo(fx - fw * 0.6, fy - fh * 0.6, fx, fy - fh);
      c.quadraticCurveTo(fx + fw * 0.6, fy - fh * 0.6, fx + fw, fy);
      c.closePath();
      c.fill();
      // 배: 먼 항로 → 가까운 항로 (판정 순서와 같다)
      const list = ships.slice().sort(function (a, b) { return a.lane - b.lane || a.seq - b.seq; });
      for (let i = 0; i < list.length; i++) {
        const s = list[i];
        if (s.x + s.hw < x0 || s.x - s.hw > x1) continue;
        paintShip(c, s, zoomed);
      }
      paintWorldFx(c);
    }
    function paintShip(c, s, zoomed) {
      const P = pose(s);
      if (P.alpha <= 0.02) return;
      const sc = LANE_SCALE[s.lane];
      c.save();
      if (s.state === 'sink') { // 수면 아래로 가라앉는 부분은 잘라낸다
        c.beginPath();
        c.rect(P.x - s.hw - 80, P.base - H * 2, s.hw * 2 + 160, H * 2 + 0.8 * sc);
        c.clip();
      }
      c.globalAlpha = P.alpha;
      c.translate(P.x, P.y + P.depth);
      if (P.tilt) c.rotate(P.tilt);
      if (s.state === 'sail') paintWake(c, s, sc);
      c.fillStyle = 'rgba(4, 16, 32, 0.28)';
      c.beginPath();
      c.ellipse(0, 1.2 * sc, s.hullL * 0.5, 1.8 * sc, 0, 0, TAU);
      c.fill();
      c.save();
      c.scale(s.dir * sc, sc); // 뱃머리가 진행 방향을 향하게 (글자는 뒤집지 않음)
      paintHull(c, s.type);
      c.restore();
      paintBoard(c, s, sc, zoomed, P.alpha);
      c.restore();
    }
    function paintWake(c, s, sc) {
      const L = s.hullL;
      const d = s.dir;
      const sx = -d * L * 0.5;
      const bx = d * L * 0.5;
      c.strokeStyle = 'rgba(235, 245, 255, 0.55)';
      c.lineWidth = Math.max(0.7, 0.9 * sc);
      c.beginPath();
      c.moveTo(sx, 0.6 * sc);
      c.lineTo(sx - d * 16 * sc, 2.4 * sc);
      c.moveTo(sx, -0.2 * sc);
      c.lineTo(sx - d * 13 * sc, -1.2 * sc);
      c.moveTo(bx - d * 2 * sc, 0.8 * sc);
      c.quadraticCurveTo(bx + d * 1.5 * sc, -0.4 * sc, bx + d * 2.5 * sc, 1.2 * sc);
      c.stroke();
      if (!reduced) {
        const k = (clock / 260 + s.ph) % 1;
        c.fillStyle = 'rgba(255, 255, 255, ' + (0.5 * (1 - k)).toFixed(3) + ')';
        c.fillRect(sx - d * (4 + 10 * k) * sc - 0.8, (0.6 + 1.2 * k) * sc, 1.6 * sc, 0.9 * sc);
      }
    }
    // 선체 (뱃머리 +x, 수면 y=0, 위쪽이 -y)
    function paintHull(c, type) {
      if (type === 'tug') {
        c.fillStyle = '#b5322a';
        c.beginPath();
        c.moveTo(-20, -6.5); c.lineTo(14, -6.5); c.quadraticCurveTo(19, -6.8, 21, -9);
        c.lineTo(18, 0.6); c.lineTo(-17, 0.6); c.quadraticCurveTo(-20.5, 0, -20, -6.5);
        c.closePath(); c.fill();
        c.fillStyle = '#1f252c';
        c.fillRect(-20, -7.4, 35, 1.6);
        c.beginPath(); c.arc(19.4, -5.2, 2.3, 0, TAU); c.fill();
        c.fillStyle = '#eef2f6';
        c.fillRect(-11, -12, 17, 5);
        c.fillRect(-6, -17, 10, 5);
        c.fillStyle = '#1d3557';
        c.fillRect(-4.8, -15.8, 2, 1.8); c.fillRect(-1.8, -15.8, 2, 1.8); c.fillRect(1.2, -15.8, 2, 1.8);
        c.fillStyle = '#1f252c';
        c.fillRect(-10.5, -16, 3, 4);
        c.fillStyle = '#f2c94c';
        c.fillRect(-10.5, -14.8, 3, 1.1);
      } else if (type === 'launch') {
        c.fillStyle = '#f1f3f5';
        c.beginPath();
        c.moveTo(-16, -4.5); c.lineTo(11, -4.5); c.quadraticCurveTo(15, -4.8, 17, -6.5);
        c.lineTo(13, 0.6); c.lineTo(-14, 0.6); c.quadraticCurveTo(-16.5, 0, -16, -4.5);
        c.closePath(); c.fill();
        c.fillStyle = '#1971c2';
        c.fillRect(-15.5, -2.6, 28, 1.3);
        c.fillStyle = '#dee2e6';
        c.fillRect(-9, -9, 12, 4.5);
        c.fillStyle = '#334e68';
        c.beginPath(); c.moveTo(3, -9); c.lineTo(7, -4.5); c.lineTo(3, -4.5); c.closePath(); c.fill();
        c.fillRect(-7.5, -8, 2.5, 1.8); c.fillRect(-4, -8, 2.5, 1.8);
        c.fillStyle = '#868e96';
        c.fillRect(-9.5, -11, 13, 2);
      } else if (type === 'drone') {
        c.fillStyle = '#6f7c89';
        c.beginPath();
        c.moveTo(-18, -4); c.lineTo(12, -4); c.lineTo(18.5, -2.5); c.lineTo(15, 0.6); c.lineTo(-17, 0.6);
        c.closePath(); c.fill();
        c.fillStyle = '#56616d';
        c.fillRect(-10, -6.5, 16, 2.5);
        c.fillStyle = '#f08c00';
        c.fillRect(-17.5, -2.2, 30, 1.1);
        c.fillStyle = '#e9ecef';
        c.beginPath(); c.arc(-3, -6.5, 2.6, Math.PI, TAU); c.fill(); // 센서 돔
        c.strokeStyle = '#2b3442';
        c.lineWidth = 0.6;
        c.beginPath(); c.moveTo(4, -6.5); c.lineTo(4, -10); c.moveTo(-8, -6.5); c.lineTo(-8, -9); c.stroke();
      } else if (type === 'pilot') {
        c.fillStyle = '#212529';
        c.beginPath();
        c.moveTo(-18, -5.5); c.lineTo(13, -5.5); c.quadraticCurveTo(17, -6, 19, -8);
        c.lineTo(15, 0.6); c.lineTo(-16, 0.6); c.quadraticCurveTo(-18.5, 0, -18, -5.5);
        c.closePath(); c.fill();
        c.fillStyle = '#e8590c';
        c.fillRect(-18, -5.5, 33, 2.6);
        c.fillStyle = '#f8f9fa';
        c.fillRect(-8, -11, 13, 5.5);
        c.fillStyle = '#1d3557';
        c.fillRect(-6.5, -9.8, 2.2, 1.8); c.fillRect(-3.4, -9.8, 2.2, 1.8); c.fillRect(-0.3, -9.8, 2.2, 1.8); c.fillRect(2.6, -9.8, 1.8, 1.8);
        c.fillStyle = '#ced4da';
        c.fillRect(-7, -14, 10, 3);
      } else { // oilrec: 방제선 (오일펜스 릴)
        c.fillStyle = '#2f6f4f';
        c.beginPath();
        c.moveTo(-21, -6); c.lineTo(15, -6); c.quadraticCurveTo(20, -6.4, 22, -8.5);
        c.lineTo(18, 0.6); c.lineTo(-19, 0.6); c.quadraticCurveTo(-21.5, 0, -21, -6);
        c.closePath(); c.fill();
        c.fillStyle = '#f1f3f5';
        c.fillRect(2, -12, 12, 6);
        c.fillRect(5, -15, 7, 3);
        c.fillStyle = '#1d3557';
        c.fillRect(6, -10.6, 2, 1.8); c.fillRect(9, -10.6, 2, 1.8);
        c.fillStyle = '#f59f00';
        c.beginPath(); c.arc(-11, -8.5, 3, 0, TAU); c.fill();
        c.fillStyle = '#c77700';
        c.beginPath(); c.arc(-11, -8.5, 1.2, 0, TAU); c.fill();
        c.fillStyle = '#adb5bd';
        c.fillRect(-17, -7.5, 3, 1.5);
      }
    }
    // 전광판(LED) 또는 깃발 + 진술. 글자는 월드 px(7~9px) — 확대 시야에서는 배율만큼 크게 다시 그려져 선명하다
    function paintBoard(c, s, sc, zoomed, alpha) {
      const bw = s.bw, bh = s.bh;
      const bot = -s.mastH;
      const top = bot - bh;
      const left = -bw / 2;
      const flag = s.board === 'flag';
      c.strokeStyle = '#2b3442';
      c.lineWidth = Math.max(0.8, 1.2 * sc);
      c.beginPath();
      c.moveTo(0, -s.footH + 0.5);
      c.lineTo(0, flag ? top - 1.5 * sc : bot);
      c.stroke();
      if (flag) {
        c.beginPath();
        c.moveTo(left - 2 * sc, top - 1 * sc);
        c.lineTo(left + bw + 2 * sc, top - 1 * sc); // 가로 활대
        c.stroke();
        const t = clock / 1000;
        const wv = reduced ? 0 : 0.8 * sc;
        c.beginPath();
        c.moveTo(left, top);
        c.lineTo(left + bw, top);
        c.lineTo(left + bw, top + bh + Math.sin(t * 3 + s.ph) * wv);
        c.quadraticCurveTo(left + bw * 0.75, top + bh + Math.sin(t * 3 + s.ph + 1.6) * wv * 2, left + bw * 0.5, top + bh);
        c.quadraticCurveTo(left + bw * 0.25, top + bh - Math.sin(t * 3 + s.ph + 0.8) * wv * 2, left, top + bh + Math.sin(t * 3 + s.ph + 2.4) * wv);
        c.closePath();
        c.fillStyle = '#f7f0dc';
        c.fill();
        c.lineWidth = Math.max(0.6, 0.7 * sc);
        c.strokeStyle = 'rgba(40, 52, 70, 0.6)';
        c.stroke();
      } else {
        rrect(c, left, top, bw, bh, 1.6 * sc);
        c.fillStyle = '#0e1826';
        c.fill();
        c.lineWidth = Math.max(0.7, 0.9 * sc);
        c.strokeStyle = '#6c7a8d';
        c.stroke();
        c.fillStyle = '#3b4656';
        c.fillRect(-3 * sc, bot - 0.5, 6 * sc, 1.2 * sc); // 받침
      }
      c.font = fontOf(s.fs, 700);
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillStyle = flag ? '#13253d' : '#ffd166';
      c.globalAlpha = alpha * (zoomed ? 1 : 0.85);
      for (let i = 0; i < s.lines.length; i++) c.fillText(s.lines[i], 0, top + s.pad + s.lh * (i + 0.5));
      c.globalAlpha = alpha;
    }
    function paintPlume(c, f) { // 물기둥
      const k = 1 - f.life / f.max;
      const rise = Math.min(1, k / 0.35);
      const fall = k > 0.45 ? (k - 0.45) / 0.55 : 0;
      const h = Math.max(1, f.h * (reduced ? 1 : 0.25 + 0.75 * Math.sin(rise * Math.PI / 2)) * (1 - 0.6 * fall));
      const w = f.w * (1 + 1.4 * k);
      c.globalAlpha = clamp(1 - fall, 0, 1) * 0.9;
      const gr = c.createLinearGradient(0, f.y - h, 0, f.y);
      gr.addColorStop(0, 'rgba(255, 255, 255, 0.2)');
      gr.addColorStop(0.3, 'rgba(240, 248, 255, 0.95)');
      gr.addColorStop(1, 'rgba(200, 225, 240, 0.9)');
      c.fillStyle = gr;
      c.beginPath();
      c.moveTo(f.x - w, f.y);
      c.quadraticCurveTo(f.x - w * 0.55, f.y - h * 0.6, f.x - w * 0.3, f.y - h);
      c.quadraticCurveTo(f.x, f.y - h * 1.12, f.x + w * 0.3, f.y - h);
      c.quadraticCurveTo(f.x + w * 0.55, f.y - h * 0.6, f.x + w, f.y);
      c.closePath();
      c.fill();
      c.globalAlpha = 1;
    }
    function paintWorldFx(c) {
      for (let i = 0; i < plumes.length; i++) paintPlume(c, plumes[i]);
      for (let i = 0; i < rings.length; i++) {
        const o = rings[i];
        const k = 1 - o.life / o.max;
        const r = o.r0 + (o.r1 - o.r0) * k;
        c.globalAlpha = clamp(1 - k, 0, 1);
        c.strokeStyle = o.c;
        c.lineWidth = o.w;
        c.beginPath();
        if (o.flat) c.ellipse(o.x, o.y, r, Math.max(0.5, r * 0.28), 0, 0, TAU);
        else c.arc(o.x, o.y, r, 0, TAU);
        c.stroke();
      }
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        const a = clamp(p.life / p.max, 0, 1);
        if (p.k === 'smoke') {
          c.globalAlpha = 1;
          c.fillStyle = 'rgba(' + p.c + ', ' + (0.42 * a).toFixed(3) + ')';
          c.beginPath();
          c.arc(p.x, p.y, Math.max(0.5, p.r), 0, TAU);
          c.fill();
        } else {
          c.globalAlpha = a;
          c.fillStyle = p.c;
          c.fillRect(p.x - p.r / 2, p.y - p.r / 2, p.r, p.r);
        }
      }
      c.globalAlpha = 1;
    }
    // ---- 화면 좌표 레이어 ----
    function toScreen(x, y, zoomed) {
      if (!zoomed) return { x: x, y: y };
      const v = viewCenter();
      const sc = scopeCenter();
      return { x: sc.x + (x - v.x) * zoomZ, y: sc.y + (y - v.y) * zoomZ };
    }
    function paintTexts(c, zoomed) {
      if (!texts.length) return;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      for (let i = 0; i < texts.length; i++) {
        const o = texts[i];
        const k = 1 - o.life / o.max;
        const p = toScreen(o.x, o.y, zoomed);
        const x = clamp(p.x, 48, Math.max(48, W - 48));
        const y = clamp(p.y - (reduced ? 0 : 24 * k), 14, Math.max(14, H - 12));
        c.globalAlpha = clamp(o.life / o.max * 1.8, 0, 1);
        c.font = fontOf(o.size, 900);
        c.lineWidth = 3;
        c.strokeStyle = 'rgba(7, 18, 33, 0.7)';
        c.strokeText(o.text, x, y);
        c.fillStyle = o.c;
        c.fillText(o.text, x, y);
      }
      c.globalAlpha = 1;
    }
    function paintEdges(c) {
      for (let i = 0; i < edges.length; i++) {
        const e = edges[i];
        const k = clamp(e.life / e.max, 0, 1);
        const w = Math.min(90, W * 0.12);
        const x0 = e.side > 0 ? W : 0;
        const gr = c.createLinearGradient(x0, 0, x0 - e.side * w, 0);
        gr.addColorStop(0, 'rgba(' + e.c + ', ' + (0.55 * k).toFixed(3) + ')');
        gr.addColorStop(1, 'rgba(' + e.c + ', 0)');
        c.fillStyle = gr;
        c.fillRect(e.side > 0 ? W - w : 0, 0, w, H);
      }
    }
    function paintCrosshair(c) { // 기본 시야의 조준선
      const kick = recoilT > 0 ? recoilT / RECOIL_MS : 0;
      const x = aim.x;
      const y = aim.y - kick * 5;
      const onShip = phase === 'play' && !!shipAt(aim.x, aim.y);
      const col = onShip ? '#ffd43b' : '#ffffff';
      c.lineCap = 'round';
      for (let pass = 0; pass < 2; pass++) {
        c.strokeStyle = pass ? col : 'rgba(5, 12, 22, 0.75)';
        c.lineWidth = pass ? 1.5 : 3.5;
        c.beginPath();
        c.arc(x, y, 11, 0, TAU);
        c.moveTo(x - 18, y); c.lineTo(x - 6, y);
        c.moveTo(x + 6, y); c.lineTo(x + 18, y);
        c.moveTo(x, y - 18); c.lineTo(x, y - 6);
        c.moveTo(x, y + 6); c.lineTo(x, y + 18);
        c.stroke();
      }
      c.lineCap = 'butt';
      c.fillStyle = col;
      c.beginPath();
      c.arc(x, y, 1.6, 0, TAU);
      c.fill();
      if (clock < reloadUntil) {
        c.strokeStyle = 'rgba(255, 146, 43, 0.95)';
        c.lineWidth = 2.5;
        c.beginPath();
        c.arc(x, y, 15, -Math.PI / 2, -Math.PI / 2 + TAU * reloadRatio());
        c.stroke();
      }
      if (muzzleT > 0) {
        c.fillStyle = 'rgba(255, 244, 214, ' + (0.5 * muzzleT / MUZZLE_MS).toFixed(3) + ')';
        c.beginPath();
        c.arc(x, y, 8, 0, TAU);
        c.fill();
      }
    }
    // 원형 스코프: 바깥은 어둡게, 안은 확대 배율로 장면을 다시 그린다 + 레티클
    function paintScope(c) {
      const R = scopeR;
      const Z = zoomZ;
      const sc = scopeCenter();
      const v = viewCenter();
      c.save();
      c.beginPath();
      c.rect(0, 0, W, H);
      c.arc(sc.x, sc.y, R, 0, TAU, true); // 반대 방향 원 = 구멍
      c.fillStyle = 'rgba(2, 6, 12, 0.9)';
      c.fill();
      c.restore();
      c.save();
      c.beginPath();
      c.arc(sc.x, sc.y, R, 0, TAU);
      c.clip();
      c.setTransform(dpr * Z, 0, 0, dpr * Z, dpr * (sc.x - v.x * Z), dpr * (sc.y - v.y * Z));
      paintStatic(c);
      const half = R / Z + 8;
      paintDynamic(c, v.x - half, v.x + half, true);
      c.restore();
      const gr = c.createRadialGradient(sc.x, sc.y, R * 0.62, sc.x, sc.y, R);
      gr.addColorStop(0, 'rgba(0, 0, 0, 0)');
      gr.addColorStop(1, 'rgba(0, 0, 0, 0.55)');
      c.fillStyle = gr;
      c.beginPath();
      c.arc(sc.x, sc.y, R, 0, TAU);
      c.fill();
      paintReticle(c, sc.x, sc.y, R);
      c.lineWidth = Math.max(5, R * 0.05);
      c.strokeStyle = '#03070c';
      c.beginPath();
      c.arc(sc.x, sc.y, R, 0, TAU);
      c.stroke();
      c.lineWidth = 1.2;
      c.strokeStyle = 'rgba(160, 190, 215, 0.35)';
      c.beginPath();
      c.arc(sc.x, sc.y, R - Math.max(5, R * 0.05) / 2 - 1, 0, TAU);
      c.stroke();
      c.strokeStyle = 'rgba(255, 255, 255, 0.1)';
      c.lineWidth = R * 0.05;
      c.beginPath();
      c.arc(sc.x, sc.y, R * 0.86, Math.PI * 1.08, Math.PI * 1.42); // 렌즈 반사광
      c.stroke();
      if (muzzleT > 0) {
        c.fillStyle = 'rgba(255, 244, 214, ' + (0.22 * muzzleT / MUZZLE_MS).toFixed(3) + ')';
        c.beginPath();
        c.arc(sc.x, sc.y, R, 0, TAU);
        c.fill();
      }
    }
    function paintReticle(c, x, y, R) {
      const inner = R * 0.62; // 굵은 기둥은 바깥쪽만 — 가운데(진술판을 읽는 곳)는 가는 선뿐
      const gap = 5;
      for (let pass = 0; pass < 2; pass++) { // 밝은 테두리 → 검은 선 (어두운 바다에서도 보이게)
        c.strokeStyle = pass ? 'rgba(6, 10, 16, 0.92)' : 'rgba(255, 255, 255, 0.22)';
        c.lineWidth = pass ? 3.2 : 5.2;
        c.beginPath();
        c.moveTo(x - R, y); c.lineTo(x - inner, y);
        c.moveTo(x + inner, y); c.lineTo(x + R, y);
        c.moveTo(x, y + inner); c.lineTo(x, y + R);
        c.moveTo(x, y - R); c.lineTo(x, y - inner);
        c.stroke();
        // 가운데 가는 선은 반투명 — 진술 글자를 가리지 않게
        c.strokeStyle = pass ? 'rgba(6, 10, 16, 0.55)' : 'rgba(255, 255, 255, 0.12)';
        c.lineWidth = pass ? 1.1 : 2.6;
        c.beginPath();
        c.moveTo(x - inner, y); c.lineTo(x - gap, y);
        c.moveTo(x + gap, y); c.lineTo(x + inner, y);
        c.moveTo(x, y - inner); c.lineTo(x, y - gap);
        c.moveTo(x, y + gap); c.lineTo(x, y + inner);
        c.stroke();
      }
      c.fillStyle = 'rgba(6, 10, 16, 0.9)';
      const step = inner / 4;
      for (let i = 1; i <= 3; i++) {
        [[x - step * i, y], [x + step * i, y], [x, y - step * i], [x, y + step * i]].forEach(function (d) {
          c.beginPath();
          c.arc(d[0], d[1], 1.7, 0, TAU);
          c.fill();
        });
      }
      const pt = shotPoint();
      c.fillStyle = (phase === 'play' && shipAt(pt.x, pt.y)) ? '#ffd43b' : '#ff4d4f';
      c.beginPath();
      c.arc(x, y, 1.9, 0, TAU);
      c.fill();
      if (clock < reloadUntil) {
        c.strokeStyle = 'rgba(255, 146, 43, 0.95)';
        c.lineWidth = 2.5;
        c.beginPath();
        c.arc(x, y, 16, -Math.PI / 2, -Math.PI / 2 + TAU * reloadRatio());
        c.stroke();
        c.font = fontOf(11, 800);
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillStyle = 'rgba(255, 190, 120, 0.95)';
        c.fillText('재장전', x, y + R * 0.52);
      }
    }
    function paintFreeze(c) { // 오인 사격: 사격 중지 (게임 정지)
      const k = clamp(freezeLeft / Math.max(1, cfg.freezeMs), 0, 1);
      c.fillStyle = 'rgba(40, 6, 12, 0.32)';
      c.fillRect(0, 0, W, H);
      const msg = '⚠ 아군 오인 사격 — 사격 중지';
      const y = H * 0.2;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.font = fontOf(clamp(W * 0.045, 15, 24), 900);
      c.lineWidth = 4;
      c.strokeStyle = 'rgba(20, 4, 8, 0.75)';
      c.strokeText(msg, W / 2, y);
      c.fillStyle = '#ffe3e3';
      c.fillText(msg, W / 2, y);
      const bw = Math.min(220, W * 0.5);
      c.fillStyle = 'rgba(255, 255, 255, 0.25)';
      c.fillRect(W / 2 - bw / 2, y + 18, bw, 4);
      c.fillStyle = '#ffa8a8';
      c.fillRect(W / 2 - bw / 2, y + 18, bw * k, 4);
    }
    function paintEnd(c) {
      const cleared = endReason === 'cleared';
      c.fillStyle = 'rgba(7, 18, 33, 0.6)';
      c.fillRect(0, H * 0.34, W, H * 0.28);
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillStyle = '#ffffff';
      c.font = fontOf(clamp(W * 0.055, 19, 30), 900);
      c.fillText(cleared ? '🎉 항만 경비 완료!' : '⚓ 경비 종료', W / 2, H * 0.44);
      c.fillStyle = '#c9e7f0';
      c.font = fontOf(clamp(W * 0.034, 13, 17), 700);
      c.fillText('점수 ' + fmtInt(score) + ' · 맞은 판단 ' + correct + '/' + attempts, W / 2, H * 0.535);
    }
    function render() {
      if (destroyed || !g) return;
      try {
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.globalAlpha = 1;
        if (bg) g.drawImage(bg, 0, 0, W, H);
        else paintStatic(g);
        if (paused) { // 일시정지: 배·진술을 그리지 않는다
          g.fillStyle = 'rgba(7, 18, 33, 0.85)';
          g.fillRect(0, 0, W, H);
          return;
        }
        paintDynamic(g, -4, W + 4, false);
        paintEdges(g);
        const zoomed = isZoomed() && (phase === 'countdown' || phase === 'play');
        if (zoomed) paintScope(g);
        else if (phase !== 'over' && phase !== 'quit') paintCrosshair(g);
        paintTexts(g, zoomed);
        if (flash) {
          g.fillStyle = 'rgba(' + flash.c + ', ' + (0.3 * flash.life / flash.max).toFixed(3) + ')';
          g.fillRect(0, 0, W, H);
        }
        if (phase === 'play' && freezeLeft > 0) paintFreeze(g);
        if (phase === 'ending' || phase === 'over') paintEnd(g);
      } catch (e) { // 그리기 실패는 게임 진행에 영향 없음 (처음 한 번만 알림)
        if (!drawFailed) { drawFailed = true; if (window.console) console.error('[스나이퍼해운] 그리기 오류', e); }
      }
    }

    // =========================================================================
    // 입력 — 마우스(우클릭 줌·좌클릭 사격) · 터치(드래그 조준) · 키보드
    // =========================================================================
    function canvasRect() {
      try { return canvas.getBoundingClientRect(); } catch (e) { return null; }
    }
    function aimAt(clientX, clientY) {
      const r = canvasRect();
      const rw = r && r.width > 0 ? r.width : W;
      const rh = r && r.height > 0 ? r.height : H;
      const x = (clientX - (r ? r.left : 0)) * (W / rw);
      const y = (clientY - (r ? r.top : 0)) * (H / rh);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      aim.x = clamp(x, 0, W);
      aim.y = clamp(y, 0, H);
    }
    function nearCanvas(clientX, clientY) {
      const r = canvasRect();
      if (!r || !(r.width > 0)) return true;
      const m = 48;
      return clientX >= r.left - m && clientX <= r.right + m && clientY >= r.top - m && clientY <= r.bottom + m;
    }
    function bit(button) { return button === 0 ? 1 : (button === 2 ? 2 : (button === 1 ? 4 : 0)); }
    // 버튼 상태 변화 처리. allowPress: 새로 눌린 버튼을 줌·사격으로 볼지 (캔버스 위에서 누른 경우만)
    function applyButtons(next, allowPress) {
      const prev = mouseButtons;
      mouseButtons = next;
      if ((prev & 2) && !(next & 2) && zoomHeld) { rmbUpAt = perfNow(); setZoomHeld(false); }
      if (!allowPress) return;
      if ((next & 2) && !(prev & 2) && aimable()) setZoomHeld(true);
      if ((next & 1) && !(prev & 1)) fire();
    }
    function onCanvasDown(e) { // pointerdown / mousedown
      if (destroyed) return;
      unlockAudio();
      if (e.pointerType === 'touch') {
        if (e.cancelable) e.preventDefault();
        touchBegin(e.pointerId, e.clientX, e.clientY);
        try { if (typeof canvas.setPointerCapture === 'function') canvas.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
        return;
      }
      if (bit(e.button) === 0) return;
      if (e.cancelable) e.preventDefault();
      focusQuiet(root);
      if (aimable()) aimAt(e.clientX, e.clientY);
      const base = (e.pointerType && typeof e.buttons === 'number') ? e.buttons : mouseButtons;
      applyButtons(base | bit(e.button), true);
    }
    function onWinMove(e) { // pointermove / mousemove (창 전체 — 캔버스 밖에서 버튼을 떼도 놓치지 않게)
      if (destroyed) return;
      if (e.pointerType === 'touch') {
        if (touch && e.pointerId === touch.id) { if (e.cancelable) e.preventDefault(); touchDrag(e.clientX, e.clientY); }
        return;
      }
      const over = nearCanvas(e.clientX, e.clientY);
      if (aimable() && (zoomHeld || over)) aimAt(e.clientX, e.clientY);
      if (typeof e.buttons === 'number' && e.buttons !== mouseButtons) {
        // 다른 버튼을 누른 채 버튼을 더 누르면(우클릭 줌 + 좌클릭 사격) pointerdown 대신 pointermove 가 온다
        const chord = !!e.pointerType && typeof e.button === 'number' && e.button >= 0;
        applyButtons(e.buttons, chord && (zoomHeld || e.target === canvas));
      }
    }
    function onWinUp(e) { // pointerup / mouseup
      if (destroyed) return;
      if (e.pointerType === 'touch') {
        if (touch && e.pointerId === touch.id) touchEnd(e.clientX, e.clientY);
        return;
      }
      const after = (e.pointerType && typeof e.buttons === 'number') ? e.buttons : mouseButtons;
      applyButtons(after & ~bit(e.button), false);
    }
    function onWinCancel(e) { if (touch && e.pointerId === touch.id) touch = null; }
    function onCanvasMenu(e) { e.preventDefault(); }
    function onWinMenu(e) { // 캔버스에서 시작한 우클릭을 밖에서 뗀 경우의 메뉴만 막는다
      if (zoomHeld || perfNow() - rmbUpAt < 400) e.preventDefault();
    }
    // 터치: 첫 손가락으로 드래그 조준 (줌 중엔 감도를 낮춘다) · 짧게 탭하면 그 자리로 조준
    function markTouch() {
      if (root.classList.contains('is-touch')) return;
      root.classList.add('is-touch');
      onResize();
    }
    function touchBegin(idv, x, y) {
      markTouch();
      if (touch) return;
      touch = { id: idv, x: x, y: y, t: perfNow(), moved: 0 };
    }
    function touchDrag(x, y) {
      const dx = x - touch.x;
      const dy = y - touch.y;
      touch.x = x;
      touch.y = y;
      touch.moved += Math.abs(dx) + Math.abs(dy);
      if (!aimable()) return;
      const r = canvasRect();
      const sx = r && r.width > 0 ? W / r.width : 1;
      const sy = r && r.height > 0 ? H / r.height : 1;
      const k = isZoomed() ? TOUCH_ZOOM_GAIN / zoomZ : 1;
      aim.x = clamp(aim.x + dx * sx * k, 0, W);
      aim.y = clamp(aim.y + dy * sy * k, 0, H);
    }
    function touchEnd(x, y) {
      const t = touch;
      touch = null;
      if (t && t.moved < 10 && perfNow() - t.t < 350 && !isZoomed() && aimable()) aimAt(x, y);
    }
    function onTouchStartEv(e) {
      if (destroyed) return;
      unlockAudio();
      if (e.cancelable) e.preventDefault(); // 뒤따르는 mousedown 중복 방지
      const t = e.changedTouches && e.changedTouches[0];
      if (t) touchBegin(t.identifier, t.clientX, t.clientY);
    }
    function onTouchMoveEv(e) {
      if (destroyed || !touch) return;
      if (e.cancelable) e.preventDefault();
      const list = e.changedTouches || [];
      for (let i = 0; i < list.length; i++) if (list[i].identifier === touch.id) touchDrag(list[i].clientX, list[i].clientY);
    }
    function onTouchEndEv(e) {
      if (destroyed || !touch) return;
      const list = e.changedTouches || [];
      for (let i = 0; i < list.length; i++) {
        if (touch && list[i].identifier === touch.id) {
          if (e.type === 'touchcancel') touch = null;
          else touchEnd(list[i].clientX, list[i].clientY);
        }
      }
    }
    // 키보드
    function aimKey(e) {
      const c = e.code || '';
      const k = e.key || '';
      if (c === 'ArrowUp' || c === 'KeyW' || k === 'ArrowUp' || k === 'Up' || k === 'w' || k === 'W' || k === 'ㅈ') return 'up';
      if (c === 'ArrowDown' || c === 'KeyS' || k === 'ArrowDown' || k === 'Down' || k === 's' || k === 'S' || k === 'ㄴ') return 'down';
      if (c === 'ArrowLeft' || c === 'KeyA' || k === 'ArrowLeft' || k === 'Left' || k === 'a' || k === 'A' || k === 'ㅁ') return 'left';
      if (c === 'ArrowRight' || c === 'KeyD' || k === 'ArrowRight' || k === 'Right' || k === 'd' || k === 'D' || k === 'ㅇ') return 'right';
      return '';
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
      const k = e.key || '';
      const c = e.code || '';
      if (k === 'Escape' || k === 'Esc' || k === 'p' || k === 'P' || k === 'ㅔ' || c === 'KeyP') {
        if (phase !== 'countdown' && phase !== 'play') return;
        e.preventDefault();
        unlockAudio();
        if (paused) resume(); else pause(true);
        return;
      }
      if (paused) {
        if (k === 'Tab') { // 오버레이 안에서 포커스 순환
          e.preventDefault();
          focusQuiet(document.activeElement === resumeBtn ? quitBtn : resumeBtn);
        }
        return;
      }
      if (phase !== 'countdown' && phase !== 'play') return;
      const onButton = !!(e.target && e.target.tagName === 'BUTTON');
      if (c === 'KeyZ' || k === 'z' || k === 'Z' || k === 'ㅋ' || k === 'Shift' || c === 'ShiftLeft' || c === 'ShiftRight') {
        e.preventDefault();
        unlockAudio();
        if (!e.repeat) toggleZoom();
        return;
      }
      if (k === ' ' || k === 'Spacebar' || c === 'Space' || k === 'Enter' || c === 'Enter' || c === 'NumpadEnter') {
        if (onButton) return; // 포커스된 버튼은 자기 동작(click)으로
        e.preventDefault();
        unlockAudio();
        if (!e.repeat) fire();
        return;
      }
      const d = aimKey(e);
      if (d) {
        e.preventDefault();
        unlockAudio();
        keys[d] = true;
      }
    }
    function onKeyUp(e) {
      const d = aimKey(e);
      if (d) keys[d] = false;
    }
    function autoPause() { pause(false); }
    function onVisibility() { if (document.hidden) autoPause(); }
    function onFocusIn(e) {
      if (phase !== 'play') return; // 카운트다운 중 앱이 다른 요소에 포커스를 줘도 멈추지 않는다
      const t = e.target;
      if (!t || t.nodeType !== 1 || t === document.body || root.contains(t) || (typeof t.contains === 'function' && t.contains(root))) return;
      autoPause(); // 플레이 중 게임 밖으로 포커스가 나가면(헤더 링크·확인 모달 등) 일시정지
    }
    function onResize() {
      if (destroyed) return;
      if (layout() && !running()) render(); // 멈춘 상태에서도 화면을 다시 그린다
    }

    if (typeof window.PointerEvent === 'function') {
      on(canvas, 'pointerdown', onCanvasDown);
      on(window, 'pointermove', onWinMove);
      on(window, 'pointerup', onWinUp);
      on(window, 'pointercancel', onWinCancel);
    } else {
      on(canvas, 'mousedown', onCanvasDown);
      on(window, 'mousemove', onWinMove);
      on(window, 'mouseup', onWinUp);
      on(canvas, 'touchstart', onTouchStartEv, { passive: false });
      on(canvas, 'touchmove', onTouchMoveEv, { passive: false });
      on(canvas, 'touchend', onTouchEndEv);
      on(canvas, 'touchcancel', onTouchEndEv);
    }
    on(canvas, 'contextmenu', onCanvasMenu);
    on(window, 'contextmenu', onWinMenu);
    on(document, 'keydown', onKeyDown);
    on(document, 'keyup', onKeyUp);
    on(document, 'visibilitychange', onVisibility);
    on(document, 'focusin', onFocusIn);
    on(window, 'blur', autoPause);
    on(window, 'resize', onResize);
    if (typeof window.ResizeObserver === 'function') {
      try { ro = new window.ResizeObserver(onResize); ro.observe(stage); } catch (e) { ro = null; }
    }
    if (styleLink) on(styleLink, 'load', onResize); // 스타일이 늦게 적용되면 캔버스 크기를 다시 맞춘다

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
      parts.length = 0; plumes.length = 0; rings.length = 0; texts.length = 0; edges.length = 0;
      ships.length = 0;
      bg = null;
      while (container.firstChild) container.removeChild(container.firstChild);
    }

    // ---- 시작: 3·2·1 카운트다운 ----
    layout();
    idleBanner();
    updateHud();
    updateZoomUi();
    setCountdown('3');
    cdLabel = '3';
    unlockAudio();
    sound('tick');
    render();
    focusQuiet(root);
    lastNow = perfNow();
    requestFrame();

    return {
      destroy: destroy,
      pause: function () { pause(false); },
      resume: function () { resume(); }
    };
  }

  // 게임 모듈이 스스로 스타일시트를 보장한다 (index.html 에 링크가 없을 때만 추가)
  // 새로 붙였으면 그 link 를 돌려준다 (불러온 뒤 크기를 다시 잰다)
  function ensureStyles() {
    try {
      if (!document.head || document.querySelector('link[href*="sniper.css"]')) return null;
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'css/sniper.css';
      document.head.appendChild(link);
      return link;
    } catch (e) { return null; }
  }

  PG.sniper = { key: 'sniper', title: '스나이퍼해운', mount: mount };
})();
