create extension if not exists pgcrypto;

create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  paused boolean not null default false,
  current_scene text,
  game_time text,
  initiative_style text not null default 'Initiative Blocks',
  active_deadline timestamptz,
  deadline_type text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.campaign_members (
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'player' check (role in ('owner','player','spectator')),
  joined_at timestamptz not null default now(),
  primary key (campaign_id,user_id)
);

create table if not exists public.characters (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  rules_edition text not null default '2024',
  profile jsonb not null default '{}'::jsonb,
  hp integer,
  max_hp integer,
  ac integer,
  x numeric,
  y numeric,
  updated_at timestamptz not null default now(),
  unique(campaign_id,user_id)
);

create table if not exists public.tokens (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  character_id uuid references public.characters(id) on delete set null,
  token_type text not null default 'pc',
  name text,
  x numeric not null default 0,
  y numeric not null default 0,
  rotation numeric not null default 0,
  hidden boolean not null default false,
  group_id text,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.story_events (
  id bigint generated always as identity primary key,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.knowledge (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  visibility text not null default 'public' check (visibility in ('public','party','private')),
  fact text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.quests (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  title text not null,
  status text not null default 'active',
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.npc_state (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  npc_key text not null,
  public_state jsonb not null default '{}'::jsonb,
  hidden_state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique(campaign_id,npc_key)
);

alter table public.campaigns enable row level security;
alter table public.campaign_members enable row level security;
alter table public.characters enable row level security;
alter table public.tokens enable row level security;
alter table public.story_events enable row level security;
alter table public.knowledge enable row level security;
alter table public.quests enable row level security;
alter table public.npc_state enable row level security;

create or replace function public.is_campaign_member(cid uuid)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select exists(
    select 1 from public.campaign_members cm
    where cm.campaign_id=cid and cm.user_id=auth.uid()
  );
$$;

create or replace function public.is_campaign_owner(cid uuid)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select exists(
    select 1 from public.campaigns c
    where c.id=cid and c.owner_id=auth.uid()
  );
$$;

create policy "campaign members read campaigns" on public.campaigns
for select to authenticated using (owner_id=auth.uid() or public.is_campaign_member(id));
create policy "owners create campaigns" on public.campaigns
for insert to authenticated with check (owner_id=auth.uid());
create policy "owners update campaigns" on public.campaigns
for update to authenticated using (owner_id=auth.uid()) with check (owner_id=auth.uid());

create policy "members read membership" on public.campaign_members
for select to authenticated using (user_id=auth.uid() or public.is_campaign_owner(campaign_id));
create policy "owners add members" on public.campaign_members
for insert to authenticated with check (public.is_campaign_owner(campaign_id) or user_id=auth.uid());
create policy "owners manage members" on public.campaign_members
for update to authenticated using (public.is_campaign_owner(campaign_id));
create policy "owners remove members" on public.campaign_members
for delete to authenticated using (public.is_campaign_owner(campaign_id));

create policy "members read characters" on public.characters
for select to authenticated using (public.is_campaign_member(campaign_id) or public.is_campaign_owner(campaign_id));
create policy "players create own character" on public.characters
for insert to authenticated with check (user_id=auth.uid() and (public.is_campaign_member(campaign_id) or public.is_campaign_owner(campaign_id)));
create policy "players update own character" on public.characters
for update to authenticated using (user_id=auth.uid() or public.is_campaign_owner(campaign_id)) with check (user_id=auth.uid() or public.is_campaign_owner(campaign_id));

create policy "members read tokens" on public.tokens
for select to authenticated using (public.is_campaign_member(campaign_id) or public.is_campaign_owner(campaign_id));
create policy "members change tokens" on public.tokens
for all to authenticated using (public.is_campaign_member(campaign_id) or public.is_campaign_owner(campaign_id)) with check (public.is_campaign_member(campaign_id) or public.is_campaign_owner(campaign_id));

create policy "members read events" on public.story_events
for select to authenticated using (public.is_campaign_member(campaign_id) or public.is_campaign_owner(campaign_id));
create policy "members append events" on public.story_events
for insert to authenticated with check ((public.is_campaign_member(campaign_id) or public.is_campaign_owner(campaign_id)) and (actor_user_id is null or actor_user_id=auth.uid()));

create policy "knowledge visibility" on public.knowledge
for select to authenticated using (
  public.is_campaign_owner(campaign_id)
  or (public.is_campaign_member(campaign_id) and visibility in ('public','party'))
  or (visibility='private' and user_id=auth.uid())
);
create policy "members add knowledge" on public.knowledge
for insert to authenticated with check (public.is_campaign_member(campaign_id) or public.is_campaign_owner(campaign_id));

create policy "members read quests" on public.quests
for select to authenticated using (public.is_campaign_member(campaign_id) or public.is_campaign_owner(campaign_id));
create policy "owner manages quests" on public.quests
for all to authenticated using (public.is_campaign_owner(campaign_id)) with check (public.is_campaign_owner(campaign_id));

create policy "members read npc public state" on public.npc_state
for select to authenticated using (public.is_campaign_member(campaign_id) or public.is_campaign_owner(campaign_id));
create policy "owner manages npc state" on public.npc_state
for all to authenticated using (public.is_campaign_owner(campaign_id)) with check (public.is_campaign_owner(campaign_id));

alter publication supabase_realtime add table public.campaigns;
alter publication supabase_realtime add table public.tokens;
