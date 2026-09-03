// Shared constants describing the sheet layout every mascot must follow, and the JSDoc contract
// a mascot module implements. See scripts/lib/sheet.mjs for the code that reads this contract.

/** @typedef {'bright' | 'plain' | 'low'} Expression */

/** @type {readonly Expression[]} */
export const EXPRESSIONS = ['bright', 'plain', 'low'];

/** @type {{ name: string; frames: number; duration: number }[]} */
export const POSES = [
  { name: 'idle', frames: 2, duration: 500 },
  { name: 'walk', frames: 4, duration: 140 },
  { name: 'sit', frames: 2, duration: 600 },
  { name: 'sleep', frames: 2, duration: 900 },
  { name: 'alert', frames: 2, duration: 120 },
  { name: 'drag', frames: 2, duration: 300 },
  { name: 'celebrate', frames: 3, duration: 160 },
];

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
