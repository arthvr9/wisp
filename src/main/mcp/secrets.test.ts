import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SecretStore } from './secrets';
import type { SafeStorageLike } from './secrets';

function reversing(available = true): SafeStorageLike {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (plain) => Buffer.from(plain, 'utf8').reverse(),
    decryptString: (encrypted) => Buffer.from(encrypted).reverse().toString('utf8'),
  };
}

const asRecord = (raw: unknown): Record<string, unknown> | undefined =>
  typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : undefined;

describe('SecretStore', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'wisp-secrets-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('round-trips a value through the encryptor', () => {
    const store = new SecretStore(reversing(), dir);
    store.set('clickup.tokens', { access_token: 'abc', n: 1 });
    expect(store.get('clickup.tokens', asRecord)).toEqual({ access_token: 'abc', n: 1 });

    const file = readFileSync(join(dir, 'clickup.tokens.bin'));
    expect(file[0]).toBe(0x45);
    expect(file.subarray(1).toString('utf8')).not.toContain('access_token');
    expect(Buffer.from(file.subarray(1)).reverse().toString('utf8')).toContain('access_token');
  });

  it('falls back to plain text with a warning when encryption is unavailable', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const store = new SecretStore(reversing(false), dir);
    store.set('a', { x: 1 });
    store.set('b', { x: 2 });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(readFileSync(join(dir, 'a.bin')).subarray(1).toString('utf8')).toBe('{"x":1}');
    expect(store.get('a', asRecord)).toEqual({ x: 1 });
  });

  it('reads plain files even when encryption became available later', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    new SecretStore(reversing(false), dir).set('a', { x: 1 });
    expect(new SecretStore(reversing(true), dir).get('a', asRecord)).toEqual({ x: 1 });
  });

  it('returns undefined for missing, rejected and corrupt blobs', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const store = new SecretStore(reversing(), dir);
    expect(store.get('missing', asRecord)).toBeUndefined();

    store.set('bad', 'not an object');
    expect(store.get('bad', asRecord)).toBeUndefined();

    store.set('corrupt', { x: 1 });
    const other = new SecretStore({ ...reversing(), decryptString: () => 'nope' }, dir);
    expect(other.get('corrupt', asRecord)).toBeUndefined();
  });

  it('deletes and sanitises keys', () => {
    const store = new SecretStore(reversing(), dir);
    store.set('../evil/key', { x: 1 });
    expect(readFileSync(join(dir, '.._evil_key.bin')).length).toBeGreaterThan(1);
    store.delete('../evil/key');
    expect(store.get('../evil/key', asRecord)).toBeUndefined();
    store.delete('never-existed');
  });
});
