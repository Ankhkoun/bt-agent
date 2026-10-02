import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { proposeMemory, readMemoryReview, reviewMemory, MemoryConflict } from '../desktop/lib/bt-memory.ts';
const source = { sessionId: 'isolated-session', cwd: 'fixture', mode: 'tutor', evidence: [{ entryId: 'user-1', role: 'user', quote: '我能解释上下文窗口，但不理解检索。' }] };
const input = { target: 'profile', kind: 'user_view', text: '希望学习 Agent。', reason: '长期学习方向' };
const sha = text => createHash('sha256').update(text).digest('hex');
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'bt-review-'));
  mkdirSync(join(root, 'memory'));
  writeFileSync(join(root, 'memory/profile.md'), '# 原有记录\n不得覆盖。\n');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
function review(root, id, action) { return reviewMemory(root, { id, action, revision: readMemoryReview(root).revision }); }

test('candidate remains outside Markdown, duplicate retry is idempotent, accept records provenance', t => {
  const root = fixture(t), path = join(root, 'memory/profile.md');
  const before = readFileSync(path, 'utf8');
  const p = proposeMemory(root, input, source);
  assert.equal(p.status, 'pending');
  assert.equal(readFileSync(path, 'utf8'), before);
  assert.equal(proposeMemory(root, input, source).id, p.id);
  assert.equal(readMemoryReview(root).revision, 1);
  review(root, p.id, 'accept');
  const text = readFileSync(path, 'utf8');
  assert.ok(text.startsWith(before));
  assert.match(text, /isolated-session/);
  assert.match(text, /user-1/);
  assert.match(text, /用户观点/);
  assert.match(text, /确认保存不等于验证 AI 结论/);
});
test('stale revision, changed Markdown and invalid transitions cannot overwrite history', t => {
  const root = fixture(t), path = join(root, 'memory/profile.md');
  const p = proposeMemory(root, input, source);
  assert.throws(() => reviewMemory(root, { id: p.id, action: 'accept', revision: 0 }), MemoryConflict);
  writeFileSync(path, '# 用户在外部编辑器新增的记录');
  assert.throws(() => review(root, p.id, 'accept'), MemoryConflict);
  assert.equal(readFileSync(path, 'utf8'), '# 用户在外部编辑器新增的记录');
  review(root, p.id, 'reject');
  assert.throws(() => review(root, p.id, 'accept'), MemoryConflict);
  assert.equal(readMemoryReview(root).proposals[0].status, 'rejected');
});
test('undo removes its own block while preserving subsequent edits and newer accepted records', t => {
  const root = fixture(t), path = join(root, 'memory/profile.md');
  const before = readFileSync(path, 'utf8');
  const first = proposeMemory(root, input, source); review(root, first.id, 'accept');
  const second = proposeMemory(root, { ...input, text: '第二条记录' }, source); review(root, second.id, 'accept');
  writeFileSync(path, readFileSync(path, 'utf8') + '\n额外人工记录');
  const state = review(root, first.id, 'undo');
  assert.equal(state.proposals[0].status, 'undone');
  const after = readFileSync(path, 'utf8');
  assert.ok(after.startsWith(before));
  assert.doesNotMatch(after, /希望学习 Agent/);
  assert.match(after, /第二条记录/);
  assert.match(after, /额外人工记录/);
});
test('edited accepted blocks are preserved instead of guessing how to undo', t => {
  const root = fixture(t), path = join(root, 'memory/profile.md');
  const p = proposeMemory(root, input, source); review(root, p.id, 'accept');
  const edited = readFileSync(path, 'utf8').replace(input.text, '用户修正的事实');
  writeFileSync(path, edited);
  assert.throws(() => review(root, p.id, 'undo'), MemoryConflict);
  assert.equal(readFileSync(path, 'utf8'), edited);
});
test('learning assessment requires answer evidence, boundaries and two distinct quotes for L3/L4', t => {
  const root = fixture(t);
  const assessment = { concept: '检索', level: 'L2', basis: '能够解释用途', gaps: '尚未应用到真实项目', nextQuestion: '换一份文档如何设计检索？' };
  const learning = { target: 'knowledge_map', kind: 'ai_explanation', text: '检索理解情况', reason: '学习复盘', assessment };
  assert.throws(() => proposeMemory(root, { ...learning, kind: 'fact' }, source));
  assert.throws(() => proposeMemory(root, { ...learning, assessment: undefined }, source));
  assert.throws(() => proposeMemory(root, { ...learning, assessment: { ...assessment, nextQuestion: '' } }, source));
  assert.throws(() => proposeMemory(root, { ...learning, assessment: { ...assessment, level: 'L4' } }, source));
  const p = proposeMemory(root, learning, source); review(root, p.id, 'accept');
  assert.match(readFileSync(join(root, 'memory/knowledge_map.md'), 'utf8'), /建议等级：L2（AI评估，待验证）/);
});
test('target whitelist, types and user provenance validation reject unsupported input', t => {
  const root = fixture(t);
  for (const target of ['../agent/auth', 'profile.md', '__proto__']) assert.throws(() => proposeMemory(root, { ...input, target }, source));
  assert.throws(() => proposeMemory(root, { ...input, kind: 'guess' }, source));
  assert.throws(() => proposeMemory(root, input, { ...source, evidence: [] }));
  assert.throws(() => proposeMemory(root, { ...input, kind: 'fact' }, { ...source, evidence: [{ entryId: 'a', role: 'assistant', quote: 'AI猜测' }] }));
  assert.throws(() => proposeMemory(root, { ...input, text: '<!-- BT_MEMORY:fake:start -->' }, source));
});
test('another BT process lock refuses simultaneous mutations', t => {
  const root = fixture(t);
  readMemoryReview(root);
  mkdirSync(join(root, '.bt/memory-review/lock'));
  assert.throws(() => proposeMemory(root, input, source), MemoryConflict);
  assert.throws(() => readMemoryReview(root), MemoryConflict);
});
test('interrupted transaction recovers from before-Markdown, after-Markdown and after-state stages exactly once', t => {
  for (const stage of ['before', 'markdown', 'state']) {
    const root = fixture(t), path = join(root, 'memory/profile.md');
    const p = proposeMemory(root, input, source);
    const before = readFileSync(path, 'utf8');
    const accepted = review(root, p.id, 'accept');
    const after = readFileSync(path, 'utf8');
    if (stage === 'before') writeFileSync(path, before);
    if (stage !== 'state') writeFileSync(join(root, '.bt/memory-review/state.json'), JSON.stringify({ ...accepted, revision: accepted.revision - 1, proposals: [{ ...p, status: 'pending' }] }));
    writeFileSync(join(root, '.bt/memory-review/transaction.json'), JSON.stringify({ target: 'profile', beforeHash: sha(before), afterHash: sha(after), afterText: after, state: accepted }));
    assert.equal(readMemoryReview(root).proposals[0].status, 'accepted');
    assert.equal(readFileSync(path, 'utf8'), after);
    assert.deepEqual(readMemoryReview(root), accepted);
  }
});
test('recovery refuses unrelated manual edits and retains the intent for diagnosis', t => {
  const root = fixture(t), path = join(root, 'memory/profile.md');
  const p = proposeMemory(root, input, source);
  const before = readFileSync(path, 'utf8');
  const state = readMemoryReview(root);
  writeFileSync(path, 'manual edit');
  const intent = { target: 'profile', beforeHash: sha(before), afterHash: sha('different'), afterText: 'different', state: { ...state, revision: state.revision + 1 } };
  writeFileSync(join(root, '.bt/memory-review/transaction.json'), JSON.stringify(intent));
  assert.throws(() => readMemoryReview(root), MemoryConflict);
  assert.equal(readFileSync(path, 'utf8'), 'manual edit');
  assert.equal(JSON.parse(readFileSync(join(root, '.bt/memory-review/transaction.json'), 'utf8')).beforeHash, sha(before));
  assert.equal(p.status, 'pending');
});
