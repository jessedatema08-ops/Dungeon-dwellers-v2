import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const URL=Deno.env.get('SUPABASE_URL')!;
const SERVICE=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const PUSH_SECRET=Deno.env.get('DD_PUSH_SECRET')||'';
const supabase=createClient(URL,SERVICE,{auth:{persistSession:false}});

Deno.serve(async req=>{
  try{
    const tickSecret=Deno.env.get('DD_TICK_SECRET')||'';
    if(tickSecret&&req.headers.get('x-dd-tick-secret')!==tickSecret)return new Response('unauthorized',{status:401});
    const {data:prefs,error:pErr}=await supabase.from('notification_preferences').select('campaign_id,user_id').eq('mode','digest');if(pErr)throw pErr;
    let digests=0,items=0;
    for(const p of prefs||[]){
      const {data:queue,error:qErr}=await supabase.from('notification_queue').select('*').eq('campaign_id',p.campaign_id).eq('user_id',p.user_id).is('delivered_at',null).order('created_at').limit(50);if(qErr)throw qErr;if(!queue?.length)continue;
      const preview=queue.slice(0,4).map((x:any)=>x.title).join(' · ');const body=queue.length===1?`${queue[0].title}: ${queue[0].body}`:`${queue.length} campaign updates. ${preview}${queue.length>4?' · and more':''}`;
      const res=await fetch(`${URL}/functions/v1/push-dispatch`,{method:'POST',headers:{'Content-Type':'application/json','x-dd-push-secret':PUSH_SECRET},body:JSON.stringify({campaign_id:p.campaign_id,user_ids:[p.user_id],type:'digest',title:'Dungeon Dwellers Daily Digest',body,url:'https://jessedatema08-ops.github.io/Dungeon-dwellers/',force:true,tag:'dd-digest'})});
      if(res.ok){const ids=queue.map((x:any)=>x.id);await supabase.from('notification_queue').update({delivered_at:new Date().toISOString()}).in('id',ids);digests++;items+=ids.length;}
    }
    return new Response(JSON.stringify({ok:true,digests,items}),{headers:{'Content-Type':'application/json'}});
  }catch(err){return new Response(JSON.stringify({error:String((err as Error).message||err)}),{status:500,headers:{'Content-Type':'application/json'}});}
});