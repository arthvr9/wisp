import { DatabaseSync } from 'node:sqlite';
import type { SQLOutputValue } from 'node:sqlite';

import type { NudgeKind, NudgeRecord } from '../../shared/nudges';
import type { Meeting, Signal, SignalKind, SignalSource } from '../../shared/signals';

export interface Diff {
  added: Signal[];
  changed: Signal[];
  gone: Signal[];
  completed: Signal[];
}

interface Row {
  id: string;
  source: SignalSource;
  kind: SignalKind;
  title: string;
  dueAt: number;
  url: string;
  status: string;
  listName: string;
  gone: boolean;
  closedAt: number | undefined;
  meeting: Meeting | undefined;
}

// Long enough for the 14 day overdue escalation to see its own past, short enough that the
// table stays small without a separate cleanup job.
export const NUDGE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

// A signal that has been gone this long is not coming back as the same row.
export const SIGNAL_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

const schema = `
CREATE TABLE IF NOT EXISTS signals (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  due_at INTEGER NOT NULL,
  url TEXT NOT NULL,
  status TEXT NOT NULL,
  list_name TEXT NOT NULL,
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  gone_at INTEGER NULL,
  closed_at INTEGER NULL,
  meeting TEXT NULL
);
CREATE TABLE IF NOT EXISTS nudges (
  signal_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS nudges_at ON nudges (at);
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS snoozes (
  signal_id TEXT PRIMARY KEY,
  until INTEGER NOT NULL
);
`;

function text(v: SQLOutputValue | undefined): string {
  return typeof v === 'string' ? v : String(v ?? '');
}

function int(v: SQLOutputValue | undefined): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'bigint') return Number(v);
  return 0;
}

function toRow(r: Record<string, SQLOutputValue>): Row {
  return {
    id: text(r.id),
    source: text(r.source) as SignalSource,
    kind: text(r.kind) as SignalKind,
    title: text(r.title),
    dueAt: int(r.due_at),
    url: text(r.url),
    status: text(r.status),
    listName: text(r.list_name),
    gone: r.gone_at !== null && r.gone_at !== undefined,
    closedAt: r.closed_at === null || r.closed_at === undefined ? undefined : int(r.closed_at),
    meeting: parseMeeting(r.meeting),
  };
}

// The meeting payload has no fixed columns of its own: it is only ever read back whole, and a
// second source of meetings would bring different fields.
function parseMeeting(value: SQLOutputValue | undefined): Meeting | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  try {
    const raw: unknown = JSON.parse(value);
    if (typeof raw !== 'object' || raw === null) return undefined;
    const m = raw as Record<string, unknown>;
    if (typeof m.endsAt !== 'number') return undefined;
    return {
      endsAt: m.endsAt,
      accepted: m.accepted === true,
      allDay: m.allDay === true,
      organizer: typeof m.organizer === 'string' ? m.organizer : '',
      busy: m.busy === true,
    };
  } catch {
    return undefined;
  }
}

function toSignal(r: Row): Signal {
  return {
    id: r.id,
    source: r.source,
    kind: r.kind,
    title: r.title,
    dueAt: r.dueAt,
    url: r.url,
    status: r.status,
    listName: r.listName,
    ...(r.closedAt === undefined ? {} : { closedAt: r.closedAt }),
    ...(r.meeting === undefined ? {} : { meeting: r.meeting }),
  };
}

function differs(a: Row, b: Signal): boolean {
  return a.title !== b.title || a.dueAt !== b.dueAt || a.status !== b.status;
}

// Phase 2 databases predate closed_at. SQLite has no ADD COLUMN IF NOT EXISTS.
function migrate(db: DatabaseSync): void {
  const columns = db
    .prepare('PRAGMA table_info(signals)')
    .all()
    .map((r) => text(r.name));
  if (!columns.includes('closed_at'))
    db.exec('ALTER TABLE signals ADD COLUMN closed_at INTEGER NULL');
}

export class SignalStore {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(schema);
    migrate(this.db);
  }

  replaceAll(source: SignalSource, signals: Signal[], nowMs: number): Diff {
    const existing = new Map<string, Row>();
    for (const r of this.db.prepare('SELECT * FROM signals WHERE source = ?').all(source)) {
      const row = toRow(r);
      existing.set(row.id, row);
    }

    const upsert = this.db.prepare(
      `INSERT INTO signals
         (id, source, kind, title, due_at, url, status, list_name, first_seen, last_seen, gone_at, closed_at, meeting)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         kind = excluded.kind,
         title = excluded.title,
         due_at = excluded.due_at,
         url = excluded.url,
         status = excluded.status,
         list_name = excluded.list_name,
         last_seen = excluded.last_seen,
         gone_at = NULL,
         closed_at = excluded.closed_at,
         meeting = excluded.meeting`,
    );
    const markGone = this.db.prepare(
      'UPDATE signals SET gone_at = ? WHERE id = ? AND gone_at IS NULL',
    );

    const diff: Diff = { added: [], changed: [], gone: [], completed: [] };
    const seen = new Set<string>();

    this.db.exec('BEGIN');
    try {
      for (const s of signals) {
        if (seen.has(s.id)) continue;
        seen.add(s.id);
        const before = existing.get(s.id);
        upsert.run(
          s.id,
          s.source,
          s.kind,
          s.title,
          s.dueAt,
          s.url,
          s.status,
          s.listName,
          nowMs,
          nowMs,
          s.closedAt ?? null,
          s.meeting === undefined ? null : JSON.stringify(s.meeting),
        );
        const open = s.closedAt === undefined;
        const wasOpen = before !== undefined && !before.gone && before.closedAt === undefined;
        if (!open) {
          if (wasOpen) diff.completed.push(s);
        } else if (before === undefined || before.gone || before.closedAt !== undefined) {
          diff.added.push(s);
        } else if (differs(before, s)) {
          diff.changed.push(s);
        }
      }
      for (const row of existing.values()) {
        if (seen.has(row.id) || row.gone) continue;
        markGone.run(nowMs, row.id);
        diff.gone.push(toSignal(row));
      }
      this.db
        .prepare('DELETE FROM signals WHERE gone_at IS NOT NULL AND gone_at < ?')
        .run(nowMs - SIGNAL_RETENTION_MS);
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
    return diff;
  }

  list(source?: SignalSource): Signal[] {
    const rows =
      source === undefined
        ? this.db
            .prepare(
              'SELECT * FROM signals WHERE gone_at IS NULL AND closed_at IS NULL ORDER BY due_at, id',
            )
            .all()
        : this.db
            .prepare(
              'SELECT * FROM signals WHERE gone_at IS NULL AND closed_at IS NULL AND source = ? ORDER BY due_at, id',
            )
            .all(source);
    return rows.map((r) => toSignal(toRow(r)));
  }

  // Lets an action mark a signal done right away, instead of waiting for the next sync to see
  // the source's own record of the completion.
  markClosed(signalId: string, closedAtMs: number): void {
    this.db.prepare('UPDATE signals SET closed_at = ? WHERE id = ?').run(closedAtMs, signalId);
  }

  recordNudge(record: NudgeRecord): void {
    this.db
      .prepare('INSERT INTO nudges (signal_id, kind, at) VALUES (?, ?, ?)')
      .run(record.signalId, record.kind, record.at);
    this.db.prepare('DELETE FROM nudges WHERE at < ?').run(record.at - NUDGE_RETENTION_MS);
  }

  // The escalation rules count how many times a signal was nudged, so the history has to keep
  // every record inside the retention window, not just the most recent one per kind.
  nudgeHistory(nowMs: number, windowMs = NUDGE_RETENTION_MS): NudgeRecord[] {
    const rows = this.db
      .prepare('SELECT signal_id, kind, at FROM nudges WHERE at > ? ORDER BY at')
      .all(nowMs - windowMs);
    return rows.map((r) => ({
      signalId: text(r.signal_id),
      kind: text(r.kind) as NudgeKind,
      at: int(r.at),
    }));
  }

  // The watermark is the actual clock, not untilMs, because untilMs is a future expiry and
  // comparing other rows against it would delete snoozes that are still active.
  snooze(signalId: string, untilMs: number): void {
    this.db
      .prepare(
        `INSERT INTO snoozes (signal_id, until) VALUES (?, ?)
         ON CONFLICT(signal_id) DO UPDATE SET until = excluded.until`,
      )
      .run(signalId, untilMs);
    this.db.prepare('DELETE FROM snoozes WHERE until < ?').run(Date.now());
  }

  snoozedUntil(signalId: string, nowMs: number): number | undefined {
    const row = this.db.prepare('SELECT until FROM snoozes WHERE signal_id = ?').get(signalId);
    if (row === undefined) return undefined;
    const until = int(row.until);
    return until > nowMs ? until : undefined;
  }

  clearSnooze(signalId: string): void {
    this.db.prepare('DELETE FROM snoozes WHERE signal_id = ?').run(signalId);
  }

  getMeta(key: string): string | undefined {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
    return row === undefined ? undefined : text(row.value);
  }

  setMeta(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO meta (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(key, value);
  }

  close(): void {
    this.db.close();
  }
}
