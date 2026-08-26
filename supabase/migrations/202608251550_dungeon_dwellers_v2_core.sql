-- Dungeon Dwellers V2 compact authoritative state.
-- One row per campaign for engine, memory, and encounter state keeps free-tier storage/read volume predictable.

create table if not exists public.campaign_engine_state (
  campaign_id uuid primary key references public.campaigns(id) on delete cascade,
  state jsonb not null default '{"version":2,"party":{},"world":{},"combat":{},"timers":{}}'::jsonb,
  revision bigint not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.campaign_memory (
  campaign_id uuid primary key references public.campaigns(id) on delete cascade,
  public_summary text not null default '',
  private_state jsonb not null default '{"npcs":{},"factions":{},"threads":[],"promises":[],"consequences":[],"locations":{},"clues":[],"timeline":[]}'::jsonb,
  last_story_id bigint,
  updated_at timestamptz not null default now()
);

create table if not exists public.encounter_state (
  campaign_id uuid primary key references public.campaigns(id) on delete cascade,
  encounter_id uuid not null default gen_random_uuid(),
  active boolean not null default false,
  public_state jsonb not null default '{"round":0,"phase":"none","effects":[],"log":[]}'::jsonb,
  hidden_state jsonb not null default '{"combatants":{},"pending":[],"resources":{}}'::jsonb,
  revision bigint not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.campaign_engine_state enable row level security;
alter table public.campaign_memory enable row level security;
alter table public.encounter_state enable row level security;

drop policy if exists "members read engine state" on public.campaign_engine_state;
create policy "members read engine state" on public.campaign_engine_state for select
  using (public.is_campaign_member(campaign_id) or public.is_campaign_owner(campaign_id));

-- Hidden memory and encounter mechanics are intentionally service-role only.
-- The campaign owner is a normal player during play and must not be able to query hidden enemy state from the browser.
revoke all on public.campaign_engine_state from anon, authenticated;
grant select on public.campaign_engine_state to authenticated;
revoke all on public.campaign_memory from anon, authenticated;
revoke all on public.encounter_state from anon, authenticated;

create or replace function public.dd_bootstrap_v2_campaign_state()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  insert into public.campaign_engine_state(campaign_id) values(new.id) on conflict do nothing;
  insert into public.campaign_memory(campaign_id) values(new.id) on conflict do nothing;
  insert into public.encounter_state(campaign_id) values(new.id) on conflict do nothing;
  insert into public.campaign_world_maps(campaign_id) values(new.id) on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists dd_bootstrap_v2_campaign_state_after_insert on public.campaigns;
create trigger dd_bootstrap_v2_campaign_state_after_insert
after insert on public.campaigns
for each row execute function public.dd_bootstrap_v2_campaign_state();

insert into public.campaign_engine_state(campaign_id) select id from public.campaigns on conflict do nothing;
insert into public.campaign_memory(campaign_id) select id from public.campaigns on conflict do nothing;
insert into public.encounter_state(campaign_id) select id from public.campaigns on conflict do nothing;
insert into public.campaign_world_maps(campaign_id) select id from public.campaigns on conflict do nothing;

create or replace function public.dd_prune_chat_messages_per_campaign()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  delete from public.chat_messages
  where id in (
    select id from public.chat_messages
    where campaign_id=new.campaign_id
    order by created_at desc,id desc
    offset 800
  );
  return new;
end;
$$;

drop trigger if exists dd_prune_chat_messages_after_insert on public.chat_messages;
create trigger dd_prune_chat_messages_after_insert
after insert on public.chat_messages
for each row execute function public.dd_prune_chat_messages_per_campaign();

create or replace function public.dd_v2_activate_combat_after_initiative()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  pending boolean;
  player_count integer;
  entry_count integer;
  turn_hours integer;
begin
  select coalesce((state #>> '{combat,pendingInitiative}')::boolean,false)
    into pending from public.campaign_engine_state where campaign_id=new.campaign_id;
  if not pending or new.side <> 'player' then return new; end if;

  select count(*) into player_count from public.characters where campaign_id=new.campaign_id;
  select count(*) into entry_count from public.initiative_entries
    where campaign_id=new.campaign_id and side='player' and defeated=false;

  if player_count > 0 and entry_count >= player_count then
    with ranked as (
      select id,side,row_number() over(partition by side order by initiative desc,id) rn,
             count(*) over(partition by side) cnt
      from public.initiative_entries where campaign_id=new.campaign_id and defeated=false
    )
    update public.initiative_entries i set block_index=case
      when r.side='player' and r.rn <= ceil(r.cnt/2.0) then 1
      when r.side='player' then 3
      when r.side='enemy' and r.rn <= ceil(r.cnt/2.0) then 2
      else 4 end
    from ranked r where i.id=r.id;

    select greatest(1,least(24,coalesce((settings->>'combatTurnHours')::integer,6))) into turn_hours
      from public.campaigns where id=new.campaign_id;
    update public.campaigns set active_block='player_1',round_number=1,
      active_deadline=now()+make_interval(hours=>turn_hours),deadline_type='combat_block',updated_at=now()
      where id=new.campaign_id;
    update public.campaign_engine_state set state=jsonb_set(state,'{combat}',
      coalesce(state->'combat','{}'::jsonb) || jsonb_build_object('active',true,'pendingInitiative',false,'round',1,'activeBlock','player_1','startedAt',now()),true)
      where campaign_id=new.campaign_id;
  end if;
  return new;
end;
$$;

drop trigger if exists dd_v2_activate_combat_after_initiative on public.initiative_entries;
create trigger dd_v2_activate_combat_after_initiative
after insert or update on public.initiative_entries
for each row execute function public.dd_v2_activate_combat_after_initiative();

create index if not exists chat_messages_campaign_created_idx on public.chat_messages(campaign_id,created_at);
create index if not exists chat_messages_private_recipients_gin on public.chat_messages using gin(recipient_user_ids);
create index if not exists story_events_campaign_created_idx on public.story_events(campaign_id,created_at desc);
create index if not exists initiative_campaign_block_idx on public.initiative_entries(campaign_id,block_index,initiative desc);
create index if not exists tokens_campaign_map_idx on public.tokens(campaign_id,map_id);

-- Trigger functions execute only through their triggers, never through the Data API.
revoke execute on function public.dd_bootstrap_v2_campaign_state() from public, anon, authenticated;
revoke execute on function public.dd_prune_chat_messages_per_campaign() from public, anon, authenticated;
revoke execute on function public.dd_v2_activate_combat_after_initiative() from public, anon, authenticated;
