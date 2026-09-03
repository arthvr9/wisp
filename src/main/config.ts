import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { normalizeConfig } from '../shared/config';
import type { Config } from '../shared/config';

type Listener = (config: Config) => void;

// Settings inputs save on every keystroke and the main process also drives the 33 ms mascot
// loop, so the write is debounced and flushed on quit.
const WRITE_DELAY_MS = 400;

export class ConfigStore {
  private config: Config;
  private readonly listeners = new Set<Listener>();
  private pendingWrite: NodeJS.Timeout | undefined;

  constructor(private readonly path: string) {
    this.config = load(path);
  }

  get(): Config {
    return this.config;
  }

  set(patch: Partial<Config>): Config {
    this.config = normalizeConfig({ ...this.config, ...patch });
    if (this.pendingWrite) clearTimeout(this.pendingWrite);
    this.pendingWrite = setTimeout(() => {
      this.flush();
    }, WRITE_DELAY_MS);
    for (const listener of this.listeners) listener(this.config);
    return this.config;
  }

  flush(): void {
    if (this.pendingWrite) {
      clearTimeout(this.pendingWrite);
      this.pendingWrite = undefined;
    }
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(this.config, null, 2) + '\n');
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

function load(path: string): Config {
  try {
    return normalizeConfig(JSON.parse(readFileSync(path, 'utf8')));
  } catch {
    return normalizeConfig(undefined);
  }
}
