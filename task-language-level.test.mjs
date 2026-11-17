import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

for (const name of ['index.html', 'public/index.html']) {
  test(name + ': task hints and samples use accessible beginner expressions', () => {
    const html = readFileSync(new URL('./' + name, import.meta.url), 'utf8');
    const source = html.match(/const TASKS=(\[[\s\S]*?\]);\s/);
    assert.ok(source, 'TASKS must exist');
    const tasks = JSON.parse(source[1]);
    assert.equal(tasks.length, 50);
    for (const task of tasks) {
      assert.equal(task.hints.length, 3);
      for (const phrase of [...task.hints, task.sample]) {
        assert.doesNotMatch(phrase, /I['’]d\b|\bwould (?:you )?like\b/i, task.id);
      }
    }
    assert.equal(tasks.find(t => t.id === 'quest50-31').sample, 'I want to try on this jacket.');
    assert.equal(tasks.find(t => t.id === 'quest50-04').sample, 'What do you want to drink?');
    assert.equal(tasks.find(t => t.id === 'quest50-46').sample, 'Can I have a burger and a drink, please?');
  });
}

test('AI instructions favor basic expressions without penalizing students using correct polite forms', () => {
  const server = readFileSync(new URL('./server.mjs', import.meta.url), 'utf8');
  assert.match(server, /【ヒントや改善例の英語レベル】/);
  assert.match(server, /生徒が自分で使った自然で正しい表現はそのまま正解として認め/);
});
