import type { SecretStore } from './mcp';
import { providerFor, speak } from './speech';
import type { SpeechProvider, SpeechResult } from './speech';
import { detectOllama } from './speech/ollama';
import type { Mood } from '../shared/mood';
import type { SpeechConfig, SpeechEvent, SpeechRequest, SpeechStatus } from '../shared/speech';

const KEY = 'speech.apiKey';

export class Voice {
  private provider: SpeechProvider | undefined;
  private status: SpeechStatus;
  private config: SpeechConfig;

  constructor(
    private readonly secrets: SecretStore,
    config: SpeechConfig,
    private readonly onStatus: (status: SpeechStatus) => void,
  ) {
    this.config = config;
    this.status = {
      provider: config.provider,
      ollamaDetected: false,
      ollamaModels: [],
      hasApiKey: this.apiKey() !== undefined,
    };
    this.rebuild();
  }

  async start(): Promise<void> {
    const found = await detectOllama();
    this.status = { ...this.status, ollamaDetected: found.found, ollamaModels: found.models };
    this.publish();
  }

  configure(config: SpeechConfig): void {
    this.config = config;
    this.rebuild();
    this.publish();
  }

  setApiKey(key: string): SpeechStatus {
    const trimmed = key.trim();
    if (trimmed.length === 0) this.secrets.delete(KEY);
    else this.secrets.set(KEY, trimmed);
    this.rebuild();
    this.publish();
    return this.status;
  }

  current(): SpeechStatus {
    return this.status;
  }

  async say(
    event: SpeechEvent,
    name: string,
    mood: Mood,
    fallback: string,
    context: SpeechRequest['context'] = {},
  ): Promise<SpeechResult> {
    const result = await speak(this.provider, { event, name, mood, fallback, context });
    this.status = {
      ...this.status,
      lastLatencyMs: result.latencyMs,
      lastSource: result.source,
      ...(result.error === undefined ? {} : { lastError: result.error }),
    };
    if (result.error === undefined && this.provider !== undefined) delete this.status.lastError;
    this.publish();
    return result;
  }

  private apiKey(): string | undefined {
    return this.secrets.get(KEY, (raw) => (typeof raw === 'string' ? raw : undefined));
  }

  private rebuild(): void {
    this.provider = providerFor(this.config, this.apiKey());
    this.status = {
      ...this.status,
      provider: this.config.provider,
      hasApiKey: this.apiKey() !== undefined,
    };
  }

  private publish(): void {
    this.onStatus(this.status);
  }
}
