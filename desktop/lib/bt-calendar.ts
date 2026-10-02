import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { btRoot } from "./bt-config";
import { writePrivateFileAtomicSync } from "./atomic-file";
import { type CalendarBook, type CalendarEvent, validateCalendarEvent } from "./bt-calendar-model";

export class CalendarConflict extends Error {}

function path(root: string): string { return join(root, ".bt", "calendar.json"); }

export function readCalendar(root = btRoot()): CalendarBook {
  const file = path(root);
  if (!existsSync(file)) return { revision: 0, events: [] };
  const value = JSON.parse(readFileSync(file, "utf8")) as Partial<CalendarBook>;
  const revision = value.revision;
  if (typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 0 || !Array.isArray(value.events)) throw new Error("日程文件格式无效，原文件已保留");
  return { revision, events: value.events.map(validateCalendarEvent) };
}

export function saveCalendarEvent(value: unknown, revision: unknown, root = btRoot()): CalendarBook {
  const event = validateCalendarEvent(value);
  const book = readCalendar(root);
  if (revision !== book.revision) throw new CalendarConflict("日程已在其他窗口更新，请刷新后重试；当前输入仍保留。");
  const index = book.events.findIndex((item) => item.id === event.id);
  if (index < 0) book.events.push(event); else book.events[index] = event;
  book.revision += 1;
  mkdirSync(join(root, ".bt"), { recursive: true });
  writePrivateFileAtomicSync(path(root), JSON.stringify(book, null, 2));
  return book;
}

export function deleteCalendarEvent(id: unknown, revision: unknown, root = btRoot()): CalendarBook {
  if (typeof id !== "string" || !id.trim() || id.length > 120) throw new Error("日程 ID 无效");
  const book = readCalendar(root);
  if (revision !== book.revision) throw new CalendarConflict("日程已在其他窗口更新，请刷新后重试；当前输入仍保留。");
  const index = book.events.findIndex((item) => item.id === id);
  if (index < 0) throw new Error("日程不存在或已被删除，请刷新后重试");
  book.events.splice(index, 1);
  book.revision += 1;
  mkdirSync(join(root, ".bt"), { recursive: true });
  writePrivateFileAtomicSync(path(root), JSON.stringify(book, null, 2));
  return book;
}

export function replaceCalendarEvents(values: unknown, revision: unknown, root = btRoot()): CalendarBook {
  if (!Array.isArray(values)) throw new Error("日程列表格式无效");
  const book = readCalendar(root);
  if (revision !== book.revision) throw new CalendarConflict("日程已在其他窗口更新，请刷新后重试；当前输入仍保留。");
  book.events = values.map(validateCalendarEvent);
  book.revision += 1;
  mkdirSync(join(root, ".bt"), { recursive: true });
  writePrivateFileAtomicSync(path(root), JSON.stringify(book, null, 2));
  return book;
}

export function newCalendarEvent(input: Partial<CalendarEvent>): CalendarEvent {
  const now = new Date().toISOString();
  return validateCalendarEvent({ id: randomUUID(), title: "", startAt: "", endAt: "", timeZone: "UTC", rrule: "", reminderMinutes: [], taskId: "", status: "scheduled", notes: "", providerLinks: {}, createdAt: now, updatedAt: now, ...input });
}
