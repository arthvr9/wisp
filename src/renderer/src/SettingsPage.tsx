import { useEffect, useState } from 'react';
import type { ChangeEvent, KeyboardEvent } from 'react';

import iconUrl from '../../../resources/icons/wisp-256.png';
import type { Config } from '../../shared/config';
import { translator } from '../../shared/i18n';
import type { EnvironmentInfo } from '../../shared/ipc';

const SAVED_VISIBLE_MS = 1500;
const NAME_MAX = 24;

export function SettingsPage() {
  const [config, setConfig] = useState<Config | null>(null);
  const [environment, setEnvironment] = useState<EnvironmentInfo | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [savedUntil, setSavedUntil] = useState<number | null>(null);

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
    const unsubscribe = window.wisp.onConfigChanged(applyConfig);
    return () => {
      alive = false;
      unsubscribe();
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

  if (!config) return <div className="page" />;

  const t = translator(config.locale, { name: config.name });

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
