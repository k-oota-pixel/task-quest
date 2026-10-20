export async function readDailyCoinBoard({
  uid,access,today,getUserDoc,queryDailyCoinWallets,decodeFields,earnedCoinsToday,validPetName,
  log=(...args)=>console.error(...args)
}){
  const mine=await getUserDoc(access,uid);
  const coinsToday=earnedCoinsToday(mine,today);
  let documents;
  try{
    documents=await queryDailyCoinWallets(access,today);
  }catch(error){
    log('Daily coin leaderboard ranking query failed',{status:error?.status||500,message:error?.message||'unknown'});
    return {today,coinsToday,top3:[],rankingAvailable:false};
  }
  const ranked=documents.filter(document=>document.name.endsWith('/apps/english-playroom')).map(document=>{
    const data=decodeFields(document.fields||{}),entryUid=document.name.split('/documents/')[1]?.split('/')[1]||'';
    return {uid:entryUid,petName:String(data.petName??'').normalize('NFKC').trim(),coinsToday:earnedCoinsToday(data,today)};
  }).filter(entry=>entry.uid&&entry.coinsToday>0&&validPetName(entry.petName));
  ranked.sort((a,b)=>b.coinsToday-a.coinsToday||a.petName.localeCompare(b.petName,'ja'));
  return {today,coinsToday,top3:ranked.slice(0,3).map(({petName,coinsToday:count})=>({petName,coinsToday:count})),rankingAvailable:true};
}
