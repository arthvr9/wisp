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
      stridePx?: number;
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
  stridePx: number;
}

// Sprite pixels one full walk cycle covers on the ground, for a sheet that does not declare its
// own. It is what the old time based cycle covered at the default walk speed, so art from before
// the field existed keeps the cadence it had.
export const DEFAULT_STRIDE_PX = 13;

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

function strideOf(json: AsepriteJson): number {
  const declared = json.meta.wisp?.stridePx;
  return typeof declared === 'number' && declared > 0 ? declared : DEFAULT_STRIDE_PX;
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
    stridePx: strideOf(json),
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

// The walk cycle advances by ground covered, not by elapsed time, so the feet cannot drift out of
// step with the speed the mascot is moving at. `phase` is 0 at the start of a cycle and 1 at its
// end; whole cycles wrap, and since the distance behind it only ever grows, the frame never steps
// backwards however small a tick is.
export function frameAtPhase(frames: readonly Frame[], phase: number): Frame {
  const first = frames[0];
  if (!first) {
    throw new Error('Animation has no frames.');
  }
  const wrapped = phase - Math.floor(phase);
  const index = Math.min(Math.floor(wrapped * frames.length), frames.length - 1);
  return frames[index] ?? first;
}
