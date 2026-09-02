import type { MenuItemConstructorOptions } from 'electron';

import type { Translate } from '../shared/i18n';

export interface MenuState {
  paused: boolean;
  hidden: boolean;
}

export interface MenuActions {
  togglePause(): void;
  toggleHidden(): void;
  poke(): void;
  openSettings(): void;
  quit(): void;
}

export function menuTemplate(
  t: Translate,
  state: MenuState,
  actions: MenuActions,
): MenuItemConstructorOptions[] {
  return [
    {
      label: state.paused ? t('menu.resume') : t('menu.pause'),
      click: () => {
        actions.togglePause();
      },
    },
    {
      label: state.hidden ? t('menu.show') : t('menu.hide'),
      click: () => {
        actions.toggleHidden();
      },
    },
    {
      label: t('menu.poke'),
      click: () => {
        actions.poke();
      },
    },
    { type: 'separator' },
    {
      label: t('menu.settings'),
      click: () => {
        actions.openSettings();
      },
    },
    { type: 'separator' },
    {
      label: t('menu.quit'),
      click: () => {
        actions.quit();
      },
    },
  ];
}
