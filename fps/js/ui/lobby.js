// ⚓ 항만 작전 UI — 로비(방 목록 + 방 만들기)
import { h, btn, setText, clamp, num } from './dom.js';
import { makeScreen, createModal, sheet, mapCard } from './parts.js';
import { mapIcon, mapList, mapInfo } from './icons.js';

const ROOM_NAME_MAX = 24;
const cleanRoomName = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, ROOM_NAME_MAX);
const countOf = (v) => (Array.isArray(v) ? v.length : num(v, 0));

export function createLobby(ctx) {
  let p = {};
  let formMap = null;
  let formMax = 8;
  const modal = createModal();

  // ---------- 헤더 ----------
  const meChip = h('span', { class: 'po-chip po-chip--me' });
  const countText = h('span', { class: 'po-lobby-count' });
  const refreshBtn = btn('⟳ 새로고침', () => ctx.emit('lobby:refresh', {}), '', { 'aria-label': '방 목록 새로고침' });

  // ---------- 방 만들기 폼 ----------
  const nameIn = h('input', {
    class: 'po-input', type: 'text', maxlength: ROOM_NAME_MAX, placeholder: '예: 2부두 야간 작전',
    autocomplete: 'off', spellcheck: 'false', 'aria-label': '방 이름', 'data-autofocus': '',
  });
  const mapBox = h('div', { class: 'po-mapcards', role: 'radiogroup', 'aria-label': '맵 선택' });
  const maxOut = h('output', { class: 'po-stepper-val', 'aria-live': 'polite' });
  const maxNote = h('span', { class: 'po-set-hint' });
  const minus = btn('−', () => setMax(formMax - 1), 'po-btn--icon', { 'aria-label': '최대 인원 줄이기' });
  const plus = btn('＋', () => setMax(formMax + 1), 'po-btn--icon', { 'aria-label': '최대 인원 늘리기' });
  const formErr = h('p', { class: 'po-field-err', role: 'alert' });
  const form = h('form', { class: 'po-create', novalidate: true, onsubmit: (e) => { e.preventDefault(); doCreate(); } },
    h('label', { class: 'po-field' }, h('span', { class: 'po-field-label', text: '방 이름' }), nameIn),
    h('div', { class: 'po-field' }, h('span', { class: 'po-field-label', text: '맵 선택' }), mapBox),
    h('div', { class: 'po-field' },
      h('span', { class: 'po-field-label', text: '최대 인원' }),
      h('div', { class: 'po-stepper' }, minus, maxOut, plus, maxNote)),
    formErr,
    h('div', { class: 'po-form-actions' },
      btn('취소', () => modal.close(), 'po-btn--ghost'),
      h('button', { type: 'submit', class: 'po-btn po-btn--primary' }, '⚓ 방 만들기')));
  const createSheet = sheet({ title: '＋ 방 만들기', onClose: () => modal.close(), body: form, cls: 'po-create-sheet' });

  function setMax(n) {
    formMax = clamp(Math.round(n), 2, 8);
    setText(maxOut, `${formMax}명`);
    setText(maxNote, `팀당 최대 ${Math.ceil(formMax / 2)}명`);
    minus.disabled = formMax <= 2;
    plus.disabled = formMax >= 8;
  }
  function renderMapCards() {
    const maps = mapList(ctx.maps, p.maps);
    if (!maps.some((m) => m.id === formMap)) formMap = maps[0] ? maps[0].id : null;
    mapBox.replaceChildren(...maps.map((m) => mapCard(m, {
      selected: m.id === formMap,
      onPick: (id) => { formMap = id; setText(formErr, ''); renderMapCards(); },
    })));
  }
  function openCreate() {
    setText(formErr, '');
    if (!nameIn.value) nameIn.value = cleanRoomName(`${ctx.playerName || '선원'}의 작전실`);
    renderMapCards();
    setMax(formMax);
    modal.open(createSheet);
    nameIn.select();
  }
  function doCreate() {
    const name = cleanRoomName(nameIn.value) || cleanRoomName(`${ctx.playerName || '선원'}의 작전실`);
    if (!formMap) { setText(formErr, '맵을 골라 주세요.'); return; }
    modal.close();
    ctx.emit('lobby:create', { name, mapId: formMap, max: formMax });
  }

  // ---------- 방 목록 ----------
  const list = h('div', { class: 'po-rooms', role: 'list', 'aria-label': '방 목록' });
  const statusEl = h('div', { class: 'po-lobby-status', role: 'status' });

  function roomRow(r) {
    const n = countOf(r.players);
    const max = Math.max(1, num(r.max, 8));
    const playing = r.status === 'playing';
    const full = n >= max;
    const joining = p.joining != null && p.joining === r.roomId;
    const m = mapInfo(ctx.maps, p.maps, r.mapId);
    const label = playing ? '진행 중' : full ? '만원' : joining ? '참가 중…' : '참가';
    return h('div', { class: 'po-room-row po-steel' + (playing || full ? ' is-locked' : ''), role: 'listitem' },
      h('div', { class: 'po-room-ico' }, mapIcon(r.mapId)),
      h('div', { class: 'po-room-main' },
        h('div', { class: 'po-room-name', text: r.name || '이름 없는 방' }),
        h('div', { class: 'po-room-meta' },
          h('span', { class: 'po-room-map', text: m ? m.name : '맵 미정' }),
          h('span', { class: 'po-room-host' }, h('span', { text: '👑', 'aria-label': '방장' }), h('span', { text: r.hostName || '?' })))),
      h('div', { class: 'po-room-count', title: `${n}/${max}명` },
        h('b', { text: `${n}/${max}` }),
        h('span', { class: 'po-meter' }, h('i', { style: { transform: `scaleX(${clamp(n / max, 0, 1)})` } }))),
      h('span', { class: 'po-badge ' + (playing ? 'po-badge--live' : 'po-badge--wait'), text: playing ? '게임 중' : '대기' }),
      btn(label, () => ctx.emit('lobby:join', { roomId: r.roomId }), 'po-btn--primary po-room-join', {
        disabled: playing || full || joining,
        'aria-label': `${r.name || '방'} ${label}`,
      }));
  }

  function emptyState() {
    return h('div', { class: 'po-empty' },
      h('div', { class: 'po-empty-art', 'aria-hidden': 'true' }, mapIcon('jetty')),
      h('p', { class: 'po-empty-title', text: '정박 중인 방이 없어요' }),
      h('p', { class: 'po-empty-sub', text: '첫 작전실을 열고 동료를 기다려 보세요.' }),
      btn('＋ 방 만들기', openCreate, 'po-btn--primary'));
  }

  const el = h('section', { class: 'po-screen po-page po-lobby', hidden: true, 'aria-label': '로비' },
    h('div', { class: 'po-page-inner' },
      h('header', { class: 'po-bar' },
        btn('← 메뉴', () => ctx.emit('lobby:back', {}), 'po-btn--ghost'),
        h('div', { class: 'po-bar-title' },
          h('h1', { class: 'po-h1 po-stencil', text: '🌐 로비' }),
          h('p', { class: 'po-bar-sub' }, h('span', { text: '작전실 목록 · ' }), countText)),
        h('div', { class: 'po-bar-actions' }, meChip, refreshBtn, btn('＋ 방 만들기', openCreate, 'po-btn--primary'))),
      h('div', { class: 'po-hazard po-hazard--thin', 'aria-hidden': 'true' }),
      statusEl,
      list),
    modal.el);

  let listSig = '';
  function render(props) {
    p = props;
    const rooms = (Array.isArray(p.rooms) ? p.rooms : []).slice()
      .sort((a, b) => (a.status === 'playing') - (b.status === 'playing'));
    setText(meChip, `👤 ${p.name || ctx.playerName || '선원'}`);
    setText(countText, p.loading && !rooms.length ? '불러오는 중' : `방 ${rooms.length}개`);
    refreshBtn.disabled = !!p.loading;

    // 같은 데이터면 다시 그리지 않는다(누르는 중인 참가 버튼이 바뀌지 않게)
    const sig = JSON.stringify([rooms, p.loading, p.error, p.joining, p.maps, ctx.maps.size]);
    if (sig === listSig) return;
    listSig = sig;
    statusEl.replaceChildren();
    if (p.error) {
      statusEl.append(h('div', { class: 'po-alert po-alert--bad' },
        h('span', { text: `⚠️ ${p.error}` }),
        btn('다시 시도', () => ctx.emit('lobby:refresh', {}), 'po-btn--sm')));
    }
    if (p.loading && !rooms.length) {
      list.replaceChildren(h('div', { class: 'po-loading' }, h('span', { class: 'po-spinner', 'aria-hidden': 'true' }), h('span', { text: '방 목록을 불러오는 중…' })));
    } else if (!rooms.length) {
      list.replaceChildren(p.error ? h('div') : emptyState());
    } else {
      list.replaceChildren(...rooms.map(roomRow));
    }
  }

  return makeScreen(el, { render, onHide: () => modal.close() });
}
