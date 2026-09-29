import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJiti } from '../node_modules/jiti/lib/jiti.mjs';
const jiti = createJiti(import.meta.url);
const { readPlanBook, savePlanItem, PlanConflict } = await jiti.import('./bt-planner.ts');
const { validDate, weekDates } = await jiti.import('./bt-planner-model.ts');
const item = (id, overrides = {}) => ({ id, title: '论文阅读', kind: 'task', status: 'todo', date: '2026-09-18', project: '论文', priority: 'P2', goalId: '', notes: '', completedOn: '', updatedAt: '', ...overrides });
test('calendar dates handle leap years and year-crossing Monday weeks', () => {
  assert.equal(validDate('2024-02-29'), true);
  assert.equal(validDate('2025-02-29'), false);
  assert.deepEqual(weekDates('2027-01-01'), ['2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03']);
});
test('planner persists links and completion, rejects stale edits and preserves corrupt data', () => {
  const root = mkdtempSync(join(tmpdir(), 'bt-planner-'));
  try {
    assert.deepEqual(readPlanBook(root), { revision: 0, items: [] });
    savePlanItem(item('goal', { kind: 'goal' }), 0, root);
    savePlanItem(item('task', { goalId: 'goal', status: 'done', completedOn: '2026-09-17', notes: '已读并做笔记' }), 1, root);
    assert.equal(readPlanBook(root).items[1].completedOn, '2026-09-17');
    assert.throws(() => savePlanItem(item('task'), 1, root), PlanConflict);
    assert.throws(() => savePlanItem(item('goal'), 2, root), /关联事项/);
    assert.throws(() => savePlanItem(item('bad', { goalId: 'missing' }), 2, root), /关联目标/);
    assert.throws(() => savePlanItem(item('bad', { status: 'done' }), 2, root), /完成日期/);
    assert.equal(readPlanBook(root).revision, 2);
    const path = join(root, '.bt', 'planner.json');
    writeFileSync(path, '{bad');
    assert.throws(() => savePlanItem(item('new'), 2, root));
    assert.equal(readFileSync(path, 'utf8'), '{bad');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
