import { describe, expect, it } from 'vitest';

import { GruplyError, gruplyClient } from './client';

function fakeFetch(
  handler: (url: string, init: RequestInit) => { status: number; body: unknown },
): typeof fetch {
  return ((url: string, init: RequestInit) => {
    const { status, body } = handler(url, init);
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }) as typeof fetch;
}

describe('gruplyClient', () => {
  it('sends a bearer token against the configured base URL', async () => {
    let seenUrl = '';
    let seenAuth: string | undefined;
    const client = gruplyClient({
      baseUrl: 'https://api.gruply.com.br/api',
      token: () => 'test-token',
      fetchFn: fakeFetch((url, init) => {
        seenUrl = url;
        seenAuth = (init.headers as Record<string, string>).authorization;
        return { status: 200, body: { data: [] } };
      }),
    });
    const result = await client.get<{ data: unknown[] }>('/projects', { perPage: '1' });
    expect(seenUrl).toBe('https://api.gruply.com.br/api/projects?perPage=1');
    expect(seenAuth).toBe('Bearer test-token');
    expect(result).toEqual({ data: [] });
  });

  it('throws before making a request when the token getter returns undefined', async () => {
    let called = false;
    const client = gruplyClient({
      baseUrl: 'https://api.gruply.com.br/api',
      token: () => undefined,
      fetchFn: fakeFetch(() => {
        called = true;
        return { status: 200, body: {} };
      }),
    });
    await expect(client.get('/projects')).rejects.toBeInstanceOf(GruplyError);
    expect(called).toBe(false);
  });

  it('throws a GruplyError that says the key was rejected on a 401, without the key', async () => {
    const client = gruplyClient({
      baseUrl: 'https://api.gruply.com.br/api',
      token: () => 'gk_super_secret_value',
      fetchFn: fakeFetch(() => ({ status: 401, body: { message: 'unauthorized' } })),
    });
    const err = await client.get('/projects').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GruplyError);
    expect((err as GruplyError).status).toBe(401);
    expect((err as GruplyError).message.toLowerCase()).toContain('rejected');
    expect((err as GruplyError).message).not.toContain('gk_super_secret_value');
  });

  it('carries the status and message from a non-401 error response', async () => {
    const client = gruplyClient({
      baseUrl: 'https://api.gruply.com.br/api',
      token: () => 'test-token',
      fetchFn: fakeFetch(() => ({ status: 422, body: { message: 'business rule violated' } })),
    });
    await expect(client.get('/projects')).rejects.toMatchObject({
      status: 422,
      message: 'business rule violated',
    });
  });

  it('falls back to a generic message when the error body has none', async () => {
    const client = gruplyClient({
      baseUrl: 'https://api.gruply.com.br/api',
      token: () => 'test-token',
      fetchFn: fakeFetch(() => ({ status: 500, body: {} })),
    });
    await expect(client.get('/projects')).rejects.toThrow(/status 500/);
  });
});
