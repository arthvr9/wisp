import { describe, expect, it } from 'vitest';

import { detectOllama } from './ollama';

const jsonResponse =
  (body: unknown): typeof fetch =>
  () =>
    Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));

describe('detectOllama', () => {
  it('lists the models when Ollama answers', async () => {
    const fetchFn = jsonResponse({ models: [{ name: 'llama3.2:3b' }, { name: 'qwen2.5:7b' }] });
    await expect(detectOllama('http://localhost:11434', fetchFn)).resolves.toEqual({
      found: true,
      models: ['llama3.2:3b', 'qwen2.5:7b'],
    });
  });

  it('reports missing when the request fails', async () => {
    const fetchFn: typeof fetch = () => Promise.reject(new Error('ECONNREFUSED'));
    await expect(detectOllama('http://localhost:11434', fetchFn)).resolves.toEqual({
      found: false,
      models: [],
    });
  });

  it('reports missing on malformed bodies and non-2xx status', async () => {
    await expect(
      detectOllama('http://localhost:11434', jsonResponse({ nope: 1 })),
    ).resolves.toEqual({ found: false, models: [] });
    const notFound: typeof fetch = () => Promise.resolve(new Response('', { status: 404 }));
    await expect(detectOllama('http://localhost:11434', notFound)).resolves.toEqual({
      found: false,
      models: [],
    });
  });
});
