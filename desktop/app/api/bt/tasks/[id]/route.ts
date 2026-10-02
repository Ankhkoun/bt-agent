import { NextResponse } from "next/server";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { cancelRun, createArtifact, evaluateTask, getTask, pauseRun, resumeRun, startRun } from "@/lib/bt-harness";
import { abortHarnessRun, executeHarnessRun } from "@/lib/bt-harness-runner";
import { abortTutorRun, executeTutorRun, submitTutorInput } from "@/lib/bt-tutor-runner";
import { executeDocumentRun } from "@/lib/bt-document-runner";
import { executePlannerRun } from "@/lib/bt-planner-runner";
import { abortInterviewerRun, executeInterviewerRun, submitInterviewerInput } from "@/lib/bt-interviewer-runner";
import { abortBuildRun, executeBuildRun } from "@/lib/bt-build-runner";
import { abortReviewRun, executeReviewRun } from "@/lib/bt-review-runner";

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
      if (task?.workflowId === "tutor") void executeTutorRun(run.id).catch((error) => console.error("[bt-harness] tutor run failed:", error));
      if (task?.workflowId === "document") void executeDocumentRun(run.id).catch((error) => console.error("[bt-harness] document run failed:", error));
      if (task?.workflowId === "planner" || task?.workflowId === "personal-planning") void Promise.resolve().then(() => executePlannerRun(run.id)).catch((error) => console.error("[bt-harness] planner run failed:", error));
      if (task?.workflowId === "interviewer") void executeInterviewerRun(run.id).catch((error) => console.error("[bt-harness] interviewer run failed:", error));
      if (task?.workflowId === "build") void executeBuildRun(run.id).catch((error) => console.error("[bt-harness] build run failed:", error));
      if (task?.workflowId === "review") void executeReviewRun(run.id).catch((error) => console.error("[bt-harness] review run failed:", error));
      return NextResponse.json({ task, run }, { status: 201 });
    }
    if (action === "respond") {
      if (typeof body.runId !== "string" || !body.runId) return NextResponse.json({ error: "runId required" }, { status: 400 });
      if (typeof body.text !== "string" || !body.text.trim() || body.text.length > 12000) return NextResponse.json({ error: "text must be 1–12000 characters" }, { status: 400 });
      const task = getTask(id);
      if (task?.workflowId === "tutor") void submitTutorInput(id, body.runId, body.text).catch((error) => console.error("[bt-harness] tutor response failed:", error));
      if (task?.workflowId === "interviewer") void submitInterviewerInput(id, body.runId, body.text).catch((error) => console.error("[bt-harness] interviewer response failed:", error));
      return NextResponse.json({ task: getTask(id) });
    }
    if (typeof body.runId !== "string" || !body.runId) return NextResponse.json({ error: "runId required" }, { status: 400 });
    const runId = body.runId;
    if (action === "pause") { pauseRun(runId); await abortHarnessRun(runId); await abortTutorRun(runId); await abortInterviewerRun(runId); await abortBuildRun(runId); await abortReviewRun(runId); }
    else if (action === "resume") { const run = resumeRun(runId); const task = getTask(id); if (task?.workflowId === "research") void executeHarnessRun(run.id).catch((error) => console.error("[bt-harness] research resume failed:", error)); if (task?.workflowId === "tutor") void executeTutorRun(run.id).catch((error) => console.error("[bt-harness] tutor resume failed:", error)); if (task?.workflowId === "document") void executeDocumentRun(run.id).catch((error) => console.error("[bt-harness] document resume failed:", error)); if (task?.workflowId === "planner" || task?.workflowId === "personal-planning") void Promise.resolve().then(() => executePlannerRun(run.id)).catch((error) => console.error("[bt-harness] planner resume failed:", error)); if (task?.workflowId === "interviewer") void executeInterviewerRun(run.id).catch((error) => console.error("[bt-harness] interviewer resume failed:", error)); if (task?.workflowId === "build") void executeBuildRun(run.id).catch((error) => console.error("[bt-harness] build resume failed:", error)); if (task?.workflowId === "review") void executeReviewRun(run.id).catch((error) => console.error("[bt-harness] review resume failed:", error)); }
    else if (action === "execute") { const task = getTask(id); if (task?.workflowId === "research") void executeHarnessRun(runId).catch((error) => console.error("[bt-harness] research execute failed:", error)); if (task?.workflowId === "tutor") void executeTutorRun(runId).catch((error) => console.error("[bt-harness] tutor execute failed:", error)); if (task?.workflowId === "document") void executeDocumentRun(runId).catch((error) => console.error("[bt-harness] document execute failed:", error)); if (task?.workflowId === "planner" || task?.workflowId === "personal-planning") void Promise.resolve().then(() => executePlannerRun(runId)).catch((error) => console.error("[bt-harness] planner execute failed:", error)); if (task?.workflowId === "interviewer") void executeInterviewerRun(runId).catch((error) => console.error("[bt-harness] interviewer execute failed:", error)); if (task?.workflowId === "build") void executeBuildRun(runId).catch((error) => console.error("[bt-harness] build execute failed:", error)); if (task?.workflowId === "review") void executeReviewRun(runId).catch((error) => console.error("[bt-harness] review execute failed:", error)); }
    else if (action === "cancel") { cancelRun(runId); await abortHarnessRun(runId); await abortTutorRun(runId); await abortInterviewerRun(runId); await abortBuildRun(runId); await abortReviewRun(runId); }
    else if (action === "evaluate") evaluateTask({ taskId: id, runId, criteria: Array.isArray(body.criteria) ? body.criteria as never : undefined, pending: Array.isArray(body.pending) ? body.pending.filter((item): item is string => typeof item === "string") : undefined, humanReview: typeof body.humanReview === "string" ? body.humanReview : undefined });
    else if (action === "artifact") {
      if (typeof body.kind !== "string" || typeof body.summary !== "string") return NextResponse.json({ error: "kind and summary required" }, { status: 400 });
      createArtifact({ taskId: id, runId, kind: body.kind, path: typeof body.path === "string" ? body.path : undefined, content: typeof body.content === "string" ? body.content : undefined, summary: body.summary });
    } else return NextResponse.json({ error: "unknown task action" }, { status: 400 });
    return NextResponse.json({ task: getTask(id) });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 409 }); }
}
