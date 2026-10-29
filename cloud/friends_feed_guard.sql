begin;

create or replace function public.friend_feed(p_token text, p_food_id text)
returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
declare
  v_link record; v_food record; v_state jsonb; v_last timestamptz;
begin
  select * into v_link from public.friend_active_link_v2(p_token);
  if v_link.link_id is null then return jsonb_build_object('ok', false, 'error', 'not_linked'); end if;
  if exists (
    select 1 from public.friend_activities
    where link_id = v_link.link_id and status = 'active' and ends_at > now()
  ) then
    return jsonb_build_object('ok', false, 'error', 'friend_busy');
  end if;
  select * into v_food from public.friend_food_catalog where id = p_food_id;
  if v_food.id is null then return jsonb_build_object('ok', false, 'error', 'bad_food'); end if;

  select max(created_at) into v_last from public.friend_events
   where link_id = v_link.link_id and type = 'feed' and target_app = v_link.other_app
     and target_account_id = v_link.other_id;
  if v_last is not null and v_last > now() - interval '2 hours' then
    return jsonb_build_object('ok', false, 'error', 'cooldown');
  end if;

  if v_link.other_app = 'momo' then
    select state into v_state from public.momo_states where account_id = v_link.other_id;
  else
    select state into v_state from public.wowo_states where account_id = v_link.other_id;
  end if;
  v_state := coalesce(v_state, '{}'::jsonb);
  v_state := jsonb_set(v_state, '{fullness}', to_jsonb(least(100, coalesce((v_state->>'fullness')::numeric, 0) + v_food.fullness)), true);
  v_state := jsonb_set(v_state, '{mood}', to_jsonb(least(100, coalesce((v_state->>'mood')::numeric, 50) + v_food.mood)), true);
  v_state := jsonb_set(v_state, '{health}', to_jsonb(least(100, coalesce((v_state->>'health')::numeric, 70) + v_food.health)), true);
  v_state := jsonb_set(v_state, '{feedLog}', jsonb_build_array(jsonb_build_object(
    'at', now(), 'emoji', v_food.emoji, 'itemName', v_food.name,
    'optionLabel', '来自密友', 'line', v_link.me_name || '偷偷塞给你的。',
    'friend', v_link.me_name, 'healthDelta', v_food.health
  )) || coalesce(v_state->'feedLog', '[]'::jsonb), true);

  if v_link.other_app = 'momo' then
    update public.momo_states set state = v_state, rev = rev + 1, updated_at = now() where account_id = v_link.other_id;
  else
    update public.wowo_states set state = v_state, rev = rev + 1, updated_at = now() where account_id = v_link.other_id;
  end if;

  insert into public.friend_events (link_id, target_app, target_account_id, type, payload)
  values (v_link.link_id, v_link.other_app, v_link.other_id, 'feed',
    jsonb_build_object('from', v_link.me_name, 'food', v_food.name, 'emoji', v_food.emoji));
  return jsonb_build_object('ok', true, 'food', v_food.name);
end;
$$;

create or replace function public.friend_feed_log_guard()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_active boolean := false;
  v_feed_changed boolean := false;
begin
  if tg_argv[0] = 'momo' then
    select exists (
      select 1
      from public.friend_activities a
      where a.status = 'active'
        and a.ends_at > now()
        and (
          (a.initiator_app = 'momo' and a.initiator_account_id = new.account_id)
          or (a.partner_app = 'momo' and a.partner_account_id = new.account_id)
        )
    ) into v_active;
  elsif tg_argv[0] = 'wowo' then
    select exists (
      select 1
      from public.friend_activities a
      where a.status = 'active'
        and a.ends_at > now()
        and (
          (a.initiator_app = 'wowo' and a.initiator_account_id = new.account_id)
          or (a.partner_app = 'wowo' and a.partner_account_id = new.account_id)
        )
    ) into v_active;
  end if;

  if not v_active then
    return new;
  end if;

  if tg_op = 'INSERT' then
    v_feed_changed := (case when jsonb_typeof(new.state->'feedLog') = 'array'
      then jsonb_array_length(new.state->'feedLog') else 0 end) > 0;
  else
    v_feed_changed := (case when jsonb_typeof(new.state->'feedLog') = 'array'
        then jsonb_array_length(new.state->'feedLog') else 0 end > 0)
      and new.state->'feedLog' is distinct from old.state->'feedLog';
  end if;

  if v_feed_changed then
    raise exception 'friend_busy';
  end if;

  return new;
end;
$$;

drop trigger if exists friend_feed_log_guard on public.momo_states;
create trigger friend_feed_log_guard
before insert or update on public.momo_states
for each row execute function public.friend_feed_log_guard('momo');

drop trigger if exists friend_feed_log_guard on public.wowo_states;
create trigger friend_feed_log_guard
before insert or update on public.wowo_states
for each row execute function public.friend_feed_log_guard('wowo');

commit;
