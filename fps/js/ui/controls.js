// ⚓ 항만 작전 UI — 조작법 시트
import { h, btn } from './dom.js';
import { sheet, keycap } from './parts.js';

const KEYS = [
  [['W', 'A', 'S', 'D'], '이동'],
  [['마우스'], '시점'],
  [['좌클릭'], '사격 · 베기 · 투척'],
  [['우클릭'], '줌 (설정에서 누르고 있기 / 토글)'],
  [['Space'], '점프'],
  [['Shift'], '천천히 걷기'],
  [['R'], '재장전'],
  [['1', '2', '3', '4'], '주무기 · 보조 · 근접 · 투척'],
  [['휠'], '무기 전환'],
  [['Tab'], '점수판 (누르는 동안)'],
  [['Esc'], '일시정지 메뉴'],
];

const RULES = [
  '선주(Owner) 🟦 vs 용선자(Charterer) 🟧 팀 섬멸전 · 5판 3선승',
  '라운드 2:00 · 라운드 중 부활 없음 · 체력 100',
  '시간이 끝나면 생존자가 많은 팀 → 남은 체력 합이 큰 팀 → 같으면 무승부(재경기)',
  '저격소총은 줌이 절반 이상 들어갔을 때 쏘면 정확해요(반샷).',
];

export function createControlsPanel({ onClose }) {
  const list = h('ul', { class: 'po-keys' },
    KEYS.map(([keys, desc]) => h('li', { class: 'po-keys-row' },
      h('span', { class: 'po-keys-caps' }, keys.map(keycap)),
      h('span', { class: 'po-keys-desc', text: desc }))));
  const rules = h('ul', { class: 'po-rules' }, RULES.map((t) => h('li', { text: t })));
  const el = sheet({
    title: '🎮 조작법',
    onClose,
    cls: 'po-controls',
    body: [list, h('h3', { class: 'po-sub-title', text: '규칙' }), rules],
    foot: [btn('확인', onClose, 'po-btn--primary', { 'data-autofocus': '' })],
  });
  return { el };
}
