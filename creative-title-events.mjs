import {applyTitleEvent,keyOf} from './creative-title-progress.mjs';
import {creativeTitles,creativeCatalog} from './title-model.mjs';
import {challengePeriods} from './challenge-model.mjs';
const encode=v=>v===null?{nullValue:null}:typeof v==='boolean'?{booleanValue:v}:typeof v==='number'?{integerValue:String(Math.floor(v))}:typeof v==='string'?{stringValue:v}:Array.isArray(v)?{arrayValue:{values:v.map(encode)}}:{mapValue:{fields:Object.fromEntries(Object.entries(v).map(([k,x])=>[k,encode(x)]))}};
export function validateTitleEvent(b,fail){
 if(!b||!creativeCatalog[b.appId]||!(/^[\w-]{8,100}$/).test(b.eventId||''))throw fail('称号の記録が不正です。',400);
 const e={appId:b.appId,eventId:b.eventId};
 for(const k of ['kind','itemId','sessionId','grade','course','mode','questionType','language','answer'])if(b[k]!==undefined){if(typeof b[k]!=='string'||b[k].length>(k==='answer'?3000:300))throw fail('記録が長すぎます。',400);e[k]=b[k];}
 for(const k of ['score','total','combo','oneLifeCorrect','afterMissCorrect','previousMistakes','previousWrongAt'])if(b[k]!==undefined){if(!Number.isInteger(b[k])||b[k]<0||b[k]>(k==='previousWrongAt'?Date.now():100000))throw fail('記録の数値が不正です。',400);e[k]=b[k];}
 for(const k of ['correct','clean','cleanRun','recovered','color','shape','size','manual','question','reason','followUp','series','first'])if(b[k]!==undefined){if(typeof b[k]!=='boolean')throw fail('記録の条件が不正です。',400);e[k]=b[k];}
 const kinds={ 'word-breaker':['run'],'pet-catch':['run'],ateru:['question','run'],'basic-quest':['question','run'],'eiken-cloze':['passage'],'reading-training':['exercise','summary'],'pet-instructions':['round','run'],'talk-quest':['chat'],'pet-chat':['chat']};
 if(!(kinds[e.appId]||['answer']).includes(e.kind))throw fail('記録の種類が不正です。',400);
 if(e.kind==='run'&&!Number.isInteger(e.score))throw fail('結果が必要です。',400);
 if(!['run','chat'].includes(e.kind)&&!e.itemId)throw fail('問題が必要です。',400);
 if(e.kind==='chat'&&(!e.sessionId||!e.itemId))throw fail('会話が必要です。',400);
 if(e.appId==='word-breaker'&&!['junior1','junior2','junior3','high1','high2','basic'].includes(e.course))throw fail('コースが不正です。',400);
 if(e.appId==='pet-catch'&&!['en-ja','ja-en'].includes(e.mode))throw fail('モードが不正です。',400);
 if(e.appId==='eiken-cloze'){
  if(!['choice','free'].includes(e.mode)||!Array.isArray(b.results)||!b.results.length||b.results.length>20||b.results.some(r=>!r||!['string','number'].includes(typeof r.id)||String(r.id).length>100||typeof r.correct!=='boolean')||new Set(b.results.map(r=>String(r.id))).size!==b.results.length)throw fail('採点結果が不正です。',400);
  e.results=b.results.map(r=>({id:String(r.id),correct:r.correct}));
 }
 if(e.appId==='listening-training'&&!['practice','dictation'].includes(e.mode))throw fail('モードが不正です。',400);
 if(['pre2-interview-questions','eiken-pre2-interview-a','reading-training'].includes(e.appId)&&e.kind!=='summary'&&(!Number.isInteger(e.score)||!e.total||e.score>e.total))throw fail('採点結果が不正です。',400);
 if(['ateru','basic-quest','pet-instructions'].includes(e.appId)&&e.kind==='run'&&e.score>(e.appId==='basic-quest'?4:5))throw fail('結果の上限を超えています。',400);
 if(['eiken-retry','eiken-title','task-quest','listening-training'].includes(e.appId)&&typeof e.correct!=='boolean')throw fail('判定が必要です。',400);
 return e;
}
export function createTitleEvents({base,projectId,accessToken,verifyUser,decodeFields,send,fail,readJson,fetch:request=fetch}){
 const prefix=`projects/${projectId}/databases/(default)/documents/`;
 return async(req,res)=>{try{
  if(req.method!=='POST')throw fail('POSTのみ対応しています。',405);
  const user=await verifyUser(req),e=validateTitleEvent(await readJson(req,12000),fail),token=await accessToken(),headers={Authorization:'Bearer '+token,'Content-Type':'application/json'};
  const path=`title_progress/${user.uid}/activities/${e.appId}`,receipt=`title_events/${user.uid}/events/${keyOf(e.appId+':'+e.eventId)}`,day=challengePeriods().day;
  for(let attempt=0;attempt<5;attempt++){
   const response=await request(base+'/documents:batchGet',{method:'POST',headers,body:JSON.stringify({documents:[prefix+path,prefix+receipt]})});if(!response.ok)throw fail('称号の記録を取得できませんでした。',502);
   const rows=await response.json();if(rows.some(r=>r.found?.name===prefix+receipt))return send(res,200,{ok:true,duplicate:true,freshTitles:[]});
   const doc=rows.find(r=>r.found?.name===prefix+path)?.found,previous=decodeFields(doc?.fields||{}),next=applyTitleEvent(previous,e,day);
   if(JSON.stringify(next).length>650000)throw fail('称号記録の上限に達しました。',413);
   const unlocked=new Set(creativeTitles(e.appId,previous).filter(t=>t.unlocked).map(t=>t.id)),freshTitles=creativeTitles(e.appId,next).filter(t=>t.unlocked&&!unlocked.has(t.id));
   const commit=await request(base+'/documents:commit',{method:'POST',headers,body:JSON.stringify({writes:[{update:{name:prefix+receipt,fields:{day:encode(day)}},currentDocument:{exists:false}},{update:{name:prefix+path,fields:encode(next).mapValue.fields},currentDocument:doc?{updateTime:doc.updateTime}:{exists:false}}]})});
   if(commit.ok)return send(res,200,{ok:true,freshTitles});const error=await commit.json?.().catch(()=>({}))||{};if(![409,412].includes(commit.status)&&!['ABORTED','ALREADY_EXISTS','FAILED_PRECONDITION'].includes(error.error?.status))throw fail('称号を保存できませんでした。',502);
  }throw fail('称号の保存が混み合っています。再試行してください。',409);
 }catch(error){send(res,error.status||500,{error:error.message||'称号を保存できませんでした。'});}};
}
