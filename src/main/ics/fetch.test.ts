import { describe, expect, it } from 'vitest';

import { fetchIcsText } from './fetch';

function fakeFetch(handler: (url: string) => { status: number; body: string }): typeof fetch {
  return ((url: string) => {
    const { status, body } = handler(url);
    return Promise.resolve(new Response(body, { status }));
  }) as typeof fetch;
}

describe('fetchIcsText', () => {
  it('returns the body when the response is ok and looks like a calendar', async () => {
    const ics = 'BEGIN:VCALENDAR\r\nEND:VCALENDAR';
    const text = await fetchIcsText(
      'https://example.com/cal.ics',
      fakeFetch(() => ({ status: 200, body: ics })),
    );
    expect(text).toBe(ics);
  });

  it('trims the body before checking for BEGIN:VCALENDAR', async () => {
    const ics = '\n\n  BEGIN:VCALENDAR\r\nEND:VCALENDAR';
    const text = await fetchIcsText(
      'https://example.com/cal.ics',
      fakeFetch(() => ({ status: 200, body: ics })),
    );
    expect(text).toBe(ics);
  });

  it('rejects a non-2xx response with a short message that omits the URL', async () => {
    const err = await fetchIcsText(
      'https://example.com/secret-token-in-url.ics',
      fakeFetch(() => ({ status: 404, body: 'not found' })),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe('the calendar link was rejected with status 404');
    expect((err as Error).message).not.toContain('secret-token-in-url');
  });

  it('rejects a body that is not an ICS calendar', async () => {
    await expect(
      fetchIcsText(
        'https://example.com/cal.ics',
        fakeFetch(() => ({ status: 200, body: '<html>not a calendar</html>' })),
      ),
    ).rejects.toThrow(/did not return an ICS calendar/);
  });

  it('rejects a non-http(s) URL without making a request', async () => {
    let called = false;
    await expect(
      fetchIcsText(
        'file:///etc/passwd',
        fakeFetch(() => {
          called = true;
          return { status: 200, body: 'BEGIN:VCALENDAR' };
        }),
      ),
    ).rejects.toThrow(/http or https/);
    expect(called).toBe(false);
  });

  it('rejects an unparseable URL', async () => {
    await expect(
      fetchIcsText(
        'not a url',
        fakeFetch(() => ({ status: 200, body: '' })),
      ),
    ).rejects.toThrow(/http or https/);
  });
});
