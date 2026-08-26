alter table public.campaign_maps add column if not exists map_kind text not null default 'tactical', add column if not exists location_key text, add column if not exists north_angle numeric not null default 0;
alter table public.campaign_maps drop constraint if exists campaign_maps_map_kind_check;
alter table public.campaign_maps add constraint campaign_maps_map_kind_check check (map_kind in ('tactical','uploaded'));
create unique index if not exists campaign_maps_location_floor_uidx on public.campaign_maps(campaign_id,location_key,name) where location_key is not null;

alter table public.tokens add column if not exists map_id uuid references public.campaign_maps(id) on delete set null;
create index if not exists tokens_campaign_map_idx on public.tokens(campaign_id,map_id);

create table if not exists public.campaign_world_maps (
  campaign_id uuid primary key references public.campaigns(id) on delete cascade,
  state jsonb not null default '{"version":1,"northAngle":0,"locations":[],"routes":[],"currentLocationId":null}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.campaign_world_maps enable row level security;

drop policy if exists "members read world map" on public.campaign_world_maps;
create policy "members read world map" on public.campaign_world_maps for select to authenticated using (public.is_campaign_member(campaign_id) or public.is_campaign_owner(campaign_id));
drop policy if exists "owners manage world map" on public.campaign_world_maps;
create policy "owners manage world map" on public.campaign_world_maps for all to authenticated using (public.is_campaign_owner(campaign_id)) with check (public.is_campaign_owner(campaign_id));

grant select,insert,update,delete on public.campaign_world_maps to authenticated;
grant select,insert,update,delete on public.campaign_maps to authenticated;
grant select,update on public.tokens to authenticated;
grant select,insert,update on public.map_views to authenticated;

drop policy if exists "players insert own map view" on public.map_views;
create policy "players insert own map view" on public.map_views for insert to authenticated with check (user_id=(select auth.uid()) and exists(select 1 from public.campaign_maps m where m.id=map_id and (public.is_campaign_member(m.campaign_id) or public.is_campaign_owner(m.campaign_id))));
drop policy if exists "players update own map view" on public.map_views;
create policy "players update own map view" on public.map_views for update to authenticated using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));