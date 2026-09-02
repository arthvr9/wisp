import { DatabaseSync } from 'node:sqlite';
import type { SQLOutputValue } from 'node:sqlite';

import type { Signal, SignalKind, SignalSource } from '../../shared/signals';

export interface Diff {
  added: Signal[];
  changed: Signal[];
  gone: Signal[];
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
}

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
  gone_at INTEGER NULL
);
CREATE TABLE IF NOT EXISTS announcements (
  signal_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (signal_id, kind)
);
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
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
  };
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
  };
}

function differs(a: Row, b: Signal): boolean {
  return a.title !== b.title || a.dueAt !== b.dueAt || a.status !== b.status;
}

export class SignalStore {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(schema);
  }

  replaceAll(source: SignalSource, signals: Signal[], nowMs: number): Diff {
    const existing = new Map<string, Row>();
    for (const r of this.db.prepare('SELECT * FROM signals WHERE source = ?').all(source)) {
      const row = toRow(r);
      existing.set(row.id, row);
    }

    const upsert = this.db.prepare(
      `INSERT INTO signals
         (id, source, kind, title, due_at, url, status, list_name, first_seen, last_seen, gone_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
       ON CONFLICT(id) DO UPDATE SET
         kind = excluded.kind,
         title = excluded.title,
         due_at = excluded.due_at,
         url = excluded.url,
         status = excluded.status,
         list_name = excluded.list_name,
         last_seen = excluded.last_seen,
         gone_at = NULL`,
    );
    const markGone = this.db.prepare(
      'UPDATE signals SET gone_at = ? WHERE id = ? AND gone_at IS NULL',
    );

    const diff: Diff = { added: [], changed: [], gone: [] };
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
        );
        if (before === undefined || before.gone) diff.added.push(s);
        else if (differs(before, s)) diff.changed.push(s);
      }
      for (const row of existing.values()) {
        if (seen.has(row.id) || row.gone) continue;
        markGone.run(nowMs, row.id);
        diff.gone.push(toSignal(row));
      }
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
        ? this.db.prepare('SELECT * FROM signals WHERE gone_at IS NULL ORDER BY due_at, id').all()
        : this.db
            .prepare(
              'SELECT * FROM signals WHERE gone_at IS NULL AND source = ? ORDER BY due_at, id',
            )
            .all(source);
    return rows.map((r) => toSignal(toRow(r)));
  }

  wasAnnounced(signalId: string, kind: string): boolean {
    const row = this.db
      .prepare('SELECT 1 AS hit FROM announcements WHERE signal_id = ? AND kind = ?')
      .get(signalId, kind);
    return row !== undefined;
  }

  markAnnounced(signalId: string, kind: string, nowMs: number): void {
    this.db
      .prepare(
        `INSERT INTO announcements (signal_id, kind, at) VALUES (?, ?, ?)
         ON CONFLICT(signal_id, kind) DO UPDATE SET at = excluded.at`,
      )
      .run(signalId, kind, nowMs);
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
