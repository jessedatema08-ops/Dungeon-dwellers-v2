-- Run after the other production migrations.
-- Adds asynchronous non-combat Scene Turns with a 24-hour default window.

create table if not exists public.scene_submissions (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  scene_turn_number integer not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  action jsonb not null default '{}'::jsonb,
  submitted_at timestamptz not null default now(),
  unique(campaign_id,scene_turn_number,user_id)
);
alter table public.scene_submissions enable row level security;

create policy "players read own scene submissions" on public.scene_submissions
for select to authenticated using (user_id=auth.uid() or public.is_campaign_owner(campaign_id));
create policy "players submit own scene actions" on public.scene_submissions
for insert to authenticated with check (user_id=auth.uid() and public.is_campaign_member(campaign_id));
create policy "players revise own scene action" on public.scene_submissions
for update to authenticated using (user_id=auth.uid() and public.is_campaign_member(campaign_id))
with check (user_id=auth.uid() and public.is_campaign_member(campaign_id));

alter table public.campaigns alter column active_block set default 'scene';
alter table public.campaigns alter column active_deadline set default (now()+interval '24 hours');
update public.campaigns
set active_block='scene',
    active_deadline=coalesce(active_deadline,now()+interval '24 hours'),
    deadline_type='scene_turn',
    state=coalesce(state,'{}'::jsonb)||jsonb_build_object('scene_turn_number',coalesce((state->>'scene_turn_number')::int,1))
where active_block is null;

do $$ begin alter publication supabase_realtime add table public.scene_submissions; exception when duplicate_object then null; end $$;
