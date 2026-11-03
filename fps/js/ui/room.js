// ⚓ 항만 작전 UI — 방(대기실): 팀 칼럼(팀전) / 한 줄 명단(개인전), 준비/시작, 모드·맵 변경, 채팅
import { h, btn, setText, num, TEAMS, TEAM_KEYS, teamKey, pingText, pingClass, modeKey, modeLabel, MODE_ICON } from './dom.js';
import { makeScreen, mapCard } from './parts.js';
import { mapList, mapInfo } from './icons.js';

const CHAT_MAX = 30;
const CHAT_LEN = 120;

function normPlayers(p) {
  return (Array.isArray(p.players) ? p.players : []).map((x, i) => ({
    id: x.id != null ? x.id : `p${i}`,
    name: x.name || '선원',
    team: teamKey(x.team),
    ready: !!x.ready,
    ping: x.ping,
    bot: !!x.bot,
    host: !!x.host || (p.hostId != null && x.id === p.hostId),
    me: !!x.me || (p.meId != null && x.id === p.meId),
  }));
}

export function createRoom(ctx) {
  let p = {};
  let screen = null;
  let chatSig = '';
  let mapSig = '';

  // ---------- 헤더 ----------
  const title = h('h1', { class: 'po-h1 po-stencil po-room-title' });
  const modeChip = h('span', { class: 'po-chip po-chip--mode' });
  const mapChip = h('span', { class: 'po-chip' });
  const countChip = h('span', { class: 'po-chip' });
  const idChip = h('span', { class: 'po-chip po-chip--dim' });

  // ---------- 팀 칼럼 ----------
  function teamCol(team) {
    const T = TEAMS[team];
    const count = h('span', { class: 'po-team-count' });
    const move = btn('이 팀으로 이동', () => ctx.emit('room:team', { team }), 'po-btn--sm');
    const list = h('ul', { class: 'po-team-list', 'aria-label': `${T.name} 팀 명단` });
    const el = h('section', { class: `po-team po-team--${team} po-steel` },
      h('header', { class: 'po-team-head' },
        h('h2', { class: 'po-team-name' },
          h('span', { class: 'po-team-emoji', text: T.emoji, 'aria-hidden': 'true' }),
          h('span', { text: T.name }), h('small', { text: T.en })),
        count, move),
      list);
    return { el, count, move, list };
  }
  const cols = { owner: teamCol('owner'), charterer: teamCol('charterer') };
  const waiting = h('p', { class: 'po-unassigned' });
  const teamsWrap = h('div', { class: 'po-room-teams' }, waiting, cols.owner.el, h('div', { class: 'po-vs', text: 'VS', 'aria-hidden': 'true' }), cols.charterer.el);

  // ---------- 개인전 명단(팀 버튼 없음) ----------
  const ffaCount = h('span', { class: 'po-team-count' });
  const ffaList = h('ul', { class: 'po-team-list', 'aria-label': '개인전 명단' });
  const ffaCol = h('section', { class: 'po-team po-team--ffa po-steel', hidden: true },
    h('header', { class: 'po-team-head' },
      h('h2', { class: 'po-team-name' },
        h('span', { class: 'po-team-emoji', text: MODE_ICON.ffa, 'aria-hidden': 'true' }),
        h('span', { text: '개인전' }), h('small', { text: '· 모두가 적' })),
      ffaCount),
    ffaList);

  // ---------- 모드(방장만 바꿀 수 있음 → 머리글 오른쪽 전환 버튼, 다른 사람은 모드 칩만) ----------
  const modeBtns = ['team', 'ffa'].map((m) => btn([
    h('span', { class: 'po-mode-ico', text: MODE_ICON[m], 'aria-hidden': 'true' }),
    h('span', { class: 'po-mode-txt' }, h('b', { text: m === 'ffa' ? '개인전' : '팀전' })),
  ], () => pickMode(m), 'po-mode-btn', { role: 'radio', 'data-mode': m }));
  const modePick = h('div', { class: 'po-modepick po-modepick--bar', role: 'radiogroup', 'aria-label': '모드 변경(방장)', title: '방장만 모드를 바꿀 수 있어요' }, modeBtns);
  function pickMode(m) {
    const players = normPlayers(p);
    const me = players.find((x) => x.me);
    if (!me || !me.host || p.starting || modeKey(m) === modeKey(p.mode)) return;
    screen.update({ mode: modeKey(m) }); // 즉시 반영, 다음 update가 오면 그 값이 우선
    ctx.emit('room:mode', { mode: modeKey(m) });
  }

  function playerRow(x) {
    return h('li', { class: 'po-pl' + (x.me ? ' is-me' : '') + (x.ready || x.host ? ' is-ready' : '') },
      h('span', { class: 'po-pl-crown', text: x.host ? '👑' : '', title: x.host ? '방장' : null }),
      h('span', { class: 'po-pl-name', text: (x.bot ? '🤖 ' : '') + x.name }),
      x.me ? h('span', { class: 'po-tag', text: '나' }) : null,
      h('span', { class: 'po-ping ' + pingClass(x.ping), text: pingText(x.ping), title: '핑' }),
      h('span', { class: 'po-pl-ready', text: x.host ? '방장' : x.ready ? '✔ 준비' : '대기 중' }));
  }
  const emptyRow = (n) => h('li', { class: 'po-pl po-pl--empty' }, h('span', { class: 'po-pl-crown' }), h('span', { class: 'po-pl-name', text: n > 1 ? `빈 자리 ×${n}` : '빈 자리' }));

  // ---------- 맵 ----------
  const mapCur = h('div', { class: 'po-room-mapcur' });
  const mapPick = h('div', { class: 'po-mapcards po-mapcards--sm', role: 'radiogroup', 'aria-label': '맵 변경' });
  const mapNote = h('p', { class: 'po-set-hint' });

  // ---------- 채팅 ----------
  const chatLog = h('ol', { class: 'po-chat-log', 'aria-live': 'polite', 'aria-label': '채팅' });
  const chatIn = h('input', {
    class: 'po-input', type: 'text', maxlength: CHAT_LEN, placeholder: '메시지 입력 후 Enter',
    autocomplete: 'off', spellcheck: 'false', 'aria-label': '채팅 입력',
  });
  const chatForm = h('form', { class: 'po-chat-form', onsubmit: (e) => { e.preventDefault(); sendChat(); } },
    chatIn, h('button', { type: 'submit', class: 'po-btn' }, '전송'));
  function sendChat() {
    const text = chatIn.value.replace(/\s+/g, ' ').trim().slice(0, CHAT_LEN);
    if (!text) return;
    chatIn.value = '';
    ctx.emit('room:chat', { text });
  }
  function renderChat(items) {
    const list = (Array.isArray(items) ? items : []).slice(-CHAT_MAX);
    const sig = JSON.stringify(list);
    if (sig === chatSig) return;
    chatSig = sig;
    const stick = chatLog.scrollHeight - chatLog.scrollTop - chatLog.clientHeight < 48;
    chatLog.replaceChildren(...(list.length ? list.map((m) => (m.system
      ? h('li', { class: 'po-chat-sys', text: m.text })
      : h('li', { class: 'po-chat-line' },
        h('b', { class: 'po-chat-name t-' + (teamKey(m.team) || 'none'), text: m.name || '?' }),
        h('span', { class: 'po-chat-text', text: m.text })))) : [h('li', { class: 'po-chat-sys', text: '대기실 채팅 — 작전 계획을 나눠 보세요.' })]));
    if (stick) chatLog.scrollTop = chatLog.scrollHeight;
  }

  // ---------- 하단 ----------
  const status = h('p', { class: 'po-room-status', role: 'status' });
  const readyBtn = btn('준비하기', toggleReady, 'po-btn--big po-ready-btn');
  const startBtn = btn('▶ 게임 시작', () => {
    if (!startBtn.disabled) ctx.emit('room:start', { roomId: p.roomId, mapId: p.mapId, mode: modeKey(p.mode) });
  }, 'po-btn--primary po-btn--big');

  // 내 준비 상태는 즉시 반영(낙관적 갱신)하고, 다음 update가 오면 그 값이 우선한다.
  const isMeRaw = (x) => !!x.me || (p.meId != null && x.id === p.meId);
  function toggleReady() {
    const me = normPlayers(p).find((x) => x.me);
    if (!me || me.host) return;
    const ready = !me.ready;
    screen.update({ players: (p.players || []).map((x) => (isMeRaw(x) ? { ...x, ready } : x)) });
    ctx.emit('room:ready', { ready });
  }

  const el = h('section', { class: 'po-screen po-page po-room', hidden: true, 'aria-label': '대기실' },
    h('div', { class: 'po-page-inner' },
      h('header', { class: 'po-bar' },
        btn('← 나가기', () => ctx.emit('room:leave', { roomId: p.roomId }), 'po-btn--ghost'),
        h('div', { class: 'po-bar-title' }, title, h('p', { class: 'po-bar-sub po-chips' }, modeChip, mapChip, countChip, idChip)),
        modePick),
      h('div', { class: 'po-hazard po-hazard--thin', 'aria-hidden': 'true' }),
      h('div', { class: 'po-room-grid' },
        h('div', { class: 'po-room-left' },
          teamsWrap,
          ffaCol,
          h('section', { class: 'po-panel po-steel po-chat' }, h('h2', { class: 'po-panel-title', text: '💬 채팅' }), chatLog, chatForm)),
        h('aside', { class: 'po-room-side' },
          h('section', { class: 'po-panel po-steel' }, h('h2', { class: 'po-panel-title', text: '🗺️ 맵' }), mapCur, mapPick, mapNote))),
      h('footer', { class: 'po-room-foot po-steel' }, status, h('div', { class: 'po-room-foot-actions' }, readyBtn, startBtn))));

  function render(props) {
    p = props;
    const players = normPlayers(p);
    const me = players.find((x) => x.me);
    const isHost = !!(me && me.host);
    const max = Math.max(2, num(p.max, 8));
    const cap = Math.max(1, num(p.teamMax, Math.ceil(max / 2)));
    const mode = modeKey(p.mode);
    const ffa = mode === 'ffa';

    setText(title, p.name || '작전실');
    setText(modeChip, `${MODE_ICON[mode]} ${modeLabel(mode, { killTarget: p.killTarget })}`);
    modeChip.classList.toggle('is-ffa', ffa);
    const m = mapInfo(ctx.maps, p.maps, p.mapId);
    setText(mapChip, `🗺️ ${m ? m.name : '맵 미정'}`);
    setText(countChip, `👥 ${players.length}/${max}`);
    setText(idChip, p.roomId ? `#${p.roomId}` : '');
    idChip.hidden = !p.roomId;

    // 명단: 팀전 = 팀 칼럼 두 개, 개인전 = 한 줄 명단
    teamsWrap.hidden = ffa;
    ffaCol.hidden = !ffa;
    const byTeam = { owner: [], charterer: [] };
    for (const x of players) if (x.team) byTeam[x.team].push(x);
    const unassigned = ffa ? [] : players.filter((x) => !x.team);
    if (ffa) {
      setText(ffaCount, `${players.length}/${max}`);
      const free = Math.max(0, max - players.length); // 빈 자리는 한 줄로 묶는다(명단이 길어지지 않게)
      ffaList.replaceChildren(...players.map(playerRow), ...(free ? [emptyRow(free)] : []));
    } else {
      for (const t of TEAM_KEYS) {
        const c = cols[t];
        setText(c.count, `${byTeam[t].length}/${cap}`);
        c.move.hidden = !me || me.team === t;
        c.move.disabled = byTeam[t].length >= cap;
        const empties = Array.from({ length: Math.max(0, cap - byTeam[t].length) }, emptyRow);
        c.list.replaceChildren(...byTeam[t].map(playerRow), ...empties);
      }
      setText(waiting, unassigned.length ? `⏳ 팀 배정 대기: ${unassigned.map((x) => x.name).join(', ')}` : '');
      waiting.hidden = !unassigned.length;
    }

    // 모드 전환: 방장만(머리글 오른쪽). 다른 사람은 모드 칩으로 확인
    for (const b of modeBtns) {
      const on = b.getAttribute('data-mode') === mode;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
      b.disabled = !!p.starting;
    }
    modePick.hidden = !isHost;
    modeChip.title = isHost ? '' : '모드는 방장만 바꿀 수 있어요';

    // 맵 (바뀐 경우에만 다시 그린다)
    const maps = mapList(ctx.maps, p.maps);
    const sig = JSON.stringify([isHost, p.mapId, maps]);
    if (sig !== mapSig) {
      mapSig = sig;
      mapCur.replaceChildren(m ? mapCard(m) : h('p', { class: 'po-set-hint', text: '맵이 아직 정해지지 않았어요.' }));
      mapPick.hidden = !isHost;
      mapPick.replaceChildren(...(isHost ? maps.map((x) => mapCard(x, {
        small: true, selected: x.id === p.mapId,
        onPick: (id) => { if (id !== p.mapId) ctx.emit('room:map', { mapId: id }); },
      })) : []));
      setText(mapNote, isHost ? '방장: 카드를 눌러 맵을 바꿀 수 있어요.' : '맵은 방장만 바꿀 수 있어요.');
    }

    renderChat(p.chat);

    // 시작 조건(방장은 자동 준비)
    //   팀전: 양 팀 1명 이상 + 팀 미배정 없음 + 방장 외 전원 준비
    //   개인전: 2명 이상 + 방장 외 전원 준비
    const notReady = players.filter((x) => !x.host && !x.ready);
    let reason = '';
    if (ffa) {
      if (players.length < 2) reason = '2명 이상 있어야 시작할 수 있어요.';
    } else if (byTeam.owner.length < 1 || byTeam.charterer.length < 1) reason = '양 팀에 1명 이상 있어야 시작할 수 있어요.';
    else if (unassigned.length) reason = `팀 배정을 기다리는 플레이어가 ${unassigned.length}명 있어요.`;
    if (!reason && notReady.length) reason = `준비 안 된 플레이어 ${notReady.length}명: ${notReady.map((x) => x.name).join(', ')}`;

    startBtn.hidden = !isHost;
    readyBtn.hidden = isHost || !me;
    startBtn.disabled = !isHost || !!reason || !!p.starting;
    setText(startBtn, p.starting ? '시작하는 중…' : '▶ 게임 시작');
    if (me && !isHost) {
      setText(readyBtn, me.ready ? '✔ 준비 완료 (취소)' : '준비하기');
      readyBtn.classList.toggle('is-on', me.ready);
      readyBtn.setAttribute('aria-pressed', me.ready ? 'true' : 'false');
    }
    let msg;
    if (isHost) msg = reason || '모두 준비됐어요. 게임을 시작하세요!';
    else if (!me) msg = '방 정보를 기다리는 중…';
    else if (!me.ready) msg = '준비를 누르면 방장이 게임을 시작할 수 있어요.';
    else msg = reason ? `방장 대기 중 · ${reason}` : '방장이 게임을 시작하기를 기다리는 중…';
    setText(status, msg);
    status.classList.toggle('is-ok', isHost && !reason);
  }

  screen = makeScreen(el, { render });
  return screen;
}
