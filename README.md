# ⚓ Port Quiz — 항만물류 도메인 스터디

부이·부두·선석(Berth)·접안(Berthing)부터 선박, 컨테이너 터미널, 해운물류, 항만 인프라까지 —
OX · 객관식 · 주관식 문제로 항만물류 도메인을 익히는 정적 퀴즈 사이트입니다.

**사이트:** https://jungmk0720.github.io/domain-study-port/

## 기능
- **⏱ 5분 타임어택** — 5분 동안 OX·객관식·주관식이 섞여 나오고, 많이 맞힐수록 상위 랭킹 (동점이면 정답률)
- **OX 퀴즈 / 객관식 / 주관식 / 종합 모의고사** — 문제마다 정답과 해설 제공, 카테고리 필터 학습
- **🏆 랭킹** — 이름을 입력해 기록 등록, 모드별 리더보드, 상위 3명 🥇🥈🥉 메달 표시
- 키보드 단축키: OX `O`/`X`(또는 `1`/`2`), 객관식 `1`~`4`, `Enter` 제출/다음

## 문제 카테고리
| 파일 | 카테고리 |
| --- | --- |
| `data/q-mooring.js` | 계류·접안시설 (부두, 안벽, 잔교, 돌핀, 선석, 접안/이안, 방충재, 계선주, 계류삭, 계선부표) |
| `data/q-vessel.js` | 선박·항해 (LOA, 흘수, 톤수, TEU, 도선, 예선, ETA/ETB) |
| `data/q-terminal.js` | 컨테이너 터미널 (STS·RTG·RMG, CY/CFS, TOS, 선석계획, 생산성 지표) |
| `data/q-logistics.js` | 해운·항만물류 (B/L, Manifest, Demurrage/Detention, 인코텀즈, 보세) |
| `data/q-infra.js` | 항만인프라·스마트항만 (방파제, 항로, 항로표지·부표, VTS, Port-MIS, 친환경 항만) |

### 문제 추가 방법
각 `data/q-*.js` 파일의 `window.QUESTION_BANK.push(...)` 안에 아래 형식으로 추가하면 됩니다.

```js
{ id: "moor-ox-21", type: "ox", category: "계류·접안시설", question: "진술문", answer: true, explanation: "해설" },
{ id: "moor-mc-17", type: "mc", category: "계류·접안시설", question: "질문", choices: ["A", "B", "C", "D"], answer: 0, explanation: "해설" },
{ id: "moor-sa-13", type: "short", category: "계류·접안시설", question: "질문 (한글 2글자)", answer: "선석", accept: ["선석", "berth"], explanation: "해설" }
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
