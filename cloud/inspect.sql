-- Read-only queries for the Supabase SQL Editor.
-- Run any query separately; do not edit rows here unless you know what you are doing.

-- 1) 账号 + 宠物状态概览
select
  a.username,
  a.created_at,
  s.rev,
  s.updated_at,
  s.state->>'name' as pet_name,
  (s.state->'totals'->>'taps')::int as taps,
  (s.state->'totals'->>'feeds')::int as feeds,
  (s.state->'totals'->>'outings')::int as outings,
  (s.state->'totals'->>'exercises')::int as exercises
from public.momo_accounts a
left join public.momo_states s on s.account_id = a.id
order by coalesce(s.updated_at, a.created_at) desc;

-- 2) 某个账号的完整宠物状态（把 username 换成你的账号）
select a.username, s.rev, s.updated_at, jsonb_pretty(s.state) as state
from public.momo_accounts a
join public.momo_states s on s.account_id = a.id
where a.username = '你的账号';

-- 3) 当前有效登录会话数量
select count(*) as active_sessions
from public.momo_sessions
where expires_at > now();

-- 4) 删除一个账号（会级联删除它的状态和会话；谨慎）
-- delete from public.momo_accounts where username = '要删除的账号';
