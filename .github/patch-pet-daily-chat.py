from pathlib import Path
p=Path('server.mjs')
s=p.read_text(encoding='utf-8')

anchor="function petPersonality(species){return PET_PERSONALITIES[species]||PET_PERSONALITIES.cat;}\n"
if anchor not in s: raise SystemExit('personality anchor missing')
topics=r'''const PET_TOPICS=Object.freeze({
  school:'school life, classes, lunch, clubs, and small moments at school',
  food:'food and drinks the student likes or wants to try',
  hobbies:'hobbies, games, sports, and things the student enjoys doing',
  weekend:'weekend plans and relaxing ways to spend free time',
  music:'music, movies, videos, books, and entertainment',
  places:'places the student likes, wants to visit, or has enjoyed visiting',
  favorites:'favorite things and simple choices between two options',
  weather:'weather, seasons, and what the student likes doing in different weather',
  dreams:'things the student wants to try, learn, or become better at',
  memories:'funny, happy, surprising, or interesting recent memories'
});
function petTopic(id){return PET_TOPICS[id]||PET_TOPICS.school;}
'''
s=s.replace(anchor,anchor+topics,1)

old="""    const petName=cleanPetMessage(body.petName,24)||'your pet';
    const message=cleanPetMessage(body.message,500);
"""
new="""    const petName=cleanPetMessage(body.petName,24)||'your pet';
    const topicId=Object.hasOwn(PET_TOPICS,String(body.topic||''))?String(body.topic):'school';
    const message=cleanPetMessage(body.message,500);
"""
if old not in s: raise SystemExit('body block missing')
s=s.replace(old,new,1)

old_prompt="""Have a friendly everyday conversation in English.
Use simple, natural English around CEFR A1-B1 unless the student clearly uses more advanced English.
Keep each reply short: usually 1-3 sentences, no more than about 45 words.
Usually end with one easy, natural question so the conversation can continue.
"""
new_prompt="""Today's conversation theme is: ${petTopic(topicId)}.
Have a friendly everyday conversation in English and gently keep the conversation connected to today's theme, while naturally following what the student says.
Use simple, natural English around CEFR A1-B1 unless the student clearly uses more advanced English.
Keep each reply short: usually 1-3 sentences, no more than about 45 words.
Usually end with one easy, natural question so the conversation can continue.
After deciding your reply, also create exactly 3 short possible student responses to your final question. Each suggestion must be natural, easy English, useful for continuing the conversation, and no more than 10 words. Make the 3 suggestions meaningfully different.
"""
if old_prompt not in s: raise SystemExit('prompt block missing')
s=s.replace(old_prompt,new_prompt,1)

old_call="""body:JSON.stringify({systemInstruction:{parts:[{text:systemText}]},contents,generationConfig:{temperature:0.85,maxOutputTokens:180,thinkingConfig:{thinkingLevel:'minimal'}}})"""
new_call="""body:JSON.stringify({systemInstruction:{parts:[{text:systemText}]},contents,generationConfig:{temperature:0.85,maxOutputTokens:320,thinkingConfig:{thinkingLevel:'minimal'},responseMimeType:'application/json',responseSchema:{type:'OBJECT',properties:{reply:{type:'STRING'},suggestions:{type:'ARRAY',items:{type:'STRING'},minItems:3,maxItems:3}},required:['reply','suggestions']}}})"""
if old_call not in s: raise SystemExit('gemini call config missing')
s=s.replace(old_call,new_call,1)

old_parse="""      const data=await upstream.json(),candidate=data.candidates?.[0];
      const reply=cleanPetMessage(candidate?.content?.parts?.filter(p=>!p.thought).map(p=>p.text||'').join(''),1200);
      if(!reply)throw Error('invalid pet response');
      send(res,200,{reply});
"""
new_parse="""      const data=await upstream.json(),candidate=data.candidates?.[0];
      const raw=candidate?.content?.parts?.filter(p=>!p.thought).map(p=>p.text||'').join('')||'';
      let result={};try{result=JSON.parse(raw);}catch{}
      const reply=cleanPetMessage(result.reply,1200);
      const suggestions=Array.isArray(result.suggestions)?result.suggestions.map(x=>cleanPetMessage(x,100)).filter(Boolean).slice(0,3):[];
      if(!reply)throw Error('invalid pet response');
      while(suggestions.length<3)suggestions.push(['Tell me more!','How about you?','That sounds interesting!'][suggestions.length]);
      send(res,200,{reply,suggestions,topic:topicId});
"""
if old_parse not in s: raise SystemExit('pet response parse block missing')
s=s.replace(old_parse,new_parse,1)

p.write_text(s,encoding='utf-8')
