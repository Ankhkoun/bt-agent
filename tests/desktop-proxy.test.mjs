import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';

const root = fileURLToPath(new URL('../', import.meta.url));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

test('production model tests use the configured proxy for Responses and Chat Completions', { timeout: 60_000 }, async t => {
  const fixture = await mkdtemp(join(tmpdir(), 'bt-proxy-test-'));
  const agentDir = join(fixture, 'agent');
  await mkdir(agentDir);
  await mkdir(join(fixture, '.pi'));
  await writeFile(join(fixture, '.pi/SYSTEM.md'), 'Local network fixture.');
  const sockets = new Set();
  const destinations = [];
  const paths = [];
  let child;
  let logs = '';
  // The reserved .invalid hostname cannot resolve. Only this local CONNECT
  // proxy can answer, proving that the built Next/Pi path actually uses it.
  const proxy = createServer();
  proxy.on('connection', socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  proxy.on('connect', (req, socket) => {
    destinations.push(req.url);
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    let data = '';
    socket.on('data', chunk => {
      data += chunk;
      if (!data.includes('\r\n\r\n')) return;
      socket.removeAllListeners('data');
      paths.push(data.split('\r\n', 1)[0].split(' ')[1]);
      const body = JSON.stringify({ error: { message: 'BT local proxy fixture', type: 'authentication_error' } });
      socket.end(`HTTP/1.1 401 Unauthorized\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`);
    });
  });
  t.after(async () => {
    if (child && child.exitCode === null) {
      const exited = once(child, 'exit'); child.kill(); await exited;
    }
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => proxy.close(resolve));
    await rm(fixture, { recursive: true, force: true });
  });
  proxy.listen(0, '127.0.0.1');
  await once(proxy, 'listening');
  const portProbe = createServer(); portProbe.listen(0, '127.0.0.1');
  await once(portProbe, 'listening');
  const port = portProbe.address().port;
  await new Promise(resolve => portProbe.close(resolve));
  const origin = `http://127.0.0.1:${port}`;
  // Never inherit personal provider credentials or proxy overrides into tests.
  const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    /^(path|systemroot|windir|temp|tmp|home|userprofile|appdata|localappdata|comspec|pathext)$/i.test(key)));
  child = spawn(process.execPath, [join(root, 'desktop/node_modules/next/dist/bin/next'), 'start', '-H', '127.0.0.1', '-p', String(port)], {
    cwd: join(root, 'desktop'), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...environment, BT_ROOT: fixture, PI_CODING_AGENT_DIR: agentDir,
      PI_TELEMETRY: '0', NEXT_TELEMETRY_DISABLED: '1', NODE_ENV: 'production',
      ELECTRON_RUNNING: '1', HTTP_PROXY: `http://127.0.0.1:${proxy.address().port}`,
      HTTPS_PROXY: `http://127.0.0.1:${proxy.address().port}`, NO_PROXY: 'localhost,127.0.0.1,::1',
    },
  });
  child.stdout.on('data', data => { logs += data; });
  child.stderr.on('data', data => { logs += data; });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${origin}/api/bt`)).ok) { ready = true; break; } } catch { /* Wait for local server. */ }
    if (child.exitCode !== null) throw new Error(logs);
    await delay(100);
  }
  assert.ok(ready, logs);
  for (const api of ['openai-responses', 'openai-completions']) {
    const response = await fetch(`${origin}/api/models-config/test`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({
        providerName: 'bt-proxy-fixture',
        provider: { baseUrl: 'http://model.invalid/v1', api, apiKey: 'local-fixture-not-a-secret' },
        model: { id: 'fixture', reasoning: false, input: ['text'], contextWindow: 128000, maxTokens: 16 },
      }), signal: AbortSignal.timeout(25_000),
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.ok, false);
    assert.match(result.error, /401/);
    assert.match(result.error, /BT local proxy fixture/);
  }
  assert.deepEqual(destinations, ['model.invalid:80', 'model.invalid:80']);
  assert.deepEqual(paths, ['/v1/responses', '/v1/chat/completions']);
});
