import { useEffect, useState } from 'react';

import type { CustomArtError, CustomMascotSummary } from '../../shared/custom-art';
import type { Translate } from '../../shared/i18n';
import type { CustomArtExport } from '../../shared/ipc';
import './custom-art.css';

interface CustomArtSectionProps {
  t: Translate;
  /** The slug in use, or empty for the built-in art. */
  customMascot: string;
  onSelect: (slug: string) => void;
}

export function CustomArtSection({ t, customMascot, onSelect }: CustomArtSectionProps) {
  const [mascots, setMascots] = useState<CustomMascotSummary[]>([]);
  const [listed, setListed] = useState(false);
  const [exported, setExported] = useState<CustomArtExport | null>(null);
  const [imported, setImported] = useState<CustomMascotSummary | null>(null);
  const [deleted, setDeleted] = useState<string | null>(null);
  const [errors, setErrors] = useState<CustomArtError[]>([]);
  const [failed, setFailed] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void window.wisp
      .listCustomMascots()
      .then((next) => {
        if (!alive) return;
        setMascots(next);
        setListed(true);
      })
      .catch(() => {
        // Not the same as an empty list. Saying there are no drawings when the read failed would
        // tell the user their work is gone, and the missing notice below would fire as well.
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  function clear() {
    setExported(null);
    setImported(null);
    setDeleted(null);
    setErrors([]);
    setFailed(false);
  }

  // Main can fail for reasons that are nobody's fault: a folder that went away, a disk that is
  // full, a permission the picker did not have. Without this the promise rejects silently and
  // the button just stops doing anything, which is the worst of both.
  function onFailure() {
    clear();
    setFailed(true);
  }

  function exportTemplate() {
    setBusy(true);
    void window.wisp
      .exportArtTemplate()
      .then((result) => {
        clear();
        if (result) setExported(result);
      })
      .catch(onFailure)
      .finally(() => {
        setBusy(false);
      });
  }

  function importFolder() {
    setBusy(true);
    void window.wisp
      .importCustomMascot()
      .then((result) => {
        clear();
        if (!result) return;
        if (!result.ok) {
          setErrors(result.errors);
          return;
        }
        setImported(result.mascot);
        return window.wisp.listCustomMascots().then(setMascots);
      })
      .catch(onFailure)
      .finally(() => {
        setBusy(false);
      });
  }

  function remove(mascot: CustomMascotSummary) {
    setBusy(true);
    void window.wisp
      .deleteCustomMascot(mascot.slug)
      .then((next) => {
        clear();
        setMascots(next);
        setConfirming(null);
        setDeleted(mascot.name);
        if (mascot.slug === customMascot) onSelect('');
      })
      .catch(onFailure)
      .finally(() => {
        setBusy(false);
      });
  }

  const missing = listed && customMascot !== '' && !mascots.some((m) => m.slug === customMascot);

  return (
    <section className="field">
      <span className="label">{t('settings.customArt')}</span>
      <p className="hint">{t('settings.customArt.hint')}</p>

      <div className="actions">
        <button type="button" disabled={busy} onClick={exportTemplate}>
          {t('settings.customArt.exportTemplate')}
        </button>
        <button type="button" disabled={busy} onClick={importFolder}>
          {t('settings.customArt.import')}
        </button>
      </div>

      {exported && (
        <p className="hint notice callout">
          {t('settings.customArt.exported', { count: exported.count, path: exported.dir })}
        </p>
      )}
      {imported && (
        <p className="hint">
          {t('settings.customArt.imported', {
            name: imported.name,
            poses: imported.poses.join(', '),
          })}
        </p>
      )}
      {deleted !== null && (
        <p className="hint">{t('settings.customArt.deleted', { name: deleted })}</p>
      )}

      {failed && <p className="hint notice">{t('settings.customArt.failed')}</p>}

      {errors.length > 0 && (
        <div className="artErrors">
          <p className="hint notice">{t('settings.customArt.errors')}</p>
          <ul>
            {errors.map((error, index) => (
              <li key={`${error.code}-${error.file ?? String(index)}`}>{error.message}</li>
            ))}
          </ul>
        </div>
      )}

      {missing && <p className="hint notice">{t('settings.customArt.missing')}</p>}

      {mascots.length === 0 ? (
        <p className="hint">{t('settings.customArt.none')}</p>
      ) : (
        <ul className="drawings">
          {mascots.map((mascot) => {
            const inUse = mascot.slug === customMascot;
            return (
              <li key={mascot.slug} className={inUse ? 'drawing inUse' : 'drawing'}>
                <span className="drawingName">{t('mascot.custom', { name: mascot.name })}</span>
                <p className="hint">{mascot.poses.join(', ')}</p>
                <p className="hint">{t('settings.customArt.fallback')}</p>
                {confirming === mascot.slug ? (
                  <>
                    <p className="hint notice">
                      {t('settings.customArt.deleteConfirm', { name: mascot.name })}
                    </p>
                    <div className="actions">
                      <button
                        type="button"
                        className="danger"
                        disabled={busy}
                        onClick={() => {
                          remove(mascot);
                        }}
                      >
                        {t('settings.customArt.delete')}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setConfirming(null);
                        }}
                      >
                        {t('settings.customArt.deleteCancel')}
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="actions">
                    {inUse ? (
                      <span className="badge">{t('settings.customArt.inUse')}</span>
                    ) : (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          onSelect(mascot.slug);
                        }}
                      >
                        {t('settings.customArt.use')}
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setConfirming(mascot.slug);
                      }}
                    >
                      {t('settings.customArt.delete')}
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {customMascot !== '' && (
        <div className="actions">
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              onSelect('');
            }}
          >
            {t('settings.customArt.useBuiltIn')}
          </button>
        </div>
      )}
    </section>
  );
}
