-- MOMO x WOWO FRIENDS: POST OFFICE PREFLIGHT REPORT v1.8.0
--
-- READ-ONLY. Every statement in this file is a SELECT.
-- Run in Supabase SQL Editor before friends_letters.sql.
--
-- This file returns exactly one result set with four columns:
--   check_name text
--   result     text
--   details    jsonb
--   status     PASS | WARN | STOP
--
-- The final row is SUMMARY with result READY or STOP.
--
-- Expected before first deployment:
--   * friend_letters is absent;
--   * friend_letter_* functions are absent;
--   * friend_identity, friend_active_link_v2, friend_events,
--     friend_event_ack are present;
--   * friend_links / friend_events have the expected columns.

with expected_letters(column_name, data_type) as (
  values
    ('id', 'uuid'),
    ('link_id', 'uuid'),
    ('sender_app', 'text'),
    ('sender_account_id', 'uuid'),
    ('sender_name', 'text'),
    ('recipient_app', 'text'),
    ('recipient_account_id', 'uuid'),
    ('recipient_name', 'text'),
    ('style', 'text'),
    ('body', 'text'),
    ('paper_style', 'text'),
    ('envelope_style', 'text'),
    ('sticker', 'text'),
    ('reply_to_id', 'uuid'),
    ('read_at', 'timestamp with time zone'),
    ('hearted_at', 'timestamp with time zone'),
    ('favorited_at', 'timestamp with time zone'),
    ('client_token', 'uuid'),
    ('created_at', 'timestamp with time zone')
),
expected_events(column_name, data_type) as (
  values
    ('id', 'uuid'),
    ('link_id', 'uuid'),
    ('target_app', 'text'),
    ('target_account_id', 'uuid'),
    ('type', 'text'),
    ('payload', 'jsonb'),
    ('created_at', 'timestamp with time zone'),
    ('read_at', 'timestamp with time zone')
),
expected_links(column_name, data_type) as (
  values
    ('id', 'uuid'),
    ('momo_account_id', 'uuid'),
    ('wowo_account_id', 'uuid'),
    ('status', 'text'),
    ('created_at', 'timestamp with time zone'),
    ('unbound_at', 'timestamp with time zone')
),
letters_missing as (
  select count(*) as n
  from expected_letters e
  where not exists (
    select 1
    from pg_attribute a
    where a.attrelid = to_regclass('public.friend_letters')
      and a.attnum > 0
      and not a.attisdropped
      and a.attname = e.column_name
      and format_type(a.atttypid, a.atttypmod) = e.data_type
  )
),
events_missing as (
  select count(*) as n
  from expected_events e
  where not exists (
    select 1
    from pg_attribute a
    where a.attrelid = to_regclass('public.friend_events')
      and a.attnum > 0
      and not a.attisdropped
      and a.attname = e.column_name
      and format_type(a.atttypid, a.atttypmod) = e.data_type
  )
),
links_missing as (
  select count(*) as n
  from expected_links e
  where not exists (
    select 1
    from pg_attribute a
    where a.attrelid = to_regclass('public.friend_links')
      and a.attnum > 0
      and not a.attisdropped
      and a.attname = e.column_name
      and format_type(a.atttypid, a.atttypmod) = e.data_type
  )
),
index_collisions as (
  select
    c.relname as index_name,
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
),
checks as (
  -- 1. Target table.
  select
    '1. friend_letters table' as check_name,
    case when to_regclass('public.friend_letters') is null then 'absent' else 'present' end as result,
    jsonb_build_object(
      'object_name', coalesce(to_regclass('public.friend_letters')::text, '(absent)')
    ) as details,
    case when to_regclass('public.friend_letters') is null then 'PASS' else 'WARN' end as status

  union all

  -- 2. Target table columns.
  select
    '2. friend_letters columns',
    case when to_regclass('public.friend_letters') is null
      then 'table absent'
      else (select n from letters_missing)::text || ' required columns missing'
    end,
    (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'column', a.attname,
            'type', format_type(a.atttypid, a.atttypmod),
            'not_null', a.attnotnull
          )
          order by a.attnum
        ),
        '[]'::jsonb
      )
      from pg_attribute a
      where a.attrelid = to_regclass('public.friend_letters')
        and a.attnum > 0
        and not a.attisdropped
    ),
    case
      when to_regclass('public.friend_letters') is null then 'PASS'
      when (select n from letters_missing) > 0 then 'STOP'
      when (
        select count(*)
        from pg_attribute a
        where a.attrelid = to_regclass('public.friend_letters')
          and a.attnum > 0
          and not a.attisdropped
          and a.attname not in (select column_name from expected_letters)
      ) > 0 then 'WARN'
      else 'PASS'
    end

  union all

  -- 3. Target table indexes.
  select
    '3. friend_letters indexes',
    case when to_regclass('public.friend_letters') is null
      then 'table absent'
      else (select count(*)::text from pg_indexes where schemaname = 'public' and tablename = 'friend_letters') || ' indexes'
    end,
    (
      select coalesce(
        jsonb_agg(jsonb_build_object('index', indexname, 'definition', indexdef) order by indexname),
        '[]'::jsonb
      )
      from pg_indexes
      where schemaname = 'public'
        and tablename = 'friend_letters'
    ),
    case
      when to_regclass('public.friend_letters') is null then 'PASS'
      when exists (
        select 1 from index_collisions
        where coalesce(table_name, '') <> 'friend_letters'
      ) then 'STOP'
      else 'PASS'
    end

  union all

  -- 4. Target table constraints.
  select
    '4. friend_letters constraints',
    case when to_regclass('public.friend_letters') is null
      then 'table absent'
      else (select count(*)::text from pg_constraint where conrelid = to_regclass('public.friend_letters')) || ' constraints'
    end,
    (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'constraint', conname,
            'type', contype,
            'definition', pg_get_constraintdef(oid)
          )
          order by conname
        ),
        '[]'::jsonb
      )
      from pg_constraint
      where conrelid = to_regclass('public.friend_letters')
    ),
    case when to_regclass('public.friend_letters') is null then 'PASS' else 'WARN' end

  union all

  -- 5. Index name collisions outside the target table.
  select
    '5. index name collisions',
    (select count(*)::text from index_collisions) || ' matching index names',
    (
      select coalesce(
        jsonb_agg(
          jsonb_build_object('index', index_name, 'table', coalesce(table_name, '(none)'))
          order by index_name
        ),
        '[]'::jsonb
      )
      from index_collisions
    ),
    case
      when exists (
        select 1 from index_collisions
        where coalesce(table_name, '') <> 'friend_letters'
      ) then 'STOP'
      else 'PASS'
    end

  union all

  -- 6. Letter RPCs already present.
  select
    '6. friend_letter_* functions',
    (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname like 'friend_letter%') || ' existing functions',
    (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'function', p.proname,
            'arguments', pg_get_function_identity_arguments(p.oid),
            'result', pg_get_function_result(p.oid)
          )
          order by p.proname, pg_get_function_identity_arguments(p.oid)
        ),
        '[]'::jsonb
      )
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname like 'friend_letter%'
    ),
    case
      when exists (
        select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname like 'friend_letter%'
      ) then 'WARN'
      else 'PASS'
    end

  union all

  -- 7. Identity and active-link dependencies.
  select
    '7. identity/active-link dependencies',
    (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('friend_identity', 'friend_active_link_v2')) || ' of 2 present',
    (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'function', p.proname,
            'arguments', pg_get_function_identity_arguments(p.oid),
            'result', pg_get_function_result(p.oid),
            'security_definer', p.prosecdef,
            'settings', p.proconfig
          )
          order by p.proname
        ),
        '[]'::jsonb
      )
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('friend_identity', 'friend_active_link_v2')
    ),
    case
      when (
        select count(*)
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('friend_identity', 'friend_active_link_v2')
      ) = 2 then 'PASS'
      else 'STOP'
    end

  union all

  -- 7b. Event function dependencies.
  select
    '7b. event function dependencies',
    (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('friend_events', 'friend_event_ack')) || ' of 2 present',
    (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'function', p.proname,
            'arguments', pg_get_function_identity_arguments(p.oid),
            'result', pg_get_function_result(p.oid)
          )
          order by p.proname
        ),
        '[]'::jsonb
      )
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('friend_events', 'friend_event_ack')
    ),
    case
      when (
        select count(*)
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('friend_events', 'friend_event_ack')
      ) = 2 then 'PASS'
      else 'STOP'
    end

  union all

  -- 8. friend_events columns.
  select
    '8. friend_events columns',
    case when to_regclass('public.friend_events') is null
      then 'table absent'
      else (select n from events_missing)::text || ' required columns missing'
    end,
    (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'column', a.attname,
            'type', format_type(a.atttypid, a.atttypmod),
            'not_null', a.attnotnull
          )
          order by a.attnum
        ),
        '[]'::jsonb
      )
      from pg_attribute a
      where a.attrelid = to_regclass('public.friend_events')
        and a.attnum > 0
        and not a.attisdropped
    ),
    case
      when to_regclass('public.friend_events') is null then 'STOP'
      when (select n from events_missing) > 0 then 'STOP'
      else 'PASS'
    end

  union all

  -- 9. friend_events constraints and indexes.
  select
    '9. friend_events constraints/indexes',
    (
      (select count(*)::text from pg_constraint where conrelid = to_regclass('public.friend_events')) || ' constraints, ' ||
      (select count(*)::text from pg_indexes where schemaname = 'public' and tablename = 'friend_events') || ' indexes'
    ),
    jsonb_build_object(
      'constraints', (
        select coalesce(jsonb_agg(jsonb_build_object('name', conname, 'type', contype, 'definition', pg_get_constraintdef(oid))), '[]'::jsonb)
        from pg_constraint
        where conrelid = to_regclass('public.friend_events')
      ),
      'indexes', (
        select coalesce(jsonb_agg(jsonb_build_object('name', indexname, 'definition', indexdef)), '[]'::jsonb)
        from pg_indexes
        where schemaname = 'public' and tablename = 'friend_events'
      )
    ),
    case when to_regclass('public.friend_events') is null then 'STOP' else 'PASS' end

  union all

  -- 10. friend_links columns.
  select
    '10. friend_links columns',
    case when to_regclass('public.friend_links') is null
      then 'table absent'
      else (select n from links_missing)::text || ' required columns missing'
    end,
    (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'column', a.attname,
            'type', format_type(a.atttypid, a.atttypmod),
            'not_null', a.attnotnull
          )
          order by a.attnum
        ),
        '[]'::jsonb
      )
      from pg_attribute a
      where a.attrelid = to_regclass('public.friend_links')
        and a.attnum > 0
        and not a.attisdropped
    ),
    case
      when to_regclass('public.friend_links') is null then 'STOP'
      when (select n from links_missing) > 0 then 'STOP'
      else 'PASS'
    end

  union all

  -- 11. friend_letters RLS and table ACL.
  select
    '11. friend_letters security',
    case when to_regclass('public.friend_letters') is null
      then 'table absent'
      else 'rls=' || coalesce((select relrowsecurity::text from pg_class where oid = to_regclass('public.friend_letters')), 'missing')
    end,
    jsonb_build_object(
      'relrowsecurity', (select relrowsecurity from pg_class where oid = to_regclass('public.friend_letters')),
      'relacl', (select relacl from pg_class where oid = to_regclass('public.friend_letters')),
      'anon_select', case when to_regclass('public.friend_letters') is not null
        then coalesce(has_table_privilege('anon', 'public.friend_letters', 'SELECT'), false)
        else false end,
      'authenticated_select', case when to_regclass('public.friend_letters') is not null
        then coalesce(has_table_privilege('authenticated', 'public.friend_letters', 'SELECT'), false)
        else false end
    ),
    case
      when to_regclass('public.friend_letters') is null then 'PASS'
      when not coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.friend_letters')), false) then 'STOP'
      when coalesce(has_table_privilege('anon', 'public.friend_letters', 'SELECT'), false) then 'STOP'
      when coalesce(has_table_privilege('authenticated', 'public.friend_letters', 'SELECT'), false) then 'STOP'
      else 'PASS'
    end

  union all

  -- 12. Related RLS policies.
  select
    '12. related RLS policies',
    (select count(*)::text from pg_policies where schemaname = 'public' and tablename in (
      'friend_letters', 'friend_events', 'friend_links',
      'friend_requests', 'friend_activities', 'friend_activity_logs'
    )) || ' policies',
    (
      select coalesce(
        jsonb_agg(jsonb_build_object('table', tablename, 'policy', policyname, 'cmd', cmd, 'roles', roles)),
        '[]'::jsonb
      )
      from pg_policies
      where schemaname = 'public'
        and tablename in (
          'friend_letters', 'friend_events', 'friend_links',
          'friend_requests', 'friend_activities', 'friend_activity_logs'
        )
    ),
    case
      when exists (
        select 1 from pg_policies
        where schemaname = 'public'
          and tablename in ('friend_letters', 'friend_events', 'friend_links', 'friend_requests')
      ) then 'WARN'
      else 'PASS'
    end

  union all

  -- 13. friend_letter_list exact signature.
  select
    '13. friend_letter_list signature',
    case when to_regprocedure('public.friend_letter_list(text,text,integer,timestamp with time zone,uuid)') is null
      then 'expected function absent'
      else 'expected signature present'
    end,
    coalesce(
      (
        select jsonb_build_object(
          'arguments', pg_get_function_identity_arguments(p.oid),
          'result', pg_get_function_result(p.oid),
          'security_definer', p.prosecdef,
          'settings', p.proconfig
        )
        from pg_proc p
        where p.oid = to_regprocedure('public.friend_letter_list(text,text,integer,timestamp with time zone,uuid)')
      ),
      '{}'::jsonb
    ),
    case
      when not exists (
        select 1
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname = 'friend_letter_list'
      ) then 'PASS'
      when to_regprocedure('public.friend_letter_list(text,text,integer,timestamp with time zone,uuid)') is not null then 'PASS'
      else 'STOP'
    end

  union all

  -- 14. Related object collisions.
  select
    '14. related object collisions',
    (select count(*)::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname in (
          'friend_letters', 'friend_letter_send', 'friend_letter_list',
          'friend_letter_get', 'friend_letter_read', 'friend_letter_react',
          'friend_letter_unread'
        )) || ' objects',
    (
      select coalesce(
        jsonb_agg(jsonb_build_object('name', c.relname, 'kind', c.relkind) order by c.relname),
        '[]'::jsonb
      )
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname in (
          'friend_letters', 'friend_letter_send', 'friend_letter_list',
          'friend_letter_get', 'friend_letter_read', 'friend_letter_react',
          'friend_letter_unread'
        )
    ),
    case
      when exists (
        select 1
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relname in (
            'friend_letter_send', 'friend_letter_list', 'friend_letter_get',
            'friend_letter_read', 'friend_letter_react', 'friend_letter_unread'
          )
      ) then 'WARN'
      else 'PASS'
    end
),
summary as (
  select
    'SUMMARY' as check_name,
    case when exists (select 1 from checks where status = 'STOP') then 'STOP' else 'READY' end as result,
    jsonb_build_object(
      'checks', count(*),
      'pass', count(*) filter (where status = 'PASS'),
      'warn', count(*) filter (where status = 'WARN'),
      'stop', count(*) filter (where status = 'STOP')
    ) as details,
    case when exists (select 1 from checks where status = 'STOP') then 'STOP' else 'PASS' end as status
  from checks
)
select check_name, result, details, status
from (
  select check_name, result, details, status, 0 as sort_order
  from checks
  union all
  select check_name, result, details, status, 1 as sort_order
  from summary
) report
order by sort_order, check_name;
