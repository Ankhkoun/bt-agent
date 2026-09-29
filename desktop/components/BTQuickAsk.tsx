"use client";
import { useEffect, useRef, useState } from "react";
import { MarkdownBody } from "./MarkdownBody";
import { boundedQuickHistory, type QuickTurn } from "@/lib/bt-quick-ask-model";

export function BTQuickAsk({ open, onClose, model }: {
  open: boolean; onClose: () => void; model: { provider: string; modelId: string } | null;
}) {
  const [question, setQuestion] = useState("");
  const [quote, setQuote] = useState("");
  const [turns, setTurns] = useState<QuickTurn[]>([]);
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const controller = useRef<AbortController | null>(null);
  const editor = useRef<HTMLTextAreaElement>(null);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => () => { controller.current?.abort(); }, []);
  useEffect(() => { if (open) editor.current?.focus(); }, [open]);
  useEffect(() => { if (open) end.current?.scrollIntoView({ block: "nearest" }); }, [open, turns, pending, error]);
  function stop() {
    controller.current?.abort(); controller.current = null;
    setPending(""); setNotice("已停止旁问，主对话继续保持原状。");
  }
  async function send() {
    if (!model || !question.trim() || controller.current) return;
    const request = new AbortController(); controller.current = request;
    const asked = question.trim();
    setPending(asked); setError(""); setNotice("");
    try {
      const response = await fetch("/api/bt/quick-ask", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: request.signal,
        body: JSON.stringify({ ...model, question: asked, quote, history: boundedQuickHistory(turns) }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "请求失败");
      if (controller.current !== request) return;
      setTurns(previous => [...previous, { question: asked, answer: result.answer }]);
      setQuestion("");
      setNotice(`${result.truncated ? "回答达到长度上限，可以继续追问。 " : ""}本次用量：${result.usage?.totalTokens ?? "—"} tokens`);
    } catch (e) {
      if (controller.current === request && !request.signal.aborted) setError(e instanceof Error ? e.message : "请求失败，请重试");
    } finally {
      if (controller.current === request) { controller.current = null; setPending(""); }
    }
  }
  return <aside className="bt-quick-ask" hidden={!open} aria-label="BT 随问侧栏" onKeyDown={e => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}>
    <header><div><strong>随问</strong><small>小问题在这里，主线留在原处</small></div><button type="button" aria-label="收起随问" onClick={onClose}>收起</button></header>
    <p className="bt-quick-hint">只发送旁问历史和你提供的引用，不自动读取主对话或 Memory。关闭侧栏保留本页内容；切换会话或刷新页面后重新开始。</p>
    <details className="bt-quick-quote"><summary>引用内容（可选）</summary><textarea aria-label="旁问引用" rows={4} maxLength={6000} value={quote} disabled={!!pending} onChange={e => setQuote(e.target.value)} placeholder="粘贴主对话中的术语、代码或一段话…"/></details>
    <div className="bt-quick-turns" aria-label="旁问记录">
      {!turns.length && !pending && <div className="bt-quick-empty"><strong>不用打断，直接问。</strong><p>例如：Session 是什么？<br/>这段代码里的 callback 有什么用？</p></div>}
      {turns.map((turn, index) => <article key={index}><p className="bt-quick-question">{turn.question}</p><MarkdownBody>{turn.answer}</MarkdownBody></article>)}
      {pending && <article><p className="bt-quick-question">{pending}</p><p role="status">BT 正在回答…</p></article>}
      {error && <p role="alert" className="bt-mode-error">{error}</p>}
      <div ref={end}/>
    </div>
    <form onSubmit={e => { e.preventDefault(); void send(); }}>
      <label htmlFor="bt-quick-question">问一个小问题</label>
      <textarea id="bt-quick-question" ref={editor} rows={3} maxLength={4000} value={question} disabled={!!pending} placeholder="输入问题，Ctrl / ⌘ + Enter 发送" onChange={e => setQuestion(e.target.value)} onKeyDown={e => {
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); e.stopPropagation(); void send(); }
      }}/>
      <div className="bt-quick-actions"><button type="button" disabled={!!pending || (!turns.length && !quote && !question)} onClick={() => {
        if (window.confirm("开始新旁问？本页旁问记录和草稿将清空，主对话不受影响。")) { setTurns([]); setQuote(""); setQuestion(""); setError(""); setNotice(""); }
      }}>新旁问</button>{pending ? <button type="button" onClick={stop}>停止</button> : <button className="bt-primary" disabled={!model || !question.trim()} type="submit">发送</button>}</div>
      <small>{model ? `使用 ${model.modelId} · 产生独立模型用量` : "请先在主对话中选择模型"}</small>
      <small>连续追问最多携带最近 8 轮、24,000 字符。</small>
      <output role="status">{notice}</output>
    </form>
  </aside>;
}
