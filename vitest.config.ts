import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // Recurrence expansion works on local wall clock components on purpose, so the suite has
    // to agree on a zone or it passes here and fails on a runner set to UTC. A test that wants
    // a different zone sets process.env.TZ itself.
    env: { TZ: 'UTC' },
  },
});
