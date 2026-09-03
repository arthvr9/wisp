import { useEffect, useState } from 'react';
import type { ChangeEvent, KeyboardEvent } from 'react';

import iconUrl from '../../../resources/icons/wisp-256.png';
import type { Config } from '../../shared/config';
import { translator } from '../../shared/i18n';
import type { Translate } from '../../shared/i18n';
import type { MessageKey } from '../../shared/i18n/en';
import type { EnvironmentInfo } from '../../shared/ipc';
import type { Mood } from '../../shared/mood';
import type { SignalSource, SignalsStatus } from '../../shared/signals';
import type { SpeechConfig, SpeechProviderKind, SpeechStatus } from '../../shared/speech';

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
  const [clientIdDraft, setClientIdDraft] = useState<string | null>(null);
  const [tenantDraft, setTenantDraft] = useState<string | null>(null);

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

  function onToggle(key: 'autostart' | 'followCursor') {
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
        <img className="icon" src={iconUrl} alt="" width={24} height={24} />
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
          <span className="label">{t('settings.outlook')}</span>
          <p className="hint">{t('settings.outlook.hint')}</p>
          {signals && (
            <p className={signals.connectors.outlook.state === 'error' ? 'hint notice' : 'hint'}>
              {statusLine(signals, 'outlook', 'settings.outlook.connected')}
            </p>
          )}
          <label className="inline" htmlFor="outlookClientId">
            {t('settings.outlook.clientId')}
          </label>
          <input
            id="outlookClientId"
            type="text"
            value={clientIdDraft ?? config.outlook.clientId}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => {
              setClientIdDraft(e.target.value);
            }}
            onBlur={() => {
              if (clientIdDraft !== null) {
                save({ outlook: { ...config.outlook, clientId: clientIdDraft.trim() } });
                setClientIdDraft(null);
              }
            }}
          />
          <p className="hint">{t('settings.outlook.clientId.hint')}</p>
          <label className="inline" htmlFor="outlookTenant">
            {t('settings.outlook.tenant')}
          </label>
          <input
            id="outlookTenant"
            type="text"
            value={tenantDraft ?? config.outlook.tenant}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => {
              setTenantDraft(e.target.value);
            }}
            onBlur={() => {
              if (tenantDraft !== null) {
                const tenant = tenantDraft.trim();
                save({
                  outlook: { ...config.outlook, tenant: tenant.length > 0 ? tenant : 'common' },
                });
                setTenantDraft(null);
              }
            }}
          />
          <p className="hint">{t('settings.outlook.tenant.hint')}</p>
          {config.outlook.clientId.length === 0 && (
            <p className="hint notice">{t('settings.outlook.needsClientId')}</p>
          )}
          {actions('outlook', config.outlook.clientId.length > 0)}
          <label className="inline" htmlFor="meetingWarn">
            {t('settings.outlook.warn')}
          </label>
          <input
            id="meetingWarn"
            type="number"
            min={0}
            max={120}
            value={config.outlook.warnMinutes}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n) && n >= 0 && n <= 120) {
                save({ outlook: { ...config.outlook, warnMinutes: n } });
              }
            }}
          />
          <label className="check">
            <input
              type="checkbox"
              checked={config.outlook.silenceDuringMeetings}
              onChange={(e) => {
                save({ outlook: { ...config.outlook, silenceDuringMeetings: e.target.checked } });
              }}
            />
            <span>{t('settings.outlook.silence')}</span>
          </label>
          <p className="hint">{t('settings.outlook.silence.hint')}</p>
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
