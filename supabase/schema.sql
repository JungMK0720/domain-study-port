-- Port Quiz 공유 랭킹 테이블 (Supabase 프로젝트: skala-domain-study)
-- SQL Editor에서 한 번 실행하면 된다. (2026-11-03 적용 완료)

create table if not exists public.scores (
  id bigint generated always as identity primary key,
  mode text not null,  -- 제약은 아래 scores_mode_check 참고
  name text not null check (char_length(btrim(name)) between 1 and 12),
  score integer not null check (score between 0 and 1000),
  total integer not null check (total between 0 and 1000),
  accuracy double precision not null default 0 check (accuracy between 0 and 1),
  time_ms integer not null default 0 check (time_ms between 0 and 86400000),
  created_at timestamptz not null default now(),
  constraint scores_score_le_total check (score <= total)
);

-- 모드·점수 제약 (2026-11-03 변경)
--  - 5분 타임어택 → 오래 버텨라 'survival' 추가 ('timeattack'은 옛 기록 보존용)
--  - 게임 모드 'runner'(항로 질주)·'shooter'(슈팅해운) 추가: score = 획득 점수라 시도 수(total)보다 클 수 있음
alter table public.scores drop constraint if exists scores_mode_check;
alter table public.scores add constraint scores_mode_check
  check (mode in ('timeattack','survival','ox','mc','short','mixed','runner','shooter'));
alter table public.scores drop constraint if exists scores_score_check;
alter table public.scores add constraint scores_score_check check (score between 0 and 10000000);
alter table public.scores drop constraint if exists scores_total_check;
alter table public.scores add constraint scores_total_check check (total between 0 and 100000);
alter table public.scores drop constraint if exists scores_score_le_total;
alter table public.scores add constraint scores_score_le_total check (mode in ('runner','shooter') or score <= total);

create index if not exists scores_mode_rank_idx
  on public.scores (mode, score desc, accuracy desc, time_ms asc, created_at asc);

-- 브라우저(publishable key)에서는 읽기·등록만 가능, 수정·삭제 불가
alter table public.scores enable row level security;

create policy "scores_read_all" on public.scores
  for select to anon, authenticated using (true);

create policy "scores_insert_all" on public.scores
  for insert to anon, authenticated with check (true);

grant select, insert on public.scores to anon, authenticated;
revoke update, delete, truncate on public.scores from anon, authenticated;

-- 관리용 (SQL Editor에서 직접 실행):
--   특정 기록 삭제:  delete from public.scores where id = <id>;
--   모드 초기화:     delete from public.scores where mode = 'timeattack';
