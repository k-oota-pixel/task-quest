import {createHmac,randomBytes,timingSafeEqual} from 'node:crypto';

export function titleAuthority(secret){
 const digest=(kind,uid,value)=>createHmac('sha256',secret).update(JSON.stringify([kind,uid,value])).digest('base64url');
 function matches(kind,uid,value,signature){
  if(typeof signature!=='string'||signature.length!==43)return false;
  const actual=Buffer.from(signature);
  const expected=Buffer.from(digest(kind,uid,value));
  return actual.length===expected.length&&timingSafeEqual(actual,expected);
 }
 return {
  award:(uid,id)=>id+'|'+digest('award',uid,id),
  marker:uid=>digest('collection',uid,1),
  initialized:(uid,wallet)=>wallet.titleCollectionVersion===1&&matches('collection',uid,1,wallet.titleCollectionProof),
  verifyAward:(uid,token)=>{
   if(typeof token!=='string')return '';
   const separator=token.lastIndexOf('|');
   if(separator<1)return '';
   const id=token.slice(0,separator);
   return matches('award',uid,id,token.slice(separator+1))?id:'';
  },
  selection:(uid,id)=>digest('selection',uid,id),
  verifySelection:(uid,wallet)=>typeof wallet.selectedTitleId==='string'&&matches('selection',uid,wallet.selectedTitleId,wallet.selectedTitleProof)
 };
}

export function createTitleAuthority({base,accessToken,request=fetch}){
 const url=base+'/documents/internal_config/titleCollectionAuthority';
 let pending;
 async function load(){
  const headers={Authorization:'Bearer '+await accessToken(),'Content-Type':'application/json'};
  for(let attempt=0;attempt<3;attempt++){
   const response=await request(url,{headers,signal:AbortSignal.timeout(12000)});
   if(response.ok){
    const key=(await response.json()).fields?.key?.stringValue;
    if(typeof key!=='string'||!/^[a-f0-9]{64}$/.test(key))throw Error('Invalid title authority key');
    return titleAuthority(Buffer.from(key,'hex'));
   }
   if(response.status!==404)throw Error('Could not load title authority');
   const key=randomBytes(32);
   const created=await request(url+'?currentDocument.exists=false',{
    method:'PATCH',headers,signal:AbortSignal.timeout(12000),
    body:JSON.stringify({fields:{key:{stringValue:key.toString('hex')}}})
   });
   if(created.ok)return titleAuthority(key);
   if(![409,412].includes(created.status))throw Error('Could not initialize title authority');
  }
  throw Error('Could not initialize title authority');
 }
 return ()=>pending??=(load().catch(error=>{pending=null;throw error;}));
}

// The app server supplies its persisted authority. This fallback keeps pure
// handler fixtures independent of the production key store.
export const fixtureTitleAuthority=async()=>titleAuthority('monstudy-test-title-authority');
