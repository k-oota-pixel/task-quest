const MODES={tower:'wordTowerBest',dungeon:'eikenDungeonBest'};
const floorOf=n=>Number.isSafeInteger(n)&&n>0&&n<=100000?n:0;
function petNameOf(value){const name=typeof value==='string'?value.normalize('NFKC').trim().replace(/\s+/g,' '):'';return name&&[...name].length<=12&&!/[\u0000-\u001f\u007f]/.test(name)?name:'名前未設定のペット';}
export function adventureLeaders(players,mode){
 const field=MODES[mode];if(!field)return [];
 const seen=new Set();return players.filter(p=>p.uid&&!seen.has(p.uid)&&seen.add(p.uid)&&floorOf(p[field])).map(p=>({uid:p.uid,petName:petNameOf(p.petName),floor:p[field]})).sort((a,b)=>b.floor-a.floor||a.uid.localeCompare(b.uid)).slice(0,10).map((p,i,rows)=>({...p,rank:rows.findIndex(r=>r.floor===p.floor)+1}));
}
export function createAdventureRankings({base,activeIds,accessToken,decodeFields,decorate,send,fail,fetch:request=globalThis.fetch,now=Date.now}){
 let cached=null,inflight=null,retryAfter=0;
 async function load(){
  if(cached&&now()-cached.fetchedAt<60000)return cached;
  if(inflight)return inflight;
  if(now()<retryAfter)throw fail('少し待ってから再表示してください。',503);
  inflight=(async()=>{
   const ids=[...new Set(await activeIds())],token=await accessToken(),players=[];
   for(let offset=0;offset<ids.length;offset+=200){
    const names=ids.slice(offset,offset+200).map(uid=>base.replace(/^https:\/\/firestore.googleapis.com\/v1\//,'')+'/documents/users/'+encodeURIComponent(uid)+'/apps/english-playroom');
    const response=await request(base+'/documents:batchGet',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},signal:AbortSignal.timeout(15000),body:JSON.stringify({documents:names,mask:{fieldPaths:['petName','wordTowerBest','eikenDungeonBest']}})});
    if(!response.ok)throw fail('ランキングを取得できませんでした。',503);
    const rows=await response.json();if(!Array.isArray(rows))throw fail('ランキングを取得できませんでした。',503);
    const expected=new Map(names.map((name,i)=>[name,ids[offset+i]]));for(const row of rows)if(expected.has(row.found?.name))players.push({...decodeFields(row.found.fields||{}),uid:expected.get(row.found.name)});
   }
   const result={fetchedAt:now(),tower:adventureLeaders(players,'tower'),dungeon:adventureLeaders(players,'dungeon')};cached=result;return result;
  })().catch(error=>{retryAfter=now()+5000;throw error;}).finally(()=>{inflight=null;});return inflight;
 }
 async function handle(req,res){try{
  if(req.method!=='GET')throw fail('GETのみ対応しています。',405);
  const mode=new URL(req.url,'http://localhost').searchParams.get('mode');if(!Object.hasOwn(MODES,mode))throw fail('冒険先を選んでください。',400);
  const result=await load();send(res,200,{mode,fetchedAt:result.fetchedAt,leaders:await decorate(result[mode])});
 }catch(error){send(res,error.status||503,{error:error.status&&error.status<500?error.message:'ランキングを取得できませんでした。時間を置いて再表示してください。'});}}
 return {handle};
}
