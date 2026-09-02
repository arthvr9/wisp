# Wisp

A desktop mascot for GNOME on Wayland, in the spirit of Shimeji. Later phases will read tasks
and meetings through MCP and nudge you about them. This repository is at Phase 0: a spike
that proves the window mechanics work on the target environment and measures what they cost.
Nothing here is the app yet, except `src/main/brain/movement.ts`, which is written to last.

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
npm run dev          # electron-vite with hot reload
npm run test         # vitest, covers the movement module
npm run typecheck
npm run lint
npm run harness      # builds, then runs the 10 minute measurement and prints a summary
npm run harness:short  # same, 1 minute, with a scripted drag self-test
```

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

Acceptance for Phase 0: walks end to end for 10 minutes below 3 percent CPU and can be
dragged with the mouse.

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
src/main/index.ts          entry, loop, harness wiring
src/main/brain/movement.ts pure movement step, tested
src/main/stage/window.ts   the only place that calls setBounds, setShape, setAlwaysOnTop
src/main/harness/          environment report, metrics, CSV, system sampler
src/preload/index.ts       exposes dragStart and dragEnd to the renderer
src/renderer/              React 18, a purple square that reports pointer down and up
src/shared/ipc.ts          channel names and payload types
```

## License

MIT.
