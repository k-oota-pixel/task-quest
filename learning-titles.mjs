import {titleState,TITLE_CONTENTS,validTitleName,creativeTitles,creativeCatalog,activityTitles} from './title-model.mjs';
const encode=value=>typeof value==='string'?{stringValue:value}:{nullValue:null};
const encodeInt=value=>({integerValue:String(Math.max(0,Math.floor(Number(value)||0)))});
const unlockedCount=titles=>new Set((titles||[]).filter(t=>t?.unlocked&&typeof t.id==='string').map(t=>t.id)).size;
export function createLearningTitles({base,projectId,accessToken,verifyUser,decodeFields,send,fail,readJson,fetch:request=fetch}){
 const prefix=`projects/${projectId}/databases/(default)/documents/`;
 async function patchWalletSummary(uid,token,summary,previous={}){
  const fields={};
  if(typeof summary.selectedId==='string'&&previous.selectedTitleId!==summary.selectedId)fields.selectedTitleId=encode(summary.selectedId);
  if(typeof summary.selectedTitle==='string'&&previous.selectedTitle!==summary.selectedTitle)fields.selectedTitle=encode(summary.selectedTitle);
  if(Number.isSafeInteger(summary.unlockedTitleCount)&&Number(previous.unlockedTitleCount)!==summary.unlockedTitleCount)fields.unlockedTitleCount=encodeInt(summary.unlockedTitleCount);
  const names=Object.keys(fields);if(!names.length)return;
  const params=new URLSearchParams(names.map(name=>['updateMask.fieldPaths',name]));
  const response=await request(base+'/documents/users/'+encodeURIComponent(uid)+'/apps/english-playroom?'+params,{method:'PATCH',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({fields})});
  if(!response.ok)throw fail('称号の集約情報を保存できませんでした。',502);
 }
 async function read(uid){
  const token=await accessToken(),paths=[`learning_activity/${uid}`,`users/${uid}/apps/eiken-retry`,`user_titles/${uid}`,...TITLE_CONTENTS.map(x=>`title_progress/${uid}/activities/${x.id}`),`users/${uid}/apps/english-playroom`];
  const response=await request(base+'/documents:batchGet',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({documents:paths.map(p=>prefix+p)})});
  if(!response.ok)throw fail('称号を取得できませんでした。',502);
  const rows=await response.json(),values=paths.map(p=>decodeFields(rows.find(r=>r.found?.name===prefix+p)?.found?.fields||{}));
  const wallet=values.at(-1),state=titleState({activity:values[0],retry:values[1],selection:values[2],progress:Object.fromEntries(TITLE_CONTENTS.map((x,i)=>[x.id,values[i+3]])),wallet});
  state.unlockedTitleCount=unlockedCount(state.titles);
  // Transfer the notebook's previously equipped title once, without overwriting
  // a selection made concurrently in another tab.
  if(values[2].selectedId===undefined&&state.selectedId){
   const migrated=await request(base+'/documents/user_titles/'+encodeURIComponent(uid)+'?currentDocument.exists=false',{method:'PATCH',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({fields:{selectedId:encode(state.selectedId),selectedTitle:encode(state.selectedTitle)}})});
   if(!migrated.ok&&![409,412].includes(migrated.status))throw fail('以前の称号を引き継げませんでした。再試行してください。',502);
  }
  await patchWalletSummary(uid,token,state,wallet);
  return state;
 }
 async function decorate(leaders){
  if(!leaders.length)return [];
  const token=await accessToken(),uids=[...new Set(leaders.map(x=>x.uid).filter(Boolean))];
  const response=await request(base+'/documents:batchGet',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({documents:uids.map(uid=>prefix+'user_titles/'+uid)})});
  if(!response.ok)throw fail('表示称号を取得できませんでした。',502);
  const rows=await response.json(),names=new Map(uids.map(uid=>[uid,validTitleName(decodeFields(rows.find(r=>r.found?.name===prefix+'user_titles/'+uid)?.found?.fields||{}).selectedId)]));
  return leaders.map(({uid,...entry})=>({...entry,title:names.get(uid)||'称号なし'}));
 }
 async function readSelection(uid){
  const token=await accessToken(),walletResponse=await request(base+'/documents/users/'+encodeURIComponent(uid)+'/apps/english-playroom',{headers:{Authorization:'Bearer '+token}});
  if(walletResponse.ok){
   const wallet=decodeFields((await walletResponse.json()).fields||{}),selectedId=typeof wallet.selectedTitleId==='string'?wallet.selectedTitleId:null;
   if(selectedId!==null)return {selectedId,selectedTitle:typeof wallet.selectedTitle==='string'?wallet.selectedTitle:validTitleName(selectedId)};
  }else if(walletResponse.status!==404)throw fail('表示称号を取得できませんでした。',502);
  const response=await request(base+'/documents/user_titles/'+encodeURIComponent(uid),{headers:{Authorization:'Bearer '+token}});
  if(response.status===404){await patchWalletSummary(uid,token,{selectedId:'',selectedTitle:''});return {selectedId:'',selectedTitle:''};}
  if(!response.ok)throw fail('表示称号を取得できませんでした。',502);
  const data=await response.json(),fields=decodeFields(data.fields||{}),selectedId=typeof fields.selectedId==='string'?fields.selectedId:'',selectedTitle=validTitleName(selectedId);
  await patchWalletSummary(uid,token,{selectedId,selectedTitle});
  return {selectedId,selectedTitle};
 }
 async function readSelectedTitle(uid,selectedId){
  if(selectedId==='')return '';
  const creative=Object.entries(creativeCatalog).find(([,titles])=>titles.some(title=>title.id===selectedId));
  if(creative){
   const [appId]=creative,name=prefix+`title_progress/${uid}/activities/${appId}`,token=await accessToken();
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
 async function readRetryTitles(uid){
  const token=await accessToken(),name=prefix+`users/${uid}/apps/eiken-retry`;
  const response=await request(base+'/documents:batchGet',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({documents:[name]})});
  if(!response.ok)throw fail('リトライ称号を取得できませんでした。',502);
  const rows=await response.json(),retry=decodeFields(rows.find(row=>row.found?.name===name)?.found?.fields||{});
  return titleState({retry}).titles.filter(title=>title.appId==='eiken-retry');
 }
 async function handle(req,res){try{
  if(!['GET','POST'].includes(req.method))throw fail('GETまたはPOSTのみ対応しています。',405);
  const user=await verifyUser(req),view=new URL(req.url,'http://localhost').searchParams.get('view');
  if(req.method==='GET'&&view==='selection')return send(res,200,await readSelection(user.uid));
  if(req.method==='GET'&&view==='retry')return send(res,200,{titles:await readRetryTitles(user.uid)});
  if(req.method==='POST'){
   const body=await readJson(req,1024),selectedId=body.selectedId;if(typeof selectedId!=='string')throw fail('称号を選んでください。',400);
   const selectedTitle=await readSelectedTitle(user.uid,selectedId),token=await accessToken(),response=await request(base+'/documents/user_titles/'+encodeURIComponent(user.uid),{method:'PATCH',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({fields:{selectedId:encode(selectedId),selectedTitle:encode(selectedTitle)}})});
   if(!response.ok)throw fail('称号を保存できませんでした。再試行してください。',502);
   await patchWalletSummary(user.uid,token,{selectedId,selectedTitle});
   return send(res,200,{selectedId,selectedTitle});
  }
  const state=await read(user.uid);
  if(req.method==='GET')return send(res,200,state);
  throw fail('GETまたはPOSTのみ対応しています。',405);
 }catch(error){send(res,error.status||500,{error:error.message||'称号を処理できませんでした。'});}}
 return {handle,read,decorate};
}
