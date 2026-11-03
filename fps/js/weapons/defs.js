/**
 * ⚓ 항만 작전(Port Ops) — 무기 정의 (weapons 담당)
 *
 * 순수 데이터 모듈이다. three.js·엔진·DOM에 의존하지 않아 node에서도 import할 수 있다.
 *  - 단위: 거리 m, 시간 s, 표 안의 각도는 '도(°)'. logic.js가 라디안으로 바꿔 쓴다.
 *  - 반동 패턴 [x, y]: 한 발마다 카메라가 튀는 각도(°). x는 오른쪽이 +, y는 위가 +.
 *  - 탄퍼짐(spread): 원뿔 반각(°). hip = 미조준, ads = 조준(줌) 상태.
 *  - 무기 이름은 팀 도메인(탱커 터미널·용선·체선료) 용어로 지었다. 상용 게임의 이름·수치는 쓰지 않았다.
 */

export const DEG = Math.PI / 180;
export const PLAYER_HP = 100;
/** ARCHITECTURE 2절 걷기 속도(m/s). 이동 탄퍼짐 계산의 기준이다. */
export const WALK_SPEED = 5.2;
/** 기본 세로 FOV 가정값. 엔진 FOV가 다르면 getZoom(baseFov)에 넘긴다. */
export const BASE_FOV = 75;

export const PARTS = Object.freeze(['head', 'body', 'legs']);
export const PRIMARY_IDS = Object.freeze(['nor1', 'dwt47']);
export const WEAPON_IDS = Object.freeze(['nor1', 'dwt47', 'sof9', 'hawser', 'bunker']);
/** 슬롯 1은 로드아웃에서 고른 주무기(PRIMARY_IDS 중 하나). */
export const SLOT_DEFAULTS = Object.freeze({ 2: 'sof9', 3: 'hawser', 4: 'bunker' });

/**
 * 무기 모듈이 돌려주는 벡터: [x, y, z] 배열이면서 .x/.y/.z 속성도 있다.
 * core(배열 규약)와 three.js식 객체 규약 어느 쪽에 넘겨도 그대로 읽힌다. JSON으로는 [x,y,z].
 */
export function vec3(x = 0, y = 0, z = 0) {
  const v = [x, y, z];
  v.x = x; v.y = y; v.z = z;
  return v;
}

/** [x,y,z] 배열이나 {x,y,z} 객체를 읽어 vec3로. 숫자가 아니면 0. */
export function toVec3(v) {
  if (!v) return vec3();
  const a = Array.isArray(v) ? v : [v.x, v.y, v.z];
  const f = (n) => (Number.isFinite(+n) ? +n : 0);
  return vec3(f(a[0]), f(a[1]), f(a[2]));
}

/**
 * DWT-47 반동 패턴(30발). 처음 7발은 거의 수직으로 솟고(묵직한 첫 반동),
 * 8~12발은 왼쪽, 13~18발은 오른쪽, 그 뒤로는 좌우로 작게 흔들린다.
 * 30발을 넘으면(이론상 없음) loopFrom 이후 구간을 반복한다.
 */
const DWT47_PATTERN = [
  [0.00, 0.55], [0.05, 0.60], [-0.05, 0.65], [0.08, 0.70], [0.10, 0.70],
  [0.05, 0.65], [0.12, 0.55], [-0.20, 0.45], [-0.35, 0.35], [-0.40, 0.30],
  [-0.40, 0.25], [-0.30, 0.20], [0.10, 0.20], [0.40, 0.20], [0.50, 0.15],
  [0.50, 0.15], [0.40, 0.15], [0.20, 0.10], [-0.30, 0.10], [-0.45, 0.10],
  [-0.45, 0.10], [-0.30, 0.10], [0.20, 0.10], [0.40, 0.10], [0.45, 0.08],
  [0.35, 0.08], [-0.10, 0.08], [-0.35, 0.08], [-0.35, 0.08], [-0.20, 0.08],
];

const T = {
  nor1: 'NOR(Notice of Readiness, 하역준비완료통지)는 선박이 항구에 도착해 하역 준비를 마쳤음을 선장이 용선자 측에 알리는 통지다. ' +
    '탱커 용선계약에서는 보통 NOR 접수 6시간 뒤와 접안 완료 중 이른 시점부터 정박기간(Laytime)이 흐른다.',
  dwt47: 'DWT(Deadweight Tonnage, 재화중량톤수)는 선박이 실을 수 있는 화물·연료·청수·식량 등의 최대 무게를 톤으로 나타낸 값이다. ' +
    '유조선 크기를 나누는 기준이며, 초대형 유조선(VLCC)은 보통 30만 DWT 안팎이다.',
  sof9: 'SOF(Statement of Facts, 사실기록서)는 선박 도착·NOR 제출·접안·하역 시작과 종료·출항 시각을 순서대로 적은 기록이다. ' +
    '정박기간 사용량과 체선료(Demurrage)를 계산하는 근거가 된다.',
  hawser: '호서(Hawser)는 선박을 부두에 묶거나 예인할 때 쓰는 굵은 계류삭이다. ' +
    '탱커 부두는 비상시 계류삭을 바로 풀 수 있도록 퀵 릴리스 훅(Quick Release Hook)을 갖춘다.',
  bunker: '벙커(Bunker)는 선박이 엔진 연료로 쓰는 연료유이고, 선박에 연료를 공급하는 작업을 벙커링(Bunkering)이라 한다. ' +
    '증기선 시절 석탄을 쌓아 두던 선내 저장고(bunker)에서 나온 말이다.',
};

const WEAPON_TABLE = {
  // ───────────────────────────── 슬롯 1 · 주무기 A ─────────────────────────────
  nor1: {
    id: 'nor1', slot: 1, kind: 'sniper', fire: 'bolt',
    name: 'NOR-1 저격소총', nameEn: 'NOR-1 Sniper Rifle', short: 'NOR-1', role: '저격',
    icon: '🎯', color: '#f2c230',
    term: { abbr: 'NOR', en: 'Notice of Readiness', ko: '하역준비완료통지', desc: T.nor1 },
    desc: T.nor1,
    tagline: '준비 완료, 한 방.',
    stats: [
      { label: '피해', value: '어느 부위든 1발' }, { label: '반샷', value: '줌 50%(0.08초)부터 정조준' },
      { label: '볼트', value: '1.2초 · 사격 후 줌 해제' }, { label: '탄약', value: '5 / 20' }, { label: '이동', value: '85%' },
    ],
    bars: { power: 100, rate: 12, accuracy: 95, mobility: 55 },

    damage: { head: 150, body: 120, legs: 100 },
    minDamage: 100,          // 1발 킬 보장(체력 100)
    falloff: null,
    pellets: 1,
    maxRange: 400,

    rpm: 50, fireInterval: 1.2,
    bolt: 1.2,               // 사격 후 볼트 조작 시간(이 동안 사격·줌 불가)
    emptyShotRecover: 0.35,  // 마지막 탄을 쏜 뒤 자동 재장전까지의 틈

    mag: 5, reserve: 20, reload: 3.0, reloadEmpty: 3.4,
    drawTime: 0.8, moveMul: 0.85,

    spread: { hip: 8, ads: 0, move: 2, adsMove: 1.5, air: 6, adsAir: 6,
      bloomPerShot: 0, bloomMax: 0, bloomDecay: 0, max: 16 },
    recoil: { pattern: [[0, 3.2]], loopFrom: 0, adsMul: 1, maxPitch: 6, maxYaw: 2,
      recoverDelay: 0.06, recoverRate: 5, patternRecover: 10 },
    zoom: { mag: 4, inTime: 0.16, outTime: 0.1, accurateAt: 0.5, overlay: 'scope',
      hideViewmodelAt: 0.9, moveMul: 0.8, unzoomOnFire: true },
  },

  // ───────────────────────────── 슬롯 1 · 주무기 B ─────────────────────────────
  dwt47: {
    id: 'dwt47', slot: 1, kind: 'rifle', fire: 'auto',
    name: 'DWT-47 돌격소총', nameEn: 'DWT-47 Assault Rifle', short: 'DWT-47', role: '돌격',
    icon: '🔫', color: '#c0392b',
    term: { abbr: 'DWT', en: 'Deadweight Tonnage', ko: '재화중량톤수', desc: T.dwt47 },
    desc: T.dwt47,
    tagline: '재화중량톤수처럼 묵직한 연사.',
    stats: [
      { label: '연사', value: '600 rpm' }, { label: '피해', value: '머리 100 · 몸 30 · 다리 22' },
      { label: '반동', value: '위로 솟다가 좌우로' }, { label: '정조준', value: '2배 줌 · 이동 80%' }, { label: '탄약', value: '30 / 90' },
    ],
    bars: { power: 55, rate: 90, accuracy: 65, mobility: 75 },

    damage: { head: 100, body: 30, legs: 22 },
    minDamage: 0,
    falloff: { start: 30, end: 80, min: 0.75 },  // 30m부터 줄어 80m에서 75%
    pellets: 1,
    maxRange: 250,

    rpm: 600, fireInterval: 0.1,

    mag: 30, reserve: 90, reload: 2.3, reloadEmpty: 2.7,
    drawTime: 0.65, moveMul: 0.95,

    spread: { hip: 1.2, ads: 0.2, move: 2.5, adsMove: 1.0, air: 5, adsAir: 4,
      bloomPerShot: 0.15, bloomMax: 1.5, bloomDecay: 4, adsBloomMul: 0.6, max: 10 },
    recoil: { pattern: DWT47_PATTERN, loopFrom: 18, adsMul: 0.8, maxPitch: 10, maxYaw: 4,
      recoverDelay: 0.12, recoverRate: 7, patternRecover: 20 },
    zoom: { mag: 2, inTime: 0.18, outTime: 0.12, accurateAt: null, overlay: null,
      hideViewmodelAt: null, moveMul: 0.8, unzoomOnFire: false },
  },

  // ───────────────────────────── 슬롯 2 · 보조 ─────────────────────────────
  sof9: {
    id: 'sof9', slot: 2, kind: 'pistol', fire: 'semi',
    name: 'SOF-9 권총', nameEn: 'SOF-9 Pistol', short: 'SOF-9', role: '보조',
    icon: '📋', color: '#9aa5b1',
    term: { abbr: 'SOF', en: 'Statement of Facts', ko: '사실기록서', desc: T.sof9 },
    desc: T.sof9,
    tagline: '기록하듯 정확하게.',
    stats: [
      { label: '방식', value: '반자동' }, { label: '피해', value: '머리 70 · 몸 28 · 다리 20' },
      { label: '탄약', value: '12 / 36' }, { label: '꺼내기', value: '0.45초' },
    ],
    bars: { power: 40, rate: 55, accuracy: 72, mobility: 90 },

    damage: { head: 70, body: 28, legs: 20 },
    minDamage: 0,
    falloff: { start: 15, end: 45, min: 0.6 },
    pellets: 1,
    maxRange: 150,

    rpm: 375, fireInterval: 0.16,   // 반자동: 누를 때마다 1발, 최소 간격 0.16초

    mag: 12, reserve: 36, reload: 1.6, reloadEmpty: 1.9,
    drawTime: 0.45, moveMul: 1.0,

    spread: { hip: 0.8, move: 1.6, air: 4.5, bloomPerShot: 0.45, bloomMax: 2.0, bloomDecay: 6, max: 8 },
    recoil: { pattern: [[0, 1.3], [0.25, 1.15], [-0.25, 1.15], [0.15, 1.05]], loopFrom: 1, adsMul: 1,
      maxPitch: 7, maxYaw: 3, recoverDelay: 0.08, recoverRate: 9, patternRecover: 12 },
    zoom: null,
  },

  // ───────────────────────────── 슬롯 3 · 근접 ─────────────────────────────
  hawser: {
    id: 'hawser', slot: 3, kind: 'melee', fire: 'melee',
    name: '호서 커터', nameEn: 'Hawser Cutter', short: 'HAWSER', role: '근접',
    icon: '🔪', color: '#b8935a',
    term: { abbr: 'Hawser', en: 'Hawser', ko: '계류삭', desc: T.hawser },
    desc: T.hawser,
    tagline: '계류삭도 끊는 칼날.',
    stats: [
      { label: '베기', value: '50 · 0.45초' }, { label: '찌르기', value: '100 · 1.0초' },
      { label: '사거리', value: '1.8 m' }, { label: '이동', value: '108%' },
    ],
    bars: { power: 70, rate: 40, accuracy: 0, mobility: 100 },

    damage: null,
    melee: {
      slash: { damage: 50, cooldown: 0.45, windup: 0.06, range: 1.8, arc: 35 },
      stab: { damage: 100, cooldown: 1.0, windup: 0.22, range: 1.8, arc: 12 },
    },
    maxRange: 1.8,
    fireInterval: 0.45,
    mag: null, reserve: null,
    drawTime: 0.4, moveMul: 1.08,
    spread: null, recoil: null, zoom: null,
  },

  // ───────────────────────────── 슬롯 4 · 투척 ─────────────────────────────
  bunker: {
    id: 'bunker', slot: 4, kind: 'grenade', fire: 'throw',
    name: '벙커 수류탄', nameEn: 'Bunker Grenade', short: 'BUNKER', role: '투척',
    icon: '🛢️', color: '#e0b324',
    term: { abbr: 'Bunker', en: 'Bunker (marine fuel)', ko: '선박 연료유', desc: T.bunker },
    desc: T.bunker,
    tagline: '연료 한 드럼, 폭발 한 번.',
    stats: [
      { label: '투척', value: '누르고 떼기 · 16 m/s' }, { label: '굴리기', value: '우클릭' },
      { label: '폭발', value: '2.5초 · 반경 6 m · 최대 100' }, { label: '엄폐', value: '가리면 피해 없음' }, { label: '수량', value: '1개' },
    ],
    bars: { power: 90, rate: 5, accuracy: 40, mobility: 85 },

    damage: null,
    count: 1,
    fuse: 2.5,
    throw: { speed: 16, pitchUp: 6 },      // 좌클릭: 시선보다 6° 위로
    lob: { speed: 8, pitchUp: 4 },         // 우클릭: 낮게 굴리기
    primeTime: 0.25,                       // 핀 뽑기 최소 시간(짧게 눌러도 이만큼 뒤에 던짐)
    throwRecover: 0.35,                    // 던진 뒤 손이 돌아오는 시간
    explosion: { radius: 6, inner: 0.8, max: 100 },   // inner 안쪽은 최대, 6m에서 0까지 선형 감쇠
    physics: {
      radius: 0.07, restitution: 0.35, friction: 0.3, rollDamp: 2.5, gravity: -12,
      restSpeed: 1.0,        // 법선 속도가 이보다 작으면 튀지 않고 미끄러진다
      sleepSpeed: 0.08,      // 바닥에서 이보다 느리면 멈춘다
      bounceEventSpeed: 1.2, // 이보다 세게 부딪히면 bounce 이벤트(소리용)
      step: 1 / 120,         // 고정 시간 간격(모든 클라이언트가 같은 궤적을 계산하도록)
    },
    maxRange: 6,
    fireInterval: 0.6,
    mag: null, reserve: null,
    drawTime: 0.5, moveMul: 1.0,
    spread: null, recoil: null, zoom: null,
  },
};

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const k of Object.keys(o)) deepFreeze(o[k]);
  }
  return o;
}

/** 무기 정의 표(읽기 전용). */
export const WEAPONS = deepFreeze(WEAPON_TABLE);

/** id로 정의를 찾는다. 없으면 null. */
export function getDef(id) {
  return Object.prototype.hasOwnProperty.call(WEAPONS, id) ? WEAPONS[id] : null;
}

const PART_ALIAS = {
  head: 'head', neck: 'head', helmet: 'head',
  body: 'body', chest: 'body', torso: 'body', arm: 'body', arms: 'body',
  legs: 'legs', leg: 'legs', foot: 'legs', feet: 'legs',
};

/** 부위 이름을 head/body/legs로 정규화한다(모르는 값은 body). */
export function normalizePart(part) {
  return PART_ALIAS[String(part || '').toLowerCase()] || 'body';
}

/** 거리 감쇠 배율(0~1). falloff가 없으면 1. */
export function falloffMul(falloff, dist) {
  if (!falloff || !(dist > falloff.start)) return 1;
  if (dist >= falloff.end) return falloff.min;
  const t = (dist - falloff.start) / (falloff.end - falloff.start);
  return 1 + (falloff.min - 1) * t;
}

/** 폭발 데미지(거리만 반영, 차폐는 grenade.js에서 판정). 정수. */
export function explosionFalloff(dist, ex = WEAPONS.bunker.explosion) {
  const d = Number.isFinite(dist) ? Math.max(0, dist) : 0;
  if (d >= ex.radius) return 0;
  if (d <= ex.inner) return ex.max;
  return Math.round(ex.max * (1 - (d - ex.inner) / (ex.radius - ex.inner)));
}

/**
 * 데미지 표 조회 → 정수 데미지.
 * @param {string} weaponId  'nor1' | 'dwt47' | 'sof9' | 'hawser' | 'bunker'
 * @param {string} part      'head' | 'body' | 'legs' (칼·수류탄은 무시)
 * @param {number} dist      거리(m). 총은 거리 감쇠, 수류탄은 폭심 거리
 * @param {string} [kind]    칼: 'slash'(기본) | 'stab'
 */
export function damage(weaponId, part = 'body', dist = 0, kind) {
  const def = getDef(weaponId);
  if (!def) return 0;
  if (def.melee) return def.melee[kind === 'stab' ? 'stab' : 'slash'].damage;
  if (def.explosion) return explosionFalloff(dist, def.explosion);
  if (!def.damage) return 0;
  const base = def.damage[normalizePart(part)];
  const d = Number.isFinite(dist) ? Math.max(0, dist) : 0;
  let v = base * falloffMul(def.falloff, d);
  if (def.minDamage) v = Math.max(v, def.minDamage);
  return Math.max(1, Math.round(v));
}

/** 배율 mag의 줌 FOV(°). tan(fov/2)를 배율로 나눈다. */
export function zoomFov(baseFovDeg, mag) {
  const base = Number.isFinite(baseFovDeg) && baseFovDeg > 0 ? baseFovDeg : BASE_FOV;
  const m = Number.isFinite(mag) && mag > 0 ? mag : 1;
  return 2 * Math.atan(Math.tan((base * DEG) / 2) / m) / DEG;
}
