# ⚓ 항만 작전 UI (`fps/js/ui/`)

캔버스 위에 얹는 **순수 DOM 오버레이**입니다. 메뉴 · 로비 · 방 · 로드아웃 · HUD · 스코프 · 점수판 · 결과 · 일시정지를 담당합니다.
외부 폰트, 이미지, 라이브러리는 쓰지 않습니다. 동적 문자열은 모두 `textContent`로 넣고, 스타일은 `fps/css/fps.css`(`po-` 접두사)에 있습니다.

| 파일 | 내용 |
|---|---|
| `index.js` | `createUI()`: 화면 관리, 이벤트, 커서 상태, 설정, 무기·맵 등록 |
| `menu.js` `lobby.js` `room.js` `loadout.js` `hud.js` `scope.js` `scoreboard.js` `results.js` `pause.js` | 화면별 모듈 |
| `settings.js` `controls.js` | 설정 저장과 설정 시트, 조작법 시트(메뉴와 일시정지가 같이 씀) |
| `dom.js` `parts.js` `icons.js` | DOM 헬퍼, 공통 부품, 도형 아이콘(맵 미니 아이콘, 헤드샷, 터미널 실루엣) |
| `demo.js` + `fps/ui-demo.html` | QA용 데모(목 데이터). 게임 본편에서는 로드하지 않습니다 |

## 시작하기

```js
import { createUI, relativeAngle } from './ui/index.js';
import { MAP_LIST } from './maps/index.js';   // [{ id, name, nameEn, desc, test? }, ...]
import { WEAPONS } from './weapons/defs.js';  // { nor1: { name, short, icon, tagline, stats, bars, term }, ... }

const ui = createUI(document.getElementById('app'), { settings: ctx.settings }); // core의 createSettings(bus) 저장소
ui.setMaps(MAP_LIST).setWeapons(WEAPONS);   // 한 번만 등록하면 이후에는 id만 넘겨도 된다
ui.show('menu');
```

- **설정 저장소는 core 것을 넘기세요**(`options.settings` = `get/set/all`이 있는 객체). 그러면 UI는 그 저장소 하나로만 읽고 씁니다. 넘기지 않으면 같은 키(`portops.settings.v1`)를 쓰는 대체 저장소를 씁니다. 대체 저장소는 쓸 때마다 저장된 JSON을 다시 읽어서 합치므로 core 전용 키(quality, invertY 등)를 지우지 않습니다. 다만 메모리 사본이 둘이 되므로 같은 세션에서 core와 UI가 같은 키를 동시에 바꾸면 나중에 쓴 쪽이 이깁니다.
- `MAP_LIST`의 `test: true` 맵(core 테스트 맵)은 방 만들기와 맵 변경 목록에 나오지 않습니다. id로 표시할 때는 이름을 찾아 줍니다.
- `fps.css`가 페이지에 없으면 `createUI`가 `<link>`를 직접 붙입니다. 끄려면 `createUI(el, { injectCss: false })`를 쓰세요.
- `.po-ui` 루트는 `position:absolute; inset:0; z-index:20; pointer-events:none`입니다. 입력이 필요한 화면만 `pointer-events:auto`입니다.

## API

```js
const ui = createUI(rootEl, { settings?, injectCss? })
ui.show(screen, props)    // 보이기. props를 통째로 교체(생략하면 직전 props 유지)
ui.hide(screen)
ui.update(screen, props)  // 부분 갱신(기존 props에 합침)
ui.isVisible(screen) → bool

ui.hud.set({ hp, ammo, reserve, slot, slots, spread, roundTime, score, alive, ... })  // 매 프레임 호출해도 됨
ui.hud.hitmarker(head, kill?)
ui.hud.damageFrom(angle)          // rad. 0 = 정면, +π/2 = 오른쪽, ±π = 뒤
ui.hud.center(text, ms?, opts?)   // opts: { sub, tone: 'owner'|'charterer'|'warn' }
ui.hud.reset()                    // 킬피드·피격표시·중앙메시지·배너 비우기(라운드/매치 전환 시)
ui.killfeed.push({ killer, victim, weaponId, head, killerTeam, victimTeam })
ui.killfeed.clear()
ui.scope.set(amount, zoom?)       // amount 0~1, zoom: 4 → "×4" 표시(선택)
ui.scope.get() → amount

ui.on(action, fn) → off           // fn(payload, action). '*'는 모든 이벤트
ui.off(action, fn)
ui.getSettings() → { sensitivity, zoomMode, fov, volume, ...저장소의 다른 키 }
ui.setSettings(patch)             // 코드에서 바꾸기(저장소에 쓰고 'settings:change' 발생)
ui.getPlayerName() / ui.setPlayerName(name)
ui.setWeapons(defs)               // 배열 또는 { id: def }
ui.setMaps(list)
ui.needsCursor() → bool           // 커서가 필요한 화면이 떠 있는가
ui.isTyping() → bool              // UI 입력칸에 포커스가 있는가
ui.el                             // .po-ui 루트 요소
ui.dispose()                      // 리스너·타이머·DOM·주입한 CSS 제거

relativeAngle(self{x,z}, yaw, from{x,z}) → rad   // damageFrom용. yaw = three.js rotation.y(전방 -Z)
```

### 화면 배타 규칙

| 화면 | 종류 | `show` 할 때 자동으로 숨기는 화면 | 커서 |
|---|---|---|---|
| `menu` `lobby` `room` `results` | 페이지(서로 배타) | 다른 페이지, `hud` `loadout` `pause` `scoreboard`, 스코프 0 | 필요 |
| `hud` | 게임 | 모든 페이지 | 불필요 |
| `loadout` | 게임 오버레이 | 없음. 카드를 고르거나 시간이 끝나면 스스로 닫힘 | 필요 |
| `pause` | 게임 오버레이 | `scoreboard`. 계속하기/나가기 누르면 스스로 닫힘 | 필요 |
| `scoreboard` | 게임 오버레이 | 없음. 입력을 받지 않음 | 불필요 |

`hide('hud')`는 스코프도 0으로 만듭니다. 그래서 게임 시작은 `ui.show('hud', …)` + `ui.show('loadout', …)`, 매치 끝은 `ui.show('results', …)`만 부르면 됩니다.

### 포인터 잠금 연동

UI는 직접 `exitPointerLock()`을 부르지 않고 엔진에 알리기만 합니다.

```js
ui.on('needCursor', (need) => { if (need && document.pointerLockElement) document.exitPointerLock(); });
// 이벤트 핸들러는 사용자 클릭 안에서 동기로 불린다 → 그 안에서 바로 다시 잠글 수 있다
ui.on('pause:resume', () => canvas.requestPointerLock());
ui.on('loadout:pick', ({ id, auto }) => { equipPrimary(id); if (!auto) canvas.requestPointerLock(); });
document.addEventListener('pointerlockchange', () => {
  if (!document.pointerLockElement && inMatch && !ui.needsCursor()) ui.show('pause');  // Esc로 잠금이 풀림
});
```

- 시간이 다 돼 자동으로 고른 경우(`auto: true`)에는 사용자 조작이 없어서 다시 잠글 수 없습니다. `ui.hud.set({ hint: '화면을 클릭하면 조작을 시작해요' })`를 띄우고, 캔버스를 클릭하면 잠그세요.
- Chrome은 Esc로 잠금을 푼 직후 약 1초 동안 다시 잠그지 못합니다(`requestPointerLock` 실패). 이 경우에도 위 힌트로 클릭을 안내하세요.
- 일시정지 화면에서 누른 Esc는 열린 설정/조작법 시트만 닫습니다. Esc 키로는 브라우저가 다시 잠그지 못하게 하기 때문입니다.

### 키 입력 주의(엔진)

- `ui.needsCursor()`가 true이면 게임 입력(WASD, 사격 등)을 무시하세요. 로드아웃이 떠 있는 동안 `1`·`2` 키는 UI가 무기 선택에 씁니다.
- UI 입력칸(닉네임, 방 이름, 채팅)에서 친 키는 `.po-ui`에서 전파를 막습니다(window/document의 버블 단계 리스너에는 오지 않음). 캡처 단계 리스너를 쓴다면 `ui.isTyping()`으로 거르세요.
- **Tab 점수판**은 엔진이 처리합니다: `keydown` Tab → `e.preventDefault(); ui.show('scoreboard', data)`, `keyup` → `ui.hide('scoreboard')`. 키 반복으로 `show`가 여러 번 불려도 데이터가 같으면 다시 그리지 않습니다. 페이지 화면에서는 Tab을 막지 마세요(키보드 탐색에 씀).

## 화면별 props

### `menu`
```js
{ name?, account?, multiDisabled?, backHref? }
```
- `account: true` + `name`이면 퀴즈 계정 이름을 고정으로 보여 줍니다. `account: false`이면 닉네임 입력칸을 씁니다.
- `account`를 생략하면 `window.Leaderboard?.getSession()?.name`(../js/leaderboard.js)을 확인하고, 없으면 닉네임 입력칸을 씁니다.
- 닉네임 초기값은 `name` → 설정 저장소의 `name`(core와 같은 필드) → `Leaderboard.getLastName()` → `선원1234` 순서로 정합니다. 시작하거나 입력을 확정하면 저장소 `name`에 저장합니다.
- `multiDisabled`: 문자열이면 멀티플레이 버튼을 끄고 그 사유를 보여 줍니다(예: Supabase 설정 없음).
- `backHref`: 기본값 `../index.html`.
- ⚙️ 설정, 🎮 조작법은 메뉴 안의 시트로 열립니다(이벤트 없음. 설정 변경은 `settings:change`로 옵니다).

### `lobby`
```js
{ rooms: [{ roomId, name, mapId, hostName, players /*수 또는 배열*/, max, status: 'waiting'|'playing' }],
  loading?, error?, joining? /*roomId*/, name?, maps? }
```
대기 중인 방이 먼저 나옵니다. 꽉 찬 방과 게임 중인 방은 참가 버튼이 꺼집니다. 방이 없으면 빈 상태를, `loading`이면 스피너를, `error`면 경고와 [다시 시도]를 보여 줍니다.
[방 만들기] 시트: 방 이름(24자), 맵 카드 3장(이름·영문·설명·미니 아이콘), 최대 인원 2~8 스테퍼.

### `room`
```js
{ roomId, name, mapId, max = 8, teamMax? /*기본 ceil(max/2)*/, hostId?, meId?,
  players: [{ id, name, team: 'owner'|'charterer'|null, ready, ping, host?, me?, bot? }],
  chat: [{ name, text, team? } | { system: true, text }], starting?, maps? }
```
- 방장은 `p.host` 또는 `id === hostId`, 나는 `p.me` 또는 `id === meId`로 판단합니다.
- 팀 칼럼 🟦 선주(Owner) / 🟧 용선자(Charterer)에는 👑, '나' 태그, 핑(색 구분), 준비 상태, 빈 자리를 보여 줍니다. 팀이 없는 플레이어는 '배정 대기' 줄에 나옵니다.
- **[게임 시작]**(방장만): 양 팀이 각각 1명 이상이고, 팀 미배정이 없고, 방장을 뺀 전원이 준비일 때만 켜집니다. 방장은 자동으로 준비로 칩니다. 켜지지 않으면 사유를 보여 줍니다.
- [준비하기]는 누르는 즉시 화면에 반영(낙관적 갱신)되고 `room:ready`를 보냅니다. 다음 `update`가 오면 그 값이 우선합니다.
- 채팅: 최근 30줄을 보여 줍니다. **보낸 메시지는 UI가 직접 넣지 않습니다.** 엔진이 자기 메시지도 `chat` 배열에 넣어 `update`하세요(Supabase broadcast는 기본적으로 자기에게 되돌아오지 않습니다).

### `loadout`
```js
{ weapons: [id | def, ...] /*보통 2개*/, seconds = 5 /*0·null이면 타이머 없음*/, selected? /*지난 선택, 시간 초과 시 기본값*/, round?, title? }
```
무기 def에서 읽는 필드는 이름이 조금 달라도 받습니다.
- `name`, `icon`(또는 `emoji`), `tagline`(또는 `subtitle`, `summary`)
- `stats`: `[{ label, value, unit? }]` 또는 `[[label, value]]` 또는 `{ label: value }`
- `bars`: `{ power, rate, accuracy, mobility, … }`(0~100) 또는 `[{ label, value }]` → 위력, 연사, 정확도, 기동성 막대
- `term`(또는 `glossary`, `domain`) = **도메인 용어 해설**: 문자열이나 `{ word|term|abbr, en|full, ko, desc|text }`, 또는 그 배열(weapons/defs.js 형식 그대로 받음)

카드나 [이 무기로 출격]을 누르거나 1·2 키를 누르면 `loadout:pick { id, auto:false }`를 보내고 닫힙니다. 시간이 끝나면 `{ id: selected ?? 첫 무기, auto:true }`를 보내고 닫힙니다. `update`에 `seconds`가 있으면 카운트다운을 다시 시작합니다.

### `hud` — `ui.hud.set(patch)` (= `show('hud', props)` / `update('hud', props)`, 항상 합침)
| 키 | 의미 |
|---|---|
| `hp`, `maxHp = 100` | 숫자와 바. 30% 이하는 주황, 15% 이하는 빨강. 40% 미만이면 비네트, 20% 이하면 맥박 효과 |
| `ammo`, `reserve`, `mag?` | `7 / 90`. `ammo: null`이면 근접 무기(—). 탄창의 25% 이하면 주황+"R 재장전", 0이면 빨강. `mag`가 없으면 그 슬롯에서 본 최대치로 추정 |
| `reload` (0~1) / `reloading` | 재장전 진행 바, "재장전 중…" |
| `slot` (1~4), `slots` | `slots`: 길이 4 배열(또는 `{1:…, 4:…}`). 원소는 무기 id, def, 또는 `null`(빈 슬롯은 흐리게) |
| `weaponName` | 탄약 위 무기 이름(생략하면 슬롯에서 찾음) |
| `spread` (rad, 반각) / `spreadPx` / `fov` | 동적 크로스헤어 간격. 픽셀 = tan(spread)/tan(fov/2)·화면높이/2. `fov`를 생략하면 설정값을 씀(줌 중이면 현재 카메라 fov를 넘기세요) |
| `roundTime` (초) | `1:23`. 10초 이하면 빨간 깜빡임. `null`이면 `-:--` |
| `score` | `{ owner, charterer, target = 3, bestOf = 5, round? }` → "선주 2 : 1 용선자 · 5판 3선승". 매치 포인트를 자동 표시 |
| `alive`, `teamSize` | `{ owner, charterer }` 생존자 수 / 팀 인원(점으로 표시) |
| `team` | 내 팀. '내 팀' 표시 |
| `hint` / `spectate` | 하단 안내 문구 / "👁️ 관전 중 · 이름". 빈 값이면 숨김 |
| `crosshair: false` | 크로스헤어 숨김 |

- `hitmarker(head, kill)`: 헤드샷은 주황, 킬은 빨강으로 표시합니다.
- `damageFrom(angle)`: 화면 중앙을 도는 붉은 호가 1.3초 동안 보이고 가장자리가 번쩍입니다. 동시에 최대 6개까지 표시합니다.
- `center(text, ms = 2000, { sub, tone })`: `ms`가 0, 음수, Infinity이면 다음 호출 때까지 유지합니다. `''`이면 지웁니다. `tone`을 생략하면 문구에 '선주'/'용선자'/'매치 포인트'가 있는지 보고 색을 정합니다.
- `killfeed.push`: `[죽인 사람] [아이콘 무기] [헤드샷] [죽은 사람]` 형식이고, 최근 5개를 5초 동안 보여 줍니다. `killer`가 없거나 `victim`과 같으면 자폭으로 표시합니다. 내 이름이 들어간 줄은 강조합니다. `weaponName`/`weaponIcon`으로 이름과 아이콘을 덮어쓸 수 있습니다.

### `scoreboard`
```js
{ players: [{ id?, name, team, kills, deaths, head /*또는 headshots*/, ping, alive, me?, bot? }] /*또는 teams: { owner:[…], charterer:[…] }*/,
  score, round?, mapId? | mapName?, meId? }
```
팀별로 킬 많은 순 → 데스 적은 순 → 헤드샷 많은 순으로 정렬합니다. 전사한 플레이어는 흐리게 표시합니다.

### `results`
```js
{ winner: 'owner'|'charterer'|'draw', score: { owner, charterer }, rounds: ['owner', { winner, reason }, …],
  players: [...scoreboard와 같음], mvp? /*이름 또는 객체*/, myTeam?, mapId?, backLabel?, lobbyLabel? /*false면 숨김*/ }
```
MVP를 생략하면 최다 킬(동률이면 데스 적은 순 → 헤드샷 많은 순)로 정합니다. 하단 고정 버튼은 [방으로 돌아가기](`results:back`)와 [로비로](`results:lobby`)입니다.

### `pause`
```js
{ leaveLabel = '방 나가기', leaveConfirm?, note? }
```
버튼은 ▶ 계속하기, ⚙️ 설정, 🎮 조작법, 🚪 나가기(한 번 더 확인)입니다. 연습장에서는 `leaveLabel: '연습장 나가기'`를 쓰세요.

## 이벤트(`ui.on`)

| action | payload | 비고 |
|---|---|---|
| `needCursor` | `true` / `false` | 커서가 필요한 화면이 생기거나 없어질 때만 발생 |
| `menu:sandbox` | `{ name, account }` | 🎯 연습장(봇) |
| `menu:multi` | `{ name, account }` | 🌐 멀티플레이 |
| `menu:name` | `{ name, account:false }` | 닉네임 입력 확정(change). 저장됨 |
| `settings:change` | `{ settings, key, value, changed[] }` | 슬라이더를 움직이는 동안 계속 발생 |
| `lobby:refresh` / `lobby:back` | `{}` | |
| `lobby:join` | `{ roomId }` | |
| `lobby:create` | `{ name, mapId, max }` | |
| `room:team` | `{ team }` | |
| `room:ready` | `{ ready }` | |
| `room:start` | `{ roomId, mapId }` | 방장만, 조건을 만족할 때만 |
| `room:map` | `{ mapId }` | 방장만 |
| `room:chat` | `{ text }` | 공백을 정리한 1~120자 |
| `room:leave` | `{ roomId }` | |
| `loadout:pick` | `{ id, auto }` | |
| `results:back` / `results:lobby` | `{}` | |
| `pause:resume` / `pause:leave` | `{}` | 둘 다 일시정지 화면을 스스로 닫음 |

## 설정

설정의 주인은 core(`js/core/settings.js`, `localStorage['portops.settings.v1']`)입니다. UI 설정 시트가 다루는 항목은 아래 4개이고, 기본값과 범위는 core와 같습니다.

| 키 | 기본값 | 범위 |
|---|---|---|
| `sensitivity` | 1 | 0.1 ~ 5 (배율) |
| `zoomMode` | `'hold'` | `'hold'` 누르고 있기 / `'toggle'` 토글 |
| `fov` | 75 | 60 ~ 100, 수직 시야각(°) — `camera.fov`에 그대로 |
| `volume` | 0.8 | 0 ~ 1 |

닉네임은 같은 저장소의 `name`에 둡니다. 범위를 벗어난 값은 쓸 때 보정합니다. [기본값으로]는 위 4개만 되돌립니다.

## 데모 / QA

`fps/ui-demo.html`은 HTTP로 열어야 합니다(`file://`에서는 ES 모듈이 막힘). 예: 저장소 루트에서 `python -m http.server`.
- 왼쪽 QA 패널에서 모든 화면과 HUD 동작(히트, 헤드샷, 피격, 킬피드, 중앙 메시지)을 띄울 수 있고, 전체 투어를 자동으로 돌릴 수 있습니다. 발생한 이벤트는 로그로 보여 줍니다.
- 메뉴부터 실제 흐름을 따라갈 수 있습니다: 멀티플레이 → 방 만들기 → 시작 → 로드아웃 → HUD → Esc 일시정지.
- HUD 조작: 좌클릭 사격, 우클릭 줌(NOR-1), 1~4 슬롯, R 재장전, H 피격, K 킬피드, Tab 점수판.
- URL로 바로 열기: `?screen=menu|menu-account|settings|controls|lobby|lobby-empty|lobby-loading|lobby-error|create|room|room-guest|loadout|hud|hud-low|scope|scoreboard|results|pause`, `&bare=1`이면 QA 패널을 숨깁니다(스크린샷용).
- 데모는 `../weapons/defs.js`와 `../maps/index.js`가 있으면 실제 데이터를 쓰고, 없거나 불러오지 못하면 **목 데이터**를 씁니다(이벤트 로그 첫 줄 `demo:data`). `?mock=1`이면 항상 목 데이터를 씁니다.

## 알려진 한계

- 게임패드나 터치 조작용 UI는 없습니다(모바일에서는 메뉴, 로비, 방, 결과만 쓸 만합니다).
- 채팅에는 욕설 필터나 도배 제한이 없습니다(길이만 120자로 자름). 필요하면 net 쪽에서 처리하세요.
- 점수판 핑과 생존 여부는 엔진이 주는 값을 그대로 보여 줍니다.
- 아이콘 일부는 이모지라 OS에 따라 모양이 다릅니다.
