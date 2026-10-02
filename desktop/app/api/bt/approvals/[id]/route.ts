import { NextResponse } from "next/server";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { getRun, resolveApproval } from "@/lib/bt-harness";
import { executeHarnessRun } from "@/lib/bt-harness-runner";
import { executeTutorRun } from "@/lib/bt-tutor-runner";
import { executePlannerRun } from "@/lib/bt-planner-runner";
import { executeInterviewerRun } from "@/lib/bt-interviewer-runner";
import { executeBuildRun } from "@/lib/bt-build-runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isApiRequestAllowed(req)) return NextResponse.json({ error: "Untrusted request" }, { status: 403 });
  if (!hasJsonContentType(req)) return NextResponse.json({ error: "JSON required" }, { status: 415 });
  const { id } = await params;
  try {
    const body = await req.json() as { decision?: unknown };
    if (!(["approved", "rejected", "expired"] as const).includes(body.decision as never)) return NextResponse.json({ error: "decision must be approved, rejected or expired" }, { status: 400 });
    const approval = resolveApproval(id, body.decision as "approved" | "rejected" | "expired");
    if (approval.decision === "approved") {
      const run = getRun(approval.runId);
      if (run?.task.workflowId === "research") void executeHarnessRun(approval.runId).catch((error) => console.error("[bt-harness] approved research run failed:", error));
      if (run?.task.workflowId === "tutor") void executeTutorRun(approval.runId).catch((error) => console.error("[bt-harness] approved tutor run failed:", error));
      if (run?.task.workflowId === "planner" || run?.task.workflowId === "personal-planning") void Promise.resolve().then(() => executePlannerRun(approval.runId)).catch((error) => console.error("[bt-harness] approved planner run failed:", error));
      if (run?.task.workflowId === "interviewer") void executeInterviewerRun(approval.runId).catch((error) => console.error("[bt-harness] approved interviewer run failed:", error));
      if (run?.task.workflowId === "build") void executeBuildRun(approval.runId).catch((error) => console.error("[bt-harness] approved build run failed:", error));
    }
    return NextResponse.json({ approval });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 409 }); }
}
