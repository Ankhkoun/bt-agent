import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { DOMParser } from "@xmldom/xmldom";
import JSZip from "jszip";

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

function hashBlock(text: string): string { return createHash("sha256").update(text).digest("hex"); }

async function parseXlsx(path: string, data: Uint8Array, size: number, modifiedAt: string): Promise<DocumentBlock[]> {
  const zip = await JSZip.loadAsync(data);
  const readXml = async (name: string) => {
    const file = zip.file(name);
    if (!file) throw new Error(`XLSX 缺少 ${name}`);
    return new DOMParser().parseFromString(await file.async("string"), "application/xml");
  };
  const sharedStrings: string[] = [];
  const sharedFile = zip.file("xl/sharedStrings.xml");
  if (sharedFile) {
    const document = new DOMParser().parseFromString(await sharedFile.async("string"), "application/xml");
    for (const item of Array.from(document.getElementsByTagName("si"))) sharedStrings.push(Array.from(item.getElementsByTagName("t")).map((node) => node.textContent ?? "").join(""));
  }
  const workbook = await readXml("xl/workbook.xml");
  const rels = await readXml("xl/_rels/workbook.xml.rels");
  const targets = new Map<string, string>();
  for (const relationship of Array.from(rels.getElementsByTagName("Relationship"))) {
    const id = relationship.getAttribute("Id");
    const target = relationship.getAttribute("Target");
    if (id && target) targets.set(id, target.replace(/^\//, "").startsWith("xl/") ? target.replace(/^\//, "") : `xl/${target.replace(/^\//, "")}`);
  }
  const blocks: DocumentBlock[] = [];
  for (const sheet of Array.from(workbook.getElementsByTagName("sheet"))) {
    const name = sheet.getAttribute("name") || "Sheet";
    const target = targets.get(sheet.getAttribute("r:id") || "");
    if (!target) throw new Error(`XLSX 工作表缺少关系：${name}`);
    const document = await readXml(target);
    for (const row of Array.from(document.getElementsByTagName("row"))) {
      for (const cell of Array.from(row.getElementsByTagName("c"))) {
        const reference = cell.getAttribute("r") || `row-${row.getAttribute("r") || "?"}`;
        const type = cell.getAttribute("t");
        const raw = cell.getElementsByTagName("v")[0]?.textContent ?? cell.getElementsByTagName("f")[0]?.textContent ?? "";
        const inline = Array.from(cell.getElementsByTagName("t")).map((node) => node.textContent ?? "").join("");
        let value = type === "s" ? (sharedStrings[Number(raw)] ?? raw) : type === "inlineStr" ? inline : type === "b" ? (raw === "1" ? "TRUE" : "FALSE") : raw;
        if (!value && inline) value = inline;
        if (!value) continue;
        blocks.push({ id: `cell-${blocks.length + 1}`, path, format: "xlsx", locator: `sheet:${name}!${reference}`, text: value, contentHash: hashBlock(value), metadata: { size, modifiedAt, parseStatus: "ok" } });
      }
    }
  }
  return blocks;
}

async function parsePptx(path: string, data: Uint8Array, size: number, modifiedAt: string): Promise<DocumentBlock[]> {
  const zip = await JSZip.loadAsync(data);
  const slideNames = Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name)).sort((a, b) => Number(a.match(/slide(\d+)/i)?.[1] ?? 0) - Number(b.match(/slide(\d+)/i)?.[1] ?? 0));
  if (!slideNames.length) throw new Error("PPTX 没有可解析的幻灯片");
  return Promise.all(slideNames.map(async (name, index) => {
    const document = new DOMParser().parseFromString(await zip.file(name)!.async("string"), "application/xml");
    const text = Array.from(document.getElementsByTagName("a:t")).map((node) => node.textContent ?? "").join(" ").trim();
    return { id: `slide-${index + 1}`, path, format: "pptx" as const, locator: `slide:${index + 1}`, text, contentHash: hashBlock(text), metadata: { size, modifiedAt, parseStatus: "ok" as const } };
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
    if (format === "xlsx" || format === "pptx") {
      try {
        const data = new Uint8Array(await readFile(absolute));
        return format === "xlsx" ? await parseXlsx(absolute, data, info.size, info.mtime.toISOString()) : await parsePptx(absolute, data, info.size, info.mtime.toISOString());
      } catch (error) {
        return [{ id: "document-parse-error", path: absolute, format, locator: "file", text: "", contentHash: "", metadata: { size: info.size, modifiedAt: info.mtime.toISOString(), parseStatus: "failed", message: error instanceof Error ? error.message : String(error) } }];
      }
    }
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
