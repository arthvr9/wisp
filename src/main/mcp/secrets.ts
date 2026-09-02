import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

const ENCRYPTED = 0x45;
const PLAIN = 0x50;

export class SecretStore {
  private warned = false;

  constructor(
    private readonly storage: SafeStorageLike,
    private readonly dir: string,
  ) {}

  get<T>(key: string, parse: (raw: unknown) => T | undefined): T | undefined {
    const path = this.pathFor(key);
    if (!existsSync(path)) return undefined;
    try {
      const file = readFileSync(path);
      const body = file.subarray(1);
      const text = file[0] === ENCRYPTED ? this.storage.decryptString(body) : body.toString('utf8');
      const json: unknown = JSON.parse(text);
      return parse(json);
    } catch (err) {
      console.warn(`secret ${key} unreadable, ignoring`, err);
      return undefined;
    }
  }

  set(key: string, value: unknown): void {
    mkdirSync(this.dir, { recursive: true });
    const text = JSON.stringify(value);
    const encrypted = this.canEncrypt();
    const body = encrypted ? this.storage.encryptString(text) : Buffer.from(text, 'utf8');
    const file = Buffer.concat([Buffer.from([encrypted ? ENCRYPTED : PLAIN]), body]);
    writeFileSync(this.pathFor(key), file, { mode: 0o600 });
  }

  delete(key: string): void {
    rmSync(this.pathFor(key), { force: true });
  }

  private canEncrypt(): boolean {
    if (this.storage.isEncryptionAvailable()) return true;
    // Some sessions have no keyring (no gnome-keyring or kwallet on the bus), so safeStorage
    // cannot encrypt and the only alternative to plain text is not storing tokens at all.
    if (!this.warned) {
      console.warn('safeStorage encryption unavailable, storing secrets as plain text');
      this.warned = true;
    }
    return false;
  }

  private pathFor(key: string): string {
    return join(this.dir, `${key.replace(/[^A-Za-z0-9._-]/g, '_')}.bin`);
  }
}
