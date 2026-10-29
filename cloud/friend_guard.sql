-- MOMO x WOWO: block solo outing/exercise while a friend activity is active.
-- Run after friends_actions_v5.sql.

create or replace function public.friend_state_guard()
returns trigger
language plpgsql
as $$
begin
  if jsonb_typeof(new.state->'friendActivity') = 'object'
     and (jsonb_typeof(new.state->'outing') = 'object'
          or jsonb_typeof(new.state->'exercise') = 'object') then
    raise exception 'friend_busy';
  end if;
  return new;
end;
$$;

drop trigger if exists friend_state_guard on public.momo_states;
create trigger friend_state_guard
before insert or update on public.momo_states
for each row execute function public.friend_state_guard();

drop trigger if exists friend_state_guard on public.wowo_states;
create trigger friend_state_guard
before insert or update on public.wowo_states
for each row execute function public.friend_state_guard();
