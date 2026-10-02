import { NextResponse } from "next/server";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { getRun, markStep, retryStep } from "@/lib/bt-harness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isApiRequestAllowed(req)) return NextResponse.json({ error: "Untrusted request" }, { status: 403 });
  const { id } = await params;
  try {
    const result = getRun(id);
    return result ? NextResponse.json(result) : NextResponse.json({ error: "Run not found" }, { status: 404 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 }); }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isApiRequestAllowed(req)) return NextResponse.json({ error: "Untrusted request" }, { status: 403 });
  if (!hasJsonContentType(req)) return NextResponse.json({ error: "JSON required" }, { status: 415 });
  const { id } = await params;
  try {
    const result = getRun(id);
    if (!result) return NextResponse.json({ error: "Run not found" }, { status: 404 });
    const body = await req.json() as Record<string, unknown>;
    if (typeof body.stepId === "string" && !result.task.steps.some((step) => step.id === body.stepId && step.runId === id)) return NextResponse.json({ error: "Step does not belong to run" }, { status: 409 });
    if (body.action === "retry-step" && typeof body.stepId === "string") return NextResponse.json({ step: retryStep(body.stepId) });
    if (body.action === "mark-step" && typeof body.stepId === "string" && typeof body.status === "string") {
      return NextResponse.json({ step: markStep({ stepId: body.stepId, status: body.status as never, output: body.output && typeof body.output === "object" ? body.output as Record<string, unknown> : undefined, failureReason: typeof body.failureReason === "string" ? body.failureReason : undefined }) });
    }
    return NextResponse.json({ error: "unknown run action" }, { status: 400 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 409 }); }
}
