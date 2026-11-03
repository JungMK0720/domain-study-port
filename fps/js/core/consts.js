/**
 * ⚓ Port Ops — 공용 상수 (ARCHITECTURE.md 2절). three.js 의존 없음(node에서도 import 가능).
 *
 * 좌표계: 1 단위 = 1 m, y 위쪽, 지면 y = 0, 맵 원점 = 맵 중앙.
 * 방향: yaw = Y축 회전(라디안, three.js rotation.y와 동일). yaw 0 → -Z를 바라봄,
 *       yaw 증가 = 위에서 볼 때 반시계(왼쪽으로 회전). 전방 벡터 = (-sin yaw, 0, -cos yaw).
 *       pitch 양수 = 위를 봄.
 */

export const VERSION = '1.0.0';

/** 플레이어 신체·이동 */
export const PLAYER = Object.freeze({
  HEIGHT: 1.8,       // 키 (m)
  EYE: 1.6,          // 눈높이 (m, 발바닥 기준)
  RADIUS: 0.35,      // 충돌 반지름 (m)
  WALK: 5.2,         // 걷기 (m/s)
  SLOW_WALK: 2.4,    // Shift 천천히 걷기 (m/s)
  JUMP_V: 6.3,       // 점프 초속 (m/s) — 최고 높이 ≈ 1.24 m (+공중 턱 오르기 0.225 → 약 1.46 m 위에 올라탐)
  GRAVITY: -16,      // 중력 (m/s²)
  STEP: 0.45,        // 계단 오름 높이 (m)
  HP: 100,           // 체력
  MAX_FALL: 40,      // 최대 낙하 속도 (m/s)
  // 앉기 (Ctrl·C 누르고 있는 동안)
  CROUCH_HEIGHT: 1.25, // 앉은 키 (m)
  CROUCH_EYE: 1.1,     // 앉은 눈높이 (m)
  CROUCH_SPEED: 2.6,   // 앉아서 이동 (m/s)
  CROUCH_TIME: 0.12    // 앉기/일어서기 전환 시간 (s, 카메라·아바타 자세)
});

/**
 * 히트박스 (발바닥 기준 로컬 좌표, 로컬 -Z = 정면).
 * head: 구(중심 높이 y, 반지름 r) / body·legs: yaw로 회전하는 박스(반폭 hw = 로컬 x, 반깊이 hd = 로컬 z).
 */
export const HITBOX = Object.freeze({
  HEAD: Object.freeze({ y: 1.62, r: 0.14 }),
  BODY: Object.freeze({ y0: 1.0, y1: 1.5, hw: 0.26, hd: 0.17 }),
  LEGS: Object.freeze({ y0: 0.0, y1: 1.0, hw: 0.22, hd: 0.15 })
});

/** 앉은 히트박스 (hw·hd는 서 있을 때와 같음). 레이 대상의 crouch(true 또는 0..1)로 HITBOX와 섞는다 */
export const HITBOX_CROUCH = Object.freeze({
  HEAD: Object.freeze({ y: 1.12, r: 0.14 }),
  BODY: Object.freeze({ y0: 0.6, y1: 1.05, hw: 0.26, hd: 0.17 }),
  LEGS: Object.freeze({ y0: 0.0, y1: 0.6, hw: 0.22, hd: 0.15 })
});

/** 앉은 상태에서의 탄퍼짐 배율 (weapons/logic.js · 임시 총) */
export const CROUCH_SPREAD_MUL = 0.8;

/** 히트 부위 이름 */
export const PARTS = Object.freeze(['head', 'body', 'legs']);

/** 팀 */
export const TEAMS = Object.freeze({
  owner: Object.freeze({ id: 'owner', name: '선주', nameEn: 'Owner', color: '#22407a', light: '#5b82d6' }),
  charterer: Object.freeze({ id: 'charterer', name: '용선자', nameEn: 'Charterer', color: '#e8731c', light: '#ffab5e' })
});
export const TEAM_IDS = Object.freeze(['owner', 'charterer']);

/** 고정 틱 */
export const TICK_RATE = 60;
export const TICK_DT = 1 / TICK_RATE;

/** 네트워크 동기화 */
export const NET = Object.freeze({
  SEND_HZ: 10,             // 각자 자기 상태 브로드캐스트 빈도
  INTERP_DELAY_MS: 100,    // 원격 아바타 보간 지연
  LOBBY_CHANNEL: 'portops:lobby',
  ROOM_CHANNEL_PREFIX: 'portops:room:'
});

/** 경기 규칙 */
export const MATCH = Object.freeze({
  ROUNDS_TO_WIN: 3,        // 5판 3선승
  MAX_ROUNDS: 5,
  ROUND_TIME: 120,         // 초
  MAX_PLAYERS: 8,          // 4:4
  MIN_PLAYERS: 2,
  RESPAWN_IN_ROUND: false
});

/** 카메라 */
export const VIEW = Object.freeze({
  FOV: 75,                 // 기본 수직 FOV (도)
  NEAR: 0.05,
  FAR: 1500,
  VIEWMODEL_FOV: 60
});

/** 재질 팔레트 (맵 mat는 이 이름만) */
export const MATS = Object.freeze([
  'concrete', 'asphalt', 'steel', 'rust', 'deck', 'tank', 'pipe', 'wood',
  'glass', 'container_red', 'grass', 'water', 'white', 'yellow'
]);

/** 맵 데이터 한도 */
export const LIMITS = Object.freeze({ SOLIDS: 300, DECOR: 200, REAL_LIGHTS: 4 });

/** 무기 슬롯 */
export const SLOTS = Object.freeze({ PRIMARY: 1, SECONDARY: 2, MELEE: 3, THROWABLE: 4 });

/** 화면 상태 */
export const SCREENS = Object.freeze(['menu', 'sandbox', 'lobby', 'room', 'match', 'results']);

/** 마우스 감도 기준(라디안/픽셀). 실제 = BASE × settings.sensitivity × lookScale */
export const MOUSE = Object.freeze({ BASE_SENS: 0.0022 });

/** 각도 단위 보정: |v| > 2π+0.01 이면 도(deg)로 보고 라디안으로 변환 */
export function toRad(v) {
  const n = Number(v) || 0;
  return Math.abs(n) > Math.PI * 2 + 0.01 ? n * Math.PI / 180 : n;
}
