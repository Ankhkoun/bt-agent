import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJiti } from '../desktop/node_modules/jiti/lib/jiti.mjs';

const jiti = createJiti(import.meta.url);
const harness = await jiti.import('../desktop/lib/bt-harness.ts');
const runner = await jiti.import('../desktop/lib/bt-harness-runner.ts');

function fixture() {
  const root = join(tmpdir(), `bt-runner-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(root, { recursive: true });
  return root;
}

function fakeSession() {
  const listeners = new Set();
  return {
    sessionId: 'fixture-session',
    onEvent(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async send(command) {
      assert.equal(command.type, 'prompt');
      const emit = (event) => { for (const listener of listeners) listener(event); };
      emit({ type: 'agent_start' });
      emit({ type: 'tool_execution_start', toolCallId: 'tool-1', toolName: 'read', args: { path: 'README.md' } });
      emit({ type: 'tool_execution_end', toolCallId: 'tool-1', toolName: 'read', result: { content: [{ type: 'text', text: 'BT-Agent is a local-first personal harness.' }] } });
      const message = { role: 'assistant', content: [{ type: 'text', text: '# Research Report\n\nThe repository uses a persistent Harness Kernel.' }] };
      emit({ type: 'message_end', message });
      emit({ type: 'agent_end', messages: [message] });
    },
  };
}

test('Research Runner persists tool actions, evidence, report artifact and approval gate', async () => {
  const root = fixture();
  try {
    const task = harness.createTask({ workflowId: 'research', objective: '研究 BT-Agent Harness', scope: root }, root);
    const run = harness.startRun(task.id, root);
    await runner.executeHarnessRun(run.id, { root, createSession: async () => fakeSession(), timeoutMs: 1_000 });
    const detail = harness.getTask(task.id, root);
    assert.ok(detail);
    assert.equal(detail.runs[0].status, 'waiting_approval');
    assert.equal(detail.steps.find((step) => step.kind === 'scope').status, 'completed');
    assert.equal(detail.steps.find((step) => step.kind === 'collect').status, 'completed');
    assert.equal(detail.steps.find((step) => step.kind === 'analyze').status, 'completed');
    assert.equal(detail.steps.find((step) => step.kind === 'artifact').status, 'completed');
    assert.equal(detail.actions[0].toolName, 'read');
    assert.equal(detail.actions[0].status, 'succeeded');
    assert.match(detail.evidence[0].quote, /local-first/);
    assert.equal(detail.artifacts[0].kind, 'research-report');
    assert.equal(detail.approvals[0].decision, 'pending');
    assert.ok(detail.events.some((event) => event.type === 'agent_tool_execution_start'));
    assert.ok(detail.events.some((event) => event.type === 'action_completed'));
    harness.resolveApproval(detail.approvals[0].id, 'approved', root);
    await runner.executeHarnessRun(run.id, { root, createSession: async () => fakeSession(), timeoutMs: 1_000 });
    const completed = harness.getTask(task.id, root);
    assert.equal(completed.runs[0].status, 'completed');
    assert.equal(completed.evaluations[0].result, 'pass');
    assert.equal(completed.steps.at(-1).status, 'completed');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Research Runner blocks a write-capable tool and records approval', async () => {
  const root = fixture();
  try {
    const task = harness.createTask({ workflowId: 'research', objective: '拒绝写入操作', scope: root }, root);
    const run = harness.startRun(task.id, root);
    const session = fakeSession();
    session.send = async () => {
      const message = { role: 'assistant', content: [{ type: 'text', text: 'blocked' }] };
      for (const listener of [...session.listeners ?? []]) listener({ type: 'tool_execution_start', toolCallId: 'tool-write', toolName: 'write', args: { path: 'x.md' } });
    };
    // Use a purpose-built session so the listener set remains observable.
    const listeners = new Set();
    const guarded = {
      sessionId: 'guarded-session',
      onEvent(listener) { listeners.add(listener); return () => listeners.delete(listener); },
      async send() { for (const listener of listeners) listener({ type: 'tool_execution_start', toolCallId: 'tool-write', toolName: 'write', args: { path: 'x.md' } }); for (const listener of listeners) listener({ type: 'agent_end', messages: [] }); },
    };
    await runner.executeHarnessRun(run.id, { root, createSession: async () => guarded, timeoutMs: 1_000 });
    const detail = harness.getTask(task.id, root);
    assert.equal(detail.runs[0].status, 'waiting_approval');
    assert.equal(detail.actions[0].status, 'blocked');
    assert.equal(detail.actions[0].riskLevel, 'L2');
    assert.equal(detail.approvals[0].riskLevel, 'L2');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
