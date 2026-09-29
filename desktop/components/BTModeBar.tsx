"use client";
import { useEffect, useState } from "react";

const modes = [
  ["general", "General", "直接解决当前的问题"],
  ["tutor", "Tutor", "让知识真正成为你的能力"],
  ["interviewer", "Interviewer", "找到知识与表达的边界"],
  ["planner", "Planner", "看清主线，再决定下一步"],
  ["bt", "BT", "有些问题，值得慢慢想"],
] as const;
export function BTModeBar({ mode, busy, onChange, asideOpen, onAside }: { mode?: string; busy: boolean; onChange: (mode: string) => Promise<void>; asideOpen?: boolean; onAside?: () => void }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [defaultMode, setDefaultMode] = useState("general");
  useEffect(() => { void fetch("/api/bt").then(r => r.json()).then(d => setDefaultMode(d.settings?.defaultMode ?? "general")).catch(() => {}); }, []);
  const active = mode ?? defaultMode;
  return <section className={`bt-mode-bar ${active === "bt" ? "bt-mode-companion" : ""}`} aria-label="BT 模式">
    <div className="bt-mode-options">{modes.map(([id, label, detail]) => <button key={id} type="button" aria-pressed={active === id} disabled={busy || pending} title={detail} onClick={async () => {
      setPending(true); setError("");
      try { await onChange(id); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setPending(false); }
    }}>{label}</button>)}</div>
    {onAside && <button type="button" className="bt-quick-toggle" aria-expanded={asideOpen} onClick={onAside}>随问 {asideOpen ? "−" : "+"}</button>}
    <span className={error ? "bt-mode-error" : "bt-mode-caption"} role={error ? "alert" : undefined}>{error || (pending ? "正在切换…" : modes.find(([id]) => id === active)?.[2])}</span>
  </section>;
}
