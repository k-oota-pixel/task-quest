import test from 'node:test';
import assert from 'node:assert/strict';
import {taskModels, callTaskGemini, validTaskResult} from './task-gemini.mjs';
const options = {apiKey: 'fake', system: 'grading instructions', task: {situation: 'At a hotel', task: 'State your reservation'}, answer: 'I have a reservation.', sleep: async () => {}};
const okay = {candidates: [{finishReason: 'STOP', content: {parts: [{text: JSON.stringify({clear: true, message: '通じます', example: 'I have a reservation.'})}]}}]};
const response = (status, data = okay) => ({ok: status === 200, status, json: async () => data});

test('backup selects its own stable model, main continues to use existing model', () => {
 assert.deepEqual(taskModels({mainModel: 'main', backupModel: 'gemini-3.5-flash-lite', backup: true}), ['gemini-3.5-flash-lite','gemini-3.1-flash-lite']);
 assert.deepEqual(taskModels({mainModel: 'main', backupModel: 'backup', backup: false}), ['main']);
});
test('503 retries and succeeds', async () => {
 let calls = 0;
 const result = await callTaskGemini({...options, models: ['gemini-3.5-flash-lite'], fetchImpl: async () => response(++calls < 3 ? 503 : 200)});
 assert.equal(calls,3); assert.equal(result.ok,true); assert.equal(result.result.clear,true);
});
test('404 on backup switches to another stable model', async () => {
 const called = [];
 const result = await callTaskGemini({...options, models: ['bad-model','gemini-3.1-flash-lite'], fetchImpl: async url => {called.push(url); return response(called.length === 1 ? 404 : 200);}});
 assert.equal(result.ok,true); assert.equal(called.length,2); assert.match(called[1],/gemini-3.1-flash-lite/);
});
test('429 is not retried', async () => {
 let calls=0;
 const result=await callTaskGemini({...options, models:['gemini-3.5-flash-lite'], fetchImpl: async()=>{calls++;return response(429);}});
 assert.equal(calls,1); assert.equal(result.status,429);
});
test('invalid JSON is retried but never accepted as valid scoring', async () => {
 let calls=0;
 const result=await callTaskGemini({...options, models:['gemini-3.5-flash-lite'], fetchImpl: async()=>{calls++;return response(200,{candidates:[{finishReason:'STOP',content:{parts:[{text:'not json'}]}}]});}});
 assert.equal(result.ok,false);assert.equal(result.reason,'invalid');assert.equal(calls,3);
 assert.equal(validTaskResult({clear:true,message:'a',example:''}),true);
});
