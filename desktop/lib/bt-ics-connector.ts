import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { writePrivateFileAtomicSync } from "./atomic-file";
import type { Connector, ConnectorItem } from "./bt-connector";
import { validateCalendarEvent, zonedLocalToInstant, zonedPartsAt, type CalendarEvent } from "./bt-calendar-model";

export interface IcsCalendarItem extends ConnectorItem {
  content: CalendarEvent[];
  metadata: { contentHash: string; eventCount: number; path: string };
}

function unescape(value: string): string { return value.replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\"); }
function escape(value: string): string { return value.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;"); }
function parseDateValue(value: string, timeZone: string): string {
  if (/^\d{8}T\d{6}Z$/.test(value)) {
    return new Date(Date.parse(`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(9, 11)}:${value.slice(11, 13)}:${value.slice(13, 15)}Z`)).toISOString();
  }
  if (/^\d{8}T\d{6}$/.test(value)) {
    const instant = zonedLocalToInstant({ year: Number(value.slice(0, 4)), month: Number(value.slice(4, 6)), day: Number(value.slice(6, 8)), hour: Number(value.slice(9, 11)), minute: Number(value.slice(11, 13)), second: Number(value.slice(13, 15)) }, timeZone);
    return new Date(instant).toISOString();
  }
  throw new Error("ICS 日期格式不受支持");
}
function formatDateValue(value: string, timeZone: string): string {
  const parts = zonedPartsAt(Date.parse(value), timeZone);
  return `${String(parts.year).padStart(4, "0")}${String(parts.month).padStart(2, "0")}${String(parts.day).padStart(2, "0")}T${String(parts.hour).padStart(2, "0")}${String(parts.minute).padStart(2, "0")}${String(parts.second).padStart(2, "0")}`;
}
function property(lines: string[], name: string): { params: Record<string, string>; value: string } | null {
  const line = lines.find((item) => item.toUpperCase().startsWith(`${name.toUpperCase()}:`) || item.toUpperCase().startsWith(`${name.toUpperCase()};`));
  if (!line) return null;
  const colon = line.indexOf(":");
  const left = line.slice(0, colon).split(";");
  const params: Record<string, string> = {};
  for (const part of left.slice(1)) { const [key, value] = part.split("=", 2); if (key && value) params[key.toUpperCase()] = value; }
  return { params, value: unescape(line.slice(colon + 1)) };
}

function parseIcs(content: string, path: string): CalendarEvent[] {
  const lines = content.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
  const events: CalendarEvent[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].toUpperCase() !== "BEGIN:VEVENT") continue;
    const body: string[] = [];
    for (index += 1; index < lines.length && lines[index].toUpperCase() !== "END:VEVENT"; index += 1) body.push(lines[index]);
    const uid = property(body, "UID")?.value;
    const summary = property(body, "SUMMARY")?.value;
    const start = property(body, "DTSTART");
    const end = property(body, "DTEND");
    if (!uid || !summary || !start || !end) throw new Error(`ICS 事件缺少 UID、SUMMARY、DTSTART 或 DTEND：${path}`);
    const timeZone = start.params.TZID ?? "UTC";
    const event = validateCalendarEvent({
      id: uid, title: summary, startAt: parseDateValue(start.value, timeZone), endAt: parseDateValue(end.value, timeZone), timeZone,
      rrule: property(body, "RRULE")?.value ?? "", reminderMinutes: [...body.join("\n").matchAll(/TRIGGER:-PT(\d+)M/gi)].map((match) => Number(match[1])), taskId: property(body, "X-BT-TASK-ID")?.value ?? "", status: "scheduled",
      notes: property(body, "DESCRIPTION")?.value ?? "", providerLinks: { ics: path }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    events.push(event);
  }
  return events;
}

function serializeIcs(events: CalendarEvent[]): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//BT-Agent//Personal Harness//EN"];
  for (const event of events) {
    const hasZone = event.timeZone !== "UTC";
    lines.push("BEGIN:VEVENT", `UID:${escape(event.id)}`, `SUMMARY:${escape(event.title)}`);
    lines.push(hasZone ? `DTSTART;TZID=${event.timeZone}:${formatDateValue(event.startAt, event.timeZone)}` : `DTSTART:${formatDateValue(event.startAt, "UTC")}Z`);
    lines.push(hasZone ? `DTEND;TZID=${event.timeZone}:${formatDateValue(event.endAt, event.timeZone)}` : `DTEND:${formatDateValue(event.endAt, "UTC")}Z`);
    if (event.rrule) lines.push(`RRULE:${event.rrule}`);
    for (const minutes of event.reminderMinutes) lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `TRIGGER:-PT${minutes}M`, `DESCRIPTION:${escape(event.title)}`, "END:VALARM");
    if (event.notes) lines.push(`DESCRIPTION:${escape(event.notes)}`);
    if (event.taskId) lines.push(`X-BT-TASK-ID:${escape(event.taskId)}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR", "");
  return lines.join("\r\n");
}

function item(filePath: string, events: CalendarEvent[]): IcsCalendarItem {
  const content = serializeIcs(events);
  const version = createHash("sha256").update(content).digest("hex");
  return { id: "calendar", title: "ICS Calendar", version, updatedAt: new Date().toISOString(), content: events, metadata: { contentHash: version, eventCount: events.length, path: filePath } };
}

export function createIcsConnector(filePath: string): Connector<IcsCalendarItem> {
  const target = resolve(filePath);
  const read = (): IcsCalendarItem => {
    const content = existsSync(target) ? readFileSync(target, "utf8") : "";
    return item(target, content ? parseIcs(content, target) : []);
  };
  const write = (events: CalendarEvent[]): IcsCalendarItem => {
    mkdirSync(dirname(target), { recursive: true });
    writePrivateFileAtomicSync(target, serializeIcs(events));
    return item(target, events);
  };
  return {
    id: "ics",
    version: "1.0.0",
    capabilities: ["read", "create", "update", "delete", "sync"],
    async healthCheck() { return { ok: true, ...(existsSync(target) ? {} : { message: "ICS 文件尚未创建" }) }; },
    async read(id: string) { if (id !== "calendar") throw new Error("ICS Connector 只支持 calendar 资源"); return read(); },
    async create(value: IcsCalendarItem) { return write(value.content.map(validateCalendarEvent)); },
    async update(_id: string, value: Partial<IcsCalendarItem>) { return write((value.content ?? read().content).map(validateCalendarEvent)); },
    async delete(id: string) { if (id !== "calendar") throw new Error("ICS Connector 只支持 calendar 资源"); write([]); },
    async sync() { const current = read(); return { cursor: current.version, items: [current] }; },
  };
}
