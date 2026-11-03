# ⚓ Port Quiz — 탱커 체선료 최적화 프로젝트 도메인 스터디

레이타임·NOR·SOF부터 부이·부두·접안까지 — 팀 프로젝트(울산 원유 탱커 체선료 최적화)에 필요한 용어만 모은
OX · 객관식 · 주관식 퀴즈 사이트입니다.

**사이트:** https://jungmk0720.github.io/domain-study-port/

## 기능
- **⏳ 오래 버텨라** — 60초로 시작해 정답 +10초 · 오답 -30초 · 패스 -10초. 시간이 0이 되면 끝.
  버틸수록 난이도가 하 → 중 → 상으로 올라갑니다. 맞힌 개수로 순위(동점이면 정답률, 그다음 오래 버틴 순).
- **OX 퀴즈 / 객관식 / 주관식 / 종합 모의고사** — 문제마다 정답과 해설, 카테고리·난이도 필터 학습
- **난이도** — 하·빈출(매일 쓰는 핵심 용어) / 중·실무(절차·관계·계산) / 상·심화(계약 조항·판례·규정 세부)
- **📖 용어집** — 팀 도메인 용어집(`data/glossary.js`): 뜻 · 공항 비유 · 헷갈림 주의, 검색·카테고리 필터,
  용어마다 관련 문제 바로 풀기(랭킹 미반영)
- **🏆 랭킹** — 이름 + 비밀번호로 기록 등록, 팀 공유 리더보드, 상위 3명 🥇🥈🥉 메달
  (학습 모드는 카테고리·난이도 '전체'로 풀었을 때만 등록)
- **👤 내 기록 / 🔐 관리자** — `#/me`에서 이름·비밀번호로 내 기록 보기·비밀번호 변경, `#/admin`에서 관리자가 비밀번호 재설정
- 키보드 단축키: OX `O`/`X`(또는 `1`/`2`), 객관식 `1`~`4`, `Enter` 제출/다음

## 🎮 게임으로 복습
| 게임 | 방법 | 파일 |
| --- | --- | --- |
| 🚢 **항로 질주** | O/X 진술을 읽고 왼쪽(O)·오른쪽(X) 항로로 배를 몰아 게이트 통과. `↑`/`↓` 속도 1.0×~3.0×, `Space` 바로 통과(일찍 맞힐수록 보너스) | `js/games/runner.js` |
| 🎯 **슈팅해운** | 정의문에 맞는 용어 과녁을 클릭해서 명중. 오답 과녁·시간 초과는 목숨 -1 | `js/games/shooter.js`, `data/shooter-cards.js` |
| 🔭 **스나이퍼해운** | 우클릭 스코프 줌 · 좌클릭 사격. 틀린 진술의 위장 적선은 저격, 맞는 진술의 아군은 통과 | `js/games/sniper.js` |

게임 점수도 랭킹에 올라가요(목숨 3개, 점수 높은 순).

## 🔫 항만 작전 (Port Ops) — 멀티플레이 FPS
**바로가기:** https://jungmk0720.github.io/domain-study-port/fps/

울산 탱커 터미널을 배경으로 한 오리지널 팀 FPS예요. 무기 이름과 맵이 모두 프로젝트 도메인 용어로 되어 있고,
무기 선택 화면에서 용어 해설을 함께 보여 줘요.

- **팀**: 선주(Owner) vs 용선자(Charterer) · 팀 섬멸전 **5판 3선승** · 체력 100 · 라운드 중 부활 없음
- **조작**: `WASD` 이동 · 마우스 시점 · 좌클릭 사격 · 우클릭 줌 · `Space` 점프 · `Shift` 천천히 걷기 · `R` 재장전 · `1`~`4` 무기 · `Tab` 점수판 · `Esc` 메뉴
- **무기**
  | 슬롯 | 무기 | 도메인 용어 | 특징 |
  | --- | --- | --- | --- |
  | 1 | 🎯 NOR-1 저격소총 | Notice of Readiness | 어느 부위든 1발 킬, 반샷(퀵스코프) 가능 |
  | 1 | 🔫 DWT-47 돌격소총 | Deadweight Tonnage | 연사 600rpm, 우클릭 2배 정조준 |
  | 2 | 📋 SOF-9 권총 | Statement of Facts | 반자동 보조무기 |
  | 3 | 🔪 호서 커터 | Hawser(계류삭) | 좌클릭 베기 50 · 우클릭 찌르기 100 |
  | 4 | 🛢️ 벙커 수류탄 | Bunker(선박 연료) | 2.5초 뒤 폭발, 반경 6m |
- **맵**: 원유 부두(Crude Jetty) · 탱크 팜(Tank Farm) · VLCC 갑판(Tanker Deck)
- **🎯 연습장(봇)**: 1:1 ~ 4:4, 쉬움·보통·어려움. 혼자서 바로 연습
- **🌐 멀티플레이**: 로비에서 방 만들기·참가, 팀·준비·맵 선택·채팅. 방장이 나가도 다른 사람이 방장을 이어받아 점수가 유지돼요.
  Supabase 무료 플랜의 실시간 메시지 한도(초당 100개) 때문에 **방 하나에 최대 6명(3:3)**
- 코드: `fps/` (three.js 0.170, 빌드 없음) — 설계는 [`fps/ARCHITECTURE.md`](fps/ARCHITECTURE.md), 모듈별 API는 `fps/js/game/*_API.md`

## 문제 카테고리
| 파일 | 카테고리 |
| --- | --- |
| `data/q-laytime.js` | 체선료·레이타임 — 용선계약, Laytime, Demurrage, NOR, SOF, 클레임 |
| `data/q-arrival.js` | 입항·대기·접안 — 입항 절차, ETA/ETB, 도선·예선, 묘박 대기, VTS |
| `data/q-berth.js` | 부두·계류·하역 — 잔교·돌핀·SBM, 계류, 로딩암·호스, 펌핑, 안전점검 |
| `data/q-ship.js` | 탱커·선박 — 선박 제원, 탱커 선형·설비, 검선, 선박 식별 |
| `data/q-data.js` | 운항데이터·지표 — AIS, 선석 KPI, 선석 배정, 정보시스템 |

### 문제 검증 (크로스체크)
모든 문항은 외부 출처(법령, IMO·IALA·ICC·BIMCO·OCIMF 등 국제기구·표준, 공공기관, 판례, 전문자료)와 대조해 검증했습니다.
문항별 판정과 근거 출처는 [`docs/factcheck/`](docs/factcheck/)에, 프로젝트 맞춤 재편 기록(제외한 문항과 사유)은
[`docs/factcheck/restructure.md`](docs/factcheck/restructure.md)에 있습니다.

### 문제 추가 방법
각 `data/q-*.js` 파일의 `window.QUESTION_BANK.push(...)` 안에 아래 형식으로 추가하면 됩니다. `level`: 1=하, 2=중, 3=상.

```js
{ id: "lay-ox-99", type: "ox", category: "체선료·레이타임", level: 1, question: "진술문", answer: true, explanation: "해설" },
{ id: "lay-mc-99", type: "mc", category: "체선료·레이타임", level: 2, question: "질문", choices: ["A", "B", "C", "D"], answer: 0, explanation: "해설" },
{ id: "lay-sa-99", type: "short", category: "체선료·레이타임", level: 1, question: "질문 (영문 약어 3글자)", answer: "SOF", accept: ["SOF", "Statement of Facts"], explanation: "해설" }
```
주관식 채점은 대소문자·공백·`- _ . · / ( ) ' " ,`를 무시하고 `answer`/`accept` 중 하나와 일치하면 정답입니다.

## 랭킹 저장 방식 — 팀 공유 (Supabase)
랭킹은 Supabase 프로젝트 **skala-domain-study**의 `public.scores` 테이블에 저장되어 **모든 팀원이 같은 랭킹**을 봅니다.

```
GitHub Pages (정적 HTML/JS)  ──HTTPS(REST)──▶  Supabase (Postgres + 자동 REST API)
        브라우저가 publishable key로 직접 호출 · 서버 코드 없음
```

- 설정 위치: `js/config.js` (`provider: 'supabase'`, Project URL, publishable key)
- 테이블: `supabase/schema.sql` (점수) · `supabase/accounts.sql` (계정·관리자)
- **이름은 한 사람만** 쓸 수 있어요. 처음 기록할 때 비밀번호(4~32자)를 정하고, 다음부터는 그 비밀번호로 기록해요.
  모드마다 **더 좋은 기록 하나만** 남아요. 비밀번호를 5번 틀리면 5분 동안 잠겨요.
- 비밀번호는 bcrypt 해시로만 저장되고, 점수 등록·조회는 모두 서버 함수(RPC)로만 해요. 테이블에 직접 쓰기는 막혀 있어요.
- **관리자 패널** `#/admin`: 비밀번호 재설정·잠금 해제·이름 변경·기록 삭제. 관리자 계정은 Supabase 대시보드에서 직접 만들어요
  (Authentication → Add user → `accounts.sql` 하단의 `insert into public.admins ...` 실행).
- publishable key(`sb_publishable_...`)는 브라우저 공개용 키라 저장소에 있어도 됩니다. **secret key(`sb_secret_...`)는 절대 커밋하지 마세요.**
- `provider`를 `'local'`로 바꾸면 브라우저 localStorage 저장(기기별)으로 돌아갑니다.

## 로컬 실행
빌드 과정 없음 — `index.html`을 브라우저로 열거나 `python -m http.server` 후 http://localhost:8000 접속.
