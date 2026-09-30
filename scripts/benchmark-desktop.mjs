// Local, isolated performance fixture. Never opens personal sessions or calls a model.
import { mkdir, mkdtemp, cp, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('../', import.meta.url));
const fixtures = join(root, '.bt', 'tests');
await mkdir(fixtures, { recursive: true });
const fixture = await mkdtemp(join(fixtures, 'performance-'));
let child, browser;
try {
  await cp(join(root, '.pi'), join(fixture, '.pi'), { recursive: true });
  await mkdir(join(fixture, 'desktop/lib'), { recursive: true });
  await cp(join(root, 'desktop/lib/bt-memory.ts'), join(fixture, 'desktop/lib/bt-memory.ts'));
  await cp(join(root, 'templates', 'memory'), join(fixture, 'memory'), { recursive: true });
  const agentDir = join(fixture, 'agent');
  await mkdir(agentDir);
  await mkdir(join(fixture, '.bt'));
  await writeFile(join(fixture, '.bt', 'projects.json'), JSON.stringify([{ id: 'fixture', name: 'Performance fixture', path: fixture }]));
  await writeFile(join(fixture, 'sample.txt'), 'Local performance fixture');
  const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = probe.address().port;
  await new Promise(r => probe.close(r));
  const origin = `http://127.0.0.1:${port}`;
  const start = performance.now();
  child = spawn(process.execPath, [join(root, 'desktop/node_modules/next/dist/bin/next'), 'start', '-H', '127.0.0.1', '-p', String(port)], {
    cwd: join(root, 'desktop'), windowsHide: true, stdio: 'ignore',
    env: { ...process.env, BT_ROOT: fixture, PI_CODING_AGENT_DIR: agentDir, PI_TELEMETRY: '0', NEXT_TELEMETRY_DISABLED: '1', PI_WEB_PASSWORD: '', ELECTRON_RUNNING: '1', NODE_ENV: 'production' },
  });
  for (;;) {
    try { const r = await fetch(`${origin}/api/bt`); await r.text(); if (r.ok) break; } catch {}
    if (child.exitCode !== null || performance.now() - start > 60_000) throw new Error('Fixture server did not start');
    await new Promise(r => setTimeout(r, 100));
  }
  const result = { serverReadyMs: Math.round(performance.now() - start) };
  const encoded = fixture.replaceAll('\\', '/').split('/').filter(Boolean).map(encodeURIComponent).join('/');
  let began = performance.now();
  await (await fetch(`${origin}/api/files/${encoded}?type=list`)).text();
  result.firstFilesMs = Math.round(performance.now() - began);
  began = performance.now();
  await Promise.all(Array.from({ length: 4 }, async () => (await fetch(`${origin}/api/file-index?cwd=${encodeURIComponent(fixture)}`)).text()));
  result.concurrentIndexMs = Math.round(performance.now() - began);
  const body = new FormData(); body.append('files', new Blob([new Uint8Array(20 * 1024 * 1024)]), 'upload-fixture.bin');
  began = performance.now();
  const upload = await fetch(`${origin}/api/files/${encoded}?type=upload&conflict=error`, { method: 'POST', headers: { Origin: origin }, body });
  const uploadResult = await upload.text();
  if (!upload.ok) result.uploadError = { status: upload.status, detail: uploadResult.slice(0, 500) };
  result.upload20MBMs = Math.round(performance.now() - began);
  browser = await chromium.launch({ channel: 'msedge', headless: true, chromiumSandbox: true });
  const page = await browser.newPage();
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.addInitScript(() => {
    window.__perfLongTasks = [];
    new PerformanceObserver(list => window.__perfLongTasks.push(...list.getEntries().map(e => Math.round(e.duration)))).observe({ type: 'longtask', buffered: true });
  });
  began = performance.now();
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.documentElement.classList.contains('pi-booted'), null, { timeout: 60000 });
  result.uiReadyMs = Math.round(performance.now() - began);
  Object.assign(result, await page.evaluate(() => ({
    longTasksMs: window.__perfLongTasks,
    scriptBytes: performance.getEntriesByType('resource').filter(r => r.initiatorType === 'script').reduce((n, r) => n + r.decodedBodySize, 0),
    slowRequests: performance.getEntriesByType('resource').filter(r => r.duration > 200).map(r => ({ path: new URL(r.name).pathname, ms: Math.round(r.duration) })),
  })));
  if (process.argv.includes('--verify-ui')) {
    // Delay only this fixture upload to observe the intermediate UI state.
    let releaseUpload;
    const uploadGate = new Promise(r => { releaseUpload = r; });
    await page.route('**/api/files/**', async route => {
      if (route.request().method() === 'POST') await uploadGate;
      await route.continue();
    });
    const textarea = page.locator('textarea').first();
    await textarea.fill('Read this local fixture');
    try {
      await page.locator('input[type="file"]').first().setInputFiles({ name: 'ui-upload.txt', mimeType: 'text/plain', buffer: Buffer.from('UI fixture') });
      await page.getByRole('status').filter({ hasText: /Copying|正在复制/ }).waitFor();
      assert.equal(await page.locator('.chat-input-send').isDisabled(), true);
      await textarea.fill('Still able to type while uploading');
    } finally { releaseUpload(); }
    await page.waitForFunction(() => document.querySelector('textarea')?.value.includes('@ui-upload.txt'));
    assert.match(await textarea.inputValue(), /Still able to type while uploading/);
    assert.equal(await page.locator('.chat-input-send').isEnabled(), true);
    assert.equal(await page.getByRole('status').filter({ hasText: /Copying|正在复制/ }).count(), 0);
    result.uploadUiVerified = true;
  }
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser?.close();
  if (child && child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; }
  if (resolve(fixture).startsWith(resolve(fixtures) + '\\') || resolve(fixture).startsWith(resolve(fixtures) + '/')) await rm(fixture, { recursive: true, force: true });
}
