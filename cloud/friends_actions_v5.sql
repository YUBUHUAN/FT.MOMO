-- MOMO x WOWO FRIENDS ACTIONS v5 (latest).
-- Momo x Wowo friend interactions (feed + two-person activities).
-- Run in the Momo project SQL editor after friends_v3.sql.
begin;
set search_path = public, extensions, pg_temp;

create table if not exists public.friend_food_catalog (
  id text primary key,
  name text not null,
  emoji text not null,
  fullness integer not null default 0,
  mood integer not null default 0,
  health integer not null default 0
);
insert into public.friend_food_catalog (id, name, emoji, fullness, mood, health) values
  ('cookie', '小饼干', '🍪', 6, 2, 0),
  ('milk', '热牛奶', '🥛', 8, 3, 1),
  ('cake', '草莓蛋糕', '🍰', 10, 5, 0),
  ('oden', '关东煮', '🍢', 14, 4, 1)
on conflict (id) do update set
  name = excluded.name, emoji = excluded.emoji,
  fullness = excluded.fullness, mood = excluded.mood, health = excluded.health;

create table if not exists public.friend_events (
  id uuid primary key default gen_random_uuid(),
  link_id uuid not null references public.friend_links(id) on delete cascade,
  target_app text not null check (target_app in ('momo', 'wowo')),
  target_account_id uuid not null,
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists friend_events_target_idx
  on public.friend_events (target_app, target_account_id, read_at, created_at desc);

create table if not exists public.friend_activities (
  id uuid primary key default gen_random_uuid(),
  link_id uuid not null references public.friend_links(id) on delete cascade,
  kind text not null check (kind in ('outing', 'exercise')),
  option text not null,
  initiator_app text not null check (initiator_app in ('momo', 'wowo')),
  initiator_account_id uuid not null,
  partner_app text not null check (partner_app in ('momo', 'wowo')),
  partner_account_id uuid not null,
  status text not null default 'pending'
    check (status in ('pending', 'active', 'declined', 'cancelled', 'completed', 'expired')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  ends_at timestamptz,
  result jsonb
);
create index if not exists friend_activities_pair_idx
  on public.friend_activities (link_id, status, created_at desc);

create table if not exists public.friend_activity_logs (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null unique,
  link_id uuid not null,
  kind text not null check (kind in ('outing', 'exercise')),
  option text not null,
  partner_name text,
  initiator_app text,
  initiator_account_id uuid,
  partner_app text,
  partner_account_id uuid,
  started_at timestamptz,
  ended_at timestamptz not null default now(),
  duration_seconds int not null default 1800,
  exploration_text text not null,
  surprise_text text not null,
  created_at timestamptz not null default now()
);
create index if not exists friend_activity_logs_link_idx
  on public.friend_activity_logs (link_id, ended_at desc);

create table if not exists public.friend_quote_lines (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('outing', 'exercise')),
  quote_type text not null check (quote_type in ('exploration', 'surprise')),
  text text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (kind, quote_type, text)
);
alter table public.friend_activity_logs enable row level security;
alter table public.friend_quote_lines enable row level security;
revoke all on table public.friend_activity_logs from anon, authenticated;
revoke all on table public.friend_quote_lines from anon, authenticated;

insert into public.friend_quote_lines (kind, quote_type, text) values
  ('outing', 'exploration', '绕到湖边的时候，风把她的发带吹起来了。'),
  ('outing', 'exploration', '游乐场的摩天轮转到最高处，她偷偷看了你一眼。'),
  ('outing', 'exploration', '海边捡到一枚很普通的贝壳，她说这个最像你。'),
  ('outing', 'exploration', '公园长椅旁边，有一只猫陪你们坐了很久。'),
  ('outing', 'exploration', '走错了一条小路，反而看见一整片开得很好的花。'),
  ('outing', 'exploration', '她数着路灯走，数到第七盏的时候笑了。'),
  ('outing', 'surprise', '回来时口袋里多了一颗糖，是给你的。'),
  ('outing', 'surprise', '她带回来一片叶子，说夹在手帐里就不会褪色。'),
  ('outing', 'surprise', '路上遇到卖气球的，她给你挑了一个最圆的。'),
  ('outing', 'surprise', '她偷偷拍了一张你的背影，存在手机最里面。'),
  ('outing', 'surprise', '回来的路上她走得很慢，说想和你多待一会儿。'),
  ('outing', 'surprise', '她记住你说过喜欢的那家小店，下次还想一起去。'),
  ('exercise', 'exploration', '羽毛球打到第十回合，两个人同时笑场了。'),
  ('exercise', 'exploration', '跳绳总是不合拍，最后干脆改成一起数数。'),
  ('exercise', 'exploration', '散步时发现一条从没走过的小路，尽头是一棵很大的树。'),
  ('exercise', 'exploration', '她教你一个很笨的拉伸动作，自己先笑倒了。'),
  ('exercise', 'exploration', '运动到一半开始比谁先看到云变成小动物。'),
  ('exercise', 'exploration', '她假装很专业地纠正你的姿势，其实自己也做错了。'),
  ('exercise', 'surprise', '她递来一瓶水，瓶身上还留着她的温度。'),
  ('exercise', 'surprise', '结束以后她偷偷把最后一块毛巾留给了你。'),
  ('exercise', 'surprise', '她说下次还要一起，语气比平时认真一点。'),
  ('exercise', 'surprise', '回去的路上她一直在哼刚才运动时的歌。'),
  ('exercise', 'surprise', '她把你随口说的“再来一次”记在了心里。'),
  ('exercise', 'surprise', '运动完她变戏法一样拿出两颗糖，一人一颗。')
on conflict (kind, quote_type, text) do nothing;

alter table public.friend_events enable row level security;
alter table public.friend_activities enable row level security;
alter table public.friend_food_catalog enable row level security;
revoke all on table public.friend_events from anon, authenticated;
revoke all on table public.friend_activities from anon, authenticated;
revoke all on table public.friend_food_catalog from anon, authenticated;

drop function if exists public.friend_active_link(text) cascade;

create or replace function public.friend_active_link(p_token text)
returns table (link_id uuid, me_app text, me_id uuid, me_name text,
               other_app text, other_id uuid, other_name text)
language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
declare v_me record;
begin
  select * into v_me from public.friend_identity(p_token);
  if not found then return; end if;
  return query
  select l.id as link_id,
         v_me.app,
         v_me.account_id,
         v_me.username,
         case when v_me.app = 'momo' then 'wowo' else 'momo' end,
         case when v_me.app = 'momo' then l.wowo_account_id else l.momo_account_id end,
         case when v_me.app = 'momo'
              then (select w.username from public.wowo_accounts w where w.id = l.wowo_account_id)
              else (select m.username from public.momo_accounts m where m.id = l.momo_account_id) end
  from public.friend_links l
  where l.status = 'active'
    and (l.momo_account_id = v_me.account_id or l.wowo_account_id = v_me.account_id)
  limit 1;
end;
$$;

drop function if exists public.friend_active_link_v2(text) cascade;

create or replace function public.friend_active_link_v2(p_token text)
returns table (link_id uuid, me_app text, me_id uuid, me_name text,
               other_app text, other_id uuid, other_name text)
language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
declare v_me record;
begin
  select * into v_me from public.friend_identity(p_token);
  if not found then return; end if;
  return query
  select l.id as link_id,
         v_me.app,
         v_me.account_id,
         v_me.username,
         case when v_me.app = 'momo' then 'wowo' else 'momo' end,
         case when v_me.app = 'momo' then l.wowo_account_id else l.momo_account_id end,
         case when v_me.app = 'momo'
              then (select w.username from public.wowo_accounts w where w.id = l.wowo_account_id)
              else (select m.username from public.momo_accounts m where m.id = l.momo_account_id) end
  from public.friend_links l
  where l.status = 'active'
    and (l.momo_account_id = v_me.account_id or l.wowo_account_id = v_me.account_id)
  limit 1;
end;
$$;

create or replace function public.friend_feed(p_token text, p_food_id text)
returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
declare
  v_link record; v_food record; v_state jsonb; v_last timestamptz;
begin
  select * into v_link from public.friend_active_link_v2(p_token);
  if v_link.link_id is null then return jsonb_build_object('ok', false, 'error', 'not_linked'); end if;
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

create or replace function public.friend_activity_request(p_token text, p_kind text, p_option text)
returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
declare v_link record; v_state jsonb; v_activity_id uuid;
begin
  perform public.friend_activity_finish(p_token);
  select * into v_link from public.friend_active_link_v2(p_token);
  if v_link.link_id is null then return jsonb_build_object('ok', false, 'error', 'not_linked'); end if;
  if p_kind not in ('outing', 'exercise') then return jsonb_build_object('ok', false, 'error', 'bad_kind'); end if;
  if length(btrim(coalesce(p_option, ''))) = 0 then return jsonb_build_object('ok', false, 'error', 'bad_option'); end if;
  if exists (select 1 from public.friend_activities where link_id = v_link.link_id and status = 'pending' and initiator_account_id = v_link.me_id) then
    return jsonb_build_object('ok', false, 'error', 'pending_exists');
  end if;
  if exists (select 1 from public.friend_activities where link_id = v_link.link_id and status = 'active') then
    return jsonb_build_object('ok', false, 'error', 'active_exists');
  end if;
  if v_link.me_app = 'momo' then
    select state into v_state from public.momo_states where account_id = v_link.me_id;
  else
    select state into v_state from public.wowo_states where account_id = v_link.me_id;
  end if;
  if coalesce(v_state->>'sleeping', 'false') = 'true'
     or jsonb_typeof(v_state->'outing') = 'object' or jsonb_typeof(v_state->'exercise') = 'object'
     or jsonb_typeof(v_state->'friendActivity') = 'object' then
    return jsonb_build_object('ok', false, 'error', 'busy');
  end if;
  insert into public.friend_activities
    (link_id, kind, option, initiator_app, initiator_account_id, partner_app, partner_account_id)
  values (v_link.link_id, p_kind, btrim(p_option), v_link.me_app, v_link.me_id, v_link.other_app, v_link.other_id)
  returning id into v_activity_id;
  insert into public.friend_events (link_id, target_app, target_account_id, type, payload)
  values (v_link.link_id, v_link.other_app, v_link.other_id, 'activity_invite',
    jsonb_build_object('id', v_activity_id, 'kind', p_kind, 'option', btrim(p_option), 'from', v_link.me_name));
  return jsonb_build_object('ok', true, 'status', 'pending');
end;
$$;

create or replace function public.friend_activity_respond(p_token text, p_id uuid, p_accept boolean)
returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
declare
  v_link record; v_act record; v_state jsonb; v_other_state jsonb;
  v_ends timestamptz;
begin
  select * into v_link from public.friend_active_link_v2(p_token);
  if v_link.link_id is null then return jsonb_build_object('ok', false, 'error', 'not_linked'); end if;
  select * into v_act from public.friend_activities
   where id = p_id and link_id = v_link.link_id and status = 'pending' and partner_account_id = v_link.me_id;
  if v_act.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if v_act.created_at < now() - interval '30 minutes' then
    update public.friend_activities set status = 'expired' where id = v_act.id;
    return jsonb_build_object('ok', false, 'error', 'expired');
  end if;
  if not p_accept then
    update public.friend_activities set status = 'declined', responded_at = now() where id = v_act.id;
    update public.friend_events set read_at = now()
      where link_id = v_link.link_id and target_app = v_link.me_app and target_account_id = v_link.me_id
        and type = 'activity_invite' and payload->>'id' = v_act.id::text and read_at is null;
    insert into public.friend_events (link_id, target_app, target_account_id, type, payload)
    values (v_link.link_id, v_act.initiator_app, v_act.initiator_account_id, 'activity_declined',
      jsonb_build_object('kind', v_act.kind, 'from', v_link.me_name));
    return jsonb_build_object('ok', true, 'status', 'declined');
  end if;

  if v_link.me_app = 'momo' then
    select state into v_state from public.momo_states where account_id = v_link.me_id;
    select state into v_other_state from public.wowo_states where account_id = v_link.other_id;
  else
    select state into v_state from public.wowo_states where account_id = v_link.me_id;
    select state into v_other_state from public.momo_states where account_id = v_link.other_id;
  end if;
  if coalesce(v_state->>'sleeping', 'false') = 'true'
     or jsonb_typeof(v_state->'outing') = 'object' or jsonb_typeof(v_state->'exercise') = 'object'
     or jsonb_typeof(v_state->'friendActivity') = 'object'
     or coalesce(v_other_state->>'sleeping', 'false') = 'true'
     or jsonb_typeof(v_other_state->'outing') = 'object' or jsonb_typeof(v_other_state->'exercise') = 'object'
     or jsonb_typeof(v_other_state->'friendActivity') = 'object' then
    return jsonb_build_object('ok', false, 'error', 'busy');
  end if;

  v_ends := now() + interval '30 minutes';
  v_state := coalesce(v_state, '{}'::jsonb);
  v_other_state := coalesce(v_other_state, '{}'::jsonb);
  v_state := jsonb_set(v_state, '{friendActivity}', jsonb_build_object(
    'id', v_act.id, 'kind', v_act.kind, 'option', v_act.option,
    'partner', v_link.other_name, 'partnerApp', v_link.other_app,
    'endsAt', v_ends), true);
  v_other_state := jsonb_set(v_other_state, '{friendActivity}', jsonb_build_object(
    'id', v_act.id, 'kind', v_act.kind, 'option', v_act.option,
    'partner', v_link.me_name, 'partnerApp', v_link.me_app,
    'endsAt', v_ends), true);

  if v_link.me_app = 'momo' then
    update public.momo_states set state = v_state, rev = rev + 1, updated_at = now() where account_id = v_link.me_id;
    update public.wowo_states set state = v_other_state, rev = rev + 1, updated_at = now() where account_id = v_link.other_id;
  else
    update public.wowo_states set state = v_state, rev = rev + 1, updated_at = now() where account_id = v_link.me_id;
    update public.momo_states set state = v_other_state, rev = rev + 1, updated_at = now() where account_id = v_link.other_id;
  end if;
  update public.friend_activities set status = 'active', responded_at = now(), ends_at = v_ends where id = v_act.id;
  update public.friend_events set read_at = now()
    where link_id = v_link.link_id and target_app = v_link.me_app and target_account_id = v_link.me_id
      and type = 'activity_invite' and payload->>'id' = v_act.id::text and read_at is null;
  insert into public.friend_events (link_id, target_app, target_account_id, type, payload)
  values (v_link.link_id, v_link.other_app, v_link.other_id, 'activity_started',
    jsonb_build_object('kind', v_act.kind, 'option', v_act.option, 'from', v_link.me_name));
  return jsonb_build_object('ok', true, 'status', 'active');
end;
$$;

create or replace function public.friend_activity_cancel(p_token text, p_id uuid)
returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
declare v_link record; v_act record; v_state jsonb; v_other_state jsonb; v_explore text; v_surprise text; v_started timestamptz; v_duration int;
begin
  select * into v_link from public.friend_active_link_v2(p_token);
  if v_link.link_id is null then return jsonb_build_object('ok', false, 'error', 'not_linked'); end if;
  select * into v_act from public.friend_activities
   where id = p_id and link_id = v_link.link_id
     and (initiator_account_id = v_link.me_id or partner_account_id = v_link.me_id)
     and status in ('pending', 'active');
  if v_act.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  update public.friend_activities set status = 'cancelled', responded_at = now() where id = v_act.id;
  if v_act.status = 'active' then
    if v_link.me_app = 'momo' then
      select state into v_state from public.momo_states where account_id = v_link.me_id;
      select state into v_other_state from public.wowo_states where account_id = v_link.other_id;
    else
      select state into v_state from public.wowo_states where account_id = v_link.me_id;
      select state into v_other_state from public.momo_states where account_id = v_link.other_id;
    end if;
    v_state := coalesce(v_state, '{}'::jsonb) - 'friendActivity';
    v_other_state := coalesce(v_other_state, '{}'::jsonb) - 'friendActivity';
    select text into v_explore from public.friend_quote_lines where kind = v_act.kind and quote_type = 'exploration' and active order by random() limit 1;
    select text into v_surprise from public.friend_quote_lines where kind = v_act.kind and quote_type = 'surprise' and active order by random() limit 1;
    v_explore := coalesce(v_explore, '一起走过的路，比地图上多了一点点。');
    v_surprise := coalesce(v_surprise, '回来时带了一点小东西，是给你的。');
    v_started := coalesce(v_act.responded_at, v_act.created_at);
    v_duration := greatest(60, extract(epoch from (now() - v_started))::int);
    insert into public.friend_activity_logs
      (activity_id, link_id, kind, option, partner_name, initiator_app, initiator_account_id,
       partner_app, partner_account_id, started_at, ended_at, duration_seconds, exploration_text, surprise_text)
    values
      (v_act.id, v_act.link_id, v_act.kind, v_act.option, v_link.other_name, v_act.initiator_app, v_act.initiator_account_id,
       v_act.partner_app, v_act.partner_account_id, v_started, now(), v_duration, v_explore, v_surprise)
    on conflict (activity_id) do nothing;
    if v_link.me_app = 'momo' then
      update public.momo_states set state = v_state, rev = rev + 1, updated_at = now() where account_id = v_link.me_id;
      update public.wowo_states set state = v_other_state, rev = rev + 1, updated_at = now() where account_id = v_link.other_id;
    else
      update public.wowo_states set state = v_state, rev = rev + 1, updated_at = now() where account_id = v_link.me_id;
      update public.momo_states set state = v_other_state, rev = rev + 1, updated_at = now() where account_id = v_link.other_id;
    end if;
  end if;
  insert into public.friend_events (link_id, target_app, target_account_id, type, payload)
  values (v_link.link_id, v_act.partner_app, v_act.partner_account_id, 'activity_cancelled',
    jsonb_build_object('kind', v_act.kind, 'from', v_link.me_name));
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.friend_activity_finish(p_token text)
returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
declare
  v_link record; v_act record; v_state jsonb; v_other_state jsonb;
  v_mood numeric; v_health numeric; v_fatigue numeric; v_name text;
  v_explore text; v_surprise text; v_started timestamptz; v_duration int;
begin
  select * into v_link from public.friend_active_link_v2(p_token);
  if v_link.link_id is null then return jsonb_build_object('ok', true); end if;
  select * into v_act from public.friend_activities
   where link_id = v_link.link_id and status = 'active' and ends_at <= now()
   order by created_at limit 1;
  if v_act.id is null then return jsonb_build_object('ok', true); end if;

  if v_link.me_app = 'momo' then
    select state into v_state from public.momo_states where account_id = v_link.me_id;
    select state into v_other_state from public.wowo_states where account_id = v_link.other_id;
  else
    select state into v_state from public.wowo_states where account_id = v_link.me_id;
    select state into v_other_state from public.momo_states where account_id = v_link.other_id;
  end if;
  v_state := coalesce(v_state, '{}'::jsonb) - 'friendActivity';
  v_other_state := coalesce(v_other_state, '{}'::jsonb) - 'friendActivity';

  if v_act.kind = 'outing' then
    v_mood := 8; v_health := 0; v_fatigue := 4;
  else
    v_mood := 3; v_health := 6; v_fatigue := 10;
  end if;

  v_state := jsonb_set(v_state, '{mood}', to_jsonb(least(100, coalesce((v_state->>'mood')::numeric, 50) + v_mood)), true);
  v_state := jsonb_set(v_state, '{health}', to_jsonb(least(100, coalesce((v_state->>'health')::numeric, 70) + v_health)), true);
  v_state := jsonb_set(v_state, '{fatigue}', to_jsonb(least(100, coalesce((v_state->>'fatigue')::numeric, 0) + v_fatigue)), true);
  v_other_state := jsonb_set(v_other_state, '{mood}', to_jsonb(least(100, coalesce((v_other_state->>'mood')::numeric, 50) + v_mood)), true);
  v_other_state := jsonb_set(v_other_state, '{health}', to_jsonb(least(100, coalesce((v_other_state->>'health')::numeric, 70) + v_health)), true);
  v_other_state := jsonb_set(v_other_state, '{fatigue}', to_jsonb(least(100, coalesce((v_other_state->>'fatigue')::numeric, 0) + v_fatigue)), true);

  v_state := jsonb_set(v_state, '{totals}',
    jsonb_set(coalesce(v_state->'totals', '{}'::jsonb),
      (case when v_act.kind = 'outing' then '{outings}' else '{exercises}' end)::text[],
      to_jsonb(coalesce((v_state->'totals'->>case when v_act.kind = 'outing' then 'outings' else 'exercises' end)::numeric, 0) + 1), true), true);
  v_other_state := jsonb_set(v_other_state, '{totals}',
    jsonb_set(coalesce(v_other_state->'totals', '{}'::jsonb),
      (case when v_act.kind = 'outing' then '{outings}' else '{exercises}' end)::text[],
      to_jsonb(coalesce((v_other_state->'totals'->>case when v_act.kind = 'outing' then 'outings' else 'exercises' end)::numeric, 0) + 1), true), true);

  if v_act.kind = 'outing' then
    v_state := jsonb_set(v_state, '{outingHistory}', jsonb_build_array(jsonb_build_object(
      'at', now(), 'emoji', '🌿', 'name', v_act.option, 'minutes', 30,
      'actualMinutes', 30, 'moodDelta', v_mood, 'friend', v_link.other_name
    )) || coalesce(v_state->'outingHistory', '[]'::jsonb), true);
    v_other_state := jsonb_set(v_other_state, '{outingHistory}', jsonb_build_array(jsonb_build_object(
      'at', now(), 'emoji', '🌿', 'name', v_act.option, 'minutes', 30,
      'actualMinutes', 30, 'moodDelta', v_mood, 'friend', v_link.me_name
    )) || coalesce(v_other_state->'outingHistory', '[]'::jsonb), true);
  else
    v_state := jsonb_set(v_state, '{exerciseHistory}', jsonb_build_array(jsonb_build_object(
      'at', now(), 'emoji', '🏸', 'name', v_act.option, 'minutes', 30,
      'actualMinutes', 30, 'healthDelta', v_health, 'fatigueDelta', v_fatigue, 'friend', v_link.other_name
    )) || coalesce(v_state->'exerciseHistory', '[]'::jsonb), true);
    v_other_state := jsonb_set(v_other_state, '{exerciseHistory}', jsonb_build_array(jsonb_build_object(
      'at', now(), 'emoji', '🏸', 'name', v_act.option, 'minutes', 30,
      'actualMinutes', 30, 'healthDelta', v_health, 'fatigueDelta', v_fatigue, 'friend', v_link.me_name
    )) || coalesce(v_other_state->'exerciseHistory', '[]'::jsonb), true);
  end if;

  if v_link.me_app = 'momo' then
    update public.momo_states set state = v_state, rev = rev + 1, updated_at = now() where account_id = v_link.me_id;
    update public.wowo_states set state = v_other_state, rev = rev + 1, updated_at = now() where account_id = v_link.other_id;
  else
    update public.wowo_states set state = v_state, rev = rev + 1, updated_at = now() where account_id = v_link.me_id;
    update public.momo_states set state = v_other_state, rev = rev + 1, updated_at = now() where account_id = v_link.other_id;
  end if;
  select text into v_explore from public.friend_quote_lines
   where kind = v_act.kind and quote_type = 'exploration' and active
   order by random() limit 1;
  select text into v_surprise from public.friend_quote_lines
   where kind = v_act.kind and quote_type = 'surprise' and active
   order by random() limit 1;
  v_explore := coalesce(v_explore, '一起走过的路，比地图上多了一点点。');
  v_surprise := coalesce(v_surprise, '回来时带了一点小东西，是给你的。');
  v_started := coalesce(v_act.responded_at, v_act.created_at);
  v_duration := greatest(60, extract(epoch from (now() - v_started))::int);
  insert into public.friend_activity_logs
    (activity_id, link_id, kind, option, partner_name, initiator_app, initiator_account_id,
     partner_app, partner_account_id, started_at, ended_at, duration_seconds, exploration_text, surprise_text)
  values
    (v_act.id, v_act.link_id, v_act.kind, v_act.option, v_link.other_name, v_act.initiator_app, v_act.initiator_account_id,
     v_act.partner_app, v_act.partner_account_id, v_started, now(), v_duration, v_explore, v_surprise)
  on conflict (activity_id) do nothing;

  update public.friend_activities set status = 'completed', result = jsonb_build_object('mood', v_mood, 'health', v_health, 'fatigue', v_fatigue) where id = v_act.id;
  insert into public.friend_events (link_id, target_app, target_account_id, type, payload)
  values (v_link.link_id, v_link.other_app, v_link.other_id, 'activity_finished',
    jsonb_build_object('kind', v_act.kind, 'option', v_act.option, 'from', '你'));
  return jsonb_build_object('ok', true, 'finished', v_act.kind);
end;
$$;

create or replace function public.friend_events(p_token text)
returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
declare v_link record; v_rows jsonb;
begin
  perform public.friend_activity_finish(p_token);
  select * into v_link from public.friend_active_link_v2(p_token);
  if v_link.link_id is null then return jsonb_build_object('ok', true, 'events', '[]'::jsonb); end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'type', e.type, 'payload', e.payload, 'createdAt', e.created_at) order by e.created_at), '[]'::jsonb)
    into v_rows
    from public.friend_events e
    where e.link_id = v_link.link_id and e.target_app = v_link.me_app
      and e.target_account_id = v_link.me_id and e.read_at is null;
  return jsonb_build_object('ok', true, 'events', v_rows, 'activity',
    (select jsonb_build_object('id', a.id, 'kind', a.kind, 'option', a.option,
       'status', a.status, 'endsAt', a.ends_at, 'from', case when a.initiator_app = v_link.me_app then 'me' else 'friend' end)
     from public.friend_activities a
     where (a.initiator_account_id = v_link.me_id or a.partner_account_id = v_link.me_id)
       and a.status in ('pending', 'active')
     order by a.created_at desc limit 1));
end;
$$;

create or replace function public.friend_event_ack(p_token text, p_id uuid)
returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
declare v_link record;
begin
  select * into v_link from public.friend_active_link_v2(p_token);
  if v_link.link_id is null then return jsonb_build_object('ok', false); end if;
  update public.friend_events set read_at = now()
   where id = p_id and link_id = v_link.link_id and target_account_id = v_link.me_id;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.friend_debug(p_token text)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
declare r record;
begin
  select * into r from public.friend_active_link_v2(p_token);
  return jsonb_build_object('ok', true, 'row', row_to_json(r));
exception when others then
  return jsonb_build_object('ok', false, 'error', SQLERRM, 'state', SQLSTATE, 'context', PG_EXCEPTION_CONTEXT);
end;
$$;

grant execute on function public.friend_debug(text) to anon, authenticated;

revoke all on function public.friend_active_link(text) from public;
grant execute on function public.friend_activity_finish(text) to anon, authenticated;
grant execute on function public.friend_feed(text, text) to anon, authenticated;
grant execute on function public.friend_activity_request(text, text, text) to anon, authenticated;
grant execute on function public.friend_activity_respond(text, uuid, boolean) to anon, authenticated;
grant execute on function public.friend_activity_cancel(text, uuid) to anon, authenticated;
grant execute on function public.friend_events(text) to anon, authenticated;
grant execute on function public.friend_event_ack(text, uuid) to anon, authenticated;

commit;


create or replace function public.friend_history(p_token text, p_limit int default 20)
returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
declare v_link record; v_rows jsonb;
begin
  select * into v_link from public.friend_active_link_v2(p_token);
  if v_link.link_id is null then return jsonb_build_object('ok', true, 'logs', '[]'::jsonb); end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', l.id, 'kind', l.kind, 'option', l.option, 'partnerName', l.partner_name,
    'startedAt', l.started_at, 'endedAt', l.ended_at, 'durationSeconds', l.duration_seconds,
    'exploration', l.exploration_text, 'surprise', l.surprise_text
  ) order by l.ended_at desc), '[]'::jsonb)
  into v_rows
  from (
    select * from public.friend_activity_logs
    where link_id = v_link.link_id
    order by ended_at desc
    limit greatest(1, least(50, coalesce(p_limit, 20)))
  ) l;
  return jsonb_build_object('ok', true, 'logs', v_rows);
end;
$$;

grant execute on function public.friend_history(text, int) to anon, authenticated;
