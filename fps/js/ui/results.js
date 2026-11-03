// ⚓ 항만 작전 UI — 결과 화면
//   팀전: 승리 팀, 라운드 기록, MVP / 개인전(mode:'ffa'): 🥇🥈🥉 시상대 + 순위표
import { h, btn, setText, num, TEAMS, teamKey, modeKey, FFA_TARGET } from './dom.js';
import { makeScreen } from './parts.js';
import { mapInfo } from './icons.js';
import { normStatPlayers, byPerformance, rankPlayers } from './scoreboard.js';

const MEDALS = { 1: '🥇', 2: '🥈', 3: '🥉' };
const FFA_REASON = {
  kills: (t) => `먼저 ${t}킬 달성`,
  time: () => '시간 종료 · 최다 킬 우승',
  forfeit: () => '다른 플레이어가 모두 나가 기권승',
  draw: () => '기록이 같아 승부를 가리지 못했어요',
};

function normRounds(list) {
  return (Array.isArray(list) ? list : []).map((r, i) => {
    const o = typeof r === 'string' ? { winner: r } : r || {};
    const w = o.winner === 'draw' ? 'draw' : teamKey(o.winner) || 'draw';
    return { n: o.n != null ? o.n : o.round != null ? o.round : i + 1, winner: w, reason: o.reason || '' };
  });
}

export function createResults(ctx) {
  const banner = h('div', { class: 'po-res-banner' });
  const kicker = h('p', { class: 'po-res-kicker po-stencil', text: 'MATCH RESULT' });
  const titleEl = h('h1', { class: 'po-res-title po-stencil' });
  const scoreEl = h('p', { class: 'po-res-score' });
  const verdict = h('p', { class: 'po-res-verdict' });
  banner.append(kicker, titleEl, scoreEl, verdict);

  const rounds = h('ol', { class: 'po-res-rounds', 'aria-label': '라운드 기록' });
  const mvpBox = h('div', { class: 'po-res-mvp po-steel po-rivets' });
  const table = h('div', { class: 'po-res-table' });
  const backBtn = btn('방으로 돌아가기', () => ctx.emit('results:back', {}), 'po-btn--primary po-btn--big');
  const lobbyBtn = btn('로비로', () => ctx.emit('results:lobby', {}), 'po-btn--ghost po-btn--big');

  const teamGrid = h('div', { class: 'po-res-grid' },
    h('section', { class: 'po-panel po-steel' }, h('h2', { class: 'po-panel-title', text: '📋 라운드 기록' }), rounds),
    mvpBox);
  const podium = h('section', { class: 'po-res-podium', 'aria-label': '시상대', hidden: true });
  const tableTitle = h('h2', { class: 'po-panel-title', text: '📊 개인 기록' });

  const el = h('section', { class: 'po-screen po-page po-results', hidden: true, 'aria-label': '매치 결과' },
    h('div', { class: 'po-page-inner po-res-inner' },
      banner,
      h('div', { class: 'po-hazard', 'aria-hidden': 'true' }),
      teamGrid,
      podium,
      h('section', { class: 'po-panel po-steel' }, tableTitle, table),
      h('div', { class: 'po-res-actions' }, backBtn, lobbyBtn)));

  // ---------- 개인전 ----------
  function pod(x, place) {
    return h('div', { class: `po-pod po-pod--${place}` + (x.me ? ' is-me' : '') },
      h('span', { class: 'po-pod-medal', text: MEDALS[x.rank] || `${x.rank}위`, 'aria-hidden': 'true' }),
      h('b', { class: 'po-pod-name' }, h('span', { text: (x.bot ? '🤖 ' : '') + x.name }), x.me ? h('span', { class: 'po-tag', text: '나' }) : null),
      h('span', { class: 'po-pod-kills', text: `${x.kills}킬 · ${x.deaths}데스` }),
      h('div', { class: 'po-pod-block', 'aria-label': `${x.rank}위` }, h('span', { text: x.rank })));
  }
  function renderFfa(p) {
    const rows = rankPlayers(normStatPlayers({ players: Array.isArray(p.ranking) && p.ranking.length ? p.ranking : p.players, meId: p.meId }));
    const target = Math.max(1, Math.floor(num(p.target != null ? p.target : p.killTarget, FFA_TARGET)));
    const me = rows.find((x) => x.me);
    let winner = null;
    if (p.reason !== 'draw') {
      if (p.winnerId != null) winner = rows.find((x) => x.id != null && String(x.id) === String(p.winnerId)) || null;
      const wName = p.winnerName || (winner && winner.name) || '';
      winner = wName ? { ...(winner || {}), name: wName } : null;
    }
    el.dataset.winner = winner ? 'ffa' : 'draw';
    setText(kicker, 'FREE FOR ALL');
    setText(titleEl, winner ? `🏆 ${winner.name} 우승!` : '무승부');
    const reasonFn = FFA_REASON[p.reason];
    setText(scoreEl, reasonFn ? reasonFn(target) : `개인전 · 목표 ${target}킬`);
    let v = '';
    if (me) v = winner && (winner.me || (winner.id != null && winner.id === me.id)) ? '🏆 내가 우승했어요!' : `내 순위 ${me.rank}위 / ${rows.length}명`;
    const m = p.mapName ? { name: p.mapName } : mapInfo(ctx.maps, p.maps, p.mapId);
    setText(verdict, [v, m && m.name].filter(Boolean).join(' · '));

    // 시상대: 2위 · 1위 · 3위 순서로 놓는다
    const top3 = rows.slice(0, 3);
    const order = [[top3[1], 2], [top3[0], 1], [top3[2], 3]].filter(([x]) => x);
    podium.replaceChildren(...(order.length ? order.map(([x, place]) => pod(x, place)) : [h('p', { class: 'po-set-hint', text: '기록이 없어요.' })]));

    setText(tableTitle, '📊 순위표');
    table.replaceChildren(h('table', { class: 'po-sb-table' },
      h('thead', {}, h('tr', {}, ['순위', '이름', '킬', '데스', '헤드샷'].map((t, i) => h('th', { scope: 'col', class: i === 1 ? '' : 'num', text: t })))),
      h('tbody', {}, rows.length ? rows.map((x) => h('tr', { class: x.me ? 'is-me' : '' },
        h('td', { class: 'num po-sb-rank', text: MEDALS[x.rank] ? `${MEDALS[x.rank]} ${x.rank}` : x.rank }),
        h('th', { scope: 'row', class: 'po-sb-name' }, h('span', { text: (x.bot ? '🤖 ' : '') + x.name }), x.me ? h('span', { class: 'po-tag', text: '나' }) : null),
        h('td', { class: 'num', text: x.kills }),
        h('td', { class: 'num', text: x.deaths }),
        h('td', { class: 'num', text: x.head })))
        : h('tr', {}, h('td', { colspan: 5, class: 'po-sb-empty', text: '기록 없음' })))));
  }

  function render(p) {
    const ffa = modeKey(p.mode) === 'ffa';
    el.dataset.mode = ffa ? 'ffa' : 'team';
    teamGrid.hidden = ffa;
    podium.hidden = !ffa;
    setText(backBtn, p.backLabel || '방으로 돌아가기');
    setText(lobbyBtn, p.lobbyLabel || '로비로');
    lobbyBtn.hidden = p.lobbyLabel === false;
    if (ffa) { renderFfa(p); return; }
    setText(kicker, 'MATCH RESULT');
    setText(tableTitle, '📊 개인 기록');
    renderTeam(p);
  }

  function renderTeam(p) {
    const winner = p.winner === 'draw' ? 'draw' : teamKey(p.winner) || 'draw';
    const sc = p.score || {};
    const players = normStatPlayers(p).sort(byPerformance);
    const me = players.find((x) => x.me);
    const myTeam = teamKey(p.myTeam) || (me ? me.team : '');

    el.dataset.winner = winner;
    setText(titleEl, winner === 'draw' ? '무승부' : `${TEAMS[winner].name} 팀 승리`);
    setText(scoreEl, `선주 ${Math.floor(num(sc.owner, 0))} : ${Math.floor(num(sc.charterer, 0))} 용선자`);
    let v = '';
    if (myTeam && winner !== 'draw') v = myTeam === winner ? '🏆 우리 팀이 이겼어요!' : '패배 — 다음 항차를 노려 보세요.';
    else if (winner === 'draw') v = '승부를 가리지 못했어요.';
    const m = p.mapName ? { name: p.mapName } : mapInfo(ctx.maps, p.maps, p.mapId);
    setText(verdict, [v, m && m.name].filter(Boolean).join(' · '));

    const rs = normRounds(p.rounds);
    rounds.replaceChildren(...(rs.length ? rs.map((r) => h('li', { class: `po-res-round t-${r.winner}`, title: r.reason || null },
      h('span', { class: 'po-res-rn', text: `R${r.n}` }),
      h('span', { class: 'po-res-rw', text: r.winner === 'draw' ? '무승부' : `${TEAMS[r.winner].emoji} ${TEAMS[r.winner].name}` }),
      r.reason ? h('span', { class: 'po-res-reason', text: r.reason }) : null))
      : [h('li', { class: 'po-res-round', text: '라운드 기록이 없어요.' })]));

    // MVP: 지정값 → 최다 킬(동률이면 데스 적은 순 → 헤드샷 많은 순)
    let mvp = null;
    if (p.mvp) {
      const name = typeof p.mvp === 'string' ? p.mvp : p.mvp.name;
      mvp = players.find((x) => x.name === name) || (typeof p.mvp === 'object' ? normStatPlayers({ players: [p.mvp] })[0] : { name, kills: 0, deaths: 0, head: 0, team: '' });
    } else if (players.length && players[0].kills > 0) mvp = players[0];
    mvpBox.replaceChildren(
      h('h2', { class: 'po-panel-title', text: '🏅 MVP' }),
      mvp ? h('div', { class: 'po-mvp' },
        h('p', { class: `po-mvp-name t-${mvp.team || 'none'}`, text: mvp.name }),
        mvp.team ? h('p', { class: 'po-mvp-team', text: `${TEAMS[mvp.team].emoji} ${TEAMS[mvp.team].name}` }) : null,
        h('dl', { class: 'po-mvp-stats' },
          h('div', {}, h('dt', { text: '킬' }), h('dd', { text: mvp.kills })),
          h('div', {}, h('dt', { text: '데스' }), h('dd', { text: mvp.deaths })),
          h('div', {}, h('dt', { text: '헤드샷' }), h('dd', { text: mvp.head }))))
        : h('p', { class: 'po-set-hint', text: '이번 매치엔 MVP가 없어요.' }));

    table.replaceChildren(h('table', { class: 'po-sb-table' },
      h('thead', {}, h('tr', {}, ['이름', '팀', '킬', '데스', '헤드샷'].map((t, i) => h('th', { scope: 'col', class: i > 1 ? 'num' : '', text: t })))),
      h('tbody', {}, players.length ? players.map((x) => h('tr', { class: x.me ? 'is-me' : '' },
        h('th', { scope: 'row', class: 'po-sb-name' }, h('span', { text: (x.bot ? '🤖 ' : '') + x.name }), x.me ? h('span', { class: 'po-tag', text: '나' }) : null),
        h('td', { class: `t-${x.team || 'none'}`, text: x.team ? TEAMS[x.team].name : '—' }),
        h('td', { class: 'num', text: x.kills }),
        h('td', { class: 'num', text: x.deaths }),
        h('td', { class: 'num', text: x.head })))
        : h('tr', {}, h('td', { colspan: 5, class: 'po-sb-empty', text: '기록 없음' })))));
  }

  return makeScreen(el, { render });
}
