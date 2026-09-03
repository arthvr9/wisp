# The Wayland problem

A field report from building a desktop mascot for GNOME on Wayland. It is not a tutorial. It is
the set of things that had to be found out the hard way, written down so the next person who
tries to put a window above other windows on a modern Linux desktop does not have to find them
again.

Everything here is against Wisp as it stands at version 0.1.0: an Electron app, a 96 by 96 pixel
frameless transparent window that walks across the screen, on Ubuntu with GNOME under a Wayland
session. Where a claim was corrected during the work, the correction is kept, because a wrong
assumption that got fixed is more useful to read than a confident one.

## 1. The problem

A Wayland client cannot place its own window on the screen, and cannot put itself above other
windows. In Electron terms:

- `setBounds({ x, y, width, height })` applies the size and ignores the position.
- `setAlwaysOnTop(true)` does nothing.

This is not a bug and not an oversight. Under X11 any client could move any window, raise itself
above everything, and read the global pointer position, which is also how X11 keyloggers work.
Wayland removed the whole category. Window placement and stacking belong to the compositor, and
the client only asks for a surface. For a text editor or a browser this is correct and nobody
notices. For an app whose entire premise is a small creature that walks around on top of your
work, it is fatal. There is no polite version of "the mascot may appear wherever GNOME feels
like putting it".

So the question is not how to work around an API gap. It is whether the app can exist at all on
this display server, and if so, at what price.

## 2. What does not work

Three answers come up immediately. All three fail here.

**Native Wayland with layer shell.** The layer shell protocol (`wlr-layer-shell-unstable-v1`)
exists precisely for panels, docks and overlays: surfaces that sit in a defined layer above or
below normal windows. It is the right protocol for this job and it is not reachable. It is a
protocol extension a toolkit has to implement, Chromium does not expose it to an Electron app,
and GNOME's compositor, Mutter, is not among the compositors that implement it. Reaching it
would mean a different toolkit or a different desktop. This is the one claim in this document
that comes from outside the repository rather than from a measurement in it: what the repository
establishes is only that native Wayland was tried, could not position or stack the window, and
was abandoned.

**A fullscreen transparent click-through overlay.** The standard trick for this class of app on
Windows and macOS: one window covering the screen, transparent everywhere except where the
character is drawn, with mouse events passed through the transparent parts to whatever is
underneath. Electron's API for it is:

```js
win.setIgnoreMouseEvents(true, { forward: true });
```

The `forward` option is documented as macOS and Windows only. Without it, `setIgnoreMouseEvents`
makes the window ignore clicks entirely, including the clicks meant for the character, which
defeats the point. There is no Linux equivalent in Electron.

That single missing option decides the whole shape of the app. It is why Wisp is a small window
that walks rather than a large transparent one that draws. Everything downstream, the bubble and
the panel being separate windows, the movement code working in screen coordinates rather than
canvas coordinates, the 33 ms `setBounds` loop, follows from `forward` not existing on Linux.

A correction worth recording, since the reasoning above is easy to overextend. While studying a
port to other platforms, two assumptions turned out to be wrong:

- The inability to click through a transparent area is **not** a Linux quirk. Electron documents
  it as a cross platform limitation of transparent windows. What is Linux specific is only the
  absence of `forward` as a way around it. So the bubble and the panel would still be separate
  windows on Windows and macOS by choice, not by force.
- `setShape` is **not** X11 only. It is documented as Windows, Linux and experimental. It is
  macOS where it does not exist. Wisp uses it to cut the four corners of the mascot window so
  clicks fall through them, and the code already degrades cleanly where it is missing.

**Asking Mutter nicely.** There is no D-Bus call, no `gsettings` key and no window rule that
grants an ordinary client the right to place itself. GNOME extensions can do it, which is
section 7.

## 3. What works, and what it costs

XWayland. Every Wayland session on GNOME runs an X server for legacy clients, and inside that X
server the old rules still apply: a client can position itself and can stack itself. Chromium
ships an X11 Ozone backend. Forcing it puts Electron in the legacy lane, where `setBounds` and
`setAlwaysOnTop` behave as documented.

Two flags on the command line:

```
--ozone-platform=x11    the point of the exercise
--no-sandbox            only for unpackaged runs, see below
```

The important detail, and the one that costs an afternoon if you do not know it: **the Ozone
platform cannot be selected from inside your own code.** Electron picks it for the browser
process before your main script is executed. Calling

```js
app.commandLine.appendSwitch('ozone-platform', 'x11');
```

at the top of `main` is too late. The browser process has already chosen Wayland, and the switch
only reaches the GPU and renderer children that are spawned afterwards. The result is a mismatch
between the browser process and the GPU process, a GPU process that crashes and respawns, and no
window at all. The failure does not look like "the flag was ignored", it looks like the app is
broken.

Wisp keeps that `appendSwitch` call anyway, so the intent sits next to the check that enforces
it, and adds the flag in three places instead:

- **From source**, `scripts/run-electron.mjs` adds both flags, because npm scripts cannot branch
  on the platform:

  ```js
  const LINUX_FLAGS = ['--ozone-platform=x11', '--no-sandbox'];
  const flags = platform === 'linux' ? LINUX_FLAGS : [];
  ```

- **Packaged**, `electron-builder.yml` bakes the flag into the launcher so a double click or a
  desktop file carries it:

  ```yaml
  executableArgs:
    - --ozone-platform=x11
  ```

- **As a last resort**, `src/main/index.ts` notices that the flag is missing in a packaged build
  and starts over with it. By that point nothing else can be done, and passing the flag in the
  new argv is also what stops the relaunch from looping, because the next process sees it and
  skips:

  ```ts
  if (app.isPackaged) {
    app.relaunch({ args: [...process.argv.slice(1), OZONE_FLAG] });
    app.exit(0);
  }
  ```

  Unpackaged, it prints a warning instead of relaunching, because a dev run started without the
  npm script is a mistake worth seeing rather than papering over.

The second flag is unrelated to Wayland and mentioned because it costs the same afternoon.
Unpackaged Electron on Ubuntu 24.04 and newer aborts on startup without `--no-sandbox`: AppArmor
blocks unprivileged user namespaces, and the setuid helper that would otherwise be used lives in
`node_modules` and is not root owned. A packaged build ships a proper helper and does not need
the flag.

Do not trust that any of this worked. Verify it. An X11 window has an XID that `xprop` can
query, and a native Wayland surface has no such id, so a successful `xprop` call on the window's
own native handle is the cheapest available proof that the app really ended up on XWayland:

```ts
const xid = win.getNativeWindowHandle().readUInt32LE(0);
if (xid === 0) return 'wayland';
const out = execFileSync('xprop', ['-id', String(xid), 'WM_CLASS'], { encoding: 'utf8' });
return out.includes('WM_CLASS') ? 'x11' : 'unknown';
```

Wisp prints that as `ozone effective` on every start, next to `ozone requested`. The two being
different is the failure mode you want reported rather than debugged.

## 4. The accident that turned out to be the whole design

The mascot window is created with these options, and one of them is doing far more work than it
looks like:

```ts
const win = new BrowserWindow({
  frame: false,
  transparent: true,
  backgroundColor: '#00000000',
  alwaysOnTop: true,
  skipTaskbar: true,
  resizable: false,
  hasShadow: false,
  focusable: false,
});
```

`focusable: false` was set for the obvious reason: a mascot must never steal keyboard focus from
what you are typing into. On X11 it does something much larger. Chromium implements it by
creating the window with the **override redirect** flag set.

For a reader who has not written X11 code: in X11 the window manager, here Mutter, normally
intercepts requests to map, move, resize and stack windows, and decides what actually happens.
That interception is how tiling, snapping, workspaces and stacking order exist at all. Override
redirect is the X11 way for a client to say "do not intercept this window". It is what menus,
tooltips and drag images use, because a dropdown must appear exactly where it was asked to
appear, immediately, without a window manager negotiating about it.

An override redirect window is therefore not managed. Mutter does not place it, does not stack
it, does not decorate it, does not give it focus and does not put it in the window list. It sits
where the client puts it, above the managed windows, permanently, for free.

That is exactly and precisely what a desktop mascot needs, and Wisp got it as a side effect of
asking for something else.

Two consequences follow, and the second one is a correction:

- `alwaysOnTop: true` and the redundant `setAlwaysOnTop(true)` in `stage/window.ts` are not what
  keeps the mascot on top. The override redirect status is.
- `isAlwaysOnTop()` returning something unexpected on this window is **moot, not broken**. There
  is no window manager involved to have an opinion about the stacking level. The initial reading
  of this was that the always on top API was misbehaving under XWayland. It is not. It is simply
  not participating.

The same options are used for the speech bubble and the day panel, which are separate
`BrowserWindow`s rather than parts of the mascot window, for the reason in section 2: a bigger
window would have a large transparent area, and on Linux that area swallows clicks with no way
to forward them.

This is also the assumption the whole app rests on, and it is the one that changes meaning
everywhere else. On Windows the same `focusable: false` sets `WS_EX_NOACTIVATE` and the window
stays managed, so `alwaysOnTop` becomes load bearing rather than moot. On macOS it does not by
itself float over fullscreen apps or appear on all Spaces, and needs `type: 'panel'` plus
`setVisibleOnAllWorkspaces`. A free behaviour on one platform is an explicit request on the
other two.

## 5. What you give up

XWayland is a compatibility layer, and the app is on the wrong side of it. Everything below is a
real limitation, not a rough edge.

**The pointer position is stale most of the time.** `screen.getCursorScreenPoint()` works under
XWayland, but XWayland only learns where the pointer is while it is over an X11 window. Over a
Wayland native window, which is most windows on a current GNOME desktop, it keeps reporting the
last position it knew. The mascot is supposed to follow you to the monitor you are working on.
In practice, if you are working in a Wayland native app, it cannot tell that you moved.

The code cannot fix this, only refuse to be fooled by it. A reading identical to the previous
tick is reported as unknown rather than trusted:

```ts
const p = screen.getCursorScreenPoint();
const moved = lastCursor?.x !== p.x || lastCursor.y !== p.y;
lastCursor = p;
return moved ? screen.getDisplayNearestPoint(p).id : undefined;
```

and the follow logic freezes its three second hysteresis on an unknown sample instead of
resetting it, because a pointer resting on another monitor produces exactly the same reading as
a pointer that walked away, and resetting would make the hold unreachable. The honest summary is
that cross monitor following works when you are in X11 apps and barely works otherwise. Note
also that this heuristic is correct only here: a genuinely still cursor on Windows or macOS
would read as unknown, which is why it is marked for deletion behind a platform seam if this app
is ever ported.

**Anything about the rest of the desktop has to be shelled out.** There is no API. Do Not
Disturb is read from GNOME's own setting, every 30 seconds:

```ts
const out = await run('gsettings', ['get', 'org.gnome.desktop.notifications', 'show-banners']);
return out.trim() === 'false';
```

Fullscreen detection is `xprop -root _NET_ACTIVE_WINDOW`, then `_NET_WM_STATE` on the id it
returns. That one has a hole that cannot be closed from here: only X11 windows are visible from
inside XWayland, so a fullscreen Wayland native app goes unnoticed. The feature is best effort,
not a guarantee, and it is documented that way rather than pretended away.

**System idle time is unreliable.** `powerMonitor.getSystemIdleTime()` drives the mascot falling
asleep and waking up. Under Wayland this reading is a known broken one (Electron issues 27912,
30126 and 34826). The sleep timings in this app have therefore never been exercised against an
accurate idle clock.

**The tray is not guaranteed to exist.** GNOME has no system tray. What provides one is the
AppIndicator extension, through the StatusNotifier D-Bus interface, so the only sensible test is
whether that interface is on the session bus:

```ts
execFile('busctl', ['--user', '--no-pager', 'list'], ..., (err, stdout) =>
  resolve(!err && stdout.includes('org.kde.StatusNotifierWatcher')));
```

If it is missing, the tray silently does not appear. This is why the right click menu on the
mascot itself, and not the tray, is the kill switch in this app. A user must never be stuck with
a mascot they cannot get rid of because of an uninstalled extension.

**Fractional scaling is unproven.** The app works in device independent pixels throughout, and
the sprite canvas draws with `imageSmoothingEnabled = false`, so a non integer scale factor
should give blocky uneven pixels rather than blur. Should. No run in `harness-results/` was made
on a fractionally scaled display or across two monitors at different scale factors, and XWayland
is exactly where scaling problems live. Treat this as untested rather than working.

## 6. What it costs to run

Moving a window 30 times a second sounds expensive, so it was measured rather than argued about.
`npm run harness` runs the app for ten minutes with no interaction and writes CSVs plus a
summary. The longest run in the repository, ten minutes, 18044 ticks against a 33 ms target:

```
duration          600.0 s, 18044 ticks at 33 ms target
loop deviation    p50 0.24 ms, p95 0.31 ms, max 3.92 ms
cpu (all procs)   mean 0.14 %, peak 0.18 %
cpu Xwayland      mean 1.01 %, peak 1.20 % (whole process, not only our share)
cpu gnome-shell   mean 20.71 %, peak 28.40 % (whole process, not only our share)
```

0.14 percent mean CPU across every Electron process, and a loop that misses its 33 ms target by
0.31 ms at the 95th percentile. That is the cost of the app itself, and it is small.

The reason the last two lines exist is the part worth copying. Under XWayland the app does not
move anything. It asks, and the compositor and the X server do the actual moving and repainting.
Measuring only your own processes would report a number that is real but incomplete. So the
harness samples `gnome-shell` and `Xwayland` CPU straight from `/proc`:

```ts
const WATCHED = ['gnome-shell', 'Xwayland'];
```

Read those two numbers carefully, and note the parenthesis in the summary line, which is there
on purpose. They are whole process figures, not Wisp's share. `gnome-shell` at 20.71 percent
mean is the compositor doing everything on that desktop during those ten minutes, of which this
app is some unknown fraction. Nothing in this repository isolates that fraction, and the summary
says so rather than implying a number it did not measure. What the sampler is good for is a
comparison: run the harness with the mascot and without it, on the same machine doing the same
thing, and the difference is attributable. The single figure alone is not.

Memory is ordinary Electron: roughly 160 MB browser process, 175 MB GPU, 100 MB renderer, 82 MB
utility, on this machine.

All of these numbers are from one machine, Ubuntu 26.04 with GNOME 50 and Electron 44. They are
not a benchmark of Electron mascots in general.

## 7. The alternative not taken

There is a correct solution, and it was not taken.

A GNOME Shell extension, written in GJS, runs inside the compositor. It can place an actor
anywhere, above anything, with no XWayland, no `--ozone-platform` flag, no `xprop` calls, no
`busctl` probe, and with the pointer position always current because the compositor is the thing
that owns the pointer. Every limitation in section 5 disappears. It was on the roadmap as Phase
8, "a native GNOME extension instead of the XWayland window".

It is marked **Not doing**, for two reasons stated plainly.

The first is that the criterion for doing it was that the current approach had to hurt, and the
measurements say it does not. 0.14 percent mean CPU and a p95 loop deviation of 0.31 ms is not a
problem that justifies rewriting the entire presentation layer in a second language. The known
price is that following the pointer across monitors barely works, and that is documented in the
README rather than fixed.

The second is maintenance. The GNOME Shell JavaScript API is not a stable API. It changes with
GNOME releases, roughly every six months, and extensions break on schedule and have to be
revalidated per version. Wisp would trade a stable dependency, an X server that has not changed
its window semantics in decades, for a moving one, and would pay that cost twice a year forever
to buy back a fraction of a percent of one core.

There is also a smaller, real consequence. Rewriting the window layer in GJS gives up any hope of
the app ever running on Windows or macOS, since everything above `src/main/brain/` would become
Shell specific. The port study in `TODO.md` concludes that roughly the top third of the codebase
is already portable. An extension would not be.

The honest version of this decision is that the XWayland approach is the worse engineering and
the better trade. If the numbers had come out ten times higher, the answer would be the other
one.

## 8. Where each thing lives

| Thing                                                                     | File                                                  |
| ------------------------------------------------------------------------- | ----------------------------------------------------- |
| The ozone flag, why it must be on the command line, the packaged relaunch | `src/main/index.ts`, top of the file                  |
| The two Linux flags for runs from source                                  | `scripts/run-electron.mjs`                            |
| The flag baked into the packaged launcher                                 | `electron-builder.yml`, `linux.executableArgs`        |
| The same flag in the autostart desktop entry                              | `src/main/autostart.ts`                               |
| The window options, `focusable: false`, `setShape`                        | `src/main/stage/window.ts`                            |
| Why the bubble and the panel are separate windows                         | `src/main/stage/bubble.ts`, `src/main/stage/panel.ts` |
| Proving the app really is on XWayland                                     | `src/main/harness/environment.ts`                     |
| Compositor and XWayland CPU from `/proc`                                  | `src/main/harness/system.ts`                          |
| The loop and process metrics, the CSV writer                              | `src/main/harness/metrics.ts`                         |
| Do Not Disturb and fullscreen by `gsettings` and `xprop`                  | `src/main/silence.ts`                                 |
| The tray probe on the session bus                                         | `src/main/tray.ts`                                    |
| The stale pointer heuristic                                               | `src/main/index.ts`, `cursorDisplayId`                |
| Follow hysteresis and how it handles an unknown sample                    | `src/main/brain/follow.ts`, `src/main/brain/actor.ts` |
| The rules this app is not allowed to break                                | `CLAUDE.md`, non-negotiables and Phase 0 findings     |
| What all of this would mean on Windows and macOS                          | `TODO.md`                                             |
| The raw measurement runs                                                  | `harness-results/`                                    |
