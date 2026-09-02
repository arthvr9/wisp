import type { Mood } from './mood';

export type SpeechProviderKind = 'off' | 'ollama' | 'openai-compatible' | 'anthropic';

export interface SpeechConfig {
  provider: SpeechProviderKind;
  baseUrl: string;
  model: string;
}

export type SpeechEvent = 'nudge' | 'celebrate' | 'hello' | 'sleepy' | 'poke';

export interface SpeechRequest {
  event: SpeechEvent;
  name: string;
  mood: Mood;
  fallback: string;
  context: {
    title?: string;
    minutesLeft?: number;
    kind?: string;
    count?: number;
  };
}

export interface SpeechStatus {
  provider: SpeechProviderKind;
  ollamaDetected: boolean;
  ollamaModels: string[];
  hasApiKey: boolean;
  lastError?: string;
  lastLatencyMs?: number;
  lastSource?: 'model' | 'fallback';
}
