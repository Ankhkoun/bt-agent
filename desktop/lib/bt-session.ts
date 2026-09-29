import { SessionManager } from "@earendil-works/pi-coding-agent";
import { statSync } from "node:fs";

const modes = new Set(["general", "tutor", "interviewer", "planner", "bt"]);
export function modeFromBTBranch(entries: readonly { type: string; customType?: string; data?: unknown }[]): string {
  let mode = "general";
  for (const entry of entries) {
    if (entry.type !== "custom" || entry.customType !== "bt-mode-v1") continue;
    const value = entry.data as { mode?: string } | undefined;
    if (value?.mode && modes.has(value.mode)) mode = value.mode;
  }
  return mode;
}
const cache = new Map<string, { mtime: number; mode: string }>();
export function readBTSessionMode(path: string): string {
  try {
    const mtime = statSync(path).mtimeMs;
    const hit = cache.get(path);
    if (hit?.mtime === mtime) return hit.mode;
    const mode = modeFromBTBranch(SessionManager.open(path).getBranch());
    if (cache.size > 500) cache.clear();
    cache.set(path, { mtime, mode });
    return mode;
  } catch { return "general"; }
}
