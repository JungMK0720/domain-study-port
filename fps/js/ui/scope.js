// ⚓ 항만 작전 UI — 스코프 오버레이(원형 시야 + 십자선 + 거리 눈금). amount 0~1로 페이드.
import { h, svg, setText, clamp, num } from './dom.js';

function reticle() {
  const line = (d, w, cls = '') => svg('path', { d, 'stroke-width': w, class: 'po-ret-line' + (cls ? ' ' + cls : '') });
  const parts = [
    // 굵은 바깥 기둥(듀플렉스)
    line('M-100 0 H-34 M34 0 H100 M0 34 V100 M0 -100 V-34', 2.6),
    // 가는 중앙 십자선
    line('M-34 0 H34 M0 -34 V34', 0.5),
  ];
  // 수평·상단 밀 눈금
  let ticks = '';
  for (let i = 6; i <= 30; i += 6) {
    const len = i % 12 === 0 ? 2.6 : 1.6;
    ticks += `M${i} ${-len} V${len} M${-i} ${-len} V${len} M${-len} ${-i} H${len} `;
  }
  parts.push(line(ticks.trim(), 0.45));
  // 하단 거리 눈금(m)
  const ladder = [[8, 6, '100'], [16, 4.8, '200'], [25, 3.8, '300']];
  for (const [y, w, label] of ladder) {
    parts.push(line(`M${-w} ${y} H${w}`, 0.5));
    parts.push(svg('text', { x: w + 1.6, y: y + 1.2, class: 'po-ret-text', text: label }));
  }
  parts.push(svg('text', { x: 1.6, y: 32.5, class: 'po-ret-text po-ret-unit', text: 'm' }));
  parts.push(svg('circle', { cx: 0, cy: 0, r: 0.8, class: 'po-ret-dot' }));
  return svg('svg', { viewBox: '-100 -100 200 200', class: 'po-scope-svg', 'aria-hidden': 'true', focusable: 'false' }, parts);
}

export function createScope(ctx) {
  let amount = 0;
  const zoomEl = h('span', { class: 'po-scope-zoom', hidden: true });
  const lens = h('div', { class: 'po-scope-lens' }, reticle(), zoomEl);
  const el = h('div', { class: 'po-scope', hidden: true, 'aria-hidden': 'true' }, lens);

  /** set(amount 0~1, opts?) — opts: 배율 숫자(4 → "×4") 또는 { zoom, label } */
  function set(a, opts) {
    const v = clamp(num(a, 0), 0, 1);
    if (opts !== undefined) {
      const o = typeof opts === 'object' && opts ? opts : { zoom: opts };
      const label = o.label != null ? String(o.label) : o.zoom ? `×${o.zoom}` : '';
      setText(zoomEl, label);
      zoomEl.hidden = !label;
    }
    if (Math.abs(v - amount) < 0.001 && (v > 0.001) === !el.hidden) return;
    amount = v;
    el.hidden = v <= 0.001;
    const s = v.toFixed(3);
    el.style.setProperty('--a', s);
    ctx.root.style.setProperty('--po-scope', s);
  }

  return {
    el,
    set,
    get amount() { return amount; },
    dispose() { el.remove(); },
  };
}
