# ⚓ Port Ops — MATCH API (경기 규칙 엔진 계약서)

> 파일: `fps/js/game/match.js` · 순수 ES 모듈(three.js·DOM·네트워크 의존 없음, node에서 테스트 가능)
> 기준: ARCHITECTURE.md 5절(무기)·7절(멀티플레이). 무기 수치는 `fps/js/weapons/defs.js`와 같다. 전송 크기는 `fps/js/game/protocol.js` 한도에 맞췄다.

방장(host) 클라이언트만 `createMatch()`로 경기를 돌린다. 메서드는 모두 **이벤트 배열**을 돌려준다.
방장은 그 이벤트와 `snapshot()`을 방 채널로 보낸다. 상태가 바뀔 때마다 보내고, 그 밖에는 1 Hz 정도로 보낸다.
다른 클라이언트는 받은 스냅샷을 `applySnapshot()`으로 풀어 화면에 쓴다(`m.state`와 같은 모양).

```js
import { createMatch, applySnapshot, standings } from './game/match.js';

const m = createMatch({
  rules: { roundsToWin: 3, maxRounds: 5, roundTimeMs: 120000, loadoutMs: 5000, roundEndMs: 4000, hp: 100 },
  players: [{ id: 'u1', name: '해운', team: 'owner' }, { id: 'u2', name: '용선', team: 'charterer' }],
  spawns: map.spawns                         // { owner: [{x,z,rotY}], charterer: [...] }
});
let ev = m.start();                          // warmup → 1라운드 loadout
ev = m.tick(dtMs);                           // 방장 루프(ms)
// 비방장의 피격 주장(sync 'hitClaim'):
ev = m.claimHit({ attackerId: from, victimId, weaponId, part, dist, kind, t: shotT });
ev = m.claimExplosion({ attackerId, center: { x, y, z }, victims: [{ id: 'u2', dmg: 64 }] });
if (ev.length) sync.sendMatch(m.snapshot(), ev);   // 스냅샷은 그대로 넘겨도 protocol을 무손실 통과한다
// 클라이언트:
const view = applySnapshot(snap);            // 잘못된 입력이면 null
const { stats, mvp } = standings(view);      // 점수판·결과 화면용 순위표
```

## 1. export 목록
| 이름 | 설명 |
|---|---|
| `createMatch(opts)` | 경기 객체를 만든다(방장 전용). 2절 |
| `applySnapshot(snap)` | 스냅샷을 화면용 상태로 푼다(`m.state` 모양). 잘못된 입력이면 `null` |
| `standings(view)` | 상태 → `{ stats: [{id,name,team,bot,connected,kills,deaths,headshots,damage}] (MVP 순), mvp }` |
| `WEAPON_RULES` | 무기 판정 표(동결). 4절 |
| `weaponRulesFromDefs(WEAPONS)` | `defs.js`의 `WEAPONS`를 `opts.weaponRules` 덮어쓰기 값으로 바꾼다 |
| `damageFor(weaponId, part, dist, kind, victimHp=100)` | 방장이 적용할 데미지를 미리 계산한다(히트마커 예측용, 수류탄은 0) |
| `normalizeWeaponId(id)` | `'NOR-1'`·`'cutter'`·`'grenade'` 등 → 정식 id 또는 `null` |
| `REASON_LABELS` | `reason` 코드 → 화면 문구(`elimination: '전멸'` 등) |
| `DEFAULT_RULES`, `TEAM_IDS`, `PHASES`, `PARTS`, `PRIMARY_IDS`, `DEFAULT_LOADOUT`, `SELF_EXPLOSION_SCALE`, `SNAPSHOT_VERSION` | 상수 |

## 2. createMatch(opts)
| opts | 기본 | 설명 |
|---|---|---|
| `rules` | 아래 표 | 일부만 줘도 된다. 잘못된 값은 기본값으로 바뀐다 |
| `players` | `[]` | `[{ id, name?, team?, bot? }]` — `addPlayer`와 같은 규칙으로 넣는다 |
| `spawns` | 없음 | 맵 `spawns` 그대로(x·z·y는 소수 2자리, rotY는 3자리로 반올림). 없으면 겹치지 않는 대체 위치 |
| `weaponRules` | 없음 | `WEAPON_RULES` 부분 덮어쓰기(0 이상 숫자만 받고, 모르는 필드는 무시) |
| `seed` / `rng` | `Math.random` | 스폰 섞기 난수(테스트 재현용) |

| rules | 기본 | 의미 |
|---|---|---|
| `roundsToWin` | 3 | 먼저 3승하면 매치 승리 |
| `maxRounds` | 5 | 승부가 난 라운드 최대 수(무승부 제외) |
| `maxTotalRounds` | 9 | 무승부 재경기를 포함한 총 라운드 상한(안전장치) |
| `roundTimeMs` / `loadoutMs` / `roundEndMs` | 120000 / 5000 / 4000 | 페이즈 시간 |
| `hp` | 100 | 라운드 시작 체력 |
| `maxPlayers` / `maxPerTeam` | 8 / 4 | 정원 |

### 메서드
모두 `events[]`를 돌려준다. 실패하면 `[{ type: 'reject', ... }]`이다.

| 메서드 | 언제 | 설명 |
|---|---|---|
| `tick(dtMs)` | 항상 | 시간을 ms 단위로 진행한다. 큰 dt는 다음 페이즈로 이어서 소비한다. 0 이하·NaN은 무시 |
| `start()` | warmup | 두 팀 모두 1명 이상이어야 한다. 성공하면 `roundStart`·`phase(loadout)` |
| `addPlayer({ id, name, team, bot })` | 항상 | `join`. 같은 id가 이미 접속 중이면 이름만 갱신하고 `[]`(멱등) |
| `removePlayer(id)` | 항상 | `leave`, 전멸이면 `roundEnd`, 팀 전원 퇴장이면 `matchEnd`가 이어진다. 모르는 id는 `[]` |
| `setTeam(id, team)` | warmup만 | `team`. 같은 팀이면 `[]` |
| `setLoadout(id, 'nor1' \| 'dwt47')` | loadout만 | `loadout`. 같은 값이면 `[]`. 별칭(`'NOR-1'`)도 받는다 |
| `claimHit(claim)` / `claimExplosion(claim)` | live만 | 5절 |
| `snapshot()` | 항상 | 7절 |
| `dispose()` | — | 이후 모든 메서드는 `[]` |
| `state` (getter) | — | 읽기 전용 뷰. 접근할 때마다 새 복사본이고, `applySnapshot(snapshot())`과 같다 |
| `rules`, `weaponRules` (getter) | — | 실제 적용 중인 규칙(동결) |

## 3. 페이즈와 라운드
```
warmup ──start()──▶ loadout(5s) ─▶ live(2:00) ─▶ roundEnd(4s) ─┬─▶ loadout … (다음 라운드)
                       ▲                                        └─▶ matchEnd (승부가 났으면 4초 뒤)
                       └ roundStart(라운드 번호, 스폰 배정)
```
- **라운드 번호**는 무승부 재경기를 포함해 1부터 센다(최대 9). 재경기 라운드는 `roundStart.replay = true`이다.
- **라운드 승리 판정** (`roundEnd.reason`)
  1. 상대 팀 생존자 0 → `elimination`. live 중 피해·퇴장 직후와 loadout 중 퇴장 직후에 판정한다.
  2. 시간 종료 → 생존자 많은 팀 `time`
  3. 생존자 수가 같으면 → 남은 체력 합이 많은 팀 `hp`
  4. 그것도 같으면 `draw`(`winner: null`). 양 팀 동시 전멸(수류탄)도 `draw`
- 무승부는 승수에 넣지 않고 다음 라운드를 재경기로 연다.
- **매치 종료** (`matchEnd.reason`)
  - `wins`: 한 팀이 `roundsToWin`승. 마지막 라운드도 `roundEnd` 4초를 보여 준 뒤 `matchEnd`
  - `maxRounds`: 승부가 난 라운드 수가 `maxRounds`에 닿음 → 앞선 팀, 같으면 `null`. 기본 규칙(3선승·5판)에서는 일어나지 않는다.
  - `roundCap`: 총 `maxTotalRounds`(9)라운드 → 앞선 팀, 같으면 무승부(`null`)
  - `forfeit`: 경기 중 한 팀 접속자가 0명 → 남은 팀이 즉시 승리(라운드 기록은 추가하지 않음)
  - `abandoned`: 양 팀 모두 0명(방장도 없으므로 사실상 일어나지 않음)
  - 승부가 정해진 마지막 `roundEnd` 4초 동안의 퇴장은 결과를 바꾸지 않는다.
- **한 호출 안의 이벤트 순서**:
  - 라운드 시작: `roundStart → phase(loadout)`
  - 킬로 끝날 때: `damage → kill → roundEnd → phase(roundEnd)`
  - 매치 종료: `roundEnd` 4초 뒤 `matchEnd → phase(matchEnd)`
  - 퇴장: `leave → (roundEnd → phase | matchEnd → phase)`

## 4. 무기 판정 표 (`WEAPON_RULES`, defs.js와 일치 — 테스트로 확인)
정식 id는 defs.js와 같다: `nor1`, `dwt47`, `sof9`, `hawser`, `bunker`.
입력은 대소문자·기호를 무시하고 별칭도 받는다(`NOR-1`, `sniper`, `rifle`, `pistol`, `cutter`·`knife`, `grenade`).
**이벤트에는 항상 정식 id**가 나간다.

| 무기 | 연사 간격 `intervalMs` (defs) | 허용오차 `toleranceMs` | 사거리 `rangeM` (defs.maxRange×1.05) | 데미지 머리/몸/다리 | 거리 감쇠 (defs.falloff) |
|---|---|---|---|---|---|
| `nor1` NOR-1 | 1200 (볼트 1.2s) | 250 | 420 | **어느 부위든 1발 킬**(남은 체력 전부) | 없음 |
| `dwt47` DWT-47 | 100 (600rpm) | 150 | 262.5 | 100 / 30 / 22 | 30m부터 줄어 80m 이상 75% |
| `sof9` SOF-9 | 160 | 170 | 157.5 | 70 / 28 / 20 | 15m부터 줄어 45m 이상 60% |
| `hawser` 호서 커터 | 베기 450 / 찌르기 1000 (defs cooldown) | 300 | **2.5** (1.8 + 0.7) | 베기 50 / 찌르기 100 (부위 무관) | — |
| `bunker` 벙커 수류탄 | 라운드당 1개 | — | 반경 6 (검증 안 함) | 피해자별 `dmg`, 상한 100 | 던진 쪽이 계산 |

- 데미지 계산은 `defs.damage()`와 같다: `max(1, round(표값 × 감쇠(dist)))`를 구하고, 피해자 남은 체력에서 자른다.
  근거리(소총 30m·권총 15m 이내)에서는 오케스트레이터 표(머리100·몸30·다리22 / 70·28·20)와 같다.
- 부위는 `head`/`body`/`legs`이다. 별칭: `neck`·`helmet`→head, `arm`·`chest`·`torso`→body, `leg`·`foot`→legs. **모르는 값은 body**(defs와 같음).
- 칼 `kind`: `'stab'`이면 찌르기, 그 밖(생략·`'shot'` 포함)은 베기다(defs와 같음).
- **연사 간격 판정(GCRA)**: 사수·무기마다 "다음 발이 가능한 가장 이른 시각 `due`"를 둔다.
  - `t < due − 허용오차`면 `too_fast`로 거절한다. 통과하면 `due = max(due, t) + 간격`이다.
  - 허용오차는 프레임 몰림과 타임스탬프 흔들림을 흡수한다. 평균 연사 속도는 간격을 넘지 못한다.
  - 소총·권총은 같은 시각 2발까지 받고 3발째를 거절한다. 저격은 0.95초 미만 간격(예: 0.5초 연타)을 거절한다.
  - 칼은 베기·찌르기가 `due`를 함께 쓰고 직전 공격의 쿨다운을 적용한다. 찌르기→베기 최단 0.84초는 통과한다.
  - 기록은 라운드 시작과 재접속 때 비운다. 거절된 판정은 기록을 바꾸지 않는다.
- defs.js가 바뀌면 이 표를 같이 고친다. 런타임에 맞추려면 `createMatch({ ..., weaponRules: weaponRulesFromDefs(WEAPONS) })`를 쓴다. 허용오차와 1발 킬 여부는 이 모듈 값을 유지한다.

## 5. 판정 주장(claim)
### `claimHit({ attackerId, victimId, weaponId, part, dist, kind, t })`
쏜 사람 화면 기준 판정을 방장이 검증한 뒤 적용한다. **데미지는 방장이 표로 계산**하고, 클라이언트가 보낸 값은 받지 않는다.

| 필드 | 설명 |
|---|---|
| `weaponId` | `nor1`·`dwt47`·`sof9`·`hawser`. 수류탄은 `claimExplosion`으로 보낸다 |
| `part` | 총: `head`/`body`/`legs`. 칼은 무시 |
| `dist` | 사수 화면 기준 거리(m). **필수**이며, 없거나 음수면 `bad_dist` |
| `kind` | 칼: `'slash'`(기본) / `'stab'`. 총은 무시(sync의 `'shot'`도 무시) |
| `t` | 사격 시각, **ms**. sync의 `shotT`(방장 시계 ms)를 그대로 넣으면 된다(아래 참고) |

`t` 처리 규칙:
- `performance.now()`도 된다.
- 무기 모듈 `ev.t`(**초**)도 된다. `|t| < 1e4`면 초로 본다. 방장 시계와 2초 이상 비교되면 단위를 확정하고, 틀렸으면 보정한다.
- 생략하면 방장 시계(`tick` 누적)로 재고, 네트워크 지터 몫으로 250ms를 더 허용한다.
- 한 사수는 한 가지 시계만 쓴다.

**검증 순서와 거절 사유**. 거절 이벤트는 `{ type: 'reject', action: 'claimHit', reason, by: attackerId, victim, weaponId }`이다.
1. `not_live` — live 페이즈가 아님(loadout·roundEnd 포함)
2. `unknown_attacker` / `unknown_victim` / `self_hit`
3. `bad_weapon`(모르는 무기) / `use_explosion`(`bunker`를 claimHit로 보냄)
4. `attacker_dead` / `victim_dead` — 죽은 사람, 관전자(늦게 들어온 사람), 퇴장한 사람을 모두 포함한다
5. `friendly_fire` — 같은 팀(아군 사격 꺼짐)
6. `bad_dist` / `out_of_range`
7. `too_fast` — 연사 간격 위반

통과하면 `damage`가 나간다. 체력이 0이 되면 `kill`, 전멸이면 `roundEnd`·`phase`가 이어진다.
**로드아웃과 무기가 맞는지는 검사하지 않는다.** 로드아웃 메시지가 live 직후에 도착해도 판정이 어긋나지 않게 하려는 것이다.
같은 주장이 두 번 오면 rifle·pistol은 같은 시각 2발을 허용하므로 두 번 적용될 수 있다. 중복 제거는 sync가 맡는다(`reliableRepeat`를 id로 걸러 냄).

### `claimExplosion({ attackerId, center, victims: [{ id, dmg }], weaponId? })`
- 폭발 1번에 호출 1번이다. 피해자마다 거리 감쇠·엄폐 판정을 마친 `dmg`를 넣는다(`defs.explosionFalloff`).
- `weaponId`를 생략하면 `bunker`이다. `center`(선택)는 피해 방향 표시용으로 `damage.center`에 실린다.
- 공격자는 이번 라운드 참가자여야 한다. **던지고 죽은 뒤 터진 것도 인정**하고, 킬도 인정한다.
- 피해자별 처리:
  - 모르는 id, 죽은 사람, 중복 id는 건너뛴다.
  - **같은 팀은 피해가 없다.**
  - **자기 자신은 50%**만 받는다(`damage.self = true`).
  - `dmg`는 0~100으로 자르고 반올림한다.
- 모든 피해를 동시에 적용한 뒤 전멸을 한 번만 판정한다. 동시 전멸은 `draw`이다.
- 거절 사유: `not_live`, `unknown_attacker`, `bad_weapon`, `not_playing`(관전자·퇴장), `bad_victims`(배열 아님), `grenade_limit`(라운드당 1개 초과).
- 자폭 사망은 데스만 1 늘고 킬은 없다. 자해 피해는 데미지 통계에 넣지 않는다.

## 6. 이벤트
- 모든 이벤트는 JSON으로 그대로 보낼 수 있다(Infinity·undefined 없음). id 필드는 플레이어 id다.
- 필드 이름과 순서는 `protocol.MATCH_EVENT_FIELDS`에 맞췄다: `damage.amount`, `kill.part`.
- 최악 조건(8명·이름 24자·나간 사람 12명·9라운드)에서도 가장 큰 이벤트가 738 B로, `encodeMatchEvent` 한도 1024 B보다 작다.

| type | 필드 |
|---|---|
| `phase` | `phase`, `round`, `durationMs`(warmup·matchEnd는 `null`). live일 때 `loadouts: { [id]: 'nor1'\|'dwt47' }` = **확정 주무기**(클라이언트는 이 값으로 장착) |
| `roundStart` | `round`, `replay`(직전 라운드가 무승부), `spawns: { [id]: { x, z, rotY, y? } }`(이번 라운드 참가자만), `score` |
| `damage` | `attacker`, `victim`, `amount`(실제 적용량), `part`(총만, 아니면 `null`), `hp`(남은 체력), `weaponId`, `kind`(칼만), `self?`, `center?` |
| `kill` | `killer`, `victim`, `weaponId`, `part`, `head`(헤드샷 킬), `killerName`, `victimName`, `killerTeam`, `victimTeam`. 자폭이면 `killer === victim` |
| `roundEnd` | `round`, `winner`(`'owner'`\|`'charterer'`\|`null`), `reason`(`elimination`\|`time`\|`hp`\|`draw`), `score`, `final`(이 라운드로 승부가 났는지), `alive: {owner, charterer}`, `hp: {owner, charterer}` |
| `matchEnd` | `winner`(`null`이면 무승부), `reason`(`wins`\|`maxRounds`\|`roundCap`\|`forfeit`\|`abandoned`), `score`, `mvpId`, `stats: [[id, kills, deaths, headshots, damage], …]`(MVP 순, 최대 12줄, **압축형**) |
| `join` | `id`, `name`, `team`, `playing`(false면 다음 라운드까지 관전), `rejoin` |
| `leave` | `id`, `name`, `team`, `wasAlive` |
| `team` | `id`, `team` |
| `loadout` | `id`, `weaponId` |
| `reject` | `action`(`claimHit`·`claimExplosion`·`start`·`addPlayer`·`setTeam`·`setLoadout`), `reason`, `by`(요청한 플레이어 id 또는 `null`), 그 밖에 `victim`·`weaponId`·`team` |

통계 규칙:
- `headshots`는 헤드샷 **킬** 수다.
- `damage`는 적에게 실제로 준 피해 합이다(넘친 피해·자해 제외).
- `deaths`는 죽은 횟수다(퇴장은 데스가 아님).
- **MVP**는 킬 → 헤드샷 → 데미지 순으로 정한다. 동률이면 데스 적은 순, 그다음 먼저 들어온 순이다. 모두 0이면 `mvpId: null`이다.
- 이름·팀이 붙은 순위표는 `standings(view)`로 만든다. matchEnd 뒤에는 방장이 정한 `result.mvpId`를 따른다.
- 라운드 기록은 `view.history`에 있다.

## 7. 상태 · 스냅샷
`m.state`와 `applySnapshot(snap)`은 같은 모양이다. 그래서 방장 화면도 클라이언트와 같은 코드로 그릴 수 있다.
```js
{
  phase: 'warmup' | 'loadout' | 'live' | 'roundEnd' | 'matchEnd',
  round: 2,                 // 현재(마지막) 라운드, warmup은 0
  roundsPlayed: 1,          // 끝난 라운드 수(무승부 포함)
  timeLeftMs: 83000,        // 현재 페이즈 남은 ms(스냅샷 시점). warmup·matchEnd는 null → 받은 뒤 로컬로 줄여 표시
  score: { owner: 1, charterer: 0 },
  rules: { roundsToWin, maxRounds, maxTotalRounds, roundTimeMs, loadoutMs, roundEndMs, hp, maxPlayers, maxPerTeam },
  players: [{ id, name, team, bot, connected, playing, alive, hp, loadout, kills, deaths, headshots, damage }],  // 입장 순
  teams: { owner: { players /*접속자*/, alive /*생존 참가자*/, hp /*생존자 체력 합*/ }, charterer: {...} },
  history: [{ round, winner, reason }],
  lastRound: { round, winner, reason, final } | null,
  result: { winner, reason, mvpId } | null   // matchEnd 뒤
}
```
- `playing`은 이번 라운드 참가자라는 뜻이다. 늦게 들어온 사람과 나간 사람은 `false`(관전)이고, warmup에서는 접속자 모두 `true`이다.
- 스냅샷 직렬화 형식: `{ v:1, ph, rn, tl, sc:[o,c], ru:[…rules], h:[[winnerIdx, 'e'|'t'|'h'|'d']…], fin, res:[winnerIdx, reason, mvpId]|null, p:[[id, name, teamIdx, flags, hp, loadout, k, d, hs, dmg]…] }`
  - teamIdx: 0=owner, 1=charterer, -1=없음
  - flags 비트: 1 접속, 2 참가, 4 생존, 8 봇
  - fin: 승부를 가른 라운드 번호(0이면 아직 없음 또는 forfeit)
- **크기 예산 1800 B**(UTF-8). 접속자는 항상 싣고, 나간 사람은 기록이 좋은 순으로 예산 안에서만 싣는다(줄 순서는 입장 순).
  - 보통은 0.7 KB 안팎이다. 최악 조건에서 1680 B로, protocol.encodeMatch 부가 키 한도 2048 B보다 작다.
  - `sync.sendMatch(m.snapshot(), events)`에 그대로 넘기면 된다. 키가 protocol의 무손실 부가 영역으로 실려 가고, 받은 `snapshot`을 `applySnapshot`에 넣으면 된다(테스트로 확인).
- 형식이 바뀌면 `v`를 올린다. 버전이 다르거나 깨진 입력이면 `applySnapshot`이 `null`을 돌려준다.
- 스폰 배정은 스냅샷에 없다. `roundStart` 이벤트로만 받는다.

## 8. 플레이어 수명
- **팀 배정**: `team`이 맞고 자리가 있으면 그 팀, 아니면 인원이 적은 팀(같으면 owner)으로 간다. 8명이 차면 `room_full`.
- **warmup**: 들어오면 바로 참가한다. 나가면 기록까지 지운다.
- **start() 이후(loadout·live·roundEnd)에 들어오면** 다음 `roundStart`까지 관전한다(`playing:false, alive:false`). loadout 중에 들어와도 다음 라운드부터다.
- **경기 중 퇴장**:
  - 그 라운드에서 사망 처리한다(`alive:false`, 데스는 세지 않음). 기록은 남는다.
  - 같은 id로 다시 들어오면 원래 팀과 기록을 이어받고, 다음 라운드부터 참가한다.
- **한 팀 접속자가 0명**이 되면 즉시 `matchEnd(forfeit)`이다. 같은 팀에 관전자라도 남아 있으면 forfeit이 아니라 그 라운드 전멸 판정이다.
- 라운드 중에는 팀 변경과 부활이 없다. 재경기는 `createMatch`를 새로 만든다(`state.players`의 접속자로).

## 9. 연결 가이드 (sync·UI 담당용)
- **방장 루프**: `const ev = m.tick(dtMs)`를 부르고, `ev.length`가 있으면 `sync.sendMatch(m.snapshot(), ev)`를 보낸다. 그 밖에는 1 Hz 정도로 `sync.sendMatch(m.snapshot())`를 보낸다.
- **히트 주장**: sync의 `hitClaim` 이벤트 `{ from, victimId, part, weaponId, dist, kind, shotT }`를 `m.claimHit({ attackerId: from, victimId, weaponId, part, dist, kind, t: shotT })`에 넣는다.
- **수류탄**: 방장이 폭발 1번당 `claimExplosion` 1번을 부른다. 피해자 `dmg`는 `defs.explosionFalloff`와 엄폐 판정으로 구한다.
- `reject`는 디버그 로그용이다. 요청자에게 돌려줄지는 sync가 정한다.
- **로드아웃**: loadout 페이즈에 `setLoadout(id, primary)`을 부른다. live 시작 `phase.loadouts[myId]`로 장착을 확정한다.
- **UI 매핑 예** (`view = applySnapshot(snap)`)
  - HUD: `hud.set({ roundTime: view.timeLeftMs / 1000, score: { ...view.score, target: view.rules.roundsToWin, bestOf: view.rules.maxRounds, round: view.round }, alive: { owner: view.teams.owner.alive, charterer: view.teams.charterer.alive }, teamSize: { owner: view.teams.owner.players, charterer: view.teams.charterer.players } })`
  - 킬 피드: `hud.pushKill({ ...ev, killer: ev.killerName, victim: ev.victimName })`. 자폭은 `killer === victim`이다.
  - 점수판: `scoreboard.render({ players: view.players, score: view.score, round: view.round, meId })` (`headshots`·`alive`를 그대로 읽는다)
  - 결과: `const { stats, mvp } = standings(view); results.render({ winner: view.result.winner ?? 'draw', score: view.score, rounds: view.history.map(r => ({ ...r, reason: REASON_LABELS[r.reason] })), players: stats, mvp, meId })`

## 10. 테스트
node 단위 테스트 30개(스크래치패드 `match/match.test.mjs`, `node --test`)가 다음을 확인한다:
- 3:0·3:2 경기
- 시간 종료 시 생존자 수·체력 합 비교, 무승부 재경기·9라운드 상한, 큰 dt 이월
- 중도 퇴장·forfeit, 관전자만 남은 팀의 전멸 판정, 마지막 roundEnd 중 퇴장, 재접속
- 아군 사격·연사 간격·사거리 거절, t 단위(초/ms) 자동 인식
- 저격 1발 킬, 수류탄(자해 50%·아군 무피해·1개 제한·동시 전멸)
- 늦게 들어온 플레이어 관전
- snapshot/applySnapshot JSON 왕복, 스폰 배정(겹침 없음·시드 재현), 정원, MVP 순서
- **defs.js와 수치 일치**, **protocol.js 왕복(최악 크기)**
