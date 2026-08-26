(()=>{
'use strict';
if(window.__DD_CAMPAIGN_MANAGER_V2)return;
window.__DD_CAMPAIGN_MANAGER_V2=true;

const $=(s,r=document)=>r.querySelector(s);
const DB=()=>window.DungeonDB;
const AI=()=>window.DungeonAI;
const esc=v=>String(v??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]));

function closeModal(){
  const root=$('#modalRoot');
  if(root){root.classList.add('hidden');root.innerHTML='';}
}

function modal(title,body,buttons=''){
  const root=$('#modalRoot');
  if(!root)return null;
  root.innerHTML=`<div class="modalBackdrop"><div class="modal"><div class="eyebrow">Campaigns</div><h2>${esc(title)}</h2><div class="modalBody">${body}</div><div class="buttonRow" style="margin-top:14px">${buttons}</div></div></div>`;
  root.classList.remove('hidden');
  return root;
}

function localDateTimeValue(d){
  const pad=n=>String(n).padStart(2,'0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function parseCampaignJson(text){
  let src=String(text||'').replace(/\[\[DD_EVENT:[\s\S]*?\]\]/g,'').trim();
  const fenced=src.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if(fenced)src=fenced[1].trim();
  const first=src.indexOf('{'),last=src.lastIndexOf('}');
  if(first<0||last<=first)throw new Error('The AI did not return campaign data.');
  return JSON.parse(src.slice(first,last+1));
}

function fallbackCampaign(seed){
  const themes=[
    ['The Hollow Sun','At Noon, the Shadows Leave','At noon, every shadow in the river city tears itself loose from its owner and walks east toward the abandoned royal observatory. By sunset, people without shadows begin forgetting their own names. The party sees one detached shadow stop, point directly at them, and carve a warning into the dust: DO NOT LET THE SUN SET TWICE.'],
    ['The Bells Under Snow','A Sound Beneath the Pass','A mountain village wakes to church bells ringing from deep beneath an avalanche field where no chapel has ever stood. Each peal reveals a different doorway in the snow, and every doorway opens onto the same candlelit hall. A rescue party enters and returns minutes later, decades older, carrying a map with the party names written in the margin.'],
    ['The River That Remembers','Footprints Flow Upstream','A river begins carrying objects upstream: lost letters, broken weapons, childhood toys, and finally the body of a local magistrate who is still alive in town. The corpse clutches a sealed message addressed to the party and dated three weeks from now.']
  ];
  const pick=themes[Math.abs([...seed].reduce((a,c)=>a+c.charCodeAt(0),0))%themes.length];
  return {
    name:pick[0],sceneTitle:pick[1],sceneText:pick[2],
    quests:[{title:'Follow the Impossible Clue',summary:'Find the source of the impossible event before it worsens.'},{title:'Who Knew First?',summary:'Discover who anticipated the event and why the party was named.'}],
    knowledge:['The phenomenon began today.','No local authority has a convincing explanation.'],
    npcs:[],theme:'mysterious'
  };
}

async function applySchedule(client){
  const {error}=await client.rpc('dd_apply_campaign_schedules');
  if(error)throw error;
}

async function generateCampaign({scheduledStart,sleepStart,sleepEnd,timezone}){
  const db=DB();
  if(!db)throw new Error('Database is unavailable.');
  const temp=await db.createCampaign(`Generating Campaign ${crypto.randomUUID().slice(0,8)}`);
  const cid=temp.id,client=db.client,seed=crypto.randomUUID();

  try{
    const startIso=new Date(scheduledStart).toISOString();
    let res=await client.from('campaigns').update({
      scheduled_start:startIso,
      sleep_start:sleepStart,
      sleep_end:sleepEnd,
      schedule_timezone:timezone,
      schedule_paused:false,
      schedule_pause_started_at:null,
      paused:false
    }).eq('id',cid);
    if(res.error)throw res.error;

    const prompt=`CAMPAIGN_GENERATION_REQUEST\nGenerate a brand-new D&D 5e 2024 campaign from scratch. This request is for a newly created empty campaign; do not continue, imitate, summarize, or reuse any existing campaign plot, scene, NPC, location, mystery, faction, or title. Use only the random seed below as creative entropy. Make the premise distinct in genre, location, central mystery, threat, imagery, factions, and moral tension. Avoid The Ashen Vault and copyrighted settings. Seed: ${seed}.\n\nReturn ONLY valid JSON with this shape: {\"name\":\"short title\",\"sceneTitle\":\"opening scene title\",\"sceneText\":\"120-220 word opening\",\"quests\":[{\"title\":\"...\",\"summary\":\"...\"}],\"knowledge\":[\"...\"],\"npcs\":[{\"key\":\"lowercase-key\",\"name\":\"...\",\"role\":\"...\",\"public\":\"...\"}],\"theme\":\"short-theme\"}`;

    let g;
    try{
      const result=await AI().ask(prompt,{campaign:{id:cid,name:temp.name,state:{}},campaignId:cid,recentStory:[],knowledge:[],quests:[],visibleTokens:[]});
      g=parseCampaignJson(result?.narration||'');
    }catch(err){
      console.warn('Fresh campaign AI generation used local fallback.',err);
      g=fallbackCampaign(seed);
    }

    const name=String(g.name||'Unnamed Adventure').slice(0,120);
    const sceneTitle=String(g.sceneTitle||'Opening Scene').slice(0,160);
    const sceneText=String(g.sceneText||'The adventure begins.').slice(0,6000);

    res=await client.from('campaigns').update({
      name,
      chapter:1,
      current_scene:sceneText,
      state:{sceneTitle,sceneText,scene_turn_number:1,generatedByAI:true,generationSeed:seed},
      settings:{combatTurnHours:6,reactionWindowHours:1,sceneTurnHours:24,initiativeStyle:'initiative_blocks'}
    }).eq('id',cid);
    if(res.error)throw res.error;

    const quests=Array.isArray(g.quests)?g.quests.slice(0,5):[];
    if(quests.length){
      res=await client.from('quests').insert(quests.map(q=>({campaign_id:cid,title:String(q.title||'Quest').slice(0,160),status:'active',data:{summary:String(q.summary||'').slice(0,1200)}})));
      if(res.error)throw res.error;
    }

    const facts=Array.isArray(g.knowledge)?g.knowledge.slice(0,8):[];
    if(facts.length){
      res=await client.from('knowledge').insert(facts.map(f=>({campaign_id:cid,user_id:null,visibility:'party',fact:String(f).slice(0,1200)})));
      if(res.error)throw res.error;
    }

    const npcs=Array.isArray(g.npcs)?g.npcs.slice(0,8):[];
    if(npcs.length){
      res=await client.from('npc_state').insert(npcs.map((n,i)=>({campaign_id:cid,npc_key:String(n.key||`npc-${i+1}`).slice(0,80),public_state:{name:String(n.name||'Unknown'),role:String(n.role||'NPC'),description:String(n.public||'')},hidden_state:{}})));
      if(res.error)throw res.error;
      res=await client.from('tokens').insert(npcs.map((n,i)=>({campaign_id:cid,token_type:'npc',name:String(n.name||'NPC').slice(0,120),x:10+((i*4)%18),y:8+((i*5)%12),hidden:false,state:{role:String(n.role||'NPC'),position_mode:'grid'}})));
      if(res.error)throw res.error;
    }

    await db.addStory(cid,'campaign_generated',{summary:`The AI generated ${name}.`,seed});
    await applySchedule(client);
    localStorage.setItem('ddPreferredCampaign',cid);
    return {id:cid,name};
  }catch(err){
    await client.from('campaigns').delete().eq('id',cid);
    throw err;
  }
}

function openGenerate(){
  const start=new Date();
  const tz=Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC';
  modal('Generate New Campaign',`<p class="statusLine">This starts from a fresh empty campaign and a new random seed. It does not use the currently selected campaign as story context.</p><div class="formGrid" style="margin-top:10px"><label class="fieldLabel">Scheduled campaign start<input id="ddCampaignStart" type="datetime-local" value="${localDateTimeValue(start)}"></label><div class="grid2"><label class="fieldLabel">Daily sleep pause starts<input id="ddSleepStart" type="time" value="23:00"></label><label class="fieldLabel">Daily sleep pause ends<input id="ddSleepEnd" type="time" value="07:00"></label></div><label class="fieldLabel">Time zone<input id="ddScheduleTimezone" value="${esc(tz)}"></label><div id="ddCampaignGenStatus" class="statusLine">Starts now by default. The 11 PM–7 AM pause is applied only when the current local time is actually inside that window.</div></div>`,'<button id="ddCancelCampaign" class="ghostBtn">Cancel</button><button id="ddGenerateCampaign" class="goldBtn">Generate Campaign</button>');
  $('#ddCancelCampaign').onclick=closeModal;
  $('#ddGenerateCampaign').onclick=async()=>{
    const btn=$('#ddGenerateCampaign'),status=$('#ddCampaignGenStatus');
    const scheduledStart=$('#ddCampaignStart').value,sleepStart=$('#ddSleepStart').value,sleepEnd=$('#ddSleepEnd').value,timezone=$('#ddScheduleTimezone').value.trim()||tz;
    if(!scheduledStart||!sleepStart||!sleepEnd){status.textContent='Choose a start time and both sleep-pause times.';status.className='statusLine bad';return;}
    try{
      btn.disabled=true;
      status.textContent='AI is inventing a fresh campaign...';
      status.className='statusLine warn';
      const made=await generateCampaign({scheduledStart,sleepStart,sleepEnd,timezone});
      status.textContent=`Created ${made.name}. Opening it now...`;
      status.className='statusLine ok';
      setTimeout(()=>location.reload(),250);
    }catch(err){
      btn.disabled=false;
      status.textContent=err.message||String(err);
      status.className='statusLine bad';
    }
  };
}

async function removeMapFiles(campaignId){
  const c=DB()?.client;
  if(!c)return;
  try{
    const {data}=await c.storage.from('campaign-maps').list(campaignId,{limit:1000});
    const paths=(data||[]).filter(x=>x?.name).map(x=>`${campaignId}/${x.name}`);
    if(paths.length)await c.storage.from('campaign-maps').remove(paths);
  }catch(err){console.warn('Campaign map file cleanup skipped.',err);}
}

function confirmDelete(row){
  const campaign=row?.campaigns||row;
  if(!campaign?.id)return;
  modal('Delete Campaign',`<p class="statusLine bad">This permanently deletes <strong>${esc(campaign.name)}</strong> and all of its campaign data. This cannot be undone.</p><div class="formGrid"><label class="fieldLabel">Type the campaign name to confirm<input id="deleteCampaignConfirm" autocomplete="off" placeholder="${esc(campaign.name)}"></label><div id="deleteCampaignStatus" class="statusLine"></div></div>`,'<button id="cancelCampaignDelete" class="ghostBtn">Cancel</button><button id="confirmCampaignDelete" class="dangerBtn" disabled>Delete Permanently</button>');
  const input=$('#deleteCampaignConfirm'),confirm=$('#confirmCampaignDelete');
  input.oninput=()=>{confirm.disabled=input.value.trim()!==campaign.name;};
  $('#cancelCampaignDelete').onclick=closeModal;
  confirm.onclick=async()=>{
    if(input.value.trim()!==campaign.name)return;
    confirm.disabled=true;confirm.textContent='Deleting...';
    try{
      const db=DB(),u=await db.user();
      if(!u)throw new Error('Sign in first.');
      if(row?.role&&row.role!=='owner')throw new Error('Only the campaign owner can delete this campaign.');
      await removeMapFiles(campaign.id);
      const {error}=await db.client.from('campaigns').delete().eq('id',campaign.id).eq('owner_id',u.id);
      if(error)throw error;
      if(localStorage.getItem('ddPreferredCampaign')===campaign.id)localStorage.removeItem('ddPreferredCampaign');
      location.reload();
    }catch(err){
      confirm.disabled=false;confirm.textContent='Delete Permanently';
      $('#deleteCampaignStatus').textContent=err.message||String(err);
      $('#deleteCampaignStatus').className='statusLine bad';
    }
  };
}

async function openManager(){
  const db=DB();
  if(!db)return;
  const rows=await db.myCampaigns();
  const root=modal('Your Campaigns','<p class="statusLine">Open, generate, or delete a campaign directly. None of these actions requires selecting a campaign first.</p><div id="ddCampaignManagerList" class="list"></div>','<button id="ddManagerGenerate" class="goldBtn">Generate Campaign</button><button id="ddManagerClose" class="ghostBtn">Close</button>');
  if(!root)return;
  const list=$('#ddCampaignManagerList',root);
  if(!rows.length)list.innerHTML='<div class="listItem"><strong>No campaigns yet</strong><span>Generate a new campaign to begin.</span></div>';
  for(const row of rows){
    const c=row.campaigns||{},item=document.createElement('div');
    item.className='listItem';
    item.innerHTML=`<strong>${esc(c.name||'Campaign')}</strong><span>${esc(row.role||'player')} · Chapter ${esc(c.chapter||1)}</span><div class="buttonRow" style="margin-top:8px"><button class="goldBtn" data-open="${esc(row.campaign_id)}">Open</button>${row.role==='owner'?`<button class="dangerBtn" data-delete="${esc(row.campaign_id)}">Delete</button>`:''}</div>`;
    list.appendChild(item);
    item.querySelector('[data-open]').onclick=()=>{localStorage.setItem('ddPreferredCampaign',row.campaign_id);location.reload();};
    item.querySelector('[data-delete]')?.addEventListener('click',()=>confirmDelete(row));
  }
  $('#ddManagerGenerate').onclick=openGenerate;
  $('#ddManagerClose').onclick=closeModal;
}

document.addEventListener('click',e=>{
  const t=e.target.closest?.('#topMenu,#lobbyCreate,#newCampaignBtn,#newCampaignBtnDuplicate');
  if(!t)return;
  e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();
  if(t.id==='topMenu')openManager().catch(err=>alert(err.message||String(err)));
  else openGenerate();
},true);

window.DungeonCampaignManager={openManager,openGenerate,confirmDelete,generateCampaign};
})();
