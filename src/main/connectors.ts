import { app, safeStorage, shell } from 'electron';
import { join } from 'node:path';

import { decideNudges } from './brain/nudge';
import type { NudgeDecision } from './brain/nudge';
import { LoopbackOAuthProvider, McpHost, NeedsAuthorizationError, SecretStore } from './mcp';
import { fetchClickUpSignals, Scheduler, SignalStore } from './signals';
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
}

export class Connectors {
  private readonly store: SignalStore;
  private readonly secrets: SecretStore;
  private readonly provider: LoopbackOAuthProvider;
  private readonly host: McpHost;
  private readonly scheduler: Scheduler;
  private clickup: ConnectionState = { state: 'disconnected' };
  private lastSyncAt: number | undefined;

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
    if (this.clickup.state !== 'connected') return { nudges: [], silenced: [], overBudget: [] };
    return decideNudges({
      signals: this.store.list('clickup'),
      nowMs,
      history: this.store.nudgeHistory(nowMs),
      silence: this.opts.silence(nowMs),
      budget: this.opts.budget(),
      dueSoonMs: this.opts.dueSoonMinutes() * 60_000,
    });
  }

  recordShown(nudge: Nudge, nowMs: number): void {
    this.store.recordNudge({ signalId: nudge.signalId, kind: nudge.kind, at: nowMs });
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
      this.store.replaceAll('clickup', signals, now);
      this.lastSyncAt = now;
      this.clickup = { state: 'connected', lastSyncAt: now, signalCount: signals.length };
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
