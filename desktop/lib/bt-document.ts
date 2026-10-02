import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve } from "node:path";

export type DocumentFormat = "markdown" | "text" | "pdf" | "docx" | "xlsx" | "pptx" | "unsupported";

export interface DocumentBlock {
  id: string;
  path: string;
  format: DocumentFormat;
  locator: string;
  text: string;
  contentHash: string;
  metadata: { size: number; modifiedAt: string; parseStatus: "ok" | "unsupported" | "failed"; message?: string };
}

const EXTENSIONS: Record<string, DocumentFormat> = {
  ".md": "markdown", ".markdown": "markdown", ".txt": "text", ".log": "text", ".json": "text", ".yaml": "text", ".yml": "text",
  ".pdf": "pdf", ".docx": "docx", ".xlsx": "xlsx", ".pptx": "pptx",
};

export function documentFormat(path: string): DocumentFormat {
  return EXTENSIONS[extname(path).toLowerCase()] ?? "unsupported";
}

function textBlocks(path: string, format: DocumentFormat, content: string, size: number, modifiedAt: string): DocumentBlock[] {
  return content.split(/\r?\n/).map((text, index) => ({
    id: `${format === "docx" ? "paragraph" : "line"}-${index + 1}`, path, format, locator: `${format === "docx" ? "P" : "L"}${index + 1}`, text,
    contentHash: createHash("sha256").update(text).digest("hex"), metadata: { size, modifiedAt, parseStatus: "ok" as const },
  }));
}

export async function parseDocument(path: string, signal?: AbortSignal): Promise<DocumentBlock[]> {
  signal?.throwIfAborted();
  const absolute = resolve(path);
  const info = await stat(absolute);
  if (!info.isFile()) throw new Error("文档路径不是文件");
  if (info.size > 25 * 1024 * 1024) throw new Error("文档超过 25 MB 限制");
  const format = documentFormat(absolute);
  if (format === "unsupported") return [{ id: "document-unsupported", path: absolute, format, locator: "file", text: "", contentHash: "", metadata: { size: info.size, modifiedAt: info.mtime.toISOString(), parseStatus: "unsupported", message: "当前版本未安装该格式的本地解析器" } }];
  if (format !== "pdf") {
    if (format === "docx") {
      try {
        const mammoth = await import("mammoth") as unknown as { extractRawText: (input: { path: string }) => Promise<{ value: string }> };
        const result = await mammoth.extractRawText({ path: absolute });
        return textBlocks(absolute, format, result.value, info.size, info.mtime.toISOString());
      } catch (error) {
        return [{ id: "document-parse-error", path: absolute, format, locator: "file", text: "", contentHash: "", metadata: { size: info.size, modifiedAt: info.mtime.toISOString(), parseStatus: "failed", message: error instanceof Error ? error.message : String(error) } }];
      }
    }
    if (["xlsx", "pptx"].includes(format)) return [{ id: "document-parser-pending", path: absolute, format, locator: "file", text: "", contentHash: "", metadata: { size: info.size, modifiedAt: info.mtime.toISOString(), parseStatus: "unsupported", message: `${format.toUpperCase()} 解析器将在 Office Connector 阶段接入` } }];
    const content = await readFile(absolute, "utf8");
    return textBlocks(absolute, format, content, info.size, info.mtime.toISOString());
  }
  try {
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const document = await getDocument({ data: new Uint8Array(await readFile(absolute)), useSystemFonts: false, disableFontFace: true, verbosity: 0 }).promise;
    if (document.numPages > 300) throw new Error("PDF 超过 300 页限制");
    const blocks: DocumentBlock[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      signal?.throwIfAborted();
      const page = await document.getPage(pageNumber);
      const content = (await page.getTextContent()).items.map((item) => "str" in item ? item.str : "").join(" ").trim();
      blocks.push({ id: `page-${pageNumber}`, path: absolute, format, locator: `page:${pageNumber}`, text: content, contentHash: createHash("sha256").update(content).digest("hex"), metadata: { size: info.size, modifiedAt: info.mtime.toISOString(), parseStatus: "ok" } });
      page.cleanup();
    }
    document.cleanup();
    return blocks;
  } catch (error) {
    return [{ id: "document-parse-error", path: absolute, format, locator: "file", text: "", contentHash: "", metadata: { size: info.size, modifiedAt: info.mtime.toISOString(), parseStatus: "failed", message: error instanceof Error ? error.message : String(error) } }];
  }
}
