// ⚓ 항만 작전 UI — 점수판(Tab 누르는 동안). 포인터 잠금 중에도 보이도록 입력은 받지 않는다.
//   팀전: 팀별 두 표 / 개인전(mode:'ffa'): 순위 번호가 붙은 한 목록
import { h, setText, num, TEAMS, TEAM_KEYS, teamKey, pingText, pingClass, modeKey, FFA_TARGET } from './dom.js';
import { makeScreen } from './parts.js';
import { mapInfo } from './icons.js';

export function normStatPlayers(p) {
  let list = Array.isArray(p.players) ? p.players : [];
  if (!list.length && p.teams && typeof p.teams === 'object') {
    list = TEAM_KEYS.flatMap((t) => (Array.isArray(p.teams[t]) ? p.teams[t].map((x) => ({ ...x, team: x.team || t })) : []));
  }
  return list.map((x) => ({
    id: x.id,
    name: x.name || '선원',
    team: teamKey(x.team),
    kills: Math.max(0, Math.floor(num(x.kills, 0))),
    deaths: Math.max(0, Math.floor(num(x.deaths, 0))),
    head: Math.max(0, Math.floor(num(x.head != null ? x.head : x.headshots, 0))),
    ping: x.ping,
    alive: x.alive !== false,
    bot: !!x.bot,
    me: !!x.me || (p.meId != null && x.id === p.meId),
    rank: x.rank != null && Number.isFinite(Number(x.rank)) ? Math.max(1, Math.floor(Number(x.rank))) : null,
    respawnIn: x.respawnIn != null && Number.isFinite(Number(x.respawnIn)) ? Math.max(0, Number(x.respawnIn)) : null,
    protect: !!x.protect,
  }));
}

export const byPerformance = (a, b) => b.kills - a.kills || a.deaths - b.deaths || b.head - a.head || String(a.name).localeCompare(String(b.name), 'ko');

/**
 * 개인전 순위: 킬↓ → 데스↑ → 헤드샷↓. 모두 rank를 주면 그대로 쓰고,
 * 아니면 같은 기록끼리 같은 순위(1, 2, 2, 4 …)를 매긴다.
 */
export function rankPlayers(list) {
  if (list.length && list.every((x) => x.rank != null)) return list.slice().sort((a, b) => a.rank - b.rank || byPerformance(a, b));
  const sorted = list.slice().sort(byPerformance);
  sorted.forEach((x, i) => {
    const prev = sorted[i - 1];
    x.rank = prev && prev.kills === x.kills && prev.deaths === x.deaths && prev.head === x.head ? prev.rank : i + 1;
  });
  return sorted;
}

export function createScoreboard(ctx) {
  let sig = '';
  const title = h('h2', { class: 'po-sb-title po-stencil', text: '점수판' });
  const meta = h('p', { class: 'po-sb-meta' });
  const ownerScore = h('b');
  const chScore = h('b');
  const scoreLine = h('div', { class: 'po-sb-score' },
    h('span', { class: 't-owner', text: '🟦 선주 ' }), ownerScore, h('span', { class: 'po-sb-colon', text: ' : ' }), chScore,
    h('span', { class: 't-charterer', text: ' 용선자 🟧' }));
  const cols = h('div', { class: 'po-sb-cols' });

  const el = h('section', { class: 'po-screen po-overlay po-scoreboard', hidden: true, 'aria-label': '점수판' },
    h('div', { class: 'po-sb-panel po-steel' },
      h('div', { class: 'po-hazard po-hazard--thin', 'aria-hidden': 'true' }),
      h('header', { class: 'po-sb-head' }, h('div', {}, title, meta), scoreLine),
      cols,
      h('p', { class: 'po-sb-foot', text: 'Tab에서 손을 떼면 닫혀요' })));

  function teamTable(team, rows) {
    const T = TEAMS[team];
    const alive = rows.filter((x) => x.alive).length;
    const row = (x) => h('tr', { class: (x.me ? 'is-me ' : '') + (x.alive ? '' : 'is-dead') },
      h('th', { scope: 'row', class: 'po-sb-name' }, h('span', { text: (x.bot ? '🤖 ' : '') + x.name }), x.me ? h('span', { class: 'po-tag', text: '나' }) : null),
      h('td', { class: 'num', text: x.kills }),
      h('td', { class: 'num', text: x.deaths }),
      h('td', { class: 'num', text: x.head }),
      h('td', { class: 'num' }, h('span', { class: 'po-ping ' + pingClass(x.ping), text: pingText(x.ping) })),
      h('td', { class: 'num po-sb-state', text: x.alive ? '생존' : '☠ 전사' }));
    return h('section', { class: `po-sb-team po-sb-team--${team}` },
      h('h3', { class: 'po-sb-team-name' },
        h('span', { text: `${T.emoji} ${T.name}` }), h('small', { text: T.en }),
        h('span', { class: 'po-sb-team-alive', text: `생존 ${alive}/${rows.length}` })),
      h('table', { class: 'po-sb-table' },
        h('thead', {}, h('tr', {}, ['이름', '킬', '데스', '헤드샷', '핑', '상태'].map((t, i) => h('th', { scope: 'col', class: i ? 'num' : '', text: t })))),
        h('tbody', {}, rows.length ? rows.map(row) : h('tr', {}, h('td', { colspan: 6, class: 'po-sb-empty', text: '플레이어 없음' })))));
  }

  function ffaState(x) {
    if (x.alive) return x.protect ? '🛡 보호' : '생존';
    return x.respawnIn != null ? `☠ ${Math.ceil(x.respawnIn / 1000)}초` : '☠ 부활 대기';
  }
  function ffaTable(rows) {
    const row = (x) => h('tr', { class: (x.me ? 'is-me ' : '') + (x.alive ? '' : 'is-dead') },
      h('td', { class: 'num po-sb-rank', text: x.rank }),
      h('th', { scope: 'row', class: 'po-sb-name' }, h('span', { text: (x.bot ? '🤖 ' : '') + x.name }), x.me ? h('span', { class: 'po-tag', text: '나' }) : null),
      h('td', { class: 'num', text: x.kills }),
      h('td', { class: 'num', text: x.deaths }),
      h('td', { class: 'num', text: x.head }),
      h('td', { class: 'num' }, h('span', { class: 'po-ping ' + pingClass(x.ping), text: pingText(x.ping) })),
      h('td', { class: 'num po-sb-state', text: ffaState(x) }));
    return h('section', { class: 'po-sb-team po-sb-team--ffa' },
      h('table', { class: 'po-sb-table' },
        h('thead', {}, h('tr', {}, ['순위', '이름', '킬', '데스', '헤드샷', '핑', '상태'].map((t, i) => h('th', { scope: 'col', class: i === 1 ? '' : 'num', text: t })))),
        h('tbody', {}, rows.length ? rows.map(row) : h('tr', {}, h('td', { colspan: 7, class: 'po-sb-empty', text: '플레이어 없음' })))));
  }

  function render(p) {
    const s = JSON.stringify(p);
    if (s === sig) return;
    sig = s;
    const ffa = modeKey(p.mode) === 'ffa';
    el.classList.toggle('is-ffa', ffa);
    scoreLine.hidden = ffa;
    if (ffa) {
      const rows = rankPlayers(normStatPlayers(p));
      const target = Math.max(1, Math.floor(num(p.target != null ? p.target : p.killTarget != null ? p.killTarget : p.score && p.score.target, FFA_TARGET)));
      const me = rows.find((x) => x.me);
      const m = p.mapName ? { name: p.mapName } : mapInfo(ctx.maps, p.maps, p.mapId);
      setText(title, `개인전 · 목표 ${target}킬`);
      setText(meta, [m && m.name, me ? `내 순위 ${me.rank}위 / ${rows.length}명` : `${rows.length}명`].filter(Boolean).join(' · '));
      cols.replaceChildren(ffaTable(rows));
      return;
    }
    setText(title, '점수판');
    const players = normStatPlayers(p);
    const sc = p.score || {};
    const target = Math.max(1, Math.floor(num(sc.target, 3)));
    const bestOf = Math.max(1, Math.floor(num(sc.bestOf, target * 2 - 1)));
    const round = p.round != null ? p.round : sc.round;
    const m = p.mapName ? { name: p.mapName } : mapInfo(ctx.maps, p.maps, p.mapId);
    setText(meta, [m && m.name, round ? `라운드 ${round}` : '', `${bestOf}판 ${target}선승`].filter(Boolean).join(' · '));
    setText(ownerScore, Math.floor(num(sc.owner, 0)));
    setText(chScore, Math.floor(num(sc.charterer, 0)));
    cols.replaceChildren(...TEAM_KEYS.map((t) => teamTable(t, players.filter((x) => x.team === t).sort(byPerformance))));
  }

  return makeScreen(el, { render, onHide: () => { sig = ''; } });
}
