import {createSign} from 'node:crypto';

const GRADE_CONFIG=Object.freeze([{key:'4',grade:'4級'},{key:'3',grade:'3級'},{key:'pre2',grade:'準2級'},{key:'2',grade:'2級'}]);
const GRADE_BY_KEY=Object.freeze(Object.fromEntries(GRADE_CONFIG.map(entry=>[entry.key,entry])));
const ROOM_IDS=Object.freeze(GRADE_CONFIG.flatMap(entry=>Array.from({length:10},(_,index)=>`${entry.key}-${index+1}`)));
const ROOM_RULES=Object.freeze(Object.fromEntries(ROOM_IDS.map(id=>{const [gradeKey,roomNoText]=id.split('-');const config=GRADE_BY_KEY[gradeKey]||GRADE_CONFIG[0];return [id,{gradeKey,grade:config.grade,roomNo:Number(roomNoText)||1,noItems:false}]})));
export const ONLINE_BATTLE_JOIN_TTL_MS=15*60*1000;
export const ONLINE_BATTLE_RESULT_TTL_MS=2*60*1000;
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
const lobbyPath=gradeKey=>'onlineBattleLobbies/'+gradeKey;
const baseName=(projectId,path)=>'projects/'+projectId+'/databases/(default)/documents/'+path;

function readBattleServiceAccount(){
 let raw='';
 if(process.env.BATTLE_FIREBASE_SERVICE_ACCOUNT_B64){
  try{raw=Buffer.from(process.env.BATTLE_FIREBASE_SERVICE_ACCOUNT_B64,'base64').toString('utf8');}catch{}
 }
 if(!raw)raw=process.env.BATTLE_FIREBASE_SERVICE_ACCOUNT_JSON||'';
 if(!raw)return null;
 try{
  const account=JSON.parse(raw);
  if(account?.client_email&&account?.private_key)return account;
 }catch{}
 return null;
}
function b64urlJson(value){return Buffer.from(JSON.stringify(value)).toString('base64url');}
function createServiceAccountAccessToken(account,request,error){
 let cached='',cachedUntil=0;
 return async()=>{
  if(cached&&Date.now()<cachedUntil-60000)return cached;
  const now=Math.floor(Date.now()/1000);
  const header=b64urlJson({alg:'RS256',typ:'JWT'});
  const claims=b64urlJson({iss:account.client_email,scope:'https://www.googleapis.com/auth/cloud-platform',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600});
  const unsigned=`${header}.${claims}`;
  const signer=createSign('RSA-SHA256');signer.update(unsigned);signer.end();
  const assertion=`${unsigned}.${signer.sign(account.private_key).toString('base64url')}`;
  const response=await request('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},signal:AbortSignal.timeout(12000),body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion})});
  let data={};try{data=await response.json();}catch{}
  if(!response.ok||!data.access_token){
   console.error('Online battle Firebase OAuth failed',{httpStatus:response.status,error:String(data?.error||''),description:String(data?.error_description||'').slice(0,200)});
   throw error('オンライン対戦用Firebaseの認証に失敗しました。',503);
  }
  cached=data.access_token;cachedUntil=Date.now()+Number(data.expires_in||3600)*1000;
  return cached;
 };
}
function battleDatabase({base,projectId,accessToken,request,error}){
 const account=readBattleServiceAccount();
 const configuredProjectId=String(process.env.BATTLE_FIREBASE_PROJECT_ID||account?.project_id||'').trim();
 if(!account||!configuredProjectId)return {base,projectId,accessToken,separated:false};
 return {
  base:`https://firestore.googleapis.com/v1/projects/${encodeURIComponent(configuredProjectId)}/databases/(default)`,
  projectId:configuredProjectId,
  accessToken:createServiceAccountAccessToken(account,request,error),
  separated:true
 };
}

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
 return {uid,nickname,petName,petAppearance:data.petAppearance||null,petShop:data.petShop||{},petHatched:data.petHatched===true,petAdult:data.petAdult!==false,stats,level:petLevel(data),hp:0,mp:stats.mp,ready:false,rematchReady:false,lastActionAt:0,joinedAt:0};
}
function emptyRoom(id){const rules=ROOM_RULES[id]||{gradeKey:'4',grade:'4級',roomNo:1,noItems:false};return {roomId:id,roomNo:rules.roomNo,gradeKey:rules.gradeKey,grade:rules.grade,noItems:false,status:'open',players:[],seq:0,winnerUid:'',lastEvent:null,matchEndedAt:0,updatedAt:Date.now()};}
function safeRoom(value,id){
 const room={...emptyRoom(id),...value};
 room.players=Array.isArray(room.players)?room.players.slice(0,2).map(player=>{
  const stats=field(player.stats),maxHp=Math.max(1,Math.floor(number(stats.hp,10))),maxMp=Math.max(0,Math.floor(number(stats.mp,6)));
  return {...player,stats:{hp:maxHp,attack:Math.max(1,Math.floor(number(stats.attack,1))),defense:Math.max(1,Math.floor(number(stats.defense,1))),mp:maxMp},hp:Math.max(0,Math.min(maxHp,Math.floor(number(player.hp,maxHp)))),mp:player.mp===undefined?maxMp:Math.max(0,Math.min(maxMp,Math.floor(number(player.mp)))),level:Math.max(1,Math.floor(number(player.level,1))),joinedAt:Math.max(0,Math.floor(number(player.joinedAt,0)))};
 }):[];
 room.seq=Math.max(0,Math.floor(number(room.seq)));
 room.matchEndedAt=Math.max(0,Math.floor(number(room.matchEndedAt,0)));
 return room;
}
function resetExpiredRoom(room,id,at){
 const fresh=emptyRoom(id);
 fresh.seq=Math.max(0,Math.floor(number(room?.seq)))+1;
 fresh.updatedAt=at;
 fresh.matchEndedAt=0;
 return fresh;
}
export function cleanupOnlineBattleRoom(value,id,at=Date.now()){
 const room=safeRoom(value,id),current=Math.max(0,Math.floor(number(at,Date.now())));
 let changed=false,reason='';
 if(room.status==='finished'){
  const endedAt=room.matchEndedAt||Math.max(0,Math.floor(number(room.updatedAt,0)));
  if(!room.matchEndedAt&&endedAt){room.matchEndedAt=endedAt;changed=true;}
  if(endedAt&&current-endedAt>=ONLINE_BATTLE_RESULT_TTL_MS)return {room:resetExpiredRoom(room,id,current),changed:true,reason:'result-expired'};
 }
 if(room.players.length){
  const fallbackJoinAt=Math.max(0,Math.floor(number(room.updatedAt,current)))||current;
  room.players=room.players.map(player=>{
   if(player.joinedAt>0)return player;
   changed=true;
   return {...player,joinedAt:fallbackJoinAt};
  });
  const activePlayers=room.players.filter(player=>current-player.joinedAt<ONLINE_BATTLE_JOIN_TTL_MS);
  if(activePlayers.length!==room.players.length){
   room.players=activePlayers.map(player=>({...player,ready:false,rematchReady:false,lastActionAt:0}));
   room.status=room.players.length?'waiting':'open';
   room.winnerUid='';
   room.lastEvent=null;
   room.matchEndedAt=0;
   room.seq=Math.max(0,Math.floor(number(room.seq)))+1;
   room.updatedAt=current;
   changed=true;
   reason='join-expired';
  }
 }
 return {room,changed,reason};
}
function publicRoom(value,id){
 const room=safeRoom(value,id);
 return {...room,players:room.players.map(p=>({...p,uid:p.uid,petShop:p.petShop||{}}))};
}
function lobbyState(room,id){
 const rules=ROOM_RULES[id]||{gradeKey:'4',grade:'4級',roomNo:1};
 const players=Array.isArray(room.players)?room.players.slice(0,2):[];
 const playerExpiresAt=players.map(player=>Math.max(0,Math.floor(number(player.joinedAt,0)))+ONLINE_BATTLE_JOIN_TTL_MS);
 const endedAt=room.status==='finished'?(room.matchEndedAt||room.updatedAt):0;
 const matchExpiresAt=endedAt>0?Math.floor(number(endedAt))+ONLINE_BATTLE_RESULT_TTL_MS:0;
 return {roomId:id,roomNo:rules.roomNo,gradeKey:rules.gradeKey,grade:rules.grade,status:room.status||'open',playerCount:players.length,playerExpiresAt,matchExpiresAt,updatedAt:Math.max(0,Math.floor(number(room.updatedAt,0)))};
}
function lobbyStateChanged(before,after){return before.status!==after.status||before.playerCount!==after.playerCount;}

// The lobby document alone is enough to project expired rooms: no N+1 room reads/writes.
export function projectOnlineBattleLobbyRoom(value,id,at=Date.now()){
 const rules=ROOM_RULES[id]||{gradeKey:'4',grade:'4級',roomNo:1};
 const saved=field(value),current=Math.max(0,Math.floor(number(at,Date.now())));
 const updatedAt=Math.max(0,Math.floor(number(saved.updatedAt,0)));
 const originalCount=Math.max(0,Math.min(2,Math.floor(number(saved.playerCount,0))));
 let count=originalCount,status=typeof saved.status==='string'?saved.status:'open';
 const expiresAt=Math.max(0,Math.floor(number(saved.matchExpiresAt,0)));
 if(status==='finished'&&((expiresAt&&current>=expiresAt)||(!expiresAt&&updatedAt&&current>=updatedAt+ONLINE_BATTLE_RESULT_TTL_MS))){
  status='open';count=0;
 }else if(count>0){
  const playerExpiresAt=Array.isArray(saved.playerExpiresAt)?saved.playerExpiresAt:[];
  if(playerExpiresAt.length===count&&playerExpiresAt.every(value=>number(value)>0)){
   count=playerExpiresAt.filter(value=>current<number(value)).length;
  }else if(updatedAt&&current>=updatedAt+ONLINE_BATTLE_JOIN_TTL_MS){
   // Pre-migration lobby summaries have no per-player deadlines.
   count=0;
  }
  if(count<originalCount)status=count?'waiting':'open';
 }
 if(count===0)status='open';
 return {roomId:id,roomNo:rules.roomNo,gradeKey:rules.gradeKey,grade:rules.grade,status,playerCount:count,updatedAt};
}

export function createOnlineBattle({base,projectId,accessToken,verifyUser,readJson,send,fail:failExternal,decodeFields,fetch:request=globalThis.fetch,now=Date.now}){
 const error=failExternal||fail;
 const battle=battleDatabase({base,projectId,accessToken,request,error});
 async function getDocAt(baseUrl,token,path,message='対戦データを読み込めませんでした。'){
  const response=await request(baseUrl+'/documents/'+path,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(12000)});
  if(response.status===404)return null;
  let data={};try{data=await response.json();}catch{}
  if(!response.ok)throw error(message,502);
  return {fields:data.fields||{},updateTime:data.updateTime||'',value:decodeFields(data.fields||{})};
 }
 async function userWallet(token,uid){return getDocAt(base,token,walletPath(uid),'ユーザー情報を読み込めませんでした。');}
 async function roomDoc(token,id){return getDocAt(battle.base,token,roomPath(id));}
 async function lobbyDoc(token,gradeKey){return getDocAt(battle.base,token,lobbyPath(gradeKey),'ロビー情報を読み込めませんでした。');}
 async function commitAt(baseUrl,token,writes,message='対戦状態が更新されました。もう一度お試しください。'){
  if(!writes.length)return {};
  const response=await request(baseUrl+'/documents:commit',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},signal:AbortSignal.timeout(12000),body:JSON.stringify({writes})});
  let data={};try{data=await response.json();}catch{}
  if(!response.ok){const e=error(message,response.status===409||response.status===412?409:502);e.retryable=response.status===409||response.status===412||data.error?.status==='ABORTED';throw e;}
  return data;
 }
 function roomWrite(id,room,snapshot){
  const path=roomPath(id),body={name:baseName(battle.projectId,path),fields:encodeFields(room)};
  return {update:body,updateMask:{fieldPaths:Object.keys(room)},currentDocument:snapshot?.updateTime?{updateTime:snapshot.updateTime}:{exists:false}};
 }
 function lobbyWrite(id,room){
  const rules=ROOM_RULES[id]||{gradeKey:'4',grade:'4級',roomNo:1},key='room'+rules.roomNo,path=lobbyPath(rules.gradeKey),state=lobbyState(room,id);
  return {update:{name:baseName(battle.projectId,path),fields:{[key]:encode(state),gradeKey:encode(rules.gradeKey),grade:encode(rules.grade),updatedAt:encode(Math.max(0,Math.floor(number(room.updatedAt,Date.now()))))}},updateMask:{fieldPaths:[key,'gradeKey','grade','updatedAt']}};
 }
 function walletWrite(uid,wallet,coins){
  const path=walletPath(uid);
  return {update:{name:baseName(projectId,path),fields:{coins:{integerValue:String(coins)}}},updateMask:{fieldPaths:['coins']},currentDocument:wallet?.updateTime?{updateTime:wallet.updateTime}:{exists:false},updateTransforms:[{fieldPath:'coinUpdatedAt',setToServerValue:'REQUEST_TIME'}]};
 }
 function inventoryWrite(uid,wallet,inventory){
  const path=walletPath(uid);
  return {update:{name:baseName(projectId,path),fields:{petDungeonItems:encode(inventory)}},updateMask:{fieldPaths:['petDungeonItems']},currentDocument:wallet?.updateTime?{updateTime:wallet.updateTime}:{exists:false},updateTransforms:[{fieldPath:'petUpdatedAt',setToServerValue:'REQUEST_TIME'}]};
 }
 async function snapshot(id,roomToken){
  for(let attempt=0;attempt<3;attempt++){
   const doc=await roomDoc(roomToken,id),cleaned=cleanupOnlineBattleRoom(doc?.value||emptyRoom(id),id,now());
   if(!cleaned.changed)return publicRoom(cleaned.room,id);
   try{await commitAt(battle.base,roomToken,[roomWrite(id,cleaned.room,doc),lobbyWrite(id,cleaned.room)]);return publicRoom(cleaned.room,id);}
   catch(e){if(e.retryable&&attempt<2)continue;throw e;}
  }
  throw error('対戦ルームを更新できませんでした。',409);
 }
 async function lobbySummary(roomToken,gradeKey){
  const config=GRADE_BY_KEY[gradeKey];if(!config)throw error('級が見つかりません。',404);
  const doc=await lobbyDoc(roomToken,gradeKey),value=doc?.value||{};
  const current=now();
  const rooms=Array.from({length:10},(_,index)=>projectOnlineBattleLobbyRoom(value['room'+(index+1)],`${gradeKey}-${index+1}`,current));
  return {gradeKey,grade:config.grade,rooms,updatedAt:Math.max(0,Math.floor(number(value.updatedAt,0)))};
 }
 async function awardWinner(walletToken,walletWrites,uid){
  const winnerWallet=await userWallet(walletToken,uid),coins=Math.max(0,Math.floor(number(winnerWallet?.value?.coins)));
  walletWrites.push(walletWrite(uid,winnerWallet,coins+2));
 }
 async function act(id,uid,roomToken,walletToken,operation,body){
  for(let attempt=0;attempt<4;attempt++){
   const stored=await roomDoc(roomToken,id),cleaned=cleanupOnlineBattleRoom(stored?.value||emptyRoom(id),id,now());
   if(cleaned.changed){
    try{await commitAt(battle.base,roomToken,[roomWrite(id,cleaned.room,stored),lobbyWrite(id,cleaned.room)]);continue;}
    catch(e){if(e.retryable&&attempt<3)continue;throw e;}
   }
   const room=cleaned.room,beforeLobby=lobbyState(room,id),players=room.players.slice(),index=players.findIndex(p=>p.uid===uid),roomWrites=[],walletWrites=[];
   if(operation==='join'){
    if(index>=0)return {room:publicRoom(room,id)};
    if(room.status==='playing'||room.status==='finished'||players.length>=2)throw error('このルームは満室です。',409);
    const wallet=await userWallet(walletToken,uid),data=wallet?.value||{},player=profile(data,uid),at=now();player.hp=player.stats.hp;player.mp=player.stats.mp;player.joinedAt=at;players.push(player);
    room.players=players;room.status='waiting';room.matchEndedAt=0;room.updatedAt=at;room.seq++;roomWrites.push(roomWrite(id,room,stored));
   }else if(operation==='leave'){
    if(index<0)return {room:publicRoom(room,id)};
    if(room.status==='playing'){
     const opponent=players.find(p=>p.uid!==uid),at=now();
     if(opponent){
      room.players=[{...opponent,ready:false,rematchReady:false}];room.status='finished';room.winnerUid=opponent.uid;room.lastEvent={type:'forfeit',from:uid,to:opponent.uid,at};room.matchEndedAt=at;room.seq++;room.updatedAt=at;
      await awardWinner(walletToken,walletWrites,opponent.uid);roomWrites.push(roomWrite(id,room,stored));
     }else{
      room.players=[];room.status='open';room.winnerUid='';room.lastEvent=null;room.matchEndedAt=0;room.seq++;room.updatedAt=at;roomWrites.push(roomWrite(id,room,stored));
     }
    }else{
     room.players=players.filter(p=>p.uid!==uid).map(p=>({...p,ready:false,rematchReady:false}));
     room.status=room.players.length?'waiting':'open';room.winnerUid='';room.lastEvent=null;room.matchEndedAt=0;room.seq++;room.updatedAt=now();roomWrites.push(roomWrite(id,room,stored));
    }
   }else{
    if(index<0)throw error('先にルームへ入室してください。',403);
    if(operation==='ready'){
     if(room.status!=='waiting'||players.length!==2)throw error('相手が入室するまでお待ちください。',409);
     players[index]={...players[index],ready:true};room.players=players;
     if(players.every(p=>p.ready)){
      const wallets=await Promise.all(players.map(p=>userWallet(walletToken,p.uid))),balances=wallets.map(w=>Math.max(0,Math.floor(number(w?.value?.coins))));
      if(balances.some(value=>value<1))throw error('対戦開始には２人とも１コイン必要です。',400);
      players.forEach(p=>{p.hp=p.stats.hp;p.mp=p.stats.mp;p.lastActionAt=0;p.rematchReady=false;});
      room.players=players;room.status='playing';room.winnerUid='';room.matchEndedAt=0;room.lastEvent={type:'start',at:now()};
      wallets.forEach((wallet,i)=>walletWrites.push(walletWrite(players[i].uid,wallet,balances[i]-1)));
     }
    }else if(operation==='miss'){
     if(room.status!=='playing')throw error('対戦中ではありません。',409);
     const attacker=players[index],at=now();
     if(at-number(attacker.lastActionAt)>0&&at-number(attacker.lastActionAt)<1200)throw error('少し待ってから解答してください。',429);
     attacker.hp=Math.max(0,Math.floor(number(attacker.hp))-1);attacker.lastActionAt=at;room.seq++;room.lastEvent={type:'miss',from:uid,damage:1,at};
     if(attacker.hp<=0){room.status='finished';room.winnerUid=index===0?players[1].uid:players[0].uid;room.matchEndedAt=at;await awardWinner(walletToken,walletWrites,room.winnerUid);}
    }else if(operation==='magic'){
     if(room.status!=='playing')throw error('対戦中ではありません。',409);
     if(room.noItems)throw error('このルームは魔法・アイテムなしです。',400);
     const spell=MAGIC_SPELLS.find(entry=>entry.id===String(body?.spellId||''));
     if(!spell)throw error('使用する魔法を選んでください。',400);
     const wallet=await userWallet(walletToken,uid),level=petLevel(wallet?.value||{}),attacker=players[index],at=now();
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
      if(defender.hp<=0){room.status='finished';room.winnerUid=uid;room.matchEndedAt=at;await awardWinner(walletToken,walletWrites,uid);}
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
     const wallet=await userWallet(walletToken,uid),inventory=normalizeInventory(wallet?.value?.petDungeonItems);
     if((inventory[item.id]||0)<1)throw error(item.name+'を持っていません。',400);
     inventory[item.id]-=1;walletWrites.push(inventoryWrite(uid,wallet,inventory));attacker.lastActionAt=at;room.seq++;
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
     if(defender.hp<=0){room.status='finished';room.winnerUid=uid;room.matchEndedAt=at;await awardWinner(walletToken,walletWrites,uid);}
    }else if(operation==='continue'){
     if(room.status!=='finished'||players.length!==2)throw error('再戦するには相手が必要です。',409);
     players[index]={...players[index],rematchReady:true};room.players=players;
     if(players.every(p=>p.rematchReady)){
      const wallets=await Promise.all(players.map(p=>userWallet(walletToken,p.uid))),balances=wallets.map(w=>Math.max(0,Math.floor(number(w?.value?.coins))));
      if(balances.some(value=>value<1))throw error('再戦には２人とも１コイン必要です。',400);
      wallets.forEach((wallet,i)=>walletWrites.push(walletWrite(players[i].uid,wallet,balances[i]-1)));
      players.forEach(p=>{p.hp=p.stats.hp;p.mp=p.stats.mp;p.ready=true;p.rematchReady=false;p.lastActionAt=0;});
      room.players=players;room.status='playing';room.winnerUid='';room.matchEndedAt=0;room.lastEvent={type:'start',at:now()};
     }
    }else throw error('操作が正しくありません。',400);
    room.seq++;room.updatedAt=now();roomWrites.push(roomWrite(id,room,stored));
   }
   if(roomWrites.length&&lobbyStateChanged(beforeLobby,lobbyState(room,id)))roomWrites.push(lobbyWrite(id,room));
   let roomCommitted=false;
   try{
    await commitAt(battle.base,roomToken,roomWrites);
    roomCommitted=true;
    if(walletWrites.length)await commitAt(base,walletToken,walletWrites,'コイン・アイテム情報を更新できませんでした。もう一度お試しください。');
    return {room:publicRoom(room,id)};
   }catch(e){
    if(!roomCommitted&&e.retryable&&attempt<3)continue;
    throw e;
   }
  }
  throw error('対戦状態の更新が競合しました。もう一度お試しください。',409);
 }
 async function handle(req,res,path){
  try{
   const user=await verifyUser(req),roomToken=await battle.accessToken();
   if(req.method==='GET'&&path==='/api/online-battle/rooms')return send(res,200,{rooms:[]});
   const lobbyMatch=path.match(/^\/api\/online-battle\/lobby\/(4|3|pre2|2)$/);
   if(req.method==='GET'&&lobbyMatch)return send(res,200,{lobby:await lobbySummary(roomToken,lobbyMatch[1])});
   const match=path.match(/^\/api\/online-battle\/room\/((?:4|3|pre2|2)-(?:10|[1-9]))(?:\/(join|ready|attack|magic|item|miss|continue|leave))?$/);
   if(!match)throw error('対戦ルームが見つかりません。',404);
   const id=match[1],operation=match[2];
   if(req.method==='GET'&&!operation)return send(res,200,{room:await snapshot(id,roomToken)});
   if(req.method!=='POST'||!operation)throw error('この操作は利用できません。',405);
   const walletToken=await accessToken(),body=await readJson(req,1024),result=await act(id,user.uid,roomToken,walletToken,operation,body);
   send(res,200,{ok:true,...result});
  }catch(e){send(res,e.status||500,{error:e.message||'オンライン対戦でエラーが発生しました。'});}
 }
 return {handle,ROOM_IDS,battleDatabaseSeparated:battle.separated,battleProjectId:battle.projectId};
}
