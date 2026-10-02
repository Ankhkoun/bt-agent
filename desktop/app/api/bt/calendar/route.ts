import { NextResponse } from "next/server";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { CalendarConflict, readCalendar, saveCalendarEvent } from "@/lib/bt-calendar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!isApiRequestAllowed(req)) return NextResponse.json({ error: "Untrusted request" }, { status: 403 });
  try { return NextResponse.json(readCalendar()); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 }); }
}

export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) return NextResponse.json({ error: "Untrusted request" }, { status: 403 });
  if (!hasJsonContentType(req)) return NextResponse.json({ error: "JSON required" }, { status: 415 });
  try {
    const text = await req.text();
    if (text.length > 32000) return NextResponse.json({ error: "日程内容过长" }, { status: 413 });
    const body = JSON.parse(text) as { event?: unknown; revision?: unknown };
    return NextResponse.json(saveCalendarEvent(body.event, body.revision));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: error instanceof CalendarConflict ? 409 : 400 });
  }
}
