-- Port Quiz 공유 랭킹 테이블 (Supabase 프로젝트: skala-domain-study)
-- SQL Editor에서 한 번 실행하면 된다. (2026-11-03 적용 완료)

create table if not exists public.scores (
  id bigint generated always as identity primary key,
  mode text not null check (mode in ('timeattack','ox','mc','short','mixed')),
  name text not null check (char_length(btrim(name)) between 1 and 12),
  score integer not null check (score between 0 and 1000),
  total integer not null check (total between 0 and 1000),
  accuracy double precision not null default 0 check (accuracy between 0 and 1),
  time_ms integer not null default 0 check (time_ms between 0 and 86400000),
  created_at timestamptz not null default now(),
  constraint scores_score_le_total check (score <= total)
);

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
