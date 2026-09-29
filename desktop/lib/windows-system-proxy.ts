import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

export interface WindowsSystemProxy {
  httpProxy?: string;
  httpsProxy?: string;
  bypass: string[];
}

function proxyUrl(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  try {
    const url = new URL(value.includes("://") ? value.trim() : `http://${value.trim()}`);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password
      || url.pathname !== "/" || url.search || url.hash) return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
}

export function parseWindowsSystemProxy(settings: {
  ProxyEnable?: number;
  ProxyServer?: string;
  ProxyOverride?: string;
  AutoConfigURL?: string;
}): WindowsSystemProxy | undefined {
  // Prefer the explicitly enabled manual proxy even if Windows retains a PAC
  // URL alongside it. We do not evaluate PAC or treat its URL as a proxy;
  // PAC-only configurations still need explicit HTTP(S)_PROXY settings.
  if (settings.ProxyEnable !== 1 || !settings.ProxyServer) return undefined;
  const raw = settings.ProxyServer.trim();
  const entries = new Map(raw.split(";").map((entry) => {
    const [scheme, ...value] = entry.trim().split("=");
    return [scheme.toLowerCase(), value.join("=")];
  }));
  const httpProxy = proxyUrl(raw.includes("=") ? entries.get("http") : raw);
  const httpsProxy = proxyUrl(raw.includes("=") ? entries.get("https") : raw);
  if (!httpProxy && !httpsProxy) return undefined;
  return { httpProxy, httpsProxy, bypass: (settings.ProxyOverride ?? "").split(";").map((s) => s.trim()).filter(Boolean) };
}

export function bypassWindowsProxy(origin: string | URL, settings: WindowsSystemProxy): boolean {
  const url = new URL(origin);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "::1" || host.startsWith("127.")) return true;
  if (url.protocol === "https:" ? !settings.httpsProxy : !settings.httpProxy) return true;
  return settings.bypass.some((pattern) => {
    if (pattern.toLowerCase() === "<local>") return !host.includes(".") && !host.includes(":");
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
    const candidate = pattern.includes(":") ? url.host : host;
    return new RegExp(`^${escaped}$`, "i").test(candidate);
  });
}

export async function readWindowsSystemProxy(
  environment: NodeJS.ProcessEnv = process.env,
  platform: string = process.platform,
): Promise<WindowsSystemProxy | undefined> {
  if (platform !== "win32" || environment.ELECTRON_RUNNING !== "1"
    || environment.BT_USE_SYSTEM_PROXY === "0") return undefined;
  // An explicit proxy environment is an operator choice, including empty values.
  if (["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy", "ALL_PROXY", "all_proxy"]
    .some((key) => environment[key] !== undefined)) return undefined;
  const executable = path.join(environment.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  try {
    const { stdout } = await promisify(execFile)(executable, ["-NoProfile", "-NonInteractive", "-Command",
      "Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings' | Select-Object ProxyEnable,ProxyServer,ProxyOverride,AutoConfigURL | ConvertTo-Json -Compress",
    ], { timeout: 5000, windowsHide: true, maxBuffer: 65536 });
    return parseWindowsSystemProxy(JSON.parse(stdout.trim()));
  } catch {
    // Registry access is optional and must not prevent opening the desktop.
    console.warn("[BT] Could not read Windows proxy settings; using proxy environment variables.");
    return undefined;
  }
}
