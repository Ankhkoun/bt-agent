import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJiti } from '../desktop/node_modules/jiti/lib/jiti.mjs';

const jiti = createJiti(import.meta.url);
const harness = await jiti.import('../desktop/lib/bt-harness.ts');
const affairs = await jiti.import('../desktop/lib/bt-personal-affairs-runner.ts');

test('Personal Affairs proposes locally, waits for approval, then records plan and review note', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bt-personal-affairs-'));
  try {
    const task = harness.createTask({
      workflowId: 'personal-affairs',
      objective: '办理实习材料',
      scope: '周五前完成；需要整理证明材料',
      metadata: { date: '2026-10-09', project: 'career', priority: 'P1' },
    }, root);
    const run = harness.startRun(task.id, root);
    affairs.executePersonalAffairsRun(run.id, { root });
    let detail = harness.getTask(task.id, root);
    assert.ok(detail);
    assert.equal(detail.runs[0].status, 'waiting_approval');
    assert.equal(detail.steps.find((step) => step.kind === 'capture').status, 'completed');
    assert.equal(detail.steps.find((step) => step.kind === 'clarify').status, 'completed');
    assert.equal(detail.steps.find((step) => step.kind === 'schedule').status, 'waiting_approval');
    assert.equal(detail.artifacts[0].kind, 'affairs-proposal');
    await assert.rejects(() => readFile(join(root, '.bt', 'planner.json'), 'utf8'), { code: 'ENOENT' });

    harness.resolveApproval(detail.approvals.find((approval) => approval.decision === 'pending').id, 'approved', root);
    affairs.executePersonalAffairsRun(run.id, { root });
    detail = harness.getTask(task.id, root);
    assert.equal(detail.runs[0].status, 'completed');
    assert.equal(detail.steps.find((step) => step.kind === 'review').status, 'completed');
    assert.equal(detail.evaluations[0].result, 'pass');
    const plan = JSON.parse(await readFile(join(root, '.bt', 'planner.json'), 'utf8'));
    assert.equal(plan.items[0].title, '办理实习材料');
    assert.equal(plan.items[0].date, '2026-10-09');
    const notes = JSON.parse(await readFile(join(root, '.bt', 'notebooks.json'), 'utf8'));
    assert.match(notes.notes[0].text, /待复盘/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
