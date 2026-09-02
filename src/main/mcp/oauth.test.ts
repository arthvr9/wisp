import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LoopbackOAuthProvider } from './oauth';
import { SecretStore } from './secrets';

const fakeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (plain: string) => Buffer.from(plain, 'utf8').reverse(),
  decryptString: (encrypted: Buffer) => Buffer.from(encrypted).reverse().toString('utf8'),
};

describe('LoopbackOAuthProvider', () => {
  let dir: string;
  let secrets: SecretStore;
  let opened: string[];
  let provider: LoopbackOAuthProvider;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'wisp-oauth-'));
    secrets = new SecretStore(fakeStorage, dir);
    opened = [];
    provider = new LoopbackOAuthProvider({
      serverKey: 'clickup',
      secrets,
      openExternal: (url) => {
        opened.push(url);
      },
      clientName: 'Wisp',
    });
  });

  afterEach(async () => {
    await provider.cancelAuthorization();
    rmSync(dir, { recursive: true, force: true });
  });

  it('resolves with the code when state matches and then closes the server', async () => {
    const redirect = await provider.beginAuthorization();
    expect(redirect).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
    expect(provider.redirectUrl).toBe(redirect);
    expect(provider.clientMetadata.redirect_uris).toEqual([redirect]);

    const waiting = provider.waitForCallback(5000);
    const res = await fetch(`${redirect}?code=the-code&state=${provider.state()}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Wisp is connected. You can close this tab.');
    await expect(waiting).resolves.toBe('the-code');
    await expect(fetch(redirect)).rejects.toThrow();
  });

  it('rejects on state mismatch', async () => {
    const redirect = await provider.beginAuthorization();
    const waiting = expect(provider.waitForCallback(5000)).rejects.toThrow(/state mismatch/);
    const res = await fetch(`${redirect}?code=the-code&state=wrong`);
    expect(res.status).toBe(400);
    await waiting;
  });

  it('rejects on an error response from the authorization server', async () => {
    const redirect = await provider.beginAuthorization();
    const waiting = expect(provider.waitForCallback(5000)).rejects.toThrow(
      /access_denied, user said no/,
    );
    await fetch(`${redirect}?error=access_denied&error_description=user+said+no`);
    await waiting;
  });

  it('rejects on timeout', async () => {
    await provider.beginAuthorization();
    await expect(provider.waitForCallback(20)).rejects.toThrow(/timed out/);
  });

  it('accepts a callback that arrives before waitForCallback is called', async () => {
    const redirect = await provider.beginAuthorization();
    await fetch(`${redirect}?code=early&state=${provider.state()}`);
    await expect(provider.waitForCallback(5000)).resolves.toBe('early');
  });

  it('only opens the browser during an authorization session', async () => {
    await expect(
      provider.redirectToAuthorization(new URL('https://example.test/authorize')),
    ).rejects.toThrow(/not started/);
    expect(() => provider.state()).toThrow(/not started/);

    await provider.beginAuthorization();
    await provider.redirectToAuthorization(new URL('https://example.test/authorize'));
    expect(opened).toEqual(['https://example.test/authorize']);
  });

  it('persists tokens, client information and the verifier through secrets', () => {
    expect(provider.hasTokens()).toBe(false);
    provider.saveTokens({ access_token: 'a', token_type: 'Bearer', refresh_token: 'r' });
    provider.saveClientInformation({ client_id: 'cid', redirect_uris: ['http://127.0.0.1:1/x'] });
    provider.saveCodeVerifier('verifier');

    const again = new LoopbackOAuthProvider({
      serverKey: 'clickup',
      secrets,
      openExternal: () => undefined,
      clientName: 'Wisp',
    });
    expect(again.hasTokens()).toBe(true);
    expect(again.tokens()?.refresh_token).toBe('r');
    expect(again.clientInformation()?.client_id).toBe('cid');
    expect(again.codeVerifier()).toBe('verifier');
    expect(again.redirectUrl).toBe('http://127.0.0.1:1/x');

    again.invalidateCredentials('tokens');
    expect(again.hasTokens()).toBe(false);
    expect(again.clientInformation()).toBeDefined();
    again.clear();
    expect(again.clientInformation()).toBeUndefined();
    expect(() => again.codeVerifier()).toThrow();
  });

  it('ignores stored blobs that fail validation', () => {
    secrets.set('clickup.tokens', { token_type: 'Bearer' });
    expect(provider.tokens()).toBeUndefined();
  });

  it('reuses the registered port when free and drops the registration otherwise', async () => {
    const first = await provider.beginAuthorization();
    provider.saveClientInformation({ client_id: 'cid', redirect_uris: [first] });
    await provider.cancelAuthorization();

    const second = await provider.beginAuthorization();
    expect(second).toBe(first);
    expect(provider.clientInformation()?.client_id).toBe('cid');

    const other = new LoopbackOAuthProvider({
      serverKey: 'other',
      secrets,
      openExternal: () => undefined,
      clientName: 'Wisp',
    });
    other.saveClientInformation({ client_id: 'x', redirect_uris: [second] });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const third = await other.beginAuthorization();
    expect(third).not.toBe(second);
    expect(other.clientInformation()).toBeUndefined();
    await other.cancelAuthorization();
  });
});
