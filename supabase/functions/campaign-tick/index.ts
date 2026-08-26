import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL=Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const PUSH_SECRET=Deno.env.get('DD_PUSH_SECRET')||'';
const AI_URL=Deno.env.get('DD_AI_URL')||'https://dungeon-dwellers-ai.jesse-datema08.workers.dev';
const supabase=createClient(SUPABASE_URL,SERVICE_KEY,{auth:{persistSession:false}});
const SEQ=['player_1','enemy_1','player_2','enemy_2'];
const INDEX:Record<string,number>={player_1:1,enemy_1:2,player_2:3,enemy_2:4};
const BY_INDEX:Record<number,string>={1:'player_1',2:'enemy_1',3:'player_2',4:'enemy_2'};

async function push(campaign_id:string,user_ids:string[],type:string,title:string,body:string){
  if(!user_ids.length||!PUSH_SECRET)return;
  await fetch(`${SUPABASE_URL}/functions/v1/push-dispatch`,{method:'POST',headers:{'Content-Type':'application/json','x-dd-push-secret':PUSH_SECRET},body:JSON.stringify({campaign_id,user_ids,type,title,body,url:'https://jessedatema08-ops.github.io/Dungeon-dwellers/'})});
}
async function playerMembers(campaignId:string){const {data}=await supabase.from('campaign_members').select('user_id,role').eq('campaign_id',campaignId).in('role',['owner','player']);return (data||[]).map(x=>x.user_id) as string[];}
async function usersForBlock(campaignId:string,block:string){const idx=INDEX[block];if(!idx)return [];const {data}=await supabase.from('initiative_entries').select('user_id').eq('campaign_id',campaignId).eq('block_index',idx).eq('side','player').eq('defeated',false);return [...new Set((data||[]).map(x=>x.user_id).filter(Boolean))] as string[];}
async function missingBlockUsers(c:any){const users=await usersForBlock(c.id,c.active_block);if(!users.length)return [];const {data}=await supabase.from('turn_submissions').select('user_id').eq('campaign_id',c.id).eq('round_number',c.round_number).eq('block_index',INDEX[c.active_block]);const done=new Set((data||[]).map(x=>x.user_id));return users.filter(u=>!done.has(u));}

async function chooseNextCombatBlock(c:any){
  const {data}=await supabase.from('initiative_entries').select('block_index').eq('campaign_id',c.id).eq('defeated',false).not('block_index','is',null);
  const existing=new Set((data||[]).map(x=>Number(x.block_index)));
  if(!existing.size)return null;
  const current=INDEX[c.active_block]||0;
  for(let step=1;step<=4;step++){
    const idx=((current-1+step)%4)+1;
    if(existing.has(idx))return {block:BY_INDEX[idx],wrapped:current>0&&idx<=current};
  }
  return null;
}
async function advanceCombat(c:any){
  const next=await chooseNextCombatBlock(c);
  if(!next){
    const hours=Number(c.settings?.sceneTurnHours)||24;
    await supabase.from('campaigns').update({active_block:'scene',active_deadline:new Date(Date.now()+hours*3600000).toISOString(),deadline_type:'scene_turn',state:{...(c.state||{}),scene_turn_number:Number(c.state?.scene_turn_number||1),notificationMarks:{}},updated_at:new Date().toISOString()}).eq('id',c.id);
    return;
  }
  const round=(c.round_number||1)+(next.wrapped?1:0);
  const player=next.block.startsWith('player');
  const deadline=new Date(Date.now()+(player?6*3600000:5*60000)).toISOString();
  await supabase.from('campaigns').update({active_block:next.block,round_number:round,active_deadline:deadline,deadline_type:player?'combat_block':'enemy_resolution',state:{...(c.state||{}),notificationMarks:{}},updated_at:new Date().toISOString()}).eq('id',c.id);
  if(player){const users=await usersForBlock(c.id,next.block);await push(c.id,users,'turn_open','Your Initiative Block Is Open',`${next.block==='player_1'?'First':'Second'} player block is open for 6 hours.`);}
}

async function callAI(message:string,campaignState:any){
  const res=await fetch(AI_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message,campaignState})});
  const raw=await res.text();let data:any={};try{data=JSON.parse(raw);}catch{data={narration:raw};}
  return String(data.narration||data.response||data.result?.narration||data.result?.response||raw);
}

async function resolveEnemyBlock(c:any){
  const lock=c.state?.enemy_resolution_lock;if(lock&&Date.now()-new Date(lock).getTime()<4*60000)return;
  await supabase.from('campaigns').update({state:{...(c.state||{}),enemy_resolution_lock:new Date().toISOString()}}).eq('id',c.id);
  const idx=INDEX[c.active_block];
  const [{data:initiative},{data:tokens},{data:chars},{data:events}]=await Promise.all([
    supabase.from('initiative_entries').select('*').eq('campaign_id',c.id).eq('defeated',false),
    supabase.from('tokens').select('*').eq('campaign_id',c.id),
    supabase.from('characters').select('id,user_id,name,hp,max_hp,ac,profile').eq('campaign_id',c.id),
    supabase.from('story_events').select('*').eq('campaign_id',c.id).order('created_at',{ascending:false}).limit(15)
  ]);
  const activeEnemies=(initiative||[]).filter((x:any)=>x.side==='enemy'&&Number(x.block_index)===idx);
  try{
    const narration=await callAI(`Resolve only the current enemy initiative block under D&D 5e 2024 revised rules. Active enemies: ${JSON.stringify(activeEnemies)}. Never roll for a player. If a player receives a legal reaction opportunity, state it clearly and do not choose the reaction for them. Keep hidden information secret. Return concise player-safe narration.`,{campaign:c,initiative,tokens,characters:chars,recentStory:events});
    await supabase.from('story_events').insert({campaign_id:c.id,actor_user_id:null,event_type:'enemy_block_resolved',payload:{summary:narration.slice(0,4000),block:c.active_block,round:c.round_number}});
  }catch(err){console.error('Enemy block AI failed',c.id,err);}
  const fresh={...c,state:{...(c.state||{}),enemy_resolution_lock:null}};await advanceCombat(fresh);
}

async function resolveScene(c:any,forced=false){
  const turn=Number(c.state?.scene_turn_number||1);
  const members=await playerMembers(c.id);
  const {data:subs}=await supabase.from('scene_submissions').select('*').eq('campaign_id',c.id).eq('scene_turn_number',turn).order('submitted_at');
  const submitted=new Set((subs||[]).map(x=>x.user_id));
  if(!forced&&members.some(u=>!submitted.has(u)))return false;
  const [{data:chars},{data:events},{data:knowledge},{data:quests}]=await Promise.all([
    supabase.from('characters').select('id,user_id,name,hp,max_hp,ac,profile').eq('campaign_id',c.id),
    supabase.from('story_events').select('*').eq('campaign_id',c.id).order('created_at',{ascending:false}).limit(20),
    supabase.from('knowledge').select('*').eq('campaign_id',c.id).order('created_at',{ascending:false}).limit(40),
    supabase.from('quests').select('*').eq('campaign_id',c.id)
  ]);
  let narration='The scene advances.';
  try{
    narration=await callAI(`Resolve this asynchronous Scene Turn together. Each listed submission is one player's meaningful scene action. Questions and party discussion are not actions. Respect split-party/private knowledge and D&D 5e 2024 revised rules. Do not invent player die results; when a player-facing roll is needed, the next scene must request that player's roll rather than fabricating it. Submissions: ${JSON.stringify(subs||[])}`,{campaign:c,characters:chars,recentStory:events,knowledge,quests});
  }catch(err){console.error('Scene resolution AI failed',c.id,err);}
  const hours=Number(c.settings?.sceneTurnHours)||24;
  const nextTurn=turn+1;
  await supabase.from('story_events').insert({campaign_id:c.id,actor_user_id:null,event_type:'scene_resolved',payload:{summary:narration.slice(0,5000),scene_turn_number:turn}});
  await supabase.from('campaigns').update({current_scene:narration.slice(0,5000),active_block:'scene',active_deadline:new Date(Date.now()+hours*3600000).toISOString(),deadline_type:'scene_turn',state:{...(c.state||{}),scene_turn_number:nextTurn,notificationMarks:{}},updated_at:new Date().toISOString()}).eq('id',c.id);
  return true;
}

async function handleScene(c:any,now:number){
  const members=await playerMembers(c.id),turn=Number(c.state?.scene_turn_number||1);
  const {data:subs}=await supabase.from('scene_submissions').select('user_id').eq('campaign_id',c.id).eq('scene_turn_number',turn);
  const submitted=new Set((subs||[]).map(x=>x.user_id));
  if(members.length&&members.every(u=>submitted.has(u))){await resolveScene(c,false);return;}
  if(!c.active_deadline)return;
  const deadline=new Date(c.active_deadline).getTime(),left=deadline-now,hours=Number(c.settings?.sceneTurnHours)||24,total=hours*3600000,missing=members.filter(u=>!submitted.has(u)),marks=c.state?.notificationMarks||{};
  if(left<=0){await push(c.id,missing,'turn_expired','Scene Turn Closed','The scene response window closed. Unsubmitted players take no meaningful scene action.');await resolveScene(c,true);return;}
  if(left<=3600000&&!marks.one_hour){marks.one_hour=true;await push(c.id,missing,'one_hour','One Hour Remaining','One hour remains in the current Scene Turn.');await supabase.from('campaigns').update({state:{...(c.state||{}),notificationMarks:marks}}).eq('id',c.id);}
  else if(left<=total/2&&!marks.halfway){marks.halfway=true;await push(c.id,missing,'halfway','Scene Turn Halfway Reminder','Half of the current Scene Turn window has elapsed.');await supabase.from('campaigns').update({state:{...(c.state||{}),notificationMarks:marks}}).eq('id',c.id);}
}

async function handlePlayerBlock(c:any,now:number){
  if(!c.active_deadline)return;const deadline=new Date(c.active_deadline).getTime(),left=deadline-now,total=(Number(c.settings?.combatTurnHours)||6)*3600000,missing=await missingBlockUsers(c),marks=c.state?.notificationMarks||{};
  if(!missing.length){await advanceCombat(c);return;}
  if(left<=0){await push(c.id,missing,'turn_expired','Initiative Block Expired','The 6-hour block expired. Unsubmitted turns do nothing meaningful.');await supabase.from('story_events').insert({campaign_id:c.id,actor_user_id:null,event_type:'block_expired',payload:{block:c.active_block,round:c.round_number,summary:'Player block expired; unsubmitted turns were forfeited.'}});await advanceCombat(c);return;}
  if(left<=3600000&&!marks.one_hour){marks.one_hour=true;await push(c.id,missing,'one_hour','One Hour Remaining','One hour remains in your initiative block.');await supabase.from('campaigns').update({state:{...(c.state||{}),notificationMarks:marks}}).eq('id',c.id);}
  else if(left<=total/2&&!marks.halfway){marks.halfway=true;await push(c.id,missing,'halfway','Halfway Reminder','Half of your initiative block has elapsed.');await supabase.from('campaigns').update({state:{...(c.state||{}),notificationMarks:marks}}).eq('id',c.id);}
}

Deno.serve(async req=>{
  try{
    const secret=Deno.env.get('DD_TICK_SECRET')||'';if(secret&&req.headers.get('x-dd-tick-secret')!==secret)return new Response('unauthorized',{status:401});
    const now=Date.now();const {data:campaigns,error}=await supabase.from('campaigns').select('*').eq('paused',false).not('active_block','is',null);if(error)throw error;
    for(const c of campaigns||[]){if(c.active_block==='scene'){await handleScene(c,now);continue;}if(c.active_block?.startsWith('enemy')){await resolveEnemyBlock(c);continue;}if(c.active_block?.startsWith('player'))await handlePlayerBlock(c,now);}
    await supabase.from('reaction_windows').update({resolved:true,resolution:{type:'forfeit',reason:'deadline_expired'}}).eq('resolved',false).lte('deadline',new Date().toISOString());
    return new Response(JSON.stringify({ok:true,checked:(campaigns||[]).length}),{headers:{'Content-Type':'application/json'}});
  }catch(err){return new Response(JSON.stringify({error:String((err as Error).message||err)}),{status:500,headers:{'Content-Type':'application/json'}});}
});