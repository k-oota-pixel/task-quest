import {randomUUID} from 'node:crypto';
import {creativeTitleCount,titleCountTransforms} from './title-count-summary.mjs';
import {titleIdsTransform} from './title-collection.mjs';
import {fixtureTitleAuthority} from './title-authority.mjs';
import {ONLINE_BATTLE_GRADES,nextOnlineBattleStanding,previousJapanBattleDay,japanBattleDay,projectOnlineBattleLeaderboard} from './online-battle-standings.mjs';
import {ONLINE_TITLE_APP,onlineBattleTitleProgress,nextOnlineBattleTitleStats,creativeTitles} from './title-model.mjs';
import {accuracyBonusDamage} from './online-question-accuracy.mjs';

const GRADE_CONFIG=Object.freeze([{key:'4',grade:'4級'},{key:'3',grade:'3級'},{key:'pre2',grade:'準2級'},{key:'2',grade:'2級'}]);
const GRADE_BY_KEY=Object.freeze(Object.fromEntries(GRADE_CONFIG.map(entry=>[entry.key,entry])));
const ROOM_IDS=Object.freeze(GRADE_CONFIG.flatMap(entry=>Array.from({length:entry.key==='4'?20:10},(_,index)=>`${entry.key}-${index+1}`)));
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
const MATCH_OPERATIONS=new Set(['attack','miss','magic','item','continue']);
const ONLINE_QUESTION_SEGMENTS=Object.freeze({'4':'g4','3':'g3','pre2':'pre2','2':'g2'});
export function validOnlineBattleQuestionId(value,gradeKey){
 if(typeof value!=='string'||!ONLINE_QUESTION_SEGMENTS[gradeKey])return false;
 const parts=/^20\d{2}-[1-3]-(g4|g3|pre2|g2)-q\d{2}$/.exec(value);
 return !!parts&&parts[1]===ONLINE_QUESTION_SEGMENTS[gradeKey];
}
function recordOnlineBattleFirstAnswer(player,questionId,gradeKey,correct){
 if(!validOnlineBattleQuestionId(questionId,gradeKey))return;
 player.battleQuestionFirst||={};
 if(!Object.hasOwn(player.battleQuestionFirst,questionId))player.battleQuestionFirst[questionId]=correct?1:0;
}
export const onlineBattleMissDamage=maxHp=>Math.max(1,Math.ceil(Math.max(1,Number(maxHp)||1)/4));
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
 return {uid,nickname,petName,petAppearance:data.petAppearance||null,petShop:data.petShop||{},petHatched:data.petHatched===true,petAdult:data.petAdult!==false,stats,level:petLevel(data),hp:0,mp:stats.mp,ready:false,rematchReady:false,lastActionAt:0,joinedAt:0,coinsAtJoin:Math.max(0,Math.floor(number(data.coins))),battleInventory:normalizeInventory(data.petDungeonItems),spentItems:{}};
}
function emptyRoom(id){const rules=ROOM_RULES[id]||{gradeKey:'4',grade:'4級',roomNo:1,noItems:false};return {roomId:id,roomNo:rules.roomNo,gradeKey:rules.gradeKey,grade:rules.grade,noItems:false,status:'open',players:[],seq:0,winnerUid:'',lastEvent:null,matchId:'',pendingSettlement:null,titleAwards:{},matchEndedAt:0,updatedAt:Date.now()};}
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
 const played=Boolean(winnerUid&&players?.length===2&&players.some(p=>p.uid===winnerUid));
 const entries=(players||[]).map(player=>({
  uid:String(player.uid||''),
  coins:player.uid===winnerUid?1:0,
  played,
  gradeKey:room.gradeKey,
  won:played&&player.uid===winnerUid,
  items:Object.fromEntries(DUNGEON_ITEMS.map(item=>[item.id,Math.max(0,Math.floor(number(player.spentItems?.[item.id])))]).filter(([,count])=>count>0)),
  ...(player.battleQuestionFirst?{firstAnswers:player.battleQuestionFirst}:{})
 })).filter(row=>row.uid&&(row.played||row.coins>0||Object.keys(row.items).length>0));
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
   room.players=activePlayers.map(player=>({...player,ready:false,rematchReady:false,lastActionAt:0,spentItems:{}}));
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
 const {pendingSettlement,titleAwards,...room}=safeRoom(value,id);
 const settlementPending=room.status==='finished'&&Boolean(pendingSettlement);
 return {...room,settlementPending,freshTitles:room.status==='finished'?(Array.isArray(titleAwards?.[viewerUid])?titleAwards[viewerUid]:[]):[],players:room.players.map(player=>{
  const {battleInventory,spentItems,coinsAtJoin,battleQuestionFirst,...safe}=player;
  const coins=settlementPending&&player.uid===room.winnerUid?Math.max(0,coinsAtJoin-1):coinsAtJoin;
  return {...safe,petShop:player.petShop||{},...(player.uid===viewerUid?{inventory:battleInventory,coins}:{})};
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

export function createOnlineBattle({base,projectId,accessToken,verifyUser,readJson,send,fail:failExternal,decodeFields,fetch:request=globalThis.fetch,now=Date.now,roomStore,getAuthority=fixtureTitleAuthority,questionMode=false,getQuestionAccuracy=null}){
 const error=failExternal||fail;
 if(!roomStore)throw new Error('Online battle requires Realtime Database storage');
 const preview=roomStore.mode==='preview';
 const roomsFor=grade=>questionMode&&grade==='4'?20:10;
 const isAllowedRoom=id=>{const match=String(id).match(/^(4|3|pre2|2)-(\d{1,2})$/);return !!match&&Number(match[2])>=1&&Number(match[2])<=roomsFor(match[1]);};
 const standingDaysField=questionMode?'onlineBattleQuestionStandingDays':'onlineBattleStandingDays';
 const realtimeSettlements=new Map();
 const walletPath=uid=>(preview?'onlineBattlePreviewUsers/':'users/')+encodeURIComponent(uid)+'/apps/english-playroom';
 async function getDoc(token,path,message){
  const response=await request(base+'/documents/'+path,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(12000)});
  if(response.status===404)return null;
  let data={};try{data=await response.json();}catch{}
  if(!response.ok)throw error(message,502);
  return {fields:data.fields||{},updateTime:data.updateTime||'',value:decodeFields(data.fields||{})};
 }
 async function userWallet(token,uid){return getDoc(token,walletPath(uid),'ユーザー情報を読み込めませんでした。');}
 async function commitSettlement(token,writes){
  if(!writes.length)return {};
  const response=await request(base+'/documents:commit',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},signal:AbortSignal.timeout(12000),body:JSON.stringify({writes})});
  let data={};try{data=await response.json();}catch{}
  if(!response.ok){const e=error('対戦報酬・称号・アイテムの精算を保存できませんでした。',response.status===409||response.status===412?409:502);e.retryable=response.status===409||response.status===412||data.error?.status==='ABORTED';throw e;}
  return data;
 }
 function ledgerPath(id){
  return (preview?'onlineBattlePreviewSettlements/':'onlineBattleSettlements/')+encodeURIComponent(id);
 }
 // Store the ranking projection in the existing settlement receipt so a retry
 // after a successful Firestore commit can resume without applying rewards twice.
 async function settlementWrites(settlement,wallets){
  const awards={},writes=[],titleStats=new Map(),titleDeltas=new Map(),standings=[],standingDays=new Map(),standingTotals=new Map();
  for(const entry of settlement.entries){
   if(!entry.played)continue;
   if(!ONLINE_BATTLE_GRADES.includes(entry.gradeKey))throw error('対戦の級が正しくありません。',400);
   const wallet=wallets.get(entry.uid);
   if(!wallet?.updateTime)throw error('称号の保存先が見つかりません。',503);
   const oldStats=field(wallet.value?.onlineBattleTitleStats);
   const newStats=nextOnlineBattleTitleStats(oldStats,entry.gradeKey,Boolean(entry.won));
   const beforeTitles=creativeTitles(ONLINE_TITLE_APP,onlineBattleTitleProgress({onlineBattleTitleStats:oldStats}));
   const afterTitles=creativeTitles(ONLINE_TITLE_APP,onlineBattleTitleProgress({onlineBattleTitleStats:newStats}));
   const oldIds=new Set(beforeTitles.filter(t=>t.unlocked).map(t=>t.id));
   titleDeltas.set(entry.uid,creativeTitleCount(ONLINE_TITLE_APP,afterTitles)-creativeTitleCount(ONLINE_TITLE_APP,beforeTitles));
   awards[entry.uid]=afterTitles
    .filter(t=>t.unlocked&&!oldIds.has(t.id))
    .map(t=>({id:t.id,label:t.label,name:t.name,condition:t.condition}));
   titleStats.set(entry.uid,newStats);
   const days=field(wallet.value?.[standingDaysField]);
   const totals=field(wallet.value?.onlineBattleQuestionStandingTotals);
   const prior=questionMode?field(totals[entry.gradeKey]):field(oldStats.byGrade?.[entry.gradeKey]);
   const player=settlement.rankingPlayers?.find(player=>player.uid===entry.uid)||profile(wallet.value,entry.uid);
   const standing=nextOnlineBattleStanding({...prior,...field(days[entry.gradeKey])},player,Boolean(entry.won),settlement.endedAt||settlement.createdAt);
   const {lastGameDay,todayGames,todayWins}=standing;
   standingDays.set(entry.uid,{...days,[entry.gradeKey]:{lastGameDay,todayGames,todayWins}});
   if(questionMode)standingTotals.set(entry.uid,{...totals,[entry.gradeKey]:{games:standing.games,wins:standing.wins}});
   standings.push({gradeKey:entry.gradeKey,standing,...(questionMode?{firstAnswers:field(entry.firstAnswers)}:{})});
  }
  writes.push({update:{name:baseName(projectId,ledgerPath(settlement.id)),fields:encodeFields({
   id:settlement.id,roomId:settlement.roomId,createdAt:settlement.createdAt,titleAwards:awards,standings
  })},currentDocument:{exists:false}});
  for(const entry of settlement.entries){
   const transforms=[];
   if(entry.coins)transforms.push({fieldPath:'coins',increment:encode(entry.coins)});
   for(const [itemId,count] of Object.entries(entry.items||{})){
    if(!DUNGEON_ITEMS.some(item=>item.id===itemId)||!Number.isSafeInteger(count)||count<=0)continue;
    const fieldPath='petDungeonItems.'+String.fromCharCode(96)+itemId+String.fromCharCode(96);
    transforms.push({fieldPath,increment:encode(-count)});
   }
   if(entry.played){
    transforms.push(...titleCountTransforms(titleDeltas.get(entry.uid)));
    if(awards[entry.uid]?.length)transforms.push(titleIdsTransform(awards[entry.uid].map(title=>title.id),await getAuthority(),entry.uid));
    const wallet=wallets.get(entry.uid);
    writes.push({
     update:{name:baseName(projectId,walletPath(entry.uid)),fields:{onlineBattleTitleStats:encode(titleStats.get(entry.uid)),[standingDaysField]:encode(standingDays.get(entry.uid)),...(questionMode?{onlineBattleQuestionStandingTotals:encode(standingTotals.get(entry.uid))}:{})}},
     updateMask:{fieldPaths:['onlineBattleTitleStats',standingDaysField,...(questionMode?['onlineBattleQuestionStandingTotals']:[])]},
     ...(transforms.length?{updateTransforms:transforms}:{}),
     currentDocument:{updateTime:wallet.updateTime}
    });
   }else if(transforms.length){
    writes.push({transform:{document:baseName(projectId,walletPath(entry.uid)),fieldTransforms:transforms},currentDocument:{exists:true}});
   }
  }
  return {writes,awards,standings};
 }
 async function applySettlement(walletToken,settlement){
  for(let attempt=0;attempt<4;attempt++){
   const players=settlement.entries.filter(entry=>entry.played);
   const snapshots=await Promise.all(players.map(entry=>userWallet(walletToken,entry.uid)));
   const wallets=new Map(players.map((entry,i)=>[entry.uid,snapshots[i]]));
   const {writes,awards,standings}=await settlementWrites(settlement,wallets);
   try{
    await commitSettlement(walletToken,writes);
    return {awards,standings};
   }catch(e){
    const saved=await getDoc(walletToken,ledgerPath(settlement.id),'精算記録を確認できませんでした。');
    if(saved?.value?.id===settlement.id){
     return {awards:field(saved.value.titleAwards),standings:saved.value.standings||[]};
    }
    if(e.retryable&&attempt<3)continue;
    throw e;
   }
  }
  throw error('対戦報酬の保存が競合しました。',503);
 }
 function resolveRealtimeSettlement(id,pending){
  const existing=realtimeSettlements.get(id);
  const entry=existing?.matchId===pending.id?existing:{matchId:pending.id,settlement:null,result:null};
  if(entry.result)return entry.result;
  realtimeSettlements.set(id,entry);
  entry.result=(async()=>{
   entry.settlement??=await applySettlement(await accessToken(),pending);
   const {awards,standings}=entry.settlement;
   await Promise.all(standings.map(({gradeKey,standing,firstAnswers})=>roomStore.saveStanding(gradeKey,standing,firstAnswers)));
   return awards;
  })().catch(error=>{
   entry.result=null;
   throw error;
  });
  return entry.result;
 }
 async function settlePending(id,stored){
  const pending=stored.value.pendingSettlement;
  const awards=await resolveRealtimeSettlement(id,pending);
  const room=safeRoom(stored.value,id);
  room.pendingSettlement=null;
  room.titleAwards=awards;
  room.lastSettledMatchId=pending.id;
  try{await roomStore.write(id,room,stored.updateTime);}
  catch(e){if(!e.retryable)throw e;}
 }
 async function snapshot(id,viewerUid){
  for(let attempt=0;attempt<6;attempt++){
   const doc=await roomStore.read(id);
   if(doc?.value?.pendingSettlement){await settlePending(id,doc);continue;}
   const cleaned=cleanupOnlineBattleRoom(doc?.value||emptyRoom(id),id,now());
   if(!cleaned.changed)return publicRoom(cleaned.room,id,viewerUid);
   try{await roomStore.write(id,cleaned.room,doc.updateTime);continue;}
   catch(e){if(e.retryable&&attempt<2)continue;throw e;}
  }
  throw error('対戦ルームを更新できませんでした。',409);
 }
 async function lobbySummary(gradeKey){
  const config=GRADE_BY_KEY[gradeKey];if(!config)throw error('級が見つかりません。',404);
  const value=await roomStore.lobby(gradeKey,lobbyState);
  const current=now();
  const rooms=Array.from({length:roomsFor(gradeKey)},(_,index)=>projectOnlineBattleLobbyRoom(value['room'+(index+1)],`${gradeKey}-${index+1}`,current));
  return {gradeKey,grade:config.grade,rooms,updatedAt:Math.max(0,Math.floor(number(value.updatedAt,0)))};
 }
 async function act(id,uid,operation,body){
  // The published snapshot is a cached static JSON file: NO Firebase read for
  // individual answers, regardless of how many times the player attacks.
  let questionAccuracy=null;
  if(questionMode&&operation==='attack'&&typeof getQuestionAccuracy==='function'){
   try{questionAccuracy=await getQuestionAccuracy();}
   catch(e){console.warn('Daily question accuracy unavailable; no bonus',String(e?.message||e));}
  }
  let joiningWallet;
  for(let attempt=0;attempt<6;attempt++){
   const stored=await roomStore.read(id);
   if(stored?.value?.pendingSettlement){await settlePending(id,stored);continue;}
   const cleaned=cleanupOnlineBattleRoom(stored?.value||emptyRoom(id),id,now());
   if(cleaned.changed){
    try{await roomStore.write(id,cleaned.room,stored.updateTime);continue;}
    catch(e){if(e.retryable&&attempt<3)continue;throw e;}
   }
   const room=cleaned.room,previousStatus=room.status,players=room.players.slice(),previousPlayers=room.players.slice(),index=players.findIndex(p=>p.uid===uid);
   if(index>=0&&MATCH_OPERATIONS.has(operation)&&(!room.matchId||body?.matchId!==room.matchId)){
    throw error('対戦が切り替わりました。最新の状態を確認してください。',409);
   }
   if(operation==='join'){
    if(index>=0)return {room:publicRoom(room,id,uid)};
    if(room.status==='playing'||room.status==='finished'||players.length>=2)throw error('このルームは満室です。',409);
    joiningWallet??=userWallet(await accessToken(),uid);
    const wallet=await joiningWallet,data=wallet?.value||{};
    if(preview&&!wallet)throw error('検証用の対戦プロフィールが用意されていません。',403);
    const player=profile(data,uid),at=now();player.hp=player.stats.hp;player.mp=player.stats.mp;player.joinedAt=at;players.push(player);
    room.players=players;room.status='waiting';room.matchEndedAt=0;room.updatedAt=at;room.seq++;
   }else if(operation==='leave'){
    if(index<0)return {room:publicRoom(room,id,uid)};
    if(room.status==='playing'){
     const opponent=players.find(p=>p.uid!==uid),at=now();
     if(opponent){
      room.players=[{...opponent,ready:false,rematchReady:false}];room.status='finished';room.winnerUid=opponent.uid;room.lastEvent={type:'forfeit',from:uid,to:opponent.uid,at};room.matchEndedAt=at;room.seq++;room.updatedAt=at;

     }else{
      room.players=[];room.status='open';room.winnerUid='';room.lastEvent=null;room.matchEndedAt=0;room.seq++;room.updatedAt=at;
     }
    }else{
     room.players=players.filter(p=>p.uid!==uid).map(p=>({...p,ready:false,rematchReady:false}));
     room.status=room.players.length?'waiting':'open';room.winnerUid='';room.lastEvent=null;room.matchEndedAt=0;room.seq++;room.updatedAt=now();
    }
   }else{
    if(index<0)throw error('先にルームへ入室してください。',403);
    if(operation==='ready'){
     if(room.status!=='waiting'||players.length!==2)throw error('相手が入室するまでお待ちください。',409);
     players[index]={...players[index],ready:true};room.players=players;
     if(players.every(p=>p.ready)){
      players.forEach(p=>{p.hp=p.stats.hp;p.mp=p.stats.mp;p.lastActionAt=0;p.rematchReady=false;if(questionMode)p.battleQuestionFirst={};});
      room.players=players;room.status='playing';room.winnerUid='';room.matchEndedAt=0;room.matchId=randomUUID();room.titleAwards={};room.lastEvent={type:'start',at:now()};
     }
    }else if(operation==='miss'){
     if(room.status!=='playing')throw error('対戦中ではありません。',409);
     const attacker=players[index],at=now();
     if(attacker.lastActionAt>0&&at-number(attacker.lastActionAt)<1200)throw error('少し待ってから解答してください。',429);
     if(questionMode)recordOnlineBattleFirstAnswer(attacker,body?.questionId,room.gradeKey,false);
     const damage=onlineBattleMissDamage(attacker.stats.hp);
      attacker.hp=Math.max(0,Math.floor(number(attacker.hp))-damage);attacker.lastActionAt=at;room.seq++;room.lastEvent={type:'miss',from:uid,damage,at};
     if(attacker.hp<=0){room.status='finished';room.winnerUid=index===0?players[1].uid:players[0].uid;room.matchEndedAt=at;}
    }else if(operation==='magic'){
     if(room.status!=='playing')throw error('対戦中ではありません。',409);
     if(room.noItems)throw error('このルームは魔法・アイテムなしです。',400);
     const spell=MAGIC_SPELLS.find(entry=>entry.id===String(body?.spellId||''));
     if(!spell)throw error('使用する魔法を選んでください。',400);
     const attacker=players[index],level=attacker.level,at=now();
     if(level<spell.level)throw error('この魔法はまだ習得していません。',400);
     if(attacker.lastActionAt>0&&at-number(attacker.lastActionAt)<1200)throw error('少し待ってから魔法を使ってください。',429);
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
     if(attacker.lastActionAt>0&&at-number(attacker.lastActionAt)<1200)throw error('少し待ってからアイテムを使ってください。',429);
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
     if(attacker.lastActionAt>0&&at-number(attacker.lastActionAt)<1200)throw error('少し待ってから攻撃してください。',429);
     if(questionMode)recordOnlineBattleFirstAnswer(attacker,body?.questionId,room.gradeKey,true);
     const baseDamage=Math.max(1,Math.floor(number(attacker.stats?.attack,1)+2-number(defender.stats?.defense,1)));
     let damage=baseDamage,bonusPercent=0,questionRate;
     if(questionMode&&validOnlineBattleQuestionId(body?.questionId,room.gradeKey)){
      const rates=questionAccuracy?.grades?.[room.gradeKey]||null;
      // A made-up question ID cannot claim the "no data" +35% tier.
      if(rates&&Object.hasOwn(rates,body.questionId)){
       questionRate=rates[body.questionId];
       ({damage,bonusPercent}=accuracyBonusDamage(baseDamage,questionRate));
      }
     }
     defender.hp=Math.max(0,Math.floor(number(defender.hp))-damage);attacker.lastActionAt=at;room.seq++;
     room.lastEvent={type:'attack',from:uid,to:defender.uid,damage,at,...(questionMode?{baseDamage,bonusPercent,...(questionRate!==undefined?{questionRate}:{})}:{})};
     if(defender.hp<=0){room.status='finished';room.winnerUid=uid;room.matchEndedAt=at;}
    }else if(operation==='continue'){
     if(room.status!=='finished'||players.length!==2)throw error('再戦するには相手が必要です。',409);
     players[index]={...players[index],rematchReady:true};room.players=players;
     if(players.every(p=>p.rematchReady)){
      players.forEach(p=>{p.hp=p.stats.hp;p.mp=p.stats.mp;p.ready=true;p.rematchReady=false;p.lastActionAt=0;if(questionMode)p.battleQuestionFirst={};});
      room.players=players;room.status='playing';room.winnerUid='';room.matchEndedAt=0;room.matchId=randomUUID();room.titleAwards={};room.lastEvent={type:'start',at:now()};
     }
    }else throw error('操作が正しくありません。',400);
    room.seq++;room.updatedAt=now();
   }
   if(previousStatus==='playing'&&room.status==='finished'){
    room.pendingSettlement=createPendingSettlement(room,previousPlayers,room.winnerUid);
    // Freeze spent items into this match's ledger; do not charge them again on rematch.
    room.players=room.players.map(player=>({...player,spentItems:{}}));
    const winner=room.players.find(player=>player.uid===room.winnerUid);
    if(winner)winner.coinsAtJoin=Math.max(0,Math.floor(number(winner.coinsAtJoin)))+1;
    if(room.pendingSettlement&&previousPlayers.length===2){
     room.pendingSettlement.rankingPlayers=previousPlayers.map(({uid,nickname,petName})=>({uid,nickname,petName}));
     room.pendingSettlement.endedAt=room.matchEndedAt||now();
    }
   }
   try{await roomStore.write(id,room,stored.updateTime);}
   catch(e){if(e.retryable&&attempt<3)continue;throw e;}
   if(room.pendingSettlement){
    try{return {room:await snapshot(id,uid)};}
    catch(e){console.warn('Online battle settlement deferred for retry',String(e?.message||e));}
   }
   return {room:publicRoom(room,id,uid)};
  }
  throw error('対戦状態の更新が競合しました。もう一度お試しください。',409);
 }

 // This admin report reads the existing per-grade RTDB standings once on demand.
 // First answers live inside the already-written standings, so battles need no
 // additional Realtime Database or Firestore reads/writes for accuracy.
 async function questionStats(gradeKey,limit=20){
  if(!questionMode||!GRADE_BY_KEY[gradeKey])throw error('対象の級が見つかりません。',400);
  const rows=new Map(),records=await roomStore.listStandings(gradeKey);
  for(const record of records){
   for(const [id,result] of Object.entries(field(record.questionFirst))){
    if(!validOnlineBattleQuestionId(id,gradeKey)||(result!==0&&result!==1))continue;
    const entry=rows.get(id)||{id,attempts:0,correct:0};
    entry.attempts++;
    if(result===1)entry.correct++;
    rows.set(id,entry);
   }
  }
  const all=[...rows.values()].map(entry=>({...entry,accuracy:Math.round(entry.correct/entry.attempts*1000)/10}))
   .sort((a,b)=>a.accuracy-b.accuracy||b.attempts-a.attempts||a.id.localeCompare(b.id,'ja'));
  return {grade:GRADE_BY_KEY[gradeKey].grade,limit,total:all.length,rows:all.slice(0,limit),source:'online-battle-questions'};
 }
 async function publishRankings(){
  const at=now(),todayDay=japanBattleDay(at),asOfDate=previousJapanBattleDay(at);
  const summary=await Promise.all(ONLINE_BATTLE_GRADES.map(async gradeKey=>{
   const previous=await roomStore.readRanking(gradeKey);
   if(previous.value?.asOfDate>=asOfDate)return {gradeKey,asOfDate,unchanged:true};
   const records=await roomStore.listStandings(gradeKey);
   const leaders=projectOnlineBattleLeaderboard(records,todayDay,10);
   const entry={schemaVersion:1,gradeKey,asOfDate,updatedAt:at,leaders};
   const published=await roomStore.writeRanking(gradeKey,entry,previous.updateTime);
   return published?{gradeKey,asOfDate,entries:leaders.length}:{gradeKey,asOfDate,unchanged:true};
  }));
  return {asOfDate,summary};
 }
 async function handle(req,res,path){
  try{
   const user=await verifyUser(req);
   if(req.method==='GET'&&path==='/api/online-battle/rooms')return send(res,200,{rooms:[]});
   const rankingMatch=path.match(/^\/api\/online-battle\/rankings\/(4|3|pre2|2)$/);
   if(req.method==='GET'&&rankingMatch){
    const gradeKey=rankingMatch[1],snapshot=await roomStore.readRanking(gradeKey);
    const data=snapshot?.value||{};
    return send(res,200,{gradeKey,grade:GRADE_BY_KEY[gradeKey].grade,asOfDate:data.asOfDate||'',leaders:Array.isArray(data.leaders)?data.leaders:[]});
   }
   const lobbyLive=path.match(/^\/api\/online-battle\/lobby\/(4|3|pre2|2)\/live$/);
   if(req.method==='GET'&&lobbyLive){
    const gradeKey=lobbyLive[1],config=GRADE_BY_KEY[gradeKey];
    return await roomStore.streamLobby(gradeKey,res,raw=>{
     const current=now();
     const rooms=Array.from({length:roomsFor(gradeKey)},(_,index)=>{
      const id=gradeKey+'-'+(index+1),value=raw[id];
      let state=null;
      try{state=typeof value==='string'?lobbyState(JSON.parse(value),id):null;}catch{}
      return projectOnlineBattleLobbyRoom(state,id,current);
     });
     return {lobby:{gradeKey,grade:config.grade,rooms,updatedAt:current}};
    });
   }
   const lobbyMatch=path.match(/^\/api\/online-battle\/lobby\/(4|3|pre2|2)$/);
   if(req.method==='GET'&&lobbyMatch)return send(res,200,{lobby:await lobbySummary(lobbyMatch[1])});
   const match=path.match(/^\/api\/online-battle\/room\/((?:4|3|pre2|2)-(?:20|1[0-9]|[1-9]))(?:\/(join|ready|attack|magic|item|miss|continue|leave))?$/);
   const live=path.match(/^\/api\/online-battle\/room\/((?:4|3|pre2|2)-(?:20|1[0-9]|[1-9]))\/live$/);
   if((match&&!isAllowedRoom(match[1]))||(live&&!isAllowedRoom(live[1])))throw error('対戦ルームが見つかりません。',404);
   if(req.method==='GET'&&live){
    const id=live[1];
    const initial=await snapshot(id,user.uid);
    if(!initial.players.some(player=>player.uid===user.uid))throw error('先にルームへ入室してください。',403);
    return await roomStore.stream(id,res,async value=>{
     const room=publicRoom(value||emptyRoom(id),id,user.uid);
     if(!room.players.some(player=>player.uid===user.uid))return {roomId:id,seq:room.seq,players:[]};
     return room;
    });
   }
   if(!match)throw error('対戦ルームが見つかりません。',404);
   const id=match[1],operation=match[2];
   if(req.method==='GET'&&!operation)return send(res,200,{room:await snapshot(id,user.uid)});
   if(req.method!=='POST'||!operation)throw error('この操作は利用できません。',405);
   const body=await readJson(req,1024),result=await act(id,user.uid,operation,body);
   send(res,200,{ok:true,...result});
   }catch(e){
    if(res.headersSent){res.end();return;}
    send(res,e.status||500,{error:e.message||'オンライン対戦でエラーが発生しました。'});
   }
 }
 return {handle,publishRankings,questionStats};
}
