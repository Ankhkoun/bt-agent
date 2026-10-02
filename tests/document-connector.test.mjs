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
const JSZip = (await import('../desktop/node_modules/jszip/lib/index.js')).default;

async function docxFixture(text) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`);
  return zip.generateAsync({ type: 'nodebuffer' });
}

async function xlsxFixture() {
  const zip = new JSZip();
  zip.file('xl/workbook.xml', '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="学习" sheetId="1" r:id="rId1"/></sheets></workbook>');
  zip.file('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>');
  zip.file('xl/sharedStrings.xml', '<sst><si><t>Harness</t></si></sst>');
  zip.file('xl/worksheets/sheet1.xml', '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><v>42</v></c></row></sheetData></worksheet>');
  return zip.generateAsync({ type: 'nodebuffer' });
}

async function pptxFixture() {
  const zip = new JSZip();
  zip.file('ppt/slides/slide1.xml', '<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree><a:t>Slide evidence</a:t></p:spTree></p:cSld></p:sld>');
  return zip.generateAsync({ type: 'nodebuffer' });
}

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

test('DocumentBlock preserves line, paragraph and page-style locators', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bt-document-'));
  try {
    const markdown = join(root, 'notes.md');
    await writeFile(markdown, '# Header\nsecond line');
    const blocks = await documentApi.parseDocument(markdown);
    assert.equal(blocks[0].locator, 'L1');
    assert.equal(blocks[1].text, 'second line');
    assert.equal(blocks[0].metadata.parseStatus, 'ok');
    const docx = join(root, 'notes.docx');
    await writeFile(docx, await docxFixture('DOCX evidence'));
    const paragraphs = await documentApi.parseDocument(docx);
    assert.equal(paragraphs[0].metadata.parseStatus, 'ok');
    assert.equal(paragraphs[0].locator, 'P1');
    assert.match(paragraphs[0].text, /DOCX evidence/);
    const xlsx = join(root, 'notes.xlsx');
    await writeFile(xlsx, await xlsxFixture());
    const cells = await documentApi.parseDocument(xlsx);
    assert.equal(cells[0].metadata.parseStatus, 'ok');
    assert.equal(cells[0].locator, 'sheet:学习!A1');
    assert.equal(cells[0].text, 'Harness');
    const pptx = join(root, 'slides.pptx');
    await writeFile(pptx, await pptxFixture());
    const slides = await documentApi.parseDocument(pptx);
    assert.equal(slides[0].locator, 'slide:1');
    assert.match(slides[0].text, /Slide evidence/);
    const pdf = join(root, 'notes.pdf');
    await writeFile(pdf, pdfFixture('DocumentBlock PDF evidence'));
    const pages = await documentApi.parseDocument(pdf);
    assert.equal(pages[0].locator, 'page:1');
    assert.match(pages[0].text, /DocumentBlock PDF evidence/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
