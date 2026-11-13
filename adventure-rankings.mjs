import {runtimePublicRankingCache} from './public-ranking-cache.mjs';

export const TOWER_SEASON='2026-11-maou';
export const DUNGEON_SEASON='2026-11-mamono-reflect';
const RANKING_SCHEMA=6;
const MODES={tower:'wordTowerBest',dungeon:'eikenDungeonBest'};
const TOP_RANK=3;
const floorOf=n=>Number.isSafeInteger(n)&&n>0&&n<=100000?n:0;
function petNameOf(value){const name=typeof value==='string'?value.normalize('NFKC').trim().replace(/\s+/g,' '):'';return name&&[...name].length<=12&&!/[\u0000-\u001f\u007f]/.test(name)?name:'名前未設定のペット';}
function rankTopThree(entries){
 const rows=[...entries].sort((a,b)=>b.floor-a.floor||Number(b.cleared===true)-Number(a.cleared===true)||a.uid.localeCompare(b.uid));let previous=null,rank=0;
 return rows.map((row,index)=>{if(row.floor!==previous){rank=index+1;previous=row.floor;}return {...row,rank};}).filter(row=>row.rank<=TOP_RANK);
}
function sanitizeLeaders(list){
 const seen=new Set(),rows=[];
 for(const item of Array.isArray(list)?list:[]){const uid=typeof item?.uid==='string'?item.uid:'',floor=floorOf(item?.floor);if(!uid||!floor||seen.has(uid))continue;seen.add(uid);const row={uid,petName:petNameOf(item.petName),floor};if(item?.cleared===true)row.cleared=true;rows.push(row);}
 return rankTopThree(rows);
}
export function adventureLeaders(players,mode){
 const field=MODES[mode];if(!field)return [];
 const seen=new Set(),rows=[];
 for(const player of players){
  if(mode==='tower'&&player?.wordTowerSeason!==TOWER_SEASON)continue;
  if(mode==='dungeon'&&player?.eikenDungeonSeason!==DUNGEON_SEASON)continue;
  const uid=typeof player?.uid==='string'?player.uid:'',floor=floorOf(player?.[field]);if(!uid||!floor||seen.has(uid))continue;seen.add(uid);const row={uid,petName:petNameOf(player.petName),floor};if(floor===100&&player?.[mode==='tower'?'wordTowerCleared':'eikenDungeonCleared']===true)row.cleared=true;rows.push(row);
 }
 return rankTopThree(rows);
}
function sanitizeStored(value){return {schemaVersion:Number(value?.schemaVersion)||0,towerSeason:typeof value?.towerSeason==='string'?value.towerSeason:'',dungeonSeason:typeof value?.dungeonSeason==='string'?value.dungeonSeason:'',tower:sanitizeLeaders(value?.tower),dungeon:sanitizeLeaders(value?.dungeon)};}
function encodeValue(value){
 if(value===null)return {nullValue:null};
 if(typeof value==='string')return {stringValue:value};
 if(typeof value==='boolean')return {booleanValue:value};
 if(Number.isSafeInteger(value))return {integerValue:String(value)};
 if(typeof value==='number'&&Number.isFinite(value))return {doubleValue:value};
 if(Array.isArray(value))return {arrayValue:{values:value.map(encodeValue)}};
 if(value&&typeof value==='object')return {mapValue:{fields:Object.fromEntries(Object.entries(value).map(([key,item])=>[key,encodeValue(item)]))}};
 return {nullValue:null};
}
const encodeFields=value=>Object.fromEntries(Object.entries(value).map(([key,item])=>[key,encodeValue(item)]));
function uidFromName(name){const match=String(name||'').match(/\/documents\/users\/([^/]+)\/apps\/english-playroom$/);return match?decodeURIComponent(match[1]):'';}
function publicRows(rows){return rows.map(row=>({...row}));}
function sameRows(a,b){return JSON.stringify(a.map(({uid,petName,floor,cleared})=>({uid,petName,floor,cleared:cleared===true})))===JSON.stringify(b.map(({uid,petName,floor,cleared})=>({uid,petName,floor,cleared:cleared===true})));}
export function createAdventureRankings({base,activeIds,excludedIds=async()=>[],accessToken,decodeFields,decorate,send,fail,fetch:request=globalThis.fetch,now=Date.now,webApiKey=process.env.FIREBASE_WEB_API_KEY||'AIzaSyAllLjPcGhygMSEIORXhKZOaDjYvpSJ4EQ',rankingStore=runtimePublicRankingCache()}){
 const docUrl=base+'/documents/leaderboards/adventure';
 async function requestUser(req){
  const auth=String(req.headers?.authorization||''),match=auth.match(/^Bearer\s+(.+)$/i);if(!match)throw fail('ログインが必要です。',401);
  const response=await request(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(webApiKey)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({idToken:match[1]})});let data={};try{data=await response.json();}catch{}
  const user=data.users?.[0];if(!response.ok||!user?.localId)throw fail('ログイン情報を確認できませんでした。',401);return {uid:user.localId};
 }
 async function requestJson(req,maxBytes=1024){if(req.body&&typeof req.body==='object')return req.body;let raw='',size=0;for await(const chunk of req){size+=chunk.length;if(size>maxBytes)throw fail('送信内容が大きすぎます。',413);raw+=chunk;}try{return JSON.parse(raw||'{}');}catch{throw fail('送信内容を読み取れません。',400);}}
 async function userDoc(token,uid){const response=await request(`${base}/documents/users/${encodeURIComponent(uid)}/apps/english-playroom`,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(15000)});if(response.status===404)return {};let data={};try{data=await response.json();}catch{}if(!response.ok)throw fail('ユーザー情報を取得できませんでした。',502);return decodeFields(data.fields||{});}
 let cached=null,inflight=null,retryAfter=0,publishChain=Promise.resolve();
 async function readSummary(token){
  const response=await request(docUrl,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(15000)});if(response.status===404)return null;let data={};try{data=await response.json();}catch{}
  if(!response.ok)throw fail('ランキングを取得できませんでした。',response.status===429?429:502);return {value:sanitizeStored(decodeFields(data.fields||{})),updateTime:data.updateTime||''};
 }
 async function writeSummary(token,value,{updateTime='',createOnly=false}={}){
  const url=new URL(docUrl);if(updateTime)url.searchParams.set('currentDocument.updateTime',updateTime);else if(createOnly)url.searchParams.set('currentDocument.exists','false');
  const response=await request(url,{method:'PATCH',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},signal:AbortSignal.timeout(15000),body:JSON.stringify({fields:encodeFields(value)})});let data={};try{data=await response.json();}catch{}
  if(!response.ok){const error=fail('ランキングを更新できませんでした。',response.status===409||response.status===412?409:502);error.retryable=response.status===409||response.status===412;throw error;}
  return {value:sanitizeStored(value),updateTime:data.updateTime||''};
 }
 async function scanPlayers(){
  const excluded=new Set(await excludedIds()),ids=[...new Set(await activeIds())].filter(uid=>!excluded.has(uid)),token=await accessToken(),players=[];
  for(let offset=0;offset<ids.length;offset+=200){
   const names=ids.slice(offset,offset+200).map(uid=>base.replace(/^https:\/\/firestore.googleapis.com\/v1\//,'')+'/documents/users/'+encodeURIComponent(uid)+'/apps/english-playroom');
   const response=await request(base+'/documents:batchGet',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},signal:AbortSignal.timeout(15000),body:JSON.stringify({documents:names,mask:{fieldPaths:['petName','wordTowerBest','wordTowerSeason','wordTowerCleared','eikenDungeonBest','eikenDungeonSeason','eikenDungeonCleared']}})});let rows=[];try{rows=await response.json();}catch{}
   if(!response.ok||!Array.isArray(rows))throw fail('ランキングを取得できませんでした。',response.status===429?429:502);
   const expected=new Set(names);for(const row of rows)if(row.found&&expected.has(row.found.name))players.push({uid:uidFromName(row.found.name),...decodeFields(row.found.fields||{})});
  }
  return {token,value:{schemaVersion:RANKING_SCHEMA,towerSeason:TOWER_SEASON,dungeonSeason:DUNGEON_SEASON,tower:adventureLeaders(players,'tower'),dungeon:adventureLeaders(players,'dungeon')}};
 }
 // Compare all listed floor-100 entries against their saved player records, once
 // when upgrading from schema v4. Query only finalists rather than all users.
 async function verifyFinalClearFlags(token,value){
  const finalists=[...new Set([...value.tower,...value.dungeon].filter(row=>row.floor===100).map(row=>row.uid))];
  if(!finalists.length)return {...value,schemaVersion:RANKING_SCHEMA};
  const profiles=new Map(),prefix=base.replace(/^https:\/\/firestore.googleapis.com\/v1\//,'');
  for(let offset=0;offset<finalists.length;offset+=200){
   const names=finalists.slice(offset,offset+200).map(uid=>prefix+'/documents/users/'+encodeURIComponent(uid)+'/apps/english-playroom');
   const response=await request(base+'/documents:batchGet',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},signal:AbortSignal.timeout(15000),body:JSON.stringify({documents:names,mask:{fieldPaths:['wordTowerBest','wordTowerSeason','wordTowerCleared','eikenDungeonBest','eikenDungeonSeason','eikenDungeonCleared']}})});
   const rows=await response.json().catch(()=>[]);
   if(!response.ok||!Array.isArray(rows))throw fail('完全制覇記録を確認できませんでした。',502);
   for(const row of rows)if(row.found)profiles.set(uidFromName(row.found.name),decodeFields(row.found.fields||{}));
  }
  if(finalists.some(uid=>!profiles.has(uid))){
   // Removed users require rebuilding the top-3, not assuming their completion.
   const rebuilt=await scanPlayers();
   return {...rebuilt.value,schemaVersion:RANKING_SCHEMA};
  }
  const verified={...value,schemaVersion:RANKING_SCHEMA};
  let mismatch=false;
  for(const mode of ['tower','dungeon']){
   verified[mode]=value[mode].map(row=>{
    if(row.floor!==100)return row;
    const saved=profiles.get(row.uid),best=floorOf(saved[MODES[mode]]);
    if(best!==100||(mode==='tower'&&saved.wordTowerSeason!==TOWER_SEASON)||(mode==='dungeon'&&saved.eikenDungeonSeason!==DUNGEON_SEASON)){mismatch=true;return row;}
    const cleared=saved[mode==='tower'?'wordTowerCleared':'eikenDungeonCleared']===true;
    const updated={...row};delete updated.cleared;if(cleared)updated.cleared=true;
    return updated;
   });
   verified[mode]=sanitizeLeaders(verified[mode]);
  }
  if(mismatch){
   const rebuilt=await scanPlayers();
   return {...rebuilt.value,schemaVersion:RANKING_SCHEMA};
  }
  console.info('Adventure finalist verification',JSON.stringify({
   checked:finalists.length,tower100:verified.tower.filter(row=>row.floor===100).length,
   towerCleared:verified.tower.filter(row=>row.floor===100&&row.cleared).length,
   dungeon100:verified.dungeon.filter(row=>row.floor===100).length,
   dungeonCleared:verified.dungeon.filter(row=>row.floor===100&&row.cleared).length
  }));
  return verified;
 }
 async function load(){
  const token=await accessToken(),stored=await readSummary(token),excluded=new Set(await excludedIds());
  if(stored){
   const staleSchema=stored.value.schemaVersion!==RANKING_SCHEMA,staleSeason=stored.value.towerSeason!==TOWER_SEASON,staleDungeon=stored.value.dungeonSeason!==DUNGEON_SEASON,hasExcluded=[...stored.value.tower,...stored.value.dungeon].some(row=>excluded.has(row.uid));
   if(!staleSchema&&!staleSeason&&!staleDungeon&&!hasExcluded)return stored;
   if(stored.value.schemaVersion===5&&!staleSeason&&staleDungeon&&!hasExcluded){
    // Roll over just this leaderboard, without scanning every player or resetting the tower.
    return writeSummary(token,{...stored.value,schemaVersion:RANKING_SCHEMA,dungeonSeason:DUNGEON_SEASON,dungeon:[]},{updateTime:stored.updateTime});
   }
   if(stored.value.schemaVersion===4&&!staleSeason&&!staleDungeon&&!hasExcluded){
    const verified=await verifyFinalClearFlags(token,stored.value);
    return writeSummary(token,verified,{updateTime:stored.updateTime});
   }
   const rebuilt=await scanPlayers();return writeSummary(token,rebuilt.value,{updateTime:stored.updateTime});
  }
  const bootstrap=await scanPlayers();try{return await writeSummary(bootstrap.token,bootstrap.value,{createOnly:true});}catch(error){if(!error.retryable)throw error;const raced=await readSummary(bootstrap.token);if(raced&&raced.value.towerSeason===TOWER_SEASON&&raced.value.dungeonSeason===DUNGEON_SEASON)return raced;throw error;}
 }
 async function decorateSummary(value){
  const tower=sanitizeLeaders(value?.tower),dungeon=sanitizeLeaders(value?.dungeon),combined=[...tower.map(row=>({...row,__mode:'tower'})),...dungeon.map(row=>({...row,__mode:'dungeon'}))];
  const decorated=decorate?await decorate(combined):combined,result={tower:[],dungeon:[]};
  for(const [index,item] of decorated.entries()){
   const currentMode=combined[index]?.__mode;if(!Object.hasOwn(result,currentMode))continue;
   const {__mode,...row}=item;result[currentMode].push({...row,uid:combined[index].uid});
  }return result;
 }
 async function snapshot(){
  if(cached&&now()-cached.fetchedAt<60000){if(!cached.public)cached.public=await decorateSummary(cached.value);return {rankingSchema:RANKING_SCHEMA,exclusionVersion:1,towerSeason:TOWER_SEASON,dungeonSeason:DUNGEON_SEASON,fetchedAt:cached.fetchedAt,...cached.public};}
  if(inflight)return inflight;if(now()<retryAfter)throw fail('少し待ってから再表示してください。',503);
  inflight=load().then(async stored=>{cached={...stored,fetchedAt:now(),public:null};cached.public=await decorateSummary(cached.value);return {rankingSchema:RANKING_SCHEMA,exclusionVersion:1,towerSeason:TOWER_SEASON,dungeonSeason:DUNGEON_SEASON,fetchedAt:cached.fetchedAt,...cached.public};}).catch(error=>{retryAfter=now()+5000;throw error;}).finally(()=>{inflight=null;});return inflight;
 }
 async function sharedSnapshot(){return rankingStore.getSection('adventure',{load:snapshot,valid:value=>value?.rankingSchema===RANKING_SCHEMA&&value?.exclusionVersion===1&&value?.towerSeason===TOWER_SEASON&&value?.dungeonSeason===DUNGEON_SEASON&&['tower','dungeon'].every(mode=>Array.isArray(value[mode])&&value[mode].every(row=>typeof row.uid==='string'&&row.uid.length>0))});}
 async function refreshSharedSnapshot(){const result=await snapshot();await rankingStore.setSection('adventure',result);return result;}
 async function publish({uid,mode,floor,petName,cleared=false}){
  if(!uid||!Object.hasOwn(MODES,mode)||(floor=floorOf(floor))===0)return null;
  if((await excludedIds()).includes(uid))return null;
  const task=async()=>{
   await snapshot();
   const token=await accessToken();let stored=cached?.value?{value:cached.value,updateTime:cached.updateTime}:await readSummary(token);if(!stored||stored.value.towerSeason!==TOWER_SEASON||stored.value.dungeonSeason!==DUNGEON_SEASON||stored.value.schemaVersion!==RANKING_SCHEMA)stored=await load();
   for(let attempt=0;attempt<3;attempt++){
    const next=sanitizeStored(stored.value);next.schemaVersion=RANKING_SCHEMA;next.towerSeason=TOWER_SEASON;next.dungeonSeason=DUNGEON_SEASON;const current=next[mode],candidateRows=current.filter(row=>row.uid!==uid).map(({rank,...row})=>row),candidate={uid,petName:petNameOf(petName),floor};if(cleared===true&&floor===100)candidate.cleared=true;candidateRows.push(candidate);const updated=rankTopThree(candidateRows);next[mode]=updated;
    if(sameRows(current,updated)){cached={...stored,value:next,fetchedAt:now(),public:null};return publicRows(updated);}
    try{const written=await writeSummary(token,next,{updateTime:stored.updateTime});cached={...written,fetchedAt:now(),public:null};return publicRows(written.value[mode]);}
    catch(error){if(!error.retryable||attempt===2)throw error;stored=await readSummary(token);if(!stored||stored.value.towerSeason!==TOWER_SEASON||stored.value.dungeonSeason!==DUNGEON_SEASON||stored.value.schemaVersion!==RANKING_SCHEMA)stored=await load();}
   }
  };
  const result=publishChain.then(task,task);publishChain=result.catch(()=>{});return result;
 }
 async function handle(req,res){try{
  if(req.method==='GET'){const mode=new URL(req.url,'http://localhost').searchParams.get('mode');if(!Object.hasOwn(MODES,mode))throw fail('冒険先を選んでください。',400);const result=await sharedSnapshot();return send(res,200,{mode,fetchedAt:result.fetchedAt,leaders:result[mode]});}
  if(req.method==='POST'){
   if(!req.headers?.['content-type']?.startsWith('application/json'))throw fail('JSONで送信してください。',415);const user=await requestUser(req),body=await requestJson(req,1024),mode=String(body.mode||'');if(!Object.hasOwn(MODES,mode))throw fail('冒険先を選んでください。',400);
   if((await excludedIds()).includes(user.uid)){await refreshSharedSnapshot();return send(res,200,{ok:true,excluded:true,record:null});}
   const expectedFloor=floorOf(Number(body.expectedFloor)),token=await accessToken(),data=await userDoc(token,user.uid),rawSavedFloor=floorOf(data[MODES[mode]]),savedFloor=((mode==='tower'&&data.wordTowerSeason!==TOWER_SEASON)||(mode==='dungeon'&&data.eikenDungeonSeason!==DUNGEON_SEASON))?0:rawSavedFloor;if(expectedFloor&&savedFloor<expectedFloor)return send(res,202,{ok:false,pending:true});
   const record=await publish({uid:user.uid,mode,floor:savedFloor,petName:data.petName,cleared:data[mode==='tower'?'wordTowerCleared':'eikenDungeonCleared']===true});await refreshSharedSnapshot();return send(res,200,{ok:true,record});
  }
  throw fail('GETまたはPOSTのみ対応しています。',405);
 }catch(error){send(res,error.status||503,{error:error.status&&error.status<500?error.message:'ランキングを処理できませんでした。時間を置いて再表示してください。'});}}
 return {handle,snapshot,publish};
}

