import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJiti } from '../desktop/node_modules/jiti/lib/jiti.mjs';

const jiti = createJiti(import.meta.url);
const harness = await jiti.import('../desktop/lib/bt-harness.ts');
const documentRunner = await jiti.import('../desktop/lib/bt-document-runner.ts');

test('Document Runner persists line evidence, record artifact and evaluation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bt-document-runner-'));
  try {
    const documentPath = join(root, 'notes.md');
    await writeFile(documentPath, '# Harness\n\nEvidence-backed records\nNext step');
    const task = harness.createTask({ workflowId: 'document', objective: '整理学习资料', scope: documentPath }, root);
    const run = harness.startRun(task.id, root);
    await documentRunner.executeDocumentRun(run.id, { root });
    const detail = harness.getTask(task.id, root);
    assert.ok(detail);
    assert.equal(detail.runs[0].status, 'completed');
    assert.equal(detail.evidence[0].locator, 'L1');
    assert.ok(detail.evidence.some((item) => item.quote.includes('Evidence-backed')));
    assert.equal(detail.artifacts[0].kind, 'document-record');
    assert.equal(detail.evaluations[0].result, 'pass');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Document Runner fails explicitly for unsupported document formats', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bt-document-runner-'));
  try {
    const documentPath = join(root, 'notes.odt');
    await writeFile(documentPath, 'fixture');
    const task = harness.createTask({ workflowId: 'document', objective: '处理 Office 资料', scope: documentPath }, root);
    const run = harness.startRun(task.id, root);
    await assert.rejects(() => documentRunner.executeDocumentRun(run.id, { root }), /当前版本未安装该格式的本地解析器/);
    const detail = harness.getTask(task.id, root);
    assert.ok(detail);
    assert.equal(detail.runs[0].status, 'failed');
    assert.equal(detail.steps.find((step) => step.kind === 'ingest').status, 'failed');
    assert.ok(detail.events.some((event) => event.type === 'document_parse_failed'));
  } finally { await rm(root, { recursive: true, force: true }); }
});
