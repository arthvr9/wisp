import type { SpeechConfig, SpeechRequest } from '../../shared/speech';
import { sanitizeLine } from './prompt';
import { anthropicProvider, openAiCompatibleProvider } from './providers';
import type { SpeechProvider } from './providers';

export { buildPrompt, sanitizeLine } from './prompt';
export { anthropicProvider, openAiCompatibleProvider, DEFAULT_ANTHROPIC_MODEL } from './providers';
export type { SpeechProvider } from './providers';
export { detectOllama } from './ollama';

export const SPEECH_TIMEOUT_MS = 2000;
export const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434/v1';

export interface SpeechResult {
  text: string;
  source: 'model' | 'fallback';
  latencyMs: number;
  error?: string;
}

export async function speak(
  provider: SpeechProvider | undefined,
  request: SpeechRequest,
  opts: { timeoutMs?: number; now?: () => number } = {},
): Promise<SpeechResult> {
  const now = opts.now ?? Date.now;
  const started = now();
  const fallback = (error: string): SpeechResult => ({
    text: request.fallback,
    source: 'fallback',
    latencyMs: now() - started,
    error,
  });
  if (!provider) return fallback('no provider');

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error('timeout'));
      controller.abort();
    }, opts.timeoutMs ?? SPEECH_TIMEOUT_MS);
  });

  try {
    const raw = await Promise.race([provider.generate(request, controller.signal), timeout]);
    const text = sanitizeLine(raw);
    if (text === undefined) return fallback('rejected by sanitizer');
    return { text, source: 'model', latencyMs: now() - started };
  } catch (error) {
    return fallback(error instanceof Error ? error.message : String(error));
  } finally {
    clearTimeout(timer);
  }
}

export function providerFor(
  config: SpeechConfig,
  apiKey: string | undefined,
): SpeechProvider | undefined {
  switch (config.provider) {
    case 'off':
      return undefined;
    case 'ollama':
      if (!config.model) return undefined;
      return openAiCompatibleProvider({
        kind: 'ollama',
        baseUrl: config.baseUrl || DEFAULT_OLLAMA_BASE_URL,
        model: config.model,
      });
    case 'openai-compatible':
      if (!config.baseUrl || !config.model) return undefined;
      return openAiCompatibleProvider({ baseUrl: config.baseUrl, model: config.model, apiKey });
    case 'anthropic':
      if (!apiKey) return undefined;
      return anthropicProvider({ apiKey, model: config.model });
  }
}
