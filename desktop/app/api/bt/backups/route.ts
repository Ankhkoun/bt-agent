import { NextResponse } from "next/server";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { btRoot } from "@/lib/bt-config";
import { createHarnessBackup, listHarnessBackups, restoreHarnessBackup } from "@/lib/bt-backup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!isApiRequestAllowed(req)) return NextResponse.json({ error: "Untrusted request" }, { status: 403 });
  try { return NextResponse.json({ backups: listHarnessBackups(btRoot()) }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 }); }
}

export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) return NextResponse.json({ error: "Untrusted request" }, { status: 403 });
  if (!hasJsonContentType(req)) return NextResponse.json({ error: "JSON required" }, { status: 415 });
  try {
    const body = await req.json() as { action?: unknown; id?: unknown };
    if (body.action === "create") return NextResponse.json({ backup: createHarnessBackup(btRoot()) }, { status: 201 });
    if (body.action === "restore" && typeof body.id === "string") return NextResponse.json({ backup: restoreHarnessBackup(btRoot(), body.id) });
    return NextResponse.json({ error: "action must be create or restore" }, { status: 400 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 409 }); }
}

