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
import type { Display, Point, WebContents } from 'electron';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { autostartPath, setAutostart } from './autostart';
import { createActor, reduce } from './brain/actor';
import { activeSilence, quietHoursWindows } from './brain/silence';
import { feed as feedShake, initialShake } from './brain/gesture';
import { createLinePicker } from './brain/lines';
import { decideMusic, initialMusicState } from './brain/music';
import { initialRhythm, step as rhythmStep } from './brain/rhythm';
import type { RhythmEvent } from './brain/rhythm';
import type { ActorState } from './brain/actor';
import { groundY } from './brain/movement';
import type { DisplayArea, Target } from './brain/movement';
import { ConfigStore } from './config';
import {
  ConnectorHub,
  createCalendarConnector,
  createClickUpConnector,
  createGruplyConnector,
} from './connectors';
import { meetingWindows } from './brain/meetings';
import { loadDotEnv } from './env';
import { SecretStore } from './mcp';
import { SilenceSources } from './silence';
import { createVoice } from './voice';
import { translator } from '../shared/i18n';
import type { Params } from '../shared/i18n';
import type { MessageKey } from '../shared/i18n/en';
import type { Celebration, Mood, MoodModifiers } from '../shared/mood';
import type { SpeechEvent, SpeechRequest } from '../shared/speech';
import type { Nudge } from '../shared/nudges';
import type { DayItem, SignalAction, SignalSource } from '../shared/signals';
import { describeEnvironment, formatEnvironment } from './harness/environment';
import { Harness, formatSummary } from './harness/metrics';
import { hasCustomMascot } from './mascots';
import { registerMascotIpc } from './mascots/ipc';
import { menuTemplate } from './menu';
import { MusicWatcher, MUSIC_POLL_MS } from './music';
import { registerShortcut, SHORTCUT } from './shortcut';
import { createBubble } from './stage/bubble';
import { createPanel } from './stage/panel';
import { openSettings } from './stage/settings';
import { createStage, MASCOT_SIZE } from './stage/window';
import { createTray, detectTray } from './tray';
import type { TrayHandle } from './tray';
import type { Config } from '../shared/config';
import { IPC } from '../shared/ipc';
import type { DragStart, EnvironmentInfo } from '../shared/ipc';

// Native Wayland clients cannot position their own windows or stay above others, which is
// the whole point of this app. Forcing the X11 backend routes us through XWayland, where
// both still work. Electron picks the Ozone platform for the browser process before this
// script runs, so this call alone is too late: it only reaches the GPU and renderer
// children, and the mismatch crashes the GPU process. The flag must also be on the command
// line (see scripts/run-electron.mjs). This line stays so the intent is visible next to the
// check. Off Linux there is no Ozone and nothing to force.
const OZONE_FLAG = '--ozone-platform=x11';
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('ozone-platform', 'x11');
  if (!process.argv.includes(OZONE_FLAG)) {
    // A packaged build is started from a desktop file or a double click, with no npm script
    // to carry the flag, and by now the browser process has already chosen its platform. The
    // only fix left is to start over with the flag on the command line. Passing it in the new
    // argv is also what stops this from looping: the next process sees it and skips.
    if (app.isPackaged) {
      app.relaunch({ args: [...process.argv.slice(1), OZONE_FLAG] });
      app.exit(0);
    } else {
      console.error(`warning: ${OZONE_FLAG} missing from the command line, window will not be X11`);
    }
  }
}

const RHYTHM_LINES: Record<RhythmEvent, MessageKey> = {
  morning: 'phrase.morning',
  endOfDay: 'phrase.endOfDay',
  friday: 'phrase.friday',
  welcomeBack: 'phrase.welcomeBack',
};

const TICK_MS = 33;
// Long enough to read, short enough that the mascot is not still talking about it later.
const PET_BUBBLE_MS = 2600;
const STARTLE_BUBBLE_MS = 2200;
const RHYTHM_CHECK_MS = 20_000;
const RHYTHM_BUBBLE_MS = 4200;
const DANCE_BUBBLE_MS = 3000;
const TRACK_BUBBLE_MS = 2400;
// How close the cursor has to be to the middle of the mascot for a shake to be aimed at it.
const SHAKE_REACH_PX = MASCOT_SIZE;
const SAMPLE_MS = 5000;
const BUBBLE_MS = 12_000;

function toArea(d: Display): DisplayArea {
  return { id: d.id, ...d.workArea };
}

function withoutSecrets(c: Config): Config {
  return { ...c, calendar: { ...c.calendar, icsUrl: c.calendar.icsUrl === '' ? '' : '(set)' } };
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
  // A mascot folder can be deleted behind the app's back. Clearing the setting here means the
  // next start shows the built-in art rather than nothing at all.
  if (config.get().customMascot !== '' && !hasCustomMascot(config.get().customMascot)) {
    config.set({ customMascot: '' });
  }
  const broadcast = (channel: string, payload: unknown) => {
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel, payload);
  };
  const secrets = new SecretStore(safeStorage, join(app.getPath('userData'), 'secrets'));
  const voice = createVoice(secrets, config.get().speech, (status) => {
    broadcast(IPC.speechStatusChanged, status);
  });
  const minutes = harnessMinutes();
  // Results go next to the source tree, where they are easy to read. In a packaged build that
  // path is inside app.asar and mkdir fails, taking the whole startup with it, so a packaged
  // run writes to userData instead.
  const resultsRoot = join(app.isPackaged ? app.getPath('userData') : appPath, 'harness-results');
  const harness = minutes === undefined ? undefined : new Harness(TICK_MS, resultsRoot);

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
        return say('phrase.dueSoon', { minutes: n.minutesLeft, title: n.title });
      case 'due-now':
        return say('phrase.dueNow', { title: n.title });
      case 'overdue':
        return say(n.repeat > 0 ? 'phrase.overdueAgain' : 'phrase.overdue', { title: n.title });
      case 'due-today':
        return say('phrase.dueToday', { title: n.title });
      case 'meeting-soon':
        return say('phrase.meetingSoon', { minutes: n.minutesLeft, title: n.title });
      case 'meeting-now':
        return say('phrase.meetingNow', { title: n.title });
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
    const fallback = say(key, { title: c.titles[0] ?? '', count: c.count });
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
      createCalendarConnector({ config: () => config.get().calendar }),
      createGruplyConnector({ token: gruplyToken, config: () => config.get().gruply }),
    ],
    secrets,
    pollMinutes: () => config.get().pollMinutes,
    dueSoonMinutes: () => config.get().dueSoonMinutes,
    meetingWarnMs: () => config.get().calendar.warnMinutes * 60_000,
    budget: () => config.get().budget,
    silence: (nowMs) => [
      ...quietHoursWindows(config.get().quietHours, nowMs),
      ...silence.windows(nowMs),
    ],
    extraSilence: (signals) =>
      meetingWindows(signals, { enabled: config.get().calendar.silenceDuringMeetings }),
    silenceStatus: (nowMs) => {
      const windows = [
        ...quietHoursWindows(config.get().quietHours, nowMs),
        ...silence.windows(nowMs),
        ...meetingWindows(connectors.signals(), {
          enabled: config.get().calendar.silenceDuringMeetings,
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
  ipcMain.on(IPC.pet, () => {
    if (hidden || actor.paused) return;
    actor = reduce(actor, { type: 'pet' }, target);
    speak('pet', say('phrase.pet'), {}, undefined, PET_BUBBLE_MS, () => undefined);
  });
  ipcMain.on(IPC.panelToggle, () => {
    togglePanel();
  });
  ipcMain.on(IPC.panelClose, () => {
    panel.hide();
  });
  app.on('before-quit', () => {
    silence.stop();
    music.stop();
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
      say('phrase.poke'),
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
  const lines = createLinePicker(Math.random);
  // Most moments have several wordings. The picker draws one and keeps the previous draw out of
  // the next, so the mascot does not say the same sentence twice running.
  const say = (key: MessageKey, params?: Params): string => t(lines.pick(key), params);

  // Music, the rhythm of the day and the shake gesture. None of these carry information, so none
  // of them go through the nudge budget: they are reactions, not messages.
  const music = new MusicWatcher();
  let musicState = initialMusicState;
  let nextMusicCheck = 0;
  let rhythm = initialRhythm;
  let nextRhythmCheck = 0;
  let shake = initialShake;
  // Night mode settles the mascot as well as darkening the windows: it walks slower and rests
  // longer. The mood modifiers are scaled rather than replaced, so a stressed mascot at night is
  // still more restless than a calm one.
  const NIGHT_SPEED = 0.7;
  const NIGHT_PAUSE = 1.6;
  const nightAdjusted = (m: MoodModifiers): MoodModifiers =>
    config.get().night
      ? { ...m, speedFactor: m.speedFactor * NIGHT_SPEED, pauseFactor: m.pauseFactor * NIGHT_PAUSE }
      : m;
  let dragTrail: { x: number; y: number } | undefined;
  let dragVelocity = { vx: 0, vy: 0 };

  // A meeting reports playback exactly as a song does, so browser audio is not trusted while one
  // is running. The user's preference about being silenced during meetings is a separate
  // question, which is why this asks with `enabled: true` regardless of it.
  const inMeeting = (nowMs: number): boolean =>
    meetingWindows(connectors.signals(), { enabled: true }).some(
      (w) => w.from <= nowMs && nowMs < w.to,
    );
  // Reactions are not nudges and have no budget, but they still keep quiet when everything else
  // does. A mascot that comments on your Friday during Do Not Disturb is the reason people turn
  // these things off.
  const quietNow = (nowMs: number): boolean =>
    activeSilence(
      [
        ...quietHoursWindows(config.get().quietHours, nowMs),
        ...silence.windows(nowMs),
        ...meetingWindows(connectors.signals(), { enabled: true }),
      ],
      nowMs,
      'low',
    ) !== undefined;
  const canReact = (nowMs: number): boolean =>
    !hidden && !actor.paused && !bubble.isVisible() && !quietNow(nowMs);

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
      speak('poke', say('phrase.poke'), {}, undefined, 4000, () => {
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
    toggleNight() {
      config.set({ night: !config.get().night });
      refreshMenus();
    },
    openSettings() {
      openSettings(appPath, config.get().mascot);
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
      night: config.get().night,
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
    tray?.setMascot(c.mascot);
    try {
      setAutostart(c.autostart, c.mascot);
    } catch (err) {
      console.error('autostart update failed', err);
    }
    refreshMenus();
  };
  applyConfig(config.get());
  config.onChange((c) => {
    applyConfig(c);
    voice.configure(c.speech);
    applyMusicSetting(c.music);
    // The bubble is on this list because it carries the theme too. It gets the redacted config
    // like the other owned windows: only the settings window is trusted with the calendar link.
    stage.win.webContents.send(IPC.configChanged, withoutSecrets(c));
    panel.win.webContents.send(IPC.configChanged, withoutSecrets(c));
    bubble.win.webContents.send(IPC.configChanged, withoutSecrets(c));
    for (const w of openSettingsWindows()) w.webContents.send(IPC.configChanged, c);
  });

  // Turning the setting off stops the polling entirely rather than throwing the readings away,
  // and clears the dance so the mascot does not keep moving to music it can no longer hear.
  let musicRunning = false;
  function applyMusicSetting(on: boolean): void {
    if (on === musicRunning) return;
    musicRunning = on;
    if (on) {
      music.start();
      return;
    }
    music.stop();
    if (musicState.dancing) actor = reduce(actor, { type: 'dance-stop' }, target);
    musicState = initialMusicState;
  }

  // Only the settings window edits the calendar link, and anyone holding it can read the
  // calendar, so it never travels to the mascot or the panel.
  function isSettings(contents: WebContents): boolean {
    return openSettingsWindows().some((w) => w.webContents === contents);
  }

  // Anything that is not one of the windows Wisp owns is a settings window. Listing the owned
  // ones explicitly means a new window added later defaults to the safe side.
  function openSettingsWindows() {
    const owned = [stage.win, panel.win, bubble.win];
    return BrowserWindow.getAllWindows().filter((w) => !owned.includes(w));
  }

  ipcMain.handle(IPC.configGet, (event) =>
    isSettings(event.sender) ? config.get() : withoutSecrets(config.get()),
  );
  ipcMain.handle(IPC.configSet, (_event, patch: Partial<Config>) => config.set(patch));
  ipcMain.handle(IPC.environmentGet, (): EnvironmentInfo => ({
    trayAvailable: tray !== undefined,
    shortcut: SHORTCUT,
    shortcutRegistered,
    autostartPath: autostartPath(),
  }));

  // Every folder picker for hand drawn art opens in main, so a path never crosses IPC and the
  // renderer never names a directory. `t` is passed as a getter because main reassigns it when
  // the locale or the creature's name changes.
  registerMascotIpc({ t: () => t });

  let drag: DragStart | undefined;
  ipcMain.on(IPC.dragStart, (_event, offset: DragStart) => {
    if (!Number.isFinite(offset.offsetX) || !Number.isFinite(offset.offsetY)) return;
    drag = offset;
    dragTrail = undefined;
    dragVelocity = { vx: 0, vy: 0 };
    actor = reduce(actor, { type: 'drag-start' }, target);
  });
  ipcMain.on(IPC.dragEnd, () => {
    drag = undefined;
    const b = stage.bounds();
    const displayId = screen.getDisplayMatching(b).id;
    const { vx, vy } = dragVelocity;
    dragTrail = undefined;
    dragVelocity = { vx: 0, vy: 0 };
    actor = reduce(actor, { type: 'drag-end', x: b.x, y: b.y, displayId, vx, vy }, target);
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
      const w = openSettings(appPath, config.get().mascot);
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
    // The walk cycle is driven by the ground covered, so a walking mascot sends every tick.
    const walkPx = actor.pose === 'walk' ? actor.walkDistance : undefined;
    const key = `${actor.pose}/${actor.facing}/${m.expression}/${m.speedFactor}/${intensity ?? ''}/${walkPx ?? ''}`;
    if (key === lastPose) return;
    lastPose = key;
    stage.win.webContents.send(IPC.pose, {
      pose: actor.pose,
      facing: actor.facing,
      expression: m.expression,
      speedFactor: m.speedFactor,
      ...(intensity === undefined ? {} : { intensity }),
      ...(walkPx === undefined ? {} : { walkPx }),
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
        const x = p.x - drag.offsetX;
        const y = p.y - drag.offsetY;
        // Release velocity is measured here rather than in the renderer, because main is the only
        // side that knows where the window actually ended up. It is smoothed so that one jittery
        // frame at the moment of release does not decide how far the mascot flies, and so that
        // holding it still for a moment before letting go drops it rather than throws it.
        if (dragTrail && dt > 0) {
          const k = 0.35;
          dragVelocity = {
            vx: dragVelocity.vx * (1 - k) + ((x - dragTrail.x) / dt) * 1000 * k,
            vy: dragVelocity.vy * (1 - k) + ((y - dragTrail.y) / dt) * 1000 * k,
          };
        }
        dragTrail = { x, y };
        stage.moveTo(x, y);
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
          mood: nightAdjusted(connectors.modifiers()),
        },
        target,
      );
      if (!hidden) stage.moveTo(Math.round(actor.x), Math.round(actor.y));
      pushPose();

      const nowMs = Date.now();

      // The cursor was already sampled by cursorDisplayId above, so the shake window is fed from
      // that reading rather than asking the screen for the pointer a second time. XWayland only
      // updates the X pointer while it is over an X window, so this reading goes stale when the
      // pointer is over a native Wayland window. That is harmless here: a shake only counts when
      // the pointer is over the mascot, which is an X window, so the samples that decide it are
      // exactly the accurate ones.
      if (lastCursor) {
        const result = feedShake(shake, { x: lastCursor.x, y: lastCursor.y, tMs: nowMs });
        shake = result.state;
        const overMascot =
          Math.abs(lastCursor.x - (actor.x + MASCOT_SIZE / 2)) < SHAKE_REACH_PX &&
          Math.abs(lastCursor.y - (actor.y + MASCOT_SIZE / 2)) < SHAKE_REACH_PX;
        if (result.shook && overMascot && canReact(nowMs)) {
          actor = reduce(actor, { type: 'startle', cursorX: lastCursor.x }, target);
          speak(
            'startle',
            say('phrase.startle'),
            {},
            undefined,
            STARTLE_BUBBLE_MS,
            () => undefined,
          );
        }
      }

      if (nowMs >= nextMusicCheck) {
        nextMusicCheck = nowMs + MUSIC_POLL_MS;
        const decision = decideMusic(musicState, music.current(), nowMs, {
          includeUnverified: !inMeeting(nowMs),
        });
        musicState = decision.state;
        // The pose is dispatched whether or not the mascot is on screen, so hiding it during a
        // song does not leave it dancing when it comes back. Only the line waits for a moment.
        if (decision.started) actor = reduce(actor, { type: 'dance-start' }, target);
        if (decision.stopped) actor = reduce(actor, { type: 'dance-stop' }, target);
        if (decision.started && canReact(nowMs)) {
          speak('dance', say('phrase.dance'), {}, undefined, DANCE_BUBBLE_MS, () => undefined);
        } else if (decision.trackChanged && canReact(nowMs)) {
          speak('dance', say('phrase.track'), {}, undefined, TRACK_BUBBLE_MS, () => undefined);
        }
      }

      if (nowMs >= nextRhythmCheck) {
        nextRhythmCheck = nowMs + RHYTHM_CHECK_MS;
        const beat = rhythmStep(rhythm, {
          nowMs,
          idleMs: powerMonitor.getSystemIdleTime() * 1000,
        });
        rhythm = beat.state;
        if (beat.event !== undefined && canReact(nowMs)) {
          const arriving = beat.event === 'morning' || beat.event === 'welcomeBack';
          const voiceEvent: SpeechEvent = arriving ? 'hello' : 'dayEnd';
          speak(voiceEvent, say(RHYTHM_LINES[beat.event]), {}, undefined, RHYTHM_BUBBLE_MS, () => {
            actor = reduce(actor, { type: 'alert', ms: RHYTHM_BUBBLE_MS }, target);
          });
        }
      }

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
    applyMusicSetting(config.get().music);
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
