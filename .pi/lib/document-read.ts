import { access, readFile, stat } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { createRequire } from "node:module";
import { createReadToolDefinition } from "@earendil-works/pi-coding-agent";

// Parsing stays local. The normal read tool retains its line limits and
// continuation semantics; no document is uploaded just by selecting it.
export async function extractPdfText(path: string, signal?: AbortSignal): Promise<Buffer> {
  signal?.throwIfAborted();
  if ((await stat(path)).size > 25 * 1024 * 1024) throw new Error("PDF 超过 25 MB，请先拆分文件再读取。");
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const assets = dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));
  const task = getDocument({
    data: new Uint8Array(await readFile(path)),
    useSystemFonts: false,
    disableFontFace: true,
    verbosity: 0,
    cMapUrl: join(assets, "cmaps").replaceAll("\\", "/") + "/",
    cMapPacked: true,
    standardFontDataUrl: join(assets, "standard_fonts").replaceAll("\\", "/") + "/",
    wasmUrl: join(assets, "wasm").replaceAll("\\", "/") + "/",
  });
  const onAbort = () => { void task.destroy(); };
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    signal?.throwIfAborted();
    const document = await task.promise;
    if (document.numPages > 300) throw new Error("PDF 超过 300 页，请先拆分文件再读取。");
    const chunks = [`[PDF 文本提取；共 ${document.numPages} 页。页内图像、图表和排版未解析。offset/limit 按提取后的文本行计数。]\n`];
    let characters = 0;
    let hasText = false;
    for (let number = 1; number <= document.numPages; number++) {
      signal?.throwIfAborted();
      const page = await document.getPage(number);
      const content = await page.getTextContent();
      let text = "";
      for (const item of content.items) {
        if ("str" in item) text += item.str + (item.hasEOL ? "\n" : " ");
      }
      hasText ||= text.trim().length > 0;
      characters += text.length;
      if (characters > 2_000_000) throw new Error("PDF 提取文本超过 200 万字符，请先拆分文件。");
      chunks.push(`\n--- 第 ${number} 页 ---\n${text.trim() || "[本页没有可提取文字，可能是扫描图片，需要 OCR。]"}\n`);
      page.cleanup();
    }
    if (!hasText) chunks.unshift("[未提取到正文；这是扫描件或没有文本层的 PDF。BT 目前未配置 OCR，不能声称已经读懂内容。]\n");
    return Buffer.from(chunks.join("\n"), "utf8");
  } finally {
    signal?.removeEventListener("abort", onAbort);
    await task.destroy();
  }
}

export function createBTReadTool(cwd: string) {
  const original = createReadToolDefinition(cwd);
  return {
    ...original,
    description: original.description + " BT also extracts PDF text locally. Scanned PDFs require OCR; page images and charts are not extracted.",
    async execute(id: Parameters<typeof original.execute>[0], params: Parameters<typeof original.execute>[1], signal: Parameters<typeof original.execute>[2], update: Parameters<typeof original.execute>[3], ctx: Parameters<typeof original.execute>[4]) {
      if (extname(params.path).toLowerCase() !== ".pdf") return original.execute(id, params, signal, update, ctx);
      const pdfReader = createReadToolDefinition(ctx.cwd, {
        operations: { access, readFile: (path) => extractPdfText(path, signal) },
      });
      return pdfReader.execute(id, params, signal, update, ctx);
    },
  };
}
