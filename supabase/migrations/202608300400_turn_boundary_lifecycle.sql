alter table public.reaction_windows
  add column if not exists boundary_key text;

create unique index if not exists reaction_windows_boundary_key_idx
  on public.reaction_windows(campaign_id, boundary_key)
  where boundary_key is not null;

create index if not exists combat_effects_save_timing_idx
  on public.combat_effects(campaign_id, save_timing)
  where active and save_ability is not null;

revoke update on table public.reaction_windows from anon, authenticated;


