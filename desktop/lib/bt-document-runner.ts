import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { btRoot } from "./bt-config";
import { createArtifact, evaluateTask, getRun, markStep, recordEvidence, recordHarnessEvent, type HarnessRun } from "./bt-harness";
import { parseDocument } from "./bt-document";

export interface DocumentRunnerOptions { root?: string }

function documentPath(task: { scope: string; metadata: Record<string, unknown> }): string {
  const candidate = typeof task.metadata.documentPath === "string" && task.metadata.documentPath.trim()
    ? task.metadata.documentPath
    : task.scope;
  if (!candidate?.trim()) throw new Error("Document Workflow 需要文档路径");
  return resolve(candidate.trim());
}

function currentStep(runId: string, root: string) {
  const detail = getRun(runId, root);
  if (!detail) throw new Error("运行不存在");
  const step = detail.task.steps.find((item) => item.id === detail.run.currentStepId);
  if (!step) throw new Error("运行没有当前步骤");
  return { detail, step };
}

function failDocumentStep(run: HarnessRun, root: string, reason: string): never {
  const current = currentStep(run.id, root);
  markStep({ stepId: current.step.id, status: "failed", failureReason: reason }, root);
  throw new Error(reason);
}

export async function executeDocumentRun(runId: string, options: DocumentRunnerOptions = {}): Promise<void> {
  const root = options.root ?? btRoot();
  const result = getRun(runId, root);
  if (!result) throw new Error("运行不存在");
  if (result.task.workflowId !== "document") throw new Error("当前运行不是 Document 工作流");
  if (result.run.status !== "running") return;
  const path = documentPath(result.task);
  const scope = currentStep(runId, root);
  if (scope.step.kind !== "scope") throw new Error("Document 只能从资料目标步骤启动");
  markStep({ stepId: scope.step.id, status: "completed", output: { path } }, root);

  const ingest = currentStep(runId, root);
  if (ingest.step.kind !== "ingest") throw new Error("Document 解析步骤状态不一致");
  let blocks;
  try { blocks = await parseDocument(path); }
  catch (error) { return failDocumentStep(result.run, root, error instanceof Error ? error.message : String(error)); }
  const first = blocks[0];
  if (!first || first.metadata.parseStatus !== "ok") {
    const message = first?.metadata.message ?? "文档解析失败";
    recordHarnessEvent({ taskId: result.task.id, runId, stepId: ingest.step.id, type: "document_parse_failed", payload: { path, format: first?.format, message } }, root);
    return failDocumentStep(result.run, root, message);
  }
  const usable = blocks.filter((block) => block.text.trim()).slice(0, 2000);
  const truncated = blocks.some((block) => block.text.trim()) && usable.length < blocks.filter((block) => block.text.trim()).length;
  const evidenceIds = usable.map((block) => recordEvidence({ taskId: result.task.id, runId, stepId: ingest.step.id, sourceType: "document", filePath: block.path, locator: block.locator, quote: block.text }, root).id);
  markStep({ stepId: ingest.step.id, status: "completed", output: { path, format: first.format, blockCount: blocks.length, evidenceCount: evidenceIds.length, truncated } }, root);

  const evidenceStep = currentStep(runId, root);
  if (evidenceStep.step.kind !== "evidence") throw new Error("Document 引用步骤状态不一致");
  markStep({ stepId: evidenceStep.step.id, status: "completed", output: { evidenceCount: evidenceIds.length, truncated } }, root);

  const artifactStep = currentStep(runId, root);
  if (artifactStep.step.kind !== "artifact") throw new Error("Document 产物步骤状态不一致");
  const detail = getRun(runId, root);
  if (!detail) throw new Error("运行不存在");
  const excerpts = detail.task.evidence.filter((item) => item.runId === runId).slice(0, 40).map((item) => `- ${item.locator ?? "引用"}: ${item.quote}`).join("\n");
  const content = `# 文档处理记录\n\n## 目标\n\n${detail.task.objective}\n\n## 来源\n\n${path}\n\n## 引用\n\n${excerpts || "未提取到文本引用"}\n\n${truncated ? "> 文档引用超过 2000 个块，Artifact 仅展示前 2000 个定位；完整文件仍保留在本地。\n" : ""}`;
  const artifactDir = join(root, ".bt", "artifacts");
  mkdirSync(artifactDir, { recursive: true });
  const artifactPath = join(artifactDir, `document-${runId}.md`);
  writeFileSync(artifactPath, content, "utf8");
  createArtifact({ taskId: detail.task.id, runId, kind: "document-record", path: artifactPath, content, summary: "带行号或页码引用的本地文档处理记录" }, root);
  evaluateTask({ taskId: detail.task.id, runId, criteria: detail.task.acceptanceCriteria.map((criterion) => ({ criterion, passed: !truncated, evidenceIds, note: truncated ? "解析结果已截断，仍需确认完整文档范围" : "本地解析结果已保存为 Evidence" })), pending: truncated ? ["确认文档是否需要完整分块"] : [] }, root);
  markStep({ stepId: artifactStep.step.id, status: "completed", output: { path: artifactPath, evidenceCount: evidenceIds.length } }, root);
}
