export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { configureHttpDispatcher } = await import("@/lib/http-dispatcher");
  const { readWindowsSystemProxy } = await import("@/lib/windows-system-proxy");
  configureHttpDispatcher(undefined, await readWindowsSystemProxy());
}
