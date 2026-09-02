import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { normalizeConfig } from '../shared/config';
import type { Config } from '../shared/config';

type Listener = (config: Config) => void;

export class ConfigStore {
  private config: Config;
  private readonly listeners = new Set<Listener>();

  constructor(private readonly path: string) {
    this.config = load(path);
  }

  get(): Config {
    return this.config;
  }

  set(patch: Partial<Config>): Config {
    this.config = normalizeConfig({ ...this.config, ...patch });
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(this.config, null, 2) + '\n');
    for (const listener of this.listeners) listener(this.config);
    return this.config;
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
