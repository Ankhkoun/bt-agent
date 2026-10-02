import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { btRoot } from "./bt-config";
import {
  completeAction,
  createArtifact,
  evaluateTask,
  getRun,
  markStep,
  pauseRun,
  recordAction,
  recordEvidence,
  recordHarnessEvent,
  requestApproval,
  resumeRun,
  type HarnessRun,
} from "./bt-harness";
import { proposeMemory } from "./bt-memory";
import { policyForTool } from "./bt-policy";
import { startRpcSession } from "./rpc-manager";

type AgentEvent = { type: string; [key: string]: unknown };
type TutorPhase = "initial" | "recall" | "variant";

export interface TutorAgentSession {
  readonly sessionId: string;
  readonly sessionFile?: string;
  onEvent(listener: (event: AgentEvent) => void): () => void;
  send(command: Record<string, unknown>): Promise<unknown>;
}

export interface TutorRunnerOptions {
  root?: string;
  createSession?: (cwd: string, key: string, sessionFile?: string) => Promise<TutorAgentSession>;
  timeoutMs?: number;
}

const activeTutorRuns = new Map<string, { session: TutorAgentSession; abort: () => Promise<unknown> }>();

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

function phasePrompt(task: { objective: string; scope: string }, phase: TutorPhase, answer?: string): string {
  const base = [
    "你正在执行 BT-Agent 的 Tutor 学习工作流。",
    `学习目标：${task.objective}`,
    task.scope ? `参考范围：${task.scope}` : "没有额外资料范围，请先基于学习目标澄清边界。",
    "区分用户原话、可验证事实和你的教学解释。不要修改文件，不要执行写入、删除、上传或发送操作。",
  ];
  if (phase === "initial") {
    return [...base,
      "先诊断学习目标和已知边界，再用最小例子教学。最后提出一个明确的复述问题，等待用户用自己的话回答。",
      "输出包含：诊断、教学、复述问题。不要替用户回答复述问题。",
    ].join("\n");
  }
  if (phase === "recall") {
    return [...base,
      `用户刚才的复述如下：\n${answer ?? ""}`,
      "检查复述中的正确点、混淆点和缺口，给出简短反馈。然后提出一个不同场景的变式问题，等待用户回答。",
      "输出包含：复述反馈、变式问题。不要直接替用户回答变式问题。",
    ].join("\n");
  }
  return [...base,
    `用户对变式问题的回答如下：\n${answer ?? ""}`,
    "评价用户是否能把概念迁移到新场景，指出证据支持的能力和仍待验证的边界。给出下一步学习建议。",
    "输出包含：变式评价、能力边界、下一步建议。不要虚构用户没有说过的内容。",
  ].join("\n");
}

function sessionInfo(detail: ReturnType<typeof getRun>): { sessionId: string; sessionFile?: string; cwd: string } | null {
  if (!detail) return null;
  const event = [...detail.task.events].reverse().find((item) => item.type === "tutor_session_started");
  if (!event || typeof event.payload.sessionId !== "string" || typeof event.payload.cwd !== "string") return null;
  return {
    sessionId: event.payload.sessionId,
    sessionFile: typeof event.payload.sessionFile === "string" ? event.payload.sessionFile : undefined,
    cwd: event.payload.cwd,
  };
}

async function defaultSession(cwd: string, key: string, sessionFile?: string): Promise<TutorAgentSession> {
  const result = await startRpcSession(key, sessionFile ?? "", cwd, { toolNames: ["read", "grep", "find", "ls"] });
  return result.session;
}

function currentStep(runId: string, root: string) {
  const detail = getRun(runId, root);
  if (!detail) throw new Error("运行不存在");
  const step = detail.task.steps.find((item) => item.id === detail.run.currentStepId);
  if (!step) throw new Error("运行没有当前步骤");
  return { detail, step };
}

function userEvidence(detail: ReturnType<typeof getRun>) {
  return detail?.task.evidence.filter((item) => item.sourceType === "tutor-user") ?? [];
}

function finalTutorArtifact(runId: string, root: string): void {
  const detail = getRun(runId, root);
  if (!detail) return;
  const lines = detail.task.evidence
    .filter((item) => item.sourceType === "tutor-user" || item.sourceType === "tutor-assistant")
    .map((item) => `### ${item.sourceType === "tutor-user" ? "用户回答" : "Tutor 反馈"}\n${item.quote}`);
  const content = `# Tutor 学习记录\n\n## 学习目标\n\n${detail.task.objective}\n\n## 过程记录\n\n${lines.join("\n\n")}\n`;
  const artifactDir = join(root, ".bt", "artifacts");
  mkdirSync(artifactDir, { recursive: true });
  const path = join(artifactDir, `tutor-${runId}.md`);
  writeFileSync(path, content, "utf8");
  createArtifact({ taskId: detail.task.id, runId, kind: "tutor-learning-log", path, content, summary: "Tutor 诊断、复述和变式验证记录" }, root);
}

function finishTutorEvaluation(runId: string, root: string, session: TutorAgentSession, finalText: string, evidenceIds: string[]): void {
  const before = getRun(runId, root);
  if (!before) throw new Error("运行不存在");
  const answers = userEvidence(before);
  const criteria = before.task.acceptanceCriteria.map((criterion) => ({
    criterion,
    passed: criterion.includes("复述") ? answers.length >= 1 : criterion.includes("变式") ? answers.length >= 2 : true,
    evidenceIds,
    note: "依据本次 Tutor Session 的用户回答和助手反馈；AI 评估仍需用户审阅。",
  }));
  evaluateTask({ taskId: before.task.id, runId, criteria, pending: criteria.filter((item) => !item.passed).map((item) => item.criterion), humanReview: "AI 评估，待用户审阅" }, root);
  const evaluation = currentStep(runId, root);
  if (evaluation.step.kind === "evaluate") markStep({ stepId: evaluation.step.id, status: "completed", output: { result: "pass", evidenceCount: evidenceIds.length } }, root);
  finalTutorArtifact(runId, root);

  const after = getRun(runId, root);
  const userQuotes = userEvidence(after).slice(-2).map((item) => ({ entryId: item.id, role: "user" as const, quote: item.quote.slice(0, 1000) }));
  const assistantQuote = finalText.trim().slice(0, 1000);
  if (userQuotes.length > 0 && assistantQuote) {
    try {
      const proposal = proposeMemory(root, {
        target: "knowledge_map",
        kind: "ai_explanation",
        text: `围绕“${before.task.objective}”的 Tutor 学习记录。`,
        reason: "Tutor 完成了诊断、用户复述和变式验证，学习记录仍需用户确认。",
        assessment: {
          concept: before.task.objective.slice(0, 200),
          level: "L2",
          basis: `Tutor 最终反馈：${assistantQuote}`,
          gaps: "AI 评估不能替代用户对知识掌握程度的判断，仍需后续复习验证。",
          nextQuestion: "请在新的场景中独立解释并应用这个概念。",
        },
      }, {
        sessionId: session.sessionId,
        cwd: resolveTaskCwd(before.task, root),
        mode: "tutor",
        evidence: [...userQuotes, { entryId: `tutor-${runId}-final`, role: "assistant" as const, quote: assistantQuote }],
      });
      recordHarnessEvent({ taskId: before.task.id, runId, type: "memory_candidate_created", payload: { proposalId: proposal.id, target: proposal.target } }, root);
    } catch (error) {
      recordHarnessEvent({ taskId: before.task.id, runId, type: "memory_candidate_failed", payload: { message: error instanceof Error ? error.message : String(error) } }, root);
    }
  }
}

async function executeTutorTurn(run: HarnessRun, options: TutorRunnerOptions, prompt: string, phase: TutorPhase): Promise<void> {
  const root = options.root ?? btRoot();
  const initial = currentStep(run.id, root);
  const stored = sessionInfo(initial.detail);
  const cwd = stored?.cwd ?? resolveTaskCwd(initial.detail.task, root);
  const createSession = options.createSession ?? defaultSession;
  const session = await createSession(cwd, stored?.sessionId ?? `bt-tutor-${run.id}`, stored?.sessionFile);
  if (!stored) recordHarnessEvent({ taskId: initial.detail.task.id, runId: run.id, stepId: initial.step.id, type: "tutor_session_started", payload: { sessionId: session.sessionId, sessionFile: session.sessionFile, cwd } }, root);
  const abort = async () => session.send({ type: "abort" });
  activeTutorRuns.set(run.id, { session, abort });
  const actionIds = new Map<string, { id: string; args: Record<string, unknown> }>();
  const evidenceIds: string[] = [];
  let finalText = "";
  let blockedByPolicy = false;
  let settled = false;
  let timeout: ReturnType<typeof setTimeout> | null = null;

  const finish = (resolvePromise: () => void, rejectPromise: (error: unknown) => void, error?: unknown) => {
    if (settled) return;
    settled = true;
    if (timeout !== null) clearTimeout(timeout);
    activeTutorRuns.delete(run.id);
    if (error === undefined) resolvePromise(); else rejectPromise(error);
  };

  await new Promise<void>((resolvePromise, rejectPromise) => {
    const unsubscribe = session.onEvent((event) => {
      try {
        const latest = getRun(run.id, root);
        if (!latest) throw new Error("运行不存在");
        const stepId = latest.run.currentStepId;
        if (["agent_start", "prompt_error", "agent_end", "tool_execution_start", "tool_execution_end", "message_end"].includes(event.type)) {
          recordHarnessEvent({ taskId: latest.task.id, runId: run.id, stepId: stepId ?? undefined, type: `agent_${event.type}`, payload: { sessionId: session.sessionId, toolCallId: typeof event.toolCallId === "string" ? event.toolCallId : undefined, toolName: typeof event.toolName === "string" ? event.toolName : undefined } }, root);
        }
        if (event.type === "tool_execution_start" && typeof event.toolName === "string") {
          const policy = policyForTool(event.toolName);
          const args = event.args && typeof event.args === "object" ? event.args as Record<string, unknown> : {};
          const action = recordAction({ taskId: latest.task.id, runId: run.id, stepId: stepId ?? undefined, sessionId: session.sessionId, kind: "tool_call", toolName: event.toolName, riskLevel: policy.riskLevel, input: args }, root);
          if (typeof event.toolCallId === "string") actionIds.set(event.toolCallId, { id: action.id, args });
          if (policy.decision === "deny" || policy.decision === "approval_required") {
            blockedByPolicy = true;
            completeAction({ actionId: action.id, status: "blocked", output: { reason: policy.decision === "deny" ? "L3 操作被 Harness 拒绝" : "需要用户审批", riskLevel: policy.riskLevel } }, root);
            if (policy.decision === "approval_required") requestApproval({ taskId: latest.task.id, runId: run.id, stepId: stepId ?? undefined, actionId: action.id, riskLevel: policy.riskLevel, scope: `${event.toolName} 工具调用`, reason: "Tutor 只允许读取操作，继续执行会改变项目或外部状态" }, root);
            void abort();
          }
        }
        if (event.type === "tool_execution_end") {
          const action = typeof event.toolCallId === "string" ? actionIds.get(event.toolCallId) : undefined;
          if (action && !blockedByPolicy) completeAction({ actionId: action.id, status: event.result && typeof event.result === "object" && (event.result as Record<string, unknown>).isError ? "failed" : "succeeded", output: event.result }, root);
          const quote = compact(event.result);
          if (quote) evidenceIds.push(recordEvidence({ taskId: latest.task.id, runId: run.id, stepId: stepId ?? undefined, sourceType: "pi-tool", sessionId: session.sessionId, entryId: typeof event.toolCallId === "string" ? event.toolCallId : undefined, filePath: action ? findFilePath(action.args) : undefined, locator: typeof event.toolName === "string" ? event.toolName : undefined, quote }, root).id);
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
          if (blockedByPolicy) { unsubscribe(); finish(resolvePromise, rejectPromise); return; }
          if (!finalText.trim()) throw new Error("Tutor 没有返回可记录的反馈");
          const live = getRun(run.id, root);
          if (!live || live.run.status !== "running") { unsubscribe(); finish(resolvePromise, rejectPromise); return; }
          const assistantEvidence = recordEvidence({ taskId: live.task.id, runId: run.id, stepId: live.run.currentStepId ?? undefined, sourceType: "tutor-assistant", sessionId: session.sessionId, entryId: `tutor-${run.id}-${phase}`, locator: phase, quote: finalText }, root);
          evidenceIds.push(assistantEvidence.id);
          recordHarnessEvent({ taskId: live.task.id, runId: run.id, stepId: live.run.currentStepId ?? undefined, type: "tutor_feedback", payload: { phase, evidenceId: assistantEvidence.id } }, root);
          if (phase === "initial") {
            const steps = currentStep(run.id, root);
            if (steps.step.kind === "diagnose") markStep({ stepId: steps.step.id, status: "completed", output: { evidenceId: assistantEvidence.id } }, root);
            const teaching = currentStep(run.id, root);
            if (teaching.step.kind === "teach") markStep({ stepId: teaching.step.id, status: "completed", output: { evidenceId: assistantEvidence.id } }, root);
            pauseRun(run.id, root);
            recordHarnessEvent({ taskId: live.task.id, runId: run.id, stepId: currentStep(run.id, root).step.id, type: "user_input_required", payload: { phase: "recall", prompt: finalText.slice(0, 4000) } }, root);
          } else if (phase === "recall") {
            const recall = currentStep(run.id, root);
            if (recall.step.kind !== "recall") throw new Error("Tutor 复述步骤状态不一致");
            markStep({ stepId: recall.step.id, status: "completed", output: { evidenceId: assistantEvidence.id } }, root);
            pauseRun(run.id, root);
            recordHarnessEvent({ taskId: live.task.id, runId: run.id, stepId: currentStep(run.id, root).step.id, type: "user_input_required", payload: { phase: "variant", prompt: finalText.slice(0, 4000) } }, root);
          } else {
            const variant = currentStep(run.id, root);
            if (variant.step.kind !== "variant") throw new Error("Tutor 变式步骤状态不一致");
            markStep({ stepId: variant.step.id, status: "completed", output: { evidenceId: assistantEvidence.id } }, root);
            finishTutorEvaluation(run.id, root, session, finalText, evidenceIds);
          }
          unsubscribe();
          finish(resolvePromise, rejectPromise);
        }
        if (event.type === "prompt_error") throw new Error(compact(event.errorMessage) || "Tutor Agent 执行失败");
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
      try { const failed = currentStep(run.id, root); markStep({ stepId: failed.step.id, status: "failed", failureReason: "Tutor 执行超时" }, root); } catch { /* preserve timeout */ }
      finish(resolvePromise, rejectPromise, new Error("Tutor 执行超时"));
    }, options.timeoutMs ?? 15 * 60 * 1000);
    void session.send({ type: "prompt", message: prompt }).catch((error) => {
      unsubscribe();
      try { const failed = currentStep(run.id, root); markStep({ stepId: failed.step.id, status: "failed", failureReason: error instanceof Error ? error.message : String(error) }, root); } catch { /* preserve original failure */ }
      finish(resolvePromise, rejectPromise, error);
    });
  });
}

export async function executeTutorRun(runId: string, options: TutorRunnerOptions = {}): Promise<void> {
  const root = options.root ?? btRoot();
  const result = getRun(runId, root);
  if (!result) throw new Error("运行不存在");
  if (result.task.workflowId !== "tutor") throw new Error("当前运行不是 Tutor 工作流");
  if (result.run.status !== "running" || activeTutorRuns.has(runId)) return;
  const step = result.task.steps.find((item) => item.id === result.run.currentStepId);
  if (!step || step.kind !== "diagnose") throw new Error("Tutor 只能从诊断步骤启动");
  await executeTutorTurn(result.run, options, phasePrompt(result.task, "initial"), "initial");
}

export async function submitTutorInput(taskId: string, runId: string, text: string, options: TutorRunnerOptions = {}): Promise<void> {
  const root = options.root ?? btRoot();
  const result = getRun(runId, root);
  if (!result || result.task.id !== taskId) throw new Error("Tutor 运行不存在");
  if (result.task.workflowId !== "tutor" || result.run.status !== "paused") throw new Error("Tutor 当前不在等待用户回答");
  const answer = text.trim();
  if (!answer || answer.length > 12000) throw new Error("回答需要 1–12000 个字符");
  if (activeTutorRuns.has(runId)) throw new Error("Tutor 仍在执行上一轮，请稍候");
  const step = result.task.steps.find((item) => item.id === result.run.currentStepId);
  if (!step || (step.kind !== "recall" && step.kind !== "variant")) throw new Error("Tutor 当前没有可提交的回答步骤");
  const phase = step.kind as Exclude<TutorPhase, "initial">;
  const info = sessionInfo(result);
  if (!info) throw new Error("Tutor Session 来源缺失，无法恢复；请重试任务");
  const evidence = recordEvidence({ taskId, runId, stepId: step.id, sourceType: "tutor-user", sessionId: info.sessionId, entryId: `tutor-${runId}-${phase}-user`, locator: phase, quote: answer }, root);
  recordHarnessEvent({ taskId, runId, stepId: step.id, type: "tutor_user_input", payload: { phase, evidenceId: evidence.id } }, root);
  resumeRun(runId, root);
  await executeTutorTurn(result.run, options, phasePrompt(result.task, phase, answer), phase);
}

export async function abortTutorRun(runId: string): Promise<void> {
  const active = activeTutorRuns.get(runId);
  if (active) await active.abort();
}

export function getActiveTutorRunIds(): string[] { return [...activeTutorRuns.keys()]; }
