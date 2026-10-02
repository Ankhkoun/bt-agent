import { NextResponse } from "next/server";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { requestApproval } from "@/lib/bt-harness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) return NextResponse.json({ error: "Untrusted request" }, { status: 403 });
  if (!hasJsonContentType(req)) return NextResponse.json({ error: "JSON required" }, { status: 415 });
  try {
    const body = await req.json() as Record<string, unknown>;
    if (typeof body.taskId !== "string" || typeof body.runId !== "string" || typeof body.riskLevel !== "string" || typeof body.scope !== "string" || typeof body.reason !== "string") {
      return NextResponse.json({ error: "taskId, runId, riskLevel, scope and reason required" }, { status: 400 });
    }
    return NextResponse.json({ approval: requestApproval({ taskId: body.taskId, runId: body.runId, stepId: typeof body.stepId === "string" ? body.stepId : undefined, actionId: typeof body.actionId === "string" ? body.actionId : undefined, riskLevel: body.riskLevel as never, scope: body.scope, reason: body.reason, expiresAt: typeof body.expiresAt === "string" ? body.expiresAt : undefined }) }, { status: 201 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 }); }
}
