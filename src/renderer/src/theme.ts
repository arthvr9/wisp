import type { Config } from '../../shared/config';

// Every window is its own renderer, so each one applies the theme for itself. Main already
// broadcasts the config when it changes, so throwing the switch repaints all of them at once and
// nothing new has to cross IPC for it.
export function startTheme(): void {
  const apply = (config: Config): void => {
    document.documentElement.dataset.theme = config.night ? 'dark' : 'light';
  };
  void window.wisp.getConfig().then(apply);
  window.wisp.onConfigChanged(apply);
}
