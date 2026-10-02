import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJiti } from '../desktop/node_modules/jiti/lib/jiti.mjs';

const jiti = createJiti(import.meta.url);
const harness = await jiti.import('../desktop/lib/bt-harness.ts');
const planner = await jiti.import('../desktop/lib/bt-planner-runner.ts');

test('Planner Runner requires approval before writing the formal plan book', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bt-planner-runner-'));
  try {
    const task = harness.createTask({ workflowId: 'planner', objective: '完成 Harness 面试准备', scope: '本周完成；每天安排一小时', metadata: { date: '2026-10-05', project: 'career', priority: 'P1' } }, root);
    const run = harness.startRun(task.id, root);
    planner.executePlannerRun(run.id, { root });
    let detail = harness.getTask(task.id, root);
    assert.ok(detail);
    assert.equal(detail.runs[0].status, 'waiting_approval');
    assert.equal(detail.steps.find((step) => step.kind === 'schedule').status, 'waiting_approval');
    assert.equal(detail.artifacts[0].kind, 'plan-proposal');
    await assert.rejects(() => readFile(join(root, '.bt', 'planner.json'), 'utf8'), { code: 'ENOENT' });

    harness.resolveApproval(detail.approvals[0].id, 'approved', root);
    planner.executePlannerRun(run.id, { root });
    detail = harness.getTask(task.id, root);
    assert.equal(detail.runs[0].status, 'completed');
    assert.equal(detail.evaluations[0].result, 'pass');
    const book = JSON.parse(await readFile(join(root, '.bt', 'planner.json'), 'utf8'));
    assert.equal(book.items[0].title, '完成 Harness 面试准备');
    assert.equal(book.items[0].date, '2026-10-05');
    assert.equal(book.items[0].priority, 'P1');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Personal Planning completes its review step after the approved schedule write', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bt-personal-planning-'));
  try {
    const task = harness.createTask({ workflowId: 'personal-planning', objective: '安排本周学习计划', scope: '每天一小时', metadata: { date: '2026-10-06', priority: 'P1' } }, root);
    const run = harness.startRun(task.id, root);
    planner.executePlannerRun(run.id, { root });
    let detail = harness.getTask(task.id, root);
    assert.ok(detail);
    assert.equal(detail.runs[0].status, 'waiting_approval');
    harness.resolveApproval(detail.approvals.find((approval) => approval.decision === 'pending').id, 'approved', root);
    planner.executePlannerRun(run.id, { root });
    detail = harness.getTask(task.id, root);
    assert.equal(detail.runs[0].status, 'completed');
    assert.equal(detail.steps.find((step) => step.kind === 'review').status, 'completed');
    assert.equal(detail.evaluations.at(-1).result, 'pass');
  } finally { await rm(root, { recursive: true, force: true }); }
});
