import { useEffect, useRef, useState } from 'react';
import type { MouseEvent, PointerEvent } from 'react';

import sheetJson from '../../../resources/sprites/wisp.json';
import sheetUrl from '../../../resources/sprites/wisp.png';
import type { PoseUpdate } from '../../shared/actor';
import { frameAt, parseSheet } from './sprites';

const SIZE = 96;
const sheet = parseSheet(sheetJson);

export function Mascot() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const image = new Image();
    image.src = sheetUrl;

    let current: PoseUpdate = { pose: 'idle', facing: 'right' };
    let poseStart = performance.now();
    let handle = 0;

    const draw = (now: number) => {
      handle = 0;
      if (image.complete && image.naturalWidth > 0) {
        const frame = frameAt(sheet.animations[current.pose], now - poseStart);
        ctx.clearRect(0, 0, SIZE, SIZE);
        ctx.imageSmoothingEnabled = false;
        ctx.save();
        if (current.facing === 'left') {
          ctx.translate(SIZE, 0);
          ctx.scale(-1, 1);
        }
        ctx.drawImage(image, frame.x, frame.y, frame.w, frame.h, 0, 0, SIZE, SIZE);
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
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    window.wisp.dragStart({ offsetX: e.clientX, offsetY: e.clientY });
  }

  function onPointerUp(e: PointerEvent<HTMLCanvasElement>) {
    if (!dragging) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    setDragging(false);
    window.wisp.dragEnd();
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
