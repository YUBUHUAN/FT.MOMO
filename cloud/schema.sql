-- MomoPet cloud schema for Supabase.
-- Run this once in Supabase Dashboard -> SQL Editor.
-- The publishable key is used by clients; all table access goes through
-- SECURITY DEFINER RPC functions, so the tables are not exposed directly.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.momo_accounts (
  id uuid primary key default gen_random_uuid(),
  username text not null,
  username_key text not null unique,
  password_hash text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.momo_sessions (
  token_hash text primary key,
  account_id uuid not null references public.momo_accounts(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists momo_sessions_account_idx
  on public.momo_sessions(account_id);
create index if not exists momo_sessions_expiry_idx
  on public.momo_sessions(expires_at);

create table if not exists public.momo_states (
  account_id uuid primary key references public.momo_accounts(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  rev bigint not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.momo_accounts enable row level security;
alter table public.momo_sessions enable row level security;
alter table public.momo_states enable row level security;

revoke all on table public.momo_accounts from anon, authenticated;
revoke all on table public.momo_sessions from anon, authenticated;
revoke all on table public.momo_states from anon, authenticated;

-- Internal helpers. Not executable by clients.
create or replace function public.momo_create_session(p_account_id uuid)
returns text
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_token text;
begin
  delete from public.momo_sessions where expires_at <= now();
  v_token := encode(gen_random_bytes(32), 'hex');
  insert into public.momo_sessions(token_hash, account_id, expires_at)
    values (encode(digest(v_token, 'sha256'), 'hex'), p_account_id, now() + interval '30 days');
  return v_token;
end;
$$;

create or replace function public.momo_session_account(p_token text)
returns uuid
language sql
security definer
set search_path = public, extensions, pg_temp
as $$
  select account_id
  from public.momo_sessions
  where token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex')
    and expires_at > now()
  limit 1;
$$;

create or replace function public.momo_register(p_username text, p_password text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_name text;
  v_key text;
  v_id uuid;
  v_hash text;
  v_token text;
begin
  v_name := btrim(coalesce(p_username, ''));
  if char_length(v_name) < 2 or char_length(v_name) > 20 or v_name ~ '[[:cntrl:]<>]' then
    return jsonb_build_object('ok', false, 'error', 'bad_username');
  end if;
  if char_length(coalesce(p_password, '')) < 6 or char_length(coalesce(p_password, '')) > 72 then
    return jsonb_build_object('ok', false, 'error', 'bad_password');
  end if;

  v_key := lower(v_name);
  v_hash := crypt(p_password, gen_salt('bf', 10));

  begin
    insert into public.momo_accounts(username, username_key, password_hash)
      values (v_name, v_key, v_hash)
      returning id into v_id;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'username_taken');
  end;

  insert into public.momo_states(account_id, state, rev)
    values (v_id, '{}'::jsonb, 0)
    on conflict (account_id) do nothing;

  v_token := public.momo_create_session(v_id);
  return jsonb_build_object(
    'ok', true,
    'token', v_token,
    'account', jsonb_build_object('id', v_id, 'username', v_name),
    'state', '{}'::jsonb,
    'rev', 0
  );
end;
$$;

create or replace function public.momo_login(p_username text, p_password text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_id uuid;
  v_name text;
  v_hash text;
  v_token text;
  v_state jsonb;
  v_rev bigint;
begin
  select id, username, password_hash
    into v_id, v_name, v_hash
  from public.momo_accounts
  where username_key = lower(btrim(coalesce(p_username, '')))
  limit 1;

  if v_id is null or v_hash <> crypt(coalesce(p_password, ''), v_hash) then
    return jsonb_build_object('ok', false, 'error', 'wrong_credentials');
  end if;

  select state, rev into v_state, v_rev
  from public.momo_states where account_id = v_id;

  if not found then
    v_state := '{}'::jsonb;
    v_rev := 0;
    insert into public.momo_states(account_id, state, rev)
      values (v_id, v_state, v_rev)
      on conflict (account_id) do nothing;
  end if;

  v_token := public.momo_create_session(v_id);
  return jsonb_build_object(
    'ok', true,
    'token', v_token,
    'account', jsonb_build_object('id', v_id, 'username', v_name),
    'state', v_state,
    'rev', v_rev
  );
end;
$$;

create or replace function public.momo_me(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_id uuid;
  v_name text;
  v_created timestamptz;
begin
  v_id := public.momo_session_account(p_token);
  if v_id is null then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;
  select username, created_at into v_name, v_created
  from public.momo_accounts where id = v_id;
  return jsonb_build_object(
    'ok', true,
    'account', jsonb_build_object('id', v_id, 'username', v_name, 'createdAt', v_created)
  );
end;
$$;

create or replace function public.momo_logout(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  delete from public.momo_sessions
  where token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex');
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.momo_get_state(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_id uuid;
  v_state jsonb;
  v_rev bigint;
  v_updated timestamptz;
begin
  v_id := public.momo_session_account(p_token);
  if v_id is null then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;
  select state, rev, updated_at into v_state, v_rev, v_updated
  from public.momo_states where account_id = v_id;
  if not found then
    return jsonb_build_object('ok', true, 'state', null, 'rev', 0);
  end if;
  return jsonb_build_object(
    'ok', true,
    'state', v_state,
    'rev', v_rev,
    'updatedAt', v_updated
  );
end;
$$;

create or replace function public.momo_save_state(
  p_token text,
  p_state jsonb,
  p_base_rev bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_id uuid;
  v_state jsonb;
  v_rev bigint;
begin
  v_id := public.momo_session_account(p_token);
  if v_id is null then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;
  if p_state is null or jsonb_typeof(p_state) <> 'object' then
    return jsonb_build_object('ok', false, 'error', 'bad_state');
  end if;
  if octet_length(p_state::text) > 512000 then
    return jsonb_build_object('ok', false, 'error', 'state_too_large');
  end if;

  select state, rev into v_state, v_rev
  from public.momo_states where account_id = v_id for update;

  if not found then
    insert into public.momo_states(account_id, state, rev)
      values (v_id, p_state, 1)
      returning state, rev into v_state, v_rev;
    return jsonb_build_object('ok', true, 'state', v_state, 'rev', v_rev);
  end if;

  if p_base_rev is not null and p_base_rev <> v_rev then
    return jsonb_build_object(
      'ok', false, 'error', 'conflict',
      'state', v_state, 'rev', v_rev
    );
  end if;

  update public.momo_states
    set state = p_state, rev = v_rev + 1, updated_at = now()
  where account_id = v_id
  returning state, rev into v_state, v_rev;

  return jsonb_build_object('ok', true, 'state', v_state, 'rev', v_rev);
end;
$$;

revoke all on function public.momo_create_session(uuid) from public, anon, authenticated;
revoke all on function public.momo_session_account(text) from public, anon, authenticated;
revoke all on function public.momo_register(text, text) from public;
revoke all on function public.momo_login(text, text) from public;
revoke all on function public.momo_me(text) from public;
revoke all on function public.momo_logout(text) from public;
revoke all on function public.momo_get_state(text) from public;
revoke all on function public.momo_save_state(text, jsonb, bigint) from public;

grant execute on function public.momo_register(text, text) to anon, authenticated;
grant execute on function public.momo_login(text, text) to anon, authenticated;
grant execute on function public.momo_me(text) to anon, authenticated;
grant execute on function public.momo_logout(text) to anon, authenticated;
grant execute on function public.momo_get_state(text) to anon, authenticated;
grant execute on function public.momo_save_state(text, jsonb, bigint) to anon, authenticated;

notify pgrst, 'reload schema';
