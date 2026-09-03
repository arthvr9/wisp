import type { Pose } from '../../shared/actor';
import type { CustomMascot } from '../../shared/custom-art';
import { POSES } from './sprites';
import type { Frame, Sheet } from './sprites';

/**
 * Somewhere to compose the frames. The browser fills it with a canvas; a test fills it with a
 * list of the draws, which is why nothing here mentions one.
 */
export interface Surface<TImage> {
  /** What the composed sheet is drawn from once every frame has landed on it. */
  image: TImage;
  draw(source: TImage, x: number, y: number, w: number, h: number): void;
}

export type SurfaceFactory<TImage> = (width: number, height: number) => Surface<TImage>;

export interface CustomSheetInput<TImage> {
  base: Sheet;
  baseImage: TImage;
  baseWidth: number;
  baseHeight: number;
  frameWidth: number;
  frameHeight: number;
  /** Sprite pixels one walk cycle covers. Zero keeps the built-in sheet's. */
  stridePx: number;
  frames: Partial<Record<Pose, TImage[]>>;
}

export interface ComposedSheet<TImage> {
  sheet: Sheet;
  image: TImage;
  width: number;
  height: number;
}

function totalMs(frames: readonly Frame[]): number {
  return frames.reduce((sum, frame) => sum + frame.durationMs, 0);
}

// A drawn pose keeps the cadence of the pose it replaces, so nobody has to type a duration in.
// Frame for frame it is the same timing; a different number of frames splits the same total.
function durationFor(built: readonly Frame[], count: number, index: number): number {
  if (built.length === count) return built[index]?.durationMs ?? 100;
  const total = totalMs(built);
  return Math.max(1, Math.round(total / count));
}

// The expression overlay sits at an offset the built-in art carries per frame. A drawing has no
// offsets of its own, so it borrows the one from the same point in the built-in cycle.
function bobFrom(built: readonly Frame[], count: number, index: number): Frame | undefined {
  if (built.length === 0) return undefined;
  if (built.length === count) return built[index];
  return built[Math.min(built.length - 1, Math.floor((index * built.length) / count))];
}

/**
 * One sheet out of the built-in art and the frames the user drew. The built-in sheet is copied
 * to the origin of the composed image and the drawings are appended in a row under it, so every
 * pose the user left undrawn keeps the rectangles, the timing and the expressions it had.
 */
export function composeCustomSheet<TImage>(
  input: CustomSheetInput<TImage>,
  createSurface: SurfaceFactory<TImage>,
): ComposedSheet<TImage> {
  // The stride is how far the mascot travels in one walk cycle, which is a fact about the
  // ground and not about the art. A walk drawn with more or fewer frames covers the same
  // distance, so the frames get closer together rather than the mascot sliding.
  const stridePx = input.stridePx > 0 ? input.stridePx : input.base.stridePx;
  const drawn = POSES.filter((pose) => (input.frames[pose]?.length ?? 0) > 0);
  if (drawn.length === 0) {
    return {
      sheet: { ...input.base, stridePx },
      image: input.baseImage,
      width: input.baseWidth,
      height: input.baseHeight,
    };
  }

  const count = drawn.reduce((sum, pose) => sum + (input.frames[pose]?.length ?? 0), 0);
  const width = Math.max(input.baseWidth, count * input.frameWidth);
  const height = input.baseHeight + input.frameHeight;
  const surface = createSurface(width, height);
  surface.draw(input.baseImage, 0, 0, input.baseWidth, input.baseHeight);

  const animations: Record<Pose, Frame[]> = { ...input.base.animations };
  let column = 0;
  for (const pose of drawn) {
    const images = input.frames[pose] ?? [];
    const built = input.base.animations[pose];
    animations[pose] = images.map((image, index) => {
      const x = column * input.frameWidth;
      column += 1;
      surface.draw(image, x, input.baseHeight, input.frameWidth, input.frameHeight);
      const bob = bobFrom(built, images.length, index);
      return {
        x,
        y: input.baseHeight,
        w: input.frameWidth,
        h: input.frameHeight,
        durationMs: durationFor(built, images.length, index),
        bobX: bob?.bobX ?? 0,
        bobY: bob?.bobY ?? 0,
      };
    });
  }

  return {
    sheet: { animations, expressions: input.base.expressions, stridePx },
    image: surface.image,
    width,
    height,
  };
}

function browserSurface(width: number, height: number): Surface<CanvasImageSource> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('A composed sheet needs a 2d canvas.');
  context.imageSmoothingEnabled = false;
  return {
    image: canvas,
    draw(source, x, y, w, h) {
      context.drawImage(source, x, y, w, h);
    },
  };
}

function decode(url: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.src = url;
  return image.decode().then(() => image);
}

export interface BuiltInArt {
  sheet: Sheet;
  image: CanvasImageSource;
  width: number;
  height: number;
}

/** The composed sheet the mascot window draws from, frames decoded out of their data URLs. */
export async function buildCustomSheet(
  built: BuiltInArt,
  mascot: CustomMascot,
): Promise<ComposedSheet<CanvasImageSource>> {
  const drawn = POSES.filter((pose) => (mascot.frames[pose]?.length ?? 0) > 0);
  const decoded = await Promise.all(
    drawn.map((pose) => Promise.all((mascot.frames[pose] ?? []).map(decode))),
  );
  const frames: Partial<Record<Pose, CanvasImageSource[]>> = {};
  drawn.forEach((pose, index) => {
    frames[pose] = decoded[index];
  });
  return composeCustomSheet(
    {
      base: built.sheet,
      baseImage: built.image,
      baseWidth: built.width,
      baseHeight: built.height,
      frameWidth: mascot.frameWidth,
      frameHeight: mascot.frameHeight,
      stridePx: mascot.stridePx,
      frames,
    },
    browserSurface,
  );
}
