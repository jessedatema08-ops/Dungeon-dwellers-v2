(()=>{
'use strict';
if(window.__DD_MAP_AI_INTEGRATION_V2)return;window.__DD_MAP_AI_INTEGRATION_V2=true;
const ai=window.DungeonAI;if(!ai?.ask)return;
const originalAsk=ai.ask.bind(ai);
const MAP_WORDS=/\b(enter|entered|arrive|arrived|leave|left|move|moved|door|gate|room|hall|corridor|stairs|stairway|bridge|road|street|path|trail|wall|cave|dungeon|building|tower|temple|forest|river|lake|portal|teleport|north|south|east|west|open|opened|close|closed|lock|locked|unlock|fire|fog|smoke|terrain)\b/i;
const inflight=new Map();
function cleanNarration(result){const text=String(result?.narration||'');return text.replace(/\[\[DD_EVENT:(\{.*?\})\]\]/s,'').trim().slice(0,5000);}
function eventOf(result){if(result?.event)return result.event;try{return ai.extract?.(result?.narration||'')?.event||null}catch{return null}}
async function updateMap(result,campaignState,opts){
  const db=window.DungeonDB;if(!db?.client)return;
  const event=eventOf(result)||{},visibility=event.responseVisibility||opts?.responseVisibility||'party';
  if(visibility==='private'||event.rollRequest)return;
  const campaignId=campaignState?.campaign?.id||campaignState?.campaignId;if(!campaignId)return;
  const narration=cleanNarration(result),sceneSummary=String(event.sceneSummary||'').trim().slice(0,5000);
  if(!sceneSummary&&!MAP_WORDS.test(narration))return;
  const sceneKey=sceneSummary?`${campaignId}|${sceneSummary}`:'';
  if(sceneKey&&sessionStorage.getItem('ddMapSceneKey')===sceneKey&&!MAP_WORDS.test(narration))return;
  const key=`${campaignId}|${sceneSummary||narration.slice(0,240)}`;if(inflight.has(key))return;
  const task=(async()=>{try{
    const {data,error}=await db.client.functions.invoke('dungeon-map-ai',{body:{campaignId,sceneSummary,narration}});
    if(error)throw error;if(data?.ok===false)throw new Error(data.error||'Map update failed.');
    if(sceneKey)sessionStorage.setItem('ddMapSceneKey',sceneKey);
    window.dispatchEvent(new CustomEvent('dd:map-ai-updated',{detail:data||{}}));
  }catch(err){console.warn('Map AI update skipped:',err?.message||err);}finally{inflight.delete(key);}})();
  inflight.set(key,task);
}
ai.ask=async function(message,campaignState,opts={}){const result=await originalAsk(message,campaignState,opts);void updateMap(result,campaignState,opts);return result;};
})();