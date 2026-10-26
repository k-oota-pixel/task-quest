import {mkdir,readFile,rename,writeFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {tmpdir} from 'node:os';

const DEFAULT_FILE=process.env.PUBLIC_RANKINGS_FILE||join(tmpdir(),'monstudy','rankings.json');
const cleanKey=key=>typeof key==='string'&&/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(key)?key:'';
const emptyState=()=>({schemaVersion:1,updatedAt:'',rankings:{}});
const clone=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));
let testCacheSerial=0;

export function createPublicRankingCache({file=DEFAULT_FILE,now=Date.now}={}){
 let state=null,readPending=null,mutation=Promise.resolve();
 const loads=new Map();
 async function readState(){
  if(state)return state;
  if(readPending)return readPending;
  readPending=(async()=>{
   try{
    const parsed=JSON.parse(await readFile(file,'utf8'));
    state=parsed&&parsed.schemaVersion===1&&parsed.rankings&&typeof parsed.rankings==='object'?parsed:emptyState();
   }catch{state=emptyState();}
   return state;
  })().finally(()=>{readPending=null;});
  return readPending;
 }
 async function persist(next){
  await mkdir(dirname(file),{recursive:true});
  const temp=`${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  await writeFile(temp,JSON.stringify(next),'utf8');
  await rename(temp,file);
 }
 async function setSection(key,value){
  key=cleanKey(key);if(!key)throw new TypeError('Invalid ranking section key');
  const task=mutation.then(async()=>{
   const current=await readState(),next={schemaVersion:1,updatedAt:new Date(now()).toISOString(),rankings:{...current.rankings,[key]:clone(value)}};
   await persist(next);state=next;return clone(next.rankings[key]);
  });
  mutation=task.catch(()=>{});return task;
 }
 async function getSection(key,{load,valid}={}){
  key=cleanKey(key);if(!key)throw new TypeError('Invalid ranking section key');
  const current=(await readState()).rankings[key];
  if(current!==undefined&&(!valid||valid(current)))return clone(current);
  if(typeof load!=='function')return current===undefined?null:clone(current);
  if(loads.has(key))return clone(await loads.get(key));
  const pending=Promise.resolve().then(load).then(value=>setSection(key,value)).finally(()=>loads.delete(key));
  loads.set(key,pending);return clone(await pending);
 }
 async function getAll(){return clone(await readState());}
 return {file,getSection,setSection,getAll};
}

export const publicRankingCache=createPublicRankingCache();
export function runtimePublicRankingCache(){
  if(!process.env.NODE_TEST_CONTEXT)return publicRankingCache;
  testCacheSerial+=1;
  return createPublicRankingCache({file:join(tmpdir(),'monstudy-tests',`${process.pid}-${testCacheSerial}.json`)});
}
