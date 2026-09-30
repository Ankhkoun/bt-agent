"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BookOpenText, FolderSimplePlus, GearSix, X, ArrowSquareOut } from "@phosphor-icons/react";
import { BTNotebooks } from "./BTNotebooks";
import { BTPlanner } from "./BTPlanner";
import { MarkdownBody } from "./MarkdownBody";
import { BTMemoryReview } from "./BTMemoryReview";

const labels: Record<string, string> = { profile: "关于我", goals: "目标", tasks: "当前任务", projects: "项目记录", knowledge_map: "知识地图", learning_log: "学习日志", bt_memory: "共同记忆" };
type Settings = { defaultMode: string; memoryEnabled: boolean; memoryLimit: number; memoryTotalLimit: number; persona: string };
type Project = { id: string; name: string; path: string };
type Data = { root: string; projects: Project[]; settings: Settings; memory: string[] };
export function BTLibrary({ onProject, onModels }: { onProject: (path: string) => void; onModels: () => void }) {
  const [data, setData] = useState<Data | null>(null);
  const [panel, setPanel] = useState<string | null>(null);
  const [memory, setMemory] = useState("profile");
  const [text, setText] = useState("");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);
  const refresh = async () => {
    const response = await fetch("/api/bt"); const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    setData(result); setSettings(result.settings);
  };
  useEffect(() => { void refresh().catch(e => setMessage(String(e))); }, []);
  useEffect(() => {
    if (panel !== "memory" || memory === "review") return;
    const controller = new AbortController(); setText(""); setMessage("");
    void fetch(`/api/bt?memory=${memory}`, { signal: controller.signal }).then(async response => {
      const result = await response.json(); if (!response.ok) throw new Error(result.error); setText(result.content);
    }).catch(e => { if (!controller.signal.aborted) setMessage(String(e)); });
    return () => controller.abort();
  }, [memory, panel]);
  useEffect(() => {
    if (!panel) return;
    const previous = document.activeElement as HTMLElement | null;
    const focusable = () => Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, textarea, select, a[href]') ?? []);
    focusable()[0]?.focus();
    const close = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); setPanel(null); }
      if (e.key === "Tab") {
        const items = focusable(); const first = items[0]; const last = items.at(-1);
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener("keydown", close, true);
    return () => { window.removeEventListener("keydown", close, true); previous?.focus(); };
  }, [panel]);
  const open = (name: string) => { setMessage(""); setPanel(name); };
  const save = async (payload: object) => {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/bt", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error);
      await refresh(); setMessage("已保存");
      if ("projects" in result) { setName(""); setPath(""); }
    } catch (e) { setMessage(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  return <>
    <div className="bt-library">
      <div className="bt-brand"><span className="bt-monogram">BT</span><div><strong>BT-Agent</strong><small>One BT · Shared memory</small></div></div>
      <div className="bt-library-actions"><button onClick={() => open("notebooks")}>随手记</button><button onClick={() => open("planner")}>日历 · 计划本</button><button onClick={() => open("memory")}><BookOpenText size={16}/> Memory</button><button onClick={() => open("settings")} aria-label="BT 设置"><GearSix size={17}/></button></div>
      <div className="bt-section-title">我的项目<button title="添加项目" aria-label="添加项目" onClick={() => open("project")}><FolderSimplePlus size={16}/></button></div>
      <div className="bt-project-list">{data?.projects.map(project => <button key={project.id} title={project.path} onClick={() => onProject(project.path)}><span className="bt-project-dot"/>{project.name}<ArrowSquareOut size={12}/></button>)}</div>
      {!data && <small>{message || "正在连接 BT…"}</small>}
    </div>
    {panel && createPortal(<div className="bt-modal-backdrop" onClick={() => setPanel(null)}><section ref={dialogRef} className={`bt-modal${panel === "planner" ? " bt-plan-modal" : ""}`} role="dialog" aria-modal="true" aria-label={panel === "notebooks" ? "BT 随手记" : panel === "planner" ? "BT 计划本" : panel === "memory" ? "BT Memory" : panel === "settings" ? "BT 设置" : "添加项目"} onClick={e => e.stopPropagation()}>
      <header><div><small>BT · PERSONAL SPACE</small><h2>{panel === "notebooks" ? "随手记下，留待回看" : panel === "planner" ? "日历、计划与做过的事" : panel === "memory" ? "记忆，让故事继续" : panel === "settings" ? "你的 BT" : "添加一个项目"}</h2></div><button onClick={() => setPanel(null)} aria-label="关闭"><X size={22}/></button></header>
      {panel === "notebooks" && <BTNotebooks />}
      {panel === "planner" && <BTPlanner />}
      {panel === "memory" && <><nav className="bt-memory-tabs">{Object.entries(labels).map(([id, label]) => <button key={id} aria-pressed={id === memory} onClick={() => setMemory(id)}>{label}</button>)}<button aria-pressed={memory === "review"} onClick={() => setMemory("review")}>候选与历史</button></nav>{memory === "review" ? <BTMemoryReview /> : <div className="bt-memory-content"><MarkdownBody>{text || message || "正在读取记忆…"}</MarkdownBody></div>}<footer>所有项目与模式共享 Memory。告诉 BT「记住…」或使用 /remember 提出候选，在「候选与历史」确认保存。</footer></>}
      {panel === "settings" && settings && <div className="bt-form">
        <button className="bt-primary" onClick={() => { setPanel(null); onModels(); }}>配置模型服务商 / API Key / 模型</button>
        <label>新对话默认模式<select value={settings.defaultMode} onChange={e => setSettings({ ...settings, defaultMode: e.target.value })}>{["general", "tutor", "interviewer", "planner", "bt"].map(id => <option key={id} value={id}>{id === "bt" ? "BT" : id[0].toUpperCase() + id.slice(1)}</option>)}</select></label>
        <label className="bt-checkbox"><input type="checkbox" checked={settings.memoryEnabled} onChange={e => setSettings({ ...settings, memoryEnabled: e.target.checked })}/> 每轮参考共享 Memory</label>
        <label>每份 Memory 自动载入的字符上限<input type="number" min={2000} max={32000} step={1000} value={settings.memoryLimit} onChange={e => setSettings({ ...settings, memoryLimit: Number(e.target.value) })}/></label>
        <label>每轮 Memory 总字符上限<input type="number" min={16000} max={128000} step={4000} value={settings.memoryTotalLimit} onChange={e => setSettings({ ...settings, memoryTotalLimit: Number(e.target.value) })}/></label>
        <label>你希望 BT 记住的交流偏好<textarea rows={5} maxLength={8000} placeholder="例如：称呼、回答长度、喜欢的交流风格。五种模式仍遵循各自边界。" value={settings.persona} onChange={e => setSettings({ ...settings, persona: e.target.value })}/></label>
        <p>默认模式用于新对话；已有对话保留自己的模式。记忆与交流偏好在下一轮生效。这里不会自动提炼或改写记忆。</p>
        <button className="bt-primary" disabled={busy} onClick={() => void save({ action: "settings", settings })}>{busy ? "保存中…" : "保存 BT 偏好"}</button><output>{message}</output>
      </div>}
      {panel === "project" && <form className="bt-form" onSubmit={e => { e.preventDefault(); void save({ action: "project", name, path }); }}>
        <label>项目名称<input required maxLength={60} value={name} onChange={e => setName(e.target.value)} placeholder="例如：小论文 / 多模态项目"/></label>
        <label>已有文件夹（可选）<input value={path} onChange={e => setPath(e.target.value)} placeholder="D:\\Projects\\my-project"/></label>
        <p>留空会创建一个独立资料文件夹。对话按项目归档，BT 的人格和长期记忆始终共享。</p>
        <button className="bt-primary" disabled={busy}>{busy ? "添加中…" : "添加项目"}</button><output>{message}</output>
      </form>}
    </section></div>, document.body)}
  </>;
}
