import { EventEmitter } from "node:events";
import * as undici from "undici";
import { bypassWindowsProxy, type WindowsSystemProxy } from "./windows-system-proxy";

export const DEFAULT_HTTP_IDLE_TIMEOUT_MS = 300_000;

type DispatcherGlobal = typeof globalThis & {
  __piWebHttpDispatcherConfigured?: boolean;
};

const dispatcherGlobal = globalThis as DispatcherGlobal;
const originalGlobalFetch = globalThis.fetch;
const ignoreUndiciDispatcherError = (): void => {};

export function parseHttpIdleTimeoutMs(value: unknown): number | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.toLowerCase() === "disabled") return 0;
    if (trimmed.length === 0) return undefined;
    return parseHttpIdleTimeoutMs(Number(trimmed));
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return undefined;
  return Math.floor(value);
}

function withUndiciErrorListener<T extends undici.Dispatcher>(dispatcher: T): T {
  if (dispatcher instanceof EventEmitter) {
    EventEmitter.prototype.on.call(dispatcher, "error", ignoreUndiciDispatcherError);
  }
  return dispatcher;
}

function createUndiciClient(origin: string | URL, options: object): undici.Dispatcher {
  return withUndiciErrorListener(new undici.Client(origin, options as undici.Client.Options));
}

function createUndiciOriginDispatcher(origin: string | URL, options: object): undici.Dispatcher {
  const dispatcherOptions = options as undici.Pool.Options;
  if (dispatcherOptions.connections === 1) return createUndiciClient(origin, dispatcherOptions);
  return withUndiciErrorListener(new undici.Pool(origin, {
    ...dispatcherOptions,
    factory: createUndiciClient,
  }));
}

/**
 * Apply a process-wide Undici dispatcher once for Node route handlers.
 * EnvHttpProxyAgent deliberately honors the operator's HTTP(S)_PROXY and
 * NO_PROXY configuration; Electron remains loopback-only at its listener.
 */
export function configureHttpDispatcher(
  timeoutMs: number = DEFAULT_HTTP_IDLE_TIMEOUT_MS,
  systemProxy?: WindowsSystemProxy,
): void {
  if (dispatcherGlobal.__piWebHttpDispatcherConfigured) return;
  const normalizedTimeoutMs = parseHttpIdleTimeoutMs(timeoutMs);
  if (normalizedTimeoutMs === undefined) {
    throw new Error(`Invalid HTTP idle timeout: ${String(timeoutMs)}`);
  }

  const options = {
    allowH2: false,
    proxyTunnel: true,
    bodyTimeout: normalizedTimeoutMs,
    headersTimeout: normalizedTimeoutMs,
    clientFactory: createUndiciClient,
    factory: createUndiciOriginDispatcher,
  };
  let dispatcher: undici.Dispatcher = withUndiciErrorListener(new undici.EnvHttpProxyAgent({
    ...options,
    ...(systemProxy ? { httpProxy: systemProxy.httpProxy ?? "", httpsProxy: systemProxy.httpsProxy ?? "" } : {}),
  }));
  if (systemProxy) {
    const direct = withUndiciErrorListener(new undici.Agent(options));
    // Windows supports wildcard IP ranges and <local>, which NO_PROXY cannot
    // express faithfully. Match these before EnvHttpProxyAgent's NO_PROXY rules.
    dispatcher = dispatcher.compose((dispatch) => (opts, handler) => (
      bypassWindowsProxy(String(opts.origin), systemProxy)
        ? direct.dispatch(opts, handler)
        : dispatch(opts, handler)
    ));
  }
  undici.setGlobalDispatcher(dispatcher);

  // Do not replace an intentional fetch override installed after this module.
  if (globalThis.fetch === originalGlobalFetch) undici.install?.();
  dispatcherGlobal.__piWebHttpDispatcherConfigured = true;
}
