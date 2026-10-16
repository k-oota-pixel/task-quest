from pathlib import Path
p=Path('server.mjs')
s=p.read_text(encoding='utf-8')
old="""      const upstream=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(petModel)}:generateContent`,{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':petKey},signal:AbortSignal.timeout(35000),body:JSON.stringify({systemInstruction:{parts:[{text:systemText}]},contents,generationConfig:{temperature:0.85,maxOutputTokens:320,thinkingConfig:{thinkingLevel:'minimal'},responseMimeType:'application/json',responseSchema:{type:'OBJECT',properties:{reply:{type:'STRING'},suggestions:{type:'ARRAY',items:{type:'STRING'},minItems:3,maxItems:3}},required:['reply','suggestions']}}})});
      if(!upstream.ok){console.error('Pet Gemini HTTP status:',upstream.status);const code=upstream.status;return send(res,code===429?429:502,{error:code===429?'Geminiの利用上限に達しました。少し待ってから話しかけてください。':code===400||code===403?'ペット会話用Geminiキー・モデル設定を確認してください。':'ペットと通信できません。少し待ってから試してください。'});}
      const data=await upstream.json(),candidate=data.candidates?.[0];
"""
new="""      let upstream=null;
      const retryable=new Set([500,502,503,504]);
      for(let attempt=0;attempt<3;attempt++){
        upstream=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(petModel)}:generateContent`,{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':petKey},signal:AbortSignal.timeout(35000),body:JSON.stringify({systemInstruction:{parts:[{text:systemText}]},contents,generationConfig:{temperature:0.85,maxOutputTokens:320,thinkingConfig:{thinkingLevel:'minimal'},responseMimeType:'application/json',responseSchema:{type:'OBJECT',properties:{reply:{type:'STRING'},suggestions:{type:'ARRAY',items:{type:'STRING'},minItems:3,maxItems:3}},required:['reply','suggestions']}}})});
        if(upstream.ok || !retryable.has(upstream.status) || attempt===2)break;
        console.warn(`Pet Gemini transient ${upstream.status}; retry ${attempt+1}/2`);
        try{await upstream.text();}catch{}
        await new Promise(r=>setTimeout(r,700*(attempt+1)));
      }
      if(!upstream.ok){console.error('Pet Gemini HTTP status:',upstream.status);const code=upstream.status;return send(res,code===429?429:502,{error:code===429?'Geminiの利用上限に達しました。少し待ってから話しかけてください。':code===400||code===403?'ペット会話用Geminiキー・モデル設定を確認してください。':code===503?'AIが一時的に混み合っています。少し待ってもう一度話しかけてください。':'ペットと通信できません。少し待ってから試してください。'});}
      const data=await upstream.json(),candidate=data.candidates?.[0];
"""
if old not in s: raise SystemExit('pet upstream block not found')
s=s.replace(old,new,1)
p.write_text(s,encoding='utf-8')
