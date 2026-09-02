import { describe, expect, it } from 'vitest';

import { format, translator } from './index';

describe('i18n', () => {
  it('interpolates named tokens and leaves unknown ones alone', () => {
    expect(format('{name} sees {count} tasks and {missing}', { name: 'Wisp', count: 3 })).toBe(
      'Wisp sees 3 tasks and {missing}',
    );
  });

  it('applies base params from the translator and lets call params override', () => {
    const t = translator('en', { name: 'Momo' });
    expect(t('phrase.hello')).toBe('Momo is here.');
    expect(t('phrase.hello', { name: 'Zé' })).toBe('Zé is here.');
  });
});
