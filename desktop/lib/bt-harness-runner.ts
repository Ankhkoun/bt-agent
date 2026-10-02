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
import { getWorkflowProfile } from "./bt-harness-model";
import { policyForTool } from "./bt-policy";
import { proposeMemory } from "./bt-memory";
import { startRpcSession } from "./rpc-manager";

type AgentEvent = { type: string; [key: string]: unknown };

export interface HarnessAgentSession {
  readonly sessionId: string;
  onEvent(listener: (event: AgentEvent) => void): () => void;
  send(command: Record<string, unknown>): Promise<unknown>;
}

export interface HarnessRunnerOptions {
  root?: string;
  createSession?: (cwd: string, key: string) => Promise<HarnessAgentSession>;
  timeoutMs?: number;
}

const activeRuns = new Map<string, { session: HarnessAgentSession; abort: () => Promise<unknown> }>();

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
      const text = record.content.filter((item) => item && typeof item === "object" && (item as Record<string, unknown>).type === "text")
        .map((item) => String((item as Record<string, unknown>).text ?? "")).join("\n");
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
  return record.content.filter((item) => item && typeof item === "object" && (item as Record<string, unknown>).type === "text")
    .map((item) => String((item as Record<string, unknown>).text ?? "")).join("\n").trim();
}

function findFilePath(args: unknown): string | undefined {
  if (!args || typeof args !== "object") return undefined;
  const value = args as Record<string, unknown>;
  for (const key of ["path", "filePath", "file"]) if (typeof value[key] === "string" && value[key].trim()) return value[key].trim();
  return undefined;
}

function researchPrompt(task: { objective: string; scope: string }, validation: boolean): string {
  if (validation) return [
    "你正在执行 BT-Agent 的 Project Research 验证阶段。",
    `研究目标：${task.objective}`,
    "请基于本次会话已经收集的证据，完成一次 Tutor/Interviewer 式验证：说明你理解的架构和关键取舍，指出证据不足之处，并列出 3 个可以被用户追问的问题及简短答案。不要修改文件。",
    "最后用“验证结论”“仍待确认”两个小节输出。",
  ].join("\n");
  return [
    "你正在执行 BT-Agent 的 Project Research 工作流。只允许读取和分析，不要修改项目文件，不要执行写入、删除、上传或发送操作。",
    `研究目标：${task.objective}`,
    task.scope ? `用户给定范围：${task.scope}` : "用户未给出额外范围，请先从项目入口和目录结构确定范围。",
    "请读取 README、关键代码、测试与 Git 最近记录，沿调用链分析实现。回答必须区分代码事实、测试事实、规划内容和推断。工具调用产生的文件路径、行号和命令输出将被 Harness 记录为 Evidence。",
    "完成后输出一份结构化研究报告，包含：项目定位、架构、核心流程、已实现能力、测试证据、风险与未完成项、可追问问题。不要编造指标。",
  ].join("\n");
}

function currentStep(runId: string, root: string) {
  const detail = getRun(runId, root);
  if (!detail) throw new Error("运行不存在");
  const step = detail.task.steps.find((item) => item.id === detail.run.currentStepId);
  if (!step) throw new Error("运行没有当前步骤");
  return { detail, step };
}

async function defaultSession(cwd: string, key: string): Promise<HarnessAgentSession> {
  const result = await startRpcSession(key, "", cwd, { toolNames: ["read", "grep", "find", "ls"] });
  return result.session;
}

async function execute(run: HarnessRun, options: HarnessRunnerOptions): Promise<void> {
  const root = options.root ?? btRoot();
  const initial = currentStep(run.id, root);
  const cwd = resolveTaskCwd(initial.detail.task, root);
  const createSession = options.createSession ?? defaultSession;
  const session = await createSession(cwd, `bt-harness-${run.id}`);
  const abort = async () => session.send({ type: "abort" });
  activeRuns.set(run.id, { session, abort });
  const actionIds = new Map<string, { id: string; args: Record<string, unknown> }>();
  const evidenceIds: string[] = [];
  let finalText = "";
  let blockedByPolicy = false;
  let settled = false;
  let timeout: ReturnType<typeof setTimeout> | null = null;

  const finish = (resolve: () => void, reject: (error: unknown) => void, error?: unknown) => {
    if (settled) return;
    settled = true;
    if (timeout !== null) clearTimeout(timeout);
    activeRuns.delete(run.id);
    if (error === undefined) resolve();
    else reject(error);
  };

  await new Promise<void>((resolvePromise, rejectPromise) => {
    const unsubscribe = session.onEvent((event) => {
      try {
        const latest = getRun(run.id, root);
        if (!latest) throw new Error("运行不存在");
        const stepId = latest.run.currentStepId;
        if (["agent_start", "prompt_error", "agent_end", "tool_execution_start", "tool_execution_end", "message_end"].includes(event.type)) {
          recordHarnessEvent({ taskId: latest.task.id, runId: run.id, stepId: stepId ?? undefined, type: `agent_${event.type}`, payload: {
            sessionId: session.sessionId, toolCallId: typeof event.toolCallId === "string" ? event.toolCallId : undefined,
            toolName: typeof event.toolName === "string" ? event.toolName : undefined,
            role: event.message && typeof event.message === "object" ? (event.message as Record<string, unknown>).role : undefined,
          } }, root);
        }

        if (event.type === "tool_execution_start" && typeof event.toolName === "string") {
          const policy = policyForTool(event.toolName);
          const action = recordAction({ taskId: latest.task.id, runId: run.id, stepId: stepId ?? undefined, sessionId: session.sessionId, kind: "tool_call", toolName: event.toolName, riskLevel: policy.riskLevel, input: event.args && typeof event.args === "object" ? event.args as Record<string, unknown> : {} }, root);
          if (typeof event.toolCallId === "string") actionIds.set(event.toolCallId, { id: action.id, args: event.args && typeof event.args === "object" ? event.args as Record<string, unknown> : {} });
          if (policy.decision === "deny" || (policy.decision === "approval_required" && !blockedByPolicy)) {
            blockedByPolicy = true;
            completeAction({ actionId: action.id, status: "blocked", output: { reason: policy.decision === "deny" ? "L3 操作被 Harness 拒绝" : "需要用户审批", riskLevel: policy.riskLevel } }, root);
            if (policy.decision === "approval_required") requestApproval({ taskId: latest.task.id, runId: run.id, stepId: stepId ?? undefined, actionId: action.id, riskLevel: policy.riskLevel, scope: `${event.toolName} 工具调用`, reason: "当前工作流只允许读取操作，继续执行会改变项目或外部状态" }, root);
            void abort();
          }
        }

        if (event.type === "tool_execution_end") {
          const action = typeof event.toolCallId === "string" ? actionIds.get(event.toolCallId) : undefined;
          const result = event.result;
          if (action && !blockedByPolicy) completeAction({ actionId: action.id, status: result && typeof result === "object" && (result as Record<string, unknown>).isError ? "failed" : "succeeded", output: result }, root);
          const quote = compact(result);
          if (quote) {
            const evidence = recordEvidence({ taskId: latest.task.id, runId: run.id, stepId: stepId ?? undefined, sourceType: "pi-tool", sessionId: session.sessionId, entryId: typeof event.toolCallId === "string" ? event.toolCallId : undefined, filePath: action ? findFilePath(action.args) : undefined, locator: typeof event.toolName === "string" ? event.toolName : undefined, quote }, root);
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
          if (blockedByPolicy) {
            unsubscribe();
            finish(resolvePromise, rejectPromise);
            return;
          }
          const live = getRun(run.id, root);
          if (!live || live.run.status !== "running") {
            unsubscribe();
            finish(resolvePromise, rejectPromise);
            return;
          }
          let after = currentStep(run.id, root);
          if (after.step.kind === "scope") {
            markStep({ stepId: after.step.id, status: "completed", output: { sessionId: session.sessionId } }, root);
            after = currentStep(run.id, root);
          }
          for (const kind of ["collect", "analyze"] as const) {
            if (after.step.kind !== kind) break;
            markStep({ stepId: after.step.id, status: "completed", output: { evidenceCount: evidenceIds.length } }, root);
            after = currentStep(run.id, root);
          }
          const artifactStep = after;
          if (artifactStep.step.kind === "artifact" && finalText) {
            const artifactDir = join(root, ".bt", "artifacts");
            mkdirSync(artifactDir, { recursive: true });
            const path = join(artifactDir, `research-${run.id}.md`);
            writeFileSync(path, `# Project Research\n\n${finalText}\n\n## Harness Evidence\n\n- ${evidenceIds.length} 条 Pi 工具证据已写入 harness.db。\n`, "utf8");
            createArtifact({ taskId: after.detail.task.id, runId: run.id, kind: "research-report", path, content: finalText, summary: "Pi Agent 生成的项目研究报告" }, root);
            markStep({ stepId: artifactStep.step.id, status: "completed", output: { path, evidenceCount: evidenceIds.length } }, root);
            const validation = currentStep(run.id, root);
            requestApproval({ taskId: after.detail.task.id, runId: run.id, stepId: validation.step.id, riskLevel: "L1", scope: "审阅研究报告并完成 Tutor / Interviewer 验证", reason: "研究报告需要用户复述和追问后才能作为完成结果", }, root);
          } else if (after.step.kind === "validate") {
            markStep({ stepId: after.step.id, status: "completed", output: { validation: finalText.slice(0, 4000) } }, root);
            const done = getRun(run.id, root);
            if (done) {
              evaluateTask({ taskId: done.task.id, runId: run.id, criteria: done.task.acceptanceCriteria.map((criterion) => ({ criterion, passed: true, evidenceIds, note: "已由 Harness 运行记录或用户验证" })) }, root);
              const evaluationStep = currentStep(run.id, root);
              if (evaluationStep.step.kind === "evaluate") markStep({ stepId: evaluationStep.step.id, status: "completed", output: { result: "pass", evidenceCount: evidenceIds.length } }, root);
              if (finalText.trim()) {
                try {
                  proposeMemory(root, { target: "projects", kind: "ai_explanation", text: `项目研究结论（待用户审阅）：\n${finalText.slice(0, 3800)}`, reason: "Research Workflow 生成了可复用的项目理解，但仍需用户确认事实边界。" }, { sessionId: session.sessionId, cwd, mode: "research", evidence: [{ entryId: run.id, role: "assistant", quote: finalText.slice(0, 1000) }] });
                } catch (error) {
                  recordHarnessEvent({ taskId: done.task.id, runId: run.id, stepId: after.step.id, type: "memory_candidate_failed", payload: { message: error instanceof Error ? error.message : String(error) } }, root);
                }
              }
            }
          }
          unsubscribe();
          finish(resolvePromise, rejectPromise);
        }
        if (event.type === "prompt_error") throw new Error(compact(event.errorMessage) || "Pi Agent 执行失败");
      } catch (error) {
        unsubscribe();
        try {
          const failed = currentStep(run.id, root);
          markStep({ stepId: failed.step.id, status: "failed", failureReason: error instanceof Error ? error.message : String(error) }, root);
        } catch { /* preserve the original failure */ }
        finish(resolvePromise, rejectPromise, error);
      }
    });

    const validation = initial.step.kind === "validate";
    timeout = setTimeout(() => {
      unsubscribe();
      void abort();
      try {
        const failed = currentStep(run.id, root);
        markStep({ stepId: failed.step.id, status: "failed", failureReason: "Harness 执行超时" }, root);
      } catch { /* preserve timeout */ }
      finish(resolvePromise, rejectPromise, new Error("Harness 执行超时"));
    }, options.timeoutMs ?? 15 * 60 * 1000);
    void session.send({ type: "prompt", message: researchPrompt(initial.detail.task, validation) }).catch((error) => {
      unsubscribe();
      try {
        const failed = currentStep(run.id, root);
        markStep({ stepId: failed.step.id, status: "failed", failureReason: error instanceof Error ? error.message : String(error) }, root);
      } catch { /* preserve the original failure */ }
      finish(resolvePromise, rejectPromise, error);
    });
  });
}

export async function executeHarnessRun(runId: string, options: HarnessRunnerOptions = {}): Promise<void> {
  const root = options.root ?? btRoot();
  const result = getRun(runId, root);
  if (!result) throw new Error("运行不存在");
  if (result.task.workflowId !== "research") throw new Error(`当前仅支持 research 工作流执行器：${getWorkflowProfile(result.task.workflowId).label}`);
  if (!["running", "paused"].includes(result.run.status)) return;
  if (activeRuns.has(runId)) return;
  await execute(result.run, options);
}

export async function abortHarnessRun(runId: string): Promise<void> {
  const active = activeRuns.get(runId);
  if (active) await active.abort();
}

export function getActiveHarnessRunIds(): string[] { return [...activeRuns.keys()]; }
