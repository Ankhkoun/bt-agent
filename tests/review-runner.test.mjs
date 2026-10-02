import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJiti } from '../desktop/node_modules/jiti/lib/jiti.mjs';

const jiti = createJiti(import.meta.url);
const harness = await jiti.import('../desktop/lib/bt-harness.ts');
const review = await jiti.import('../desktop/lib/bt-review-runner.ts');

test('Review Runner records read-only findings, evidence, report and evaluation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bt-review-runner-'));
  try {
    await mkdir(join(root, 'project'), { recursive: true });
    const listeners = new Set();
    const session = {
      sessionId: 'review-fixture-session',
      onEvent(listener) { listeners.add(listener); return () => listeners.delete(listener); },
      async send(command) {
        if (command.type === 'abort') return null;
        assert.equal(command.type, 'prompt');
        const emit = (event) => { for (const listener of [...listeners]) listener(event); };
        emit({ type: 'agent_start' });
        emit({ type: 'tool_execution_start', toolCallId: 'read-1', toolName: 'read', args: { path: 'src/index.ts' } });
        emit({ type: 'tool_execution_end', toolCallId: 'read-1', toolName: 'read', result: { content: [{ type: 'text', text: 'the implementation keeps user approval before writes' }] } });
        emit({ type: 'tool_execution_start', toolCallId: 'git-1', toolName: 'git', args: { command: 'diff --stat' } });
        emit({ type: 'tool_execution_end', toolCallId: 'git-1', toolName: 'git', result: { content: [{ type: 'text', text: '2 files changed' }] } });
        const message = { role: 'assistant', content: [{ type: 'text', text: '## Findings\n\n[P1] 审批边界需要人工确认。\n\n## Evidence\n\n引用实现和 Git Diff。\n\n## Risks\n\n真实模型执行仍未验证。\n\n## Next actions\n\n补充真人验收。' }] };
        emit({ type: 'message_end', message });
        emit({ type: 'agent_end', messages: [message] });
      },
    };
    const task = harness.createTask({ workflowId: 'review', objective: '审查 Harness 的审批边界', scope: join(root, 'project') }, root);
    const run = harness.startRun(task.id, root);
    await review.executeReviewRun(run.id, { root, createSession: async () => session, timeoutMs: 1_000 });
    const detail = harness.getTask(task.id, root);
    assert.ok(detail);
    assert.equal(detail.runs[0].status, 'completed');
    assert.equal(detail.steps.find((step) => step.kind === 'scope').status, 'completed');
    assert.equal(detail.steps.find((step) => step.kind === 'inspect').status, 'completed');
    assert.equal(detail.steps.find((step) => step.kind === 'findings').status, 'completed');
    assert.equal(detail.steps.find((step) => step.kind === 'artifact').status, 'completed');
    assert.equal(detail.actions.length, 2);
    assert.equal(detail.actions.every((action) => action.status === 'succeeded'), true);
    assert.equal(detail.evidence.filter((item) => item.sourceType === 'review-tool').length, 2);
    assert.equal(detail.artifacts[0].kind, 'review-report');
    assert.equal(detail.evaluations[0].result, 'pass');
    assert.match(detail.evaluations[0].humanReview, /用户确认/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
