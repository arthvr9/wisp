import type { Config } from '../../shared/config';

// The first paint is already correct: the preload reads the theme off the URL and sets the
// attribute before any of this runs. So there is nothing to ask main for here, only the switch
// being thrown to keep up with, which main broadcasts to every window. Reading the config again
// on mount would be a second source of truth racing the first, and the later of the two would
// win rather than the newer.
export function startTheme(): void {
  window.wisp.onConfigChanged((config: Config): void => {
    document.documentElement.dataset.theme = config.night ? 'dark' : 'light';
  });
}
