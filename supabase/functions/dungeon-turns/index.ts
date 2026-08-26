import { createClient } from 'npm:@supabase/supabase-js@2';

const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const SEQ=['player_1','enemy_1','player_2','enemy_2'];
const IDX:any={player_1:1,enemy_1:2,player_2:3,enemy_2:4};
const LABEL:any={player_1:'Players · First Half',enemy_1:'Enemies · First Half',player_2:'Players · Second Half',enemy_2:'Enemies · Second Half'};
function parseAI(raw:string){let d:any;try{d=raw?JSON.parse(raw):{}}catch{d={raw}}const narration=String(typeof d==='string'?d:(d.narration||d.response||d.result?.narration||d.result?.response||d.raw||''));const m=/\[\[DD_EVENT:(\{.*?\})\]\]/s.exec(narration);let event:any=null;if(m){try{event=JSON.parse(m[1]);}catch{}}return {text:narration.replace(m?.[0]||'','').trim(),event};}
async function askAI(aiUrl:string,message:string,state:any){const res=await fetch(aiUrl,{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify({message,campaignState:state})});const raw=await res.text();if(!res.ok)throw new Error(raw||`AI HTTP ${res.status}`);return parseAI(raw);}
async function postDM(db:any,campaignId:string,body:string,metadata:any={}){if(!body?.trim())return;await db.from('chat_messages').insert({campaign_id:campaignId,user_id:null,body:body.trim(),sender_kind:'dm',visibility:'party',recipient_user_ids:[],metadata:{channel:'party',...metadata}});}

Deno.serve(async req=>{
  if(req.method!=='POST')return json({ok:false,error:'POST required'},405);
  const secret=Deno.env.get('TURN_CRON_SECRET')||'';
  if(secret&&req.headers.get('x-cron-secret')!==secret)return json({ok:false,error:'Unauthorized'},401);
  const url=Deno.env.get('SUPABASE_URL')!,service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,aiUrl=Deno.env.get('DUNGEON_AI_WORKER_URL')||'https://dungeon-dwellers-ai.jesse-datema08.workers.dev';
  const db=createClient(url,service),now=new Date();const processed:any[]=[];
  const {data:campaigns,error}=await db.from('campaigns').select('*').eq('paused',false).limit(200);if(error)return json({ok:false,error:error.message},500);

  for(const c of campaigns||[]){
    const active=String(c.active_block||'');

    if(!active){
      const sceneTurn=Number(c.state?.scene_turn_number||1),deadline=c.active_deadline?new Date(c.active_deadline):null;
      const {data:members}=await db.from('campaign_members').select('user_id,role').eq('campaign_id',c.id).in('role',['owner','player']);
      const {data:subs}=await db.from('scene_submissions').select('*').eq('campaign_id',c.id).eq('scene_turn_number',sceneTurn).eq('resolved',false).order('submitted_at');
      const required=(members||[]).length,readyByAll=required>0&&(subs||[]).length>=required,readyByTime=!!deadline&&deadline<=now;
      if(!readyByAll&&!readyByTime)continue;
      const {data:chars}=await db.from('characters').select('*').eq('campaign_id',c.id);
      const {data:tokens}=await db.from('tokens').select('*').eq('campaign_id',c.id);
      const {data:quests}=await db.from('quests').select('*').eq('campaign_id',c.id);
      const {data:knowledge}=await db.from('knowledge').select('*').eq('campaign_id',c.id).order('created_at',{ascending:false}).limit(80);
      const actions=(subs||[]).map((s:any)=>({user_id:s.user_id,action:s.action}));
      const prompt=`Resolve Scene Turn ${sceneTurn} for Dungeon Dwellers using D&D 5e 2024 revised rules. Resolve all submitted player actions together in a fair sequence. Do not invent player-facing dice results. If a player action requires a roll that was not supplied, do not fabricate it; narrate only up to the point where the player must roll and make that need clear. If no actions were submitted, let time pass naturally without inventing meaningful player actions. Keep private discoveries private. Write the result as a message the Dungeon Master posts to the shared campaign chat. Return concise narration plus optional metadata [[DD_EVENT:{"notify":"scene","sceneSummary":"","publicKnowledge":"","visibilityUpdates":[],"mapView":null}]].`;
      try{
        const ai=await askAI(aiUrl,prompt,{campaign:c,characters:chars||[],tokens:tokens||[],quests:quests||[],knowledge:knowledge||[],sceneTurn,submissions:actions});
        const summary=ai.event?.sceneSummary||ai.text||c.current_scene;
        const nextTurn=sceneTurn+1,hours=Number(c.settings?.sceneTurnHours||24),nextDeadline=new Date(Date.now()+hours*3600000);
        await db.from('campaigns').update({current_scene:summary,state:{...(c.state||{}),sceneText:summary,scene_turn_number:nextTurn},active_deadline:nextDeadline.toISOString(),deadline_type:'scene_turn',updated_at:new Date().toISOString()}).eq('id',c.id);
        if((subs||[]).length)await db.from('scene_submissions').update({resolved:true}).eq('campaign_id',c.id).eq('scene_turn_number',sceneTurn);
        if(ai.text){await db.from('story_events').insert({campaign_id:c.id,actor_user_id:null,event_type:'scene_resolved',payload:{summary:ai.text,scene_turn_number:sceneTurn}});await postDM(db,c.id,ai.text,{kind:'scene_resolved',sceneTurn});}
        if(ai.event?.publicKnowledge)await db.from('knowledge').insert({campaign_id:c.id,user_id:null,visibility:'party',fact:String(ai.event.publicKnowledge).slice(0,4000)});
        if(Array.isArray(ai.event?.visibilityUpdates))for(const u of ai.event.visibilityUpdates.slice(0,100)){if(!u?.tokenId||!u?.userId)continue;await db.from('token_visibility').upsert({token_id:u.tokenId,user_id:u.userId,visible:!!u.visible,label_override:u.label||null,state:u.state||{},updated_at:new Date().toISOString()},{onConflict:'token_id,user_id'});}
        const {data:map}=await db.from('campaign_maps').select('id').eq('campaign_id',c.id).eq('active',true).order('updated_at',{ascending:false}).limit(1).maybeSingle();
        if(ai.event?.mapView?.userId&&map?.id)await db.from('map_views').upsert({map_id:map.id,user_id:ai.event.mapView.userId,view_state:ai.event.mapView.viewState||{},updated_at:new Date().toISOString()},{onConflict:'map_id,user_id'});
        for(const m of members||[])await db.from('notification_outbox').insert({campaign_id:c.id,user_id:m.user_id,kind:'new_scene',title:'New AI DM Message',body:String(summary||'The scene advanced.').slice(0,180),data:{campaignId:c.id,sceneTurn:nextTurn}});
        processed.push({campaign:c.id,type:'scene',from:sceneTurn,to:nextTurn});
      }catch(e){await db.from('story_events').insert({campaign_id:c.id,actor_user_id:null,event_type:'scene_resolution_error',payload:{summary:String(e),scene_turn_number:sceneTurn}});}
      continue;
    }

    if(!SEQ.includes(active)||!c.active_deadline||new Date(c.active_deadline)>now)continue;
    const currentIdx=SEQ.indexOf(active),currentBlockIndex=IDX[active];
    const {data:entries}=await db.from('initiative_entries').select('*').eq('campaign_id',c.id).eq('defeated',false).order('initiative',{ascending:false});
    const blockEntries=(entries||[]).filter((e:any)=>e.block_index===currentBlockIndex);

    if(active.startsWith('player')){
      for(const e of blockEntries.filter((x:any)=>x.user_id)){
        const {data:submission}=await db.from('turn_submissions').select('id').eq('campaign_id',c.id).eq('round_number',c.round_number).eq('block_index',currentBlockIndex).eq('user_id',e.user_id).maybeSingle();
        if(!submission){
          await db.from('story_events').insert({campaign_id:c.id,actor_user_id:e.user_id,event_type:'missed_turn',payload:{summary:`${e.display_name} missed the ${LABEL[active]} decision window and does nothing meaningful this block.`,round:c.round_number,block:active}});
          await db.from('notification_outbox').insert({campaign_id:c.id,user_id:e.user_id,kind:'turn_expired',title:'Turn Window Expired',body:'Your combat block expired. No meaningful action was submitted.',data:{campaignId:c.id,round:c.round_number,block:active}});
        }
      }
    }else{
      const {data:tokens}=await db.from('tokens').select('*').eq('campaign_id',c.id);const {data:chars}=await db.from('characters').select('*').eq('campaign_id',c.id);
      const prompt=`Resolve ${LABEL[active]} automatically for Dungeon Dwellers using D&D 5e 2024 revised rules. Enemy/NPC mechanics may be rolled automatically. Never roll player-facing dice. Respect current positions, conditions, HP, hidden information, and legal reactions. This is round ${c.round_number}. Write the result as a concise Dungeon Master message for the shared campaign chat and identify reaction opportunities clearly.`;
      try{const ai=await askAI(aiUrl,prompt,{campaign:c,initiative:entries||[],tokens:tokens||[],characters:chars||[],activeBlock:active});if(ai.text){await db.from('story_events').insert({campaign_id:c.id,actor_user_id:null,event_type:'enemy_block_resolved',payload:{summary:ai.text,round:c.round_number,block:active}});await postDM(db,c.id,ai.text,{kind:'enemy_block_resolved',round:c.round_number,block:active});}}catch(e){await db.from('story_events').insert({campaign_id:c.id,actor_user_id:null,event_type:'enemy_block_resolution_error',payload:{summary:String(e),round:c.round_number,block:active}});}
    }

    const next=SEQ[(currentIdx+1)%4],nextRound=next==='player_1'?Number(c.round_number||1)+1:Number(c.round_number||1),hours=next.startsWith('player')?Number(c.settings?.combatTurnHours||6):0.0833333,deadline=new Date(Date.now()+hours*3600000);
    await db.from('campaigns').update({active_block:next,round_number:nextRound,active_deadline:deadline.toISOString(),deadline_type:next.startsWith('player')?'combat_block':'enemy_resolution',updated_at:new Date().toISOString()}).eq('id',c.id);
    if(next==='player_1'){const {data:members}=await db.from('campaign_members').select('user_id').eq('campaign_id',c.id);for(const m of members||[])await db.from('notification_outbox').insert({campaign_id:c.id,user_id:m.user_id,kind:'round_resolved',title:'Combat Round Resolved',body:`Round ${c.round_number} has resolved. Round ${nextRound} begins.`,data:{campaignId:c.id,round:nextRound}});}
    if(next.startsWith('player')){
      const nextEntries=(entries||[]).filter((e:any)=>e.block_index===IDX[next]&&e.user_id);
      for(const e of nextEntries)await db.from('notification_outbox').insert([
        {campaign_id:c.id,user_id:e.user_id,kind:'turn_open',title:'Your Initiative Block Is Open',body:`${LABEL[next]} is open for ${hours} hours.`,data:{campaignId:c.id,round:nextRound,block:next},deliver_after:new Date().toISOString()},
        {campaign_id:c.id,user_id:e.user_id,kind:'halfway',title:'Turn Window Halfway',body:'Half of your combat decision window remains.',data:{campaignId:c.id,round:nextRound,block:next},deliver_after:new Date(Date.now()+hours*1800000).toISOString()},
        {campaign_id:c.id,user_id:e.user_id,kind:'one_hour',title:'One Hour Remaining',body:'One hour remains in your combat decision window.',data:{campaignId:c.id,round:nextRound,block:next},deliver_after:new Date(Math.max(Date.now(),deadline.getTime()-3600000)).toISOString()}
      ]);
    }
    processed.push({campaign:c.id,type:'combat',from:active,to:next,round:nextRound});
  }
  return json({ok:true,processed});
});