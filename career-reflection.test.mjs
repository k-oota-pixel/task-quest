import test from 'node:test';
import assert from 'node:assert/strict';
import {validateCareerRequest,callCareerGemini,createCareerReflection,careerInstructions} from './career-reflection.mjs';

const matrix={values:[
 {label:'興味を持てること',weight:3},{label:'資格を取得できること',weight:1},
 {label:'家族のすすめ',weight:4},{label:'将来の仕事につながること',weight:2}
],options:['経済学部','経営学部','工学部','商学部'].map(name=>({name,kind:'faculty'})),
 ratings:[1,4,2,3,2,5,1,4,3,1,5,2,5,2,2,1]};
const history=[{question:'なぜ重要にしているのですか？',answer:'将来の進路を自分で考えたいからです。'}];
const input={step:2,matrix,history};
const mockResponse=(result,status=200)=>({ok:status===200,status,json:async()=>({
 candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(result)}]}}]
})});
const sendRecords=[];
const send=(_,status,body)=>{sendRecords.push({status,body});return body;};
const fail=(message,status)=>Object.assign(new Error(message),{status});
test('validates completed matrix and computes weighted comparison independently',()=>{
 const normalized=validateCareerRequest(input);
 assert.equal(normalized.step,2);
 assert.equal(normalized.scores[0].name,'工学部');
 assert.equal(normalized.scores[0].total,31);
 assert.match(careerInstructions(2),/一度にひとつだけ/);
});
test('rejects incomplete matrices, duplicate values and empty learner answers',()=>{
 assert.throws(()=>validateCareerRequest({...input,matrix:{...matrix,ratings:[...matrix.ratings.slice(0,15),0]}}),/評価を16か所/);
 assert.throws(()=>validateCareerRequest({...input,matrix:{...matrix,values:matrix.values.map((v,i)=>i===1?{...v,label:matrix.values[0].label}:v)}}),/重複/);
 assert.throws(()=>validateCareerRequest({...input,history:[{question:'なぜ？',answer:''}]}),/回答/);
});
test('Gemini returns one thoughtful question in a strict JSON schema',async()=>{
 let usedUrl='',usedBody;
 const response=await callCareerGemini({apiKey:'test',model:'gemini-2.5-flash-lite',
  input:validateCareerRequest(input),fetchImpl:async(url,options)=>{
    usedUrl=url;usedBody=JSON.parse(options.body);return mockResponse({question:'その判断を確かめるには何を調べたいですか？'});
  }});
 assert.match(usedUrl,/gemini-2.5-flash-lite/);
 assert.equal(usedBody.generationConfig.responseMimeType,'application/json');
 assert.equal(response.question,'その判断を確かめるには何を調べたいですか？');
});
test('Gemini summary summarizes learner replies in three short fields',async()=>{
 const normalized=validateCareerRequest({step:4,matrix,history:[
  ...history,{question:'根拠は何ですか？',answer:'今は想像だけでつけた点数です。'},
  {question:'何を調べたいですか？',answer:'大学のシラバスを調べたいです。'}
 ]});
 const actual=await callCareerGemini({apiKey:'test',model:'gemini-2.5-flash-lite',input:normalized,
  fetchImpl:async()=>mockResponse({values:'自分で決めたい',toExplore:'学びの実態',nextStep:'大学のシラバスを見る'})});
 assert.equal(actual.summary.nextStep,'大学のシラバスを見る');
});
test('429 quota failure is not retried',async()=>{
 let count=0;
 await assert.rejects(callCareerGemini({apiKey:'test',model:'gemini-2.5-flash-lite',
  input:validateCareerRequest(input),fetchImpl:async()=>{count++;return {ok:false,status:429};}}),error=>error.status===429);
 assert.equal(count,1);
});
test('API requires vocabulary key and limits requests per user',async()=>{
 const req={method:'POST',headers:{'content-type':'application/json'}};
 const handle=createCareerReflection({verifyUser:async()=>({uid:'test-learner'}),readJson:async()=>input,send,fail,
  env:{VOCAB_GEMINI_API_KEY:'test',CAREER_GEMINI_MODEL:'gemini-2.5-flash-lite'},
  fetchImpl:async()=>mockResponse({question:'なぜですか？'}),now:()=>Date.UTC(2026,10,17)});
 for(let i=0;i<7;i++)await handle(req,{});
 assert.equal(sendRecords[0].status,200);
 assert.equal(sendRecords[6].status,429);
 const withoutKey=createCareerReflection({verifyUser:async()=>({uid:'test-learner'}),readJson:async()=>input,send,fail,env:{}});
 await withoutKey(req,{});
 assert.equal(sendRecords.at(-1).status,503);
});
