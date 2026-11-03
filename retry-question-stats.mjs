export function createRetryQuestionStats({base,accessToken,verifyAdmin,decodeFields,send,fail,fetch:request=fetch}){
  const allowedGrades=new Set(['4級','3級','準2級','2級','準1級']);
  const allowedLimits=new Set([10,20,30,50,100]);
  return async(req,res)=>{try{
    if(req.method!=='GET')throw fail('GETのみ対応しています。',405);
    await verifyAdmin(req);
    const url=new URL(req.url,'http://localhost'),grade=String(url.searchParams.get('grade')||'準2級');
    if(!allowedGrades.has(grade))throw fail('級を確認してください。',400);
    const requested=Number(url.searchParams.get('limit')||20),limit=allowedLimits.has(requested)?requested:20;
    const token=await accessToken();
    const response=await request(base+'/documents/analytics/retry-question-first-v1',{headers:{Authorization:'Bearer '+token}});
    if(response.status===404)return send(res,200,{grade,limit,total:0,rows:[],updatedAt:''});
    let raw={};try{raw=await response.json();}catch{}
    if(!response.ok)throw fail('リトライ難問ランキングを取得できませんでした。',502);
    const data=decodeFields(raw.fields||{}),items=data.items&&typeof data.items==='object'?data.items:{};
    const all=Object.values(items).filter(item=>item&&item.grade===grade&&Number(item.attempts)>0).map(item=>{
      const attempts=Math.max(0,Math.floor(Number(item.attempts)||0)),correct=Math.max(0,Math.min(attempts,Math.floor(Number(item.correct)||0)));
      return {id:String(item.id||''),attempts,correct,accuracy:attempts?Math.round(correct/attempts*1000)/10:0};
    }).filter(row=>row.id).sort((a,b)=>a.accuracy-b.accuracy||b.attempts-a.attempts||a.id.localeCompare(b.id,'ja'));
    return send(res,200,{grade,limit,total:all.length,rows:all.slice(0,limit),updatedAt:data.updatedAt||raw.updateTime||''});
  }catch(error){send(res,error.status||500,{error:error.message||'リトライ難問ランキングを取得できませんでした。'});}};
}
