import { z } from 'zod';

const tagsSchema = z.object({ models: z.array(z.object({ name: z.string() })) });

export async function detectOllama(
  baseUrl = 'http://localhost:11434',
  fetchFn: typeof fetch = fetch,
): Promise<{ found: boolean; models: string[] }> {
  const missing = { found: false, models: [] };
  try {
    const url = `${baseUrl.replace(/\/+$/, '')}/api/tags`;
    const response = await fetchFn(url, { signal: AbortSignal.timeout(1500) });
    if (!response.ok) return missing;
    const parsed = tagsSchema.safeParse(await response.json());
    if (!parsed.success) return missing;
    return { found: true, models: parsed.data.models.map((m) => m.name) };
  } catch {
    return missing;
  }
}
