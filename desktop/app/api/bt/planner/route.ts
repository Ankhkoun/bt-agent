import { NextResponse } from "next/server";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { PlanConflict, readPlanBook, savePlanItem } from "@/lib/bt-planner";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  if (!isApiRequestAllowed(req)) return NextResponse.json({ error: "Untrusted request" }, { status: 403 });
  try { return NextResponse.json(readPlanBook()); }
  catch (error) { return NextResponse.json({ error: String(error) }, { status: 500 }); }
}
export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) return NextResponse.json({ error: "Untrusted request" }, { status: 403 });
  if (!hasJsonContentType(req)) return NextResponse.json({ error: "JSON required" }, { status: 415 });
  try {
    const text = await req.text();
    if (text.length > 32000) return NextResponse.json({ error: "事项内容过长" }, { status: 413 });
    const body = JSON.parse(text);
    return NextResponse.json(savePlanItem(body.item, body.revision));
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: error instanceof PlanConflict ? 409 : 400 }); }
}
