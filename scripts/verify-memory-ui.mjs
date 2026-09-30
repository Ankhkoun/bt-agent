import assert from 'node:assert/strict';
import { mkdir, mkdtemp, cp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { chromium } from 'playwright-core';
import { proposeMemory } from '../desktop/lib/bt-memory.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
await mkdir(join(root, '.bt/tests'), { recursive: true });
const fixture = await mkdtemp(join(root, '.bt/tests/memory-ui-'));
let child, browser;
let logs = '';
try {
  await cp(join(root, '.pi'), join(fixture, '.pi'), { recursive: true });
  await mkdir(join(fixture, 'desktop/lib'), { recursive: true });
  await cp(join(root, 'desktop/lib/bt-memory.ts'), join(fixture, 'desktop/lib/bt-memory.ts'));
  await cp(join(root, 'templates/memory'), join(fixture, 'memory'), { recursive: true });
  await mkdir(join(fixture, 'agent'));
  const original = await readFile(join(fixture, 'memory/knowledge_map.md'), 'utf8');
  const source = { sessionId: 'ui-fixture-session', cwd: '隔离测试资料目录', mode: 'tutor', evidence: [{ entryId: 'user-answer', role: 'user', quote: '上下文窗口限制一次请求中的信息，检索可以选择相关资料。' }] };
  const assessment = { concept: '上下文与检索', level: 'L2', basis: '能区分两者作用', gaps: '尚未验证检索失败与冲突处理', nextQuestion: '检索到相互冲突的记录时如何处理？' };
  proposeMemory(fixture, { target: 'knowledge_map', kind: 'ai_explanation', text: '用户能够解释上下文窗口与检索的基本区别。', reason: '保留本轮回答依据，以便下一次针对缺口提问。', assessment }, source);
  proposeMemory(fixture, { target: 'profile', kind: 'user_view', text: '希望优先学习 Agent 应用开发。', reason: '学习方向', }, source);
  const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const origin = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [join(root, 'desktop/node_modules/next/dist/bin/next'), 'start', '-H', '127.0.0.1', '-p', String(port)], {
    cwd: join(root, 'desktop'), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, BT_ROOT: fixture, PI_CODING_AGENT_DIR: join(fixture, 'agent'), PI_TELEMETRY: '0', NEXT_TELEMETRY_DISABLED: '1', PI_WEB_PASSWORD: '', NODE_ENV: 'production' },
  });
  child.stdout.on('data', d => { logs += d; }); child.stderr.on('data', d => { logs += d; });
  const began = Date.now();
  for (;;) {
    try { if ((await fetch(`${origin}/api/bt`)).ok) break; } catch { /* Wait for fixture service. */ }
    if (child.exitCode !== null || Date.now() - began > 30000) throw new Error(`Fixture server did not start: ${logs}`);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({ channel: 'msedge', headless: true, chromiumSandbox: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.goto(origin);
  await page.getByRole('button', { name: 'Memory', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'BT Memory' });
  await dialog.getByRole('button', { name: '候选与历史', exact: true }).click();
  const learning = dialog.locator('article').filter({ hasText: '上下文窗口与检索的基本区别' });
  await learning.waitFor();
  await learning.locator('summary').click();
  await learning.getByText(source.evidence[0].quote, { exact: true }).waitFor();
  await learning.getByText(assessment.nextQuestion, { exact: true }).waitFor();
  await mkdir(join(root, 'docs/assets'), { recursive: true });
  await dialog.screenshot({ path: join(root, 'docs/assets/memory-review-fixture.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  const bounds = await dialog.boundingBox();
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390, JSON.stringify(bounds));
  assert.equal(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1), true);
  await learning.getByRole('button', { name: '确认保存', exact: true }).click();
  await dialog.getByText('已保存到长期记忆，下轮对话生效。', { exact: true }).waitFor();
  assert.match(await readFile(join(fixture, 'memory/knowledge_map.md'), 'utf8'), /ui-fixture-session/);
  await dialog.locator('article').filter({ hasText: '希望优先学习 Agent' }).getByRole('button', { name: '拒绝', exact: true }).click();
  await dialog.getByText('已拒绝，长期记忆未改变。', { exact: true }).waitFor();
  await dialog.getByRole('button', { name: '审阅历史', exact: true }).click();
  await learning.getByRole('button', { name: '撤销此记录', exact: true }).click();
  await dialog.getByText('已撤销此记录，保留其他内容。', { exact: true }).waitFor();
  assert.equal(await readFile(join(fixture, 'memory/knowledge_map.md'), 'utf8'), original);
  await page.reload();
  await page.getByRole('button', { name: 'Memory', exact: true }).click();
  await dialog.getByRole('button', { name: '候选与历史', exact: true }).click();
  await dialog.getByRole('button', { name: '审阅历史', exact: true }).click();
  await learning.getByText('已撤销', { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log('PASS memory UI: evidence, assessment, approval, rejection, scoped undo, reload and 390px layout; no real model requests.');
} finally {
  await browser?.close();
  if (child && child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; }
  assert.ok(fixture.startsWith(join(root, '.bt', 'tests')));
  await rm(fixture, { recursive: true, force: true });
}
