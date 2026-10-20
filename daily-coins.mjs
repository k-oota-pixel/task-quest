const RANKING_CACHE_TTL_MS=5*60*1000;
const RANKING_ERROR_CACHE_TTL_MS=30*1000;

const cleanEntry=value=>{
  if(!value||typeof value.uid!=='string'||!value.uid)return null;
  const petName=String(value.petName??'').normalize('NFKC').trim();
  const coinsToday=Math.max(0,Math.floor(Number(value.coinsToday)||0));
  return coinsToday>0&&petName&&[...petName].length<=12&&!/[\u0000-\u001f\u007f]/.test(petName)?{uid:value.uid,petName,coinsToday}:null;
};
const compareEntries=(a,b)=>b.coinsToday-a.coinsToday||a.petName.localeCompare(b.petName,'ja')||a.uid.localeCompare(b.uid);
const cleanLeaders=leaders=>Array.isArray(leaders)?leaders.map(cleanEntry).filter(Boolean).sort(compareEntries).slice(0,3):[];
const emptyBoard=today=>({schemaVersion:1,today,leaders:[]});
const boardFor=(value,today)=>value?.today===today?{schemaVersion:1,today,leaders:cleanLeaders(value.leaders)}:emptyBoard(today);
const publicTop3=leaders=>leaders.map(({petName,coinsToday})=>({petName,coinsToday}));

function uidFromDocumentName(name){
  const match=String(name||'').match(/\/documents\/users\/([^/]+)\/apps\/english-playroom$/);
  if(!match)return '';
  try{return decodeURIComponent(match[1]);}catch{return match[1];}
}
function rankWalletDocuments(documents,{today,decodeFields,earnedCoinsToday,validPetName}){
  const entries=[];
  for(const document of documents||[]){
    const uid=uidFromDocumentName(document?.name);
    if(!uid)continue;
    const data=decodeFields(document.fields||{}),petName=String(data.petName??'').normalize('NFKC').trim();
    const coinsToday=Math.max(0,Math.floor(Number(earnedCoinsToday(data,today))||0));
    if(coinsToday>0&&validPetName(petName))entries.push({uid,petName,coinsToday});
  }
  return cleanLeaders(entries);
}
function mergeCandidate(leaders,candidate){
  const current=cleanLeaders(leaders),previous=current.find(entry=>entry.uid===candidate.uid);
  const entry={...candidate,coinsToday:Math.max(candidate.coinsToday,previous?.coinsToday||0)};
  const next=current.filter(value=>value.uid!==candidate.uid);
  next.push(entry);
  return cleanLeaders(next);
}
const sameLeaders=(a,b)=>JSON.stringify(cleanLeaders(a))===JSON.stringify(cleanLeaders(b));
function rememberViewer(cache,uid,today,leaders){
  if(!cache)return;
  if(!(cache.viewerSnapshots instanceof Map))cache.viewerSnapshots=new Map();
  if(cache.viewerSnapshotsDay!==today){cache.viewerSnapshots.clear();cache.viewerSnapshotsDay=today;}
  cache.viewerSnapshots.set(uid,{today,leaders:cleanLeaders(leaders)});
  while(cache.viewerSnapshots.size>10000)cache.viewerSnapshots.delete(cache.viewerSnapshots.keys().next().value);
}
function loadOrBootstrap(options){
  const {access,today,readSummary,writeSummary,queryDailyCoinWallets,decodeFields,earnedCoinsToday,validPetName,rankingCache}=options;
  if(rankingCache?.bootstrapPending?.today===today)return rankingCache.bootstrapPending.promise;
  const promise=Promise.resolve().then(async()=>{
    const stored=await readSummary(access);
    if(stored)return stored;
    const leaders=rankWalletDocuments(await queryDailyCoinWallets(access,today),{today,decodeFields,earnedCoinsToday,validPetName});
    const value={...emptyBoard(today),leaders};
    try{return await writeSummary(access,value,'');}
    catch(error){
      if(!error?.retryable)throw error;
      const raced=await readSummary(access);
      if(raced)return raced;
      throw error;
    }
  });
  if(rankingCache)rankingCache.bootstrapPending={today,promise};
  return promise.finally(()=>{if(rankingCache?.bootstrapPending?.promise===promise)rankingCache.bootstrapPending=null;});
}
async function commitCandidate({access,today,candidate,stored,readSummary,writeSummary,bootstrap}){
  let current=stored;
  for(let attempt=0;attempt<3;attempt++){
    if(!current)current=await bootstrap();
    const board=boardFor(current.value,today),leaders=mergeCandidate(board.leaders,candidate),next={...board,leaders};
    if(sameLeaders(board.leaders,leaders))return {stored:current,leaders:board.leaders,changed:false};
    try{
      const written=await writeSummary(access,next,current.updateTime||'');
      return {stored:written,leaders,changed:true};
    }catch(error){
      if(!error?.retryable||attempt===2)throw error;
      current=await readSummary(access);
    }
  }
  throw new Error('daily leaderboard update retry limit reached');
}

/*
 * When a summary document is absent, this compatibility path performs a one-time
 * bootstrap scan. Once written, normal page views read only the single summary doc.
 */
export async function readDailyCoinBoard({
  uid,access,today,getUserDoc,queryDailyCoinWallets,decodeFields,earnedCoinsToday,validPetName,
  readSummary,writeSummary,rankingCache=null,forceRankingRefresh=false,
  log=(...args)=>console.error(...args)
}){
  const mine=await getUserDoc(access,uid);
  const coinsToday=earnedCoinsToday(mine,today);
  if(typeof readSummary!=='function'||typeof writeSummary!=='function'){
    let ranking;
    if(rankingCache&&!forceRankingRefresh&&rankingCache.today===today&&rankingCache.expiresAt>Date.now())ranking=rankingCache.result;
    else if(rankingCache?.pending?.today===today)ranking=await rankingCache.pending.promise;
    else{
      const promise=(async()=>{
        try{
          const documents=await queryDailyCoinWallets(access,today);
          const leaders=rankWalletDocuments(documents,{today,decodeFields,earnedCoinsToday,validPetName});
          return {top3:publicTop3(leaders),rankingAvailable:true};
        }catch(error){log('Daily coin leaderboard ranking query failed',{status:error?.status||500,message:error?.message||'unknown'});return {top3:[],rankingAvailable:false};}
      })();
      if(rankingCache)rankingCache.pending={today,promise};
      ranking=await promise;
      if(rankingCache&&rankingCache.pending?.promise===promise){rankingCache.pending=null;rankingCache.today=today;rankingCache.result=ranking;rankingCache.expiresAt=Date.now()+(ranking.rankingAvailable?RANKING_CACHE_TTL_MS:RANKING_ERROR_CACHE_TTL_MS);}
    }
    return {today,coinsToday,...ranking};
  }

  try{
    let stored=await loadOrBootstrap({access,today,readSummary,writeSummary,queryDailyCoinWallets,decodeFields,earnedCoinsToday,validPetName,rankingCache});
    let leaders=boardFor(stored.value,today).leaders;
    const candidate=cleanEntry({uid,petName:mine.petName,coinsToday});
    if(candidate){
      const next=mergeCandidate(leaders,candidate);
      if(!sameLeaders(leaders,next)){
        const result=await commitCandidate({access,today,candidate,stored,readSummary,writeSummary,
          bootstrap:()=>loadOrBootstrap({access,today,readSummary,writeSummary,queryDailyCoinWallets,decodeFields,earnedCoinsToday,validPetName,rankingCache})});
        stored=result.stored;leaders=result.leaders;
      }
    }
    rememberViewer(rankingCache,uid,today,leaders);
    return {today,coinsToday,top3:publicTop3(leaders),rankingAvailable:true};
  }catch(error){
    log('Daily coin leaderboard summary failed',{status:error?.status||500,message:error?.message||'unknown'});
    return {today,coinsToday,top3:[],rankingAvailable:false};
  }
}

/*
 * After a coin grant, compare the user's trusted Firestore total with the last
 * ranking snapshot served to that user. A non-contender needs no leaderboard read.
 */
export async function publishDailyCoinBoard({
  uid,access,today,getUserDoc,queryDailyCoinWallets,decodeFields,earnedCoinsToday,validPetName,
  readSummary,writeSummary,rankingCache=null
}){
  const data=await getUserDoc(access,uid);
  const candidate=cleanEntry({uid,petName:data.petName,coinsToday:earnedCoinsToday(data,today)});
  if(!candidate)return {updated:false,top3:[]};

  const snapshot=rankingCache?.viewerSnapshots instanceof Map?rankingCache.viewerSnapshots.get(uid):null;
  if(snapshot?.today===today&&sameLeaders(mergeCandidate(snapshot.leaders,candidate),snapshot.leaders)){
    return {updated:false,top3:publicTop3(snapshot.leaders)};
  }

  let stored=await loadOrBootstrap({access,today,readSummary,writeSummary,queryDailyCoinWallets,decodeFields,earnedCoinsToday,validPetName,rankingCache});
  const current=boardFor(stored.value,today);
  let leaders=current.leaders;
  const next=mergeCandidate(leaders,candidate);
  let updated=false;
  if(!sameLeaders(leaders,next)){
    const result=await commitCandidate({access,today,candidate,stored,readSummary,writeSummary,
      bootstrap:()=>loadOrBootstrap({access,today,readSummary,writeSummary,queryDailyCoinWallets,decodeFields,earnedCoinsToday,validPetName,rankingCache})});
    stored=result.stored;leaders=result.leaders;updated=result.changed;
  }
  rememberViewer(rankingCache,uid,today,leaders);
  return {updated,top3:publicTop3(leaders)};
}
