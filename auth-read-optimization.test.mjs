import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
process.env.NODE_ENV='test';process.env.ADMIN_EMAIL='teacher@example.test';process.env.PET_GEMINI_API_KEY='test-key';
const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
process.env.FIREBASE_SERVICE_ACCOUNT_JSON=JSON.stringify({client_email:'test@example.test',private_key:privateKey.export({type:'pkcs8',format:'pem'})});
const nativeFetch=globalThis.fetch;
let reads=[],authCalls=0,accountVersion=3,resetRequired=false,disabled=false,email='student@example.test',emailVerified=true;
const fields=value=>Object.fromEntries(Object.entries(value).map(([k,v])=>[k,typeof v==='number'?{integerValue:String(v)}:typeof v==='boolean'?{booleanValue:v}:{stringValue:v}]));
globalThis.fetch=async(url,options={})=>{
 const text=String(url);
 if(text.includes('oauth2.googleapis.com'))return Response.json({access_token:'test-access',expires_in:3600});
 if(text.includes('identitytoolkit.googleapis.com')){authCalls++;return Response.json({users:[{localId:'student',createdAt:'1700000000000',email,emailVerified,disabled}]});}
 if(text.includes('firestore.googleapis.com')){
  assert.equal(options.method||'GET','GET','these checks must not write data');reads.push(text);
  if(text.endsWith('/documents/account_uids/student'))return Response.json({fields:fields({idKey:'id-key'})});
  if(text.endsWith('/documents/code_accounts/id-key'))return Response.json({fields:fields({uid:'student',loginId:'student_01',version:accountVersion,resetRequired})});
  throw Error('Unexpected Firestore read: '+text);
 }
 if(text.includes('generativelanguage.googleapis.com'))throw Error('AI must not be called by this test');
 return nativeFetch(url,options);
};
const claims=Buffer.from(JSON.stringify({aud:'eiken-retry',iss:'https://securetoken.google.com/eiken-retry',sub:'student',codeVersion:3,firebase:{sign_in_provider:'custom'}})).toString('base64url');
const headers={'Content-Type':'application/json',Authorization:'Bearer header.'+claims+'.accepted'};
test('real API routing performs two admission reads per request and rechecks resets on the next request',async()=>{
 const {server}=await import('./server.mjs');await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 async function call(path,{method='POST',body={},signedIn=true}={}){reads=[];authCalls=0;const response=await nativeFetch(base+path,{method,headers:signedIn?headers:{'Content-Type':'application/json'},...(method==='GET'?{}:{body:JSON.stringify(body)})});const data=await response.json();return {status:response.status,data,readCount:reads.length,authCalls};}
 try{
  for(const path of ['/api/pet-chat','/api/learning/activity']){const r=await call(path,{body:{appId:'invalid-test'}});assert.equal(r.status,400,path);assert.equal(r.readCount,2,path);assert.equal(r.authCalls,1,path);}
  let r=await call('/api/account/session');assert.equal(r.status,200);assert.equal(r.data.admin,false);assert.equal(r.readCount,2);
  r=await call('/api/admin/session',{method:'GET'});assert.equal(r.status,403);assert.equal(r.readCount,2);
  email='teacher@example.test';r=await call('/api/account/session');assert.equal(r.data.admin,true);assert.equal(r.readCount,2);
  r=await call('/api/admin/session',{method:'GET'});assert.equal(r.status,200);assert.equal(r.readCount,2);
  emailVerified=false;r=await call('/api/account/session');assert.equal(r.data.admin,false);r=await call('/api/admin/session',{method:'GET'});assert.equal(r.status,403);
  emailVerified=true;resetRequired=true;r=await call('/api/pet-chat');assert.equal(r.status,403);assert.equal(r.readCount,2);
  r=await call('/api/account/session');assert.equal(r.data.resetRequired,true);assert.equal(r.data.admin,false);
  resetRequired=false;accountVersion=4;r=await call('/api/pet-chat');assert.equal(r.status,401);assert.equal(r.readCount,2);
  accountVersion=3;disabled=true;r=await call('/api/pet-chat');assert.equal(r.status,401);assert.equal(r.readCount,0);
  disabled=false;r=await call('/api/pet-chat',{signedIn:false});assert.equal(r.status,401);assert.equal(r.readCount,0);
 }finally{await new Promise(resolve=>server.close(resolve));globalThis.fetch=nativeFetch;}
});
