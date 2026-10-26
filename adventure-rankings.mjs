import {publicRankingCache} from './public-ranking-cache.mjs';

const MODES={tower:'wordTowerBest',dungeon:'eikenDungeonBest'};
const TOP_RANK=3;
const floorOf=n=>Number.isSafeInteger(n)&&n>0&&n<=100000?n:0;
function petNameOf(value){const name=typeof value==='string'?value.normalize('NFKC').trim().replace(/\s+/g,' '):'';return name&&[...name].length<=12&&!/[\u0000-\u001f\u007f]/.test(name)?name:'名前未設定のペット';}
function rankTopThree(entries){
 const rows=[...entries].sort((a,b)=>b.floor-a.floor||a.uid.localeCompare(b.uid));let previous=null,rank=0;
 return rows.map((row,index)=>{if(row.floor!==previous){rank=index+1;previous=row.floor;}return {...row,rank};}).filter(row=>row.rank<=TOP_RANK);
}
function sanitizeLeaders(list){
 const seen=new Set(),rows=[];
 for(const item of Array.isArray(list)?list:[]){const uid=typeof item?.uid==='string'?item.uid:'',floor=floorOf(item?.floor);if(!uid||!floor||seen.has(uid))continue;seen.add(uid);rows.push({uid,petName:petNameOf(item.petName),floor});}
 return rankTopThree(rows);
}
export function adventureLeaders(players,mode){
 const field=MODES[mode];if(!field)return [];
 const seen=new Set(),rows=[];
 for(const player of players){const uid=typeof player?.uid==='string'?player.uid:'',floor=floorOf(player?.[field]);if(!uid||!floor||seen.has(uid))continue;seen.add(uid);rows.push({uid,petName:petNameOf(player.petName),floor});}
 return rankTopThree(rows);
}
function sanitizeStored(value){return {schemaVersion:1,tower:sanitizeLeaders(value?.tower),dungeon:sanitizeLeaders(value?.dungeon)};}
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
function publicRows(rows){return rows.map(({uid,...row})=>row);}
function sameRows(a,b){return JSON.stringify(a.map(({uid,petName,floor})=>({uid,petName,floor})))===JSON.stringify(b.map(({uid,petName,floor})=>({uid,petName,floor})));}
export function createAdventureRankings({base,activeIds,accessToken,decodeFields,decorate,send,fail,fetch:request=globalThis.fetch,now=Date.now,webApiKey=process.env.FIREBASE_WEB_API_KEY||'AIzaSyAllLjPcGhygMSEIORXhKZOaDjYvpSJ4EQ'}){
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
  const ids=[...new Set(await activeIds())],token=await accessToken(),players=[];
  for(let offset=0;offset<ids.length;offset+=200){
   const names=ids.slice(offset,offset+200).map(uid=>base.replace(/^https:\/\/firestore.googleapis.com\/v1\//,'')+'/documents/users/'+encodeURIComponent(uid)+'/apps/english-playroom');
   const response=await request(base+'/documents:batchGet',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},signal:AbortSignal.timeout(15000),body:JSON.stringify({documents:names,mask:{fieldPaths:['petName','wordTowerBest','eikenDungeonBest']}})});let rows=[];try{rows=await response.json();}catch{}
   if(!response.ok||!Array.isArray(rows))throw fail('ランキングを取得できませんでした。',response.status===429?429:502);
   const expected=new Set(names);for(const row of rows)if(row.found&&expected.has(row.found.name))players.push({uid:uidFromName(row.found.name),...decodeFields(row.found.fields||{})});
  }
  return {token,value:{schemaVersion:1,tower:adventureLeaders(players,'tower'),dungeon:adventureLeaders(players,'dungeon')}};
 }
 async function load(){
  const token=await accessToken(),stored=await readSummary(token);if(stored)return stored;
  const bootstrap=await scanPlayers();try{return await writeSummary(bootstrap.token,bootstrap.value,{createOnly:true});}catch(error){if(!error.retryable)throw error;const raced=await readSummary(bootstrap.token);if(raced)return raced;throw error;}
 }
 async function decorateSummary(value){
  const tower=sanitizeLeaders(value?.tower),dungeon=sanitizeLeaders(value?.dungeon),combined=[...tower.map(row=>({...row,__mode:'tower'})),...dungeon.map(row=>({...row,__mode:'dungeon'}))];
  const decorated=decorate?await decorate(combined):combined.map(({uid,...row})=>row),result={tower:[],dungeon:[]};
  for(const item of decorated){const currentMode=item.__mode;if(!Object.hasOwn(result,currentMode))continue;const {__mode,...row}=item;result[currentMode].push(row);}return result;
 }
 async function snapshot(){
  if(cached&&now()-cached.fetchedAt<60000){if(!cached.public)cached.public=await decorateSummary(cached.value);return {fetchedAt:cached.fetchedAt,...cached.public};}
  if(inflight)return inflight;if(now()<retryAfter)throw fail('少し待ってから再表示してください。',503);
  inflight=load().then(async stored=>{cached={...stored,fetchedAt:now(),public:null};cached.public=await decorateSummary(cached.value);return {fetchedAt:cached.fetchedAt,...cached.public};}).catch(error=>{retryAfter=now()+5000;throw error;}).finally(()=>{inflight=null;});return inflight;
 }
 async function sharedSnapshot(){return publicRankingCache.getSection('adventure',{load:snapshot});}
 async function refreshSharedSnapshot(){const result=await snapshot();await publicRankingCache.setSection('adventure',result);return result;}
 async function publish({uid,mode,floor,petName}){
  if(!uid||!Object.hasOwn(MODES,mode)||(floor=floorOf(floor))===0)return null;
  const task=async()=>{
   const token=await accessToken();let stored=cached?.value?{value:cached.value,updateTime:cached.updateTime}:await readSummary(token);if(!stored)stored=await load();
   for(let attempt=0;attempt<3;attempt++){
    const next=sanitizeStored(stored.value),current=next[mode],candidateRows=current.filter(row=>row.uid!==uid).map(({rank,...row})=>row);candidateRows.push({uid,petName:petNameOf(petName),floor});const updated=rankTopThree(candidateRows);next[mode]=updated;
    if(sameRows(current,updated)){cached={...stored,fetchedAt:now(),public:null};return publicRows(updated);}
    try{const written=await writeSummary(token,next,{updateTime:stored.updateTime});cached={...written,fetchedAt:now(),public:null};return publicRows(written.value[mode]);}
    catch(error){if(!error.retryable||attempt===2)throw error;stored=await readSummary(token);if(!stored)stored=await load();}
   }
  };
  const result=publishChain.then(task,task);publishChain=result.catch(()=>{});return result;
 }
 async function handle(req,res){try{
  if(req.method==='GET'){const mode=new URL(req.url,'http://localhost').searchParams.get('mode');if(!Object.hasOwn(MODES,mode))throw fail('冒険先を選んでください。',400);const result=await sharedSnapshot();return send(res,200,{mode,fetchedAt:result.fetchedAt,leaders:result[mode]});}
  if(req.method==='POST'){
   if(!req.headers?.['content-type']?.startsWith('application/json'))throw fail('JSONで送信してください。',415);const user=await requestUser(req),body=await requestJson(req,1024),mode=String(body.mode||'');if(!Object.hasOwn(MODES,mode))throw fail('冒険先を選んでください。',400);
   const expectedFloor=floorOf(Number(body.expectedFloor)),token=await accessToken(),data=await userDoc(token,user.uid),savedFloor=floorOf(data[MODES[mode]]);if(expectedFloor&&savedFloor<expectedFloor)return send(res,202,{ok:false,pending:true});
   const record=await publish({uid:user.uid,mode,floor:savedFloor,petName:data.petName});await refreshSharedSnapshot();return send(res,200,{ok:true,record});
  }
  throw fail('GETまたはPOSTのみ対応しています。',405);
 }catch(error){send(res,error.status||503,{error:error.status&&error.status<500?error.message:'ランキングを処理できませんでした。時間を置いて再表示してください。'});}}
 return {handle,snapshot,publish};
}
