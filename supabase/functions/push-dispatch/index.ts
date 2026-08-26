import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type, x-dd-push-secret'};
const IMPORTANT=new Set(['turn_open','one_hour','turn_expired','reaction','major_character']);

Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
  try{
    const secret=Deno.env.get('DD_PUSH_SECRET')||'';
    if(!secret||req.headers.get('x-dd-push-secret')!==secret)return new Response(JSON.stringify({error:'unauthorized'}),{status:401,headers:{...cors,'Content-Type':'application/json'}});
    const sbUrl=Deno.env.get('SUPABASE_URL')!,service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,vapidPublic=Deno.env.get('VAPID_PUBLIC_KEY')!,vapidPrivate=Deno.env.get('VAPID_PRIVATE_KEY')!,vapidSubject=Deno.env.get('VAPID_SUBJECT')||'mailto:admin@example.com';
    if(!vapidPublic||!vapidPrivate)throw new Error('VAPID keys are not configured');
    webpush.setVapidDetails(vapidSubject,vapidPublic,vapidPrivate);
    const supabase=createClient(sbUrl,service,{auth:{persistSession:false}});
    const body=await req.json();const {campaign_id,user_ids,type,title,body:message,url:targetUrl,tag,force=false}=body;
    if(!campaign_id||!Array.isArray(user_ids)||!type)throw new Error('campaign_id, user_ids, and type are required');
    const prefColumn={turn_open:'turn_open',halfway:'halfway',one_hour:'one_hour',turn_expired:'turn_expired',reaction:'reaction',round_resolved:'round_resolved',new_scene:'new_scene',mentions:'mentions',pause_resume:'pause_resume',major_character:'major_character'}[type];
    if(!prefColumn&&!force)throw new Error(`Unsupported notification type: ${type}`);
    const {data:prefs,error:prefError}=await supabase.from('notification_preferences').select('*').eq('campaign_id',campaign_id).in('user_id',user_ids);if(prefError)throw prefError;
    const now=new Date(),deferred:string[]=[];
    const allowed=(prefs||[]).filter((p:any)=>{
      if(!force&&prefColumn&&!p[prefColumn])return false;
      if(!force&&p.mode==='important'&&!IMPORTANT.has(type))return false;
      if(!force&&p.mode==='digest'){deferred.push(p.user_id);return false;}
      if(p.quiet_start&&p.quiet_end){const hh=String(now.getUTCHours()).padStart(2,'0'),mm=String(now.getUTCMinutes()).padStart(2,'0'),cur=`${hh}:${mm}:00`;const quiet=p.quiet_start<p.quiet_end?(cur>=p.quiet_start&&cur<p.quiet_end):(cur>=p.quiet_start||cur<p.quiet_end);if(quiet&&!force)return false;}
      return true;
    }).map((p:any)=>p.user_id);
    if(!allowed.length)return new Response(JSON.stringify({ok:true,sent:0,deferred_user_ids:deferred}),{headers:{...cors,'Content-Type':'application/json'}});
    const {data:subs,error:subError}=await supabase.from('push_subscriptions').select('*').in('user_id',allowed);if(subError)throw subError;
    let sent=0,removed=0;const payload=JSON.stringify({title:title||'Dungeon Dwellers',body:message||'Your campaign has an update.',url:targetUrl||'https://jessedatema08-ops.github.io/Dungeon-dwellers/',tag:tag||`dd-${type}`});
    for(const sub of subs||[]){try{await webpush.sendNotification({endpoint:sub.endpoint,keys:{p256dh:sub.p256dh,auth:sub.auth}},payload);sent++;}catch(err){const status=(err as any)?.statusCode;if(status===404||status===410){await supabase.from('push_subscriptions').delete().eq('id',sub.id);removed++;}else console.error('Push failed',sub.id,err);}}
    return new Response(JSON.stringify({ok:true,sent,removed,deferred_user_ids:deferred}),{headers:{...cors,'Content-Type':'application/json'}});
  }catch(err){return new Response(JSON.stringify({error:String((err as Error).message||err)}),{status:400,headers:{...cors,'Content-Type':'application/json'}});}
});