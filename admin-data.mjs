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
    return cached('summary:'+uid,async()=>{
      const url=new URL(`${base}/documents/users/${encodeURIComponent(uid)}/apps/english-playroom`);
      for(const field of ['nickname','petName','coins'])url.searchParams.append('mask.fieldPaths',field);
      const token=await accessToken();const r=await request(url,{headers:{Authorization:`Bearer ${token}`}});
      if(r.status===404)return {};
      const d=await r.json();if(!r.ok)throw fail(d?.error?.status==='RESOURCE_EXHAUSTED'?'Firestoreの利用上限に達しています。時間を置いてから更新してください。':'一覧情報を取得できませんでした。',r.status===429?429:502);
      return decodeFields(d.fields||{});
    });
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
  async function nicknameDirectory(){
    return cached('nicknames',async()=>{
      const rows=[];let token='';
      do{
        const url=new URL(`${base}/documents/nickname_registry`);
        url.searchParams.set('pageSize','1000');if(token)url.searchParams.set('pageToken',token);
        const body=await json(url);rows.push(...(body.documents||[]));token=body.nextPageToken||'';
      }while(token);
      return rows.map(doc=>decodeFields(doc.fields||{})).map(data=>({uid:String(data.uid||''),nickname:normalizeNickname(data.nickname)})).filter(row=>row.uid&&validNickname(row.nickname));
    });
  }
  function learningTime(value){const ms=typeof value==='number'?value:Date.parse(value||'');return Number.isFinite(ms)&&ms>0?ms:null;}
  function cursor(value){if(!value)return {phase:'recent'};try{const c=JSON.parse(Buffer.from(value,'base64url').toString());if(c.phase==='recent'&&typeof c.at==='string'&&typeof c.name==='string'&&c.name.startsWith('projects/'+projectId+'/databases/(default)/documents/learning_activity/'))return c;if(c.phase==='unrecorded'&&Number.isSafeInteger(c.offset)&&c.offset>=0)return c;}catch{}throw fail('ページ情報が不正です。',400);}
  const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
  async function activity(uid){return cached('activity:'+uid,async()=>{const token=await accessToken(),r=await request(base+'/documents/learning_activity/'+encodeURIComponent(uid),{headers:{Authorization:'Bearer '+token}});if(r.status===404)return null;const body=await r.json();if(!r.ok)throw fail('学習日時を取得できませんでした。',502);return learningTime(decodeFields(body.fields||{}).lastLearningAt);});}
  async function unrecorded(){return cached('unrecorded',async()=>{
    const rows=await json(base+'/documents:runQuery',{method:'POST',body:JSON.stringify({structuredQuery:{from:[{collectionId:'learning_activity'}],select:{fields:[{fieldPath:'uid'}]}}})});
    const known=new Set(rows.filter(r=>r.document).map(r=>decodeFields(r.document.fields||{}).uid));
    return (await authDirectory()).filter(u=>!known.has(u.localId)).sort((a,b)=>String(a.localId).localeCompare(String(b.localId)));
  });}
  async function page(token){return cached('page:'+token,async()=>{
    const c=cursor(token);let rows=[],nextPageToken=null;
    if(c.phase==='recent'){
      const query={from:[{collectionId:'learning_activity'}],orderBy:[{field:{fieldPath:'lastLearningAt'},direction:'DESCENDING'},{field:{fieldPath:'__name__'},direction:'DESCENDING'}],limit:11};
      if(c.at)query.startAt={values:[{timestampValue:c.at},{referenceValue:c.name}],before:false};
      const result=await json(base+'/documents:runQuery',{method:'POST',body:JSON.stringify({structuredQuery:query})});
      const documents=result.filter(r=>r.document).map(r=>r.document),more=documents.length>10;
      rows=documents.slice(0,10).map(doc=>{const d=decodeFields(doc.fields||{});return {uid:d.uid,lastLearningAt:learningTime(d.lastLearningAt)};});
      if(more){const last=documents[9];nextPageToken=encode({phase:'recent',at:decodeFields(last.fields).lastLearningAt,name:last.name});}
      else {const waiting=await unrecorded(),room=10-rows.length;rows.push(...waiting.slice(0,room).map(u=>({uid:u.localId,lastLearningAt:null,createdAt:u.createdAt||null})));if(waiting.length>room)nextPageToken=encode({phase:'unrecorded',offset:room});}
    }else{const waiting=await unrecorded();rows=waiting.slice(c.offset,c.offset+10).map(u=>({uid:u.localId,lastLearningAt:null,createdAt:u.createdAt||null}));if(waiting.length>c.offset+10)nextPageToken=encode({phase:'unrecorded',offset:c.offset+10});}
    const users=await Promise.all(rows.map(async row=>{const p=await summary(row.uid),nickname=normalizeNickname(p.nickname);return {...row,nickname:nickname||'ニックネーム未登録',hasNickname:validNickname(nickname),petName:normalizeNickname(p.petName)||'ペット名未設定',coins:Math.max(0,Math.floor(Number(p.coins)||0))};}));
    return {users,nextPageToken,pageSize:10,fetchedAt:now()};
  });}
  async function search(query){
    const normalized=normalizeNickname(query),needle=normalized.toLocaleLowerCase('ja-JP');
    const length=[...normalized].length;if(!normalized||length>20)throw fail('検索語は1〜20文字で入力してください。',400);
    const [directory,nicknames]=await Promise.all([authDirectory(),nicknameDirectory()]);
    const authByUid=new Map(directory.map(user=>[String(user.localId||''),user]));
    const matches=nicknames.filter(row=>authByUid.has(row.uid)&&row.nickname.toLocaleLowerCase('ja-JP').includes(needle));
    matches.sort((a,b)=>{
      const ak=a.nickname.toLocaleLowerCase('ja-JP'),bk=b.nickname.toLocaleLowerCase('ja-JP');
      const aq=ak===needle?0:ak.startsWith(needle)?1:2,bq=bk===needle?0:bk.startsWith(needle)?1:2;
      if(aq!==bq)return aq-bq;
      const au=authByUid.get(a.uid)||{},bu=authByUid.get(b.uid)||{};
      return a.nickname.localeCompare(b.nickname,'ja-JP');
    });
    const selected=matches.slice(0,100);
    const users=await Promise.all(selected.map(async row=>{
      const u=authByUid.get(row.uid)||{},p=await summary(row.uid),nickname=normalizeNickname(p.nickname)||row.nickname;
      return {uid:row.uid,nickname,hasNickname:validNickname(nickname),coins:Math.max(0,Math.floor(Number(p.coins)||0)),petName:normalizeNickname(p.petName)||'ペット名未設定',createdAt:u.createdAt||null,lastLearningAt:await activity(row.uid),disabled:!!u.disabled};
    }));
    users.sort((a,b)=>(b.lastLearningAt||0)-(a.lastLearningAt||0)||a.nickname.localeCompare(b.nickname,'ja'));
    return {users,query:normalized,total:matches.length,truncated:matches.length>users.length,fetchedAt:now()};
  }
  async function detail(uid){
    return cached('detail:'+uid,async()=>{
      const prefix=`projects/${projectId}/databases/(default)/documents/users/${uid}/apps/`;
      const rows=await json(`${base}/documents:batchGet`,{method:'POST',body:JSON.stringify({documents:[...APP_IDS.map(id=>prefix+id),`projects/${projectId}/databases/(default)/documents/learning_activity/${uid}`]})});
      const apps={};for(const row of rows){const doc=row.found;if(!doc?.name?.startsWith(prefix))continue;const id=doc.name.slice(prefix.length);if(APP_IDS.includes(id))apps[id]=decodeFields(doc.fields||{});}
      const activityDoc=rows.find(row=>row.found?.name===`projects/${projectId}/databases/(default)/documents/learning_activity/${uid}`);
      return {uid,apps,activity:activityDoc?decodeFields(activityDoc.found.fields||{}):{},fetchedAt:now()};
    });
  }
  async function handle(req,res){
    try{
      if(req.method!=='GET')throw fail('GETのみ対応しています。',405);
      await verifyAdmin(req); // Cache never bypasses authentication or authorization.
      const url=new URL(req.url,'http://localhost');
      if(url.pathname==='/api/admin/session'){send(res,200,{admin:true,apiVersion:'1.5.9'});return;}
      if(url.pathname==='/api/admin/retry-screen-logs'){
        const ids=[...new Set((url.searchParams.get('uids')||'').split(',').filter(Boolean))];
        if(!ids.length||ids.length>10||ids.some(id=>id.length>128||!/^[-A-Za-z0-9_]+$/.test(id)))throw fail('対象は10人以内で指定してください。',400);
        const users=await Promise.all(ids.map(uid=>cached('retry-screen:'+uid,async()=>{
          const name=`projects/${projectId}/databases/(default)/documents/users/${uid}/apps/eiken-retry`;
          const rows=await json(base+'/documents:batchGet',{method:'POST',body:JSON.stringify({documents:[name],mask:{fieldPaths:['state.screenLogs']}})});
          const data=decodeFields(rows[0]?.found?.fields||{});
          return {uid,logs:Array.isArray(data.state?.screenLogs)?data.state.screenLogs.slice(-100):[]};
        })));
        send(res,200,{users,fetchedAt:now()});return;
      }
      if(url.pathname==='/api/admin/user'){

        const uid=url.searchParams.get('uid')||'';if(!uid||uid.length>128||/[\/\u0000-\u001f]/.test(uid))throw fail('ユーザーIDが不正です。',400);
        send(res,200,await detail(uid));return;
      }
      const query=url.searchParams.get('search')||'';
      if(query){send(res,200,await search(query));return;}
      const token=url.searchParams.get('pageToken')||'';
      if(token.length>4096||url.searchParams.has('limit')&&url.searchParams.get('limit')!=='10')throw fail('一覧は10人ずつ取得してください。',400);
      send(res,200,await page(token));
    }catch(error){send(res,error.status||500,{error:error.message||'管理情報を取得できませんでした。'});}
  }
  function updateCoins(uid,coins){
    for(const [key,e] of cache){
      if(e.value?.users)for(const user of e.value.users)if(user.uid===uid)user.coins=coins;
      if(e.value?.uid===uid&&e.value.apps?.['english-playroom'])e.value.apps['english-playroom'].coins=coins;
      if(key==='summary:'+uid&&e.value)e.value.coins=coins;
    }
  }
  function invalidate(uid){cache.delete('detail:'+uid);cache.delete('summary:'+uid);cache.delete('nicknames');cache.delete('activity:'+uid);cache.delete('unrecorded');for(const [key,e]of cache)if(key.startsWith('page:'))cache.delete(key);}
  async function activeIds(){return (await authDirectory()).filter(u=>!u.disabled&&typeof u.localId==='string'&&u.localId.length>0&&u.localId.length<=128&&!/[\/\u0000-\u001f]/.test(u.localId)).map(u=>u.localId);}
  function invalidateLearning(uid){cache.delete('activity:'+uid);cache.delete('summary:'+uid);cache.delete('unrecorded');for(const key of cache.keys())if(key.startsWith('page:'))cache.delete(key);}
  return {handle,updateCoins,invalidate,invalidateLearning,activeIds};
}
