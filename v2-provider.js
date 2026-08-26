(()=>{
'use strict';
function apply(){if(window.DungeonAI?.setProvider){window.DungeonAI.setProvider({type:'supabase-edge',functionName:'dungeon-v2-ai'});return true;}return false;}
if(!apply())window.addEventListener('load',apply,{once:true});
})();