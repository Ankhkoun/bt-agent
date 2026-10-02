"use client";

import { useEffect, useState } from "react";
import { ArrowClockwise, Play, Pause, XCircle } from "@phosphor-icons/react";

type Task = {
  id: string;
  workflowId: string;
  objective: string;
  scope: string;
  acceptanceCriteria: string[];
  status: string;
  createdAt: string;
  updatedAt: string;
};
type Run = { id: string; taskId: string; status: string; currentStepId: string | null; startedAt: string | null; completedAt: string | null; failureReason: string | null };
type Step = { id: string; runId: string; title: string; kind: string; status: string; position: number; attempt: number; requiresApproval: boolean };
type Detail = Task & { runs: Run[]; steps: Step[]; actions: { id: string; kind: string; toolName: string | null; riskLevel: string; status: string; input: Record<string, unknown>; output: Record<string, unknown> }[]; evidence: { id: string; sourceType: string; filePath: string | null; locator: string | null; quote: string }[]; approvals: { id: string; riskLevel: string; scope: string; reason: string; decision: string }[]; artifacts: { id: string; kind: string; summary: string; path: string | null }[]; evaluations: { id: string; result: string; pending: string[] }[] };

const workflows = [
  ["research", "项目研究"],
  ["build", "工程执行"],
  ["tutor", "Tutor 学习"],
  ["interviewer", "Interviewer 面试"],
  ["document", "文档处理"],
  ["planner", "Planner 计划"],
  ["bt", "BT 反思"],
  ["personal-planning", "个人规划"],
  ["personal-affairs", "个人事务"],
] as const;

const statusLabel: Record<string, string> = {
  draft: "草稿", ready: "待开始", running: "运行中", blocked: "等待处理", completed: "已完成", failed: "失败", cancelled: "已取消",
  pending: "待开始", paused: "已暂停", waiting_approval: "等待审批", skipped: "已跳过", rejected: "已拒绝",
};

export function BTTaskCenter() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<Detail | null>(null);
  const [workflowId, setWorkflowId] = useState("research");
  const [objective, setObjective] = useState("");
  const [scope, setScope] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    const response = await fetch("/api/bt/tasks");
    const data = await response.json() as { tasks?: Task[]; counts?: Record<string, number>; error?: string };
    if (!response.ok) throw new Error(data.error ?? "任务加载失败");
    setTasks(data.tasks ?? []); setCounts(data.counts ?? {});
  };
  const load = async (id: string) => {
    const response = await fetch(`/api/bt/tasks/${encodeURIComponent(id)}`);
    const data = await response.json() as { task?: Detail; error?: string };
    if (!response.ok || !data.task) throw new Error(data.error ?? "任务不存在");
    setSelected(data.task);
  };
  useEffect(() => { void refresh().catch((error) => setMessage(error instanceof Error ? error.message : String(error))); }, []);

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!objective.trim()) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/bt/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workflowId, objective, scope }) });
      const data = await response.json() as { task?: Task; error?: string };
      if (!response.ok || !data.task) throw new Error(data.error ?? "创建失败");
      setObjective(""); setScope(""); await refresh(); await load(data.task.id); setMessage("任务已创建");
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };

  const action = async (taskId: string, actionName: string, runId?: string) => {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/bt/tasks/${encodeURIComponent(taskId)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: actionName, ...(runId ? { runId } : {}) }) });
      const data = await response.json() as { task?: Detail; error?: string };
      if (!response.ok || !data.task) throw new Error(data.error ?? "操作失败");
      setSelected(data.task); await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };

  const resolveApproval = async (approvalId: string, decision: "approved" | "rejected") => {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/bt/approvals/${encodeURIComponent(approvalId)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision }) });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "审批处理失败");
      if (selected) await load(selected.id); await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };

  const activeRun = selected?.runs.find((run) => ["running", "paused", "waiting_approval"].includes(run.status)) ?? selected?.runs[0];

  return <div className="bt-task-center">
    <div className="bt-task-summary">
      <strong>任务中心</strong>
      <span>草稿 {counts.draft ?? 0}</span><span>运行中 {counts.running ?? 0}</span><span>待处理 {counts.blocked ?? 0}</span><span>已完成 {counts.completed ?? 0}</span>
      <button type="button" title="刷新任务" aria-label="刷新任务" onClick={() => void refresh()}><ArrowClockwise size={16}/></button>
    </div>
    <form className="bt-form bt-task-create" onSubmit={(event) => void create(event)}>
      <label>工作流<select value={workflowId} onChange={(event) => setWorkflowId(event.target.value)}>{workflows.map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select></label>
      <label>目标<textarea required rows={3} maxLength={4000} value={objective} onChange={(event) => setObjective(event.target.value)} placeholder="例如：研究这个项目的 Agent 架构并准备面试材料"/></label>
      <label>范围（可选）<input maxLength={4000} value={scope} onChange={(event) => setScope(event.target.value)} placeholder="项目目录、文档或时间范围"/></label>
      <button className="bt-primary" disabled={busy || !objective.trim()}>创建任务</button>
    </form>
    {message && <output className="bt-task-message">{message}</output>}
    <div className="bt-task-layout">
      <div className="bt-task-list" aria-label="任务列表">
        {tasks.length === 0 && <p className="bt-plan-hint">还没有任务。创建一个项目研究或个人规划任务开始。</p>}
        {tasks.map((task) => <button type="button" className={`bt-task-row${selected?.id === task.id ? " is-selected" : ""}`} key={task.id} onClick={() => void load(task.id).catch((error) => setMessage(String(error)))}>
          <span><strong>{task.objective}</strong><small>{workflows.find(([id]) => id === task.workflowId)?.[1] ?? task.workflowId}</small></span><em>{statusLabel[task.status] ?? task.status}</em>
        </button>)}
      </div>
      {selected && <section className="bt-task-detail" aria-label="任务详情">
        <div className="bt-task-detail-head"><div><small>{workflows.find(([id]) => id === selected.workflowId)?.[1] ?? selected.workflowId}</small><h3>{selected.objective}</h3></div><span className={`bt-task-status status-${selected.status}`}>{statusLabel[selected.status] ?? selected.status}</span></div>
        {selected.scope && <p className="bt-task-scope">范围：{selected.scope}</p>}
        <div className="bt-task-actions">
          {!activeRun && !["completed", "cancelled"].includes(selected.status) && <button type="button" className="bt-primary" disabled={busy} onClick={() => void action(selected.id, "start")}><Play size={15}/>开始运行</button>}
          {activeRun?.status === "running" && <button type="button" disabled={busy} onClick={() => void action(selected.id, "pause", activeRun.id)}><Pause size={15}/>暂停</button>}
          {activeRun?.status === "paused" && <button type="button" className="bt-primary" disabled={busy} onClick={() => void action(selected.id, "resume", activeRun.id)}><Play size={15}/>继续</button>}
          {activeRun && ["running", "paused", "waiting_approval"].includes(activeRun.status) && <button type="button" disabled={busy} onClick={() => void action(selected.id, "cancel", activeRun.id)}><XCircle size={15}/>取消</button>}
        </div>
        {activeRun && <><h4>运行步骤</h4><ol className="bt-task-steps">{selected.steps.filter((step) => step.runId === activeRun.id).map((step) => <li key={step.id} className={`step-${step.status}`}><span>{step.title}</span><em>{statusLabel[step.status] ?? step.status}{step.requiresApproval ? " · 需审批" : ""}</em></li>)}</ol></>}
        {selected.artifacts.length > 0 && <><h4>产物</h4><ul className="bt-task-artifacts">{selected.artifacts.map((artifact) => <li key={artifact.id}><strong>{artifact.kind}</strong><span>{artifact.summary}</span></li>)}</ul></>}
        {selected.approvals.some((approval) => approval.decision === "pending") && <><h4>待审批操作</h4><ul className="bt-task-artifacts">{selected.approvals.filter((approval) => approval.decision === "pending").map((approval) => <li key={approval.id}><strong>{approval.riskLevel}</strong><span>{approval.scope}：{approval.reason}</span><button type="button" className="bt-primary" disabled={busy} onClick={() => void resolveApproval(approval.id, "approved")}>批准</button><button type="button" disabled={busy} onClick={() => void resolveApproval(approval.id, "rejected")}>拒绝</button></li>)}</ul></>}
        {selected.evidence.length > 0 && <><h4>证据（{selected.evidence.length}）</h4><ul className="bt-task-artifacts">{selected.evidence.slice(-8).map((item) => <li key={item.id}><strong>{item.locator ?? item.sourceType}</strong><span>{item.filePath ? `${item.filePath}：` : ""}{item.quote}</span></li>)}</ul></>}
        {selected.actions.length > 0 && <><h4>工具动作（{selected.actions.length}）</h4><ul className="bt-task-artifacts">{selected.actions.slice(-8).map((item) => <li key={item.id}><strong>{item.toolName ?? item.kind}</strong><span>{item.riskLevel} · {statusLabel[item.status] ?? item.status}</span></li>)}</ul></>}
        {selected.evaluations.length > 0 && <><h4>最近评估</h4><p className="bt-task-evaluation">{statusLabel[selected.evaluations[0].result] ?? selected.evaluations[0].result}{selected.evaluations[0].pending.length ? ` · 待处理：${selected.evaluations[0].pending.join("、")}` : ""}</p></>}
      </section>}
    </div>
  </div>;
}
