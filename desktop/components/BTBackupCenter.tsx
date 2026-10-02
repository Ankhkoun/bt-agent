"use client";

import { useEffect, useState } from "react";

type Backup = { id: string; createdAt: string; files: string[]; includesMemory: boolean };

export function BTBackupCenter() {
  const [backups, setBackups] = useState<Backup[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = async () => {
    const response = await fetch("/api/bt/backups");
    const data = await response.json() as { backups?: Backup[]; error?: string };
    if (!response.ok) throw new Error(data.error ?? "备份加载失败");
    setBackups(data.backups ?? []);
  };
  useEffect(() => { void refresh().catch((error) => setMessage(error instanceof Error ? error.message : String(error))); }, []);
  const create = async () => {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/bt/backups", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "create" }) });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "备份失败");
      await refresh(); setMessage("备份已创建");
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  const restore = async (id: string) => {
    if (!window.confirm("恢复前会自动创建当前数据的安全备份，确认继续吗？")) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/bt/backups", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "restore", id }) });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "恢复失败");
      await refresh(); setMessage("已恢复；请刷新任务和记忆页面");
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  return <div className="bt-form">
    <p>备份包含 Harness 数据、计划本、随手记、项目设置和 Markdown Memory，不包含 Pi 凭据或 Session。</p>
    <button className="bt-primary" disabled={busy} onClick={() => void create()}>立即备份</button>
    {message && <output>{message}</output>}
    <ul className="bt-task-artifacts">{backups.map((backup) => <li key={backup.id}><strong>{new Date(backup.createdAt).toLocaleString()}</strong><span>{backup.files.length} 项{backup.includesMemory ? " · 含 Memory" : ""}</span><button type="button" disabled={busy} onClick={() => void restore(backup.id)}>恢复</button></li>)}</ul>
    {!backups.length && <p>暂无备份。</p>}
  </div>;
}

