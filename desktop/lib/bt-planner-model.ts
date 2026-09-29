export type PlanKind = "task" | "goal" | "note";
export interface PlanStep {
  id: string; title: string; done: boolean; completedOn: string;
}
export interface PlanItem {
  id: string; title: string; kind: PlanKind; status: "todo" | "doing" | "done" | "archived";
  date: string; project: string; priority: "P1" | "P2" | "P3"; goalId: string;
  notes: string; completedOn: string; updatedAt: string; steps: PlanStep[];
}
export interface PlanBook { revision: number; items: PlanItem[] }
export function localDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function validDate(value: unknown): value is string {
  if (value === "") return true;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00`);
  return !Number.isNaN(date.getTime()) && localDate(date) === value;
}
export function validatePlanItem(value: unknown): PlanItem {
  if (!value || typeof value !== "object") throw new Error("事项格式无效");
  const p = value as PlanItem;
  for (const key of ["id", "title", "date", "project", "goalId", "notes", "completedOn", "updatedAt"] as const) {
    if (typeof p[key] !== "string" || p[key].length > (key === "notes" ? 20000 : 240)) throw new Error("字段格式或长度无效");
  }
  const steps = Array.isArray(p.steps) ? p.steps.map((step) => {
    if (!step || typeof step !== "object" || typeof step.id !== "string" || typeof step.title !== "string" || !step.title.trim() || step.title.length > 240 || typeof step.done !== "boolean" || typeof step.completedOn !== "string" || !validDate(step.completedOn)) throw new Error("步骤格式或长度无效");
    return { id: step.id, title: step.title.trim(), done: step.done, completedOn: step.done ? step.completedOn || localDate() : "" };
  }) : [];
  if (steps.length > 100) throw new Error("单个事项最多包含 100 个步骤");
  if (!p.title.trim() || !p.id || !["task", "goal", "note"].includes(p.kind) || !["todo", "doing", "done", "archived"].includes(p.status) || !["P1", "P2", "P3"].includes(p.priority) || !validDate(p.date) || !validDate(p.completedOn) || (p.status === "done" && !p.completedOn)) throw new Error("请检查标题、状态和日期；已完成事项需要完成日期");
  return { id: p.id, title: p.title.trim(), kind: p.kind, status: p.status, date: p.date, project: p.project, priority: p.priority, goalId: p.goalId, notes: p.notes, completedOn: p.completedOn, updatedAt: p.updatedAt, steps };
}
export function stepProgress(item: PlanItem): { done: number; total: number; percent: number } {
  const total = item.steps.length; const done = item.steps.filter((step) => step.done).length;
  return { done, total, percent: total ? Math.round(done / total * 100) : item.status === "done" ? 100 : 0 };
}
export function weekDates(anchor: string): string[] {
  const start = new Date(`${anchor}T12:00:00`);
  start.setDate(start.getDate() - (start.getDay() + 6) % 7);
  return Array.from({ length: 7 }, (_, i) => { const day = new Date(start); day.setDate(day.getDate() + i); return localDate(day); });
}
