const scoreOf=value=>Number.isSafeInteger(value)&&value>0?value:0;
const petNameOf=value=>{
  if(typeof value!=='string')return 'ペットの赤ちゃん';
  const name=value.normalize('NFKC').trim().replace(/\s+/g,' ');
  return name&&[...name].length<=12&&!/[\u0000-\u001f\u007f]/.test(name)?name:'ペットの赤ちゃん';
};
function tokyoDay(now=Date.now()){
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(now));
  const map=Object.fromEntries(parts.map(p=>[p.type,p.value]));
  return `${map.year}-${map.month}-${map.day}`;
}
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
function sanitizeStored(value,today){
  if(value?.date!==today)return {schemaVersion:1,date:today,score:0,leaders:[]};
  const score=scoreOf(value.score),seen=new Set(),leaders=[];
  if(Array.isArray(value.leaders))for(const item of value.leaders){
    const uid=typeof item?.uid==='string'?item.uid:'';
    if(!uid||seen.has(uid))continue;
    seen.add(uid);leaders.push({uid,petName:petNameOf(item.petName)});
  }
  leaders.sort((a,b)=>a.petName.localeCompare(b.petName,'ja'));
  return {schemaVersion:1,date:today,score,leaders:score?leaders:[]};
}
function publicRecord(value,today){
  const clean=sanitizeStored(value,today);
  return {date:clean.date,score:clean.score,petNames:clean.leaders.map(v=>v.petName).slice(0,5),leaderCount:clean.leaders.length};
}

export function createPetCatchRecords({base,accessToken,verifyUser,decodeFields,send,fail,fetch:request=globalThis.fetch,decorate=null,now=Date.now}){
  const docUrl=base+'/documents/leaderboards/pet-catch-daily';
  let cached=null,inflight=null,retryAfter=0,publishChain=Promise.resolve();

  async function readStored(token,today){
    const response=await request(docUrl,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(15000)});
    if(response.status===404)return {value:sanitizeStored(null,today),updateTime:''};
    let data={};try{data=await response.json();}catch{}
    if(!response.ok)throw fail('今日のPET CATCH記録を取得できませんでした。',response.status===429?429:502);
    return {value:sanitizeStored(decodeFields(data.fields||{}),today),updateTime:data.updateTime||''};
  }
  async function writeStored(token,value,updateTime=''){
    const url=new URL(docUrl);if(updateTime)url.searchParams.set('currentDocument.updateTime',updateTime);
    const response=await request(url,{method:'PATCH',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},signal:AbortSignal.timeout(15000),body:JSON.stringify({fields:encodeFields(value)})});
    let data={};try{data=await response.json();}catch{}
    if(!response.ok){const error=fail('今日のPET CATCH記録を更新できませんでした。',response.status===409||response.status===412?409:502);error.retryable=response.status===409||response.status===412;throw error;}
    return {value:sanitizeStored(decodeFields(data.fields||encodeFields(value)),value.date),updateTime:data.updateTime||''};
  }
  async function userDoc(token,uid){
    const response=await request(`${base}/documents/users/${encodeURIComponent(uid)}/apps/english-playroom`,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(15000)});
    if(response.status===404)return {};
    let data={};try{data=await response.json();}catch{}
    if(!response.ok)throw fail('PET CATCHの記録を取得できませんでした。',502);
    return decodeFields(data.fields||{});
  }
  async function snapshot(){
    const today=tokyoDay(now());
    if(cached&&cached.day===today&&now()-cached.fetchedAt<30000)return publicRecord(cached.value,today);
    if(inflight)return inflight;
    if(now()<retryAfter)throw fail('記録を取得できませんでした。少し待ってから再試行してください。',503);
    inflight=(async()=>{const token=await accessToken(),stored=await readStored(token,today);cached={value:stored.value,updateTime:stored.updateTime,day:today,fetchedAt:now()};return publicRecord(stored.value,today);})().catch(error=>{retryAfter=now()+5000;throw error;}).finally(()=>{inflight=null;});
    return inflight;
  }
  async function publish(uid){
    const task=async()=>{
      const today=tokyoDay(now()),token=await accessToken(),data=await userDoc(token,uid);
      if(data.petCatchDailyDate!==today)return snapshot();
      const score=scoreOf(data.petCatchDailyBest);if(!score)return snapshot();
      const name=petNameOf(data.petName);
      const sameDayCache=cached?.day===today?cached:null;
      if(sameDayCache&&score<scoreOf(sameDayCache.value?.score))return publicRecord(sameDayCache.value,today);
      let stored=await readStored(token,today);
      for(let attempt=0;attempt<3;attempt++){
        const next=sanitizeStored(stored.value,today),recordScore=scoreOf(next.score);let changed=false;
        if(score>recordScore){next.score=score;next.leaders=[{uid,petName:name}];changed=true;}
        else if(score===recordScore){const leader=next.leaders.find(v=>v.uid===uid);if(leader){if(leader.petName!==name){leader.petName=name;changed=true;}}else{next.leaders.push({uid,petName:name});changed=true;}}
        if(!changed){cached={value:next,updateTime:stored.updateTime,day:today,fetchedAt:now()};return publicRecord(next,today);}
        next.leaders.sort((a,b)=>a.petName.localeCompare(b.petName,'ja'));
        try{const written=await writeStored(token,next,stored.updateTime);cached={value:written.value,updateTime:written.updateTime,day:today,fetchedAt:now()};return publicRecord(written.value,today);}
        catch(error){if(!error.retryable||attempt===2)throw error;stored=await readStored(token,today);}
      }
    };
    const result=publishChain.then(task,task);publishChain=result.catch(()=>{});return result;
  }
  async function handle(req,res){
    try{
      if(req.method==='GET'){const record=await snapshot();if(decorate)record.leaders=await decorate((cached?.value?.leaders||[]).slice(0,5));return send(res,200,record);}
      if(req.method==='POST'){const user=await verifyUser(req),record=await publish(user.uid);if(decorate)record.leaders=await decorate((cached?.value?.leaders||[]).slice(0,5));return send(res,200,{ok:true,record});}
      throw fail('GETまたはPOSTのみ対応しています。',405);
    }catch(error){send(res,error.status||503,{error:error.status&&error.status<500?error.message:'今日のPET CATCH記録を処理できませんでした。時間を置いて再試行してください。'});}
  }
  return {handle,snapshot,publish};
}
