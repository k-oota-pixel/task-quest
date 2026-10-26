import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createPublicRankingCache} from './public-ranking-cache.mjs';

test('stores all public ranking sections in one atomic JSON file',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'monstudy-ranking-test-'));
  let time=Date.parse('2026-10-27T00:00:00Z'),loads=0;
  const file=join(dir,'rankings.json'),cache=createPublicRankingCache({file,now:()=>time});
  const first=await cache.getSection('wordBreaker',{load:async()=>{loads++;return {courses:{junior1:{score:10}}};}});
  assert.equal(first.courses.junior1.score,10);
  assert.equal(loads,1);
  await cache.getSection('wordBreaker',{load:async()=>{loads++;return {courses:{}};}});
  assert.equal(loads,1);
  time+=1000;
  await Promise.all([cache.setSection('adventure',{tower:[{floor:3}]}),cache.setSection('petCatch',{date:'2026-10-27',score:7})]);
  const disk=JSON.parse(await readFile(file,'utf8'));
  assert.equal(disk.schemaVersion,1);
  assert.ok(disk.rankings.wordBreaker);
  assert.ok(disk.rankings.adventure);
  assert.ok(disk.rankings.petCatch);
});

test('reloads a daily section only when its validator says it is stale',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'monstudy-ranking-day-test-'));
  const cache=createPublicRankingCache({file:join(dir,'rankings.json')});
  await cache.setSection('dailyCoins',{today:'2026-10-26',top3:[]});
  let loads=0;
  const section=await cache.getSection('dailyCoins',{valid:value=>value.today==='2026-10-27',load:async()=>{loads++;return {today:'2026-10-27',top3:[]};}});
  assert.equal(section.today,'2026-10-27');
  assert.equal(loads,1);
});
