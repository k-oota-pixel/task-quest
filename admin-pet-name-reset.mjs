export function createAdminPetNameReset({base,projectId,verifyAdmin,accessToken,readJson,send,fail,invalidate=()=>{},fetchImpl=fetch}){
 return async function handle(req,res){
  try{
   const admin=await verifyAdmin(req);
   if(req.method!=='POST')throw fail('POSTのみ対応しています。',405);
   if(!req.headers['content-type']?.startsWith('application/json'))throw fail('JSONで送信してください。',415);
   const body=await readJson(req,1024),uid=body.uid;
   if(typeof uid!=='string'||!uid||uid.length>128||!/^[-A-Za-z0-9_]+$/.test(uid))throw fail('ユーザーIDが不正です。',400);
   const token=await accessToken(),headers={Authorization:'Bearer '+token,'Content-Type':'application/json'},path='users/'+uid+'/apps/english-playroom';
   for(let attempt=0;attempt<3;attempt++){
    const response=await fetchImpl(base+'/documents/'+path,{headers});
    if(response.status===404)throw fail('ペットの情報が見つかりません。',404);
    if(!response.ok)throw fail('ペットの情報を取得できませんでした。',502);
    const doc=await response.json(),fields=doc.fields||{};
    if(!fields.petHatched?.booleanValue)throw fail('ペットが誕生してからリセットできます。',400);
    const generation=Math.max(1,Math.floor(Number(fields.petGeneration?.integerValue)||1));
    const writes=[{update:{name:'projects/'+projectId+'/databases/(default)/documents/'+path,fields:{petName:{nullValue:null},petNameResetGeneration:{integerValue:String(generation)}}},updateMask:{fieldPaths:['petName','petNameResetGeneration']},currentDocument:{updateTime:doc.updateTime},updateTransforms:[{fieldPath:'petNameResetAt',setToServerValue:'REQUEST_TIME'},{fieldPath:'petUpdatedAt',setToServerValue:'REQUEST_TIME'}]}];
    const saved=await fetchImpl(base+'/documents:commit',{method:'POST',headers,body:JSON.stringify({writes})});
    if(saved.ok){invalidate(uid);console.log('Admin pet name reset: uid='+uid+' by='+admin.uid);send(res,200,{ok:true});return;}
    const error=await saved.json().catch(()=>({}));
    if(saved.status===409||['FAILED_PRECONDITION','ABORTED'].includes(error.error?.status))continue;
    throw fail('ペット名をリセットできませんでした。',502);
   }
   throw fail('情報が更新されました。もう一度お試しください。',409);
  }catch(error){send(res,error.status||500,{error:error.message||'ペット名をリセットできませんでした。'});}
 };
}
