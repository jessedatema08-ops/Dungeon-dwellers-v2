(()=>{
'use strict';
const URL='https://xyvwicaoqnhjsfmjsgtk.supabase.co';
const KEY='sb_publishable_oidZHzC3CnuG_L_vkI7a8g_8cxMclpt';
if(!window.supabase){console.error('Supabase library failed to load');return;}
const client=window.supabase.createClient(URL,KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,flowType:'pkce'}});
async function q(p){const {data,error}=await p;if(error)throw error;return data;}
async function session(){return (await q(client.auth.getSession())).session;}
async function user(){return (await session())?.user||null;}
const DB={
 client,session,user,onAuth:cb=>client.auth.onAuthStateChange((_e,s)=>cb(s)),
 signUp:(email,password)=>q(client.auth.signUp({email,password,options:{emailRedirectTo:location.href}})),
 signIn:(email,password)=>q(client.auth.signInWithPassword({email,password})),
 async signOut(){const {error}=await client.auth.signOut();if(error)throw error;},
 myCampaigns:()=>q(client.from('campaign_members').select('campaign_id,role,joined_at,campaigns(*)').order('joined_at')),
 async createCampaign(name='The Ashen Vault'){
   const u=await user();if(!u)throw new Error('Sign in first.');const ashen=name.trim().toLowerCase()==='the ashen vault';
   const scene=ashen?'You and Neris stand in a sealed burial chamber beneath the ruined watch chapel. A bronze door to the north bears an inscription you cannot read. A collapsed shrine blocks the west wall. Something shifted in the darkness beyond it a moment ago.':null;
   const c=await q(client.from('campaigns').insert({owner_id:u.id,name,chapter:ashen?4:1,current_scene:scene,settings:{combatTurnHours:6,reactionWindowHours:1,sceneTurnHours:24,initiativeStyle:'initiative_blocks'},state:ashen?{sceneTitle:'The Broken Gate',sceneText:scene,scene_turn_number:1}:{scene_turn_number:1}}).select().single());
   await q(client.from('campaign_members').insert({campaign_id:c.id,user_id:u.id,role:'owner'}));
   await q(client.from('notification_preferences').upsert({campaign_id:c.id,user_id:u.id},{onConflict:'campaign_id,user_id'}));
   if(ashen){
     await q(client.from('quests').insert([{campaign_id:c.id,title:'The Blue Light Below',status:'active',data:{summary:'Find what is pulsing beneath the ruined watch chapel and determine why the lower vault has reopened.'}},{campaign_id:c.id,title:"Neris's Debt",status:'active',data:{summary:"Decide whether to help Neris clear her brother's name."}}]));
     await q(client.from('knowledge').insert([{campaign_id:c.id,user_id:null,visibility:'party',fact:'Neris says the Ashen Vault was opened once before, around twenty years ago.'},{campaign_id:c.id,user_id:null,visibility:'party',fact:'The bronze north door bears an inscription the party cannot currently read.'}]));
     await q(client.from('npc_state').insert({campaign_id:c.id,npc_key:'neris',public_state:{name:'Neris',role:'rescued courier',trust:'high',fear:'low',favor:'owes one'},hidden_state:{}}));
     await q(client.from('tokens').insert([{campaign_id:c.id,token_type:'npc',name:'Neris',x:42,y:54,hidden:false,state:{relationship:'Trust high · Fear low · Owes a favor'}},{campaign_id:c.id,token_type:'enemy',name:'Unknown Creature',x:72,y:57,hidden:true,state:{revealed:false}}]));
     await q(client.from('campaign_maps').insert({campaign_id:c.id,name:'Ashen Vault · Lower Chapel',active:true,generated_spec:{name:'Ashen Vault · Lower Chapel',theme:'ashen-vault',rooms:[{x:8,y:12,w:35,h:32},{x:53,y:20,w:38,h:26},{x:22,y:58,w:50,h:30}]}}));
     await q(client.from('story_events').insert({campaign_id:c.id,actor_user_id:u.id,event_type:'campaign_continuity',payload:{summary:'Jesse spared Neris after learning she had been smuggling medicine. Neris led the party beneath the ruined watch chapel to the sealed burial chamber and the unreadable bronze gate.'}}));
   }
   return c;
 },
 campaign:id=>q(client.from('campaigns').select('*').eq('id',id).single()),
 saveCampaign:(id,patch)=>q(client.from('campaigns').update({...patch,updated_at:new Date().toISOString()}).eq('id',id).select().single()),
 members:id=>q(client.from('campaign_members').select('campaign_id,user_id,role,joined_at').eq('campaign_id',id).order('joined_at')),
 memberCharacters:id=>q(client.from('characters').select('id,campaign_id,user_id,name,display_name,profile,hp,max_hp,ac,x,y,updated_at').eq('campaign_id',id).order('updated_at')),
 async createInvite(campaign_id,{expiresHours=168,maxUses=null}={}){const u=await user();if(!u)throw new Error('Sign in first.');return q(client.from('campaign_invites').insert({campaign_id,created_by:u.id,expires_at:expiresHours?new Date(Date.now()+expiresHours*3600000).toISOString():null,max_uses:maxUses}).select().single());},
 acceptInvite:token=>q(client.rpc('accept_campaign_invite',{p_token:token})),
 async character(campaign_id){const u=await user();if(!u)return null;return q(client.from('characters').select('*').eq('campaign_id',campaign_id).eq('user_id',u.id).maybeSingle());},
 async saveCharacter(campaign_id,row){const u=await user();if(!u)throw new Error('Sign in first.');const out={...row,campaign_id,user_id:u.id,updated_at:new Date().toISOString()};if(out.id)return q(client.from('characters').upsert(out,{onConflict:'id'}).select().single());delete out.id;return q(client.from('characters').upsert(out,{onConflict:'campaign_id,user_id'}).select().single());},
 story:(id,limit=80)=>q(client.from('story_events').select('*').eq('campaign_id',id).order('created_at',{ascending:false}).limit(limit)),
 async addStory(campaign_id,event_type,payload={}){const u=await user();return q(client.from('story_events').insert({campaign_id,actor_user_id:u?.id||null,event_type,payload}).select().single());},
 knowledge:id=>q(client.from('knowledge').select('*').eq('campaign_id',id).order('created_at',{ascending:false})),
 quests:id=>q(client.from('quests').select('*').eq('campaign_id',id).order('updated_at',{ascending:false})),
 publicNpcs:id=>q(client.rpc('get_public_npcs',{p_campaign:id})),
 tokens:id=>q(client.from('tokens').select('*').eq('campaign_id',id)),
 saveToken:t=>q(client.from('tokens').upsert({...t,updated_at:new Date().toISOString()},{onConflict:'id'}).select().single()),
 async tokenVisibility(id){const ts=await DB.tokens(id);if(!ts.length)return [];return q(client.from('token_visibility').select('*').in('token_id',ts.map(t=>t.id)));},
 activeMap:id=>q(client.from('campaign_maps').select('*').eq('campaign_id',id).eq('active',true).order('updated_at',{ascending:false}).limit(1).maybeSingle()),
 async mapView(map_id){const u=await user();if(!u)return null;return q(client.from('map_views').select('*').eq('map_id',map_id).eq('user_id',u.id).maybeSingle());},
 async mapUrl(path){if(!path)return null;return (await q(client.storage.from('campaign-maps').createSignedUrl(path,3600))).signedUrl;},
 async uploadMap(campaign_id,file,name='Campaign Map'){if(!file?.type?.startsWith('image/'))throw new Error('Choose a PNG, JPG, or WebP map.');const ext=(file.name.split('.').pop()||'png').replace(/[^a-z0-9]/gi,'').toLowerCase(),path=`${campaign_id}/${crypto.randomUUID()}.${ext}`;await q(client.storage.from('campaign-maps').upload(path,file,{cacheControl:'3600',upsert:false,contentType:file.type}));await q(client.from('campaign_maps').update({active:false}).eq('campaign_id',campaign_id).eq('active',true));return q(client.from('campaign_maps').insert({campaign_id,name,storage_path:path,active:true,generated_spec:{}}).select().single());},
 async createGeneratedMap(campaign_id,spec){await q(client.from('campaign_maps').update({active:false}).eq('campaign_id',campaign_id).eq('active',true));return q(client.from('campaign_maps').insert({campaign_id,name:spec?.name||'Generated Dungeon',active:true,generated_spec:spec||{}}).select().single());},
 initiative:id=>q(client.from('initiative_entries').select('*').eq('campaign_id',id).eq('defeated',false).order('block_index').order('initiative',{ascending:false})),
 async submitTurn(campaign_id,round_number,block_index,action){const u=await user();if(!u)throw new Error('Sign in first.');return q(client.from('turn_submissions').upsert({campaign_id,round_number,block_index,user_id:u.id,action,submitted_at:new Date().toISOString()},{onConflict:'campaign_id,round_number,block_index,user_id'}).select().single());},
 myTurnSubmission:(campaign_id,round_number,block_index)=>user().then(u=>u?q(client.from('turn_submissions').select('*').eq('campaign_id',campaign_id).eq('round_number',round_number).eq('block_index',block_index).eq('user_id',u.id).maybeSingle()):null),
 async submitScene(campaign_id,scene_turn_number,action){const u=await user();if(!u)throw new Error('Sign in first.');return q(client.from('scene_submissions').upsert({campaign_id,scene_turn_number,user_id:u.id,action,submitted_at:new Date().toISOString(),resolved:false},{onConflict:'campaign_id,scene_turn_number,user_id'}).select().single());},
 async mySceneSubmission(campaign_id,scene_turn_number){const u=await user();if(!u)return null;return q(client.from('scene_submissions').select('*').eq('campaign_id',campaign_id).eq('scene_turn_number',scene_turn_number).eq('user_id',u.id).maybeSingle());},
 sceneSubmissions:(campaign_id,scene_turn_number)=>q(client.from('scene_submissions').select('*').eq('campaign_id',campaign_id).eq('scene_turn_number',scene_turn_number).order('submitted_at')),
 async myReactions(campaign_id){const u=await user();if(!u)return [];return q(client.from('reaction_windows').select('*').eq('campaign_id',campaign_id).eq('user_id',u.id).eq('resolved',false).gt('deadline',new Date().toISOString()).order('created_at',{ascending:false}));},
 resolveReaction:(id,resolution)=>q(client.from('reaction_windows').update({resolved:true,resolution}).eq('id',id).select().single()),
 async notificationPrefs(campaign_id){const u=await user();if(!u)return null;let row=await q(client.from('notification_preferences').select('*').eq('campaign_id',campaign_id).eq('user_id',u.id).maybeSingle());if(!row)row=await q(client.from('notification_preferences').insert({campaign_id,user_id:u.id}).select().single());return row;},
 async saveNotificationPrefs(campaign_id,patch){const u=await user();if(!u)throw new Error('Sign in first.');return q(client.from('notification_preferences').upsert({campaign_id,user_id:u.id,...patch,updated_at:new Date().toISOString()},{onConflict:'campaign_id,user_id'}).select().single());},
 async savePushSubscription(sub){const u=await user(),j=sub.toJSON();if(!u)throw new Error('Sign in first.');return q(client.from('push_subscriptions').upsert({user_id:u.id,endpoint:j.endpoint,p256dh:j.keys.p256dh,auth:j.keys.auth,user_agent:navigator.userAgent,last_seen_at:new Date().toISOString()},{onConflict:'endpoint'}).select().single());},
 notificationHistory:(limit=50)=>q(client.from('notification_outbox').select('*').order('created_at',{ascending:false}).limit(limit)),
 chat:(id,limit=100)=>q(client.from('chat_messages').select('*').eq('campaign_id',id).order('created_at',{ascending:true}).limit(limit)),
 async sendChat(campaign_id,body,mentions=[]){const u=await user();if(!u)throw new Error('Sign in first.');return q(client.from('chat_messages').insert({campaign_id,user_id:u.id,body,mentions}).select().single());},
 subscribe(campaign_id,onChange){const ch=client.channel(`dd:${campaign_id}:${crypto.randomUUID()}`);ch.on('postgres_changes',{event:'*',schema:'public',table:'campaigns',filter:`id=eq.${campaign_id}`},p=>onChange('campaigns',p));['campaign_members','characters','tokens','campaign_maps','map_views','token_visibility','initiative_entries','turn_submissions','scene_submissions','reaction_windows','story_events','knowledge','quests','chat_messages','notification_outbox'].forEach(table=>ch.on('postgres_changes',{event:'*',schema:'public',table,filter:`campaign_id=eq.${campaign_id}`},p=>onChange(table,p)));return ch.subscribe();},
 unsubscribe(ch){if(ch)client.removeChannel(ch);}
};
window.ddSupabase=client;window.DungeonDB=DB;window.dispatchEvent(new CustomEvent('dd:db-ready'));
})();