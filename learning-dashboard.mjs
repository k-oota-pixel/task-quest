// Read only the authenticated learner's records, on explicit dashboard requests.
export function createLearningDashboard({base,projectId,accessToken,verifyUser,decodeFields,send,fail,fetch:request=globalThis.fetch}){
 const ids=['english-playroom','ateru','basic-quest','eiken-retry','eiken-cloze','eiken-title','task-quest','eiken-pre2-interview-a','listening-training','pre2-interview-questions','talk-quest'];
 return async(req,res)=>{try{
  if(req.method!=='GET')throw fail('GETのみ対応しています。',405);
  const user=await verifyUser(req),prefix=`projects/${projectId}/databases/(default)/documents/`,appsPrefix=prefix+`users/${user.uid}/apps/`,activityPath=prefix+`learning_activity/${user.uid}`;
  const token=await accessToken();
  const response=await request(base+'/documents:batchGet',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({documents:[...ids.map(id=>appsPrefix+id),activityPath]})});
  if(!response.ok)throw fail('学習記録を取得できませんでした。もう一度お試しください。',502);
  const rows=await response.json(),apps={};let activity={};
  for(const row of rows){const d=row.found;if(!d)continue;
   if(d.name===activityPath)activity=decodeFields(d.fields||{});
   else if(d.name.startsWith(appsPrefix)&&ids.includes(d.name.slice(appsPrefix.length)))apps[d.name.slice(appsPrefix.length)]=decodeFields(d.fields||{});
  }
  res.setHeader?.('Cache-Control','no-store');send(res,200,{apps,activity,fetchedAt:Date.now()});
 }catch(error){send(res,error.status||500,{error:error.message||'学習記録を取得できませんでした。'});}};
}
