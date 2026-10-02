import { NextResponse } from "next/server";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { cancelRun, createArtifact, evaluateTask, getTask, pauseRun, resumeRun, startRun } from "@/lib/bt-harness";
import { abortHarnessRun, executeHarnessRun } from "@/lib/bt-harness-runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isApiRequestAllowed(req)) return NextResponse.json({ error: "Untrusted request" }, { status: 403 });
  const { id } = await params;
  try {
    const task = getTask(id);
    return task ? NextResponse.json({ task }) : NextResponse.json({ error: "Task not found" }, { status: 404 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 }); }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isApiRequestAllowed(req)) return NextResponse.json({ error: "Untrusted request" }, { status: 403 });
  if (!hasJsonContentType(req)) return NextResponse.json({ error: "JSON required" }, { status: 415 });
  const { id } = await params;
  try {
    const body = await req.json() as Record<string, unknown>;
    const action = body.action;
    if (action === "start") {
      const run = startRun(id);
      const task = getTask(id);
      if (task?.workflowId === "research") void executeHarnessRun(run.id).catch((error) => console.error("[bt-harness] research run failed:", error));
      return NextResponse.json({ task, run }, { status: 201 });
    }
    if (typeof body.runId !== "string" || !body.runId) return NextResponse.json({ error: "runId required" }, { status: 400 });
    if (action === "pause") { pauseRun(body.runId); await abortHarnessRun(body.runId); }
    else if (action === "resume") { const run = resumeRun(body.runId); if (getTask(id)?.workflowId === "research") void executeHarnessRun(run.id).catch((error) => console.error("[bt-harness] research resume failed:", error)); }
    else if (action === "execute") { void executeHarnessRun(body.runId).catch((error) => console.error("[bt-harness] research execute failed:", error)); }
    else if (action === "cancel") { cancelRun(body.runId); await abortHarnessRun(body.runId); }
    else if (action === "evaluate") evaluateTask({ taskId: id, runId: body.runId, criteria: Array.isArray(body.criteria) ? body.criteria as never : undefined, pending: Array.isArray(body.pending) ? body.pending.filter((item): item is string => typeof item === "string") : undefined, humanReview: typeof body.humanReview === "string" ? body.humanReview : undefined });
    else if (action === "artifact") {
      if (typeof body.kind !== "string" || typeof body.summary !== "string") return NextResponse.json({ error: "kind and summary required" }, { status: 400 });
      createArtifact({ taskId: id, runId: body.runId, kind: body.kind, path: typeof body.path === "string" ? body.path : undefined, content: typeof body.content === "string" ? body.content : undefined, summary: body.summary });
    } else return NextResponse.json({ error: "unknown task action" }, { status: 400 });
    return NextResponse.json({ task: getTask(id) });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 409 }); }
}
