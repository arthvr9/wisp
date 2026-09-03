# Porting Wisp to Windows and macOS

A study of what binds this app to Linux, what the equivalents are, and in what order to do the
work. Written against the code as it stands, not against Electron in general.

## 1. What the app assumes today

Wisp assumes an X11 window server reached through XWayland, a GNOME session, and a handful of
command line tools on `PATH`. The mascot is an override-redirect X window produced by
`focusable: false`, which on Linux means the window manager stops managing it entirely, so it
floats above everything and never takes focus for free. Two flags on the command line
(`--ozone-platform=x11` and `--no-sandbox`) are required for the app to start at all, and both
are meaningless off Linux. Every environment reading outside the window (do not disturb,
fullscreen, tray availability, compositor CPU) is a subprocess call to `gsettings`, `xprop`,
`busctl`, or a read of `/proc`. On Windows and macOS none of those four exist, and the free
floating behaviour has to be asked for explicitly instead of being a side effect.

## 2. Every Linux specific behaviour

Risk is the risk of the port of that piece, not the importance of the feature.

| What it does                                                                                                   | Where                                                         | Windows equivalent                                                                                                                                                                     | macOS equivalent                                                                                                                                                                                                                                 | Risk                                                                                                                                                                                                                                                                |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Forces the X11 Ozone backend so the window can position itself and stay on top                                 | `package.json` scripts, `src/main/index.ts:52-62`             | None. Delete the flag and the warning check                                                                                                                                            | None. Delete the flag and the warning check                                                                                                                                                                                                      | Low. The `console.error` guard will fire on every non-Linux start until it is made conditional                                                                                                                                                                      |
| `--no-sandbox` to work around AppArmor plus a non-root `chrome-sandbox`                                        | `package.json` scripts, `src/main/autostart.ts:26-30`         | Not needed                                                                                                                                                                             | Not needed                                                                                                                                                                                                                                       | Low                                                                                                                                                                                                                                                                 |
| `focusable: false` gives an unmanaged, always above, never focused window                                      | `src/main/stage/window.ts:30`, `bubble.ts:35`, `panel.ts:50`  | Sets `WS_EX_NOACTIVATE` and implies `skipTaskbar: true` (documented). The window stays managed, so `alwaysOnTop` is load bearing and no longer moot                                    | Documented as supported, but it does not by itself float over full screen apps or appear on all Spaces. Needs `type: 'panel'` (adds `NSWindowStyleMaskNonactivatingPanel`) plus `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })` | High. This is the single assumption the whole design rests on, and it is the one that changes meaning on both targets                                                                                                                                               |
| `alwaysOnTop: true` and a redundant `setAlwaysOnTop(true)`                                                     | `src/main/stage/window.ts:26,39`                              | Real topmost. Level argument is mostly ignored beyond normal versus topmost                                                                                                            | Level matters. Docs: levels `floating` through `status` sit below the Dock. To sit above everything you need a higher level, in practice `screen-saver`                                                                                          | Medium. Expect to pass a level on macOS and nothing on Windows                                                                                                                                                                                                      |
| `setShape` to cut the four corners so clicks fall through them                                                 | `src/main/stage/window.ts:60-67`                              | Supported. Docs annotate `setShape` as _Windows_ _Linux_ _Experimental_                                                                                                                | Not supported. The `cutCorners()` guard already degrades to `unavailable` or `failed`                                                                                                                                                            | Low, and the prompt's assumption that `setShape` is X11 only is wrong: it works on Windows too                                                                                                                                                                      |
| Bubble and panel are separate windows because a transparent area cannot be clicked through                     | `src/main/stage/bubble.ts:22-24`, `panel.ts:38-40`            | `setIgnoreMouseEvents(true, { forward: true })` exists, and so does `setShape`, so a single window would be possible                                                                   | `setIgnoreMouseEvents(true, { forward: true })` exists                                                                                                                                                                                           | Low. Do not rewrite. The limitation is documented as cross platform ("you cannot click through the transparent area"), the extra windows are cheap, and one design on three platforms is worth more than a saved window                                             |
| `showInactive()` to show without stealing focus                                                                | `window.ts:49`, `bubble.ts:56`, `panel.ts:71`, `index.ts:334` | Supported                                                                                                                                                                              | Supported, but on a normal window it can still activate the app. With `type: 'panel'` it behaves as intended                                                                                                                                     | Medium on macOS                                                                                                                                                                                                                                                     |
| `skipTaskbar: true` on all three floating windows                                                              | `window.ts:27`, `bubble.ts:32`, `panel.ts:47`                 | Real and required, or the mascot gets a taskbar button                                                                                                                                 | No taskbar. Dock presence is a separate problem, see section 3                                                                                                                                                                                   | Low                                                                                                                                                                                                                                                                 |
| Tray availability probed by looking for `org.kde.StatusNotifierWatcher` on the session bus                     | `src/main/tray.ts:12-19`                                      | Notification area always exists. Skip the probe                                                                                                                                        | Menu bar always exists. Skip the probe                                                                                                                                                                                                           | Low, but `busctl` must never be spawned off Linux                                                                                                                                                                                                                   |
| Tray icons are PNG plus `@2x`, one per mood, in colour                                                         | `src/main/tray.ts:27-31`, `resources/icons/*/tray*.png`       | Docs recommend `.ico`. A colour PNG works but looks wrong at small sizes                                                                                                               | Docs want template images: monochrome, filename ending in `Template`, `@2x` at 144 dpi, or macOS will not invert or pick the retina file. Six coloured mood icons conflict with that convention                                                  | Medium. The mood-coloured tray icon is a real design decision on macOS, not a file conversion                                                                                                                                                                       |
| Do not disturb read from `gsettings org.gnome.desktop.notifications show-banners`                              | `src/main/silence.ts:17-22`                                   | No supported Electron API. Focus Assist / quiet hours state is reachable through `SHQueryUserNotificationState` or undocumented registry keys, both needing native code or a shell out | No supported API. Focus modes are stored in a private plist that Apple has changed repeatedly                                                                                                                                                    | High. Both are best dropped rather than reimplemented, see section 7                                                                                                                                                                                                |
| Active window fullscreen detected with `xprop -root _NET_ACTIVE_WINDOW` then `_NET_WM_STATE`                   | `src/main/silence.ts:24-31`                                   | `SHQueryUserNotificationState` returns a presentation/fullscreen state, but there is no Electron binding                                                                               | `CGWindowListCopyWindowInfo` or `NSWorkspace`, again native only                                                                                                                                                                                 | High. Same call: drop it                                                                                                                                                                                                                                            |
| The poll is already guarded by `process.platform !== 'linux'`, so both sources silently return false elsewhere | `src/main/silence.ts:82`                                      | Already inert                                                                                                                                                                          | Already inert                                                                                                                                                                                                                                    | Low. This is the one place that already ports itself                                                                                                                                                                                                                |
| Autostart writes `~/.config/autostart/wisp.desktop` with the two flags baked in                                | `src/main/autostart.ts`                                       | `app.setLoginItemSettings({ openAtLogin, path, args, enabled })`, which writes the HKCU Run key and the startup-approved key                                                           | `app.setLoginItemSettings({ openAtLogin })` via `SMAppService`. Electron's docs warn it may silently fail unless the app is packaged, signed and notarised                                                                                       | Medium on Windows, high on macOS because it cannot be proven working on an unsigned build                                                                                                                                                                           |
| Settings copy says "Writes a .desktop file to {path}" and shows the path                                       | `src/shared/i18n/en.ts:25`, `index.ts` `IPC.environmentGet`   | Needs different copy and no path, or the registry key name                                                                                                                             | Needs different copy and no path                                                                                                                                                                                                                 | Low, but it is user facing and easy to forget                                                                                                                                                                                                                       |
| `safeStorage` for connector tokens, with a plain text fallback when no keyring is on the bus                   | `src/main/mcp/secrets.ts:52-62`                               | DPAPI. Available as soon as the app is ready, so the plain text branch should never be taken                                                                                           | Keychain. Available, but without a stable code signature macOS cannot tell two builds are the same app and re-prompts after every update                                                                                                         | Medium. The fallback branch is correct to keep, but on Windows it becoming reachable would be a bug worth logging loudly                                                                                                                                            |
| `powerMonitor.getSystemIdleTime()` drives sleep and wake                                                       | `src/main/index.ts:574`                                       | Backed by `GetLastInputInfo`. Accurate                                                                                                                                                 | Accurate                                                                                                                                                                                                                                         | Low in code, medium in behaviour. On Linux under Wayland this is a known broken reading (Electron issues 27912, 30126, 34826), so on Windows and macOS the sleep timings will be exercised properly for the first time and the tuning constants may need revisiting |
| Cursor position treated as unknown when it did not move, because XWayland only updates it over X windows       | `src/main/index.ts:556-563`                                   | Cursor is always current. The heuristic actively harms follow: a genuinely still cursor reads as unknown                                                                               | Same as Windows                                                                                                                                                                                                                                  | Low to fix, but it is a silent behaviour regression if left in                                                                                                                                                                                                      |
| `setBounds` every 33 ms to walk the mascot                                                                     | `src/main/index.ts:583`, `stage/window.ts:53`                 | `SetWindowPos` per tick against DWM. Cost unmeasured                                                                                                                                   | `setFrame` per tick. Docs note the y coordinate cannot be smaller than the tray height                                                                                                                                                           | Medium. The Phase 0 CPU budget (under 3 percent) has to be re-proven on each platform                                                                                                                                                                               |
| Harness samples `gnome-shell` and `Xwayland` CPU from `/proc`                                                  | `src/main/harness/system.ts`                                  | No equivalent. Already returns `[]` off Linux                                                                                                                                          | No equivalent. Already returns `[]`                                                                                                                                                                                                              | Low                                                                                                                                                                                                                                                                 |
| Harness proves it is really on XWayland by reading the XID and calling `xprop`                                 | `src/main/harness/environment.ts:33-48`                       | `getNativeWindowHandle()` is an `HWND`, the whole check is meaningless                                                                                                                 | Handle is an `NSView` pointer, likewise                                                                                                                                                                                                          | Low. Already guarded, but the report fields (`sessionType`, `ozoneRequested`, `ozoneEffective`) become noise                                                                                                                                                        |
| Window icon read from `resources/icons/wisp-256.png`                                                           | `src/main/stage/settings.ts:22`, `src/main/autostart.ts:33`   | That file does not exist. The real files are `resources/icons/<mascot>/icon-256.png`. Silent no-op today, visible as a default icon on Windows                                         | Same, though a packaged macOS app takes its icon from the `.icns` in the bundle                                                                                                                                                                  | Low, but fix it before packaging, not after                                                                                                                                                                                                                         |
| `resources/` read at runtime through `app.getAppPath()`                                                        | `src/main/tray.ts:28`, `settings.ts:22`                       | Depends entirely on the packager config, which does not exist yet                                                                                                                      | Same                                                                                                                                                                                                                                             | Medium, and it is a packaging problem on all three platforms including Linux                                                                                                                                                                                        |

Non-issues worth recording so nobody re-investigates them: `node:sqlite` is in Node itself and
needs no native module, there are no native dependencies in `package.json` at all, the OAuth
loopback server binds `127.0.0.1` which is portable, `shell.openExternal` is portable, and
everything under `src/main/brain/`, `src/main/connectors/`, `src/main/ics/`, `src/main/speech/`
and `src/renderer/` has no platform surface.

## 3. macOS problems with no Linux equivalent

- **Code signing and notarisation.** Anything distributed to another machine must be signed with
  a Developer ID certificate and notarised, or Gatekeeper refuses it. Enrolment in the Apple
  Developer Program is required to get the certificate, and it costs 99 USD per year. Running
  your own unsigned build locally is possible (ad hoc signature, right click and Open), so the
  fee is only unavoidable the moment someone else has to install it.
- **Hardened runtime.** Notarisation requires it. It is a set of entitlements in the app bundle.
  Wisp does nothing exotic (no JIT of its own beyond Chromium's, no library injection), so the
  default Electron entitlements should be enough, but this is unverified for this app.
- **safeStorage depends on the signature.** Electron's own docs list `safeStorage` as an API that
  needs code signing to behave: without a stable signature the Keychain treats each build as a
  new app and prompts again. The token store will look flaky on an unsigned build and the cause
  will not be obvious.
- **Login items depend on the signature too.** Electron's docs say `openAtLogin` may silently
  fail when the app is not packaged, signed and notarised. So autostart on macOS cannot be
  validated at all before the signing work is done. Plan for that ordering.
- **Accessibility permission.** Less of a problem than expected. Electron's docs only require the
  trusted accessibility client permission for the four media key accelerators. `Control+Alt+W`
  is not one of them, so the current shortcut should register without any permission prompt.
  Free, no developer account.
- **`LSUIElement`.** Without it the app gets a Dock icon and appears in the app switcher, which
  is wrong for a mascot. Set it in the bundle `Info.plist` at packaging time (`LSUIElement: 1`),
  or call `app.dock.hide()` at runtime. The plist route is the right one: `app.dock.hide()`
  leaves a flicker at launch. Free.
- **Spaces and full screen apps.** A transparent always on top window does not follow the user
  between Spaces and does not appear over a full screened app unless you ask. Two things
  together: `type: 'panel'` (documented as adding `NSWindowStyleMaskNonactivatingPanel`, which
  makes the window float over full screened apps and appear on all Spaces) and
  `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })`. Free, and this is the piece
  most likely to need iteration on real hardware.
- **Apple Silicon and Intel.** Two architectures. Options are two separate builds or one universal
  binary, roughly double the download. There are no native modules in this project, so either is
  mechanical. It matters mostly for what CI has to build and what the owner can test on. Free.
- **A Mac is required to sign and notarise.** `codesign` and the notary tool run on macOS only.
  This cannot be done from the Linux machine.

Paid: the Developer Program (99 USD per year) for signing and notarisation, therefore also for a
reliable Keychain and a working login item. Everything else in this list is free.

## 4. Windows problems

- **Taskbar.** `skipTaskbar: true` is already set on all three floating windows and is real on
  Windows. Note that `focusable: false` implies it anyway, per the docs. Nothing to build, but it
  must be verified: a mascot with a taskbar button is an immediate bug report.
- **Per monitor DPI and fractional scaling.** Electron is per monitor DPI aware by default and
  `screen.getCursorScreenPoint()` returns a DIP point, so the movement code, which works in DIP,
  should be correct as written. The risk is elsewhere: at 125 or 150 percent the 96 DIP mascot
  becomes 120 or 144 physical pixels and a 96 pixel sprite is upscaled by a non-integer factor.
  `imageSmoothingEnabled = false` is already set (`Mascot.tsx:149`), so expect blocky but uneven
  pixels rather than blur. Dragging across a scale boundary between two monitors is the other
  thing to test, since `screenToDipPoint` and `dipToScreenPoint` exist precisely because that
  conversion is display relative.
- **`setAlwaysOnTop` levels.** Windows has effectively two states, normal and topmost. The level
  argument is accepted but does much less than on macOS. Passing no level is correct here.
- **Startup folder versus registry.** `app.setLoginItemSettings` uses the registry Run key under
  `HKEY_CURRENT_USER` and also touches the startup approved key so the entry shows as enabled in
  Task Manager. That is the right route. A shortcut dropped into the Startup folder is the manual
  alternative and has no advantage. `getLoginItemSettings` needs the same `path` and `args` that
  were set, which the current Linux code does not have to think about.
- **SmartScreen and code signing.** An unsigned installer gets the "Windows protected your PC"
  interstitial with a Run anyway hidden behind More info. Since June 2023, per Electron's docs, a
  cheap OV certificate no longer helps: Windows treats OV-signed software as unsigned. Only an EV
  certificate clears it, and EV certificates must live on FIPS 140 Level 2 hardware, so they
  cannot simply be copied into CI. Options are a hardware token from a reseller (DigiCert,
  GlobalSign, Sectigo, SSL.com, several hundred USD per year), a cloud signing service such as
  DigiCert KeyLocker, or Azure Artifact Signing, which Electron's docs call the cheapest option
  and which is restricted to certain countries. For a personal project run from a build the owner
  produced himself, unsigned is survivable.
- **Transparent frameless window and the compositor.** Documented limitations that apply here:
  transparency does not work unless the window is frameless (it is), transparent windows are not
  resizable and setting `resizable: true` can break them (it is false), transparency is lost when
  DevTools is open, and the transparent area cannot be clicked through. The unknowns are visual:
  whether moving a layered transparent window 30 times a second against DWM produces tearing or
  trails, and what it costs in CPU. Nothing in the docs answers that, only the machine will.

## 5. Recommended order of work

**Phase 1: make it start on Windows, change nothing else.** Cheapest step, largest information
yield. Add per platform npm scripts so the two Linux flags are only passed on Linux, make the
missing-flag warning conditional, and let the existing `process.platform` guards do their work.
No abstraction, no packaging, no new features. Then run it on the Windows machine for an hour.

What this proves: whether `focusable: false` plus `alwaysOnTop` gives a window that stays above
other windows, never takes focus, and still receives the left button drag and the right button
menu. Whether the transparent frameless window renders cleanly while moving. Whether `setShape`
works. Whether the tray appears without the `busctl` probe. Whether the 30 Hz `setBounds` loop
stays inside the Phase 0 CPU budget. Run `npm run harness` there: it already degrades to
Electron's own process metrics without `/proc`.

What would make it fail: the mascot is not clickable because `WS_EX_NOACTIVATE` swallows the
mouse, or the window flickers or leaves trails while walking, or CPU is an order of magnitude
worse. Any of those changes the design, not the plumbing, and is worth knowing before writing a
single line of abstraction.

**Phase 2: the platform seam, plus the Windows integrations.** Only after Phase 1 has told you
what the seam has to hide. Introduce `src/main/platform/` (section 6), move autostart to
`setLoginItemSettings`, convert the tray icons to `.ico`, fix the `wisp-256.png` path, and fix
the settings copy. Test on a fractionally scaled display and across two monitors with different
scale factors.

What this proves: that the app is genuinely per platform rather than Linux with holes. Fails if
the seam turns out to need a fourth or fifth method every time something new is touched, which
means the boundary is in the wrong place.

**Phase 3: package for Windows, unsigned.** Add a packager (there is none in `package.json`
today, which is a gap for Linux too). Prove that `resources/` is reachable from the packaged app,
that `safeStorage` uses DPAPI and never falls back to plain text, that autostart survives a
reboot, and that the app runs without `--no-sandbox`. Then look at SmartScreen and decide whether
a certificate is worth buying.

What would make it fail: asar unpacking of the sprite sheet and icons, or the login item pointing
at a stale path.

**Phase 4: macOS, blind.** Without a Mac, three things are still possible and two of them are
free. Build on GitHub Actions macOS runners, which are free and unlimited on public repositories
and metered otherwise (about 0.062 USD per minute at the time of writing). That gets you a
compiling, packaging, universal or arch-specific build and catches every type and path error, but
it proves nothing about window behaviour, because a CI runner has no interactive session worth
looking at. Second, borrow a Mac for an afternoon: for the window mechanics questions (panel type,
Spaces, full screen, level, drag, transparent repaint) an afternoon of hands-on time answers more
than a month of CI. Third, rent one. Prices seen in September 2026, verify before paying: cloud
Mac minis from roughly 85 to 199 USD per month (MyRemoteMac, MacStadium, rentamac.io), AWS EC2
Mac considerably more, hourly and daily options exist. A rented Mac accessed over screen sharing
is adequate for this app, since the whole question is what a window does on screen.

Honest statement of the position: everything in section 3 except the two signing items can be
implemented blind and verified in an afternoon on borrowed hardware. The two signing items cannot
be done at all without both a Mac and 99 USD per year. So the macOS port splits cleanly into
"works when you build it yourself" (cheap, needs a few hours on any Mac) and "installable by
other people" (needs the developer account and a Mac in the loop for every release).

**Phase 5: sign and notarise, if and only if distributing.** Decide this from the answer to the
first open question in section 8, not by default.

## 6. What to refactor before porting, not after

`src/main/stage/` is the right seam for window _calls_, and CLAUDE.md already enforces that every
`setBounds`, `setShape` and `setAlwaysOnTop` lives there. But it is currently a single
implementation, not a boundary: `createStage`, `createBubble` and `createPanel` each hard code the
same eleven constructor options, three times over. The port does not want three per platform
files. It wants one place that answers "what does a floating, non-activating, always visible
window look like here".

Concretely, before touching anything else:

1. **Extract the shared window traits.** One function in `src/main/stage/` returning the
   `BrowserWindowConstructorOptions` common to the mascot, the bubble and the panel, with the per
   platform differences inside it: `type: 'panel'` on macOS, the always on top level on macOS,
   nothing extra on Windows. The three creators then differ only by size and URL, which is what
   they should have differed by all along. This is a small refactor that is worth doing on Linux
   alone, and it is the highest leverage change in this list.
2. **Add `src/main/platform/`, a second seam for everything that is not a window.** `stage/` does
   not cover autostart, tray detection, silence sources, the harness system sampler, or the
   command line flags. Those are five unrelated files that each branch on Linux. Give them one
   interface (`autostart`, `trayAvailable`, `silenceSources`, `systemSampler`) with a Linux, a
   Windows and a macOS implementation, and pick it once at startup. Without this, every one of
   them grows its own `process.platform` ladder and the code becomes unreadable in three files at
   a time.
3. **Move the launch flags out of `package.json`.** Six scripts hard code `--ozone-platform=x11
--no-sandbox`. On Windows those scripts do not run. Either per platform scripts or a small
   launcher that adds the flags when `process.platform === 'linux'`. Note that the ozone flag
   genuinely has to be on the command line, so it cannot move into `index.ts`.
4. **Make `SilenceSources` take its sources as an argument.** Today it hard codes `doNotDisturb()`
   and `activeX11Fullscreen()` and guards the whole poll by platform. If the sources are injected,
   Windows and macOS pass an empty list, snooze keeps working, and the class stops knowing about
   `gsettings`.
5. **Delete the cursor "moved" heuristic behind the platform seam.** `cursorDisplayId()` in
   `index.ts` returns `undefined` when the cursor did not move. That is correct on XWayland and
   wrong everywhere else. It belongs with the platform object, not inline in the loop.
6. **Fix `resources/icons/wisp-256.png` and add a packager config.** Both are Linux bugs today
   that only become visible when packaged. Doing them now means Phase 3 tests packaging, not
   these two.

What stays untouched and is already right: `src/main/brain/` is pure and portable, the connectors
know nothing about the platform, `movement.ts` works in DIP which is the correct unit on all
three, and the renderer has no platform surface at all. Roughly the top third of the codebase
ports for free, which is the good news in this document.

## 7. Things to disable rather than port

- **Do not disturb detection** on Windows and macOS. Neither has a supported API. The Windows
  route needs `SHQueryUserNotificationState` through native code, and the macOS route needs a
  private plist Apple keeps changing. The feature degrades cleanly: quiet hours, meeting windows
  and the manual snooze all still work, and they are the sources users actually configure.
- **Active window fullscreen detection.** Same reasoning, same conclusion. Note this also has a
  hole on Linux today (Wayland-native fullscreen apps are invisible to `xprop`), so the feature
  is already best-effort rather than a guarantee.
- **The `/proc` system sampler.** Compositor CPU was measured because the compositor does the
  moving under XWayland. On Windows and macOS the equivalent cost is inside DWM and WindowServer,
  not attributable per process without OS specific tooling. The harness should report our own
  process metrics and say the system column is Linux only.
- **The ozone and XWayland fields in the environment report.** They report on a decision that does
  not exist off Linux. Print the platform instead.
- **The `busctl` tray probe.** Both other platforms always have somewhere to put a tray icon.
- **`setShape`.** Not implemented on macOS. The existing `unavailable` return already handles it,
  and the four cut corners are cosmetic.
- **`--no-sandbox`.** Off Linux it is a security regression for no benefit.
- **The `.env` loader** stays as is: it is dev only and already inert in a packaged build.

## 8. Open questions and unverified claims

Questions only the owner can answer:

1. Will builds be distributed to other people, or only run by the owner on his own machines? This
   single answer decides whether the 99 USD per year and the Windows certificate question exist
   at all.
2. Is the macOS mascot expected to float over full screened apps and follow the user across
   Spaces, or is "visible on the current desktop" acceptable? The first costs a design decision,
   the second costs nothing.
3. Is a tray icon required on Windows and macOS, or does the right click menu remain the kill
   switch as it does on Linux? If the tray is required on macOS, the coloured mood icons have to
   be redesigned as template images or the mood signal drops out of the menu bar.
4. Is a native module or a shelled-out PowerShell call acceptable for Windows do not disturb, or
   is dropping that source fine? The recommendation here is to drop it.
5. Which Windows versions are in scope, and is there a machine with fractional scaling and a
   second monitor at a different scale to test on? That combination is where DPI bugs live.
6. Intel macOS in scope, or Apple Silicon only?
7. Is there budget or access for a few hours on a Mac, and if not, is a macOS build that is only
   proven to compile acceptable as an interim state?

Claims in this document that could not be verified:

- Whether `focusable: false` on Windows still delivers the left button drag and the right button
  menu to the renderer. `WS_EX_NOACTIVATE` should not block mouse messages, but this was not
  tested on hardware and it is the assumption Phase 1 exists to check.
- What a 33 ms `setBounds` loop costs on Windows DWM and on macOS WindowServer, and whether it
  produces visible tearing or trails. No documentation answers this. Only the harness on real
  machines will.
- Whether `win.setShape` throws, returns undefined, or silently does nothing on macOS. The
  `try`/`catch` in `cutCorners()` covers all three, but the reported result is a guess.
- Whether the OAuth loopback HTTP server triggers a Windows Firewall prompt. Binding to
  `127.0.0.1` normally does not, but this was not confirmed.
- The exact SmartScreen threshold and wording for an unsigned Electron installer. SmartScreen is
  reputation based and Microsoft does not document the thresholds.
- Whether Azure Artifact Signing is available in the owner's country. Electron's docs say it is
  country restricted and point at Microsoft's prerequisites page, which was not checked.
- Whether a supported route exists to read macOS Focus mode state. None was found, but absence of
  evidence is not proof here.
- All prices quoted (Apple Developer Program 99 USD per year, GitHub Actions macOS runners free on
  public repositories and about 0.062 USD per minute otherwise, cloud Mac rentals from roughly 85
  USD per month, EV certificates in the low hundreds per year) come from vendor pages and search
  results read in September 2026. Confirm each before spending anything.
- Whether the default Electron hardened runtime entitlements are sufficient for this app under
  notarisation. Nothing in the code suggests otherwise, but it was not tested.
