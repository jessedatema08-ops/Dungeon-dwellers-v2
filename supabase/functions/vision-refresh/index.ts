import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const URL=Deno.env.get('SUPABASE_URL')!;
const SERVICE=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON=Deno.env.get('SUPABASE_ANON_KEY')!;
const AI_URL=Deno.env.get('DD_AI_URL')||'https://dungeon-dwellers-ai.jesse-datema08.workers.dev';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type'};

Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
  try{
    const auth=req.headers.get('Authorization')||'';
    const userClient=createClient(URL,ANON,{global:{headers:{Authorization:auth}},auth:{persistSession:false}});
    const {data:{user},error:userError}=await userClient.auth.getUser();if(userError||!user)return new Response(JSON.stringify({error:'unauthorized'}),{status:401,headers:{...cors,'Content-Type':'application/json'}});
    const {campaign_id}=await req.json();if(!campaign_id)throw new Error('campaign_id required');
    const admin=createClient(URL,SERVICE,{auth:{persistSession:false}});
    const {data:member}=await admin.from('campaign_members').select('role').eq('campaign_id',campaign_id).eq('user_id',user.id).maybeSingle();if(!member)throw new Error('Not a campaign member');
    const [{data:campaign},{data:character},{data:tokens},{data:map}]=await Promise.all([
      admin.from('campaigns').select('id,name,current_scene,state').eq('id',campaign_id).single(),
      admin.from('characters').select('*').eq('campaign_id',campaign_id).eq('user_id',user.id).maybeSingle(),
      admin.from('tokens').select('*').eq('campaign_id',campaign_id),
      admin.from('campaign_maps').select('*').eq('campaign_id',campaign_id).eq('active',true).order('updated_at',{ascending:false}).limit(1).maybeSingle()
    ]);
    const own=(tokens||[]).find((t:any)=>t.owner_user_id===user.id)||(tokens||[]).find((t:any)=>t.character_id===character?.id);
    const hidden=(tokens||[]).filter((t:any)=>t.hidden);
    let decisions:hiddenDecision[]=[];
    if(hidden.length){
      const prompt=`You are the visibility adjudicator for a D&D 5e 2024 tactical map. Decide only what THIS player can currently perceive. Be conservative: uncertain hidden creatures remain hidden. Use position distance, character senses, current scene, lighting/state metadata, invisibility, darkness, and any revealed state. Do not reveal secrets in labels or reasoning. Return ONLY JSON with this shape: {"visible":[{"token_id":"uuid","visible":true|false}],"sightRadius":number}.\nPLAYER CHARACTER:${JSON.stringify(character?.profile||{})}\nPLAYER TOKEN:${JSON.stringify(own||null)}\nCAMPAIGN SCENE:${JSON.stringify({current_scene:campaign?.current_scene,state:campaign?.state})}\nMAP:${JSON.stringify(map?.generated_spec||{})}\nHIDDEN TOKENS:${JSON.stringify(hidden.map((t:any)=>({id:t.id,token_type:t.token_type,x:t.x,y:t.y,state:t.state,name:t.name})))}`;
      const res=await fetch(AI_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:prompt,campaignState:{mode:'visibility-only'}})});const raw=await res.text();let payload:any;try{payload=JSON.parse(raw);}catch{payload={narration:raw};}const text=String(payload.narration||payload.response||payload.result?.narration||raw);const m=text.match(/\{[\s\S]*\}/);if(m){try{const j=JSON.parse(m[0]);decisions=Array.isArray(j.visible)?j.visible:[];(decisions as any).sightRadius=Number(j.sightRadius)||90;}catch{}}
    }
    const byId=new Map(decisions.map((d:any)=>[d.token_id,Boolean(d.visible)]));
    for(const t of hidden){await admin.from('token_visibility').upsert({token_id:t.id,user_id:user.id,visible:byId.get(t.id)===true,updated_at:new Date().toISOString()},{onConflict:'token_id,user_id'});await admin.from('tokens').update({updated_at:new Date().toISOString()}).eq('id',t.id);}
    if(map?.id){await admin.from('map_views').upsert({map_id:map.id,user_id:user.id,view_state:{center:{x:Number(own?.x)||50,y:Number(own?.y)||50},sightRadius:Number((decisions as any).sightRadius)||90,updatedBy:'ai-visibility'},updated_at:new Date().toISOString()},{onConflict:'map_id,user_id'});}
    return new Response(JSON.stringify({ok:true,updated:hidden.length}),{headers:{...cors,'Content-Type':'application/json'}});
  }catch(err){return new Response(JSON.stringify({error:String((err as Error).message||err)}),{status:400,headers:{...cors,'Content-Type':'application/json'}});}
});

type hiddenDecision={token_id:string,visible:boolean};