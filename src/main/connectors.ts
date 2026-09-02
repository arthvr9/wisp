import { app, safeStorage, shell } from 'electron';
import { join } from 'node:path';

import { flushCelebration, initialCelebration, noteCompleted } from './brain/celebrate';
import type { CelebrationState } from './brain/celebrate';
import {
  initialMood,
  moodBudget,
  moodModifiers,
  moodOf,
  recordEvents,
  stepMood,
} from './brain/mood';
import type { MoodState } from './brain/mood';
import { decideNudges } from './brain/nudge';
import type { NudgeDecision } from './brain/nudge';
import { LoopbackOAuthProvider, McpHost, NeedsAuthorizationError, SecretStore } from './mcp';
import { fetchClickUpSignals, Scheduler, SignalStore } from './signals';
import type { Celebration, Mood, MoodEvent, MoodModifiers } from '../shared/mood';
import type { Nudge, NudgeBudget, SilenceWindow } from '../shared/nudges';
import type { ConnectionState, Signal, SignalsStatus, SilenceStatus } from '../shared/signals';

const CLICKUP_URL = 'https://mcp.clickup.com/mcp';
const HORIZON_DAYS = 14;

export interface ConnectorOptions {
  pollMinutes: () => number;
  dueSoonMinutes: () => number;
  budget: () => NudgeBudget;
  silence: (nowMs: number) => SilenceWindow[];
  silenceStatus: (nowMs: number) => SilenceStatus;
  onStatus: (status: SignalsStatus) => void;
  onNudges: (nudges: Nudge[]) => void;
  onMood: (mood: Mood) => void;
  onCelebration: (celebration: Celebration) => void;
}

export class Connectors {
  private readonly store: SignalStore;
  private readonly secrets: SecretStore;
  private readonly provider: LoopbackOAuthProvider;
  private readonly host: McpHost;
  private readonly scheduler: Scheduler;
  private clickup: ConnectionState = { state: 'disconnected' };
  private lastSyncAt: number | undefined;
  private mood: MoodState = initialMood;
  private celebration: CelebrationState = initialCelebration;
  private lastQuietHourAt = 0;

  constructor(private readonly opts: ConnectorOptions) {
    const userData = app.getPath('userData');
    this.store = new SignalStore(join(userData, 'signals.sqlite'));
    this.secrets = new SecretStore(safeStorage, join(userData, 'secrets'));
    this.provider = new LoopbackOAuthProvider({
      serverKey: 'clickup',
      secrets: this.secrets,
      openExternal: (url) => shell.openExternal(url),
      clientName: 'Wisp',
    });
    this.host = new McpHost({
      url: CLICKUP_URL,
      provider: this.provider,
      clientInfo: { name: 'wisp', version: app.getVersion() },
    });
    this.scheduler = new Scheduler({
      baseMs: () => opts.pollMinutes() * 60_000,
      run: () => this.sync(),
      onSchedule: () => {
        this.publish();
      },
    });
  }

  start(): void {
    if (this.provider.hasTokens()) {
      this.clickup = { state: 'connected', signalCount: this.store.list('clickup').length };
      this.scheduler.start();
    }
    this.publish();
  }

  status(): SignalsStatus {
    return {
      clickup: this.clickup,
      nextSyncAt: this.scheduler.nextAt(),
      silence: this.opts.silenceStatus(Date.now()),
    };
  }

  signals(): Signal[] {
    return this.store.list();
  }

  async connect(): Promise<SignalsStatus> {
    this.clickup = { state: 'authorizing' };
    this.publish();
    try {
      await this.host.authorize();
      this.clickup = { state: 'connected', signalCount: 0 };
      this.publish();
      await this.scheduler.runNow();
      this.scheduler.start();
    } catch (err) {
      this.clickup = { state: 'error', message: messageOf(err) };
      this.publish();
    }
    return this.status();
  }

  async disconnect(): Promise<SignalsStatus> {
    this.scheduler.stop();
    await this.host.close();
    this.provider.clear();
    this.store.replaceAll('clickup', [], Date.now());
    this.clickup = { state: 'disconnected' };
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
    if (this.clickup.state !== 'connected') return { nudges: [], silenced: [], overBudget: [] };
    const decision = decideNudges({
      signals: this.store.list('clickup'),
      nowMs,
      history: this.store.nudgeHistory(nowMs),
      silence: this.opts.silence(nowMs),
      budget: moodBudget(this.currentMood(), this.opts.budget()),
      dueSoonMs: this.opts.dueSoonMinutes() * 60_000,
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
    // One quiet-hour event per hour without a fresh overdue keeps the ladder drifting up.
    if (nowMs - this.lastQuietHourAt >= 60 * 60_000) {
      this.lastQuietHourAt = nowMs;
      if (!this.mood.events.some((e) => e.kind === 'overdue-new' && e.at > nowMs - 60 * 60_000)) {
        this.mood = recordEvents(this.mood, [{ kind: 'quiet-hour', at: nowMs }]);
      }
    }
    this.advanceMood(nowMs);
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
    void this.host.close();
    this.store.close();
  }

  private async sync(): Promise<void> {
    try {
      if (!this.host.isConnected()) await this.host.connect();
      const now = Date.now();
      const signals = await fetchClickUpSignals(this.host, {
        nowMs: now,
        horizonDays: HORIZON_DAYS,
      });
      const diff = this.store.replaceAll('clickup', signals, now);
      if (diff.completed.length > 0) {
        this.celebration = noteCompleted(
          this.celebration,
          diff.completed.map((c) => ({ title: c.title, at: now })),
        );
        this.pushMoodEvents(
          diff.completed.map((c) => ({
            kind: (c.closedAt ?? now) > c.dueAt ? 'task-done-late' : 'task-done',
            at: now,
          })),
          now,
        );
      }
      this.lastSyncAt = now;
      const openCount = signals.filter((sig) => sig.closedAt === undefined).length;
      this.clickup = { state: 'connected', lastSyncAt: now, signalCount: openCount };
      this.publish();
      this.opts.onNudges(this.decide(now).nudges);
    } catch (err) {
      if (err instanceof NeedsAuthorizationError) {
        this.clickup = { state: 'error', message: 'authorization expired, connect again' };
      } else {
        this.clickup = { state: 'error', message: messageOf(err), lastSyncAt: this.lastSyncAt };
      }
      this.publish();
      throw err;
    }
  }

  publishStatus(): void {
    this.opts.onStatus(this.status());
  }

  private publish(): void {
    this.publishStatus();
  }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
