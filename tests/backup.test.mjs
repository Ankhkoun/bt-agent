import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createJiti } from '../desktop/node_modules/jiti/lib/jiti.mjs';

const jiti = createJiti(import.meta.url);
const backup = await jiti.import('../desktop/lib/bt-backup.ts');

test('Harness backup preserves local business data and restores with a safety snapshot', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bt-backup-'));
  try {
    await mkdir(join(root, '.bt'), { recursive: true });
    await mkdir(join(root, 'memory'), { recursive: true });
    await writeFile(join(root, '.bt', 'harness.db'), 'v1');
    await writeFile(join(root, '.bt', 'planner.json'), '{}');
    await writeFile(join(root, 'memory', 'projects.md'), 'project fact');
    const created = backup.createHarnessBackup(root);
    assert.equal(backup.listHarnessBackups(root).length, 1);
    await writeFile(join(root, '.bt', 'harness.db'), 'v2');
    await writeFile(join(root, 'memory', 'projects.md'), 'changed');
    const safety = backup.restoreHarnessBackup(root, created.id);
    assert.ok(safety.id);
    assert.equal(await readFile(join(root, '.bt', 'harness.db'), 'utf8'), 'v1');
    assert.equal(await readFile(join(root, 'memory', 'projects.md'), 'utf8'), 'project fact');
  } finally { await rm(root, { recursive: true, force: true }); }
});

