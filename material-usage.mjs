import {CHALLENGE_CONTENTS,challengePeriods} from './challenge-model.mjs';

export const MATERIAL_ACTIVITY_TRACKING_SINCE='2026-10-27';
export const USAGE_CONTENTS=[
 ['eigo-meter','エイゴメーター'],
 ['word-wolf','ワードウルフ'],
 ...CHALLENGE_CONTENTS.map(x=>[x.id,x.label]),
 ['adventure-tower','エイゴダンジョンズ（タワー）'],
 ['adventure-dungeon','エイゴダンジョンズ（ダンジョン）']
];
const ids=new Set(USAGE_CONTENTS.map(x=>x[0]));
const countValue=value=>Math.max(0,Math.floor(Number(value)||0));

export function materialActivityWrites({counts,projectId,now=Date.now()}){
 const entries=[...(counts instanceof Map?counts:new Map(Object.entries(counts||{})))].filter(([id,count])=>ids.has(id)&&countValue(count)>0);
 if(!entries.length)return [];
 const {day}=challengePeriods(now),prefix=`projects/${projectId}/databases/(default)/documents/`;
 return [{
  update:{name:prefix+`material_activity_daily/day-${day}`,fields:{schemaVersion:{integerValue:'1'}}},
  updateMask:{fieldPaths:['schemaVersion']},
  updateTransforms:[
   ...entries.map(([id,count])=>({fieldPath:'counts.`'+id+'`',increment:{integerValue:String(countValue(count))}})),
   {fieldPath:'updatedAt',setToServerValue:'REQUEST_TIME'}
  ]
 }];
}

export function createMaterialUsage({base,accessToken,verifyAdmin,decodeFields,send,fail,fetch:request=fetch,now=Date.now}){
 let cached=null,pending=null;
 return async function handle(req,res){try{
  if(req.method!=='GET')throw fail('GETのみ対応しています。',405);
  await verifyAdmin(req);
  const day=challengePeriods(now()).day;
  if(cached&&cached.day===day&&now()-cached.fetchedAt<60000){send(res,200,cached);return;}
  if(!pending||pending.day!==day){const entry={day};pending=entry;entry.promise=(async()=>{
   const token=await accessToken(),dailyCounts=new Map();let pageToken='';
   do{
    const url=new URL(base+'/documents/material_activity_daily');
    url.searchParams.set('pageSize','1000');if(pageToken)url.searchParams.set('pageToken',pageToken);
    const response=await request(url.toString(),{headers:{Authorization:'Bearer '+token}});
    if(response.status===404)break;
    const body=await response.json().catch(()=>({}));
    if(!response.ok)throw fail('教材の取り組み回数を取得できませんでした。',502);
    for(const document of body.documents||[]){
     const id=String(document.name||'').split('/').at(-1)||'';
     if(!/^day-\d{4}-\d{2}-\d{2}$/.test(id))continue;
     const counts=decodeFields(document.fields||{}).counts||{};
     dailyCounts.set(id.slice(4),counts);
    }
    pageToken=body.nextPageToken||'';
   }while(pageToken);
   const rows=USAGE_CONTENTS.map(([id,label])=>{
    let total=0;for(const [date,counts] of dailyCounts)if(date>=MATERIAL_ACTIVITY_TRACKING_SINCE&&date<=day)total+=countValue(counts[id]);
    return {id,label,today:countValue(dailyCounts.get(day)?.[id]),total};
   });
   return {day,trackingSince:MATERIAL_ACTIVITY_TRACKING_SINCE,fetchedAt:now(),rows};
  })().then(data=>(cached=data)).finally(()=>{if(pending===entry)pending=null;});}
  send(res,200,await pending.promise);
 }catch(e){send(res,e.status||500,{error:e.message||'教材の取り組み回数を取得できませんでした。'});}};
}

export function createMaterialActivity({base,projectId,accessToken,readJson,send,fail,fetch:request=fetch,now=Date.now}){
 const windows=new Map();let globalWindow={start:0,count:0};
 return async function handle(req,res){try{
  if(req.method!=='POST')throw fail('POSTのみ対応しています。',405);
  if(!req.headers?.['content-type']?.startsWith('application/json'))throw fail('JSONで送信してください。',415);
  const body=await readJson(req,1024),appId=body?.appId;
  if(!['eigo-meter','word-wolf'].includes(appId))throw fail('教材が不正です。',400);
  const time=now(),ip=String(req.socket?.remoteAddress||'unknown');
  for(const [key,value] of windows)if(time-value.start>=60000)windows.delete(key);
  if(time-globalWindow.start>=60000)globalWindow={start:time,count:0};
  const entry=windows.get(ip)||{start:time,count:0};
  if(entry.count>=300||globalWindow.count>=3000)throw fail('アクセスが集中しています。',429);
  if(windows.size>=5000&&!windows.has(ip))throw fail('アクセスが集中しています。',429);
  entry.count++;windows.set(ip,entry);globalWindow.count++;
  const writes=materialActivityWrites({counts:new Map([[appId,1]]),projectId,now:time});
  const token=await accessToken(),response=await request(base+'/documents:commit',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({writes})});
  if(!response.ok)throw fail('取り組み回数を保存できませんでした。',502);
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
