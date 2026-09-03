import { useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent, PointerEvent } from 'react';

import type { Pose, PoseUpdate } from '../../shared/actor';
import { defaultConfig } from '../../shared/config';
import type { Config } from '../../shared/config';
import { isMascot } from '../../shared/mascots';
import type { MascotName } from '../../shared/mascots';
import { buildCustomSheet } from './custom-sheet';
import { frameAt, frameAtPhase, parseSheet } from './sprites';
import type { AsepriteJson, Frame, Sheet } from './sprites';

const SIZE = 96;

// Vite resolves this glob at build time, so every mascot's sheet ships in the bundle and
// switching mascots at runtime never needs a network request or a dynamic import.
const sheetUrls = import.meta.glob<string>('../../../resources/sprites/*.png', {
  eager: true,
  import: 'default',
});
const sheetJsons = import.meta.glob<AsepriteJson>('../../../resources/sprites/*.json', {
  eager: true,
  import: 'default',
});

interface MascotSheet {
  url: string;
  sheet: Sheet;
}

function mascotNameFromPath(path: string): string {
  return (path.split('/').pop() ?? '').replace(/\.\w+$/, '');
}

const SHEETS: Partial<Record<MascotName, MascotSheet>> = {};
for (const [path, url] of Object.entries(sheetUrls)) {
  const name = mascotNameFromPath(path);
  if (!isMascot(name)) continue;
  const json = sheetJsons[path.replace(/\.png$/, '.json')];
  if (!json) continue;
  try {
    SHEETS[name] = { url, sheet: parseSheet(json) };
  } catch (err) {
    console.error(`Sprite sheet for "${name}" is invalid.`, err);
  }
}

// Falls back to wisp so a mascot whose art has not shipped yet still shows something rather
// than a blank window.
function sheetFor(mascot: MascotName): MascotSheet | undefined {
  return SHEETS[mascot] ?? SHEETS.wisp;
}

// These poses draw their own eyes: sleep and celebrate close them, pet narrows them and startle
// opens them wide. The overlay repaints the whole eye band, so it would rub all four out. Dance
// keeps the overlay on purpose, because the mood still has to show while it dances.
const OWN_EYES: readonly Pose[] = ['sleep', 'celebrate', 'pet', 'startle'];

// A left click that neither moved far nor took long opens the panel instead of being read as
// the start of a drag.
const CLICK_MAX_DISTANCE = 4;
const CLICK_MAX_DURATION_MS = 400;
const DOUBLE_CLICK_MS = 220;

// Art, not interface, which is why these are here and not in theme.css. A trophy is gold in
// night mode too, the same way the mascot stays purple in it.
const GOLD = '#facc15';
const GOLD_DARK = '#ca8a04';
const SPARKLE = '#fef3c7';

// Cup, stem and base in sprite pixels, drawn above the right shoulder so the flame stays clear.
const TROPHY: readonly string[] = ['xxxxxx', 'xxxxxx', '.xxxx.', '..xx..', '..xx..', '.dddd.'];
const TROPHY_AT = { x: 21, y: 2 };
const SPARKLES: readonly [number, number][] = [
  [5, 10],
  [27, 8],
];

function drawPixels(ctx: CanvasRenderingContext2D, scale: number, rows: readonly string[]) {
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const cell = row[x];
      if (cell === '.') continue;
      ctx.fillStyle = cell === 'd' ? GOLD_DARK : GOLD;
      ctx.fillRect((TROPHY_AT.x + x) * scale, (TROPHY_AT.y + y) * scale, scale, scale);
    }
  });
}

function drawCelebration(ctx: CanvasRenderingContext2D, scale: number, intensity: 1 | 2 | 3) {
  if (intensity === 3) {
    drawPixels(ctx, scale, TROPHY);
    return;
  }
  if (intensity === 2) {
    ctx.fillStyle = SPARKLE;
    for (const [x, y] of SPARKLES) ctx.fillRect(x * scale, y * scale, scale, scale);
  }
}

function drawFrame(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  frame: Frame,
  dx = 0,
  dy = 0,
) {
  const scale = SIZE / frame.w;
  ctx.drawImage(source, frame.x, frame.y, frame.w, frame.h, dx * scale, dy * scale, SIZE, SIZE);
}

/** The sheet the window draws from: the built-in art, or the built-in art with a drawing on it. */
interface Art {
  source: CanvasImageSource;
  /** A drawing is composed after it decodes; a sheet straight off disk has to be waited for. */
  ready: () => boolean;
  sheet: Sheet;
}

async function drawnArt(entry: MascotSheet, slug: string): Promise<Art | null> {
  const mascot = await window.wisp.loadCustomMascot(slug);
  if (!mascot) return null;
  const image = new Image();
  image.src = entry.url;
  await image.decode();
  const composed = await buildCustomSheet(
    { sheet: entry.sheet, image, width: image.naturalWidth, height: image.naturalHeight },
    mascot,
  );
  return { source: composed.image, ready: () => true, sheet: composed.sheet };
}

// The sheet declares its stride in sprite pixels and the mascot walks in screen pixels, so the
// stride is scaled the same way the frame is before the two are compared.
function walkPhase(sheet: Sheet, walkPx: number): number {
  const frame = sheet.animations.walk[0];
  const scale = frame ? SIZE / frame.w : 1;
  return walkPx / (sheet.stridePx * scale);
}

interface PointerDown {
  x: number;
  y: number;
  time: number;
}

export function Mascot() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const clickTimer = useRef<number | null>(null);
  const downRef = useRef<PointerDown | null>(null);
  const [dragging, setDragging] = useState(false);
  const [mascot, setMascot] = useState<MascotName>(defaultConfig.mascot);
  const [customMascot, setCustomMascot] = useState(defaultConfig.customMascot);
  const [drawn, setDrawn] = useState<{ key: string; art: Art } | null>(null);
  const key = `${mascot}/${customMascot}`;

  const builtIn = useMemo<Art | null>(() => {
    const entry = sheetFor(mascot);
    if (!entry) return null;
    const image = new Image();
    image.src = entry.url;
    return {
      source: image,
      ready: () => image.complete && image.naturalWidth > 0,
      sheet: entry.sheet,
    };
  }, [mascot]);

  // The built-in art draws until the drawing is composed, and stays if it never is. An empty
  // window would be a worse answer than the mascot the user had yesterday.
  const art = drawn?.key === key ? drawn.art : builtIn;

  useEffect(() => {
    const apply = (config: Config) => {
      setMascot(config.mascot);
      setCustomMascot(config.customMascot);
    };
    void window.wisp.getConfig().then(apply);
    return window.wisp.onConfigChanged(apply);
  }, []);

  useEffect(
    () => () => {
      if (clickTimer.current !== null) window.clearTimeout(clickTimer.current);
    },
    [],
  );

  useEffect(() => {
    const entry = sheetFor(mascot);
    if (!entry || customMascot.length === 0) return;
    let alive = true;
    void drawnArt(entry, customMascot)
      .then((art) => {
        if (alive && art) setDrawn({ key, art });
      })
      .catch((err: unknown) => {
        console.error('The drawing could not be composed.', err);
      });
    return () => {
      alive = false;
    };
  }, [mascot, customMascot, key]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !art) return;
    const { source, sheet, ready } = art;

    let current: PoseUpdate = {
      pose: 'idle',
      facing: 'right',
      expression: 'plain',
      speedFactor: 1,
    };
    let poseStart = performance.now();
    let handle = 0;

    const draw = (now: number) => {
      handle = 0;
      if (ready()) {
        const speed = current.speedFactor > 0 ? current.speedFactor : 1;
        // Walking is driven by ground covered, which already carries the mood speed factor.
        // Every other pose is a clock, and there the factor still has to be applied by hand.
        const frame =
          current.pose === 'walk' && current.walkPx !== undefined
            ? frameAtPhase(sheet.animations.walk, walkPhase(sheet, current.walkPx))
            : frameAt(sheet.animations[current.pose], (now - poseStart) * speed);
        const scale = SIZE / frame.w;
        ctx.clearRect(0, 0, SIZE, SIZE);
        ctx.imageSmoothingEnabled = false;
        ctx.save();
        if (current.facing === 'left') {
          ctx.translate(SIZE, 0);
          ctx.scale(-1, 1);
        }
        drawFrame(ctx, source, frame);
        if (!OWN_EYES.includes(current.pose)) {
          drawFrame(ctx, source, sheet.expressions[current.expression], frame.bobX, frame.bobY);
        }
        if (current.pose === 'celebrate' && current.intensity !== undefined) {
          drawCelebration(ctx, scale, current.intensity);
        }
        ctx.restore();
      }
      schedule();
    };

    const schedule = () => {
      if (handle === 0 && document.visibilityState === 'visible') {
        handle = requestAnimationFrame(draw);
      }
    };

    const stop = () => {
      if (handle !== 0) {
        cancelAnimationFrame(handle);
        handle = 0;
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') schedule();
      else stop();
    };

    const unsubscribe = window.wisp.onPose((update) => {
      if (update.pose !== current.pose) poseStart = performance.now();
      current = update;
    });
    document.addEventListener('visibilitychange', onVisibility);
    schedule();

    return () => {
      stop();
      unsubscribe();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [art]);

  function onPointerDown(e: PointerEvent<HTMLCanvasElement>) {
    if (e.button !== 0) return;
    downRef.current = { x: e.clientX, y: e.clientY, time: performance.now() };
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    window.wisp.dragStart({ offsetX: e.clientX, offsetY: e.clientY });
  }

  function onPointerUp(e: PointerEvent<HTMLCanvasElement>) {
    if (!dragging) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    setDragging(false);
    window.wisp.dragEnd();

    const down = downRef.current;
    downRef.current = null;
    if (!down || e.type !== 'pointerup') return;
    const distance = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    const duration = performance.now() - down.time;
    if (distance > CLICK_MAX_DISTANCE || duration >= CLICK_MAX_DURATION_MS) return;

    // A double click is petting, and petting must not leave the panel open behind it. The panel
    // therefore waits out the double click window before opening. It is the cost of putting two
    // gestures on one button, and 220ms is under what a person reads as a delay.
    if (clickTimer.current !== null) {
      window.clearTimeout(clickTimer.current);
      clickTimer.current = null;
      window.wisp.pet();
      return;
    }
    clickTimer.current = window.setTimeout(() => {
      clickTimer.current = null;
      window.wisp.togglePanel();
    }, DOUBLE_CLICK_MS);
  }

  function onContextMenu(e: MouseEvent<HTMLCanvasElement>) {
    e.preventDefault();
    window.wisp.contextMenu();
  }

  return (
    <canvas
      ref={canvasRef}
      width={SIZE}
      height={SIZE}
      className={dragging ? 'mascot dragging' : 'mascot'}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onContextMenu={onContextMenu}
    />
  );
}
