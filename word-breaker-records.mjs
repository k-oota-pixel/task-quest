export const RECORD_COURSES=['junior1','junior2','junior3','high1','high2','basic'];
const scoreOf=value=>Number.isSafeInteger(value)&&value>0?value:0;
const petNameOf=value=>{
 if(typeof value!=='string')return '名前未設定のペット';
 const name=value.normalize('NFKC').trim().replace(/\s+/g,' ');
 return name&&[...name].length<=12&&!/[\u0000-\u001f\u007f]/.test(name)?name:'名前未設定のペット';
};
const emptyCourses=()=>Object.fromEntries(RECORD_COURSES.map(course=>[course,{score:0,leaders:[]}]))
const publicCourses=courses=>Object.fromEntries(RECORD_COURSES.map(course=>{
 const value=courses?.[course]||{},leaders=Array.isArray(value.leaders)?value.leaders:[];
 return [course,{score:scoreOf(value.score),petNames:leaders.map(v=>petNameOf(v?.petName)).slice(0,3),leaderCount:leaders.length}];
}));
function internalSummary(players){
 const courses=emptyCourses();
 for(const player of players){
  const uid=typeof player.uid==='string'?player.uid:'';
  if(!uid)continue;
  for(const course of RECORD_COURSES){
   const score=scoreOf(player.wordBreakerBests?.[course]?.score),current=courses[course];
   if(score>current.score){current.score=score;current.leaders=score?[{uid,petName:petNameOf(player.petName)}]:[];}
   else if(score&&score===current.score&&!current.leaders.some(v=>v.uid===uid))current.leaders.push({uid,petName:petNameOf(player.petName)});
  }
 }
 for(const course of RECORD_COURSES)courses[course].leaders.sort((a,b)=>a.petName.localeCompare(b.petName,'ja'));
 return courses;
}
export function summarizeRecords(players){return publicCourses(internalSummary(players));}
function encodeValue(value){
 if(value===null)return {nullValue:null};
 if(typeof value==='string')return {stringValue:value};
 if(typeof value==='boolean')return {booleanValue:value};
 if(Number.isSafeInteger(value))return {integerValue:String(value)};
 if(typeof value==='number'&&Number.isFinite(value))return {doubleValue:value};
 if(Array.isArray(value))return {arrayValue:{values:value.map(encodeValue)}};
 if(value&&typeof value==='object')return {mapValue:{fields:Object.fromEntries(Object.entries(value).map(([k,v])=>[k,encodeValue(v)]))}};
 return {nullValue:null};
}
const encodeFields=obj=>Object.fromEntries(Object.entries(obj).map(([k,v])=>[k,encodeValue(v)]));
function sanitizeStored(value){
 const courses=emptyCourses();
 for(const course of RECORD_COURSES){
  const current=value?.courses?.[course]||{},score=scoreOf(current.score),seen=new Set(),leaders=[];
  if(Array.isArray(current.leaders))for(const item of current.leaders){
   const uid=typeof item?.uid==='string'?item.uid:'';if(!uid||seen.has(uid))continue;seen.add(uid);leaders.push({uid,petName:petNameOf(item.petName)});
  }
  courses[course]={score,leaders:score?leaders:[]};
 }
 return {schemaVersion:1,courses};
}
function uidFromName(name){const match=String(name||'').match(/\/documents\/users\/([^/]+)\/apps\/english-playroom$/);return match?decodeURIComponent(match[1]):'';}
export function createWordBreakerRecords({base,activeIds,accessToken,decodeFields,send,fail,fetch:request=globalThis.fetch,decorate=null,now=Date.now,webApiKey=process.env.FIREBASE_WEB_API_KEY||'AIzaSyAllLjPcGhygMSEIORXhKZOaDjYvpSJ4EQ'}){
 const docUrl=base+'/documents/leaderboards/word-breaker';
 async function requestUser(req){const auth=String(req.headers?.authorization||'');const match=auth.match(/^Bearer\s+(.+)$/i);if(!match)throw fail('ログインが必要です。',401);const response=await request(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(webApiKey)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({idToken:match[1]})});let data={};try{data=await response.json();}catch{}const user=data.users?.[0];if(!response.ok||!user?.localId)throw fail('ログイン情報を確認できませんでした。',401);return {uid:user.localId};}
 async function requestJson(req,maxBytes=1024){if(req.body&&typeof req.body==='object')return req.body;let raw='',size=0;for await(const chunk of req){size+=chunk.length;if(size>maxBytes)throw fail('送信内容が大きすぎます。',413);raw+=chunk;}try{return JSON.parse(raw||'{}');}catch{throw fail('送信内容を読み取れません。',400);}}
 async function userDoc(token,uid){const response=await request(`${base}/documents/users/${encodeURIComponent(uid)}/apps/english-playroom`,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(15000)});if(response.status===404)return {};let data={};try{data=await response.json();}catch{}if(!response.ok)throw fail('ユーザー情報を取得できませんでした。',502);return decodeFields(data.fields||{});}
 let cached=null,inflight=null,retryAfter=0,publishChain=Promise.resolve();
 async function readSummary(token){
  const response=await request(docUrl,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(15000)});
  if(response.status===404)return null;
  const data=await response.json();
  if(!response.ok)throw fail('みんなの記録を取得できませんでした。',response.status===429?429:502);
  return {value:sanitizeStored(decodeFields(data.fields||{})),updateTime:data.updateTime||''};
 }
 async function writeSummary(token,value,updateTime=''){
  const url=new URL(docUrl);if(updateTime)url.searchParams.set('currentDocument.updateTime',updateTime);
  const response=await request(url,{method:'PATCH',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},signal:AbortSignal.timeout(15000),body:JSON.stringify({fields:encodeFields(value)})});
  let data={};try{data=await response.json();}catch{}
  if(!response.ok){const error=fail('みんなの記録を更新できませんでした。',response.status===409||response.status===412?409:502);error.retryable=response.status===409||response.status===412;throw error;}
  return {value:sanitizeStored(decodeFields(data.fields||encodeFields(value))),updateTime:data.updateTime||''};
 }
 async function scanPlayers(){
  const ids=[...new Set(await activeIds())],players=[],token=await accessToken();
  for(let offset=0;offset<ids.length;offset+=200){
   const names=ids.slice(offset,offset+200).map(uid=>base.replace(/^https:\/\/firestore.googleapis.com\/v1\//,'')+'/documents/users/'+uid+'/apps/english-playroom');
   const response=await request(base+'/documents:batchGet',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},signal:AbortSignal.timeout(15000),body:JSON.stringify({documents:names,mask:{fieldPaths:['petName','wordBreakerBests']}})});
   const rows=await response.json();if(!response.ok||!Array.isArray(rows))throw fail('みんなの記録を取得できませんでした。',response.status===429?429:502);
   const expected=new Set(names);for(const row of rows)if(row.found&&expected.has(row.found.name))players.push({uid:uidFromName(row.found.name),...decodeFields(row.found.fields||{})});
  }
  return {token,courses:internalSummary(players)};
 }
 async function load(){
  const token=await accessToken(),stored=await readSummary(token);if(stored)return stored;
  const bootstrap=await scanPlayers(),value={schemaVersion:1,courses:bootstrap.courses};
  try{return await writeSummary(bootstrap.token,value);}catch(error){if(!error.retryable)throw error;const raced=await readSummary(bootstrap.token);if(raced)return raced;throw error;}
 }
 async function snapshot(){
  if(cached&&now()-cached.fetchedAt<60000)return {courses:publicCourses(cached.value.courses),fetchedAt:cached.fetchedAt};
  if(inflight)return inflight;
  if(now()<retryAfter)throw fail('記録を取得できませんでした。少し待ってから再試行してください。',503);
  inflight=load().then(stored=>{cached={...stored,fetchedAt:now()};return {courses:publicCourses(stored.value.courses),fetchedAt:cached.fetchedAt};}).catch(error=>{retryAfter=now()+5000;throw error;}).finally(()=>{inflight=null;});
  return inflight;
 }
 async function publish({uid,course,score,petName}){
  if(!RECORD_COURSES.includes(course)||!uid)return null;score=scoreOf(score);if(!score)return null;
  const task=async()=>{
   const token=await accessToken();let stored=cached?.value?{value:cached.value,updateTime:cached.updateTime}:await readSummary(token);
   if(!stored){stored=await load();}
   for(let attempt=0;attempt<3;attempt++){
    const next=sanitizeStored(stored.value),record=next.courses[course],name=petNameOf(petName);let changed=false;
    if(score>record.score){record.score=score;record.leaders=[{uid,petName:name}];changed=true;}
    else if(score===record.score){const leader=record.leaders.find(v=>v.uid===uid);if(leader){if(leader.petName!==name){leader.petName=name;changed=true;}}else{record.leaders.push({uid,petName:name});changed=true;}}
    if(!changed){cached={...stored,fetchedAt:now()};return publicCourses(next)[course];}
    record.leaders.sort((a,b)=>a.petName.localeCompare(b.petName,'ja'));
    try{const written=await writeSummary(token,next,stored.updateTime);cached={...written,fetchedAt:now()};return publicCourses(written.value.courses)[course];}
    catch(error){if(!error.retryable||attempt===2)throw error;stored=await readSummary(token);if(!stored)stored=await load();}
   }
  };
  const result=publishChain.then(task,task);publishChain=result.catch(()=>{});return result;
 }
 async function handle(req,res){
  try{
   if(req.method==='GET'){const result=await snapshot();if(decorate&&cached){const all=RECORD_COURSES.flatMap(course=>(cached.value.courses[course]?.leaders||[]).slice(0,3));const decorated=await decorate(all);let offset=0;for(const course of RECORD_COURSES){const size=Math.min(3,cached.value.courses[course]?.leaders?.length||0);result.courses[course].leaders=decorated.slice(offset,offset+size);offset+=size;}}return send(res,200,result);}
   if(req.method==='POST'){
    if(!req.headers['content-type']?.startsWith('application/json'))throw fail('JSONで送信してください。',415);
    const user=await requestUser(req),body=await requestJson(req,1024),course=String(body.course||'');if(!RECORD_COURSES.includes(course))throw fail('コースが不正です。',400);
    const token=await accessToken(),data=await userDoc(token,user.uid),score=scoreOf(data.wordBreakerBests?.[course]?.score),record=await publish({uid:user.uid,course,score,petName:data.petName});
    return send(res,200,{ok:true,record});
   }
   throw fail('GETまたはPOSTのみ対応しています。',405);
  }catch(error){send(res,error.status||503,{error:error.status&&error.status<500?error.message:'みんなの記録を処理できませんでした。時間を置いて再試行してください。'});}
 }
 return {handle,snapshot,publish};
}
