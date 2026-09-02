import { describe, expect, it } from 'vitest';

import type { SpeechRequest } from '../../shared/speech';
import { openAiCompatibleProvider } from './providers';

const request: SpeechRequest = {
  event: 'hello',
  name: 'Wisp',
  mood: 'cheerful',
  fallback: 'Morning.',
  context: {},
};

describe('openAiCompatibleProvider', () => {
  it('posts to chat/completions and returns the content', async () => {
    let seenUrl = '';
    let seenInit: RequestInit | undefined;
    const fetchFn: typeof fetch = (url, init) => {
      seenUrl = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
      seenInit = init;
      return Promise.resolve(
        new Response(JSON.stringify({ choices: [{ message: { content: 'Hello there.' } }] })),
      );
    };
    const provider = openAiCompatibleProvider({
      baseUrl: 'http://localhost:11434/v1/',
      model: 'llama3.2',
      fetchFn,
    });
    const text = await provider.generate(request, new AbortController().signal);
    expect(text).toBe('Hello there.');
    expect(seenUrl).toBe('http://localhost:11434/v1/chat/completions');
    const headers = seenInit?.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
    const body = JSON.parse(typeof seenInit?.body === 'string' ? seenInit.body : '') as {
      model: string;
      stream: boolean;
    };
    expect(body.model).toBe('llama3.2');
    expect(body.stream).toBe(false);
  });

  it('sends a bearer token when a key is given and throws on non-2xx', async () => {
    let auth: string | undefined;
    const fetchFn: typeof fetch = (_url, init) => {
      auth = (init?.headers as Record<string, string>).Authorization;
      return Promise.resolve(new Response('nope', { status: 401 }));
    };
    const provider = openAiCompatibleProvider({
      baseUrl: 'https://api.example.com/v1',
      model: 'm',
      apiKey: 'secret',
      fetchFn,
    });
    await expect(provider.generate(request, new AbortController().signal)).rejects.toThrow(
      'HTTP 401',
    );
    expect(auth).toBe('Bearer secret');
  });

  it('throws on a malformed body', async () => {
    const fetchFn: typeof fetch = () => Promise.resolve(new Response(JSON.stringify({ x: 1 })));
    const provider = openAiCompatibleProvider({ baseUrl: 'http://x/v1', model: 'm', fetchFn });
    await expect(provider.generate(request, new AbortController().signal)).rejects.toThrow(
      'unexpected response shape',
    );
  });
});
