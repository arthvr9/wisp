# Wisp

A desktop mascot for GNOME on Wayland. The window is the character: a small, frameless,
transparent, non-focusable X11 window (through XWayland) that moves itself with setBounds.

## Non-negotiables

- Target is Linux, GNOME, Wayland session (Ubuntu, Debian 13). Nothing else is tested.
- Electron runs with the X11 Ozone backend. Do not try native Wayland: clients there cannot
  position their own windows or stay above others. If you think there is a better path, stop
  and ask before changing the approach.
- `--ozone-platform=x11` goes on the command line (npm scripts). Electron picks the platform
  before the main script runs, so `app.commandLine.appendSwitch` alone is too late.
- The window is the mascot. No full-screen click-through overlay: `setIgnoreMouseEvents`
  with `forward` only exists on macOS and Windows.
- Every call to `setBounds`, `setShape` or `setAlwaysOnTop` lives in `src/main/stage/` and
  nowhere else.
- `src/main/brain/movement.ts` stays pure: no `electron` import, no `Date.now()`. Time
  arrives as an argument. It has tests. Keep them passing.

## Text (README, UI, commits, issues)

- No em dashes or en dashes. Use a comma, parentheses or a full stop.
- No emoji anywhere, including commits and README.
- No exclamation marks.
- No startup language. Not "let's get started", "you're all set", "oops, something went
  wrong", "seamlessly", "supercharge", "unlock", "magic".
- Short, slightly dry sentences. Say what happened and what to do.
- Personality lives in the mascot's lines. Settings screens are sober. A settings panel that
  tries to be funny gets tiring in two days.
- Repository, README, comments and commits in English. Conventional Commits.

## Visual

- No shadcn/ui, no Lucide. Two small screens: own CSS and a few hand-written components give
  less code and more character than a library.
- Icons come out of the same pipeline as the mascot: drawn in Aseprite, pixel art. A generic
  icon set next to a pixel creature is what makes a project look like a template. If a ready
  set is unavoidable somewhere, Phosphor before Lucide.
- No rounded border plus shadow on everything. Choose what deserves separation.

## Code

- TypeScript strict. No explicit `any`, no `as unknown as`.
- ESLint and Prettier: 2 spaces, single quotes, printWidth 100. Run `npm run lint` and
  `npm run format:check` before committing.
- Comments only where the code cannot explain itself. No comment that repeats the next line,
  no JSDoc on obvious functions, no section banners.
- Mandatory exception: every platform workaround gets one short line saying why it exists.
  The X11 forcing and the `--no-sandbox` flag are the first two. Without that note someone
  cleans the code in six months and breaks the project.

## Phase 0 findings worth remembering

- `focusable: false` makes Chromium create an override-redirect X window. Mutter does not
  manage it, so it stacks above everything and never takes focus. `alwaysOnTop` and
  `isAlwaysOnTop()` are moot for it, not broken.
- `screen.getCursorScreenPoint()` works under XWayland, but XWayland only learns the pointer
  position while the pointer is over an X window. Over Wayland-native windows it reports the
  last known position.
- Unpackaged Electron on Ubuntu 24.04+ aborts without `--no-sandbox` because AppArmor blocks
  unprivileged user namespaces and the setuid helper in node_modules is not root-owned. A
  packaged build ships a proper helper and does not need the flag.
