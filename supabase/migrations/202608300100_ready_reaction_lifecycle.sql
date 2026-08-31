create table if not exists public.readied_actions (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  character_id uuid not null references public.characters(id) on delete cascade,
  round_number integer not null,
  block_index integer not null,
  trigger_text text not null check (char_length(trigger_text) between 3 and 500),
  action_id text not null,
  action_name text not null,
  status text not null default 'armed' check (status in ('armed','triggered','resolved','expired','cancelled')),
  triggered_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  unique(campaign_id, round_number, user_id)
);

create index if not exists readied_actions_campaign_status_idx
  on public.readied_actions(campaign_id, status, round_number);
create index if not exists readied_actions_user_id_idx on public.readied_actions(user_id);

alter table public.readied_actions enable row level security;
revoke all on table public.readied_actions from anon, authenticated;
grant all on table public.readied_actions to service_role;
create policy "readied actions are server only" on public.readied_actions
  for all to anon, authenticated using (false) with check (false);

alter table public.reaction_windows
  add column if not exists ready_action_id uuid references public.readied_actions(id) on delete set null;
create unique index if not exists reaction_windows_one_ready_trigger_idx
  on public.reaction_windows(ready_action_id) where ready_action_id is not null;

revoke update on table public.reaction_windows from anon, authenticated;
drop policy if exists "players resolve own reactions" on public.reaction_windows;

create or replace function public.expire_stale_combat_windows(p_campaign_id uuid, p_round_number integer)
returns void language plpgsql security invoker set search_path = public as $$
begin
  update public.reaction_windows
     set resolved=true,
         resolution=jsonb_build_object('type','expired','at',now())
   where campaign_id=p_campaign_id and not resolved and deadline <= now();
  update public.readied_actions
     set status='expired', resolved_at=now()
   where campaign_id=p_campaign_id and status in ('armed','triggered') and round_number < p_round_number;
end;
$$;
revoke all on function public.expire_stale_combat_windows(uuid,integer) from public, anon, authenticated;
grant execute on function public.expire_stale_combat_windows(uuid,integer) to service_role;

