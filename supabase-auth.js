(()=>{
'use strict';
const SUPABASE_URL='https://xyvwicaoqnhjsfmjsgtk.supabase.co';
const SUPABASE_PUBLISHABLE_KEY='sb_publishable_oidZHzC3CnuG_L_vkI7a8g_8cxMclpt';
const CAMPAIGN_NAME='The Ashen Vault';
let client=null,currentUser=null,currentCampaign=null,syncTimer=null;

function injectStyles(){
  if(document.getElementById('ddAuthStyles'))return;
  const style=document.createElement('style');style.id='ddAuthStyles';style.textContent=`
  .ddAuthGate{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;padding:18px;background:radial-gradient(circle at 50% 0,#162033 0,#080a0f 36%,#040507 76%);color:#f2eee5;font-family:Inter,system-ui,sans-serif}
  .ddAuthCard{width:min(100%,420px);border:1px solid rgba(207,166,94,.3);border-radius:24px;background:linear-gradient(180deg,#12161d,#080a0e);padding:22px;box-shadow:0 28px 70px rgba(0,0,0,.58)}
  .ddAuthBrand{font:700 30px/.95 Georgia,serif;letter-spacing:.08em;text-transform:uppercase;color:#e1bd77;text-align:center;margin-bottom:6px}.ddAuthSub{text-align:center;color:#9d9486;font-size:12px;margin-bottom:18px}
  .ddAuthTabs{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:14px}.ddAuthTabs button,.ddAuthButton{min-height:44px;border-radius:12px;border:1px solid rgba(207,166,94,.24);background:#0e1218;color:#d8d0c2;font-weight:700}.ddAuthTabs button.active,.ddAuthButton.primary{background:linear-gradient(180deg,#2b2317,#17120c);border-color:rgba(225,189,119,.55);color:#f1dba9}
  .ddAuthField{display:grid;gap:6px;margin-top:10px}.ddAuthField label{font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#a7926b}.ddAuthField input{width:100%;min-height:46px;border-radius:12px;border:1px solid rgba(207,166,94,.2);background:#090c10;color:#f4efe5;padding:10px 12px;font-size:15px}
  .ddAuthButton{width:100%;margin-top:14px}.ddAuthMsg{min-height:18px;margin-top:10px;font-size:12px;color:#b8afa0;text-align:center}.ddAuthMsg.error{color:#e6a0a0}.ddAuthMsg.success{color:#9fd8ae}
  .ddAccountPanel{margin-top:12px;border:1px solid rgba(207,166,94,.18);border-radius:14px;padding:12px;background:rgba(255,255,255,.02)}.ddAccountPanel strong{display:block;color:#f2eee5;margin-bottom:4px}.ddAccountPanel span{font-size:12px;color:#9e9587}.ddAccountPanel button{margin-top:10px;min-height:38px;border:1px solid rgba(207,166,94,.2);border-radius:10px;background:#11151b;color:#ddd4c4;padding:0 12px}
  `;document.head.appendChild(style);
}

function createGate(){
  if(document.getElementById('ddAuthGate'))return document.getElementById('ddAuthGate');
  const gate=document.createElement('div');gate.className='ddAuthGate';gate.id='ddAuthGate';gate.innerHTML=`<div class="ddAuthCard"><div class="ddAuthBrand">Dungeon Dwellers</div><div class="ddAuthSub">Sign in to load your campaign</div><div class="ddAuthTabs"><button type="button" class="active" data-auth-mode="signin">Sign In</button><button type="button" data-auth-mode="signup">Create Account</button></div><div class="ddAuthField"><label>Email</label><input id="ddAuthEmail" type="email" autocomplete="email" inputmode="email"></div><div class="ddAuthField"><label>Password</label><input id="ddAuthPassword" type="password" autocomplete="current-password" minlength="6"></div><button class="ddAuthButton primary" id="ddAuthSubmit" type="button">Sign In</button><div class="ddAuthMsg" id="ddAuthMsg"></div></div>`;
  document.body.appendChild(gate);
  let mode='signin';
  gate.querySelectorAll('[data-auth-mode]').forEach(btn=>btn.addEventListener('click',()=>{mode=btn.dataset.authMode;gate.querySelectorAll('[data-auth-mode]').forEach(b=>b.classList.toggle('active',b===btn));gate.querySelector('#ddAuthSubmit').textContent=mode==='signup'?'Create Account':'Sign In';gate.querySelector('#ddAuthPassword').autocomplete=mode==='signup'?'new-password':'current-password';setMsg('');}));
  gate.querySelector('#ddAuthSubmit').addEventListener('click',async()=>{
    const email=gate.querySelector('#ddAuthEmail').value.trim(),password=gate.querySelector('#ddAuthPassword').value;
    if(!email||password.length<6){setMsg('Enter a valid email and a password of at least 6 characters.','error');return;}
    const submit=gate.querySelector('#ddAuthSubmit');submit.disabled=true;submit.textContent=mode==='signup'?'Creating…':'Signing in…';
    try{
      if(mode==='signup'){
        const {data,error}=await client.auth.signUp({email,password});if(error)throw error;
        if(!data.session){setMsg('Account created. Check your email to confirm, then sign in.','success');return;}
      }else{
        const {error}=await client.auth.signInWithPassword({email,password});if(error)throw error;
      }
    }catch(err){setMsg(err.message||'Authentication failed.','error');}
    finally{submit.disabled=false;submit.textContent=mode==='signup'?'Create Account':'Sign In';}
  });
  gate.querySelector('#ddAuthPassword').addEventListener('keydown',e=>{if(e.key==='Enter')gate.querySelector('#ddAuthSubmit').click();});
  return gate;
}
function setMsg(text,type=''){const el=document.getElementById('ddAuthMsg');if(!el)return;el.textContent=text;el.className='ddAuthMsg'+(type?' '+type:'');}
function showGate(show){const gate=createGate();gate.style.display=show?'grid':'none';}

async function ensureCampaign(user){
  let {data,error}=await client.from('campaigns').select('*').eq('owner_id',user.id).eq('name',CAMPAIGN_NAME).limit(1).maybeSingle();
  if(error)throw error;
  if(!data){
    const created=await client.from('campaigns').insert({owner_id:user.id,name:CAMPAIGN_NAME,current_scene:'The Broken Gate',game_time:'9:16 PM',initiative_style:'Initiative Blocks'}).select().single();
    if(created.error)throw created.error;data=created.data;
  }
  currentCampaign=data;
  const membership=await client.from('campaign_members').upsert({campaign_id:data.id,user_id:user.id,role:'owner'},{onConflict:'campaign_id,user_id'});if(membership.error)throw membership.error;
  return data;
}

function readLocalState(){try{return JSON.parse(localStorage.getItem('ddBetaV4')||'{}')}catch{return {}}}
async function syncLocalState(){
  if(!client||!currentUser||!currentCampaign)return;
  const s=readLocalState();
  const profile={class:'Fighter',subclass:'Champion',level:5,rules_edition:'2024',second_wind:Number.isFinite(s.secondWind)?s.secondWind:3,action_surge:Number.isFinite(s.actionSurge)?s.actionSurge:1,potions:Number.isFinite(s.potions)?s.potions:3,relic:!!s.relic,combat:!!s.combat,reaction:s.reaction!==false};
  const char=await client.from('characters').upsert({campaign_id:currentCampaign.id,user_id:currentUser.id,name:'Jesse',rules_edition:'2024',profile,hp:Number.isFinite(s.hp)?s.hp:38,max_hp:50,ac:18},{onConflict:'campaign_id,user_id'});if(char.error)console.warn('Character sync failed',char.error);
  const campaignUpdate=await client.from('campaigns').update({paused:!!s.paused,current_scene:document.querySelector('.sceneHeading')?.textContent||'The Broken Gate',game_time:s.time||'9:16 PM',initiative_style:s.initiativeStyle||'Initiative Blocks',updated_at:new Date().toISOString()}).eq('id',currentCampaign.id);if(campaignUpdate.error)console.warn('Campaign sync failed',campaignUpdate.error);
}
function scheduleSync(){clearTimeout(syncTimer);syncTimer=setTimeout(()=>syncLocalState().catch(err=>console.warn('Supabase sync failed',err)),350);}

function installLocalStorageBridge(){
  if(window.__ddStorageBridge)return;window.__ddStorageBridge=true;
  const original=Storage.prototype.setItem;
  Storage.prototype.setItem=function(key,value){const result=original.call(this,key,value);if(this===localStorage&&key==='ddBetaV4')scheduleSync();return result;};
}

function renderAccountPanel(){
  const grid=document.querySelector('#systemsPage .featureGrid');if(!grid||document.getElementById('ddAccountPanel'))return;
  const panel=document.createElement('div');panel.id='ddAccountPanel';panel.className='ddAccountPanel';panel.innerHTML=`<strong>Supabase Account</strong><span id="ddAccountEmail"></span><button type="button" id="ddSignOut">Sign Out</button>`;grid.parentElement.appendChild(panel);
  panel.querySelector('#ddSignOut').addEventListener('click',()=>client?.auth.signOut());
}
function updateAccountPanel(){renderAccountPanel();const email=document.getElementById('ddAccountEmail');if(email)email.textContent=currentUser?.email?`${currentUser.email} · cloud sync active`:'Not signed in';}

async function onSession(session){
  currentUser=session?.user||null;
  if(!currentUser){currentCampaign=null;showGate(true);updateAccountPanel();return;}
  showGate(false);
  try{await ensureCampaign(currentUser);await syncLocalState();installLocalStorageBridge();updateAccountPanel();window.ddSupabase={client,user:currentUser,campaign:currentCampaign,sync:syncLocalState};document.dispatchEvent(new CustomEvent('dd-supabase-ready',{detail:{user:currentUser,campaign:currentCampaign}}));}
  catch(err){console.error('Supabase bootstrap failed',err);showGate(true);setMsg('Signed in, but campaign setup failed: '+(err.message||err),'error');}
}

async function init(){
  injectStyles();createGate();showGate(true);
  if(!window.supabase){
    await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';s.onload=resolve;s.onerror=()=>reject(new Error('Could not load Supabase client'));document.head.appendChild(s);});
  }
  client=window.supabase.createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
  const {data:{session}}=await client.auth.getSession();await onSession(session);
  client.auth.onAuthStateChange((_event,nextSession)=>{setTimeout(()=>onSession(nextSession),0);});
}
init().catch(err=>{console.error(err);injectStyles();createGate();showGate(true);setMsg(err.message||'Supabase failed to initialize.','error');});
})();