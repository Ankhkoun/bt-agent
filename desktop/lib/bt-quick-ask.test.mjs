import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';
const jiti = createJiti(import.meta.url);
const { parseQuickAsk, boundedQuickHistory, quickAskPrompt } = await jiti.import('./bt-quick-ask-model.ts');
const input = { provider: 'fixture', modelId: 'fixture', question: 'Session 是什么？', quote: '引用', history: [] };
test('旁问仅接受显式字段，主会话和 Memory 不进入 prompt', () => {
  const parsed = parseQuickAsk({ ...input, sessionId: 'secret-session', memory: 'secret-memory', systemPrompt: 'override' });
  assert.deepEqual(parsed, input);
  const prompt = quickAskPrompt(parsed);
  assert.match(prompt, /Session/);
  assert.match(prompt, /引用/);
  assert.doesNotMatch(prompt, /secret-session|secret-memory|override/);
});
test('拒绝空问题、无效历史和超出预算的输入', () => {
  for (const patch of [{ question: ' ' }, { quote: 'x'.repeat(6001) }, { history: [{}] }, { history: Array(9).fill({ question: 'q', answer: 'a' }) }, { history: Array(2).fill({ question: 'q', answer: 'a'.repeat(13000) }) }]) {
    assert.throws(() => parseQuickAsk({ ...input, ...patch }));
  }
});
test('历史保留最近完整问答，按轮数和字符双重限制，不拆分一轮', () => {
  const turns = Array.from({ length: 10 }, (_, i) => ({ question: `q${i}`, answer: 'a' }));
  assert.deepEqual(boundedQuickHistory(turns), turns.slice(-8));
  const large = turns.map(turn => ({ ...turn, answer: 'a'.repeat(10000) }));
  assert.deepEqual(boundedQuickHistory(large), large.slice(-2));
  assert.doesNotThrow(() => parseQuickAsk({ ...input, history: boundedQuickHistory(large) }));
});
