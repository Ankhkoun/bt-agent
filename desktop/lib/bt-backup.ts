import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";

const VERSION = 1;
const BACKUP_DIR = [".bt", "backups"];
const INCLUDED_BT_FILES = ["harness.db", "planner.json", "calendar.json", "notebooks.json", "projects.json", "preferences.json"];

function backupRoot(root: string): string { return join(root, ...BACKUP_DIR); }
function safeBackupPath(root: string, id: string): string {
  const base = resolve(backupRoot(root));
  const path = resolve(base, id);
  if (path !== base && !path.startsWith(`${base}${sep}`)) throw new Error("备份路径无效");
  return path;
}

export interface HarnessBackup {
  id: string;
  createdAt: string;
  files: string[];
  includesMemory: boolean;
}

export function createHarnessBackup(root: string): HarnessBackup {
  const createdAt = new Date().toISOString();
  const id = createdAt.replace(/[:.]/g, "-");
  const directory = safeBackupPath(root, id);
  mkdirSync(directory, { recursive: true });
  const files: string[] = [];
  const bt = join(root, ".bt");
  for (const name of INCLUDED_BT_FILES) {
    const source = join(bt, name);
    if (!existsSync(source)) continue;
    cpSync(source, join(directory, name), { recursive: false });
    files.push(`.bt/${name}`);
  }
  let includesMemory = false;
  const memory = join(root, "memory");
  if (existsSync(memory)) {
    cpSync(memory, join(directory, "memory"), { recursive: true });
    includesMemory = true;
    files.push("memory/*");
  }
  const manifest = { version: VERSION, id, createdAt, files, includesMemory };
  writeFileSync(join(directory, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
  return manifest;
}

export function listHarnessBackups(root: string): HarnessBackup[] {
  const directory = backupRoot(root);
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.isDirectory()).flatMap((entry) => {
    try {
      const value = JSON.parse(readFileSync(join(directory, entry.name, "manifest.json"), "utf8")) as HarnessBackup & { version: number };
      return value.version === VERSION ? [value] : [];
    } catch { return []; }
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function restoreHarnessBackup(root: string, id: string): HarnessBackup {
  const directory = safeBackupPath(root, id);
  const manifestPath = join(directory, "manifest.json");
  if (!existsSync(manifestPath)) throw new Error("备份不存在或格式不受支持");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as HarnessBackup & { version: number };
  if (manifest.version !== VERSION || manifest.id !== id) throw new Error("备份版本不受支持");
  const current = createHarnessBackup(root);
  const bt = join(root, ".bt");
  mkdirSync(bt, { recursive: true });
  for (const name of INCLUDED_BT_FILES) {
    const source = join(directory, name);
    if (existsSync(source)) cpSync(source, join(bt, name), { recursive: false });
  }
  if (manifest.includesMemory && existsSync(join(directory, "memory"))) cpSync(join(directory, "memory"), join(root, "memory"), { recursive: true });
  return current;
}
