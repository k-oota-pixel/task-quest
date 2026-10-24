import {CHALLENGE_CONTENTS,challengePeriods} from './challenge-model.mjs';
export const USAGE_CONTENTS=[['eigo-meter','エイゴメーター'],['word-wolf','ワードウルフ'],...CHALLENGE_CONTENTS.map(x=>[x.id,x.label])];
const ids=new Set(USAGE_CONTENTS.map(x=>x[0]));
export function usageWrites({appId,projectId,now=Date.now()}){
 if(!ids.has(appId))return [];
 const {day}=challengePeriods(now);
 return ['total','day-'+day].map(id=>({update:{name:`projects/${projectId}/databases/(default)/documents/material_usage/${id}`,fields:{schemaVersion:{integerValue:'1'}}},updateMask:{fieldPaths:['schemaVersion']},updateTransforms:[{fieldPath:'counts.`'+appId+'`',increment:{integerValue:'1'}},{fieldPath:'updatedAt',setToServerValue:'REQUEST_TIME'}]}));
}
export function createMaterialUsage({base,accessToken,verifyAdmin,decodeFields,send,fail,fetch:request=fetch,now=Date.now}){
 let cached=null,pending=null;
 return async function handle(req,res){try{
  if(req.method!=='GET')throw fail('GETのみ対応しています。',405);
  await verifyAdmin(req);
  const {day}=challengePeriods(now());
  if(cached&&cached.day===day&&now()-cached.fetchedAt<60000){send(res,200,cached);return;}
  if(!pending||pending.day!==day){const entry={day};pending=entry;entry.promise=(async()=>{
   const token=await accessToken();const values=await Promise.all(['total','day-'+day].map(async id=>{const response=await request(base+'/documents/material_usage/'+id,{headers:{Authorization:'Bearer '+token}});if(response.status===404)return {};const body=await response.json();if(!response.ok)throw fail('教材の利用回数を取得できませんでした。',502);return decodeFields(body.fields||{});}));
   const count=x=>Math.max(0,Math.floor(Number(x)||0));
   return {day,trackingSince:'2026-10-24',fetchedAt:now(),rows:USAGE_CONTENTS.map(([id,label])=>({id,label,today:count(values[1].counts?.[id]),total:count(values[0].counts?.[id])}))};
  })().then(data=>(cached=data)).finally(()=>{if(pending===entry)pending=null;});}
  send(res,200,await pending.promise);
 }catch(e){send(res,e.status||500,{error:e.message||'教材の利用回数を取得できませんでした。'});}};
}

export function createMaterialOpen({base,projectId,accessToken,readJson,send,fail,fetch:request=fetch,now=Date.now}){
 const windows=new Map();let globalWindow={start:0,count:0};
 return async function handle(req,res){try{
  if(req.method!=='POST')throw fail('POSTのみ対応しています。',405);
  if(!req.headers?.['content-type']?.startsWith('application/json'))throw fail('JSONで送信してください。',415);
  const body=await readJson(req,1024);if(!body||!ids.has(body.appId))throw fail('教材が不正です。',400);
  const time=now(),ip=String(req.socket?.remoteAddress||'unknown');for(const [key,value] of windows)if(time-value.start>=60000)windows.delete(key);
  if(time-globalWindow.start>=60000)globalWindow={start:time,count:0};
  const entry=windows.get(ip)||{start:time,count:0};if(entry.count>=300||globalWindow.count>=3000)throw fail('アクセスが集中しています。',429);
  if(windows.size>=5000&&!windows.has(ip))throw fail('アクセスが集中しています。',429);
  entry.count++;windows.set(ip,entry);globalWindow.count++;
  const token=await accessToken(),response=await request(base+'/documents:commit',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({writes:usageWrites({appId:body.appId,projectId,now:time})})});
  if(!response.ok)throw fail('利用回数を保存できませんでした。',502);
  send(res,200,{ok:true});
 }catch(e){send(res,e.status||500,{error:e.message||'利用回数を保存できませんでした。'});}};
}
