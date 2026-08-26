(()=>{
'use strict';
const $=s=>document.querySelector(s);
const modal=$('#modal'),title=$('#modalTitle'),body=$('#modalBody'),choices=$('#modalChoices'),primary=$('#modalPrimary'),back=$('#modalBack');
if(!modal||!title||!body||!choices||!primary||!back)return;
let bypassAttack=false,bypassSecond=false,bypassComposerAttack=false,pendingSecondButton=null;

function showModal({kicker='Details',heading,html='',choiceButtons=[],primaryText=null,onPrimary=null,backText='Close'}){
  $('#modalKicker').textContent=kicker;title.textContent=heading;body.innerHTML=html;choices.innerHTML='';
  choiceButtons.forEach(({label,meta,onClick,selected=false})=>{const b=document.createElement('button');if(selected)b.classList.add('selectedWeapon');b.innerHTML=`<strong>${label}</strong><span>${meta||''}</span>`;b.addEventListener('click',onClick);choices.appendChild(b);});
  primary.style.display=onPrimary?'block':'none';primary.textContent=primaryText||'Continue';primary.onclick=()=>onPrimary?.();back.textContent=backText;back.onclick=()=>modal.classList.remove('open');modal.classList.add('open');
}
function confirmWeapon(onConfirm,attackLabel='Attack'){
  showModal({kicker:attackLabel,heading:'Choose your weapon',html:'<p>Confirm the weapon for this attack before choosing a target.</p><div class="weaponConfirmNote">Claymore is the only weapon currently available for this attack. Showing it explicitly keeps the choice clear instead of silently forcing it.</div>',choiceButtons:[{label:'Claymore',meta:'Greatsword profile · 2d6 Slashing · Heavy · Two-Handed · Graze',selected:true,onClick:()=>{modal.classList.remove('open');onConfirm();}}],backText:'Cancel'});
}
document.addEventListener('click',e=>{const attack=e.target.closest('[data-action="attack"]');if(!attack)return;if(bypassAttack){bypassAttack=false;return;}e.preventDefault();e.stopImmediatePropagation();confirmWeapon(()=>{bypassAttack=true;attack.click();},'Attack · Weapon');},true);
const send=$('[data-action="send-custom"]'),input=$('#customInput');
if(send&&input)send.addEventListener('click',e=>{if(bypassComposerAttack){bypassComposerAttack=false;return;}const text=input.value.trim();const attackIntent=/^(?:i\s+)?(?:attack|strike|shoot|stab|slash|hit)\b|\bi\s+(?:attack|strike|shoot|stab|slash|hit)\b|\bi\s+swing\s+at\b/i.test(text);if(!attackIntent)return;e.preventDefault();e.stopImmediatePropagation();confirmWeapon(()=>{bypassComposerAttack=true;send.click();},'Custom Attack · Weapon');},true);
choices.addEventListener('click',e=>{const btn=e.target.closest('button');if(!btn)return;if(!/^Make Second Attack$/i.test((btn.querySelector('strong')?.textContent||btn.textContent).trim()))return;if(bypassSecond){bypassSecond=false;return;}e.preventDefault();e.stopImmediatePropagation();pendingSecondButton=btn;confirmWeapon(()=>{if(pendingSecondButton){bypassSecond=true;const b=pendingSecondButton;pendingSecondButton=null;b.click();}},'Attack 2 · Weapon');},true);

function openProfile(kind){
  if(kind==='player')showModal({kicker:'Battle Map · Player Character',heading:'Jesse',html:'<div class="mapProfile"><div class="mapProfileAvatar">JD</div><div><h3>Champion Fighter 5</h3><p>Player character · 2024 rules</p></div></div><div class="profileStats"><div class="profileStat"><span>HP</span><strong>38 / 50</strong></div><div class="profileStat"><span>AC</span><strong>18</strong></div><div class="profileStat"><span>Speed</span><strong>30 ft</strong></div><div class="profileStat"><span>Reaction</span><strong>Available</strong></div><div class="profileStat"><span>Conditions</span><strong>None</strong></div><div class="profileStat"><span>Spells</span><strong>None</strong></div></div><p>Key features: Extra Attack, Second Wind, Action Surge, Tactical Mind, Tactical Shift, Improved Critical, Remarkable Athlete.</p>'});
  else showModal({kicker:'Battle Map · NPC',heading:'Neris',html:'<div class="mapProfile"><div class="mapProfileAvatar">N</div><div><h3>Neris</h3><p>Rescued courier · known ally</p></div></div><div class="profileStats"><div class="profileStat"><span>Trust</span><strong>High</strong></div><div class="profileStat"><span>Fear</span><strong>Low</strong></div><div class="profileStat"><span>Favor</span><strong>Owes one</strong></div></div><p>Known information only: Neris smuggled medicine through the old tunnels and says the Ashen Vault was opened once before, twenty years ago. Unknown NPC stats and secrets remain hidden.</p>'});
}
function setupTokens(){const pc=$('#playerToken'),npc=document.querySelector('.token.npc');[[pc,'player','Open Jesse character sheet'],[npc,'npc','Open Neris known information']].forEach(([el,kind,label])=>{if(!el)return;el.setAttribute('role','button');el.setAttribute('tabindex','0');el.setAttribute('aria-label',label);el.addEventListener('click',()=>openProfile(kind));el.addEventListener('keydown',ev=>{if(ev.key==='Enter'||ev.key===' '){ev.preventDefault();openProfile(kind);}});});}
function setupMasterMap(){const map=document.querySelector('.battlemap');if(!map||map.classList.contains('master-ready'))return;map.classList.add('master-ready');const canvas=document.createElement('div');canvas.className='masterMapCanvas';['Watch Chapel','Ashen Vault','North Crypts','Old Tunnels','Flooded Cistern','Fallback Route'].forEach((name,i)=>{const z=document.createElement('div');z.className='master-zone '+['zone-chapel','zone-vault','zone-crypt','zone-tunnels','zone-cistern','zone-backup'][i];z.innerHTML=`<span>${name}</span>`;canvas.appendChild(z);});[...map.children].forEach(el=>canvas.appendChild(el));map.appendChild(canvas);const badge=document.createElement('div');badge.className='mapBadge';badge.innerHTML='<i></i><span>Local vision · master map cached</span>';map.appendChild(badge);}
function addSystemNote(){const grid=document.querySelector('#systemsPage .featureGrid');if(!grid||document.getElementById('masterMapSystem'))return;const d=document.createElement('div');d.id='masterMapSystem';d.innerHTML='<strong>Persistent Master Map</strong><span>One large campaign map can stay cached on-device. The battle map is only a moving local viewport with player-specific fog and vision, reducing repeated map transfers while keeping off-course areas ready.</span>';grid.appendChild(d);}

const glyphs={
  character:'<svg viewBox="0 0 32 32"><path d="M10 8 16 4l6 4 3 7-3 12H10L7 15z"/><path d="M12 12h8M13 17h6M16 17v6"/></svg>',
  inventory:'<svg viewBox="0 0 32 32"><rect x="6" y="10" width="20" height="17" rx="4"/><path d="M11 10V8a5 5 0 0 1 10 0v2M11 16v6M21 16v6"/></svg>',
  journal:'<svg viewBox="0 0 32 32"><path d="M6 6h9a4 4 0 0 1 4 4v16H10a4 4 0 0 0-4 2z"/><path d="M26 6h-7v20h7z"/></svg>',
  map:'<svg viewBox="0 0 32 32"><path d="m5 8 7-3 8 3 7-3v19l-7 3-8-3-7 3zM12 5v19M20 8v19"/></svg>',
  quest:'<svg viewBox="0 0 32 32"><path d="M9 5h14v22H9zM12 10h8M12 15h8M12 20h5"/></svg>'
};
function setupQuickIcons(){document.querySelectorAll('.quickIcon').forEach(el=>{for(const key of Object.keys(glyphs)){if(el.classList.contains(key)){el.innerHTML=glyphs[key];break;}}});}

let openFinalPage=null;
function setupFinalBottomNav(){
  const nav=document.querySelector('.nav');if(!nav)return;
  nav.innerHTML=`
    <button type="button" data-final-page="scene" class="active" aria-label="Home"><span class="finalNavIcon"><svg viewBox="0 0 48 48"><path d="M9 22.5 24 9l15 13.5V39H29V28H19v11H9Z"/><path d="M16 17V11h6"/></svg></span><span class="finalNavLabel">Home</span></button>
    <button type="button" data-final-page="world" aria-label="Campaign"><span class="finalNavIcon"><svg viewBox="0 0 48 48"><path d="M8 11h12c4 0 7 3 7 7v21c0-4-3-7-7-7H8Z"/><path d="M40 11H28c-4 0-7 3-7 7v21c0-4 3-7 7-7h12Z"/></svg></span><span class="finalNavLabel">Campaign</span></button>
    <button type="button" class="finalCenterButton" data-final-action="turn" aria-label="Continue turn"><span class="finalNavIcon"><svg viewBox="0 0 48 48"><path d="m24 5 16 10v18L24 43 8 33V15Z"/><path d="m24 5 5 10-5 9-5-9Zm16 10-11 0 5 9 6 9M8 15h11l-5 9-6 9m6-9h20L24 43Zm5-9h10M19 15H9"/></svg></span></button>
    <button type="button" data-final-page="journal" aria-label="NPCs"><span class="finalNavIcon"><svg viewBox="0 0 48 48"><circle cx="24" cy="16" r="8"/><path d="M11 39c1-9 6-14 13-14s12 5 13 14"/><path d="M7 34c1-5 4-8 8-10M41 34c-1-5-4-8-8-10"/></svg></span><span class="finalNavLabel">NPCs</span></button>
    <button type="button" data-final-page="systems" aria-label="More"><span class="finalNavIcon"><svg viewBox="0 0 48 48"><circle cx="12" cy="24" r="2.7"/><circle cx="24" cy="24" r="2.7"/><circle cx="36" cy="24" r="2.7"/></svg></span><span class="finalNavLabel">More</span></button>`;
  openFinalPage=page=>{document.querySelectorAll('.page').forEach(p=>p.classList.toggle('active',p.id===page+'Page'));nav.querySelectorAll('[data-final-page]').forEach(b=>b.classList.toggle('active',b.dataset.finalPage===page));document.body.classList.toggle('ddHomeActive',page==='scene');window.scrollTo({top:0,behavior:'auto'});};
  nav.querySelectorAll('[data-final-page]').forEach(btn=>btn.addEventListener('click',()=>openFinalPage(btn.dataset.finalPage)));
  nav.querySelector('[data-final-action="turn"]')?.addEventListener('click',()=>{openFinalPage('scene');setTimeout(()=>document.getElementById('customInput')?.focus(),160);});
  document.body.classList.add('ddHomeActive');
}

function setupHomeShortcuts(){
  const routeShortcut=btn=>{
    const icon=btn.querySelector('.quickIcon');
    if(icon?.classList.contains('character')) return openFinalPage?.('character');
    if(icon?.classList.contains('inventory')) return openFinalPage?.('inventory');
    if(icon?.classList.contains('journal')||icon?.classList.contains('quest')) return openFinalPage?.('journal');
    if(icon?.classList.contains('map')){
      openFinalPage?.('scene');
      setTimeout(()=>document.querySelector('#scenePage .mapModule')?.scrollIntoView({behavior:'smooth',block:'start'}),80);
      return;
    }
  };
  document.querySelectorAll('.quickNavCard').forEach(btn=>btn.removeAttribute('onclick'));
  document.addEventListener('click',e=>{
    const btn=e.target.closest('.quickNavCard');
    if(!btn)return;
    e.preventDefault();
    e.stopPropagation();
    routeShortcut(btn);
  },true);
  const gear=document.querySelector('.gearGhost');
  if(gear){
    gear.setAttribute('aria-label','Open settings and systems');
    gear.title='Settings';
    gear.addEventListener('click',()=>openFinalPage?.('systems'));
  }
}

setupMasterMap();setupTokens();addSystemNote();setupQuickIcons();setupFinalBottomNav();setupHomeShortcuts();
const authScript=document.createElement('script');authScript.src='supabase-auth.js?v=1';authScript.defer=true;document.body.appendChild(authScript);
})();