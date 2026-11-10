export function createAdminUserIndex({base,projectId,accessToken,verifyAdmin,verifyUser,encodeFields,decodeFields,send,fail,fetchImpl=fetch,now=Date.now}){
 const docName='projects/'+projectId+'/databases/(default)/documents/admin_search_index/current';
 const url=base+'/documents/admin_search_index/current';
 let building=null;
 const selfSyncAt=new Map();
 async function req(url,options={}){
  const token=await accessToken();
  const response=await fetchImpl(url,{...options,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'}});
  if(response.status===404)return null;
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw fail('利用者検索用データを取得できませんでした。',502);
  return data;
 }
 async function read(){
  const data=await req(url);if(!data)return null;
  const v=decodeFields(data.fields||{});
  return {users:Array.isArray(v.users)?v.users:[],updatedAt:v.updatedAt||'',updateTime:data.updateTime};
 }
 async function sourceUsers(){
  const userMap=new Map(),codeMap=new Map();
  let cursor='';
  do{
   const u=new URL('https://identitytoolkit.googleapis.com/v1/projects/'+encodeURIComponent(projectId)+'/accounts:batchGet');
   u.searchParams.set('maxResults','1000');if(cursor)u.searchParams.set('nextPageToken',cursor);
   const body=await req(u.toString());
   for(const person of body?.users||[]){const uid=String(person.localId||'');if(!person.disabled&&/^[A-Za-z0-9_-]{1,128}$/.test(uid))
    userMap.set(uid,{uid,codeName:'',loginId:'',nickname:'',petName:''});}
   cursor=body?.nextPageToken||'';
  }while(cursor);
  let last='';
  while(true){
   const query={from:[{collectionId:'code_accounts'}],select:{fields:[{fieldPath:'uid'},{fieldPath:'codeName'},{fieldPath:'loginId'}]},orderBy:[{field:{fieldPath:'__name__'},direction:'ASCENDING'}],limit:500};
   if(last)query.startAt={values:[{referenceValue:last}],before:false};
   const rows=await req(base+'/documents:runQuery',{method:'POST',body:JSON.stringify({structuredQuery:query})});
   const docs=(rows||[]).filter(x=>x.document).map(x=>x.document);
   for(const doc of docs){
    if(doc.name<=last)continue;
    const a=decodeFields(doc.fields||{}),uid=String(a.uid||'');
    if(!/^[A-Za-z0-9_-]{1,128}$/.test(uid))continue;
    const row=userMap.get(uid)||{uid,codeName:'',loginId:'',nickname:'',petName:''};
    row.codeName=String(a.codeName||'');row.loginId=String(a.loginId||'');userMap.set(uid,row);
   }
   if(docs.length<500)break;
   last=docs.at(-1).name;
  }
  const users=[...userMap.values()].sort((a,b)=>a.uid.localeCompare(b.uid));
  for(let i=0;i<users.length;i+=100){
   const slice=users.slice(i,i+100);
   const documents=slice.map(row=>'projects/'+projectId+'/databases/(default)/documents/users/'+row.uid+'/apps/english-playroom');
   const rows=await req(base+'/documents:batchGet',{method:'POST',body:JSON.stringify({documents,mask:{fieldPaths:['nickname','petName']}})});
   const found=new Map((rows||[]).filter(x=>x.found).map(x=>[x.found.name,decodeFields(x.found.fields||{})]));
   for(const item of slice){
    const v=found.get('projects/'+projectId+'/databases/(default)/documents/users/'+item.uid+'/apps/english-playroom')||{};
    item.nickname=String(v.nickname||'');item.petName=String(v.petName||'');
   }
  }
  return users;
 }
 async function build(force=false){
  if(building)return building;
  building=(async()=>{
   const users=await sourceUsers();
   const index=await read();
   if(index&&!force)return index;
   const fields=encodeFields({version:1,updatedAt:new Date(now()).toISOString(),users});
   if(Buffer.byteLength(JSON.stringify(fields),'utf8')>850000)throw fail('検索データが大きくなりました。複数ドキュメントへの分割が必要です。',413);
   try{await req(base+'/documents:commit',{method:'POST',body:JSON.stringify({writes:[{update:{name:docName,fields},currentDocument:index?{updateTime:index.updateTime}:{exists:false}}]})});}
   catch(error){const latest=await read();if(latest)return latest;throw error;}
   return {users,updatedAt:new Date(now()).toISOString()};
  })().finally(()=>{building=null;});
  return building;
 }
 async function sync(uid,change={}){
  if(!/^[A-Za-z0-9_-]{1,128}$/.test(uid))return;
  for(let attempt=0;attempt<4;attempt++){
   const index=await read();
   if(!index)return;
   const profile=await req(base+'/documents/users/'+encodeURIComponent(uid)+'/apps/english-playroom?mask.fieldPaths=nickname&mask.fieldPaths=petName');
   const fields=decodeFields(profile?.fields||{});
   const users=index.users.filter(item=>item.uid!==uid);
   const old=index.users.find(item=>item.uid===uid)||{uid,codeName:'',loginId:'',nickname:'',petName:''};
   const newRow={uid,codeName:String(change.codeName??old.codeName??''),loginId:String(change.loginId??old.loginId??''),
    nickname:String(fields.nickname||''),petName:String(fields.petName||'')};
   if(index.users.some(item=>item.uid===uid&&JSON.stringify(item)===JSON.stringify(newRow)))return;
   users.push(newRow);
   users.sort((a,b)=>a.uid.localeCompare(b.uid));
   const encoded=encodeFields({version:1,updatedAt:new Date(now()).toISOString(),users});
   if(Buffer.byteLength(JSON.stringify(encoded),'utf8')>850000)return;
   try{
    await req(base+'/documents:commit',{method:'POST',body:JSON.stringify({writes:[{update:{name:docName,fields:encoded},currentDocument:{updateTime:index.updateTime}}]})});
    return;
   }catch(error){if(attempt===3)throw error;}
  }
 }
 async function lookup(reqHttp,res){
  try{
   if(reqHttp.method!=='GET')throw fail('GETのみ対応しています。',405);
   await verifyAdmin(reqHttp);
   const uid=new URL(reqHttp.url,'http://localhost').searchParams.get('uid')||'';
   if(!/^[A-Za-z0-9_-]{1,128}$/.test(uid))throw fail('ユーザーIDが不正です。',400);
   const raw=await req(base+'/documents/users/'+encodeURIComponent(uid)+'/apps/english-playroom?mask.fieldPaths=coins&mask.fieldPaths=nickname&mask.fieldPaths=petName');
   if(!raw)return send(res,200,{uid,coins:0,nickname:'',petName:''});
   const d=decodeFields(raw.fields||{});
   send(res,200,{uid,coins:Math.max(0,Math.floor(Number(d.coins)||0)),nickname:String(d.nickname||''),petName:String(d.petName||'')});
  }catch(error){send(res,error.status||500,{error:error.message||'利用者を確認できませんでした。'});}
 }
 async function get(reqHttp,res){
  try{
   if(reqHttp.method!=='GET')throw fail('GETのみ対応しています。',405);
   await verifyAdmin(reqHttp);
   const params=new URL(reqHttp.url,'http://localhost').searchParams;
   const value=params.get('refresh')==='1'?await build(true):(await read()||await build());
   send(res,200,{users:value.users,updatedAt:value.updatedAt,total:value.users.length});
  }catch(error){send(res,error.status||500,{error:error.message||'検索データを取得できませんでした。'});}
 }
 async function selfSync(reqHttp,res){
  try{
   if(reqHttp.method!=='POST')throw fail('POSTのみ対応しています。',405);
   const user=await verifyUser(reqHttp);
   const last=selfSyncAt.get(user.uid)||0;
   if(now()-last<30000)return send(res,200,{ok:true,skipped:true});
   selfSyncAt.set(user.uid,now());
   if(selfSyncAt.size>1000)selfSyncAt.delete(selfSyncAt.keys().next().value);
   await sync(user.uid);
   send(res,200,{ok:true});
  }catch(error){send(res,error.status||500,{error:error.message||'検索情報を更新できませんでした。'});}
 }
 async function searchGift(q,excludeUid){
  const name=String(q||'').normalize('NFKC').trim().toLocaleLowerCase('ja-JP');
  if(!name||[...name].length>12)return [];
  const index=await read()||await build();
  return index.users.filter(x=>x.uid!==excludeUid&&String(x.petName||'').normalize('NFKC').toLocaleLowerCase('ja-JP').includes(name)&&x.nickname)
    .slice(0,10).map(x=>({uid:x.uid,petName:x.petName,nickname:x.nickname}));
 }
 return {get,lookup,selfSync,sync,build,searchGift};
}
