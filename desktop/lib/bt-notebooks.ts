import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { btRoot } from "./bt-config";
import { writePrivateFileAtomicSync } from "./atomic-file";
import type { Notebooks } from "./bt-notebooks-model";
export class NotebookConflict extends Error {}
export function readNotebooks(root = btRoot()): Notebooks {
  const path = join(root, ".bt", "notebooks.json");
  if (!existsSync(path)) return { revision: 0, books: [{ id: "default", name: "我的随手记" }], notes: [] };
  const data = JSON.parse(readFileSync(path, "utf8")) as Notebooks;
  if (!Number.isSafeInteger(data.revision) || data.revision < 0 || !Array.isArray(data.books) || !Array.isArray(data.notes) || !data.books.every(b => typeof b.id === "string" && typeof b.name === "string") || !data.notes.every(n => typeof n.id === "string" && typeof n.text === "string" && typeof n.createdAt === "string" && typeof n.updatedAt === "string" && data.books.some(b => b.id === n.notebookId))) throw new Error("笔记本文件格式无效，原文件已保留");
  return data;
}
export function updateNotebooks(value: unknown, root = btRoot()): Notebooks {
  if (!value || typeof value !== "object") throw new Error("无效请求");
  const p = value as Record<string, unknown>;
  const data = readNotebooks(root);
  if (p.revision !== data.revision) throw new NotebookConflict("笔记本已在其他窗口更新，请刷新后再保存。当前正文会保留。");
  if (p.action === "create" || p.action === "rename") {
    if (typeof p.name !== "string" || !p.name.trim() || p.name.trim().length > 80) throw new Error("笔记本名称需要 1–80 个字符");
    if (p.action === "create") data.books.push({ id: randomUUID(), name: p.name.trim() });
    else { const book = data.books.find(b => b.id === p.id); if (!book) throw new Error("笔记本不存在"); book.name = p.name.trim(); }
  } else if (p.action === "note") {
    if (typeof p.text !== "string" || !p.text.trim() || p.text.length > 50000) throw new Error("正文需要 1–50000 个字符");
    if (!data.books.some(b => b.id === p.notebookId)) throw new Error("笔记本不存在");
    const now = new Date().toISOString();
    if (p.id) {
      const note = data.notes.find(n => n.id === p.id && n.notebookId === p.notebookId);
      if (!note) throw new Error("笔记不存在");
      note.text = p.text; note.updatedAt = now;
    } else data.notes.push({ id: randomUUID(), notebookId: String(p.notebookId), text: p.text, createdAt: now, updatedAt: now });
  } else throw new Error("未知操作");
  data.revision++;
  mkdirSync(join(root, ".bt"), { recursive: true });
  writePrivateFileAtomicSync(join(root, ".bt", "notebooks.json"), JSON.stringify(data, null, 2));
  return data;
}
