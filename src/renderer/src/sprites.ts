import type { Pose } from '../../shared/actor';

export interface AsepriteRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface AsepriteFrame {
  frame: AsepriteRect;
  duration: number;
}

export interface AsepriteTag {
  name: string;
  from: number;
  to: number;
  direction?: string;
}

export interface AsepriteJson {
  frames: Record<string, AsepriteFrame>;
  meta: {
    frameTags: AsepriteTag[];
  };
}

export interface Frame {
  x: number;
  y: number;
  w: number;
  h: number;
  durationMs: number;
}

export interface Sheet {
  animations: Record<Pose, Frame[]>;
}

export const POSES: readonly Pose[] = ['idle', 'walk', 'sit', 'sleep', 'alert', 'drag'];

export function parseSheet(json: AsepriteJson): Sheet {
  const frames: Frame[] = Object.values(json.frames).map((f) => ({
    x: f.frame.x,
    y: f.frame.y,
    w: f.frame.w,
    h: f.frame.h,
    durationMs: f.duration,
  }));
  const animations: Partial<Record<Pose, Frame[]>> = {};
  for (const pose of POSES) {
    const tag = json.meta.frameTags.find((t) => t.name === pose);
    if (!tag) {
      throw new Error(`Sprite sheet has no frame tag "${pose}".`);
    }
    if (tag.from < 0 || tag.to < tag.from || tag.to >= frames.length) {
      throw new Error(
        `Frame tag "${pose}" spans ${tag.from} to ${tag.to}, sheet has ${frames.length} frames.`,
      );
    }
    animations[pose] = frames.slice(tag.from, tag.to + 1);
  }
  return { animations: animations as Record<Pose, Frame[]> };
}

export function frameAt(frames: readonly Frame[], elapsedMs: number): Frame {
  const first = frames[0];
  if (!first) {
    throw new Error('Animation has no frames.');
  }
  const total = frames.reduce((sum, f) => sum + f.durationMs, 0);
  if (total <= 0) return first;
  let t = Math.max(0, elapsedMs) % total;
  for (const frame of frames) {
    if (t < frame.durationMs) return frame;
    t -= frame.durationMs;
  }
  return first;
}
