-- Dungeon Dwellers final production migration v3
-- Run after supabase-final-v2.sql.

create or replace function public.dd_initialize_scene_deadline()
returns trigger
language plpgsql
set search_path=public
as $$
declare scene_hours numeric;
begin
  if new.active_block is null and new.active_deadline is null then
    scene_hours := coalesce((new.settings->>'sceneTurnHours')::numeric,24);
    new.active_deadline := now() + make_interval(secs => (scene_hours*3600)::int);
    new.deadline_type := 'scene_turn';
    new.state := coalesce(new.state,'{}'::jsonb) || jsonb_build_object('scene_turn_number',coalesce((new.state->>'scene_turn_number')::int,1));
  end if;
  return new;
end;
$$;

drop trigger if exists dd_initialize_scene_deadline on public.campaigns;
create trigger dd_initialize_scene_deadline
before insert on public.campaigns
for each row execute function public.dd_initialize_scene_deadline();

-- Backfill existing non-combat campaigns that have no scene deadline.
update public.campaigns
set active_deadline = now() + make_interval(secs => (coalesce((settings->>'sceneTurnHours')::numeric,24)*3600)::int),
    deadline_type = 'scene_turn',
    state = coalesce(state,'{}'::jsonb) || jsonb_build_object('scene_turn_number',coalesce((state->>'scene_turn_number')::int,1)),
    updated_at = now()
where active_block is null and active_deadline is null;
