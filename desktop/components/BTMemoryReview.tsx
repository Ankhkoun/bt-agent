"use client";
import { useEffect, useState } from "react";
import type { MemoryReviewState } from "../lib/bt-memory";
import styles from "./BTMemoryReview.module.css";

const kindNames = { fact: "事实", user_view: "用户观点", ai_explanation: "AI解释 · 待验证", shared_question: "共同问题" };
const statusNames = { pending: "待确认", accepted: "已保存", rejected: "已拒绝", undone: "已撤销" };
export function BTMemoryReview() {
  const [data, setData] = useState<MemoryReviewState | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState(false);
  const refresh = async (signal?: AbortSignal) => {
    const response = await fetch("/api/bt/memory-review", { signal });
    const state = await response.json();
    if (!response.ok) throw new Error(state.error);
    setData(state);
  };
  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal).catch(e => { if (!controller.signal.aborted) setMessage(e.message); });
    return () => controller.abort();
  }, []);
  const review = async (id: string, action: "accept" | "reject" | "undo") => {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/bt/memory-review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, action, revision: data?.revision }) });
      const state = await response.json();
      if (!response.ok) {
        if (response.status === 409) await refresh();
        throw new Error(state.error);
      }
      setData(state);
      setMessage(action === "accept" ? "已保存到长期记忆，下轮对话生效。" : action === "undo" ? "已撤销此记录，保留其他内容。" : "已拒绝，长期记忆未改变。");
    } catch (e) { setMessage(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const proposals = data?.proposals.filter(p => history ? p.status !== "pending" : p.status === "pending").toReversed() ?? [];
  return <div className={styles.panel}>
    <p>BT 提出的记录先留在这里。确认前不会写入长期记忆；确认保存也不代表 AI 的知识评估已经成为事实。</p>
    <nav className={styles.actions} aria-label="记忆审阅范围">
      <button aria-pressed={!history} onClick={() => setHistory(false)}>待确认 ({data?.proposals.filter(p => p.status === "pending").length ?? 0})</button>
      <button aria-pressed={history} onClick={() => setHistory(true)}>审阅历史</button>
      <button disabled={busy} onClick={() => { void refresh().catch(e => setMessage(e.message)); }}>刷新</button>
    </nav>
    <output role="status">{message}</output>
    {!data && !message && <p>正在读取候选…</p>}
    {data && !proposals.length && <p>{history ? "暂无审阅历史。" : "暂无候选。对 BT 说「记住…」，或完成一轮学习复盘后，让它提出记忆候选。"}</p>}
    {proposals.map(p => <article key={p.id} className={styles.card}>
      <header><strong>{kindNames[p.kind]} · {p.target}</strong><span>{statusNames[p.status]}</span></header>
      <p className={styles.text}>{p.text}</p>
      <p>保留理由：{p.reason}</p>
      {p.assessment && <dl>
        <dt>知识点与建议等级</dt><dd>{p.assessment.concept} · {p.assessment.level}（AI评估，待验证）</dd>
        <dt>评估依据</dt><dd>{p.assessment.basis}</dd>
        <dt>缺口与边界</dt><dd>{p.assessment.gaps}</dd>
        <dt>下一验证问题</dt><dd>{p.assessment.nextQuestion}</dd>
      </dl>}
      <details><summary>查看来源与原文证据</summary>
        <p>模式：{p.source.mode} · 提出时间：{new Date(p.createdAt).toLocaleString()}</p>
        <p className={styles.text}>来源 Session：{p.source.sessionId}</p>
        <p className={styles.text}>资料目录：{p.source.cwd}</p>
        {p.source.evidence.map((e, i) => <blockquote key={i}><small>{e.role === "user" ? "用户" : "助手"} · 条目 {e.entryId}</small><p className={styles.text}>{e.quote}</p></blockquote>)}
      </details>
      <div className={styles.actions}>
        {p.status === "pending" && <><button disabled={busy} onClick={() => void review(p.id, "accept")}>确认保存</button><button disabled={busy} onClick={() => void review(p.id, "reject")}>拒绝</button></>}
        {p.status === "accepted" && <button disabled={busy} onClick={() => void review(p.id, "undo")}>撤销此记录</button>}
      </div>
    </article>)}
  </div>;
}
