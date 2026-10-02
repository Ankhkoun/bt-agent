import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJiti } from '../desktop/node_modules/jiti/lib/jiti.mjs';

const jiti = createJiti(import.meta.url);
const harness = await jiti.import('../desktop/lib/bt-harness.ts');
const interviewer = await jiti.import('../desktop/lib/bt-interviewer-runner.ts');

function fixture() {
  const root = join(tmpdir(), `bt-interviewer-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(root, { recursive: true });
  return root;
}
function fakeSession() {
  const listeners = new Set();
  let turn = 0;
  return {
    sessionId: 'interviewer-fixture-session',
    sessionFile: 'interviewer-fixture-session.jsonl',
    onEvent(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async send(command) {
      if (command.type === 'abort') return null;
      assert.equal(command.type, 'prompt');
      const texts = [
        '核心问题：请说明 Harness 为什么需要 Evidence。',
        '追问：如果没有用户审批，Evidence 和 Artifact 的边界会怎样？',
        '# 面试评价\n\n回答能区分证据与产物，但还需要补充失败恢复和审批过期的取舍。',
      ];
      const message = { role: 'assistant', content: [{ type: 'text', text: texts[turn++] }] };
      for (const listener of [...listeners]) listener({ type: 'agent_start' });
      for (const listener of [...listeners]) listener({ type: 'message_end', message });
      for (const listener of [...listeners]) listener({ type: 'agent_end', messages: [message] });
    },
  };
}

test('Interviewer Runner pauses for two answers and produces an evaluation report', async () => {
  const root = fixture();
  try {
    const task = harness.createTask({ workflowId: 'interviewer', objective: 'BT-Agent Harness 架构', scope: root }, root);
    const run = harness.startRun(task.id, root);
    const session = fakeSession();
    const createSession = async () => session;
    await interviewer.executeInterviewerRun(run.id, { root, createSession, timeoutMs: 1_000 });
    let detail = harness.getTask(task.id, root);
    assert.ok(detail);
    assert.equal(detail.runs[0].status, 'paused');
    assert.equal(detail.steps.find((step) => step.kind === 'ask').status, 'running');
    await interviewer.submitInterviewerInput(task.id, run.id, 'Evidence 保存来源事实，Artifact 保存处理结果。', { root, createSession, timeoutMs: 1_000 });
    detail = harness.getTask(task.id, root);
    assert.equal(detail.runs[0].status, 'paused');
    assert.equal(detail.steps.find((step) => step.kind === 'follow_up').status, 'running');
    await interviewer.submitInterviewerInput(task.id, run.id, '审批决定谁可以把结果写入正式 Memory。', { root, createSession, timeoutMs: 1_000 });
    detail = harness.getTask(task.id, root);
    assert.equal(detail.runs[0].status, 'completed');
    assert.equal(detail.evaluations[0].result, 'pass');
    assert.equal(detail.artifacts[0].kind, 'interview-report');
    assert.equal(detail.evidence.filter((item) => item.sourceType === 'interviewer-user').length, 2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
