import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { btRoot } from "./bt-config";
import { writePrivateFileAtomicSync } from "./atomic-file";
import { type PlanBook, validatePlanItem } from "./bt-planner-model";

export function readPlanBook(root = btRoot()): PlanBook {
  const path = join(root, ".bt", "planner.json");
  if (!existsSync(path)) return { revision: 0, items: [] };
  const data = JSON.parse(readFileSync(path, "utf8"));
  if (!Number.isSafeInteger(data.revision) || data.revision < 0 || !Array.isArray(data.items)) throw new Error("计划本文件格式无效，原文件已保留");
  return { revision: data.revision, items: data.items.map(validatePlanItem) };
}
export class PlanConflict extends Error {}
// Synchronous read/check/atomic replace prevents interleaving within the desktop server.
export function savePlanItem(value: unknown, revision: unknown, root = btRoot()): PlanBook {
  const item = validatePlanItem(value);
  const book = readPlanBook(root);
  if (revision !== book.revision) throw new PlanConflict("计划本已在其他窗口更新。请刷新后重新编辑；当前输入仍保留。");
  if (item.goalId && !book.items.some(p => p.id === item.goalId && p.kind === "goal" && p.id !== item.id)) throw new Error("关联目标不存在，或事项关联了自己");
  if (item.kind !== "goal" && book.items.some(p => p.goalId === item.id)) throw new Error("此目标仍有关联事项，不能改为其他类型");
  item.updatedAt = new Date().toISOString();
  const index = book.items.findIndex(p => p.id === item.id);
  if (index < 0) book.items.push(item); else book.items[index] = item;
  book.revision++;
  mkdirSync(join(root, ".bt"), { recursive: true });
  writePrivateFileAtomicSync(join(root, ".bt", "planner.json"), JSON.stringify(book, null, 2));
  return book;
}
