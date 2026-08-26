(()=>{
'use strict';
const CONDITIONS=new Set(['blinded','charmed','deafened','exhaustion','frightened','grappled','incapacitated','invisible','paralyzed','petrified','poisoned','prone','restrained','stunned','unconscious']);
const ABILITIES=['strength','dexterity','constitution','intelligence','wisdom','charisma'];
const lower=v=>String(v||'').trim().toLowerCase();
const clone=v=>JSON.parse(JSON.stringify(v??{}));
const abilityMod=score=>Math.floor((Number(score||10)-10)/2);
const proficiencyBonus=level=>{level=Number(level||1);return level>=17?6:level>=13?5:level>=9?4:level>=5?3:2;};
function named(list,name){const n=lower(name);return (list||[]).find(x=>lower(typeof x==='string'?x:x?.name)===n)||null;}
function normalizeProfile(input){
  const p=clone(input||{});p.identity=p.identity||{};p.identity.rulesEdition='D&D 5e 2024 revised';p.identity.level=Math.max(1,Math.min(20,Number(p.identity.level||1)));
  p.proficiencyBonus=Number(p.proficiencyBonus||proficiencyBonus(p.identity.level));p.abilities=p.abilities||{};
  for(const a of ABILITIES){const score=Number(p.abilities[a]?.score||10);p.abilities[a]={...(p.abilities[a]||{}),score,mod:Number.isFinite(Number(p.abilities[a]?.mod))?Number(p.abilities[a].mod):abilityMod(score)};}
  p.defenses={armorClass:10,currentHp:1,maxHp:1,tempHp:0,speed:30,conditions:[],exhaustion:0,resistances:[],immunities:[],vulnerabilities:[],...(p.defenses||{})};
  p.classFeatures=Array.isArray(p.classFeatures)?p.classFeatures:[];p.subclassFeatures=Array.isArray(p.subclassFeatures)?p.subclassFeatures:[];p.speciesFeatures=Array.isArray(p.speciesFeatures)?p.speciesFeatures:[];p.feats=Array.isArray(p.feats)?p.feats:[];
  p.equipment={weapons:[],armor:[],consumables:[],gear:[],...(p.equipment||{})};for(const k of ['weapons','armor','consumables','gear'])if(!Array.isArray(p.equipment[k]))p.equipment[k]=[];
  p.spellcasting={canCastSpells:false,cantrips:[],knownSpells:[],preparedSpells:[],innateSpells:[],rituals:[],slots:{},...(p.spellcasting||{})};for(const k of ['cantrips','knownSpells','preparedSpells','innateSpells','rituals'])if(!Array.isArray(p.spellcasting[k]))p.spellcasting[k]=[];
  p.magicItems=Array.isArray(p.magicItems)?p.magicItems:[];p.languages=Array.isArray(p.languages)?p.languages:[];p.senses={darkvision:0,blindsight:0,truesight:0,passivePerception:10,...(p.senses||{})};p.attunement=p.attunement||{used:0,max:3,items:[]};
  return p;
}
function features(profile){const p=normalizeProfile(profile);return [...p.classFeatures,...p.subclassFeatures,...p.speciesFeatures,...p.feats,...p.magicItems];}
function inventory(profile){const p=normalizeProfile(profile);return [...p.equipment.weapons,...p.equipment.armor,...p.equipment.consumables,...p.equipment.gear,...p.magicItems];}
function allSpells(profile){const s=normalizeProfile(profile).spellcasting;return [...new Set([...s.cantrips,...s.knownSpells,...s.preparedSpells,...s.innateSpells,...s.rituals].map(x=>typeof x==='string'?x:x?.name).filter(Boolean))];}
function legalWeapon(profile,name){return named(normalizeProfile(profile).equipment.weapons,name);}
function legalFeature(profile,name){return named(features(profile),name);}
function legalSpell(profile,name){const p=normalizeProfile(profile);return p.spellcasting.canCastSpells&&named(allSpells(p),name)?name:null;}
function resourceAvailable(feature){if(!feature)return false;if(feature.usesCurrent!=null)return Number(feature.usesCurrent)>0;if(feature.current!=null)return Number(feature.current)>0;return true;}
function validateAction(profile,action){
  const p=normalizeProfile(profile),a=action||{},type=lower(a.type||a.kind||'custom'),conds=new Set((p.defenses.conditions||[]).map(lower));
  if(Number(p.defenses.currentHp)<=0&&!['death_save','custom'].includes(type))return {ok:false,reason:'Character is at 0 HP and cannot take that action normally.'};
  if(conds.has('incapacitated')&&['attack','cast','feature','dash','disengage','dodge','help','hide','ready','search','study','use_item'].includes(type))return {ok:false,reason:'Incapacitated prevents that action.'};
  if(type==='attack'){const w=legalWeapon(p,a.weapon);if(!w)return {ok:false,reason:'That weapon is not on the authoritative character record.'};if(w.ammo!=null&&Number(w.ammo)<=0)return {ok:false,reason:'No ammunition remains for that weapon.'};return {ok:true,weapon:w};}
  if(type==='cast'){const s=legalSpell(p,a.spell);if(!s)return {ok:false,reason:'That spell is not available on the authoritative character record.'};return {ok:true,spell:s};}
  if(type==='feature'){const f=legalFeature(p,a.feature);if(!f)return {ok:false,reason:'That feature is not on the authoritative character record.'};if(!resourceAvailable(f))return {ok:false,reason:'That feature has no remaining uses.'};return {ok:true,feature:f};}
  if(type==='use_item'){const item=named(inventory(p),a.item);if(!item)return {ok:false,reason:'That item is not on the authoritative character record.'};if(item.quantity!=null&&Number(item.quantity)<=0)return {ok:false,reason:'No uses of that item remain.'};return {ok:true,item};}
  return {ok:true};
}
function validateIntent(text,character){
  const profile=normalizeProfile(character?.profile||character||{}),t=String(text||'').trim(),l=lower(t);if(!t)return {ok:false,reason:'No action was entered.'};
  const cast=l.match(/\bcast\s+(?:the\s+)?(?:spell\s+)?([a-z][a-z' -]{1,40})/i);if(cast){const spellName=cast[1].replace(/\b(?:at|on|toward|towards|using|with)\b.*$/i,'').trim();if(!legalSpell(profile,spellName))return {ok:false,reason:`${spellName} is not available on this character record.`};}
  for(const f of features(profile)){const name=f?.name;if(!name||!l.includes(lower(name)))continue;if(!resourceAvailable(f))return {ok:false,reason:`${name} has no uses remaining.`};}
  const attack=/\b(attack|strike|slash|stab|shoot|swing|hit)\b/.test(l);if(attack&&/\bwith\b/.test(l)){const after=t.match(/\bwith\s+(?:my\s+)?([a-z][a-z' -]{1,35})/i)?.[1]?.replace(/\b(?:at|on|against)\b.*$/i,'').trim();if(after&&!legalWeapon(profile,after))return {ok:false,reason:`${after} is not an available weapon on this character record.`};}
  const use=t.match(/\buse\s+(?:my\s+|the\s+)?([a-z][a-z' -]{1,40})/i);if(use){const itemName=use[1].replace(/\b(?:on|at|against|to)\b.*$/i,'').trim();if(itemName&&!named(inventory(profile),itemName)&&!legalFeature(profile,itemName))return {ok:true,warning:`${itemName} is not clearly listed in the authoritative character record. The AI DM must verify it before allowing the action.`};}
  return {ok:true};
}
function advantageState(reasons=[]){let adv=0,dis=0;for(const r of reasons){if(r?.type==='advantage')adv++;if(r?.type==='disadvantage')dis++;}return adv&&dis?'normal':adv?'advantage':dis?'disadvantage':'normal';}
function weaponAttackRequest(profile,weapon){const w=legalWeapon(profile,weapon);if(!w)throw new Error('Unknown weapon');const b=Number(w.attackBonus||0);return {label:`${w.name} Attack`,expression:`1d20${b>=0?'+':''}${b}`,mode:'normal',hiddenDC:true};}
function weaponDamageExpression(profile,weapon,{critical=false}={}){const w=legalWeapon(profile,weapon);if(!w)throw new Error('Unknown weapon');const expr=String(w.damage||'1d4');return critical&&window.DungeonDice?window.DungeonDice.criticalExpression(expr):expr;}
function applyDamage(target,amount,type='untyped'){
  const p=normalizeProfile(target?.profile||target||{}),dtype=lower(type);amount=Math.max(0,Number(amount)||0);let adjusted=amount;if(p.defenses.immunities.map(lower).includes(dtype))adjusted=0;else if(p.defenses.resistances.map(lower).includes(dtype))adjusted=Math.floor(adjusted/2);else if(p.defenses.vulnerabilities.map(lower).includes(dtype))adjusted*=2;
  let temp=Number(p.defenses.tempHp||0),toHp=adjusted;if(temp>0){const used=Math.min(temp,toHp);temp-=used;toHp-=used;}const before=Number(p.defenses.currentHp||0),current=Math.max(0,before-toHp);return {amount,adjusted,type,previousHp:before,currentHp:current,tempHp:temp,droppedToZero:current===0};
}
function applyHealing(target,amount){const p=normalizeProfile(target?.profile||target||{}),max=Number(p.defenses.maxHp||0),before=Number(p.defenses.currentHp||0),current=Math.min(max,before+Math.max(0,Number(amount)||0));return {previousHp:before,currentHp:current,actualHealing:current-before};}
const concentrationDC=damage=>Math.max(10,Math.floor((Number(damage)||0)/2));
function deathSave(natural,current={successes:0,failures:0}){let successes=current.successes||0,failures=current.failures||0;if(natural===20)return {successes,failures,currentHp:1,stable:false,conscious:true};if(natural===1)failures+=2;else if(natural>=10)successes++;else failures++;return {successes:Math.min(3,successes),failures:Math.min(3,failures),currentHp:0,stable:successes>=3,dead:failures>=3,conscious:false};}
function spendResource(profile,featureName,count=1){const p=normalizeProfile(profile),f=features(p).find(x=>lower(x.name)===lower(featureName));if(!f)return {ok:false,reason:'Feature not found.',profile};if(f.usesCurrent==null&&f.current==null)return {ok:true,profile:p};const key=f.usesCurrent!=null?'usesCurrent':'current';if(Number(f[key])<count)return {ok:false,reason:'Not enough uses remaining.',profile};f[key]=Number(f[key])-count;return {ok:true,profile:p,remaining:f[key]};}
function effectModel({trigger,condition=null,effect,duration='instant',resourceCost=null,recovery=null,source=null}={}){return {trigger,condition,effect,duration,resourceCost,recovery,source};}
function snapshot(profile){const p=normalizeProfile(profile);return {identity:p.identity,proficiencyBonus:p.proficiencyBonus,abilities:p.abilities,defenses:p.defenses,languages:p.languages,senses:p.senses,classFeatures:p.classFeatures,subclassFeatures:p.subclassFeatures,speciesFeatures:p.speciesFeatures,feats:p.feats,equipment:p.equipment,spellcasting:p.spellcasting,magicItems:p.magicItems,attunement:p.attunement};}
window.DungeonRules={normalizeProfile,validateAction,validateIntent,allSpells,features,inventory,legalWeapon,legalFeature,legalSpell,advantageState,weaponAttackRequest,weaponDamageExpression,applyDamage,applyHealing,concentrationDC,deathSave,spendResource,effectModel,snapshot,conditions:[...CONDITIONS]};
})();