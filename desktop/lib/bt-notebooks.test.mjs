import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJiti } from '../node_modules/jiti/lib/jiti.mjs';
const jiti = createJiti(import.meta.url);
const { readNotebooks, updateNotebooks, NotebookConflict } = await jiti.import('./bt-notebooks.ts');
test('notebook rename preserves entries, edits preserve original dates, stale writes rejected', () => {
 const root = mkdtempSync(join(tmpdir(), 'bt-notes-'));
 try {
  assert.equal(readNotebooks(root).books[0].name, '我的随手记');
  let data = updateNotebooks({ action: 'create', name: '数据集处理', revision: 0 }, root);
  const book = data.books[1];
  data = updateNotebooks({ action: 'note', notebookId: book.id, text: '去重完成\n产物在 clean_v2', revision: 1 }, root);
  const note = data.notes[0];
  updateNotebooks({ action: 'rename', id: book.id, name: '实验随记', revision: 2 }, root);
  data = readNotebooks(root);
  assert.equal(data.books[1].name, '实验随记');
  assert.equal(data.notes[0].notebookId, book.id);
  assert.equal(data.notes[0].text, note.text);
  data = updateNotebooks({ action: 'note', notebookId: book.id, id: note.id, text: '补充：标注待检查', revision: 3 }, root);
  assert.equal(data.notes[0].createdAt, note.createdAt);
  assert.throws(() => updateNotebooks({ action: 'rename', id: book.id, name: '旧修改', revision: 2 }, root), NotebookConflict);
  assert.throws(() => updateNotebooks({ action: 'create', name: '  ', revision: 4 }, root));
  assert.throws(() => updateNotebooks({ action: 'note', notebookId: 'missing', text: 'x', revision: 4 }, root));
  assert.equal(readNotebooks(root).revision, 4);
 } finally { rmSync(root, { recursive: true, force: true }); }
});
