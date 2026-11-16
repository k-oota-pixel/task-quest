// Administrator-only, on-demand English diagnostic snapshot.
// Individual results stay in users/{uid}/apps/english-playroom.
// GET costs one snapshot document read; POST refreshes from latest attempts.
export const DIAGNOSTIC_SCALE = 'pilot-1';
export const DIAGNOSTIC_SNAPSHOT = 'analytics/level-diagnostic-summary-v1';

const categories = ['4級', '3級', '準2級', '2級', '準1級程度'];
const bands = Array.from({length:10}, (_,i)=>({
  label: (i*100)+'〜'+(i===9?1000:i*100+99)+'点', min:i*100, max:i===9?1000:i*100+99
}));
const rounded = n => Math.round(n*10)/10;
const asNumber = value => typeof value === 'number' || typeof value === 'string' && value.trim()
  ? Number(value) : NaN;
const average = nums => nums.length ? rounded(nums.reduce((a,b)=>a+b,0)/nums.length) : null;

export function summarizeDiagnostic(rows, {updatedAt=new Date().toISOString(),source='batchGet',sourceReads=0}={}) {
  const scores=[], vocabulary=[], grammar=[], latestTimes=[];
  const gradeCounts=Object.fromEntries([...categories, '不明'].map(key=>[key,0]));
  const scoreBands=bands.map(item=>({...item,count:0}));
  for(const entry of rows){
    const latest=entry?.assessmentLatest;
    if(!latest || latest.scaleVersion!==DIAGNOSTIC_SCALE) continue;
    const score=asNumber(latest.score);
    if(!Number.isFinite(score)||score<0||score>1000)continue;
    scores.push(score);
    const v=asNumber(latest.vocabScore),g=asNumber(latest.grammarScore);
    if(Number.isFinite(v)&&v>=0&&v<=1000)vocabulary.push(v);
    if(Number.isFinite(g)&&g>=0&&g<=1000)grammar.push(g);
    const grade=categories.find(key=>String(latest.grade||'').startsWith(key));
    gradeCounts[grade||'不明']++;
    scoreBands[Math.min(9,Math.floor(score/100))].count++;
    const at=asNumber(latest.atMs);
    if(Number.isFinite(at)&&at>0)latestTimes.push(at);
  }
  scores.sort((a,b)=>a-b);
  return {
    schemaVersion:1,scaleVersion:DIAGNOSTIC_SCALE,updatedAt,source,sourceReads,
    participantCount:scores.length,
    averageScore:average(scores),
    medianScore:scores.length ? rounded(scores.length%2?scores[(scores.length-1)/2]:
      (scores[scores.length/2-1]+scores[scores.length/2])/2) : null,
    minimumScore:scores.length?scores[0]:null,
    maximumScore:scores.length?scores.at(-1):null,
    averageVocabScore:average(vocabulary),averageGrammarScore:average(grammar),
    gradeCounts,scoreBands,latestAttemptAt:latestTimes.length?Math.max(...latestTimes):null
  };
}

export function createDiagnosticStats({base,projectId,accessToken,verifyAdmin,activeIds,adminIds,
  decodeFields,encodeFields,send,fail,fetchImpl=fetch,now=Date.now}){
  const docName='projects/'+projectId+'/databases/(default)/documents/'+DIAGNOSTIC_SNAPSHOT;
  const path=base+'/documents/'+DIAGNOSTIC_SNAPSHOT;
  const prefix='projects/'+projectId+'/databases/(default)/documents/users/';
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
    const doc=await response.json();
    const value=decodeFields(doc.fields||{});
    if(value.schemaVersion!==1||value.scaleVersion!==DIAGNOSTIC_SCALE)
      throw fail('集計結果の形式が異なります。',502);
    return value;
  }

  async function readMatching(active,excluded){
    // Prefer a collection-group query: reads only existing test-takers if
    // the assessmentScaleVersion collection-group index is available.
    const structuredQuery={
      from:[{collectionId:'apps',allDescendants:true}],
      select:{fields:[{fieldPath:'assessmentLatest'}]},
      where:{fieldFilter:{field:{fieldPath:'assessmentScaleVersion'},op:'EQUAL',
        value:{stringValue:DIAGNOSTIC_SCALE}}},
      limit:5000
    };
    const response=await call(base+'/documents:runQuery',{
      method:'POST',body:JSON.stringify({structuredQuery})
    });
    if(!response.ok){
      const error=await response.json().catch(()=>({}));
      const reason=error?.error?.status;
      if(reason==='FAILED_PRECONDITION'||reason==='INVALID_ARGUMENT')return null;
      throw fail('受験結果の検索に失敗しました。',response.status===429?429:502);
    }
    const raw=await response.json();
    if(!Array.isArray(raw))throw fail('受験結果の形式が不正です。',502);
    const documents=raw.map(row=>row.document).filter(Boolean);
    if(documents.length>=5000)throw fail('受験記録が多すぎるため、集計範囲を分割してください。',413);
    const rows=[],seen=new Set();
    for(const doc of documents){
      if(!doc.name?.startsWith(prefix)||!doc.name.endsWith('/apps/english-playroom'))continue;
      const uid=doc.name.slice(prefix.length,-'/apps/english-playroom'.length);
      if(!active.has(uid)||excluded.has(uid)||seen.has(uid))continue;
      seen.add(uid);
      rows.push(decodeFields(doc.fields||{}));
    }
    return {rows,source:'collectionGroup',sourceReads:documents.length};
  }

  async function readByUid(ids){
    const rows=[];
    for(let i=0;i<ids.length;i+=100){
      const batch=ids.slice(i,i+100).map(uid=>prefix+uid+'/apps/english-playroom');
      const response=await call(base+'/documents:batchGet',{method:'POST',
        body:JSON.stringify({documents:batch,mask:{fieldPaths:['assessmentLatest']}})});
      if(!response.ok)throw fail('個別の最新診断を取得できませんでした。',response.status===429?429:502);
      const result=await response.json();
      if(!Array.isArray(result))throw fail('個別の診断データが不正です。',502);
      for(const item of result)if(item.found?.fields)rows.push(decodeFields(item.found.fields));
    }
    return {rows,source:'batchGet',sourceReads:ids.length};
  }
  async function rebuild(){
    const [activeList,adminList]=await Promise.all([activeIds(),adminIds()]);
    const excluded=new Set(adminList),active=new Set(activeList);
    const ids=[...active].filter(uid=>!excluded.has(uid));
    const input=await readMatching(active,excluded)||await readByUid(ids);
    const summary=summarizeDiagnostic(input.rows,{
      updatedAt:new Date(now()).toISOString(),source:input.source,sourceReads:input.sourceReads
    });
    const response=await call(base+'/documents:commit',{method:'POST',body:JSON.stringify({
      writes:[{update:{name:docName,fields:encodeFields(summary)}}]
    })});
    if(!response.ok)throw fail('レベル判定の集計を保存できませんでした。',502);
    return summary;
  }

  return async function handle(req,res){
    try{
      if(!['GET','POST'].includes(req.method))throw fail('GETまたはPOSTのみ対応しています。',405);
      await verifyAdmin(req);
      if(req.method==='GET'){
        const summary=await readSnapshot();
        return send(res,200,summary?{ready:true,summary}:{ready:false});
      }
      if(!pending)pending=rebuild().finally(()=>{pending=null;});
      return send(res,200,{ready:true,summary:await pending});
    }catch(error){
      return send(res,error.status||500,{error:error.message||'集計処理に失敗しました。'});
    }
  };
}
