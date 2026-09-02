import { useEffect, useState } from 'react';
import type { ChangeEvent, KeyboardEvent } from 'react';

import iconUrl from '../../../resources/icons/wisp-256.png';
import type { Config } from '../../shared/config';
import { translator } from '../../shared/i18n';
import type { EnvironmentInfo } from '../../shared/ipc';
import type { SignalsStatus } from '../../shared/signals';

const SAVED_VISIBLE_MS = 1500;
const NAME_MAX = 24;

export function SettingsPage() {
  const [config, setConfig] = useState<Config | null>(null);
  const [environment, setEnvironment] = useState<EnvironmentInfo | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [savedUntil, setSavedUntil] = useState<number | null>(null);
  const [signals, setSignals] = useState<SignalsStatus | null>(null);
  const [busy, setBusy] = useState(false);

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
    const unsubscribe = window.wisp.onConfigChanged(applyConfig);
    const unsubscribeSignals = window.wisp.onSignalsStatusChanged((s) => {
      if (alive) setSignals(s);
    });
    return () => {
      alive = false;
      unsubscribe();
      unsubscribeSignals();
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

  function clickup(action: 'connect' | 'disconnect' | 'sync') {
    return () => {
      setBusy(true);
      const call =
        action === 'connect'
          ? window.wisp.clickupConnect()
          : action === 'disconnect'
            ? window.wisp.clickupDisconnect()
            : window.wisp.clickupSyncNow();
      void call.then(setSignals).finally(() => {
        setBusy(false);
      });
    };
  }

  if (!config) return <div className="page" />;

  const t = translator(config.locale, { name: config.name });
  const clock = (ms: number) =>
    new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

  function clickupStatusLine(status: SignalsStatus): string {
    const c = status.clickup;
    switch (c.state) {
      case 'disconnected':
        return t('settings.clickup.disconnected');
      case 'authorizing':
        return t('settings.clickup.authorizing');
      case 'connected':
        return (
          t('settings.clickup.connected', { count: c.signalCount }) +
          (c.lastSyncAt ? ' ' + t('settings.clickup.lastSync', { time: clock(c.lastSyncAt) }) : '')
        );
      case 'error':
        return t('settings.clickup.error', { message: c.message });
    }
  }

  return (
    <div className="page">
      <header className="header">
        <img className="icon" src={iconUrl} alt="" width={24} height={24} />
        <h1>{t('settings.title')}</h1>
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
            <p className={signals.clickup.state === 'error' ? 'hint notice' : 'hint'}>
              {clickupStatusLine(signals)}
              {signals.nextSyncAt && signals.clickup.state === 'connected'
                ? ' ' + t('settings.clickup.nextSync', { time: clock(signals.nextSyncAt) })
                : ''}
            </p>
          )}
          <div className="actions">
            {signals?.clickup.state === 'connected' || signals?.clickup.state === 'error' ? (
              <>
                <button type="button" disabled={busy} onClick={clickup('sync')}>
                  {t('settings.clickup.syncNow')}
                </button>
                <button type="button" disabled={busy} onClick={clickup('disconnect')}>
                  {t('settings.clickup.disconnect')}
                </button>
              </>
            ) : (
              <button
                type="button"
                className="primary"
                disabled={busy || signals?.clickup.state === 'authorizing'}
                onClick={clickup('connect')}
              >
                {t('settings.clickup.connect')}
              </button>
            )}
          </div>
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
                if (n >= 1 && n <= 20) save({ budget: { ...config.budget, maxPerHour: n } });
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
                if (n >= 1 && n <= 100) save({ budget: { ...config.budget, maxPerDay: n } });
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
