(()=>{
'use strict';
let cached=null;
let writing=false;
const DB=()=>window.DungeonDB;

function desiredText(c){
  if(!c)return null;
  const start=c.scheduled_start?new Date(c.scheduled_start):null;
  if(start&&start.getTime()>Date.now()){
    return `Scheduled start · ${start.toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}`;
  }
  if(c.schedule_paused){
    return `Sleep pause · resumes ${String(c.sleep_end||'07:00').slice(0,5)}`;
  }
  return null;
}

function enforce(){
  if(writing)return;
  const el=document.querySelector('#turnTimer');
  if(!el)return;
  const text=desiredText(cached);
  if(text&&el.textContent!==text){
    writing=true;
    el.textContent=text;
    writing=false;
  }
}

async function refresh(){
  const id=localStorage.getItem('ddPreferredCampaign');
  if(!id||!DB())return;
  try{
    cached=await DB().campaign(id);
    enforce();
  }catch{}
}

const observer=new MutationObserver(()=>enforce());
function attach(){
  const el=document.querySelector('#turnTimer');
  if(el)observer.observe(el,{childList:true,characterData:true,subtree:true});
}

document.addEventListener('DOMContentLoaded',()=>{attach();refresh();setInterval(refresh,2000);});
setTimeout(()=>{attach();refresh();},500);
})();