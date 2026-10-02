import { NextResponse } from "next/server";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import { parseDocument } from "@/lib/bt-document";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) return NextResponse.json({ error: "Untrusted request" }, { status: 403 });
  if (!hasJsonContentType(req)) return NextResponse.json({ error: "JSON required" }, { status: 415 });
  try {
    const body = await req.json() as { path?: unknown };
    if (typeof body.path !== "string" || !body.path.trim()) return NextResponse.json({ error: "path required" }, { status: 400 });
    const roots = await getAllowedFileRoots(body.path);
    if (!isExistingFilePathAllowed(body.path, roots)) return NextResponse.json({ error: "Access denied" }, { status: 403 });
    return NextResponse.json({ path: body.path, blocks: await parseDocument(body.path, req.signal) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}

