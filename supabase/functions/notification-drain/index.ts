import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const URL=Deno.env.get('SUPABASE_URL')!;
const SERVICE=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const PUSH_SECRET=Deno.env.get('DD_PUSH_SECRET')||'';
const supabase=createClient(URL,SERVICE,{auth:{persistSession:false}});

Deno.serve(async req=>{
  try{
    const tickSecret=Deno.env.get('DD_TICK_SECRET')||'';
    if(tickSecret&&req.headers.get('x-dd-tick-secret')!==tickSecret)return new Response('unauthorized',{status:401});
    const {data:rows,error}=await supabase.from('notification_queue').select('*').is('delivered_at',null).order('created_at').limit(100);if(error)throw error;
    let delivered=0,deferred=0;
    for(const n of rows||[]){
      const res=await fetch(`${URL}/functions/v1/push-dispatch`,{method:'POST',headers:{'Content-Type':'application/json','x-dd-push-secret':PUSH_SECRET},body:JSON.stringify({campaign_id:n.campaign_id,user_ids:[n.user_id],type:n.event_type,title:n.title,body:n.body,url:'https://jessedatema08-ops.github.io/Dungeon-dwellers/'})});
      if(!res.ok)continue;const result=await res.json().catch(()=>({}));
      if(Array.isArray(result.deferred_user_ids)&&result.deferred_user_ids.includes(n.user_id)){deferred++;continue;}
      await supabase.from('notification_queue').update({delivered_at:new Date().toISOString()}).eq('id',n.id);delivered++;
    }
    return new Response(JSON.stringify({ok:true,checked:(rows||[]).length,delivered,deferred}),{headers:{'Content-Type':'application/json'}});
  }catch(err){return new Response(JSON.stringify({error:String((err as Error).message||err)}),{status:500,headers:{'Content-Type':'application/json'}});}
});