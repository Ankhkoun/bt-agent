import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJiti } from '../node_modules/jiti/lib/jiti.mjs';

const jiti = createJiti(import.meta.url);
const model = await jiti.import('./bt-calendar-model.ts');
const store = await jiti.import('./bt-calendar.ts');

function event(overrides = {}) {
  return {
    id: 'event-1', title: '学习', startAt: '2026-10-05T09:00:00+08:00', endAt: '2026-10-05T10:00:00+08:00', timeZone: 'Asia/Shanghai', rrule: '', taskId: '', status: 'scheduled', notes: '', providerLinks: {}, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', ...overrides,
  };
}

test('RRULE expands daily, weekly BYDAY and monthly occurrences in the event timezone', () => {
  assert.equal(model.expandOccurrences(event({ rrule: 'FREQ=DAILY;COUNT=3' }), '2026-10-05T00:00:00Z', '2026-10-10T00:00:00Z').length, 3);
  const weekly = model.expandOccurrences(event({ rrule: 'FREQ=WEEKLY;COUNT=4;BYDAY=MO,WE' }), '2026-10-05T00:00:00Z', '2026-10-20T00:00:00Z');
  assert.deepEqual(weekly.map((item) => item.startAt.slice(0, 10)), ['2026-10-05', '2026-10-07', '2026-10-12', '2026-10-14']);
  const monthly = model.expandOccurrences(event({ startAt: '2026-01-31T09:00:00+08:00', endAt: '2026-01-31T10:00:00+08:00', rrule: 'FREQ=MONTHLY;COUNT=3' }), '2026-01-01T00:00:00Z', '2026-05-01T00:00:00Z');
  assert.deepEqual(monthly.map((item) => item.startAt.slice(0, 10)), ['2026-01-31', '2026-02-28', '2026-03-31']);
});

test('calendar validation and conflict detection preserve timezone and reject stale writes', async () => {
  assert.throws(() => model.validateCalendarEvent(event({ timeZone: 'Not/AZone' })), /时区/);
  const second = event({ id: 'event-2', title: '面试', startAt: '2026-10-05T09:30:00+08:00', endAt: '2026-10-05T10:30:00+08:00' });
  assert.equal(model.findCalendarConflicts([event(), second], '2026-10-05T00:00:00Z', '2026-10-06T00:00:00Z').length, 1);
  const root = await mkdtemp(join(tmpdir(), 'bt-calendar-'));
  try {
    let book = store.saveCalendarEvent(event(), 0, root);
    assert.equal(book.revision, 1);
    await assert.rejects(() => readFile(join(root, '.bt', 'calendar.json'), 'utf8').then(() => store.saveCalendarEvent(second, 0, root)), /日程已在其他窗口更新/);
    book = store.deleteCalendarEvent('event-1', 1, root);
    assert.equal(book.revision, 2);
    assert.equal(book.events.length, 0);
    assert.throws(() => store.deleteCalendarEvent('event-1', 2, root), /日程不存在/);
    book = store.replaceCalendarEvents([second], 2, root);
    assert.equal(book.revision, 3);
    assert.equal(book.events[0].title, '面试');
    assert.throws(() => store.replaceCalendarEvents([], 2, root), /日程已在其他窗口更新/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
