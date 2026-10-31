import test from 'node:test';
import assert from 'node:assert/strict';
import {createContactMessage} from './contact-message.mjs';

function responseRecorder(){
  return {status:null,body:null,send(status,body){this.status=status;this.body=body;}};
}

test('contact email never includes the signed-in email address',async()=>{
  let outbound;
  const handle=createContactMessage({
    verifyUser:async()=>({uid:'user-123',email:'student@example.com'}),
    readJson:async()=>({message:'画面が動きません。',page:'/english-playroom/'}),
    send:(res,status,obj)=>res.send(status,obj),
    fail:(message,status=500)=>Object.assign(new Error(message),{status}),
    env:{RESEND_API_KEY:'secret',CONTACT_TO_EMAIL:'developer@example.com',CONTACT_FROM_EMAIL:'Monstudy <noreply@example.net>'},
    now:()=>Date.UTC(2026,10,1,12,0,0),
    fetchImpl:async(url,options)=>{outbound={url,options};return {ok:true,status:200};}
  });
  const req={method:'POST',headers:{'content-type':'application/json'}};
  const res=responseRecorder();
  await handle(req,res);
  assert.equal(res.status,200);
  const payload=JSON.parse(outbound.options.body);
  assert.deepEqual(payload.to,['developer@example.com']);
  assert.match(payload.text,/user-123/);
  assert.doesNotMatch(payload.text,/student@example\.com/);
  assert.doesNotMatch(outbound.options.body,/student@example\.com/);
});

test('contact handler rejects missing mail configuration',async()=>{
  const handle=createContactMessage({
    verifyUser:async()=>({uid:'user-123',email:'student@example.com'}),
    readJson:async()=>({message:'test'}),
    send:(res,status,obj)=>res.send(status,obj),
    fail:(message,status=500)=>Object.assign(new Error(message),{status}),
    env:{},fetchImpl:async()=>{throw Error('must not call');}
  });
  const req={method:'POST',headers:{'content-type':'application/json'}};
  const res=responseRecorder();
  await handle(req,res);
  assert.equal(res.status,503);
});
