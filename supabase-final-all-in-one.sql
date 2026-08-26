-- Dungeon Dwellers — FINAL ALL-IN-ONE MIGRATION
-- Run this ONCE after the original supabase-schema.sql.
-- This combines: supabase-final-migration.sql, supabase-final-fix.sql,
-- supabase-final-v2.sql, supabase-final-v3.sql, supabase-final-v4.sql.

-- ============================================================
-- PART 1 — production migration
-- ============================================================
create extension if not exists pgcrypto;

alter table public.campaigns add column if not exists chapter integer not null default 1;
alter table public.campaigns add column if not exists settings jsonb not null default '{"combatTurnHours":6,"reactionWindowHours":1,"sceneTurnHours":24,"initiativeStyle":"initiative_blocks"}'::jsonb;
alter table public.campaigns add column if not exists active_block text;
alter table public.campaigns add column if not exists round_number integer not null default 0;
alter table public.campaigns add column if not exists state jsonb not null default '{}'::jsonb;

alter table public.characters add column if not exists display_name text;
alter table public.characters add column if not exists source text not null default 'manual';
alter table public.characters add column if not exists import_meta jsonb not null default '{}'::jsonb;

alter table public.tokens add column if not exists initiative numeric;
alter table public.tokens add column if not exists owner_user_id uuid references auth.users(id) on delete set null;

create table if not exists public.campaign_invites (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  token text not null unique default encode(gen_random_bytes(18),'hex'),
  expires_at timestamptz,
  max_uses integer,
  uses integer not null default 0,
  revoked boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.notification_preferences (
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  mode text not null default 'immediate' check (mode in ('immediate','important','digest')),
  turn_open boolean not null default true,
  halfway boolean not null default true,
  one_hour boolean not null default true,
  turn_expired boolean not null default true,
  reaction boolean not null default true,
  round_resolved boolean not null default true,
  new_scene boolean not null default true,
  mentions boolean not null default true,
  pause_resume boolean not null default true,
  major_character boolean not null default true,
  quiet_start time,
  quiet_end time,
  updated_at timestamptz not null default now(),
  primary key(campaign_id,user_id)
);

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table if not exists public.campaign_maps (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  name text not null default 'Campaign Map',
  storage_path text,
  generated_spec jsonb not null default '{}'::jsonb,
  width integer,
  height integer,
  grid_size numeric not null default 50,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.map_views (
  map_id uuid not null references public.campaign_maps(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  view_state jsonb not null default '{"explored":[],"visible":[],"lighting":{}}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key(map_id,user_id)
);

create table if not exists public.token_visibility (
  token_id uuid not null references public.tokens(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  visible boolean not null default true,
  label_override text,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key(token_id,user_id)
);

create table if not exists public.initiative_entries (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  combatant_key text not null,
  side text not null check (side in ('player','enemy')),
  user_id uuid references auth.users(id) on delete set null,
  token_id uuid references public.tokens(id) on delete set null,
  display_name text not null,
  initiative numeric not null,
  block_index integer,
  defeated boolean not null default false,
  state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(campaign_id,combatant_key)
);

create table if not exists public.turn_submissions (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  round_number integer not null,
  block_index integer not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  action jsonb not null default '{}'::jsonb,
  submitted_at timestamptz not null default now(),
  unique(campaign_id,round_number,block_index,user_id)
);

create table if not exists public.reaction_windows (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  trigger jsonb not null default '{}'::jsonb,
  legal_options jsonb not null default '[]'::jsonb,
  deadline timestamptz not null,
  resolved boolean not null default false,
  resolution jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.chat_messages (
  id bigint generated always as identity primary key,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  body text not null,
  mentions uuid[] not null default '{}',
  created_at timestamptz not null default now()
);

alter table public.campaign_invites enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.campaign_maps enable row level security;
alter table public.map_views enable row level security;
alter table public.token_visibility enable row level security;
alter table public.initiative_entries enable row level security;
alter table public.turn_submissions enable row level security;
alter table public.reaction_windows enable row level security;
alter table public.chat_messages enable row level security;

drop policy if exists "owners add members" on public.campaign_members;
drop policy if exists "members read membership" on public.campaign_members;
drop policy if exists "members read campaign membership" on public.campaign_members;
drop policy if exists "owners add campaign members" on public.campaign_members;
create policy "members read campaign membership" on public.campaign_members
for select to authenticated using (public.is_campaign_member(campaign_id) or public.is_campaign_owner(campaign_id));
create policy "owners add campaign members" on public.campaign_members
for insert to authenticated with check (public.is_campaign_owner(campaign_id));

drop policy if exists "members read tokens" on public.tokens;
drop policy if exists "members change tokens" on public.tokens;
drop policy if exists "members read visible tokens" on public.tokens;
drop policy if exists "owners manage all tokens" on public.tokens;
drop policy if exists "players update owned tokens" on public.tokens;
create policy "members read visible tokens" on public.tokens
for select to authenticated using (
  public.is_campaign_owner(campaign_id)
  or (public.is_campaign_member(campaign_id) and hidden=false)
  or exists (
    select 1 from public.token_visibility tv
    where tv.token_id=tokens.id and tv.user_id=auth.uid() and tv.visible=true
  )
);
create policy "owners manage all tokens" on public.tokens
for all to authenticated using (public.is_campaign_owner(campaign_id)) with check (public.is_campaign_owner(campaign_id));
create policy "players update owned tokens" on public.tokens
for update to authenticated using (owner_user_id=auth.uid() and public.is_campaign_member(campaign_id))
with check (owner_user_id=auth.uid() and public.is_campaign_member(campaign_id));

drop policy if exists "owners manage invites" on public.campaign_invites;
create policy "owners manage invites" on public.campaign_invites
for all to authenticated using (public.is_campaign_owner(campaign_id)) with check (public.is_campaign_owner(campaign_id) and created_by=auth.uid());

drop policy if exists "members read own notification prefs" on public.notification_preferences;
drop policy if exists "members create own notification prefs" on public.notification_preferences;
drop policy if exists "members update own notification prefs" on public.notification_preferences;
create policy "members read own notification prefs" on public.notification_preferences
for select to authenticated using (user_id=auth.uid() and public.is_campaign_member(campaign_id));
create policy "members create own notification prefs" on public.notification_preferences
for insert to authenticated with check (user_id=auth.uid() and public.is_campaign_member(campaign_id));
create policy "members update own notification prefs" on public.notification_preferences
for update to authenticated using (user_id=auth.uid() and public.is_campaign_member(campaign_id))
with check (user_id=auth.uid() and public.is_campaign_member(campaign_id));

drop policy if exists "users manage own push subscriptions" on public.push_subscriptions;
create policy "users manage own push subscriptions" on public.push_subscriptions
for all to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid());

drop policy if exists "members read campaign maps" on public.campaign_maps;
drop policy if exists "owners manage campaign maps" on public.campaign_maps;
create policy "members read campaign maps" on public.campaign_maps
for select to authenticated using (public.is_campaign_member(campaign_id) or public.is_campaign_owner(campaign_id));
create policy "owners manage campaign maps" on public.campaign_maps
for all to authenticated using (public.is_campaign_owner(campaign_id)) with check (public.is_campaign_owner(campaign_id));

drop policy if exists "players read own map view" on public.map_views;
drop policy if exists "owners manage map views" on public.map_views;
create policy "players read own map view" on public.map_views
for select to authenticated using (
  user_id=auth.uid()
  or exists(select 1 from public.campaign_maps m where m.id=map_id and public.is_campaign_owner(m.campaign_id))
);
create policy "owners manage map views" on public.map_views
for all to authenticated using (
  exists(select 1 from public.campaign_maps m where m.id=map_id and public.is_campaign_owner(m.campaign_id))
) with check (
  exists(select 1 from public.campaign_maps m where m.id=map_id and public.is_campaign_owner(m.campaign_id))
);

drop policy if exists "users read own token visibility" on public.token_visibility;
drop policy if exists "owners manage token visibility" on public.token_visibility;
create policy "users read own token visibility" on public.token_visibility
for select to authenticated using (
  user_id=auth.uid()
  or exists(select 1 from public.tokens t where t.id=token_id and public.is_campaign_owner(t.campaign_id))
);
create policy "owners manage token visibility" on public.token_visibility
for all to authenticated using (
  exists(select 1 from public.tokens t where t.id=token_id and public.is_campaign_owner(t.campaign_id))
) with check (
  exists(select 1 from public.tokens t where t.id=token_id and public.is_campaign_owner(t.campaign_id))
);

drop policy if exists "members read initiative" on public.initiative_entries;
drop policy if exists "owners manage initiative" on public.initiative_entries;
create policy "members read initiative" on public.initiative_entries
for select to authenticated using (public.is_campaign_member(campaign_id) or public.is_campaign_owner(campaign_id));
create policy "owners manage initiative" on public.initiative_entries
for all to authenticated using (public.is_campaign_owner(campaign_id)) with check (public.is_campaign_owner(campaign_id));

drop policy if exists "players read own submissions" on public.turn_submissions;
drop policy if exists "players submit own turns" on public.turn_submissions;
drop policy if exists "players revise own unprocessed turns" on public.turn_submissions;
create policy "players read own submissions" on public.turn_submissions
for select to authenticated using (user_id=auth.uid() or public.is_campaign_owner(campaign_id));
create policy "players submit own turns" on public.turn_submissions
for insert to authenticated with check (user_id=auth.uid() and public.is_campaign_member(campaign_id));
create policy "players revise own unprocessed turns" on public.turn_submissions
for update to authenticated using (user_id=auth.uid() and public.is_campaign_member(campaign_id))
with check (user_id=auth.uid() and public.is_campaign_member(campaign_id));

drop policy if exists "players read own reactions" on public.reaction_windows;
drop policy if exists "players resolve own reactions" on public.reaction_windows;
drop policy if exists "owners manage reaction windows" on public.reaction_windows;
create policy "players read own reactions" on public.reaction_windows
for select to authenticated using (user_id=auth.uid() or public.is_campaign_owner(campaign_id));
create policy "players resolve own reactions" on public.reaction_windows
for update to authenticated using (user_id=auth.uid() and public.is_campaign_member(campaign_id))
with check (user_id=auth.uid() and public.is_campaign_member(campaign_id));
create policy "owners manage reaction windows" on public.reaction_windows
for all to authenticated using (public.is_campaign_owner(campaign_id)) with check (public.is_campaign_owner(campaign_id));

drop policy if exists "members read chat" on public.chat_messages;
drop policy if exists "members send chat" on public.chat_messages;
create policy "members read chat" on public.chat_messages
for select to authenticated using (public.is_campaign_member(campaign_id) or public.is_campaign_owner(campaign_id));
create policy "members send chat" on public.chat_messages
for insert to authenticated with check (user_id=auth.uid() and public.is_campaign_member(campaign_id));

create or replace function public.accept_campaign_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  inv public.campaign_invites%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into inv from public.campaign_invites
  where token=p_token and revoked=false
    and (expires_at is null or expires_at>now())
    and (max_uses is null or uses<max_uses)
  for update;
  if inv.id is null then raise exception 'Invite is invalid, expired, revoked, or fully used'; end if;

  insert into public.campaign_members(campaign_id,user_id,role)
  values(inv.campaign_id,auth.uid(),'player')
  on conflict(campaign_id,user_id) do nothing;
  update public.campaign_invites set uses=uses+1 where id=inv.id;
  insert into public.notification_preferences(campaign_id,user_id)
  values(inv.campaign_id,auth.uid())
  on conflict(campaign_id,user_id) do nothing;
  return inv.campaign_id;
end;
$$;
revoke all on function public.accept_campaign_invite(text) from public;
grant execute on function public.accept_campaign_invite(text) to authenticated;

create or replace function public.assign_initiative_blocks(p_campaign uuid)
returns void
language plpgsql
security definer
set search_path=public
as $$
begin
  if not public.is_campaign_owner(p_campaign) then raise exception 'Owner required'; end if;
  with ranked as (
    select id, side,
      row_number() over(partition by side order by initiative desc, created_at asc) as rn,
      count(*) over(partition by side) as cnt
    from public.initiative_entries
    where campaign_id=p_campaign and defeated=false
  )
  update public.initiative_entries i
  set block_index = case
    when r.side='player' and r.rn<=ceil(r.cnt/2.0) then 1
    when r.side='enemy'  and r.rn<=ceil(r.cnt/2.0) then 2
    when r.side='player' then 3
    else 4
  end
  from ranked r where r.id=i.id;
end;
$$;
revoke all on function public.assign_initiative_blocks(uuid) from public;
grant execute on function public.assign_initiative_blocks(uuid) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('campaign-maps','campaign-maps',false,26214400,array['image/png','image/jpeg','image/webp'])
on conflict(id) do update set public=false,file_size_limit=26214400,allowed_mime_types=array['image/png','image/jpeg','image/webp'];

drop policy if exists "campaign map members read" on storage.objects;
drop policy if exists "campaign map owners upload" on storage.objects;
drop policy if exists "campaign map owners update" on storage.objects;
drop policy if exists "campaign map owners delete" on storage.objects;
create policy "campaign map members read" on storage.objects for select to authenticated
using (bucket_id='campaign-maps' and public.is_campaign_member((storage.foldername(name))[1]::uuid));
create policy "campaign map owners upload" on storage.objects for insert to authenticated
with check (bucket_id='campaign-maps' and public.is_campaign_owner((storage.foldername(name))[1]::uuid));
create policy "campaign map owners update" on storage.objects for update to authenticated
using (bucket_id='campaign-maps' and public.is_campaign_owner((storage.foldername(name))[1]::uuid))
with check (bucket_id='campaign-maps' and public.is_campaign_owner((storage.foldername(name))[1]::uuid));
create policy "campaign map owners delete" on storage.objects for delete to authenticated
using (bucket_id='campaign-maps' and public.is_campaign_owner((storage.foldername(name))[1]::uuid));

do $$ begin alter publication supabase_realtime add table public.campaign_invites; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.notification_preferences; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.campaign_maps; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.map_views; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.token_visibility; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.initiative_entries; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.turn_submissions; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.reaction_windows; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.chat_messages; exception when duplicate_object then null; end $$;

-- ============================================================
-- PART 2 — authenticated players can submit their own initiative
-- ============================================================
drop policy if exists "players submit own initiative" on public.initiative_entries;
drop policy if exists "players update own initiative" on public.initiative_entries;
create policy "players submit own initiative" on public.initiative_entries
for insert to authenticated
with check (side='player' and user_id=auth.uid() and public.is_campaign_member(campaign_id));
create policy "players update own initiative" on public.initiative_entries
for update to authenticated
using (side='player' and user_id=auth.uid() and public.is_campaign_member(campaign_id))
with check (side='player' and user_id=auth.uid() and public.is_campaign_member(campaign_id));

-- ============================================================
-- PART 3 — final production v2
-- ============================================================
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

drop policy if exists "players read own scene submissions" on public.scene_submissions;
drop policy if exists "players create own scene submissions" on public.scene_submissions;
drop policy if exists "players update own scene submissions" on public.scene_submissions;
drop policy if exists "owners read scene submissions" on public.scene_submissions;
create policy "players read own scene submissions" on public.scene_submissions
for select to authenticated using (user_id=auth.uid() or public.is_campaign_owner(campaign_id));
create policy "players create own scene submissions" on public.scene_submissions
for insert to authenticated with check (user_id=auth.uid() and public.is_campaign_member(campaign_id));
create policy "players update own scene submissions" on public.scene_submissions
for update to authenticated using (user_id=auth.uid() and public.is_campaign_member(campaign_id) and resolved=false)
with check (user_id=auth.uid() and public.is_campaign_member(campaign_id));

-- owner read access is already covered by the first SELECT policy above.

drop policy if exists "users read own notification outbox" on public.notification_outbox;
create policy "users read own notification outbox" on public.notification_outbox
for select to authenticated using (user_id=auth.uid());
revoke insert, update, delete on public.notification_outbox from anon, authenticated;
grant select on public.notification_outbox to authenticated;

-- Tighten membership: only owner can add normal rows; invite RPC handles self-join.
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
  select * into inv from public.campaign_invites
  where token=p_token and revoked=false
    and (expires_at is null or expires_at>now())
    and (max_uses is null or uses<max_uses)
  for update;
  if inv.id is null then raise exception 'Invite is invalid, expired, revoked, or fully used'; end if;

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

-- NPC base table becomes owner-only. Members receive public state via RPC.
drop policy if exists "members read npc public state" on public.npc_state;
drop policy if exists "owner manages npc state" on public.npc_state;
drop policy if exists "owners read npc state" on public.npc_state;
drop policy if exists "owners manage npc state" on public.npc_state;
create policy "owners read npc state" on public.npc_state
for select to authenticated using (public.is_campaign_owner(campaign_id));
create policy "owners manage npc state" on public.npc_state
for all to authenticated using (public.is_campaign_owner(campaign_id)) with check (public.is_campaign_owner(campaign_id));

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
  from ranked r where r.id=i.id;
end;
$$;
revoke all on function public.assign_initiative_blocks(uuid) from public;
grant execute on function public.assign_initiative_blocks(uuid) to authenticated;

-- Final per-player map read policies.
drop policy if exists "players read own map view" on public.map_views;
create policy "players read own map view" on public.map_views
for select to authenticated using (
  user_id=auth.uid()
  or exists(select 1 from public.campaign_maps m where m.id=map_id and public.is_campaign_owner(m.campaign_id))
);
drop policy if exists "users read own token visibility" on public.token_visibility;
create policy "users read own token visibility" on public.token_visibility
for select to authenticated using (
  user_id=auth.uid()
  or exists(select 1 from public.tokens t where t.id=token_id and public.is_campaign_owner(t.campaign_id))
);

create or replace function public.server_set_player_map_view(p_map uuid,p_user uuid,p_view jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare cid uuid;
begin
  select campaign_id into cid from public.campaign_maps where id=p_map;
  if cid is null then raise exception 'Unknown map'; end if;
  if auth.role() <> 'service_role' then raise exception 'Server only'; end if;
  insert into public.map_views(map_id,user_id,view_state,updated_at)
  values(p_map,p_user,coalesce(p_view,'{}'::jsonb),now())
  on conflict(map_id,user_id) do update set view_state=excluded.view_state,updated_at=now();
end;
$$;
revoke all on function public.server_set_player_map_view(uuid,uuid,jsonb) from public,anon,authenticated;

create or replace function public.server_set_token_visibility(p_token uuid,p_user uuid,p_visible boolean,p_label text default null,p_state jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path=public as $$
begin
  if auth.role() <> 'service_role' then raise exception 'Server only'; end if;
  insert into public.token_visibility(token_id,user_id,visible,label_override,state,updated_at)
  values(p_token,p_user,p_visible,p_label,coalesce(p_state,'{}'::jsonb),now())
  on conflict(token_id,user_id) do update
  set visible=excluded.visible,label_override=excluded.label_override,state=excluded.state,updated_at=now();
end;
$$;
revoke all on function public.server_set_token_visibility(uuid,uuid,boolean,text,jsonb) from public,anon,authenticated;

create or replace function public.server_queue_notification(
  p_campaign uuid,p_user uuid,p_kind text,p_title text,p_body text,
  p_data jsonb default '{}'::jsonb,p_deliver_after timestamptz default now()
) returns bigint language plpgsql security definer set search_path=public as $$
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

do $$ begin alter publication supabase_realtime add table public.scene_submissions; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.notification_outbox; exception when duplicate_object then null; end $$;

-- ============================================================
-- PART 4 — final production v3: scene-turn deadlines
-- ============================================================
create or replace function public.dd_initialize_scene_deadline()
returns trigger
language plpgsql
set search_path=public
as $$
declare scene_hours numeric;
begin
  if new.active_block is null and new.active_deadline is null then
    scene_hours := coalesce((new.settings->>'sceneTurnHours')::numeric,24);
    new.active_deadline := now() + make_interval(secs => (scene_hours*3600)::int);
    new.deadline_type := 'scene_turn';
    new.state := coalesce(new.state,'{}'::jsonb) || jsonb_build_object('scene_turn_number',coalesce((new.state->>'scene_turn_number')::int,1));
  end if;
  return new;
end;
$$;

drop trigger if exists dd_initialize_scene_deadline on public.campaigns;
create trigger dd_initialize_scene_deadline
before insert on public.campaigns
for each row execute function public.dd_initialize_scene_deadline();

update public.campaigns
set active_deadline = now() + make_interval(secs => (coalesce((settings->>'sceneTurnHours')::numeric,24)*3600)::int),
    deadline_type = 'scene_turn',
    state = coalesce(state,'{}'::jsonb) || jsonb_build_object('scene_turn_number',coalesce((state->>'scene_turn_number')::int,1)),
    updated_at = now()
where active_block is null and active_deadline is null;

-- ============================================================
-- PART 5 — final production v4: mention + pause/resume notifications
-- ============================================================
create or replace function public.dd_queue_chat_mentions()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  target uuid;
  sender_name text;
begin
  select coalesce(c.display_name,c.name,'A party member') into sender_name
  from public.characters c
  where c.campaign_id=new.campaign_id and c.user_id=new.user_id
  limit 1;
  sender_name := coalesce(sender_name,'A party member');

  foreach target in array coalesce(new.mentions,'{}'::uuid[]) loop
    if target<>new.user_id and exists(
      select 1 from public.campaign_members cm
      where cm.campaign_id=new.campaign_id and cm.user_id=target
    ) then
      insert into public.notification_outbox(campaign_id,user_id,kind,title,body,data)
      values(new.campaign_id,target,'mentions','Party Mention',
        left(sender_name||' mentioned you: '||new.body,180),
        jsonb_build_object('campaignId',new.campaign_id,'chatMessageId',new.id));
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists dd_chat_mentions on public.chat_messages;
create trigger dd_chat_mentions
after insert on public.chat_messages
for each row execute function public.dd_queue_chat_mentions();

create or replace function public.dd_queue_pause_resume()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  m record;
  label text;
begin
  if old.paused is distinct from new.paused then
    label := case when new.paused then 'Campaign Paused' else 'Campaign Resumed' end;
    for m in select user_id from public.campaign_members where campaign_id=new.id loop
      insert into public.notification_outbox(campaign_id,user_id,kind,title,body,data)
      values(
        new.id,m.user_id,'pause_resume',label,
        case when new.paused
          then new.name||' has been paused. Turn and AI progression timers are frozen.'
          else new.name||' has resumed. Turn and AI progression timers are active again.'
        end,
        jsonb_build_object('campaignId',new.id,'paused',new.paused)
      );
    end loop;
  end if;
  return new;
end;
$$;

drop trigger if exists dd_campaign_pause_resume on public.campaigns;
create trigger dd_campaign_pause_resume
after update of paused on public.campaigns
for each row execute function public.dd_queue_pause_resume();

revoke insert,update,delete on public.notification_outbox from anon,authenticated;
grant select on public.notification_outbox to authenticated;
