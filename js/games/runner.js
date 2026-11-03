/*!
 * 🚢 항로 질주 — O/X 러너 (Port Quiz 게임 모듈)
 * 계약: window.PortGames.runner = { key, title, mount(container, ctx) → { destroy } }
 * IIFE + ES2019, 외부 라이브러리·이미지·웹폰트 없음. 전역은 window.PortGames 만 사용.
 * 모든 시간은 performance.now() 기반 게임 시계(일시정지 시간 제외)로 잰다 — setTimeout 없음.
 */
(function () {
  'use strict';

  const PG = window.PortGames = window.PortGames || {};

  const LEVEL_SHORT = { 1: '하', 2: '중', 3: '상' };
  const LEVEL_FULL = { 1: '하 · 빈출', 2: '중 · 실무', 3: '상 · 심화' };
  const LEVEL_FACTOR = { 1: 1.0, 2: 0.9, 3: 0.8 };
  const COUNT_MS = 3000;    // 3·2·1
  const GO_MS = 450;        // "GO!"
  const CORRECT_MS = 1200;  // 정답 확인(정답·해설) 표시 — 게이트는 통과 연출
  const FEEDBACK_MS = 1800; // 오답 해설 표시(게임 정지)
  const RUSH_MS = 300;      // Space '바로 통과': 게이트가 배까지 당겨지는 연출
  const SPEED_MIN = 1;      // 속도 배율 (↑/↓, 0.5 단위)
  const SPEED_MAX = 3;
  const SPEED_STEP = 0.5;
  const LANE_TWEEN_MS = 140; // 레인 이동: 고정 140ms ease-out (중앙선 통과 ≈ 41ms)
  const TOAST_MS = 1500;
  const MAX_DT = 100;

  function now() {
    return (window.performance && typeof window.performance.now === 'function') ? window.performance.now() : Date.now();
  }
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function coerceLevel(v) {
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
  function str(v) { return typeof v === 'string' ? v.trim() : ''; }
  function fmtNum(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function reducedMotion() {
    try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; }
  }
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }
  function button(cls, text, label) {
    const b = el('button', cls, text);
    b.type = 'button';
    if (label) b.setAttribute('aria-label', label);
    return b;
  }
  function focusQuiet(e) {
    if (!e || typeof e.focus !== 'function') return;
    try { e.focus({ preventScroll: true }); } catch (err) { try { e.focus(); } catch (err2) { /* noop */ } }
  }
  // 읽을 시간 T = clamp(3 + 글자 수/15, 4, 12)초 × 레벨 계수, 최소 3.5초
  function readTimeMs(text, level) {
    const base = Math.min(12, Math.max(4, 3 + String(text).length / 15));
    return Math.max(3.5, base * (LEVEL_FACTOR[level] || 1)) * 1000;
  }
  // O/X 문항만, 하 셔플 → 중 셔플 → 상 셔플, 같은 진술은 한 번만
  function buildDeck(bank) {
    const seen = new Set();
    const items = [];
    (Array.isArray(bank) ? bank : []).forEach(function (q) {
      if (!q || typeof q !== 'object' || q.type !== 'ox') return;
      const text = str(q.question);
      const ans = coerceOX(q.answer);
      if (!text || ans === null || seen.has(text)) return;
      seen.add(text);
      items.push({ text: text, answer: ans, level: coerceLevel(q.level), explanation: str(q.explanation), category: str(q.category) });
    });
    let deck = [];
    [1, 2, 3].forEach(function (l) {
      deck = deck.concat(shuffle(items.filter(function (x) { return x.level === l; })));
    });
    return deck;
  }

  // 짧은 효과음 합성 (muted 면 AudioContext 자체를 만들지 않음)
  function makeAudio(muted) {
    const AC = window.AudioContext || window.webkitAudioContext;
    let ac = null;
    if (!muted && AC) { try { ac = new AC(); } catch (e) { ac = null; } }
    function resume() {
      if (!ac || ac.state !== 'suspended' || typeof ac.resume !== 'function') return;
      try { const p = ac.resume(); if (p && typeof p.catch === 'function') p.catch(function () { /* noop */ }); } catch (e) { /* noop */ }
    }
    function tone(freq, dur, type, vol, delay, slideTo) {
      if (!ac || ac.state === 'closed') return;
      try {
        const t0 = ac.currentTime + (delay || 0);
        const o = ac.createOscillator();
        const g = ac.createGain();
        o.type = type || 'sine';
        o.frequency.setValueAtTime(freq, t0);
        if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(vol || 0.12, t0 + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        o.connect(g);
        g.connect(ac.destination);
        o.start(t0);
        o.stop(t0 + dur + 0.03);
      } catch (e) { /* noop */ }
    }
    return {
      resume: resume,
      tick: function () { tone(440, 0.08, 'sine', 0.12); },
      go: function () { tone(880, 0.18, 'sine', 0.14); },
      move: function () { tone(540, 0.035, 'square', 0.035); },
      rush: function () { tone(300, 0.22, 'triangle', 0.09, 0, 900); },
      correct: function () { tone(660, 0.09, 'triangle', 0.15); tone(990, 0.13, 'triangle', 0.13, 0.08); },
      wrong: function () { tone(220, 0.3, 'sawtooth', 0.1, 0, 110); },
      fanfare: function () { [523, 659, 784, 1047].forEach(function (f, i) { tone(f, 0.12, 'triangle', 0.11, i * 0.07); }); },
      close: function () {
        const a = ac;
        ac = null;
        if (a && typeof a.close === 'function') {
          try { const p = a.close(); if (p && typeof p.catch === 'function') p.catch(function () { /* noop */ }); } catch (e) { /* noop */ }
        }
      }
    };
  }

  function mount(container, ctx) {
    ctx = ctx || {};
    const cfg = (ctx.config && typeof ctx.config === 'object') ? ctx.config : {};
    const livesCfg = Number(cfg.lives);
    const LIVES = (Number.isFinite(livesCfg) && livesCfg >= 1) ? Math.min(9, Math.floor(livesCfg)) : 3;
    const lockRaw = cfg.laneLockSeconds;
    const lockNum = Number(lockRaw);
    const LOCK_MS = (lockRaw !== undefined && lockRaw !== null && lockRaw !== '' && Number.isFinite(lockNum) && lockNum >= 0) ? Math.min(5, lockNum) * 1000 : 500;
    const reduce = reducedMotion();
    const audio = makeAudio(!!ctx.muted);
    const deck = buildDeck(ctx.bank);
    const rafFn = typeof window.requestAnimationFrame === 'function'
      ? function (f) { return window.requestAnimationFrame(f); }
      : function (f) { return window.setTimeout(f, 16); };
    const cafFn = typeof window.cancelAnimationFrame === 'function'
      ? function (id) { window.cancelAnimationFrame(id); }
      : function (id) { window.clearTimeout(id); };

    const S = {
      phase: 'countdown', // countdown → run (→ rush: Space 바로 통과) → (pass: 정답 확인 | feedback: 오답) → run … → ended
      paused: false, destroyed: false, endCalled: false,
      lives: LIVES, score: 0, correct: 0, attempts: 0, combo: 0, maxCombo: 0, maxLevel: 0,
      review: [], ptr: 0, cur: null,
      lane: 0, shipX: 0, tw: null, lockOn: false, speedMul: SPEED_MIN, gateP: 0, rushLeft: 0, rushFrom: 0, commitR: 0,
      phaseLeft: COUNT_MS + GO_MS, runMs: 0, playMs: 0, passY: 0,
      scroll: 0, shake: 0, toastLeft: 0, countShown: '',
      particles: [], floaters: [],
      raf: 0, lastTs: 0
    };

    // ---------- DOM ----------
    while (container.firstChild) container.removeChild(container.firstChild);
    const root = el('div', 'rn');
    root.tabIndex = -1;
    const hud = el('div', 'rn-hud');
    const livesEl = el('span', 'rn-lives');
    const scoreEl = el('span', 'rn-score', '0');
    const comboEl = el('span', 'rn-combo');
    const levelEl = el('span', 'lv-badge lv-1', LEVEL_FULL[1]);
    const tallyEl = el('span', 'rn-tally');
    const pauseBtn = button('rn-pause-btn', '⏸', '일시정지');
    const speedBox = el('span', 'rn-speed');
    const slowBtn = button('rn-speed-btn', '▼', '속도 내리기 (↓ 또는 S)');
    const speedEl = el('span', 'rn-speed-val', '⚡ 1.0×');
    const fastBtn = button('rn-speed-btn', '▲', '속도 올리기 (↑ 또는 W)');
    speedBox.appendChild(slowBtn); speedBox.appendChild(speedEl); speedBox.appendChild(fastBtn);
    hud.appendChild(livesEl); hud.appendChild(scoreEl); hud.appendChild(comboEl);
    hud.appendChild(levelEl); hud.appendChild(tallyEl); hud.appendChild(speedBox); hud.appendChild(pauseBtn);

    const banner = el('div', 'rn-banner');
    const qEl = el('p', 'rn-q', '곧 출항합니다 — 진술이 맞으면 왼쪽(O), 틀리면 오른쪽(X)!');
    qEl.setAttribute('aria-live', 'polite');
    const bar = el('div', 'rn-bar');
    const fill = el('div', 'rn-bar-fill');
    bar.appendChild(fill);
    bar.setAttribute('aria-hidden', 'true');
    const fbEl = el('div', 'rn-fb');
    fbEl.hidden = true;
    fbEl.setAttribute('aria-live', 'assertive');
    banner.appendChild(qEl); banner.appendChild(bar); banner.appendChild(fbEl);

    const stage = el('div', 'rn-stage');
    const canvas = el('canvas', 'rn-canvas');
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', '항로 화면: 왼쪽은 O 레인, 오른쪽은 X 레인');
    const toastEl = el('div', 'rn-toast');
    toastEl.hidden = true;
    const lockEl = el('div', 'rn-lock', '🔒 레인 고정');
    lockEl.hidden = true;
    const countEl = el('div', 'rn-count', '3');
    countEl.setAttribute('aria-live', 'assertive');
    stage.appendChild(canvas); stage.appendChild(toastEl); stage.appendChild(lockEl); stage.appendChild(countEl);

    const controls = el('div', 'rn-controls');
    const btnO = button('rn-btn rn-btn-o', 'O', 'O 레인(왼쪽)으로 이동');
    const btnX = button('rn-btn rn-btn-x', 'X', 'X 레인(오른쪽)으로 이동');
    const btnGo = button('rn-go', '⚡ 바로 통과');
    btnGo.disabled = true;
    controls.appendChild(btnO); controls.appendChild(btnGo); controls.appendChild(btnX);

    const overlay = el('div', 'rn-pause');
    overlay.hidden = true;
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', '일시정지');
    const resumeBtn = button('btn btn-primary', '▶ 계속하기');
    const quitBtn = button('btn btn-ghost', '그만두기');
    overlay.appendChild(el('p', 'rn-pause-icon', '⏸'));
    overlay.appendChild(el('h2', 'rn-pause-title', '일시정지'));
    overlay.appendChild(el('p', 'rn-pause-msg', 'Esc 또는 P로도 계속할 수 있어요. 그만두면 기록은 저장되지 않아요.'));
    overlay.appendChild(resumeBtn);
    overlay.appendChild(quitBtn);

    root.appendChild(hud); root.appendChild(banner); root.appendChild(stage); root.appendChild(controls); root.appendChild(overlay);
    container.appendChild(root);

    let g = null;
    try { g = canvas.getContext ? canvas.getContext('2d') : null; } catch (e) { g = null; }

    // ---------- 크기 (반응형 + devicePixelRatio) ----------
    let W = 320;
    let H = 400;
    function resize() {
      if (S.destroyed) return;
      W = Math.max(240, Math.floor(stage.clientWidth || container.clientWidth || 320));
      let docTop = 0;
      try { docTop = stage.getBoundingClientRect().top + (window.pageYOffset || 0); } catch (e) { docTop = 0; }
      const vh = window.innerHeight || 700;
      const ctrlH = controls.offsetHeight || 72;
      let want = Math.floor(vh - docTop - ctrlH - 28);
      if (!Number.isFinite(want)) want = 400;
      H = Math.max(260, Math.min(want, 560, Math.round(W * 1.35)));
      const dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
      canvas.style.width = W + 'px';
      canvas.style.height = H + 'px';
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      if (g) g.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw();
    }

    // ---------- 진행 ----------
    function multiplier() { return Math.min(3, 1 + 0.1 * S.combo); }
    function speed() { // 배경 스크롤 속도감 (px/ms): 레벨·콤보에 따라 조금씩 증가
      const lvl = S.cur ? S.cur.q.level : 1;
      return 0.11 * (1 + 0.15 * (lvl - 1) + 0.02 * Math.min(S.combo, 15));
    }
    function geom() {
      const shipL = Math.max(56, Math.min(104, H * 0.2));
      const shipY = H - shipL * 0.5 - 14;
      return { shipL: shipL, shipY: shipY, hitY: shipY - shipL * 0.5, gateH: Math.max(46, Math.min(64, H * 0.12)) };
    }
    function updateHud() {
      livesEl.textContent = '♥'.repeat(Math.max(0, S.lives)) + '♡'.repeat(Math.max(0, LIVES - S.lives));
      livesEl.setAttribute('aria-label', '목숨 ' + Math.max(0, S.lives) + '개');
      scoreEl.textContent = fmtNum(S.score);
      scoreEl.setAttribute('aria-label', '점수 ' + S.score + '점');
      comboEl.textContent = '콤보 ' + S.combo + ' · x' + multiplier().toFixed(1);
      comboEl.classList.toggle('is-hot', S.combo >= 3);
      const lvl = S.cur ? S.cur.q.level : 1;
      levelEl.className = 'lv-badge lv-' + lvl;
      levelEl.textContent = LEVEL_FULL[lvl];
      tallyEl.textContent = '맞힘 ' + S.correct + ' / ' + S.attempts;
      btnO.classList.toggle('is-active', S.lane === 0);
      btnX.classList.toggle('is-active', S.lane === 1);
      btnO.setAttribute('aria-pressed', String(S.lane === 0));
      btnX.setAttribute('aria-pressed', String(S.lane === 1));
      speedEl.textContent = '⚡ ' + S.speedMul.toFixed(1) + '×';
      speedEl.setAttribute('aria-label', '속도 ' + S.speedMul.toFixed(1) + '배');
      slowBtn.disabled = S.speedMul <= SPEED_MIN;
      fastBtn.disabled = S.speedMul >= SPEED_MAX;
      updateActionBtn();
      syncLock();
    }
    // 진행 중엔 '⚡ 바로 통과', 정답 확인/오답 해설 중엔 '다음 ▶', 그 밖엔 비활성
    function updateActionBtn() {
      const fb = S.phase === 'pass' || S.phase === 'feedback';
      btnGo.textContent = fb ? '다음 ▶' : '⚡ 바로 통과';
      btnGo.setAttribute('aria-label', fb ? '다음 문제 (Space)' : '지금 레인으로 바로 결정 (Space)');
      btnGo.disabled = S.destroyed || S.paused || !(S.phase === 'run' || fb);
    }
    function showToast(text) {
      toastEl.textContent = text;
      toastEl.hidden = false;
      toastEl.classList.remove('is-on');
      void toastEl.offsetWidth;
      toastEl.classList.add('is-on');
      S.toastLeft = TOAST_MS;
    }
    function nextQuestion() {
      if (S.ptr >= deck.length) { end('cleared'); return; }
      const q = deck[S.ptr++];
      const prevLevel = S.cur ? S.cur.q.level : 0;
      S.cur = { q: q, T: readTimeMs(q.text, q.level) };
      S.runMs = 0;
      S.gateP = 0;
      S.phase = 'run';
      if (q.level > S.maxLevel) S.maxLevel = q.level;
      if (prevLevel && q.level > prevLevel) { showToast('📈 난이도 상승 · ' + LEVEL_SHORT[q.level]); audio.fanfare(); }
      qEl.textContent = q.text;
      fbEl.hidden = true;
      while (fbEl.firstChild) fbEl.removeChild(fbEl.firstChild);
      banner.className = 'rn-banner';
      bar.classList.remove('is-low');
      fill.style.width = '100%';
      updateHud();
    }
    // r: Space 로 일찍 결정했을 때 남은 시간 비율(0~1). 게이트가 자연 도착하면 0
    function judge(r) {
      const early = r > 0;
      const q = S.cur.q;
      const userO = S.shipX < 0.5; // 보이는 대로 판정(WYSIWYG): 그려지는 배 위치 기준
      const ok = userO === q.answer;
      S.attempts++;
      while (fbEl.firstChild) fbEl.removeChild(fbEl.firstChild);
      fbEl.hidden = false;
      if (ok) {
        const pts = Math.round((100 + 50 * r) * multiplier()); // 조기 결정 보너스 × (이번 정답 직전까지의) 콤보 배율
        S.score += pts;
        S.correct++;
        S.combo++;
        if (S.combo > S.maxCombo) S.maxCombo = S.combo;
        audio.correct();
        burst();
        S.floaters.push({ text: '+' + pts, x: laneX(S.lane), y: geom().shipY - geom().shipL * 0.6, life: 800 });
        banner.className = 'rn-banner is-correct';
        fbEl.appendChild(el('strong', 'rn-fb-head', '✓ 정답: ' + (q.answer ? 'O' : 'X') + ' · +' + fmtNum(pts) + '점' + (early ? ' (⚡ 조기 결정 보너스)' : '')));
        if (q.explanation) fbEl.appendChild(el('p', 'rn-fb-expl', '💡 ' + q.explanation));
        if (S.combo === 5 || S.combo === 10) { showToast('🚀 항속 증가! 콤보 ' + S.combo); audio.fanfare(); }
        S.phase = 'pass';
        S.phaseLeft = CORRECT_MS;
        S.passY = 0;
      } else {
        S.lives--;
        S.combo = 0;
        audio.wrong();
        if (!reduce) S.shake = 320;
        S.review.push({
          prompt: q.text, answer: q.answer ? 'O' : 'X', userAnswer: userO ? 'O' : 'X',
          explanation: q.explanation, category: q.category, level: q.level
        });
        banner.className = 'rn-banner is-wrong';
        fbEl.appendChild(el('strong', 'rn-fb-head', '✗ 오답 · 정답: ' + (q.answer ? 'O' : 'X')));
        if (q.explanation) fbEl.appendChild(el('p', 'rn-fb-expl', '💡 ' + q.explanation));
        S.phase = 'feedback';
        S.phaseLeft = FEEDBACK_MS;
      }
      updateHud();
    }
    function afterAnswer() {
      if (S.lives <= 0) { end('lives'); return; }
      if (S.ptr >= deck.length) { end('cleared'); return; }
      nextQuestion();
    }
    function end(reason) {
      if (S.phase === 'ended') return;
      S.phase = 'ended';
      stopLoop();
      updateActionBtn();
      draw();
      if (S.endCalled) return;
      S.endCalled = true;
      const result = {
        score: S.score, correct: S.correct, attempts: S.attempts, timeMs: Math.round(S.playMs),
        maxCombo: S.maxCombo, maxLevel: S.maxLevel || 1, reason: reason, review: S.review.slice()
      };
      if (typeof ctx.onEnd === 'function') {
        try { ctx.onEnd(result); } catch (e) { if (window.console) console.error(e); }
      }
    }

    // ---------- 레인 트윈 · 잠금 ----------
    function startTween(to) { S.tw = { from: S.shipX, to: to, t: 0 }; }
    function stepTween(t) {
      if (!S.tw || !(t > 0)) return;
      S.tw.t += t;
      const k = Math.min(1, S.tw.t / LANE_TWEEN_MS);
      S.shipX = S.tw.from + (S.tw.to - S.tw.from) * (1 - (1 - k) * (1 - k)); // ease-out
      if (k >= 1) { S.shipX = S.tw.to; S.tw = null; }
    }
    // 판정 직전 구간: 남은 실제 시간((T - runMs) / 속도) ≤ laneLockSeconds 이면 레인 변경 무시
    function laneLocked() {
      if (S.phase === 'rush') return true; // 바로 통과로 이미 결정
      return S.phase === 'run' && LOCK_MS > 0 && !!S.cur && (S.cur.T - S.runMs) / S.speedMul <= LOCK_MS;
    }
    function syncLock() {
      const on = laneLocked();
      if (on === S.lockOn) return;
      S.lockOn = on;
      lockEl.hidden = !on;
      bar.classList.toggle('is-lock', on);
      [btnO, btnX].forEach(function (b) {
        b.classList.toggle('is-locked', on);
        if (on) b.setAttribute('aria-disabled', 'true'); else b.removeAttribute('aria-disabled');
      });
    }
    function renderBar() {
      fill.style.width = ((1 - S.gateP) * 100).toFixed(2) + '%';
      bar.classList.toggle('is-low', S.gateP > 0.75);
    }
    // 입력 순간까지 시뮬레이션을 따라잡는다 → 입력 타이밍이 프레임레이트와 무관하게 정확
    function catchUp() {
      if (S.destroyed || S.paused || S.phase === 'ended' || !S.lastTs) return;
      const t = now();
      let dt = t - S.lastTs;
      if (!(dt > 0)) return;
      S.lastTs = t;
      if (dt > MAX_DT) dt = MAX_DT;
      update(dt);
    }

    function update(dt) {
      if (S.toastLeft > 0) { S.toastLeft -= dt; if (S.toastLeft <= 0) toastEl.hidden = true; }
      if (S.shake > 0) S.shake = Math.max(0, S.shake - dt);
      stepParticles(dt);
      let rest = dt;
      for (let i = 0; i < 8 && rest > 0 && S.phase !== 'ended' && !S.destroyed; i++) rest = step(rest);
      syncLock();
    }
    // 현재 단계 안에서 t 만큼 진행. 단계가 끝나면(판정 등) 남은 시간을 돌려줘 다음 단계가 이어서 쓴다.
    function step(t) {
      if (S.phase === 'countdown') {
        stepTween(t);
        S.phaseLeft -= t;
        const n = Math.ceil((S.phaseLeft - GO_MS) / 1000);
        const label = n > 0 ? String(n) : 'GO!';
        if (label !== S.countShown) {
          S.countShown = label;
          countEl.textContent = label;
          if (n > 0) audio.tick(); else audio.go();
        }
        if (S.phaseLeft > 0) return 0;
        const left = -S.phaseLeft;
        countEl.hidden = true;
        nextQuestion();
        return left;
      }
      if (S.phase === 'run') {
        // 속도 배율만큼 게이트가 빨리 다가오고 시간 바도 빨리 준다
        const need = Math.max(0, (S.cur.T - S.runMs) / S.speedMul); // 게이트 도착까지 남은 실제 시간
        const use = Math.min(t, need);
        stepTween(use);
        S.playMs += use;
        S.scroll += use * speed() * S.speedMul;
        S.runMs = use < need ? S.runMs + use * S.speedMul : S.cur.T;
        S.gateP = Math.min(1, S.runMs / S.cur.T);
        renderBar();
        if (use < need) return 0;
        judge(0); // 정확한 도착 순간(서브프레임)의 배 위치로 판정
        return t - use;
      }
      if (S.phase === 'rush') {
        const use = Math.min(t, Math.max(0, S.rushLeft));
        stepTween(use);
        S.playMs += use;
        S.scroll += use * speed() * S.speedMul * 2;
        S.rushLeft -= use;
        const k = 1 - Math.max(0, S.rushLeft) / RUSH_MS;
        S.gateP = S.rushFrom + (1 - S.rushFrom) * k * k; // 배 쪽으로 빠르게 당겨짐
        renderBar();
        if (S.rushLeft > 0) return 0;
        S.gateP = 1;
        judge(S.commitR);
        return t - use;
      }
      if (S.phase === 'pass' || S.phase === 'feedback') {
        const use = Math.min(t, Math.max(0, S.phaseLeft));
        if (S.phase === 'pass') { // 정답: 게이트 통과 연출 계속
          stepTween(use);
          S.scroll += use * speed() * S.speedMul;
          S.passY += use * 0.5;
        } // 오답: 장면 정지 — 해설을 읽는 시간
        S.playMs += use;
        S.phaseLeft -= use;
        if (S.phaseLeft > 0) return 0;
        afterAnswer();
        return t - use;
      }
      return 0;
    }
    function frame() {
      S.raf = 0;
      if (S.destroyed || S.paused || S.phase === 'ended') return;
      const t = now();
      let dt = S.lastTs ? t - S.lastTs : 16;
      S.lastTs = t;
      if (!(dt >= 0)) dt = 0;
      if (dt > MAX_DT) dt = MAX_DT;
      update(dt);
      draw();
      if (!S.destroyed && !S.paused && S.phase !== 'ended' && !S.raf) S.raf = rafFn(frame);
    }
    function startLoop() {
      if (S.raf || S.destroyed || S.paused || S.phase === 'ended') return;
      S.lastTs = now();
      S.raf = rafFn(frame);
    }
    function stopLoop() {
      if (S.raf) { cafFn(S.raf); S.raf = 0; }
    }

    // ---------- 일시정지 ----------
    function pause() {
      if (S.paused || S.destroyed || S.phase === 'ended') return;
      catchUp();
      if (S.phase === 'ended') return;
      S.paused = true;
      stopLoop();
      updateActionBtn();
      overlay.hidden = false;
      focusQuiet(resumeBtn);
    }
    function resume() {
      if (!S.paused || S.destroyed || S.phase === 'ended') return;
      S.paused = false;
      updateActionBtn();
      overlay.hidden = true;
      audio.resume();
      focusQuiet(root);
      startLoop();
    }

    // ---------- 입력 ----------
    function setLane(l) {
      // 해설 표시 중엔 정지, '바로 통과'로 이미 결정한 문제는 레인 고정
      if (S.destroyed || S.paused || S.phase === 'ended' || S.phase === 'feedback' || S.phase === 'rush') return;
      catchUp();
      if (S.phase === 'ended' || S.phase === 'feedback' || laneLocked()) return; // 🔒 판정 직전엔 레인 고정
      audio.resume();
      if (S.lane !== l) { S.lane = l; startTween(l); audio.move(); updateHud(); }
    }
    function changeSpeed(dir) {
      if (S.destroyed || S.paused || S.phase === 'ended') return;
      catchUp();
      if (S.phase === 'ended') return;
      const v = Math.max(SPEED_MIN, Math.min(SPEED_MAX, Math.round((S.speedMul + dir * SPEED_STEP) * 2) / 2));
      if (v !== S.speedMul) { S.speedMul = v; audio.resume(); audio.move(); }
      updateHud();
    }
    // Space/Enter: 진행 중이면 지금 레인으로 바로 결정, 정답 확인·해설 중이면 다음 문제로
    function primary() {
      if (S.destroyed || S.paused || S.phase === 'ended') return;
      catchUp(); // 누른 순간 기준으로 결정 (잠금 중에도 허용)
      if (S.phase === 'ended') return;
      audio.resume();
      if (S.phase === 'run') {
        const p = Math.min(1, S.runMs / S.cur.T);
        S.commitR = Math.max(0, Math.min(1, 1 - p));
        S.rushFrom = p;
        S.rushLeft = RUSH_MS;
        S.phase = 'rush';
        audio.rush();
        updateActionBtn();
      } else if (S.phase === 'pass' || S.phase === 'feedback') {
        S.phaseLeft = 0;
        afterAnswer(); // 남은 표시 시간 건너뛰기
      }
      // countdown · rush(이미 결정됨) 에서는 무시
    }
    function isInteractive(t) {
      return !!(t && typeof t.closest === 'function' && t.closest('button, a, input, select, textarea, [contenteditable="true"]'));
    }
    // 게임이 소유한 키 입력: 게임 영역 안이거나, 특정 컨트롤에 포커스가 없는 상태(body)
    function ownsKey(t) {
      if (!t || t === window || t === document || t === document.body || t === document.documentElement) return true;
      return typeof t.nodeType === 'number' && root.contains(t);
    }
    function onKey(e) {
      if (S.destroyed || e.defaultPrevented || !ownsKey(e.target)) return;
      const k = e.key;
      const c = e.code || '';
      if (k === 'Escape' || k === 'Esc' || k === 'p' || k === 'P' || k === 'ㅔ' || c === 'KeyP') {
        if (S.phase !== 'ended') { e.preventDefault(); if (!e.repeat) { if (S.paused) resume(); else pause(); } }
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (k === ' ' || k === 'Spacebar' || c === 'Space' || k === 'Enter') {
        if (isInteractive(e.target)) return; // 포커스된 버튼은 기본 동작(click)에 맡김
        if (S.phase === 'ended') return;
        e.preventDefault();                    // 페이지 스크롤 방지 (게임 소유 입력만)
        if (!e.repeat) primary();              // 누르고 있어 생기는 반복 입력 무시
        return;
      }
      if (S.paused) return;
      if (k === 'ArrowUp' || k === 'w' || k === 'W' || c === 'KeyW') { e.preventDefault(); if (!e.repeat) changeSpeed(1); }
      else if (k === 'ArrowDown' || k === 's' || k === 'S' || c === 'KeyS') { e.preventDefault(); if (!e.repeat) changeSpeed(-1); }
      else if (k === 'ArrowLeft' || k === 'a' || k === 'A' || c === 'KeyA') { e.preventDefault(); setLane(0); }
      else if (k === 'ArrowRight' || k === 'd' || k === 'D' || c === 'KeyD') { e.preventDefault(); setLane(1); }
    }
    let swipe = null;
    function onPointerDown(e) { audio.resume(); swipe = { x: e.clientX, y: e.clientY }; }
    function onPointerUp(e) {
      if (!swipe) return;
      const dx = e.clientX - swipe.x;
      const dy = e.clientY - swipe.y;
      swipe = null;
      if (Math.abs(dx) >= 28 && Math.abs(dx) > Math.abs(dy)) setLane(dx < 0 ? 0 : 1);
    }
    function onPointerCancel() { swipe = null; }
    function onTouchStart(e) { const t = e.changedTouches && e.changedTouches[0]; if (t) onPointerDown(t); }
    function onTouchEnd(e) { const t = e.changedTouches && e.changedTouches[0]; if (t) onPointerUp(t); }
    function onO() { setLane(0); }
    function onX() { setLane(1); }
    function onGo() { primary(); }
    function onSlow() { changeSpeed(-1); }
    function onFast() { changeSpeed(1); }
    // 마우스로 조작 버튼을 눌러도 포커스를 게임 영역에 남김 → 이어서 Space/방향키가 바로 동작
    function keepFocus(e) { if (e.pointerType === 'mouse') e.preventDefault(); }
    const ctrlBtns = [btnO, btnX, btnGo, slowBtn, fastBtn, pauseBtn];
    function onPauseBtn() { pause(); }
    function onResumeBtn() { resume(); }
    function onQuitBtn() {
      if (S.destroyed || S.phase === 'ended') return;
      if (typeof ctx.onQuit === 'function') { try { ctx.onQuit(); } catch (e) { if (window.console) console.error(e); } }
    }
    function onVis() { if (document.hidden) pause(); }
    function onBlur() { pause(); }
    function onResize() { resize(); }

    // ---------- 파티클·떠오르는 점수 ----------
    function laneX(lane) { return W * (0.25 + 0.5 * lane); }
    function burst() {
      const n = reduce ? 0 : 18;
      const gm = geom();
      const x = laneX(S.lane);
      const y = gm.shipY - gm.shipL * 0.45;
      const colors = ['#5eead4', '#ffffff', '#fde68a', '#93c5fd'];
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const v = 0.06 + Math.random() * 0.16;
        S.particles.push({ x: x, y: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 0.05, life: 500 + Math.random() * 300, max: 800, r: 2 + Math.random() * 3, c: colors[i % colors.length] });
      }
    }
    function stepParticles(dt) {
      for (let i = S.particles.length - 1; i >= 0; i--) {
        const p = S.particles[i];
        p.life -= dt;
        if (p.life <= 0) { S.particles.splice(i, 1); continue; }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      }
      for (let j = S.floaters.length - 1; j >= 0; j--) {
        const f = S.floaters[j];
        f.life -= dt;
        if (f.life <= 0) { S.floaters.splice(j, 1); continue; }
        if (!reduce) f.y -= dt * 0.05;
      }
    }

    // ---------- 그리기 (캔버스 도형·그라디언트로 직접 그린 항만 테마) ----------
    function rrect(x, y, w, h2, r) {
      const rr = Math.min(r, w / 2, h2 / 2);
      g.beginPath();
      g.moveTo(x + rr, y);
      g.arcTo(x + w, y, x + w, y + h2, rr);
      g.arcTo(x + w, y + h2, x, y + h2, rr);
      g.arcTo(x, y + h2, x, y, rr);
      g.arcTo(x, y, x + w, y, rr);
      g.closePath();
    }
    function drawSea() {
      const grd = g.createLinearGradient(0, 0, 0, H);
      grd.addColorStop(0, '#08294a');
      grd.addColorStop(1, '#0d5a74');
      g.fillStyle = grd;
      g.fillRect(0, 0, W, H);
      // 가장자리 방파제
      g.fillStyle = 'rgba(2, 16, 32, 0.35)';
      g.fillRect(0, 0, 10, H);
      g.fillRect(W - 10, 0, 10, H);
      // 흘러내리는 물결
      const gap = 44;
      const base = Math.floor(S.scroll / gap);
      const off = S.scroll - base * gap;
      g.strokeStyle = 'rgba(255, 255, 255, 0.10)';
      g.lineWidth = 2;
      g.lineCap = 'round';
      for (let j = -1; j * gap + off < H + gap; j++) {
        const y = off + j * gap;
        const id = base - j;
        for (let k = 0; k < 4; k++) {
          const rnd = ((id * 7919 + k * 104729) % 997 + 997) % 997 / 997;
          const x = 18 + rnd * (W - 36);
          g.beginPath();
          g.moveTo(x - 13, y);
          g.quadraticCurveTo(x, y - 5, x + 13, y);
          g.stroke();
        }
      }
      // 레인 워터마크
      g.fillStyle = 'rgba(255, 255, 255, 0.07)';
      g.font = '900 ' + Math.round(Math.min(W * 0.22, 120)) + 'px system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('O', laneX(0), H * 0.45);
      g.fillText('X', laneX(1), H * 0.45);
    }
    function drawBuoys() {
      const gap = 72;
      const off = (S.scroll * 1.0) % gap;
      const x = W / 2;
      g.strokeStyle = 'rgba(255, 255, 255, 0.22)';
      g.lineWidth = 1.5;
      g.setLineDash([4, 6]);
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, H);
      g.stroke();
      g.setLineDash([]);
      for (let y = off - gap; y < H + gap; y += gap) {
        g.fillStyle = '#f59e0b';
        g.beginPath();
        g.arc(x, y, 7, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = '#fff7ed';
        g.fillRect(x - 7, y - 1.5, 14, 3);
        g.fillStyle = '#b45309';
        g.beginPath();
        g.moveTo(x, y - 14);
        g.lineTo(x - 4, y - 6);
        g.lineTo(x + 4, y - 6);
        g.closePath();
        g.fill();
      }
    }
    function drawGate(cx, bottom, label, gm, mark, locked) {
      const gw = W * 0.5 * 0.8;
      const gh = gm.gateH;
      const top = bottom - gh;
      const isO = label === 'O';
      // 게이트 안쪽 수면
      g.fillStyle = isO ? 'rgba(45, 212, 191, 0.10)' : 'rgba(251, 113, 133, 0.10)';
      g.fillRect(cx - gw / 2, top, gw, gh);
      // 기둥(부두 교각)
      g.fillStyle = '#cbd5e1';
      g.fillRect(cx - gw / 2, top, 9, gh);
      g.fillRect(cx + gw / 2 - 9, top, 9, gh);
      // 상부 아치 빔
      const beam = g.createLinearGradient(0, top, 0, top + 24);
      beam.addColorStop(0, locked ? '#fde68a' : (isO ? '#2dd4bf' : '#fb7185'));
      beam.addColorStop(1, locked ? '#b45309' : (isO ? '#0f766e' : '#be123c'));
      g.fillStyle = beam;
      rrect(cx - gw / 2 - 4, top - 6, gw + 8, 26, 8);
      g.fill();
      if (mark) {
        g.lineWidth = 3;
        g.strokeStyle = mark === 'ok' ? '#4ade80' : '#f87171';
        rrect(cx - gw / 2 - 6, top - 8, gw + 12, gh + 10, 10);
        g.stroke();
      }
      g.fillStyle = '#ffffff';
      g.font = '900 18px system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(label + (mark === 'ok' ? ' ✓' : mark === 'bad' ? ' ✗' : ''), cx, top + 7);
      // 판정선 (게이트 하단) — 배 중심선에 닿는 순간 결정
      g.strokeStyle = locked ? '#fbbf24' : 'rgba(255, 255, 255, 0.85)';
      g.lineWidth = 2;
      g.setLineDash([6, 4]);
      g.beginPath();
      g.moveTo(cx - gw / 2, bottom);
      g.lineTo(cx + gw / 2, bottom);
      g.stroke();
      g.setLineDash([]);
      // 신호등
      g.fillStyle = '#fde047';
      g.beginPath(); g.arc(cx - gw / 2 + 4.5, top + gh - 6, 3, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.arc(cx + gw / 2 - 4.5, top + gh - 6, 3, 0, Math.PI * 2); g.fill();
    }
    function drawGates(gm) {
      if (!S.cur || (S.phase !== 'run' && S.phase !== 'rush' && S.phase !== 'pass' && S.phase !== 'feedback')) return;
      const p = (S.phase === 'run' || S.phase === 'rush') ? S.gateP : 1;
      let bottom = -12 + (gm.shipY + 12) * p;
      if (S.phase === 'pass') bottom += S.passY;
      let markO = null;
      let markX = null;
      if (S.phase === 'feedback') {
        const ansLane = S.cur.q.answer ? 0 : 1;
        markO = ansLane === 0 ? 'ok' : (S.lane === 0 ? 'bad' : null);
        markX = ansLane === 1 ? 'ok' : (S.lane === 1 ? 'bad' : null);
      }
      drawGate(laneX(0), bottom, 'O', gm, markO, S.lockOn);
      drawGate(laneX(1), bottom, 'X', gm, markX, S.lockOn);
    }
    function drawShip(gm) {
      const x = W * (0.25 + 0.5 * S.shipX);
      const y = gm.shipY;
      const L = gm.shipL;
      const B = L * 0.36;
      g.strokeStyle = S.lockOn ? 'rgba(251, 191, 36, 0.55)' : 'rgba(255, 255, 255, 0.18)';
      g.lineWidth = 1.5;
      g.setLineDash([2, 6]);
      g.beginPath();
      g.moveTo(12, y);
      g.lineTo(W - 12, y);
      g.stroke();
      g.setLineDash([]);
      // 항적
      g.strokeStyle = 'rgba(255, 255, 255, 0.35)';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(x - B * 0.35, y + L * 0.48); g.lineTo(x - B * 0.9, y + L * 0.9);
      g.moveTo(x + B * 0.35, y + L * 0.48); g.lineTo(x + B * 0.9, y + L * 0.9);
      g.stroke();
      // 그림자
      g.fillStyle = 'rgba(0, 0, 0, 0.25)';
      g.beginPath();
      g.ellipse(x + 3, y + 4, B * 0.62, L * 0.52, 0, 0, Math.PI * 2);
      g.fill();
      // 선체 (위에서 본 탱커)
      g.beginPath();
      g.moveTo(x, y - L * 0.5);
      g.quadraticCurveTo(x + B * 0.52, y - L * 0.32, x + B * 0.5, y - L * 0.12);
      g.lineTo(x + B * 0.5, y + L * 0.4);
      g.quadraticCurveTo(x + B * 0.5, y + L * 0.5, x, y + L * 0.5);
      g.quadraticCurveTo(x - B * 0.5, y + L * 0.5, x - B * 0.5, y + L * 0.4);
      g.lineTo(x - B * 0.5, y - L * 0.12);
      g.quadraticCurveTo(x - B * 0.52, y - L * 0.32, x, y - L * 0.5);
      g.closePath();
      g.fillStyle = '#b91c1c';
      g.fill();
      // 갑판
      g.save();
      g.beginPath();
      g.moveTo(x, y - L * 0.42);
      g.quadraticCurveTo(x + B * 0.4, y - L * 0.28, x + B * 0.38, y - L * 0.1);
      g.lineTo(x + B * 0.38, y + L * 0.38);
      g.lineTo(x - B * 0.38, y + L * 0.38);
      g.lineTo(x - B * 0.38, y - L * 0.1);
      g.quadraticCurveTo(x - B * 0.4, y - L * 0.28, x, y - L * 0.42);
      g.closePath();
      g.fillStyle = '#3f6212';
      g.fill();
      g.restore();
      // 화물 배관
      g.strokeStyle = '#e2e8f0';
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(x, y - L * 0.32); g.lineTo(x, y + L * 0.18);
      g.moveTo(x - B * 0.18, y - L * 0.2); g.lineTo(x - B * 0.18, y + L * 0.16);
      g.moveTo(x + B * 0.18, y - L * 0.2); g.lineTo(x + B * 0.18, y + L * 0.16);
      g.stroke();
      // 선교(브리지) + 연돌
      g.fillStyle = '#f8fafc';
      rrect(x - B * 0.34, y + L * 0.2, B * 0.68, L * 0.16, 3);
      g.fill();
      g.fillStyle = '#f97316';
      rrect(x - B * 0.1, y + L * 0.3, B * 0.2, L * 0.07, 2);
      g.fill();
    }
    function drawFx() {
      for (let i = 0; i < S.particles.length; i++) {
        const p = S.particles[i];
        g.globalAlpha = Math.max(0, p.life / p.max);
        g.fillStyle = p.c;
        g.beginPath();
        g.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        g.fill();
      }
      g.globalAlpha = 1;
      g.font = '900 20px system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      for (let j = 0; j < S.floaters.length; j++) {
        const f = S.floaters[j];
        g.globalAlpha = Math.max(0, Math.min(1, f.life / 400));
        g.fillStyle = '#fde68a';
        g.fillText(f.text, f.x, f.y);
      }
      g.globalAlpha = 1;
    }
    function draw() {
      if (!g || S.destroyed) return;
      const gm = geom();
      g.save();
      if (S.shake > 0 && !reduce) {
        const m = 6 * (S.shake / 320);
        g.translate((Math.random() * 2 - 1) * m, (Math.random() * 2 - 1) * m);
      }
      drawSea();
      drawBuoys();
      drawGates(gm);
      drawShip(gm);
      drawFx();
      g.restore();
    }

    // ---------- 시작 · 해제 ----------
    let ro = null;
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', onBlur);
    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', onVis);
    if (window.PointerEvent) {
      stage.addEventListener('pointerdown', onPointerDown);
      stage.addEventListener('pointerup', onPointerUp);
      stage.addEventListener('pointercancel', onPointerCancel);
    } else {
      stage.addEventListener('touchstart', onTouchStart);
      stage.addEventListener('touchend', onTouchEnd);
    }
    btnO.addEventListener('click', onO);
    btnX.addEventListener('click', onX);
    btnGo.addEventListener('click', onGo);
    slowBtn.addEventListener('click', onSlow);
    fastBtn.addEventListener('click', onFast);
    ctrlBtns.forEach(function (b) { b.addEventListener('pointerdown', keepFocus); });
    pauseBtn.addEventListener('click', onPauseBtn);
    resumeBtn.addEventListener('click', onResumeBtn);
    quitBtn.addEventListener('click', onQuitBtn);
    if (typeof window.ResizeObserver === 'function') {
      try { ro = new window.ResizeObserver(function () { resize(); }); ro.observe(stage); } catch (e) { ro = null; }
    }
    updateHud();
    resize();
    audio.resume();
    audio.tick();
    S.countShown = '3';
    focusQuiet(root);
    startLoop();

    function destroy() {
      if (S.destroyed) return;
      S.destroyed = true;
      stopLoop();
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVis);
      stage.removeEventListener('pointerdown', onPointerDown);
      stage.removeEventListener('pointerup', onPointerUp);
      stage.removeEventListener('pointercancel', onPointerCancel);
      stage.removeEventListener('touchstart', onTouchStart);
      stage.removeEventListener('touchend', onTouchEnd);
      btnO.removeEventListener('click', onO);
      btnX.removeEventListener('click', onX);
      btnGo.removeEventListener('click', onGo);
      slowBtn.removeEventListener('click', onSlow);
      fastBtn.removeEventListener('click', onFast);
      ctrlBtns.forEach(function (b) { b.removeEventListener('pointerdown', keepFocus); });
      pauseBtn.removeEventListener('click', onPauseBtn);
      resumeBtn.removeEventListener('click', onResumeBtn);
      quitBtn.removeEventListener('click', onQuitBtn);
      if (ro) { try { ro.disconnect(); } catch (e) { /* noop */ } ro = null; }
      audio.close();
      S.particles.length = 0;
      S.floaters.length = 0;
      while (container.firstChild) container.removeChild(container.firstChild);
    }
    return { destroy: destroy };
  }

  PG.runner = { key: 'runner', title: '항로 질주', mount: mount };
})();
