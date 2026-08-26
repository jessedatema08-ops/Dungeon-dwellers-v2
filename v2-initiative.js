(()=>{
'use strict';
if(window.DungeonInitiativeV2)return;
const DB=()=>window.DungeonDB,R=()=>window.DungeonRulesV2;
let channel=null,lastPromptKey='';
function cid(){return localStorage.getItem('ddPreferredCampaign');}
async function check(){const id=cid();if(!id||!DB()||!R())return;try{const s=await DB().session(),uid=s?.user?.id;if(!uid)return;const [{data:engine},ch,entries]=await Promise.all([DB().client.from('campaign_engine_state').select('*').eq('campaign_id',id).maybeSingle(),DB().character(id),DB().initiative(id)]);const combat=engine?.state?.combat||{},pending=Array.isArray(combat.pendingUsers)?combat.pendingUsers:[];if(!combat.pendingInitiative||!pending.includes(uid)||entries.some(e=>e.user_id===uid&&!e.defeated))return;const key=`${id}:${combat.requestedAt||engine?.revision||0}:${uid}`;if(lastPromptKey===key)return;lastPromptKey=key;const mod=R().abilityMod(ch,'dexterity');window.dispatchEvent(new CustomEvent('dd:roll-request',{detail:{request:{label:'Initiative',expression:`1d20${mod>=0?'+':''}${mod}`,mode:'normal',reason:'The AI Dungeon Master called for initiative.',hiddenDC:false},visibility:'party'}}));}catch(err){console.warn('V2 initiative check failed',err);}}
async function subscribe(){const id=cid();if(!id||!DB())return;if(channel)DB().client.removeChannel(channel);channel=DB().client.channel(`dd-v2-initiative:${id}:${crypto.randomUUID()}`).on('postgres_changes',{event:'*',schema:'public',table:'campaign_engine_state',filter:`campaign_id=eq.${id}`},()=>check()).on('postgres_changes',{event:'*',schema:'public',table:'initiative_entries',filter:`campaign_id=eq.${id}`},()=>check()).subscribe();await check();}
function init(){subscribe();window.addEventListener('storage',()=>{lastPromptKey='';subscribe();});document.addEventListener('visibilitychange',()=>{if(!document.hidden)check();});}
window.DungeonInitiativeV2={check,subscribe};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(init,180),{once:true});else setTimeout(init,180);
})();