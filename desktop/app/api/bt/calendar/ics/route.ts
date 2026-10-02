import { join } from "node:path";
import { NextResponse } from "next/server";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { CalendarConflict, readCalendar, replaceCalendarEvents } from "@/lib/bt-calendar";
import { btRoot } from "@/lib/bt-config";
import { createIcsConnector } from "@/lib/bt-ics-connector";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) return NextResponse.json({ error: "Untrusted request" }, { status: 403 });
  if (!hasJsonContentType(req)) return NextResponse.json({ error: "JSON required" }, { status: 415 });
  try {
    const text = await req.text();
    if (text.length > 4000) return NextResponse.json({ error: "请求内容过长" }, { status: 413 });
    const body = JSON.parse(text) as { direction?: unknown; revision?: unknown };
    if (body.direction !== "import" && body.direction !== "export") throw new Error("ICS 操作无效");
    const connector = createIcsConnector(join(btRoot(), ".bt", "calendar.ics"));
    if (body.direction === "export") {
      const book = readCalendar();
      const item = await connector.create?.({ id: "calendar", title: "BT Calendar", content: book.events, metadata: { contentHash: "", eventCount: book.events.length, path: ".bt/calendar.ics" } });
      return NextResponse.json({ book, cursor: item?.version ?? null });
    }
    const item = await connector.read("calendar");
    const book = replaceCalendarEvents(item.content, body.revision);
    return NextResponse.json({ book, cursor: item.version, imported: item.content.length });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: error instanceof CalendarConflict ? 409 : 400 });
  }
}
