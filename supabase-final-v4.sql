-- Dungeon Dwellers final production migration v4
-- Run after supabase-final-v3.sql.
-- Completes server notification coverage for party mentions and pause/resume.

-- Queue notifications for explicit @mentions stored in chat_messages.mentions.
create or replace function public.dd_queue_chat_mentions()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  target uuid;
  sender_name text;
begin
  select coalesce(c.display_name,c.name,'A party member') into sender_name
  from public.characters c
  where c.campaign_id=new.campaign_id and c.user_id=new.user_id
  limit 1;
  sender_name := coalesce(sender_name,'A party member');

  foreach target in array coalesce(new.mentions,'{}'::uuid[]) loop
    if target<>new.user_id and exists(
      select 1 from public.campaign_members cm
      where cm.campaign_id=new.campaign_id and cm.user_id=target
    ) then
      insert into public.notification_outbox(campaign_id,user_id,kind,title,body,data)
      values(
        new.campaign_id,
        target,
        'mentions',
        'Party Mention',
        left(sender_name||' mentioned you: '||new.body,180),
        jsonb_build_object('campaignId',new.campaign_id,'chatMessageId',new.id)
      );
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists dd_chat_mentions on public.chat_messages;
create trigger dd_chat_mentions
after insert on public.chat_messages
for each row execute function public.dd_queue_chat_mentions();

-- Queue pause/resume notifications for every member except the owner who changed it.
create or replace function public.dd_queue_pause_resume()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  m record;
  label text;
begin
  if old.paused is distinct from new.paused then
    label := case when new.paused then 'Campaign Paused' else 'Campaign Resumed' end;
    for m in select user_id from public.campaign_members where campaign_id=new.id loop
      insert into public.notification_outbox(campaign_id,user_id,kind,title,body,data)
      values(
        new.id,
        m.user_id,
        'pause_resume',
        label,
        case when new.paused
          then new.name||' has been paused. Turn and AI progression timers are frozen.'
          else new.name||' has resumed. Turn and AI progression timers are active again.'
        end,
        jsonb_build_object('campaignId',new.id,'paused',new.paused)
      );
    end loop;
  end if;
  return new;
end;
$$;

drop trigger if exists dd_campaign_pause_resume on public.campaigns;
create trigger dd_campaign_pause_resume
after update of paused on public.campaigns
for each row execute function public.dd_queue_pause_resume();

-- Keep notification outbox inaccessible for writes from normal clients.
revoke insert,update,delete on public.notification_outbox from anon,authenticated;
grant select on public.notification_outbox to authenticated;
