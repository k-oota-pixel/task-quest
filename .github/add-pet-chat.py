from pathlib import Path

p=Path('server.mjs')
s=p.read_text(encoding='utf-8')

old="const key=process.env.GEMINI_API_KEY,model=process.env.GEMINI_MODEL||'gemini-2.5-flash';"
new="const key=process.env.GEMINI_API_KEY,model=process.env.GEMINI_MODEL||'gemini-2.5-flash';\nconst petKey=process.env.PET_GEMINI_API_KEY||'',petModel=process.env.PET_GEMINI_MODEL||'gemini-2.5-flash';\nconst petWindows=new Map();let petDaily=0,petDay='',petActive=0;"
if old not in s:
    raise SystemExit('key line not found')
s=s.replace(old,new,1)

marker="export const server=http.createServer(async(req,res)=>{"
if marker not in s:
    raise SystemExit('server marker not found')
insert=r'''
const PET_PERSONALITIES=Object.freeze({
  cat:'You are a cat: calm, a little cool, quietly affectionate, and sometimes lightly witty. Do not sound rude.',
  dog:'You are a dog: cheerful, friendly, energetic, and openly excited to talk with the student.',
  bird:'You are a small bird: lively, curious, quick, and fond of asking short follow-up questions.',
  hamster:'You are a hamster: gentle, slightly shy, warm, and very encouraging.',
  panda:'You are a panda: relaxed, easygoing, patient, and comforting, with a calm sense of humor.',
  penguin:'You are a penguin: earnest, polite, dependable, and a little formal in a charming way.'
});
function petPersonality(species){return PET_PERSONALITIES[species]||PET_PERSONALITIES.cat;}
function cleanPetMessage(value,max=500){return String(value??'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'').trim().slice(0,max);}
async function handlePetChat(req,res){
  try{
    if(req.method!=='POST')throw fail('POSTのみ対応しています。',405);
    if(!petKey)throw fail('ペット会話用APIキーが未設定です。',503);
    if(!req.headers['content-type']?.startsWith('application/json'))throw fail('JSONで送信してください。',415);
    const user=await verifyUser(req),body=await readJson(req,12000);
    const species=String(body.species||'cat');
    if(!Object.hasOwn(PET_PERSONALITIES,species))throw fail('ペットの種類を確認できません。',400);
    const petName=cleanPetMessage(body.petName,24)||'your pet';
    const message=cleanPetMessage(body.message,500);
    if(!message)throw fail('メッセージを入力してください。',400);
    const history=Array.isArray(body.history)?body.history.slice(-10).map(x=>({role:x?.role==='assistant'?'model':'user',text:cleanPetMessage(x?.text,500)})).filter(x=>x.text):[];

    const today=new Date().toISOString().slice(0,10);if(petDay!==today){petDay=today;petDaily=0;petWindows.clear();}
    const now=Date.now(),rateKey=user.uid;for(const [k,v]of petWindows)if(now-v.start>=60000)petWindows.delete(k);
    const w=petWindows.get(rateKey)||{start:now,count:0};
    if(w.count>=30||petActive>=8)return send(res,429,{error:'おしゃべりが混み合っています。少し待ってから話しかけてください。'});
    if(petDaily>=Number(process.env.PET_DAILY_LIMIT||1500))return send(res,429,{error:'本日のペット会話の上限に達しました。'});
    w.count++;petWindows.set(rateKey,w);petDaily++;petActive++;

    const systemText=`
You are ${petName}, a pet companion in an English-learning app for Japanese high school students.
${petPersonality(species)}
Have a friendly everyday conversation in English.
Use simple, natural English around CEFR A1-B1 unless the student clearly uses more advanced English.
Keep each reply short: usually 1-3 sentences, no more than about 45 words.
Usually end with one easy, natural question so the conversation can continue.
If the student's English has a small mistake, understand the meaning and keep talking. Do not turn every reply into a correction lesson.
If a correction would genuinely help, model the natural expression gently inside your reply without scolding or grading.
If the student writes Japanese, still answer in easy English.
Never ask for full names, addresses, phone numbers, email addresses, passwords, school IDs, or other sensitive personal information.
Do not claim to be a human. Stay in character as the student's pet.
`;
    try{
      const contents=history.map(x=>({role:x.role,parts:[{text:x.text}]}));
      contents.push({role:'user',parts:[{text:message}]});
      const upstream=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(petModel)}:generateContent`,{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':petKey},signal:AbortSignal.timeout(35000),body:JSON.stringify({systemInstruction:{parts:[{text:systemText}]},contents,generationConfig:{temperature:0.85,maxOutputTokens:180,thinkingConfig:{thinkingLevel:'minimal'}}})});
      if(!upstream.ok){console.error('Pet Gemini HTTP status:',upstream.status);const code=upstream.status;return send(res,code===429?429:502,{error:code===429?'Geminiの利用上限に達しました。少し待ってから話しかけてください。':code===400||code===403?'ペット会話用Geminiキー・モデル設定を確認してください。':'ペットと通信できません。少し待ってから試してください。'});}
      const data=await upstream.json(),candidate=data.candidates?.[0];
      const reply=cleanPetMessage(candidate?.content?.parts?.filter(p=>!p.thought).map(p=>p.text||'').join(''),1200);
      if(!reply)throw Error('invalid pet response');
      send(res,200,{reply});
    }finally{petActive=Math.max(0,petActive-1);}
  }catch(e){send(res,e.status||500,{error:e.message||'ペットとおしゃべりできませんでした。'});}
}

'''
s=s.replace(marker,insert+marker,1)

route="  const path=new URL(req.url,'http://localhost').pathname;\n"
if route not in s:
    raise SystemExit('route marker not found')
s=s.replace(route,route+"  if(path==='/api/pet-chat')return handlePetChat(req,res);\n",1)

status="if(req.method==='GET'&&path==='/api/status')return send(res,200,{ready:!!key});"
if status not in s:
    raise SystemExit('status marker not found')
s=s.replace(status,"if(req.method==='GET'&&path==='/api/status')return send(res,200,{ready:!!key,petChatReady:!!petKey});",1)

p.write_text(s,encoding='utf-8')
