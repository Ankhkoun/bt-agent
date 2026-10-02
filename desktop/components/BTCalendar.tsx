"use client";

import { useEffect, useMemo, useState } from "react";
import { expandOccurrences, findCalendarConflicts, zonedLocalToInstant, zonedPartsAt, type CalendarEvent, type CalendarBook } from "@/lib/bt-calendar-model";
import { localDate, weekDates } from "@/lib/bt-planner-model";

type CalendarDraft = {
  id: string;
  title: string;
  startLocal: string;
  endLocal: string;
  timeZone: string;
  rrule: string;
  reminderText: string;
  taskId: string;
  status: CalendarEvent["status"];
  notes: string;
  createdAt: string;
  providerLinks: Record<string, string>;
};

const weekdays = ["一", "二", "三", "四", "五", "六", "日"];

function pad(value: number): string { return String(value).padStart(2, "0"); }

function localInput(value: string, timeZone: string): string {
  const parts = zonedPartsAt(Date.parse(value), timeZone);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
}

function isoFromLocal(value: string, timeZone: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error("请填写有效的日期和时间");
  return new Date(zonedLocalToInstant({ year: Number(match[1]), month: Number(match[2]), day: Number(match[3]), hour: Number(match[4]), minute: Number(match[5]) }, timeZone)).toISOString();
}

function toDraft(event: CalendarEvent): CalendarDraft {
  return { id: event.id, title: event.title, startLocal: localInput(event.startAt, event.timeZone), endLocal: localInput(event.endAt, event.timeZone), timeZone: event.timeZone, rrule: event.rrule, reminderText: event.reminderMinutes.join(", "), taskId: event.taskId, status: event.status, notes: event.notes, createdAt: event.createdAt, providerLinks: event.providerLinks };
}

function newDraft(date: string): CalendarDraft {
  const now = new Date().toISOString();
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  return { id: crypto.randomUUID(), title: "", startLocal: `${date}T09:00`, endLocal: `${date}T10:00`, timeZone, rrule: "", reminderText: "", taskId: "", status: "scheduled", notes: "", createdAt: now, providerLinks: {} };
}

function occurrenceTime(value: string, timeZone: string): string {
  return new Date(value).toLocaleTimeString("zh-CN", { timeZone, hour: "2-digit", minute: "2-digit" });
}

export function BTCalendar() {
  const [book, setBook] = useState<CalendarBook>({ revision: 0, events: [] });
  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState<"week" | "month">("week");
  const [anchor, setAnchor] = useState(localDate());
  const [draft, setDraft] = useState<CalendarDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function refresh() {
    try {
      const response = await fetch("/api/bt/calendar");
      const data = await response.json() as CalendarBook & { error?: string };
      if (!response.ok) throw new Error(data.error);
      setBook(data); setLoaded(true); setMessage("");
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  }

  useEffect(() => { void refresh(); }, []);

  const days = useMemo(() => {
    if (view === "week") return weekDates(anchor);
    const first = new Date(`${anchor.slice(0, 7)}-01T12:00:00`);
    first.setDate(first.getDate() - (first.getDay() + 6) % 7);
    return Array.from({ length: 42 }, (_, index) => { const date = new Date(first); date.setDate(date.getDate() + index); return localDate(date); });
  }, [anchor, view]);

  const range = useMemo(() => {
    const start = new Date(`${days[0]}T00:00:00`);
    const end = new Date(`${days.at(-1)}T00:00:00`);
    end.setDate(end.getDate() + 1);
    return { start: start.toISOString(), end: end.toISOString() };
  }, [days]);

  const occurrences = useMemo(() => book.events.flatMap((event) => {
    try { return expandOccurrences(event, range.start, range.end).map((item) => ({ ...item, event })); }
    catch { return []; }
  }), [book.events, range]);

  const conflicts = useMemo(() => {
    try { return findCalendarConflicts(book.events, range.start, range.end); }
    catch { return []; }
  }, [book.events, range]);

  async function save() {
    if (!draft) return;
    setBusy(true); setMessage("");
    try {
      const startAt = isoFromLocal(draft.startLocal, draft.timeZone);
      const endAt = isoFromLocal(draft.endLocal, draft.timeZone);
      const reminderMinutes = draft.reminderText.split(",").map((value) => value.trim()).filter(Boolean).map((value) => Number(value));
      const event: CalendarEvent = { id: draft.id, title: draft.title, startAt, endAt, timeZone: draft.timeZone, rrule: draft.rrule, reminderMinutes, taskId: draft.taskId, status: draft.status, notes: draft.notes, providerLinks: draft.providerLinks, createdAt: draft.createdAt, updatedAt: new Date().toISOString() };
      const response = await fetch("/api/bt/calendar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event, revision: book.revision }) });
      const data = await response.json() as CalendarBook & { error?: string };
      if (!response.ok) throw new Error(data.error);
      setBook(data); setDraft(null); setMessage("日程已保存");
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  async function remove(event: CalendarEvent) {
    if (!window.confirm(`确认删除日程“${event.title}”？`)) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/bt/calendar", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: event.id, revision: book.revision }) });
      const data = await response.json() as CalendarBook & { error?: string };
      if (!response.ok) throw new Error(data.error);
      setBook(data); setDraft(null); setMessage("日程已删除");
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  const occurrenceDay = (item: (typeof occurrences)[number]) => {
    const parts = zonedPartsAt(Date.parse(item.startAt), item.event.timeZone);
    return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
  };
  const occurrencesFor = (day: string) => occurrences.filter((item) => occurrenceDay(item) === day);

  return <section className="bt-calendar-panel" aria-label="本地日程">
    <div className="bt-calendar-toolbar">
      <div className="bt-memory-tabs"><button aria-pressed={view === "week"} onClick={() => setView("week")}>周视图</button><button aria-pressed={view === "month"} onClick={() => setView("month")}>月视图</button></div>
      <label>定位日期<input aria-label="日程定位日期" type="date" value={anchor} onChange={(event) => { if (event.target.value) setAnchor(event.target.value); }} /></label>
      <button disabled={!loaded || busy} className="bt-primary" onClick={() => setDraft(newDraft(anchor))}>＋ 新增日程</button>
      <button disabled={busy} onClick={() => void refresh()}>刷新</button>
    </div>
    <p className="bt-plan-hint">日程保存到本机 `.bt/calendar.json`；时区和重复规则会原样保留，也可通过 ICS Connector 同步。</p>
    <output role="status">{message || (!loaded ? "正在读取日程…" : "")}</output>
    {conflicts.length > 0 && <p className="bt-calendar-warning">当前范围发现 {conflicts.length} 组时间冲突，请在保存前确认取舍。</p>}
    <div className={`bt-calendar-grid ${view === "month" ? "is-month" : ""}`}>{days.map((day, index) => <section key={day} className={`${day === localDate() ? "is-today" : ""} ${view === "month" && day.slice(0, 7) !== anchor.slice(0, 7) ? "outside-month" : ""}`}>
      <button className="bt-plan-day" disabled={!loaded} onClick={() => setDraft(newDraft(day))}>{weekdays[index % 7]} · {day.slice(5)} ＋</button>
      {occurrencesFor(day).map((item) => <button className={`bt-calendar-event${item.event.status === "cancelled" ? " is-cancelled" : ""}`} key={`${item.event.id}-${item.index}`} onClick={() => setDraft(toDraft(item.event))}><strong>{item.event.title}</strong><small>{occurrenceTime(item.startAt, item.event.timeZone)}–{occurrenceTime(item.endAt, item.event.timeZone)} · {item.event.timeZone}</small></button>)}
    </section>)}</div>
    {draft && <form className="bt-form bt-calendar-editor" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <h3>{book.events.some((event) => event.id === draft.id) ? "编辑日程" : "新增日程"}</h3>
      <label>标题<input required maxLength={240} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
      <div className="bt-plan-fields"><label>开始时间<input required type="datetime-local" value={draft.startLocal} onChange={(event) => setDraft({ ...draft, startLocal: event.target.value })} /></label><label>结束时间<input required type="datetime-local" value={draft.endLocal} onChange={(event) => setDraft({ ...draft, endLocal: event.target.value })} /></label><label>时区<input required list="bt-time-zones" maxLength={120} value={draft.timeZone} onChange={(event) => setDraft({ ...draft, timeZone: event.target.value })} /></label><label>关联任务 ID<input maxLength={120} value={draft.taskId} onChange={(event) => setDraft({ ...draft, taskId: event.target.value })} /></label></div>
      <datalist id="bt-time-zones"><option value="Asia/Shanghai" /><option value="UTC" /><option value="America/Los_Angeles" /><option value="Europe/Berlin" /></datalist>
      <label>重复规则<input maxLength={1000} value={draft.rrule} onChange={(event) => setDraft({ ...draft, rrule: event.target.value })} placeholder="例如 FREQ=WEEKLY;BYDAY=MO,WE" /></label>
      <label>提前提醒（分钟，逗号分隔）<input inputMode="numeric" maxLength={40} value={draft.reminderText} onChange={(event) => setDraft({ ...draft, reminderText: event.target.value })} placeholder="例如 10, 60" /></label>
      <label>备注<textarea rows={3} maxLength={20000} value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} /></label>
      <div className="bt-plan-toolbar"><button className="bt-primary" disabled={busy}>{busy ? "保存中…" : "保存日程"}</button><button type="button" disabled={busy} onClick={() => setDraft(null)}>取消</button>{book.events.some((event) => event.id === draft.id) && <button type="button" disabled={busy} onClick={() => { const event = book.events.find((item) => item.id === draft.id); if (event) void remove(event); }}>删除日程</button>}</div>
    </form>}
  </section>;
}
