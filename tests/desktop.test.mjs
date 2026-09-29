import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, mkdtemp, cp, writeFile, readFile, stat, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { pdfFixture } from './pdf-fixture.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

test('BT desktop production API with isolated memory and local model', { timeout: 180_000 }, async t => {
  await mkdir(join(root, '.bt/tests'), { recursive: true });
  const fixture = await mkdtemp(join(root, '.bt/tests/desktop-'));
  const agentDir = join(fixture, 'agent');
  const requests = [];
  let child;
  let logs = '';
  const model = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const payload = JSON.parse(body);
    requests.push(payload);
    const user = JSON.stringify(payload.messages.findLast(m => m.role === 'user')?.content);
    const readPdf = user.includes('FIXTURE_PDF');
    const browserClose = user.includes('FIXTURE_BROWSER');
    const tool = (user.includes('FIXTURE_WRITE') || readPdf || browserClose) && payload.messages.at(-1)?.role !== 'tool';
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const delta = tool
      ? { role: 'assistant', tool_calls: [{ index: 0, id: 'tool-fixture', type: 'function', function: browserClose
        ? { name: 'bt_browser', arguments: JSON.stringify({ action: 'close' }) }
        : readPdf
        ? { name: 'read', arguments: JSON.stringify({ path: join(fixture, '中文 文件.pdf') }) }
        : { name: 'write', arguments: JSON.stringify({ path: join(fixture, 'scratch.txt'), content: 'desktop tool verified' }) } }] }
      : { role: 'assistant', content: '## BT fixture\n\n**Streaming verified.**\n\n```python\nprint("BT")\n```' };
    const chunk = (delta, finish_reason) => ({ id: 'fixture', object: 'chat.completion.chunk', model: 'fixture', choices: [{ index: 0, delta, finish_reason }] });
    res.write(`data: ${JSON.stringify(chunk(delta, null))}\n\n`);
    res.write(`data: ${JSON.stringify(chunk({}, tool ? 'tool_calls' : 'stop'))}\n\n`);
    res.end('data: [DONE]\n\n');
  });
  model.listen(0, '127.0.0.1');
  await once(model, 'listening');
  t.after(async () => {
    if (child && child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; }
    model.closeAllConnections();
    await new Promise(resolve => model.close(resolve));
    assert.ok(fixture.startsWith(join(root, '.bt', 'tests')));
    await rm(fixture, { recursive: true, force: true });
  });
  await cp(join(root, '.pi'), join(fixture, '.pi'), { recursive: true });
  await cp(join(root, 'templates/memory'), join(fixture, 'memory'), { recursive: true });
  await writeFile(join(fixture, 'memory/profile.md'), '# Fixture\nBT_DESKTOP_MEMORY_MARKER\n');
  await mkdir(agentDir, { recursive: true });
  await writeFile(join(agentDir, 'models.json'), JSON.stringify({ providers: { 'bt-test': {
    baseUrl: `http://127.0.0.1:${model.address().port}/v1`, api: 'openai-completions', apiKey: 'local-fixture-not-a-secret',
    models: [{ id: 'fixture', name: 'Local fixture', reasoning: false, input: ['text', 'image'], contextWindow: 128000, maxTokens: 2048, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
  } } }));
  const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const origin = `http://127.0.0.1:${port}`;
  async function start() {
    child = spawn(process.execPath, [join(root, 'desktop/node_modules/next/dist/bin/next'), 'start', '-H', '127.0.0.1', '-p', String(port)], {
      cwd: join(root, 'desktop'), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, BT_ROOT: fixture, PI_CODING_AGENT_DIR: agentDir, PI_TELEMETRY: '0', NEXT_TELEMETRY_DISABLED: '1', PI_WEB_PASSWORD: '', NODE_ENV: 'production' },
    });
    child.stdout.on('data', d => { logs += d; }); child.stderr.on('data', d => { logs += d; });
    for (let i = 0; i < 100; i++) {
      try { if ((await fetch(`${origin}/api/bt`)).ok) return; } catch { /* Wait for our child server. */ }
      if (child.exitCode !== null) throw new Error(logs);
      await delay(150);
    }
    throw new Error(`Startup timeout: ${logs}`);
  }
  async function api(path, body, method = body ? 'POST' : 'GET') {
    const res = await fetch(`${origin}${path}`, { method, headers: { 'Content-Type': 'application/json', Origin: origin }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await res.json(); assert.equal(res.ok, true, JSON.stringify(data)); return data;
  }
  const command = async (id, type, args = {}) => (await api(`/api/agent/${id}`, { type, ...args })).data;
  async function prompt(id, message, images) {
    await command(id, 'prompt', { message, ...(images ? { images } : {}) });
    for (let i = 0; i < 200; i++) {
      const state = await command(id, 'get_state');
      if (!state.isPromptRunning && !state.isStreaming) {
        const session = await api(`/api/sessions/${id}`);
        assert.ok(JSON.stringify(session).includes('Streaming verified'), JSON.stringify(session).slice(0, 500));
        return;
      }
      await delay(50);
    }
    throw new Error(`Prompt timeout: ${logs}`);
  }
  await start();
  let sid;
  let btSettings;
  await t.test('large local uploads, concurrent indexing, conflicts and root boundaries', async () => {
    const encoded = fixture.replaceAll('\\', '/').split('/').filter(Boolean).map(encodeURIComponent).join('/');
    const fileIndexUrl = `/api/file-index?cwd=${encodeURIComponent(fixture)}`;
    const indexes = await Promise.all(Array.from({ length: 4 }, () => api(fileIndexUrl)));
    for (const index of indexes) assert.deepEqual(index, indexes[0]);
    const form = new FormData();
    form.append('files', new Blob([new Uint8Array(20 * 1024 * 1024)]), 'large-fixture.bin');
    const uploaded = await fetch(`${origin}/api/files/${encoded}?type=upload&conflict=error`, { method: 'POST', headers: { Origin: origin }, body: form });
    assert.equal(uploaded.status, 200, await uploaded.clone().text());
    assert.equal((await stat(join(fixture, 'large-fixture.bin'))).size, 20 * 1024 * 1024);
    assert.ok((await api(fileIndexUrl)).files.includes('large-fixture.bin'));
    const duplicate = new FormData(); duplicate.append('files', new Blob(['must not overwrite']), 'large-fixture.bin');
    const conflict = await fetch(`${origin}/api/files/${encoded}?type=upload&conflict=error`, { method: 'POST', headers: { Origin: origin }, body: duplicate });
    assert.equal(conflict.status, 409);
    assert.equal((await stat(join(fixture, 'large-fixture.bin'))).size, 20 * 1024 * 1024);
    assert.equal((await fetch(`${origin}/api/file-index?cwd=${encodeURIComponent(join(root, 'scripts'))}`)).status, 403);
    const tooLarge = new FormData(); tooLarge.append('files', new Blob([new Uint8Array(26 * 1024 * 1024)]), 'oversized.bin');
    const rejected = await fetch(`${origin}/api/files/${encoded}?type=upload&conflict=error`, { method: 'POST', headers: { Origin: origin }, body: tooLarge });
    assert.equal(rejected.status, 413);
    await assert.rejects(stat(join(fixture, 'oversized.bin')), { code: 'ENOENT' });
  });
  await t.test('ignored document workspace indexes and reads uploaded PDF immediately', async () => {
    const fileIndexUrl = `/api/file-index?cwd=${encodeURIComponent(fixture)}`;
    await api(fileIndexUrl); // Warm the cache before the upload.
    const form = new FormData();
    form.append('files', new Blob([pdfFixture()], { type: 'application/pdf' }), '中文 文件.pdf');
    const encoded = fixture.replaceAll('\\', '/').split('/').filter(Boolean).map(encodeURIComponent).join('/');
    const uploaded = await fetch(`${origin}/api/files/${encoded}?type=upload&conflict=error`, { method: 'POST', headers: { Origin: origin }, body: form });
    assert.equal(uploaded.status, 200, await uploaded.clone().text());
    const index = await api(fileIndexUrl);
    assert.ok(index.files.includes('中文 文件.pdf'), JSON.stringify(index));
    assert.ok((await api(`${fileIndexUrl}&q=${encodeURIComponent('中文')}`)).matches.some(m => m.path === '中文 文件.pdf'));
    const preview = await fetch(`${origin}/api/files/${encoded}/${encodeURIComponent('中文 文件.pdf')}?type=download`);
    assert.equal(preview.status, 200);
    assert.equal(preview.headers.get('content-type'), 'application/pdf');
  });
  await t.test('Memory whitelist, settings validation and same-origin boundary', async () => {
    const data = await api('/api/bt'); btSettings = data.settings;
    assert.equal(data.memory.length, 7);
    assert.match((await api('/api/bt?memory=profile')).content, /BT_DESKTOP_MEMORY_MARKER/);
    assert.equal((await fetch(`${origin}/api/bt?memory=../agent/auth`)).status, 400);
    assert.equal((await fetch(`${origin}/api/bt`, { headers: { Origin: 'https://foreign.example' } })).status, 403);
    assert.equal((await fetch(`${origin}/api/bt`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'settings', settings: { ...btSettings, defaultMode: 'invalid' } }) })).status, 400);
    await api('/api/bt', { action: 'settings', settings: { ...btSettings, persona: 'BT_PERSONA_MARKER' } });
    sid = (await api('/api/agent/new', { cwd: fixture, type: 'ensure_session', provider: 'bt-test', modelId: 'fixture' })).sessionId;
  });
  await t.test('five real mode switches are awaited and do not call a model', async () => {
    for (const mode of ['general', 'tutor', 'interviewer', 'planner', 'bt']) {
      const count = requests.length;
      await command(sid, 'bt_set_mode', { mode });
      const state = await command(sid, 'get_state');
      assert.ok(state.extensionStatuses.some(s => s.key === 'bt-mode' && s.text.toLowerCase().endsWith(mode)), JSON.stringify(state.extensionStatuses));
      assert.equal(requests.length, count);
      await prompt(sid, `desktop-${mode}`);
      assert.match(requests.at(-1).messages[0].content, new RegExp(`BT_CURRENT_MODE: ${mode}`));
    }
  });
  await t.test('shared persona, memory, tools, attachments and streaming', async () => {
    const controller = new AbortController();
    const response = await fetch(`${origin}/api/agent/${sid}/events`, { signal: controller.signal });
    let stream = '';
    const reading = (async () => { try { for await (const chunk of response.body) stream += Buffer.from(chunk).toString(); } catch (e) { if (!controller.signal.aborted) throw e; } })();
    try {
      await prompt(sid, 'FIXTURE_WRITE');
      assert.equal(await readFile(join(fixture, 'scratch.txt'), 'utf8'), 'desktop tool verified');
      assert.match(stream, /message_update/); assert.match(stream, /tool_execution/);
      await prompt(sid, 'FIXTURE_PDF @"中文 文件.pdf"');
      const pdfResult = requests.at(-1).messages.findLast(m => m.role === 'tool');
      assert.match(JSON.stringify(pdfResult), /BT_PDF_FIXTURE/);
      assert.doesNotMatch(JSON.stringify(pdfResult), /%PDF-1.4/);
      assert.ok(requests.at(-1).tools.some(tool => tool.function.name === 'bt_browser'));
      await prompt(sid, 'FIXTURE_BROWSER');
      const browserResult = requests.at(-1).messages.findLast(m => m.role === 'tool');
      assert.match(JSON.stringify(browserResult), /closed/);
      await command(sid, 'set_tools', { toolNames: [] });
      await prompt(sid, 'chat only');
      const system = requests.at(-1).messages[0].content;
      assert.match(system, /你叫 BT/); assert.match(system, /BT_DESKTOP_MEMORY_MARKER/); assert.match(system, /BT_PERSONA_MARKER/);
      await prompt(sid, 'image fixture', [{ type: 'image', mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZk0AAAAASUVORK5CYII=' }]);
      assert.match(JSON.stringify(requests.at(-1)), /image_url/);
    } finally { controller.abort(); await reading; }
  });
  await t.test('history rename, search, mode restoration and cross-project memory', async () => {
    await api(`/api/sessions/${sid}`, { name: 'BT fixture renamed' }, 'PATCH');
    const list = await api('/api/sessions?force=1');
    assert.equal(list.sessions.find(s => s.id === sid)?.btMode, 'bt');
    assert.match(JSON.stringify(await api('/api/sessions/search?q=desktop-tutor')), /desktop-tutor/);
    const exited = once(child, 'exit'); child.kill(); await exited; await start();
    await command(sid, 'get_commands');
    assert.ok((await command(sid, 'get_state')).extensionStatuses.some(s => s.text === 'BT · BT'));
    const added = await api('/api/bt', { action: 'project', name: 'Fixture project' });
    const project = added.projects.find(p => p.name === 'Fixture project');
    await api('/api/bt', { action: 'settings', settings: { ...btSettings, defaultMode: 'tutor', memoryEnabled: false } });
    const other = (await api('/api/agent/new', { cwd: project.path, type: 'ensure_session', provider: 'bt-test', modelId: 'fixture' })).sessionId;
    await prompt(other, 'cross project');
    assert.match(requests.at(-1).messages[0].content, /BT_CURRENT_MODE: tutor/);
    assert.doesNotMatch(requests.at(-1).messages[0].content, /BT_DESKTOP_MEMORY_MARKER/);
    await api('/api/bt', { action: 'settings', settings: { ...btSettings, defaultMode: 'tutor' } });
    await prompt(other, 'shared memory');
    assert.match(requests.at(-1).messages[0].content, /BT_DESKTOP_MEMORY_MARKER/);
    await api(`/api/sessions/${other}`, undefined, 'DELETE');
    assert.ok(!(await api('/api/sessions?force=1')).sessions.some(s => s.id === other));
  });
  assert.equal(await readFile(join(fixture, 'memory/profile.md'), 'utf8'), '# Fixture\nBT_DESKTOP_MEMORY_MARKER\n');
});
