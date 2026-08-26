-- Run after supabase-final-migration.sql.
-- Lets each authenticated player submit only their own initiative roll.

drop policy if exists "players submit own initiative" on public.initiative_entries;
drop policy if exists "players update own initiative" on public.initiative_entries;

create policy "players submit own initiative" on public.initiative_entries
for insert to authenticated
with check (
  side='player'
  and user_id=auth.uid()
  and public.is_campaign_member(campaign_id)
);

create policy "players update own initiative" on public.initiative_entries
for update to authenticated
using (
  side='player'
  and user_id=auth.uid()
  and public.is_campaign_member(campaign_id)
)
with check (
  side='player'
  and user_id=auth.uid()
  and public.is_campaign_member(campaign_id)
);
