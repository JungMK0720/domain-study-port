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

## 랭킹 저장 방식
기본값은 **브라우저 localStorage** 저장입니다 (설정 불필요, 기록은 기기·브라우저별로 따로 보관).

### 팀 공유 랭킹 설정 (선택, Supabase 무료 플랜)
1. [supabase.com](https://supabase.com)에서 프로젝트 생성
2. SQL Editor에서 실행:
   ```sql
   create table public.scores (
     id bigint generated always as identity primary key,
     mode text not null check (mode in ('timeattack','ox','mc','short','mixed')),
     name text not null check (char_length(name) between 1 and 12),
     score int not null check (score between 0 and 1000),
     total int not null check (total between 0 and 1000),
     accuracy double precision not null default 0,
     time_ms int not null default 0,
     created_at timestamptz not null default now()
   );
   alter table public.scores enable row level security;
   create policy "anyone can read"   on public.scores for select using (true);
   create policy "anyone can insert" on public.scores for insert with check (true);
   ```
3. Project Settings → API에서 **Project URL**과 **anon public key**를 복사해 `js/config.js`에 입력:
   ```js
   leaderboard: { provider: 'supabase', supabase: { url: 'https://xxxx.supabase.co', anonKey: '...', table: 'scores' } }
   ```
4. 커밋 & 푸시하면 모든 팀원이 같은 랭킹을 보게 됩니다.

> anon key는 공개되어도 되는 키이지만, 누구나 기록을 등록할 수 있는 구조이므로 스터디 용도로만 사용하세요.

## 로컬 실행
빌드 과정 없음 — `index.html`을 브라우저로 열거나 `python -m http.server` 후 http://localhost:8000 접속.
