const APP_IDS=['english-playroom','ateru','basic-quest','eiken-retry','eiken-cloze','eiken-title','task-quest','eiken-pre2-interview-a'];
export function createAdminData({base,projectId,accessToken,verifyAdmin,send,fail,decodeFields,normalizeNickname,validNickname,fetch:request=globalThis.fetch,now=Date.now}){
  const cache=new Map(),TTL=60000;
  async function cached(key,read){
    const previous=cache.get(key);if(previous&&previous.until>now())return previous.promise;
    if(cache.size>=200)cache.delete(cache.keys().next().value);
    const entry={until:now()+TTL};cache.set(key,entry);
    entry.promise=read().then(value=>{entry.value=value;return value;}).catch(error=>{entry.until=now()+5000;throw error;});
    return entry.promise;
  }
  async function json(url,options={}){
    const token=await accessToken();const response=await request(url,{...options,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'}});
    const body=await response.json();
    if(!response.ok)throw fail(body?.error?.status==='RESOURCE_EXHAUSTED'?'Firestoreの利用上限に達しています。時間を置いてから更新してください。':'管理情報を取得できませんでした。',response.status===429?429:502);
    return body;
  }
  async function summary(uid){
    const url=new URL(`${base}/documents/users/${encodeURIComponent(uid)}/apps/english-playroom`);
    for(const field of ['nickname','coins'])url.searchParams.append('mask.fieldPaths',field);
    const token=await accessToken();const r=await request(url,{headers:{Authorization:`Bearer ${token}`}});
    if(r.status===404)return {};
    const d=await r.json();if(!r.ok)throw fail(d?.error?.status==='RESOURCE_EXHAUSTED'?'Firestoreの利用上限に達しています。時間を置いてから更新してください。':'一覧情報を取得できませんでした。',r.status===429?429:502);
    return decodeFields(d.fields||{});
  }
  async function authDirectory(){
    return cached('auth:recent',async()=>{
      const users=[];let token='';
      do{
        const url=new URL(`https://identitytoolkit.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/accounts:batchGet`);
        url.searchParams.set('maxResults','1000');if(token)url.searchParams.set('nextPageToken',token);
        const auth=await json(url);users.push(...(auth.users||[]));token=auth.nextPageToken||'';
      }while(token);
      users.sort((a,b)=>Number(b.lastLoginAt||0)-Number(a.lastLoginAt||0)||Number(b.createdAt||0)-Number(a.createdAt||0)||String(a.localId||'').localeCompare(String(b.localId||'')));
      return users;
    });
  }
  function pageOffset(token){
    if(!token)return 0;
    if(!/^\d+$/.test(token))throw fail('ページ情報が不正です。',400);
    const offset=Number(token);if(!Number.isSafeInteger(offset)||offset<0||offset%10!==0)throw fail('ページ情報が不正です。',400);
    return offset;
  }
  async function page(token){
    const offset=pageOffset(token);
    return cached('page:'+offset,async()=>{
      const directory=await authDirectory(),slice=directory.slice(offset,offset+10);
      const users=await Promise.all(slice.map(async u=>{
        const p=await summary(u.localId),nickname=normalizeNickname(p.nickname);
        return {uid:u.localId,nickname:nickname||'ニックネーム未登録',hasNickname:validNickname(nickname),coins:Math.max(0,Math.floor(Number(p.coins)||0)),createdAt:u.createdAt||null,lastLoginAt:u.lastLoginAt||null,disabled:!!u.disabled};
      }));
      return {users,nextPageToken:offset+10<directory.length?String(offset+10):null,pageSize:10,fetchedAt:now()};
    });
  }
  async function detail(uid){
    return cached('detail:'+uid,async()=>{
      const prefix=`projects/${projectId}/databases/(default)/documents/users/${uid}/apps/`;
      const rows=await json(`${base}/documents:batchGet`,{method:'POST',body:JSON.stringify({documents:APP_IDS.map(id=>prefix+id)})});
      const apps={};for(const row of rows){const doc=row.found;if(!doc?.name?.startsWith(prefix))continue;const id=doc.name.slice(prefix.length);if(APP_IDS.includes(id))apps[id]=decodeFields(doc.fields||{});}
      return {uid,apps,fetchedAt:now()};
    });
  }
  async function handle(req,res){
    try{
      if(req.method!=='GET')throw fail('GETのみ対応しています。',405);
      await verifyAdmin(req); // Cache never bypasses authentication or authorization.
      const url=new URL(req.url,'http://localhost');
      if(url.pathname==='/api/admin/session'){send(res,200,{admin:true,apiVersion:'1.5.8'});return;}
      if(url.pathname==='/api/admin/user'){
        const uid=url.searchParams.get('uid')||'';if(!uid||uid.length>128||/[\/\u0000-\u001f]/.test(uid))throw fail('ユーザーIDが不正です。',400);
        send(res,200,await detail(uid));return;
      }
      const token=url.searchParams.get('pageToken')||'';
      if(token.length>4096||url.searchParams.has('limit')&&url.searchParams.get('limit')!=='10')throw fail('一覧は10人ずつ取得してください。',400);
      send(res,200,await page(token));
    }catch(error){send(res,error.status||500,{error:error.message||'管理情報を取得できませんでした。'});}
  }
  function updateCoins(uid,coins){
    for(const e of cache.values()){
      if(e.value?.users)for(const user of e.value.users)if(user.uid===uid)user.coins=coins;
      if(e.value?.uid===uid&&e.value.apps?.['english-playroom'])e.value.apps['english-playroom'].coins=coins;
    }
  }
  function invalidate(uid){cache.delete('detail:'+uid);for(const [key,e]of cache)if(key.startsWith('page:')&&(!e.value||e.value.users.some(u=>u.uid===uid)))cache.delete(key);}
  return {handle,updateCoins,invalidate};
}
