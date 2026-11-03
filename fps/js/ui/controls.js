// ⚓ 항만 작전 UI — 조작법 시트
import { h, btn } from './dom.js';
import { sheet, keycap } from './parts.js';

const OR = '|'; // 키 사이 "또는"
const KEYS = [
  [['W', 'A', 'S', 'D'], '이동'],
  [['마우스'], '시점'],
  [['좌클릭'], '사격 · 베기 · 투척'],
  [['우클릭'], '줌 (설정에서 누르고 있기 / 토글)'],
  [['Space'], '점프'],
  [['Ctrl', OR, 'C'], '앉기 (누르고 있는 동안)'],
  [['Shift'], '천천히 걷기'],
  [['R'], '재장전'],
  [['1', '2', '3', '4'], '주무기 · 보조 · 근접 · 투척'],
  [['휠'], '무기 전환'],
  [['Tab'], '점수판 (누르는 동안)'],
  [['B'], '누르고 있기: 이모트 휠 (마우스로 고르고 떼기, 움직이면 취소)'],
  [['Esc'], '일시정지 메뉴'],
];

const RULES = [
  '팀전: 선주(Owner) 🟦 vs 용선자(Charterer) 🟧 섬멸전 · 5판 3선승 · 라운드 2:00 · 라운드 중 부활 없음',
  '팀전 시간 종료: 생존자가 많은 팀 → 남은 체력 합이 큰 팀 → 같으면 무승부(재경기)',
  '개인전: 모두가 적 · 먼저 목표 킬(기본 20)에 닿으면 우승 · 5분 · 죽으면 3초 뒤 부활(직후 잠깐 보호)',
  '저격소총은 줌이 절반 이상 들어갔을 때 쏘면 정확해요(반샷).',
];

export function createControlsPanel({ onClose }) {
  const list = h('ul', { class: 'po-keys' },
    KEYS.map(([keys, desc]) => h('li', { class: 'po-keys-row' },
      h('span', { class: 'po-keys-caps' }, keys.map((k) => (k === OR ? h('span', { class: 'po-keys-or', text: '또는' }) : keycap(k)))),
      h('span', { class: 'po-keys-desc', text: desc }))));
  // Ctrl+W는 브라우저가 가로채 탭을 닫는다(페이지가 막을 수 없음)
  const warn = h('p', { class: 'po-keys-warn', role: 'note' },
    h('b', { text: '⚠️ 앉은 채 앞으로 갈 때는 C 추천' }),
    h('span', { text: ' — Ctrl+W는 브라우저 탭 닫기예요.' }));
  const rules = h('ul', { class: 'po-rules' }, RULES.map((t) => h('li', { text: t })));
  const el = sheet({
    title: '🎮 조작법',
    onClose,
    cls: 'po-controls',
    body: [list, warn, h('h3', { class: 'po-sub-title', text: '규칙' }), rules],
    foot: [btn('확인', onClose, 'po-btn--primary', { 'data-autofocus': '' })],
  });
  return { el };
}
