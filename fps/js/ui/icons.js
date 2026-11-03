// ⚓ 항만 작전 UI — 도형으로 그린 아이콘(외부 이미지 없음)과 무기·맵 정보 조회
import { svg } from './dom.js';

// ---------- 맵 미니 아이콘 (viewBox 0 0 48 32) ----------
const WAVE = 'M1 28 q3 -2 6 0 t6 0 t6 0 t6 0 t6 0 t6 0 t6 0 t6 0';
const MAP_DRAW = {
  // 원유 부두: 유조선 선수 + 잔교 + 로딩암
  jetty: () => [
    svg('path', { d: WAVE, class: 'po-ic-water' }),
    svg('path', { d: 'M2 19 H17 L14 25 H5 Z', class: 'po-ic-fill' }),
    svg('rect', { x: 4, y: 14, width: 4, height: 5, class: 'po-ic-fill' }),
    svg('rect', { x: 19, y: 17, width: 27, height: 3, class: 'po-ic-fill' }),
    svg('path', { d: 'M23 20 V27 M31 20 V27 M39 20 V27', class: 'po-ic-line' }),
    svg('path', { d: 'M35 17 V6 H42 V11', class: 'po-ic-accent' }),
  ],
  // 탱크 팜: 원통 저장탱크 3기 + 배관
  tankfarm: () => [
    svg('path', { d: 'M1 27 H47', class: 'po-ic-line' }),
    svg('rect', { x: 3, y: 12, width: 12, height: 15, rx: 1, class: 'po-ic-fill' }),
    svg('ellipse', { cx: 9, cy: 12, rx: 6, ry: 2, class: 'po-ic-cap' }),
    svg('rect', { x: 17, y: 7, width: 15, height: 20, rx: 1, class: 'po-ic-fill' }),
    svg('ellipse', { cx: 24.5, cy: 7, rx: 7.5, ry: 2.2, class: 'po-ic-cap' }),
    svg('rect', { x: 34, y: 14, width: 11, height: 13, rx: 1, class: 'po-ic-fill' }),
    svg('ellipse', { cx: 39.5, cy: 14, rx: 5.5, ry: 1.8, class: 'po-ic-cap' }),
    svg('path', { d: 'M2 22 H46', class: 'po-ic-accent' }),
  ],
  // VLCC 갑판: 긴 선체 + 선미 거주구 + 갑판 배관
  vlcc: () => [
    svg('path', { d: WAVE, class: 'po-ic-water' }),
    svg('path', { d: 'M2 17 H46 L42 25 H6 Z', class: 'po-ic-fill' }),
    svg('rect', { x: 35, y: 7, width: 8, height: 10, class: 'po-ic-fill' }),
    svg('rect', { x: 37.5, y: 3, width: 3, height: 4, class: 'po-ic-cap' }),
    svg('path', { d: 'M7 15 H33', class: 'po-ic-accent' }),
    svg('path', { d: 'M9 17 V10 M9 10 L13 12', class: 'po-ic-line' }),
  ],
  // 알 수 없는 맵: 닻
  _: () => [
    svg('circle', { cx: 24, cy: 6.5, r: 2.6, class: 'po-ic-line' }),
    svg('path', { d: 'M24 9 V27 M18 13 H30', class: 'po-ic-line' }),
    svg('path', { d: 'M13 20 Q15 27.5 24 27.5 Q33 27.5 35 20', class: 'po-ic-accent' }),
  ],
};

export function mapIcon(id, cls = '') {
  const draw = MAP_DRAW[id] || MAP_DRAW._;
  return svg('svg', { viewBox: '0 0 48 32', class: 'po-mapico' + (cls ? ' ' + cls : ''), 'aria-hidden': 'true', focusable: 'false' }, draw());
}

// ---------- 헤드샷 아이콘 (조준선 + 머리) ----------
export function headshotIcon() {
  return svg('svg', { viewBox: '0 0 16 16', class: 'po-hs-ico', role: 'img', 'aria-label': '헤드샷' },
    svg('title', { text: '헤드샷' }),
    svg('circle', { cx: 8, cy: 8, r: 5.2 }),
    svg('path', { d: 'M8 0.8 V4.4 M8 11.6 V15.2 M0.8 8 H4.4 M11.6 8 H15.2' }),
    svg('circle', { cx: 8, cy: 8, r: 1.4, class: 'po-hs-dot' }));
}

// ---------- 메뉴 배경: 탱커 터미널 실루엣 ----------
export function skyline() {
  const g = (d, cls = 'po-sky-fill') => svg('path', { d, class: cls });
  return svg('svg', { viewBox: '0 0 1200 220', preserveAspectRatio: 'xMidYMax slice', class: 'po-skyline', 'aria-hidden': 'true', focusable: 'false' },
    g('M0 206 H1200 V220 H0 Z'),
    // 저장탱크
    g('M60 206 V128 Q60 120 70 120 H180 Q190 120 190 128 V206 Z'),
    g('M205 206 V150 Q205 144 213 144 H282 Q290 144 290 150 V206 Z'),
    g('M880 206 V112 Q880 104 890 104 H1010 Q1020 104 1020 112 V206 Z'),
    g('M1035 206 V140 Q1035 134 1043 134 H1122 Q1130 134 1130 140 V206 Z'),
    // 플레어 스택 + 불꽃
    g('M330 206 V44 H340 V206 Z'),
    svg('path', { d: 'M335 41 C327 31 333 22 335 12 C338 22 344 30 335 41 Z', class: 'po-sky-flame' }),
    // 갠트리 크레인
    g('M470 206 V74 H478 V206 Z M560 206 V74 H568 V206 Z M452 66 H700 V76 H452 Z M640 76 H648 V104 H640 Z'),
    g('M478 120 L560 92 L562 98 L480 126 Z'),
    // 로딩암
    g('M745 206 V128 H753 V206 Z M749 128 L792 100 L797 106 L753 134 Z M792 100 L818 142 L812 145 L788 106 Z'),
    // 유조선 선체
    g('M600 206 L618 186 H860 L846 206 Z'),
    g('M800 186 V160 H836 V186 Z'),
    // 파이프랙
    svg('path', { d: 'M0 192 H1200', class: 'po-sky-pipe' }),
    // 항공 장애등
    svg('circle', { cx: 335, cy: 50, r: 2.4, class: 'po-sky-lamp' }),
    svg('circle', { cx: 696, cy: 62, r: 2.4, class: 'po-sky-lamp' }),
    svg('circle', { cx: 950, cy: 98, r: 2.4, class: 'po-sky-lamp' }));
}

// ---------- 무기 ----------
const SLOT_ICONS = ['', '🎯', '🔫', '🔪', '💣'];

export function guessWeaponIcon(id, slot) {
  const s = String(id == null ? '' : id).toLowerCase();
  if (/nor|snip/.test(s)) return '🎯';
  if (/dwt|rifle|assault|\bar\b/.test(s)) return '🔫';
  if (/sof|pistol/.test(s)) return '🔫';
  if (/cut|knife|hawser|melee/.test(s)) return '🔪';
  if (/bunker|grenade|nade|frag/.test(s)) return '💣';
  if (/fall|world|env/.test(s)) return '⚠️';
  return SLOT_ICONS[slot] || '✖';
}

function shortName(name) {
  const first = String(name).split(/\s+/)[0] || '';
  return /[A-Za-z].*\d|\d.*[A-Za-z]/.test(first) ? first : String(name);
}

/** 무기 id(또는 정의 객체) → { id, icon, name, short } */
export function weaponInfo(registry, ref, extra = {}) {
  const isObj = ref && typeof ref === 'object';
  const id = isObj ? ref.id : ref;
  const def = { ...((id != null && registry.get(String(id))) || {}), ...(isObj ? ref : {}) };
  const name = extra.weaponName || def.name || def.label || (id != null ? String(id) : '');
  return {
    id: id == null ? '' : String(id),
    icon: extra.weaponIcon || def.icon || def.emoji || guessWeaponIcon(id, def.slot),
    name,
    short: extra.weaponShort || def.short || def.code || shortName(name),
    def,
  };
}

// ---------- 맵 ----------
// 엔진이 ui.setMaps()/props.maps로 넘기지 않았을 때만 쓰는 최소 대체값(이름만).
const FALLBACK_MAPS = [
  { id: 'jetty', name: '원유 부두', nameEn: 'Crude Jetty', desc: '' },
  { id: 'tankfarm', name: '탱크 팜', nameEn: 'Tank Farm', desc: '' },
  { id: 'vlcc', name: 'VLCC 갑판', nameEn: 'VLCC Deck', desc: '' },
];

export function normMap(m) {
  if (typeof m === 'string') return { id: m, name: m, nameEn: '', desc: '', test: false };
  return { id: String(m.id), name: m.name || String(m.id), nameEn: m.nameEn || '', desc: m.desc || '', test: !!m.test };
}

function allMaps(registry, list) {
  if (Array.isArray(list) && list.length) return list.map(normMap);
  if (registry.size) return [...registry.values()];
  return FALLBACK_MAPS.map(normMap);
}

/** 방 만들기·맵 변경에서 고를 수 있는 맵. core 테스트 맵(test:true)은 뺀다(그것뿐이면 그대로). */
export function mapList(registry, list) {
  const all = allMaps(registry, list);
  const real = all.filter((m) => !m.test);
  return real.length ? real : all;
}

/** id → 맵 정보(테스트 맵 포함). 모르는 id면 id를 이름으로 쓴다. */
export function mapInfo(registry, list, id) {
  return allMaps(registry, list).find((m) => m.id === id) || (id ? normMap(String(id)) : null);
}
