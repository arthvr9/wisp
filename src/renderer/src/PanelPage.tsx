import { useEffect, useState } from 'react';

import type { Config } from '../../shared/config';
import { translator } from '../../shared/i18n';
import type { Translate } from '../../shared/i18n';
import type { MessageKey } from '../../shared/i18n/en';
import type { DayGroup, DayItem, SignalAction, SignalSource } from '../../shared/signals';
import { formatTimeLeft, groupRows, panelTitle } from './panel-format';

const SOURCE_KEY: Record<SignalSource, MessageKey> = {
  clickup: 'panel.source.clickup',
  calendar: 'panel.source.calendar',
  gruply: 'panel.source.gruply',
};

const GROUP_KEY: Record<DayGroup, MessageKey> = {
  late: 'panel.group.late',
  today: 'panel.group.today',
  tomorrow: 'panel.group.tomorrow',
  week: 'panel.group.week',
  later: 'panel.group.later',
};

interface RowState {
  pending?: SignalAction;
  error?: string;
  confirming?: boolean;
}

function clockOf(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

interface RowProps {
  item: DayItem;
  state: RowState;
  t: Translate;
  onOpen: () => void;
  onSnooze: () => void;
  onStartConfirm: () => void;
  onCancelConfirm: () => void;
  onConfirmComplete: () => void;
}

function Row({
  item,
  state,
  t,
  onOpen,
  onSnooze,
  onStartConfirm,
  onCancelConfirm,
  onConfirmComplete,
}: RowProps) {
  const pending = state.pending !== undefined;
  const timeText = formatTimeLeft(item, t);
  const sourceLabel = t(SOURCE_KEY[item.signal.source]);

  return (
    <li className={item.overdue ? 'row overdue' : 'row'}>
      <p className="row-title">{item.signal.title}</p>
      <p className="row-meta">
        <span className="row-source">
          {sourceLabel} · {item.signal.listName}
        </span>
        <span className={item.overdue ? 'row-time overdue' : 'row-time'}>{timeText}</span>
      </p>
      {item.snoozedUntil !== undefined && (
        <p className="row-note">{t('panel.snoozed', { time: clockOf(item.snoozedUntil) })}</p>
      )}
      {state.error !== undefined && (
        <p className="row-error">{t('panel.actionFailed', { message: state.error })}</p>
      )}
      <div className="row-actions">
        {state.confirming === true ? (
          <>
            <span className="row-confirm">{t('panel.action.confirmPrompt')}</span>
            <button
              type="button"
              className="primary"
              disabled={pending}
              onClick={onConfirmComplete}
            >
              {t('panel.action.confirm')}
            </button>
            <button type="button" disabled={pending} onClick={onCancelConfirm}>
              {t('panel.action.cancel')}
            </button>
          </>
        ) : (
          <>
            <button type="button" disabled={pending} onClick={onOpen}>
              {t('panel.action.open')}
            </button>
            <button type="button" disabled={pending} onClick={onSnooze}>
              {t('panel.action.snooze')}
            </button>
            {item.actions.complete && (
              <button type="button" disabled={pending} onClick={onStartConfirm}>
                {t('panel.action.done')}
              </button>
            )}
          </>
        )}
        {pending && <span className="row-pending">{t('panel.pending')}</span>}
      </div>
    </li>
  );
}

export function Panel() {
  const [config, setConfig] = useState<Config | null>(null);
  const [items, setItems] = useState<DayItem[] | null>(null);
  const [rowStates, setRowStates] = useState<Record<string, RowState>>({});

  useEffect(() => {
    void window.wisp.getConfig().then(setConfig);
  }, []);

  useEffect(() => {
    let alive = true;
    void window.wisp
      .listDay()
      .then((day) => {
        if (alive) setItems(day);
      })
      .catch((err: unknown) => {
        console.error(err);
      });
    const unsubscribe = window.wisp.onDayChanged((day) => {
      if (alive) setItems(day);
    });
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') window.wisp.closePanel();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  function updateRow(id: string, patch: RowState | undefined) {
    setRowStates((prev) => {
      if (patch === undefined) {
        return Object.fromEntries(Object.entries(prev).filter(([key]) => key !== id));
      }
      return { ...prev, [id]: { ...prev[id], ...patch } };
    });
  }

  function performAction(id: string, action: SignalAction) {
    updateRow(id, { pending: action, error: undefined, confirming: false });
    void window.wisp
      .runAction(id, action)
      .then((day) => {
        setItems(day);
        updateRow(id, undefined);
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        updateRow(id, { pending: undefined, error: message });
      });
  }

  if (!config || !items) return <div className="panel-window" />;

  const t = translator(config.locale, { name: config.name });

  const sections = groupRows(items);

  return (
    <div className="panel-window">
      <div className="panel">
        <header className="panel-header">
          <h1>{panelTitle(items, t)}</h1>
          <button
            type="button"
            className="panel-close"
            aria-label={t('panel.close')}
            onClick={() => {
              window.wisp.closePanel();
            }}
          >
            ×
          </button>
        </header>
        <div className="panel-body">
          {sections.length === 0 ? (
            <p className="empty">{t('panel.emptyAll')}</p>
          ) : (
            sections.map((section) => (
              <section key={section.group} className={`group ${section.group}`}>
                <h2 className="group-head">
                  {t(GROUP_KEY[section.group])}
                  <span className="group-count">{section.items.length}</span>
                </h2>
                <ul className="list">
                  {section.items.map((item) => {
                    const id = item.signal.id;
                    const state = rowStates[id] ?? {};
                    return (
                      <Row
                        key={id}
                        item={item}
                        state={state}
                        t={t}
                        onOpen={() => {
                          performAction(id, 'open');
                        }}
                        onSnooze={() => {
                          performAction(id, 'snooze');
                        }}
                        onStartConfirm={() => {
                          updateRow(id, { confirming: true });
                        }}
                        onCancelConfirm={() => {
                          updateRow(id, undefined);
                        }}
                        onConfirmComplete={() => {
                          performAction(id, 'complete');
                        }}
                      />
                    );
                  })}
                </ul>
              </section>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
