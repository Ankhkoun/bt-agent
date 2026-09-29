import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import test from "node:test";
import { createJiti } from "jiti";
import { fetch, getGlobalDispatcher } from "undici";

const jiti = createJiti(import.meta.url);
const { parseWindowsSystemProxy, bypassWindowsProxy, readWindowsSystemProxy } = await jiti.import("./windows-system-proxy.ts");

test("inherits static Windows HTTP proxies and per-scheme settings", () => {
  assert.deepEqual(parseWindowsSystemProxy({ ProxyEnable: 1, ProxyServer: "127.0.0.1:7890" }), {
    httpProxy: "http://127.0.0.1:7890", httpsProxy: "http://127.0.0.1:7890", bypass: [],
  });
  assert.deepEqual(parseWindowsSystemProxy({ ProxyEnable: 1, ProxyServer: "http=proxy:80;https=https://secure:443;socks=other:1080" }), {
    httpProxy: "http://proxy", httpsProxy: "https://secure", bypass: [],
  });
});

test("an enabled manual proxy remains usable when Windows also stores a PAC URL", () => {
  const settings = parseWindowsSystemProxy({
    ProxyEnable: 1, ProxyServer: "127.0.0.1:7890",
    AutoConfigURL: "https://example.test/proxy.pac", ProxyOverride: "<local>;*.internal.test",
  });
  assert.deepEqual(settings, {
    httpProxy: "http://127.0.0.1:7890", httpsProxy: "http://127.0.0.1:7890",
    bypass: ["<local>", "*.internal.test"],
  });
  assert.equal(bypassWindowsProxy("https://model.example.test", settings), false);
  assert.equal(bypassWindowsProxy("http://localhost:30142", settings), true);
});

test("does not turn disabled, PAC-only, malformed or SOCKS-only settings into an HTTP proxy", () => {
  for (const settings of [
    { ProxyEnable: 0, ProxyServer: "proxy:80" },
    { ProxyEnable: 0, ProxyServer: "proxy:80", AutoConfigURL: "https://example.test/proxy.pac" },
    { ProxyEnable: 1, AutoConfigURL: "https://example.test/proxy.pac" },
    { ProxyEnable: 1, ProxyServer: "socks=proxy:1080" },
    { ProxyEnable: 1, ProxyServer: "socks5://proxy:1080" },
    { ProxyEnable: 1, ProxyServer: "bad proxy" },
    { ProxyEnable: 1, ProxyServer: "http://user:password@proxy:80" },
  ]) assert.equal(parseWindowsSystemProxy(settings), undefined);
});

test("preserves Windows wildcard and local bypass behavior without proxying loopback", () => {
  const settings = parseWindowsSystemProxy({ ProxyEnable: 1, ProxyServer: "proxy:80", ProxyOverride: "<local>;10.*;192.168.*;*.internal.test;*zhihu.com" });
  for (const host of ["localhost", "127.0.0.2", "[::1]", "intranet", "10.1.2.3", "192.168.0.1", "api.internal.test", "www.zhihu.com"]) {
    assert.equal(bypassWindowsProxy(`https://${host}/`, settings), true, host);
  }
  for (const host of ["api.openai.com", "internal.test.attacker.test", "110.1.2.3"]) {
    assert.equal(bypassWindowsProxy(`https://${host}/`, settings), false, host);
  }
  const httpOnly = parseWindowsSystemProxy({ ProxyEnable: 1, ProxyServer: "http=proxy:80" });
  assert.equal(bypassWindowsProxy("https://example.test/", httpOnly), true);
});

test("explicit proxy environment, opt-out and non-desktop runs never read registry settings", async () => {
  for (const key of ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy", "ALL_PROXY", "all_proxy"]) {
    assert.equal(await readWindowsSystemProxy({ ELECTRON_RUNNING: "1", [key]: "" }, "win32"), undefined);
  }
  assert.equal(await readWindowsSystemProxy({ ELECTRON_RUNNING: "1", BT_USE_SYSTEM_PROXY: "0" }, "win32"), undefined);
  assert.equal(await readWindowsSystemProxy({}, "win32"), undefined);
  assert.equal(await readWindowsSystemProxy({ ELECTRON_RUNNING: "1" }, "linux"), undefined);
});

test("real dispatcher tunnels model requests through proxy and bypasses local services", async (t) => {
  let tunnels = 0;
  const sockets = new Set();
  const proxy = http.createServer();
  proxy.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  proxy.on("connect", (req, socket) => {
    tunnels++;
    assert.equal(req.url, "model.invalid:80");
    socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    socket.once("data", () => socket.end("HTTP/1.1 200 OK\r\nContent-Length: 7\r\nConnection: close\r\n\r\nproxied"));
  });
  const local = http.createServer((_req, res) => res.end("local"));
  proxy.listen(0, "127.0.0.1");
  local.listen(0, "127.0.0.1");
  await Promise.all([once(proxy, "listening"), once(local, "listening")]);
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    local.closeAllConnections();
    await Promise.all([new Promise((resolve) => proxy.close(resolve)), new Promise((resolve) => local.close(resolve))]);
    await getGlobalDispatcher().close();
  });
  const { configureHttpDispatcher } = await jiti.import("./http-dispatcher.ts");
  configureHttpDispatcher(2000, parseWindowsSystemProxy({ ProxyEnable: 1, ProxyServer: `127.0.0.1:${proxy.address().port}` }));
  assert.equal(await (await fetch("http://model.invalid/", { signal: AbortSignal.timeout(5000) })).text(), "proxied");
  assert.equal(await (await fetch(`http://127.0.0.1:${local.address().port}/`, { signal: AbortSignal.timeout(5000) })).text(), "local");
  assert.equal(tunnels, 1);
});
