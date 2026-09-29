"use client";
import { useEffect, useRef, useState } from "react";
import { localDate, stepProgress, weekDates, type PlanBook, type PlanItem } from "@/lib/bt-planner-model";
import "./BTPlanner.css";
const views = { week: "周计划", calendar: "日历", goals: "长期计划", journal: "完成日志", table: "全部事项" };
const statuses = { todo: "待开始", doing: "进行中", done: "已完成", archived: "已归档" };
const kinds = { task: "任务", goal: "长期目标", note: "记事" };
export function BTPlanner() {
  const [book, setBook] = useState<PlanBook>({ revision: 0, items: [] });
  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState<keyof typeof views>("week");
  const [anchor, setAnchor] = useState(localDate());
  const [query, setQuery] = useState("");
  const [project, setProject] = useState("");
  const [status, setStatus] = useState("");
  const [draft, setDraft] = useState<PlanItem | null>(null);
  const [busy, setBusy] = useState(false);
  const editorRef = useRef<HTMLFormElement>(null);
  const draftId = draft?.id;
  useEffect(() => { if (draftId) { editorRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); editorRef.current?.querySelector("input")?.focus({ preventScroll: true }); } }, [draftId]);
  const [message, setMessage] = useState("");
  async function refresh() {
    try { const r = await fetch("/api/bt/planner"); const data = await r.json(); if (!r.ok) throw new Error(data.error); setBook(data); setLoaded(true); setMessage(""); }
    catch (e) { setMessage(String(e)); }
  }
  useEffect(() => { void refresh(); }, []);
  const create = (date = anchor) => setDraft({ id: crypto.randomUUID(), title: "", kind: view === "goals" ? "goal" : "task", status: view === "journal" ? "done" : "todo", date, project, priority: "P2", goalId: "", notes: "", completedOn: view === "journal" ? date : "", updatedAt: "", steps: [] });
  async function save(item: PlanItem) {
    setBusy(true); setMessage("");
    try {
      const r = await fetch("/api/bt/planner", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ item, revision: book.revision }) });
      const data = await r.json(); if (!r.ok) throw new Error(data.error);
      setBook(data); setDraft(null); setMessage("已保存到本机");
    } catch (e) { setMessage(String(e)); } finally { setBusy(false); }
  }
  const items = book.items.filter(p => (!project || p.project === project) && (!status ? p.status !== "archived" : p.status === status) && `${p.title} ${p.notes}`.toLowerCase().includes(query.toLowerCase()));
  const days = weekDates(anchor);
  const goals = book.items.filter(p => p.kind === "goal");
  const visible = items.filter(p => view === "goals" ? p.kind === "goal" : view === "journal" ? p.status === "done" : true).sort((a, b) => view === "journal" ? b.completedOn.localeCompare(a.completedOn) : a.date.localeCompare(b.date) || a.priority.localeCompare(b.priority));
  function card(item: PlanItem) { const progress = stepProgress(item); return <button className={`bt-plan-card ${item.status === "done" ? "is-done" : ""}`} key={item.id} onClick={() => setDraft({ ...item })}><strong>{item.title}</strong><small>{item.priority} · {statuses[item.status]}{item.project && ` · ${item.project}`}</small>{progress.total > 0 && <span className="bt-plan-progress"><span style={{ width: `${progress.percent}%` }} />{progress.done}/{progress.total} 步骤 · {progress.percent}%</span>}</button>; }
  const first = new Date(`${anchor.slice(0, 7)}-01T12:00:00`);
  first.setDate(first.getDate() - (first.getDay() + 6) % 7);
  const monthDays = Array.from({ length: 42 }, (_, i) => { const d = new Date(first); d.setDate(d.getDate() + i); return localDate(d); });
  return <div className="bt-planner">
    <nav className="bt-memory-tabs">{Object.entries(views).map(([key, label]) => <button key={key} aria-pressed={view === key} onClick={() => setView(key as keyof typeof views)}>{label}</button>)}</nav>
    <div className="bt-plan-toolbar">
      <label>定位日期<input aria-label="定位日期" type="date" value={anchor} onChange={e => { if (e.target.value) setAnchor(e.target.value); }}/></label>
      <input aria-label="搜索事项" placeholder="搜索标题 / 笔记" value={query} onChange={e => setQuery(e.target.value)}/>
      <select aria-label="筛选项目" value={project} onChange={e => setProject(e.target.value)}><option value="">全部项目</option>{[...new Set(book.items.map(p => p.project).filter(Boolean))].map(p => <option key={p}>{p}</option>)}</select>
      <select aria-label="筛选状态" value={status} onChange={e => setStatus(e.target.value)}><option value="">未归档</option>{Object.entries(statuses).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
      <button disabled={!loaded || busy} className="bt-primary" onClick={() => create()}>＋ 新增{view === "goals" ? "目标" : view === "journal" ? "完成记录" : "事项"}</button>
      <button disabled={busy} onClick={() => void refresh()}>刷新</button>
      <button disabled={!loaded} onClick={() => { const url = URL.createObjectURL(new Blob([JSON.stringify(book, null, 2)], { type: "application/json" })); const a = document.createElement("a"); a.href = url; a.download = `BT-计划本-${localDate()}.json`; a.click(); URL.revokeObjectURL(url); }}>导出</button>
    </div>
    <p className="bt-plan-hint">{view === "week" ? `${days[0]} — ${days[6]} · 周一开始；点击事项编辑或记录完成。` : view === "calendar" ? `${anchor.slice(0, 7)} · 点击日期新增事项。` : "计划和完成记录共用一份数据；完成日期可以补记，归档后仍可查询。"}</p>
    <output role="status">{message || (!loaded ? "正在读取计划本…" : "")}</output>
    {(view === "calendar" || view === "week") && <div className="bt-plan-grid">{(view === "week" ? days : monthDays).map((day, i) => <section key={day} className={`${day === localDate() ? "is-today" : ""} ${view === "calendar" && day.slice(0, 7) !== anchor.slice(0, 7) ? "outside-month" : ""}`}><button className="bt-plan-day" disabled={!loaded} onClick={() => create(day)}>{["一", "二", "三", "四", "五", "六", "日"][i % 7]} · {day.slice(5)} ＋</button>{items.filter(p => p.date === day).map(card)}</section>)}</div>}
    {view === "week" && <div className="bt-plan-backlog"><h3>逾期未完成 / 尚未排期</h3>{items.filter(p => p.status !== "done" && p.status !== "archived" && (!p.date || p.date < localDate())).map(card)}</div>}
    {view === "goals" && <div className="bt-plan-goals">{visible.map(g => { const tasks = book.items.filter(p => p.goalId === g.id && p.status !== "archived"); const done = tasks.filter(p => p.status === "done").length; const stepCount = tasks.reduce((n, p) => n + stepProgress(p).done, 0); const allSteps = tasks.reduce((n, p) => n + p.steps.length, 0); return <section key={g.id}>{card(g)}<p>截止：{g.date || "未定"} · 关联事项 {done}/{tasks.length} 完成{allSteps ? ` · 步骤 ${stepCount}/${allSteps}` : ""}</p><progress value={allSteps ? stepCount : done} max={allSteps || tasks.length || 1}/><p className="bt-plan-notes">{g.notes}</p></section>; })}</div>}
    {(view === "table" || view === "journal") && <div className="bt-plan-table"><table><thead><tr>{["事项", "类型", "状态", "优先级", "项目", "计划日期", "完成日期", "关联目标", "笔记 / 成果"].map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{visible.map(p => <tr key={p.id}><td><button onClick={() => setDraft({ ...p })}>{p.title}</button></td><td>{kinds[p.kind]}</td><td>{statuses[p.status]}</td><td>{p.priority}</td><td>{p.project}</td><td>{p.date || "未排期"}</td><td>{p.completedOn}</td><td>{goals.find(g => g.id === p.goalId)?.title}</td><td className="bt-plan-notes">{p.notes}</td></tr>)}</tbody></table></div>}
    {loaded && visible.length === 0 && <p className="bt-plan-hint">暂无符合条件的事项。可以新增计划，或补记已经做完的事情。</p>}
    {draft && <form ref={editorRef} className="bt-form bt-plan-editor" onSubmit={e => { e.preventDefault(); void save(draft); }}>
      <h3>{book.items.some(p => p.id === draft.id) ? "编辑事项" : "新增事项"}</h3>
      <label>标题<input required maxLength={240} value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })}/></label>
      <div className="bt-plan-fields"><label>类型<select value={draft.kind} onChange={e => setDraft({ ...draft, kind: e.target.value as PlanItem["kind"] })}>{Object.entries(kinds).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <label>状态<select value={draft.status} onChange={e => setDraft({ ...draft, status: e.target.value as PlanItem["status"], completedOn: e.target.value === "done" ? draft.completedOn || localDate() : "" })}>{Object.entries(statuses).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <label>优先级<select value={draft.priority} onChange={e => setDraft({ ...draft, priority: e.target.value as PlanItem["priority"] })}>{["P1", "P2", "P3"].map(p => <option key={p}>{p}</option>)}</select></label>
      <label>项目 / 领域<input maxLength={240} value={draft.project} onChange={e => setDraft({ ...draft, project: e.target.value })} placeholder="例如：论文 / 实习 / 生活"/></label>
      <label>计划日期 / 目标截止<input type="date" value={draft.date} onChange={e => setDraft({ ...draft, date: e.target.value })}/></label>
      {draft.status === "done" && <label>实际完成日期<input required type="date" value={draft.completedOn} onChange={e => setDraft({ ...draft, completedOn: e.target.value })}/></label>}
      <label>关联长期目标<select value={draft.goalId} onChange={e => setDraft({ ...draft, goalId: e.target.value })}><option value="">不关联</option>{goals.filter(g => g.id !== draft.id).map(g => <option key={g.id} value={g.id}>{g.title}</option>)}</select></label></div>
      <section className="bt-plan-steps"><div className="bt-plan-step-heading"><strong>执行步骤</strong><small>{stepProgress(draft).done}/{draft.steps.length || 0} 已完成{draft.steps.length ? ` · ${stepProgress(draft).percent}%` : ""}</small></div>{draft.steps.map((step, index) => <div className={`bt-plan-step ${step.done ? "is-done" : ""}`} key={step.id}><input aria-label={`完成步骤 ${index + 1}`} type="checkbox" checked={step.done} onChange={e => setDraft({ ...draft, steps: draft.steps.map(s => s.id === step.id ? { ...s, done: e.target.checked, completedOn: e.target.checked ? s.completedOn || localDate() : "" } : s) })}/><input aria-label={`步骤 ${index + 1} 内容`} maxLength={240} value={step.title} onChange={e => setDraft({ ...draft, steps: draft.steps.map(s => s.id === step.id ? { ...s, title: e.target.value } : s) })}/><button type="button" aria-label={`删除步骤 ${index + 1}`} onClick={() => setDraft({ ...draft, steps: draft.steps.filter(s => s.id !== step.id) })}>删除</button></div>)}<button type="button" onClick={() => setDraft({ ...draft, steps: [...draft.steps, { id: crypto.randomUUID(), title: "", done: false, completedOn: "" }] })} disabled={draft.steps.length >= 100}>＋ 添加步骤</button></section>
      <label>笔记 / 完成成果 / 复盘<textarea rows={4} maxLength={20000} value={draft.notes} onChange={e => setDraft({ ...draft, notes: e.target.value })}/></label>
      <div className="bt-plan-toolbar"><button className="bt-primary" disabled={busy}>{busy ? "保存中…" : "保存"}</button><button type="button" disabled={busy} onClick={() => setDraft(null)}>取消编辑</button></div>
    </form>}
  </div>;
}
