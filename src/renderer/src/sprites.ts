import type { Pose } from '../../shared/actor';
import type { Expression } from '../../shared/mood';

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
    wisp?: {
      bob?: {
        offsetX?: number[];
        offsetY?: number[];
      };
    };
  };
}

export interface Frame {
  x: number;
  y: number;
  w: number;
  h: number;
  durationMs: number;
  bobX: number;
  bobY: number;
}

export interface Sheet {
  animations: Record<Pose, Frame[]>;
  expressions: Record<Expression, Frame>;
}

export const POSES: readonly Pose[] = [
  'idle',
  'walk',
  'sit',
  'sleep',
  'alert',
  'drag',
  'celebrate',
];
export const EXPRESSIONS: readonly Expression[] = ['bright', 'plain', 'low'];
const EXPRESSIONS_TAG = 'expressions';

function findTag(json: AsepriteJson, name: string, frameCount: number): AsepriteTag {
  const tag = json.meta.frameTags.find((t) => t.name === name);
  if (!tag) {
    throw new Error(`Sprite sheet has no frame tag "${name}".`);
  }
  if (tag.from < 0 || tag.to < tag.from || tag.to >= frameCount) {
    throw new Error(
      `Frame tag "${name}" spans ${tag.from} to ${tag.to}, sheet has ${frameCount} frames.`,
    );
  }
  return tag;
}

export function parseSheet(json: AsepriteJson): Sheet {
  const offsetX = json.meta.wisp?.bob?.offsetX ?? [];
  const offsetY = json.meta.wisp?.bob?.offsetY ?? [];
  const frames: Frame[] = Object.values(json.frames).map((f, i) => ({
    x: f.frame.x,
    y: f.frame.y,
    w: f.frame.w,
    h: f.frame.h,
    durationMs: f.duration,
    bobX: offsetX[i] ?? 0,
    bobY: offsetY[i] ?? 0,
  }));
  const animations: Partial<Record<Pose, Frame[]>> = {};
  for (const pose of POSES) {
    const tag = findTag(json, pose, frames.length);
    animations[pose] = frames.slice(tag.from, tag.to + 1);
  }
  const tag = findTag(json, EXPRESSIONS_TAG, frames.length);
  if (tag.to - tag.from + 1 !== EXPRESSIONS.length) {
    throw new Error(
      `Frame tag "${EXPRESSIONS_TAG}" has ${tag.to - tag.from + 1} frames, expected ${EXPRESSIONS.length}.`,
    );
  }
  const expressions: Partial<Record<Expression, Frame>> = {};
  EXPRESSIONS.forEach((expression, i) => {
    expressions[expression] = frames[tag.from + i];
  });
  return {
    animations: animations as Record<Pose, Frame[]>,
    expressions: expressions as Record<Expression, Frame>,
  };
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
