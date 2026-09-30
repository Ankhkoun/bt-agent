import { NextResponse } from "next/server";
import { btRoot } from "@/lib/bt-config";
import { MemoryConflict, readMemoryReview, reviewMemory } from "@/lib/bt-memory";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  if (!isApiRequestAllowed(req)) return NextResponse.json({ error: "Untrusted request" }, { status: 403 });
  try { return NextResponse.json(readMemoryReview(btRoot())); }
  catch (error) { return failure(error); }
}
export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) return NextResponse.json({ error: "Untrusted request" }, { status: 403 });
  if (!hasJsonContentType(req)) return NextResponse.json({ error: "JSON required" }, { status: 415 });
  try { return NextResponse.json(reviewMemory(btRoot(), await req.json())); }
  catch (error) { return failure(error); }
}
function failure(error: unknown) {
  return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: error instanceof MemoryConflict ? 409 : 400 });
}
