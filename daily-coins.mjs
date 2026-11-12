import {publicRankingCache} from './public-ranking-cache.mjs';

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
const publicTop3=leaders=>leaders.map(({uid,petName,coinsToday})=>({uid,petName,coinsToday}));
// The title decorator omits uids for other leaderboards. Restore them only for
// the daily-coin board so a ranked pet can be opened without an extra lookup.
async function viewableTop3(leaders,decorate){
  const entries=decorate?await decorate(leaders):publicTop3(leaders);
  return entries.map((entry,index)=>({...entry,uid:leaders[index]?.uid||''}));
}

async function getPublicBoard(rankingStore,today){
  const value=await rankingStore.getSection('dailyCoins');
  return value?.today===today&&value.rankingAvailable===true&&Array.isArray(value.top3)&&
    value.top3.every(entry=>typeof entry.uid==='string'&&entry.uid.length>0)?value:null;
}
async function publicBoard(today,leaders,decorate,rankingStore,previous,refreshTitles=false){
  if(!refreshTitles&&previous&&sameLeaders(previous.top3,leaders))return previous;
  const known=new Map(refreshTitles?[]:(previous?.top3||[]).map(entry=>[entry.uid,entry.title]));
  const missing=leaders.filter(entry=>!known.has(entry.uid));
  if(decorate&&missing.length){
    for(const entry of await viewableTop3(missing,decorate))known.set(entry.uid,entry.title);
  }
  const top3=publicTop3(leaders).map(entry=>known.get(entry.uid)===undefined?entry:{...entry,title:known.get(entry.uid)});
  const result={today,top3,rankingAvailable:true,titlesCheckedAt:refreshTitles||!previous?Date.now():previous.titlesCheckedAt||0};
  await rankingStore.setSection('dailyCoins',result);
  return result;
}
function serializeRanking(cache,task){
  if(!cache)return task();
  const pending=(cache.updateChain||Promise.resolve()).then(task,task);
  cache.updateChain=pending.catch(()=>{});
  return pending;
}

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
function loadOrBootstrap(options){
  const {access,today,readSummary,writeSummary,queryDailyCoinWallets,decodeFields,earnedCoinsToday,validPetName,rankingCache}=options;
  if(rankingCache?.stored?.today===today)return Promise.resolve(rankingCache.stored.document);
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
  }).then(document=>{
    if(rankingCache)rankingCache.stored={today,document};
    return document;
  });
  if(rankingCache)rankingCache.bootstrapPending={today,promise};
  return promise.finally(()=>{if(rankingCache?.bootstrapPending?.promise===promise)rankingCache.bootstrapPending=null;});
}
async function commitCandidate({access,today,candidate,stored,readSummary,writeSummary,bootstrap,rankingCache}){
  let current=stored;
  for(let attempt=0;attempt<3;attempt++){
    if(!current)current=await bootstrap();
    const board=boardFor(current.value,today),leaders=mergeCandidate(board.leaders,candidate),next={...board,leaders};
    if(sameLeaders(board.leaders,leaders))return {stored:current,leaders:board.leaders,changed:false};
    try{
      const written=await writeSummary(access,next,current.updateTime||'',current.value);
      if(rankingCache)rankingCache.stored={today,document:written};
      return {stored:written,leaders,changed:true};
    }catch(error){
      if(!error?.retryable||attempt===2)throw error;
      current=await readSummary(access);
      if(rankingCache)rankingCache.stored=current?{today,document:current}:null;
    }
  }
  throw new Error('daily leaderboard update retry limit reached');
}

export async function readDailyCoinBoard({
  uid,access,today,getUserDoc,queryDailyCoinWallets,decodeFields,earnedCoinsToday,validPetName,
  readSummary,writeSummary,rankingCache=null,forceRankingRefresh=false,decorate=null,rankingStore=publicRankingCache,
  log=(...args)=>console.error(...args)
}){
  const mine=await getUserDoc(access,uid);
  const coinsToday=Math.max(0,Math.floor(Number(earnedCoinsToday(mine,today))||0));
  if(typeof readSummary!=='function'||typeof writeSummary!=='function'){
    let ranking;
    if(rankingCache&&!forceRankingRefresh&&rankingCache.today===today&&rankingCache.expiresAt>Date.now())ranking=rankingCache.result;
    else if(rankingCache?.pending?.today===today)ranking=await rankingCache.pending.promise;
    else{
      const promise=(async()=>{
        try{
          const documents=await queryDailyCoinWallets(access,today);
          const leaders=rankWalletDocuments(documents,{today,decodeFields,earnedCoinsToday,validPetName});
          return {top3:await viewableTop3(leaders,decorate),rankingAvailable:true};
        }catch(error){log('Daily coin leaderboard ranking query failed',{status:error?.status||500,message:error?.message||'unknown'});return {top3:[],rankingAvailable:false};}
      })();
      if(rankingCache)rankingCache.pending={today,promise};
      ranking=await promise;
      if(rankingCache&&rankingCache.pending?.promise===promise){rankingCache.pending=null;rankingCache.today=today;rankingCache.result=ranking;rankingCache.expiresAt=Date.now()+(ranking.rankingAvailable?RANKING_CACHE_TTL_MS:RANKING_ERROR_CACHE_TTL_MS);}
    }
    return {today,coinsToday,...ranking};
  }

  try{
    const ranking=await serializeRanking(rankingCache,async()=>{
      const shared=await getPublicBoard(rankingStore,today);
      if(shared){
        const stale=Date.now()-(shared.titlesCheckedAt||0)>=RANKING_CACHE_TTL_MS;
        if(forceRankingRefresh&&stale&&decorate)return publicBoard(today,shared.top3,decorate,rankingStore,shared,true);
        return shared;
      }
      const candidate=cleanEntry({uid,petName:mine.petName,coinsToday});
      const bootstrap=()=>loadOrBootstrap({access,today,readSummary,writeSummary,queryDailyCoinWallets,decodeFields,earnedCoinsToday,validPetName,rankingCache});
      const stored=await bootstrap();
      const leaders=candidate?(await commitCandidate({access,today,candidate,stored,readSummary,writeSummary,bootstrap,rankingCache})).leaders:boardFor(stored.value,today).leaders;
      return publicBoard(today,leaders,decorate,rankingStore,null);
    });
    return {today,coinsToday,top3:ranking.top3,rankingAvailable:true};
  }catch(error){
    log('Daily coin leaderboard summary failed',{status:error?.status||500,message:error?.message||'unknown'});
    return {today,coinsToday,top3:[],rankingAvailable:false};
  }
}

export async function publishDailyCoinBoard({
  uid,access,today,getUserDoc,queryDailyCoinWallets,decodeFields,earnedCoinsToday,validPetName,
  readSummary,writeSummary,rankingCache=null,decorate=null,rankingStore=publicRankingCache,walletData
}){
  // Only server settlement handlers supply walletData. Browser notifications
  // still read the saved wallet rather than accepting a claimed score.
  const data=walletData??await getUserDoc(access,uid);
  const candidate=cleanEntry({uid,petName:data.petName,coinsToday:earnedCoinsToday(data,today)});
  if(!candidate)return {updated:false,top3:[]};
  return serializeRanking(rankingCache,async()=>{
    const shared=await getPublicBoard(rankingStore,today);
    if(shared&&sameLeaders(mergeCandidate(shared.top3,candidate),shared.top3)){
      return {updated:false,top3:shared.top3};
    }
    const bootstrap=()=>loadOrBootstrap({access,today,readSummary,writeSummary,queryDailyCoinWallets,decodeFields,earnedCoinsToday,validPetName,rankingCache});
    const stored=await bootstrap();
    const {leaders,changed}=await commitCandidate({access,today,candidate,stored,readSummary,writeSummary,bootstrap,rankingCache});
    const ranking=await publicBoard(today,leaders,decorate,rankingStore,shared);
    return {updated:changed,top3:ranking.top3};
  });
}
