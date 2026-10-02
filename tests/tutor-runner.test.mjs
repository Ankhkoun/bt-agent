import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJiti } from '../desktop/node_modules/jiti/lib/jiti.mjs';

const jiti = createJiti(import.meta.url);
const harness = await jiti.import('../desktop/lib/bt-harness.ts');
const tutor = await jiti.import('../desktop/lib/bt-tutor-runner.ts');
const memory = await jiti.import('../desktop/lib/bt-memory.ts');

function fixture() {
  const root = join(tmpdir(), `bt-tutor-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(root, { recursive: true });
  return root;
}

function fakeSession() {
  const listeners = new Set();
  let turn = 0;
  return {
    sessionId: 'tutor-fixture-session',
    sessionFile: 'tutor-fixture-session.jsonl',
    onEvent(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async send(command) {
      if (command.type === 'abort') return null;
      assert.equal(command.type, 'prompt');
      const texts = [
        '# 诊断与教学\n\n这是核心概念的最小解释。请先用自己的话复述。',
        '# 复述反馈\n\n你的复述抓住了主要关系。现在请回答：如果约束改变，结论会怎样变化？',
        '# 变式评价\n\n你能把概念迁移到新场景，边界仍需通过后续复习巩固。',
      ];
      const message = { role: 'assistant', content: [{ type: 'text', text: texts[turn++] }] };
      for (const listener of [...listeners]) listener({ type: 'agent_start' });
      for (const listener of [...listeners]) listener({ type: 'message_end', message });
      for (const listener of [...listeners]) listener({ type: 'agent_end', messages: [message] });
    },
  };
}

test('Tutor Runner pauses for recall and variant answers, then evaluates and proposes memory', async () => {
  const root = fixture();
  try {
    const task = harness.createTask({ workflowId: 'tutor', objective: '理解 Harness 状态机', scope: root }, root);
    const run = harness.startRun(task.id, root);
    const session = fakeSession();
    const createSession = async () => session;

    await tutor.executeTutorRun(run.id, { root, createSession, timeoutMs: 1_000 });
    let detail = harness.getTask(task.id, root);
    assert.ok(detail);
    assert.equal(detail.runs[0].status, 'paused');
    assert.equal(detail.steps.find((step) => step.kind === 'recall').status, 'running');
    assert.ok(detail.evidence.some((item) => item.sourceType === 'tutor-assistant'));
    assert.ok(detail.events.some((event) => event.type === 'user_input_required'));

    await tutor.submitTutorInput(task.id, run.id, '状态机通过固定状态和迁移约束运行。', { root, createSession, timeoutMs: 1_000 });
    detail = harness.getTask(task.id, root);
    assert.equal(detail.runs[0].status, 'paused');
    assert.equal(detail.steps.find((step) => step.kind === 'variant').status, 'running');
    assert.ok(detail.evidence.some((item) => item.sourceType === 'tutor-user'));

    await tutor.submitTutorInput(task.id, run.id, '如果审批过期，运行应进入失败并保留原因。', { root, createSession, timeoutMs: 1_000 });
    detail = harness.getTask(task.id, root);
    assert.equal(detail.runs[0].status, 'completed');
    assert.equal(detail.evaluations[0].result, 'pass');
    assert.equal(detail.artifacts[0].kind, 'tutor-learning-log');
    assert.ok(detail.evidence.filter((item) => item.sourceType === 'tutor-user').length === 2);
    assert.ok(memory.readMemoryReview(root).proposals.some((proposal) => proposal.target === 'knowledge_map'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
