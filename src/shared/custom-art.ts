import type { Pose } from './actor';

// Shape of a hand drawn mascot: the types main and the settings screen agree on. The numbers
// that describe the built-in art (frame size, how many frames each pose spends, the stride)
// are read from resources/sprites/wisp.json at runtime, not repeated here.

export const CUSTOM_ART_VERSION = 1;

export const CUSTOM_ART_MANIFEST = 'mascot.json';
export const CUSTOM_ART_GUIDE = 'how-to-draw.txt';
export const CUSTOM_ART_REFERENCE = 'reference.png';

/** One pose of the built-in sheet, as the template and the validator both see it. */
export interface CustomArtPoseSpec {
  pose: Pose;
  frames: number;
  durationMs: number;
}

export interface CustomArtSpec {
  frameWidth: number;
  frameHeight: number;
  /** Row the mascot stands on, counted from the top of the frame starting at 0. */
  groundRow: number;
  /** Sprite pixels one full walk cycle covers on the ground. */
  stridePx: number;
  poses: CustomArtPoseSpec[];
}

/**
 * What each pose is for, shown in the guide file and available to the settings screen. Partial
 * on purpose: a pose added to the behaviour before its art exists still has to typecheck here.
 */
export const POSE_GUIDE: Partial<Record<Pose, string>> = {
  idle: 'Standing still and breathing. This one plays most of the time, so it deserves the most care.',
  walk: 'One full walk cycle, facing right. The window mirrors it when the mascot walks the other way, so draw it facing right only.',
  sit: 'Sitting down and staying there. It follows a walk that ended, so the first frame should read as the moment of sitting.',
  sleep: 'Asleep, after a long stretch with nobody at the machine. Slow and small movement.',
  alert: 'Woken up by something worth saying: a task due soon, a meeting about to start.',
  drag: 'Held by the mouse and hanging from it. Nothing touches the ground in this one.',
  celebrate: 'A task was finished. This is the only pose allowed to be loud.',
  dance: 'A short dance that loops, so the last frame has to lead back into the first.',
  pet: 'Being petted by the pointer. Small, warm, no walking.',
  startle: 'Caught by surprise, before it settles back to idle.',
};

export const POSE_GUIDE_FALLBACK = 'One more pose of the built-in sheet.';

export type CustomArtErrorCode =
  | 'no-directory'
  | 'not-a-directory'
  | 'unreadable'
  | 'too-many-files'
  | 'too-large'
  | 'folder-too-large'
  | 'symlink'
  | 'not-a-png'
  | 'wrong-size'
  | 'blank'
  | 'partial-pose'
  | 'unknown-frame'
  | 'duplicate-frame'
  | 'nothing-drawn';

/**
 * One thing the user has to fix, already written as a sentence they can act on. `file` and
 * `pose` are there so the settings screen can group or highlight without parsing the message.
 */
export interface CustomArtError {
  code: CustomArtErrorCode;
  message: string;
  file?: string;
  pose?: Pose;
}

/** A mascot on disk, without the pixels. */
export interface CustomMascotSummary {
  slug: string;
  name: string;
  /** Poses the user drew. Every other pose falls back to the built-in art. */
  poses: Pose[];
  frameWidth: number;
  frameHeight: number;
  stridePx: number;
}

/** A mascot with its pixels, as data URLs, one array of frames per drawn pose. */
export interface CustomMascot extends CustomMascotSummary {
  frames: Partial<Record<Pose, string[]>>;
}

export type CustomArtImportResult =
  { ok: true; mascot: CustomMascotSummary } | { ok: false; errors: CustomArtError[] };

/** `frameFileName('walk', 3)` is `walk-03.png`. The index is 1 based, the way the user counts. */
export function frameFileName(pose: string, index: number): string {
  return `${pose}-${String(index).padStart(2, '0')}.png`;
}

export function parseFrameFileName(fileName: string): { pose: string; index: number } | null {
  const match = /^([a-z]+)-(\d{1,3})\.png$/.exec(fileName.toLowerCase());
  if (!match) return null;
  const pose = match[1];
  const digits = match[2];
  if (pose === undefined || digits === undefined) return null;
  const index = Number.parseInt(digits, 10);
  if (index < 1) return null;
  return { pose, index };
}

const SLUG_MAX = 32;

/** A folder name for a mascot the user named. Diacritics, spaces and punctuation all go. */
export function slugForMascotName(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, SLUG_MAX)
    .replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : 'mascot';
}

// A slug reaches main from the renderer and is joined onto a path, so it is checked before it
// is trusted rather than after.
export function isCustomMascotSlug(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,47}$/.test(value);
}

// Measured off the built-in sheet: the mascot rests on this row and its shadow spills one row
// below it. Frames are 32 rows tall, so the bottom two rows stay empty.
export const GROUND_ROW = 28;

// The pose names the art can carry. The sheet decides which of them actually have frames, so a
// name missing from a sheet is simply a pose the mascot does not draw.
export const POSE_ORDER: readonly Pose[] = [
  'idle',
  'walk',
  'sit',
  'sleep',
  'alert',
  'drag',
  'celebrate',
  'dance',
  'pet',
  'startle',
];

export function isPose(value: string): value is Pose {
  return (POSE_ORDER as readonly string[]).includes(value);
}
