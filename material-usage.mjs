import {CHALLENGE_CONTENTS,challengePeriods} from './challenge-model.mjs';

export const USAGE_CONTENTS=[
 ['eigo-meter','エイゴメーター'],
 ['word-wolf','ワードウルフ'],
 ...CHALLENGE_CONTENTS.map(x=>[x.id,x.label]),
 ['pet-fishing','PET FISHING'],
 ['adventure-tower','魔王の塔'],
 ['adventure-dungeon','魔物の巣窟'],
 ['today','TODAY']
];
const ids=new Set(USAGE_CONTENTS.map(x=>x[0]));
const countValue=value=>Math.max(0,Math.floor(Number(value)||0));
const decodeCountMap=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};

export function createMaterialUsage({base,projectId,accessToken,verifyAdmin,decodeFields,send,fail,fetch:request=fetch,now=Date.now}){
 // Nothing runs on a schedule: only the administrator's report request refreshes totals.
 const SNAPSHOT='analytics/material-usage-snapshot-v2';
 const prefix='projects/'+projectId+'/databases/(default)/documents/';
 const validDay=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value);
 const positive=value=>Math.max(0,Math.floor(Number(value)||0));
 const asObject=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};
 const encodeCounts=value=>({mapValue:{fields:Object.fromEntries(Object.entries(asObject(value)).filter(([id])=>ids.has(id)).map(([id,n])=>[id,{integerValue:String(positive(n))}]))}});
 let cached=null,pending=null;
 async function db(url,options={}){
  const token=await accessToken();
  return request(url,{...options,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',...(options.headers||{})}});
 }
 async function getSnapshot(){
  const res=await db(base+'/documents/'+SNAPSHOT);
  if(res.status===404)return null;
  if(!res.ok)throw fail('集計結果を取得できませんでした。',502);
  const doc=await res.json(),state=decodeFields(doc.fields||{});
  if(state.schemaVersion!==2||!Number.isFinite(Date.parse(state.through))||!validDay(state.day)||!validDay(state.trackingSince))throw fail('集計結果の形式が不正です。',502);
  return {...state,updateTime:doc.updateTime};
 }
 function add(state,fields,upper,backfill=false){
  const data=decodeFields(fields||{}),day=String(data.day||'');
  if(!validDay(day)||day>state.day)return;
  // During migration, leave documents created on/after the cutoff for the next
  // incremental pass. This also avoids double-counting concurrent writes.
  if(backfill&&Number.isFinite(Date.parse(data.recordedAt))&&Date.parse(data.recordedAt)>=Date.parse(upper))return;
  const counts=data.counts&&typeof data.counts==='object'?data.counts:{[data.appId]:data.count||1};
  for(const [id,value] of Object.entries(counts)){
   if(!ids.has(id))continue;
   const count=positive(value);if(!count)continue;
   state.totals[id]=(state.totals[id]||0)+count;
   if(day===state.day)state.todayCounts[id]=(state.todayCounts[id]||0)+count;
   state.trackingSince=!state.trackingSince||day<state.trackingSince?day:state.trackingSince;
  }
 }
 async function query(structuredQuery){
  const res=await db(base+'/documents:runQuery',{method:'POST',body:JSON.stringify({structuredQuery})});
  if(!res.ok){
   const error=await res.json().catch(()=>({}));
   if(error.error?.status==='FAILED_PRECONDITION')throw fail('差分集計用のFirestoreインデックスが必要です。管理者に設定を確認してください。',502);
   throw fail('学習履歴の集計に失敗しました。',502);
  }
  const data=await res.json();return (Array.isArray(data)?data:[]).map(x=>x.document).filter(Boolean);
 }
 async function backfill(state,upper){
  let cursor='';
  while(true){
   const q={from:[{collectionId:'events',allDescendants:true}],orderBy:[{field:{fieldPath:'__name__'},direction:'ASCENDING'}],limit:1000};
   if(cursor)q.startAt={values:[{referenceValue:cursor}],before:false};
   const docs=await query(q);
   for(const doc of docs)if(!cursor||doc.name>cursor)add(state,doc.fields,upper,true);
   if(docs.length<1000)break;
   const last=docs.at(-1).name;
   if(last<=cursor)throw fail('過去の履歴の読み取りが進みませんでした。',502);
   cursor=last;
  }
  let token='';
  do{
   const u=new URL(base+'/documents/material_activity_events');
   u.searchParams.set('pageSize','1000');if(token)u.searchParams.set('pageToken',token);
   const res=await db(u.toString());
   if(res.status===404)break;
   if(!res.ok)throw fail('教材別の利用履歴を取得できませんでした。',502);
   const page=await res.json();
   for(const doc of page.documents||[])add(state,doc.fields,upper,true);
   token=page.nextPageToken||'';
  }while(token);
 }
 async function delta(collection,allDescendants,state,from,upper){
  let cursor=null;
  while(true){
   const q={from:[{collectionId:collection,...(allDescendants?{allDescendants:true}:{})}],
    where:{compositeFilter:{op:'AND',filters:[
     {fieldFilter:{field:{fieldPath:'recordedAt'},op:'GREATER_THAN_OR_EQUAL',value:{timestampValue:from}}},
     {fieldFilter:{field:{fieldPath:'recordedAt'},op:'LESS_THAN',value:{timestampValue:upper}}}
    ]}},
    orderBy:[{field:{fieldPath:'recordedAt'},direction:'ASCENDING'},{field:{fieldPath:'__name__'},direction:'ASCENDING'}],
    limit:500};
   if(cursor)q.startAt={values:[{timestampValue:cursor.time},{referenceValue:cursor.name}],before:false};
   const docs=await query(q);
   for(const doc of docs)add(state,doc.fields,upper);
   if(docs.length<500)break;
   const last=docs.at(-1),time=decodeFields(last.fields||{}).recordedAt;
   if(!time||cursor?.name===last.name)throw fail('差分履歴の読み取りが進みませんでした。',502);
   cursor={name:last.name,time};
  }
 }
 async function save(state,previous){
  const fields={schemaVersion:{integerValue:'2'},day:{stringValue:state.day},
   through:{timestampValue:state.through},trackingSince:{stringValue:state.trackingSince||state.day},
   totals:encodeCounts(state.totals),todayCounts:encodeCounts(state.todayCounts)};
  const res=await db(base+'/documents:commit',{method:'POST',body:JSON.stringify({writes:[{
   update:{name:prefix+SNAPSHOT,fields},currentDocument:previous?{updateTime:previous.updateTime}:{exists:false}
  }]})});
  if(res.ok)return state;
  const error=await res.json().catch(()=>({}));
  if([409,412].includes(res.status)||['FAILED_PRECONDITION','ABORTED','ALREADY_EXISTS'].includes(error.error?.status)){
   const latest=await getSnapshot();if(latest)return latest;
  }
  throw fail('教材別集計を保存できませんでした。',502);
 }
 function view(state){
  return {day:state.day,trackingSince:state.trackingSince||state.day,through:state.through,fetchedAt:now(),
   rows:USAGE_CONTENTS.map(([id,label])=>({id,label,today:positive(state.todayCounts?.[id]),total:positive(state.totals?.[id])}))};
 }
 async function refresh(day){
  const previous=await getSnapshot();
  // A 60-second safety margin prevents missing server-timestamp commits in flight.
  const upper=new Date(now()-60000).toISOString();
  if(previous&&previous.through>=upper&&previous.day===day)return view(previous);
  const state={day,through:upper,trackingSince:previous?.trackingSince||'',
   totals:{...asObject(previous?.totals)},todayCounts:previous?.day===day?{...asObject(previous?.todayCounts)}:{}};
  if(previous)await Promise.all([
   delta('events',true,state,previous.through,upper),
   delta('material_activity_events',false,state,previous.through,upper)
  ]);
  else await backfill(state,upper);
  return view(await save(state,previous));
 }
 return async function handle(req,res){
  try{
   if(req.method!=='GET')throw fail('GETのみ対応しています。',405);
   await verifyAdmin(req);
   const day=challengePeriods(now()).day;
   if(cached&&cached.day===day&&now()-cached.fetchedAt<60000)return send(res,200,cached);
   if(!pending)pending=refresh(day).then(value=>(cached=value)).finally(()=>{pending=null;});
   send(res,200,await pending);
  }catch(error){send(res,error.status||500,{error:error.message||'教材の利用回数を読み込めませんでした。'});}
 };
}

export function createMaterialActivity({base,projectId,accessToken,readJson,send,fail,fetch:request=fetch,now=Date.now}){
 const windows=new Map();let globalWindow={start:0,count:0};
 return async function handle(req,res){try{
  if(req.method!=='POST')throw fail('POSTのみ対応しています。',405);
  if(!req.headers?.['content-type']?.startsWith('application/json'))throw fail('JSONで送信してください。',415);
  const body=await readJson(req,1024),appId=body?.appId,eventId=body?.eventId;
  if(!['eigo-meter','word-wolf','today'].includes(appId)||typeof eventId!=='string'||!/^\w[\w-]{7,99}$/.test(eventId))throw fail('教材または記録IDが不正です。',400);
  const time=now(),ip=String(req.socket?.remoteAddress||'unknown');
  for(const [key,value] of windows)if(time-value.start>=60000)windows.delete(key);
  if(time-globalWindow.start>=60000)globalWindow={start:time,count:0};
  const entry=windows.get(ip)||{start:time,count:0};
  if(entry.count>=300||globalWindow.count>=3000)throw fail('アクセスが集中しています。',429);
  if(windows.size>=5000&&!windows.has(ip))throw fail('アクセスが集中しています。',429);
  entry.count++;windows.set(ip,entry);globalWindow.count++;
  const day=challengePeriods(time).day,token=await accessToken(),prefix=`projects/${projectId}/databases/(default)/documents/`;
  const response=await request(base+'/documents:commit',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({writes:[{
   update:{name:prefix+`material_activity_events/${eventId}`,fields:{eventId:{stringValue:eventId},appId:{stringValue:appId},day:{stringValue:day},count:{integerValue:'1'}}},
   currentDocument:{exists:false},updateTransforms:[{fieldPath:'recordedAt',setToServerValue:'REQUEST_TIME'}]
  }]})});
  if(!response.ok){
   const error=await response.json?.().catch(()=>({}))||{};
   if([409,412].includes(response.status)||['ALREADY_EXISTS','FAILED_PRECONDITION'].includes(error.error?.status)){send(res,200,{ok:true,duplicate:true});return;}
   throw fail('取り組み回数を保存できませんでした。',502);
  }
  send(res,200,{ok:true});
 }catch(e){send(res,e.status||500,{error:e.message||'取り組み回数を保存できませんでした。'});}};
}

export function createMaterialOpen({send,fail}){
 return async function handle(req,res){
  if(req.method!=='POST')return send(res,405,{error:'POSTのみ対応しています。'});
  // Kept temporarily for cached clients; page views no longer change usage totals.
  send(res,200,{ok:true,deprecated:true});
 };
}
