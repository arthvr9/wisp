import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Only for running from source. A packaged build has no .env next to it, and secrets belong in
// safeStorage there. Values already in the environment win, so a shell export still overrides.
export function loadDotEnv(appPath: string): void {
  const path = join(appPath, '.env');
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (key in process.env) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}
