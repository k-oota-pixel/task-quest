import {readFileSync,writeFileSync} from 'node:fs';
const path='server.mjs';
let source=readFileSync(path,'utf8');
const before="const todayNews=createTodayNewsGenerator({apiKey:key,model:process.env.TODAY_GEMINI_MODEL||model,send,fail});";
const after="const todayNews=createTodayNewsGenerator({apiKey:process.env.TODAY_GEMINI_API_KEY||backupKey||key,model:process.env.TODAY_GEMINI_MODEL||model,send,fail});";
if(!source.includes(after)){
  if(!source.includes(before))throw new Error('TODAY key anchor not found');
  source=source.replace(before,after);
}
writeFileSync(path,source);
