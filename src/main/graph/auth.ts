import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';

import { z } from 'zod';

import type { SecretStore } from '../mcp';

export interface GraphAuthOptions {
  clientId: string;
  tenant: string;
  secrets: SecretStore;
  openExternal: (url: string) => Promise<void> | void;
  fetchFn?: typeof fetch;
  now?: () => number;
}

// Scoped by client id and tenant on purpose. One fixed key would let tokens minted for one
// app registration keep working after the user pastes another one, under the wrong account.
function tokensKey(clientId: string, tenant: string): string {
  const scope = `${clientId}.${tenant}`.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80);
  return `outlook.tokens.${scope}`;
}
const SCOPE = 'Calendars.Read offline_access';
const CALLBACK_PATH = '/callback';
const TIMEOUT_MS = 5 * 60_000;
const REFRESH_SKEW_MS = 60_000;

const DONE_PAGE =
  '<!doctype html><meta charset="utf-8"><title>Wisp</title>' +
  '<p style="font:16px sans-serif;margin:3em">Wisp is connected. You can close this tab.</p>';

const TokensSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresAt: z.number(),
});
type StoredTokens = z.infer<typeof TokensSchema>;

const TokenResponseSchema = z.looseObject({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  expires_in: z.number(),
});
type TokenResponse = z.infer<typeof TokenResponseSchema>;

interface PendingCallback {
  promise: Promise<string>;
  resolve: (code: string) => void;
  reject: (err: Error) => void;
}

function pendingCallback(): PendingCallback {
  let resolve: PendingCallback['resolve'] = () => undefined;
  let reject: PendingCallback['reject'] = () => undefined;
  const promise = new Promise<string>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  // Cancelling before anyone awaits the promise must not surface as an unhandled rejection.
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

function base64url(input: Buffer): string {
  return input.toString('base64url');
}

function errorMessage(raw: unknown): string | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const body = raw as { error_description?: unknown; error?: unknown };
  if (typeof body.error_description === 'string') return body.error_description;
  if (typeof body.error === 'string') return body.error;
  return undefined;
}

function isInvalidGrant(raw: unknown): boolean {
  return (
    typeof raw === 'object' &&
    raw !== null &&
    (raw as { error?: unknown }).error === 'invalid_grant'
  );
}

/** Thrown when Entra ID rejects the stored refresh token, so the user has to sign in again. */
export class LostGrantError extends Error {}

export class GraphAuth {
  private server?: Server;
  private pending?: PendingCallback;
  private currentState?: string;
  private authorizing?: Promise<void>;

  constructor(private readonly opts: GraphAuthOptions) {}

  hasTokens(): boolean {
    return this.loadTokens() !== undefined;
  }

  signOut(): void {
    this.opts.secrets.delete(this.tokensKey);
  }

  // Concurrent calls share the one flow in progress so a second click never opens a second
  // loopback server or a second browser tab.
  authorize(): Promise<void> {
    this.authorizing ??= this.runAuthorize().finally(() => {
      this.authorizing = undefined;
    });
    return this.authorizing;
  }

  async cancel(): Promise<void> {
    this.pending?.reject(new Error('authorization cancelled'));
    await this.closeServer();
  }

  async accessToken(): Promise<string> {
    const tokens = this.loadTokens();
    if (tokens === undefined) {
      throw new Error('Outlook is not connected.');
    }
    const now = this.opts.now?.() ?? Date.now();
    if (tokens.expiresAt - now > REFRESH_SKEW_MS) return tokens.accessToken;
    return this.refresh(tokens.refreshToken);
  }

  private get tokensKey(): string {
    return tokensKey(this.opts.clientId, this.tenant);
  }

  private get tenant(): string {
    return this.opts.tenant.trim() === '' ? 'common' : this.opts.tenant;
  }

  private async runAuthorize(): Promise<void> {
    const verifier = base64url(randomBytes(32));
    const challenge = base64url(createHash('sha256').update(verifier).digest());
    const state = randomBytes(16).toString('hex');
    const redirectUri = await this.openServer(state);
    try {
      await this.opts.openExternal(this.authorizeUrl(redirectUri, state, challenge));
      const code = await this.waitForCallback();
      await this.exchangeCode(code, verifier, redirectUri);
    } finally {
      await this.closeServer();
    }
  }

  private authorizeUrl(redirectUri: string, state: string, challenge: string): string {
    const url = new URL(`https://login.microsoftonline.com/${this.tenant}/oauth2/v2.0/authorize`);
    url.searchParams.set('client_id', this.opts.clientId);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_mode', 'query');
    url.searchParams.set('scope', SCOPE);
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    return url.toString();
  }

  private async openServer(state: string): Promise<string> {
    await this.closeServer();
    const server = createServer((req, res) => {
      this.handleCallback(req, res);
    });
    // A public client may register any localhost port, so the OS picks one and it goes
    // straight into the redirect_uri used for both the authorize request and this server.
    const port = await listen(server, 0);
    this.server = server;
    this.currentState = state;
    this.pending = pendingCallback();
    return `http://localhost:${port}${CALLBACK_PATH}`;
  }

  private handleCallback(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== CALLBACK_PATH) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
      return;
    }
    const error = url.searchParams.get('error');
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');

    let failure: string | undefined;
    if (error !== null) {
      failure = url.searchParams.get('error_description') ?? error;
    } else if (state !== this.currentState) {
      failure = 'sign-in failed: state mismatch';
    } else if (code === null || code === '') {
      failure = 'sign-in failed: no authorization code in callback';
    }

    res.setHeader('connection', 'close');
    if (failure !== undefined) {
      res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }).end(failure);
      this.pending?.reject(new Error(failure));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(DONE_PAGE);
    this.pending?.resolve(code ?? '');
  }

  private waitForCallback(): Promise<string> {
    const pending = this.pending;
    if (pending === undefined) throw new Error('loopback server was not started');
    const timer = setTimeout(() => {
      pending.reject(new Error('sign-in timed out'));
    }, TIMEOUT_MS);
    return pending.promise.finally(() => {
      clearTimeout(timer);
    });
  }

  private async closeServer(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    this.currentState = undefined;
    this.pending = undefined;
    if (server === undefined) return;
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
      server.closeAllConnections();
    });
  }

  private async exchangeCode(code: string, verifier: string, redirectUri: string): Promise<void> {
    const body = new URLSearchParams({
      client_id: this.opts.clientId,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
      scope: SCOPE,
    });
    const json = await this.tokenRequest(body);
    this.storeTokens(json);
  }

  private async refresh(refreshToken: string): Promise<string> {
    const body = new URLSearchParams({
      client_id: this.opts.clientId,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      scope: SCOPE,
    });
    const json = await this.tokenRequest(body, refreshToken);
    return this.storeTokens(json, refreshToken).accessToken;
  }

  private async tokenRequest(
    body: URLSearchParams,
    currentRefreshToken?: string,
  ): Promise<TokenResponse> {
    const fetchFn = this.opts.fetchFn ?? fetch;
    const res = await fetchFn(
      `https://login.microsoftonline.com/${this.tenant}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      },
    );
    const raw: unknown = await res.json().catch(() => undefined);
    if (!res.ok) {
      // A refresh token that Entra ID has revoked cannot be retried; clearing it here is what
      // makes hasTokens() go false so the UI offers sign-in again instead of failing forever.
      if (currentRefreshToken !== undefined && isInvalidGrant(raw)) {
        this.signOut();
        throw new LostGrantError(errorMessage(raw) ?? 'the sign-in was revoked');
      }
      throw new Error(errorMessage(raw) ?? `sign-in failed with status ${res.status}`);
    }
    const parsed = TokenResponseSchema.safeParse(raw);
    if (!parsed.success) throw new Error('unexpected response from the Microsoft sign-in service');
    return parsed.data;
  }

  private storeTokens(json: TokenResponse, fallbackRefreshToken?: string): StoredTokens {
    const refreshToken = json.refresh_token ?? fallbackRefreshToken;
    if (refreshToken === undefined) {
      throw new Error('sign-in response did not include a refresh token');
    }
    const now = this.opts.now?.() ?? Date.now();
    const tokens: StoredTokens = {
      accessToken: json.access_token,
      refreshToken,
      expiresAt: now + json.expires_in * 1000,
    };
    this.opts.secrets.set(this.tokensKey, tokens);
    return tokens;
  }

  private loadTokens(): StoredTokens | undefined {
    return this.opts.secrets.get(this.tokensKey, (raw) => {
      const parsed = TokensSchema.safeParse(raw);
      return parsed.success ? parsed.data : undefined;
    });
  }
}
