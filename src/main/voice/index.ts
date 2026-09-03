import type { SecretStore } from '../mcp';
import type { Mood } from '../../shared/mood';
import type { SpeechConfig, SpeechEvent, SpeechRequest, SpeechStatus } from '../../shared/speech';

export interface SpokenLine {
  text: string;
  source: 'model' | 'fallback';
  latencyMs: number;
}

// The only surface the rest of the app knows about. Main never imports src/main/speech; the
// model-backed implementation loads it on demand, so with the provider off neither the
// provider adapters nor the Anthropic SDK are ever loaded. Deleting speech/ and voice/model.ts
// and returning silentVoice() from createVoice is enough to remove the feature.
export interface Voice {
  start(): Promise<void>;
  configure(config: SpeechConfig): void;
  setApiKey(key: string): Promise<SpeechStatus>;
  current(): Promise<SpeechStatus>;
  say(
    event: SpeechEvent,
    name: string,
    mood: Mood,
    fallback: string,
    context?: SpeechRequest['context'],
  ): Promise<SpokenLine>;
}

export function silentVoice(): Voice {
  const status: SpeechStatus = {
    provider: 'off',
    ollamaDetected: false,
    ollamaModels: [],
    hasApiKey: false,
  };
  return {
    start: () => Promise.resolve(),
    configure: () => undefined,
    setApiKey: () => Promise.resolve(status),
    current: () => Promise.resolve(status),
    say: (_event, _name, _mood, fallback) =>
      Promise.resolve({ text: fallback, source: 'fallback', latencyMs: 0 }),
  };
}

export function createVoice(
  secrets: SecretStore,
  config: SpeechConfig,
  onStatus: (status: SpeechStatus) => void,
): Voice {
  return lazyVoice(secrets, config, onStatus);
}

// Settings asks for the status every time it opens, and with the voice off that must not drag
// in the provider adapters. Ollama detection is its own small module with no SDK behind it.
async function offStatus(): Promise<SpeechStatus> {
  const { detectOllama } = await import('../speech/ollama');
  const found = await detectOllama();
  return {
    provider: 'off',
    ollamaDetected: found.found,
    ollamaModels: found.models,
    hasApiKey: false,
  };
}

function lazyVoice(
  secrets: SecretStore,
  initial: SpeechConfig,
  onStatus: (status: SpeechStatus) => void,
): Voice {
  let config = initial;
  let loaded: Promise<Voice> | undefined;
  const silent = silentVoice();

  const load = (): Promise<Voice> => {
    loaded ??= import('./model').then((m) => {
      const voice = m.createModelVoice(secrets, config, onStatus);
      return voice.start().then(() => voice);
    });
    return loaded;
  };
  // Settings opening or a provider being chosen is what pulls the module in.
  const active = (): Promise<Voice> =>
    config.provider === 'off' && !loaded ? Promise.resolve(silent) : load();

  return {
    start: () => Promise.resolve(),
    configure(next) {
      config = next;
      if (next.provider !== 'off' || loaded) {
        void load().then((v) => {
          v.configure(next);
        });
      }
    },
    setApiKey: (key) => load().then((v) => v.setApiKey(key)),
    current: () => (loaded ? load().then((v) => v.current()) : offStatus()),
    say: (event, name, mood, fallback, context) =>
      active().then((v) => v.say(event, name, mood, fallback, context)),
  };
}
