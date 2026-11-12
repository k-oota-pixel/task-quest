import {titleState,TITLE_CONTENTS,validTitleName,DEFENSE_TITLE_APP,ONLINE_TITLE_APP} from './title-model.mjs';
import {awardTitleIds,collectionTitleState,hasTitleCollection,titleCollectionVersion,walletTitleIds} from './title-collection.mjs';
import {titleCountTransforms} from './title-count-summary.mjs';
import {fixtureTitleAuthority} from './title-authority.mjs';
const encode=value=>typeof value==='string'?{stringValue:value}:{nullValue:null};
const encodeInt=value=>({integerValue:String(Math.max(0,Math.floor(Number(value)||0)))});
const encodeIds=ids=>({arrayValue:{values:[...ids].sort().map(stringValue=>({stringValue}))}});
export function createLearningTitles({base,projectId,accessToken,verifyUser,decodeFields,send,fail,readJson,onTitleCountChanged=async()=>{},weeklyProgress=async()=>({progress:{}}),getAuthority=fixtureTitleAuthority,fetch:request=fetch}){
 const prefix=`projects/${projectId}/databases/(default)/documents/`;
 // Revision tokens preserve invalidations arriving while a full count is being read.
 const revisionOf=wallet=>Math.max(0,Math.floor(Number(wallet.titleCountRevision)||0));
 const walletPath=uid=>`users/${encodeURIComponent(uid)}/apps/english-playroom`;
 const retryAwards=new Map();
 async function patchWalletSummary(uid,token,summary,previous={},snapshot){
  const fields={};
  if(typeof summary.selectedId==='string'&&previous.selectedTitleId!==summary.selectedId)fields.selectedTitleId=encode(summary.selectedId);
  if(typeof summary.selectedTitle==='string'&&previous.selectedTitle!==summary.selectedTitle)fields.selectedTitle=encode(summary.selectedTitle);
  if(typeof summary.selectedTitleProof==='string'&&previous.selectedTitleProof!==summary.selectedTitleProof)fields.selectedTitleProof=encode(summary.selectedTitleProof);
  if(Number.isSafeInteger(summary.unlockedTitleCount)&&Number(previous.unlockedTitleCount)!==summary.unlockedTitleCount)fields.unlockedTitleCount=encodeInt(summary.unlockedTitleCount);
  if(summary.earnedTitleIds){
   fields.earnedTitleIds=encodeIds(summary.earnedTitleIds);
   fields.titleCollectionVersion=encodeInt(titleCollectionVersion);
   fields.titleCollectionProof=encode(summary.titleCollectionProof);
  }
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
 async function fetchWallet(uid,token){
  const response=await request(base+'/documents/'+walletPath(uid),{headers:{Authorization:'Bearer '+token}});
  if(response.status===404)return null;
  if(!response.ok)throw fail('称号を取得できませんでした。',502);
  const doc=await response.json();
  return {fields:decodeFields(doc.fields||{}),updateTime:doc.updateTime};
 }
 async function migrate(uid,{progress=false}={}){
  for(let attempt=0;attempt<3;attempt++){
   try{return await restore(uid,progress);}
   catch(error){if(!error.titleSummaryConflict||attempt===2)throw error;}
  }
 }
 async function restore(uid,showProgress){
  const progressApps=TITLE_CONTENTS.filter(x=>x.id!==DEFENSE_TITLE_APP&&x.id!==ONLINE_TITLE_APP);
  const token=await accessToken(),paths=[`learning_activity/${uid}`,`users/${uid}/apps/eiken-retry`,`user_titles/${uid}`,...progressApps.map(x=>`title_progress/${uid}/activities/${x.id}`),walletPath(uid)];
  const response=await request(base+'/documents:batchGet',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({documents:paths.map(p=>prefix+p),newTransaction:{readOnly:{}}})});
  if(!response.ok)throw fail('称号を取得できませんでした。',502);
  const rows=await response.json();
  const doc=path=>rows.find(row=>row.found?.name===prefix+path)?.found;
  const values=paths.map(path=>decodeFields(doc(path)?.fields||{}));
  let wallet=values.at(-1);
  const authority=await getAuthority();
  if(hasTitleCollection(wallet,authority,uid)&&!showProgress)return {wallet,state:collectionTitleState(wallet,authority,uid)};
  const selection=values[2];
  const legacy=titleState({activity:values[0],retry:values[1],selection:authority.verifySelection(uid,wallet)?{selectedId:wallet.selectedTitleId}:selection,progress:Object.fromEntries(progressApps.map((x,i)=>[x.id,values[i+3]])),wallet,weeklyEarnedIds:selection.weeklyEarnedIds});
  if(!hasTitleCollection(wallet,authority,uid)){
   const known=walletTitleIds(wallet,authority,uid);
   const earnedTitleIds=[...new Set([...known,...legacy.titles.filter(title=>title.unlocked).map(title=>title.id)])].map(id=>authority.award(uid,id));
   const titleCollectionProof=authority.marker(uid);
   const selectedTitleProof=authority.selection(uid,legacy.selectedId);
   const initialized={...wallet,earnedTitleIds,titleCollectionVersion,titleCollectionProof,selectedTitleProof,selectedTitleId:legacy.selectedId,selectedTitle:legacy.selectedTitle};
   const state=collectionTitleState(initialized,authority,uid);
   const snapshot=doc(paths.at(-1));
   await patchWalletSummary(uid,token,{...state,earnedTitleIds,titleCollectionProof,selectedTitleProof},wallet,{found:Boolean(snapshot),updateTime:snapshot?.updateTime});
   wallet=initialized;
  }
  const state=collectionTitleState(wallet,authority,uid);
  if(showProgress){
   const details=new Map(legacy.titles.map(title=>[title.id,title.done]));
   state.titles=state.titles.map(title=>title.unlocked?title:{...title,done:details.get(title.id)??title.done});
  }
  return {wallet,state};
 }
 async function ensureCollection(uid,token){
  const [snapshot,authority]=await Promise.all([fetchWallet(uid,token),getAuthority()]);
  if(hasTitleCollection(snapshot?.fields,authority,uid))return {wallet:snapshot.fields,state:collectionTitleState(snapshot.fields,authority,uid),snapshot};
  return migrate(uid);
 }
 async function recordAwards(uid,token,ids,transforms=[]){
  if(!ids.length)return;
  const write=awardTitleIds(prefix,uid,ids,await getAuthority());
  write.updateTransforms.push(...transforms);
  const response=await request(base+'/documents:commit',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({writes:[write]})});
  if(!response.ok)throw fail('獲得した称号を保存できませんでした。',502);
 }
 async function publish(uid,wallet,state){
  try{await onTitleCountChanged({uid,petName:wallet.petName||'',unlockedTitleCount:state.unlockedTitleCount});}
  catch(error){console.warn('Title leaderboard update deferred',error?.message||error);}
 }
 async function read(uid,{includeWeekly=false,progress=false,legacy=false,publishRanking=true}={}){
  const token=await accessToken();
  let {wallet,state,snapshot}=progress?await migrate(uid,{progress:true}):await ensureCollection(uid,token);
  if(includeWeekly){
   let weekly={progress:{}};
   try{weekly=await weeklyProgress(uid);}catch(error){console.warn('Weekly title progress unavailable',error?.message||error);}
   const authority=await getAuthority();
   state=collectionTitleState(wallet,authority,uid,{weeklyPeriod:weekly.week||'',weeklyProgress:weekly.progress||{}});
  }
  if(legacy&&snapshot){
   // A cached strength client still expects the old summary fields.
   try{await patchWalletSummary(uid,token,state,snapshot.fields,{found:true,updateTime:snapshot.updateTime});}
   catch(error){if(!error.titleSummaryConflict)throw error;}
  }
  if(publishRanking)await publish(uid,wallet,state);
  return state;
 }
 async function decorate(leaders){
  if(!leaders.length)return [];
  const token=await accessToken(),uids=[...new Set(leaders.map(x=>x.uid).filter(Boolean))];
  async function readNames(paths,fields){
   const response=await request(base+'/documents:batchGet',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({documents:paths.map(path=>prefix+path),mask:{fieldPaths:fields}})});
   if(!response.ok)throw fail('表示称号を取得できませんでした。',502);
   let rows;
   if(typeof response.text==='function'){
    const raw=await response.text();
    try{const value=JSON.parse(raw);rows=Array.isArray(value)?value:[value];}
    catch{rows=raw.split(/\r?\n/).filter(line=>line.trim()).map(line=>JSON.parse(line));}
   }else{
    const value=await response.json();rows=Array.isArray(value)?value:[value];
   }
   return paths.map(path=>decodeFields(rows.find(row=>row.found?.name===prefix+path)?.found?.fields||{}));
  }
  const authority=await getAuthority();
  const primary=(await readNames(uids.map(walletPath),['selectedTitleId','selectedTitleProof'])).map((wallet,index)=>authority.verifySelection(uids[index],wallet)?wallet.selectedTitleId:null);
  const missing=uids.filter((uid,index)=>primary[index]===null);
  const legacy=missing.length?await readNames(missing.map(uid=>'user_titles/'+uid),['selectedId']):[];
  const names=new Map(uids.map((uid,index)=>[uid,validTitleName(primary[index]??legacy[missing.indexOf(uid)]?.selectedId)]));
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
 async function readRetryTitles(uid){
  const token=await accessToken(),name=prefix+`users/${uid}/apps/eiken-retry`;
  const response=await request(base+'/documents:batchGet',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({documents:[name]})});
  if(!response.ok)throw fail('リトライ称号を取得できませんでした。',502);
  const rows=await response.json(),retry=decodeFields(rows.find(row=>row.found?.name===name)?.found?.fields||{});
  const titles=titleState({retry}).titles.filter(title=>title.appId==='eiken-retry');
  const owned=titles.filter(title=>title.id.startsWith('retry:')&&title.unlocked).map(title=>title.id);
  const synced=retryAwards.get(uid)||new Set();
  const added=owned.filter(id=>!synced.has(id));
  if(added.length){
   await recordAwards(uid,token,added,titleCountTransforms(0,{invalidate:true}));
   if(retryAwards.size>=2000&&!retryAwards.has(uid))retryAwards.delete(retryAwards.keys().next().value);
   retryAwards.set(uid,new Set([...synced,...added]));
  }
  return titles;
 }
 // Read only the expanded content's progress documents (usually one Firestore read).
 // Ownership comes from the existing collection read; do not migrate or write here.
 async function readAppProgress(uid,appId){
  if(!TITLE_CONTENTS.some(item=>item.id===appId))throw fail('教材が不正です。',400);
  const walletNeeded=[DEFENSE_TITLE_APP,ONLINE_TITLE_APP,'word-tower','eiken-dungeon'].includes(appId);
  const progressPath=`title_progress/${uid}/activities/${appId}`;
  const activityPath=`learning_activity/${uid}`,retryPath=`users/${uid}/apps/eiken-retry`;
  const paths=[
   ...([DEFENSE_TITLE_APP,ONLINE_TITLE_APP].includes(appId)?[]:[progressPath]),
   ...(appId==='eiken-retry'?[retryPath,activityPath]:[]),
   ...(appId===DEFENSE_TITLE_APP?[activityPath]:[]),
   ...(walletNeeded?[walletPath(uid)]:[])
  ];
  const token=await accessToken(),response=await request(base+'/documents:batchGet',{
   method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
   body:JSON.stringify({documents:paths.map(path=>prefix+path)})
  });
  if(!response.ok)throw fail('教材別の進捗を取得できませんでした。',502);
  const rows=await response.json(),data=path=>decodeFields(rows.find(row=>row.found?.name===prefix+path)?.found?.fields||{});
  const state=titleState({
   activity:paths.includes(activityPath)?data(activityPath):{},
   retry:paths.includes(retryPath)?data(retryPath):{},
   wallet:walletNeeded?data(walletPath(uid)):{},
   progress:paths.includes(progressPath)?{[appId]:data(progressPath)}:{}
  });
  return {appId,titles:state.titles.filter(item=>item.appId===appId).map(({id,done})=>({id,done}))};
 }
 async function handle(req,res){try{
  if(!['GET','POST'].includes(req.method))throw fail('GETまたはPOSTのみ対応しています。',405);
  const user=await verifyUser(req),view=new URL(req.url,'http://localhost').searchParams.get('view');
  if(req.method==='GET'&&view==='selection')return send(res,200,await readSelection(user.uid));
  if(req.method==='GET'&&view==='app-progress')return send(res,200,await readAppProgress(user.uid,new URL(req.url,'http://localhost').searchParams.get('appId')));
  if(req.method==='GET'){
   if(view==='retry')return send(res,200,{titles:await readRetryTitles(user.uid)});
   if(view==='initialize'){
    const {state}=await migrate(user.uid);
    return send(res,200,{unlockedTitleCount:state.unlockedTitleCount});
   }
   return send(res,200,await read(user.uid,{includeWeekly:view==='weekly',progress:view==='progress',legacy:!view,publishRanking:view!=='strength'}));
  }
  const body=await readJson(req,1024),selectedId=body.selectedId;
  if(typeof selectedId!=='string')throw fail('称号を選んでください。',400);
  const token=await accessToken(),{wallet,state}=await ensureCollection(user.uid,token);
  const title=state.titles.find(t=>t.id===selectedId&&t.unlocked);
  if(selectedId&&!title)throw fail('未解放の称号は選択できません。',400);
  const selectedTitle=title?.name||'';
  const authority=await getAuthority();
  await patchWalletSummary(user.uid,token,{selectedId,selectedTitle,selectedTitleProof:authority.selection(user.uid,selectedId)},wallet);
  return send(res,200,{selectedId,selectedTitle});
 }catch(error){send(res,error.status||500,{error:error.message||'称号を処理できませんでした。'});}}
 return {handle,read,decorate};
}
