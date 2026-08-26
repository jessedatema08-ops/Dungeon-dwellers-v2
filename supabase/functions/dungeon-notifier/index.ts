import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type, x-cron-secret','Access-Control-Allow-Methods':'POST, OPTIONS'};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}});
function inQuietHours(start:string|null,end:string|null,now=new Date()){if(!start||!end)return false;const mins=(s:string)=>{const [h,m]=s.split(':').map(Number);return h*60+m;};const cur=now.getHours()*60+now.getMinutes(),a=mins(start),b=mins(end);return a===b?false:(a<b?cur>=a&&cur<b:cur>=a||cur<b);}
Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
  if(req.method!=='POST')return json({ok:false,error:'POST required'},405);
  const cronSecret=Deno.env.get('NOTIFIER_CRON_SECRET')||'';if(cronSecret&&req.headers.get('x-cron-secret')!==cronSecret)return json({ok:false,error:'Unauthorized'},401);
  const supabaseUrl=Deno.env.get('SUPABASE_URL')!,service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const vapidPublic=Deno.env.get('VAPID_PUBLIC_KEY')||'',vapidPrivate=Deno.env.get('VAPID_PRIVATE_KEY')||'',subject=Deno.env.get('VAPID_SUBJECT')||'mailto:admin@example.com';
  if(!vapidPublic||!vapidPrivate)return json({ok:false,error:'VAPID secrets are not configured'},500);webpush.setVapidDetails(subject,vapidPublic,vapidPrivate);
  const admin=createClient(supabaseUrl,service);const {data:rows,error}=await admin.from('notification_outbox').select('*').is('sent_at',null).is('failed_at',null).lte('deliver_after',new Date().toISOString()).order('id').limit(100);if(error)return json({ok:false,error:error.message},500);
  let sent=0,skipped=0,failed=0;
  for(const row of rows||[]){
    const {data:pref}=await admin.from('notification_preferences').select('*').eq('campaign_id',row.campaign_id).eq('user_id',row.user_id).maybeSingle();
    const keyMap:any={turn:'turn_open',turn_open:'turn_open',halfway:'halfway',one_hour:'one_hour',turn_expired:'turn_expired',reaction:'reaction',round:'round_resolved',round_resolved:'round_resolved',scene:'new_scene',new_scene:'new_scene',mention:'mentions',mentions:'mentions',pause_resume:'pause_resume',major_character:'major_character',attacked:'major_character',afflicted:'major_character',info:'major_character'};const enabledKey=keyMap[row.kind];
    if(pref&&enabledKey&&pref[enabledKey]===false){await admin.from('notification_outbox').update({sent_at:new Date().toISOString(),failure:'disabled-by-user'}).eq('id',row.id);skipped++;continue;}
    if(pref&&inQuietHours(pref.quiet_start,pref.quiet_end)){await admin.from('notification_outbox').update({deliver_after:new Date(Date.now()+30*60000).toISOString()}).eq('id',row.id);skipped++;continue;}
    if(pref?.mode==='digest'&&!['reaction','turn_expired'].includes(row.kind)){await admin.from('notification_outbox').update({deliver_after:new Date(Date.now()+6*3600000).toISOString()}).eq('id',row.id);skipped++;continue;}
    if(pref?.mode==='important'&&!['reaction','turn','turn_open','one_hour','turn_expired','major_character','attacked','afflicted'].includes(row.kind)){await admin.from('notification_outbox').update({sent_at:new Date().toISOString(),failure:'filtered-important-only'}).eq('id',row.id);skipped++;continue;}
    const {data:subs}=await admin.from('push_subscriptions').select('*').eq('user_id',row.user_id);if(!subs?.length){await admin.from('notification_outbox').update({failed_at:new Date().toISOString(),failure:'no-push-subscription'}).eq('id',row.id);failed++;continue;}
    let any=false;for(const sub of subs){try{await webpush.sendNotification({endpoint:sub.endpoint,keys:{p256dh:sub.p256dh,auth:sub.auth}},JSON.stringify({title:row.title,body:row.body,data:row.data||{}}));any=true;}catch(e:any){if(e?.statusCode===404||e?.statusCode===410)await admin.from('push_subscriptions').delete().eq('id',sub.id);}}
    if(any){await admin.from('notification_outbox').update({sent_at:new Date().toISOString()}).eq('id',row.id);sent++;}else{await admin.from('notification_outbox').update({failed_at:new Date().toISOString(),failure:'all-subscriptions-failed'}).eq('id',row.id);failed++;}
  }
  return json({ok:true,sent,skipped,failed});
});