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
- **🏆 랭킹** — 이름을 입력해 기록 등록, 팀 공유 리더보드, 상위 3명 🥇🥈🥉 메달
  (학습 모드는 카테고리·난이도 '전체'로 풀었을 때만 등록)
- 키보드 단축키: OX `O`/`X`(또는 `1`/`2`), 객관식 `1`~`4`, `Enter` 제출/다음

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
- 테이블·보안 정책: `supabase/schema.sql` — RLS로 **읽기·등록만 허용, 수정·삭제 불가**, 이름 1~12자·점수 범위 등 서버측 검증
- publishable key(`sb_publishable_...`)는 브라우저 공개용 키라 저장소에 있어도 됩니다. **secret key(`sb_secret_...`)는 절대 커밋하지 마세요.**
- 기록 삭제·초기화는 Supabase 대시보드 SQL Editor에서 직접 (`schema.sql` 하단 참고)
- `provider`를 `'local'`로 바꾸면 브라우저 localStorage 저장(기기별)으로 돌아갑니다.

> 로그인 없이 누구나 기록을 등록할 수 있는 구조이므로 스터디 용도로만 사용하세요.

## 로컬 실행
빌드 과정 없음 — `index.html`을 브라우저로 열거나 `python -m http.server` 후 http://localhost:8000 접속.
