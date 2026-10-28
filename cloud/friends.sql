-- Momo x Wowo friends (shared Supabase project).
-- Run once in the Momo Supabase SQL editor, after wowo_accounts /
-- wowo_sessions / wowo_states exist (cloud/schema.sql from the Wowo repo).
begin;

create extension if not exists pgcrypto;

alter table public.momo_accounts add column if not exists friend_code text;
alter table public.wowo_accounts add column if not exists friend_code text;

create unique index if not exists momo_friend_code_uidx
  on public.momo_accounts (friend_code) where friend_code is not null;
create unique index if not exists wowo_friend_code_uidx
  on public.wowo_accounts (friend_code) where friend_code is not null;

create table if not exists public.friend_requests (
  id uuid primary key default gen_random_uuid(),
  from_app text not null check (from_app in ('momo', 'wowo')),
  from_account_id uuid not null,
  to_app text not null check (to_app in ('momo', 'wowo')),
  to_account_id uuid not null,
  status text not null default 'pending'
    check (status in ('pending', 'matched', 'cancelled', 'expired')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days')
);
create unique index if not exists friend_requests_pair_pending_uidx
  on public.friend_requests (from_app, from_account_id, to_app, to_account_id)
  where status = 'pending';
create index if not exists friend_requests_to_idx
  on public.friend_requests (to_app, to_account_id, status, expires_at);

create table if not exists public.friend_links (
  id uuid primary key default gen_random_uuid(),
  momo_account_id uuid not null references public.momo_accounts(id) on delete cascade,
  wowo_account_id uuid not null references public.wowo_accounts(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'unbound')),
  created_at timestamptz not null default now(),
  unbound_at timestamptz,
  unique (momo_account_id, wowo_account_id)
);
create unique index if not exists friend_links_momo_active_uidx
  on public.friend_links (momo_account_id) where status = 'active';
create unique index if not exists friend_links_wowo_active_uidx
  on public.friend_links (wowo_account_id) where status = 'active';

alter table public.friend_requests enable row level security;
alter table public.friend_links enable row level security;
revoke all on table public.friend_requests from anon, authenticated;
revoke all on table public.friend_links from anon, authenticated;

create or replace function public.friend_identity(p_token text)
returns table (app text, account_id uuid, username text, friend_code text)
language sql
security definer
set search_path = public
as $$
  select 'momo'::text, s.account_id, a.username, a.friend_code
  from public.momo_sessions s
  join public.momo_accounts a on a.id = s.account_id
  where s.token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex')
    and s.expires_at > now()
  union all
  select 'wowo'::text, s.account_id, a.username, a.friend_code
  from public.wowo_sessions s
  join public.wowo_accounts a on a.id = s.account_id
  where s.token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex')
    and s.expires_at > now()
  limit 1;
$$;

create or replace function public.friend_new_code(p_prefix text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  loop
    v_code := p_prefix || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
    exit when not exists (select 1 from public.momo_accounts where friend_code = v_code)
              and not exists (select 1 from public.wowo_accounts where friend_code = v_code);
  end loop;
  return v_code;
end;
$$;

create or replace function public.friend_code_for(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me record;
  v_code text;
begin
  select * into v_me from public.friend_identity(p_token);
  if not found then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;
  if v_me.friend_code is null then
    if v_me.app = 'momo' then
      v_code := public.friend_new_code('M');
      update public.momo_accounts set friend_code = v_code where id = v_me.account_id;
    else
      v_code := public.friend_new_code('W');
      update public.wowo_accounts set friend_code = v_code where id = v_me.account_id;
    end if;
  else
    v_code := v_me.friend_code;
  end if;
  return jsonb_build_object('ok', true, 'app', v_me.app, 'code', v_code);
end;
$$;

create or replace function public.friend_pending(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me record;
  v_count integer;
begin
  select * into v_me from public.friend_identity(p_token);
  if not found then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;
  select count(*) into v_count
  from public.friend_requests
  where to_app = v_me.app and to_account_id = v_me.account_id
    and status = 'pending' and expires_at > now();
  return jsonb_build_object('ok', true, 'count', v_count);
end;
$$;

create or replace function public.friend_request(p_token text, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me record;
  v_target record;
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_req uuid;
  v_momo uuid;
  v_wowo uuid;
begin
  select * into v_me from public.friend_identity(p_token);
  if not found then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;
  if v_code = '' then
    return jsonb_build_object('ok', false, 'error', 'bad_code');
  end if;

  if v_code like 'M-%' then
    select 'momo'::text as app, id as account_id, username, friend_code
      into v_target from public.momo_accounts where friend_code = v_code;
  elsif v_code like 'W-%' then
    select 'wowo'::text as app, id as account_id, username, friend_code
      into v_target from public.wowo_accounts where friend_code = v_code;
  else
    return jsonb_build_object('ok', false, 'error', 'bad_code');
  end if;

  if v_target.account_id is null then
    return jsonb_build_object('ok', false, 'error', 'bad_code');
  end if;
  if v_target.app = v_me.app then
    return jsonb_build_object('ok', false, 'error', 'same_app');
  end if;
  if v_target.account_id = v_me.account_id then
    return jsonb_build_object('ok', false, 'error', 'self');
  end if;

  if exists (
    select 1 from public.friend_links
    where status = 'active'
      and (momo_account_id = v_me.account_id or wowo_account_id = v_me.account_id)
  ) then
    return jsonb_build_object('ok', false, 'error', 'already_linked');
  end if;
  if exists (
    select 1 from public.friend_links
    where status = 'active'
      and (momo_account_id = v_target.account_id or wowo_account_id = v_target.account_id)
  ) then
    return jsonb_build_object('ok', false, 'error', 'target_linked');
  end if;

  select id into v_req from public.friend_requests
  where from_app = v_target.app and from_account_id = v_target.account_id
    and to_app = v_me.app and to_account_id = v_me.account_id
    and status = 'pending' and expires_at > now()
  limit 1;

  if v_req is not null then
    if v_me.app = 'momo' then
      v_momo := v_me.account_id; v_wowo := v_target.account_id;
    else
      v_momo := v_target.account_id; v_wowo := v_me.account_id;
    end if;
    insert into public.friend_links (momo_account_id, wowo_account_id, status)
    values (v_momo, v_wowo, 'active')
    on conflict (momo_account_id, wowo_account_id)
    do update set status = 'active', unbound_at = null, created_at = now();
    update public.friend_requests
      set status = 'matched'
      where status = 'pending'
        and ((from_app = v_me.app and from_account_id = v_me.account_id
              and to_app = v_target.app and to_account_id = v_target.account_id)
          or (from_app = v_target.app and from_account_id = v_target.account_id
              and to_app = v_me.app and to_account_id = v_me.account_id));
    return jsonb_build_object('ok', true, 'status', 'matched');
  end if;

  insert into public.friend_requests (from_app, from_account_id, to_app, to_account_id)
  values (v_me.app, v_me.account_id, v_target.app, v_target.account_id)
  on conflict (from_app, from_account_id, to_app, to_account_id)
    where status = 'pending' do nothing;
  return jsonb_build_object('ok', true, 'status', 'pending');
end;
$$;

create or replace function public.friend_status(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me record;
  v_link record;
  v_app text;
  v_id uuid;
  v_name text;
  v_state jsonb;
  v_mood double precision;
  v_status text := 'home';
  v_pending integer;
begin
  select * into v_me from public.friend_identity(p_token);
  if not found then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;
  select count(*) into v_pending
  from public.friend_requests
  where to_app = v_me.app and to_account_id = v_me.account_id
    and status = 'pending' and expires_at > now();

  select * into v_link from public.friend_links
  where status = 'active'
    and (momo_account_id = v_me.account_id or wowo_account_id = v_me.account_id)
  limit 1;

  if not found then
    return jsonb_build_object('ok', true, 'linked', null, 'pending', v_pending);
  end if;

  if v_me.app = 'momo' then
    v_app := 'wowo'; v_id := v_link.wowo_account_id;
  else
    v_app := 'momo'; v_id := v_link.momo_account_id;
  end if;

  if v_app = 'momo' then
    select username into v_name from public.momo_accounts where id = v_id;
    select state into v_state from public.momo_states where account_id = v_id;
  else
    select username into v_name from public.wowo_accounts where id = v_id;
    select state into v_state from public.wowo_states where account_id = v_id;
  end if;

  if v_state is not null then
    v_mood := coalesce((v_state->>'mood')::double precision, 50);
    if coalesce((v_state->>'sleeping')::boolean, false) then
      v_status := 'sleeping';
    elsif jsonb_typeof(v_state->'outing') = 'object' then
      v_status := 'outing';
    elsif jsonb_typeof(v_state->'exercise') = 'object' then
      v_status := 'exercise';
    end if;
  else
    v_mood := 50;
  end if;

  return jsonb_build_object(
    'ok', true,
    'pending', v_pending,
    'linked', jsonb_build_object(
      'app', v_app,
      'name', v_name,
      'mood', v_mood,
      'status', v_status,
      'since', v_link.created_at
    )
  );
end;
$$;

create or replace function public.friend_unbind(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me record;
begin
  select * into v_me from public.friend_identity(p_token);
  if not found then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;
  update public.friend_links
    set status = 'unbound', unbound_at = now()
    where status = 'active'
      and (momo_account_id = v_me.account_id or wowo_account_id = v_me.account_id);
  update public.friend_requests set status = 'cancelled'
    where status = 'pending'
      and (from_account_id = v_me.account_id or to_account_id = v_me.account_id);
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.friend_identity(text) from public;
revoke all on function public.friend_new_code(text) from public;
grant execute on function public.friend_code_for(text) to anon, authenticated;
grant execute on function public.friend_pending(text) to anon, authenticated;
grant execute on function public.friend_request(text, text) to anon, authenticated;
grant execute on function public.friend_status(text) to anon, authenticated;
grant execute on function public.friend_unbind(text) to anon, authenticated;

commit;
