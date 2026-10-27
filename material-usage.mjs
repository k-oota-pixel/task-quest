import {CHALLENGE_CONTENTS,challengePeriods} from './challenge-model.mjs';

export const USAGE_CONTENTS=[
 ['eigo-meter','エイゴメーター'],
 ['word-wolf','ワードウルフ'],
 ...CHALLENGE_CONTENTS.map(x=>[x.id,x.label]),
 ['adventure-tower','魔王の塔'],
 ['adventure-dungeon','魔物の巣窟']
];
const ids=new Set(USAGE_CONTENTS.map(x=>x[0]));
const countValue=value=>Math.max(0,Math.floor(Number(value)||0));
const decodeCountMap=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};

export function createMaterialUsage({base,accessToken,verifyAdmin,decodeFields,send,fail,fetch:request=fetch,now=Date.now}){
 let cached=null,pending=null;
 return async function handle(req,res){try{
  if(req.method!=='GET')throw fail('GETのみ対応しています。',405);
  await verifyAdmin(req);
  const day=challengePeriods(now()).day;
  if(cached&&cached.day===day&&now()-cached.fetchedAt<60000){send(res,200,cached);return;}
  if(!pending||pending.day!==day){const entry={day};pending=entry;entry.promise=(async()=>{
   const token=await accessToken(),countsByDay=new Map();
   const add=(date,appId,count)=>{
    if(!/^\\d{4}-\\d{2}-\\d{2}$/.test(date)||date>day||!ids.has(appId))return;
    const counts=countsByDay.get(date)||{};
    counts[appId]=(counts[appId]||0)+countValue(count);
    countsByDay.set(date,counts);
   };
   let cursor='';
   do{
    const structuredQuery={from:[{collectionId:'events',allDescendants:true}],orderBy:[{field:{fieldPath:'__name__'},direction:'ASCENDING'}],limit:1000};
    if(cursor)structuredQuery.startAt={values:[{referenceValue:cursor}],before:false};
    const response=await request(base+'/documents:runQuery',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({structuredQuery})});
    if(!response.ok)throw fail('学習イベントの集計を取得できませんでした。',502);
    const results=await response.json(),documents=(Array.isArray(results)?results:[]).map(x=>x?.document).filter(Boolean);
    for(const document of documents){
     const fields=decodeFields(document.fields||{}),eventCounts=decodeCountMap(fields.counts),date=String(fields.day||'');
     for(const [appId,count] of Object.entries(eventCounts))add(date,appId,count);
    }
    cursor=documents.at(-1)?.name||'';
    if(documents.length<1000)break;
   }while(cursor);
   let pageToken='';
   do{
    const url=new URL(base+'/documents/material_activity_events');
    url.searchParams.set('pageSize','1000');if(pageToken)url.searchParams.set('pageToken',pageToken);
    const response=await request(url.toString(),{headers:{Authorization:'Bearer '+token}});
    if(response.status===404)break;
    const body=await response.json().catch(()=>({}));
    if(!response.ok)throw fail('教材の取り組み回数を取得できませんでした。',502);
    for(const document of body.documents||[]){
     const fields=decodeFields(document.fields||{});
     add(String(fields.day||''),String(fields.appId||''),fields.count||1);
    }
    pageToken=body.nextPageToken||'';
   }while(pageToken);
   const trackedDays=[...countsByDay.keys()].sort(),trackingSince=trackedDays[0]||day;
   const rows=USAGE_CONTENTS.map(([id,label])=>{
    let total=0;for(const [date,counts] of countsByDay)if(date>=trackingSince&&date<=day)total+=countValue(counts[id]);
    return {id,label,today:countValue(countsByDay.get(day)?.[id]),total};
   });
   return {day,trackingSince,fetchedAt:now(),rows};
  })().then(data=>(cached=data)).finally(()=>{if(pending===entry)pending=null;});}
  send(res,200,await pending.promise);
 }catch(e){send(res,e.status||500,{error:e.message||'教材の取り組み回数を取得できませんでした。'});}};
}

export function createMaterialActivity({base,projectId,accessToken,readJson,send,fail,fetch:request=fetch,now=Date.now}){
 const windows=new Map();let globalWindow={start:0,count:0};
 return async function handle(req,res){try{
  if(req.method!=='POST')throw fail('POSTのみ対応しています。',405);
  if(!req.headers?.['content-type']?.startsWith('application/json'))throw fail('JSONで送信してください。',415);
  const body=await readJson(req,1024),appId=body?.appId,eventId=body?.eventId;
  if(!['eigo-meter','word-wolf'].includes(appId)||typeof eventId!=='string'||!/^\\w[\\w-]{7,99}$/.test(eventId))throw fail('教材または記録IDが不正です。',400);
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
   currentDocument:{exists:false}
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
