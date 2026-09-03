import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';

import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import {
  OAuthClientInformationSchema,
  OAuthTokensSchema,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import { z } from 'zod';

import type { SecretStore } from './secrets';

export interface LoopbackOAuthProviderOptions {
  serverKey: string;
  secrets: SecretStore;
  openExternal: (url: string) => Promise<void> | void;
  clientName: string;
}

const StoredClientSchema = OAuthClientInformationSchema.extend({
  redirect_uris: z.array(z.string()).optional(),
});
type StoredClient = z.infer<typeof StoredClientSchema>;

const DEFAULT_TIMEOUT_MS = 300_000;
const CALLBACK_PATH = '/callback';
const DONE_PAGE =
  '<!doctype html><meta charset="utf-8"><title>Wisp</title>' +
  '<p style="font:16px sans-serif;margin:3em">Wisp is connected. You can close this tab.</p>';

interface Pending {
  promise: Promise<string>;
  resolve: (code: string) => void;
  reject: (err: Error) => void;
}

function pending(): Pending {
  let resolve: Pending['resolve'] = () => undefined;
  let reject: Pending['reject'] = () => undefined;
  const promise = new Promise<string>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  // A cancelled session rejects with nobody awaiting yet; that must not count as unhandled.
  promise.catch(() => undefined);
  return { promise, resolve, reject };
}

function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (err: Error): void => {
      server.off('listening', onListening);
      reject(err);
    };
    const onListening = (): void => {
      server.off('error', onError);
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('loopback server has no TCP address'));
        return;
      }
      resolve(address.port);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, '127.0.0.1');
  });
}

export class LoopbackOAuthProvider implements OAuthClientProvider {
  private readonly keys: { client: string; tokens: string; verifier: string };
  private callbackUrl: string;
  private server?: Server;
  private callback?: Pending;
  private currentState?: string;

  constructor(private readonly opts: LoopbackOAuthProviderOptions) {
    this.keys = {
      client: `${opts.serverKey}.client`,
      tokens: `${opts.serverKey}.tokens`,
      verifier: `${opts.serverKey}.verifier`,
    };
    this.callbackUrl = this.loadClient()?.redirect_uris?.[0] ?? `http://127.0.0.1${CALLBACK_PATH}`;
  }

  get redirectUrl(): string {
    return this.callbackUrl;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: this.opts.clientName,
      redirect_uris: [this.callbackUrl],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: 'read',
    };
  }

  state(): string {
    if (this.currentState === undefined) {
      throw new UnauthorizedError('interactive authorization was not started');
    }
    return this.currentState;
  }

  clientInformation(): OAuthClientInformationMixed | undefined {
    return this.loadClient();
  }

  saveClientInformation(info: OAuthClientInformationMixed): void {
    this.opts.secrets.set(this.keys.client, info);
  }

  tokens(): OAuthTokens | undefined {
    return this.opts.secrets.get(this.keys.tokens, (raw) => {
      const parsed = OAuthTokensSchema.safeParse(raw);
      return parsed.success ? parsed.data : undefined;
    });
  }

  saveTokens(tokens: OAuthTokens): void {
    this.opts.secrets.set(this.keys.tokens, tokens);
  }

  hasTokens(): boolean {
    return this.tokens() !== undefined;
  }

  saveCodeVerifier(verifier: string): void {
    this.opts.secrets.set(this.keys.verifier, verifier);
  }

  codeVerifier(): string {
    const verifier = this.opts.secrets.get(this.keys.verifier, (raw) =>
      typeof raw === 'string' ? raw : undefined,
    );
    if (verifier === undefined) throw new Error('no PKCE code verifier saved');
    return verifier;
  }

  async redirectToAuthorization(url: URL): Promise<void> {
    if (this.server === undefined) {
      throw new UnauthorizedError('interactive authorization was not started');
    }
    await this.opts.openExternal(url.toString());
  }

  invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery'): void {
    const { secrets } = this.opts;
    if (scope === 'all' || scope === 'client') secrets.delete(this.keys.client);
    if (scope === 'all' || scope === 'tokens') secrets.delete(this.keys.tokens);
    if (scope === 'all' || scope === 'verifier') secrets.delete(this.keys.verifier);
  }

  clear(): void {
    this.invalidateCredentials('all');
  }

  // The loopback port is chosen here and ends up in redirect_uris, both for dynamic client
  // registration and for the authorization request. The SDK reads redirectUrl only while it
  // runs auth(), so the server must be listening before the transport connects.
  async beginAuthorization(): Promise<string> {
    await this.cancelAuthorization();
    const server = createServer((req, res) => {
      this.handle(req, res);
    });
    const preferred = this.registeredPort();
    let port: number;
    try {
      port = await listen(server, preferred);
    } catch (err) {
      if (preferred === 0) throw err;
      port = await listen(server, 0);
    }
    this.callbackUrl = `http://127.0.0.1:${port}${CALLBACK_PATH}`;

    const client = this.loadClient();
    if (client?.redirect_uris !== undefined && !client.redirect_uris.includes(this.callbackUrl)) {
      // The registration is bound to a port we could not reuse; dropping it makes the SDK
      // register again with the current redirect URI.
      this.opts.secrets.delete(this.keys.client);
    }

    this.server = server;
    this.currentState = randomBytes(16).toString('hex');
    this.callback = pending();
    return this.callbackUrl;
  }

  async waitForCallback(timeoutMs = DEFAULT_TIMEOUT_MS): Promise<string> {
    const callback = this.callback;
    if (callback === undefined) throw new Error('beginAuthorization() was not called');
    const timer = setTimeout(() => {
      callback.reject(new Error('authorization timed out'));
    }, timeoutMs);
    try {
      return await callback.promise;
    } finally {
      clearTimeout(timer);
      await this.cancelAuthorization();
    }
  }

  async cancelAuthorization(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    this.callback?.reject(new Error('authorization cancelled'));
    this.callback = undefined;
    this.currentState = undefined;
    if (server === undefined) return;
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
      server.closeAllConnections();
    });
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? '/', this.callbackUrl);
    if (url.pathname !== CALLBACK_PATH) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
      return;
    }
    const callback = this.callback;
    const error = url.searchParams.get('error');
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');

    let failure: string | undefined;
    if (error !== null) {
      const description = url.searchParams.get('error_description');
      failure = `authorization failed: ${error}${description === null ? '' : `, ${description}`}`;
    } else if (state !== this.currentState) {
      failure = 'authorization failed: state mismatch';
    } else if (code === null || code === '') {
      failure = 'authorization failed: no code in callback';
    }

    res.setHeader('connection', 'close');
    if (failure !== undefined) {
      res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }).end(failure);
      callback?.reject(new Error(failure));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(DONE_PAGE);
    callback?.resolve(code ?? '');
  }

  private loadClient(): StoredClient | undefined {
    return this.opts.secrets.get(this.keys.client, (raw) => {
      const parsed = StoredClientSchema.safeParse(raw);
      return parsed.success ? parsed.data : undefined;
    });
  }

  private registeredPort(): number {
    const registered = this.loadClient()?.redirect_uris?.[0];
    if (registered === undefined) return 0;
    try {
      const url = new URL(registered);
      return url.hostname === '127.0.0.1' && url.port !== '' ? Number(url.port) : 0;
    } catch {
      return 0;
    }
  }
}
