import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJiti } from '../node_modules/jiti/lib/jiti.mjs';

const jiti = createJiti(import.meta.url);
const { createIcsConnector } = await jiti.import('./bt-ics-connector.ts');

test('ICS Connector round-trips timezone, RRULE, task link and sync cursor', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bt-ics-'));
  try {
    const connector = createIcsConnector(join(root, 'calendar.ics'));
    const event = { id: 'event-1', title: '学习', startAt: '2026-10-09T01:00:00.000Z', endAt: '2026-10-09T02:00:00.000Z', timeZone: 'Asia/Shanghai', rrule: 'FREQ=WEEKLY;BYDAY=FR', reminderMinutes: [15], taskId: 'task-1', status: 'scheduled', notes: '复盘', providerLinks: {}, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z' };
    await connector.create({ id: 'calendar', content: [event], title: 'ICS Calendar' });
    const raw = await readFile(join(root, 'calendar.ics'), 'utf8');
    assert.match(raw, /DTSTART;TZID=Asia\/Shanghai:20261009T090000/);
    assert.match(raw, /TRIGGER:-PT15M/);
    const read = await connector.read('calendar');
    assert.equal(read.content[0].timeZone, 'Asia/Shanghai');
    assert.equal(read.content[0].rrule, 'FREQ=WEEKLY;BYDAY=FR');
    assert.equal(read.content[0].taskId, 'task-1');
    assert.deepEqual(read.content[0].reminderMinutes, [15]);
    const sync = await connector.sync();
    assert.equal(sync.cursor, read.version);
    await connector.delete('calendar');
    assert.equal((await connector.read('calendar')).content.length, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});
