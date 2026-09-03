import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ConnectorHubOptions } from './hub';
import { ConnectorHub } from './hub';
import type { Connector } from './types';
import { SecretStore } from '../mcp';
import type { Signal, SignalSource } from '../../shared/signals';

const DAY_MS = 24 * 60 * 60_000;

// ConnectorHub reaches for app.getPath('userData') to place its sqlite file, so the module is
// mocked here rather than pulling in real Electron for a unit test. vi.mock calls are hoisted
// above these imports by the test runner, so this only needs to run before the mock is used.
let userDataDir = '';
vi.mock('electron', () => ({
  app: { getPath: () => userDataDir },
}));

function taskSig(id: string, dueAt: number, overrides: Partial<Signal> = {}): Signal {
  return {
    id: `clickup:${id}`,
    source: 'clickup',
    kind: 'task-due',
    title: `Task ${id}`,
    dueAt,
    url: `https://app.clickup.com/t/${id}`,
    status: 'to do',
    listName: 'Inbox',
    ...overrides,
  };
}

function meetingSig(id: string, dueAt: number, overrides: Partial<Signal> = {}): Signal {
  return {
    id: `calendar:${id}`,
    source: 'calendar',
    kind: 'meeting',
    title: `Meeting ${id}`,
    dueAt,
    url: `https://outlook.office.com/calendar/item/${id}`,
    status: 'confirmed',
    listName: 'Calendar',
    meeting: {
      endsAt: dueAt + 30 * 60_000,
      accepted: true,
      allDay: false,
      organizer: 'boss@example.com',
      busy: true,
    },
    ...overrides,
  };
}

function fakeConnector(source: SignalSource, overrides: Partial<Connector> = {}): Connector {
  return {
    source,
    hasCredentials: () => true,
    connect: () => Promise.resolve(),
    disconnect: () => Promise.resolve(),
    fetch: () => Promise.resolve([]),
    close: () => Promise.resolve(),
    ...overrides,
  };
}

function fakeSecrets(): SecretStore {
  return new SecretStore(
    {
      isEncryptionAvailable: () => true,
      encryptString: (plain: string) => Buffer.from(plain, 'utf8'),
      decryptString: (encrypted: Buffer) => encrypted.toString('utf8'),
    },
    mkdtempSync(join(tmpdir(), 'wisp-secrets-')),
  );
}

function makeHub(
  connectors: Connector[],
  overrides: Partial<ConnectorHubOptions> = {},
): ConnectorHub {
  return new ConnectorHub({
    connectors,
    secrets: fakeSecrets(),
    pollMinutes: () => 5,
    dueSoonMinutes: () => 30,
    meetingWarnMs: () => 15 * 60_000,
    budget: () => ({ maxPerHour: 10, maxPerDay: 10 }),
    silence: () => [],
    silenceStatus: () => ({}),
    onStatus: vi.fn(),
    onNudges: vi.fn(),
    onMood: vi.fn(),
    onCelebration: vi.fn(),
    openExternal: vi.fn(),
    onDay: vi.fn(),
    ...overrides,
  });
}

describe('ConnectorHub', () => {
  let hub: ConnectorHub | undefined;

  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'wisp-hub-'));
  });

  afterEach(() => {
    hub?.close();
    hub = undefined;
    rmSync(userDataDir, { recursive: true, force: true });
  });

  it('completes a task through its connector and marks it closed in the store', async () => {
    const now = Date.now();
    const task = taskSig('a', now + 60 * 60_000);
    const complete = vi.fn(() => Promise.resolve());
    const clickup = fakeConnector('clickup', { fetch: () => Promise.resolve([task]), complete });
    hub = makeHub([clickup]);
    hub.start();
    await hub.syncNow();
    expect(hub.signals().map((s) => s.id)).toContain('clickup:a');

    await hub.runAction('clickup:a', 'complete', now);

    expect(complete).toHaveBeenCalledWith('clickup:a');
    expect(hub.signals().map((s) => s.id)).not.toContain('clickup:a');
  });

  it('throws when completing a signal whose source cannot write', async () => {
    const now = Date.now();
    const meeting = meetingSig('a', now + 60 * 60_000);
    const outlook = fakeConnector('calendar', { fetch: () => Promise.resolve([meeting]) });
    hub = makeHub([outlook]);
    hub.start();
    await hub.syncNow();

    await expect(hub.runAction('calendar:a', 'complete', now)).rejects.toThrow();
  });

  it('silences the next decision for a snoozed signal', async () => {
    const now = Date.now();
    const overdueTask = taskSig('a', now - 2 * 60_000);
    const clickup = fakeConnector('clickup', { fetch: () => Promise.resolve([overdueTask]) });
    hub = makeHub([clickup]);
    hub.start();
    await hub.syncNow();

    const before = hub.decide(now);
    expect(before.nudges.some((n) => n.signalId === 'clickup:a')).toBe(true);

    await hub.runAction('clickup:a', 'snooze', now);

    const after = hub.decide(now);
    expect(after.nudges.some((n) => n.signalId === 'clickup:a')).toBe(false);
  });

  it('passes the signal url to openExternal on open', async () => {
    const now = Date.now();
    const task = taskSig('a', now + 60 * 60_000);
    const clickup = fakeConnector('clickup', { fetch: () => Promise.resolve([task]) });
    const openExternal = vi.fn(() => Promise.resolve());
    hub = makeHub([clickup], { openExternal });
    hub.start();
    await hub.syncNow();

    await hub.runAction('clickup:a', 'open', now);

    expect(openExternal).toHaveBeenCalledWith(task.url);
  });

  it('throws when opening an unknown signal', async () => {
    hub = makeHub([fakeConnector('clickup')]);
    await expect(hub.runAction('clickup:missing', 'open', Date.now())).rejects.toThrow();
  });

  it('lists every open task, weeks out included, under its own group', async () => {
    const now = new Date(2026, 8, 2, 10, 0).getTime();
    const tasks = [
      taskSig('late', now - 3 * DAY_MS),
      taskSig('today', now + 4 * 60 * 60_000),
      taskSig('tomorrow', new Date(2026, 8, 3, 9, 0).getTime()),
      taskSig('week', new Date(2026, 8, 7, 9, 0).getTime()),
      taskSig('later', new Date(2026, 8, 24, 9, 0).getTime()),
    ];
    const clickup = fakeConnector('clickup', { fetch: () => Promise.resolve(tasks) });
    hub = makeHub([clickup]);
    hub.start();
    await hub.syncNow();

    const items = hub.day(now);
    expect(items.map((i) => i.signal.id)).toEqual([
      'clickup:late',
      'clickup:today',
      'clickup:tomorrow',
      'clickup:week',
      'clickup:later',
    ]);
    expect(items.map((i) => i.group)).toEqual(['late', 'today', 'tomorrow', 'week', 'later']);
  });

  it('leaves a meeting further out than tomorrow off the list', async () => {
    const now = new Date(2026, 8, 2, 10, 0).getTime();
    const soon = meetingSig('soon', new Date(2026, 8, 3, 9, 0).getTime());
    const far = meetingSig('far', new Date(2026, 8, 6, 9, 0).getTime());
    const calendar = fakeConnector('calendar', { fetch: () => Promise.resolve([soon, far]) });
    hub = makeHub([calendar]);
    hub.start();
    await hub.syncNow();

    expect(hub.day(now).map((i) => i.signal.id)).toEqual(['calendar:soon']);
  });
});
