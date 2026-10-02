import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJiti } from '../desktop/node_modules/jiti/lib/jiti.mjs';

const jiti = createJiti(import.meta.url);
const harness = await jiti.import('../desktop/lib/bt-harness.ts');
const build = await jiti.import('../desktop/lib/bt-build-runner.ts');

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'bt-build-runner-'));
  await mkdir(join(root, 'project'), { recursive: true });
  return root;
}

function fakeSessionFactory(modes) {
  let turn = 0;
  return async (cwd, key, sessionFile, mode) => {
    modes.push({ cwd, key, sessionFile, mode });
    const listeners = new Set();
    return {
      sessionId: `build-fixture-${turn}`,
      sessionFile: sessionFile ?? `build-fixture-${turn}.jsonl`,
      onEvent(listener) { listeners.add(listener); return () => listeners.delete(listener); },
      async send(command) {
        if (command.type === 'abort') return null;
        assert.equal(command.type, 'prompt');
        const emit = (event) => { for (const listener of [...listeners]) listener(event); };
        emit({ type: 'agent_start' });
        if (mode === 'readonly') {
          emit({ type: 'tool_execution_start', toolCallId: `read-${turn}`, toolName: 'read', args: { path: 'README.md' } });
          emit({ type: 'tool_execution_end', toolCallId: `read-${turn}`, toolName: 'read', result: { content: [{ type: 'text', text: 'scope inspected' }] } });
        } else if (turn === 1) {
          emit({ type: 'tool_execution_start', toolCallId: 'edit-1', toolName: 'edit', args: { path: 'src/index.ts' } });
          emit({ type: 'tool_execution_end', toolCallId: 'edit-1', toolName: 'edit', result: { content: [{ type: 'text', text: 'file edited' }] } });
        } else {
          emit({ type: 'tool_execution_start', toolCallId: 'verify-1', toolName: 'powershell', args: { command: 'npm test' } });
          emit({ type: 'tool_execution_end', toolCallId: 'verify-1', toolName: 'powershell', result: { content: [{ type: 'text', text: 'tests passed' }] } });
        }
        const message = { role: 'assistant', content: [{ type: 'text', text: turn === 0 ? '# Build 计划\n\n检查完成。' : turn === 1 ? '# 修改完成\n\n已完成代码编辑。' : '# 验证完成\n\n测试通过。' }] };
        emit({ type: 'message_end', message });
        emit({ type: 'agent_end', messages: [message] });
        turn += 1;
      },
    };
  };
}

test('Build Runner executes inspect, edit and verify phases behind approvals', async () => {
  const root = await fixture();
  try {
    const modes = [];
    const task = harness.createTask({ workflowId: 'build', objective: '实现并验证一个小功能', scope: join(root, 'project') }, root);
    const run = harness.startRun(task.id, root);
    const createSession = fakeSessionFactory(modes);

    await build.executeBuildRun(run.id, { root, createSession, timeoutMs: 1_000 });
    let detail = harness.getTask(task.id, root);
    assert.ok(detail);
    assert.equal(detail.runs[0].status, 'waiting_approval');
    assert.equal(detail.steps.find((step) => step.kind === 'scope').status, 'completed');
    assert.equal(detail.steps.find((step) => step.kind === 'inspect').status, 'completed');
    assert.equal(detail.steps.find((step) => step.kind === 'edit').status, 'waiting_approval');
    assert.equal(detail.artifacts[0].kind, 'build-plan');
    assert.equal(detail.actions[0].toolName, 'read');
    assert.equal(detail.actions[0].status, 'succeeded');
    assert.equal(modes[0].mode, 'readonly');

    harness.resolveApproval(detail.approvals.find((approval) => approval.decision === 'pending').id, 'approved', root);
    await build.executeBuildRun(run.id, { root, createSession, timeoutMs: 1_000 });
    detail = harness.getTask(task.id, root);
    assert.equal(detail.runs[0].status, 'waiting_approval');
    assert.equal(detail.steps.find((step) => step.kind === 'edit').status, 'completed');
    assert.equal(detail.steps.find((step) => step.kind === 'verify').status, 'waiting_approval');
    assert.equal(detail.actions.find((action) => action.toolName === 'edit').status, 'succeeded');

    harness.resolveApproval(detail.approvals.find((approval) => approval.decision === 'pending').id, 'approved', root);
    await build.executeBuildRun(run.id, { root, createSession, timeoutMs: 1_000 });
    detail = harness.getTask(task.id, root);
    assert.equal(detail.runs[0].status, 'completed');
    assert.equal(detail.steps.at(-1).status, 'completed');
    assert.equal(detail.actions.find((action) => action.toolName === 'powershell').status, 'succeeded');
    assert.equal(detail.artifacts.at(-1).kind, 'build-report');
    assert.equal(detail.evaluations.at(-1).result, 'pass');
    assert.equal(modes.filter((entry) => entry.mode === 'full').length, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Build Runner blocks an unapproved L2 tool and failed steps can be retried', async () => {
  const root = await fixture();
  try {
    const task = harness.createTask({ workflowId: 'build', objective: '拒绝未审批的写入', scope: root }, root);
    const run = harness.startRun(task.id, root);
    const listeners = new Set();
    const guarded = {
      sessionId: 'build-guarded-session',
      onEvent(listener) { listeners.add(listener); return () => listeners.delete(listener); },
      async send(command) {
        if (command.type === 'abort') return null;
        for (const listener of [...listeners]) listener({ type: 'tool_execution_start', toolCallId: 'write-1', toolName: 'write', args: { path: 'x.ts' } });
        const message = { role: 'assistant', content: [{ type: 'text', text: 'blocked' }] };
        for (const listener of [...listeners]) listener({ type: 'message_end', message });
        for (const listener of [...listeners]) listener({ type: 'agent_end', messages: [message] });
      },
    };
    await build.executeBuildRun(run.id, { root, createSession: async () => guarded, timeoutMs: 1_000 });
    let detail = harness.getTask(task.id, root);
    assert.ok(detail);
    assert.equal(detail.runs[0].status, 'waiting_approval');
    assert.equal(detail.actions[0].status, 'blocked');
    assert.equal(detail.actions[0].riskLevel, 'L2');
    assert.equal(detail.approvals[0].riskLevel, 'L2');

    const failedStep = detail.steps.find((step) => step.kind === 'scope');
    assert.ok(failedStep);
    harness.markStep({ stepId: failedStep.id, status: 'failed', failureReason: 'fixture failure' }, root);
    const retried = harness.retryStep(failedStep.id, root);
    assert.equal(retried.status, 'running');
    assert.equal(retried.attempt, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
