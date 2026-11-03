-- =====================================================================
-- Port Quiz: 이름 계정(비밀번호) + 이름·모드별 최고 기록 + 관리자 (2026-11-03)
--  - 이름은 중복 불가(대소문자·연속 공백 무시). 비밀번호는 bcrypt 해시로만 저장.
--  - 같은 이름으로 다시 등록하면 비밀번호 확인 후 '더 좋은 기록'일 때만 갱신.
--  - 5회 연속 틀리면 5분 잠금. 로그인 유지는 세션 토큰(해시로 저장, 60일).
--  - 관리자: Supabase Auth 사용자 중 public.admins에 등록된 계정만 admin_* 함수 사용 가능.
--  - 모든 쓰기는 SECURITY DEFINER 함수(RPC)로만. 직접 insert는 2단계에서 막는다.
-- =====================================================================

-- ───────────── 1단계 (기존 사이트와 호환: 직접 insert 아직 허용) ─────────────
create extension if not exists pgcrypto with schema extensions;

-- 백업 (정리 전 원본 보관)
create table if not exists public.scores_backup_20261103 as table public.scores;
alter table public.scores_backup_20261103 enable row level security;
revoke all on public.scores_backup_20261103 from anon, authenticated;

-- 이름 정규화
create or replace function public.pq_clean_name(p text) returns text
language sql immutable as $$ select regexp_replace(btrim(coalesce(p, '')), '\s+', ' ', 'g') $$;
create or replace function public.pq_norm_name(p text) returns text
language sql immutable as $$ select lower(public.pq_clean_name(p)) $$;
-- 오래 버텨라·게임은 오래 버틸수록, 학습 모드는 빨리 풀수록 좋은 기록
create or replace function public.pq_time_desc(p_mode text) returns boolean
language sql immutable as $$ select p_mode in ('survival', 'runner', 'shooter', 'sniper') $$;
create or replace function public.pq_is_better(p_mode text, a_score int, a_acc double precision, a_time int,
                                              b_score int, b_acc double precision, b_time int) returns boolean
language sql immutable as $$
  select a_score > b_score or (a_score = b_score and (a_acc > b_acc or (a_acc = b_acc and
         (case when public.pq_time_desc(p_mode) then a_time > b_time else a_time < b_time end))))
$$;

create table if not exists public.players (
  id bigint generated always as identity primary key,
  name text not null check (char_length(name) between 1 and 12),
  name_key text not null unique,
  password_hash text,                 -- null = 옛 기록 이름(처음 등록하는 사람이 비밀번호를 정하거나 관리자가 설정)
  failed_count int not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.players enable row level security;
revoke all on public.players from anon, authenticated;

create table if not exists public.player_sessions (
  token_hash text primary key,        -- sha256(토큰). 토큰 원문은 브라우저에만 있음
  player_id bigint not null references public.players(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
alter table public.player_sessions enable row level security;
revoke all on public.player_sessions from anon, authenticated;

create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.admins enable row level security;
revoke all on public.admins from anon, authenticated;

alter table public.scores add column if not exists player_id bigint references public.players(id) on delete cascade;

-- 기존 기록의 이름 → 계정(비밀번호 미설정)으로 옮기고, 이름·모드별 최고 기록만 남김
insert into public.players (name, name_key)
select distinct on (public.pq_norm_name(name)) public.pq_clean_name(name), public.pq_norm_name(name)
from public.scores where player_id is null
order by public.pq_norm_name(name), created_at
on conflict (name_key) do nothing;

update public.scores s set player_id = p.id
from public.players p
where s.player_id is null and p.name_key = public.pq_norm_name(s.name);

delete from public.scores s using (
  select id, row_number() over (
           partition by player_id, mode
           order by score desc, accuracy desc,
                    case when public.pq_time_desc(mode) then -time_ms else time_ms end asc,
                    created_at asc) as rn
  from public.scores where player_id is not null) d
where s.id = d.id and d.rn > 1;

create unique index if not exists scores_player_mode_uidx on public.scores (player_id, mode);

-- ───────────── 내부 함수 (외부 호출 불가) ─────────────
-- 이름+비밀번호 인증. 실패 횟수 기록이 롤백되지 않도록 예외 대신 o_error로 반환
create or replace function public.pq_auth(p_name text, p_password text, p_create boolean,
  out o_player_id bigint, out o_name text, out o_error text)
language plpgsql security definer set search_path = public, extensions as $$
declare
  v public.players%rowtype;
  k text := public.pq_norm_name(p_name);
  c text := public.pq_clean_name(p_name);
begin
  if char_length(c) < 1 or char_length(c) > 12 then o_error := 'NAME_INVALID'; return; end if;
  if p_password is null or char_length(p_password) < 4 or char_length(p_password) > 32 then
    o_error := 'PASSWORD_INVALID'; return;
  end if;
  select * into v from public.players where name_key = k for update;
  if not found then
    if not p_create then o_error := 'NOT_FOUND'; return; end if;
    insert into public.players (name, name_key, password_hash)
    values (c, k, crypt(p_password, gen_salt('bf', 8)))
    returning id, name into o_player_id, o_name;
    return;
  end if;
  if v.locked_until is not null and v.locked_until > now() then o_error := 'LOCKED'; return; end if;
  if v.password_hash is null then
    update public.players
       set password_hash = crypt(p_password, gen_salt('bf', 8)), failed_count = 0, locked_until = null, updated_at = now()
     where id = v.id;
    o_player_id := v.id; o_name := v.name; return;
  end if;
  if crypt(p_password, v.password_hash) <> v.password_hash then
    update public.players
       set failed_count = failed_count + 1,
           locked_until = case when failed_count + 1 >= 5 then now() + interval '5 minutes' else locked_until end
     where id = v.id;
    o_error := 'WRONG_PASSWORD'; return;
  end if;
  if v.failed_count <> 0 or v.locked_until is not null then
    update public.players set failed_count = 0, locked_until = null where id = v.id;
  end if;
  o_player_id := v.id; o_name := v.name;
end $$;

create or replace function public.pq_new_session(p_player_id bigint) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare t text := encode(gen_random_bytes(24), 'hex');
begin
  delete from public.player_sessions where expires_at < now();
  insert into public.player_sessions (token_hash, player_id, expires_at)
  values (encode(digest(t, 'sha256'), 'hex'), p_player_id, now() + interval '60 days');
  return t;
end $$;

create or replace function public.pq_session_player(p_token text) returns bigint
language sql stable security definer set search_path = public, extensions as $$
  select player_id from public.player_sessions
  where token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex') and expires_at > now()
$$;

create or replace function public.pq_rank(p_score_id bigint) returns int
language sql stable security definer set search_path = public as $$
  select 1 + count(*)::int
  from public.scores o, public.scores b
  where b.id = p_score_id and o.mode = b.mode and o.id <> b.id and (
        o.score > b.score or (o.score = b.score and (
        o.accuracy > b.accuracy or (o.accuracy = b.accuracy and (
        (case when public.pq_time_desc(b.mode) then o.time_ms > b.time_ms else o.time_ms < b.time_ms end)
        or (o.time_ms = b.time_ms and o.created_at < b.created_at))))))
$$;

create or replace function public.pq_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and exists (select 1 from public.admins where user_id = auth.uid())
$$;

-- ───────────── 사용자 함수 (RPC) ─────────────
create or replace function public.submit_score(
  p_mode text, p_score int, p_total int, p_correct int, p_time_ms int,
  p_token text default null, p_name text default null, p_password text default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_pid bigint; v_name text; v_err text; v_token text := null;
  v_points boolean := p_mode in ('runner', 'shooter', 'sniper');
  v_score int := greatest(0, coalesce(p_score, 0));
  v_total int := greatest(0, coalesce(p_total, 0));
  v_correct int; v_acc double precision; v_time int := greatest(0, coalesce(p_time_ms, 0));
  v_old public.scores%rowtype; v_improved boolean := false; v_id bigint;
begin
  if p_mode is null or p_mode not in ('survival', 'ox', 'mc', 'short', 'mixed', 'runner', 'shooter', 'sniper') then
    return jsonb_build_object('ok', false, 'error', 'MODE_INVALID');
  end if;
  if coalesce(p_token, '') <> '' and p_name is null then
    v_pid := public.pq_session_player(p_token);
    if v_pid is null then return jsonb_build_object('ok', false, 'error', 'SESSION_EXPIRED'); end if;
    select name into v_name from public.players where id = v_pid;
  else
    select o_player_id, o_name, o_error into v_pid, v_name, v_err from public.pq_auth(p_name, p_password, true);
    if v_err is not null then return jsonb_build_object('ok', false, 'error', v_err); end if;
    v_token := public.pq_new_session(v_pid);
  end if;
  if v_points then
    v_correct := least(v_total, greatest(0, coalesce(p_correct, 0)));
  else
    v_total := greatest(v_score, v_total);
    v_correct := v_score;
  end if;
  v_acc := case when v_total > 0 then v_correct::double precision / v_total else 0 end;

  select * into v_old from public.scores where player_id = v_pid and mode = p_mode for update;
  if not found then
    insert into public.scores (mode, name, score, total, accuracy, time_ms, player_id)
    values (p_mode, v_name, v_score, v_total, v_acc, v_time, v_pid) returning id into v_id;
    v_improved := true;
  elsif public.pq_is_better(p_mode, v_score, v_acc, v_time, v_old.score, v_old.accuracy, v_old.time_ms) then
    update public.scores
       set score = v_score, total = v_total, accuracy = v_acc, time_ms = v_time, name = v_name, created_at = now()
     where id = v_old.id;
    v_id := v_old.id; v_improved := true;
  else
    v_id := v_old.id;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id, 'name', v_name, 'improved', v_improved,
    'rank', public.pq_rank(v_id), 'token', v_token,
    'best', (select jsonb_build_object('score', score, 'total', total, 'accuracy', accuracy,
                                       'timeMs', time_ms, 'createdAt', created_at)
             from public.scores where id = v_id));
end $$;

create or replace function public.player_login(p_name text, p_password text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_pid bigint; v_name text; v_err text;
begin
  select o_player_id, o_name, o_error into v_pid, v_name, v_err from public.pq_auth(p_name, p_password, false);
  if v_err is not null then return jsonb_build_object('ok', false, 'error', v_err); end if;
  return jsonb_build_object('ok', true, 'name', v_name, 'token', public.pq_new_session(v_pid));
end $$;

create or replace function public.player_logout(p_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  delete from public.player_sessions where token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex');
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.player_records(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare v_pid bigint := public.pq_session_player(p_token);
begin
  if v_pid is null then return jsonb_build_object('ok', false, 'error', 'SESSION_EXPIRED'); end if;
  return jsonb_build_object('ok', true,
    'name', (select name from public.players where id = v_pid),
    'records', (select coalesce(jsonb_agg(jsonb_build_object(
                  'mode', s.mode, 'score', s.score, 'total', s.total, 'accuracy', s.accuracy,
                  'timeMs', s.time_ms, 'createdAt', s.created_at, 'rank', public.pq_rank(s.id))
                  order by s.mode), '[]'::jsonb)
                from public.scores s where s.player_id = v_pid));
end $$;

create or replace function public.player_change_password(p_token text, p_old text, p_new text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_pid bigint := public.pq_session_player(p_token); v_name text; v_chk bigint; v_err text;
begin
  if v_pid is null then return jsonb_build_object('ok', false, 'error', 'SESSION_EXPIRED'); end if;
  if p_new is null or char_length(p_new) < 4 or char_length(p_new) > 32 then
    return jsonb_build_object('ok', false, 'error', 'PASSWORD_INVALID');
  end if;
  select name into v_name from public.players where id = v_pid;
  select o_player_id, o_error into v_chk, v_err from public.pq_auth(v_name, p_old, false);
  if v_err is not null then return jsonb_build_object('ok', false, 'error', v_err); end if;
  update public.players set password_hash = crypt(p_new, gen_salt('bf', 8)), updated_at = now() where id = v_pid;
  delete from public.player_sessions
   where player_id = v_pid and token_hash <> encode(digest(coalesce(p_token, ''), 'sha256'), 'hex');
  return jsonb_build_object('ok', true);
end $$;

-- ───────────── 관리자 함수 (RPC, Supabase Auth 로그인 + admins 등록 필요) ─────────────
create or replace function public.admin_list_players() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.pq_is_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
            'id', p.id, 'name', p.name, 'hasPassword', p.password_hash is not null,
            'failedCount', p.failed_count, 'lockedUntil', p.locked_until, 'createdAt', p.created_at,
            'records', (select coalesce(jsonb_agg(jsonb_build_object(
                          'id', s.id, 'mode', s.mode, 'score', s.score, 'total', s.total,
                          'accuracy', s.accuracy, 'timeMs', s.time_ms, 'createdAt', s.created_at)
                          order by s.mode), '[]'::jsonb)
                        from public.scores s where s.player_id = p.id))
            order by p.name_key), '[]'::jsonb)
          from public.players p);
end $$;

create or replace function public.admin_set_password(p_player_id bigint, p_new text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public.pq_is_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_new is null or char_length(p_new) < 4 or char_length(p_new) > 32 then
    return jsonb_build_object('ok', false, 'error', 'PASSWORD_INVALID');
  end if;
  update public.players
     set password_hash = crypt(p_new, gen_salt('bf', 8)), failed_count = 0, locked_until = null, updated_at = now()
   where id = p_player_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'NOT_FOUND'); end if;
  delete from public.player_sessions where player_id = p_player_id;   -- 기존 로그인 모두 해제
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_create_player(p_name text, p_password text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare c text := public.pq_clean_name(p_name); k text := public.pq_norm_name(p_name); v_id bigint;
begin
  if not public.pq_is_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if char_length(c) < 1 or char_length(c) > 12 then return jsonb_build_object('ok', false, 'error', 'NAME_INVALID'); end if;
  if p_password is null or char_length(p_password) < 4 or char_length(p_password) > 32 then
    return jsonb_build_object('ok', false, 'error', 'PASSWORD_INVALID');
  end if;
  if exists (select 1 from public.players where name_key = k) then
    return jsonb_build_object('ok', false, 'error', 'NAME_TAKEN');
  end if;
  insert into public.players (name, name_key, password_hash)
  values (c, k, crypt(p_password, gen_salt('bf', 8))) returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'name', c);
end $$;

create or replace function public.admin_rename_player(p_player_id bigint, p_new_name text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c text := public.pq_clean_name(p_new_name); k text := public.pq_norm_name(p_new_name);
begin
  if not public.pq_is_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if char_length(c) < 1 or char_length(c) > 12 then return jsonb_build_object('ok', false, 'error', 'NAME_INVALID'); end if;
  if exists (select 1 from public.players where name_key = k and id <> p_player_id) then
    return jsonb_build_object('ok', false, 'error', 'NAME_TAKEN');
  end if;
  update public.players set name = c, name_key = k, updated_at = now() where id = p_player_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'NOT_FOUND'); end if;
  update public.scores set name = c where player_id = p_player_id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_unlock(p_player_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.pq_is_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  update public.players set failed_count = 0, locked_until = null where id = p_player_id;
  return jsonb_build_object('ok', found);
end $$;

create or replace function public.admin_delete_player(p_player_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.pq_is_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  delete from public.players where id = p_player_id;   -- 기록·세션은 cascade로 함께 삭제
  return jsonb_build_object('ok', found);
end $$;

create or replace function public.admin_delete_score(p_score_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.pq_is_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  delete from public.scores where id = p_score_id;
  return jsonb_build_object('ok', found);
end $$;

-- ───────────── 실행 권한 ─────────────
revoke execute on function public.pq_auth(text, text, boolean) from public, anon, authenticated;
revoke execute on function public.pq_new_session(bigint) from public, anon, authenticated;
revoke execute on function public.pq_session_player(text) from public, anon, authenticated;
revoke execute on function public.pq_rank(bigint) from public, anon, authenticated;
revoke execute on function public.pq_is_admin() from public, anon, authenticated;

revoke execute on function public.submit_score(text, int, int, int, int, text, text, text) from public;
revoke execute on function public.player_login(text, text) from public;
revoke execute on function public.player_logout(text) from public;
revoke execute on function public.player_records(text) from public;
revoke execute on function public.player_change_password(text, text, text) from public;
grant execute on function public.submit_score(text, int, int, int, int, text, text, text) to anon, authenticated;
grant execute on function public.player_login(text, text) to anon, authenticated;
grant execute on function public.player_logout(text) to anon, authenticated;
grant execute on function public.player_records(text) to anon, authenticated;
grant execute on function public.player_change_password(text, text, text) to anon, authenticated;

revoke execute on function public.admin_list_players() from public, anon;
revoke execute on function public.admin_set_password(bigint, text) from public, anon;
revoke execute on function public.admin_create_player(text, text) from public, anon;
revoke execute on function public.admin_rename_player(bigint, text) from public, anon;
revoke execute on function public.admin_unlock(bigint) from public, anon;
revoke execute on function public.admin_delete_player(bigint) from public, anon;
revoke execute on function public.admin_delete_score(bigint) from public, anon;
grant execute on function public.admin_list_players() to authenticated;
grant execute on function public.admin_set_password(bigint, text) to authenticated;
grant execute on function public.admin_create_player(text, text) to authenticated;
grant execute on function public.admin_rename_player(bigint, text) to authenticated;
grant execute on function public.admin_unlock(bigint) to authenticated;
grant execute on function public.admin_delete_player(bigint) to authenticated;
grant execute on function public.admin_delete_score(bigint) to authenticated;

-- ───────────── 2단계 (새 화면 배포 직후 실행: 직접 쓰기 차단) ─────────────
-- 1단계 이후 옛 화면으로 들어온 기록도 계정으로 옮기고 정리한 뒤 직접 insert를 막는다.
--
-- insert into public.players (name, name_key)
-- select distinct on (public.pq_norm_name(name)) public.pq_clean_name(name), public.pq_norm_name(name)
-- from public.scores where player_id is null order by public.pq_norm_name(name), created_at
-- on conflict (name_key) do nothing;
-- update public.scores s set player_id = p.id from public.players p
--  where s.player_id is null and p.name_key = public.pq_norm_name(s.name);
-- delete from public.scores s using (select id, row_number() over (partition by player_id, mode
--   order by score desc, accuracy desc, case when public.pq_time_desc(mode) then -time_ms else time_ms end asc,
--   created_at asc) as rn from public.scores) d where s.id = d.id and d.rn > 1;
-- drop policy if exists "scores_insert_all" on public.scores;
-- revoke insert, update, delete, truncate on public.scores from anon, authenticated;
-- alter table public.scores alter column player_id set not null;

-- ───────────── 관리자 등록 (관리자 본인이 실행) ─────────────
-- 1) Supabase 대시보드 → Authentication → Users → Add user (이메일·비밀번호, Auto Confirm)
-- 2) SQL Editor에서:  insert into public.admins (user_id)
--                     select id from auth.users where email = '관리자 이메일';
-- (권장) Authentication → Sign In / Providers → Email → 'Allow new users to sign up' 끄기
