import { describe, expect, it } from 'vitest';

import type { SpeechRequest } from '../../shared/speech';
import { buildPrompt, sanitizeLine } from './prompt';

const request: SpeechRequest = {
  event: 'nudge',
  name: 'Wisp',
  mood: 'dejected',
  fallback: 'Due in 10 min: Write the report',
  context: { title: 'Write the report', minutesLeft: 10 },
};

describe('buildPrompt', () => {
  it('names the creature, the mood and the constraints in the system prompt', () => {
    const { system } = buildPrompt(request);
    expect(system).toContain('You are Wisp');
    expect(system).toContain('at most 12 words');
    expect(system).toContain('dejected');
    expect(system).toContain('quiet and withdrawn');
  });

  it('puts the context and the reference line in the user prompt', () => {
    const { user } = buildPrompt(request);
    expect(user).toContain('Task title: Write the report');
    expect(user).toContain('Minutes left: 10');
    expect(user).toContain('Due in 10 min: Write the report');
    expect(user).not.toContain('Count:');
  });
});

describe('sanitizeLine', () => {
  it('trims, keeps the first line and strips quotes', () => {
    expect(sanitizeLine('  "The report is due soon."  \nSecond line')).toBe(
      'The report is due soon.',
    );
    expect(sanitizeLine('“Quiet day.”')).toBe('Quiet day.');
  });

  it('replaces exclamation marks and collapses whitespace', () => {
    expect(sanitizeLine('Done!!  Well   done!')).toBe('Done. Well done.');
  });

  it('rejects empty, long and emoji lines', () => {
    expect(sanitizeLine('   ')).toBeUndefined();
    expect(sanitizeLine('""')).toBeUndefined();
    expect(sanitizeLine('a'.repeat(141))).toBeUndefined();
    expect(sanitizeLine('Nice work \u{1F389}')).toBeUndefined();
    expect(sanitizeLine('Sunny ☀️')).toBeUndefined();
  });
});
