export function createAdminMessagePages({base,projectId,accessToken,encodeFields,decodeFields,getProfiles=async()=>new Map(),fetchImpl=fetch,now=Date.now}){
 const prefix='projects/'+projectId+'/databases/(default)/documents/admin_message_pages/';
 const collection=base+'/documents/admin_message_pages/';
 let bootstrapPromise=null;
 const error=(message,status=502)=>Object.assign(new Error(message),{status});
 async function request(url,options={}){
  const token=await accessToken();
  const response=await fetchImpl(url,{...options,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'}});
  if(response.status===404)return null;
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw error('メッセージの集約データを処理できませんでした。',response.status);
  return data;
 }
 async function get(id){
  const document=await request(collection+encodeURIComponent(id));
  if(!document)return null;
  return {value:decodeFields(document.fields||{}),updateTime:document.updateTime};
 }
 function record(id,value,precondition=null){
  const write={update:{name:prefix+id,fields:encodeFields({version:1,...value})}};
  if(precondition)write.currentDocument=precondition;
  return write;
 }
 async function commit(writes){return request(base+'/documents:commit',{method:'POST',body:JSON.stringify({writes})});}
 async function getHistorical(){
  const pages=[];let token='';
  do{
   const url=new URL(base+'/documents/developerMessages');
   url.searchParams.set('pageSize','50');url.searchParams.set('orderBy','createdAt desc');
   if(token)url.searchParams.set('pageToken',token);
   const result=await request(url.toString());
   const batch=(result?.documents||[]).map(doc=>({
    id:String(doc.name||'').split('/').pop(),...decodeFields(doc.fields||{})
   }));
   if(batch.length){
    const senders=await getProfiles(batch.map(m=>m.uid));
    pages.push(batch.map(m=>({...m,sender:senders.get(m.uid)||null})));
   }
   token=result?.nextPageToken||'';
  }while(token);
  return pages.length?pages:[[]];
 }
 async function bootstrap(){
  if(bootstrapPromise)return bootstrapPromise;
  bootstrapPromise=(async()=>{
   const old=await get('current');
   if(old)return old;
   const pages=await getHistorical();
   // Archive pages are immutable, ordered from newest to oldest.
   const archives=[];
   for(let i=1;i<pages.length;i++){
    const id='arch_'+String(i).padStart(6,'0');
    archives.push(record(id,{messages:pages[i],next:i+1<pages.length?'arch_'+String(i+1).padStart(6,'0'):''}));
   }
   for(let i=0;i<archives.length;i+=50)await commit(archives.slice(i,i+50));
   const first={messages:pages[0],next:pages.length>1?'arch_000001':'',updatedAt:new Date(now()).toISOString()};
   try{await commit([record('current',first,{exists:false})]);}
   catch(e){const latest=await get('current');if(latest)return latest;throw e;}
   return {value:first};
  })().finally(()=>{bootstrapPromise=null;});
  return bootstrapPromise;
 }
 async function list(token=''){
  const id=token||'current';
  if(id!=='current'&&!/^arch_[A-Za-z0-9_-]{1,80}$/.test(id))throw error('ページ情報が不正です。',400);
  const row=await get(id)||(id==='current'?await bootstrap():null);
  if(!row)throw error('過去のメッセージが見つかりません。',404);
  return {messages:Array.isArray(row.value.messages)?row.value.messages:[],nextPageToken:row.value.next||null};
 }
 async function append(message){
  // The original individual message is always saved first. If the display cache
  // hasn't been initialized yet, its first admin request imports all originals.
  for(let attempt=0;attempt<5;attempt++){
   const current=await get('current');
   if(!current)return;
   const head=Array.isArray(current.value.messages)?current.value.messages:[];
   if(head.some(row=>row.id===message.id))return;
   const sender=(await getProfiles([message.uid])).get(message.uid)||null;
   const item={...message,sender};
   const full=head.length>=50;
   const id='arch_'+String(now())+'_'+message.id.replace(/[^A-Za-z0-9_-]/g,'').slice(0,40);
   const next=full?id:current.value.next||'';
   const currentValue={messages:full?[item]:[item,...head],next,updatedAt:new Date(now()).toISOString()};
   const writes=full?[record(id,{messages:head,next:current.value.next||''},{exists:false})]:[];
   writes.push(record('current',currentValue,{updateTime:current.updateTime}));
   try{await commit(writes);return;}
   catch(e){if(attempt===4)throw e;}
  }
 }
 return {list,append};
}
