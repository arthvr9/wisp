import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

import type { SpeechProviderKind, SpeechRequest } from '../../shared/speech';
import { buildPrompt } from './prompt';

export interface SpeechProvider {
  readonly kind: SpeechProviderKind;
  generate(request: SpeechRequest, signal: AbortSignal): Promise<string>;
}

export const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-5';

const completionSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string().nullable() }) })).min(1),
});

export function openAiCompatibleProvider(opts: {
  baseUrl: string;
  model: string;
  apiKey?: string;
  fetchFn?: typeof fetch;
  kind?: SpeechProviderKind;
}): SpeechProvider {
  const fetchFn = opts.fetchFn ?? fetch;
  const url = `${opts.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  return {
    kind: opts.kind ?? 'openai-compatible',
    async generate(request, signal) {
      const { system, user } = buildPrompt(request);
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (opts.apiKey) headers.Authorization = `Bearer ${opts.apiKey}`;
      const response = await fetchFn(url, {
        method: 'POST',
        headers,
        signal,
        body: JSON.stringify({
          model: opts.model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          max_tokens: 60,
          temperature: 0.8,
          stream: false,
        }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const parsed = completionSchema.safeParse(await response.json());
      if (!parsed.success) throw new Error('unexpected response shape');
      const content = parsed.data.choices[0]?.message.content;
      if (content === null || content === undefined) throw new Error('empty completion');
      return content;
    },
  };
}

export function anthropicProvider(opts: { apiKey: string; model: string }): SpeechProvider {
  const client = new Anthropic({ apiKey: opts.apiKey, timeout: 2000, maxRetries: 0 });
  const model = opts.model || DEFAULT_ANTHROPIC_MODEL;
  return {
    kind: 'anthropic',
    async generate(request, signal) {
      const { system, user } = buildPrompt(request);
      try {
        const response = await client.messages.create(
          {
            model,
            max_tokens: 100,
            system,
            output_config: { effort: 'low' },
            messages: [{ role: 'user', content: user }],
          },
          { signal },
        );
        if (response.stop_reason === 'refusal') throw new Error('refused');
        return response.content
          .filter((block) => block.type === 'text')
          .map((block) => block.text)
          .join('');
      } catch (error) {
        throw new Error(describeAnthropicError(error), { cause: error });
      }
    },
  };
}

function describeAnthropicError(error: unknown): string {
  if (error instanceof Anthropic.AuthenticationError) return 'invalid API key';
  if (error instanceof Anthropic.RateLimitError) return 'rate limited';
  if (error instanceof Anthropic.APIUserAbortError) return 'aborted';
  if (error instanceof Anthropic.APIConnectionTimeoutError) return 'timed out';
  if (error instanceof Anthropic.APIError) {
    return error.status === undefined ? 'connection failed' : `API error ${error.status}`;
  }
  return error instanceof Error ? error.message : String(error);
}
