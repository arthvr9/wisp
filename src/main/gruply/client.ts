const TIMEOUT_MS = 15_000;

export class GruplyError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'GruplyError';
  }
}

export interface GruplyClient {
  get<T>(path: string, query?: Record<string, string>): Promise<T>;
}

export interface GruplyClientOptions {
  baseUrl: string;
  token: () => string | undefined;
  fetchFn?: typeof fetch;
}

function extractMessage(raw: unknown): string | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const message = (raw as { message?: unknown }).message;
  return typeof message === 'string' ? message : undefined;
}

export function gruplyClient(opts: GruplyClientOptions): GruplyClient {
  const fetchFn = opts.fetchFn ?? fetch;
  return {
    async get<T>(path: string, query?: Record<string, string>): Promise<T> {
      const token = opts.token();
      if (token === undefined) {
        throw new GruplyError(401, 'Gruply has no API key configured');
      }
      const url = new URL(path.startsWith('http') ? path : `${opts.baseUrl}${path}`);
      if (query !== undefined) {
        for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
      }
      const res = await fetchFn(url.toString(), {
        headers: { authorization: `Bearer ${token}` },
        // AbortSignal.timeout needs no manual timer or cleanup on the success path.
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const body: unknown = await res.json().catch(() => undefined);
      if (!res.ok) {
        if (res.status === 401) {
          // Never echo the token back, even the rejected one, into an error a log might keep.
          throw new GruplyError(401, 'Gruply rejected the API key');
        }
        throw new GruplyError(
          res.status,
          extractMessage(body) ?? `Gruply request failed with status ${res.status}`,
        );
      }
      return body as T;
    },
  };
}
