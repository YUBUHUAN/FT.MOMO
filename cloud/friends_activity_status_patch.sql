begin;

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
    'status', 'active', 'endsAt', v_ends), true);
  v_other_state := jsonb_set(v_other_state, '{friendActivity}', jsonb_build_object(
    'id', v_act.id, 'kind', v_act.kind, 'option', v_act.option,
    'partner', v_link.me_name, 'partnerApp', v_link.me_app,
    'status', 'active', 'endsAt', v_ends), true);

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

commit;
