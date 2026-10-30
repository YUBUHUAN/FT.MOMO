-- MOMO x WOWO FRIENDS: LINK LIFECYCLE PREFLIGHT v1.8.0
--
-- READ-ONLY. This file contains SELECT statements only.
-- Run it in the Momo Supabase SQL Editor AFTER friends_letters.sql and BEFORE
-- friend_link_lifecycles.sql.
--
-- It does not create, alter, drop, grant, revoke, insert, update or delete
-- any database object or row.
--
-- Preconditions:
--   * public.friend_links exists
--   * public.friend_requests exists
--   * public.friend_identity(text) exists
--   * public.friend_letters exists
--
-- If friend_letters is absent, run friends_letters.sql first.

-- 1. Core table existence and columns.
select
  '1. core tables' as check_name,
  to_regclass('public.friend_links') is not null as friend_links_exists,
  to_regclass('public.friend_requests') is not null as friend_requests_exists,
  to_regclass('public.friend_letters') is not null as friend_letters_exists,
  to_regprocedure('public.friend_identity(text)') is not null as friend_identity_exists;

select
  '1b. friend_links columns' as check_name,
  column_name,
  data_type,
  is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'friend_links'
order by ordinal_position;

-- 2. Original account-pair unique constraint.
select
  '2. legacy pair unique constraint' as check_name,
  c.conname,
  pg_get_constraintdef(c.oid) as definition
from pg_constraint c
where c.conrelid = to_regclass('public.friend_links')
  and c.conname = 'friend_links_momo_account_id_wowo_account_id_key';

-- 3. Active partial unique indexes.
select
  '3. active partial unique indexes' as check_name,
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'friend_links'
  and indexname in (
    'friend_links_momo_active_uidx',
    'friend_links_wowo_active_uidx'
  )
order by indexname;

-- 4. Current lifecycle functions.
select
  '4. lifecycle functions' as check_name,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as identity_arguments,
  pg_get_function_result(p.oid) as result_type,
  p.prosecdef as security_definer,
  p.proconfig as function_settings,
  p.proacl as function_acl,
  (p.prosrc like '%friend_link_lock_accounts%') as uses_lock_helper,
  (p.prosrc like '%relationship_changed%') as has_relationship_changed,
  (p.prosrc like '%for update%') as has_for_update,
  (p.prosrc like '%row_count%') as has_row_count
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'friend_request',
    'friend_unbind',
    'friend_link_lock_accounts'
  )
order by p.proname, pg_get_function_identity_arguments(p.oid);

-- 5. Duplicate account-pair rows (expected 0 before first lifecycle migration;
-- after migration, historical pairs may have multiple rows).
select
  '5. duplicate account pairs' as check_name,
  count(*) as duplicate_pair_groups,
  coalesce(sum(duplicate_count - 1), 0) as extra_rows
from (
  select momo_account_id, wowo_account_id, count(*) as duplicate_count
  from public.friend_links
  group by momo_account_id, wowo_account_id
  having count(*) > 1
) d;

-- 6. More than one active link per Momo/Wowo account.
select
  '6. duplicate active links' as check_name,
  (
    select count(*)
    from (
      select momo_account_id
      from public.friend_links
      where status = 'active'
      group by momo_account_id
      having count(*) > 1
    ) m
  ) as duplicate_active_momo,
  (
    select count(*)
    from (
      select wowo_account_id
      from public.friend_links
      where status = 'active'
      group by wowo_account_id
      having count(*) > 1
    ) w
  ) as duplicate_active_wowo;

-- 7. Link and letter counts. The letter table is optional at this stage; use
-- dynamic, read-only queries so an absent table returns 0 instead of failing.
with letter_counts as (
  select
    case
      when to_regclass('public.friend_letters') is null then
        jsonb_build_object(
          'total', 0,
          'null_link', 0,
          'orphan_link', 0
        )
      else
        (xpath(
          '/row/data/text()',
          query_to_xml(
            'select jsonb_build_object(
               ''total'', (select count(*) from public.friend_letters),
               ''null_link'', (select count(*) from public.friend_letters where link_id is null),
               ''orphan_link'', (
                 select count(*)
                 from public.friend_letters l
                 left join public.friend_links fl on fl.id = l.link_id
                 where l.link_id is not null and fl.id is null
               )
             )::text as data',
            false, true, ''
          )
        ))[1]::text::jsonb
    end as data
)
select
  '7. link and letter counts' as check_name,
  (select count(*) from public.friend_links) as friend_links_total,
  (select count(*) from public.friend_links where status = 'active') as friend_links_active,
  (select count(*) from public.friend_links where status = 'unbound') as friend_links_unbound,
  coalesce((data->>'total')::bigint, 0) as friend_letters_total,
  coalesce((data->>'null_link')::bigint, 0) as friend_letters_null_link,
  coalesce((data->>'orphan_link')::bigint, 0) as friend_letters_orphan_link
from letter_counts;

-- 8. Letters by link status. Dynamic SQL keeps this read-only check safe when
-- friend_letters has not been created yet.
with status_data as (
  select
    case
      when to_regclass('public.friend_letters') is null then '[]'::jsonb
      else
        (xpath(
          '/row/data/text()',
          query_to_xml(
            'select coalesce(
               jsonb_agg(
                 jsonb_build_object(
                   ''link_status'', link_status,
                   ''letter_count'', letter_count
                 )
                 order by link_status
               ),
               ''[]''::jsonb
             )::text as data
             from (
               select coalesce(fl.status, ''deleted'') as link_status,
                      count(*) as letter_count
               from public.friend_letters l
               left join public.friend_links fl on fl.id = l.link_id
               group by coalesce(fl.status, ''deleted'')
             ) s',
            false, true, ''
          )
        ))[1]::text::jsonb
    end as data
)
select
  '8. letters by link status' as check_name,
  case
    when to_regclass('public.friend_letters') is null then 'table absent'
    else jsonb_array_length(data)::text || ' status groups'
  end as result,
  data as details
from status_data;

-- 9. Pending-request uniqueness precondition.
select
  '9. pending request uniqueness' as check_name,
  (
    select count(*)
    from (
      select from_app, from_account_id, to_app, to_account_id
      from public.friend_requests
      where status = 'pending'
      group by from_app, from_account_id, to_app, to_account_id
      having count(*) > 1
    ) p
  ) as duplicate_pending_groups;

select
  '9b. pending request index' as check_name,
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'friend_requests'
  and indexname = 'friend_requests_pair_pending_uidx';

-- 10. RLS and table privileges for link/letter tables.
select
  '10. table security' as check_name,
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  c.relacl as table_acl,
  coalesce(has_table_privilege('anon', c.oid, 'SELECT'), false) as anon_can_select,
  coalesce(has_table_privilege('authenticated', c.oid, 'SELECT'), false) as authenticated_can_select
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('friend_links', 'friend_letters', 'friend_requests')
  and c.relkind = 'r'
order by c.relname;

select
  '10b. related RLS policies' as check_name,
  schemaname,
  tablename,
  policyname,
  cmd,
  roles
from pg_policies
where schemaname = 'public'
  and tablename in ('friend_links', 'friend_letters')
order by tablename, policyname;

-- 11. Existing function/table dependency inventory.
select
  '11. link/letter dependencies' as check_name,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as identity_arguments,
  p.prosecdef as security_definer,
  p.proconfig as function_settings
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'friend_active_link_v2',
    'friend_status',
    'friend_letter_send',
    'friend_letter_list',
    'friend_letter_get',
    'friend_letter_read',
    'friend_letter_react',
    'friend_letter_unread'
  )
order by p.proname, pg_get_function_identity_arguments(p.oid);

-- 12. Summary. READY only when the core prerequisites are present and the
-- active/pending uniqueness checks have no conflicts.
select
  'SUMMARY' as check_name,
  case
    when to_regclass('public.friend_links') is null then 'STOP'
    when to_regclass('public.friend_requests') is null then 'STOP'
    when to_regclass('public.friend_letters') is null then 'STOP'
    when to_regprocedure('public.friend_identity(text)') is null then 'STOP'
    when to_regprocedure('public.friend_request(text,text)') is null then 'STOP'
    when to_regprocedure('public.friend_unbind(text)') is null then 'STOP'
    when not exists (
      select 1
      from pg_indexes
      where schemaname = 'public'
        and tablename = 'friend_links'
        and indexname = 'friend_links_momo_active_uidx'
    ) then 'STOP'
    when not exists (
      select 1
      from pg_indexes
      where schemaname = 'public'
        and tablename = 'friend_links'
        and indexname = 'friend_links_wowo_active_uidx'
    ) then 'STOP'
    when (
      select count(*)
      from (
        select momo_account_id
        from public.friend_links
        where status = 'active'
        group by momo_account_id
        having count(*) > 1
      ) m
    ) > 0 then 'STOP'
    when (
      select count(*)
      from (
        select wowo_account_id
        from public.friend_links
        where status = 'active'
        group by wowo_account_id
        having count(*) > 1
      ) w
    ) > 0 then 'STOP'
    when (
      select count(*)
      from (
        select from_app, from_account_id, to_app, to_account_id
        from public.friend_requests
        where status = 'pending'
        group by from_app, from_account_id, to_app, to_account_id
        having count(*) > 1
      ) p
    ) > 0 then 'STOP'
    when not exists (
      select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = 'friend_links'
        and c.relrowsecurity
    ) then 'STOP'
    when not exists (
      select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = 'friend_letters'
        and c.relrowsecurity
    ) then 'STOP'
    when not exists (
      select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = 'friend_requests'
        and c.relrowsecurity
    ) then 'STOP'
    when coalesce(has_table_privilege('anon', 'public.friend_links', 'SELECT'), true) then 'STOP'
    when coalesce(has_table_privilege('authenticated', 'public.friend_links', 'SELECT'), true) then 'STOP'
    when (
      case
        when to_regclass('public.friend_letters') is null then false
        else coalesce(has_table_privilege('anon', 'public.friend_letters', 'SELECT'), true)
      end
    ) then 'STOP'
    when (
      case
        when to_regclass('public.friend_letters') is null then false
        else coalesce(has_table_privilege('authenticated', 'public.friend_letters', 'SELECT'), true)
      end
    ) then 'STOP'
    when coalesce(has_table_privilege('anon', 'public.friend_requests', 'SELECT'), true) then 'STOP'
    when coalesce(has_table_privilege('authenticated', 'public.friend_requests', 'SELECT'), true) then 'STOP'
    else 'READY'
  end as status;
