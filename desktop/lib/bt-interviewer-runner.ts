import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { btRoot } from "./bt-config";
import { completeAction, createArtifact, evaluateTask, getRun, markStep, pauseRun, recordAction, recordEvidence, recordHarnessEvent, requestApproval, resumeRun, type HarnessRun } from "./bt-harness";
import { policyForTool } from "./bt-policy";
import { startRpcSession } from "./rpc-manager";

type AgentEvent = { type: string; [key: string]: unknown };
type InterviewPhase = "question" | "follow_up" | "evaluate";

export interface InterviewerAgentSession {
  readonly sessionId: string;
  readonly sessionFile?: string;
  onEvent(listener: (event: AgentEvent) => void): () => void;
  send(command: Record<string, unknown>): Promise<unknown>;
}
export interface InterviewerRunnerOptions {
  root?: string;
  createSession?: (cwd: string, key: string, sessionFile?: string) => Promise<InterviewerAgentSession>;
  timeoutMs?: number;
}

const activeRuns = new Map<string, { session: InterviewerAgentSession; abort: () => Promise<unknown> }>();

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
function prompt(task: { objective: string; scope: string }, phase: InterviewPhase, answer?: string): string {
  const base = ["你正在执行 BT-Agent 的 Interviewer 面试工作流。", `面试范围：${task.objective}`, task.scope ? `参考项目或资料：${task.scope}` : "请先根据目标确定面试边界。", "只允许读取和分析，不要修改文件，不要执行写入、删除、上传或发送操作。不要编造项目中不存在的事实。"];
  if (phase === "question") return [...base, "提出一个能区分理解深度的核心问题，等待用户回答。只输出问题及必要的事实背景，不要替用户作答。"].join("\n");
  if (phase === "follow_up") return [...base, `用户对核心问题的回答：\n${answer ?? ""}`, "指出回答中有依据的部分和缺口，然后提出一个针对缺口的追问，等待用户回答。"].join("\n");
  return [...base, `用户对追问的回答：\n${answer ?? ""}`, "对本轮面试给出统一评价：事实准确性、设计取舍、表达结构、仍需补强的知识点和下一步练习。不要把推测写成事实。"].join("\n");
}
function currentStep(runId: string, root: string) {
  const detail = getRun(runId, root);
  if (!detail) throw new Error("运行不存在");
  const step = detail.task.steps.find((item) => item.id === detail.run.currentStepId);
  if (!step) throw new Error("运行没有当前步骤");
  return { detail, step };
}
function sessionInfo(detail: ReturnType<typeof getRun>): { sessionId: string; sessionFile?: string; cwd: string } | null {
  const event = detail ? [...detail.task.events].reverse().find((item) => item.type === "interviewer_session_started") : undefined;
  if (!event || typeof event.payload.sessionId !== "string" || typeof event.payload.cwd !== "string") return null;
  return { sessionId: event.payload.sessionId, sessionFile: typeof event.payload.sessionFile === "string" ? event.payload.sessionFile : undefined, cwd: event.payload.cwd };
}
async function defaultSession(cwd: string, key: string, sessionFile?: string): Promise<InterviewerAgentSession> {
  return (await startRpcSession(key, sessionFile ?? "", cwd, { toolNames: ["read", "grep", "find", "ls"] })).session;
}

function finishReport(runId: string, root: string): void {
  const detail = getRun(runId, root);
  if (!detail) return;
  const lines = detail.task.evidence.filter((item) => item.sourceType === "interviewer-user" || item.sourceType === "interviewer-assistant").map((item) => `### ${item.sourceType === "interviewer-user" ? "候选人回答" : "面试反馈"}\n${item.quote}`);
  const content = `# Interviewer 面试记录\n\n## 范围\n\n${detail.task.objective}\n\n## 过程\n\n${lines.join("\n\n")}\n`;
  const dir = join(root, ".bt", "artifacts");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `interviewer-${runId}.md`);
  writeFileSync(path, content, "utf8");
  createArtifact({ taskId: detail.task.id, runId, kind: "interview-report", path, content, summary: "核心问题、追问和结构化面试评价" }, root);
}

async function executeTurn(run: HarnessRun, options: InterviewerRunnerOptions, phase: InterviewPhase, message: string): Promise<void> {
  const root = options.root ?? btRoot();
  const initial = currentStep(run.id, root);
  const stored = sessionInfo(initial.detail);
  const cwd = stored?.cwd ?? resolveCwd(initial.detail.task, root);
  const session = await (options.createSession ?? defaultSession)(cwd, stored?.sessionId ?? `bt-interviewer-${run.id}`, stored?.sessionFile);
  if (!stored) recordHarnessEvent({ taskId: initial.detail.task.id, runId: run.id, stepId: initial.step.id, type: "interviewer_session_started", payload: { sessionId: session.sessionId, sessionFile: session.sessionFile, cwd } }, root);
  const abort = async () => session.send({ type: "abort" });
  activeRuns.set(run.id, { session, abort });
  const actions = new Map<string, { id: string; args: Record<string, unknown> }>();
  let finalText = "";
  let blocked = false;
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
          if (policy.decision !== "allow") {
            blocked = true;
            completeAction({ actionId: action.id, status: "blocked", output: { reason: policy.decision === "deny" ? "L3 操作被 Harness 拒绝" : "需要用户审批", riskLevel: policy.riskLevel } }, root);
            if (policy.decision === "approval_required") requestApproval({ taskId: latest.task.id, runId: run.id, stepId: stepId ?? undefined, actionId: action.id, riskLevel: policy.riskLevel, scope: `${event.toolName} 工具调用`, reason: "Interviewer 只允许读取操作，继续执行会改变项目或外部状态" }, root);
            void abort();
          }
        }
        if (event.type === "tool_execution_end") {
          const action = typeof event.toolCallId === "string" ? actions.get(event.toolCallId) : undefined;
          if (action && !blocked) completeAction({ actionId: action.id, status: event.result && typeof event.result === "object" && (event.result as Record<string, unknown>).isError ? "failed" : "succeeded", output: event.result }, root);
          const quote = compact(event.result);
          if (quote) recordEvidence({ taskId: latest.task.id, runId: run.id, stepId: stepId ?? undefined, sourceType: "pi-tool", sessionId: session.sessionId, entryId: typeof event.toolCallId === "string" ? event.toolCallId : undefined, filePath: action ? findFilePath(action.args) : undefined, locator: typeof event.toolName === "string" ? event.toolName : undefined, quote }, root);
        }
        if (event.type === "message_end") { const text = textFromMessage(event.message); if (text) finalText = text; }
        if (event.type === "agent_end") {
          const messages = Array.isArray(event.messages) ? event.messages : [];
          for (let index = messages.length - 1; index >= 0; index -= 1) { const text = textFromMessage(messages[index]); if (text) { finalText = text; break; } }
          if (blocked) { unsubscribe(); finish(resolvePromise, rejectPromise); return; }
          if (!finalText.trim()) throw new Error("Interviewer 没有返回可记录的内容");
          const live = getRun(run.id, root);
          if (!live || live.run.status !== "running") { unsubscribe(); finish(resolvePromise, rejectPromise); return; }
          const assistant = recordEvidence({ taskId: live.task.id, runId: run.id, stepId: live.run.currentStepId ?? undefined, sourceType: "interviewer-assistant", sessionId: session.sessionId, entryId: `interviewer-${run.id}-${phase}`, locator: phase, quote: finalText }, root);
          if (phase === "question") {
            pauseRun(run.id, root);
            recordHarnessEvent({ taskId: live.task.id, runId: run.id, stepId: live.run.currentStepId ?? undefined, type: "user_input_required", payload: { phase: "question", prompt: finalText.slice(0, 4000), evidenceId: assistant.id } }, root);
          } else if (phase === "follow_up") {
            const ask = currentStep(run.id, root);
            if (ask.step.kind !== "ask") throw new Error("Interviewer 主问题步骤状态不一致");
            markStep({ stepId: ask.step.id, status: "completed", output: { evidenceId: assistant.id } }, root);
            pauseRun(run.id, root);
            recordHarnessEvent({ taskId: live.task.id, runId: run.id, stepId: currentStep(run.id, root).step.id, type: "user_input_required", payload: { phase: "follow_up", prompt: finalText.slice(0, 4000), evidenceId: assistant.id } }, root);
          } else {
            const followUp = currentStep(run.id, root);
            if (followUp.step.kind !== "follow_up") throw new Error("Interviewer 追问步骤状态不一致");
            markStep({ stepId: followUp.step.id, status: "completed", output: { evidenceId: assistant.id } }, root);
            const evaluate = currentStep(run.id, root);
            if (evaluate.step.kind !== "evaluate") throw new Error("Interviewer 评价步骤状态不一致");
            markStep({ stepId: evaluate.step.id, status: "completed", output: { evidenceId: assistant.id } }, root);
            const latestRun = getRun(run.id, root);
            if (!latestRun) throw new Error("运行不存在");
            const answers = latestRun.task.evidence.filter((item) => item.sourceType === "interviewer-user");
            evaluateTask({ taskId: latestRun.task.id, runId: run.id, criteria: latestRun.task.acceptanceCriteria.map((criterion) => ({ criterion, passed: answers.length >= 2, evidenceIds: answers.map((item) => item.id), note: "依据候选人两轮原文回答和 Interviewer 反馈；仍需人工复核" })), humanReview: "AI 评价，待人工复核" }, root);
            finishReport(run.id, root);
          }
          unsubscribe();
          finish(resolvePromise, rejectPromise);
        }
        if (event.type === "prompt_error") throw new Error(compact(event.errorMessage) || "Interviewer 执行失败");
      } catch (error) {
        unsubscribe();
        try { const failed = currentStep(run.id, root); markStep({ stepId: failed.step.id, status: "failed", failureReason: error instanceof Error ? error.message : String(error) }, root); } catch { /* preserve original failure */ }
        finish(resolvePromise, rejectPromise, error);
      }
    });
    timeout = setTimeout(() => { unsubscribe(); void abort(); try { const failed = currentStep(run.id, root); markStep({ stepId: failed.step.id, status: "failed", failureReason: "Interviewer 执行超时" }, root); } catch { /* preserve timeout */ } finish(resolvePromise, rejectPromise, new Error("Interviewer 执行超时")); }, options.timeoutMs ?? 15 * 60 * 1000);
    void session.send({ type: "prompt", message }).catch((error) => { unsubscribe(); try { const failed = currentStep(run.id, root); markStep({ stepId: failed.step.id, status: "failed", failureReason: error instanceof Error ? error.message : String(error) }, root); } catch { /* preserve original failure */ } finish(resolvePromise, rejectPromise, error); });
  });
}

export async function executeInterviewerRun(runId: string, options: InterviewerRunnerOptions = {}): Promise<void> {
  const root = options.root ?? btRoot();
  const result = getRun(runId, root);
  if (!result) throw new Error("运行不存在");
  if (result.task.workflowId !== "interviewer") throw new Error("当前运行不是 Interviewer 工作流");
  if (result.run.status !== "running" || activeRuns.has(runId)) return;
  const scope = currentStep(runId, root);
  if (scope.step.kind !== "scope") throw new Error("Interviewer 只能从范围步骤启动");
  markStep({ stepId: scope.step.id, status: "completed", output: { scope: result.task.scope } }, root);
  await executeTurn(result.run, options, "question", prompt(result.task, "question"));
}

export async function submitInterviewerInput(taskId: string, runId: string, text: string, options: InterviewerRunnerOptions = {}): Promise<void> {
  const root = options.root ?? btRoot();
  const result = getRun(runId, root);
  if (!result || result.task.id !== taskId || result.task.workflowId !== "interviewer" || result.run.status !== "paused") throw new Error("Interviewer 当前不在等待回答");
  const answer = text.trim();
  if (!answer || answer.length > 12000) throw new Error("回答需要 1–12000 个字符");
  if (activeRuns.has(runId)) throw new Error("Interviewer 仍在执行上一轮，请稍候");
  const step = result.task.steps.find((item) => item.id === result.run.currentStepId);
  if (!step || (step.kind !== "ask" && step.kind !== "follow_up")) throw new Error("Interviewer 当前没有可提交的回答步骤");
  const info = sessionInfo(result);
  if (!info) throw new Error("Interviewer Session 来源缺失，无法恢复；请重试任务");
  const phase: InterviewPhase = step.kind === "ask" ? "follow_up" : "evaluate";
  recordEvidence({ taskId, runId, stepId: step.id, sourceType: "interviewer-user", sessionId: info.sessionId, entryId: `interviewer-${runId}-${step.kind}-user`, locator: step.kind, quote: answer }, root);
  recordHarnessEvent({ taskId, runId, stepId: step.id, type: "interviewer_user_input", payload: { phase: step.kind } }, root);
  resumeRun(runId, root);
  await executeTurn(result.run, options, phase, prompt(result.task, phase, answer));
}

export async function abortInterviewerRun(runId: string): Promise<void> { const active = activeRuns.get(runId); if (active) await active.abort(); }
export function getActiveInterviewerRunIds(): string[] { return [...activeRuns.keys()]; }
