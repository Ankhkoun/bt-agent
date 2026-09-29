import { existsSync, mkdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import { writePrivateFileAtomicSync } from "./atomic-file";

export const BT_MODES = ["general", "tutor", "interviewer", "planner", "bt"] as const;
export type BTMode = typeof BT_MODES[number];
export const BT_MEMORY = ["profile", "goals", "tasks", "projects", "knowledge_map", "learning_log", "bt_memory"] as const;
export function btRoot(): string {
  const root = process.env.BT_ROOT;
  if (!root || !existsSync(join(root, ".pi", "SYSTEM.md"))) throw new Error("请通过 BT-Agent 桌面启动器打开应用。");
  return resolve(root);
}
export interface BTSettings { defaultMode: BTMode; memoryEnabled: boolean; memoryLimit: number; memoryTotalLimit: number; persona: string }
export const DEFAULT_BT_SETTINGS: BTSettings = { defaultMode: "general", memoryEnabled: true, memoryLimit: 8000, memoryTotalLimit: 64000, persona: "" };
export function readBTSettings(): BTSettings {
  const path = join(btRoot(), ".bt", "preferences.json");
  if (!existsSync(path)) return { ...DEFAULT_BT_SETTINGS };
  return validateBTSettings(JSON.parse(readFileSync(path, "utf8")));
}
export function validateBTSettings(value: unknown): BTSettings {
  if (!value || typeof value !== "object") throw new Error("无效的 BT 设置");
  const data = value as Record<string, unknown>;
  const memoryTotalLimit = data.memoryTotalLimit === undefined ? DEFAULT_BT_SETTINGS.memoryTotalLimit : Number(data.memoryTotalLimit);
  if (!BT_MODES.includes(data.defaultMode as BTMode) || typeof data.memoryEnabled !== "boolean" || !Number.isInteger(data.memoryLimit) || Number(data.memoryLimit) < 2000 || Number(data.memoryLimit) > 32000 || !Number.isInteger(memoryTotalLimit) || memoryTotalLimit < 16000 || memoryTotalLimit > 128000 || typeof data.persona !== "string" || data.persona.length > 8000) throw new Error("设置范围无效：每份记忆 2000–32000 字符，总记忆 16000–128000 字符，个性偏好最多 8000 字符。");
  return { defaultMode: data.defaultMode as BTMode, memoryEnabled: data.memoryEnabled, memoryLimit: Number(data.memoryLimit), memoryTotalLimit, persona: data.persona };
}
export function saveBTSettings(value: unknown): BTSettings {
  const data = validateBTSettings(value);
  mkdirSync(join(btRoot(), ".bt"), { recursive: true });
  writePrivateFileAtomicSync(join(btRoot(), ".bt", "preferences.json"), JSON.stringify(data, null, 2));
  return data;
}
export interface BTProject { id: string; name: string; path: string }
function projectFile() { return join(btRoot(), ".bt", "projects.json"); }
export function readBTProjects(): BTProject[] {
  if (existsSync(projectFile())) return JSON.parse(readFileSync(projectFile(), "utf8"));
  const projects = [{ id: "bt-agent", name: "BT-Agent", path: btRoot() }, ...[
    ["mentor", "导师 Agent"], ["papers", "论文"], ["career", "实习准备"],
  ].map(([id, name]) => ({ id, name, path: join(btRoot(), ".bt", "workspaces", name) }))];
  for (const project of projects) mkdirSync(project.path, { recursive: true });
  writePrivateFileAtomicSync(projectFile(), JSON.stringify(projects, null, 2));
  return projects;
}
export function addBTProject(name: string, path?: string): BTProject[] {
  if (!name.trim() || name.length > 60) throw new Error("项目名称需要 1–60 个字符");
  const id = randomUUID();
  let directory: string;
  if (path?.trim()) {
    directory = realpathSync(path.trim());
    if (!statSync(directory).isDirectory()) throw new Error("请选择已有项目文件夹");
  } else {
    directory = join(btRoot(), ".bt", "workspaces", id);
    mkdirSync(directory, { recursive: true });
  }
  const projects = readBTProjects();
  if (projects.some((p) => p.path.toLowerCase() === directory.toLowerCase())) throw new Error("此文件夹已在项目列表中");
  projects.push({ id, name: name.trim(), path: directory });
  writePrivateFileAtomicSync(projectFile(), JSON.stringify(projects, null, 2));
  return projects;
}
