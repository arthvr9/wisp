import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SpeechRequest } from '../../shared/speech';
import { providerFor, speak } from './index';
import type { SpeechProvider } from './providers';

const request: SpeechRequest = {
  event: 'poke',
  name: 'Wisp',
  mood: 'calm',
  fallback: 'Yes?',
  context: {},
};

const fake = (generate: SpeechProvider['generate']): SpeechProvider => ({
  kind: 'openai-compatible',
  generate,
});

afterEach(() => {
  vi.useRealTimers();
});

describe('speak', () => {
  it('returns the fallback without a provider', async () => {
    const result = await speak(undefined, request);
    expect(result).toMatchObject({ text: 'Yes?', source: 'fallback', error: 'no provider' });
  });

  it('returns the sanitized model text on success', async () => {
    let t = 1000;
    const now = () => (t += 50);
    const provider = fake(() => Promise.resolve('"Something you need!"\n'));
    const result = await speak(provider, request, { now });
    expect(result).toEqual({ text: 'Something you need.', source: 'model', latencyMs: 50 });
  });

  it('falls back on timeout and aborts the provider', async () => {
    vi.useFakeTimers();
    let aborted = false;
    const provider = fake(
      (_r, signal) =>
        new Promise<string>((_, reject) => {
          signal.addEventListener('abort', () => {
            aborted = true;
            reject(new Error('aborted'));
          });
        }),
    );
    const pending = speak(provider, request, { timeoutMs: 200 });
    await vi.advanceTimersByTimeAsync(250);
    const result = await pending;
    expect(aborted).toBe(true);
    expect(result).toMatchObject({ text: 'Yes?', source: 'fallback', error: 'timeout' });
  });

  it('falls back when the provider throws', async () => {
    const provider = fake(() => Promise.reject(new Error('HTTP 500')));
    const result = await speak(provider, request);
    expect(result).toMatchObject({ text: 'Yes?', source: 'fallback', error: 'HTTP 500' });
  });

  it('falls back when the sanitizer rejects the text', async () => {
    const provider = fake(() => Promise.resolve('Hi \u{1F44B}'));
    const result = await speak(provider, request);
    expect(result).toMatchObject({
      text: 'Yes?',
      source: 'fallback',
      error: 'rejected by sanitizer',
    });
  });
});

describe('providerFor', () => {
  it('returns nothing when off or when required pieces are missing', () => {
    expect(providerFor({ provider: 'off', baseUrl: '', model: '' }, 'k')).toBeUndefined();
    expect(providerFor({ provider: 'ollama', baseUrl: '', model: '' }, undefined)).toBeUndefined();
    expect(
      providerFor({ provider: 'openai-compatible', baseUrl: '', model: 'm' }, undefined),
    ).toBeUndefined();
    expect(
      providerFor({ provider: 'openai-compatible', baseUrl: 'http://x/v1', model: '' }, 'k'),
    ).toBeUndefined();
    expect(
      providerFor({ provider: 'anthropic', baseUrl: '', model: '' }, undefined),
    ).toBeUndefined();
  });

  it('builds providers with the right kind', () => {
    expect(
      providerFor({ provider: 'ollama', baseUrl: '', model: 'llama3.2' }, undefined)?.kind,
    ).toBe('ollama');
    expect(
      providerFor({ provider: 'openai-compatible', baseUrl: 'http://x/v1', model: 'm' }, undefined)
        ?.kind,
    ).toBe('openai-compatible');
    expect(providerFor({ provider: 'anthropic', baseUrl: '', model: '' }, 'key')?.kind).toBe(
      'anthropic',
    );
  });
});
