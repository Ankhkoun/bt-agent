import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJiti } from '../desktop/node_modules/jiti/lib/jiti.mjs';

const jiti = createJiti(import.meta.url);
const harness = await jiti.import('../desktop/lib/bt-harness.ts');

function fixture() {
  const root = join(tmpdir(), `bt-harness-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(join(root, '.bt'), { recursive: true });
  writeFileSync(join(root, '.bt', 'planner.json'), JSON.stringify({ revision: 1, items: [{ id: 'legacy-task', title: '旧计划', kind: 'task', status: 'todo', date: '2026-10-01', project: '测试', priority: 'P2', goalId: '', notes: '迁移', completedOn: '', updatedAt: '2026-10-01T00:00:00.000Z', steps: [] }] }));
  writeFileSync(join(root, '.bt', 'notebooks.json'), JSON.stringify({ revision: 1, books: [{ id: 'legacy-book', name: '旧笔记' }], notes: [{ id: 'legacy-note', notebookId: 'legacy-book', text: '迁移记录', createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z' }] }));
  return root;
}

test('Harness Kernel creates a research run, persists events, resumes and records evidence', () => {
  const root = fixture();
  try {
    const overview = harness.readHarnessOverview(root);
    assert.equal(overview.tasks.length, 1);
    assert.equal(overview.tasks[0].objective, '旧计划');
    assert.ok(readdirSync(join(root, '.bt')).some((name) => name.startsWith('planner.json.before-harness-')));

    const task = harness.createTask({ workflowId: 'research', objective: '研究 Harness 架构', scope: 'README 与 desktop/lib', acceptanceCriteria: ['生成报告', '保存证据'] }, root);
    assert.equal(task.status, 'draft');
    const run = harness.startRun(task.id, root);
    assert.equal(run.status, 'running');
    let detail = harness.getTask(task.id, root);
    assert.ok(detail);
    assert.equal(detail.runs[0].status, 'running');
    assert.equal(detail.steps[0].status, 'running');

    const evidence = harness.recordEvidence({ taskId: task.id, runId: run.id, stepId: detail.steps[0].id, sourceType: 'file', filePath: 'README.md', locator: 'L1', quote: 'BT-Agent' }, root);
    const artifact = harness.createArtifact({ taskId: task.id, runId: run.id, kind: 'report', path: '.bt/artifacts/research.md', content: '# report', summary: '研究报告' }, root);
    assert.equal(evidence.contentHash.length, 64);
    assert.equal(artifact.contentHash.length, 64);

    harness.markStep({ stepId: detail.steps[0].id, status: 'completed', output: { evidenceId: evidence.id } }, root);
    detail = harness.getTask(task.id, root);
    assert.equal(detail.steps[1].status, 'running');
    harness.pauseRun(run.id, root);
    assert.equal(harness.getTask(task.id, root).runs[0].status, 'paused');
    harness.resumeRun(run.id, root);
    assert.equal(harness.getTask(task.id, root).runs[0].status, 'running');
    const evaluation = harness.evaluateTask({ taskId: task.id, runId: run.id, criteria: [{ criterion: '生成报告', passed: true, evidenceIds: [evidence.id], note: '产物已创建' }, { criterion: '保存证据', passed: true, evidenceIds: [evidence.id], note: '文件引用有效' }] }, root);
    assert.equal(evaluation.result, 'pass');
    detail = harness.getTask(task.id, root);
    assert.equal(detail.artifacts[0].summary, '研究报告');
    assert.equal(detail.evidence[0].quote, 'BT-Agent');
    assert.ok(detail.events.some((item) => item.type === 'run_started'));
    assert.ok(detail.events.some((item) => item.type === 'evaluation_completed'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('Harness approval blocks a run and only an explicit decision resumes it', () => {
  const root = fixture();
  try {
    const task = harness.createTask({ workflowId: 'build', objective: '修改并验证项目', acceptanceCriteria: ['完成修改'] }, root);
    const run = harness.startRun(task.id, root);
    const approval = harness.requestApproval({ taskId: task.id, runId: run.id, riskLevel: 'L2', scope: '编辑项目文件', reason: '需要执行工程修改' }, root);
    assert.equal(approval.decision, 'pending');
    assert.equal(harness.getTask(task.id, root).runs[0].status, 'waiting_approval');
    harness.resolveApproval(approval.id, 'rejected', root);
    assert.equal(harness.getTask(task.id, root).runs[0].status, 'failed');
    assert.throws(() => harness.resolveApproval(approval.id, 'approved', root), /已经处理/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('Harness enforces step transitions and expires stale approvals', () => {
  const root = fixture();
  try {
    const task = harness.createTask({ workflowId: 'build', objective: '状态边界', acceptanceCriteria: ['完成'] }, root);
    const run = harness.startRun(task.id, root);
    const detail = harness.getTask(task.id, root);
    assert.throws(() => harness.markStep({ stepId: detail.steps[1].id, status: 'completed' }, root), /步骤不能从 pending/);
    const approval = harness.requestApproval({ taskId: task.id, runId: run.id, stepId: detail.steps[0].id, riskLevel: 'L2', scope: 'fixture', reason: 'fixture', expiresAt: '2000-01-01T00:00:00.000Z' }, root);
    const resolved = harness.resolveApproval(approval.id, 'approved', root);
    assert.equal(resolved.decision, 'expired');
    const retryRun = harness.getTask(task.id, root).runs[0];
    assert.equal(retryRun.failureReason, '审批已过期');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
