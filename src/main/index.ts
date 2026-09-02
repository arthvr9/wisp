import { app, ipcMain, screen } from 'electron';
import type { Display } from 'electron';
import { join } from 'node:path';

import { step } from './brain/movement';
import type { DisplayArea, MovementState, Target } from './brain/movement';
import { describeEnvironment, formatEnvironment } from './harness/environment';
import { Harness, formatSummary } from './harness/metrics';
import { createStage, MASCOT_SIZE } from './stage/window';
import { IPC } from '../shared/ipc';
import type { DragStart } from '../shared/ipc';

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
const SPEED_PX_S = 120;

function toArea(d: Display): DisplayArea {
  return { id: d.id, ...d.workArea };
}

function harnessMinutes(): number | undefined {
  const raw = process.env.WISP_HARNESS_MINUTES;
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function logCursor(): void {
  const point = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(point);
  console.log(`cursor            ${point.x},${point.y} on display #${display.id}`);
}

void app.whenReady().then(() => {
  const harness = new Harness(TICK_MS, join(app.getAppPath(), 'harness-results'));
  const minutes = harnessMinutes();

  let target: Target = {
    displays: screen.getAllDisplays().map(toArea),
    width: MASCOT_SIZE,
    height: MASCOT_SIZE,
  };
  const refreshDisplays = () => {
    target = { ...target, displays: screen.getAllDisplays().map(toArea) };
  };
  screen.on('display-added', refreshDisplays);
  screen.on('display-removed', refreshDisplays);
  screen.on('display-metrics-changed', refreshDisplays);

  const home = screen.getPrimaryDisplay();
  let state: MovementState = {
    x: home.workArea.x + 40,
    y: home.workArea.y + home.workArea.height - MASCOT_SIZE - 40,
    vx: SPEED_PX_S,
    displayId: home.id,
  };

  const stage = createStage(Math.round(state.x), Math.round(state.y));

  stage.win.webContents.once('did-finish-load', () => {
    console.log(formatEnvironment(describeEnvironment(stage.win)));
    console.log(`setShape          ${stage.cutCorners()}`);
    logCursor();
    console.log(`results           ${harness.resultsDir}`);
    if (minutes !== undefined) console.log(`harness           running for ${minutes} min`);
  });

  let drag: DragStart | undefined;
  ipcMain.on(IPC.dragStart, (_event, offset: DragStart) => {
    drag = offset;
  });
  ipcMain.on(IPC.dragEnd, () => {
    drag = undefined;
    const b = stage.bounds();
    state = { ...state, x: b.x, y: b.y, displayId: screen.getDisplayMatching(b).id };
  });

  let loop: NodeJS.Timeout | undefined;
  stage.win.webContents.once('did-finish-load', () => {
    let last = performance.now();
    loop = setInterval(() => {
      const now = performance.now();
      const dt = now - last;
      last = now;
      harness.tick(dt);

      if (drag) {
        const p = screen.getCursorScreenPoint();
        stage.moveTo(p.x - drag.offsetX, p.y - drag.offsetY);
        return;
      }
      state = step(state, target, dt);
      stage.moveTo(Math.round(state.x), Math.round(state.y));
    }, TICK_MS);
    if (process.env.WISP_DRAG_SELFTEST) dragSelfTest();
  });

  // Drives the renderer's pointer handlers without a human, to prove the mousedown, IPC
  // and setBounds chain is wired. It cannot prove that XWayland delivers real clicks.
  function dragSelfTest(): void {
    const before = stage.bounds();
    setTimeout(() => {
      stage.win.webContents.sendInputEvent({
        type: 'mouseDown',
        x: 48,
        y: 48,
        button: 'left',
        clickCount: 1,
      });
    }, 3000);
    setTimeout(() => {
      const during = drag !== undefined;
      stage.win.webContents.sendInputEvent({
        type: 'mouseUp',
        x: 48,
        y: 48,
        button: 'left',
        clickCount: 1,
      });
      setTimeout(() => {
        const after = stage.bounds();
        console.log(
          `drag self-test    start=${during ? 'received' : 'missing'} end=${drag === undefined ? 'received' : 'missing'}` +
            ` bounds ${before.x},${before.y} -> ${after.x},${after.y}`,
        );
      }, 200);
    }, 3500);
  }

  let sampleCount = 0;
  const sampler = setInterval(() => {
    const samples = harness.sampleProcesses();
    const system = harness.sampleSystem();
    sampleCount += 1;
    if (sampleCount === 1) {
      harness.discardFirstCpuSample();
      return;
    }
    const total = samples.reduce((sum, s) => sum + s.cpuPercent, 0);
    const parts = samples.map((s) => `${s.type} ${s.cpuPercent.toFixed(1)}%`).join(', ');
    const sys = system.map((s) => `${s.name} ${s.cpuPercent.toFixed(1)}%`).join(', ');
    console.log(
      `t=${samples[0]?.elapsedS.toFixed(0) ?? '?'}s cpu ${total.toFixed(1)}% (${parts}) system: ${sys}`,
    );
    logCursor();
  }, SAMPLE_MS);

  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    clearInterval(loop);
    clearInterval(sampler);
    console.log('\n' + formatSummary(harness.finish()));
    console.log(`results written to ${harness.resultsDir}`);
  };

  if (minutes !== undefined) {
    setTimeout(
      () => {
        finish();
        app.quit();
      },
      minutes * 60 * 1000,
    );
  }
  app.on('before-quit', finish);
  app.on('window-all-closed', () => {
    app.quit();
  });
});
