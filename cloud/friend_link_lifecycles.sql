-- MOMO x WOWO FRIENDS: RELATIONSHIP LIFECYCLES v1.8.0
-- Run in the Momo Supabase project after:
--   1. friends_v3.sql / friends_actions_v6.sql
--   2. friends_letters.sql
--
-- friend_links represents relationship lifecycles, not a single row per
-- account pair. Re-binding the same pair must create a new link row so old
-- letters remain permanently bound to their original link.
--
-- This migration is data-preserving:
--   * no UPDATE of friend_letters
--   * no UPDATE of existing friend_links ids/status
--   * only constraint/function changes
--
-- This file is the formal counterpart of the verified local migration:
--   D:\momo-local-supabase\supabase\migrations\0009_friend_link_lifecycles.sql
--
-- Run friend_link_lifecycles_preflight.sql first.
-- Do not run against the formal project until a database backup exists.

begin;

set search_path = public, extensions, pg_temp;

-- ---------------------------------------------------------------------------
-- 1. Allow multiple historical links for the same account pair.
--
-- Keep the two partial unique active indexes:
--   friend_links_momo_active_uidx
--   friend_links_wowo_active_uidx
--
-- They still guarantee at most one active link per account.
-- ---------------------------------------------------------------------------

alter table public.friend_links
  drop constraint if exists friend_links_momo_account_id_wowo_account_id_key;

create unique index if not exists friend_links_momo_active_uidx
  on public.friend_links (momo_account_id)
  where status = 'active';

create unique index if not exists friend_links_wowo_active_uidx
  on public.friend_links (wowo_account_id)
  where status = 'active';

-- ---------------------------------------------------------------------------
-- 2. Shared account-pair advisory lock.
--
-- Both friend_request() and friend_unbind() use this exact helper.
-- Keys are sorted before locking so concurrent requests involving the same
-- accounts always acquire locks in the same order.
-- ---------------------------------------------------------------------------

create or replace function public.friend_link_lock_accounts(
  p_first_app text,
  p_first_id uuid,
  p_second_app text,
  p_second_id uuid
) returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_first text;
  v_second text;
  v_tmp text;
begin
  v_first := 'friend-link-account:' || p_first_app || ':' || p_first_id::text;
  v_second := 'friend-link-account:' || p_second_app || ':' || p_second_id::text;

  if v_first > v_second then
    v_tmp := v_first;
    v_first := v_second;
    v_second := v_tmp;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_first, 0));
  if v_second <> v_first then
    perform pg_advisory_xact_lock(hashtextextended(v_second, 0));
  end if;
end;
$$;

revoke all on function public.friend_link_lock_accounts(text, uuid, text, uuid) from public;
revoke all on function public.friend_link_lock_accounts(text, uuid, text, uuid) from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. friend_request(): create a new lifecycle row on re-bind.
--
-- The account-pair lock is acquired before the active/pending checks.
-- The checks are repeated after the lock. Other unique violations are
-- re-raised rather than being reported as "already_linked".
-- ---------------------------------------------------------------------------

create or replace function public.friend_request(
  p_token text,
  p_code text
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_me record;
  v_target record;
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_req uuid;
  v_momo uuid;
  v_wowo uuid;
  v_constraint text;
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
      into v_target
      from public.momo_accounts
      where friend_code = v_code;
  elsif v_code like 'W-%' then
    select 'wowo'::text as app, id as account_id, username, friend_code
      into v_target
      from public.wowo_accounts
      where friend_code = v_code;
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

  -- Lock both accounts in a globally consistent order before any active or
  -- pending state is read. This serializes:
  --   * duplicate A -> B requests
  --   * simultaneous A -> B and B -> A requests
  --   * A -> B and A -> C requests sharing account A
  perform public.friend_link_lock_accounts(
    v_me.app, v_me.account_id,
    v_target.app, v_target.account_id
  );

  -- Re-check after acquiring the lock.
  if exists (
    select 1
    from public.friend_links
    where status = 'active'
      and (momo_account_id = v_me.account_id or wowo_account_id = v_me.account_id)
  ) then
    return jsonb_build_object('ok', false, 'error', 'already_linked');
  end if;

  if exists (
    select 1
    from public.friend_links
    where status = 'active'
      and (momo_account_id = v_target.account_id or wowo_account_id = v_target.account_id)
  ) then
    return jsonb_build_object('ok', false, 'error', 'target_linked');
  end if;

  -- Opposite-direction pending request: matching both requests creates a new
  -- lifecycle row.
  select id into v_req
  from public.friend_requests
  where from_app = v_target.app
    and from_account_id = v_target.account_id
    and to_app = v_me.app
    and to_account_id = v_me.account_id
    and status = 'pending'
    and expires_at > now()
  limit 1;

  if v_req is not null then
    if v_me.app = 'momo' then
      v_momo := v_me.account_id;
      v_wowo := v_target.account_id;
    else
      v_momo := v_target.account_id;
      v_wowo := v_me.account_id;
    end if;

    begin
      -- No ON CONFLICT here: the same pair must get a new friend_links row.
      insert into public.friend_links (
        momo_account_id,
        wowo_account_id,
        status
      ) values (
        v_momo,
        v_wowo,
        'active'
      );
    exception
      when unique_violation then
        get stacked diagnostics v_constraint = constraint_name;

        -- Only the two active-link indexes are translated into a business
        -- conflict. Other unique violations (e.g. PK collision) are real
        -- database errors and must not be hidden as already_linked.
        if v_constraint = 'friend_links_momo_active_uidx' then
          if v_me.app = 'momo' then
            return jsonb_build_object('ok', false, 'error', 'already_linked');
          else
            return jsonb_build_object('ok', false, 'error', 'target_linked');
          end if;
        elsif v_constraint = 'friend_links_wowo_active_uidx' then
          if v_me.app = 'wowo' then
            return jsonb_build_object('ok', false, 'error', 'already_linked');
          else
            return jsonb_build_object('ok', false, 'error', 'target_linked');
          end if;
        end if;

        raise;
    end;

    update public.friend_requests
      set status = 'matched'
      where status = 'pending'
        and (
          (from_app = v_me.app and from_account_id = v_me.account_id
            and to_app = v_target.app and to_account_id = v_target.account_id)
          or
          (from_app = v_target.app and from_account_id = v_target.account_id
            and to_app = v_me.app and to_account_id = v_me.account_id)
        );

    return jsonb_build_object('ok', true, 'status', 'matched');
  end if;

  -- Same-direction duplicate requests are absorbed by the existing pending
  -- unique index. No link is created at this stage.
  insert into public.friend_requests (
    from_app,
    from_account_id,
    to_app,
    to_account_id
  ) values (
    v_me.app,
    v_me.account_id,
    v_target.app,
    v_target.account_id
  )
  on conflict (from_app, from_account_id, to_app, to_account_id)
    where status = 'pending'
    do nothing;

  return jsonb_build_object('ok', true, 'status', 'pending');
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. friend_unbind(): use the same account-pair lock and exact active row.
--
-- The lock is acquired for the active link's two accounts before the update.
-- Existing unbound links are not touched.
-- ---------------------------------------------------------------------------

create or replace function public.friend_unbind(
  p_token text
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_me record;
  v_candidate record;
  v_current record;
  v_updated integer;
begin
  select * into v_me from public.friend_identity(p_token);
  if not found then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;

  -- The pre-lock read is only used to discover which account pair must be
  -- locked. It is not authoritative and its id is never used for the update.
  select *
    into v_candidate
    from public.friend_links
    where status = 'active'
      and (
        momo_account_id = v_me.account_id
        or wowo_account_id = v_me.account_id
      )
    limit 1;

  if v_candidate.id is not null then
    perform public.friend_link_lock_accounts(
      'momo', v_candidate.momo_account_id,
      'wowo', v_candidate.wowo_account_id
    );
  else
    -- No pair is known yet. Locking the caller's account still prevents a
    -- concurrent friend_request() involving this account from creating a
    -- link while the no-active decision is made.
    perform public.friend_link_lock_accounts(
      v_me.app, v_me.account_id,
      v_me.app, v_me.account_id
    );
  end if;

  -- Authoritative read after the lock. FOR UPDATE protects against a direct
  -- row-level update bypassing the advisory lock.
  select *
    into v_current
    from public.friend_links
    where status = 'active'
      and (
        momo_account_id = v_me.account_id
        or wowo_account_id = v_me.account_id
      )
    limit 1
    for update;

  -- Nothing active at the authoritative check: unbind is already complete.
  if v_current.id is null then
    update public.friend_requests
      set status = 'cancelled'
      where status = 'pending'
        and (
          from_account_id = v_me.account_id
          or to_account_id = v_me.account_id
        );

    return jsonb_build_object('ok', true);
  end if;

  -- The account had no active link before locking, but one appeared while
  -- waiting. We only locked the caller's account; do not touch a pair whose
  -- other account is not covered by the lock.
  if v_candidate.id is null then
    return jsonb_build_object('ok', false, 'error', 'relationship_changed');
  end if;

  -- The pair changed while waiting (for example unbind/rebind with a
  -- different partner). Do not update a link outside the locked pair.
  if v_current.momo_account_id <> v_candidate.momo_account_id
     or v_current.wowo_account_id <> v_candidate.wowo_account_id then
    return jsonb_build_object('ok', false, 'error', 'relationship_changed');
  end if;

  update public.friend_links
    set status = 'unbound',
        unbound_at = now()
    where id = v_current.id
      and status = 'active';

  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    return jsonb_build_object('ok', false, 'error', 'relationship_changed');
  end if;

  update public.friend_requests
    set status = 'cancelled'
    where status = 'pending'
      and (
        from_account_id = v_me.account_id
        or to_account_id = v_me.account_id
      );

  return jsonb_build_object('ok', true);
end;
$$;

commit;
