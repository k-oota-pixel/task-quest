const RETRYABLE_HTTP = new Set([500, 502, 503, 504]);
const FALLBACK_MODEL = 'gemini-3.1-flash-lite';

export function taskModels({backup = false, mainModel, backupModel}) {
  const selected = backup ? backupModel : mainModel;
  return [...new Set((backup ? [selected, FALLBACK_MODEL] : [selected]).filter(Boolean))];
}

export function validTaskResult(result) {
  return typeof result?.clear === 'boolean' &&
    typeof result.message === 'string' && result.message.length > 0 && result.message.length <= 1000 &&
    typeof result.example === 'string' && result.example.length <= 1000;
}

function taskBody(system, task, answer) {
  return JSON.stringify({
    systemInstruction: {parts: [{text: system}]},
    contents: [{role: 'user', parts: [{text: JSON.stringify({situation: task.situation, task: task.task, studentAnswer: answer})}]}],
    generationConfig: {
      temperature: 0.2, maxOutputTokens: 1024, thinkingConfig: {thinkingLevel: 'minimal'},
      responseMimeType: 'application/json',
      responseSchema: {type: 'OBJECT', properties: {clear: {type: 'BOOLEAN'}, message: {type: 'STRING'}, example: {type: 'STRING'}}, required: ['clear', 'message', 'example']}
    }
  });
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// A single logical answer check. Retry only transient errors; never immediately retry quota (429).
// A second stable model is tried only when the backup model returns 404.
export async function callTaskGemini({apiKey, models, system, task, answer, fetchImpl = fetch, sleep = delay, now = Date.now, totalMs = 38000}) {
  const started = now();
  const body = taskBody(system, task, answer);
  let last = {ok: false, status: 502, reason: 'upstream', model: models[0] || ''};
  for (const [modelIndex, model] of models.entries()) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const remaining = totalMs - (now() - started);
      if (remaining < 750) return {...last, status: 504, reason: 'timeout'};
      let response;
      try {
        response = await fetchImpl('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent', {
          method: 'POST',
          headers: {'Content-Type': 'application/json', 'x-goog-api-key': apiKey},
          signal: AbortSignal.timeout(Math.min(remaining, attempt === 0 ? 22000 : 8000)),
          body
        });
      } catch {
        last = {ok: false, status: 504, reason: 'network', model};
        if (attempt === 2) return last;
        await sleep(350 * (attempt + 1));
        continue;
      }
      if (!response.ok) {
        last = {ok: false, status: response.status, reason: response.status === 404 ? 'model' : 'upstream', model};
        if (response.status === 404 && modelIndex + 1 < models.length) break;
        if (!RETRYABLE_HTTP.has(response.status) || attempt === 2) return last;
        await sleep(350 * (attempt + 1));
        continue;
      }
      try {
        const data = await response.json();
        const candidate = data.candidates?.[0];
        if (candidate?.finishReason !== 'STOP') throw Error('Unfinished Gemini response');
        const raw = candidate.content?.parts?.filter(part => !part.thought).map(part => part.text || '').join('') || '';
        const result = JSON.parse(raw);
        if (!validTaskResult(result)) throw Error('Malformed Gemini response');
        return {ok: true, result, model};
      } catch {
        last = {ok: false, status: 502, reason: 'invalid', model};
        if (attempt === 2) return last;
        await sleep(350 * (attempt + 1));
      }
    }
  }
  return last;
}
