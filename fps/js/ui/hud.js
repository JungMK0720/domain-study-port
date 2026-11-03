// ⚓ 항만 작전 UI — HUD(체력·탄약·슬롯·크로스헤어·히트마커·피격 방향·타이머·스코어·킬피드·중앙 메시지)
//   개인전(score.mode === 'ffa'): 내 킬·순위·1위 표시, 부활 패널(respawn), 보호 표시(protect), 중립 킬피드
// hud.set()은 매 프레임 불러도 된다: 값이 바뀐 곳만 DOM에 쓴다.
import { h, setText, clamp, fmtTime, num, TEAMS, TEAM_KEYS, teamKey, FFA_TARGET } from './dom.js';
import { makeScreen } from './parts.js';
import { headshotIcon, weaponInfo } from './icons.js';

const KILLFEED_MAX = 5;
const KILLFEED_MS = 5000;
const DMG_MAX = 6;

function autoTone(text) {
  if (/매치 ?포인트|무승부|재경기|연장/.test(text)) return 'warn';
  if (/선주/.test(text) && !/용선자/.test(text)) return 'owner';
  if (/용선자/.test(text) && !/선주/.test(text)) return 'charterer';
  return '';
}

export function createHud(ctx) {
  const st = {
    hp: null, maxHp: 100, ammo: undefined, reserve: undefined, mag: undefined, magSeen: 0,
    reload: null, reloading: false, slot: null, slotList: null, slotSig: '', weaponName: null,
    spread: 0, spreadPx: null, fov: null, gap: -1, time: undefined, scoreSig: '', aliveSig: '',
    alive: null, size: null, team: null, centerTimer: null, hitAnim: null,
    ffa: false, respSig: '', protect: false,
  };
  let viewH = 0;

  // ---------- 요소 ----------
  const vignette = h('div', { class: 'po-vignette', 'aria-hidden': 'true' });
  const flash = h('div', { class: 'po-flash', 'aria-hidden': 'true' });
  const dmgs = h('div', { class: 'po-dmgs', 'aria-hidden': 'true' });
  const xhair = h('div', { class: 'po-xhair', 'aria-hidden': 'true' }, ['t', 'b', 'l', 'r', 'dot'].map((k) => h('i', { class: `po-xh-${k}` })));
  const hit = h('div', { class: 'po-hit', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'), h('i'));

  function side(team) {
    const score = h('b', { class: 'po-ts-score', text: '0' });
    const pips = h('span', { class: 'po-pips' });
    const aliveN = h('span', { class: 'po-ts-alive-n' });
    const mp = h('span', { class: 'po-ts-mp', text: '매치 포인트', hidden: true });
    const el = h('div', { class: `po-ts po-ts--${team}` },
      h('div', { class: 'po-ts-row' }, h('span', { class: 'po-ts-name', text: TEAMS[team].name }), score),
      h('div', { class: 'po-ts-alive' }, pips, aliveN),
      mp);
    return { el, score, pips, aliveN, mp };
  }
  const sides = { owner: side('owner'), charterer: side('charterer') };
  const timer = h('div', { class: 'po-timer', text: '-:--' });
  const tcSub = h('div', { class: 'po-tc-sub', text: '5판 3선승' });

  // 개인전 스코어: "🎯 7킬 · 2위/5 · 1위 해운 12 / 20"
  const ffaKills = h('b', { class: 'po-ts-score', text: '0' });
  const ffaGoal = h('span', { class: 'po-ts-alive-n po-ffa-goal' });
  const ffaRank = h('b', { class: 'po-ts-score', text: '-' });
  const ffaTotal = h('small', { class: 'po-ffa-total' });
  const ffaLeader = h('span', { class: 'po-ts-alive-n po-ffa-leader' });
  const ffaMe = h('div', { class: 'po-ts po-ts--ffa po-ffa-me' },
    h('div', { class: 'po-ts-row' }, h('span', { class: 'po-ts-name', text: '🎯 내 킬' }), h('span', { class: 'po-ffa-kv' }, ffaKills, h('small', { text: '킬' }))),
    h('div', { class: 'po-ts-alive' }, ffaGoal));
  const ffaStand = h('div', { class: 'po-ts po-ts--ffa po-ffa-stand' },
    h('div', { class: 'po-ts-row' }, h('span', { class: 'po-ffa-kv' }, ffaRank, h('small', { text: '위' }), ffaTotal), h('span', { class: 'po-ts-name', text: '순위' })),
    h('div', { class: 'po-ts-alive' }, ffaLeader));

  const top = h('div', { class: 'po-top', role: 'group', 'aria-label': '라운드 스코어' },
    sides.owner.el, ffaMe, h('div', { class: 'po-tc' }, timer, tcSub), ffaStand, sides.charterer.el);

  const hpNum = h('b', { class: 'po-hp-num', text: '100' });
  const hpFill = h('i');
  const hpEl = h('div', { class: 'po-hp' },
    h('span', { class: 'po-hp-ico', text: '✚', 'aria-hidden': 'true' }),
    h('div', { class: 'po-hp-main' },
      h('div', { class: 'po-hp-top' }, hpNum, h('span', { class: 'po-hp-label', text: '체력' })),
      h('div', { class: 'po-hp-bar' }, hpFill)));

  const wpnName = h('span', { class: 'po-ammo-wpn' });
  const magEl = h('b', { class: 'po-ammo-mag', text: '—' });
  const resEl = h('span', { class: 'po-ammo-res' });
  const ammoHint = h('span', { class: 'po-ammo-hint' });
  const reloadFill = h('i');
  const reloadBar = h('div', { class: 'po-reload', hidden: true }, reloadFill);
  const ammoEl = h('div', { class: 'po-ammo' }, wpnName, h('div', { class: 'po-ammo-row' }, magEl, resEl), reloadBar, ammoHint);

  const slotsEl = h('div', { class: 'po-slots' });
  const slotEls = [1, 2, 3, 4].map((n) => {
    const ico = h('span', { class: 'po-slot-ico' });
    const nm = h('span', { class: 'po-slot-nm', text: '비어 있음' });
    const el = h('div', { class: 'po-slot is-empty' }, h('kbd', { class: 'po-slot-key', text: String(n) }), ico, nm);
    slotsEl.append(el);
    return { el, ico, nm };
  });

  const feed = h('div', { class: 'po-killfeed', 'aria-label': '킬피드' });
  const centerMain = h('div', { class: 'po-center-main' });
  const centerSub = h('div', { class: 'po-center-sub', hidden: true });
  const centerEl = h('div', { class: 'po-center', 'aria-live': 'polite' }, centerMain, centerSub);
  const specEl = h('div', { class: 'po-spec', hidden: true });
  const hintEl = h('div', { class: 'po-hint', hidden: true });

  // 개인전 부활 패널 "💀 해운에게 당했어요 · 3초 뒤 부활" / 부활 직후 보호 "🛡 보호 중"
  const rspMain = h('div', { class: 'po-rsp-main' });
  const rspWpn = h('span', { class: 'po-rsp-wpn', hidden: true });
  const rspNum = h('b', { class: 'po-rsp-num' });
  const rspTxt = h('span', { class: 'po-rsp-txt' });
  const respawnEl = h('div', { class: 'po-rsp', hidden: true, role: 'status' },
    h('div', { class: 'po-rsp-top' }, rspMain, rspWpn),
    h('div', { class: 'po-rsp-line' }, rspNum, rspTxt));
  const protectEl = h('div', { class: 'po-protect', hidden: true, role: 'status', text: '🛡 보호 중' });
  // 이모트 중 하단 안내 "🕺 탱고 · 움직이면 취소"(MODES.md 4.3)
  const emoteEl = h('div', { class: 'po-emote-banner', hidden: true, role: 'status' });

  const el = h('section', { class: 'po-screen po-hud', hidden: true, 'aria-label': 'HUD' },
    vignette, flash, dmgs, xhair, hit, protectEl, top, feed, centerEl, respawnEl, specEl, emoteEl, hintEl, hpEl,
    h('div', { class: 'po-br' }, slotsEl, ammoEl));

  ctx.listen(window, 'resize', () => { viewH = 0; if (st.gap >= 0) applySpread(); });

  // ---------- 적용 ----------
  function applyHp(v) {
    const hp = Math.max(0, Math.round(num(v, 0)));
    if (hp === st.hp && st.maxSeen === st.maxHp) return;
    st.hp = hp;
    st.maxSeen = st.maxHp;
    const r = clamp(hp / st.maxHp, 0, 1);
    setText(hpNum, hp);
    hpFill.style.transform = `scaleX(${r.toFixed(3)})`;
    hpEl.classList.toggle('is-low', r <= 0.3);
    hpEl.classList.toggle('is-crit', r <= 0.15);
    hpEl.classList.toggle('is-dead', hp <= 0);
    vignette.style.opacity = hp <= 0 ? '0' : clamp((0.4 - r) / 0.4, 0, 1).toFixed(3);
    vignette.classList.toggle('is-pulse', hp > 0 && r <= 0.2);
  }

  function applyReload(v) {
    const r = v == null || v === false ? null : clamp(num(v, 0), 0, 1);
    st.reload = r;
    const show = r != null && r < 1;
    reloadBar.hidden = !show;
    if (show) reloadFill.style.transform = `scaleX(${r.toFixed(3)})`;
  }

  function applyAmmo() {
    const a = st.ammo;
    const has = a != null && a !== '' && Number.isFinite(Number(a));
    ammoEl.classList.toggle('is-melee', !has);
    if (!has) {
      setText(magEl, '—');
      setText(resEl, '');
      setText(ammoHint, '');
      ammoEl.classList.remove('is-low', 'is-empty');
      return;
    }
    const ammo = Math.max(0, Math.floor(Number(a)));
    st.magSeen = Math.max(st.magSeen, ammo);
    const mag = num(st.mag, 0) || st.magSeen;
    const res = st.reserve == null || st.reserve === '' ? null : Math.max(0, Math.floor(num(st.reserve, 0)));
    setText(magEl, ammo);
    setText(resEl, res == null ? '' : `/ ${res}`);
    const empty = ammo === 0;
    const low = !empty && mag > 1 && ammo <= Math.max(1, Math.ceil(mag * 0.25));
    ammoEl.classList.toggle('is-empty', empty);
    ammoEl.classList.toggle('is-low', low);
    let hint = '';
    if (st.reloading || (st.reload != null && st.reload < 1)) hint = '재장전 중…';
    else if (empty) hint = res > 0 ? 'R 재장전' : '탄약 없음';
    else if (low && res > 0) hint = 'R 재장전';
    setText(ammoHint, hint);
  }

  function normSlot(s) {
    if (s == null || s === false || s === '') return null;
    const info = weaponInfo(ctx.weapons, s);
    return { id: info.id, icon: info.icon, name: info.short || info.name, full: info.name };
  }
  function applySlots(list) {
    const arr = Array.isArray(list) ? list : list && typeof list === 'object' ? [1, 2, 3, 4].map((n) => list[n]) : [];
    const norm = [0, 1, 2, 3].map((i) => normSlot(arr[i]));
    const sig = JSON.stringify(norm);
    if (sig === st.slotSig) return;
    st.slotSig = sig;
    st.slotList = norm;
    norm.forEach((s, i) => {
      const se = slotEls[i];
      se.el.classList.toggle('is-empty', !s);
      setText(se.ico, s ? s.icon : '');
      setText(se.nm, s ? s.name : '비어 있음');
      se.el.title = s ? s.full : '';
    });
    applyWeaponName();
  }
  function applySlot(n) {
    const v = Math.round(num(n, 0));
    if (v === st.slot) return;
    if (st.slot != null) st.magSeen = 0;
    st.slot = v;
    slotEls.forEach((se, i) => se.el.classList.toggle('is-active', i + 1 === v));
    applyWeaponName();
  }
  function applyWeaponName() {
    const s = st.slotList && st.slot ? st.slotList[st.slot - 1] : null;
    setText(wpnName, st.weaponName != null ? st.weaponName : s ? `${s.icon} ${s.full}` : '');
  }

  function applySpread() {
    let gap;
    if (st.spreadPx != null) gap = num(st.spreadPx, 0);
    else {
      if (!viewH) viewH = ctx.root.clientHeight || window.innerHeight || 800;
      const fovDeg = num(st.fov, 0) || ctx.setting('fov') || 75;
      const half = (clamp(fovDeg, 10, 150) * Math.PI) / 360;
      gap = (Math.tan(clamp(num(st.spread, 0), 0, 1.2)) / Math.tan(half)) * (viewH / 2);
    }
    const g = Math.round(clamp(4 + gap, 4, 200) * 2) / 2;
    if (g === st.gap) return;
    st.gap = g;
    xhair.style.setProperty('--gap', `${g}px`);
  }

  function applyTime(t) {
    const v = t == null || t === '' || !Number.isFinite(Number(t)) ? null : Math.max(0, Math.ceil(Number(t)));
    if (v === st.time) return;
    st.time = v;
    setText(timer, v == null ? '-:--' : fmtTime(v));
    timer.classList.toggle('is-urgent', v != null && v <= 10);
  }

  function applyScore(s) {
    const sc = s || {};
    const ffa = sc.mode === 'ffa';
    if (ffa !== st.ffa) {
      st.ffa = ffa;
      st.scoreSig = '';
      top.classList.toggle('is-ffa', ffa);
    }
    if (ffa) { applyFfaScore(sc); return; }
    const o = Math.max(0, Math.floor(num(sc.owner, 0)));
    const c = Math.max(0, Math.floor(num(sc.charterer, 0)));
    const target = Math.max(1, Math.floor(num(sc.target, 3)));
    const bestOf = Math.max(1, Math.floor(num(sc.bestOf, target * 2 - 1)));
    const round = sc.round != null ? Math.floor(num(sc.round, 0)) : 0;
    const sig = [o, c, target, bestOf, round].join('|');
    if (sig === st.scoreSig) return;
    st.scoreSig = sig;
    setText(sides.owner.score, o);
    setText(sides.charterer.score, c);
    setText(tcSub, `${bestOf}판 ${target}선승${round ? ` · 라운드 ${round}` : ''}`);
    const done = o >= target || c >= target;
    sides.owner.mp.hidden = done || o !== target - 1;
    sides.charterer.mp.hidden = done || c !== target - 1;
    top.setAttribute('aria-label', `선주 ${o} : ${c} 용선자 · ${bestOf}판 ${target}선승`);
  }

  // score: { mode:'ffa', kills, rank, total, leaderName, leaderKills, target }
  function applyFfaScore(sc) {
    const kills = Math.max(0, Math.floor(num(sc.kills, 0)));
    const rank = sc.rank != null && sc.rank !== '' ? Math.max(1, Math.floor(num(sc.rank, 1))) : null;
    const total = sc.total != null && sc.total !== '' ? Math.max(1, Math.floor(num(sc.total, 1))) : null;
    const target = Math.max(1, Math.floor(num(sc.target, FFA_TARGET)));
    const leaderName = sc.leaderName ? String(sc.leaderName) : '';
    const leaderKills = Math.max(0, Math.floor(num(sc.leaderKills, 0)));
    const sig = ['ffa', kills, rank, total, target, leaderName, leaderKills].join('|');
    if (sig === st.scoreSig) return;
    st.scoreSig = sig;
    const rankText = rank == null ? '-' : String(rank);
    const totalText = total == null ? '' : `/${total}`;
    setText(ffaKills, kills);
    setText(ffaGoal, kills >= target ? '목표 달성!' : `목표까지 ${target - kills}킬`);
    setText(ffaRank, rankText);
    setText(ffaTotal, totalText);
    setText(ffaLeader, leaderName ? `1위 ${leaderName} ${leaderKills} / ${target}` : `목표 ${target}킬`);
    ffaStand.classList.toggle('is-leader', rank === 1);
    setText(tcSub, `개인전 · ${target}킬`);
    top.setAttribute('aria-label', `🎯 ${kills}킬 · ${rankText}위${totalText} · ${leaderName ? `1위 ${leaderName} ${leaderKills} / ${target}` : `목표 ${target}킬`}`);
  }

  function weaponByName(name) {
    for (const d of ctx.weapons.values()) if (d.name === name || d.short === name) return d;
    return null;
  }
  // respawn: { seconds, killer?, weaponName?, weaponId? } | null
  function applyRespawn(r) {
    const on = !!r && typeof r === 'object';
    const sec = on ? Math.max(0, Math.ceil(num(r.seconds, 0))) : 0;
    const self = ctx.playerName;
    const killer = on && r.killer && String(r.killer) !== self ? String(r.killer) : '';
    let w = null;
    if (on && r.weaponId != null) w = weaponInfo(ctx.weapons, r.weaponId, r.weaponName ? { weaponName: r.weaponName } : {});
    else if (on && r.weaponName) {
      const d = weaponByName(String(r.weaponName));
      w = d ? weaponInfo(ctx.weapons, d.id, { weaponName: String(r.weaponName) }) : { icon: '', name: String(r.weaponName) };
    }
    const sig = on ? JSON.stringify([sec, killer, w && w.name, w && w.icon]) : '';
    if (sig === st.respSig) return;
    const wasOn = st.respSig !== '';
    st.respSig = sig;
    respawnEl.hidden = !on;
    if (!on) {
      if (wasOn && ctx.hooks && ctx.hooks.respawnEnd) ctx.hooks.respawnEnd(); // 부활 → compact 로드아웃도 닫기
      return;
    }
    setText(rspMain, killer ? `💀 ${killer}에게 당했어요` : '💀 전사했어요');
    rspWpn.hidden = !w;
    if (w) setText(rspWpn, w.icon ? `${w.icon} ${w.name}` : w.name);
    setText(rspNum, sec > 0 ? String(sec) : '');
    setText(rspTxt, sec > 0 ? '초 뒤 부활' : '곧 부활해요…');
    respawnEl.setAttribute('aria-label', `${rspMain.textContent} · ${sec > 0 ? `${sec}초 뒤 부활` : '곧 부활'}`);
  }

  function applyProtect(v) {
    const on = !!v;
    if (on === st.protect) return;
    st.protect = on;
    protectEl.hidden = !on;
    hpEl.classList.toggle('is-protect', on);
  }

  function applyAlive() {
    const a = st.alive || {};
    const z = st.size || {};
    const sig = JSON.stringify([a.owner, a.charterer, z.owner, z.charterer]);
    if (sig === st.aliveSig) return;
    st.aliveSig = sig;
    for (const t of TEAM_KEYS) {
      const n = Math.max(0, Math.floor(num(a[t], 0)));
      const total = Math.min(8, Math.max(n, Math.floor(num(z[t], 0))));
      setText(sides[t].aliveN, a[t] == null ? '' : `생존 ${n}`);
      sides[t].pips.replaceChildren(...Array.from({ length: total }, (_, i) => h('i', { class: i < n ? 'is-alive' : '' })));
    }
  }

  function banner(node, text) {
    setText(node, text || '');
    node.hidden = !text;
  }

  // ---------- 공개 ----------
  function set(p) {
    if (!p || typeof p !== 'object') return;
    if ('maxHp' in p) st.maxHp = Math.max(1, num(p.maxHp, 100));
    if ('hp' in p || 'maxHp' in p) applyHp('hp' in p ? p.hp : st.hp);
    let ammoDirty = false;
    for (const k of ['ammo', 'reserve', 'mag']) if (k in p) { st[k] = p[k]; ammoDirty = true; }
    if ('reloading' in p) { st.reloading = !!p.reloading; ammoDirty = true; }
    if ('reload' in p) { applyReload(p.reload); ammoDirty = true; }
    if ('slots' in p) applySlots(p.slots);
    if ('slot' in p) { applySlot(p.slot); ammoDirty = true; }
    if ('weaponName' in p) { st.weaponName = p.weaponName == null ? null : String(p.weaponName); applyWeaponName(); }
    if (ammoDirty) applyAmmo();
    if ('spread' in p) st.spread = p.spread;
    if ('spreadPx' in p) st.spreadPx = p.spreadPx;
    if ('fov' in p) st.fov = p.fov;
    if ('spread' in p || 'spreadPx' in p || 'fov' in p || st.gap < 0) applySpread();
    if ('roundTime' in p) applyTime(p.roundTime);
    if ('score' in p) applyScore(p.score);
    if ('alive' in p) st.alive = p.alive;
    if ('teamSize' in p) st.size = p.teamSize;
    if ('alive' in p || 'teamSize' in p) applyAlive();
    if ('team' in p && teamKey(p.team) !== st.team) {
      st.team = teamKey(p.team);
      for (const t of TEAM_KEYS) sides[t].el.classList.toggle('is-mine', t === st.team);
    }
    if ('hint' in p) banner(hintEl, p.hint);
    if ('spectate' in p) banner(specEl, p.spectate ? `👁️ 관전 중 · ${p.spectate}` : '');
    if ('crosshair' in p) xhair.hidden = p.crosshair === false;
    if ('respawn' in p) applyRespawn(p.respawn);
    if ('protect' in p) applyProtect(p.protect);
    if ('emote' in p) {
      // emote: { name, icon } | null — 아이콘이 없으면 🕺
      const e = p.emote && typeof p.emote === 'object' ? p.emote : null;
      const name = e ? String(e.name || e.id || '') : '';
      banner(emoteEl, name ? `${e.icon || '🕺'} ${name} · 움직이면 취소` : '');
      el.classList.toggle('is-emote', !!name); // 이모트 중(3인칭)에는 크로스헤어·히트마커를 숨긴다
    }
  }

  function hitmarker(head = false, kill = false) {
    hit.classList.toggle('is-head', !!head);
    hit.classList.toggle('is-kill', !!kill);
    if (!hit.animate) return;
    if (st.hitAnim) st.hitAnim.cancel();
    st.hitAnim = hit.animate([
      { opacity: 1, transform: 'scale(1.4)' },
      { opacity: 1, transform: 'scale(1)', offset: 0.35 },
      { opacity: 0, transform: 'scale(1)' },
    ], { duration: head || kill ? 440 : 260, easing: 'ease-out' });
  }

  function damageFrom(angle) {
    const d = h('div', { class: 'po-dmg', style: { transform: `rotate(${num(angle, 0)}rad)` } }, h('i'));
    dmgs.append(d);
    while (dmgs.children.length > DMG_MAX) dmgs.firstElementChild.remove();
    if (d.animate) {
      d.animate([{ opacity: 1 }, { opacity: 1, offset: 0.3 }, { opacity: 0 }], { duration: 1300, easing: 'ease-in' })
        .onfinish = () => d.remove();
    } else ctx.later(() => d.remove(), 1300);
    if (flash.animate) flash.animate([{ opacity: 0.65 }, { opacity: 0 }], { duration: 380, easing: 'ease-out' });
  }

  function center(text, ms, opts) {
    if (ms && typeof ms === 'object') { opts = ms; ms = opts.ms; }
    const o = opts || {};
    if (st.centerTimer != null) { ctx.cancel(st.centerTimer); st.centerTimer = null; }
    if (!text) { centerEl.classList.remove('is-show'); return; }
    setText(centerMain, text);
    setText(centerSub, o.sub || '');
    centerSub.hidden = !o.sub;
    centerEl.dataset.tone = o.tone || autoTone(String(text));
    centerEl.classList.remove('is-show');
    void centerEl.offsetWidth; // 애니메이션 재시작
    centerEl.classList.add('is-show');
    const dur = ms == null ? 2000 : Number(ms);
    if (Number.isFinite(dur) && dur > 0) {
      st.centerTimer = ctx.later(() => { st.centerTimer = null; centerEl.classList.remove('is-show'); }, dur);
    }
  }

  function pushKill(k) {
    if (!k) return;
    // 개인전이면(k.mode === 'ffa', 생략 시 HUD score.mode를 따름) 팀 색 없이 중립
    const ffa = k.mode === 'ffa' || (k.mode == null && st.ffa);
    const kt = ffa ? 'ffa' : teamKey(k.killerTeam) || 'none';
    const vt = ffa ? 'ffa' : teamKey(k.victimTeam) || 'none';
    const self = ctx.playerName;
    const mine = k.mine != null ? !!k.mine : !!self && (k.killer === self || k.victim === self);
    const w = weaponInfo(ctx.weapons, k.weaponId, k);
    const suicide = !k.killer || k.killer === k.victim;
    const row = h('div', { class: 'po-kf' + (mine ? ' is-mine' : '') + (k.head ? ' is-head' : '') + (ffa ? ' is-ffa' : '') },
      suicide ? null : h('span', { class: `po-kf-name t-${kt}`, text: k.killer }),
      h('span', { class: 'po-kf-wpn', title: w.name },
        h('span', { class: 'po-kf-ico', text: w.icon, 'aria-hidden': 'true' }),
        w.short ? h('span', { class: 'po-kf-wn', text: w.short }) : null),
      k.head ? headshotIcon() : null,
      h('span', { class: `po-kf-name t-${vt}`, text: k.victim == null ? '' : k.victim }));
    feed.append(row);
    while (feed.children.length > KILLFEED_MAX) feed.firstElementChild.remove();
    ctx.later(() => {
      row.classList.add('is-out');
      ctx.later(() => row.remove(), 400);
    }, KILLFEED_MS);
  }

  function reset() {
    feed.replaceChildren();
    dmgs.replaceChildren();
    center('');
    banner(hintEl, '');
    banner(specEl, '');
    applyRespawn(null);
    applyProtect(false);
    banner(emoteEl, '');
    el.classList.remove('is-emote');
  }

  const screen = makeScreen(el, { render: (_props, { patch }) => set(patch) });
  return Object.assign(screen, {
    set, hitmarker, damageFrom, center, reset,
    killfeed: { push: pushKill, clear: () => feed.replaceChildren() },
  });
}
