const MAX_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 15_000;

function parseHttpUrl(url: string): URL | undefined {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed : undefined;
  } catch {
    return undefined;
  }
}

const TOO_LARGE = 'the calendar is larger than this app will read';

// A published calendar with years of history can be tens of megabytes, and none of it past the
// window is useful. The header is a hint the server may not send, so the body is read in
// chunks and abandoned as soon as it passes the cap, rather than buffered whole and measured.
async function readCapped(res: Response): Promise<string> {
  const body = res.body;
  if (body === null) return '';
  const decoder = new TextDecoder();
  // The DOM lib types Response.body as a stream of any, so the chunk type is stated here.
  const reader = (body as ReadableStream<Uint8Array>).getReader();
  let size = 0;
  let text = '';
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_BYTES) throw new Error(TOO_LARGE);
      text += decoder.decode(chunk.value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return text + decoder.decode();
}

export async function fetchIcsText(url: string, fetchFn: typeof fetch = fetch): Promise<string> {
  const parsed = parseHttpUrl(url);
  if (parsed === undefined) {
    throw new Error('the calendar link must be an http or https URL');
  }

  const res = await fetchFn(parsed.toString(), {
    // AbortSignal.timeout needs no manual timer or cleanup on the success path.
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    // Never include the URL in an error: a published calendar link is a bearer capability,
    // and this message is exactly the kind of thing a log or an error dialog keeps around.
    throw new Error(`the calendar link was rejected with status ${res.status}`);
  }

  const length = Number(res.headers.get('content-length') ?? '0');
  if (length > MAX_BYTES) throw new Error(TOO_LARGE);
  const text = await readCapped(res);
  if (!text.trim().startsWith('BEGIN:VCALENDAR')) {
    throw new Error('the calendar link did not return an ICS calendar');
  }
  return text;
}
