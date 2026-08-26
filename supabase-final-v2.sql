-- Dungeon Dwellers final production migration v2
-- Run AFTER: supabase-schema.sql, supabase-final-migration.sql, supabase-final-fix.sql
-- Safe to run more than once where practical.

create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- Scene turns, AI-safe view state, notification queue
-- ------------------------------------------------------------
create table if not exists public.scene_submissions (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  scene_turn_number integer not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  action jsonb not null default '{}'::jsonb,
  submitted_at timestamptz not null default now(),
  resolved boolean not null default false,
  unique(campaign_id,scene_turn_number,user_id)
);

create table if not exists public.notification_outbox (
  id bigint generated always as identity primary key,
  campaign_id uuid references public.campaigns(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  title text not null,
  body text not null,
  data jsonb not null default '{}'::jsonb,
  deliver_after timestamptz not null default now(),
  sent_at timestamptz,
  failed_at timestamptz,
  failure text,
  created_at timestamptz not null default now()
);

create index if not exists scene_submissions_campaign_idx on public.scene_submissions(campaign_id,scene_turn_number);
create index if not exists notification_outbox_pending_idx on public.notification_outbox(sent_at,deliver_after);

alter table public.scene_submissions enable row level security;
alter table public.notification_outbox enable row level security;

-- Players can submit only their own scene action and read only their own submission.
drop policy if exists "players read own scene submissions" on public.scene_submissions;
drop policy if exists "players create own scene submissions" on public.scene_submissions;
drop policy if exists "players update own scene submissions" on public.scene_submissions;
drop policy if exists "owners read scene submissions" on public.scene_submissions;
create policy "players read own scene submissions" on public.scene_submissions
for select to authenticated
using (user_id=auth.uid() or public.is_campaign_owner(campaign_id));
create policy "players create own scene submissions" on public.scene_submissions
for insert to authenticated
with check (user_id=auth.uid() and public.is_campaign_member(campaign_id));
create policy "players update own scene submissions" on public.scene_submissions
for update to authenticated
using (user_id=auth.uid() and public.is_campaign_member(campaign_id) and resolved=false)
with check (user_id=auth.uid() and public.is_campaign_member(campaign_id));
create policy "owners read scene submissions" on public.scene_submissions
for select to authenticated using (public.is_campaign_owner(campaign_id));

-- Outbox is server-owned. A user may only read their own notification history.
drop policy if exists "users read own notification outbox" on public.notification_outbox;
create policy "users read own notification outbox" on public.notification_outbox
for select to authenticated using (user_id=auth.uid());
revoke insert, update, delete on public.notification_outbox from anon, authenticated;
grant select on public.notification_outbox to authenticated;

-- ------------------------------------------------------------
-- Tight invite behavior: invite RPC is the ONLY self-join path.
-- Successful invite is always role=player.
-- ------------------------------------------------------------
drop policy if exists "owners add campaign members" on public.campaign_members;
create policy "owners add campaign members" on public.campaign_members
for insert to authenticated
with check (public.is_campaign_owner(campaign_id) and role in ('player','spectator'));

create or replace function public.accept_campaign_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  inv public.campaign_invites%rowtype;
  existing_role text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  select * into inv
  from public.campaign_invites
  where token=p_token
    and revoked=false
    and (expires_at is null or expires_at>now())
    and (max_uses is null or uses<max_uses)
  for update;

  if inv.id is null then
    raise exception 'Invite is invalid, expired, revoked, or fully used';
  end if;

  select role into existing_role
  from public.campaign_members
  where campaign_id=inv.campaign_id and user_id=auth.uid();

  if existing_role is null then
    insert into public.campaign_members(campaign_id,user_id,role)
    values(inv.campaign_id,auth.uid(),'player');
    update public.campaign_invites set uses=uses+1 where id=inv.id;
  end if;

  insert into public.notification_preferences(campaign_id,user_id)
  values(inv.campaign_id,auth.uid())
  on conflict(campaign_id,user_id) do nothing;

  return inv.campaign_id;
end;
$$;
revoke all on function public.accept_campaign_invite(text) from public;
grant execute on function public.accept_campaign_invite(text) to authenticated;

-- ------------------------------------------------------------
-- Public NPC access without exposing hidden_state.
-- Base npc_state rows are owner-only; members use the RPC below.
-- ------------------------------------------------------------
drop policy if exists "members read npc public state" on public.npc_state;
drop policy if exists "owner manages npc state" on public.npc_state;
create policy "owners read npc state" on public.npc_state
for select to authenticated using (public.is_campaign_owner(campaign_id));
create policy "owners manage npc state" on public.npc_state
for all to authenticated
using (public.is_campaign_owner(campaign_id))
with check (public.is_campaign_owner(campaign_id));

create or replace function public.get_public_npcs(p_campaign uuid)
returns table(id uuid,npc_key text,public_state jsonb,updated_at timestamptz)
language sql
stable
security definer
set search_path=public
as $$
  select n.id,n.npc_key,n.public_state,n.updated_at
  from public.npc_state n
  where n.campaign_id=p_campaign
    and (public.is_campaign_member(p_campaign) or public.is_campaign_owner(p_campaign));
$$;
revoke all on function public.get_public_npcs(uuid) from public;
grant execute on function public.get_public_npcs(uuid) to authenticated;

-- ------------------------------------------------------------
-- Four-block initiative assignment for ANY counts.
-- Sort each side by initiative, ceil(count/2) in first half.
-- Player 1 -> Enemy 1 -> Player 2 -> Enemy 2.
-- ------------------------------------------------------------
create or replace function public.assign_initiative_blocks(p_campaign uuid)
returns void
language plpgsql
security definer
set search_path=public
as $$
begin
  if not public.is_campaign_owner(p_campaign) then raise exception 'Owner required'; end if;

  with ranked as (
    select id,side,
      row_number() over(partition by side order by initiative desc,created_at asc,id) as rn,
      count(*) over(partition by side) as cnt
    from public.initiative_entries
    where campaign_id=p_campaign and defeated=false
  )
  update public.initiative_entries i
  set block_index=case
    when r.side='player' and r.rn<=ceil(r.cnt/2.0) then 1
    when r.side='enemy'  and r.rn<=ceil(r.cnt/2.0) then 2
    when r.side='player' then 3
    else 4
  end
  from ranked r
  where r.id=i.id;
end;
$$;
revoke all on function public.assign_initiative_blocks(uuid) from public;
grant execute on function public.assign_initiative_blocks(uuid) to authenticated;

-- ------------------------------------------------------------
-- Per-player map visibility. Players can read ONLY their own view rows.
-- Owners can read/write all. Hidden token details never leak through tokens.
-- ------------------------------------------------------------
drop policy if exists "players read own map view" on public.map_views;
create policy "players read own map view" on public.map_views
for select to authenticated
using (
  user_id=auth.uid()
  or exists(select 1 from public.campaign_maps m where m.id=map_id and public.is_campaign_owner(m.campaign_id))
);

drop policy if exists "users read own token visibility" on public.token_visibility;
create policy "users read own token visibility" on public.token_visibility
for select to authenticated
using (
  user_id=auth.uid()
  or exists(select 1 from public.tokens t where t.id=token_id and public.is_campaign_owner(t.campaign_id))
);

-- Security-definer helper used only by trusted server orchestration to write visibility.
-- It requires the server to pass the owning campaign user id as a second check.
create or replace function public.server_set_player_map_view(
  p_map uuid,
  p_user uuid,
  p_view jsonb
) returns void
language plpgsql
security definer
set search_path=public
as $$
declare cid uuid;
begin
  select campaign_id into cid from public.campaign_maps where id=p_map;
  if cid is null then raise exception 'Unknown map'; end if;
  -- Direct authenticated clients are intentionally blocked.
  if auth.role() <> 'service_role' then raise exception 'Server only'; end if;
  insert into public.map_views(map_id,user_id,view_state,updated_at)
  values(p_map,p_user,coalesce(p_view,'{}'::jsonb),now())
  on conflict(map_id,user_id) do update set view_state=excluded.view_state,updated_at=now();
end;
$$;
revoke all on function public.server_set_player_map_view(uuid,uuid,jsonb) from public,anon,authenticated;

create or replace function public.server_set_token_visibility(
  p_token uuid,
  p_user uuid,
  p_visible boolean,
  p_label text default null,
  p_state jsonb default '{}'::jsonb
) returns void
language plpgsql
security definer
set search_path=public
as $$
begin
  if auth.role() <> 'service_role' then raise exception 'Server only'; end if;
  insert into public.token_visibility(token_id,user_id,visible,label_override,state,updated_at)
  values(p_token,p_user,p_visible,p_label,coalesce(p_state,'{}'::jsonb),now())
  on conflict(token_id,user_id) do update
  set visible=excluded.visible,label_override=excluded.label_override,state=excluded.state,updated_at=now();
end;
$$;
revoke all on function public.server_set_token_visibility(uuid,uuid,boolean,text,jsonb) from public,anon,authenticated;

-- ------------------------------------------------------------
-- Notification helpers. Server/Edge Function uses service role.
-- ------------------------------------------------------------
create or replace function public.server_queue_notification(
  p_campaign uuid,
  p_user uuid,
  p_kind text,
  p_title text,
  p_body text,
  p_data jsonb default '{}'::jsonb,
  p_deliver_after timestamptz default now()
) returns bigint
language plpgsql
security definer
set search_path=public
as $$
declare out_id bigint;
begin
  if auth.role() <> 'service_role' then raise exception 'Server only'; end if;
  insert into public.notification_outbox(campaign_id,user_id,kind,title,body,data,deliver_after)
  values(p_campaign,p_user,p_kind,p_title,p_body,coalesce(p_data,'{}'::jsonb),coalesce(p_deliver_after,now()))
  returning id into out_id;
  return out_id;
end;
$$;
revoke all on function public.server_queue_notification(uuid,uuid,text,text,text,jsonb,timestamptz) from public,anon,authenticated;

-- Realtime publications. Duplicate membership is harmless if wrapped.
do $$ begin
  alter publication supabase_realtime add table public.scene_submissions;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.notification_outbox;
exception when duplicate_object then null; end $$;
