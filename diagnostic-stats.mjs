// Administrator-only, on-demand diagnostic statistics.
// Initial migration reads individual wallets once. Subsequent refreshes use the
// existing assessmentUpdatedAt timestamp; no extra writes by learners.
export const DIAGNOSTIC_SCALE='pilot-2-grade2';
export const DIAGNOSTIC_SNAPSHOT='admin_diagnostic_stats/current';
const SNAPSHOT_VERSION=3;
const grades=['4級','3級','準2級','2級','準1級程度'];
const PREFIX_ERROR='学習記録の差分検索に失敗しました。Firestoreのlearning_activityコレクションにassessmentUpdatedAt（昇順）の単一フィールドインデックスがあるか確認してください。';
const asNumber=value=>value===null||value===undefined||value===''?NaN:Number(value);
const average=values=>values.length?Math.round(values.reduce((a,b)=>a+b,0)*10/values.length)/10:null;
const safeCount=value=>Number.isInteger(value)&&value>=0?value:null;
const validUid=uid=>typeof uid==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(uid);
const obj=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};

export function normalizeDiagnostic(latest){
  if(!latest||latest.scaleVersion!==DIAGNOSTIC_SCALE)return null;
  const score=asNumber(latest.score);
  if(!Number.isFinite(score)||score<0||score>1000)return null;
  const normalized={id:String(latest.id||''),score,
    grade:String(latest.grade||''),
    atMs:Number(latest.atMs)||0};
  for(const key of ['vocabScore','grammarScore']){
    const value=asNumber(latest[key]);
    if(Number.isFinite(value)&&value>=0&&value<=1000)normalized[key]=value;
  }
  for(const key of ['vocabCorrect','vocabTotal','grammarCorrect','grammarTotal']){
    const value=safeCount(asNumber(latest[key]));
    if(value!==null)normalized[key]=value;
  }
  return normalized;
}

export function summarizeMembers(members, {updatedAt=new Date().toISOString(),source='batchGet',
  sourceReads=0,through=''}={}){
  const values=Object.values(obj(members)).filter(Boolean);
  const sorted=values.map(x=>x.score).sort((a,b)=>a-b);
  const counts=Object.fromEntries([...grades,'不明'].map(k=>[k,0]));
  const scoreBands=Array.from({length:10},(_,i)=>({
    label:i*100+'〜'+(i===9?1000:i*100+99)+'点',
    min:i*100,max:i===9?1000:i*100+99,count:0
  }));
  for(const entry of values){
    const grade=grades.find(k=>String(entry.grade||'').startsWith(k));
    counts[grade||'不明']++;
    scoreBands[Math.min(9,Math.floor(entry.score/100))].count++;
  }
  const valid=key=>values.map(x=>asNumber(x[key])).filter(Number.isFinite);
  const times=valid('atMs');
  const middle=sorted.length%2?sorted[(sorted.length-1)/2]:
    (sorted[sorted.length/2-1]+sorted[sorted.length/2])/2;
  return {schemaVersion:SNAPSHOT_VERSION,scaleVersion:DIAGNOSTIC_SCALE,
    updatedAt,through,source,sourceReads,
    participantCount:values.length,averageScore:average(sorted),
    medianScore:sorted.length?Math.round(middle*10)/10:null,
    minimumScore:sorted.length?sorted[0]:null,
    maximumScore:sorted.length?sorted.at(-1):null,
    averageVocabScore:average(valid('vocabScore')),
    averageGrammarScore:average(valid('grammarScore')),
    averageVocabCorrect:average(valid('vocabCorrect')),
    averageGrammarCorrect:average(valid('grammarCorrect')),
    gradeCounts:counts,scoreBands,
    latestAttemptAt:times.length?Math.max(...times):null
  };
}

export function summarizeDiagnostic(rows,options={}){
  const members={};
  for(const [index,row] of rows.entries()){
    const record=normalizeDiagnostic(row?.assessmentLatest);
    if(record)members[String(index)]=record;
  }
  return summarizeMembers(members,options);
}

export function createDiagnosticStats({base,projectId,accessToken,verifyAdmin,activeIds,adminIds,
  decodeFields,encodeFields,send,fail,fetchImpl=fetch,now=Date.now}){
  const docName='projects/'+projectId+'/databases/(default)/documents/'+DIAGNOSTIC_SNAPSHOT;
  const path=base+'/documents/'+DIAGNOSTIC_SNAPSHOT;
  const userPrefix='projects/'+projectId+'/databases/(default)/documents/users/';
  let pending=null;
  async function call(url,options={}){
    const token=await accessToken();
    return fetchImpl(url,{...options,headers:{
      Authorization:'Bearer '+token,'Content-Type':'application/json',...(options.headers||{})
    }});
  }
  async function readSnapshot(){
    const response=await call(path);
    if(response.status===404)return null;
    if(!response.ok)throw fail('保存済みのレベル判定集計を読み込めませんでした。',502);
    const doc=await response.json(),value=decodeFields(doc.fields||{});
    if(![1,2,SNAPSHOT_VERSION].includes(value.schemaVersion))
      throw fail('集計データの形式が不正です。',502);
    return {value,updateTime:doc.updateTime};
  }
  const publicView=value=>{
    const {members,...summary}=value;
    return summary;
  };
  const uidFromDoc=name=>{
    if(!name?.startsWith(userPrefix)||!name.endsWith('/apps/english-playroom'))return '';
    const uid=name.slice(userPrefix.length,-'/apps/english-playroom'.length);
    return validUid(uid)?uid:'';
  };
  async function batchGetMembers(ids){
    const members={};
    for(let start=0;start<ids.length;start+=100){
      const docs=ids.slice(start,start+100).map(uid=>userPrefix+uid+'/apps/english-playroom');
      const response=await call(base+'/documents:batchGet',{method:'POST',
        body:JSON.stringify({documents:docs,mask:{fieldPaths:['assessmentLatest']}})});
      if(!response.ok)throw fail('初回の受験結果の取得に失敗しました。',502);
      const rows=await response.json();
      if(!Array.isArray(rows))throw fail('受験結果の形式が不正です。',502);
      for(const row of rows){
        const uid=uidFromDoc(row.found?.name);
        if(!uid)continue;
        const record=normalizeDiagnostic(decodeFields(row.found.fields||{}).assessmentLatest);
        if(record)members[uid]=record;
      }
    }
    return members;
  }
  // A top-level collection uses Firestore's default single-field index.
  // Each completed diagnostic already updates its own learning_activity doc
  // in the same transaction as the wallet and attempt receipt.
  const activityPrefix='projects/'+projectId+'/databases/(default)/documents/learning_activity/';
  const uidFromActivityDoc=name=>{
    if(!name?.startsWith(activityPrefix))return '';
    const uid=name.slice(activityPrefix.length);
    return validUid(uid)?uid:'';
  };
  async function changedMembers(after,before,allowed){
    let cursor=null,markerReads=0;
    const updates=new Map();
    while(true){
      const filters=[
        {fieldFilter:{field:{fieldPath:'assessmentUpdatedAt'},op:'GREATER_THAN_OR_EQUAL',
          value:{timestampValue:after}}},
        {fieldFilter:{field:{fieldPath:'assessmentUpdatedAt'},op:'LESS_THAN',
          value:{timestampValue:before}}}
      ];
      const structuredQuery={
        from:[{collectionId:'learning_activity'}],
        select:{fields:[{fieldPath:'assessmentUpdatedAt'}]},
        where:{compositeFilter:{op:'AND',filters}},
        orderBy:[{field:{fieldPath:'assessmentUpdatedAt'},direction:'ASCENDING'},
          {field:{fieldPath:'__name__'},direction:'ASCENDING'}],
        limit:200
      };
      if(cursor)structuredQuery.startAt={values:[
        {timestampValue:cursor.at},{referenceValue:cursor.name}],before:false};
      const response=await call(base+'/documents:runQuery',{
        method:'POST',body:JSON.stringify({structuredQuery})});
      if(!response.ok){
        const error=await response.json().catch(()=>({}));
        const reason=String(error?.error?.status||'UNKNOWN');
        console.warn('diagnostic_activity_delta_query_failed',{status:response.status,reason});
        if(response.status===429||reason==='RESOURCE_EXHAUSTED')
          throw fail('Firestoreの読み取り上限または利用制限に達しています。',429);
        if(response.status===400||reason==='FAILED_PRECONDITION')
          throw fail(PREFIX_ERROR,412);
        throw fail('学習記録の差分検索に失敗しました。集計結果は変更していません。',502);
      }
      const rows=await response.json();
      if(!Array.isArray(rows))throw fail('学習記録の差分検索の応答が不正です。',502);
      const docs=rows.map(x=>x.document).filter(Boolean);
      markerReads+=docs.length;
      if(markerReads>10000)throw fail('差分が多すぎます。管理者に確認してください。',413);
      for(const doc of docs){
        const uid=uidFromActivityDoc(doc.name);
        if(!uid||!allowed.has(uid))continue;
        const at=String(decodeFields(doc.fields||{}).assessmentUpdatedAt||'');
        if(at)updates.set(uid,at);
      }
      if(docs.length<200)break;
      const last=docs.at(-1);
      const at=String(decodeFields(last.fields||{}).assessmentUpdatedAt||'');
      if(!at||last.name===cursor?.name)
        throw fail('学習記録の差分検索を安全に継続できませんでした。',502);
      cursor={name:last.name,at};
    }
    const uids=[...updates.keys()];
    const members=uids.length?await batchGetMembers(uids):{};
    const changes=Object.fromEntries(uids.map(uid=>[uid,{
      at:updates.get(uid),record:members[uid]||null
    }]));
    return {changes,readCount:markerReads+uids.length};
  }
  async function saveSnapshot(snapshot,previous){
    const encoded=encodeFields(snapshot);
    if(Buffer.byteLength(JSON.stringify(encoded),'utf8')>800000)
      throw fail('集計ドキュメントが大きくなりました。分割保存が必要です。',413);
    const write={update:{name:docName,fields:encoded},
      currentDocument:previous?{updateTime:previous.updateTime}:{exists:false}};
    const response=await call(base+'/documents:commit',{
      method:'POST',body:JSON.stringify({writes:[write]})});
    if(!response.ok){
      const error=await response.json().catch(()=>({}));
      const reason=String(error?.error?.status||'');
      if(response.status===409||response.status===412||
        ['ABORTED','FAILED_PRECONDITION','ALREADY_EXISTS'].includes(reason))
        throw fail('ほかの集計更新と競合しました。もう一度更新してください。',409);
      throw fail('集計結果を保存できませんでした。',502);
    }
    return publicView(snapshot);
  }
  async function refresh(){
    const previous=await readSnapshot();
    const [active,admins]=await Promise.all([activeIds(),adminIds()]);
    const allowed=new Set(active.filter(validUid));
    for(const uid of admins)allowed.delete(uid);
    const upper=new Date(now()-1000).toISOString();
    // Migrate earlier snapshots once so no attempts saved before the activity
    // marker rollout can be missed. This is the only full-user backfill.
    if(!previous||previous.value.schemaVersion!==SNAPSHOT_VERSION||
      previous.value.scaleVersion!==DIAGNOSTIC_SCALE||
      !previous.value.through||!previous.value.members){
      const ids=[...allowed];
      const members=await batchGetMembers(ids);
      const snapshot={...summarizeMembers(members,{
        updatedAt:new Date(now()).toISOString(),source:'initialBackfill',
        sourceReads:ids.length,through:upper
      }),members};
      return saveSnapshot(snapshot,previous);
    }
    const snapshot=previous.value;
    if(snapshot.through>=upper)return {...publicView(snapshot),source:'unchanged',sourceReads:0};
    const {changes,readCount}=await changedMembers(snapshot.through,upper,allowed);
    const members={...snapshot.members};
    let changed=false;
    // Also handle accounts that were disabled after the last snapshot.
    for(const uid of Object.keys(members))if(!allowed.has(uid)){
      delete members[uid];changed=true;
    }
    for(const [uid,item] of Object.entries(changes)){
      if(!allowed.has(uid))continue;
      if(!item.record){
        if(members[uid]){delete members[uid];changed=true;}
      }else if(JSON.stringify(members[uid])!==JSON.stringify(item.record)){
        members[uid]=item.record;changed=true;
      }
    }
    if(!changed&&!readCount)return {...publicView(snapshot),source:'unchanged',sourceReads:0};
    const next={...summarizeMembers(members,{
      updatedAt:new Date(now()).toISOString(),source:'delta',
      sourceReads:readCount,through:upper
    }),members};
    return saveSnapshot(next,previous);
  }
  return async function handle(req,res){
    try{
      if(!['GET','POST'].includes(req.method))throw fail('GETまたはPOSTのみ対応しています。',405);
      await verifyAdmin(req);
      if(req.method==='GET'){
        const previous=await readSnapshot();
        return send(res,200,previous?{ready:true,summary:publicView(previous.value)}:{ready:false});
      }
      if(!pending)pending=refresh().finally(()=>{pending=null;});
      return send(res,200,{ready:true,summary:await pending});
    }catch(error){
      return send(res,error.status||500,{error:error.message||'集計処理に失敗しました。'});
    }
  };
}
