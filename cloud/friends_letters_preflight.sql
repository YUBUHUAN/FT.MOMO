-- FRIEND POST OFFICE 1.8.0 — READ-ONLY PREFLIGHT
--
-- Run this file in a Supabase SQL Editor BEFORE friends_letters.sql.
-- This file contains SELECT statements only.
-- It does not create, alter, drop, grant, revoke, insert, update or delete
-- any database object or row.
--
-- Expected: every query returns metadata only. No "Success. No rows returned"
-- from a mutating statement should appear.

-- 1. Does the target table already exist?
select
  '1. friend_letters table' as check_name,
  to_regclass('public.friend_letters') is not null as object_exists,
  coalesce(to_regclass('public.friend_letters')::text, '(absent)') as object_name;

-- 2. Existing friend_letters columns, if the table already exists.
select
  '2. existing friend_letters columns' as check_name,
  a.attname as column_name,
  format_type(a.atttypid, a.atttypmod) as data_type,
  a.attnotnull as not_null,
  pg_get_expr(d.adbin, d.adrelid) as column_default
from pg_attribute a
left join pg_attrdef d
  on d.adrelid = a.attrelid and d.adnum = a.attnum
where a.attrelid = to_regclass('public.friend_letters')
  and a.attnum > 0
  and not a.attisdropped
order by a.attnum;

-- 3. Existing friend_letters indexes.
select
  '3. existing friend_letters indexes' as check_name,
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'friend_letters'
order by indexname;

-- 4. Existing friend_letters constraints.
select
  '4. existing friend_letters constraints' as check_name,
  conname,
  contype,
  pg_get_constraintdef(c.oid) as definition
from pg_constraint c
where c.conrelid = to_regclass('public.friend_letters')
order by conname;

-- 5. Colliding index names anywhere in public.
select
  '5. index name collisions' as check_name,
  c.relname as index_name,
  n.nspname as schema_name,
  t.relname as table_name
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_index i on i.indexrelid = c.oid
left join pg_class t on t.oid = i.indrelid
where n.nspname = 'public'
  and c.relkind = 'i'
  and c.relname in (
    'friend_letters_client_token_uidx',
    'friend_letters_recipient_idx',
    'friend_letters_sender_idx',
    'friend_letters_link_idx',
    'friend_letters_reply_idx'
  )
order by c.relname;

-- 6. Existing friend_letter_* functions and signatures.
select
  '6. friend_letter_* functions' as check_name,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as identity_arguments,
  pg_get_function_result(p.oid) as result_type,
  p.prosecdef as security_definer,
  p.proconfig as function_settings,
  p.proacl as function_acl
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname like 'friend_letter%'
order by p.proname, pg_get_function_identity_arguments(p.oid);

-- 7. Existing friend_identity and friend_active_link_v2 signatures.
select
  '7. friend identity/link dependencies' as check_name,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as identity_arguments,
  pg_get_function_result(p.oid) as result_type,
  p.prosecdef as security_definer,
  p.proconfig as function_settings
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('friend_identity', 'friend_active_link_v2')
order by p.proname;

-- 7b. Existing friend_events and friend_event_ack signatures.
select
  '7b. friend event function signatures' as check_name,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as identity_arguments,
  pg_get_function_result(p.oid) as result_type,
  p.prosecdef as security_definer,
  p.proconfig as function_settings
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('friend_events', 'friend_event_ack')
order by p.proname;

-- 8. Actual friend_events columns.
select
  '8. friend_events columns' as check_name,
  column_name,
  data_type,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'friend_events'
order by ordinal_position;

-- 9. Actual friend_events constraints and indexes.
select
  '9. friend_events constraints' as check_name,
  conname,
  contype,
  pg_get_constraintdef(c.oid) as definition
from pg_constraint c
where c.conrelid = to_regclass('public.friend_events')
order by conname;

select
  '9. friend_events indexes' as check_name,
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'friend_events'
order by indexname;

-- 10. Existing friend_links columns needed for link_id and lifecycle.
select
  '10. friend_links columns' as check_name,
  column_name,
  data_type,
  is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'friend_links'
order by ordinal_position;

-- 11. friend_letters table ACL, if it exists.
select
  '11. friend_letters table ACL' as check_name,
  c.relname as table_name,
  c.relacl as acl
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = 'friend_letters'
  and c.relkind = 'r';

-- 12. Verify no policies are needed by showing existing RLS policies for the
-- related friend tables. This is information only.
select
  '12. related RLS policies' as check_name,
  schemaname,
  tablename,
  policyname,
  cmd,
  roles,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename in (
    'friend_letters', 'friend_events', 'friend_links',
    'friend_requests', 'friend_activities', 'friend_activity_logs'
  )
order by tablename, policyname;

-- 13. Verify the expected signature of friend_letter_list: five arguments.
select
  '13. friend_letter_list signature' as check_name,
  p.proname,
  pg_get_function_identity_arguments(p.oid) as identity_arguments,
  pg_get_function_result(p.oid) as result_type,
  p.prosecdef as security_definer,
  p.proconfig as function_settings
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'friend_letter_list'
order by pg_get_function_identity_arguments(p.oid);

-- 14. Optional: list related table names that could collide.
select
  '14. related object collisions' as check_name,
  c.relname,
  c.relkind
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
    'friend_letters',
    'friend_letter_send',
    'friend_letter_list',
    'friend_letter_get',
    'friend_letter_read',
    'friend_letter_react',
    'friend_letter_unread'
  )
order by c.relname, c.relkind;
