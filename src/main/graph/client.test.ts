import { describe, expect, it } from 'vitest';

import { GraphError, graphClient } from './client';

function fakeAuth(token = 'the-token'): { accessToken: () => Promise<string>; calls: number } {
  const auth = {
    calls: 0,
    accessToken: () => {
      auth.calls += 1;
      return Promise.resolve(token);
    },
  };
  return auth;
}

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

describe('graphClient', () => {
  it('sends a bearer token from the auth object against the v1.0 base URL', async () => {
    const auth = fakeAuth('tok123');
    let seenUrl = '';
    let seenAuth: string | undefined;
    const client = graphClient(
      auth,
      fakeFetch((url, init) => {
        seenUrl = url;
        seenAuth = (init.headers as Record<string, string>).authorization;
        return { status: 200, body: { value: [] } };
      }),
    );
    const result = await client.get<{ value: unknown[] }>('/me/calendarView', { a: '1' });
    expect(seenUrl).toBe('https://graph.microsoft.com/v1.0/me/calendarView?a=1');
    expect(seenAuth).toBe('Bearer tok123');
    expect(result).toEqual({ value: [] });
    expect(auth.calls).toBe(1);
  });

  it('uses an absolute URL as-is, without prefixing the base URL', async () => {
    const auth = fakeAuth();
    let seenUrl = '';
    const client = graphClient(
      auth,
      fakeFetch((url) => {
        seenUrl = url;
        return { status: 200, body: {} };
      }),
    );
    await client.get('https://graph.microsoft.com/v1.0/me/calendarView?next=1');
    expect(seenUrl).toBe('https://graph.microsoft.com/v1.0/me/calendarView?next=1');
  });

  it('merges extra headers alongside the bearer token', async () => {
    const auth = fakeAuth();
    let seenHeaders: Record<string, string> = {};
    const client = graphClient(
      auth,
      fakeFetch((_url, init) => {
        seenHeaders = init.headers as Record<string, string>;
        return { status: 200, body: {} };
      }),
    );
    await client.get('/me/calendarView', undefined, { Prefer: 'outlook.timezone="UTC"' });
    expect(seenHeaders.Prefer).toBe('outlook.timezone="UTC"');
    expect(seenHeaders.authorization).toBeDefined();
  });

  it('throws a GraphError with the status and Graph error message on failure', async () => {
    const auth = fakeAuth();
    const client = graphClient(
      auth,
      fakeFetch(() => ({
        status: 403,
        body: { error: { code: 'Forbidden', message: 'no access' } },
      })),
    );
    await expect(client.get('/me/calendarView')).rejects.toMatchObject({
      status: 403,
      message: 'no access',
    });
    await expect(client.get('/me/calendarView')).rejects.toBeInstanceOf(GraphError);
  });

  it('falls back to a generic message when the error body has no message', async () => {
    const auth = fakeAuth();
    const client = graphClient(
      auth,
      fakeFetch(() => ({ status: 500, body: {} })),
    );
    await expect(client.get('/me/calendarView')).rejects.toThrow(/status 500/);
  });
});
