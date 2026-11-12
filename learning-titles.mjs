import {titleState,TITLE_CONTENTS,RANKING_ONLY_CONTENTS,validTitleName,creativeTitles,creativeCatalog,activityTitles,WEEKLY_DAYS_TARGET,DEFENSE_TITLE_APP,defenseTitleProgress,ONLINE_TITLE_APP,onlineBattleTitleProgress} from './title-model.mjs';
const encode=value=>typeof value==='string'?{stringValue:value}:{nullValue:null};
const encodeInt=value=>({integerValue:String(Math.max(0,Math.floor(Number(value)||0)))});
const unlockedCount=titles=>new Set((titles||[]).filter(t=>t?.unlocked&&typeof t.id==='string').map(t=>t.id)).size;
export function createLearningTitles({base,projectId,accessToken,verifyUser,decodeFields,send,fail,readJson,onTitleCountChanged=async()=>{},weeklyProgress=async()=>({progress:{}}),fetch:request=fetch}){
 const prefix=`projects/${projectId}/databases/(default)/documents/`;
 // Revision tokens preserve invalidations arriving while a full count is being read.
 const revisionOf=wallet=>Math.max(0,Math.floor(Number(wallet.titleCountRevision)||0));
 const titleCountInvalidation=(prefix,uid)=>({update:{name:prefix+`users/${uid}/apps/english-playroom`,fields:{}},updateMask:{fieldPaths:[]},updateTransforms:[{fieldPath:'titleCountRevision',increment:{integerValue:'1'}}]});
 async function patchWalletSummary(uid,token,summary,previous={},snapshot){
  const fields={};
  if(typeof summary.selectedId==='string'&&previous.selectedTitleId!==summary.selectedId)fields.selectedTitleId=encode(summary.selectedId);
  if(typeof summary.selectedTitle==='string'&&previous.selectedTitle!==summary.selectedTitle)fields.selectedTitle=encode(summary.selectedTitle);
  if(Number.isSafeInteger(summary.unlockedTitleCount)&&Number(previous.unlockedTitleCount)!==summary.unlockedTitleCount)fields.unlockedTitleCount=encodeInt(summary.unlockedTitleCount);
  if(Number.isSafeInteger(summary.unlockedTitleCount)){
   if(previous.titleCountSummaryVersion!==1)fields.titleCountSummaryVersion=encodeInt(1);
   if(previous.titleCountSyncedRevision!==revisionOf(previous))fields.titleCountSyncedRevision=encodeInt(revisionOf(previous));
  }
  const names=Object.keys(fields);if(!names.length)return;
  const params=new URLSearchParams(names.map(name=>['updateMask.fieldPaths',name]));
  if(snapshot){
   if(snapshot.updateTime)params.set('currentDocument.updateTime',snapshot.updateTime);
   else if(!snapshot.found)params.set('currentDocument.exists','false');
  }
  const response=await request(base+'/documents/users/'+encodeURIComponent(uid)+'/apps/english-playroom?'+params,{method:'PATCH',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({fields})});
  if(!response.ok){
   const error=fail('称号の集約情報を保存できませんでした。',502);
   error.titleSummaryConflict=Boolean(snapshot&&[409,412].includes(response.status));
   throw error;
  }
 }
 async function mirrorWalletSummary(uid,token,summary,previous={}){
  try{await patchWalletSummary(uid,token,summary,previous);}catch(error){console.warn('Title wallet summary sync deferred',error?.message||error);}
 }
 async function read(uid,options={}){
  for(let attempt=0;attempt<3;attempt++){
   try{return await readOnce(uid,options);}
   catch(error){if(!error.titleSummaryConflict||attempt===2)throw error;}
  }
 }
 async function readOnce(uid,{includeWeekly=false}={}){
  // Defense titles derive from the wallet and already-loaded activity record.
  // Do not add a new title_progress document read just for this game.
  const progressApps=TITLE_CONTENTS.filter(x=>x.id!==DEFENSE_TITLE_APP&&x.id!==ONLINE_TITLE_APP);
  const token=await accessToken(),paths=[`learning_activity/${uid}`,`users/${uid}/apps/eiken-retry`,`user_titles/${uid}`,...progressApps.map(x=>`title_progress/${uid}/activities/${x.id}`),`users/${uid}/apps/english-playroom`];
  const response=await request(base+'/documents:batchGet',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({documents:paths.map(p=>prefix+p),newTransaction:{readOnly:{}}})});
  if(!response.ok)throw fail('称号を取得できませんでした。',502);
  const rows=await response.json(),values=paths.map(p=>decodeFields(rows.find(r=>r.found?.name===prefix+p)?.found?.fields||{}));
  const wallet=values.at(-1),selection=values[2];
  const walletDoc=rows.find(row=>row.found?.name===prefix+paths.at(-1))?.found;
  let weekly={progress:{}};
  if(includeWeekly){try{weekly=await weeklyProgress(uid);}catch(error){console.warn('Weekly title progress unavailable',error?.message||error);}}
  const earned=new Set(Array.isArray(selection.weeklyEarnedIds)?selection.weeklyEarnedIds.filter(x=>typeof x==='string'&&x.startsWith('weekly:')):[]);
  const additions=Object.entries(weekly.progress||{}).filter(([app,days])=>Number(days)>=WEEKLY_DAYS_TARGET&&(app==='coins'||[...TITLE_CONTENTS,...RANKING_ONLY_CONTENTS].some(item=>item.id===app)))
   .map(([app])=>'weekly:'+app).filter(id=>!earned.has(id));
  if(includeWeekly&&additions.length){
   const ids=[...earned,...additions];
   const response=await request(base+'/documents/user_titles/'+encodeURIComponent(uid)+'?updateMask.fieldPaths=weeklyEarnedIds',{
    method:'PATCH',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
    body:JSON.stringify({fields:{weeklyEarnedIds:{arrayValue:{values:ids.map(value=>({stringValue:value}))}}}})
   });
   if(response.ok){selection.weeklyEarnedIds=ids;}else console.warn('Weekly title award sync deferred',response.status);
  }
  const state=titleState({activity:values[0],retry:values[1],selection,progress:Object.fromEntries(progressApps.map((x,i)=>[x.id,values[i+3]])),wallet,weeklyEarnedIds:selection.weeklyEarnedIds,weeklyProgress:weekly.progress||{}});
  state.unlockedTitleCount=unlockedCount(state.titles);
  state.weeklyPeriod=weekly.week||'';
  state.weeklyProgress=weekly.progress||{};
  // Transfer the notebook's previously equipped title once, without overwriting
  // a selection made concurrently in another tab.
  if(values[2].selectedId===undefined&&state.selectedId){
   const migrated=await request(base+'/documents/user_titles/'+encodeURIComponent(uid)+'?currentDocument.exists=false',{method:'PATCH',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({fields:{selectedId:encode(state.selectedId),selectedTitle:encode(state.selectedTitle)}})});
   if(!migrated.ok&&![409,412].includes(migrated.status))throw fail('以前の称号を引き継げませんでした。再試行してください。',502);
  }
  await patchWalletSummary(uid,token,state,wallet,{found:Boolean(walletDoc),updateTime:walletDoc?.updateTime});
  // Fast awards may have updated the wallet before the title list was opened.
  // The ranking service skips unchanged leaderboards.
  try{await onTitleCountChanged({uid,petName:wallet.petName||'',unlockedTitleCount:state.unlockedTitleCount});}
  catch(error){console.warn('Title leaderboard update deferred',error?.message||error);}
  return state;
 }
 async function decorate(leaders){
  if(!leaders.length)return [];
  const token=await accessToken(),uids=[...new Set(leaders.map(x=>x.uid).filter(Boolean))];
  const response=await request(base+'/documents:batchGet',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({documents:uids.map(uid=>prefix+'user_titles/'+uid)})});
  if(!response.ok)throw fail('表示称号を取得できませんでした。',502);
  // Firestore batchGet may stream newline-delimited JSON instead of a JSON array.
  let rows;
  if(typeof response.text==='function'){
   const raw=await response.text();
   try{const value=JSON.parse(raw);rows=Array.isArray(value)?value:[value];}
   catch{rows=raw.split(/\r?\n/).filter(line=>line.trim()).map(line=>JSON.parse(line));}
  }else{
   const value=await response.json();rows=Array.isArray(value)?value:[value];
  }
  const names=new Map(uids.map(uid=>[uid,validTitleName(decodeFields(rows.find(r=>r.found?.name===prefix+'user_titles/'+uid)?.found?.fields||{}).selectedId)]));
  return leaders.map(({uid,...entry})=>({...entry,uid,title:names.get(uid)||'称号なし'}));
 }
 async function readSelection(uid){
  const token=await accessToken(),walletResponse=await request(base+'/documents/users/'+encodeURIComponent(uid)+'/apps/english-playroom',{headers:{Authorization:'Bearer '+token}});
  if(walletResponse.ok){
   const wallet=decodeFields((await walletResponse.json()).fields||{}),selectedId=typeof wallet.selectedTitleId==='string'?wallet.selectedTitleId:null;
   if(selectedId!==null)return {selectedId,selectedTitle:typeof wallet.selectedTitle==='string'?wallet.selectedTitle:validTitleName(selectedId)};
  }else if(walletResponse.status!==404)throw fail('表示称号を取得できませんでした。',502);
  const response=await request(base+'/documents/user_titles/'+encodeURIComponent(uid),{headers:{Authorization:'Bearer '+token}});
  if(response.status===404){await mirrorWalletSummary(uid,token,{selectedId:'',selectedTitle:''});return {selectedId:'',selectedTitle:''};}
  if(!response.ok)throw fail('表示称号を取得できませんでした。',502);
  const data=await response.json(),fields=decodeFields(data.fields||{}),selectedId=typeof fields.selectedId==='string'?fields.selectedId:'',selectedTitle=validTitleName(selectedId);
  await mirrorWalletSummary(uid,token,{selectedId,selectedTitle});
  return {selectedId,selectedTitle};
 }
 async function readSelectedTitle(uid,selectedId){
  if(selectedId==='')return '';
  if(selectedId.startsWith('master:')||selectedId.startsWith('weekly:')){
   // Master titles are derived from all previously earned titles, not client claims.
   const appId=selectedId.slice(7);
   if(![...TITLE_CONTENTS,...RANKING_ONLY_CONTENTS].some(item=>item.id===appId))throw fail('称号を選んでください。',400);
   const state=await read(uid),title=state.titles.find(t=>t.id===selectedId&&t.unlocked);
   if(!title)throw fail('未解放の称号は選択できません。',400);
   return title.name;
  }
  const creative=Object.entries(creativeCatalog).find(([,titles])=>titles.some(title=>title.id===selectedId));
  if(creative){
   const [appId]=creative;
   if(appId===ONLINE_TITLE_APP){
    // A single existing wallet read proves ownership; no additional progress document.
    const token=await accessToken(),name=prefix+`users/${uid}/apps/english-playroom`;
    const response=await request(base+'/documents/users/'+encodeURIComponent(uid)+'/apps/english-playroom',{headers:{Authorization:'Bearer '+token}});
    if(!response.ok)throw fail('オンライン対戦の称号を確認できませんでした。',502);
    const wallet=decodeFields((await response.json()).fields||{});
    const title=creativeTitles(appId,onlineBattleTitleProgress(wallet)).find(item=>item.id===selectedId);
    if(!title?.unlocked)throw fail('未解放の称号は選択できません。',400);
    return title.name;
   }
   if(appId===DEFENSE_TITLE_APP){
    const token=await accessToken(),names=[prefix+`learning_activity/${uid}`,prefix+`users/${uid}/apps/english-playroom`];
    const response=await request(base+'/documents:batchGet',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({documents:names})});
    if(!response.ok)throw fail('称号を確認できませんでした。',502);
    const rows=await response.json(),activity=decodeFields(rows.find(row=>row.found?.name===names[0])?.found?.fields||{}),wallet=decodeFields(rows.find(row=>row.found?.name===names[1])?.found?.fields||{});
    const title=creativeTitles(appId,defenseTitleProgress(activity,wallet)).find(item=>item.id===selectedId);
    if(!title?.unlocked)throw fail('未解放の称号は選択できません。',400);
    return title.name;
   }
   const name=prefix+`title_progress/${uid}/activities/${appId}`,token=await accessToken();
   const response=await request(base+'/documents:batchGet',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({documents:[name]})});
   if(!response.ok)throw fail('称号を確認できませんでした。',502);
   const rows=await response.json(),progress=decodeFields(rows.find(row=>row.found?.name===name)?.found?.fields||{}),title=creativeTitles(appId,progress).find(item=>item.id===selectedId);
   if(!title?.unlocked)throw fail('未解放の称号は選択できません。',400);return title.name;
  }
  if(selectedId.startsWith('retry:')){
   const title=(await readRetryTitles(uid)).find(item=>item.id===selectedId);if(!title?.unlocked)throw fail('未解放の称号は選択できません。',400);return title.name;
  }
  const appId=TITLE_CONTENTS.find(item=>selectedId.startsWith(item.id+':'))?.id;
  const threshold=Number(selectedId.slice((appId||'').length+1));
  if(!appId||!Number.isInteger(threshold))throw fail('称号を選んでください。',400);
  const name=prefix+`learning_activity/${uid}`,token=await accessToken(),response=await request(base+'/documents:batchGet',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({documents:[name]})});
  if(!response.ok)throw fail('称号を確認できませんでした。',502);
  const rows=await response.json(),activity=decodeFields(rows.find(row=>row.found?.name===name)?.found?.fields||{}),title=activityTitles(appId,activity.contents?.[appId]?.titleCount).find(item=>item.need===threshold);
  if(!title?.unlocked)throw fail('未解放の称号は選択できません。',400);return title.name;
 }
 async function readRetryTitles(uid,{invalidate=false}={}){
  const token=await accessToken(),name=prefix+`users/${uid}/apps/eiken-retry`;
  const response=await request(base+'/documents:batchGet',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({documents:[name]})});
  if(!response.ok)throw fail('リトライ称号を取得できませんでした。',502);
  const rows=await response.json(),retry=decodeFields(rows.find(row=>row.found?.name===name)?.found?.fields||{});
  // Called after the notebook's cloud save: its grade titles use that saved history.
  if(invalidate){const invalidated=await request(base+'/documents:commit',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({writes:[titleCountInvalidation(prefix,uid)]})});
  if(!invalidated.ok)throw fail('称号数の更新を予約できませんでした。',502);}
  return titleState({retry}).titles.filter(title=>title.appId==='eiken-retry');
 }
 async function handle(req,res){try{
  if(!['GET','POST'].includes(req.method))throw fail('GETまたはPOSTのみ対応しています。',405);
  const user=await verifyUser(req),view=new URL(req.url,'http://localhost').searchParams.get('view');
  if(req.method==='GET'&&view==='selection')return send(res,200,await readSelection(user.uid));
  if(req.method==='GET'&&view==='retry')return send(res,200,{titles:await readRetryTitles(user.uid,{invalidate:true})});
  if(req.method==='GET'&&view==='weekly')return send(res,200,await read(user.uid,{includeWeekly:true}));
  if(req.method==='POST'){
   const body=await readJson(req,1024),selectedId=body.selectedId;if(typeof selectedId!=='string')throw fail('称号を選んでください。',400);
   const selectedTitle=await readSelectedTitle(user.uid,selectedId),token=await accessToken(),response=await request(base+'/documents/user_titles/'+encodeURIComponent(user.uid),{method:'PATCH',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({fields:{selectedId:encode(selectedId),selectedTitle:encode(selectedTitle)}})});
   if(!response.ok)throw fail('称号を保存できませんでした。再試行してください。',502);
   await mirrorWalletSummary(user.uid,token,{selectedId,selectedTitle});
   return send(res,200,{selectedId,selectedTitle});
  }
  const state=await read(user.uid);
  if(req.method==='GET')return send(res,200,state);
  throw fail('GETまたはPOSTのみ対応しています。',405);
 }catch(error){send(res,error.status||500,{error:error.message||'称号を処理できませんでした。'});}}
 return {handle,read,decorate};
}
