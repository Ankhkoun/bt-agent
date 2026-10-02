import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { resolve, relative } from "node:path";
import type { Connector, ConnectorContext, ConnectorItem } from "./bt-connector";

export interface LocalFileItem extends ConnectorItem {
  id: string;
  title: string;
  version: string;
  content: string;
  metadata: { path: string; size: number; contentHash: string };
}

export function createLocalFileConnector(root: string): Connector<LocalFileItem> {
  const base = resolve(root);
  const safePath = (id: string) => {
    const path = resolve(base, id);
    const rel = relative(base, path);
    if (rel.startsWith("..") || rel.includes(`..\\`) || rel.includes("../")) throw new Error("文件路径超出 Connector 根目录");
    return path;
  };
  return {
    id: "local-file",
    version: "1",
    capabilities: ["read"],
    async healthCheck() {
      try { const info = await stat(base); return { ok: info.isDirectory(), message: info.isDirectory() ? undefined : "根路径不是目录" }; }
      catch (error) { return { ok: false, message: error instanceof Error ? error.message : String(error) }; }
    },
    async read(id: string, context?: ConnectorContext) {
      context?.signal?.throwIfAborted();
      const path = safePath(id);
      const info = await stat(path);
      if (!info.isFile()) throw new Error("Connector 目标不是文件");
      if (info.size > 25 * 1024 * 1024) throw new Error("文件超过 25 MB 限制");
      const content = await readFile(path, "utf8");
      const contentHash = createHash("sha256").update(content).digest("hex");
      return { id, title: id, version: `${info.mtimeMs}:${info.size}`, content, metadata: { path, size: info.size, contentHash }, updatedAt: info.mtime.toISOString() };
    },
  };
}

