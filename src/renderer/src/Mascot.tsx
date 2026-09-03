import { useEffect, useRef, useState } from 'react';
import type { MouseEvent, PointerEvent } from 'react';

import sheetJson from '../../../resources/sprites/wisp.json';
import sheetUrl from '../../../resources/sprites/wisp.png';
import type { PoseUpdate } from '../../shared/actor';
import { frameAt, parseSheet } from './sprites';
import type { Frame } from './sprites';

const SIZE = 96;
const sheet = parseSheet(sheetJson);

// A left click that neither moved far nor took long opens the panel instead of being read as
// the start of a drag.
const CLICK_MAX_DISTANCE = 4;
const CLICK_MAX_DURATION_MS = 400;

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
  image: HTMLImageElement,
  frame: Frame,
  dx = 0,
  dy = 0,
) {
  const scale = SIZE / frame.w;
  ctx.drawImage(image, frame.x, frame.y, frame.w, frame.h, dx * scale, dy * scale, SIZE, SIZE);
}

interface PointerDown {
  x: number;
  y: number;
  time: number;
}

export function Mascot() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const downRef = useRef<PointerDown | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const image = new Image();
    image.src = sheetUrl;

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
      if (image.complete && image.naturalWidth > 0) {
        const speed = current.speedFactor > 0 ? current.speedFactor : 1;
        const frame = frameAt(sheet.animations[current.pose], (now - poseStart) * speed);
        const scale = SIZE / frame.w;
        ctx.clearRect(0, 0, SIZE, SIZE);
        ctx.imageSmoothingEnabled = false;
        ctx.save();
        if (current.facing === 'left') {
          ctx.translate(SIZE, 0);
          ctx.scale(-1, 1);
        }
        drawFrame(ctx, image, frame);
        if (current.pose !== 'sleep' && current.pose !== 'celebrate') {
          drawFrame(ctx, image, sheet.expressions[current.expression], frame.bobX, frame.bobY);
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
    image.addEventListener('load', schedule);
    schedule();

    return () => {
      stop();
      unsubscribe();
      document.removeEventListener('visibilitychange', onVisibility);
      image.removeEventListener('load', schedule);
    };
  }, []);

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
    if (distance <= CLICK_MAX_DISTANCE && duration < CLICK_MAX_DURATION_MS) {
      window.wisp.togglePanel();
    }
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
