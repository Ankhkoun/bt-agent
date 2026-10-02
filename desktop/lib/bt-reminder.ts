import { expandOccurrences, type CalendarEvent } from "./bt-calendar-model";

export interface DueCalendarReminder {
  key: string;
  event: CalendarEvent;
  occurrenceStart: string;
  minutesBefore: number;
}

export function dueCalendarReminders(events: CalendarEvent[], now = Date.now(), lookbackMs = 90_000): DueCalendarReminder[] {
  const maximumLead = Math.max(0, ...events.flatMap((event) => event.reminderMinutes));
  const from = new Date(now - maximumLead * 60_000 - lookbackMs).toISOString();
  const to = new Date(now + maximumLead * 60_000 + lookbackMs).toISOString();
  const output: DueCalendarReminder[] = [];
  for (const event of events) {
    if (event.status !== "scheduled" || event.reminderMinutes.length === 0) continue;
    let occurrences;
    try { occurrences = expandOccurrences(event, from, to); }
    catch { continue; }
    for (const occurrence of occurrences) for (const minutesBefore of event.reminderMinutes) {
      const dueAt = Date.parse(occurrence.startAt) - minutesBefore * 60_000;
      if (dueAt <= now && dueAt > now - lookbackMs) output.push({ key: `${event.id}:${occurrence.index}:${minutesBefore}`, event, occurrenceStart: occurrence.startAt, minutesBefore });
    }
  }
  return output;
}
