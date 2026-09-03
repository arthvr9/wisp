import type { Config } from '../../shared/config';

// The first paint is already correct: the preload reads the theme off the URL and sets the
// attribute before any of this runs. What is left is keeping up with the switch being thrown,
// which main broadcasts to every window. A failed read is not allowed to change anything, or a
// window that briefly cannot reach main would drop back to the light palette on its own.
export function startTheme(): void {
  const apply = (config: Config): void => {
    document.documentElement.dataset.theme = config.night ? 'dark' : 'light';
  };
  window.wisp
    .getConfig()
    .then(apply)
    .catch(() => undefined);
  window.wisp.onConfigChanged(apply);
}
