import {createSign} from 'node:crypto';

// Short, bounded Google OAuth refresh for Firebase admin REST calls.
// No usernames, credentials, assertion, or bearer token are ever logged.
export function createGoogleAccessToken({
 serviceAccount,
 fetchImpl=fetch,
 now=Date.now,
 logger=console,
 timeoutMs=10000,
 maxAttempts=2
}){
 let token='',expiresAt=0,inFlight=null;
 return async function getGoogleAccessToken(){
  if(token&&now()<expiresAt-60000)return token;
  if(inFlight)return inFlight;
  const task=(async()=>{
   const sa=serviceAccount(),issued=Math.floor(now()/1000);
   const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
   const unsigned=encode({alg:'RS256',typ:'JWT'})+'.'+encode({
    iss:sa.client_email,scope:'https://www.googleapis.com/auth/cloud-platform',
    aud:'https://oauth2.googleapis.com/token',iat:issued,exp:issued+3600
   });
   const signer=createSign('RSA-SHA256');
   signer.update(unsigned);signer.end();
   const assertion=unsigned+'.'+signer.sign(sa.private_key).toString('base64url');
   for(let attempt=1;attempt<=maxAttempts;attempt++){
    const started=now();
    try{
     const response=await fetchImpl('https://oauth2.googleapis.com/token',{
      method:'POST',
      headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({
       grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion
      }),
      signal:AbortSignal.timeout(timeoutMs)
     });
     if(!response.ok){
      const failure=new Error('OAuth HTTP error');
      failure.httpStatus=response.status;
      throw failure;
     }
     const body=await response.json();
     if(typeof body?.access_token!=='string'||!body.access_token)throw Error('Missing OAuth token');
     token=body.access_token;
     expiresAt=now()+Math.max(300,Number(body.expires_in)||3600)*1000;
     logger.info?.(JSON.stringify({event:'google_oauth_refresh',result:'success',attempt,elapsedMs:now()-started}));
     return token;
    }catch(error){
     logger.warn?.(JSON.stringify({
      event:'google_oauth_refresh',result:'failure',attempt,
      elapsedMs:now()-started,httpStatus:error?.httpStatus||null,
      kind:error?.name||'Error'
     }));
     if(attempt>=maxAttempts||error?.httpStatus>=400&&error.httpStatus<500&&error.httpStatus!==429)break;
    }
   }
   throw Object.assign(Error('Firebase管理用の接続が完了しませんでした。再度お試しください。'),{status:503});
  })();
  inFlight=task;
  try{return await task;}
  finally{if(inFlight===task)inFlight=null;}
 };
}
