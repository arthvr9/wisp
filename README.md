<p align="center">
  <img src="docs/images/wisp.png" width="120" alt="The Wisp mascot, a small purple creature with a flame on its head">
</p>

<h1 align="center">Wisp</h1>

<p align="center">
  A desktop mascot for GNOME on Wayland. It walks around your screen, reads your tasks
  over MCP, and speaks up when one is about to be due.
</p>

<p align="center">
  <img src="docs/images/poses.png" width="640" alt="Idle, walking, sitting, sleeping, alert, held and celebrating">
</p>

Phase 4 of 8. It runs from source on Ubuntu and Debian 13. There is no package yet, and the
art is a placeholder until the real Aseprite sheet lands.

| The bubble                                                                                                  | Settings                                                                   |
| ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| <img src="docs/images/bubble.png" width="240" alt="A speech bubble above the mascot reading Due in 30 min"> | <img src="docs/images/settings.png" width="300" alt="The settings window"> |

## Why it is built this way

Under Wayland a client cannot position its own window or keep it above others. Electron
therefore runs with the X11 Ozone backend and lives inside XWayland, where both still work.
The window is the character: a 96 by 96 pixel frameless, transparent, non-focusable window
that walks across the screen with `setBounds`. There is no fullscreen click-through overlay,
because `setIgnoreMouseEvents` with `forward` does not exist on Linux.

`focusable: false` makes Chromium create an override-redirect X window. Mutter does not
manage it, so it stays above every managed window and never takes keyboard focus. That is
exactly the behaviour a mascot needs.

## Running

Requires Node 22 or newer.

```
npm install
npm run dev            # electron-vite with hot reload
npm run start          # build and run
npm run test           # vitest: movement, follow, actor, nudges, mood, speech, sprites
npm run typecheck
npm run lint
npm run sprites        # regenerate the placeholder sheet, icons and README images
npm run harness        # build, run the 10 minute measurement, print a summary
npm run harness:short  # same, 1 minute, with a scripted self-test
```

Two flags are passed on the command line by every script and both are required.

- `--ozone-platform=x11`. Electron picks the Ozone platform before the main script runs, so
  `app.commandLine.appendSwitch` alone is too late. Without the flag the browser process stays
  on Wayland while the GPU and renderer children switch to X11, the GPU process crashes in a
  loop and no window appears.
- `--no-sandbox`. Ubuntu 24.04 and newer block unprivileged user namespaces through AppArmor,
  and the setuid `chrome-sandbox` inside `node_modules` is not root owned, so an unpackaged
  Electron aborts on start. A packaged build ships a proper helper and will not need this. To
  keep the sandbox during development:
  `sudo chown root node_modules/electron/dist/chrome-sandbox && sudo chmod 4755 node_modules/electron/dist/chrome-sandbox`.

## Using it

- Left button drags the mascot. Drop it and it falls to the bottom of the work area.
- Right button opens the menu: Pause, Hide, Poke, Snooze for an hour, Settings, Quit. This is
  the kill switch that always works.
- `Control+Alt+W` pauses and resumes, two quick presses hide. Registering succeeds on X11, but
  a Wayland compositor may never deliver the key to an XWayland client, so settings shows the
  registration status and the menu stays primary.
- The tray needs a StatusNotifier host. Ubuntu GNOME ships the AppIndicator extension, plain
  GNOME does not. Wisp checks the session bus at start and disables the tray if none exists.
- Config lives in `~/.config/wisp/config.json`, the task cache in `signals.sqlite` next to it,
  and secrets in `secrets/`, encrypted with the GNOME keyring through safeStorage.

## How it behaves

Every decision is a pure function in `src/main/brain/`, tested with time and randomness
injected. `actor.ts` is a reducer over idle, walk, sit, sleep, alert, drag and celebrate.
`movement.ts` eases to a constant walking speed, bounces on an edge with no neighbour and
crosses to a touching display, mapping Y proportionally and landing on the new ground.
`follow.ts` holds a three second hysteresis before the mascot walks toward the monitor where
the pointer is. Sleep comes after five minutes without input, read from the session idle timer.

Following has a known limit under XWayland. The X server only learns the pointer position
while the pointer is over an X11 window, so Wisp treats an unchanged position as unknown and
never chases a stale point. On a desktop with no other X11 apps it only sees the pointer over
the mascot itself. The GNOME extension in Phase 8 is the real fix.

## ClickUp

Settings has a ClickUp section with a Connect button. Connecting opens the browser on
ClickUp's OAuth page. Wisp listens on a loopback port for the redirect, exchanges the code
with PKCE and stores the tokens encrypted. The client registers itself dynamically, so there
is no app to create in ClickUp and no API key to paste. Only `read` is requested, though the
server advertises `read write` and the SDK may ask for both. Nothing is ever written.

Every few minutes Wisp asks for your open tasks due between seven days ago and two weeks
ahead, validates the answer with Zod and caches it in SQLite through the built in
`node:sqlite`, so there is no native module to compile. Failures back off exponentially with
jitter.

The adapter discovers tool names at runtime by suffix, because the official server's names
were not verified against a live connection. The task shape it validates was observed through
ClickUp's own connector. The first Connect on a real machine is still the test.

## Nudges

`src/main/brain/nudge.ts` decides what deserves a bubble, from the cached signals, the history
of what was already shown, the active silence windows and the budget.

| Kind      | When                                             | Urgency | Repeats                                              |
| --------- | ------------------------------------------------ | ------- | ---------------------------------------------------- |
| due-now   | within the last minute of the due time           | urgent  | once                                                 |
| due-soon  | inside the warning window, 30 minutes by default | normal  | once                                                 |
| overdue   | past due by more than a minute                   | normal  | after 1 h, then 4 h, then daily, stops after 14 days |
| due-today | later today, outside the warning window          | low     | once per day                                         |

Silence is one abstraction, `SilenceWindow[]`, fed by several sources: quiet hours from
settings, GNOME Do Not Disturb read from gsettings, a snooze from the menu, and a fullscreen
X11 window in focus. Quiet hours and fullscreen let an urgent nudge through, the other two do
not. Meetings become a fifth source in Phase 5.

The budget is a hard ceiling, three per hour and twelve per day by default, urgent included.
Excess is dropped rather than queued and comes back on the next decision if it still matters.

## Mood

<p align="center">
  <img src="docs/images/moods.png" width="560" alt="The six moods, from dejected to elated">
</p>

Dejected, stressed, uneasy, calm, cheerful, elated. Events from the last eight hours score the
ladder: a completed task counts up, one completed late counts a little, a task going overdue
counts down, every interruption shown counts down a little, and each quiet hour counts up. The
mood moves one step at a time, stays at least twenty minutes on a step, and climbs out of
dejected on its own after two quiet hours.

Mood shrinks the budget within the hard cap, never past it. Dejected drops to one interruption
per hour, because sadness here is withdrawal rather than volume. It also changes how the
mascot looks and moves through modifiers, not separate sheets: an expression layer over the
eyes, animation speed, and how long it rests. The tray icon mirrors it and returns to neutral
when you hide the mascot on purpose.

## Celebration

When a sync shows a task that was open and is now closed, Wisp aggregates completions for
thirty seconds and celebrates once: a hop for one task, a dance for two or three, a trophy for
four or more. Only your own tasks count, because that is all the adapter fetches.

## Voice

Off by default, in which case the bubble uses fixed lines. A provider can rewrite each line in
the creature's words, with a two second timeout and the fixed line as fallback, so a slow or
absent model never delays a bubble by more than that.

| Provider                 | Notes                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------ |
| Ollama on this machine   | Detected at `localhost:11434`, offered first when found. Nothing leaves the machine. |
| OpenAI-compatible server | Any chat completions endpoint, NVIDIA included. Base URL, model, optional key.       |
| Anthropic                | Official SDK, `claude-opus-5` at low effort by default.                              |

Cloud providers receive task titles and the mood, and settings says so next to the option.
Keys are stored with safeStorage, never in config.json.

The voice sits behind one interface, `src/main/voice/index.ts`. With the provider off, nothing
under `src/main/speech/` and no part of the Anthropic SDK is loaded. To remove the feature:
delete `src/main/speech/` and `src/main/voice/model.ts`, return `silentVoice()` from
`createVoice`, drop the Voice section from settings and `@anthropic-ai/sdk` from package.json.

## Sprites

`resources/sprites/wisp.png` and `wisp.json` follow the Aseprite JSON export, hash format,
with tags named after the poses. The current files are generated by
`scripts/make-placeholder-sprites.mjs`. Export from Aseprite with the same tag names and drop
the two files in, nothing else changes. Frames are 32 by 32 drawn at 3x on a canvas with
`image-rendering: pixelated`.

`meta.wisp.bob` is a small extension the real exporter does not produce: it says how far each
frame moves the eyes, so the expression overlay lands on them. Leave it out and the offsets
are zero.

## What the harness measures

`npm run harness` runs the mascot for ten minutes without interaction and writes to
`harness-results/<timestamp>/`.

| File            | Contents                                                                        |
| --------------- | ------------------------------------------------------------------------------- |
| `ticks.csv`     | Every loop tick with the real interval and its deviation from the 33 ms target. |
| `processes.csv` | Every 5 s, CPU and working set per Electron process from `app.getAppMetrics()`. |
| `system.csv`    | Every 5 s, CPU of `gnome-shell` and `Xwayland` from `/proc`, whole process.     |
| `summary.txt`   | p50, p95 and max of the loop deviation, mean and peak CPU, memory per process.  |

At startup it logs the session type, the Electron version, the requested and effective Ozone
platform (verified by querying the window's XID with `xprop`), the display layout, whether
`setShape` worked, and where the cursor is.

Phase 0 acceptance was ten minutes below 3 percent CPU while walking, and being draggable. On
this machine it measured 0.14 percent mean CPU and a p95 loop deviation of 0.31 ms. Run it
again after changes that touch the loop.

## Tested environments

| Machine | OS        | GNOME | Electron | CPU mean | CPU peak | Loop dev p50 / p95 / max (ms) | Drag works | Notes |
| ------- | --------- | ----- | -------- | -------- | -------- | ----------------------------- | ---------- | ----- |
|         | Ubuntu    |       |          |          |          |                               |            |       |
|         | Debian 13 |       |          |          |          |                               |            |       |

## Layout

```
src/main/index.ts            entry, loop, IPC, harness wiring
src/main/brain/              pure: movement, follow, actor, silence, nudges, mood, celebration
src/main/stage/              the only place that calls setBounds, setShape, setAlwaysOnTop
src/main/mcp/                MCP client host, OAuth PKCE loopback provider, encrypted secrets
src/main/signals/            SQLite cache with diff, scheduler with backoff, ClickUp adapter
src/main/speech/             prompt, sanitizer, provider adapters, Ollama detection
src/main/voice/              the interface the app sees, and its lazy implementation
src/main/harness/            environment report, metrics, CSV, system sampler
src/renderer/                React: mascot canvas, bubble, settings
src/shared/                  poses, config shape, IPC channels, i18n
resources/                   sprite sheet, Aseprite metadata, tray icons
scripts/                     placeholder sprite generator, README image generator
```

## Roadmap

| Phase | What                                                                       | State   |
| ----- | -------------------------------------------------------------------------- | ------- |
| 0     | Spike: prove the window mechanics and measure the cost                     | Done    |
| 1     | Life: the creature walks, sleeps, follows, and can be dismissed            | Done    |
| 2     | Signal: the first real data, ClickUp tasks over MCP                        | Done    |
| 3     | Judgement: rules, silence windows, a budget                                | Done    |
| 4     | Soul: mood, celebration, an optional voice                                 | Done    |
| 5     | Proof: a second connector, Outlook calendar, to test the abstraction       | Next    |
| 6     | Action: click the mascot and act on the day                                | Planned |
| 7     | Showcase: package, document, publish                                       | Planned |
| 8     | If it is worth it: a native GNOME extension instead of the XWayland window | Maybe   |

## License

MIT.
