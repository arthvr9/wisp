import { app } from 'electron';
import { join } from 'node:path';

import { flushCelebration, initialCelebration, noteCompleted } from '../brain/celebrate';
import type { CelebrationState } from '../brain/celebrate';
import { dayItems } from '../brain/day';
import {
  initialMood,
  moodBudget,
  moodModifiers,
  moodOf,
  recordEvents,
  stepMood,
} from '../brain/mood';
import type { MoodState } from '../brain/mood';
import { decideNudges } from '../brain/nudge';
import type { NudgeDecision } from '../brain/nudge';
import { DAY_MS, localDayStart } from '../brain/silence';
import type { SecretStore } from '../mcp';
import { NeedsAuthorizationError } from '../mcp';
import { nextDelayMs, Scheduler, SignalStore } from '../signals';
import type { Celebration, Mood, MoodEvent, MoodModifiers } from '../../shared/mood';
import type { Nudge, NudgeBudget, SilenceWindow } from '../../shared/nudges';
import { SIGNAL_SOURCES } from '../../shared/signals';
import type {
  ConnectionState,
  DayItem,
  Signal,
  SignalAction,
  SignalSource,
  SignalsStatus,
  SilenceStatus,
} from '../../shared/signals';
import type { Connector } from './types';

// Six days past today is the last one whose weekday name is still unambiguous, so it is where
// the panel stops saying "Friday" and starts saying a date.
const WEEK_DAYS = 6;

// Each boundary is read from the offset of its own day rather than from today's, so a week
// that contains a clock change still ends on local midnight instead of drifting an hour.
function endOfLocalDay(nowMs: number, daysAhead: number): number {
  const around = nowMs + daysAhead * DAY_MS;
  return localDayStart(around, new Date(around).getTimezoneOffset()) + DAY_MS;
}

// One hour of quiet is long enough to be worth a dedicated action, short enough that a
// snoozed item is back the same day rather than forgotten.
const SNOOZE_MS = 60 * 60_000;

export interface ConnectorHubOptions {
  connectors: Connector[];
  secrets: SecretStore;
  pollMinutes: () => number;
  dueSoonMinutes: () => number;
  meetingWarnMs: () => number;
  budget: () => NudgeBudget;
  silence: (nowMs: number) => SilenceWindow[];
  extraSilence?: (signals: readonly Signal[]) => SilenceWindow[];
  silenceStatus: (nowMs: number) => SilenceStatus;
  onStatus: (status: SignalsStatus) => void;
  onNudges: (nudges: Nudge[]) => void;
  onMood: (mood: Mood) => void;
  onCelebration: (celebration: Celebration) => void;
  openExternal: (url: string) => Promise<void> | void;
  /** Fired whenever the day list can have changed: after a sync, and after any action. */
  onDay: (items: DayItem[]) => void;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function disconnectedStates(): Record<SignalSource, ConnectionState> {
  const entries = SIGNAL_SOURCES.map((source) => [source, { state: 'disconnected' as const }]);
  return Object.fromEntries(entries) as Record<SignalSource, ConnectionState>;
}

function zeroGenerations(): Record<SignalSource, number> {
  const entries = SIGNAL_SOURCES.map((source) => [source, 0]);
  return Object.fromEntries(entries) as Record<SignalSource, number>;
}

export class ConnectorHub {
  private readonly store: SignalStore;
  private readonly scheduler: Scheduler;
  private readonly state: Record<SignalSource, ConnectionState> = disconnectedStates();
  private readonly generation: Record<SignalSource, number> = zeroGenerations();
  private readonly failures: Record<string, number> = {};
  private readonly retryAt: Record<string, number> = {};
  private readonly lastSyncAt: Partial<Record<SignalSource, number>> = {};
  private readonly active = new Set<SignalSource>();
  private mood: MoodState = initialMood;
  private celebration: CelebrationState = initialCelebration;
  private lastQuietHourAt: number | undefined;

  constructor(private readonly opts: ConnectorHubOptions) {
    const userData = app.getPath('userData');
    this.store = new SignalStore(join(userData, 'signals.sqlite'));
    this.scheduler = new Scheduler({
      baseMs: () => opts.pollMinutes() * 60_000,
      run: () => this.sync(),
      onSchedule: () => {
        this.publish();
      },
    });
  }

  start(): void {
    for (const connector of this.opts.connectors) {
      if (!connector.hasCredentials()) continue;
      this.active.add(connector.source);
      this.state[connector.source] = {
        state: 'connected',
        signalCount: this.store.list(connector.source).length,
      };
    }
    if (this.active.size > 0) this.scheduler.start();
    this.publish();
  }

  status(): SignalsStatus {
    return {
      connectors: { ...this.state },
      active: [...this.active],
      nextSyncAt: this.scheduler.nextAt(),
      silence: this.opts.silenceStatus(Date.now()),
      secretsEncrypted: this.opts.secrets.encryptionAvailable(),
    };
  }

  signals(): Signal[] {
    return this.store.list();
  }

  day(nowMs: number): DayItem[] {
    return dayItems(this.store.list(), {
      nowMs,
      endOfDayMs: endOfLocalDay(nowMs, 0),
      endOfTomorrowMs: endOfLocalDay(nowMs, 1),
      endOfWeekMs: endOfLocalDay(nowMs, WEEK_DAYS),
      snoozedUntil: (signalId) => this.store.snoozedUntil(signalId, nowMs),
      canComplete: (source) => this.canComplete(source),
    });
  }

  async runAction(signalId: string, action: SignalAction, nowMs: number): Promise<void> {
    switch (action) {
      case 'open':
        await this.runOpen(signalId);
        break;
      case 'snooze':
        this.store.snooze(signalId, nowMs + SNOOZE_MS);
        break;
      case 'complete':
        await this.runComplete(signalId, nowMs);
        break;
    }
    this.opts.onDay(this.day(nowMs));
  }

  async connect(source: SignalSource): Promise<SignalsStatus> {
    const connector = this.connectorFor(source);
    this.state[source] = { state: 'authorizing' };
    this.publish();
    try {
      await connector.connect();
      this.active.add(source);
      this.state[source] = { state: 'connected', signalCount: 0 };
      this.publish();
      // start() runs one cycle itself, so calling runNow() first would sync twice.
      this.scheduler.start();
    } catch (err) {
      this.state[source] = { state: 'error', message: messageOf(err) };
      this.publish();
    }
    return this.status();
  }

  async disconnect(source: SignalSource): Promise<SignalsStatus> {
    const connector = this.connectorFor(source);
    // Anything already in flight belongs to the previous generation and must not write back.
    this.generation[source] += 1;
    this.active.delete(source);
    await connector.disconnect();
    this.store.replaceAll(source, [], Date.now());
    this.state[source] = { state: 'disconnected' };
    if (this.active.size === 0) this.scheduler.stop();
    this.publish();
    return this.status();
  }

  async syncNow(): Promise<SignalsStatus> {
    await this.scheduler.runNow();
    return this.status();
  }

  // Called from main every half minute: cache and history only, no network.
  decide(nowMs: number): NudgeDecision {
    this.tickMood(nowMs);
    const signals = this.store.list();
    // A snoozed signal is filtered out of the candidates entirely, so every rule stops firing
    // on it for the duration rather than one rule at a time being silenced.
    const candidates = signals.filter((s) => this.store.snoozedUntil(s.id, nowMs) === undefined);
    const extraSilence = this.opts.extraSilence ?? (() => []);
    const decision = decideNudges({
      signals: candidates,
      nowMs,
      history: this.store.nudgeHistory(nowMs),
      silence: [...this.opts.silence(nowMs), ...extraSilence(signals)],
      budget: moodBudget(this.currentMood(), this.opts.budget()),
      dueSoonMs: this.opts.dueSoonMinutes() * 60_000,
      meetingWarnMs: this.opts.meetingWarnMs(),
    });
    const freshOverdue = decision.nudges.filter((n) => n.kind === 'overdue' && n.repeat === 0);
    if (freshOverdue.length > 0) {
      this.pushMoodEvents(
        freshOverdue.map(() => ({ kind: 'overdue-new', at: nowMs })),
        nowMs,
      );
    }
    return decision;
  }

  recordShown(nudge: Nudge, nowMs: number): void {
    this.store.recordNudge({ signalId: nudge.signalId, kind: nudge.kind, at: nowMs });
    this.pushMoodEvents([{ kind: 'nudge-shown', at: nowMs }], nowMs);
  }

  currentMood(): Mood {
    return moodOf(this.mood);
  }

  modifiers(): MoodModifiers {
    return moodModifiers(this.currentMood());
  }

  private tickMood(nowMs: number): void {
    // One quiet-hour event per hour without a fresh overdue keeps the ladder drifting up. The
    // first tick after a start only seeds the clock, so a restart cannot earn a free hour.
    this.lastQuietHourAt ??= nowMs;
    if (nowMs - this.lastQuietHourAt >= 60 * 60_000) {
      this.lastQuietHourAt = nowMs;
      if (!this.mood.events.some((e) => e.kind === 'overdue-new' && e.at > nowMs - 60 * 60_000)) {
        this.mood = recordEvents(this.mood, [{ kind: 'quiet-hour', at: nowMs }]);
      }
    }
    this.advanceMood(nowMs);
    this.pollCelebration(nowMs);
  }

  pollCelebration(nowMs: number): void {
    const flushed = flushCelebration(this.celebration, nowMs);
    this.celebration = flushed.state;
    if (flushed.celebration) this.opts.onCelebration(flushed.celebration);
  }

  private pushMoodEvents(events: MoodEvent[], nowMs: number): void {
    this.mood = recordEvents(this.mood, events);
    this.advanceMood(nowMs);
  }

  private advanceMood(nowMs: number): void {
    const before = moodOf(this.mood);
    this.mood = stepMood(this.mood, nowMs);
    const after = moodOf(this.mood);
    if (after !== before) this.opts.onMood(after);
  }

  close(): void {
    this.scheduler.stop();
    for (const connector of this.opts.connectors) void connector.close();
    this.store.close();
  }

  private connectorFor(source: SignalSource): Connector {
    const connector = this.opts.connectors.find((c) => c.source === source);
    if (connector === undefined) throw new Error(`no connector registered for ${source}`);
    return connector;
  }

  private canComplete(source: SignalSource): boolean {
    return this.opts.connectors.some((c) => c.source === source && c.complete !== undefined);
  }

  private findSignal(signalId: string): Signal | undefined {
    return this.store.list().find((s) => s.id === signalId);
  }

  private async runOpen(signalId: string): Promise<void> {
    const signal = this.findSignal(signalId);
    if (signal === undefined) throw new Error(`unknown signal: ${signalId}`);
    if (signal.url.trim() === '') throw new Error(`signal ${signalId} has no url to open`);
    await this.opts.openExternal(signal.url);
  }

  private async runComplete(signalId: string, nowMs: number): Promise<void> {
    const signal = this.findSignal(signalId);
    if (signal === undefined) throw new Error(`unknown signal: ${signalId}`);
    const connector = this.opts.connectors.find((c) => c.source === signal.source);
    if (connector?.complete === undefined) {
      throw new Error(`${signal.source} does not support marking items complete`);
    }
    await connector.complete(signalId);
    this.store.markClosed(signalId, nowMs);
    // Mirrors what a completion discovered by the next sync does, so the mascot celebrates
    // the same way whether the user finished the task here or in the source app.
    this.celebration = noteCompleted(this.celebration, [{ title: signal.title, at: nowMs }]);
    this.pushMoodEvents(
      [{ kind: nowMs > signal.dueAt ? 'task-done-late' : 'task-done', at: nowMs }],
      nowMs,
    );
  }

  private async sync(): Promise<void> {
    const now = Date.now();
    const completed: { title: string; at: number }[] = [];
    const moodEvents: MoodEvent[] = [];

    for (const connector of this.opts.connectors) {
      const source = connector.source;
      if (!this.active.has(source)) continue;
      // Backoff is per source, so one failing connector cannot slow the polling of the others.
      if (now < (this.retryAt[source] ?? 0)) continue;
      const generation = this.generation[source];
      const stale = () => generation !== this.generation[source];
      try {
        const signals = await connector.fetch(now);
        if (stale()) continue;
        const diff = this.store.replaceAll(source, signals, now);
        // Completions only make sense for tasks, so a finished meeting is not a celebration.
        const finishedTasks = diff.completed.filter((s) => s.kind === 'task-due');
        for (const task of finishedTasks) {
          completed.push({ title: task.title, at: now });
          moodEvents.push({
            kind: (task.closedAt ?? now) > task.dueAt ? 'task-done-late' : 'task-done',
            at: now,
          });
        }
        this.lastSyncAt[source] = now;
        const openCount = signals.filter((sig) => sig.closedAt === undefined).length;
        this.state[source] = { state: 'connected', lastSyncAt: now, signalCount: openCount };
        this.failures[source] = 0;
        this.retryAt[source] = 0;
      } catch (err) {
        if (stale()) continue;
        this.failures[source] = (this.failures[source] ?? 0) + 1;
        this.retryAt[source] =
          now +
          nextDelayMs({
            baseMs: this.opts.pollMinutes() * 60_000,
            failures: this.failures[source],
            rng: Math.random,
          });
        if (err instanceof NeedsAuthorizationError) {
          this.state[source] = { state: 'error', message: 'authorization expired, connect again' };
        } else {
          this.state[source] = {
            state: 'error',
            message: messageOf(err),
            lastSyncAt: this.lastSyncAt[source],
          };
        }
      }
    }

    if (completed.length > 0) this.celebration = noteCompleted(this.celebration, completed);
    if (moodEvents.length > 0) this.pushMoodEvents(moodEvents, now);
    this.publish();
    this.opts.onNudges(this.decide(now).nudges);
    this.opts.onDay(this.day(now));
  }

  publishStatus(): void {
    this.opts.onStatus(this.status());
  }

  private publish(): void {
    this.publishStatus();
  }
}
