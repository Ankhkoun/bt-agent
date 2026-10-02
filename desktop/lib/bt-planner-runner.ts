import { randomUUID } from "node:crypto";
import { createArtifact, evaluateTask, getRun, markStep, requestApproval, type HarnessRun } from "./bt-harness";
import { readPlanBook, savePlanItem } from "./bt-planner";
import { localDate, type PlanItem } from "./bt-planner-model";
import { btRoot } from "./bt-config";

export interface PlannerRunnerOptions { root?: string }

function currentStep(runId: string, root: string) {
  const detail = getRun(runId, root);
  if (!detail) throw new Error("运行不存在");
  const step = detail.task.steps.find((item) => item.id === detail.run.currentStepId);
  if (!step) throw new Error("运行没有当前步骤");
  return { detail, step };
}

function planItem(run: HarnessRun, root: string): PlanItem {
  const detail = getRun(run.id, root);
  if (!detail) throw new Error("运行不存在");
  const metadata = detail.task.metadata;
  const priority = metadata.priority === "P1" || metadata.priority === "P2" || metadata.priority === "P3" ? metadata.priority : "P2";
  const date = typeof metadata.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(metadata.date) ? metadata.date : localDate();
  return {
    id: randomUUID(), title: detail.task.objective, kind: "task", status: "todo", date,
    project: typeof metadata.project === "string" ? metadata.project.slice(0, 240) : "",
    priority, goalId: "", notes: detail.task.scope.slice(0, 20000), completedOn: "", updatedAt: new Date().toISOString(), steps: [],
  };
}

export function executePlannerRun(runId: string, options: PlannerRunnerOptions = {}): void {
  const root = options.root ?? btRoot();
  const result = getRun(runId, root);
  if (!result) throw new Error("运行不存在");
  if (result.task.workflowId !== "planner" && result.task.workflowId !== "personal-planning") throw new Error("当前运行不是 Planner 工作流");
  if (result.run.status !== "running") return;

  const first = currentStep(runId, root);
  if (first.step.kind === "goal" || first.step.kind === "intake") {
    markStep({ stepId: first.step.id, status: "completed", output: { objective: first.detail.task.objective } }, root);
  }
  const constraints = currentStep(runId, root);
  if (constraints.step.kind === "constraints" || constraints.step.kind === "clarify") {
    markStep({ stepId: constraints.step.id, status: "completed", output: { scope: constraints.detail.task.scope } }, root);
  }
  const proposal = currentStep(runId, root);
  if (proposal.step.kind === "propose" || proposal.step.kind === "decide") {
    const detail = proposal.detail;
    const item = planItem(result.run, root);
    const content = `# 计划候选\n\n目标：${detail.task.objective}\n\n约束：${detail.task.scope || "未提供"}\n\n拟创建事项：${item.title}\n日期：${item.date}\n优先级：${item.priority}\n项目：${item.project || "未关联"}\n\n用户批准后才会写入正式计划本。\n`;
    createArtifact({ taskId: detail.task.id, runId, kind: "plan-proposal", content, summary: "等待用户批准的计划候选" }, root);
    markStep({ stepId: proposal.step.id, status: "completed", output: { date: item.date, priority: item.priority } }, root);
    const schedule = currentStep(runId, root);
    requestApproval({ taskId: detail.task.id, runId, stepId: schedule.step.id, riskLevel: "L1", scope: `创建计划事项：${item.title}`, reason: "模型只能提出计划候选，写入正式计划本需要用户明确批准" }, root);
    return;
  }
  const schedule = currentStep(runId, root);
  if (schedule.step.kind !== "schedule") throw new Error("Planner 写入步骤状态不一致");
  const item = planItem(result.run, root);
  try {
    const book = readPlanBook(root);
    savePlanItem(item, book.revision, root);
  } catch (error) {
    markStep({ stepId: schedule.step.id, status: "failed", failureReason: error instanceof Error ? error.message : String(error) }, root);
    throw error;
  }
  const latest = getRun(runId, root);
  if (!latest) throw new Error("运行不存在");
  evaluateTask({ taskId: latest.task.id, runId, criteria: latest.task.acceptanceCriteria.map((criterion) => ({ criterion, passed: true, note: "计划候选已批准并写入计划本" })) }, root);
  markStep({ stepId: schedule.step.id, status: "completed", output: { planItemId: item.id, title: item.title, date: item.date } }, root);
  const completed = getRun(runId, root);
  if (!completed || completed.run.currentStepId === null) return;
  const after = currentStep(runId, root);
  if (after.step.kind === "review") {
    markStep({ stepId: after.step.id, status: "completed", output: { planItemId: item.id, review: "计划已写入本地计划本，等待周期复盘" } }, root);
  }
}
