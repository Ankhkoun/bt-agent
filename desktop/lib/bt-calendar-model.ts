export const CALENDAR_STATUSES = ["scheduled", "completed", "cancelled"] as const;
export type CalendarStatus = typeof CALENDAR_STATUSES[number];

export interface CalendarEvent {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
  timeZone: string;
  rrule: string;
  taskId: string;
  status: CalendarStatus;
  notes: string;
  providerLinks: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export interface CalendarBook { revision: number; events: CalendarEvent[] }

export interface CalendarOccurrence {
  eventId: string;
  index: number;
  startAt: string;
  endAt: string;
}

const TIME_ZONE_CACHE = new Map<string, boolean>();

export function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim() || value.length > 120) return false;
  const timeZone = value.trim();
  const cached = TIME_ZONE_CACHE.get(timeZone);
  if (cached !== undefined) return cached;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format();
    TIME_ZONE_CACHE.set(timeZone, true);
    return true;
  } catch {
    TIME_ZONE_CACHE.set(timeZone, false);
    return false;
  }
}

function parseDate(value: unknown): number {
  if (typeof value !== "string" || !value.trim()) return Number.NaN;
  return Date.parse(value);
}

export interface ParsedRRule {
  freq: "DAILY" | "WEEKLY" | "MONTHLY";
  interval: number;
  count?: number;
  until?: number;
  byDay?: number[];
  byMonthDay?: number;
}

const DAY_BY_NAME: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

export function parseRRule(value: string): ParsedRRule | null {
  if (!value.trim()) return null;
  const fields = new Map<string, string>();
  for (const part of value.trim().toUpperCase().split(";")) {
    const [key, raw] = part.split("=", 2);
    if (!key || !raw || fields.has(key)) throw new Error("RRULE 字段无效或重复");
    fields.set(key, raw);
  }
  const freq = fields.get("FREQ");
  if (freq !== "DAILY" && freq !== "WEEKLY" && freq !== "MONTHLY") throw new Error("仅支持 DAILY、WEEKLY、MONTHLY RRULE");
  const interval = fields.has("INTERVAL") ? Number(fields.get("INTERVAL")) : 1;
  if (!Number.isSafeInteger(interval) || interval < 1 || interval > 366) throw new Error("RRULE INTERVAL 必须是 1–366 的整数");
  const count = fields.has("COUNT") ? Number(fields.get("COUNT")) : undefined;
  if (count !== undefined && (!Number.isSafeInteger(count) || count < 1 || count > 10000)) throw new Error("RRULE COUNT 必须是 1–10000 的整数");
  const until = fields.has("UNTIL") ? parseRRuleUntil(fields.get("UNTIL") ?? "") : undefined;
  if (until !== undefined && Number.isNaN(until)) throw new Error("RRULE UNTIL 无效");
  const byDay = fields.has("BYDAY") ? fields.get("BYDAY")?.split(",").map((item) => DAY_BY_NAME[item]).filter((item) => item !== undefined) : undefined;
  if (fields.has("BYDAY") && (!byDay?.length || byDay.length !== fields.get("BYDAY")?.split(",").length)) throw new Error("RRULE BYDAY 无效");
  const byMonthDay = fields.has("BYMONTHDAY") ? Number(fields.get("BYMONTHDAY")) : undefined;
  if (byMonthDay !== undefined && (!Number.isSafeInteger(byMonthDay) || byMonthDay < 1 || byMonthDay > 31)) throw new Error("RRULE BYMONTHDAY 必须是 1–31 的整数");
  const supported = new Set(["FREQ", "INTERVAL", "COUNT", "UNTIL", "BYDAY", "BYMONTHDAY"]);
  if ([...fields.keys()].some((key) => !supported.has(key))) throw new Error("RRULE 包含未支持的字段");
  if (freq === "DAILY" && (byDay || byMonthDay)) throw new Error("DAILY 当前不支持 BYDAY 或 BYMONTHDAY");
  if (freq === "WEEKLY" && byMonthDay) throw new Error("WEEKLY 不支持 BYMONTHDAY");
  if (freq === "MONTHLY" && byDay) throw new Error("MONTHLY 当前不支持 BYDAY");
  return { freq, interval, ...(count === undefined ? {} : { count }), ...(until === undefined ? {} : { until }), ...(byDay ? { byDay } : {}), ...(byMonthDay === undefined ? {} : { byMonthDay }) };
}

function parseRRuleUntil(value: string): number {
  if (/^\d{8}$/.test(value)) return Date.parse(`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T23:59:59.999Z`);
  if (/^\d{8}T\d{6}Z$/.test(value)) return Date.parse(`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(9, 11)}:${value.slice(11, 13)}:${value.slice(13, 15)}Z`);
  return parseDate(value);
}

export function validateCalendarEvent(value: unknown): CalendarEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("日程格式无效");
  const item = value as Partial<CalendarEvent>;
  if (typeof item.id !== "string" || !item.id.trim() || item.id.length > 120) throw new Error("日程 ID 无效");
  if (typeof item.title !== "string" || !item.title.trim() || item.title.length > 240) throw new Error("日程标题需要 1–240 个字符");
  if (Number.isNaN(parseDate(item.startAt)) || Number.isNaN(parseDate(item.endAt)) || parseDate(item.endAt) <= parseDate(item.startAt)) throw new Error("日程开始和结束时间无效");
  if (!isValidTimeZone(item.timeZone)) throw new Error("日程时区无效");
  if (typeof item.rrule !== "string" || item.rrule.length > 1000) throw new Error("RRULE 无效");
  parseRRule(item.rrule);
  if (typeof item.taskId !== "string" || item.taskId.length > 120 || typeof item.notes !== "string" || item.notes.length > 20000) throw new Error("日程关联或备注无效");
  if (!CALENDAR_STATUSES.includes(item.status as CalendarStatus)) throw new Error("日程状态无效");
  const providerLinks = item.providerLinks && typeof item.providerLinks === "object" && !Array.isArray(item.providerLinks) ? item.providerLinks as Record<string, unknown> : {};
  const links: Record<string, string> = {};
  for (const [key, link] of Object.entries(providerLinks)) {
    if (!key || key.length > 80 || typeof link !== "string" || link.length > 500) throw new Error("外部日程链接无效");
    links[key] = link;
  }
  if (typeof item.createdAt !== "string" || typeof item.updatedAt !== "string") throw new Error("日程时间戳无效");
  return {
    id: item.id.trim(), title: item.title.trim(), startAt: item.startAt as string, endAt: item.endAt as string,
    timeZone: item.timeZone as string, rrule: item.rrule, taskId: item.taskId, status: item.status as CalendarStatus,
    notes: item.notes, providerLinks: links, createdAt: item.createdAt, updatedAt: item.updatedAt,
  };
}

function localParts(instant: number, timeZone: string): { year: number; month: number; day: number; hour: number; minute: number; second: number; millisecond: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(instant));
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute"), second: get("second"), millisecond: new Date(instant).getUTCMilliseconds() };
}

function sameLocal(a: ReturnType<typeof localParts>, b: ReturnType<typeof localParts>): boolean {
  return a.year === b.year && a.month === b.month && a.day === b.day && a.hour === b.hour && a.minute === b.minute && a.second === b.second;
}

function localToInstant(parts: ReturnType<typeof localParts>, timeZone: string): number {
  const target = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second, parts.millisecond);
  const candidates = new Set<number>();
  for (const delta of [-48, -36, -24, -12, 0, 12, 24, 36, 48]) {
    const guess = target + delta * 60 * 60 * 1000;
    const observed = localParts(guess, timeZone);
    const offset = Date.UTC(observed.year, observed.month - 1, observed.day, observed.hour, observed.minute, observed.second, observed.millisecond) - guess;
    candidates.add(target - offset);
  }
  const valid = [...candidates].filter((candidate) => sameLocal(localParts(candidate, timeZone), parts));
  if (!valid.length) throw new Error("日程时间落在时区的无效夏令时区间");
  return Math.min(...valid);
}

function addDays(parts: ReturnType<typeof localParts>, days: number): ReturnType<typeof localParts> {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days, parts.hour, parts.minute, parts.second, parts.millisecond));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(), hour: parts.hour, minute: parts.minute, second: parts.second, millisecond: parts.millisecond };
}

function addMonths(parts: ReturnType<typeof localParts>, months: number): ReturnType<typeof localParts> {
  const date = new Date(Date.UTC(parts.year, parts.month - 1 + months, 1, parts.hour, parts.minute, parts.second, parts.millisecond));
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: Math.min(parts.day, lastDay), hour: parts.hour, minute: parts.minute, second: parts.second, millisecond: parts.millisecond };
}

function dayOfWeek(parts: ReturnType<typeof localParts>): number { return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay(); }

export function expandOccurrences(event: CalendarEvent, rangeStart: string, rangeEnd: string): CalendarOccurrence[] {
  const from = parseDate(rangeStart);
  const to = parseDate(rangeEnd);
  if (Number.isNaN(from) || Number.isNaN(to) || to <= from) throw new Error("日程展开范围无效");
  const start = parseDate(event.startAt);
  const end = parseDate(event.endAt);
  const duration = end - start;
  const rule = parseRRule(event.rrule);
  const first = localParts(start, event.timeZone);
  const output: CalendarOccurrence[] = [];
  let generated = 0;
  let period = 0;
  const limit = Math.min(rule?.count ?? 10000, 10000);
  while (generated < limit && period < 10000) {
    const candidates: ReturnType<typeof localParts>[] = [];
    if (!rule) candidates.push(first);
    else if (rule.freq === "DAILY") candidates.push(addDays(first, period * rule.interval));
    else if (rule.freq === "MONTHLY") {
      const candidate = addMonths(first, period * rule.interval);
      if (!rule.byMonthDay || rule.byMonthDay === candidate.day) candidates.push(rule.byMonthDay ? { ...candidate, day: rule.byMonthDay } : candidate);
    } else {
      const weekStart = addDays(first, period * rule.interval * 7);
      const days = rule.byDay?.length ? rule.byDay : [dayOfWeek(first)];
      for (const weekday of days) {
        const offset = (weekday - dayOfWeek(weekStart) + 7) % 7;
        const candidate = addDays(weekStart, offset);
        if (period > 0 || candidate.day >= first.day || candidate.month !== first.month) candidates.push(candidate);
      }
      candidates.sort((a, b) => localToInstant(a, event.timeZone) - localToInstant(b, event.timeZone));
    }
    for (const candidate of candidates) {
      const occurrenceStart = localToInstant(candidate, event.timeZone);
      if (occurrenceStart < start) continue;
      if (rule?.until !== undefined && occurrenceStart > rule.until) return output;
      generated += 1;
      if (occurrenceStart < to && occurrenceStart + duration > from) output.push({ eventId: event.id, index: generated - 1, startAt: new Date(occurrenceStart).toISOString(), endAt: new Date(occurrenceStart + duration).toISOString() });
      if (occurrenceStart >= to) return output;
    }
    if (!rule) break;
    period += 1;
  }
  return output;
}

export function findCalendarConflicts(events: CalendarEvent[], rangeStart: string, rangeEnd: string): Array<{ first: CalendarOccurrence; second: CalendarOccurrence }> {
  const occurrences = events.flatMap((event) => expandOccurrences(event, rangeStart, rangeEnd));
  const conflicts: Array<{ first: CalendarOccurrence; second: CalendarOccurrence }> = [];
  for (let i = 0; i < occurrences.length; i += 1) for (let j = i + 1; j < occurrences.length; j += 1) {
    const first = occurrences[i]; const second = occurrences[j];
    if (first.eventId === second.eventId) continue;
    if (Date.parse(first.startAt) < Date.parse(second.endAt) && Date.parse(second.startAt) < Date.parse(first.endAt)) conflicts.push({ first, second });
  }
  return conflicts;
}
