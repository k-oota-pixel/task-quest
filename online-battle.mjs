const ROOM_IDS=Object.freeze(Array.from({length:12},(_,index)=>String(index+1)));
const ROOM_RULES=Object.freeze(Object.fromEntries(ROOM_IDS.map(id=>{const n=Number(id);const block=Math.floor((n-1)/3);return [id,{grade:['4級','3級','準2級','2級'][block]||'2級',noItems:n%3===0}]})));
const MAGIC_SPELLS=Object.freeze([
 {id:'mimuros',name:'ミムロス',level:5,kind:'heal',base:10,mpCost:5},
 {id:'mirogoro',name:'ミロゴロ',level:15,kind:'attack',base:15,mpCost:5},
 {id:'mimurose',name:'ミムローズ',level:25,kind:'heal',base:30,mpCost:10},
 {id:'mirogoron',name:'ミロゴロン',level:35,kind:'attack',base:30,mpCost:10}
]);
const DUNGEON_ITEMS=Object.freeze([
 {id:'bandage',name:'ばんそうこう',icon:'🩹',kind:'hp',amount:10},
 {id:'medicine',name:'きずぐすり',icon:'🧴',kind:'hp',amount:20},
 {id:'date-hospital-prescription',name:'伊達医院の処方箋',icon:'📄',kind:'hp',amount:100},
 {id:'inter-prescription',name:'インターの処方箋',icon:'📄',kind:'hp',amount:100},
 {id:'date-water',name:'だてのみず',icon:'💧',kind:'mp',amount:10},
 {id:'yoteizan-water',name:'ようていざんのみず',icon:'🏔️',kind:'mp',amount:20}
]);
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const field=v=>v&&typeof v==='object'?v:{};
const number=(v,fallback=0)=>Number.isFinite(Number(v))?Number(v):fallback;
const encode=value=>{
 if(value===null||value===undefined)return {nullValue:null};
 if(typeof value==='string')return {stringValue:value};
 if(typeof value==='boolean')return {booleanValue:value};
 if(Number.isSafeInteger(value))return {integerValue:String(value)};
 if(typeof value==='number'&&Number.isFinite(value))return {doubleValue:value};
 if(Array.isArray(value))return {arrayValue:{values:value.map(encode)}};
 if(typeof value==='object')return {mapValue:{fields:Object.fromEntries(Object.entries(value).map(([k,v])=>[k,encode(v)]))}};
 return {nullValue:null};
};
const encodeFields=value=>Object.fromEntries(Object.entries(value).map(([k,v])=>[k,encode(v)]));
const walletPath=uid=>'users/'+encodeURIComponent(uid)+'/apps/english-playroom';
const roomPath=id=>'onlineBattleRooms/room'+id;
const baseName=(projectId,path)=>'projects/'+projectId+'/databases/(default)/documents/'+path;
function ageBonuses(days,adult){
 const out={hp:adult?2:0,attack:adult?1:0,defense:adult?1:0,mp:adult?2:0};
 if(!adult)return out;
 const milestones=[[5,2,1,1,2],[10,3,2,2,3],[15,2,1,1,2],[20,3,2,2,3],[25,2,1,1,2],[30,3,2,2,3],[35,2,1,1,2]];
 for(const [day,hp,attack,defense,mp] of milestones){if(days<day)break;out.hp+=hp;out.attack+=attack;out.defense+=defense;out.mp+=mp;}
 return out;
}
function allocationTotal(allocation={}){
 return ['hp','attack','defense','mp'].reduce((sum,key)=>{const n=Number(allocation?.[key]);return sum+(Number.isSafeInteger(n)&&n>0?n:0);},0);
}
function petLevel(data={}){
 const stored=Number(data.petStrengthLevelPoints),safeStored=Number.isSafeInteger(stored)&&stored>0?stored:0;
 return 1+Math.max(safeStored,allocationTotal(field(data.petStrength)));
}
function petStats(data){
 const base=field(data.petBaseStats),allocation=field(data.petStrength);
 const hp0=Math.max(10,Math.min(15,Math.floor(number(base.hp,10))));
 const attack0=Math.max(1,Math.min(6,Math.floor(number(base.attack,1))));
 const defense0=Math.max(1,Math.min(6,Math.floor(number(base.defense,1))));
 const mp0=Math.max(6,Math.min(11,Math.floor(number(base.mp,6))));
 const adult=data.petHatched===true&&data.petAdult!==false,age=ageBonuses(Math.max(0,Math.floor(number(data.petLifeDays))),adult);
 return {
  hp:hp0+Math.min(1000,Math.max(0,Math.floor(number(allocation.hp))))*2+age.hp,
  attack:attack0+Math.min(1000,Math.max(0,Math.floor(number(allocation.attack))))+age.attack,
  defense:defense0+Math.min(1000,Math.max(0,Math.floor(number(allocation.defense))))+age.defense,
  mp:mp0+Math.min(1000,Math.max(0,Math.floor(number(allocation.mp))))+age.mp
 };
}
function normalizeInventory(value={}){
 const source=field(value),next={};
 for(const item of DUNGEON_ITEMS){const n=Number(source[item.id]);next[item.id]=Number.isSafeInteger(n)&&n>0?n:0;}
 return next;
}
function rollMagicAmount(base,random=Math.random){
 const value=Math.max(0,Number(base)||0),r=Math.max(0,Math.min(.999999,Number(random())||0));
 if(r<.5)return value;
 if(r<.625)return Math.max(0,value-2);
 if(r<.75)return Math.max(0,value-1);
 if(r<.875)return value+1;
 return value+2;
}
function profile(data,uid){
 const nickname=typeof data.nickname==='string'&&data.nickname.trim()?data.nickname.trim().slice(0,24):'なまえ未設定';
 const petName=typeof data.petName==='string'&&data.petName.trim()?data.petName.trim().slice(0,24):(data.petHatched?'ペット':'ふしぎなたまご');
 const stats=petStats(data);
 return {uid,nickname,petName,petAppearance:data.petAppearance||null,petShop:data.petShop||{},petHatched:data.petHatched===true,petAdult:data.petAdult!==false,stats,level:petLevel(data),hp:0,mp:stats.mp,ready:false,rematchReady:false,lastActionAt:0};
}
function emptyRoom(id){const rules=ROOM_RULES[id]||{grade:'4級',noItems:false};return {roomId:id,grade:rules.grade,noItems:rules.noItems,status:'open',players:[],seq:0,winnerUid:'',lastEvent:null,updatedAt:Date.now()};}
function safeRoom(value,id){
 const room={...emptyRoom(id),...value};
 room.players=Array.isArray(room.players)?room.players.slice(0,2).map(player=>{
  const stats=field(player.stats),maxHp=Math.max(1,Math.floor(number(stats.hp,10))),maxMp=Math.max(0,Math.floor(number(stats.mp,6)));
  return {...player,stats:{hp:maxHp,attack:Math.max(1,Math.floor(number(stats.attack,1))),defense:Math.max(1,Math.floor(number(stats.defense,1))),mp:maxMp},hp:Math.max(0,Math.min(maxHp,Math.floor(number(player.hp,maxHp)))),mp:player.mp===undefined?maxMp:Math.max(0,Math.min(maxMp,Math.floor(number(player.mp)))),level:Math.max(1,Math.floor(number(player.level,1)))};
 }):[];
 room.seq=Math.max(0,Math.floor(number(room.seq)));
 return room;
}
function publicRoom(value,id){
 const room=safeRoom(value,id);
 return {...room,players:room.players.map(p=>({...p,uid:p.uid,petShop:p.petShop||{}}))};
}
export function createOnlineBattle({base,projectId,accessToken,verifyUser,readJson,send,fail:failExternal,decodeFields,fetch:request=globalThis.fetch,now=Date.now}){
 const error=failExternal||fail;
 async function getDoc(token,path){
  const response=await request(base+'/documents/'+path,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(12000)});
  if(response.status===404)return null;
  let data={};try{data=await response.json();}catch{}
  if(!response.ok)throw error('対戦データを読み込めませんでした。',502);
  return {fields:data.fields||{},updateTime:data.updateTime||'',value:decodeFields(data.fields||{})};
 }
 async function userWallet(token,uid){return getDoc(token,walletPath(uid));}
 async function commit(token,writes){
  const response=await request(base+'/documents:commit',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},signal:AbortSignal.timeout(12000),body:JSON.stringify({writes})});
  let data={};try{data=await response.json();}catch{}
  if(!response.ok){const e=error('対戦状態が更新されました。もう一度お試しください。',response.status===409||response.status===412?409:502);e.retryable=response.status===409||response.status===412||data.error?.status==='ABORTED';throw e;}
  return data;
 }
 function roomWrite(id,room,snapshot){
  const path=roomPath(id),body={name:baseName(projectId,path),fields:encodeFields(room)};
  return {update:body,updateMask:{fieldPaths:Object.keys(room)},currentDocument:snapshot?.updateTime?{updateTime:snapshot.updateTime}:{exists:false}};
 }
 function walletWrite(uid,wallet,coins){
  const path=walletPath(uid);
  return {update:{name:baseName(projectId,path),fields:{coins:{integerValue:String(coins)}}},updateMask:{fieldPaths:['coins']},currentDocument:wallet?.updateTime?{updateTime:wallet.updateTime}:{exists:false},updateTransforms:[{fieldPath:'coinUpdatedAt',setToServerValue:'REQUEST_TIME'}]};
 }
 function inventoryWrite(uid,wallet,inventory){
  const path=walletPath(uid);
  return {update:{name:baseName(projectId,path),fields:{petDungeonItems:encode(inventory)}},updateMask:{fieldPaths:['petDungeonItems']},currentDocument:wallet?.updateTime?{updateTime:wallet.updateTime}:{exists:false},updateTransforms:[{fieldPath:'petUpdatedAt',setToServerValue:'REQUEST_TIME'}]};
 }
 async function snapshot(id,token){
  const doc=await getDoc(token,roomPath(id));
  return publicRoom(doc?.value||emptyRoom(id),id);
 }
 async function rooms(token){return Promise.all(ROOM_IDS.map(id=>snapshot(id,token)));}
 async function awardWinner(token,writes,uid){
  const winnerWallet=await userWallet(token,uid),coins=Math.max(0,Math.floor(number(winnerWallet?.value?.coins)));
  writes.push(walletWrite(uid,winnerWallet,coins+2));
 }
 async function act(id,uid,token,operation,body){
  for(let attempt=0;attempt<4;attempt++){
   const stored=await getDoc(token,roomPath(id)),room=safeRoom(stored?.value||emptyRoom(id),id);
   const players=room.players.slice(),index=players.findIndex(p=>p.uid===uid),writes=[];
   if(operation==='join'){
    if(index>=0)return {room:publicRoom(room,id)};
    if(room.status==='playing'||room.status==='finished'||players.length>=2)throw error('このルームは満室です。',409);
    const wallet=await userWallet(token,uid),data=wallet?.value||{},player=profile(data,uid);player.hp=player.stats.hp;player.mp=player.stats.mp;players.push(player);
    room.players=players;room.status='waiting';room.updatedAt=now();room.seq++;writes.push(roomWrite(id,room,stored));
   }else if(operation==='leave'){
    if(index<0)return {room:publicRoom(room,id)};
    if(room.status==='playing'){
     const opponent=players.find(p=>p.uid!==uid),at=now();
     if(opponent){
      room.players=[{...opponent,ready:false,rematchReady:false}];room.status='finished';room.winnerUid=opponent.uid;room.lastEvent={type:'forfeit',from:uid,to:opponent.uid,at};room.seq++;room.updatedAt=at;
      await awardWinner(token,writes,opponent.uid);writes.push(roomWrite(id,room,stored));
     }else{
      room.players=[];room.status='open';room.winnerUid='';room.lastEvent=null;room.seq++;room.updatedAt=at;writes.push(roomWrite(id,room,stored));
     }
    }else{
     room.players=players.filter(p=>p.uid!==uid).map(p=>({...p,ready:false,rematchReady:false}));
     room.status=room.players.length?'waiting':'open';room.winnerUid='';room.lastEvent=null;room.seq++;room.updatedAt=now();writes.push(roomWrite(id,room,stored));
    }
   }else{
    if(index<0)throw error('先にルームへ入室してください。',403);
    if(operation==='ready'){
     if(room.status!=='waiting'||players.length!==2)throw error('相手が入室するまでお待ちください。',409);
     players[index]={...players[index],ready:true};room.players=players;
     if(players.every(p=>p.ready)){
      const wallets=await Promise.all(players.map(p=>userWallet(token,p.uid))),balances=wallets.map(w=>Math.max(0,Math.floor(number(w?.value?.coins))));
      if(balances.some(value=>value<1))throw error('対戦開始には２人とも１コイン必要です。',400);
      players.forEach(p=>{p.hp=p.stats.hp;p.mp=p.stats.mp;p.lastActionAt=0;p.rematchReady=false;});
      room.players=players;room.status='playing';room.winnerUid='';room.lastEvent={type:'start',at:now()};
      wallets.forEach((wallet,i)=>writes.push(walletWrite(players[i].uid,wallet,balances[i]-1)));
     }
    }else if(operation==='miss'){
     if(room.status!=='playing')throw error('対戦中ではありません。',409);
     const attacker=players[index],at=now();
     if(at-number(attacker.lastActionAt)>0&&at-number(attacker.lastActionAt)<1200)throw error('少し待ってから解答してください。',429);
     attacker.hp=Math.max(0,Math.floor(number(attacker.hp))-1);attacker.lastActionAt=at;room.seq++;room.lastEvent={type:'miss',from:uid,damage:1,at};
     if(attacker.hp<=0){room.status='finished';room.winnerUid=index===0?players[1].uid:players[0].uid;await awardWinner(token,writes,room.winnerUid);}
    }else if(operation==='magic'){
     if(room.status!=='playing')throw error('対戦中ではありません。',409);
     if(room.noItems)throw error('このルームは魔法・アイテムなしです。',400);
     const spell=MAGIC_SPELLS.find(entry=>entry.id===String(body?.spellId||''));
     if(!spell)throw error('使用する魔法を選んでください。',400);
     const wallet=await userWallet(token,uid),level=petLevel(wallet?.value||{}),attacker=players[index],at=now();
     if(level<spell.level)throw error('この魔法はまだ習得していません。',400);
     if(at-number(attacker.lastActionAt)>0&&at-number(attacker.lastActionAt)<1200)throw error('少し待ってから魔法を使ってください。',429);
     if(Math.floor(number(attacker.mp))<spell.mpCost)throw error('MPが足りません。',400);
     if(spell.kind==='heal'&&attacker.hp>=attacker.stats.hp)throw error('HPは満タンです。',400);
     attacker.mp=Math.max(0,Math.floor(number(attacker.mp))-spell.mpCost);attacker.lastActionAt=at;room.seq++;
     const rolled=rollMagicAmount(spell.base);
     if(spell.kind==='heal'){
      const before=attacker.hp;attacker.hp=Math.min(attacker.stats.hp,attacker.hp+rolled);const heal=attacker.hp-before;
      room.lastEvent={type:'magic',kind:'heal',from:uid,spellId:spell.id,name:spell.name,heal,mpCost:spell.mpCost,at};
     }else{
      const targetIndex=index===0?1:0,defender=players[targetIndex],damage=Math.max(0,rolled);
      defender.hp=Math.max(0,Math.floor(number(defender.hp))-damage);room.lastEvent={type:'magic',kind:'attack',from:uid,to:defender.uid,spellId:spell.id,name:spell.name,damage,mpCost:spell.mpCost,at};
      if(defender.hp<=0){room.status='finished';room.winnerUid=uid;await awardWinner(token,writes,uid);}
     }
    }else if(operation==='item'){
     if(room.status!=='playing')throw error('対戦中ではありません。',409);
     if(room.noItems)throw error('このルームは魔法・アイテムなしです。',400);
     const item=DUNGEON_ITEMS.find(entry=>entry.id===String(body?.itemId||''));
     if(!item)throw error('使用するアイテムを選んでください。',400);
     const attacker=players[index],at=now();
     if(at-number(attacker.lastActionAt)>0&&at-number(attacker.lastActionAt)<1200)throw error('少し待ってからアイテムを使ってください。',429);
     if(item.kind==='hp'&&attacker.hp>=attacker.stats.hp)throw error('HPは満タンです。',400);
     if(item.kind==='mp'&&attacker.mp>=attacker.stats.mp)throw error('MPは満タンです。',400);
     const wallet=await userWallet(token,uid),inventory=normalizeInventory(wallet?.value?.petDungeonItems);
     if((inventory[item.id]||0)<1)throw error(item.name+'を持っていません。',400);
     inventory[item.id]-=1;writes.push(inventoryWrite(uid,wallet,inventory));attacker.lastActionAt=at;room.seq++;
     let amount=0;
     if(item.kind==='hp'){const before=attacker.hp;attacker.hp=Math.min(attacker.stats.hp,attacker.hp+item.amount);amount=attacker.hp-before;}
     else{const before=attacker.mp;attacker.mp=Math.min(attacker.stats.mp,attacker.mp+item.amount);amount=attacker.mp-before;}
     room.lastEvent={type:'item',kind:item.kind,from:uid,itemId:item.id,name:item.name,icon:item.icon,amount,at};
    }else if(operation==='attack'){
     if(room.status!=='playing')throw error('対戦中ではありません。',409);
     const attacker=players[index],targetIndex=index===0?1:0,defender=players[targetIndex],at=now();
     if(at-number(attacker.lastActionAt)>0&&at-number(attacker.lastActionAt)<1200)throw error('少し待ってから攻撃してください。',429);
     const damage=Math.max(1,Math.floor(number(attacker.stats?.attack,1)+2-number(defender.stats?.defense,1)));
     defender.hp=Math.max(0,Math.floor(number(defender.hp))-damage);attacker.lastActionAt=at;room.seq++;room.lastEvent={type:'attack',from:uid,to:defender.uid,damage,at};
     if(defender.hp<=0){room.status='finished';room.winnerUid=uid;await awardWinner(token,writes,uid);}
    }else if(operation==='continue'){
     if(room.status!=='finished'||players.length!==2)throw error('再戦するには相手が必要です。',409);
     players[index]={...players[index],rematchReady:true};room.players=players;
     if(players.every(p=>p.rematchReady)){
      const wallets=await Promise.all(players.map(p=>userWallet(token,p.uid))),balances=wallets.map(w=>Math.max(0,Math.floor(number(w?.value?.coins))));
      if(balances.some(value=>value<1))throw error('再戦には２人とも１コイン必要です。',400);
      wallets.forEach((wallet,i)=>writes.push(walletWrite(players[i].uid,wallet,balances[i]-1)));
      players.forEach(p=>{p.hp=p.stats.hp;p.mp=p.stats.mp;p.ready=true;p.rematchReady=false;p.lastActionAt=0;});
      room.players=players;room.status='playing';room.winnerUid='';room.lastEvent={type:'start',at:now()};
     }
    }else throw error('操作が正しくありません。',400);
    room.seq++;room.updatedAt=now();writes.push(roomWrite(id,room,stored));
   }
   try{await commit(token,writes);return {room:publicRoom(room,id)};}
   catch(e){if(e.retryable&&attempt<3)continue;throw e;}
  }
  throw error('対戦状態の更新が競合しました。もう一度お試しください。',409);
 }
 async function handle(req,res,path){
  try{
   const user=await verifyUser(req),token=await accessToken();
   if(req.method==='GET'&&path==='/api/online-battle/rooms')return send(res,200,{rooms:await rooms(token)});
   const match=path.match(/^\/api\/online-battle\/room\/(1[0-2]|[1-9])(?:\/(join|ready|attack|magic|item|miss|continue|leave))?$/);
   if(!match)throw error('対戦ルームが見つかりません。',404);
   const id=match[1],operation=match[2];
   if(req.method==='GET'&&!operation)return send(res,200,{room:await snapshot(id,token)});
   if(req.method!=='POST'||!operation)throw error('この操作は利用できません。',405);
   const body=await readJson(req,1024),result=await act(id,user.uid,token,operation,body);
   send(res,200,{ok:true,...result});
  }catch(e){send(res,e.status||500,{error:e.message||'オンライン対戦でエラーが発生しました。'});}
 }
 return {handle,ROOM_IDS};
}