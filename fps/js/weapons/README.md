# ⚓ 항만 작전 — 무기 모듈 (`fps/js/weapons/`)

담당: **weapons**. ARCHITECTURE.md 5절(무기)·6절(입력)을 구현한다.

| 파일 | 내용 | 의존 |
|---|---|---|
| `defs.js` | 무기 5종 수치·표시 정보·도메인 해설, `damage()` | 없음(순수) |
| `logic.js` | 무기 상태 머신 `createArsenal()` | defs |
| `grenade.js` | 수류탄 투척 물리·폭발 피해 `createGrenadeSystem()` | defs (충돌 함수는 주입) |
| `viewmodel.js` | 1인칭 무기 모형 `createViewmodel()` | three, defs |

`defs`·`logic`·`grenade`는 three.js·엔진·DOM을 쓰지 않는다. 그래서 node에서 바로 테스트할 수 있다.

---

## 1. 무기 표

| 슬롯 | id | 이름 | 데미지 (머리/몸/다리) | 연사 | 탄창/예비 | 재장전 (보통/빈 탄창) | 꺼내기 | 이동 |
|---|---|---|---|---|---|---|---|---|
| 1 | `nor1` | 🎯 NOR-1 저격소총 | 150/120/100, 최소 100 → **어느 부위든 1발 킬** | 볼트 1.2s | 5/20 | 3.0/3.4s | 0.8s | 0.85 (줌 중 ×0.8) |
| 1 | `dwt47` | 🔫 DWT-47 돌격소총 | 100/30/22. 30m부터 줄어 80m에서 75% | 600rpm (0.1s) | 30/90 | 2.3/2.7s | 0.65s | 0.95 (정조준 ×0.8 = 0.76) |
| 2 | `sof9` | 📋 SOF-9 권총 | 70/28/20. 15m부터 줄어 45m에서 60% | 반자동, 최소 0.16s | 12/36 | 1.6/1.9s | 0.45s | 1.0 |
| 3 | `hawser` | 🔪 호서 커터 | 베기 50 (0.45s), 찌르기 100 (1.0s). 부위 무관, 사거리 1.8m | — | ∞ | — | 0.4s | 1.08 |
| 4 | `bunker` | 🛢️ 벙커 수류탄 | 폭심 0.8m 안 100. 6m까지 선형으로 줄어 0. 가리면 0 | 신관 2.5s | 1개 | — | 0.5s | 1.0 |

탄퍼짐은 원뿔 반각(°)이다. 쏠 때마다 이 원뿔 안에서 가운데로 몰리게 뽑는다.

| 무기 | 미조준 | 조준 | 이동(최대, 조준 시) | 공중 | 연사 블룸 |
|---|---|---|---|---|---|
| NOR-1 | **8** | **0** (줌 진행도 ≥ 0.5) | +2 (+1.5) | +6 | — |
| DWT-47 | 1.2 | 0.2 (줌 진행도에 비례) | +2.5 (+1.0) | +5 (+4) | 발당 +0.15, 최대 1.5 (조준 시 ×0.6) |
| SOF-9 | 0.8 | — | +1.6 | +4.5 | 발당 +0.45, 최대 2.0 |

- 이동 페널티는 `수평 속력 / 5.2`에 비례한다. Shift 천천히 걷기(`walking`)는 그 절반이다.
- 반동은 카메라를 튀게 하는 각도(°)이고, 표기는 위 +, 오른쪽 +다.
  - DWT-47은 정해진 30발 패턴을 따른다. 1~7발은 거의 수직으로 0.55~0.7°씩 오르고, 8~12발은 왼쪽, 13~18발은 오른쪽으로 흐른 뒤, 이후 좌우로 작게 흔들린다. 정조준하면 ×0.8.
  - 회복: 마지막 발 0.12s 뒤부터 초당 7의 비율로 지수적으로 원위치한다. 패턴 위치도 초당 20발씩 처음으로 되돌아간다.
  - NOR-1은 한 발에 3.2° 튀고, SOF-9는 1.05~1.3° 튄다.
- 줌
  - NOR-1: 4배, 줌 인 0.16s, 줌 아웃 0.1s. 진행도 0.55부터 스코프 오버레이가 나타나고 0.9를 넘으면 모형을 숨긴다.
  - DWT-47: 2배, 0.18s. 홀로 조준경을 화면 가운데로 가져오고 모형은 보인 채 둔다.
- 칼 판정은 휘두른 뒤 베기 0.06s, 찌르기 0.22s 지점에서 한 번 한다.
- 수류탄
  - 좌클릭: 누르면 핀을 뽑고(최소 0.25s), 떼면 던진다. 초속 16m/s로 시선보다 6° 위를 향한다.
  - 우클릭: 낮게 굴리기. 8m/s, 4° 위.
  - 물리: 중력 −12, 반발 0.35, 부딪힐 때 접선 속도 70% 유지, 구르기 감쇠 2.5/s, 반지름 0.07m.

### 이름과 도메인 해설

ARCHITECTURE 5절의 가칭을 **그대로 확정**했다. 다섯 개 모두 팀 도메인(탱커 터미널·용선·체선료)의 실제 용어이고 무기의 성격과도 맞는다(NOR = "준비 완료 통지 → 한 방", SOF = "시각을 정확히 기록 → 정확한 권총"). 그래서 바꿀 이유가 없었다. 영문명은 `NOR-1 Sniper Rifle`, `DWT-47 Assault Rifle`, `SOF-9 Pistol`, `Hawser Cutter`, `Bunker Grenade`로 정했다.

로드아웃 화면에 보여 줄 해설은 각 정의의 `desc`(= `term.desc`)에 있다.

- **NOR**(Notice of Readiness, 하역준비완료통지)는 선박이 항구에 도착해 하역 준비를 마쳤음을 선장이 용선자 측에 알리는 통지다. 탱커 용선계약에서는 보통 NOR 접수 6시간 뒤와 접안 완료 중 이른 시점부터 정박기간(Laytime)이 흐른다.
- **DWT**(Deadweight Tonnage, 재화중량톤수)는 선박이 실을 수 있는 화물·연료·청수·식량 등의 최대 무게를 톤으로 나타낸 값이다. 유조선 크기를 나누는 기준이며, 초대형 유조선(VLCC)은 보통 30만 DWT 안팎이다.
- **SOF**(Statement of Facts, 사실기록서)는 선박 도착·NOR 제출·접안·하역 시작과 종료·출항 시각을 순서대로 적은 기록이다. 정박기간 사용량과 체선료(Demurrage)를 계산하는 근거가 된다.
- **호서**(Hawser)는 선박을 부두에 묶거나 예인할 때 쓰는 굵은 계류삭이다. 탱커 부두는 비상시 계류삭을 바로 풀 수 있도록 퀵 릴리스 훅(Quick Release Hook)을 갖춘다.
- **벙커**(Bunker)는 선박이 엔진 연료로 쓰는 연료유이고, 선박에 연료를 공급하는 작업을 벙커링(Bunkering)이라 한다. 증기선 시절 석탄을 쌓아 두던 선내 저장고(bunker)에서 나온 말이다.

모형 도장도 같은 소재로 맞췄다.

| 무기 | 도장 |
|---|---|
| NOR-1 | 남색 + 안전 황색, `NOTICE OF READINESS` 표기 |
| DWT-47 | 선체 방청 적색. 탄창에 만재흘수선 표(Load Line mark) |
| SOF-9 | 회색 슬라이드에 `SOF-9` 표기 |
| 호서 커터 | 밧줄 감은 손잡이 + 갈고리형 톱니 날 |
| 벙커 수류탄 | 작은 연료 드럼. `BUNKER / VLSFO · 0.5%S` 라벨 |

상용 게임의 이름·모델·수치는 쓰지 않았다.

---

## 2. 공통 규약

- 단위: 거리 m, 시간 s. **API의 각도는 모두 라디안**이다(`defs.js`의 표만 도(°)).
- 각도 방향은 three.js 카메라 Euler `'YXZ'`, CORE_API 1절과 같다.
  - **yaw +** = 왼쪽(`rotation.y`), **pitch +** = 위(`rotation.x`).
- 벡터 출력은 `vec3`다. `[x, y, z]` 배열이면서 `.x/.y/.z` 속성도 있다. core(배열 규약)에도, `{x,y,z}`를 읽는 코드에도 그대로 넘길 수 있고, JSON으로 바꾸면 `[x,y,z]`가 된다.
- 벡터 입력은 배열과 `{x,y,z}`를 모두 받는다.
- `pos`는 발바닥 위치다(CORE_API와 같음).

---

## 3. `defs.js`

```js
import { WEAPONS, getDef, damage, PRIMARY_IDS, WEAPON_IDS } from './weapons/defs.js';
```

### 무기 정의(`WEAPONS[id]`)

읽기 전용(deep freeze)이다. 필드 이름은 `game/match.js`의 `weaponRulesFromDefs()`가 읽으므로 **바꾸지 않는다**.

| 묶음 | 필드 |
|---|---|
| 표시 | `id, slot, kind, fire, name, nameEn, short, role, icon, color, tagline, desc` |
| 해설 | `term {abbr, en, ko, desc}`. UI 로드아웃은 `term`을 읽는다 |
| 로드아웃 카드 | `stats [{label, value}]`, `bars {power, rate, accuracy, mobility}` (0~100) |
| 피해 | `damage {head, body, legs}`, `minDamage`, `falloff {start, end, min}`, `pellets`, `maxRange` |
| 사격 | `rpm`, `fireInterval` |
| 탄약 | `mag`, `reserve`, `reload`, `reloadEmpty` |
| 기본 | `drawTime`, `moveMul` |
| 퍼짐·반동·줌 | `spread {...}`, `recoil {pattern, ...}`, `zoom {mag, inTime, outTime, accurateAt, overlay, hideViewmodelAt, moveMul, unzoomOnFire}` |
| 저격 전용 | `bolt`, `emptyShotRecover` |
| 칼 전용 | `melee {slash, stab}` → `{damage, cooldown, windup, range, arc(°)}` |
| 수류탄 전용 | `count, fuse, throw, lob, primeTime, throwRecover, explosion {radius, inner, max}, physics {...}` |

### 함수

- `damage(weaponId, part, dist, kind)` → **정수 데미지**
  - 총은 부위표에 거리 감쇠를 곱한다. NOR-1은 최소 100.
  - 칼은 `kind`가 `'stab'`이면 100, 그 외는 50.
  - 수류탄은 `dist`를 폭심 거리로 보고 감쇠만 적용한다(차폐는 `grenade.js`가 판정).
  - 모르는 부위는 body, 모르는 무기는 0.
- `getDef(id)`, `normalizePart(part)`, `falloffMul(falloff, dist)`, `explosionFalloff(dist, ex?)`, `zoomFov(baseFovDeg, mag)`
- `vec3(x,y,z)`, `toVec3(v)`
- 상수: `DEG, PLAYER_HP, WALK_SPEED(5.2), BASE_FOV(75), PARTS, PRIMARY_IDS, WEAPON_IDS, SLOT_DEFAULTS`

---

## 4. `logic.js` — `createArsenal(opts)`

```js
const arsenal = createArsenal({ primary: 'nor1' | 'dwt47', zoomMode: 'hold' | 'toggle', rng?, walkSpeed?, draw? });
```

- `primary`가 잘못되면 `dwt47`.
- 처음에는 주무기를 든 준비 상태다. `draw: true`면 꺼내는 동작부터 시작한다.

### `update(dt, input, motion)` → 이벤트 배열(매번 새 배열)

`input` 필드는 모두 생략할 수 있다.

| 필드 | 뜻 |
|---|---|
| `fireDown` | 좌클릭을 누르고 있음 |
| `firePressed` | 이번 프레임에 눌림. 생략하면 `fireDown`의 상승 에지로 계산. 프레임 사이에 짧게 클릭한 경우도 이것으로 받는다 |
| `zoomDown` | 우클릭을 누르고 있음. hold 줌, 칼 찌르기, 수류탄 굴리기에 쓴다 |
| `zoomToggle` | 토글 모드에서 이번 프레임에 우클릭이 눌림(에지). 계속 true로 와도 한 번만 센다 |
| `reloadPressed` | R |
| `slot` | 1~4, 이번 프레임에 누른 숫자키(없으면 null) |
| `wheel` | 휠. 부호만 본다. + = 다음 슬롯(1→2→3→4), 빈 슬롯은 건너뜀 |

`motion`은 `{ speed: 수평 속력(m/s), onGround, walking: Shift }`다.

줌 방식(누르는 동안 / 토글)은 **설정이 바뀔 때 `setZoomMode('hold'|'toggle')`로 알려 준다**. 입력 계층은 두 신호(`zoomDown`, `zoomToggle`)를 모두 보내도 된다.

### 이벤트

공통 필드는 `{ type, weaponId, t }`다(`t`는 arsenal 내부 시각).

| type | 언제 | 추가 필드 |
|---|---|---|
| `fire` | 발사 | `pellets[{yaw,pitch,dir}]`, `yaw/pitch/dir`(첫 탄), `spread`(rad), `spreadDeg`, `aim`(0~1), `zoom`, `scoped`, `quickscope`, `noscope`, `recoil{yaw,pitch}`(발사 순간 카메라 반동), `kick{yaw,pitch}`(이번 발), `shotIndex`, `mag`, `reserve`, `maxRange`, `slot` |
| `dryFire` | 탄이 하나도 없을 때 클릭(누를 때 1번) | — |
| `boltCycle` | 저격 사격 직후(마지막 탄 제외) | `duration` (1.2) |
| `reloadStart` | 재장전 시작(R 또는 자동) | `duration`, `empty`, `mag`, `reserve` |
| `reloadEnd` | 재장전 완료 | `mag`, `reserve` |
| `reloadCancel` | 재장전 중 교체 | — |
| `switch` | 교체 시작. `weaponId` = 새 무기 | `from`, `to`, `slot`, `drawTime`, (`reset: true` = `resetRound`) |
| `zoomChange` | 줌 목표가 바뀜 | `zoomed` |
| `swing` | 칼 휘두르기 시작(애니·소리) | `kind`('slash'\|'stab'), `duration`, `windup`, `index`, `damage`, `range` |
| `melee` | **칼 판정 시점**(엔진이 이때 히트 검사) | `kind`, `damage`, `range`(1.8), `arc`(rad, 판정 원뿔 반각 힌트: 베기 35°, 찌르기 12°), `index` |
| `swingCancel` | 판정 전에 교체 | `kind` |
| `prime` | 수류탄 핀 뽑기 시작 | `kind`('overhand'\|'underhand'), `primeTime` |
| `primeCancel` | 준비 중 교체(수류탄 유지) | `kind` |
| `throw` | 투척 | `kind`, `speed`, `pitchUp`(rad), `fuse`, `count`(남은 개수) |

탄 방향은 카메라 기준이다.

- `pellets[i].yaw/pitch`는 반동이 적용된 화면 방향을 기준으로 한 탄퍼짐 오프셋이다.
- `dir`은 같은 내용을 카메라 로컬 단위 벡터로 준 것이다(−z가 정면).
- 월드 방향은 `shotDirection(myYaw, myPitch, ev, i)`로 구한다. 반동은 `ev.recoil`을 써서 반영된다. 또는 `dir`을 '그 발을 쏠 때의' 카메라 쿼터니언으로 돌려도 된다.

### 메서드

| 메서드 | 반환 |
|---|---|
| `getZoom(baseFov=75)` | `{ progress, target, zoomed, mag, curMag, fov, targetFov, overlay('scope'\|null), scopeAmount(0~1 오버레이 불투명도), hideViewmodel, accurate }` |
| `getSpread()` | `{ rad, deg, accurate }` (크로스헤어용, 현재 사격 시 쓰일 값과 같음) |
| `getRecoilKick()` | `{ yaw, pitch }`. **누적 오프셋**이다. 카메라 = 내 각도 + kick. 내 각도에 더해 넣지 말 것 |
| `getAmmo(id?)` | `{ weaponId, kind:'mag'\|'count'\|'none', mag, magSize, reserve, infinite, reloading }` |
| `getWeapon()` | `{ id, slot, name, nameEn, short, def, state, progress(0~1), elapsed, duration, previous }` |
| `getSlots()` | `[{ slot, id, name, short, icon, empty, active }] × 4` |
| `getMoveMul()` | 이동속도 배율(무기 × 줌) |
| `getViewState(baseFov)` | `viewmodel.update()`에 넘길 표시 상태 |
| `getHud(baseFov)` | UI `hud.set()`에 그대로 넘길 값: `{ ammo, reserve, mag, reloading, reload, slots, slot, spread, fov, crosshair }` |
| `serialize()` | 네트워크 표시용 `{ w: 무기 id, s: 상태, z: 0\|1 }`. 상태는 `STATES` 중 하나: idle, draw, reload, bolt, swing, prime, throw |

그 밖의 조작:

- `select(slotOrId)`: 이벤트는 다음 `update()`에서 나온다.
- `setPrimary(id)`, `getPrimary()`
- `setZoomMode(m)`, `getZoomMode()`
- `resetRound({ primary?, draw? })`: 탄약·수류탄 1개를 채우고 주무기를 든다.
- `giveGrenade(n)`, `getTime()`, `dispose()`

### 규칙 요약

- **저격**
  - 반샷: 줌 진행도 ≥ 0.5(160ms 줌 인의 80ms)면 조준 정확도(0°)를 준다. 0.49는 미조준(8°).
  - 사격하면 자동으로 줌이 풀리고 볼트 1.2s 동안 사격·줌을 할 수 없다.
  - hold 모드에서는 **우클릭을 뗐다가 다시 눌러야** 다시 줌된다. 볼트 중에 다시 누르면 볼트가 끝나는 즉시 줌된다.
  - 마지막 탄은 볼트 없이 0.35s 뒤 자동 재장전한다(3.4s).
- **소총**: 누르는 동안 정확히 0.1s 간격으로 쏜다(프레임 속도와 무관). 새로 누르면 즉시 쏜다.
- **권총**: 클릭 1번에 1발이다. 쿨다운이 끝나기 0.1s 전까지의 클릭은 기억했다가 쏜다.
- **칼**
  - 누르고 있으면 계속 휘두른다.
  - 찌르기 뒤 1.0s 동안은 베기도 할 수 없다.
  - 판정 전에 교체하면 그 공격은 취소된다.
- **수류탄**
  - 1개다. 던지면 0.35s 뒤 이전 무기로 돌아가고 4번 칸이 빈다(선택·휠에서 제외).
  - 던지는 동작 중에는 교체할 수 없다.
- **공통**
  - 교체하면 꺼내기 시간(0.4~0.8s)이 걸린다.
  - 재장전 중에 교체하면 취소되고, 탄약은 그대로 남는다.
  - 탄창이 비면 자동으로 재장전한다. 꺼내는 중에 누른 R은 꺼낸 뒤 실행한다.

### 방장 검증

`validateHit(weaponId, { dist, interval, kind?, tolerance=0.6 })` → `{ ok, reason? }`

- 거리와 연사 간격만 본다.
- `reason`은 `'weapon' | 'range' | 'rate'` 중 하나다.
- 칼은 사거리 + 1.2m까지 허용한다.

`game/match.js`의 `WEAPON_RULES`는 이 표와 같은 값이다. 바꾸면 `weaponRulesFromDefs(WEAPONS)`로 맞춘다.

---

## 5. `grenade.js` — `createGrenadeSystem(cfg)`

충돌 함수는 두 방식을 모두 받는다.

| 방식 | 넘기는 것 | 동작 |
|---|---|---|
| **core 월드(권장)** | `createGrenadeSystem({ world })` (`engine/physics.js`의 `createWorld` 결과) | core의 `world.sphereSweep(body, dt, opt)`(적분기)를 쓴다. 반발 0.35·마찰·중력은 이 모듈 값으로 넘긴다. `world.lineOfSight`도 함께 쓴다 |
| 선분 스윕(브리프 계약) | `{ sphereSweep(from, to, r) → {hit, point, normal, t?, center?}, lineOfSight(a, b) }` | 이 모듈이 포물선·바운스를 직접 적분한다. `point`는 '닿는 순간 구의 중심'을 권장한다. 표면 접점이어도 판별해서 보정한다 |

- 함수만 넘겨도 방식을 자동으로 알아챈다(`detectSweepStyle`). `sweepStyle`로 강제할 수도 있다.
- 선분 방식에는 암묵적 바닥 `floorY`(기본 0, 끄려면 `null`)가 있다.
- 시간 간격은 1/120s로 고정이다. 그래서 같은 투척이면 클라이언트마다 같은 궤적을 그린다.

```js
const nades = createGrenadeSystem({ world, onEvent? });
nades.throwFrom({ eye, forward, speed: ev.speed, pitchUp: ev.pitchUp, fuse: ev.fuse, owner: myId, inherit?: myVel });
for (const e of nades.update(dt)) {
  // e = { type:'bounce', id, owner, pos, normal, speed, mat } | { type:'explode', id, owner, pos }
}
nades.explosionDamage(center, targets) // → [{ id, damage(정수), dist, visible }] 입력 순서 그대로
```

- `targets`는 `[{ id, pos(발바닥), height?=1.8 }]` 또는 `[{ id, points:[...] }]`다.
- 피해 판정
  - 다리·몸·머리 세 점 중 **폭심에서 보이는 가장 가까운 점**까지의 거리로 감쇠한다.
  - 세 점이 모두 가려지면 0이다.
  - 폭심은 바닥에 가려지지 않도록 0.12m 올려서 본다.
- 그 밖의 함수
  - 시스템: `spawn(pos, vel, o)`, `list()`(렌더링용 사본), `count`, `sweepStyle`, `remove(id)`, `clear()`, `dispose()`
  - 단독: `throwVelocity`, `createGrenade`, `stepGrenade(g, dt, sweep, {style, floorY, physics})`, `explosionDamage(center, targets, lineOfSight, opts)`

---

## 6. `viewmodel.js` — `createViewmodel(camera, opts)`

```js
const vm = createViewmodel(R.viewCamera, { lookCamera: R.camera, team: 'owner' });  // core 렌더러
vm.preload();                                  // 첫 교체 때 끊김 방지(선택)
for (const ev of events) vm.play(ev);          // arsenal 이벤트를 그대로
vm.update(dt, arsenal.getViewState(R.baseFov));
```

### 붙는 위치

- `camera.parent`가 Scene이면 그 씬에 붙고 매 프레임 카메라를 따라간다. core의 `viewScene`이 이 경우이고, 자식 수가 늘어나므로 core가 깊이를 지운 뒤 그려 준다.
- 카메라가 씬 밖이면 카메라의 자식으로 붙는다.

### 레이어와 그리는 순서

- 메시는 전용 레이어 `VIEWMODEL_LAYER(30)`에만 있고, 그 레이어는 넘겨받은 카메라에서만 켠다. 그래서 월드 레이캐스트나 다른 카메라에는 잡히지 않는다.
- 월드 카메라에 직접 붙인 경우 대비
  - 그리기 직전에 깊이를 한 번 지운다(`clearDepth`). 그래서 벽에 파묻히지 않는다.
  - 줌으로 FOV가 줄어도 모형이 커지지 않게 보정한다.

### 애니메이션

- 반동 킥
- 재장전: 기울여 내리고, 탄창을 빼고 넣고, 왼손이 따라간다.
- 교체 올리기
- 저격 볼트 조작
- 권총 슬라이드: 쏠 때 뒤로 밀리고, 빈 탄창이면 젖혀진 채로 있다.
- 칼: 베기 2종 번갈아, 찌르기
- 수류탄: 왼손으로 핀 뽑기 → 던지기
- 걷기 흔들림, 숨쉬기, 착지 출렁임
- 시점 회전 sway: `lookCamera` 회전을 쓴다.

### 줌

- 저격은 줌 진행도가 **0.9를 넘으면 모형을 숨긴다**. 스코프 오버레이는 UI가 그린다(`getZoom().scopeAmount`).
- 소총 정조준은 조준경 점을 화면 가운데로 가져온다.

### 메서드

| 메서드 | 내용 |
|---|---|
| `setWeapon(id)` | 즉시 바꾸기. `switch` 이벤트나 `update`의 `weaponId`로도 자동으로 바뀐다 |
| `play(ev)` | arsenal 이벤트를 넘긴다 |
| `update(dt, state)` | `getViewState()` 결과를 넘긴다 |
| `getMuzzleWorld(out?, worldCamera?)` | 총구의 월드 좌표. 뷰모델 카메라 화면에서 같은 자리에 보이도록 월드 카메라 시선 위로 옮겨 준다. FX 섬광·예광탄 시작점에 쓴다. 칼·수류탄이면 `null` |
| `setTeam('owner'\|'charterer')` | 소매 색을 팀 색으로 |
| `setVisible(bool)` | 사망·관전 시 숨기기 |
| `setClearDepth(bool)` | 깊이 지우기 켜고 끄기 |
| `preload(ids?)` | 모형 미리 만들기 |
| `getWeaponId()` | 지금 보이는 무기 id |
| `dispose()` | 정리 |

옵션:

| 옵션 | 기본값 | 뜻 |
|---|---|---|
| `lookCamera` | — | sway와 총구 좌표 계산에 쓸 월드 카메라 |
| `scene` | — | 붙일 씬을 직접 지정 |
| `clearDepth` | true | 그리기 직전 깊이 지우기 |
| `muzzleFlash` | true | 내장 1인칭 섬광. FX가 1인칭 섬광을 그리면 false |
| `scale` | 1 | 전체 크기 배율 |
| `team` | — | 소매 색 |

---

## 7. 붙이는 예 (main/game 담당 참고)

```js
import { createArsenal, shotDirection } from './weapons/logic.js';
import { createGrenadeSystem } from './weapons/grenade.js';
import { createViewmodel } from './weapons/viewmodel.js';
import { WEAPONS } from './weapons/defs.js';

ui.setWeapons(Object.values(WEAPONS));                       // 로드아웃 카드·HUD 슬롯 이름
const arsenal = createArsenal({ primary: picked, zoomMode: settings.get('zoomToggle') ? 'toggle' : 'hold' });
const vm = createViewmodel(R.viewCamera, { lookCamera: R.camera, team: myTeam, muzzleFlash: false });
const nades = createGrenadeSystem({ world });

// 고정 틱
const evs = arsenal.update(dt, weaponInput, { speed: Math.hypot(vel[0], vel[2]), onGround, walking: shift });
for (const ev of evs) {
  vm.play(ev);
  if (ev.type === 'fire') {
    for (let i = 0; i < ev.pellets.length; i++) {
      const dir = shotDirection(player.yaw, player.pitch, ev, i);
      const hit = world.traceShot(eye, dir, ev.maxRange, targets, { ignoreId: myId });
      // hit.kind === 'player' → 방장에게 { w: ev.weaponId, id, part, dist } 보고
    }
    fx.muzzleFlash(vm.getMuzzleWorld(tmp, R.camera), forward, ev.weaponId);
  }
  if (ev.type === 'melee') { /* ev.range·ev.arc 안의 첫 대상에게 ev.damage */ }
  if (ev.type === 'throw') nades.throwFrom({ eye, forward, speed: ev.speed, pitchUp: ev.pitchUp, fuse: ev.fuse, owner: myId });
}
for (const ge of nades.update(dt)) if (ge.type === 'explode') {
  const res = nades.explosionDamage(ge.pos, players.map((p) => ({ id: p.id, pos: p.pos })));
}

// 렌더 프레임
const k = arsenal.getRecoilKick();
R.camera.rotation.set(player.pitch + k.pitch, player.yaw + k.yaw, 0);    // 'YXZ'
const z = arsenal.getZoom(R.baseFov);
R.setFov(z.fov);
ui.scope.set(z.scopeAmount, z.mag);
ui.hud.set(arsenal.getHud(R.baseFov));
vm.update(frameDt, arsenal.getViewState(R.baseFov));
player.speedMul = arsenal.getMoveMul();
net.state.weapon = arsenal.serialize();
```

---

## 8. 알려진 한계

- **반동**
  - 반동은 '되돌아오는 시점 오프셋'이다. 연사 중에 마우스로 눌러 보정했다면, 멈춘 뒤 회복하면서 조준이 그만큼 아래로 내려간다(일반적인 view punch 방식).
  - 패턴은 고정이고 무작위 요소는 탄퍼짐에만 있다.
- **이동 페널티**는 엔진이 넘기는 수평 속력만 본다. 앉기 자세는 없다.
- **칼**
  - 실제 판정(사거리·원뿔 안 대상 찾기)은 엔진이 한다. 이 모듈은 `range`와 `arc`만 준다.
  - 뒤찌르기 보너스는 없다.
- **수류탄**
  - 쿠킹이 없다. 신관은 손을 뗀 순간부터 2.5s다.
  - 던지는 사람의 속도는 `inherit`로 넘길 때만 더한다.
  - 수류탄은 플레이어 몸에 부딪히지 않는다(월드 충돌만).
  - 자기 피해·팀킬을 적용할지는 경기 규칙(match)이 정한다.
  - core 적분기 방식에서는 core의 정지·구르기 기준(1.2m/s, 0.2m/s)이 적용된다.
- **권총**은 우클릭 기능이 없다.
- **뷰모델**
  - 내장 섬광과 FX 섬광을 함께 쓰면 두 번 그려진다. 한쪽을 끈다.
  - 조명은 core `viewScene`의 조명을 따른다.
  - 3인칭(남이 보는) 무기 모형은 이 모듈에 없다. core 아바타 담당 영역이다.
  - 카메라 near가 0.05보다 크면 정조준 때 일부가 잘릴 수 있다.
- **판정과 시간**
  - 사격 판정은 클라이언트 기준이다. 방장 검증(`validateHit`)은 거리와 간격만 본다.
  - `t`는 arsenal 내부 시각(초)이고, 네트워크 시각과 같지 않다.

## 9. 테스트

테스트 파일은 레포 밖 스크래치패드에 있다. 확인한 항목:

- node 단위 테스트 46개
  - logic 29: 연사 속도·탄약, 재장전·교체 취소, 반샷 경계 0.49/0.5, 볼트·자동 줌 해제, 반동 패턴·회복, 칼 쿨다운, 수류탄 로직, 데미지 표, HUD
  - grenade 11: 바운스·감쇠·차폐, 스윕 결과 규약 3종, core `physics.js` 실연동, 고정 스텝 결정성
  - viewmodel 6: three 실객체, NaN 없음, 숨김·ADS 조준점 위치, 총구 좌표 매핑
- 헤드리스 Chrome(SwiftShader) 스모크
  - core `createRenderer()`의 viewScene 경로로 18개 장면을 렌더했다. 눈앞 0.45m 벽과 유리가 있는 상태에서도 무기가 보이고, 저격 줌 100%에서는 숨는다.
  - 콘솔 오류는 0건이었다.
