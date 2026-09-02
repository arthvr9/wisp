import { app, BrowserWindow, ipcMain, Menu, powerMonitor, screen } from 'electron';
import type { Display, Point } from 'electron';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { autostartPath, setAutostart } from './autostart';
import { createActor, reduce } from './brain/actor';
import type { ActorState } from './brain/actor';
import { groundY } from './brain/movement';
import type { DisplayArea, Target } from './brain/movement';
import { ConfigStore } from './config';
import { describeEnvironment, formatEnvironment } from './harness/environment';
import { Harness, formatSummary } from './harness/metrics';
import { menuTemplate } from './menu';
import { registerShortcut, SHORTCUT } from './shortcut';
import { openSettings } from './stage/settings';
import { createStage, MASCOT_SIZE } from './stage/window';
import { createTray, detectTray } from './tray';
import type { TrayHandle } from './tray';
import type { Config } from '../shared/config';
import { translator } from '../shared/i18n';
import { IPC } from '../shared/ipc';
import type { DragStart, EnvironmentInfo } from '../shared/ipc';

// Native Wayland clients cannot position their own windows or stay above others, which is
// the whole point of this app. Forcing the X11 backend routes us through XWayland, where
// both still work. Electron picks the Ozone platform for the browser process before this
// script runs, so this call alone is too late: it only reaches the GPU and renderer
// children, and the mismatch crashes the GPU process. The flag must also be on the command
// line (see the npm scripts). This line stays so the intent is visible next to the check.
app.commandLine.appendSwitch('ozone-platform', 'x11');
const OZONE_FLAG = '--ozone-platform=x11';
if (!process.argv.includes(OZONE_FLAG)) {
  console.error(`warning: ${OZONE_FLAG} missing from the command line, window will not be X11`);
}

const TICK_MS = 33;
const SAMPLE_MS = 5000;

function toArea(d: Display): DisplayArea {
  return { id: d.id, ...d.workArea };
}

function harnessMinutes(): number | undefined {
  const raw = process.env.WISP_HARNESS_MINUTES;
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

void app.whenReady().then(async () => {
  const appPath = app.getAppPath();
  const config = new ConfigStore(join(app.getPath('userData'), 'config.json'));
  const minutes = harnessMinutes();
  const harness =
    minutes === undefined ? undefined : new Harness(TICK_MS, join(appPath, 'harness-results'));

  let target: Target = {
    displays: screen.getAllDisplays().map(toArea),
    width: MASCOT_SIZE,
    height: MASCOT_SIZE,
  };
  const home = toArea(screen.getPrimaryDisplay());
  let actor: ActorState = createActor(home.id, home.x + 40, groundY(home, MASCOT_SIZE));
  const stage = createStage(Math.round(actor.x), Math.round(actor.y));

  const refreshDisplays = () => {
    target = { ...target, displays: screen.getAllDisplays().map(toArea) };
    actor = reduce(actor, { type: 'displays-changed' }, target);
  };
  screen.on('display-added', refreshDisplays);
  screen.on('display-removed', refreshDisplays);
  screen.on('display-metrics-changed', refreshDisplays);

  let hidden = false;
  let tray: TrayHandle | undefined;
  let t = translator(config.get().locale, { name: config.get().name });

  const actions = {
    togglePause() {
      actor = reduce(actor, { type: actor.paused ? 'resume' : 'pause' }, target);
      refreshMenus();
    },
    toggleHidden() {
      hidden = !hidden;
      if (hidden) stage.win.hide();
      else stage.win.showInactive();
      refreshMenus();
    },
    poke() {
      actor = reduce(actor, { type: 'alert' }, target);
    },
    openSettings() {
      openSettings(appPath);
    },
    quit() {
      app.quit();
    },
  };

  function refreshMenus(): void {
    tray?.update(t('tray.tooltip'), menuTemplate(t, { paused: actor.paused, hidden }, actions));
  }

  const shortcutRegistered = registerShortcut({
    toggle: () => {
      actions.togglePause();
    },
    hide: () => {
      if (!hidden) actions.toggleHidden();
    },
  });

  if (await detectTray()) {
    tray = createTray(appPath);
    refreshMenus();
  } else {
    console.warn('no StatusNotifier tray on the session bus, tray disabled');
  }

  const applyConfig = (c: Config) => {
    t = translator(c.locale, { name: c.name });
    try {
      setAutostart(c.autostart);
    } catch (err) {
      console.error('autostart update failed', err);
    }
    refreshMenus();
  };
  applyConfig(config.get());
  config.onChange((c) => {
    applyConfig(c);
    for (const w of [stage.win, ...openSettingsWindows()]) {
      w.webContents.send(IPC.configChanged, c);
    }
  });

  function openSettingsWindows() {
    return BrowserWindow.getAllWindows().filter((w) => w !== stage.win);
  }

  ipcMain.handle(IPC.configGet, () => config.get());
  ipcMain.handle(IPC.configSet, (_event, patch: Partial<Config>) => config.set(patch));
  ipcMain.handle(IPC.environmentGet, (): EnvironmentInfo => ({
    trayAvailable: tray !== undefined,
    shortcut: SHORTCUT,
    shortcutRegistered,
    autostartPath: autostartPath(),
  }));

  let drag: DragStart | undefined;
  ipcMain.on(IPC.dragStart, (_event, offset: DragStart) => {
    drag = offset;
    actor = reduce(actor, { type: 'drag-start' }, target);
  });
  ipcMain.on(IPC.dragEnd, () => {
    drag = undefined;
    const b = stage.bounds();
    const displayId = screen.getDisplayMatching(b).id;
    actor = reduce(actor, { type: 'drag-end', x: b.x, y: b.y, displayId }, target);
  });
  let menuShown = false;
  let openMenu: Menu | undefined;
  ipcMain.on(IPC.contextMenu, () => {
    openMenu = Menu.buildFromTemplate(menuTemplate(t, { paused: actor.paused, hidden }, actions));
    openMenu.on('menu-will-show', () => {
      menuShown = true;
    });
    openMenu.popup({ window: stage.win });
  });

  // Drives the renderer without a human: right click, drag, settings window. It proves the
  // wiring, not that XWayland delivers real input.
  function selfTest(): void {
    const send = (type: 'mouseDown' | 'mouseUp', button: 'left' | 'right') => {
      stage.win.webContents.sendInputEvent({ type, x: 48, y: 48, button, clickCount: 1 });
    };
    const at = (ms: number, fn: () => void) => setTimeout(fn, ms);
    at(2000, () => {
      send('mouseDown', 'right');
      send('mouseUp', 'right');
    });
    at(2800, () => {
      console.log(`self-test menu    ${menuShown ? 'shown' : 'not shown'}`);
      openMenu?.closePopup();
    });
    const before = { ...stage.bounds() };
    at(3500, () => {
      send('mouseDown', 'left');
    });
    at(4000, () => {
      const during = drag !== undefined && actor.pose === 'drag';
      send('mouseUp', 'left');
      at(200, () => {
        const after = stage.bounds();
        console.log(
          `self-test drag    ${during ? 'ok' : 'failed'} ${before.x},${before.y} -> ${after.x},${after.y} pose ${actor.pose}`,
        );
      });
    });
    at(5000, () => {
      const w = openSettings(appPath);
      w.webContents.once('did-finish-load', () => {
        console.log('self-test settings loaded');
        at(1500, () => {
          const dir = process.env.WISP_SELFTEST_SHOTS;
          if (dir) {
            void Promise.all([
              w.webContents.capturePage(),
              stage.win.webContents.capturePage(),
            ]).then(([settingsShot, mascotShot]) => {
              writeFileSync(join(dir, 'settings.png'), settingsShot.toPNG());
              writeFileSync(join(dir, 'mascot.png'), mascotShot.toPNG());
              w.close();
            });
          } else {
            w.close();
          }
        });
      });
    });
  }

  let lastPose = '';
  const pushPose = () => {
    const key = `${actor.pose}/${actor.facing}`;
    if (key === lastPose) return;
    lastPose = key;
    stage.win.webContents.send(IPC.pose, { pose: actor.pose, facing: actor.facing });
  };

  // XWayland only updates the X pointer while it is over an X window, so a position that
  // did not change since the last tick is treated as unknown rather than trusted.
  let lastCursor: Point | undefined;
  const cursorDisplayId = (): number | undefined => {
    const p = screen.getCursorScreenPoint();
    const moved = lastCursor?.x !== p.x || lastCursor.y !== p.y;
    lastCursor = p;
    return moved ? screen.getDisplayNearestPoint(p).id : undefined;
  };

  stage.win.webContents.once('did-finish-load', () => {
    console.log(formatEnvironment(describeEnvironment(stage.win)));
    console.log(`setShape          ${stage.cutCorners()}`);
    console.log(
      `shortcut          ${SHORTCUT} ${shortcutRegistered ? 'registered' : 'not registered'}`,
    );
    console.log(`tray              ${tray ? 'available' : 'unavailable'}`);
    if (harness)
      console.log(`harness           ${minutes ?? 0} min, results in ${harness.resultsDir}`);
    pushPose();
    if (process.env.WISP_SELFTEST) selfTest();
    if (process.env.WISP_OPEN_SETTINGS) openSettings(appPath);

    let last = performance.now();
    setInterval(() => {
      const now = performance.now();
      const dt = now - last;
      last = now;
      harness?.tick(dt);

      if (drag) {
        const p = screen.getCursorScreenPoint();
        lastCursor = p;
        stage.moveTo(p.x - drag.offsetX, p.y - drag.offsetY);
        return;
      }
      actor = reduce(
        actor,
        {
          type: 'tick',
          dtMs: dt,
          rng: Math.random,
          cursor: { displayId: cursorDisplayId(), idleMs: powerMonitor.getSystemIdleTime() * 1000 },
          followCursor: config.get().followCursor,
        },
        target,
      );
      if (!hidden) stage.moveTo(Math.round(actor.x), Math.round(actor.y));
      pushPose();
    }, TICK_MS);
  });

  if (harness) {
    let sampleCount = 0;
    setInterval(() => {
      const samples = harness.sampleProcesses();
      const system = harness.sampleSystem();
      sampleCount += 1;
      if (sampleCount === 1) {
        harness.discardFirstCpuSample();
        return;
      }
      const total = samples.reduce((sum, s) => sum + s.cpuPercent, 0);
      const sys = system.map((s) => `${s.name} ${s.cpuPercent.toFixed(1)}%`).join(', ');
      console.log(
        `t=${samples[0]?.elapsedS.toFixed(0) ?? '?'}s cpu ${total.toFixed(1)}% pose ${actor.pose} system: ${sys}`,
      );
    }, SAMPLE_MS);
    setTimeout(
      () => {
        console.log('\n' + formatSummary(harness.finish()));
        app.quit();
      },
      (minutes ?? 0) * 60 * 1000,
    );
  }

  app.on('window-all-closed', () => {
    // The mascot window is hidden rather than closed, so this only fires on quit.
  });
});
