import type { BrowserWindow } from 'electron';
import { join } from 'node:path';

export type Theme = 'light' | 'dark';

// The theme rides in on the URL rather than being asked for over IPC. A window is shown on
// ready-to-show, which fires before an IPC round trip can land, so asking would paint every
// window in the light palette for a frame first. On the mascot that is worse than a flicker: it
// carries a 900ms filter transition, so night mode would start bright and then dim on every
// launch, which is the opposite of what the switch is for.
export function loadPage(win: BrowserWindow, page: string, theme: Theme): void {
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl !== undefined) {
    void win.loadURL(`${devUrl}/${page}?theme=${theme}`);
    return;
  }
  void win.loadFile(join(__dirname, `../renderer/${page}`), { query: { theme } });
}
