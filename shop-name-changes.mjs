export const RENAME_PRICE=30;
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
export function normalizeShopName(kind,value){
  if(typeof value!=='string'||/[\u0000-\u001f\u007f]/.test(value))throw fail('名前を正しく入力してください。');
  const name=kind==='user'?value.normalize('NFKC').trim().replace(/\s+/g,' '):value.trim();
  const limit=kind==='pet'?12:20;
  if(!['pet','user'].includes(kind)||![...name].length||[...name].length>limit)throw fail(`名前は1〜${limit}文字で入力してください。`);
  return name;
}
export function createShopNameChanges({base,projectId,fetchImpl=fetch}){
  const prefix=`projects/${projectId}/databases/(default)/documents/`;
  return async function rename(token,uid,kind,value){
    const name=normalizeShopName(kind,value),field=kind==='pet'?'petName':'nickname';
    const headers={Authorization:`Bearer ${token}`,'Content-Type':'application/json'};
    async function read(path){const r=await fetchImpl(`${base}/documents/${path}`,{headers});if(r.status===404)return null;if(!r.ok)throw fail('名前の情報を取得できませんでした。',502);return r.json();}
    for(let attempt=0;attempt<3;attempt++){
      const path=`users/${uid}/apps/english-playroom`,doc=await read(path),f=doc?.fields||{};
      if(!f.petHatched?.booleanValue)throw fail('ペットが誕生してから使えます。');
      if(f[field]?.stringValue===name)throw fail('今と同じ名前です。');
      const coins=Math.max(0,Math.floor(Number(f.coins?.integerValue??f.coins?.doubleValue)||0));
      if(coins<RENAME_PRICE)throw fail('コインが足りません。');
      const fields={coins:{integerValue:String(coins-RENAME_PRICE)},[field]:{stringValue:name}};
      const writes=[];
      if(kind==='user'){
        const key=name.toLocaleLowerCase('ja-JP'),oldName=f.nickname?.stringValue||'',oldKey=oldName.normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('ja-JP');
        const registryPath=key=>`nickname_registry/${Buffer.from(key,'utf8').toString('base64url')}`;
        const target=await read(registryPath(key));
        if(target&&target.fields?.uid?.stringValue!==uid)throw fail('そのニックネームはすでに使われています。別の名前を入力してください。',409);
        writes.push({update:{name:prefix+registryPath(key),fields:{uid:{stringValue:uid},nickname:{stringValue:name}}},currentDocument:target?{updateTime:target.updateTime}:{exists:false}});
        if(oldKey&&oldKey!==key){const previous=await read(registryPath(oldKey));if(previous?.fields?.uid?.stringValue===uid)writes.push({delete:prefix+registryPath(oldKey),currentDocument:{updateTime:previous.updateTime}});}
        fields.nicknameKey={stringValue:key};fields.nicknameSchemaVersion={integerValue:'1'};
      }
      writes.push({update:{name:prefix+path,fields},updateMask:{fieldPaths:Object.keys(fields)},currentDocument:{updateTime:doc.updateTime},updateTransforms:[{fieldPath:'coinUpdatedAt',setToServerValue:'REQUEST_TIME'},{fieldPath:kind==='pet'?'petUpdatedAt':'nicknameUpdatedAt',setToServerValue:'REQUEST_TIME'}]});
      const response=await fetchImpl(`${base}/documents:commit`,{method:'POST',headers,body:JSON.stringify({writes})});
      if(response.ok)return {name,coins:coins-RENAME_PRICE};
      const body=await response.json().catch(()=>({}));
      if(['FAILED_PRECONDITION','ABORTED','ALREADY_EXISTS'].includes(body.error?.status)||response.status===409)continue;
      throw fail('名前を変更できませんでした。',502);
    }
    throw fail('情報が更新されました。もう一度お試しください。',409);
  };
}
