drop policy if exists "owners manage engine state" on public.campaign_engine_state;
drop policy if exists "owners manage campaign memory" on public.campaign_memory;
drop policy if exists "owners read campaign memory" on public.campaign_memory;
drop policy if exists "owners manage encounter state" on public.encounter_state;
drop policy if exists "owners read encounter state" on public.encounter_state;

revoke all on public.campaign_engine_state from anon, authenticated;
grant select on public.campaign_engine_state to authenticated;

revoke all on public.campaign_memory from anon, authenticated;
revoke all on public.encounter_state from anon, authenticated;
