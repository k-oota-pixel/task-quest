import test from 'node:test';
import assert from 'node:assert/strict';
import {createWeeklyTitleSettlement} from './weekly-title-settlement.mjs';
import {fixtureTitleAuthority} from './title-authority.mjs';

test('settles the previous week once and only writes newly earned titles',async()=>{
 const authority=await fixtureTitleAuthority(),prefix='projects/p/databases/(default)/documents/';
 const wallet=uid=>prefix+'users/'+uid+'/apps/english-playroom';
 const checkpointName=prefix+'leaderboards/weekly-title-settlement';
 let time=Date.parse('2026-11-15T23:59:59+09:00'),checkpoint=null;
 const operations=[];
 const make=()=>createWeeklyTitleSettlement({base:'https://db',projectId:'p',accessToken:async()=>'token',decodeFields:x=>x,
  now:()=>time,getAuthority:fixtureTitleAuthority,log:assert.fail,
  completedWeek:async week=>{operations.push(week);return {a:{coins:4,ateru:4},b:{ateru:4},c:{ateru:3}};},
  fetch:async(url,options)=>{
   if(url.endsWith('/weekly-title-settlement')){
    operations.push('checkpoint');
    return checkpoint?{ok:true,json:async()=>checkpoint}:{ok:false,status:404};
   }
   if(url.endsWith(':batchGet')){
    operations.push('candidates');
    assert.deepEqual(JSON.parse(options.body).documents,[wallet('a'),wallet('b')]);
    return {ok:true,json:async()=>[
     {found:{name:wallet('b'),updateTime:'b-version',fields:{earnedTitleIds:[authority.award('b','weekly:ateru')]}}},
     {found:{name:wallet('a'),updateTime:'a-version',fields:{earnedTitleIds:[]}}}
    ]};
   }
   assert.ok(url.endsWith(':commit'),url);
   operations.push('commit');
   const [award,record,...other]=JSON.parse(options.body).writes;
   assert.equal(other.length,0);
   assert.equal(award.update.name,wallet('a'));
   assert.deepEqual(award.currentDocument,{updateTime:'a-version'});
   assert.deepEqual(award.updateTransforms[0].appendMissingElements.values.map(x=>authority.verifyAward('a',x.stringValue)),
    ['weekly:coins','weekly:ateru']);
   assert.equal(record.update.name,checkpointName);
   assert.deepEqual(record.currentDocument,{exists:false});
   checkpoint={updateTime:'committed',fields:{settledThrough:record.update.fields.settledThrough.stringValue}};
   return {ok:true,json:async()=>({writeResults:[{},{updateTime:'committed'}]})};
  }});
 const settlement=make();
 await settlement.run();
 assert.deepEqual(operations,[]);
 time+=1000;
 await Promise.all([settlement.run(),settlement.run()]);
 await settlement.run();
 assert.deepEqual(operations,['checkpoint','2026-11-09','candidates','commit']);
 await make().run();
 assert.deepEqual(operations,['checkpoint','2026-11-09','candidates','commit','checkpoint']);
});
