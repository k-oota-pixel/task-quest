// One small summary write per completed learning action; no background heartbeat.
const CONTENT_IDS=new Set(['word-breaker','ateru','basic-quest','eiken-retry','task-quest','eiken-cloze','eiken-title','listening-training','pre2-interview-questions','eiken-pre2-interview-a','talk-quest','pet-catch']);
export function createLearningActivity({base,projectId,accessToken,verifyUser,send,fail,readJson,invalidate,fetch:request=fetch}){
 const verifiedTokens=new Map();
 async function verified(req){
  const key=String(req.headers?.authorization||''),entry=verifiedTokens.get(key);
  if(key&&entry&&entry.until>Date.now())return entry.promise;
  const promise=verifyUser(req);if(key){if(verifiedTokens.size>=2000)verifiedTokens.delete(verifiedTokens.keys().next().value);verifiedTokens.set(key,{until:Date.now()+60000,promise});promise.catch(()=>verifiedTokens.delete(key));}return promise;
 }
 return async function handle(req,res){try{
  if(req.method!=='POST')throw fail('POSTのみ対応しています。',405);
  const user=await verified(req);
  const body=req.headers?.['content-type']?.startsWith('application/json')?await readJson(req,1024):{};
  const appId=body.appId;if(appId!==undefined&&!CONTENT_IDS.has(appId))throw fail('教材が不正です。',400);
  const token=await accessToken(),transforms=[{fieldPath:'lastLearningAt',setToServerValue:'REQUEST_TIME'}];
  if(appId)transforms.push({fieldPath:'contents.`'+appId+'`.lastLearningAt',setToServerValue:'REQUEST_TIME'});
  const response=await request(base+'/documents:commit',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({writes:[{update:{name:`projects/${projectId}/databases/(default)/documents/learning_activity/${user.uid}`,fields:{uid:{stringValue:user.uid}}},updateMask:{fieldPaths:['uid']},updateTransforms:transforms}]})});
  if(!response.ok)throw fail('学習日時を保存できませんでした。',502);
  invalidate(user.uid);send(res,200,{ok:true});
 }catch(error){send(res,error.status||500,{error:error.message||'学習日時を保存できませんでした。'});}};
}
