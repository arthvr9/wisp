// Shared constants describing the sheet layout every mascot must follow, and the JSDoc contract
// a mascot module implements. See scripts/lib/sheet.mjs for the code that reads this contract.

/** @typedef {'bright' | 'plain' | 'low'} Expression */

/** @type {readonly Expression[]} */
export const EXPRESSIONS = ['bright', 'plain', 'low'];

// The pose order and the default hold for one of its frames. How many frames a pose spends is
// the mascot's own business: its frame table is what the sheet reads, and a frame that wants a
// different hold says so with `durationMs`.
/** @type {{ name: string; duration: number }[]} */
export const POSES = [
  { name: 'idle', duration: 500 },
  { name: 'walk', duration: 140 },
  { name: 'sit', duration: 600 },
  { name: 'sleep', duration: 900 },
  { name: 'alert', duration: 120 },
  { name: 'drag', duration: 300 },
  { name: 'celebrate', duration: 160 },
  { name: 'dance', duration: 105 },
  { name: 'pet', duration: 100 },
  { name: 'startle', duration: 95 },
];

// The seven poses every mascot has to draw. The three after them were added once art already
// existed, so a mascot that skips one is an older mascot rather than a broken one: the sheet
// leaves the tag out and the renderer borrows another pose for it. Leaving one of these seven
// out is still an error, because there is nothing sensible to borrow.
export const REQUIRED_POSES = ['idle', 'walk', 'sit', 'sleep', 'alert', 'drag', 'celebrate'];

/** @type {{ mood: string; expression: Expression; brightness: number; saturation: number }[]} */
export const MOODS = [
  { mood: 'dejected', expression: 'low', brightness: 0.78, saturation: 0.55 },
  { mood: 'stressed', expression: 'low', brightness: 0.9, saturation: 0.85 },
  { mood: 'uneasy', expression: 'plain', brightness: 0.95, saturation: 0.95 },
  { mood: 'calm', expression: 'plain', brightness: 1, saturation: 1 },
  { mood: 'cheerful', expression: 'bright', brightness: 1.08, saturation: 1 },
  { mood: 'elated', expression: 'bright', brightness: 1.18, saturation: 1.05 },
];

/**
 * Every mascot specific frame spec extends this: `bobX`/`bobY` say how far frame i moves the
 * eyes away from the idle eye position, so the expression overlay lands on the eyes of a frame
 * that bobs, walks or hops. Zero (the default) means the eyes do not move for that frame.
 * @typedef {object} FrameSpec
 * @property {number} [bobX]
 * @property {number} [bobY]
 * @property {number} [durationMs] how long this frame is held, when the pose default is wrong for
 *   it. A pose that spends many frames on one gesture usually holds each of them for less.
 */

/**
 * A mascot is a table of per pose frame specs (`T`, a shape private to the mascot module) plus
 * the drawing functions that turn a spec into pixels. Everything that is the same for every
 * mascot (the sheet grid, the PNG encoder, the tray composition, the JSON writer) lives in
 * scripts/lib/sheet.mjs instead and is generic over `T`.
 * @template {FrameSpec} T
 * @typedef {object} Mascot
 * @property {string} id
 * @property {number} stridePx how many sprite pixels one full walk cycle covers on the ground.
 *   The renderer advances the walk frames by distance walked rather than by elapsed time, so
 *   this is what keeps the feet (or the bob) in step with whatever speed the mascot moves at.
 *   It belongs to the art: measure it from how far a foot travels against the body between
 *   frames, since a stepping cat and a floating ghost do not agree on it.
 * @property {Record<string, T[]>} frames keyed by pose name, in the order of POSES
 * @property {(spec: T) => import('./canvas.mjs').Canvas} draw one 32x32 sheet frame
 * @property {(expression: Expression) => import('./canvas.mjs').Canvas} drawExpression one 32x32
 *   overlay frame: clears the mascot's eye area then paints the mood's eyes on top of it
 * @property {(expression: Expression, brightness: number, saturation: number) => import('./canvas.mjs').Canvas} drawTray
 *   a 22x22 tray icon tinted for one mood
 * @property {() => import('./canvas.mjs').Canvas} drawIcon a 32x32 portrait for the settings icon
 */
