import { globalShortcut } from 'electron';

export const SHORTCUT = 'Control+Alt+W';
const DOUBLE_PRESS_MS = 600;

export interface ShortcutHandlers {
  toggle(): void;
  hide(): void;
}

// One press pauses or resumes, two quick presses hide. Registration can succeed on X11 and
// still never fire under a Wayland compositor, which is why the settings page shows the status
// and the right-click menu stays the primary kill switch.
export function registerShortcut(handlers: ShortcutHandlers): boolean {
  let lastPress = 0;
  let pending: NodeJS.Timeout | undefined;
  try {
    return globalShortcut.register(SHORTCUT, () => {
      const now = Date.now();
      if (now - lastPress < DOUBLE_PRESS_MS && pending) {
        clearTimeout(pending);
        pending = undefined;
        lastPress = 0;
        handlers.hide();
        return;
      }
      lastPress = now;
      pending = setTimeout(() => {
        pending = undefined;
        handlers.toggle();
      }, DOUBLE_PRESS_MS);
    });
  } catch {
    return false;
  }
}
