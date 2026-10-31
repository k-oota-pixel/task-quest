const cleanText=value=>String(value??'').replace(/\r\n?/g,'\n').trim();
const safePage=value=>{
  const text=cleanText(value).slice(0,300);
  return /^\/[A-Za-z0-9_~!$&'()*+,;=:@%./?-]*$/.test(text)?text:'/english-playroom/';
};

export function createContactMessage({verifyUser,readJson,send,fail,fetchImpl=fetch,env=process.env,now=Date.now}){
  const windows=new Map();
  const WINDOW_MS=60*60*1000;
  const LIMIT=5;
  const COOLDOWN_MS=15000;

  function admit(uid){
    const time=now();
    let entry=windows.get(uid);
    if(!entry||time-entry.start>=WINDOW_MS)entry={start:time,count:0,last:0};
    if(entry.last&&time-entry.last<COOLDOWN_MS)throw fail('続けて送信する場合は少し待ってください。',429);
    if(entry.count>=LIMIT)throw fail('メッセージの送信回数が多いため、しばらく待ってからお試しください。',429);
    entry.count++;entry.last=time;windows.set(uid,entry);
  }

  function sentAt(){
    return new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',dateStyle:'medium',timeStyle:'medium'}).format(new Date(now()));
  }

  return async function handleContactMessage(req,res){
    if(req.method!=='POST')return send(res,405,{error:'POSTのみ対応しています。'});
    if(!req.headers['content-type']?.startsWith('application/json'))return send(res,415,{error:'JSONで送信してください。'});
    try{
      const user=await verifyUser(req);
      const body=await readJson(req,8192);
      const message=cleanText(body.message);
      if(!message||[...message].length>2000)throw fail('メッセージは1〜2000文字で入力してください。',400);
      const page=safePage(body.page);
      const to=cleanText(env.CONTACT_TO_EMAIL);
      if(!to)throw fail('お問い合わせ送信の準備中です。管理者に確認してください。',503);
      admit(user.uid);

      const timestamp=sentAt();
      const apiKey=cleanText(env.RESEND_API_KEY);
      const from=cleanText(env.CONTACT_FROM_EMAIL);
      let upstream;

      if(apiKey&&from){
        const text=[
          'もんすたでぃから開発者へのメッセージが届きました。',
          '',
          `ユーザーID: ${user.uid}`,
          `ページ: ${page}`,
          `送信日時: ${timestamp}`,
          '',
          '--- メッセージ ---',
          message
        ].join('\n');
        upstream=await fetchImpl('https://api.resend.com/emails',{
          method:'POST',
          headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},
          body:JSON.stringify({from,to:[to],subject:'【もんすたでぃ】開発者へのメッセージ',text}),
          signal:AbortSignal.timeout(12000)
        });
      }else{
        upstream=await fetchImpl(`https://formsubmit.co/ajax/${encodeURIComponent(to)}`,{
          method:'POST',
          headers:{'Content-Type':'application/json','Accept':'application/json'},
          body:JSON.stringify({
            _subject:'【もんすたでぃ】開発者へのメッセージ',
            _template:'table',
            _captcha:'false',
            _url:'https://k-oota-pixel.github.io/english-playroom/',
            service:'もんすたでぃ',
            user_id:user.uid,
            page,
            sent_at:timestamp,
            message
          }),
          signal:AbortSignal.timeout(12000)
        });
      }

      if(!upstream.ok){
        let detail='';try{detail=await upstream.text();}catch{}
        console.error('Contact email send failed',{status:upstream.status,detail:detail.slice(0,300)});
        throw fail('メッセージを送信できませんでした。少し待ってもう一度お試しください。',502);
      }
      return send(res,200,{ok:true});
    }catch(error){
      return send(res,error.status||500,{error:error.message||'メッセージを送信できませんでした。'});
    }
  };
}
