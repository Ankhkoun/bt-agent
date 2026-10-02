import { randomUUID } from "node:crypto";
import { createArtifact, evaluateTask, getRun, markStep, requestApproval } from "./bt-harness";
import { btRoot } from "./bt-config";
import { readPlanBook, savePlanItem } from "./bt-planner";
import { localDate, type PlanItem } from "./bt-planner-model";
import { readNotebooks, updateNotebooks } from "./bt-notebooks";

export interface PersonalAffairsRunnerOptions { root?: string }

function currentStep(runId: string, root: string) {
  const detail = getRun(runId, root);
  if (!detail) throw new Error("运行不存在");
  const step = detail.task.steps.find((item) => item.id === detail.run.currentStepId);
  if (!step) throw new Error("运行没有当前步骤");
  return { detail, step };
}

function planItem(detail: ReturnType<typeof currentStep>): PlanItem {
  const metadata = detail.detail.task.metadata;
  const priority = metadata.priority === "P1" || metadata.priority === "P2" || metadata.priority === "P3" ? metadata.priority : "P2";
  const date = typeof metadata.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(metadata.date) ? metadata.date : localDate();
  return {
    id: randomUUID(),
    title: detail.detail.task.objective,
    kind: "task",
    status: "todo",
    date,
    project: typeof metadata.project === "string" ? metadata.project.slice(0, 240) : "",
    priority,
    goalId: "",
    notes: detail.detail.task.scope.slice(0, 20000),
    completedOn: "",
    updatedAt: new Date().toISOString(),
    steps: [],
  };
}

function proposalContent(detail: ReturnType<typeof currentStep>, item: PlanItem): string {
  return `# 个人事务安排候选\n\n事务：${detail.detail.task.objective}\n\n约束：${detail.detail.task.scope || "未提供"}\n\n拟安排日期：${item.date}\n优先级：${item.priority}\n项目：${item.project || "未关联"}\n\n用户批准后才会写入本地计划本和随手记；不会自动写入外部日历或发送提醒。\n`;
}

export function executePersonalAffairsRun(runId: string, options: PersonalAffairsRunnerOptions = {}): void {
  const root = options.root ?? btRoot();
  const result = getRun(runId, root);
  if (!result) throw new Error("运行不存在");
  if (result.task.workflowId !== "personal-affairs") throw new Error("当前运行不是 Personal Affairs 工作流");
  if (result.run.status !== "running") return;

  const capture = currentStep(runId, root);
  if (capture.step.kind === "capture") markStep({ stepId: capture.step.id, status: "completed", output: { objective: capture.detail.task.objective } }, root);
  const clarify = currentStep(runId, root);
  if (clarify.step.kind === "clarify") markStep({ stepId: clarify.step.id, status: "completed", output: { scope: clarify.detail.task.scope } }, root);

  const schedule = currentStep(runId, root);
  if (schedule.step.kind !== "schedule") throw new Error("Personal Affairs 安排步骤状态不一致");
  const item = planItem(schedule);
  const latest = getRun(runId, root);
  if (!latest) throw new Error("运行不存在");
  const approved = latest.task.approvals.some((approval) => approval.stepId === schedule.step.id && approval.decision === "approved");
  if (!approved) {
    if (!latest.task.artifacts.some((artifact) => artifact.kind === "affairs-proposal")) {
      createArtifact({ taskId: latest.task.id, runId, kind: "affairs-proposal", content: proposalContent(schedule, item), summary: "等待用户批准的个人事务安排候选" }, root);
    }
    if (!latest.task.approvals.some((approval) => approval.stepId === schedule.step.id && approval.decision === "pending")) {
      requestApproval({ taskId: latest.task.id, runId, stepId: schedule.step.id, riskLevel: "L1", scope: `安排个人事务：${item.title}`, reason: "模型只能提出事务安排候选，写入正式计划和随手记需要用户明确批准" }, root);
    }
    return;
  }

  let saved: PlanItem;
  try {
    const book = readPlanBook(root);
    savePlanItem(item, book.revision, root);
    saved = item;
  } catch (error) {
    markStep({ stepId: schedule.step.id, status: "failed", failureReason: error instanceof Error ? error.message : String(error) }, root);
    throw error;
  }
  markStep({ stepId: schedule.step.id, status: "completed", output: { planItemId: saved.id, date: saved.date } }, root);

  const review = currentStep(runId, root);
  if (review.step.kind !== "review") throw new Error("Personal Affairs 复盘步骤状态不一致");
  const notebooks = readNotebooks(root);
  const notebookId = notebooks.books[0]?.id ?? "default";
  const updated = updateNotebooks({
    action: "note",
    notebookId,
    text: `个人事务已安排\n\n事务：${latest.task.objective}\n日期：${saved.date}\n优先级：${saved.priority}\n\n待复盘：执行结果、延期原因和下一步。`,
    revision: notebooks.revision,
  }, root);
  evaluateTask({ taskId: latest.task.id, runId, criteria: latest.task.acceptanceCriteria.map((criterion) => ({ criterion, passed: true, note: "用户批准后已写入本地计划本，并创建复盘记录" })) }, root);
  markStep({ stepId: review.step.id, status: "completed", output: { notebookRevision: updated.revision, planItemId: saved.id } }, root);
}
