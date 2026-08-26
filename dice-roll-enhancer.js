(()=>{
'use strict';
const modal=document.getElementById('rollModal');
const stage=document.getElementById('dieStage');
const title=document.getElementById('rollTitle');
const label=document.getElementById('rollLabel');
const result=document.getElementById('rollResult');
const math=document.getElementById('rollMath');
const button=document.getElementById('rollButton');
const close=document.getElementById('rollClose');
const legacyNum=document.getElementById('dieNum');
if(!modal||!stage||!title||!button||!close||!legacyNum)return;

let currentSpec={count:1,sides:20,kind:'d20',expression:'1d20'};
let rollTick=null;
let lastAttackCritical=false;

function byId(id){return document.getElementById(id)}
function clearTick(){if(rollTick){clearInterval(rollTick);rollTick=null;}}
function randomInt(max){return Math.floor(Math.random()*max)+1;}
function getTitle(){return (title.textContent||'').trim().toLowerCase();}
function extractIntegers(text){return (text.match(/\d+/g)||[]).map(Number);}
function getMathRows(){return [...math.querySelectorAll('.row')].map(row=>({
  key:(row.querySelector('span')?.textContent||'').trim(),
  value:(row.querySelector('strong')?.textContent||'').trim()
}));}
function parseDamageValues(){
  const row=getMathRows().find(r=>/damage dice/i.test(r.key));
  return row?extractIntegers(row.value):[];
}
function parseDamageProfile(){
  const row=getMathRows().find(r=>/claymore|damage|potion|second wind|tactical/i.test(r.key));
  if(!row)return null;
  const m=row.value.match(/(\d+)d(\d+)/i);
  return m?{count:Number(m[1]),sides:Number(m[2])}:null;
}
function detectSpec(){
  const t=getTitle();
  if(/roll damage/.test(t)){
    return {count:lastAttackCritical?4:2,sides:6,kind:'d6',expression:lastAttackCritical?'4d6':'2d6'};
  }
  if(/tactical mind/.test(t)) return {count:1,sides:10,kind:'d10',expression:'1d10'};
  if(/second wind/.test(t)) return {count:1,sides:10,kind:'d10',expression:'1d10'};
  if(/potion/.test(t)) return {count:2,sides:4,kind:'d4',expression:'2d4'};
  return {count:1,sides:20,kind:'d20',expression:'1d20'};
}
function dieMarkup(spec,index){
  return `<div class="polyDie ${spec.kind}" data-index="${index}" aria-hidden="true"><span class="dieValue">—</span></div>`;
}
function ensureVisuals(){
  let tray=stage.querySelector('.diceTray');
  if(!tray){
    tray=document.createElement('div');
    tray.className='diceTray';
    const meta=document.createElement('div');
    meta.className='diceExpression';
    stage.insertBefore(meta, stage.querySelector('.rollResult'));
    stage.insertBefore(tray, stage.querySelector('.rollResult'));
  }
  return tray;
}
function renderSpec(){
  currentSpec=detectSpec();
  const tray=ensureVisuals();
  const expression=stage.querySelector('.diceExpression');
  expression.textContent=currentSpec.expression;
  tray.innerHTML=Array.from({length:currentSpec.count},(_,i)=>dieMarkup(currentSpec,i)).join('');
  stage.classList.add('enhancedDiceStage');
  stage.classList.remove('impactHit','negativeHit','criticalHit');
  if(currentSpec.count>2) tray.classList.add('wide'); else tray.classList.remove('wide');
}
function setFaceValues(values){
  const faces=[...stage.querySelectorAll('.polyDie .dieValue')];
  faces.forEach((face,i)=>face.textContent=values[i]??'—');
}
function animateRoll(){
  clearTick();
  rollTick=setInterval(()=>{
    setFaceValues(Array.from({length:currentSpec.count},()=>randomInt(currentSpec.sides)));
  },88);
}
function applyOutcomeClasses(values){
  const t=getTitle();
  const raw=Number(legacyNum.textContent)||values[0]||0;
  const text=((label.textContent||'')+' '+(result.textContent||'')).toLowerCase();
  stage.classList.remove('impactHit','negativeHit','criticalHit');
  if(/critical/.test(text)||raw===20){
    stage.classList.add('criticalHit');
    return;
  }
  if(currentSpec.count>1 && /damage/.test(t)){
    const total=values.reduce((a,b)=>a+b,0);
    const max=currentSpec.count*currentSpec.sides;
    if(total>=Math.ceil(max*0.75)) stage.classList.add('impactHit');
    else if(total<=Math.max(2,Math.floor(max*0.35))) stage.classList.add('negativeHit');
    return;
  }
  if(raw>=15) stage.classList.add('impactHit');
  else if(raw<=5) stage.classList.add('negativeHit');
}
function finalizeVisuals(){
  clearTick();
  let values=[];
  if(currentSpec.count===1){
    values=[Number(legacyNum.textContent)||0];
  }else{
    values=parseDamageValues();
    const profile=parseDamageProfile();
    if(profile){currentSpec=Object.assign({},currentSpec,profile,{kind:'d'+profile.sides,expression:`${profile.count}d${profile.sides}`});}
    if(values.length===0) values=[Number(legacyNum.textContent)||0];
    if(values.length<currentSpec.count){
      while(values.length<currentSpec.count) values.push('•');
    }
  }
  setFaceValues(values);
  const expr=stage.querySelector('.diceExpression');
  if(expr) expr.textContent=currentSpec.expression;
  applyOutcomeClasses(values.filter(v=>typeof v==='number'));
}
function refreshOnOpen(){
  renderSpec();
  if(currentSpec.count===1) setFaceValues(['—']);
  else setFaceValues(Array.from({length:currentSpec.count},()=> '—'));
}

const openObserver=new MutationObserver(()=>{
  if(modal.classList.contains('open')) refreshOnOpen();
});
openObserver.observe(modal,{attributes:true,attributeFilter:['class']});

const classObserver=new MutationObserver(()=>{
  if(stage.classList.contains('rolling')){
    renderSpec();
    animateRoll();
    setTimeout(finalizeVisuals,1485);
  }
});
classObserver.observe(stage,{attributes:true,attributeFilter:['class']});

button.addEventListener('click',()=>{
  renderSpec();
});
close.addEventListener('click',()=>{
  const t=getTitle();
  if(/roll to hit/.test(t)){
    const text=((label.textContent||'')+' '+(result.textContent||'')).toLowerCase();
    lastAttackCritical=/critical/.test(text) || Number(legacyNum.textContent)===20;
  }
  clearTick();
});

renderSpec();
})();