import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { btRoot } from "./bt-config";
import {
  completeAction,
  createArtifact,
  evaluateTask,
  getRun,
  markStep,
  recordAction,
  recordEvidence,
  recordHarnessEvent,
  requestApproval,
  type HarnessRun,
} from "./bt-harness";
import { policyForTool } from "./bt-policy";
import { startRpcSession } from "./rpc-manager";

type AgentEvent = { type: string; [key: string]: unknown };

export interface ReviewAgentSession {
  readonly sessionId: string;
  onEvent(listener: (event: AgentEvent) => void): () => void;
  send(command: Record<string, unknown>): Promise<unknown>;
}

export interface ReviewRunnerOptions {
  root?: string;
  createSession?: (cwd: string, key: string) => Promise<ReviewAgentSession>;
  timeoutMs?: number;
}

const activeRuns = new Map<string, { session: ReviewAgentSession; abort: () => Promise<unknown> }>();

function isDirectory(path: string): boolean {
  try { return statSync(path).isDirectory(); } catch { return false; }
}

function resolveTaskCwd(task: { scope: string; metadata: Record<string, unknown> }, root: string): string {
  const candidates = [task.metadata.cwd, task.metadata.projectPath, task.scope]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => resolve(value));
  return candidates.find(isDirectory) ?? root;
}

function compact(value: unknown, limit = 12000): string {
  if (typeof value === "string") return value.slice(0, limit);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.content)) {
      const text = record.content
        .filter((item) => item && typeof item === "object" && (item as Record<string, unknown>).type === "text")
        .map((item) => String((item as Record<string, unknown>).text ?? ""))
        .join("\n");
      if (text) return text.slice(0, limit);
    }
    try { return JSON.stringify(value).slice(0, limit); } catch { return String(value).slice(0, limit); }
  }
  return value === undefined ? "" : String(value).slice(0, limit);
}

function textFromMessage(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const record = message as Record<string, unknown>;
  if (record.role !== "assistant") return "";
  if (typeof record.content === "string") return record.content.trim();
  if (!Array.isArray(record.content)) return "";
  return record.content
    .filter((item) => item && typeof item === "object" && (item as Record<string, unknown>).type === "text")
    .map((item) => String((item as Record<string, unknown>).text ?? ""))
    .join("\n")
    .trim();
}

function findFilePath(args: unknown): string | undefined {
  if (!args || typeof args !== "object") return undefined;
  const value = args as Record<string, unknown>;
  for (const key of ["path", "filePath", "file"]) {
    if (typeof value[key] === "string" && value[key].trim()) return value[key].trim();
  }
  return undefined;
}

function currentStep(runId: string, root: string) {
  const detail = getRun(runId, root);
  if (!detail) throw new Error("运行不存在");
  const step = detail.task.steps.find((item) => item.id === detail.run.currentStepId);
  if (!step) throw new Error("运行没有当前步骤");
  return { detail, step };
}

function reviewPrompt(task: { objective: string; scope: string }): string {
  return [
    "你正在执行 BT-Agent 的 Review 审查工作流。只允许读取和分析，不要修改项目文件，不要执行写入、删除、上传或发送操作。",
    `审查目标：${task.objective}`,
    task.scope ? `用户给定范围：${task.scope}` : "用户未给出额外范围，请从项目入口和目录结构确定范围。",
    "请读取相关实现、文档、测试和 Git 变更，先验证事实，再给出审查结论。每个问题都要尽量引用文件路径、行号、测试或命令证据，明确区分事实、风险和推断。不要编造指标。",
    "最后输出结构化报告，必须包含：## Findings（按严重程度排序的问题或确认项）、## Evidence（证据定位）、## Risks（剩余风险）、## Next actions（可执行后续动作）。如果没有问题，也要说明检查过的范围和未验证项。",
  ].join("\n");
}

async function defaultSession(cwd: string, key: string): Promise<ReviewAgentSession> {
  return (await startRpcSession(key, "", cwd, { toolNames: ["read", "grep", "find", "ls", "git"] })).session;
}

async function execute(run: HarnessRun, options: ReviewRunnerOptions): Promise<void> {
  const root = options.root ?? btRoot();
  const initial = currentStep(run.id, root);
  const cwd = resolveTaskCwd(initial.detail.task, root);
  if (initial.step.kind === "scope") markStep({ stepId: initial.step.id, status: "completed", output: { cwd } }, root);
  const inspect = currentStep(run.id, root);
  if (inspect.step.kind !== "inspect") throw new Error("Review 检查步骤状态不一致");
  const session = await (options.createSession ?? defaultSession)(cwd, `bt-review-${run.id}`);
  const abort = async () => session.send({ type: "abort" });
  activeRuns.set(run.id, { session, abort });
  const actions = new Map<string, { id: string; args: Record<string, unknown> }>();
  const evidenceIds: string[] = [];
  let finalText = "";
  let blockedByPolicy = false;
  let settled = false;
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const finish = (resolvePromise: () => void, rejectPromise: (error: unknown) => void, error?: unknown) => {
    if (settled) return;
    settled = true;
    if (timeout) clearTimeout(timeout);
    activeRuns.delete(run.id);
    if (error === undefined) resolvePromise(); else rejectPromise(error);
  };

  await new Promise<void>((resolvePromise, rejectPromise) => {
    const unsubscribe = session.onEvent((event) => {
      try {
        const latest = getRun(run.id, root);
        if (!latest) throw new Error("运行不存在");
        const stepId = latest.run.currentStepId;
        if (["agent_start", "prompt_error", "agent_end", "tool_execution_start", "tool_execution_end", "message_end"].includes(event.type)) {
          recordHarnessEvent({ taskId: latest.task.id, runId: run.id, stepId: stepId ?? undefined, type: `agent_${event.type}`, payload: {
            sessionId: session.sessionId,
            toolCallId: typeof event.toolCallId === "string" ? event.toolCallId : undefined,
            toolName: typeof event.toolName === "string" ? event.toolName : undefined,
          } }, root);
        }
        if (event.type === "tool_execution_start" && typeof event.toolName === "string") {
          const policy = policyForTool(event.toolName);
          const args = event.args && typeof event.args === "object" ? event.args as Record<string, unknown> : {};
          const action = recordAction({ taskId: latest.task.id, runId: run.id, stepId: stepId ?? undefined, sessionId: session.sessionId, kind: "tool_call", toolName: event.toolName, riskLevel: policy.riskLevel, input: args }, root);
          if (typeof event.toolCallId === "string") actions.set(event.toolCallId, { id: action.id, args });
          if (policy.decision === "deny" || policy.decision === "approval_required") {
            blockedByPolicy = true;
            completeAction({ actionId: action.id, status: "blocked", output: { reason: policy.decision === "deny" ? "L3 操作被 Harness 拒绝" : "Review 只允许读取操作，需要审批才能继续", riskLevel: policy.riskLevel } }, root);
            if (policy.decision === "approval_required") requestApproval({ taskId: latest.task.id, runId: run.id, stepId: stepId ?? undefined, actionId: action.id, riskLevel: policy.riskLevel, scope: `${event.toolName} 工具调用`, reason: "Review 工作流默认只读，继续执行会改变项目或外部状态" }, root);
            void abort();
          }
        }
        if (event.type === "tool_execution_end") {
          const action = typeof event.toolCallId === "string" ? actions.get(event.toolCallId) : undefined;
          if (action) {
            const row = getRun(run.id, root)?.task.actions.find((item) => item.id === action.id);
            if (row?.status === "running") completeAction({ actionId: action.id, status: event.result && typeof event.result === "object" && (event.result as Record<string, unknown>).isError ? "failed" : "succeeded", output: event.result }, root);
          }
          const quote = compact(event.result);
          if (quote) {
            const evidence = recordEvidence({ taskId: latest.task.id, runId: run.id, stepId: stepId ?? undefined, sourceType: "review-tool", sessionId: session.sessionId, entryId: typeof event.toolCallId === "string" ? event.toolCallId : undefined, filePath: action ? findFilePath(action.args) : undefined, locator: typeof event.toolName === "string" ? event.toolName : undefined, quote }, root);
            evidenceIds.push(evidence.id);
          }
        }
        if (event.type === "message_end") {
          const text = textFromMessage(event.message);
          if (text) finalText = text;
        }
        if (event.type === "agent_end") {
          const messages = Array.isArray(event.messages) ? event.messages : [];
          for (let index = messages.length - 1; index >= 0; index -= 1) {
            const text = textFromMessage(messages[index]);
            if (text) { finalText = text; break; }
          }
          if (!finalText.trim() && !blockedByPolicy) throw new Error("Review Agent 没有返回可记录的报告");
          const live = getRun(run.id, root);
          if (!live || live.run.status !== "running" || blockedByPolicy) {
            unsubscribe();
            finish(resolvePromise, rejectPromise);
            return;
          }
          markStep({ stepId: inspect.step.id, status: "completed", output: { evidenceCount: evidenceIds.length } }, root);
          const findings = currentStep(run.id, root);
          if (findings.step.kind !== "findings") throw new Error("Review 问题步骤状态不一致");
          const assistant = recordEvidence({ taskId: live.task.id, runId: run.id, stepId: findings.step.id, sourceType: "review-assistant", sessionId: session.sessionId, entryId: `review-${run.id}`, locator: "report", quote: finalText }, root);
          markStep({ stepId: findings.step.id, status: "completed", output: { evidenceId: assistant.id, evidenceCount: evidenceIds.length } }, root);
          const artifactStep = currentStep(run.id, root);
          if (artifactStep.step.kind !== "artifact") throw new Error("Review 产物步骤状态不一致");
          const artifactDir = join(root, ".bt", "artifacts");
          mkdirSync(artifactDir, { recursive: true });
          const path = join(artifactDir, `review-${run.id}.md`);
          const content = `# Review 审查报告\n\n## 目标\n\n${live.task.objective}\n\n${finalText}\n\n## Harness Evidence\n\n- ${evidenceIds.length} 条工具证据已写入 harness.db。\n`;
          writeFileSync(path, content, "utf8");
          createArtifact({ taskId: live.task.id, runId: run.id, kind: "review-report", path, content, summary: "带证据、风险和后续动作的审查报告" }, root);
          evaluateTask({ taskId: live.task.id, runId: run.id, criteria: live.task.acceptanceCriteria.map((criterion) => ({ criterion, passed: evidenceIds.length > 0 && finalText.trim().length > 0, evidenceIds: [...evidenceIds, assistant.id], note: "审查报告和工具证据已记录，结论仍需人工复核" })), humanReview: "Review Findings 需要用户确认严重程度和后续动作" }, root);
          markStep({ stepId: artifactStep.step.id, status: "completed", output: { path, evidenceCount: evidenceIds.length } }, root);
          unsubscribe();
          finish(resolvePromise, rejectPromise);
        }
        if (event.type === "prompt_error") throw new Error(compact(event.errorMessage) || "Review Agent 执行失败");
      } catch (error) {
        unsubscribe();
        try {
          const failed = currentStep(run.id, root);
          markStep({ stepId: failed.step.id, status: "failed", failureReason: error instanceof Error ? error.message : String(error) }, root);
        } catch { /* preserve original failure */ }
        finish(resolvePromise, rejectPromise, error);
      }
    });
    timeout = setTimeout(() => {
      unsubscribe();
      void abort();
      try {
        const failed = currentStep(run.id, root);
        markStep({ stepId: failed.step.id, status: "failed", failureReason: "Review 执行超时" }, root);
      } catch { /* preserve timeout */ }
      finish(resolvePromise, rejectPromise, new Error("Review 执行超时"));
    }, options.timeoutMs ?? 15 * 60 * 1000);
    void session.send({ type: "prompt", message: reviewPrompt(initial.detail.task) }).catch((error) => {
      unsubscribe();
      try {
        const failed = currentStep(run.id, root);
        markStep({ stepId: failed.step.id, status: "failed", failureReason: error instanceof Error ? error.message : String(error) }, root);
      } catch { /* preserve original failure */ }
      finish(resolvePromise, rejectPromise, error);
    });
  });
}

export async function executeReviewRun(runId: string, options: ReviewRunnerOptions = {}): Promise<void> {
  const root = options.root ?? btRoot();
  const result = getRun(runId, root);
  if (!result) throw new Error("运行不存在");
  if (result.task.workflowId !== "review") throw new Error("当前运行不是 Review 工作流");
  if (result.run.status !== "running" || activeRuns.has(runId)) return;
  await execute(result.run, options);
}

export async function abortReviewRun(runId: string): Promise<void> {
  const active = activeRuns.get(runId);
  if (active) await active.abort();
}

export function getActiveReviewRunIds(): string[] { return [...activeRuns.keys()]; }
