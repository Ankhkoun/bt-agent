import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { btRoot } from "./bt-config";
import { readNotebooks } from "./bt-notebooks";
import { readPlanBook } from "./bt-planner";
import {
  getWorkflowProfile,
  isRunStatus,
  isStepStatus,
  isTaskStatus,
  newId,
  type ApprovalDecision,
  type RiskLevel,
  type RunStatus,
  type StepStatus,
  type TaskInput,
  type TaskStatus,
  type WorkflowId,
  validateTaskInput,
} from "./bt-harness-model";

export interface HarnessTask {
  id: string;
  workflowId: WorkflowId;
  objective: string;
  scope: string;
  acceptanceCriteria: string[];
  status: TaskStatus;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface HarnessRun {
  id: string;
  taskId: string;
  status: RunStatus;
  currentStepId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  failureReason: string | null;
}

export interface HarnessStep {
  id: string;
  runId: string;
  position: number;
  title: string;
  kind: string;
  status: StepStatus;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  attempt: number;
  requiresApproval: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface HarnessEvent {
  id: string;
  taskId: string;
  runId: string | null;
  stepId: string | null;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export type HarnessActionStatus = "pending" | "running" | "succeeded" | "failed" | "blocked";

export interface HarnessAction {
  id: string;
  taskId: string;
  runId: string | null;
  stepId: string | null;
  sessionId: string | null;
  kind: string;
  toolName: string | null;
  riskLevel: RiskLevel;
  status: HarnessActionStatus;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  createdAt: string;
  completedAt: string | null;
}

export interface HarnessApproval {
  id: string;
  taskId: string;
  runId: string;
  stepId: string | null;
  actionId: string | null;
  riskLevel: RiskLevel;
  scope: string;
  decision: ApprovalDecision;
  reason: string;
  createdAt: string;
  decidedAt: string | null;
  expiresAt: string | null;
}

export interface HarnessEvidence {
  id: string;
  taskId: string;
  runId: string | null;
  stepId: string | null;
  sourceType: string;
  filePath: string | null;
  sessionId: string | null;
  entryId: string | null;
  locator: string | null;
  quote: string;
  contentHash: string;
  createdAt: string;
}

export interface HarnessArtifact {
  id: string;
  taskId: string;
  runId: string | null;
  kind: string;
  path: string | null;
  contentHash: string | null;
  summary: string;
  createdAt: string;
}

export interface HarnessEvaluation {
  id: string;
  taskId: string;
  runId: string | null;
  result: "pass" | "partial" | "fail";
  criteria: Array<{ criterion: string; passed: boolean; evidenceIds: string[]; note: string }>;
  pending: string[];
  humanReview: string | null;
  createdAt: string;
}

export interface HarnessTaskDetail extends HarnessTask {
  runs: HarnessRun[];
  steps: HarnessStep[];
  events: HarnessEvent[];
  actions: HarnessAction[];
  approvals: HarnessApproval[];
  evidence: HarnessEvidence[];
  artifacts: HarnessArtifact[];
  evaluations: HarnessEvaluation[];
}

export interface HarnessOverview {
  tasks: HarnessTask[];
  counts: Record<TaskStatus, number>;
}

export class HarnessConflict extends Error {}

type Row = Record<string, unknown>;

const SCHEMA_VERSION = 1;

function now(): string { return new Date().toISOString(); }
function json(value: unknown): string { return JSON.stringify(value ?? {}); }
function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}
function hash(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function dbPath(root: string): string { return join(root, ".bt", "harness.db"); }

function mapTask(row: Row): HarnessTask {
  const workflowId = String(row.workflow_id);
  getWorkflowProfile(workflowId);
  const status = String(row.status);
  if (!isTaskStatus(status)) throw new Error(`任务状态无效：${status}`);
  return {
    id: String(row.id),
    workflowId: workflowId as WorkflowId,
    objective: String(row.objective),
    scope: String(row.scope ?? ""),
    acceptanceCriteria: parseJson<string[]>(row.acceptance_json, []),
    status,
    metadata: parseJson<Record<string, unknown>>(row.metadata_json, {}),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapRun(row: Row): HarnessRun {
  const status = String(row.status);
  if (!isRunStatus(status)) throw new Error(`运行状态无效：${status}`);
  return {
    id: String(row.id), taskId: String(row.task_id), status,
    currentStepId: row.current_step_id === null ? null : String(row.current_step_id),
    startedAt: row.started_at === null ? null : String(row.started_at),
    completedAt: row.completed_at === null ? null : String(row.completed_at),
    failureReason: row.failure_reason === null ? null : String(row.failure_reason),
  };
}

function mapStep(row: Row): HarnessStep {
  const status = String(row.status);
  if (!isStepStatus(status)) throw new Error(`步骤状态无效：${status}`);
  return {
    id: String(row.id), runId: String(row.run_id), position: Number(row.position),
    title: String(row.title), kind: String(row.kind), status,
    input: parseJson<Record<string, unknown>>(row.input_json, {}),
    output: parseJson<Record<string, unknown>>(row.output_json, {}),
    attempt: Number(row.attempt), requiresApproval: Number(row.requires_approval) === 1,
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

function mapEvent(row: Row): HarnessEvent {
  return {
    id: String(row.id), taskId: String(row.task_id),
    runId: row.run_id === null ? null : String(row.run_id),
    stepId: row.step_id === null ? null : String(row.step_id),
    type: String(row.type), payload: parseJson<Record<string, unknown>>(row.payload_json, {}), createdAt: String(row.created_at),
  };
}

function mapAction(row: Row): HarnessAction {
  return {
    id: String(row.id), taskId: String(row.task_id), runId: row.run_id === null ? null : String(row.run_id),
    stepId: row.step_id === null ? null : String(row.step_id), sessionId: row.session_id === null ? null : String(row.session_id),
    kind: String(row.kind), toolName: row.tool_name === null ? null : String(row.tool_name),
    riskLevel: String(row.risk_level) as RiskLevel, status: String(row.status) as HarnessActionStatus,
    input: parseJson<Record<string, unknown>>(row.input_json, {}), output: parseJson<Record<string, unknown>>(row.output_json, {}),
    createdAt: String(row.created_at), completedAt: row.completed_at === null ? null : String(row.completed_at),
  };
}

function mapApproval(row: Row): HarnessApproval {
  return {
    id: String(row.id), taskId: String(row.task_id), runId: String(row.run_id),
    stepId: row.step_id === null ? null : String(row.step_id),
    actionId: row.action_id === null ? null : String(row.action_id),
    riskLevel: String(row.risk_level) as RiskLevel, decision: String(row.decision) as ApprovalDecision,
    scope: String(row.scope), reason: String(row.reason), createdAt: String(row.created_at),
    decidedAt: row.decided_at === null ? null : String(row.decided_at),
    expiresAt: row.expires_at === null ? null : String(row.expires_at),
  };
}

function mapEvidence(row: Row): HarnessEvidence {
  return {
    id: String(row.id), taskId: String(row.task_id), runId: row.run_id === null ? null : String(row.run_id),
    stepId: row.step_id === null ? null : String(row.step_id), sourceType: String(row.source_type),
    filePath: row.file_path === null ? null : String(row.file_path),
    sessionId: row.session_id === null ? null : String(row.session_id),
    entryId: row.entry_id === null ? null : String(row.entry_id),
    locator: row.locator === null ? null : String(row.locator), quote: String(row.quote),
    contentHash: String(row.content_hash), createdAt: String(row.created_at),
  };
}

function mapArtifact(row: Row): HarnessArtifact {
  return {
    id: String(row.id), taskId: String(row.task_id), runId: row.run_id === null ? null : String(row.run_id),
    kind: String(row.kind), path: row.path === null ? null : String(row.path),
    contentHash: row.content_hash === null ? null : String(row.content_hash), summary: String(row.summary), createdAt: String(row.created_at),
  };
}

function mapEvaluation(row: Row): HarnessEvaluation {
  const result = String(row.result) as HarnessEvaluation["result"];
  if (!(["pass", "partial", "fail"] as const).includes(result)) throw new Error(`评估结果无效：${result}`);
  return {
    id: String(row.id), taskId: String(row.task_id), runId: row.run_id === null ? null : String(row.run_id), result,
    criteria: parseJson<HarnessEvaluation["criteria"]>(row.criteria_json, []),
    pending: parseJson<string[]>(row.pending_json, []),
    humanReview: row.human_review === null ? null : String(row.human_review), createdAt: String(row.created_at),
  };
}

function schema(db: DatabaseSync): void {
  db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS harness_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL,
      objective TEXT NOT NULL,
      scope TEXT NOT NULL DEFAULT '',
      acceptance_json TEXT NOT NULL,
      status TEXT NOT NULL,
      metadata_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      current_step_id TEXT,
      started_at TEXT,
      completed_at TEXT,
      failure_reason TEXT
    );
    CREATE TABLE IF NOT EXISTS steps (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      title TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      input_json TEXT NOT NULL,
      output_json TEXT NOT NULL,
      attempt INTEGER NOT NULL DEFAULT 0,
      requires_approval INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS harness_events (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      run_id TEXT REFERENCES runs(id) ON DELETE CASCADE,
      step_id TEXT REFERENCES steps(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS actions (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      run_id TEXT REFERENCES runs(id) ON DELETE CASCADE,
      step_id TEXT REFERENCES steps(id) ON DELETE SET NULL,
      session_id TEXT,
      kind TEXT NOT NULL,
      tool_name TEXT,
      risk_level TEXT NOT NULL,
      status TEXT NOT NULL,
      input_json TEXT NOT NULL,
      output_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      completed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS approvals (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      step_id TEXT REFERENCES steps(id) ON DELETE SET NULL,
      action_id TEXT,
      risk_level TEXT NOT NULL,
      scope TEXT NOT NULL,
      decision TEXT NOT NULL,
      reason TEXT NOT NULL,
      created_at TEXT NOT NULL,
      decided_at TEXT,
      expires_at TEXT
    );
    CREATE TABLE IF NOT EXISTS evidence (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      run_id TEXT REFERENCES runs(id) ON DELETE CASCADE,
      step_id TEXT REFERENCES steps(id) ON DELETE SET NULL,
      source_type TEXT NOT NULL,
      file_path TEXT,
      session_id TEXT,
      entry_id TEXT,
      locator TEXT,
      quote TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS artifacts (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      run_id TEXT REFERENCES runs(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      path TEXT,
      content_hash TEXT,
      summary TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS evaluations (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      run_id TEXT REFERENCES runs(id) ON DELETE CASCADE,
      result TEXT NOT NULL,
      criteria_json TEXT NOT NULL,
      pending_json TEXT NOT NULL,
      human_review TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS notebooks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS records (
      id TEXT PRIMARY KEY,
      notebook_id TEXT NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_updated ON tasks(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_runs_task ON runs(task_id, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_steps_run ON steps(run_id, position);
    CREATE INDEX IF NOT EXISTS idx_events_run ON harness_events(run_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_actions_run ON actions(run_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_evidence_task ON evidence(task_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_artifacts_task ON artifacts(task_id, created_at);
  `);
  const version = db.prepare("SELECT value FROM harness_meta WHERE key = 'schema_version'").get() as Row | undefined;
  if (!version) db.prepare("INSERT INTO harness_meta(key, value) VALUES('schema_version', ?)").run(String(SCHEMA_VERSION));
  else if (Number(version.value) !== SCHEMA_VERSION) throw new Error(`不支持的 Harness 数据库版本：${version.value}`);
}

function migrateLegacy(db: DatabaseSync, root: string): void {
  const marker = (key: string) => db.prepare("SELECT value FROM harness_meta WHERE key = ?").get(key) as Row | undefined;
  const setMarker = (key: string) => db.prepare("INSERT OR REPLACE INTO harness_meta(key, value) VALUES(?, ?)").run(key, now());
  const btDir = join(root, ".bt");
  mkdirSync(btDir, { recursive: true });

  if (!marker("legacy_planner_v1") && existsSync(join(btDir, "planner.json"))) {
    const backup = join(btDir, `planner.json.before-harness-${Date.now()}.bak`);
    copyFileSync(join(btDir, "planner.json"), backup);
    const plan = readPlanBook(root);
    for (const item of plan.items) {
      const createdAt = item.updatedAt || now();
      const status: TaskStatus = item.status === "done" ? "completed" : item.status === "archived" ? "cancelled" : item.status === "doing" ? "running" : "draft";
      const taskId = item.id || randomUUID();
      const metadata = { legacyKind: item.kind, project: item.project, priority: item.priority, goalId: item.goalId, notes: item.notes, completedOn: item.completedOn, steps: item.steps };
      db.prepare(`INSERT OR IGNORE INTO tasks(id, workflow_id, objective, scope, acceptance_json, status, metadata_json, created_at, updated_at)
        VALUES(?, 'personal-planning', ?, ?, ?, ?, ?, ?, ?)`).run(taskId, item.title, item.project || "", json(["用户确认计划状态"]), status, json(metadata), createdAt, createdAt);
    }
    setMarker("legacy_planner_v1");
  }

  if (!marker("legacy_notebooks_v1") && existsSync(join(btDir, "notebooks.json"))) {
    const backup = join(btDir, `notebooks.json.before-harness-${Date.now()}.bak`);
    copyFileSync(join(btDir, "notebooks.json"), backup);
    const notebooks = readNotebooks(root);
    const importedAt = now();
    for (const book of notebooks.books) {
      db.prepare("INSERT OR IGNORE INTO notebooks(id, name, created_at, updated_at) VALUES(?, ?, ?, ?)").run(book.id, book.name, importedAt, importedAt);
    }
    for (const note of notebooks.notes) {
      db.prepare("INSERT OR IGNORE INTO records(id, notebook_id, text, created_at, updated_at) VALUES(?, ?, ?, ?, ?)").run(note.id, note.notebookId, note.text, note.createdAt, note.updatedAt);
    }
    setMarker("legacy_notebooks_v1");
  }
}

function withDb<T>(root: string, operation: (db: DatabaseSync) => T): T {
  mkdirSync(join(root, ".bt"), { recursive: true });
  const db = new DatabaseSync(dbPath(root));
  try {
    schema(db);
    migrateLegacy(db, root);
    return operation(db);
  } finally {
    db.close();
  }
}

function event(db: DatabaseSync, taskId: string, runId: string | null, stepId: string | null, type: string, payload: Record<string, unknown> = {}): HarnessEvent {
  const value: HarnessEvent = { id: newId(), taskId, runId, stepId, type, payload, createdAt: now() };
  db.prepare(`INSERT INTO harness_events(id, task_id, run_id, step_id, type, payload_json, created_at) VALUES(?, ?, ?, ?, ?, ?, ?)`)
    .run(value.id, taskId, runId, stepId, type, json(payload), value.createdAt);
  return value;
}

export function recordHarnessEvent(input: { taskId: string; runId?: string; stepId?: string; type: string; payload?: Record<string, unknown> }, root = btRoot()): HarnessEvent {
  if (!input.type.trim()) throw new Error("事件类型不能为空");
  return withDb(root, (db) => transaction(db, () => event(db, input.taskId, input.runId ?? null, input.stepId ?? null, input.type.trim(), input.payload ?? {})));
}

function normalizeActionValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { value: value === undefined ? null : value };
  return value as Record<string, unknown>;
}

export function recordAction(input: {
  taskId: string;
  runId?: string;
  stepId?: string;
  sessionId?: string;
  kind: string;
  toolName?: string;
  riskLevel: RiskLevel;
  status?: HarnessActionStatus;
  input?: Record<string, unknown>;
}, root = btRoot()): HarnessAction {
  if (!input.kind.trim()) throw new Error("动作类型不能为空");
  if (!("L0 L1 L2 L3".split(" ") as string[]).includes(input.riskLevel)) throw new Error("无效风险等级");
  return withDb(root, (db) => transaction(db, () => {
    const value: HarnessAction = {
      id: newId(), taskId: input.taskId, runId: input.runId ?? null, stepId: input.stepId ?? null,
      sessionId: input.sessionId?.trim() || null, kind: input.kind.trim(), toolName: input.toolName?.trim() || null,
      riskLevel: input.riskLevel, status: input.status ?? "running", input: input.input ?? {}, output: {}, createdAt: now(), completedAt: null,
    };
    db.prepare(`INSERT INTO actions(id, task_id, run_id, step_id, session_id, kind, tool_name, risk_level, status, input_json, output_json, created_at, completed_at)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(value.id, value.taskId, value.runId, value.stepId, value.sessionId, value.kind, value.toolName, value.riskLevel, value.status, json(value.input), json(value.output), value.createdAt, null);
    event(db, value.taskId, value.runId, value.stepId, "action_started", { actionId: value.id, kind: value.kind, toolName: value.toolName, riskLevel: value.riskLevel });
    return value;
  }));
}

export function completeAction(input: { actionId: string; status: HarnessActionStatus; output?: unknown }, root = btRoot()): HarnessAction {
  return withDb(root, (db) => transaction(db, () => {
    if (!(new Set<HarnessActionStatus>(["succeeded", "failed", "blocked"])).has(input.status)) throw new HarnessConflict("动作只能以成功、失败或阻塞结束");
    const row = db.prepare("SELECT * FROM actions WHERE id = ?").get(input.actionId) as Row | undefined;
    if (!row) throw new Error("动作不存在");
    if (["succeeded", "failed", "blocked"].includes(String(row.status))) throw new HarnessConflict("动作已经结束");
    const completedAt = now();
    const output = normalizeActionValue(input.output);
    db.prepare("UPDATE actions SET status = ?, output_json = ?, completed_at = ? WHERE id = ?").run(input.status, json(output), completedAt, input.actionId);
    const value = mapAction(db.prepare("SELECT * FROM actions WHERE id = ?").get(input.actionId) as Row);
    event(db, value.taskId, value.runId, value.stepId, "action_completed", { actionId: value.id, status: value.status });
    return value;
  }));
}

function transaction<T>(db: DatabaseSync, operation: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = operation();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* preserve original error */ }
    throw error;
  }
}

export function harnessDatabasePath(root = btRoot()): string { return dbPath(root); }

export function createTask(input: TaskInput, root = btRoot()): HarnessTask {
  const data = validateTaskInput(input);
  return withDb(root, (db) => transaction(db, () => {
    const value: HarnessTask = {
      id: newId(), workflowId: data.workflowId as WorkflowId, objective: data.objective, scope: data.scope ?? "",
      acceptanceCriteria: data.acceptanceCriteria ?? [], status: "draft", metadata: data.metadata ?? {}, createdAt: now(), updatedAt: now(),
    };
    db.prepare(`INSERT INTO tasks(id, workflow_id, objective, scope, acceptance_json, status, metadata_json, created_at, updated_at)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(value.id, value.workflowId, value.objective, value.scope, json(value.acceptanceCriteria), value.status, json(value.metadata), value.createdAt, value.updatedAt);
    event(db, value.id, null, null, "task_created", { workflowId: value.workflowId, objective: value.objective });
    return value;
  }));
}

export function listTasks(root = btRoot()): HarnessTask[] {
  return withDb(root, (db) => (db.prepare("SELECT * FROM tasks ORDER BY updated_at DESC").all() as Row[]).map(mapTask));
}

export function readHarnessOverview(root = btRoot()): HarnessOverview {
  const tasks = listTasks(root);
  const counts = Object.fromEntries(["draft", "ready", "running", "blocked", "completed", "failed", "cancelled"].map((status) => [status, 0])) as Record<TaskStatus, number>;
  for (const task of tasks) counts[task.status]++;
  return { tasks, counts };
}

export function getTask(taskId: string, root = btRoot()): HarnessTaskDetail | null {
  if (!taskId.trim()) return null;
  return withDb(root, (db) => {
    const taskRow = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as Row | undefined;
    if (!taskRow) return null;
    return {
      ...mapTask(taskRow),
      runs: (db.prepare("SELECT * FROM runs WHERE task_id = ? ORDER BY COALESCE(started_at, '') DESC").all(taskId) as Row[]).map(mapRun),
      steps: (db.prepare("SELECT steps.* FROM steps JOIN runs ON runs.id = steps.run_id WHERE runs.task_id = ? ORDER BY steps.created_at, steps.position").all(taskId) as Row[]).map(mapStep),
      events: (db.prepare("SELECT * FROM harness_events WHERE task_id = ? ORDER BY created_at, id").all(taskId) as Row[]).map(mapEvent),
      actions: (db.prepare("SELECT * FROM actions WHERE task_id = ? ORDER BY created_at, id").all(taskId) as Row[]).map(mapAction),
      approvals: (db.prepare("SELECT * FROM approvals WHERE task_id = ? ORDER BY created_at DESC").all(taskId) as Row[]).map(mapApproval),
      evidence: (db.prepare("SELECT * FROM evidence WHERE task_id = ? ORDER BY created_at").all(taskId) as Row[]).map(mapEvidence),
      artifacts: (db.prepare("SELECT * FROM artifacts WHERE task_id = ? ORDER BY created_at").all(taskId) as Row[]).map(mapArtifact),
      evaluations: (db.prepare("SELECT * FROM evaluations WHERE task_id = ? ORDER BY created_at DESC").all(taskId) as Row[]).map(mapEvaluation),
    };
  });
}

export function getRun(runId: string, root = btRoot()): { task: HarnessTaskDetail; run: HarnessRun } | null {
  const taskId = withDb(root, (db) => {
    const row = db.prepare("SELECT task_id FROM runs WHERE id = ?").get(runId) as Row | undefined;
    return row ? String(row.task_id) : null;
  });
  if (!taskId) return null;
  const task = getTask(taskId, root);
  if (!task) return null;
  const run = task.runs.find((item) => item.id === runId);
  return run ? { task, run } : null;
}

export function startRun(taskId: string, root = btRoot()): HarnessRun {
  return withDb(root, (db) => transaction(db, () => {
    const taskRow = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as Row | undefined;
    if (!taskRow) throw new Error("任务不存在");
    const task = mapTask(taskRow);
    if (["cancelled", "completed"].includes(task.status)) throw new HarnessConflict("已结束的任务不能再次启动，请创建新任务");
    const active = db.prepare("SELECT * FROM runs WHERE task_id = ? AND status IN ('pending', 'running', 'waiting_approval', 'paused') ORDER BY started_at DESC LIMIT 1").get(taskId) as Row | undefined;
    if (active) return mapRun(active);
    const profile = getWorkflowProfile(task.workflowId);
    const run: HarnessRun = { id: newId(), taskId, status: "running", currentStepId: null, startedAt: now(), completedAt: null, failureReason: null };
    db.prepare("INSERT INTO runs(id, task_id, status, current_step_id, started_at, completed_at, failure_reason) VALUES(?, ?, ?, ?, ?, ?, ?)").run(run.id, run.taskId, run.status, null, run.startedAt, null, null);
    const seeds = profile.seeds(task.objective);
    let firstStep: string | null = null;
    seeds.forEach((seed, position) => {
      const stepId = newId();
      if (firstStep === null) firstStep = stepId;
      const status = position === 0 ? "running" : "pending";
      db.prepare(`INSERT INTO steps(id, run_id, position, title, kind, status, input_json, output_json, attempt, requires_approval, created_at, updated_at)
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(stepId, run.id, position, seed.title, seed.kind, status, "{}", "{}", 0, seed.requiresApproval ? 1 : 0, run.startedAt, run.startedAt);
      if (position === 0) event(db, taskId, run.id, stepId, "step_started", { title: seed.title, kind: seed.kind });
    });
    db.prepare("UPDATE runs SET current_step_id = ? WHERE id = ?").run(firstStep, run.id);
    db.prepare("UPDATE tasks SET status = 'running', updated_at = ? WHERE id = ?").run(now(), taskId);
    event(db, taskId, run.id, null, "run_started", { workflowId: task.workflowId, stepCount: seeds.length });
    return { ...run, currentStepId: firstStep };
  }));
}

function updateRunStatus(runId: string, status: RunStatus, root: string, reason?: string): HarnessRun {
  return withDb(root, (db) => transaction(db, () => {
    const row = db.prepare("SELECT runs.*, tasks.workflow_id, tasks.status AS task_status FROM runs JOIN tasks ON tasks.id = runs.task_id WHERE runs.id = ?").get(runId) as Row | undefined;
    if (!row) throw new Error("运行不存在");
    const run = mapRun(row);
    const transitions: Record<RunStatus, RunStatus[]> = {
      pending: ["running", "cancelled"], running: ["paused", "waiting_approval", "completed", "failed", "cancelled"], waiting_approval: ["running", "paused", "cancelled", "failed"], paused: ["running", "cancelled"], completed: [], failed: ["running", "cancelled"], cancelled: [],
    };
    if (run.status !== status && !transitions[run.status].includes(status)) throw new HarnessConflict(`运行不能从 ${run.status} 变为 ${status}`);
    const completedAt = ["completed", "failed", "cancelled"].includes(status) ? now() : null;
    db.prepare("UPDATE runs SET status = ?, completed_at = ?, failure_reason = ? WHERE id = ?").run(status, completedAt, reason ?? null, runId);
    const taskStatus: TaskStatus = status === "completed" ? "completed" : status === "failed" ? "failed" : status === "cancelled" ? "cancelled" : status === "paused" ? "blocked" : "running";
    db.prepare("UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?").run(taskStatus, now(), run.taskId);
    event(db, run.taskId, run.id, run.currentStepId, `run_${status}`, reason ? { reason } : {});
    const next = db.prepare("SELECT * FROM runs WHERE id = ?").get(runId) as Row;
    return mapRun(next);
  }));
}

export function pauseRun(runId: string, root = btRoot()): HarnessRun { return updateRunStatus(runId, "paused", root); }
export function resumeRun(runId: string, root = btRoot()): HarnessRun { return updateRunStatus(runId, "running", root); }
export function cancelRun(runId: string, root = btRoot()): HarnessRun { return updateRunStatus(runId, "cancelled", root); }

export function retryStep(stepId: string, root = btRoot()): HarnessStep {
  return withDb(root, (db) => transaction(db, () => {
    const row = db.prepare("SELECT steps.*, runs.task_id, runs.status AS run_status FROM steps JOIN runs ON runs.id = steps.run_id WHERE steps.id = ?").get(stepId) as Row | undefined;
    if (!row) throw new Error("步骤不存在");
    if (String(row.status) !== "failed") throw new HarnessConflict("只有失败步骤可以重试");
    const updatedAt = now();
    db.prepare("UPDATE steps SET status = 'running', attempt = attempt + 1, updated_at = ? WHERE id = ?").run(updatedAt, stepId);
    db.prepare("UPDATE runs SET status = 'running', current_step_id = ?, failure_reason = NULL WHERE id = ?").run(stepId, String(row.run_id));
    db.prepare("UPDATE tasks SET status = 'running', updated_at = ? WHERE id = ?").run(updatedAt, String(row.task_id));
    event(db, String(row.task_id), String(row.run_id), stepId, "step_retried", { attempt: Number(row.attempt) + 1 });
    return mapStep(db.prepare("SELECT * FROM steps WHERE id = ?").get(stepId) as Row);
  }));
}

export function requestApproval(input: { taskId: string; runId: string; stepId?: string; actionId?: string; riskLevel: RiskLevel; scope: string; reason: string; expiresAt?: string }, root = btRoot()): HarnessApproval {
  if (!(["L0", "L1", "L2", "L3"] as readonly string[]).includes(input.riskLevel)) throw new Error("无效风险等级");
  if (!input.scope.trim() || !input.reason.trim()) throw new Error("审批范围和理由不能为空");
  return withDb(root, (db) => transaction(db, () => {
    const createdAt = now();
    const value: HarnessApproval = { id: newId(), taskId: input.taskId, runId: input.runId, stepId: input.stepId ?? null, actionId: input.actionId ?? null, riskLevel: input.riskLevel, scope: input.scope.trim().slice(0, 4000), decision: "pending", reason: input.reason.trim().slice(0, 4000), createdAt, decidedAt: null, expiresAt: input.expiresAt ?? null };
    db.prepare(`INSERT INTO approvals(id, task_id, run_id, step_id, action_id, risk_level, scope, decision, reason, created_at, decided_at, expires_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`) 
      .run(value.id, value.taskId, value.runId, value.stepId, value.actionId, value.riskLevel, value.scope, value.decision, value.reason, value.createdAt, null, value.expiresAt);
    db.prepare("UPDATE runs SET status = 'waiting_approval' WHERE id = ? AND status = 'running'").run(value.runId);
    if (value.stepId) db.prepare("UPDATE steps SET status = 'waiting_approval', updated_at = ? WHERE id = ? AND status = 'running'").run(createdAt, value.stepId);
    db.prepare("UPDATE tasks SET status = 'blocked', updated_at = ? WHERE id = ?").run(createdAt, value.taskId);
    event(db, value.taskId, value.runId, value.stepId, "approval_requested", { approvalId: value.id, riskLevel: value.riskLevel, scope: value.scope });
    return value;
  }));
}

export function resolveApproval(id: string, decision: Exclude<ApprovalDecision, "pending">, root = btRoot()): HarnessApproval {
  if (!["approved", "rejected", "expired"].includes(decision)) throw new Error("无效审批决定");
  return withDb(root, (db) => transaction(db, () => {
    const row = db.prepare("SELECT * FROM approvals WHERE id = ?").get(id) as Row | undefined;
    if (!row) throw new Error("审批不存在");
    const value = mapApproval(row);
    if (value.decision !== "pending") throw new HarnessConflict("审批已经处理");
    const decidedAt = now();
    const expired = value.expiresAt !== null && Date.parse(value.expiresAt) <= Date.parse(decidedAt);
    const effectiveDecision: Exclude<ApprovalDecision, "pending"> = expired ? "expired" : decision;
    db.prepare("UPDATE approvals SET decision = ?, decided_at = ? WHERE id = ?").run(effectiveDecision, decidedAt, id);
    if (effectiveDecision === "approved") {
      db.prepare("UPDATE runs SET status = 'running' WHERE id = ? AND status = 'waiting_approval'").run(value.runId);
      if (value.stepId) db.prepare("UPDATE steps SET status = 'running', updated_at = ? WHERE id = ? AND status = 'waiting_approval'").run(decidedAt, value.stepId);
    } else {
      db.prepare("UPDATE runs SET status = 'failed', completed_at = ?, failure_reason = ? WHERE id = ? AND status = 'waiting_approval'").run(decidedAt, `审批${effectiveDecision === "rejected" ? "被拒绝" : "已过期"}`, value.runId);
      if (value.stepId) db.prepare("UPDATE steps SET status = 'failed', output_json = ?, updated_at = ? WHERE id = ? AND status = 'waiting_approval'").run(json({ failureReason: `审批${effectiveDecision === "rejected" ? "被拒绝" : "已过期"}` }), decidedAt, value.stepId);
    }
    db.prepare("UPDATE tasks SET status = ? , updated_at = ? WHERE id = ?").run(effectiveDecision === "approved" ? "running" : "failed", decidedAt, value.taskId);
    event(db, value.taskId, value.runId, value.stepId, "approval_resolved", { approvalId: id, decision: effectiveDecision });
    return mapApproval(db.prepare("SELECT * FROM approvals WHERE id = ?").get(id) as Row);
  }));
}

export function recordEvidence(input: { taskId: string; runId?: string; stepId?: string; sourceType: string; filePath?: string; sessionId?: string; entryId?: string; locator?: string; quote: string }, root = btRoot()): HarnessEvidence {
  if (!input.sourceType.trim() || !input.quote.trim() || input.quote.length > 12000) throw new Error("证据类型和引用正文不能为空，正文最多 12000 字符");
  return withDb(root, (db) => transaction(db, () => {
    const value: HarnessEvidence = { id: newId(), taskId: input.taskId, runId: input.runId ?? null, stepId: input.stepId ?? null, sourceType: input.sourceType.trim(), filePath: input.filePath?.trim() || null, sessionId: input.sessionId?.trim() || null, entryId: input.entryId?.trim() || null, locator: input.locator?.trim() || null, quote: input.quote.trim(), contentHash: hash(input.quote), createdAt: now() };
    db.prepare(`INSERT INTO evidence(id, task_id, run_id, step_id, source_type, file_path, session_id, entry_id, locator, quote, content_hash, created_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(value.id, value.taskId, value.runId, value.stepId, value.sourceType, value.filePath, value.sessionId, value.entryId, value.locator, value.quote, value.contentHash, value.createdAt);
    event(db, value.taskId, value.runId, value.stepId, "evidence_captured", { evidenceId: value.id, sourceType: value.sourceType });
    return value;
  }));
}

export function createArtifact(input: { taskId: string; runId?: string; kind: string; path?: string; content?: string; summary: string }, root = btRoot()): HarnessArtifact {
  if (!input.kind.trim() || !input.summary.trim()) throw new Error("产物类型和摘要不能为空");
  return withDb(root, (db) => transaction(db, () => {
    const value: HarnessArtifact = { id: newId(), taskId: input.taskId, runId: input.runId ?? null, kind: input.kind.trim(), path: input.path?.trim() || null, contentHash: input.content === undefined ? null : hash(input.content), summary: input.summary.trim().slice(0, 12000), createdAt: now() };
    db.prepare("INSERT INTO artifacts(id, task_id, run_id, kind, path, content_hash, summary, created_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?)").run(value.id, value.taskId, value.runId, value.kind, value.path, value.contentHash, value.summary, value.createdAt);
    event(db, value.taskId, value.runId, null, "artifact_created", { artifactId: value.id, kind: value.kind, path: value.path });
    return value;
  }));
}

export function evaluateTask(input: { taskId: string; runId?: string; criteria?: Array<{ criterion: string; passed: boolean; evidenceIds?: string[]; note?: string }>; pending?: string[]; humanReview?: string }, root = btRoot()): HarnessEvaluation {
  return withDb(root, (db) => transaction(db, () => {
    const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(input.taskId) as Row | undefined;
    if (!task) throw new Error("任务不存在");
    const taskValue = mapTask(task);
    const criteria = (input.criteria ?? taskValue.acceptanceCriteria.map((criterion) => ({ criterion, passed: false, evidenceIds: [], note: "待验证" }))).map((item) => ({ criterion: String(item.criterion).trim(), passed: item.passed === true, evidenceIds: Array.isArray(item.evidenceIds) ? item.evidenceIds.filter((id): id is string => typeof id === "string") : [], note: typeof item.note === "string" ? item.note.trim() : "" }));
    if (criteria.some((item) => !item.criterion)) throw new Error("评估条件不能为空");
    const pending = (input.pending ?? criteria.filter((item) => !item.passed).map((item) => item.criterion)).filter((item) => item.trim()).map((item) => item.trim());
    const result: HarnessEvaluation["result"] = criteria.every((item) => item.passed) && pending.length === 0 ? "pass" : criteria.some((item) => item.passed) ? "partial" : "fail";
    const value: HarnessEvaluation = { id: newId(), taskId: input.taskId, runId: input.runId ?? null, result, criteria, pending, humanReview: input.humanReview?.trim() || null, createdAt: now() };
    db.prepare("INSERT INTO evaluations(id, task_id, run_id, result, criteria_json, pending_json, human_review, created_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?)").run(value.id, value.taskId, value.runId, value.result, json(value.criteria), json(value.pending), value.humanReview, value.createdAt);
    event(db, value.taskId, value.runId, null, "evaluation_completed", { evaluationId: value.id, result: value.result, pending: value.pending });
    return value;
  }));
}

export function markStep(input: { stepId: string; status: StepStatus; output?: Record<string, unknown>; failureReason?: string }, root = btRoot()): HarnessStep {
  return withDb(root, (db) => transaction(db, () => {
    if (!isStepStatus(input.status)) throw new HarnessConflict(`步骤状态无效：${input.status}`);
    const row = db.prepare("SELECT steps.*, runs.task_id FROM steps JOIN runs ON runs.id = steps.run_id WHERE steps.id = ?").get(input.stepId) as Row | undefined;
    if (!row) throw new Error("步骤不存在");
    const current = mapStep(row);
    if (current.status === "completed" && input.status !== "completed") throw new HarnessConflict("已完成步骤不能回退");
    const allowed: Record<StepStatus, StepStatus[]> = {
      pending: ["running", "skipped"], running: ["waiting_approval", "completed", "failed", "skipped"], waiting_approval: ["running", "failed"], completed: ["completed"], failed: ["running", "failed"], skipped: [],
    };
    if (current.status !== input.status && !allowed[current.status].includes(input.status)) throw new HarnessConflict(`步骤不能从 ${current.status} 变为 ${input.status}`);
    const updatedAt = now();
    const output = input.output ?? current.output;
    db.prepare("UPDATE steps SET status = ?, output_json = ?, updated_at = ? WHERE id = ?").run(input.status, json({ ...output, ...(input.failureReason ? { failureReason: input.failureReason } : {}) }), updatedAt, input.stepId);
    if (input.status === "completed") {
      const next = db.prepare("SELECT * FROM steps WHERE run_id = ? AND position > ? AND status = 'pending' ORDER BY position LIMIT 1").get(current.runId, current.position) as Row | undefined;
      if (next) {
        db.prepare("UPDATE steps SET status = 'running', updated_at = ? WHERE id = ?").run(updatedAt, String(next.id));
        db.prepare("UPDATE runs SET current_step_id = ?, status = 'running' WHERE id = ?").run(String(next.id), current.runId);
        event(db, String(row.task_id), current.runId, String(next.id), "step_started", { title: String(next.title), kind: String(next.kind) });
      } else {
        db.prepare("UPDATE runs SET current_step_id = NULL, status = 'completed', completed_at = ? WHERE id = ?").run(updatedAt, current.runId);
        db.prepare("UPDATE tasks SET status = 'completed', updated_at = ? WHERE id = ?").run(updatedAt, String(row.task_id));
        event(db, String(row.task_id), current.runId, input.stepId, "run_completed", {});
      }
    } else if (input.status === "failed") {
      db.prepare("UPDATE runs SET status = 'failed', completed_at = ?, failure_reason = ? WHERE id = ?").run(updatedAt, input.failureReason ?? "步骤失败", current.runId);
      db.prepare("UPDATE tasks SET status = 'failed', updated_at = ? WHERE id = ?").run(updatedAt, String(row.task_id));
      event(db, String(row.task_id), current.runId, input.stepId, "step_failed", { reason: input.failureReason ?? "步骤失败" });
    }
    return mapStep(db.prepare("SELECT * FROM steps WHERE id = ?").get(input.stepId) as Row);
  }));
}
