const RETRYABLE = new Set([500, 502, 503, 504]);

export function normalizeVocabularyRequest(body) {
  if (!body || typeof body.prompt !== 'string') {
    throw Object.assign(new Error('AIへの依頼内容を確認してください。'), {status: 400});
  }
  const prompt = body.prompt.trim();
  if (!prompt || prompt.length > 12000) {
    throw Object.assign(new Error('AIへの依頼は1〜12,000文字で入力してください。'), {status: 400});
  }

  const input = body.generationConfig && typeof body.generationConfig === 'object'
    ? body.generationConfig : {};
  const requestedTokens = Number(input.maxOutputTokens);
  const maxOutputTokens = Number.isFinite(requestedTokens)
    ? Math.max(128, Math.min(4096, Math.floor(requestedTokens))) : 1024;
  const requestedTemperature = Number(input.temperature);
  const temperature = Number.isFinite(requestedTemperature)
    ? Math.max(0, Math.min(1, requestedTemperature)) : 0.4;
  const generationConfig = {temperature, maxOutputTokens};

  if (input.responseMimeType === 'application/json') {
    generationConfig.responseMimeType = 'application/json';
    if (input.responseSchema && typeof input.responseSchema === 'object') {
      const encoded = JSON.stringify(input.responseSchema);
      if (encoded.length > 4000) {
        throw Object.assign(new Error('AIの出力形式が大きすぎます。'), {status: 400});
      }
      generationConfig.responseSchema = input.responseSchema;
    }
  }
  return {prompt, generationConfig};
}

export async function callVocabularyGemini({apiKey, models, request, fetchImpl = fetch, sleep = ms => new Promise(resolve => setTimeout(resolve, ms))}) {
  if (!apiKey) return {ok: false, status: 503, reason: 'unconfigured'};
  const selectedModels = [...new Set((models || []).filter(model => typeof model === 'string' && /^[a-z0-9.-]{1,80}$/i.test(model)))];
  if (!selectedModels.length) return {ok: false, status: 503, reason: 'unconfigured'};
  const body = JSON.stringify({contents: [{parts: [{text: request.prompt}]}], generationConfig: request.generationConfig});
  let last = {ok: false, status: 502, reason: 'upstream'};

  for (const [modelIndex, model] of selectedModels.entries()) {
    for (let attempt = 0; attempt < 2; attempt++) {
      let response;
      try {
        response = await fetchImpl('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent', {
          method: 'POST',
          headers: {'Content-Type': 'application/json', 'x-goog-api-key': apiKey},
          body,
          signal: AbortSignal.timeout(25000)
        });
      } catch {
        last = {ok: false, status: 504, reason: 'network'};
        if (attempt === 0) await sleep(300);
        continue;
      }

      if (!response.ok) {
        last = {ok: false, status: response.status, reason: response.status === 404 ? 'model' : 'upstream'};
        if (response.status === 404 && modelIndex + 1 < selectedModels.length) break;
        if (!RETRYABLE.has(response.status) || attempt === 1) return last;
        await sleep(300);
        continue;
      }

      try {
        const data = await response.json();
        const candidate = data.candidates?.[0];
        const text = candidate?.content?.parts?.filter(part => !part.thought).map(part => part.text || '').join('').trim() || '';
        if (candidate?.finishReason !== 'STOP' || !text || text.length > 30000) throw Error('invalid response');
        return {ok: true, text, model};
      } catch {
        last = {ok: false, status: 502, reason: 'invalid'};
        if (attempt === 1) return last;
        await sleep(300);
      }
    }
  }
  return last;
}
