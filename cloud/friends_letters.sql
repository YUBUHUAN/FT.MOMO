-- MOMO x WOWO FRIENDS: POST OFFICE v1.8.0
-- Run in the Momo Supabase project after friends_v3.sql and friends_actions.sql.
--
-- This migration only adds friend_letters and letter RPCs.
-- It does not modify momo_states / wowo_states, existing activities, feeds,
-- friend_events columns, or friend_links rows.

begin;

create table if not exists public.friend_letters (
  id uuid primary key default gen_random_uuid(),

  -- Keep history if a link is removed. Never CASCADE from links to letters.
  link_id uuid null references public.friend_links(id) on delete set null,

  sender_app text not null check (sender_app in ('momo', 'wowo')),
  sender_account_id uuid not null,
  sender_name text not null,

  recipient_app text not null check (recipient_app in ('momo', 'wowo')),
  recipient_account_id uuid not null,
  recipient_name text not null,

  style text not null check (style in ('warm', 'cute', 'romantic')),
  body text not null check (char_length(btrim(body)) between 1 and 2000),

  paper_style text not null check (paper_style in (
    'paper-cream', 'paper-sakura', 'paper-night'
  )),
  envelope_style text not null check (envelope_style in (
    'envelope-kraft', 'envelope-blue', 'envelope-rose'
  )),
  sticker text null check (
    sticker is null or sticker in (
      'sticker-heart', 'sticker-star', 'sticker-leaf',
      'sticker-paw', 'sticker-flower', 'sticker-bow'
    )
  ),

  reply_to_id uuid null references public.friend_letters(id) on delete set null,

  -- read_at is only used for recipient unread count.
  -- It must not be exposed to the sender as a read receipt.
  read_at timestamptz null,
  hearted_at timestamptz null,
  favorited_at timestamptz null,

  -- Client-generated UUID. Retries with the same token must be idempotent.
  client_token uuid not null,

  created_at timestamptz not null default now()
);

create unique index if not exists friend_letters_client_token_uidx
  on public.friend_letters (sender_app, sender_account_id, client_token);

create index if not exists friend_letters_recipient_idx
  on public.friend_letters (recipient_app, recipient_account_id, created_at desc);

create index if not exists friend_letters_sender_idx
  on public.friend_letters (sender_app, sender_account_id, created_at desc);

create index if not exists friend_letters_link_idx
  on public.friend_letters (link_id, created_at desc);

create index if not exists friend_letters_reply_idx
  on public.friend_letters (reply_to_id);

alter table public.friend_letters enable row level security;
revoke all on table public.friend_letters from anon, authenticated;

-- ---------------------------------------------------------------------------
-- send
-- ---------------------------------------------------------------------------

create or replace function public.friend_letter_send(
  p_token text,
  p_style text,
  p_body text,
  p_paper_style text,
  p_envelope_style text,
  p_sticker text,
  p_reply_to uuid,
  p_client_token uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_me record;
  v_link record;
  v_existing public.friend_letters%rowtype;
  v_original public.friend_letters%rowtype;
  v_id uuid;
  v_style text := lower(btrim(coalesce(p_style, '')));
  v_body text := btrim(coalesce(p_body, ''));
  v_paper text := lower(btrim(coalesce(p_paper_style, '')));
  v_envelope text := lower(btrim(coalesce(p_envelope_style, '')));
  v_sticker text := nullif(lower(btrim(coalesce(p_sticker, ''))), '');
  v_excerpt text;
  v_today_count int;
begin
  select * into v_me from public.friend_identity(p_token);
  if not found then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;
  if p_client_token is null then
    return jsonb_build_object('ok', false, 'error', 'bad_client_token');
  end if;

  -- Serialize sends by sender. This closes the check-then-insert race for
  -- duplicate client tokens and the 30-second / daily rate limits.
  perform pg_advisory_xact_lock(
    hashtext(v_me.app || ':' || v_me.account_id::text)::bigint
  );

  select * into v_existing
  from public.friend_letters
  where sender_app = v_me.app
    and sender_account_id = v_me.account_id
    and client_token = p_client_token
  limit 1;
  if v_existing.id is not null then
    return jsonb_build_object(
      'ok', true,
      'duplicate', true,
      'letter', jsonb_build_object(
        'id', v_existing.id,
        'style', v_existing.style,
        'recipientName', v_existing.recipient_name,
        'excerpt', left(regexp_replace(v_existing.body, E'\\s+', ' ', 'g'), 60),
        'createdAt', v_existing.created_at
      )
    );
  end if;

  if v_style not in ('warm', 'cute', 'romantic') then
    return jsonb_build_object('ok', false, 'error', 'bad_style');
  end if;
  if char_length(v_body) = 0 or char_length(v_body) > 2000 then
    return jsonb_build_object('ok', false, 'error', 'bad_body');
  end if;
  if v_paper not in ('paper-cream', 'paper-sakura', 'paper-night') then
    return jsonb_build_object('ok', false, 'error', 'bad_paper');
  end if;
  if v_envelope not in ('envelope-kraft', 'envelope-blue', 'envelope-rose') then
    return jsonb_build_object('ok', false, 'error', 'bad_envelope');
  end if;
  if v_sticker is not null and v_sticker not in (
    'sticker-heart', 'sticker-star', 'sticker-leaf',
    'sticker-paw', 'sticker-flower', 'sticker-bow'
  ) then
    return jsonb_build_object('ok', false, 'error', 'bad_sticker');
  end if;

  select * into v_link from public.friend_active_link_v2(p_token);
  if v_link.link_id is null then
    return jsonb_build_object('ok', false, 'error', 'link_inactive');
  end if;

  if p_reply_to is not null then
    select * into v_original
    from public.friend_letters
    where id = p_reply_to;
    if v_original.id is null
       or v_original.link_id is distinct from v_link.link_id
       or v_original.recipient_app is distinct from v_link.me_app
       or v_original.recipient_account_id is distinct from v_link.me_id
       or v_original.sender_app is distinct from v_link.other_app
       or v_original.sender_account_id is distinct from v_link.other_id then
      return jsonb_build_object('ok', false, 'error', 'bad_reply');
    end if;
  end if;

  if exists (
    select 1 from public.friend_letters
    where sender_app = v_link.me_app
      and sender_account_id = v_link.me_id
      and created_at > now() - interval '30 seconds'
  ) then
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;

  select count(*) into v_today_count
  from public.friend_letters
  where sender_app = v_link.me_app
    and sender_account_id = v_link.me_id
    and created_at >= (
      date_trunc('day', now() AT TIME ZONE 'Asia/Shanghai')
      AT TIME ZONE 'Asia/Shanghai'
    );
  if v_today_count >= 30 then
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;

  insert into public.friend_letters (
    link_id,
    sender_app, sender_account_id, sender_name,
    recipient_app, recipient_account_id, recipient_name,
    style, body, paper_style, envelope_style, sticker,
    reply_to_id, client_token
  ) values (
    v_link.link_id,
    v_link.me_app, v_link.me_id, v_link.me_name,
    v_link.other_app, v_link.other_id, v_link.other_name,
    v_style, v_body, v_paper, v_envelope, v_sticker,
    p_reply_to, p_client_token
  ) returning id into v_id;

  v_excerpt := left(regexp_replace(v_body, E'\\s+', ' ', 'g'), 60);

  insert into public.friend_events (
    link_id, target_app, target_account_id, type, payload
  ) values (
    v_link.link_id,
    v_link.other_app,
    v_link.other_id,
    'letter_received',
    jsonb_build_object(
      'letterId', v_id,
      'from', v_link.me_name,
      'style', v_style,
      'excerpt', v_excerpt
    )
  );

  return jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'letter', jsonb_build_object(
      'id', v_id,
      'style', v_style,
      'recipientName', v_link.other_name,
      'excerpt', v_excerpt,
      'createdAt', now()
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- list / history
-- ---------------------------------------------------------------------------

create or replace function public.friend_letter_list(
  p_token text,
  p_box text default 'inbox',
  p_limit int default 20,
  p_before timestamptz default null,
  p_before_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_me record;
  v_box text := lower(coalesce(p_box, 'inbox'));
  v_limit int := greatest(1, least(50, coalesce(p_limit, 20)));
  v_rows jsonb;
  v_next timestamptz;
  v_next_id uuid;
  v_has_more boolean;
begin
  select * into v_me from public.friend_identity(p_token);
  if not found then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;
  if v_box not in ('inbox', 'sent', 'all') then
    return jsonb_build_object('ok', false, 'error', 'bad_box');
  end if;

  select coalesce(jsonb_agg(item order by created_at desc, id desc), '[]'::jsonb)
  into v_rows
  from (
    select
      jsonb_build_object(
        'id', l.id,
        'linkId', l.link_id,
        'direction', case
          when l.recipient_app = v_me.app and l.recipient_account_id = v_me.account_id then 'received'
          else 'sent'
        end,
        'senderName', l.sender_name,
        'recipientName', l.recipient_name,
        'style', l.style,
        'paperStyle', l.paper_style,
        'envelopeStyle', l.envelope_style,
        'sticker', l.sticker,
        'excerpt', left(regexp_replace(l.body, E'\\s+', ' ', 'g'), 60),
        'read', case
          when l.recipient_app = v_me.app and l.recipient_account_id = v_me.account_id
            then l.read_at is not null
          else null
        end,
        'hearted', l.hearted_at is not null,
        'favorited', l.favorited_at is not null,
        'replyToId', l.reply_to_id,
        'linkStatus', coalesce(fl.status, 'deleted'),
        'createdAt', l.created_at
      ) as item,
      l.id,
      l.created_at
    from public.friend_letters l
    left join public.friend_links fl on fl.id = l.link_id
    where (
      (v_box = 'inbox' and l.recipient_app = v_me.app and l.recipient_account_id = v_me.account_id)
      or (v_box = 'sent' and l.sender_app = v_me.app and l.sender_account_id = v_me.account_id)
      or (v_box = 'all' and (
        (l.recipient_app = v_me.app and l.recipient_account_id = v_me.account_id)
        or (l.sender_app = v_me.app and l.sender_account_id = v_me.account_id)
      ))
    )
      and (
        p_before is null
        or l.created_at < p_before
        or (
          p_before_id is not null
          and l.created_at = p_before
          and l.id < p_before_id
        )
      )
    order by l.created_at desc, l.id desc
    limit v_limit
  ) x;

  select l.created_at, l.id
  into v_next, v_next_id
  from (
    select l.created_at, l.id
    from public.friend_letters l
    where (
      (v_box = 'inbox' and l.recipient_app = v_me.app and l.recipient_account_id = v_me.account_id)
      or (v_box = 'sent' and l.sender_app = v_me.app and l.sender_account_id = v_me.account_id)
      or (v_box = 'all' and (
        (l.recipient_app = v_me.app and l.recipient_account_id = v_me.account_id)
        or (l.sender_app = v_me.app and l.sender_account_id = v_me.account_id)
      ))
    )
      and (
        p_before is null
        or l.created_at < p_before
        or (
          p_before_id is not null
          and l.created_at = p_before
          and l.id < p_before_id
        )
      )
    order by l.created_at desc, l.id desc
    limit v_limit
  ) l
  order by l.created_at asc, l.id asc
  limit 1;

  -- Only expose a next cursor when there is a row older than the last row of
  -- this page. A full last page must not advertise another page.
  if v_next is not null
     and jsonb_array_length(v_rows) >= v_limit then
    select exists (
      select 1
      from public.friend_letters l
      where (
        (v_box = 'inbox' and l.recipient_app = v_me.app and l.recipient_account_id = v_me.account_id)
        or (v_box = 'sent' and l.sender_app = v_me.app and l.sender_account_id = v_me.account_id)
        or (v_box = 'all' and (
          (l.recipient_app = v_me.app and l.recipient_account_id = v_me.account_id)
          or (l.sender_app = v_me.app and l.sender_account_id = v_me.account_id)
        ))
      )
        and (
          l.created_at < v_next
          or (
            l.created_at = v_next
            and l.id < v_next_id
          )
        )
    ) into v_has_more;

    if not coalesce(v_has_more, false) then
      v_next := null;
      v_next_id := null;
    end if;
  else
    v_next := null;
    v_next_id := null;
  end if;

  return jsonb_build_object(
    'ok', true,
    'letters', v_rows,
    'nextBefore', v_next,
    'nextBeforeId', v_next_id
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- get
-- ---------------------------------------------------------------------------

create or replace function public.friend_letter_get(
  p_token text,
  p_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_me record;
  v_letter public.friend_letters%rowtype;
  v_link record;
  v_is_recipient boolean;
  v_can_reply boolean := false;
  v_can_react boolean := false;
  v_payload jsonb;
begin
  select * into v_me from public.friend_identity(p_token);
  if not found then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;

  select * into v_letter
  from public.friend_letters
  where id = p_id
    and (
      (sender_app = v_me.app and sender_account_id = v_me.account_id)
      or (recipient_app = v_me.app and recipient_account_id = v_me.account_id)
    )
  limit 1;

  -- Do not reveal whether another person's letter exists.
  if v_letter.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  v_is_recipient := v_letter.recipient_app = v_me.app
    and v_letter.recipient_account_id = v_me.account_id;

  select * into v_link from public.friend_active_link_v2(p_token);
  if v_is_recipient
     and v_link.link_id is not null
     and v_link.link_id = v_letter.link_id then
    v_can_reply := true;
    v_can_react := true;
  end if;

  v_payload := jsonb_build_object(
    'id', v_letter.id,
    'linkId', v_letter.link_id,
    'style', v_letter.style,
    'body', v_letter.body,
    'paperStyle', v_letter.paper_style,
    'envelopeStyle', v_letter.envelope_style,
    'sticker', v_letter.sticker,
    'senderName', v_letter.sender_name,
    'recipientName', v_letter.recipient_name,
    'replyToId', v_letter.reply_to_id,
    'hearted', v_letter.hearted_at is not null,
    'favorited', v_letter.favorited_at is not null,
    'createdAt', v_letter.created_at,
    'linkStatus', case
      when v_letter.link_id is null then 'deleted'
      when exists (select 1 from public.friend_links where id = v_letter.link_id and status = 'active') then 'active'
      else 'unbound'
    end
  );

  -- Read status is visible only to the recipient. This is not a read receipt
  -- to the sender.
  if v_is_recipient then
    v_payload := v_payload || jsonb_build_object('read', v_letter.read_at is not null);
  end if;

  return jsonb_build_object(
    'ok', true,
    'letter', v_payload,
    'canReply', v_can_reply,
    'canReact', v_can_react
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- mark read
-- ---------------------------------------------------------------------------

create or replace function public.friend_letter_read(
  p_token text,
  p_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_me record;
  v_letter public.friend_letters%rowtype;
begin
  select * into v_me from public.friend_identity(p_token);
  if not found then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;

  select * into v_letter
  from public.friend_letters
  where id = p_id
    and recipient_app = v_me.app
    and recipient_account_id = v_me.account_id
  limit 1;

  if v_letter.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  update public.friend_letters
  set read_at = coalesce(read_at, now())
  where id = v_letter.id;

  return jsonb_build_object('ok', true, 'read', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- heart / favorite
-- ---------------------------------------------------------------------------

create or replace function public.friend_letter_react(
  p_token text,
  p_id uuid,
  p_kind text
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_me record;
  v_link record;
  v_letter public.friend_letters%rowtype;
  v_kind text := lower(btrim(coalesce(p_kind, '')));
begin
  select * into v_me from public.friend_identity(p_token);
  if not found then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;
  if v_kind not in ('heart', 'favorite') then
    return jsonb_build_object('ok', false, 'error', 'bad_kind');
  end if;

  select * into v_link from public.friend_active_link_v2(p_token);
  if v_link.link_id is null then
    return jsonb_build_object('ok', false, 'error', 'link_inactive');
  end if;

  select * into v_letter
  from public.friend_letters
  where id = p_id
    and link_id = v_link.link_id
  limit 1;

  if v_letter.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if v_letter.recipient_app is distinct from v_me.app
     or v_letter.recipient_account_id is distinct from v_me.account_id then
    return jsonb_build_object('ok', false, 'error', 'not_recipient');
  end if;

  if v_kind = 'heart' then
    update public.friend_letters
    set hearted_at = coalesce(hearted_at, now())
    where id = v_letter.id;
  else
    update public.friend_letters
    set favorited_at = coalesce(favorited_at, now())
    where id = v_letter.id;
  end if;

  select * into v_letter from public.friend_letters where id = p_id;

  return jsonb_build_object(
    'ok', true,
    'hearted', v_letter.hearted_at is not null,
    'favorited', v_letter.favorited_at is not null
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- unread
-- ---------------------------------------------------------------------------

create or replace function public.friend_letter_unread(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_me record;
  v_count int;
begin
  select * into v_me from public.friend_identity(p_token);
  if not found then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;

  select count(*) into v_count
  from public.friend_letters
  where recipient_app = v_me.app
    and recipient_account_id = v_me.account_id
    and read_at is null;

  return jsonb_build_object('ok', true, 'count', v_count);
end;
$$;

-- ---------------------------------------------------------------------------
-- permissions
-- ---------------------------------------------------------------------------

revoke all on function public.friend_letter_send(text, text, text, text, text, text, uuid, uuid) from public;
revoke all on function public.friend_letter_list(text, text, int, timestamptz, uuid) from public;
revoke all on function public.friend_letter_get(text, uuid) from public;
revoke all on function public.friend_letter_read(text, uuid) from public;
revoke all on function public.friend_letter_react(text, uuid, text) from public;
revoke all on function public.friend_letter_unread(text) from public;

grant execute on function public.friend_letter_send(text, text, text, text, text, text, uuid, uuid) to anon, authenticated;
grant execute on function public.friend_letter_list(text, text, int, timestamptz, uuid) to anon, authenticated;
grant execute on function public.friend_letter_get(text, uuid) to anon, authenticated;
grant execute on function public.friend_letter_read(text, uuid) to anon, authenticated;
grant execute on function public.friend_letter_react(text, uuid, text) to anon, authenticated;
grant execute on function public.friend_letter_unread(text) to anon, authenticated;

commit;
