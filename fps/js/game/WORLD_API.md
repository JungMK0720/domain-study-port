# ⚓ Port Ops — WORLD API (게임 화면 공용 무대)

> 파일: `fps/js/game/world.js` · 싱글(연습장 `practice.js`)과 멀티(`session.js`)가 **같은 World**를 쓴다.
> World는 "그리고, 듣고, 쏘는" 쪽만 맡는다. **누가 맞았고 몇 점인지는 match(방장)가 정한다.**

## 0. 만들기 — 앱에 World는 하나다

```js
import { createWorld } from './game/world.js';
const world = await createWorld({ root, ui, settings, ctx });
```

| 옵션 | 설명 |
|---|---|
| `ctx` | core 플러그인 ctx(`install(ctx)`가 받는 것). core의 renderer·input·loop·player·avatars·loadMap을 그대로 쓴다. **생략하면 `game/index.js`가 등록해 둔 ctx를 쓴다** |
| `ui` | `createUI()` 결과. 앱에 하나뿐이다 — `game/index.js`가 만들어 넘긴다. 직접 `createUI`를 또 부르지 말 것 |
| `root`, `settings` | 생략 가능(`ctx.ui.root`, `ctx.settings`) |

- 렌더러·입력·루프는 core 것을 쓰고, World가 새로 만드는 것은 **오디오(fx/audio)·이펙트(fx/effects)·뷰모델·로컬 arsenal·수류탄 시스템**뿐이다.
- `createWorld`를 여러 번 불러도 **같은 World를 공유하는 핸들**을 돌려준다(뷰모델·오디오가 두 벌 생기지 않는다).
  핸들의 `dispose()`는 그 핸들로 건 `on()` 리스너만 떼고, 마지막 핸들이 닫힐 때 실제로 정리한다.
- `game/index.js`는 '🌐 멀티플레이'를 처음 누를 때 `createSession({ ctx, ui, world, settings, bus, playerName, setScreens: true })`로 **이미 만든 `ui`·`world`를 넘기고** `open()`한다.
  세션의 `exit`(로비 → 메뉴)에서 세션을 정리하고 core `menu`로 돌아간다. core 화면 `lobby`·`room`·`match`·`results`는 game/index.js가 얇게 등록해 두어
  세션이 `ctx.setScreen`을 부르면 상태가 따라간다(`match`에서만 캔버스 클릭 → 포인터 잠금 → 조작).

## 1. 메서드

| 메서드 | 설명 |
|---|---|
| `await loadMap(mapId)` → `{ spawns, mapName, mapId, map, data, fallback }` | core `ctx.loadMap` + 수류탄 시스템 + HUD 표시 + 3D 렌더 켜기. `spawns`는 빌더 결과(`{owner:[{x,y,z,rotY}], charterer:[…]}`, y 자동) |
| `unloadMap()` | HUD·스코프 숨김, 액터·수류탄·이펙트 정리, 포인터 잠금 해제, 렌더 끄기, core 맵 해제. 화면 `exit`에서 부른다 |
| `reset()` | 라운드 전환용: 수류탄·이펙트·탄흔·예약 소리·관전 정리, HUD 킬피드·중앙 메시지 비우기. **액터는 남는다** |
| `spawnLocal({ id?, name?, team, spawn:{x,z,rotY,y?}, loadout? })` | 로컬 플레이어 부활(체력 100, 탄약 채움, 주무기 꺼내기). `loadout`: `'nor1'`·`'dwt47'`(생략하면 직전 값) |
| `setLocalLoadout(id)` | 주무기만 바꾼다(live 시작 때 `phase.loadouts[myId]` 확정값 반영) |
| `setLocalHp(hp)` | 체력 표시·상태 갱신(방장 확정값). 줄면 화면이 살짝 흔들린다. 0이어도 죽이지는 않는다 → `killLocal` |
| `killLocal(info?)` | 쓰러지는 카메라 → 1.6초 뒤 같은 팀 생존 액터 3인칭 관전(좌클릭으로 대상 바꾸기). `info = { killerId?, dir?:[x,z] }`. `localDeath` 발생 |
| `addActor({ id, name, team, kind:'remote'\|'bot' })` / `removeActor(id)` / `clearActors()` | 원격 플레이어·봇 아바타 |
| `setActorState(id, state)` | 매 프레임(또는 틱) **보간이 끝난 상태를 그대로** 그린다(World는 다시 보간하지 않는다 → avatars 지연 0). `state = { pos:[x,y,z], yaw, pitch, alive, moving?, walking?, onGround?, hp? }`. 죽어 있던 액터가 `alive:true`로 오면 그 자리로 순간이동하며 일어선다. 걷는 액터는 3D 발소리가 난다(Shift 걷기는 조용) |
| `actorFire({ id, weaponId, origin, dir, hitPoint?, hitKind?, victimId?, normal?, mat? })` | 원격 사격 연출: FX 섬광·예광탄·탄착·3D 총성. `hitKind:'player'`면 피격 퍼프(내가 맞은 경우는 생략). `normal/mat`이 없으면 탄착점에서 월드 레이로 찾는다. 칼(`hawser`)은 휘두르는 소리만 |
| `actorGrenade({ id, pos, vel, fuse?, t?, grenadeId? })` | 결정론 수류탄(1/120 고정 스텝)을 같은 초기값으로 시뮬레이션하고 바운스 소리·폭발 연출. `t`(ms, `performance.now()` 기준)가 과거면 그만큼 앞당겨 진행 |
| `actorDeath(id, info?)` | 아바타 쓰러짐. `info.dir = [x,z]`(총알 방향) |
| `feedbackDamage({ attackerPos?, amount, head?, kill?, incoming? })` | `attackerPos`가 있거나 `incoming:true`면 **내가 맞음** → 피격 방향 호. 아니면 **내가 맞힘** → 히트마커(+헤드샷/킬 소리) |
| `setRound({ phase, round, score, timeLeftMs, alive, teamSize, roundsToWin?, maxRounds? })` | HUD 타이머·스코어·생존자. 타이머는 다음 호출까지 로컬로 줄인다(`setPaused(true)` 동안만 멈춤 — 멀티는 일시정지 화면이 떠도 흐른다). `phase`가 `loadout`·`matchEnd`면 이동·사격을 막는다 |
| `setControlsEnabled(bool)` | 이동·사격·무기 교체 허용(시점은 잠금 상태를 따름) |
| `setPaused(bool)` | 수류탄·예약 소리 시뮬레이션 정지(연습장 일시정지용. 멀티는 쓰지 않는다) |
| `setPauseOptions({ leaveLabel, note })` | 일시정지 화면 문구 |
| `setScoreboard(provider)` | Tab을 누르면 `provider()`의 결과로 `ui.show('scoreboard', …)`(열려 있는 동안 0.5초마다 갱신) |
| `setHint(text)` | HUD 하단 안내(잠금 안내가 우선) |
| `sound(name, opts?)` | `audio.play` 그대로(`round_start` 등) |
| `getLocalState()` → `{ ...player.snapshot(), vel, name, weaponId, weapon:{w,s,z}, kills, deaths }` | sync 전송용(새 객체) |
| `getActor(id)` / `getActors()` | `{ id, name, team, kind, alive, state }` |
| `getMap()` | core 맵(`buildMap` 결과) 또는 null |
| `on(evt, fn)` → `off` | 아래 이벤트 |
| `dispose()` | 핸들 닫기(0절) |

## 2. 이벤트 (`world.on`)

| evt | payload | 언제 |
|---|---|---|
| `fire` | `{ id, weaponId, origin:[x,y,z], dir:[x,y,z], hitPoint:[x,y,z]\|null, hitKind:'player'\|'world'\|'none', victimId?, part?, dist, normal?, mat?, t, quickscope, noscope, spread(°) }` | 로컬 플레이어가 쏠 때(칼 휘두르기도 `weaponId:'hawser'`, `hitKind:'none'`) — 원격에 `actorFire`로 재생 |
| `hitClaim` | `{ victimId, part, weaponId, dist, kind, t, point, origin }` | 로컬 판정에 액터가 맞았을 때. `kind`: 총 `'shot'`, 칼 `'slash'`·`'stab'`. `t` = `performance.now()` ms. **데미지는 match가 확정** → `match.claimHit({ attackerId: myId, ...payload })` |
| `grenade` | `{ id, grenadeId, pos:[x,y,z], vel:[x,y,z], fuse, t, kind }` | 로컬 투척 직후 — 원격은 `actorGrenade(payload)`로 같은 궤적 재생 |
| `explosion` | `{ ownerId, local, grenadeId, center:{x,y,z}, victims:[{ id, dmg, dist }] }` | **모든** 수류탄 폭발(엄폐·거리 감쇠 끝난 값, 로컬 플레이어 포함). 멀티는 `local:true`만 `match.claimExplosion({ attackerId: ownerId, center, victims })`, 연습장은 전부 |
| `localDeath` | `{ id, info }` | `killLocal` 직후 |
| `loadoutPick` | `{ id, auto }` | UI 로드아웃에서 골랐을 때(World가 arsenal에 먼저 반영하고, `auto:false`면 같은 클릭 안에서 포인터 잠금) |
| `pause` | `{ paused }` | Esc로 일시정지 화면이 열리고 닫힐 때 |
| `leave` | `{}` | 일시정지 화면의 [나가기] |

## 3. World가 알아서 하는 것

- **입력 → 무기**: core input(좌클릭·우클릭·R·1~4·휠) → `arsenal.update`(고정 틱) → 뷰모델·소리·판정. `ui.needsCursor()`가 true이거나 잠금이 풀리면 무시한다.
  - 줌 FOV(`arsenal.getZoom`) → `renderer.setFov`, 감도 `input.setLookScale(줌FOV/기본FOV × zoomSensitivity)`, NOR-1 스코프 `ui.scope.set(scopeAmount, ×4)`.
  - 반동은 `arsenal.getRecoilKick()`을 카메라에만 더한다(view punch). 화면 흔들림은 `fx.setApplyShake(false)` + `fx.getShake()`를 같은 곳에서 더한다(core player 흔들림과 한쪽 경로).
  - 이동속도 `player.setSpeedScale(arsenal.getMoveMul())`.
  - 칼: 판정 순간(`melee` 이벤트) 눈 앞 사거리·원뿔(`ev.arc`) 안 + 시선이 통하는 가장 가까운 액터.
  - 1인칭 섬광은 뷰모델 것만, 원격 섬광은 `fx.muzzleFlash`.
- **HUD**: 체력·탄약·슬롯·크로스헤어(탄퍼짐)·무기 이름·타이머·스코어·생존자·관전 이름·잠금 안내(`클릭해서 시작`). Tab 점수판, 히트마커·피격 방향.
- **포인터 잠금**: `ui needCursor` → 잠금 해제, 로드아웃 클릭·`pause:resume` → 그 클릭 안에서 다시 잠금. Esc로 풀리면 일시정지 화면.
- **오디오**: 첫 클릭/키에서 unlock, `settings.volume` 반영, 리스너 = 카메라(눈) 위치·각도.

## 4. 연결 예 (멀티 세션)

```js
const off = [
  world.on('fire', (e) => sync.sendFire(e)),
  world.on('hitClaim', (c) => isHost ? apply(match.claimHit({ attackerId: myId, ...c })) : sync.sendHitClaim(c)),
  world.on('grenade', (g) => sync.sendGrenade(g)),
  world.on('explosion', (x) => { if (x.local) claimOrSend({ attackerId: myId, center: x.center, victims: x.victims }); }),
];
await world.loadMap(mapId);
// roundStart: world.reset(); world.spawnLocal({ id: myId, name, team, spawn: ev.spawns[myId], loadout });
// 매 프레임: for (const r of remotes) world.setActorState(r.id, interp.sample(now));
// 원격 이벤트: world.actorFire(msg) · world.actorGrenade(msg) · world.actorDeath(id, { dir })
// match damage: victim === myId → world.setLocalHp(ev.hp); world.feedbackDamage({ attackerPos, amount: ev.amount })
//               attacker === myId → world.feedbackDamage({ amount: ev.amount, head: ev.part === 'head', kill: ev.hp === 0 })
// match kill: victim === myId → world.killLocal({ killerId: ev.killer }); 그 밖 → world.actorDeath(ev.victim)
// 화면 exit: world.unloadMap();
```

## 5. 계약에서 달라진 점 (브리프 대비)

- `createWorld`에 `ctx` 옵션 추가(생략 가능 — game/index.js가 `setWorldContext(ctx)`로 등록). 여러 번 불러도 같은 World의 핸들.
- 이벤트 `explosion`·`leave` 추가(수류탄 피해 주장, 일시정지 [나가기]).
- 메서드 추가: `setLocalLoadout`, `unloadMap`, `clearActors`, `setPaused`, `setPauseOptions`, `setScoreboard`, `setHint`, `sound`, `getActor(s)`, `getMap`.
- `setActorState`에 `teleport:true`(보간 없이 순간이동), `actorFire`에 `hitKind`·`victimId`·`normal`·`mat`(선택).
- `feedbackDamage`는 `incoming`으로 방향을 명시할 수 있다(없으면 `attackerPos` 유무로 판단).
- `hitClaim.t`는 `performance.now()` ms. 연습장은 `t`를 넘기지 않고 방장 시계로 잰다.
