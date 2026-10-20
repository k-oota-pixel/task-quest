const RANKING_CACHE_TTL_MS=5*60*1000;
const RANKING_ERROR_CACHE_TTL_MS=30*1000;

export async function readDailyCoinBoard({
  uid,access,today,getUserDoc,queryDailyCoinWallets,decodeFields,earnedCoinsToday,validPetName,
  rankingCache=null,forceRankingRefresh=false,
  log=(...args)=>console.error(...args)
}){
  const mine=await getUserDoc(access,uid);
  const coinsToday=earnedCoinsToday(mine,today);
  let ranking;
  if(rankingCache&&!forceRankingRefresh&&rankingCache.today===today&&rankingCache.expiresAt>Date.now()){
    ranking=rankingCache.result;
  }else if(rankingCache?.pending?.today===today){
    ranking=await rankingCache.pending.promise;
  }else{
    const promise=(async()=>{
      try{
        const documents=await queryDailyCoinWallets(access,today);
        const ranked=documents.filter(document=>document.name.endsWith('/apps/english-playroom')).map(document=>{
          const data=decodeFields(document.fields||{}),entryUid=document.name.split('/documents/')[1]?.split('/')[1]||'';
          return {uid:entryUid,petName:String(data.petName??'').normalize('NFKC').trim(),coinsToday:earnedCoinsToday(data,today)};
        }).filter(entry=>entry.uid&&entry.coinsToday>0&&validPetName(entry.petName));
        ranked.sort((a,b)=>b.coinsToday-a.coinsToday||a.petName.localeCompare(b.petName,'ja'));
        return {top3:ranked.slice(0,3).map(({petName,coinsToday:count})=>({petName,coinsToday:count})),rankingAvailable:true};
      }catch(error){
        log('Daily coin leaderboard ranking query failed',{status:error?.status||500,message:error?.message||'unknown'});
        return {top3:[],rankingAvailable:false};
      }
    })();
    if(rankingCache)rankingCache.pending={today,promise};
    ranking=await promise;
    if(rankingCache&&rankingCache.pending?.promise===promise){
      rankingCache.pending=null;
      rankingCache.today=today;
      rankingCache.result=ranking;
      rankingCache.expiresAt=Date.now()+(ranking.rankingAvailable?RANKING_CACHE_TTL_MS:RANKING_ERROR_CACHE_TTL_MS);
    }
  }
  return {today,coinsToday,...ranking};
}
