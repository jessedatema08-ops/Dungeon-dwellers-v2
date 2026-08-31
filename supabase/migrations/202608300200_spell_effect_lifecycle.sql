create table if not exists public.combat_effects (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  source_character_id uuid references public.characters(id) on delete cascade,
  target_character_id uuid references public.characters(id) on delete cascade,
  target_token_id uuid references public.tokens(id) on delete cascade,
  effect_type text not null,
  name text not null,
  state jsonb not null default '{}'::jsonb,
  concentration boolean not null default false,
  started_round integer,
  expires_round integer,
  save_ability text,
  save_dc integer,
  save_timing text,
  active boolean not null default true,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  check ((target_character_id is not null) <> (target_token_id is not null))
);

alter table public.readied_actions
  add column if not exists slot_level integer check (slot_level between 0 and 9),
  add column if not exists resource_committed boolean not null default false;

create index if not exists combat_effects_campaign_active_idx
  on public.combat_effects(campaign_id, active, expires_round);
create index if not exists combat_effects_source_character_idx
  on public.combat_effects(source_character_id) where active;
create index if not exists combat_effects_target_character_idx
  on public.combat_effects(target_character_id) where active;
create index if not exists combat_effects_target_token_idx
  on public.combat_effects(target_token_id) where active;

alter table public.combat_effects enable row level security;
revoke all on table public.combat_effects from anon, authenticated;
grant all on table public.combat_effects to service_role;
create policy "combat effects are server only" on public.combat_effects
  for all to anon, authenticated using (false) with check (false);

create or replace function public.expire_combat_effects(p_campaign_id uuid, p_round_number integer)
returns integer language plpgsql security invoker set search_path = public as $$
declare affected integer;
begin
  update public.combat_effects set active=false, ended_at=now()
   where campaign_id=p_campaign_id and active and expires_round is not null and expires_round <= p_round_number;
  get diagnostics affected = row_count;
  return affected;
end;
$$;
revoke all on function public.expire_combat_effects(uuid,integer) from public, anon, authenticated;
grant execute on function public.expire_combat_effects(uuid,integer) to service_role;

create or replace function public.expire_stale_combat_windows(p_campaign_id uuid, p_round_number integer)
returns void language plpgsql security invoker set search_path = public as $$
begin
  update public.reaction_windows
     set resolved=true, resolution=jsonb_build_object('type','expired','at',now())
   where campaign_id=p_campaign_id and not resolved and deadline <= now();
  update public.readied_actions
     set status='expired', resolved_at=now()
   where campaign_id=p_campaign_id and status in ('armed','triggered') and round_number < p_round_number;
  update public.characters c
     set profile=jsonb_set(coalesce(c.profile,'{}'::jsonb),'{concentration}','{"active":false}'::jsonb,true), updated_at=now()
   where c.campaign_id=p_campaign_id
     and coalesce(c.profile#>>'{concentration,readied}','false')='true'
     and exists (
       select 1 from public.readied_actions r
       where r.character_id=c.id and r.status='expired'
         and r.action_id=c.profile#>>'{concentration,actionId}'
     );
end;
$$;
revoke all on function public.expire_stale_combat_windows(uuid,integer) from public, anon, authenticated;
grant execute on function public.expire_stale_combat_windows(uuid,integer) to service_role;

