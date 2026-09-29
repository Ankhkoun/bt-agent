import { NextResponse } from "next/server";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { NotebookConflict, readNotebooks, updateNotebooks } from "@/lib/bt-notebooks";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  if (!isApiRequestAllowed(req)) return NextResponse.json({ error: "Untrusted request" }, { status: 403 });
  try { return NextResponse.json(readNotebooks()); }
  catch (e) { return NextResponse.json({ error: String(e) }, { status: 500 }); }
}
export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) return NextResponse.json({ error: "Untrusted request" }, { status: 403 });
  if (!hasJsonContentType(req)) return NextResponse.json({ error: "JSON required" }, { status: 415 });
  try {
    const text = await req.text();
    if (text.length > 310000) return NextResponse.json({ error: "内容过长" }, { status: 413 });
    return NextResponse.json(updateNotebooks(JSON.parse(text)));
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: e instanceof NotebookConflict ? 409 : 400 }); }
}
