/**
 * ⚓ Port Ops — 연습장 봇전 (싱글플레이)
 *
 *   const practice = createPractice({ ctx, world, ui });
 *   ctx.registerScreen('sandbox', { enter: (p) => practice.enter(p), exit: () => practice.exit() });
 *   const setup = createPracticeSetup({ ui, maps: ctx.maps, onStart: (o) => ctx.setScreen('sandbox', o) });
 *
 * - 로컬 match.js(5판 3선승)를 이 탭에서 직접 돌린다(방장 = 나). loadout → live → roundEnd → … → matchEnd(결과 화면).
 * - 봇: bots.js 두뇌를 10 Hz로 생각시키고(봇마다 위상을 엇갈림), 이동은 engine physics.moveCharacter로 매 틱.
 *   사격은 봇마다 weapons/logic arsenal → physics.traceShot → match.claimHit. 연출은 world.actorFire.
 * - 내 사격·칼·수류탄 판정은 World가 하고('hitClaim'·'explosion'), 여기서 match에 넣는다.
 *
 * params(enter): { mapId, size(1~4, 팀당 인원), difficulty('easy'|'normal'|'hard'), timeScale(1~8, 시험용), botWeapon('mix'|'dwt47'|'nor1') }
 * URL(시험용, params가 우선): ?sandbox=<mapId>&bots=1&difficulty=hard&timescale=4&botweapon=dwt47
 */
import { PLAYER } from '../core/consts.js';
import { moveCharacter, traceShot, lineOfSight, findFloor } from '../engine/physics.js';
import { createArsenal, shotDirection, dirFromYawPitch } from '../weapons/logic.js';
import { throwVelocity } from '../weapons/grenade.js';
import { createMatch, standings, REASON_LABELS } from './match.js';
import { createBot } from './bots.js';
import { buildNavGrid } from './navgrid.js';
import { meleeTrace } from './world.js';
import { h, btn } from '../ui/dom.js';
import { sheet, createModal, mapCard } from '../ui/parts.js';

export const PRACTICE_DEFAULTS = Object.freeze({ mapId: 'tankfarm', size: 2, difficulty: 'normal', timeScale: 1 });
const DIFFS = ['easy', 'normal', 'hard'];
const PREF_KEY = 'portops.practice.v1';
const THINK_DT = 0.1;                    // 봇 판단 주기 10 Hz
const TEAM_NAME = { owner: '선주', charterer: '용선자' };
const BOT_NAMES = {
  owner: ['갑판장', '도선사', '기관사'],
  charterer: ['검정사', '하역반장', '예인선장', '검수원']
};
const PITCH_LIMIT = (89 * Math.PI) / 180;
const IDLE = Object.freeze({ forward: 0, strafe: 0, jump: false, walk: false, yawDelta: 0, pitchDelta: 0, fire: false, zoom: false, reload: false, slot: null });

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const num = (v, d) => (Number.isFinite(+v) && v !== null && v !== '' ? +v : d);
function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(PREF_KEY) || 'null');
    if (p && typeof p === 'object') return { ...PRACTICE_DEFAULTS, ...p };
  } catch (e) { /* ignore */ }
  return { ...PRACTICE_DEFAULTS };
}
function savePrefs(p) {
  try { localStorage.setItem(PREF_KEY, JSON.stringify({ mapId: p.mapId, size: p.size, difficulty: p.difficulty })); } catch (e) { /* ignore */ }
}

/** params + URL(시험용) → 정규화된 옵션 */
export function practiceOptions(params = {}) {
  const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
  const prefs = loadPrefs();
  // 우선순위: 직접 준 params → URL(시험용) → 지난 선택 → 기본값
  const mapId = String(params.mapId || q.get('sandbox') || prefs.mapId || PRACTICE_DEFAULTS.mapId);
  const size = clamp(Math.round(num(params.size, num(params.bots, num(q.get('bots'), num(prefs.size, 2))))), 1, 4);
  const dq = q.get('difficulty');
  const difficulty = DIFFS.includes(params.difficulty) ? params.difficulty : DIFFS.includes(dq) ? dq : DIFFS.includes(prefs.difficulty) ? prefs.difficulty : 'normal';
  const timeScale = clamp(Math.round(num(params.timeScale, num(q.get('timescale'), 1))), 1, 8);
  // 봇 주무기: mix(기본, 30% 저격) · dwt47 · nor1
  const bw = params.botWeapon || q.get('botweapon');
  const botWeapon = bw === 'dwt47' || bw === 'nor1' ? bw : 'mix';
  return { mapId, size, difficulty, timeScale, botWeapon };
}

export function createPractice({ ctx, world, ui }) {
  const navCache = new WeakMap();
  let run = null;

  function navFor(data) {
    let nav = navCache.get(data);
    if (!nav) {
      const t0 = performance.now();
      nav = buildNavGrid(data);
      navCache.set(data, nav);
      console.info(`[practice] navgrid ${data.id || '?'} ${Math.round(performance.now() - t0)} ms`, nav.info && nav.info.nodes);
    }
    return nav;
  }

  async function enter(params = {}) {
    const opts = practiceOptions(params);
    const info = await world.loadMap(opts.mapId);
    run = startRun(opts, info);
  }

  function exit() {
    if (run) { run.dispose(); run = null; }
    world.unloadMap();
  }

  function restart() {
    if (!run) return;
    const { opts, info } = run;
    run.dispose();
    world.reset();
    if (ui) ui.show('hud', {});
    run = startRun(opts, info);
  }

  /* ============================================================ 한 판 */
  function startRun(opts, info) {
    const map = info.map;
    const nav = navFor(info.data);
    const rng = mulberry32((Date.now() ^ 0x5f3759df) >>> 0);
    const me = { id: world.localId, name: ctx.session.name || '나', team: 'owner' };
    const offs = [];
    let disposed = false, paused = false;
    let phase = 'warmup', round = 0, phaseEndsAt = 0, simMs = 0, stepCount = 0;
    let score = { owner: 0, charterer: 0 };
    let lastPick = run && run.lastPick ? run.lastPick : 'dwt47';
    let resultsAt = 0, resultsEv = null;
    const alive = new Map();                 // id → bool (이번 라운드)
    const spawnOf = new Map();               // id → 이번 라운드 스폰
    const los = (a, b) => lineOfSight(map.world, a, b);

    /* ---------- 봇 ---------- */
    const bots = [];
    const total = opts.size * 2 - 1;
    function makeBot(team, k) {
      const id = `bot-${team === 'owner' ? 'o' : 'c'}${k + 1}`;
      const name = `${BOT_NAMES[team][k] || '선원'} 봇`;
      const primary = opts.botWeapon === 'mix' ? (rng() < 0.3 ? 'nor1' : 'dwt47') : opts.botWeapon;
      const i = bots.length;
      return {
        id, name, team, primary,
        brain: createBot({ id, team, difficulty: opts.difficulty, primary, seed: (rng() * 4294967296) >>> 0 }),
        arsenal: createArsenal({ primary, zoomMode: 'hold', rng }),
        body: { pos: [0, 0, 0], vel: [0, 0, 0], onGround: true },
        yaw: 0, pitch: 0, hp: PLAYER.HP, alive: true,
        cmd: IDLE, thinkAcc: (i / Math.max(1, total)) * THINK_DT,
        yawRate: 0, pitchRate: 0, rateTicks: 0,
        edge: { reload: false, slot: null, jump: false }
      };
    }
    for (let k = 0; k < opts.size - 1; k++) bots.push(makeBot('owner', k));
    for (let k = 0; k < opts.size; k++) bots.push(makeBot('charterer', k));
    const botById = new Map(bots.map((b) => [b.id, b]));
    for (const b of bots) world.addActor({ id: b.id, name: b.name, team: b.team, kind: 'bot' });

    const match = createMatch({
      players: [{ id: me.id, name: me.name, team: me.team }, ...bots.map((b) => ({ id: b.id, name: b.name, team: b.team, bot: true }))],
      spawns: map.spawns
    });

    /* ---------- 위치·대상 ---------- */
    const eyeOf = (b) => [b.body.pos[0], b.body.pos[1] + PLAYER.EYE, b.body.pos[2]];
    function posOf(id) {
      if (id === me.id) return ctx.player.state.pos;
      const b = botById.get(id);
      return b ? b.body.pos : null;
    }
    const meAlive = () => !!alive.get(me.id) && world.localAlive;
    /** 봇 b가 쏠 수 있는 대상(자기 제외, 살아 있는 모두 — 아군 사격은 match가 거른다) */
    function targetsFor(b) {
      const out = [];
      if (meAlive()) out.push({ id: me.id, pos: ctx.player.state.pos, yaw: ctx.player.state.yaw, alive: true });
      for (const o of bots) if (o !== b && o.alive) out.push({ id: o.id, pos: o.body.pos, yaw: o.yaw, alive: true });
      return out;
    }
    function botView(b) {
      const enemies = [], allies = [];
      const mine = { id: me.id, pos: ctx.player.state.pos, alive: meAlive(), team: me.team };
      (me.team === b.team ? allies : enemies).push(mine);
      for (const o of bots) {
        if (o === b) continue;
        (o.team === b.team ? allies : enemies).push({ id: o.id, pos: o.body.pos, alive: o.alive, team: o.team });
      }
      const a = b.arsenal;
      return {
        self: {
          pos: b.body.pos, vel: b.body.vel, yaw: b.yaw, pitch: b.pitch, hp: b.hp, alive: b.alive,
          slot: a.getWeapon().slot, ammo: a.getAmmo(), weapon: a.getWeapon(), zoom: a.getZoom().progress,
          recoil: a.getRecoilKick(), grenades: a.getAmmo('bunker').mag
        },
        enemies, allies, nav, los
      };
    }
    function hear(origin, shooterId, team) {
      for (const b of bots) if (b.alive && b.id !== shooterId) b.brain.hearShot(origin, { id: shooterId, team });
    }

    /* ---------- 이벤트 → 화면 ---------- */
    function aliveCounts() {
      const c = { owner: 0, charterer: 0 };
      if (alive.get(me.id)) c[me.team]++;
      for (const b of bots) if (alive.get(b.id)) c[b.team]++;
      return c;
    }
    function pushRound() {
      world.setRound({
        phase, round, score,
        timeLeftMs: phase === 'warmup' || phase === 'matchEnd' ? null : Math.max(0, phaseEndsAt - simMs) / opts.timeScale,
        alive: aliveCounts(), teamSize: { owner: opts.size, charterer: opts.size },
        roundsToWin: match.rules.roundsToWin, maxRounds: match.rules.maxRounds
      });
    }
    function apply(evs) {
      if (!evs || !evs.length || disposed) return;
      for (const ev of evs) {
        try {
          switch (ev.type) {
            case 'roundStart': onRoundStart(ev); break;
            case 'phase': onPhase(ev); break;
            case 'damage': onDamage(ev); break;
            case 'kill': onKill(ev); break;
            case 'roundEnd': onRoundEnd(ev); break;
            case 'matchEnd': onMatchEnd(ev); break;
            case 'reject': if (ctx.flags && ctx.flags.debug) console.debug('[practice] reject', ev); break;
            default: break;
          }
        } catch (err) { console.error('[practice] 이벤트 처리 오류', ev && ev.type, err); }
      }
    }

    function onRoundStart(ev) {
      round = ev.round;
      if (ev.score) score = { ...ev.score };
      world.reset();
      alive.clear();
      spawnOf.clear();
      const sp = (ev.spawns && ev.spawns[me.id]) || map.spawns[me.team][0];
      spawnOf.set(me.id, sp);
      world.spawnLocal({ id: me.id, name: me.name, team: me.team, spawn: sp, loadout: lastPick });
      alive.set(me.id, true);
      for (const b of bots) {
        const s = (ev.spawns && ev.spawns[b.id]) || map.spawns[b.team][0];
        spawnOf.set(b.id, s);
        placeBot(b, s);
        b.alive = true;
        b.hp = PLAYER.HP;
        alive.set(b.id, true);
        b.arsenal.resetRound({ primary: b.primary, draw: false });
        b.arsenal.update(0, {}, { speed: 0, onGround: true });
        b.brain.reset();
        b.cmd = IDLE; b.rateTicks = 0;
        b.edge.reload = false; b.edge.slot = null; b.edge.jump = false;
        world.setActorState(b.id, { pos: b.body.pos, yaw: b.yaw, pitch: 0, alive: true, teleport: true });
      }
      if (ui) ui.hud.center(ev.replay ? `라운드 ${round} · 재경기` : `라운드 ${round}`, 2200, { sub: '주무기를 고르세요' });
    }
    function placeBot(b, s) {
      const x = num(s.x, 0), z = num(s.z, 0);
      const y = Number.isFinite(s.y) ? s.y : findFloor(map.world, x, z);
      b.body.pos[0] = x; b.body.pos[1] = y; b.body.pos[2] = z;
      b.body.vel[0] = b.body.vel[1] = b.body.vel[2] = 0;
      b.body.onGround = true;
      b.yaw = num(s.rotY, 0); b.pitch = 0;
    }

    function onPhase(ev) {
      phase = ev.phase;
      phaseEndsAt = simMs + num(ev.durationMs, 0);
      if (phase === 'loadout') {
        for (const b of bots) match.setLoadout(b.id, b.primary);
        if (ui) {
          const secs = Math.max(1, Math.floor(num(ev.durationMs, 5000) / 1000 / opts.timeScale) - 1);
          ui.show('loadout', { weapons: ['nor1', 'dwt47'], seconds: secs, selected: lastPick, round });
        }
      } else if (phase === 'live') {
        if (ui && ui.isVisible('loadout')) ui.hide('loadout');
        const lo = ev.loadouts || {};
        if (lo[me.id]) { world.setLocalLoadout(lo[me.id]); lastPick = lo[me.id]; }
        for (const b of bots) if (lo[b.id] && lo[b.id] !== b.arsenal.getPrimary()) b.arsenal.setPrimary(lo[b.id]);
        world.sound('round_start');
        if (ui) ui.hud.center('작전 개시!', 1400, { sub: `라운드 ${round} · ${TEAM_NAME[me.team]} 팀` });
      } else if (phase === 'matchEnd') {
        if (ui && ui.isVisible('loadout')) ui.hide('loadout');
      }
      pushRound();
    }

    function onDamage(ev) {
      const ap = ev.center ? [ev.center.x, ev.center.y, ev.center.z] : posOf(ev.attacker);
      if (ev.victim === me.id) {
        world.setLocalHp(ev.hp);
        world.feedbackDamage({ attackerPos: ap ? ap.slice() : null, amount: ev.amount, incoming: true });
      } else {
        const b = botById.get(ev.victim);
        if (b) { b.hp = ev.hp; if (ap) b.brain.onDamage({ from: ap.slice() }); }
      }
      if (ev.attacker === me.id && ev.victim !== me.id) {
        world.feedbackDamage({ amount: ev.amount, head: ev.part === 'head', kill: ev.hp <= 0, incoming: false });
      }
    }

    function onKill(ev) {
      if (ui) ui.killfeed.push({ killer: ev.killerName, victim: ev.victimName, weaponId: ev.weaponId, head: ev.head, killerTeam: ev.killerTeam, victimTeam: ev.victimTeam });
      alive.set(ev.victim, false);
      const kp = posOf(ev.killer), vp = posOf(ev.victim);
      const dir = kp && vp && ev.killer !== ev.victim ? [vp[0] - kp[0], vp[2] - kp[2]] : null;
      if (ev.victim === me.id) world.killLocal({ killerId: ev.killer, dir });
      else {
        const b = botById.get(ev.victim);
        if (b) { b.alive = false; b.hp = 0; world.actorDeath(b.id, { dir }); }
      }
      pushRound();
    }

    function onRoundEnd(ev) {
      if (ev.score) score = { ...ev.score };
      const won = ev.winner === me.team;
      const text = ev.winner ? `${TEAM_NAME[ev.winner]} 승리` : '무승부 — 재경기';
      const sub = `${REASON_LABELS[ev.reason] || ev.reason}${ev.final ? ' · 매치 결정' : ''} · ${score.owner} : ${score.charterer}`;
      if (ui) ui.hud.center(text, 3600, { sub, tone: ev.winner || 'warn' });
      world.sound(won ? 'round_win' : 'round_lose');
    }

    function onMatchEnd(ev) {
      resultsEv = ev;
      resultsAt = performance.now() + 2200;
      const text = ev.winner ? (ev.winner === me.team ? '🏆 매치 승리!' : '매치 패배') : '매치 무승부';
      if (ui) ui.hud.center(text, 0, { sub: `${TEAM_NAME.owner} ${ev.score.owner} : ${ev.score.charterer} ${TEAM_NAME.charterer}`, tone: ev.winner || 'warn' });
    }

    function showResults() {
      resultsAt = 0;
      if (!ui) return;
      const view = match.state;
      const { stats, mvp } = standings(view);
      const res = view.result || {};
      ui.show('results', {
        winner: res.winner || (resultsEv && resultsEv.winner) || 'draw',
        score: view.score,
        rounds: view.history.map((r) => ({ winner: r.winner || 'draw', reason: REASON_LABELS[r.reason] || r.reason })),
        players: stats.map((s) => ({ ...s, head: s.headshots, me: s.id === me.id })),
        mvp: mvp ? { name: mvp.name, team: mvp.team, kills: mvp.kills, deaths: mvp.deaths, head: mvp.headshots } : undefined,
        myTeam: me.team, mapId: opts.mapId, meId: me.id,
        backLabel: '🔁 다시 하기', lobbyLabel: '메뉴로'
      });
    }

    /* ---------- 내 판정 → match ---------- */
    offs.push(world.on('hitClaim', (c) => {
      apply(match.claimHit({ attackerId: me.id, victimId: c.victimId, weaponId: c.weaponId, part: c.part, dist: c.dist, kind: c.kind }));
    }));
    offs.push(world.on('explosion', (x) => {
      apply(match.claimExplosion({ attackerId: x.ownerId, center: x.center, victims: x.victims.map((v) => ({ id: v.id, dmg: v.dmg })) }));
    }));
    offs.push(world.on('fire', (f) => { if (f.weaponId !== 'hawser') hear(f.origin, me.id, me.team); }));
    offs.push(world.on('loadoutPick', (p) => {
      if (p && p.id) { lastPick = p.id; apply(match.setLoadout(me.id, p.id)); }
    }));
    offs.push(world.on('pause', (p) => { paused = !!(p && p.paused); world.setPaused(paused); }));
    offs.push(world.on('leave', () => { ctx.setScreen('menu'); }));
    if (ui) {
      offs.push(ui.on('results:back', () => { if (!disposed) restart(); }));
      offs.push(ui.on('results:lobby', () => { if (!disposed) ctx.setScreen('menu'); }));
    }
    world.setPauseOptions({ leaveLabel: '연습장 나가기', note: '연습장은 일시정지하면 봇도 멈춰요.' });
    world.setControlsEnabled(true);
    world.setHint('');
    world.setScoreboard(() => {
      const view = match.state;
      return {
        players: view.players.map((p) => ({ id: p.id, name: p.name, team: p.team, kills: p.kills, deaths: p.deaths, head: p.headshots, ping: p.bot ? null : 0, alive: p.alive, me: p.id === me.id, bot: p.bot })),
        score: view.score, round: view.round, mapId: opts.mapId, meId: me.id
      };
    });

    /* ---------- 봇 시뮬레이션 ---------- */
    const wish = { x: 0, z: 0, jump: false };
    function stepBot(b, dt) {
      if (!b.alive) return;
      const live = phase === 'live';
      if (live) {
        b.thinkAcc += dt;
        if (b.thinkAcc >= THINK_DT - 1e-6) {
          const tdt = Math.min(0.1, b.thinkAcc);
          b.thinkAcc = 0;
          let out = IDLE;
          try { out = b.brain.think(tdt, botView(b)) || IDLE; } catch (err) { console.error('[practice] bot think', err); }
          b.cmd = out;
          const n = Math.max(1, Math.round(tdt / dt));
          b.yawRate = num(out.yawDelta, 0) / n;
          b.pitchRate = num(out.pitchDelta, 0) / n;
          b.rateTicks = n;
          if (out.reload) b.edge.reload = true;
          if (out.slot) b.edge.slot = out.slot;
          if (out.jump) b.edge.jump = true;
        }
      } else if (b.cmd !== IDLE) { b.cmd = IDLE; b.rateTicks = 0; }
      // 시점: 판단 사이 틱에 나눠서 돈다(부드럽게)
      if (b.rateTicks > 0) {
        b.yaw += b.yawRate;
        b.pitch = clamp(b.pitch + b.pitchRate, -PITCH_LIMIT, PITCH_LIMIT);
        b.rateTicks--;
      }
      if (b.yaw > Math.PI * 4 || b.yaw < -Math.PI * 4) b.yaw %= Math.PI * 2;
      // 이동
      const c = b.cmd;
      const a = b.arsenal;
      const speed = (c.walk ? PLAYER.SLOW_WALK : PLAYER.WALK) * a.getMoveMul();
      let f = clamp(num(c.forward, 0), -1, 1), s = clamp(num(c.strafe, 0), -1, 1);
      const len = Math.hypot(f, s);
      if (len > 1) { f /= len; s /= len; }
      const sy = Math.sin(b.yaw), cy = Math.cos(b.yaw);
      wish.x = (-sy * f + cy * s) * speed;
      wish.z = (-cy * f - sy * s) * speed;
      wish.jump = live && b.edge.jump && b.body.onGround;
      b.edge.jump = false;
      moveCharacter(map.world, b.body, wish, dt);
      if (b.body.pos[1] < -30) placeBot(b, spawnOf.get(b.id) || map.spawns[b.team][0]);
      // 무기
      const hs = Math.hypot(b.body.vel[0], b.body.vel[2]);
      const wi = {
        fireDown: live && !!c.fire, zoomDown: live && !!c.zoom,
        reloadPressed: b.edge.reload, slot: b.edge.slot, wheel: 0
      };
      b.edge.reload = false; b.edge.slot = null;
      const evs = a.update(dt, wi, { speed: hs, onGround: b.body.onGround, walking: !!c.walk });
      for (const ev of evs) botWeaponEvent(b, ev);
      if (b.alive) world.setActorState(b.id, { pos: b.body.pos, yaw: b.yaw, pitch: b.pitch, alive: true, moving: hs > 0.3, walking: !!c.walk, onGround: b.body.onGround, hp: b.hp });
    }

    function botWeaponEvent(b, ev) {
      switch (ev.type) {
        case 'fire': {
          const e = eyeOf(b);
          const dv = shotDirection(b.yaw, b.pitch, ev, 0);
          const d = [dv[0], dv[1], dv[2]];
          const hit = traceShot(map.world, e, d, num(ev.maxRange, 250), targetsFor(b));
          world.actorFire({
            id: b.id, weaponId: ev.weaponId, origin: e, dir: d,
            hitPoint: hit.kind === 'none' ? null : hit.point, hitKind: hit.kind,
            victimId: hit.kind === 'player' ? hit.id : undefined, normal: hit.normal, mat: hit.mat
          });
          hear(e, b.id, b.team);
          if (hit.kind === 'player') apply(match.claimHit({ attackerId: b.id, victimId: hit.id, weaponId: ev.weaponId, part: hit.part, dist: hit.dist }));
          break;
        }
        case 'swing': world.actorFire({ id: b.id, weaponId: 'hawser', origin: eyeOf(b), dir: dirFromYawPitch(b.yaw, b.pitch) }); break;
        case 'melee': {
          const e = eyeOf(b);
          const hit = meleeTrace(map.world, e, dirFromYawPitch(b.yaw, b.pitch), num(ev.range, 1.8), num(ev.arc, 0.6), targetsFor(b), b.id);
          if (hit) {
            world.sound('knife_hit', { pos: hit.point });
            apply(match.claimHit({ attackerId: b.id, victimId: hit.id, weaponId: 'hawser', dist: hit.dist, kind: ev.kind }));
          }
          break;
        }
        case 'throw': {
          const e = eyeOf(b);
          const f = dirFromYawPitch(b.yaw, b.pitch);
          let start = [e[0] + f[0] * 0.3, e[1] + f[1] * 0.3 - 0.06, e[2] + f[2] * 0.3];
          if (!lineOfSight(map.world, e, start)) start = e;
          const v = throwVelocity(f, ev.speed, ev.pitchUp, b.body.vel, 0.5);
          world.actorGrenade({ id: b.id, pos: start, vel: [v[0], v[1], v[2]], fuse: ev.fuse });
          break;
        }
        case 'prime': world.sound('grenade_pin', { pos: eyeOf(b) }); break;
        case 'reloadStart': world.sound('reload_mag_out', { pos: eyeOf(b) }); break;
        case 'boltCycle': world.sound('bolt', { pos: eyeOf(b) }); break;
        default: break;
      }
    }

    function step(dt) {
      simMs += dt * 1000;
      apply(match.tick(dt * 1000));
      if (disposed) return;
      for (const b of bots) stepBot(b, dt);
      if (++stepCount % 6 === 0) pushRound();
    }
    const stats = { ticks: 0, ms: 0, maxMs: 0 };   // 봇·경기 시뮬레이션 비용(성능 확인용)
    offs.push(ctx.onTick((dt) => {
      if (disposed) return;
      if (resultsAt && performance.now() >= resultsAt) showResults();
      if (paused) return;
      const t0 = performance.now();
      for (let i = 0; i < opts.timeScale && !disposed; i++) step(dt);
      const ms = performance.now() - t0;
      stats.ticks++; stats.ms += ms; if (ms > stats.maxMs) stats.maxMs = ms;
    }, -80));

    /* ---------- 시작 ---------- */
    apply(match.start());

    const r = {
      opts, info, match, bots,
      get lastPick() { return lastPick; },
      get phase() { return phase; },
      get round() { return round; },
      get score() { return { ...score }; },
      get paused() { return paused; },
      get stats() { return { ticks: stats.ticks, avgMs: stats.ticks ? +(stats.ms / stats.ticks).toFixed(3) : 0, maxMs: +stats.maxMs.toFixed(2) }; },
      dispose() {
        if (disposed) return;
        disposed = true;
        offs.forEach((o) => { try { o(); } catch (e) { /* ignore */ } });
        offs.length = 0;
        world.setScoreboard(null);
        world.setPaused(false);
        world.setPauseOptions({});
        world.setRound({ phase: null, timeLeftMs: null });
        for (const b of bots) { world.removeActor(b.id); b.brain.dispose(); b.arsenal.dispose(); }
        match.dispose();
      }
    };
    return r;
  }

  return {
    enter, exit, restart,
    get run() { return run; },
    get active() { return !!run; }
  };
}

/* ============================================================ 시작 설정 시트 (맵 · 인원 · 난이도) */

/**
 * 메뉴의 '🎯 연습장'을 누르면 여는 설정 시트. UI 모듈의 부품(sheet·mapCard·po-seg)을 그대로 쓴다.
 * @param {{ ui, maps, onStart:(opts)=>void }} o
 */
export function createPracticeSetup({ ui, maps, onStart }) {
  const modal = createModal();
  ui.el.append(modal.el);
  let sel = loadPrefs();

  function field(label, control) {
    return h('div', { class: 'po-field' }, h('span', { class: 'po-field-label', text: label }), control);
  }
  function seg(items, key, label) {
    const box = h('div', { class: 'po-seg', role: 'radiogroup', 'aria-label': label });
    const draw = () => box.replaceChildren(...items.map(([v, text]) => btn(text, () => { sel[key] = v; draw(); },
      'po-seg-btn' + (sel[key] === v ? ' is-on' : ''), { role: 'radio', 'aria-checked': sel[key] === v ? 'true' : 'false' })));
    draw();
    return box;
  }

  function build() {
    const list = (maps.MAP_LIST || []).filter((m) => !m.test);
    if (!list.some((m) => m.id === sel.mapId)) sel.mapId = (list[0] && list[0].id) || PRACTICE_DEFAULTS.mapId;
    const mapBox = h('div', { class: 'po-mapcards', role: 'radiogroup', 'aria-label': '맵 선택' });
    const drawMaps = () => mapBox.replaceChildren(...list.map((m) => mapCard(m, { selected: m.id === sel.mapId, onPick: (id) => { sel.mapId = id; drawMaps(); } })));
    drawMaps();
    const start = btn('🎯 출격', () => {
      savePrefs(sel);
      modal.close();
      onStart({ mapId: sel.mapId, size: sel.size, difficulty: sel.difficulty });
    }, 'po-btn--primary', { 'data-autofocus': '' });
    return sheet({
      title: '🎯 연습장 · 봇전',
      body: [
        field('맵', mapBox),
        field('인원 (나 + 봇)', seg([[1, '1 vs 1'], [2, '2 vs 2'], [3, '3 vs 3'], [4, '4 vs 4']], 'size', '인원')),
        field('봇 난이도', seg([['easy', '쉬움'], ['normal', '보통'], ['hard', '어려움']], 'difficulty', '난이도')),
        h('p', { class: 'po-field-hint', text: '5판 3선승 · 라운드 2분 · 나와 아군 봇은 🟦 선주, 적 봇은 🟧 용선자예요. Esc로 일시정지.' })
      ],
      foot: [btn('취소', () => modal.close(), 'po-btn--ghost'), start],
      onClose: () => modal.close()
    });
  }

  return {
    open() { sel = loadPrefs(); sel.size = clamp(Math.round(num(sel.size, 2)), 1, 4); if (!DIFFS.includes(sel.difficulty)) sel.difficulty = 'normal'; modal.open(build()); },
    close() { modal.close(); },
    get isOpen() { return modal.isOpen; },
    dispose() { modal.close(); modal.el.remove(); }
  };
}

export default createPractice;
