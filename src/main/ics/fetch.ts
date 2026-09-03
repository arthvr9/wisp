const TIMEOUT_MS = 15_000;

function parseHttpUrl(url: string): URL | undefined {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed : undefined;
  } catch {
    return undefined;
  }
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

  const text = await res.text();
  if (!text.trim().startsWith('BEGIN:VCALENDAR')) {
    throw new Error('the calendar link did not return an ICS calendar');
  }
  return text;
}
