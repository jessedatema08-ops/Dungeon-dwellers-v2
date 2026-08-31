create table if not exists public.combat_action_economy (
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  round_number integer not null,
  block_index integer not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  action_used boolean not null default false,
  attack_action_started boolean not null default false,
  attacks_used integer not null default 0 check (attacks_used >= 0),
  bonus_action_used boolean not null default false,
  reaction_used boolean not null default false,
  movement_used_ft numeric not null default 0 check (movement_used_ft >= 0),
  request_ids uuid[] not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (campaign_id, round_number, block_index, user_id)
);
alter table public.combat_action_economy enable row level security;
revoke all on table public.combat_action_economy from anon, authenticated;
grant all on table public.combat_action_economy to service_role;
create index if not exists combat_action_economy_user_id_idx on public.combat_action_economy(user_id);
create policy "combat economy is server only" on public.combat_action_economy for all to anon,authenticated using (false) with check (false);

create or replace function public.consume_combat_resource(p_campaign_id uuid,p_round_number integer,p_block_index integer,p_user_id uuid,p_resource text,p_request_id uuid,p_amount numeric default 0,p_limit numeric default 0) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare r public.combat_action_economy;
begin
  if p_resource not in ('action','attack','bonus_action','reaction','movement') then raise exception 'Unknown combat resource'; end if;
  insert into public.combat_action_economy(campaign_id,round_number,block_index,user_id) values(p_campaign_id,p_round_number,p_block_index,p_user_id) on conflict do nothing;
  select * into r from public.combat_action_economy where campaign_id=p_campaign_id and round_number=p_round_number and block_index=p_block_index and user_id=p_user_id for update;
  if p_request_id = any(r.request_ids) then return to_jsonb(r); end if;
  if p_resource='action' and r.action_used then raise exception 'Your Action is already spent this turn'; end if;
  if p_resource='attack' and r.action_used and not r.attack_action_started then raise exception 'Your Action is already spent this turn'; end if;
  if p_resource='attack' and r.attacks_used>=greatest(1,p_limit::integer) then raise exception 'All attacks from your Attack action are already spent'; end if;
  if p_resource='bonus_action' and r.bonus_action_used then raise exception 'Your Bonus Action is already spent this turn'; end if;
  if p_resource='reaction' and r.reaction_used then raise exception 'Your Reaction is already spent this round'; end if;
  if p_resource='movement' and r.movement_used_ft+greatest(0,p_amount)>greatest(0,p_limit) then raise exception 'That movement exceeds your remaining speed'; end if;
  update public.combat_action_economy set action_used=action_used or p_resource in ('action','attack'),attack_action_started=attack_action_started or p_resource='attack',attacks_used=attacks_used+case when p_resource='attack' then 1 else 0 end,bonus_action_used=bonus_action_used or p_resource='bonus_action',reaction_used=reaction_used or p_resource='reaction',movement_used_ft=movement_used_ft+case when p_resource='movement' then greatest(0,p_amount) else 0 end,request_ids=array_append(request_ids,p_request_id),updated_at=now() where campaign_id=p_campaign_id and round_number=p_round_number and block_index=p_block_index and user_id=p_user_id returning * into r;
  return to_jsonb(r);
end $$;
revoke all on function public.consume_combat_resource(uuid,integer,integer,uuid,text,uuid,numeric,numeric) from public,anon,authenticated;
grant execute on function public.consume_combat_resource(uuid,integer,integer,uuid,text,uuid,numeric,numeric) to service_role;

