-- Run after supabase-final-migration.sql and supabase-final-fix.sql.
-- Creates a server-side queue so closed-app push can honor each player's preferences.

create table if not exists public.notification_queue (
  id bigint generated always as identity primary key,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null,
  title text not null,
  body text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  delivered_at timestamptz
);
alter table public.notification_queue enable row level security;
-- No browser policies: queue is backend-only. Service-role Edge Functions bypass RLS.

create or replace function public.queue_reaction_notification()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.notification_queue(campaign_id,user_id,event_type,title,body,payload)
  values(new.campaign_id,new.user_id,'reaction','Reaction Available',coalesce(new.trigger->>'text',new.trigger->>'label','The AI DM is waiting for your reaction.'),jsonb_build_object('reaction_id',new.id));
  return new;
end;$$;
drop trigger if exists dd_queue_reaction on public.reaction_windows;
create trigger dd_queue_reaction after insert on public.reaction_windows for each row execute function public.queue_reaction_notification();

create or replace function public.queue_chat_mentions()
returns trigger language plpgsql security definer set search_path=public as $$
declare uid uuid;
begin
  foreach uid in array new.mentions loop
    if uid<>new.user_id then
      insert into public.notification_queue(campaign_id,user_id,event_type,title,body,payload)
      values(new.campaign_id,uid,'mentions','Party Mention',left(new.body,180),jsonb_build_object('message_id',new.id));
    end if;
  end loop;
  return new;
end;$$;
drop trigger if exists dd_queue_chat_mentions on public.chat_messages;
create trigger dd_queue_chat_mentions after insert on public.chat_messages for each row execute function public.queue_chat_mentions();

create or replace function public.queue_campaign_change()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if old.paused is distinct from new.paused then
    insert into public.notification_queue(campaign_id,user_id,event_type,title,body)
    select new.id,cm.user_id,'pause_resume',case when new.paused then 'Campaign Paused' else 'Campaign Resumed' end,case when new.paused then 'Campaign timers and AI progression are paused.' else 'Campaign progression has resumed.' end
    from public.campaign_members cm where cm.campaign_id=new.id;
  end if;
  if old.current_scene is distinct from new.current_scene and new.current_scene is not null then
    insert into public.notification_queue(campaign_id,user_id,event_type,title,body)
    select new.id,cm.user_id,'new_scene','New AI DM Scene',left(new.current_scene,180)
    from public.campaign_members cm where cm.campaign_id=new.id;
  end if;
  return new;
end;$$;
drop trigger if exists dd_queue_campaign_change on public.campaigns;
create trigger dd_queue_campaign_change after update on public.campaigns for each row execute function public.queue_campaign_change();

-- A browser may only queue a major-character notification for itself inside a campaign it belongs to.
-- Backend service-role calls can queue for any affected campaign member.
create or replace function public.queue_major_character_event(p_campaign uuid,p_user uuid,p_title text,p_body text)
returns void language plpgsql security definer set search_path=public as $$
begin
  if auth.role()<>'service_role' then
    if auth.uid() is null or auth.uid()<>p_user or not public.is_campaign_member(p_campaign) then
      raise exception 'Not allowed';
    end if;
  end if;
  insert into public.notification_queue(campaign_id,user_id,event_type,title,body)
  values(p_campaign,p_user,'major_character',coalesce(p_title,'Character Update'),left(coalesce(p_body,'Your character has an important update.'),180));
end;$$;
revoke all on function public.queue_major_character_event(uuid,uuid,text,text) from public;
grant execute on function public.queue_major_character_event(uuid,uuid,text,text) to authenticated,service_role;

do $$ begin alter publication supabase_realtime add table public.notification_queue; exception when duplicate_object then null; end $$;
