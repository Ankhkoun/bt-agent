import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { btRoot } from "@/lib/bt-config";
import { isApiRequestAllowed } from "@/lib/request-security";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const limit = 10 * 1024 * 1024;
function imageType(b: Buffer): string | undefined {
  if (b.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return "png";
  if (b[0] === 255 && b[1] === 216 && b[2] === 255) return "jpg";
  if (["GIF87a", "GIF89a"].includes(b.toString("ascii", 0, 6))) return "gif";
  if (b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") return "webp";
}
export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) return Response.json({ error: "Untrusted request" }, { status: 403 });
  if (!req.headers.get("content-type")?.startsWith("image/")) return Response.json({ error: "请选择 PNG、JPEG、GIF 或 WebP 图片" }, { status: 415 });
  try {
    const reader = req.body?.getReader();
    if (!reader) return Response.json({ error: "图片为空" }, { status: 400 });
    const chunks: Uint8Array[] = []; let size = 0;
    for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > limit) { await reader.cancel(); return Response.json({ error: "单张图片最多 10 MB" }, { status: 413 }); } chunks.push(value); }
    const bytes = Buffer.concat(chunks); const ext = imageType(bytes);
    if (!ext) return Response.json({ error: "不支持此图片格式" }, { status: 415 });
    const directory = join(btRoot(), ".bt", "notebook-images"); await mkdir(directory, { recursive: true });
    const id = `${randomUUID()}.${ext}`;
    await writeFile(join(directory, id), bytes, { flag: "wx", mode: 0o600 });
    return Response.json({ url: `/api/bt/notebooks/images?id=${id}` });
  } catch { return Response.json({ error: "图片保存失败，请重试" }, { status: 500 }); }
}
export async function GET(req: Request) {
  if (!isApiRequestAllowed(req)) return Response.json({ error: "Untrusted request" }, { status: 403 });
  const id = new URL(req.url).searchParams.get("id") || "";
  if (!/^[a-f0-9-]{36}\.(png|jpg|gif|webp)$/.test(id)) return new Response(null, { status: 400 });
  try {
    const bytes = await readFile(join(btRoot(), ".bt", "notebook-images", id));
    const type = imageType(bytes); if (!type) return new Response(null, { status: 415 });
    return new Response(new Uint8Array(bytes), { headers: { "Content-Type": `image/${type === "jpg" ? "jpeg" : type}`, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, max-age=86400" } });
  } catch { return new Response(null, { status: 404 }); }
}
