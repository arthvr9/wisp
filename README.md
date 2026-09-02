# Wisp

A desktop mascot for GNOME on Wayland, in the spirit of Shimeji. Later phases will read tasks
and meetings through MCP and nudge you about them. Phase 0 proved the window mechanics on
the target environment and measured what they cost. Phase 1 made the creature alive without
any external data: it walks, sits, sleeps and follows you between monitors, and you can pause,
hide or quit it from a right-click menu, a global shortcut or the tray. Phase 2 brought the
first real signal: your open ClickUp tasks with a due date, read through the official ClickUp
MCP server, shown in a speech bubble when they are about to be due. Phase 3 added judgement: a
rules table decides what deserves a bubble, silence windows decide when, and a hard budget caps
how often. Phase 4 gives it a soul: a mood that follows your day, a celebration when tasks get
done, and an optional voice from a language model, local first.

## Target

Linux, GNOME, Wayland session. Ubuntu and Debian 13.

Under Wayland a client cannot position its own window or keep it above others. Electron
therefore runs with the X11 Ozone backend and lives inside XWayland, where both still work.
The window is the character: a 96 by 96 pixel frameless, transparent, non-focusable window
that walks across the screen with `setBounds`.

## Running

Requires Node 22 or newer.

```
npm install
npm run dev            # electron-vite with hot reload
npm run start          # build and run
npm run test           # vitest: movement, follow, actor reducer, sprites, i18n
npm run typecheck
npm run lint
npm run sprites        # regenerate the placeholder sprite sheet and icons
npm run harness        # build, run the 10 minute measurement, print a summary
npm run harness:short  # same, 1 minute, with a scripted drag self-test
```

## Using it

- Left button drags the mascot. Drop it and it falls to the bottom of the work area.
- Right button opens the menu: Pause or Resume, Hide or Show, Poke, Settings, Quit. This is
  the kill switch that always works.
- `Control+Alt+W` pauses or resumes; two quick presses hide. Registering succeeds on X11 but
  a Wayland compositor may never deliver the key to an XWayland client, so the settings page
  shows the registration status and the menu stays primary.
- The tray needs a StatusNotifier host. Ubuntu GNOME ships the AppIndicator extension, plain
  GNOME does not. Wisp checks the session bus at start and disables the tray if none exists.
- Settings: name (used as `{name}` in the mascot's lines), language (English only for now),
  start with the session (writes `~/.config/autostart/wisp.desktop`), follow the cursor.
- Config lives in `~/.config/wisp/config.json`.

## How it behaves

All decisions are pure functions in `src/main/brain/`, tested with time and randomness
injected. `actor.ts` is a reducer over the poses idle, walk, sit, sleep, alert and drag.
`movement.ts` eases to a constant walking speed, bounces on an edge with no neighbour and
crosses to a touching display, mapping Y proportionally and landing on the new ground.
`follow.ts` holds a 3 second hysteresis before the mascot walks toward the monitor where the
pointer is. Sleep comes after 5 minutes without input, read from the session idle timer.

Following has a known limit under XWayland: the X server only learns the pointer position
while the pointer is over an X11 window. Wisp treats a position that did not change since the
last tick as unknown, so it never chases a stale point, but on a desktop with no other X11
apps it only sees the pointer when it is over the mascot itself. The GNOME extension in Phase
8 is the real fix.

## ClickUp

Settings has a ClickUp section with a Connect button. Connecting opens the browser on
ClickUp's OAuth page; Wisp listens on a loopback port for the redirect, exchanges the code
with PKCE and stores the tokens encrypted with Electron's safeStorage (the GNOME keyring) under
`~/.config/wisp/secrets/`. The client registers itself dynamically, there is no app to create
in ClickUp and no API key to paste. Only the `read` scope is requested by Wisp, though the
server advertises `read write` and the SDK may ask for both. Nothing is ever written.

Every few minutes (5 by default, exponential backoff with jitter on failures) Wisp asks the
server for your open tasks due between seven days ago and two weeks ahead, validates the
answer with Zod and stores the result in `~/.config/wisp/signals.sqlite` (the Node built-in
`node:sqlite`, no native module). A task due within the warning window (30 minutes by
default) makes the mascot stop, take the alert pose and show a bubble with the task name.
What gets shown, and when, is decided by the nudge engine below.

## Nudges

`src/main/brain/nudge.ts` is a pure function over the cached signals, the history of what was
already shown, the active silence windows and the budget. `now` is an argument, so the whole
day can be simulated in tests. The rules:

| Kind      | When                                       | Urgency | Repeats                                              |
| --------- | ------------------------------------------ | ------- | ---------------------------------------------------- |
| due-now   | within the last minute of the due time     | urgent  | once                                                 |
| due-soon  | inside the warning window (30 min default) | normal  | once                                                 |
| overdue   | past due by more than a minute             | normal  | after 1 h, then 4 h, then daily; stops after 14 days |
| due-today | later today, outside the warning window    | low     | once per day                                         |

Silence windows are one abstraction, `SilenceWindow[]`, with several sources:

- Quiet hours from settings (19:00 to 08:00 by default). Urgent nudges still pass.
- GNOME Do Not Disturb, read from `org.gnome.desktop.notifications show-banners` every 30 s.
  Blocks everything.
- Snooze for an hour from the right-click menu. Blocks everything.
- A fullscreen X11 window in focus. Urgent still passes. Wayland-native fullscreen apps are
  invisible from XWayland, so this source is partial.
- Meetings arrive as a fifth source in Phase 5.

The budget is a hard ceiling: at most 3 nudges per hour and 12 per day by default, urgent ones
included. Excess is dropped, not queued, and shows up again on the next decision if still
relevant. Settings shows when a silence source is active.

The adapter discovers tool names at runtime by suffix (`filter_tasks`, `resolve_assignees`)
because the official server's names were not verified against a live connection. The task
shape it validates was observed through ClickUp's connector. The full OAuth round trip against
`mcp.clickup.com` has not been exercised yet; the first Connect on a real machine is the test.

## Mood

`src/main/brain/mood.ts` keeps a six-step ladder: dejected, stressed, uneasy, calm, cheerful,
elated. Events from the last eight hours score it: a completed task counts up, a task
completed late counts a little, a task going overdue counts down, every interruption shown
counts down a little, and each quiet hour counts up. The mood moves one step at a time and
stays at least twenty minutes on a step. Dejected climbs back on its own after two quiet hours.

Mood changes the budget within the hard cap, never above it: uneasy and stressed shrink the
hourly allowance, dejected drops to one interruption per hour and four per day. Sadness here is
withdrawal, not volume. Mood also changes how the mascot looks and moves through modifiers,
not separate sprite sheets: an expression layer over the eyes, animation speed and how long it
rests. The tray icon mirrors the mood and returns to neutral when you hide the mascot on
purpose.

## Celebration

When a sync shows a task that was open and is now closed, Wisp aggregates completions for
thirty seconds and celebrates once: a hop for one task, a dance for two or three, a trophy for
four or more. Only tasks assigned to you count, because the adapter only fetches those.

## Voice

Settings has a Voice section. Off by default: the bubble uses the fixed lines. A provider can
rewrite each line in the creature's words, with a two second timeout and the fixed line as
fallback, so a slow or absent model never delays a bubble by more than that.

- Ollama on this machine. Detected at `localhost:11434`; the models it lists are offered.
  Nothing leaves the machine. This is the preset offered first when it is found.
- OpenAI-compatible server. Any chat completions endpoint, NVIDIA included. Base URL, model
  and an optional API key.
- Anthropic. Official SDK, default model `claude-opus-5` at low effort. API key required.

Cloud providers receive task titles and the mood. The settings page says so next to the
option. API keys are stored encrypted with safeStorage, never in config.json.

The voice is an optional module behind one interface, `src/main/voice/index.ts`. With the
provider off, nothing under `src/main/speech/` or the Anthropic SDK is loaded; the module is
pulled in on demand when settings opens or a provider is chosen. To drop the feature entirely:
delete `src/main/speech/` and `src/main/voice/model.ts`, return `silentVoice()` from
`createVoice`, remove the Voice section from the settings page and `@anthropic-ai/sdk` from
package.json.

## Sprites

`resources/sprites/wisp.png` and `wisp.json` follow the Aseprite JSON export (hash format,
tags named after the poses). The current files are a code-generated placeholder from
`scripts/make-placeholder-sprites.mjs`. Export from Aseprite with the same tag names and drop
the two files in; nothing else changes. Frames are 32x32 drawn at 3x on a canvas with
`image-rendering: pixelated`.

Two flags are passed on the command line by every script and both are required:

- `--ozone-platform=x11`. Electron picks the Ozone platform before the main script runs, so
  `app.commandLine.appendSwitch` alone is too late. Without the flag the browser process
  stays on Wayland while the GPU and renderer children switch to X11, the GPU process
  crashes in a loop and no window appears.
- `--no-sandbox`. Ubuntu 24.04 and newer block unprivileged user namespaces through
  AppArmor, and the setuid `chrome-sandbox` inside `node_modules` is not root-owned, so an
  unpackaged Electron aborts on start. A packaged build ships a proper helper and will not
  need this. If you prefer the sandbox during development:
  `sudo chown root node_modules/electron/dist/chrome-sandbox && sudo chmod 4755 node_modules/electron/dist/chrome-sandbox`.

## What the harness measures

`npm run harness` runs the mascot for 10 minutes without interaction and writes to
`harness-results/<timestamp>/`:

- `ticks.csv`: every loop tick with the real interval and its deviation from the 33 ms
  target. The summary reports p50, p95 and max of the deviation. This is the signal that the
  compositor is stalling.
- `processes.csv`: every 5 seconds, `app.getAppMetrics()` per Electron process: CPU percent
  (of one core) and working set in KB. The first sample is discarded because it has no
  previous reading to diff against.
- `system.csv`: every 5 seconds, CPU of `gnome-shell` and `Xwayland` read from `/proc`.
  These are whole-process numbers, not only our share, since the compositor also serves
  every other window. Watch the difference between an idle desktop and a run.
- `summary.txt` and `summary.json`: the numbers below.

At startup the harness logs `XDG_SESSION_TYPE`, the Electron version, the requested and the
effective Ozone platform (verified by querying the window's XID with `xprop`), the display
layout, whether `setShape` worked, and the cursor position with the display it is on.

Phase 0 acceptance was: walks end to end for 10 minutes below 3 percent CPU and can be
dragged with the mouse. Run the harness again after changes that touch the loop.

## Findings from the spike

- `focusable: false` makes Chromium create an override-redirect X window. Mutter does not
  manage it, so it stacks above every managed window, including the active one, and never
  takes keyboard focus. `alwaysOnTop` and `isAlwaysOnTop()` are moot for it. This is the
  behaviour we want.
- `setShape` accepts a list of rectangles and does not throw. Corner cut of 8 pixels is
  applied in `src/main/stage/window.ts`.
- `screen.getCursorScreenPoint()` responds under XWayland. XWayland only learns the pointer
  position while the pointer is over an X window, so over Wayland-native windows it reports
  the last known position. Dragging is unaffected because the pointer is over the mascot.
- Movement is a pure function in `src/main/brain/movement.ts`. Speed is constant per second
  regardless of tick length. The mascot bounces at an edge with no neighbour and crosses to a
  touching display, mapping Y proportionally when heights differ.

## Tested environments

| Machine | OS        | GNOME | Electron | CPU mean | CPU peak | Loop dev p50 / p95 / max (ms) | Drag works | Notes |
| ------- | --------- | ----- | -------- | -------- | -------- | ----------------------------- | ---------- | ----- |
|         | Ubuntu    |       |          |          |          |                               |            |       |
|         | Debian 13 |       |          |          |          |                               |            |       |

## Layout

```
src/main/index.ts            entry, loop, IPC, harness wiring
src/main/brain/              pure: movement, follow, actor, silence, nudges, mood ladder, celebration
src/main/stage/              the only place that calls setBounds, setShape, setAlwaysOnTop
src/main/harness/            environment report, metrics, CSV, system sampler
src/main/connectors.ts       ties MCP host, signal store, scheduler, nudges, mood and celebration
src/main/voice.ts            speech provider selection, API key, status
src/main/speech/             prompt, sanitizer, OpenAI-compatible and Anthropic adapters, Ollama detection
src/main/silence.ts          system silence sources: Do Not Disturb, X11 fullscreen, snooze
src/main/mcp/                MCP client host, OAuth PKCE loopback provider, encrypted secrets
src/main/signals/            SQLite cache with diff, scheduler with backoff, ClickUp adapter
src/main/config.ts           JSON config store
src/main/autostart.ts        .desktop file in ~/.config/autostart
src/main/tray.ts             StatusNotifier detection and tray
src/main/shortcut.ts         global shortcut
src/main/menu.ts             context menu template
src/preload/index.ts         window.wisp bridge
src/renderer/                React 18: mascot canvas page and settings page
src/shared/                  poses, config shape, IPC channels, i18n
resources/sprites/           sprite sheet and Aseprite metadata
scripts/                     placeholder sprite generator
```

## License

MIT.
