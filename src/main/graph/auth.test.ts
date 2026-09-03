import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { GraphAuth } from './auth';
import { SecretStore } from '../mcp';

const fakeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (plain: string) => Buffer.from(plain, 'utf8').reverse(),
  decryptString: (encrypted: Buffer) => Buffer.from(encrypted).reverse().toString('utf8'),
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

interface TokenCall {
  url: string;
  body: URLSearchParams;
}

function fakeTokenFetch(respond: (call: TokenCall) => { status: number; body: unknown }): {
  fetchFn: typeof fetch;
  calls: TokenCall[];
} {
  const calls: TokenCall[] = [];
  const fetchFn = ((url: string, init: RequestInit) => {
    const call = { url, body: new URLSearchParams(init.body as string) };
    calls.push(call);
    const { status, body } = respond(call);
    return Promise.resolve(jsonResponse(status, body));
  }) as typeof fetch;
  return { fetchFn, calls };
}

describe('GraphAuth', () => {
  let dir: string;
  let secrets: SecretStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'wisp-graph-auth-'));
    secrets = new SecretStore(fakeStorage, dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('has no tokens before authorization', () => {
    const auth = new GraphAuth({
      clientId: 'client-1',
      tenant: 'contoso',
      secrets,
      openExternal: () => undefined,
    });
    expect(auth.hasTokens()).toBe(false);
  });

  it('runs the PKCE authorization code flow and stores the resulting tokens', async () => {
    const { fetchFn, calls } = fakeTokenFetch(() => ({
      status: 200,
      body: { access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 3600 },
    }));
    let authorizeUrl = '';
    const auth = new GraphAuth({
      clientId: 'client-1',
      tenant: 'contoso',
      secrets,
      fetchFn,
      now: () => 1_000_000,
      openExternal: async (url) => {
        authorizeUrl = url;
        const parsed = new URL(url);
        const redirect = parsed.searchParams.get('redirect_uri');
        const state = parsed.searchParams.get('state');
        await fetch(`${redirect}?code=abc123&state=${state}`);
      },
    });

    await auth.authorize();

    const parsedAuthorize = new URL(authorizeUrl);
    expect(parsedAuthorize.origin + parsedAuthorize.pathname).toBe(
      'https://login.microsoftonline.com/contoso/oauth2/v2.0/authorize',
    );
    expect(parsedAuthorize.searchParams.get('client_id')).toBe('client-1');
    expect(parsedAuthorize.searchParams.get('response_type')).toBe('code');
    expect(parsedAuthorize.searchParams.get('scope')).toBe('Calendars.Read offline_access');
    expect(parsedAuthorize.searchParams.get('code_challenge_method')).toBe('S256');
    expect(parsedAuthorize.searchParams.get('redirect_uri')).toMatch(
      /^http:\/\/localhost:\d+\/callback$/,
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://login.microsoftonline.com/contoso/oauth2/v2.0/token');
    expect(calls[0]?.body.get('grant_type')).toBe('authorization_code');
    expect(calls[0]?.body.get('code')).toBe('abc123');
    expect(calls[0]?.body.get('client_id')).toBe('client-1');
    expect(calls[0]?.body.get('redirect_uri')).toBe(
      parsedAuthorize.searchParams.get('redirect_uri'),
    );

    const verifier = calls[0]?.body.get('code_verifier');
    expect(verifier).toBeTruthy();
    const expectedChallenge = createHash('sha256')
      .update(verifier ?? '')
      .digest('base64url');
    expect(expectedChallenge).toBe(parsedAuthorize.searchParams.get('code_challenge'));

    expect(auth.hasTokens()).toBe(true);
    await expect(auth.accessToken()).resolves.toBe('access-1');
    expect(calls).toHaveLength(1);
  });

  it('rejects when the callback state does not match', async () => {
    const { fetchFn } = fakeTokenFetch(() => ({ status: 200, body: {} }));
    const auth = new GraphAuth({
      clientId: 'client-1',
      tenant: 'contoso',
      secrets,
      fetchFn,
      openExternal: async (url) => {
        const redirect = new URL(url).searchParams.get('redirect_uri');
        await fetch(`${redirect}?code=abc123&state=wrong`);
      },
    });
    await expect(auth.authorize()).rejects.toThrow(/state mismatch/);
    expect(auth.hasTokens()).toBe(false);
  });

  it('rejects with the error_description when the authorization server reports an error', async () => {
    const auth = new GraphAuth({
      clientId: 'client-1',
      tenant: 'contoso',
      secrets,
      openExternal: async (url) => {
        const redirect = new URL(url).searchParams.get('redirect_uri');
        await fetch(`${redirect}?error=access_denied&error_description=user+said+no`);
      },
    });
    await expect(auth.authorize()).rejects.toThrow(/user said no/);
  });

  it('cancel() rejects a pending authorize() and closes the server', async () => {
    let capturedRedirect = '';
    const auth = new GraphAuth({
      clientId: 'client-1',
      tenant: 'contoso',
      secrets,
      openExternal: (url) => {
        capturedRedirect = new URL(url).searchParams.get('redirect_uri') ?? '';
      },
    });
    const authorizing = auth.authorize();
    // Let the loopback server finish binding and openExternal run before cancelling.
    await new Promise((resolve) => setTimeout(resolve, 20));
    await auth.cancel();
    await expect(authorizing).rejects.toThrow(/cancelled/);
    await expect(fetch(capturedRedirect)).rejects.toThrow();
  });

  it('only runs one authorization flow at a time', async () => {
    const { fetchFn } = fakeTokenFetch(() => ({
      status: 200,
      body: { access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 3600 },
    }));
    let opens = 0;
    const auth = new GraphAuth({
      clientId: 'client-1',
      tenant: 'contoso',
      secrets,
      fetchFn,
      openExternal: async (url) => {
        opens += 1;
        const parsed = new URL(url);
        const redirect = parsed.searchParams.get('redirect_uri');
        const state = parsed.searchParams.get('state');
        await fetch(`${redirect}?code=abc123&state=${state}`);
      },
    });
    const [first, second] = await Promise.all([auth.authorize(), auth.authorize()]);
    expect(first).toBeUndefined();
    expect(second).toBeUndefined();
    expect(opens).toBe(1);
  });

  it('accessToken() returns the stored token when it is not close to expiry', async () => {
    const { fetchFn, calls } = fakeTokenFetch(() => ({ status: 200, body: {} }));
    const auth = new GraphAuth({
      clientId: 'client-1',
      tenant: 'contoso',
      secrets,
      fetchFn,
      now: () => 1_000_000,
      openExternal: () => undefined,
    });
    secrets.set('outlook.tokens.client-1.contoso', {
      accessToken: 'still-good',
      refreshToken: 'refresh-1',
      expiresAt: 1_000_000 + 10 * 60_000,
    });
    await expect(auth.accessToken()).resolves.toBe('still-good');
    expect(calls).toHaveLength(0);
  });

  it('accessToken() refreshes when the token is within 60 seconds of expiry, rotating the refresh token', async () => {
    const { fetchFn, calls } = fakeTokenFetch((call) => {
      expect(call.body.get('grant_type')).toBe('refresh_token');
      expect(call.body.get('refresh_token')).toBe('refresh-1');
      return {
        status: 200,
        body: { access_token: 'access-2', refresh_token: 'refresh-2', expires_in: 3600 },
      };
    });
    let now = 1_000_000;
    const auth = new GraphAuth({
      clientId: 'client-1',
      tenant: 'contoso',
      secrets,
      fetchFn,
      now: () => now,
      openExternal: () => undefined,
    });
    secrets.set('outlook.tokens.client-1.contoso', {
      accessToken: 'about-to-expire',
      refreshToken: 'refresh-1',
      expiresAt: now + 30_000,
    });
    await expect(auth.accessToken()).resolves.toBe('access-2');
    expect(calls).toHaveLength(1);

    now += 1;
    await expect(auth.accessToken()).resolves.toBe('access-2');
    expect(calls).toHaveLength(1);
  });

  it('accessToken() throws when Outlook was never connected', async () => {
    const auth = new GraphAuth({
      clientId: 'client-1',
      tenant: 'contoso',
      secrets,
      openExternal: () => undefined,
    });
    await expect(auth.accessToken()).rejects.toThrow(/not connected/);
  });

  it('signs out on invalid_grant during refresh, so hasTokens() goes false', async () => {
    const { fetchFn } = fakeTokenFetch(() => ({
      status: 400,
      body: { error: 'invalid_grant', error_description: 'token revoked' },
    }));
    const auth = new GraphAuth({
      clientId: 'client-1',
      tenant: 'contoso',
      secrets,
      fetchFn,
      now: () => 1_000_000,
      openExternal: () => undefined,
    });
    secrets.set('outlook.tokens.client-1.contoso', {
      accessToken: 'about-to-expire',
      refreshToken: 'refresh-1',
      expiresAt: 1_000_000 + 30_000,
    });
    await expect(auth.accessToken()).rejects.toThrow(/token revoked/);
    expect(auth.hasTokens()).toBe(false);
  });

  it('signOut() clears stored tokens', () => {
    const auth = new GraphAuth({
      clientId: 'client-1',
      tenant: 'contoso',
      secrets,
      openExternal: () => undefined,
    });
    secrets.set('outlook.tokens.client-1.contoso', {
      accessToken: 'a',
      refreshToken: 'r',
      expiresAt: 2_000_000,
    });
    expect(auth.hasTokens()).toBe(true);
    auth.signOut();
    expect(auth.hasTokens()).toBe(false);
  });

  it('defaults an empty tenant to "common"', async () => {
    const { fetchFn, calls } = fakeTokenFetch(() => ({
      status: 200,
      body: { access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 3600 },
    }));
    const auth = new GraphAuth({
      clientId: 'client-1',
      tenant: '',
      secrets,
      fetchFn,
      openExternal: async (url) => {
        const parsed = new URL(url);
        expect(parsed.origin + parsed.pathname).toBe(
          'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
        );
        const redirect = parsed.searchParams.get('redirect_uri');
        const state = parsed.searchParams.get('state');
        await fetch(`${redirect}?code=abc123&state=${state}`);
      },
    });
    await auth.authorize();
    expect(calls[0]?.url).toBe('https://login.microsoftonline.com/common/oauth2/v2.0/token');
  });
});
