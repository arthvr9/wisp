import { describe, expect, it } from 'vitest';

import { gruplyClient } from './client';
import { fetchGruplySignals } from './tasks';
import { loadDotEnv } from '../env';

// Runs against the real API only when a key is present, so the suite stays offline by default.
// Provide WISP_GRUPLY_TOKEN and WISP_GRUPLY_EMAIL in .env or the environment to exercise it.
loadDotEnv(process.cwd());
const token = process.env.WISP_GRUPLY_TOKEN;
const email = process.env.WISP_GRUPLY_EMAIL;

describe.skipIf(token === undefined || email === undefined)('Gruply, against the live API', () => {
  it('reads the projects and returns this user due tasks', async () => {
    const client = gruplyClient({
      baseUrl: 'https://api.gruply.com.br/api',
      token: () => token,
    });
    const signals = await fetchGruplySignals(client, {
      nowMs: Date.now(),
      email: email ?? '',
      horizonDays: 60,
      pastDays: 120,
    });
    for (const signal of signals) {
      expect(signal.source).toBe('gruply');
      expect(signal.id.startsWith('gruply:')).toBe(true);
      expect(Number.isFinite(signal.dueAt)).toBe(true);
      expect(signal.title.length).toBeGreaterThan(0);
    }
    console.log(`live gruply: ${signals.length} signals for the configured user`);
  }, 120_000);
});
