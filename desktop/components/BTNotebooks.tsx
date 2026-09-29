"use client";
import { useEffect, useRef, useState } from "react";
import { NoteContent } from "./NoteContent";
import type { Notebooks } from "@/lib/bt-notebooks-model";
import "./BTPlanner.css";
type Draft = { text: string; id: string; bookId: string };
export function BTNotebooks() {
  const [data, setData] = useState<Notebooks | null>(null);
  const [bookId, setBookId] = useState("default");
  const [draft, setDraft] = useState<Draft>({ text: "", id: "", bookId: "default" });
  const [name, setName] = useState("");
  const [naming, setNaming] = useState<"create" | "rename" | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const editor = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const uploading = useRef(false);
  const [message, setMessage] = useState("");
  async function insertImages(files: File[]) {
    if (busy || uploading.current || !files.length) return;
    const start = editor.current?.selectionStart ?? draft.text.length;
    const end = editor.current?.selectionEnd ?? start;
    const snapshot = { ...draft, bookId: draft.text || draft.id ? draft.bookId : bookId };
    uploading.current = true; setBusy(true); setMessage("正在保存图片…");
    const markers: string[] = [];
    try {
      for (const file of files) {
        if (file.size > 10 * 1024 * 1024) throw new Error("单张图片最多 10 MB");
        const r = await fetch("/api/bt/notebooks/images", { method: "POST", headers: { "Content-Type": file.type || "image/unknown" }, body: file });
        const result = await r.json(); if (!r.ok) throw new Error(result.error);
        markers.push(`![图片](${result.url})`);
      }
      setMessage("图片已插入，点击保存笔记完成记录");
    } catch (e) { setMessage(String(e)); }
    finally {
      if (markers.length) changeDraft({ ...snapshot, text: snapshot.text.slice(0, start) + "\n" + markers.join("\n") + "\n" + snapshot.text.slice(end) });
      uploading.current = false; setBusy(false);
    }
  }
  function changeDraft(next: Draft) {
    setDraft(next);
    try { sessionStorage.setItem("bt-quick-note-draft", JSON.stringify(next)); } catch { /* Current text remains in component state. */ }
  }
  async function refresh() {
    try { const r = await fetch("/api/bt/notebooks"); const result = await r.json(); if (!r.ok) throw new Error(result.error); setData(result); setMessage(""); }
    catch (e) { setMessage(String(e)); }
  }
  useEffect(() => {
    void refresh();
    try { const saved = JSON.parse(sessionStorage.getItem("bt-quick-note-draft") || "null"); if (saved && typeof saved.text === "string" && typeof saved.bookId === "string" && typeof saved.id === "string") { setDraft(saved); setBookId(saved.bookId); } } catch { /* Ignore invalid transient draft. */ }
  }, []);
  async function save(payload: object) {
    if (!data) return;
    setBusy(true); setMessage("");
    try {
      const r = await fetch("/api/bt/notebooks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, revision: data.revision }) });
      const result = await r.json(); if (!r.ok) throw new Error(result.error);
      setData(result); setMessage("已保存到本机");
      if ("text" in payload) changeDraft({ text: "", id: "", bookId });
      else { if (naming === "create") setBookId(result.books.at(-1).id); setNaming(null); }
    } catch (e) { setMessage(String(e)); } finally { setBusy(false); }
  }
  const current = data?.books.find(b => b.id === bookId);
  const draftBook = data?.books.find(b => b.id === draft.bookId);
  return <div className="bt-planner bt-notebooks">
    <div className="bt-plan-toolbar">
      <label>笔记本<select aria-label="选择笔记本" value={bookId} disabled={!data || busy} onChange={e => setBookId(e.target.value)}>{data?.books.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
      <button disabled={!data || busy} onClick={() => { setNaming("create"); setName(""); }}>新建笔记本</button>
      <button disabled={!current || busy} onClick={() => { setNaming("rename"); setName(current?.name || ""); }}>重命名</button>
      <button disabled={busy} onClick={() => void refresh()}>刷新</button>
    </div>
    {naming && <form className="bt-plan-toolbar" onSubmit={e => { e.preventDefault(); void save({ action: naming, id: bookId, name }); }}><input aria-label="笔记本名称" placeholder="给笔记本起个名字" autoFocus required maxLength={80} value={name} onChange={e => setName(e.target.value)}/><button disabled={busy}>保存名称</button><button type="button" onClick={() => setNaming(null)}>取消</button></form>}
    <form className="bt-form" onSubmit={e => { e.preventDefault(); void save({ action: "note", notebookId: draft.text || draft.id ? draft.bookId : bookId, id: draft.id || undefined, text: draft.text }); }}>
      <label>{draft.id ? "编辑笔记" : "随手写几句"}<textarea ref={editor} onPaste={e => { const files = Array.from(e.clipboardData.files).filter(f => f.type.startsWith("image/")); if (files.length) { e.preventDefault(); void insertImages(files); } }} aria-label="笔记正文" disabled={busy} rows={7} maxLength={50000} placeholder="今天做了什么、产物放在哪里，或者还没做完的事……" value={draft.text} onChange={e => changeDraft({ ...draft, bookId: draft.text || draft.id ? draft.bookId : bookId, text: e.target.value })}/></label>
      <div className="bt-plan-toolbar"><input ref={picker} hidden type="file" aria-label="选择笔记图片" accept="image/png,image/jpeg,image/gif,image/webp" multiple disabled={busy} onChange={e => { void insertImages(Array.from(e.target.files || [])); e.target.value = ""; }}/><button type="button" disabled={!data || busy} onClick={() => picker.current?.click()}>插入图片</button><small>可直接粘贴截图 · 每张最多 10 MB</small></div>
      {draft.text.includes("![图片](") && <div className="bt-note-entry"><small>预览</small><NoteContent text={draft.text}/></div>}
      <div className="bt-plan-toolbar"><button className="bt-primary" disabled={!data || busy || !draft.text.trim()}>{busy ? "保存中…" : "保存笔记"}</button>{(draft.text || draft.id) && <button type="button" disabled={busy} onClick={() => { if (window.confirm("放弃当前未保存的修改？已保存的笔记不会删除。")) changeDraft({ text: "", id: "", bookId }); }}>放弃草稿</button>}<small>保存到「{(draft.text || draft.id ? draftBook : current)?.name || "我的随手记"}」 · 自动记录日期</small></div>
    </form>
    <output role="status">{message || (!data ? "正在读取笔记本…" : "")}</output>
    <input aria-label="搜索笔记" placeholder="搜索这个笔记本" value={query} onChange={e => setQuery(e.target.value)}/>
    <div className="bt-note-list">{data?.notes.filter(n => n.notebookId === bookId && n.text.toLowerCase().includes(query.toLowerCase())).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(n => <article key={n.id} className="bt-note-entry"><div className="bt-plan-toolbar"><time dateTime={n.createdAt}>{new Date(n.createdAt).toLocaleString("zh-CN")}</time>{n.updatedAt !== n.createdAt && <small>已编辑 {new Date(n.updatedAt).toLocaleString("zh-CN")}</small>}<button disabled={busy || !!draft.text || !!draft.id} onClick={() => changeDraft({ text: n.text, id: n.id, bookId: n.notebookId })}>编辑</button></div><NoteContent text={n.text}/></article>)}</div>
    {data && !data.notes.some(n => n.notebookId === bookId) && <p className="bt-plan-hint">这个笔记本还没有记录，写一句也可以。</p>}
  </div>;
}
