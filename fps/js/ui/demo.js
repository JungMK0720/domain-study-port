// ⚓ 항만 작전 UI 데모(QA 전용) — fps/ui-demo.html 에서 로드
// 목 데이터로 모든 화면을 띄우고, HUD는 가짜 게임 루프로 움직인다.
// URL: ?screen=menu|menu-account|settings|controls|lobby|lobby-empty|lobby-loading|lobby-error|create|
//              room|room-guest|loadout|hud|hud-low|scope|scoreboard|results|pause|tour  &bare=1(QA 패널 숨김)
import { createUI, relativeAngle } from './index.js';
import { h } from './dom.js';

// ---------- 목 데이터 (실제 값은 maps/*, weapons/defs 담당이 제공) ----------
const MAPS = [
  { id: 'jetty', name: '원유 부두', nameEn: 'Crude Jetty', desc: '로딩암이 늘어선 잔교. 긴 부두는 저격, 펌프실은 근접전.' },
  { id: 'tankfarm', name: '탱크 팜', nameEn: 'Tank Farm', desc: '원통 저장탱크 사이 미로. 방유제 너머로 엄폐하라.' },
  { id: 'vlcc', name: 'VLCC 갑판', nameEn: 'VLCC Deck', desc: '초대형 유조선 갑판. 매니폴드 주변이 격전지.' },
];
const WEAPONS = [
  {
    id: 'nor1', slot: 1, name: 'NOR-1 저격소총', short: 'NOR-1', icon: '🎯', tagline: '준비 완료, 한 방.',
    stats: [{ label: '피해', value: '어느 부위든 1발' }, { label: '탄약', value: '5 / 20' }, { label: '볼트', value: '1.2초' }, { label: '반샷', value: '줌 50% 이상' }],
    bars: { power: 100, rate: 12, accuracy: 95, mobility: 55 },
    term: { abbr: 'NOR', en: 'Notice of Readiness', ko: '하역준비완료통지', desc: '(목 데이터) 선박이 도착해 하역 준비가 끝났음을 알리는 통지. 보통 NOR 제출 후 정해진 시간이 지나면 정박 기간(Laytime) 계산이 시작된다.' },
  },
  {
    id: 'dwt47', slot: 1, name: 'DWT-47 돌격소총', short: 'DWT-47', icon: '🔫', tagline: '묵직한 연사.',
    stats: [{ label: '연사', value: '600 rpm' }, { label: '피해', value: '머리 100 · 몸 30' }, { label: '탄약', value: '30 / 90' }, { label: '정조준', value: '2배 줌' }],
    bars: { power: 45, rate: 85, accuracy: 60, mobility: 75 },
    term: { abbr: 'DWT', en: 'Deadweight Tonnage', ko: '재화중량톤수', desc: '(목 데이터) 배가 실을 수 있는 화물·연료·청수 등의 최대 무게. 유조선 크기를 말하는 대표 지표로, VLCC는 약 20만~32만 DWT다.' },
  },
  { id: 'sof9', slot: 2, name: 'SOF-9 권총', short: 'SOF-9', icon: '📋' },
  { id: 'hawser', slot: 3, name: '호서 커터', short: 'HAWSER', icon: '🔪' },
  { id: 'bunker', slot: 4, name: '벙커 수류탄', short: 'BUNKER', icon: '🛢️' },
];
const MAG = { nor1: [5, 20], dwt47: [30, 90], sof9: [12, 36], hawser: [null, null], bunker: [1, 0] };
const OWNERS = ['도선사J', '갑판장', '기관장'];
const CHARTERERS = ['화주대리', '포워더', '하역반장', '검정인'];
const ROOMS = [
  { roomId: 'k7q2', name: '2부두 야간 작전', mapId: 'jetty', hostName: '도선사J', players: 3, max: 8, status: 'waiting' },
  { roomId: 'm3x9', name: '탱크 팜 4:4 고수만', mapId: 'tankfarm', hostName: '갑판장', players: 8, max: 8, status: 'waiting' },
  { roomId: 'p1z5', name: '체선료 내기 한 판', mapId: 'vlcc', hostName: '하역반장', players: 6, max: 6, status: 'playing' },
  { roomId: 'a8c4', name: '초보 환영 · 반샷 연습', mapId: 'jetty', hostName: '검량사', players: 1, max: 4, status: 'waiting' },
];
const CHAT = [
  { system: true, text: '도선사J님이 방을 만들었어요.' },
  { name: '도선사J', team: 'owner', text: '부두 끝 로딩암 쪽 저격 자리 조심하세요' },
  { name: '화주대리', team: 'charterer', text: '펌프실로 돌아서 들어갑시다' },
  { system: true, text: '포워더님이 입장했어요.' },
];

// ---------- 가짜 게임 화면(캔버스) ----------
const canvas = document.getElementById('scene');
function drawScene() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = (canvas.width = Math.round(innerWidth * dpr));
  const hh = (canvas.height = Math.round(innerHeight * dpr));
  const g = canvas.getContext('2d');
  const hz = hh * 0.56;
  const sky = g.createLinearGradient(0, 0, 0, hz);
  sky.addColorStop(0, '#264653'); sky.addColorStop(0.62, '#f4a261'); sky.addColorStop(1, '#ffd6a5');
  g.fillStyle = sky; g.fillRect(0, 0, w, hz);
  g.fillStyle = 'rgba(255,214,165,.9)'; g.beginPath(); g.arc(w * 0.72, hz * 0.86, hh * 0.06, 0, Math.PI * 2); g.fill();
  const sea = g.createLinearGradient(0, hz, 0, hh);
  sea.addColorStop(0, '#2c4f6e'); sea.addColorStop(1, '#0f2238');
  g.fillStyle = sea; g.fillRect(0, hz, w, hh - hz);
  g.fillStyle = 'rgba(255,214,165,.18)';
  for (let i = 0; i < 26; i++) g.fillRect(w * 0.6 + Math.sin(i * 7) * w * 0.1, hz + i * 6 * dpr, w * 0.08 * (1 - i / 30), 2 * dpr);
  g.fillStyle = '#1b2a3a';
  [[0.05, 0.08, 0.1], [0.16, 0.06, 0.07], [0.82, 0.1, 0.12], [0.94, 0.07, 0.08]].forEach(([x, rw, rh]) => g.fillRect(w * x, hz - hh * rh, w * rw, hh * rh));
  g.fillRect(w * 0.3, hz - hh * 0.3, w * 0.008, hh * 0.3);
  g.fillStyle = '#f77f00'; g.beginPath(); g.ellipse(w * 0.304, hz - hh * 0.31, w * 0.006, hh * 0.02, 0, 0, Math.PI * 2); g.fill();
  // 잔교 갑판(원근)
  g.fillStyle = '#5b5f66';
  g.beginPath(); g.moveTo(w * 0.36, hz); g.lineTo(w * 0.64, hz); g.lineTo(w * 1.1, hh); g.lineTo(-w * 0.1, hh); g.closePath(); g.fill();
  g.strokeStyle = 'rgba(0,0,0,.25)'; g.lineWidth = 2 * dpr;
  for (let i = 1; i < 12; i++) { const t = i / 12; const y = hz + (hh - hz) * t * t; g.beginPath(); g.moveTo(w * (0.36 - 0.46 * t * t), y); g.lineTo(w * (0.64 + 0.46 * t * t), y); g.stroke(); }
  g.fillStyle = '#9b2226'; g.fillRect(w * 0.02, hh * 0.5, w * 0.2, hh * 0.32);
  g.fillStyle = 'rgba(0,0,0,.18)'; for (let i = 0; i < 9; i++) g.fillRect(w * (0.03 + i * 0.021), hh * 0.52, w * 0.006, hh * 0.28);
  g.strokeStyle = '#f2c14e'; g.lineWidth = 6 * dpr; g.beginPath(); g.moveTo(w * 0.78, hh * 0.62); g.lineTo(w * 0.98, hh * 0.6); g.stroke();
}
drawScene();
window.addEventListener('resize', drawScene);

// ---------- UI ----------
const ui = createUI(document.getElementById('stage'));

const qs = new URLSearchParams(location.search);
const bare = qs.get('bare') === '1';
const me = { id: 'me', name: '' };
let room = null; // 현재 방(목)
let mode = 'menu'; // 'menu' | 'game'
let sandbox = false;

// 이벤트 로그(QA)
const logList = h('ol', { class: 'qa-log', 'aria-label': '이벤트 로그' });
function log(action, payload) {
  let text = action;
  if (payload !== undefined) {
    try { text += ' ' + JSON.stringify(payload); } catch { /* 순환 참조 무시 */ }
  }
  logList.prepend(h('li', { text: text.length > 160 ? text.slice(0, 157) + '…' : text }));
  while (logList.children.length > 14) logList.lastElementChild.remove();
}
ui.on('*', (payload, action) => log(action, payload));

// ---------- 화면별 목 상태 ----------
function lobbyProps(extra = {}) { return { rooms: ROOMS, ...extra }; }

function makeRoom(asHost) {
  const name = ui.getPlayerName() || '선원1234';
  me.name = name;
  const players = [
    { id: 'h', name: asHost ? name : '도선사J', team: 'owner', ready: true, ping: 24, host: true },
    { id: 'o2', name: '갑판장', team: 'owner', ready: true, ping: 61 },
    { id: 'c1', name: '화주대리', team: 'charterer', ready: true, ping: 95 },
    { id: 'c2', name: '포워더', team: 'charterer', ready: !asHost ? true : true, ping: 172 },
  ];
  if (!asHost) players.push({ id: 'me', name, team: 'charterer', ready: false, ping: 38 });
  room = {
    roomId: asHost ? 'n0w1' : 'k7q2', name: asHost ? `${name}의 작전실` : '2부두 야간 작전', mapId: 'jetty', max: 8,
    hostId: 'h', meId: asHost ? 'h' : 'me', players, chat: CHAT.slice(),
  };
  return room;
}
function showRoom(asHost) { ui.show('room', makeRoom(asHost)); }

function statPlayers() {
  const mk = (name, team, i, alive) => ({ id: `${team}${i}`, name, team, kills: (7 - i * 2 + (team === 'owner' ? 1 : 0)) % 9, deaths: (i + 2) % 5, head: (i + 1) % 4, ping: 20 + i * 37, alive });
  return [
    { id: 'me', name: me.name || ui.getPlayerName() || '선원1234', team: 'owner', kills: 6, deaths: 2, head: 3, ping: 31, alive: true, me: true },
    ...OWNERS.map((n, i) => mk(n, 'owner', i, i !== 1)),
    ...CHARTERERS.map((n, i) => mk(n, 'charterer', i, i < 2)),
  ];
}

// ---------- 가짜 게임 루프 ----------
const game = {
  hp: 100, slot: 1, primary: 'dwt47', ammo: { 1: 30, 2: 12, 3: null, 4: 1 }, reserve: { 1: 90, 2: 36, 3: null, 4: 0 },
  time: 120, spread: 0.012, zoom: 0, zoomTarget: 0, reload: null, score: { owner: 1, charterer: 1, target: 3, round: 3 },
  alive: { owner: 3, charterer: 2 }, teamSize: { owner: 4, charterer: 4 }, last: 0, tick: 0,
};
function slotsList() { return [game.primary, 'sof9', 'hawser', game.ammo[4] > 0 ? 'bunker' : null]; }
function weaponIdForSlot(s) { return slotsList()[s - 1]; }
function setPrimary(id) {
  game.primary = id;
  const [mag, res] = MAG[id] || [30, 90];
  game.ammo[1] = mag; game.reserve[1] = res;
}
function hudState() {
  const wid = weaponIdForSlot(game.slot);
  return {
    hp: game.hp, ammo: game.ammo[game.slot], reserve: game.reserve[game.slot], mag: (MAG[wid] || [])[0],
    slot: game.slot, slots: slotsList(), spread: game.spread, roundTime: game.time, score: game.score,
    alive: game.alive, teamSize: game.teamSize, team: 'owner', reload: game.reload,
  };
}
function loop(t) {
  const dt = Math.min(0.05, (t - (game.last || t)) / 1000);
  game.last = t;
  if (mode === 'game') {
    game.spread += (0.012 - game.spread) * Math.min(1, dt * 6);
    game.zoom += (game.zoomTarget - game.zoom) * Math.min(1, dt * 14);
    if (Math.abs(game.zoom - game.zoomTarget) < 0.002) game.zoom = game.zoomTarget;
    if (game.reload != null) {
      game.reload += dt / 1.6;
      if (game.reload >= 1) {
        const wid = weaponIdForSlot(game.slot);
        const need = (MAG[wid] || [0])[0] - game.ammo[game.slot];
        const take = Math.min(need, game.reserve[game.slot]);
        game.ammo[game.slot] += take; game.reserve[game.slot] -= take; game.reload = null;
      }
    }
    game.tick += dt;
    if (game.tick >= 1 && !ui.isVisible('loadout')) { game.tick = 0; game.time = Math.max(0, game.time - 1); }
    ui.hud.set(hudState());
    ui.scope.set(game.slot === 1 && game.primary === 'nor1' ? game.zoom : 0, 4);
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

function fire() {
  if (game.reload != null) return;
  const a = game.ammo[game.slot];
  if (a == null) { ui.hud.hitmarker(false); return; }
  if (a <= 0) { ui.hud.center('R 키로 재장전', 900); return; }
  game.ammo[game.slot] = a - 1;
  game.spread = Math.min(0.12, game.spread + (game.zoom > 0.5 ? 0.004 : 0.03));
  const r = Math.random();
  if (r < 0.15) {
    ui.hud.hitmarker(true, true);
    ui.killfeed.push({ killer: me.name || ui.getPlayerName(), victim: CHARTERERS[Math.floor(Math.random() * 4)], weaponId: weaponIdForSlot(game.slot), head: true, killerTeam: 'owner', victimTeam: 'charterer' });
  } else if (r < 0.5) ui.hud.hitmarker(false);
  if (game.primary === 'nor1' && game.slot === 1) game.zoomTarget = 0; // 볼트 후 자동 줌 해제
}
function takeHit() {
  game.hp = Math.max(0, game.hp - 12);
  const self = { x: 0, z: 0 };
  const from = { x: Math.cos(Math.random() * 6.28) * 10, z: Math.sin(Math.random() * 6.28) * 10 };
  ui.hud.damageFrom(relativeAngle(self, 0, from));
  if (game.hp === 0) {
    ui.killfeed.push({ killer: '하역반장', victim: me.name || ui.getPlayerName(), weaponId: 'dwt47', head: false, killerTeam: 'charterer', victimTeam: 'owner' });
    ui.hud.center('전사', 1800, { sub: '다음 라운드를 기다리세요' });
    ui.hud.set({ spectate: '도선사J' });
  }
}
function demoKillfeed() {
  const k = [
    { killer: '도선사J', victim: '포워더', weaponId: 'nor1', head: true, killerTeam: 'owner', victimTeam: 'charterer' },
    { killer: '화주대리', victim: '기관장', weaponId: 'dwt47', head: false, killerTeam: 'charterer', victimTeam: 'owner' },
    { killer: '갑판장', victim: '검정인', weaponId: 'hawser', head: false, killerTeam: 'owner', victimTeam: 'charterer' },
    { killer: '하역반장', victim: '하역반장', weaponId: 'bunker', head: false, killerTeam: 'charterer', victimTeam: 'charterer' },
    { killer: me.name || ui.getPlayerName(), victim: '화주대리', weaponId: 'sof9', head: true, killerTeam: 'owner', victimTeam: 'charterer' },
  ];
  k.forEach((x, i) => setTimeout(() => ui.killfeed.push(x), i * 120));
}

function startGame(opts = {}) {
  mode = 'game';
  Object.assign(game, { hp: opts.hp != null ? opts.hp : 100, time: 120, zoom: 0, zoomTarget: 0, reload: null, slot: 1 });
  ui.hud.reset();
  ui.show('hud', hudState());
  if (opts.loadout !== false) {
    ui.show('loadout', { weapons: ['nor1', 'dwt47'], seconds: 5, round: game.score.round, selected: game.primary });
  }
}

// ---------- 액션 처리(엔진 흉내) ----------
ui.on('menu:sandbox', () => { sandbox = true; startGame(); });
ui.on('menu:multi', ({ name }) => {
  me.name = name;
  ui.show('lobby', lobbyProps({ loading: true, rooms: [] }));
  setTimeout(() => ui.isVisible('lobby') && ui.update('lobby', { loading: false, rooms: ROOMS }), 700);
});
ui.on('lobby:refresh', () => {
  ui.update('lobby', { loading: true, error: null });
  setTimeout(() => ui.isVisible('lobby') && ui.update('lobby', { loading: false, rooms: ROOMS }), 600);
});
ui.on('lobby:back', () => ui.show('menu'));
ui.on('lobby:create', ({ name, mapId, max }) => { const r = makeRoom(true); Object.assign(r, { name, mapId, max }); ui.show('room', r); });
ui.on('lobby:join', ({ roomId }) => {
  ui.update('lobby', { joining: roomId });
  setTimeout(() => { if (ui.isVisible('lobby')) { ui.update('lobby', { joining: null }); showRoom(false); } }, 500);
});
ui.on('room:team', ({ team }) => {
  room.players = room.players.map((p) => (p.id === room.meId ? { ...p, team, ready: p.host } : p));
  room.chat = [...room.chat, { system: true, text: `${me.name}님이 ${team === 'owner' ? '선주' : '용선자'} 팀으로 이동했어요.` }];
  ui.update('room', { players: room.players, chat: room.chat });
});
ui.on('room:ready', ({ ready }) => { room.players = room.players.map((p) => (p.id === room.meId ? { ...p, ready } : p)); });
ui.on('room:map', ({ mapId }) => {
  room.mapId = mapId;
  room.chat = [...room.chat, { system: true, text: `맵이 ${MAPS.find((m) => m.id === mapId).name}(으)로 바뀌었어요.` }];
  ui.update('room', { mapId, chat: room.chat });
});
ui.on('room:chat', ({ text }) => {
  const mine = room.players.find((p) => p.id === room.meId);
  room.chat = [...room.chat, { name: me.name, team: mine && mine.team, text }];
  ui.update('room', { chat: room.chat });
});
ui.on('room:leave', () => ui.show('lobby', lobbyProps()));
ui.on('room:start', () => { sandbox = false; game.score = { owner: 0, charterer: 0, target: 3, round: 1 }; startGame(); });
ui.on('loadout:pick', ({ id }) => {
  setPrimary(id);
  ui.hud.center(`라운드 ${game.score.round}`, 1600, { sub: game.score.owner === 2 || game.score.charterer === 2 ? '매치 포인트' : '선주 vs 용선자 · 팀 섬멸전' });
});
ui.on('pause:resume', () => {});
ui.on('pause:leave', () => { mode = 'menu'; if (sandbox || !room) ui.show('menu'); else ui.show('room', room); });
ui.on('results:back', () => { mode = 'menu'; if (room) ui.show('room', room); else ui.show('menu'); });
ui.on('results:lobby', () => { mode = 'menu'; ui.show('lobby', lobbyProps()); });

// 게임 입력 흉내(HUD가 보이고 커서 화면이 없을 때만)
const playing = () => mode === 'game' && ui.isVisible('hud') && !ui.needsCursor();
window.addEventListener('keydown', (e) => {
  if (ui.isTyping()) return;
  if (e.code === 'Tab' && mode === 'game' && ui.isVisible('hud') && !ui.isVisible('pause')) {
    e.preventDefault();
    ui.show('scoreboard', { players: statPlayers(), score: game.score, mapId: room ? room.mapId : 'jetty' });
    return;
  }
  if (e.code === 'Escape' && playing()) { ui.show('pause', { leaveLabel: sandbox ? '연습장 나가기' : '방 나가기' }); return; }
  if (!playing() || e.repeat) return;
  if (/^Digit[1-4]$/.test(e.code)) { game.slot = Number(e.code.slice(5)); game.zoomTarget = 0; game.reload = null; }
  if (e.code === 'KeyR' && game.ammo[game.slot] != null && game.reserve[game.slot] > 0) game.reload = 0;
  if (e.code === 'KeyH') takeHit();
  if (e.code === 'KeyK') demoKillfeed();
});
window.addEventListener('keyup', (e) => { if (e.code === 'Tab') ui.hide('scoreboard'); });
const stage = document.getElementById('stage');
stage.addEventListener('contextmenu', (e) => { if (mode === 'game') e.preventDefault(); });
stage.addEventListener('mousedown', (e) => {
  if (!playing() || e.target.closest('.po-page, .po-overlay, .qa')) return;
  if (e.button === 0) fire();
  if (e.button === 2) game.zoomTarget = ui.getSettings().zoomMode === 'toggle' && game.zoomTarget > 0 ? 0 : 1;
});
stage.addEventListener('mouseup', (e) => { if (e.button === 2 && ui.getSettings().zoomMode === 'hold') game.zoomTarget = 0; });

// ---------- 시나리오 ----------
const clickIn = (sel) => setTimeout(() => { const b = document.querySelector(sel); if (b) b.click(); }, 30);
const SCENES = {
  menu: () => { mode = 'menu'; ui.show('menu'); },
  'menu-account': () => { mode = 'menu'; ui.show('menu', { name: '홍길동', account: true }); },
  settings: () => { SCENES.menu(); clickIn('.po-menu .po-menu-btn--sub'); },
  controls: () => { SCENES.menu(); clickIn('.po-menu .po-menu-btn--sub:nth-of-type(4)'); },
  lobby: () => { mode = 'menu'; ui.show('lobby', lobbyProps()); },
  'lobby-empty': () => { mode = 'menu'; ui.show('lobby', { rooms: [] }); },
  'lobby-loading': () => { mode = 'menu'; ui.show('lobby', { rooms: [], loading: true }); },
  'lobby-error': () => { mode = 'menu'; ui.show('lobby', { rooms: [], error: '로비 서버(Supabase)에 연결할 수 없어요.' }); },
  create: () => { SCENES.lobby(); clickIn('.po-lobby .po-bar-actions .po-btn--primary'); },
  room: () => { mode = 'menu'; showRoom(true); },
  'room-guest': () => { mode = 'menu'; showRoom(false); },
  loadout: () => startGame(),
  hud: () => {
    startGame({ loadout: false });
    setPrimary('dwt47');
    game.ammo[1] = 7; game.time = 83;
    demoKillfeed();
    ui.hud.center('선주 팀 라운드 승리', 60000, { sub: '선주 2 : 1 용선자 · 매치 포인트' });
    game.score = { owner: 2, charterer: 1, target: 3, round: 4 };
    setTimeout(() => ui.hud.hitmarker(true), 700);
  },
  'hud-low': () => { startGame({ loadout: false, hp: 18 }); setTimeout(() => ui.hud.damageFrom(-1.2), 400); },
  scope: () => { startGame({ loadout: false }); setPrimary('nor1'); game.zoomTarget = 1; game.zoom = 1; },
  scoreboard: () => { startGame({ loadout: false }); ui.show('scoreboard', { players: statPlayers(), score: game.score, mapId: 'tankfarm' }); },
  results: () => {
    mode = 'menu';
    makeRoom(true);
    ui.show('results', {
      winner: 'owner', score: { owner: 3, charterer: 1 }, myTeam: 'owner', mapId: 'vlcc',
      rounds: [{ winner: 'owner', reason: '섬멸' }, { winner: 'charterer', reason: '시간 종료 · 생존자 수' }, { winner: 'owner', reason: '섬멸' }, { winner: 'owner', reason: '시간 종료 · 체력 합' }],
      players: statPlayers(),
    });
  },
  pause: () => { startGame({ loadout: false }); ui.show('pause'); },
};
const TOUR = ['menu', 'settings', 'controls', 'lobby', 'lobby-empty', 'create', 'room', 'room-guest', 'loadout', 'hud', 'hud-low', 'scope', 'scoreboard', 'results', 'pause'];
let tourTimer = null;
function tour(i = 0) {
  clearTimeout(tourTimer);
  if (i >= TOUR.length) return;
  go(TOUR[i]);
  tourTimer = setTimeout(() => tour(i + 1), 2600);
}
function go(name) {
  for (const s of ['scoreboard', 'pause', 'loadout']) ui.hide(s);
  document.querySelectorAll('.po-modal:not([hidden]) .po-btn--icon').forEach((b) => b.click());
  (SCENES[name] || SCENES.menu)();
}

// ---------- QA 패널 ----------
if (!bare) {
  const b = (label, fn) => h('button', { type: 'button', onclick: fn }, label);
  const panel = h('aside', { class: 'qa', 'aria-label': 'QA 패널' },
    h('div', { class: 'qa-head' },
      h('strong', { text: 'QA · UI 데모' }),
      b('접기', () => panel.classList.toggle('is-min'))),
    h('div', { class: 'qa-body' },
      h('p', { class: 'qa-label', text: '화면' }),
      h('div', { class: 'qa-grid' }, Object.keys(SCENES).map((k) => b(k, () => go(k)))),
      h('p', { class: 'qa-label', text: 'HUD 동작' }),
      h('div', { class: 'qa-grid' },
        b('히트', () => ui.hud.hitmarker(false)),
        b('헤드샷', () => ui.hud.hitmarker(true)),
        b('피격(H)', () => (mode === 'game' ? takeHit() : null)),
        b('킬피드(K)', demoKillfeed),
        b('매치 포인트', () => ui.hud.center('매치 포인트', 2000, { sub: '선주 2 : 2 용선자' })),
        b('용선자 승리', () => ui.hud.center('용선자 팀 라운드 승리', 2000)),
        b('체력 회복', () => { game.hp = 100; ui.hud.set({ spectate: null }); }),
        b('힌트 토글', () => ui.hud.set({ hint: document.querySelector('.po-hint[hidden]') ? '화면을 클릭하면 조작을 시작해요' : '' }))),
      h('p', { class: 'qa-label', text: '자동' }),
      h('div', { class: 'qa-grid' }, b('▶ 전체 투어', () => tour(0)), b('■ 정지', () => clearTimeout(tourTimer))),
      h('p', { class: 'qa-help', text: 'HUD에서: 좌클릭 사격 · 우클릭 줌(NOR-1) · 1~4 슬롯 · R 재장전 · Tab 점수판 · Esc 일시정지' }),
      h('p', { class: 'qa-label', text: '이벤트 로그' }),
      logList));
  if (innerWidth < 700) panel.classList.add('is-min');
  document.body.append(panel);
}

window.addEventListener('pagehide', (e) => { if (!e.persisted) ui.dispose(); });

// 실제 무기 정의·맵 목록이 있으면 그것을 쓰고(통합 확인), 없거나 실패하면 목 데이터. ?mock=1이면 항상 목 데이터.
async function boot() {
  let weapons = WEAPONS;
  let maps = MAPS;
  const src = [];
  if (qs.get('mock') !== '1') {
    try {
      const m = await import('../weapons/defs.js');
      if (m.WEAPONS && typeof m.WEAPONS === 'object') { weapons = m.WEAPONS; src.push('weapons/defs.js'); }
    } catch (e) { console.info('[demo] weapons/defs.js 대신 목 데이터 사용:', e.message); }
    try {
      const m = await import('../maps/index.js');
      if (Array.isArray(m.MAP_LIST) && m.MAP_LIST.length) { maps = m.MAP_LIST; src.push('maps/index.js'); }
    } catch (e) { console.info('[demo] maps/index.js 대신 목 데이터 사용:', e.message); }
  }
  ui.setMaps(maps).setWeapons(weapons);
  log('demo:data', src.length ? src.join(', ') : '목 데이터');
  go(qs.get('screen') || 'menu');
}
boot();
