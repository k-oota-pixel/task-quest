import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {createGoogleAccessToken} from './google-access-token.mjs';

const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const serviceAccount=()=>({
 client_email:'test@example.invalid',
 private_key:privateKey.export({type:'pkcs8',format:'pem'})
});
const logger={info(){},warn(){}};

test('concurrent admission calls share one OAuth refresh and cache token',async()=>{
 let requests=0;
 const get=createGoogleAccessToken({
  serviceAccount,logger,
  fetchImpl:async(url,options)=>{
   assert.equal(url,'https://oauth2.googleapis.com/token');
   assert.equal(options.method,'POST');
   assert.ok(options.signal);
   requests++;
   await new Promise(resolve=>setTimeout(resolve,1));
   return Response.json({access_token:'private-test-token',expires_in:3600});
  }
 });
 const results=await Promise.all(Array.from({length:20},()=>get()));
 assert.equal(new Set(results).size,1);
 assert.equal(requests,1);
 assert.equal(await get(),'private-test-token');
 assert.equal(requests,1);
});

test('hung Google OAuth fetch times out and a second attempt succeeds',async()=>{
 let count=0;
 const get=createGoogleAccessToken({
  serviceAccount,logger,timeoutMs:15,
  fetchImpl:async(url,options)=>{
   count++;
   if(count===1)return new Promise((resolve,reject)=>{
    options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true});
   });
   return Response.json({access_token:'recovered',expires_in:3600});
  }
 });
 assert.equal(await get(),'recovered');
 assert.equal(count,2);
});

test('repeated OAuth timeout returns 503 and does not poison a future retry',async()=>{
 let available=false,requests=0;
 const get=createGoogleAccessToken({
  serviceAccount,logger,timeoutMs:10,
  fetchImpl:async(url,options)=>{
   requests++;
   if(available)return Response.json({access_token:'recovered',expires_in:3600});
   return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true}));
  }
 });
 await assert.rejects(get(),{status:503});
 assert.equal(requests,2);
 available=true;
 assert.equal(await get(),'recovered');
 assert.equal(requests,3);
});

test('invalid credentials fail promptly without repeated OAuth requests',async()=>{
 let requests=0;
 const get=createGoogleAccessToken({
  serviceAccount,logger,
  fetchImpl:async()=>{
   requests++;
   return Response.json({error:'invalid_grant'},{status:400});
  }
 });
 await assert.rejects(get(),{status:503});
 assert.equal(requests,1);
});

test('token refreshes on expiry but no secrets appear in logs',async()=>{
 const logs=[];let clock=1000000,requests=0;
 const get=createGoogleAccessToken({
  serviceAccount,now:()=>clock,
  logger:{warn:x=>logs.push(x),info:x=>logs.push(x)},
  fetchImpl:async()=>{
   requests++;
   return Response.json({access_token:'SECRET_TOKEN',expires_in:3600});
  }
 });
 await get();
 clock+=3590*1000;
 await get();
 assert.equal(requests,2);
 assert.ok(logs.every(x=>!x.includes('SECRET_TOKEN')&&!x.includes('PRIVATE KEY')));
});
