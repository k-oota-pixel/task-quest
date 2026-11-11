import {createSign,randomUUID} from 'node:crypto';
import {ONLINE_BATTLE_GRADES,nextOnlineBattleStanding,previousJapanBattleDay,japanBattleDay,projectOnlineBattleLeaderboard,onlineBattleRankingScanComplete} from './online-battle-standings.mjs';

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
const statsPath=(gradeKey,uid)=>'onlineBattleStats/'+gradeKey+'/players/'+encodeURIComponent(uid);
const dailyRankingPath=gradeKey=>'onlineBattleRankings/'+gradeKey;
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
 return {uid,nickname,petName,petAppearance:data.petAppearance||null,petShop:data.petShop||{},petHatched:data.petHatched===true,petAdult:data.petAdult!==false,stats,level:petLevel(data),hp:0,mp:stats.mp,ready:false,rematchReady:false,lastActionAt:0,joinedAt:0,coinsAtJoin:Math.max(0,Math.floor(number(data.coins))),battleInventory:normalizeInventory(data.petDungeonItems),spentItems:{}};
}
function emptyRoom(id){const rules=ROOM_RULES[id]||{gradeKey:'4',grade:'4級',roomNo:1,noItems:false};return {roomId:id,roomNo:rules.roomNo,gradeKey:rules.gradeKey,grade:rules.grade,noItems:false,status:'open',players:[],seq:0,winnerUid:'',lastEvent:null,matchId:'',pendingSettlement:null,matchEndedAt:0,updatedAt:Date.now()};}
function safeRoom(value,id){
 const room={...emptyRoom(id),...value};
 room.players=Array.isArray(room.players)?room.players.slice(0,2).map(player=>{
  const stats=field(player.stats),maxHp=Math.max(1,Math.floor(number(stats.hp,10))),maxMp=Math.max(0,Math.floor(number(stats.mp,6)));
  return {...player,stats:{hp:maxHp,attack:Math.max(1,Math.floor(number(stats.attack,1))),defense:Math.max(1,Math.floor(number(stats.defense,1))),mp:maxMp},hp:Math.max(0,Math.min(maxHp,Math.floor(number(player.hp,maxHp)))),mp:player.mp===undefined?maxMp:Math.max(0,Math.min(maxMp,Math.floor(number(player.mp)))),level:Math.max(1,Math.floor(number(player.level,1))),joinedAt:Math.max(0,Math.floor(number(player.joinedAt,0))),coinsAtJoin:Math.max(0,Math.floor(number(player.coinsAtJoin))),battleInventory:normalizeInventory(player.battleInventory),spentItems:normalizeInventory(player.spentItems)};
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
function createPendingSettlement(room,players=room.players,winnerUid=room.winnerUid){
 const entries=(players||[]).map(player=>({
  uid:String(player.uid||''),
  coins:player.uid===winnerUid?1:0,
  items:Object.fromEntries(DUNGEON_ITEMS.map(item=>[item.id,Math.max(0,Math.floor(number(player.spentItems?.[item.id])))]).filter(([,count])=>count>0))
 })).filter(row=>row.uid&&(row.coins>0||Object.keys(row.items).length>0));
 if(!entries.length)return null;
 const matchId=String(room.matchId||'legacy-'+room.roomId+'-'+room.updatedAt+'-'+room.seq).replace(/[^A-Za-z0-9-]/g,'-');
 return {id:matchId,roomId:room.roomId,entries,createdAt:Date.now()};
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
   if(room.status==='playing'&&!room.pendingSettlement)room.pendingSettlement=createPendingSettlement(room,room.players,'');
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
function publicRoom(value,id,viewerUid=''){
 const {pendingSettlement,...room}=safeRoom(value,id);
 return {...room,players:room.players.map(player=>{
  const {battleInventory,spentItems,coinsAtJoin,...safe}=player;
  return {...safe,petShop:player.petShop||{},...(player.uid===viewerUid?{inventory:battleInventory,coins:coinsAtJoin}:{})};
 })};
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
 async function standingDoc(token,gradeKey,uid){return getDocAt(battle.base,token,statsPath(gradeKey,uid),'対戦成績を読み込めませんでした。');}
 async function dailyRankingDoc(token,gradeKey){return getDocAt(battle.base,token,dailyRankingPath(gradeKey),'ランキングを読み込めませんでした。');}
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
 function standingWrite(gradeKey,uid,standing,snapshot){
  return {update:{name:baseName(battle.projectId,statsPath(gradeKey,uid)),fields:encodeFields(standing)},updateMask:{fieldPaths:Object.keys(standing)},currentDocument:snapshot?.updateTime?{updateTime:snapshot.updateTime}:{exists:false}};
 }
 function ledgerPath(id){return 'onlineBattleSettlements/'+encodeURIComponent(id);}
 function settlementWrites(settlement){
  const writes=[{update:{name:baseName(projectId,ledgerPath(settlement.id)),fields:encodeFields({id:settlement.id,roomId:settlement.roomId,createdAt:settlement.createdAt})},currentDocument:{exists:false}}];
  for(const entry of settlement.entries){
   const transforms=[];
   if(entry.coins)transforms.push({fieldPath:'coins',increment:encode(entry.coins)});
   for(const [itemId,count] of Object.entries(entry.items||{})){
    if(!DUNGEON_ITEMS.some(item=>item.id===itemId)||!Number.isSafeInteger(count)||count<=0)continue;
    const fieldPath='petDungeonItems.'+String.fromCharCode(96)+itemId+String.fromCharCode(96);
    transforms.push({fieldPath,increment:encode(-count)});
   }
   if(transforms.length)writes.push({transform:{document:baseName(projectId,walletPath(entry.uid)),fieldTransforms:transforms},currentDocument:{exists:true}});
  }
  return writes;
 }
 async function applySettlement(walletToken,settlement){
  try{await commitAt(base,walletToken,settlementWrites(settlement),'対戦報酬・アイテムの精算を保存できませんでした。');}
  catch(e){
   const saved=await getDocAt(base,walletToken,ledgerPath(settlement.id),'精算記録を確認できませんでした。');
   if(saved?.value?.id===settlement.id)return;
   throw e;
  }
 }
 async function settlePending(id,roomToken,walletToken,stored){
  const pending=stored?.value?.pendingSettlement;
  if(!pending)return false;
  await applySettlement(walletToken,pending);
  const room=safeRoom(stored.value,id);room.pendingSettlement=null;
  try{await commitAt(battle.base,roomToken,[roomWrite(id,room,stored)],'精算状態を保存できませんでした。');}
  catch(e){if(!e.retryable)throw e;}
  return true;
 }
 function inventoryWrite(uid,wallet,inventory){
  const path=walletPath(uid);
  return {update:{name:baseName(projectId,path),fields:{petDungeonItems:encode(inventory)}},updateMask:{fieldPaths:['petDungeonItems']},currentDocument:wallet?.updateTime?{updateTime:wallet.updateTime}:{exists:false},updateTransforms:[{fieldPath:'petUpdatedAt',setToServerValue:'REQUEST_TIME'}]};
 }
 async function snapshot(id,roomToken,viewerUid){
  for(let attempt=0;attempt<6;attempt++){
   const doc=await roomDoc(roomToken,id);
   if(doc?.value?.pendingSettlement){await settlePending(id,roomToken,await accessToken(),doc);continue;}
   const cleaned=cleanupOnlineBattleRoom(doc?.value||emptyRoom(id),id,now());
   if(!cleaned.changed)return publicRoom(cleaned.room,id,viewerUid);
   try{await commitAt(battle.base,roomToken,[roomWrite(id,cleaned.room,doc),lobbyWrite(id,cleaned.room)]);continue;}
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
 async function act(id,uid,roomToken,walletToken,operation,body){
  for(let attempt=0;attempt<6;attempt++){
   const stored=await roomDoc(roomToken,id);
   if(stored?.value?.pendingSettlement){await settlePending(id,roomToken,walletToken,stored);continue;}
   const cleaned=cleanupOnlineBattleRoom(stored?.value||emptyRoom(id),id,now());
   if(cleaned.changed){
    try{await commitAt(battle.base,roomToken,[roomWrite(id,cleaned.room,stored),lobbyWrite(id,cleaned.room)]);continue;}
    catch(e){if(e.retryable&&attempt<3)continue;throw e;}
   }
   const room=cleaned.room,beforeLobby=lobbyState(room,id),previousStatus=room.status,players=room.players.slice(),previousPlayers=room.players.slice(),index=players.findIndex(p=>p.uid===uid),roomWrites=[];
   if(operation==='join'){
    if(index>=0)return {room:publicRoom(room,id,uid)};
    if(room.status==='playing'||room.status==='finished'||players.length>=2)throw error('このルームは満室です。',409);
    const wallet=await userWallet(walletToken,uid),data=wallet?.value||{};
    const player=profile(data,uid),at=now();player.hp=player.stats.hp;player.mp=player.stats.mp;player.joinedAt=at;players.push(player);
    room.players=players;room.status='waiting';room.matchEndedAt=0;room.updatedAt=at;room.seq++;roomWrites.push(roomWrite(id,room,stored));
   }else if(operation==='leave'){
    if(index<0)return {room:publicRoom(room,id,uid)};
    if(room.status==='playing'){
     const opponent=players.find(p=>p.uid!==uid),at=now();
     if(opponent){
      room.players=[{...opponent,ready:false,rematchReady:false}];room.status='finished';room.winnerUid=opponent.uid;room.lastEvent={type:'forfeit',from:uid,to:opponent.uid,at};room.matchEndedAt=at;room.seq++;room.updatedAt=at;
      roomWrites.push(roomWrite(id,room,stored));
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
      players.forEach(p=>{p.hp=p.stats.hp;p.mp=p.stats.mp;p.lastActionAt=0;p.rematchReady=false;});
      room.players=players;room.status='playing';room.winnerUid='';room.matchEndedAt=0;room.matchId=randomUUID();room.lastEvent={type:'start',at:now()};
     }
    }else if(operation==='miss'){
     if(room.status!=='playing')throw error('対戦中ではありません。',409);
     const attacker=players[index],at=now();
     if(at-number(attacker.lastActionAt)>0&&at-number(attacker.lastActionAt)<1200)throw error('少し待ってから解答してください。',429);
     attacker.hp=Math.max(0,Math.floor(number(attacker.hp))-1);attacker.lastActionAt=at;room.seq++;room.lastEvent={type:'miss',from:uid,damage:1,at};
     if(attacker.hp<=0){room.status='finished';room.winnerUid=index===0?players[1].uid:players[0].uid;room.matchEndedAt=at;}
    }else if(operation==='magic'){
     if(room.status!=='playing')throw error('対戦中ではありません。',409);
     if(room.noItems)throw error('このルームは魔法・アイテムなしです。',400);
     const spell=MAGIC_SPELLS.find(entry=>entry.id===String(body?.spellId||''));
     if(!spell)throw error('使用する魔法を選んでください。',400);
     const attacker=players[index],level=attacker.level,at=now();
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
      if(defender.hp<=0){room.status='finished';room.winnerUid=uid;room.matchEndedAt=at;}
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
     const inventory=normalizeInventory(attacker.battleInventory);
     if((inventory[item.id]||0)<1)throw error(item.name+'を持っていません。',400);
     inventory[item.id]-=1;attacker.battleInventory=inventory;attacker.spentItems={...attacker.spentItems,[item.id]:Math.max(0,Math.floor(number(attacker.spentItems?.[item.id])))+1};attacker.lastActionAt=at;room.seq++;
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
     if(defender.hp<=0){room.status='finished';room.winnerUid=uid;room.matchEndedAt=at;}
    }else if(operation==='continue'){
     if(room.status!=='finished'||players.length!==2)throw error('再戦するには相手が必要です。',409);
     players[index]={...players[index],rematchReady:true};room.players=players;
     if(players.every(p=>p.rematchReady)){
      players.forEach(p=>{p.hp=p.stats.hp;p.mp=p.stats.mp;p.ready=true;p.rematchReady=false;p.lastActionAt=0;});
      room.players=players;room.status='playing';room.winnerUid='';room.matchEndedAt=0;room.matchId=randomUUID();room.lastEvent={type:'start',at:now()};
     }
    }else throw error('操作が正しくありません。',400);
    room.seq++;room.updatedAt=now();roomWrites.push(roomWrite(id,room,stored));
   }
   if(previousStatus==='playing'&&room.status==='finished'){
    room.pendingSettlement=createPendingSettlement(room,previousPlayers,room.winnerUid);
    const winner=room.players.find(player=>player.uid===room.winnerUid);
    if(winner)winner.coinsAtJoin=Math.max(0,Math.floor(number(winner.coinsAtJoin)))+1;
    const roomWriteIndex=roomWrites.findIndex(write=>write.update?.name===baseName(battle.projectId,roomPath(id)));
    if(roomWriteIndex>=0)roomWrites[roomWriteIndex]=roomWrite(id,room,stored);
   }
   if(previousStatus==='playing'&&room.status==='finished'&&room.winnerUid&&previousPlayers.length===2){
    const gradeKey=ROOM_RULES[id].gradeKey,endedAt=room.matchEndedAt||now();
    const existing=await Promise.all(previousPlayers.map(player=>standingDoc(roomToken,gradeKey,player.uid)));
    previousPlayers.forEach((player,i)=>{
     const result=nextOnlineBattleStanding(existing[i]?.value||{},player,player.uid===room.winnerUid,endedAt);
     roomWrites.push(standingWrite(gradeKey,player.uid,result,existing[i]));
    });
   }
   if(roomWrites.length&&lobbyStateChanged(beforeLobby,lobbyState(room,id)))roomWrites.push(lobbyWrite(id,room));
   let roomCommitted=false;
   try{
    const result=await commitAt(battle.base,roomToken,roomWrites);
    roomCommitted=true;
    if(room.pendingSettlement){
     const roomIndex=roomWrites.findIndex(write=>write.update?.name===baseName(battle.projectId,roomPath(id)));
     const saved={value:room,updateTime:result.writeResults?.[roomIndex]?.updateTime||stored?.updateTime||''};
     try{await settlePending(id,roomToken,walletToken,saved);}
     catch(e){console.warn('Online battle settlement deferred for retry',String(e?.message||e));}
    }
    return {room:publicRoom(room,id,uid)};
   }catch(e){
    if(!roomCommitted&&e.retryable&&attempt<3)continue;
    throw e;
   }
  }
  throw error('対戦状態の更新が競合しました。もう一度お試しください。',409);
 }

 async function rankCandidates(token,gradeKey,todayDay){
  let limit=12;
  while(limit<=4096){
   const response=await request(battle.base+'/documents/onlineBattleStats/'+gradeKey+':runQuery',{
    method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
    signal:AbortSignal.timeout(20000),
    body:JSON.stringify({structuredQuery:{from:[{collectionId:'players'}],orderBy:[{field:{fieldPath:'wins'},direction:'DESCENDING'}],limit}})
   });
   let raw=[];try{raw=await response.json();}catch{}
   if(!response.ok||!Array.isArray(raw))throw error('ランキングの集計に失敗しました。',502);
   const records=raw.filter(row=>row.document?.fields).map(row=>decodeFields(row.document.fields));
   if(records.length<limit||onlineBattleRankingScanComplete(records,todayDay,10))return projectOnlineBattleLeaderboard(records,todayDay,10);
   limit*=2;
  }
  throw error('ランキング候補が多すぎるため、集計を安全に完了できませんでした。',503);
 }
 async function publishRankings(){
  const token=await battle.accessToken(),todayDay=japanBattleDay(now()),asOfDate=previousJapanBattleDay(now()),summary=[];
  for(const gradeKey of ONLINE_BATTLE_GRADES){
   const previous=await dailyRankingDoc(token,gradeKey);
   if(previous?.value?.asOfDate===asOfDate){
    summary.push({gradeKey,asOfDate,unchanged:true});
    continue;
   }
   const leaders=await rankCandidates(token,gradeKey,todayDay);
   const entry={schemaVersion:1,gradeKey,asOfDate,updatedAt:Math.floor(now()),leaders};
   await commitAt(battle.base,token,[{
    update:{name:baseName(battle.projectId,dailyRankingPath(gradeKey)),fields:encodeFields(entry)},
    updateMask:{fieldPaths:Object.keys(entry)},
    currentDocument:previous?.updateTime?{updateTime:previous.updateTime}:{exists:false}
   }],'対戦ランキングを保存できませんでした。');
   summary.push({gradeKey,asOfDate,entries:leaders.length});
  }
  return {asOfDate,summary};
 }
 async function handle(req,res,path){
  try{
   const user=await verifyUser(req),roomToken=await battle.accessToken();
   if(req.method==='GET'&&path==='/api/online-battle/rooms')return send(res,200,{rooms:[]});
   const rankingMatch=path.match(/^\/api\/online-battle\/rankings\/(4|3|pre2|2)$/);
   if(req.method==='GET'&&rankingMatch){
    const gradeKey=rankingMatch[1],snapshot=await dailyRankingDoc(roomToken,gradeKey);
    const data=snapshot?.value||{};
    return send(res,200,{gradeKey,grade:GRADE_BY_KEY[gradeKey].grade,asOfDate:data.asOfDate||'',leaders:Array.isArray(data.leaders)?data.leaders:[]});
   }
   const lobbyMatch=path.match(/^\/api\/online-battle\/lobby\/(4|3|pre2|2)$/);
   if(req.method==='GET'&&lobbyMatch)return send(res,200,{lobby:await lobbySummary(roomToken,lobbyMatch[1])});
   const match=path.match(/^\/api\/online-battle\/room\/((?:4|3|pre2|2)-(?:10|[1-9]))(?:\/(join|ready|attack|magic|item|miss|continue|leave))?$/);
   if(!match)throw error('対戦ルームが見つかりません。',404);
   const id=match[1],operation=match[2];
   if(req.method==='GET'&&!operation)return send(res,200,{room:await snapshot(id,roomToken,user.uid)});
   if(req.method!=='POST'||!operation)throw error('この操作は利用できません。',405);
   const walletToken=await accessToken(),body=await readJson(req,1024),result=await act(id,user.uid,roomToken,walletToken,operation,body);
   send(res,200,{ok:true,...result});
  }catch(e){send(res,e.status||500,{error:e.message||'オンライン対戦でエラーが発生しました。'});}
 }
 return {handle,publishRankings,ROOM_IDS,battleDatabaseSeparated:battle.separated,battleProjectId:battle.projectId};
}
