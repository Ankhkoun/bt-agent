import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJiti } from '../desktop/node_modules/jiti/lib/jiti.mjs';
import { pdfFixture } from './pdf-fixture.mjs';

const jiti = createJiti(import.meta.url);
const documentApi = await jiti.import('../desktop/lib/bt-document.ts');
const { createLocalFileConnector } = await jiti.import('../desktop/lib/bt-local-connector.ts');
const { ConnectorRegistry } = await jiti.import('../desktop/lib/bt-connector.ts');

test('local Connector exposes health, bounded reads and content versions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bt-connector-'));
  try {
    await writeFile(join(root, 'README.md'), '# BT\n\nLocal evidence');
    const registry = new ConnectorRegistry();
    registry.register(createLocalFileConnector(root));
    assert.deepEqual(await registry.healthCheck(), [{ id: 'local-file', ok: true }]);
    const item = await registry.get('local-file').read('README.md');
    assert.match(item.content, /Local evidence/);
    assert.match(item.metadata.contentHash, /^[a-f0-9]{64}$/);
    await assert.rejects(() => registry.get('local-file').read('../secret.txt'), /超出/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('DocumentBlock preserves line and page-style locators and reports unsupported Office formats', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bt-document-'));
  try {
    const markdown = join(root, 'notes.md');
    await writeFile(markdown, '# Header\nsecond line');
    const blocks = await documentApi.parseDocument(markdown);
    assert.equal(blocks[0].locator, 'L1');
    assert.equal(blocks[1].text, 'second line');
    assert.equal(blocks[0].metadata.parseStatus, 'ok');
    const docx = join(root, 'notes.docx');
    await writeFile(docx, 'fixture');
    const unsupported = await documentApi.parseDocument(docx);
    assert.equal(unsupported[0].metadata.parseStatus, 'unsupported');
    assert.equal(unsupported[0].format, 'docx');
    const pdf = join(root, 'notes.pdf');
    await writeFile(pdf, pdfFixture('DocumentBlock PDF evidence'));
    const pages = await documentApi.parseDocument(pdf);
    assert.equal(pages[0].locator, 'page:1');
    assert.match(pages[0].text, /DocumentBlock PDF evidence/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
