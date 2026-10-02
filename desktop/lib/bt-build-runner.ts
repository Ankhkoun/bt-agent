import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { btRoot } from "./bt-config";
import { completeAction, createArtifact, evaluateTask, getRun, markStep, recordAction, recordEvidence, recordHarnessEvent, requestApproval, type HarnessRun } from "./bt-harness";
import { policyForTool } from "./bt-policy";
import { startRpcSession } from "./rpc-manager";

type AgentEvent = { type: string; [key: string]: unknown };
type BuildPhase = "inspect" | "edit" | "verify";
type ToolMode = "readonly" | "full";

export interface BuildAgentSession {
  readonly sessionId: string;
  readonly sessionFile?: string;
  onEvent(listener: (event: AgentEvent) => void): () => void;
  send(command: Record<string, unknown>): Promise<unknown>;
}
export interface BuildRunnerOptions {
  root?: string;
  createSession?: (cwd: string, key: string, sessionFile?: string, mode?: ToolMode) => Promise<BuildAgentSession>;
  timeoutMs?: number;
}

const activeRuns = new Map<string, { session: BuildAgentSession; abort: () => Promise<unknown> }>();

function isDirectory(path: string): boolean { try { return statSync(path).isDirectory(); } catch { return false; } }
function resolveCwd(task: { scope: string; metadata: Record<string, unknown> }, root: string): string {
  const candidates = [task.metadata.cwd, task.metadata.projectPath, task.scope].filter((value): value is string => typeof value === "string" && value.trim().length > 0).map((value) => resolve(value));
  return candidates.find(isDirectory) ?? root;
}
function compact(value: unknown, limit = 12000): string {
  if (typeof value === "string") return value.slice(0, limit);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.content)) {
      const text = record.content.filter((item) => item && typeof item === "object" && (item as Record<string, unknown>).type === "text").map((item) => String((item as Record<string, unknown>).text ?? "")).join("\n");
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
  return record.content.filter((item) => item && typeof item === "object" && (item as Record<string, unknown>).type === "text").map((item) => String((item as Record<string, unknown>).text ?? "")).join("\n").trim();
}
function findFilePath(args: unknown): string | undefined {
  if (!args || typeof args !== "object") return undefined;
  const value = args as Record<string, unknown>;
  for (const key of ["path", "filePath", "file"]) if (typeof value[key] === "string" && value[key].trim()) return value[key].trim();
  return undefined;
}
function sessionInfo(detail: ReturnType<typeof getRun>): { sessionId: string; sessionFile?: string; cwd: string } | null {
  const event = detail ? [...detail.task.events].reverse().find((item) => item.type === "build_session_started") : undefined;
  if (!event || typeof event.payload.sessionId !== "string" || typeof event.payload.cwd !== "string") return null;
  return { sessionId: event.payload.sessionId, sessionFile: typeof event.payload.sessionFile === "string" ? event.payload.sessionFile : undefined, cwd: event.payload.cwd };
}
function currentStep(runId: string, root: string) {
  const detail = getRun(runId, root);
  if (!detail) throw new Error("运行不存在");
  const step = detail.task.steps.find((item) => item.id === detail.run.currentStepId);
  if (!step) throw new Error("运行没有当前步骤");
  return { detail, step };
}
function prompt(task: { objective: string; scope: string }, phase: BuildPhase): string {
  const base = ["你正在执行 BT-Agent 的 Build 工程执行工作流。", `工程目标：${task.objective}`, task.scope ? `工作目录或范围：${task.scope}` : "请从当前项目确定工作范围。", "严格区分代码事实、测试事实和推断。不要删除、上传、发送或修改凭据。"];
  if (phase === "inspect") return [...base, "当前阶段只读检查 README、相关代码、测试和 Git Diff，生成实施计划和验证命令。不要修改任何文件。"].join("\n");
  if (phase === "edit") return [...base, "用户已批准实施计划。按计划修改代码，并说明每个修改解决的问题；不要执行删除、上传或外部发送。完成后等待下一次验证审批。"].join("\n");
  return [...base, "用户已批准验证阶段。运行必要的测试和静态检查，记录完整命令、结果和失败原因。不要修改测试结果或隐藏失败。"].join("\n");
}
async function defaultSession(cwd: string, key: string, sessionFile?: string, mode: ToolMode = "readonly"): Promise<BuildAgentSession> {
  const toolNames = mode === "readonly" ? ["read", "grep", "find", "ls", "git"] : ["read", "grep", "find", "ls", "git", "edit", "write", "powershell"];
  return (await startRpcSession(key, sessionFile ?? "", cwd, { toolNames })).session;
}

async function executeTurn(run: HarnessRun, options: BuildRunnerOptions, phase: BuildPhase): Promise<void> {
  const root = options.root ?? btRoot();
  const initial = currentStep(run.id, root);
  const stored = sessionInfo(initial.detail);
  const cwd = stored?.cwd ?? resolveCwd(initial.detail.task, root);
  const mode: ToolMode = phase === "inspect" ? "readonly" : "full";
  const session = await (options.createSession ?? defaultSession)(cwd, stored?.sessionId ?? `bt-build-${run.id}`, stored?.sessionFile, mode);
  if (!stored) recordHarnessEvent({ taskId: initial.detail.task.id, runId: run.id, stepId: initial.step.id, type: "build_session_started", payload: { sessionId: session.sessionId, sessionFile: session.sessionFile, cwd } }, root);
  const abort = async () => session.send({ type: "abort" });
  activeRuns.set(run.id, { session, abort });
  const actions = new Map<string, { id: string; args: Record<string, unknown> }>();
  let finalText = "";
  let settled = false;
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const finish = (resolvePromise: () => void, rejectPromise: (error: unknown) => void, error?: unknown) => { if (settled) return; settled = true; if (timeout) clearTimeout(timeout); activeRuns.delete(run.id); if (error === undefined) resolvePromise(); else rejectPromise(error); };

  await new Promise<void>((resolvePromise, rejectPromise) => {
    const unsubscribe = session.onEvent((event) => {
      try {
        const latest = getRun(run.id, root);
        if (!latest) throw new Error("运行不存在");
        const stepId = latest.run.currentStepId;
        if (["agent_start", "prompt_error", "agent_end", "tool_execution_start", "tool_execution_end", "message_end"].includes(event.type)) recordHarnessEvent({ taskId: latest.task.id, runId: run.id, stepId: stepId ?? undefined, type: `agent_${event.type}`, payload: { sessionId: session.sessionId, toolName: typeof event.toolName === "string" ? event.toolName : undefined } }, root);
        if (event.type === "tool_execution_start" && typeof event.toolName === "string") {
          const policy = policyForTool(event.toolName);
          const args = event.args && typeof event.args === "object" ? event.args as Record<string, unknown> : {};
          const action = recordAction({ taskId: latest.task.id, runId: run.id, stepId: stepId ?? undefined, sessionId: session.sessionId, kind: "tool_call", toolName: event.toolName, riskLevel: policy.riskLevel, input: args }, root);
          if (typeof event.toolCallId === "string") actions.set(event.toolCallId, { id: action.id, args });
          const approved = latest.task.approvals.some((item) => item.stepId === stepId && item.decision === "approved");
          if (policy.decision === "deny" || (policy.decision === "approval_required" && !approved)) {
            completeAction({ actionId: action.id, status: "blocked", output: { reason: policy.decision === "deny" ? "L3 操作被 Harness 拒绝" : "需要用户审批", riskLevel: policy.riskLevel } }, root);
            if (policy.decision === "approval_required") requestApproval({ taskId: latest.task.id, runId: run.id, stepId: stepId ?? undefined, actionId: action.id, riskLevel: policy.riskLevel, scope: `${event.toolName} 工具调用`, reason: "Build 的写入或验证操作必须逐阶段批准" }, root);
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
          if (quote) recordEvidence({ taskId: latest.task.id, runId: run.id, stepId: stepId ?? undefined, sourceType: "build-tool", sessionId: session.sessionId, entryId: typeof event.toolCallId === "string" ? event.toolCallId : undefined, filePath: action ? findFilePath(action.args) : undefined, locator: typeof event.toolName === "string" ? event.toolName : undefined, quote }, root);
        }
        if (event.type === "message_end") { const text = textFromMessage(event.message); if (text) finalText = text; }
        if (event.type === "agent_end") {
          const messages = Array.isArray(event.messages) ? event.messages : [];
          for (let index = messages.length - 1; index >= 0; index -= 1) { const text = textFromMessage(messages[index]); if (text) { finalText = text; break; } }
          if (!finalText.trim()) throw new Error("Build Agent 没有返回可记录的结果");
          const live = getRun(run.id, root);
          if (!live || live.run.status !== "running") { unsubscribe(); finish(resolvePromise, rejectPromise); return; }
          const assistant = recordEvidence({ taskId: live.task.id, runId: run.id, stepId: live.run.currentStepId ?? undefined, sourceType: "build-assistant", sessionId: session.sessionId, entryId: `build-${run.id}-${phase}`, locator: phase, quote: finalText }, root);
          if (phase === "inspect") {
            const scope = currentStep(run.id, root);
            if (scope.step.kind === "scope") markStep({ stepId: scope.step.id, status: "completed", output: { cwd } }, root);
            const inspect = currentStep(run.id, root);
            if (inspect.step.kind !== "inspect") throw new Error("Build 检查步骤状态不一致");
            createArtifact({ taskId: live.task.id, runId: run.id, kind: "build-plan", content: `# Build 计划\n\n${finalText}\n`, summary: "只读检查生成的实施计划" }, root);
            markStep({ stepId: inspect.step.id, status: "completed", output: { evidenceId: assistant.id } }, root);
            const edit = currentStep(run.id, root);
            requestApproval({ taskId: live.task.id, runId: run.id, stepId: edit.step.id, riskLevel: "L2", scope: "按 Build 计划修改代码", reason: "代码编辑会改变本地项目状态，需要用户逐阶段批准" }, root);
          } else if (phase === "edit") {
            const edit = currentStep(run.id, root);
            if (edit.step.kind !== "edit") throw new Error("Build 编辑步骤状态不一致");
            markStep({ stepId: edit.step.id, status: "completed", output: { evidenceId: assistant.id } }, root);
            const verify = currentStep(run.id, root);
            requestApproval({ taskId: live.task.id, runId: run.id, stepId: verify.step.id, riskLevel: "L2", scope: "运行测试和静态检查", reason: "验证命令可能执行 Shell 操作，需要用户单独批准" }, root);
          } else {
            const verify = currentStep(run.id, root);
            if (verify.step.kind !== "verify") throw new Error("Build 验证步骤状态不一致");
            markStep({ stepId: verify.step.id, status: "completed", output: { evidenceId: assistant.id } }, root);
            const artifact = currentStep(run.id, root);
            const detail = getRun(run.id, root);
            if (!detail) throw new Error("运行不存在");
            const content = `# Build 交付报告\n\n## 目标\n\n${detail.task.objective}\n\n## 最终结果\n\n${finalText}\n`;
            const dir = join(root, ".bt", "artifacts"); mkdirSync(dir, { recursive: true });
            const path = join(dir, `build-${run.id}.md`); writeFileSync(path, content, "utf8");
            createArtifact({ taskId: detail.task.id, runId: run.id, kind: "build-report", path, content, summary: "代码修改和验证结果报告" }, root);
            evaluateTask({ taskId: detail.task.id, runId: run.id, criteria: detail.task.acceptanceCriteria.map((criterion) => ({ criterion, passed: true, evidenceIds: detail.task.evidence.map((item) => item.id), note: "已记录实施和验证结果，仍需用户审阅 Diff" })), humanReview: "Build 结果需用户审阅 Diff" }, root);
            markStep({ stepId: artifact.step.id, status: "completed", output: { path, evidenceId: assistant.id } }, root);
          }
          unsubscribe();
          finish(resolvePromise, rejectPromise);
        }
        if (event.type === "prompt_error") throw new Error(compact(event.errorMessage) || "Build Agent 执行失败");
      } catch (error) {
        unsubscribe();
        try { const failed = currentStep(run.id, root); markStep({ stepId: failed.step.id, status: "failed", failureReason: error instanceof Error ? error.message : String(error) }, root); } catch { /* preserve original failure */ }
        finish(resolvePromise, rejectPromise, error);
      }
    });
    timeout = setTimeout(() => { unsubscribe(); void abort(); try { const failed = currentStep(run.id, root); markStep({ stepId: failed.step.id, status: "failed", failureReason: "Build 执行超时" }, root); } catch { /* preserve timeout */ } finish(resolvePromise, rejectPromise, new Error("Build 执行超时")); }, options.timeoutMs ?? 15 * 60 * 1000);
    void session.send({ type: "prompt", message: prompt(initial.detail.task, phase) }).catch((error) => { unsubscribe(); try { const failed = currentStep(run.id, root); markStep({ stepId: failed.step.id, status: "failed", failureReason: error instanceof Error ? error.message : String(error) }, root); } catch { /* preserve original failure */ } finish(resolvePromise, rejectPromise, error); });
  });
}

export async function executeBuildRun(runId: string, options: BuildRunnerOptions = {}): Promise<void> {
  const root = options.root ?? btRoot();
  const result = getRun(runId, root);
  if (!result) throw new Error("运行不存在");
  if (result.task.workflowId !== "build") throw new Error("当前运行不是 Build 工作流");
  if (result.run.status !== "running" || activeRuns.has(runId)) return;
  const step = result.task.steps.find((item) => item.id === result.run.currentStepId);
  if (!step) throw new Error("Build 没有当前步骤");
  const phase: BuildPhase = step.kind === "scope" || step.kind === "inspect" ? "inspect" : step.kind === "edit" ? "edit" : "verify";
  await executeTurn(result.run, options, phase);
}

export async function abortBuildRun(runId: string): Promise<void> { const active = activeRuns.get(runId); if (active) await active.abort(); }
export function getActiveBuildRunIds(): string[] { return [...activeRuns.keys()]; }
