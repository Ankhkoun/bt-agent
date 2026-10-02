import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createJiti } from '../node_modules/jiti/lib/jiti.mjs';

const jiti = createJiti(import.meta.url);
const { dueCalendarReminders } = await jiti.import('./bt-reminder.ts');

test('calendar reminders expand recurring events and deduplicate by occurrence and lead time', () => {
  const now = Date.parse('2026-10-05T00:00:00.000Z');
  const event = { id: 'event-1', title: '学习', startAt: '2026-10-05T00:05:00.000Z', endAt: '2026-10-05T01:00:00.000Z', timeZone: 'UTC', rrule: '', reminderMinutes: [5, 10], taskId: '', status: 'scheduled', notes: '', providerLinks: {}, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z' };
  const reminders = dueCalendarReminders([event], now, 10 * 60 * 1000);
  assert.deepEqual(reminders.map((item) => item.minutesBefore), [5, 10]);
  assert.equal(reminders[0].key, 'event-1:0:5');
});
