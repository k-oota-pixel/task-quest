import test from 'node:test';
import assert from 'node:assert/strict';
import {callVocabularyGemini, normalizeVocabularyRequest} from './vocabulary-gemini.mjs';

const request = normalizeVocabularyRequest({
  prompt: 'Generate a short memory hint.',
  generationConfig: {temperature: 0.6, maxOutputTokens: 700}
});
const success = {candidates: [{finishReason: 'STOP', content: {parts: [{text: 'A concise learning hint.'}]}}]};
const response = (status, body = success) => ({ok: status === 200, status, json: async () => body});

test('normalizes output limits and accepts JSON response schemas', () => {
  const normalized = normalizeVocabularyRequest({prompt: '  Write examples.  ', generationConfig: {
    temperature: 4, maxOutputTokens: 9000, responseMimeType: 'application/json',
    responseSchema: {type: 'OBJECT', properties: {sentences: {type: 'ARRAY'}}}
  }});
  assert.equal(normalized.prompt, 'Write examples.');
  assert.equal(normalized.generationConfig.temperature, 1);
  assert.equal(normalized.generationConfig.maxOutputTokens, 4096);
  assert.equal(normalized.generationConfig.responseMimeType, 'application/json');
});

test('rejects missing and oversized prompts', () => {
  assert.throws(() => normalizeVocabularyRequest({prompt: ' '}), error => error.status === 400);
  assert.throws(() => normalizeVocabularyRequest({prompt: 'x'.repeat(12001)}), error => error.status === 400);
});

test('does not retry quota errors', async () => {
  let calls = 0;
  const result = await callVocabularyGemini({apiKey: 'test-key', models: ['gemini-test'], request,
    fetchImpl: async () => { calls++; return response(429); }, sleep: async () => {}});
  assert.equal(calls, 1);
  assert.equal(result.status, 429);
});

test('retries temporary errors and returns only generated text', async () => {
  let calls = 0;
  const result = await callVocabularyGemini({apiKey: 'test-key', models: ['gemini-test'], request,
    fetchImpl: async () => response(++calls === 1 ? 503 : 200), sleep: async () => {}});
  assert.equal(calls, 2);
  assert.deepEqual(result, {ok: true, text: 'A concise learning hint.', model: 'gemini-test'});
});

test('uses the next configured model after a 404', async () => {
  const urls = [];
  const result = await callVocabularyGemini({apiKey: 'test-key', models: ['retired-model', 'current-model'], request,
    fetchImpl: async url => { urls.push(url); return response(urls.length === 1 ? 404 : 200); }, sleep: async () => {}});
  assert.equal(urls.length, 2);
  assert.match(urls[1], /current-model/);
  assert.equal(result.ok, true);
});
