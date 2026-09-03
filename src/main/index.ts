import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  powerMonitor,
  safeStorage,
  screen,
  shell,
} from 'electron';
import type { Display, Point } from 'electron';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { autostartPath, setAutostart } from './autostart';
import { createActor, reduce } from './brain/actor';
import { activeSilence, quietHoursWindows } from './brain/silence';
import type { ActorState } from './brain/actor';
import { groundY } from './brain/movement';
import type { DisplayArea, Target } from './brain/movement';
import { ConfigStore } from './config';
import {
  ConnectorHub,
  createClickUpConnector,
  createGruplyConnector,
  createOutlookConnector,
} from './connectors';
import { meetingWindows } from './brain/meetings';
import { loadDotEnv } from './env';
import { SecretStore } from './mcp';
import { SilenceSources } from './silence';
import { createVoice } from './voice';
import type { Celebration, Mood } from '../shared/mood';
import type { SpeechEvent, SpeechRequest } from '../shared/speech';
import type { Nudge } from '../shared/nudges';
import type { DayItem, SignalAction, SignalSource } from '../shared/signals';
import { describeEnvironment, formatEnvironment } from './harness/environment';
import { Harness, formatSummary } from './harness/metrics';
import { menuTemplate } from './menu';
import { registerShortcut, SHORTCUT } from './shortcut';
import { createBubble } from './stage/bubble';
import { createPanel } from './stage/panel';
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
const BUBBLE_MS = 12_000;

function toArea(d: Display): DisplayArea {
  return { id: d.id, ...d.workArea };
}

function isAction(value: unknown): value is SignalAction {
  return value === 'complete' || value === 'snooze' || value === 'open';
}

function harnessMinutes(): number | undefined {
  const raw = process.env.WISP_HARNESS_MINUTES;
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

void app.whenReady().then(async () => {
  const appPath = app.getAppPath();
  loadDotEnv(appPath);
  const config = new ConfigStore(join(app.getPath('userData'), 'config.json'));
  const broadcast = (channel: string, payload: unknown) => {
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel, payload);
  };
  const secrets = new SecretStore(safeStorage, join(app.getPath('userData'), 'secrets'));
  const voice = createVoice(secrets, config.get().speech, (status) => {
    broadcast(IPC.speechStatusChanged, status);
  });
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
  const bubble = createBubble();

  const silence = new SilenceSources();
  silence.start();

  let bubbleUntil = 0;
  const queue: Nudge[] = [];
  const enqueue = (list: Nudge[]) => {
    for (const n of list) {
      if (!queue.some((q) => q.signalId === n.signalId && q.kind === n.kind)) queue.push(n);
    }
  };
  const phrase = (n: Nudge): string => {
    switch (n.kind) {
      case 'due-soon':
        return t('phrase.dueSoon', { minutes: n.minutesLeft, title: n.title });
      case 'due-now':
        return t('phrase.dueNow', { title: n.title });
      case 'overdue':
        return t(n.repeat > 0 ? 'phrase.overdueAgain' : 'phrase.overdue', { title: n.title });
      case 'due-today':
        return t('phrase.dueToday', { title: n.title });
      case 'meeting-soon':
        return t('phrase.meetingSoon', { minutes: n.minutesLeft, title: n.title });
      case 'meeting-now':
        return t('phrase.meetingNow', { title: n.title });
    }
  };
  // The bubble shows the fixed line at once and swaps in the model's line only if one arrives
  // while the same bubble is still up. CLAUDE.md is explicit that the bubble never waits.
  let bubbleSeq = 0;
  const speak = (
    event: SpeechEvent,
    fallback: string,
    context: SpeechRequest['context'],
    url: string | undefined,
    poseMs: number,
    pose: () => void,
  ) => {
    bubbleSeq += 1;
    const seq = bubbleSeq;
    bubble.show(url === undefined ? { text: fallback } : { text: fallback, url });
    bubbleUntil = Date.now() + poseMs;
    pose();
    void voice
      .say(event, config.get().name, connectors.currentMood(), fallback, context)
      .then((r) => {
        if (r.source !== 'model' || seq !== bubbleSeq || !bubble.isVisible()) return;
        bubble.show(url === undefined ? { text: r.text } : { text: r.text, url });
      });
  };
  const showNext = (nowMs: number) => {
    const next = queue.shift();
    if (!next) return;
    connectors.recordShown(next, nowMs);
    const context = { title: next.title, minutesLeft: next.minutesLeft, kind: next.kind };
    speak('nudge', phrase(next), context, next.url, BUBBLE_MS, () => {
      actor = reduce(actor, { type: 'alert', ms: BUBBLE_MS }, target);
    });
  };
  const celebrate = (c: Celebration) => {
    if (hidden || actor.paused || bubble.isVisible()) return;
    const key =
      c.intensity === 1
        ? 'phrase.celebrate.1'
        : c.intensity === 2
          ? 'phrase.celebrate.2'
          : 'phrase.celebrate.3';
    const fallback = t(key, { title: c.titles[0] ?? '', count: c.count });
    const ms = Math.max(c.intensity === 1 ? 2500 : c.intensity === 2 ? 4000 : 6000, 4000);
    speak('celebrate', fallback, { count: c.count, title: c.titles[0] }, undefined, ms, () => {
      actor = reduce(actor, { type: 'celebrate', intensity: c.intensity }, target);
    });
  };

  const openExternal = (url: string) => shell.openExternal(url);
  const GRUPLY_KEY = 'gruply.token';
  // The environment variable is a convenience for running from source. A pasted key goes to
  // safeStorage, which is where a packaged build keeps it.
  const gruplyToken = (): string | undefined => {
    const stored = secrets.get(GRUPLY_KEY, (raw) => (typeof raw === 'string' ? raw : undefined));
    return stored ?? process.env.WISP_GRUPLY_TOKEN;
  };
  const secretStatus = (): Record<string, boolean> => ({
    gruply: gruplyToken() !== undefined,
    gruplyFromEnv:
      secrets.get(GRUPLY_KEY, (raw) => (typeof raw === 'string' ? raw : undefined)) === undefined &&
      process.env.WISP_GRUPLY_TOKEN !== undefined,
  });
  const connectors: ConnectorHub = new ConnectorHub({
    connectors: [
      createClickUpConnector({ secrets, openExternal, version: app.getVersion() }),
      createOutlookConnector({ secrets, openExternal, config: () => config.get().outlook }),
      createGruplyConnector({ token: gruplyToken, config: () => config.get().gruply }),
    ],
    secrets,
    pollMinutes: () => config.get().pollMinutes,
    dueSoonMinutes: () => config.get().dueSoonMinutes,
    meetingWarnMs: () => config.get().outlook.warnMinutes * 60_000,
    budget: () => config.get().budget,
    silence: (nowMs) => [
      ...quietHoursWindows(config.get().quietHours, nowMs),
      ...silence.windows(nowMs),
    ],
    extraSilence: (signals) =>
      meetingWindows(signals, { enabled: config.get().outlook.silenceDuringMeetings }),
    silenceStatus: (nowMs) => {
      const windows = [
        ...quietHoursWindows(config.get().quietHours, nowMs),
        ...silence.windows(nowMs),
        ...meetingWindows(connectors.signals(), {
          enabled: config.get().outlook.silenceDuringMeetings,
        }),
      ];
      return {
        snoozedUntil: silence.snoozedUntil(nowMs),
        activeSource: activeSilence(windows, nowMs, 'normal')?.source,
      };
    },
    onStatus: (status) => {
      broadcast(IPC.signalsStatusChanged, status);
    },
    onNudges: enqueue,
    onMood: (mood) => {
      onMood(mood);
    },
    onCelebration: celebrate,
    openExternal,
    onDay: (items) => {
      broadcast(IPC.dayChanged, items);
    },
  });
  const onMood = (mood: Mood) => {
    broadcast(IPC.moodChanged, mood);
    tray?.setMood(hidden ? 'neutral' : mood);
    pushPose();
    refreshMenus();
  };
  ipcMain.handle(IPC.connectorConnect, (_event, source: SignalSource) =>
    connectors.connect(source),
  );
  ipcMain.handle(IPC.connectorDisconnect, (_event, source: SignalSource) =>
    connectors.disconnect(source),
  );
  ipcMain.handle(IPC.syncNow, () => connectors.syncNow());
  ipcMain.handle(IPC.signalsStatusGet, () => connectors.status());
  ipcMain.handle(IPC.signalsList, () => connectors.signals());
  ipcMain.handle(IPC.dayList, (): DayItem[] => connectors.day(Date.now()));
  ipcMain.handle(IPC.actionRun, async (_event, signalId: unknown, action: unknown) => {
    if (typeof signalId !== 'string' || !isAction(action)) throw new Error('unknown action');
    await connectors.runAction(signalId, action, Date.now());
    return connectors.day(Date.now());
  });
  ipcMain.handle(IPC.secretStatus, () => secretStatus());
  ipcMain.handle(IPC.secretSet, (_event, name: unknown, value: unknown) => {
    if (name !== 'gruply') throw new Error('unknown secret');
    const key = typeof value === 'string' ? value.trim().slice(0, 200) : '';
    if (key.length === 0) secrets.delete(GRUPLY_KEY);
    else secrets.set(GRUPLY_KEY, key);
    connectors.publishStatus();
    return secretStatus();
  });
  ipcMain.on(IPC.panelToggle, () => {
    togglePanel();
  });
  ipcMain.on(IPC.panelClose, () => {
    panel.hide();
  });
  app.on('before-quit', () => {
    silence.stop();
    connectors.close();
    panel.destroy();
    config.flush();
  });

  ipcMain.handle(IPC.speechStatusGet, () => voice.current());
  ipcMain.handle(IPC.speechSetApiKey, (_event, key: unknown) =>
    voice.setApiKey(typeof key === 'string' ? key.slice(0, 400) : ''),
  );
  ipcMain.handle(IPC.speechTest, async () => {
    const r = await voice.say(
      'poke',
      config.get().name,
      connectors.currentMood(),
      t('phrase.poke'),
      {},
    );
    return { text: r.text, source: r.source, latencyMs: r.latencyMs };
  });
  ipcMain.handle(IPC.moodGet, () => connectors.currentMood());

  const refreshDisplays = () => {
    target = { ...target, displays: screen.getAllDisplays().map(toArea) };
    actor = reduce(actor, { type: 'displays-changed' }, target);
  };
  screen.on('display-added', refreshDisplays);
  screen.on('display-removed', refreshDisplays);
  screen.on('display-metrics-changed', refreshDisplays);

  const panel = createPanel();
  const togglePanel = () => {
    if (panel.isVisible()) {
      panel.hide();
      return;
    }
    const display = target.displays.find((d) => d.id === actor.displayId) ?? target.displays[0];
    if (!display) return;
    panel.win.webContents.send(IPC.dayChanged, connectors.day(Date.now()));
    panel.toggle(Math.round(actor.x), Math.round(actor.y), display);
  };

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
      if (hidden) panel.hide();
      if (hidden) stage.win.hide();
      else stage.win.showInactive();
      tray?.setMood(hidden ? 'neutral' : connectors.currentMood());
      refreshMenus();
    },
    poke() {
      speak('poke', t('phrase.poke'), {}, undefined, 4000, () => {
        actor = reduce(actor, { type: 'alert', ms: 4000 }, target);
      });
    },
    toggleSnooze() {
      const now = Date.now();
      if (silence.snoozedUntil(now) !== undefined) silence.unsnooze();
      else silence.snooze(now + 60 * 60 * 1000);
      refreshMenus();
      connectors.publishStatus();
    },
    openSettings() {
      openSettings(appPath);
    },
    quit() {
      app.quit();
    },
  };

  function menuState() {
    return {
      paused: actor.paused,
      hidden,
      snoozed: silence.snoozedUntil(Date.now()) !== undefined,
    };
  }

  function refreshMenus(): void {
    tray?.update(t('tray.tooltip'), menuTemplate(t, menuState(), actions));
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
    voice.configure(c.speech);
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
    if (!Number.isFinite(offset.offsetX) || !Number.isFinite(offset.offsetY)) return;
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
    openMenu = Menu.buildFromTemplate(menuTemplate(t, menuState(), actions));
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
    at(4500, () => {
      bubble.show({
        text: t('phrase.dueSoon', { minutes: 30, title: 'Self-test task with a long name' }),
      });
      bubbleUntil = Date.now() + 4000;
      actor = reduce(actor, { type: 'alert', ms: 4000 }, target);
    });
    at(4800, () => {
      togglePanel();
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
              bubble.capture(),
              panel.capture(),
            ]).then(([settingsShot, mascotShot, bubbleShot, panelShot]) => {
              writeFileSync(join(dir, 'settings.png'), settingsShot.toPNG());
              writeFileSync(join(dir, 'mascot.png'), mascotShot.toPNG());
              writeFileSync(join(dir, 'bubble.png'), bubbleShot.toPNG());
              writeFileSync(join(dir, 'panel.png'), panelShot.toPNG());
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
  function pushPose(): void {
    const m = connectors.modifiers();
    const intensity = actor.celebrateIntensity;
    const key = `${actor.pose}/${actor.facing}/${m.expression}/${m.speedFactor}/${intensity ?? ''}`;
    if (key === lastPose) return;
    lastPose = key;
    stage.win.webContents.send(IPC.pose, {
      pose: actor.pose,
      facing: actor.facing,
      expression: m.expression,
      speedFactor: m.speedFactor,
      ...(intensity === undefined ? {} : { intensity }),
    });
  }

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
    let nextDueCheck = 0;
    let nextCelebrationCheck = 0;
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
          mood: connectors.modifiers(),
        },
        target,
      );
      if (!hidden) stage.moveTo(Math.round(actor.x), Math.round(actor.y));
      pushPose();

      const nowMs = Date.now();
      if (nowMs >= nextDueCheck) {
        nextDueCheck = nowMs + 30_000;
        enqueue(connectors.decide(nowMs).nudges);
      } else if (nowMs >= nextCelebrationCheck) {
        // Celebrations aggregate over 30 s, so they need a finer poll than the nudge decision.
        nextCelebrationCheck = nowMs + 2000;
        connectors.pollCelebration(nowMs);
      }
      if (bubble.isVisible()) {
        if (nowMs >= bubbleUntil || hidden) bubble.hide();
        else {
          const d = target.displays.find((x) => x.id === actor.displayId);
          bubble.follow(actor.x, actor.y, d?.x ?? 0, (d?.x ?? 0) + (d?.width ?? 1920));
        }
      } else if (queue.length > 0 && !hidden && !actor.paused) {
        showNext(nowMs);
      }
    }, TICK_MS);
    connectors.start();
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
