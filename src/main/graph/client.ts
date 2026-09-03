const BASE_URL = 'https://graph.microsoft.com/v1.0';
const TIMEOUT_MS = 15_000;

export class GraphError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'GraphError';
  }
}

export interface GraphClient {
  get<T>(
    path: string,
    query?: Record<string, string>,
    headers?: Record<string, string>,
  ): Promise<T>;
}

function extractMessage(raw: unknown): string | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const error = (raw as { error?: unknown }).error;
  if (typeof error !== 'object' || error === null) return undefined;
  const message = (error as { message?: unknown }).message;
  return typeof message === 'string' ? message : undefined;
}

export function graphClient(
  auth: { accessToken(): Promise<string> },
  fetchFn: typeof fetch = fetch,
): GraphClient {
  return {
    async get<T>(
      path: string,
      query?: Record<string, string>,
      headers?: Record<string, string>,
    ): Promise<T> {
      const url = new URL(path.startsWith('http') ? path : `${BASE_URL}${path}`);
      if (query !== undefined) {
        for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
      }
      const token = await auth.accessToken();
      const res = await fetchFn(url.toString(), {
        headers: { authorization: `Bearer ${token}`, ...headers },
        // AbortSignal.timeout needs no manual timer or cleanup on the success path.
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const body: unknown = await res.json().catch(() => undefined);
      if (!res.ok) {
        throw new GraphError(
          res.status,
          extractMessage(body) ?? `Graph request failed with status ${res.status}`,
        );
      }
      return body as T;
    },
  };
}
