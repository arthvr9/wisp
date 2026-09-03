import { useEffect, useState } from 'react';
import type { ChangeEvent, KeyboardEvent } from 'react';

import type { Config } from '../../shared/config';
import { translator } from '../../shared/i18n';
import type { Translate } from '../../shared/i18n';
import type { MessageKey } from '../../shared/i18n/en';
import type { EnvironmentInfo } from '../../shared/ipc';
import { MASCOTS, isMascot } from '../../shared/mascots';
import type { MascotName } from '../../shared/mascots';
import type { Mood } from '../../shared/mood';
import type { SignalSource, SignalsStatus } from '../../shared/signals';
import type { SpeechConfig, SpeechProviderKind, SpeechStatus } from '../../shared/speech';
import { CustomArtSection } from './CustomArtSection';

// Vite resolves this glob at build time, so every mascot's icon ships in the bundle.
const iconUrls = import.meta.glob<string>('../../../resources/icons/*/icon-256.png', {
  eager: true,
  import: 'default',
});

function mascotFromIconPath(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 2] ?? '';
}

const MASCOT_ICONS: Partial<Record<MascotName, string>> = {};
for (const [path, url] of Object.entries(iconUrls)) {
  const name = mascotFromIconPath(path);
  if (isMascot(name)) MASCOT_ICONS[name] = url;
}

// Falls back to wisp so a mascot whose art has not shipped yet still shows an icon.
function mascotIconUrl(name: MascotName): string | undefined {
  return MASCOT_ICONS[name] ?? MASCOT_ICONS.wisp;
}

const SAVED_VISIBLE_MS = 1500;
const NAME_MAX = 24;
const PROVIDERS: readonly SpeechProviderKind[] = [
  'off',
  'ollama',
  'openai-compatible',
  'anthropic',
];
const BASE_URL_PLACEHOLDER: Partial<Record<SpeechProviderKind, string>> = {
  'openai-compatible': 'https://integrate.api.nvidia.com/v1',
  ollama: 'http://localhost:11434/v1',
};

interface SpeechTestResult {
  text: string;
  source: 'model' | 'fallback';
  latencyMs: number;
}

interface VoiceSectionProps {
  t: Translate;
  speech: SpeechConfig;
  status: SpeechStatus | null;
  onSave: (patch: Partial<SpeechConfig>) => void;
  onStatus: (status: SpeechStatus) => void;
}

function VoiceSection({ t, speech, status, onSave, onStatus }: VoiceSectionProps) {
  const [baseUrlDraft, setBaseUrlDraft] = useState<string | null>(null);
  const [modelDraft, setModelDraft] = useState<string | null>(null);
  const [keyDraft, setKeyDraft] = useState('');
  const [result, setResult] = useState<SpeechTestResult | null>(null);
  const [busy, setBusy] = useState(false);

  const provider = speech.provider;
  const isCloud = provider === 'openai-compatible' || provider === 'anthropic';
  const ollamaDetected = status?.ollamaDetected === true;
  const ollamaModels = status?.ollamaModels ?? [];
  const providers: readonly SpeechProviderKind[] = ollamaDetected
    ? ['ollama', ...PROVIDERS.filter((p) => p !== 'ollama')]
    : PROVIDERS;
  const showModelSelect = provider === 'ollama' && ollamaModels.length > 0;

  function commit(key: 'baseUrl' | 'model', value: string | null) {
    if (key === 'baseUrl') setBaseUrlDraft(null);
    else setModelDraft(null);
    if (value === null) return;
    const trimmed = value.trim();
    if (trimmed !== speech[key]) onSave({ [key]: trimmed });
  }

  function saveKey() {
    const key = keyDraft.trim();
    if (key.length === 0) return;
    setBusy(true);
    void window.wisp
      .setSpeechApiKey(key)
      .then((next) => {
        onStatus(next);
        setKeyDraft('');
      })
      .finally(() => {
        setBusy(false);
      });
  }

  function test() {
    setBusy(true);
    setResult(null);
    void window.wisp
      .testSpeech()
      .then(setResult)
      .catch(() => {
        setResult(null);
      })
      .finally(() => {
        setBusy(false);
      });
  }

  return (
    <section className="field">
      <label htmlFor="speechProvider">{t('settings.speech')}</label>
      <p className="hint">{t('settings.speech.hint')}</p>
      <select
        id="speechProvider"
        value={provider}
        onChange={(e) => {
          onSave({ provider: e.target.value as SpeechProviderKind });
        }}
      >
        {providers.map((p) => (
          <option key={p} value={p}>
            {t(`settings.speech.provider.${p}`)}
          </option>
        ))}
      </select>
      {status && (
        <p className="hint">
          {t(ollamaDetected ? 'settings.speech.ollama.found' : 'settings.speech.ollama.missing')}
        </p>
      )}
      {provider === 'ollama' && <p className="hint">{t('settings.speech.local')}</p>}
      {isCloud && <p className="hint notice callout">{t('settings.speech.cloud')}</p>}

      {(provider === 'ollama' || provider === 'openai-compatible') && (
        <>
          <label className="inline" htmlFor="speechBaseUrl">
            {t('settings.speech.baseUrl')}
          </label>
          <input
            id="speechBaseUrl"
            type="text"
            value={baseUrlDraft ?? speech.baseUrl}
            placeholder={BASE_URL_PLACEHOLDER[provider]}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => {
              setBaseUrlDraft(e.target.value);
            }}
            onBlur={() => {
              commit('baseUrl', baseUrlDraft);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
          />
        </>
      )}

      {provider !== 'off' && (
        <>
          <label className="inline" htmlFor="speechModel">
            {t('settings.speech.model')}
          </label>
          {showModelSelect ? (
            <select
              id="speechModel"
              value={speech.model}
              onChange={(e) => {
                commit('model', e.target.value);
              }}
            >
              {!ollamaModels.includes(speech.model) && <option value={speech.model} />}
              {ollamaModels.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          ) : (
            <input
              id="speechModel"
              type="text"
              value={modelDraft ?? speech.model}
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => {
                setModelDraft(e.target.value);
              }}
              onBlur={() => {
                commit('model', modelDraft);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
              }}
            />
          )}
        </>
      )}

      {isCloud && (
        <>
          <label className="inline" htmlFor="speechApiKey">
            {t('settings.speech.apiKey')}
          </label>
          <div className="keyRow">
            <input
              id="speechApiKey"
              type="password"
              value={keyDraft}
              autoComplete="off"
              onChange={(e) => {
                setKeyDraft(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveKey();
              }}
            />
            <button type="button" disabled={busy || keyDraft.trim().length === 0} onClick={saveKey}>
              {t('settings.speech.apiKey.save')}
            </button>
          </div>
          {status?.hasApiKey && <p className="hint">{t('settings.speech.apiKey.set')}</p>}
        </>
      )}

      {provider !== 'off' && (
        <>
          <div className="actions">
            <button type="button" disabled={busy} onClick={test}>
              {t('settings.speech.test')}
            </button>
          </div>
          {result && (
            <p className="hint">
              {t('settings.speech.result', {
                source: result.source,
                ms: result.latencyMs,
                text: result.text,
              })}
            </p>
          )}
          {status?.lastError !== undefined && (
            <p className="hint notice">
              {t('settings.speech.error', { message: status.lastError })}
            </p>
          )}
        </>
      )}
    </section>
  );
}

export function SettingsPage() {
  const [config, setConfig] = useState<Config | null>(null);
  const [environment, setEnvironment] = useState<EnvironmentInfo | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [savedUntil, setSavedUntil] = useState<number | null>(null);
  const [signals, setSignals] = useState<SignalsStatus | null>(null);
  const [speech, setSpeech] = useState<SpeechStatus | null>(null);
  const [mood, setMood] = useState<Mood | null>(null);
  const [busy, setBusy] = useState(false);
  const [calendarUrlDraft, setCalendarUrlDraft] = useState<string | null>(null);
  const [gruplyEmailDraft, setGruplyEmailDraft] = useState<string | null>(null);
  const [gruplyKeyDraft, setGruplyKeyDraft] = useState('');
  const [secrets, setSecrets] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let alive = true;
    const applyConfig = (next: Config) => {
      if (!alive) return;
      setConfig(next);
      setNameDraft(next.name);
    };
    void window.wisp.getConfig().then(applyConfig);
    void window.wisp.getEnvironment().then((env) => {
      if (alive) setEnvironment(env);
    });
    void window.wisp.getSignalsStatus().then((s) => {
      if (alive) setSignals(s);
    });
    void window.wisp.secretStatus().then((s) => {
      if (alive) setSecrets(s);
    });
    void window.wisp.getSpeechStatus().then((s) => {
      if (alive) setSpeech(s);
    });
    void window.wisp.getMood().then((m) => {
      if (alive) setMood(m);
    });
    const unsubscribe = window.wisp.onConfigChanged(applyConfig);
    const unsubscribeSignals = window.wisp.onSignalsStatusChanged((s) => {
      if (alive) setSignals(s);
    });
    const unsubscribeSpeech = window.wisp.onSpeechStatusChanged((s) => {
      if (alive) setSpeech(s);
    });
    const unsubscribeMood = window.wisp.onMoodChanged((m) => {
      if (alive) setMood(m);
    });
    return () => {
      alive = false;
      unsubscribe();
      unsubscribeSignals();
      unsubscribeSpeech();
      unsubscribeMood();
    };
  }, []);

  useEffect(() => {
    if (savedUntil === null) return;
    const id = setTimeout(
      () => {
        setSavedUntil(null);
      },
      Math.max(0, savedUntil - Date.now()),
    );
    return () => {
      clearTimeout(id);
    };
  }, [savedUntil]);

  function save(patch: Partial<Config>) {
    void window.wisp.setConfig(patch).then((next) => {
      setConfig(next);
      setNameDraft(next.name);
      setSavedUntil(Date.now() + SAVED_VISIBLE_MS);
    });
  }

  function commitName() {
    if (!config) return;
    const name = nameDraft.trim().slice(0, NAME_MAX);
    if (name.length === 0 || name === config.name) {
      setNameDraft(config.name);
      return;
    }
    save({ name });
  }

  function onNameKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') e.currentTarget.blur();
    if (e.key === 'Escape' && config) setNameDraft(config.name);
  }

  function onToggle(key: 'autostart' | 'followCursor' | 'night' | 'music') {
    return (e: ChangeEvent<HTMLInputElement>) => {
      save({ [key]: e.target.checked });
    };
  }

  function connector(source: SignalSource, action: 'connect' | 'disconnect' | 'sync') {
    return () => {
      setBusy(true);
      const call =
        action === 'connect'
          ? window.wisp.connect(source)
          : action === 'disconnect'
            ? window.wisp.disconnect(source)
            : window.wisp.syncNow();
      void call.then(setSignals).finally(() => {
        setBusy(false);
      });
    };
  }

  if (!config) return <div className="page" />;

  const t = translator(config.locale, { name: config.name });
  const clock = (ms: number) =>
    new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

  function statusLine(
    status: SignalsStatus,
    source: SignalSource,
    connectedKey: MessageKey,
  ): string {
    const c = status.connectors[source];
    switch (c.state) {
      case 'disconnected':
        return t('settings.clickup.disconnected');
      case 'authorizing':
        return t('settings.clickup.authorizing');
      case 'connected':
        return (
          t(connectedKey, { count: c.signalCount }) +
          (c.lastSyncAt ? ' ' + t('settings.clickup.lastSync', { time: clock(c.lastSyncAt) }) : '')
        );
      case 'error':
        return t('settings.clickup.error', { message: c.message });
    }
  }

  function actions(source: SignalSource, connectable: boolean) {
    const state = signals?.connectors[source].state;
    const syncing =
      state === 'connected' || (state === 'error' && signals?.active.includes(source));
    if (syncing) {
      return (
        <div className="actions">
          <button type="button" disabled={busy} onClick={connector(source, 'sync')}>
            {t('settings.clickup.syncNow')}
          </button>
          <button type="button" disabled={busy} onClick={connector(source, 'disconnect')}>
            {t('settings.clickup.disconnect')}
          </button>
        </div>
      );
    }
    return (
      <div className="actions">
        <button
          type="button"
          className="primary"
          disabled={busy || !connectable || state === 'authorizing'}
          onClick={connector(source, 'connect')}
        >
          {t('settings.clickup.connect')}
        </button>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="header">
        <img className="icon" src={mascotIconUrl(config.mascot)} alt="" width={24} height={24} />
        <h1>{t('settings.title')}</h1>
        {mood && <span className="mood">{t('settings.mood', { mood: t(`mood.${mood}`) })}</span>}
      </header>

      <main>
        <section className="field">
          <label htmlFor="name">{t('settings.name')}</label>
          <input
            id="name"
            type="text"
            maxLength={NAME_MAX}
            value={nameDraft}
            onChange={(e) => {
              setNameDraft(e.target.value);
            }}
            onBlur={commitName}
            onKeyDown={onNameKeyDown}
            spellCheck={false}
            autoComplete="off"
          />
          <p className="hint">{t('settings.name.hint')}</p>
        </section>

        <section className="field">
          <span className="label">{t('settings.mascot')}</span>
          <div className="mascotRow" role="group" aria-label={t('settings.mascot')}>
            {MASCOTS.map((name) => (
              <button
                key={name}
                type="button"
                className={name === config.mascot ? 'mascotOption selected' : 'mascotOption'}
                aria-pressed={name === config.mascot}
                onClick={() => {
                  save({ mascot: name });
                }}
              >
                <img src={mascotIconUrl(name)} alt="" width={32} height={32} />
                <span>{t(`mascot.${name}`)}</span>
              </button>
            ))}
          </div>
          <p className="hint">{t('settings.mascot.hint')}</p>
        </section>

        <CustomArtSection
          t={t}
          customMascot={config.customMascot}
          onSelect={(slug) => {
            save({ customMascot: slug });
          }}
        />

        <section className="field">
          <label htmlFor="locale">{t('settings.language')}</label>
          <select id="locale" value={config.locale} disabled>
            <option value="en">{t('settings.language.en')}</option>
          </select>
        </section>

        <section className="field">
          <label className="check">
            <input type="checkbox" checked={config.autostart} onChange={onToggle('autostart')} />
            <span>{t('settings.autostart')}</span>
          </label>
          {environment && (
            <p className="hint">
              {t('settings.autostart.hint', { path: environment.autostartPath })}
            </p>
          )}
        </section>

        <section className="field">
          <label className="check">
            <input
              type="checkbox"
              checked={config.followCursor}
              onChange={onToggle('followCursor')}
            />
            <span>{t('settings.followCursor')}</span>
          </label>
          <p className="hint">{t('settings.followCursor.hint')}</p>
        </section>

        <section className="field">
          <label className="check">
            <input type="checkbox" checked={config.night} onChange={onToggle('night')} />
            <span>{t('settings.night')}</span>
          </label>
          <p className="hint">{t('settings.night.hint')}</p>
        </section>

        <section className="field">
          <label className="check">
            <input type="checkbox" checked={config.music} onChange={onToggle('music')} />
            <span>{t('settings.music')}</span>
          </label>
          <p className="hint">{t('settings.music.hint')}</p>
        </section>

        <section className="field">
          <span className="label">{t('settings.shortcut')}</span>
          <code className="shortcut">{environment?.shortcut ?? ''}</code>
          <p className="hint">{t('settings.shortcut.hint')}</p>
          {environment && !environment.shortcutRegistered && (
            <p className="hint notice">{t('settings.shortcut.unavailable')}</p>
          )}
        </section>

        <section className="field">
          <span className="label">{t('settings.clickup')}</span>
          <p className="hint">{t('settings.clickup.hint')}</p>
          {signals && (
            <p className={signals.connectors.clickup.state === 'error' ? 'hint notice' : 'hint'}>
              {statusLine(signals, 'clickup', 'settings.clickup.connected')}
              {signals.nextSyncAt && signals.connectors.clickup.state === 'connected'
                ? ' ' + t('settings.clickup.nextSync', { time: clock(signals.nextSyncAt) })
                : ''}
            </p>
          )}
          {signals && !signals.secretsEncrypted && (
            <p className="hint notice">{t('settings.clickup.secrets')}</p>
          )}
          {actions('clickup', true)}
          <label className="inline" htmlFor="dueSoon">
            {t('settings.clickup.dueSoon')}
          </label>
          <input
            id="dueSoon"
            type="number"
            min={1}
            max={1440}
            value={config.dueSoonMinutes}
            onChange={(e) => {
              const minutes = Number(e.target.value);
              if (Number.isFinite(minutes) && minutes >= 1 && minutes <= 1440) {
                save({ dueSoonMinutes: minutes });
              }
            }}
          />
        </section>

        <VoiceSection
          t={t}
          speech={config.speech}
          status={speech}
          onSave={(patch) => {
            save({ speech: { ...config.speech, ...patch } });
          }}
          onStatus={setSpeech}
        />

        <section className="field">
          <span className="label">{t('settings.calendar')}</span>
          <p className="hint">{t('settings.calendar.hint')}</p>
          {signals && (
            <p className={signals.connectors.calendar.state === 'error' ? 'hint notice' : 'hint'}>
              {statusLine(signals, 'calendar', 'settings.calendar.connected')}
            </p>
          )}
          <label className="inline" htmlFor="calendarUrl">
            {t('settings.calendar.url')}
          </label>
          <input
            id="calendarUrl"
            type="text"
            value={calendarUrlDraft ?? config.calendar.icsUrl}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => {
              setCalendarUrlDraft(e.target.value);
            }}
            onBlur={() => {
              if (calendarUrlDraft !== null) {
                save({ calendar: { ...config.calendar, icsUrl: calendarUrlDraft.trim() } });
                setCalendarUrlDraft(null);
              }
            }}
          />
          <p className="hint">{t('settings.calendar.url.hint')}</p>
          <p className="hint notice">{t('settings.calendar.url.secret')}</p>
          <p className="hint">{t('settings.calendar.url.cache')}</p>
          {config.calendar.icsUrl.length === 0 && (
            <p className="hint notice">{t('settings.calendar.needsUrl')}</p>
          )}
          {actions('calendar', config.calendar.icsUrl.length > 0)}
          <label className="inline" htmlFor="meetingWarn">
            {t('settings.calendar.warn')}
          </label>
          <input
            id="meetingWarn"
            type="number"
            min={0}
            max={120}
            value={config.calendar.warnMinutes}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n) && n >= 0 && n <= 120) {
                save({ calendar: { ...config.calendar, warnMinutes: n } });
              }
            }}
          />
          <label className="check">
            <input
              type="checkbox"
              checked={config.calendar.silenceDuringMeetings}
              onChange={(e) => {
                save({
                  calendar: { ...config.calendar, silenceDuringMeetings: e.target.checked },
                });
              }}
            />
            <span>{t('settings.calendar.silence')}</span>
          </label>
          <p className="hint">{t('settings.calendar.silence.hint')}</p>
        </section>

        <section className="field">
          <span className="label">{t('settings.gruply')}</span>
          <p className="hint">{t('settings.gruply.hint')}</p>
          {signals && (
            <p className={signals.connectors.gruply.state === 'error' ? 'hint notice' : 'hint'}>
              {statusLine(signals, 'gruply', 'settings.gruply.connected')}
            </p>
          )}
          <label className="inline" htmlFor="gruplyEmail">
            {t('settings.gruply.email')}
          </label>
          <input
            id="gruplyEmail"
            type="email"
            value={gruplyEmailDraft ?? config.gruply.email}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => {
              setGruplyEmailDraft(e.target.value);
            }}
            onBlur={() => {
              if (gruplyEmailDraft !== null) {
                save({ gruply: { ...config.gruply, email: gruplyEmailDraft.trim() } });
                setGruplyEmailDraft(null);
              }
            }}
          />
          <p className="hint">{t('settings.gruply.email.hint')}</p>
          <label className="inline" htmlFor="gruplyKey">
            {t('settings.gruply.key')}
          </label>
          <div className="keyRow">
            <input
              id="gruplyKey"
              type="password"
              value={gruplyKeyDraft}
              autoComplete="off"
              onChange={(e) => {
                setGruplyKeyDraft(e.target.value);
              }}
            />
            <button
              type="button"
              disabled={gruplyKeyDraft.length === 0}
              onClick={() => {
                void window.wisp.setSecret('gruply', gruplyKeyDraft).then((s) => {
                  setSecrets(s);
                  setGruplyKeyDraft('');
                });
              }}
            >
              {t('settings.speech.apiKey.save')}
            </button>
          </div>
          <p className="hint">{t('settings.gruply.key.hint')}</p>
          {secrets.gruplyFromEnv === true && (
            <p className="hint notice">{t('settings.gruply.key.fromEnv')}</p>
          )}
          {secrets.gruply === true && secrets.gruplyFromEnv !== true && (
            <p className="hint">{t('settings.gruply.key.set')}</p>
          )}
          {(config.gruply.email.length === 0 || secrets.gruply !== true) && (
            <p className="hint notice">{t('settings.gruply.needsSetup')}</p>
          )}
          {actions('gruply', config.gruply.email.length > 0 && secrets.gruply === true)}
        </section>

        <section className="field">
          <span className="label">{t('settings.nudges')}</span>
          <p className="hint">{t('settings.nudges.hint')}</p>
          <label className="check">
            <input
              type="checkbox"
              checked={config.quietHours.enabled}
              onChange={(e) => {
                save({ quietHours: { ...config.quietHours, enabled: e.target.checked } });
              }}
            />
            <span>{t('settings.quietHours')}</span>
          </label>
          <div className="row">
            <label className="inline" htmlFor="quietFrom">
              {t('settings.quietHours.from')}
            </label>
            <input
              id="quietFrom"
              type="time"
              value={config.quietHours.start}
              disabled={!config.quietHours.enabled}
              onChange={(e) => {
                if (e.target.value)
                  save({ quietHours: { ...config.quietHours, start: e.target.value } });
              }}
            />
            <label className="inline" htmlFor="quietTo">
              {t('settings.quietHours.to')}
            </label>
            <input
              id="quietTo"
              type="time"
              value={config.quietHours.end}
              disabled={!config.quietHours.enabled}
              onChange={(e) => {
                if (e.target.value)
                  save({ quietHours: { ...config.quietHours, end: e.target.value } });
              }}
            />
          </div>
          <div className="row">
            <label className="inline" htmlFor="perHour">
              {t('settings.budget.perHour')}
            </label>
            <input
              id="perHour"
              type="number"
              min={1}
              max={20}
              value={config.budget.maxPerHour}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isFinite(n) && n >= 1 && n <= 20) {
                  save({ budget: { ...config.budget, maxPerHour: n } });
                }
              }}
            />
            <label className="inline" htmlFor="perDay">
              {t('settings.budget.perDay')}
            </label>
            <input
              id="perDay"
              type="number"
              min={1}
              max={100}
              value={config.budget.maxPerDay}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isFinite(n) && n >= 1 && n <= 100) {
                  save({ budget: { ...config.budget, maxPerDay: n } });
                }
              }}
            />
          </div>
          {signals?.silence.snoozedUntil !== undefined && (
            <p className="hint notice">
              {t('settings.nudges.snoozed', { time: clock(signals.silence.snoozedUntil) })}
            </p>
          )}
          {signals?.silence.activeSource !== undefined && (
            <p className="hint notice">
              {t('settings.nudges.silenced', {
                source: t(`silence.${signals.silence.activeSource}`),
              })}
            </p>
          )}
        </section>

        {environment && !environment.trayAvailable && (
          <section className="field">
            <p className="hint notice">{t('settings.tray.unavailable')}</p>
          </section>
        )}
      </main>

      <footer className="footer">
        <span className="status" role="status">
          {savedUntil !== null ? t('settings.saved') : ''}
        </span>
      </footer>
    </div>
  );
}
