import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { BTBrowser, validateBrowserUrl } from '../.pi/lib/browser.ts';

test('browser only opens explicit HTTP(S) addresses without URL credentials', () => {
  assert.equal(validateBrowserUrl('https://example.com/a'), 'https://example.com/a');
  for (const url of ['file:///C:/private.txt', 'javascript:alert(1)', 'data:text/html,secret', 'https://user:secret@example.com', 'not a url']) {
    assert.throws(() => validateBrowserUrl(url));
  }
});

test('dedicated Edge browser reads JS pages, interacts, manages tabs and retains only its own profile', { timeout: 90_000 }, async t => {
  const base = resolve('.bt/tests'); await mkdir(base, { recursive: true });
  const dir = await mkdtemp(join(base, 'browser-'));
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (req.url === '/second') return res.end('<html><title>Second</title><body>SECOND_PAGE</body></html>');
    res.end(`<!doctype html><html><title>BT browser fixture</title><body>
      <h1>Local page</h1><p id="js"></p>
      <input aria-label="Search fixture" id="query"><button onclick="document.querySelector('#result').textContent=document.querySelector('#query').value">Apply</button>
      <p id="result"></p><a href="/second">Next page</a><a href="/second" target="_blank">New tab</a>
      <input type="password" aria-label="Password" value="never-return-this-secret">
      <button onclick="localStorage.setItem('fixture','PROFILE_RESTORED');document.querySelector('#saved').textContent='SAVED'">Remember fixture</button><p id="saved"></p>
      <script>document.querySelector('#js').textContent='JS_RENDERED';document.querySelector('#saved').textContent=localStorage.getItem('fixture')||'';</script>
      </body></html>`);
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = new BTBrowser(dir, { headless: true });
  t.after(async () => {
    await browser.close();
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    assert.ok(dir.startsWith(base)); await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });
  let data = (await browser.run({ action: 'open', url: origin })).data;
  assert.match(data.text, /JS_RENDERED/);
  assert.doesNotMatch(JSON.stringify(data), /never-return-this-secret/);
  const ref = (label) => data.controls.find(c => c.label === label).ref;
  const oldRef = ref('Apply');
  data = (await browser.run({ action: 'fill', ref: ref('Search fixture'), text: 'BT_BROWSER_READ_OK' })).data;
  await assert.rejects(browser.run({ action: 'click', ref: oldRef }), /ref/);
  data = (await browser.run({ action: 'click', ref: ref('Apply') })).data;
  assert.match(data.text, /BT_BROWSER_READ_OK/);
  await assert.rejects(browser.run({ action: 'fill', ref: ref('Password'), text: 'not-a-real-password' }), /手动操作/);
  data = (await browser.run({ action: 'click', ref: ref('Remember fixture') })).data;
  data = (await browser.run({ action: 'click', ref: ref('Next page') })).data;
  assert.match(data.text, /SECOND_PAGE/);
  data = (await browser.run({ action: 'back' })).data;
  assert.match(data.text, /PROFILE_RESTORED/);
  data = (await browser.run({ action: 'click', ref: ref('New tab') })).data;
  const tabs = (await browser.run({ action: 'tabs' })).data;
  assert.equal(tabs.length, 2);
  const first = tabs.find(tab => tab.url === origin + '/');
  await browser.run({ action: 'select', tab: first.tab });
  const shot = await browser.run({ action: 'screenshot' });
  assert.ok(Buffer.from(shot.image, 'base64').length > 100);
  await browser.run({ action: 'close' });
  data = (await browser.run({ action: 'open', url: origin })).data;
  assert.match(data.text, /PROFILE_RESTORED/);
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(browser.run({ action: 'read' }, aborted.signal));
});
