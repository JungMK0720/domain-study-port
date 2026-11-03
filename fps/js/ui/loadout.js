// ⚓ 항만 작전 UI — 로드아웃(라운드 전 주무기 선택, 카운트다운)
// 무기 이름·수치·도메인 용어 해설은 무기 담당(defs)이 props로 준다. 여기서는 표시만 한다.
import { h, setText, isTextField, clamp, num } from './dom.js';
import { makeScreen } from './parts.js';
import { weaponInfo } from './icons.js';

const BAR_LABELS = { power: '위력', rate: '연사', accuracy: '정확도', mobility: '기동성', range: '사거리', control: '반동 제어' };

/** bars: { power: 0~100, ... } 또는 [{ label, value }] → 막대 그래프 */
function normBars(b) {
  if (!b || typeof b !== 'object') return [];
  const pairs = Array.isArray(b)
    ? b.filter(Boolean).map((x) => [x.label != null ? x.label : x.key, x.value])
    : Object.keys(b).map((k) => [BAR_LABELS[k] || k, b[k]]);
  return pairs.filter(([label]) => label != null && label !== '')
    .map(([label, v]) => ({ label: String(label), value: clamp(num(v, 0), 0, 100) }));
}

function normStats(st) {
  if (!st) return [];
  const one = (label, value, unit) => ({ label: String(label), value: `${value}${unit ? unit : ''}` });
  if (Array.isArray(st)) {
    return st.filter(Boolean).map((x) => (Array.isArray(x) ? one(x[0], x[1]) : one(x.label != null ? x.label : x.name, x.value, x.unit)));
  }
  if (typeof st === 'object') return Object.keys(st).map((k) => one(k, st[k]));
  return [];
}

function normTerms(t) {
  if (!t) return [];
  if (Array.isArray(t)) return t.flatMap(normTerms);
  if (typeof t === 'string') return [{ word: '', sub: '', desc: t }];
  let word = t.word || t.term || t.abbr || t.title || t.name || '';
  let ko = t.ko || t.korean || '';
  if (!word && ko) { word = ko; ko = ''; }
  const sub = [t.en || t.english || t.full || '', ko].filter(Boolean).join(' · ');
  return [{ word: String(word), sub, desc: String(t.desc || t.text || t.description || t.body || '') }];
}

function normWeapon(reg, ref) {
  const info = weaponInfo(reg, ref);
  const d = info.def;
  return {
    id: info.id,
    name: info.name,
    icon: info.icon,
    tagline: d.tagline || d.subtitle || d.summary || '',
    stats: normStats(d.stats),
    bars: normBars(d.bars),
    terms: normTerms(d.term != null ? d.term : d.glossary != null ? d.glossary : d.domain),
  };
}

export function createLoadout(ctx) {
  let p = {};
  let weapons = [];
  let endAt = 0;
  let timer = null;

  const title = h('h2', { class: 'po-lo-title po-stencil' });
  const sub = h('p', { class: 'po-lo-sub', text: '카드를 누르거나 1 · 2 키로 고르세요' });
  const count = h('div', { class: 'po-lo-count', role: 'timer', 'aria-label': '남은 시간' });
  const barFill = h('i');
  const cards = h('div', { class: 'po-lo-cards' });
  const foot = h('p', { class: 'po-lo-foot' });

  const el = h('section', { class: 'po-screen po-overlay po-loadout', hidden: true, role: 'dialog', 'aria-label': '주무기 선택' },
    h('div', { class: 'po-lo-panel' },
      h('header', { class: 'po-lo-header' }, h('div', { class: 'po-lo-heading' }, title, sub), count),
      h('div', { class: 'po-lo-bar', 'aria-hidden': 'true' }, barFill),
      cards,
      foot));

  const defaultId = () => {
    if (p.selected != null && weapons.some((w) => w.id === String(p.selected))) return String(p.selected);
    return weapons[0] ? weapons[0].id : null;
  };

  function pick(id, auto) {
    if (id == null) return;
    stop();
    ctx.emit('loadout:pick', { id, auto: !!auto });
    ctx.hideSelf('loadout');
  }

  function termBox(t) {
    return h('div', { class: 'po-lo-term' },
      h('div', { class: 'po-lo-term-head' },
        h('span', { class: 'po-lo-term-badge', text: '📘 용어 해설' }),
        t.word ? h('b', { class: 'po-lo-term-word', text: t.word }) : null,
        t.sub ? h('span', { class: 'po-lo-term-sub', text: t.sub }) : null),
      t.desc ? h('p', { class: 'po-lo-term-desc', text: t.desc }) : null);
  }

  function card(w, i, sel) {
    return h('article', { class: 'po-lo-card po-steel po-rivets' + (sel ? ' is-sel' : ''), onclick: () => pick(w.id, false) },
      h('header', { class: 'po-lo-head' },
        h('span', { class: 'po-lo-ico', text: w.icon, 'aria-hidden': 'true' }),
        h('div', { class: 'po-lo-names' },
          h('h3', { class: 'po-lo-name po-stencil', text: w.name }),
          w.tagline ? h('p', { class: 'po-lo-tagline', text: w.tagline }) : null),
        h('kbd', { class: 'po-key', text: String(i + 1), title: `${i + 1}번 키` })),
      w.stats.length ? h('dl', { class: 'po-lo-stats' },
        w.stats.map((s) => h('div', { class: 'po-lo-stat' }, h('dt', { text: s.label }), h('dd', { text: s.value })))) : null,
      w.bars.length ? h('div', { class: 'po-lo-bars' },
        w.bars.map((b) => h('div', { class: 'po-lo-barrow' },
          h('span', { class: 'po-lo-barlabel', text: b.label }),
          h('span', { class: 'po-meter po-lo-meter', role: 'meter', 'aria-label': b.label, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': b.value },
            h('i', { style: { transform: `scaleX(${b.value / 100})` } }))))) : null,
      w.terms.map(termBox),
      h('button', {
        type: 'button', class: 'po-btn po-btn--primary po-lo-pick',
        onclick: (e) => { e.stopPropagation(); pick(w.id, false); },
      }, sel ? '✔ 이 무기로 출격' : '이 무기로 출격'));
  }

  function stop() {
    if (timer != null) { ctx.cancel(timer); timer = null; }
  }
  function tick() {
    const left = endAt - performance.now();
    setText(count, String(Math.max(0, Math.ceil(left / 1000))));
    el.classList.toggle('is-urgent', left <= 2000);
    if (left <= 0) pick(defaultId(), true);
  }
  function startCountdown(sec) {
    stop();
    const s = Number(sec);
    const timed = Number.isFinite(s) && s > 0;
    count.hidden = !timed;
    barFill.parentElement.hidden = !timed;
    el.classList.remove('is-urgent');
    if (!timed) return;
    const ms = s * 1000;
    endAt = performance.now() + ms;
    barFill.style.transition = 'none';
    barFill.style.transform = 'scaleX(1)';
    void barFill.offsetWidth; // 트랜지션 재시작
    barFill.style.transition = `transform ${ms}ms linear`;
    barFill.style.transform = 'scaleX(0)';
    tick();
    timer = ctx.every(tick, 100);
  }

  function render(props, { fresh, patch }) {
    p = props;
    weapons = (Array.isArray(p.weapons) ? p.weapons : []).map((w) => normWeapon(ctx.weapons, w));
    const def = defaultId();
    setText(title, p.title || (p.round ? `라운드 ${p.round} · 주무기 선택` : '주무기 선택'));
    cards.replaceChildren(...(weapons.length
      ? weapons.map((w, i) => card(w, i, w.id === def && p.selected != null))
      : [h('p', { class: 'po-lo-empty', text: '무기 정보를 불러오지 못했어요.' })]));
    const dw = weapons.find((w) => w.id === def);
    const secs = p.seconds === undefined ? 5 : p.seconds;
    setText(foot, dw && Number(secs) > 0 && Number.isFinite(Number(secs)) ? `시간 안에 고르지 않으면 ${dw.name}(으)로 출격해요.` : '');
    if (fresh || 'seconds' in patch) startCountdown(secs);
  }

  // 숫자키는 캡처 단계에서 받아 여기서 소비한다. 그래야 엔진 입력(window 버블 리스너)이
  // 같은 키를 무기 슬롯 전환으로 한 번 더 처리하지 않는다. 예: 2로 DWT-47을 골랐는데 SOF-9를 드는 문제.
  ctx.listen(window, 'keydown', (e) => {
    if (!screen.visible || isTextField(e.target)) return;
    const m = /^(?:Digit|Numpad)([1-9])$/.exec(e.code || '');
    if (!m) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.repeat) return;
    const w = weapons[Number(m[1]) - 1];
    if (w) pick(w.id, false);
  }, true);

  const screen = makeScreen(el, { render, onHide: stop, onDispose: stop });
  return screen;
}
