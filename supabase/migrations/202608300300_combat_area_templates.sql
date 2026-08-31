create table if not exists public.combat_areas (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  map_id uuid not null references public.campaign_maps(id) on delete cascade,
  source_character_id uuid references public.characters(id) on delete cascade,
  request_id uuid not null,
  name text not null,
  shape text not null check (shape in ('sphere','circle','cylinder','cone','cube','square','line')),
  geometry jsonb not null,
  style jsonb not null default '{}'::jsonb,
  started_round integer,
  expires_round integer,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists combat_areas_request_idx on public.combat_areas(campaign_id,request_id);
create index if not exists combat_areas_campaign_active_idx on public.combat_areas(campaign_id,active,expires_round);
create index if not exists combat_areas_map_idx on public.combat_areas(map_id) where active;
create index if not exists combat_areas_source_idx on public.combat_areas(source_character_id) where active;
alter table public.combat_areas enable row level security;
revoke all on table public.combat_areas from anon, authenticated;
grant all on table public.combat_areas to service_role;
create policy "combat areas are server only" on public.combat_areas for all to anon,authenticated using(false) with check(false);

create or replace function public.expire_combat_areas(p_campaign_id uuid,p_round_number integer)
returns integer language plpgsql security invoker set search_path=public as $$
declare affected integer;
begin
  update public.combat_areas set active=false
   where campaign_id=p_campaign_id and active and expires_round is not null and expires_round <= p_round_number;
  get diagnostics affected=row_count;
  return affected;
end;
$$;
revoke all on function public.expire_combat_areas(uuid,integer) from public,anon,authenticated;
grant execute on function public.expire_combat_areas(uuid,integer) to service_role;

