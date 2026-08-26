create or replace function public.prune_story_events_per_campaign()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.story_events
  where campaign_id = new.campaign_id
    and id in (
      select id
      from public.story_events
      where campaign_id = new.campaign_id
      order by created_at desc, id desc
      offset 250
    );
  return new;
end;
$$;

drop trigger if exists prune_story_events_after_insert on public.story_events;
create trigger prune_story_events_after_insert
after insert on public.story_events
for each row execute function public.prune_story_events_per_campaign();

with ranked as (
  select id,
         row_number() over (partition by campaign_id order by created_at desc, id desc) as rn
  from public.story_events
)
delete from public.story_events s
using ranked r
where s.id = r.id
  and r.rn > 250;
