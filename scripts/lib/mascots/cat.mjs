// A chunky black cat, drawn against a reference sheet of a small black cat in the same style: a
// wide rounded head sitting straight on the body with no neck, big solid triangle ears growing
// out of the top of it, green eyes with a dark slit pupil, one pink nose as the only warm colour
// on the face, a cream bib down the chest and a thin hooked tail.
//
// Four rules the reference is strict about and the art must not lose:
//   - the tail leaves the rump on the diagonal (or, sitting, lies along the ground) and never
//     runs beside a leg. It is four pixels wide and every row of the curve steps one pixel, so
//     it reads as a tail rather than as a hook. Anything thinner is all outline once the mask
//     is painted and reads as a wire.
//   - the body is compact and carries volume. The profile body is eighteen long and twelve
//     deep, half again as long as it is deep; at twice as long it reads as a dachshund, and on
//     thin legs under a shallow body it reads as a stray.
//   - the head sits on the shoulders. Every column the head occupies has body under it starting
//     at or above the lowest head pixel of that column, so no row of background can appear
//     between jaw and chest. One transparent row there is three screen pixels at 1:3 and it
//     reads as a severed head, so the top line of a profile body runs flat under the whole
//     head and only steps down behind it.
//   - a walking leg is a shape, not a column. Every leg leans: a planted forward leg puts its paw
//     ahead of its own shoulder and steps back as it rises, a pushing leg is the mirror of that,
//     and a swinging leg is short, folded and off the ground. Four vertical posts that only
//     change column and lift a pixel read as a toy marching in place, whatever the timing.
//
// Frames are pixel maps: `#` is fur, `l` a cream patch, `p` pink, `-` a crease inside the
// silhouette. Each layer (far legs behind the body, the body with its tail and near
// legs, the head, whatever wraps in front) is one mask outlined in one pass, so the parts of a
// layer share an outline instead of drawing a seam between them.
//
// There are no whiskers. Two or three grey pixels beside a dark head at this size read as dirt
// on the screen, so the ears, the pink nose and the eyes carry the cat instead.
import { Canvas, tintPalette } from '../canvas.mjs';
import { paintMask, paintZ } from '../parts.mjs';
import { FRAME } from '../sheet.mjs';

/** @typedef {import('../mascot.mjs').Expression} Expression */
/** @typedef {import('../mascot.mjs').FrameSpec} FrameSpec */
/** @typedef {{ x: number; y: number; rows: string[] }} Art a pixel map placed at x, y */
/** @typedef {'open' | 'wide' | 'half' | 'closed' | 'happy'} EyeStyle */

/** @type {Record<string, import('../canvas.mjs').Rgba>} */
const PALETTE = {
  outline: [16, 16, 22, 255],
  body: [58, 58, 70, 255],
  // The far pair is painted a step darker than the near pair, so the two sides read as two sides
  // even on the frames where a far leg crosses behind a near one.
  far: [38, 38, 48, 255],
  lightFar: [176, 167, 147, 255],
  light: [238, 226, 200, 255],
  pink: [226, 146, 158, 255],
  eye: [124, 220, 128, 255],
  white: [255, 255, 255, 255],
};
const TINT_SKIP = ['eye', 'white'];

// The head is the same twelve by nine block in every pose, so the expression overlay lands on
// the eyes wherever the head goes. Its top row is full width because the ear bases sit on it:
// a narrower row leaves one pixel of background showing at the base of each ear.
const HEAD = [
  '.##########.',
  '.##########.',
  '############',
  '############',
  '############',
  '############',
  '############',
  '.##########.',
  '..########..',
];

// Eye geometry inside that block: two eyes three pixels wide with two pixels of fur between
// them, growing upward from one fixed bottom row so every expression shares a baseline. The
// widest of them starts at row 1, which is what the overlay has to clear.
const EYE_LEFT_DX = 2;
const EYE_RIGHT_DX = 7;
const EYE_BOTTOM_DY = 5;
const EYE_TOP_DY = 1;

// Four rows tall, four wide at the base, two of head between them, tips leaning outward. The
// mask makes them solid dark, which is what the reference does: no inner pink. A one pixel tip
// on a four row triangle reads as a horn at this size, so the tip is two wide and blunt.
/** @type {Record<string, string[]>} */
const EARS = {
  up: ['.##......##.', '.###....###.', '.####..####.', '.####..####.'],
  relaxed: ['.##......##.', '.###....###.', '.####..####.'],
  flat: ['.###....###.', '.####..####.'],
};

const GROUND = 28;

// Profile standing body: eighteen long and twelve deep, half again as long as it is deep. At
// twenty two it read as a dachshund, a horizontal sausage on four sticks. The top line is flat
// across every column the head covers and steps down only behind it, which is what buries the
// jaw in the shoulder; the head is drawn over it, so those rows are mostly never seen. What they
// buy is a silhouette with no seam.
const STAND_BODY = [
  '......############',
  '....##############',
  '..################',
  '.#################',
  '##################',
  '##################',
  '##################',
  '##################',
  '##################',
  '##################',
  '.#################',
  '..###############.',
];
// Raised a row above where it used to sit: under it there has to be enough height for a leg to
// lean, and three rows of visible leg can only hold a post.
const STAND_BODY_AT = { x: 9, y: 12 };

// A narrow wedge of cream under the chin, widening a little down the chest, and one row along
// the bottom of the belly. Together about a seventh of the visible body: a broad band across the
// flank reads as a saddle on a two colour cat, not as a black cat with a pale chest.
const STAND_MARKS = ['..l', '.ll', '.ll', 'lll', 'lll', '.ll'];
const STAND_MARKS_AT = { x: 23, y: 15 };
const STAND_BELLY = ['llllllllll'];
const STAND_BELLY_AT = { x: 13, y: 22 };

// The walking tail: a four pixel arc that leaves the rump on the diagonal, sweeps up and back
// and hooks forward at the tip. Every row steps one pixel, so the curve is round: a vertical
// stack with a bar across the top is a hook, not a tail, and a base that meets the rump at
// ninety degrees is a limb bolted on. Every row of it is above the line of the back.
const TAIL_UP = [
  '..####..',
  '.####...',
  '####....',
  '####....',
  '####....',
  '.####...',
  '..####..',
  '...####.',
  '....####',
];
const TAIL_UP_AT = { x: 6, y: 7 };

// The alert tail: up, with the tip stepped forward and the base still curving out of the rump on
// the diagonal, because a constant width column joined at ninety degrees reads as a plank.
const TAIL_STRAIGHT = [
  '.####...',
  '####....',
  '####....',
  '####....',
  '####....',
  '####....',
  '####....',
  '####....',
  '.####...',
  '..####..',
  '...####.',
  '....####',
];
const TAIL_STRAIGHT_AT = { x: 7, y: 4 };

// Sitting: a wedge with a vertical chest at the front and the back curving down to a heavy
// rump, steep at the shoulder and flattening at the base, which is the shape a cat actually
// makes. A straight forty five degree back reads as a doorstop.
const SIT_BODY = [
  '.......############',
  '.....##############',
  '....###############',
  '...################',
  '..#################',
  '..#################',
  '.##################',
  '.##################',
  '###################',
  '###################',
  '###################',
  '###################',
  '###################',
  '###################',
  '###################',
  '###################',
  '###################',
  '.#################.',
];
const SIT_BODY_AT = { x: 9, y: 11 };

// The bib: a wedge that starts under the chin and widens a little down the chest, plus the pale
// front paw the cat sits on. Both touch the front of the animal; cream that starts in the middle
// of the flank reads as a marking on a different cat.
const SIT_MARKS = ['...l', '..ll', '..ll', '.lll', '.lll', 'llll', 'llll', '.lll', '..ll'];
const SIT_MARKS_AT = { x: 23, y: 13 };
const SIT_PAW = ['.lll'];
const SIT_PAW_AT = { x: 23, y: 27 };

// The crease that separates the front leg from the haunch behind it.
const SIT_CREASE = ['-', '-', '-', '-', '-', '-', '-', '-'];
const SIT_CREASE_AT = { x: 22, y: 20 };

// A sitting cat lays its tail along the ground and curls the tip up. Down there it cannot be
// confused with a leg (a sitting cat shows none), it widens the silhouette the way the sitting
// poses in the reference do, and the flick has somewhere to go: the tip only.
const TAIL_SIT = [
  '..###.....',
  '.####.....',
  '.####.....',
  '.####.....',
  '.####.....',
  '.#####....',
  '..######..',
  '..########',
  '...#######',
];
const TAIL_SIT_FLICK = [
  '...####...',
  '..#####...',
  '.#####....',
  '.####.....',
  '.####.....',
  '.#####....',
  '..######..',
  '..########',
  '...#######',
];
const TAIL_SIT_AT = { x: 1, y: 20 };

// Asleep: a mound, higher at the rump, with the head down at the front. The tail is stretched
// out behind with the tip hooked up, well clear of the mound, because a tail tucked into a
// sleeping silhouette at this size is a tail nobody can see.
const CURL_BODY = [
  '...##########.........',
  '.##############.......',
  '################......',
  '#################.....',
  '##################....',
  '###################...',
  '####################..',
  '#####################.',
  '######################',
  '######################',
  '######################',
  '.####################.',
  '...################...',
];
const CURL_BODY_AT = { x: 5, y: 16 };

const CURL_MARKS = ['..lllllllll.', '...llllllll.'];
const CURL_MARKS_AT = { x: 13, y: 26 };

const TAIL_SLEEP = [
  '.###......',
  '.####.....',
  '.####.....',
  '..####....',
  '..######..',
  '...######.',
  '....#####.',
];
const TAIL_SLEEP_AT = { x: 0, y: 20 };

// Held up by the scruff: a short hanging body with the legs dangling clear of it, rather than
// legs drawn inside a long body where nothing of them shows.
const HANG_BODY = [
  '.############.',
  '##############',
  '##############',
  '##############',
  '##############',
  '##############',
  '##############',
  '.############.',
  '..##########..',
];
const HANG_BODY_AT = { x: 11, y: 11 };

const HANG_MARKS = ['.ll.', 'llll', 'llll', '.ll.'];
const HANG_MARKS_AT = { x: 16, y: 13 };

// It leaves the flank high, well above the dangling paws, and hooks at the tip. Nothing about a
// tail that stops eight rows short of the ground can be read as a fifth leg.
const TAIL_HANG = [
  '......###',
  '...######',
  '..#####..',
  '.####....',
  '.####....',
  '..####...',
  '..####...',
  '...####..',
];
const TAIL_HANG_AT = { x: 4, y: 14 };

// Mid hop: a shorter, rounder body with the hind legs tucked and both front paws thrown up.
const JUMP_BODY = [
  '.############.',
  '##############',
  '##############',
  '##############',
  '##############',
  '##############',
  '.############.',
  '..##########..',
  '...########...',
];
const JUMP_BODY_AT = { x: 9, y: 13 };

const JUMP_MARKS = ['.ll.', 'llll', 'llll', '.ll.'];
const JUMP_MARKS_AT = { x: 14, y: 16 };

const TAIL_JUMP = [
  '..####....',
  '.####.....',
  '.####.....',
  '..####....',
  '..#####...',
  '...#######',
];
const TAIL_JUMP_AT = { x: 2, y: 14 };

// Both front legs thrown up and out, one either side of the head, paws on top. They run all the
// way down into the shoulder: an arm that stops short of the body floats beside it.
const ARM_LEFT = [
  '#ll#....',
  '####....',
  '.####...',
  '..####..',
  '...####.',
  '....####',
  '.....###',
];
const ARM_LEFT_AT = { x: 4, y: 10 };
const ARM_RIGHT = [
  '....#ll#',
  '....####',
  '...####.',
  '..####..',
  '.####...',
  '####....',
  '###.....',
];
const ARM_RIGHT_AT = { x: 20, y: 10 };

/**
 * @param {Art} art
 * @param {number} dx
 * @param {number} dy
 * @returns {Art}
 */
function shift(art, dx, dy) {
  return { x: art.x + dx, y: art.y + dy, rows: art.rows };
}

/**
 * @param {Uint8Array} mask
 * @param {Art} art
 * @param {number} width
 * @param {number} height
 */
function stamp(mask, art, width, height) {
  art.rows.forEach((row, dy) => {
    for (let dx = 0; dx < row.length; dx++) {
      if (row[dx] === '.') continue;
      const x = art.x + dx;
      const y = art.y + dy;
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      mask[y * width + x] = 1;
    }
  });
}

/** @type {Record<string, string>} */
const DETAIL = { l: 'light', f: 'lightFar', p: 'pink', '-': 'outline' };

/**
 * The `l`, `f`, `p` and `-` cells, painted after the outline pass so they sit inside the
 * silhouette rather than being eaten by it.
 * @param {Canvas} canvas
 * @param {Art} art
 */
function paintDetail(canvas, art) {
  const { palette } = canvas;
  art.rows.forEach((row, dy) => {
    for (let dx = 0; dx < row.length; dx++) {
      const key = DETAIL[row[dx] ?? ''];
      const color = key ? palette[key] : undefined;
      if (color) canvas.set(art.x + dx, art.y + dy, color);
    }
  });
}

/**
 * One layer: the parts share a mask, so they share one outline. Later layers paint over earlier
 * ones, which is how a leg reads as being behind the body and a wrapped tail as being in front.
 * @param {Canvas} canvas
 * @param {Art[]} parts
 * @param {'body' | 'far'} [tone]
 */
function paintParts(canvas, parts, tone = 'body') {
  if (parts.length === 0) return;
  const { palette } = canvas;
  // The far pair is painted flat in its own tone, with no outline of its own: two pixels wide,
  // an outline would be the whole leg and the two sides would be the same black.
  const fill = tone === 'far' ? palette.far : palette.body;
  const edge = tone === 'far' ? palette.far : palette.outline;
  if (!fill || !edge) throw new Error(`Palette has no ${tone} tone.`);
  const mask = new Uint8Array(canvas.width * canvas.height);
  for (const part of parts) stamp(mask, part, canvas.width, canvas.height);
  paintMask(canvas, mask, fill, edge);
  for (const part of parts) paintDetail(canvas, part);
}

// The four shapes a leg takes, as the offset of each row from the shoulder or hip it hangs off,
// paw row first and rising from there. A planted leg is what carries the animal: `reach` puts the
// paw two columns ahead and steps back as it rises, `plant` stands under the joint taking the
// weight, `push` is the mirror of the reach at the end of the stroke. `swing` is the one leg that
// is not on the ground: shorter, folded back at the top and forward at the paw, carried through
// under the belly. Rows above the ones listed stay under the joint, buried in the body.
/** @typedef {{ dx: number[]; lift: number }} LegShape */
/** @type {Record<string, LegShape>} */
const LEG_SHAPES = {
  reach: { dx: [2, 2, 1], lift: 0 },
  plant: { dx: [0], lift: 0 },
  push: { dx: [-2, -2, -1], lift: 0 },
  swing: { dx: [1, 0, -1], lift: 1 },
};

// A lateral sequence walk: each leg runs the same four shapes a quarter of a cycle behind the one
// before it, which is why no two legs are ever in the same shape. On frame 0 the animal is
// stretched between a near front paw planted ahead of the chest and a far hind paw still on the
// ground behind the rump, with the far front upright under the chest carrying the weight and the
// near hind folded and swinging through under the belly.
const LEG_CYCLE = ['reach', 'plant', 'push', 'swing'];

// Where each leg hangs from, how wide it is and how far it leans. The near pair is four pixels
// wide with a cream paw; the far pair is two, painted flat in the far tone with a dimmer paw, and
// sits far enough from its near partner that the two never line up side by side into one seven
// pixel post. Four legs that each swing four pixels do not fit side by side on an eighteen pixel
// body, so a far leg is sometimes partly behind a near one. That is what the far side of an
// animal looks like, and the tone is what keeps it readable; two legs merging into one black mass
// is not.
/** @type {Record<string, { x: number; width: number; lean: number; phase: number }>} */
const LEGS = {
  nearFront: { x: 23, width: 4, lean: 2, phase: 0 },
  farFront: { x: 19, width: 2, lean: 2, phase: 1 },
  farHind: { x: 9, width: 2, lean: 2, phase: 2 },
  nearHind: { x: 12, width: 4, lean: 2, phase: 3 },
};

/**
 * One leg in one shape. The bottom row is the paw: pale in the middle, because at this size those
 * light pixels are the only thing that lets the eye follow one foot around the cycle.
 * @param {{ x: number; width: number; lean: number }} leg
 * @param {number} top
 * @param {number} ground
 * @param {string} shape
 * @returns {Art}
 */
function legArt(leg, top, ground, shape) {
  const form = LEG_SHAPES[shape];
  if (!form) throw new Error(`Unknown leg shape ${shape}.`);
  const bottom = ground - form.lift;
  const offset = (/** @type {number} */ y) => {
    const raw = form.dx[bottom - y] ?? 0;
    return raw === 0 ? 0 : Math.sign(raw) * Math.min(Math.abs(raw), leg.lean);
  };
  let left = 0;
  for (let y = top; y <= bottom; y++) left = Math.min(left, offset(y));
  const shaft = '#'.repeat(leg.width);
  const pale = leg.width > 2 ? 'l' : 'f';
  const paw = leg.width > 2 ? `#${pale.repeat(leg.width - 2)}#` : pale.repeat(leg.width);
  /** @type {string[]} */
  const rows = [];
  for (let y = top; y <= bottom; y++) {
    rows.push('.'.repeat(offset(y) - left) + (y === bottom ? paw : shaft));
  }
  return { x: leg.x + left, y: top, rows };
}

/**
 * A leg that is not walking: a straight post. The hanging and hopping poses want one, since a cat
 * held by the scruff or in mid air is not striding.
 * @param {number} x
 * @param {number} top
 * @param {number} bottom paw row
 * @param {'near' | 'far'} kind
 * @returns {Art}
 */
function postArt(x, top, bottom, kind) {
  const near = kind === 'near';
  const shaft = near ? '####' : '##';
  const paw = near ? '#ll#' : '##';
  /** @type {string[]} */
  const rows = [];
  for (let y = top; y <= bottom; y++) rows.push(y === bottom ? paw : shaft);
  return { x, y: top, rows };
}

/**
 * @param {number} hx
 * @param {number} hy
 * @param {'up' | 'relaxed' | 'flat'} ears
 * @returns {Art[]}
 */
function headParts(hx, hy, ears) {
  const rows = EARS[ears];
  if (!rows) throw new Error(`Unknown ear set ${ears}.`);
  return [
    { x: hx, y: hy - rows.length, rows },
    { x: hx, y: hy, rows: HEAD },
  ];
}

/**
 * Two green eyes with a dark slit pupil. Every open style grows upward from `bottom` and keeps a
 * row of green above and below the pupil, so the pupil never touches the edge of the eye: that
 * one dark column is the difference between a bead and an animal looking at you.
 * @param {Canvas} canvas
 * @param {number} leftX
 * @param {number} rightX
 * @param {number} bottom
 * @param {EyeStyle} style
 */
function paintCatEyes(canvas, leftX, rightX, bottom, style) {
  const { palette } = canvas;
  for (const x of [leftX, rightX]) {
    if (style === 'closed') {
      for (let dx = 0; dx < 3; dx++) canvas.set(x + dx, bottom - 1, palette.light);
      continue;
    }
    if (style === 'happy') {
      canvas.set(x, bottom - 1, palette.eye);
      canvas.set(x + 1, bottom - 2, palette.eye);
      canvas.set(x + 2, bottom - 1, palette.eye);
      continue;
    }
    const top = style === 'wide' ? bottom - 4 : style === 'half' ? bottom - 2 : bottom - 3;
    for (let y = top; y <= bottom; y++) {
      for (let dx = 0; dx < 3; dx++) canvas.set(x + dx, y, palette.eye);
    }
    const pupilBottom = style === 'wide' ? bottom - 1 : style === 'half' ? top + 1 : top + 2;
    for (let y = top + 1; y <= pupilBottom; y++) canvas.set(x + 1, y, palette.outline);
    if (style === 'wide') canvas.set(x, top, palette.white);
  }
}

/**
 * The pink nose, and the small open mouth under it that the loud poses use. It is the only warm
 * colour on the face. The eyes are painted by the caller, since the expression overlay repaints
 * them from a frame of its own.
 * @param {Canvas} canvas
 * @param {number} hx
 * @param {number} hy
 * @param {boolean} mouth
 */
function paintFace(canvas, hx, hy, mouth) {
  const { palette } = canvas;
  canvas.set(hx + 5, hy + 6, palette.pink);
  canvas.set(hx + 6, hy + 6, palette.pink);
  if (!mouth) return;
  canvas.set(hx + 5, hy + 7, palette.pink);
  canvas.set(hx + 6, hy + 7, palette.pink);
}

/**
 * @param {Canvas} canvas
 * @param {number} leftX
 * @param {number} rightX
 * @param {number} bottom
 * @param {Expression} expression
 */
function paintExpression(canvas, leftX, rightX, bottom, expression) {
  const style = expression === 'bright' ? 'wide' : expression === 'low' ? 'half' : 'open';
  paintCatEyes(canvas, leftX, rightX, bottom, style);
}

/**
 * @typedef {FrameSpec & {
 *   kind: 'sit' | 'stand' | 'curl' | 'hang' | 'jump',
 *   dx?: number,
 *   dy?: number,
 *   headDx?: number,
 *   headDy?: number,
 *   ears?: 'up' | 'relaxed' | 'flat',
 *   eyes?: EyeStyle,
 *   mouth?: boolean,
 *   step?: number,
 *   walk?: number,
 *   tailUp?: boolean,
 *   tailFlick?: boolean,
 *   tailDx?: number,
 *   tailDy?: number,
 *   zAt?: [number, number],
 * }} CatSpec
 */

/** @type {Record<string, [number, number]>} */
const HEAD_AT = {
  sit: [16, 5],
  stand: [15, 7],
  curl: [15, 19],
  hang: [12, 4],
  jump: [10, 6],
};

/** @param {CatSpec} spec */
function headOrigin(spec) {
  const at = HEAD_AT[spec.kind];
  if (!at) throw new Error(`Unknown pose kind ${spec.kind}.`);
  return {
    x: at[0] + (spec.dx ?? 0) + (spec.headDx ?? 0),
    y: at[1] + (spec.dy ?? 0) + (spec.headDy ?? 0),
  };
}

/**
 * @typedef {{ behind: Art[]; body: Art[]; front: Art[] }} Layers
 */

/**
 * @param {CatSpec} spec
 * @returns {Layers}
 */
function standLayers(spec) {
  const top = 19;
  // The whole frame is moved by dy later, so the legs grow by that much instead: a body that
  // lifts a pixel must not take its planted paws with it.
  const ground = GROUND - (spec.dy ?? 0);
  // Standing still, every leg is under its own joint. Only the walk runs the cycle.
  const shapeOf = (/** @type {{ phase: number }} */ leg) =>
    spec.walk === undefined ? 'plant' : (LEG_CYCLE[(leg.phase + spec.walk) % 4] ?? 'plant');
  const tail = spec.tailUp
    ? { ...TAIL_STRAIGHT_AT, rows: TAIL_STRAIGHT }
    : { ...TAIL_UP_AT, rows: TAIL_UP };
  return {
    behind: [LEGS.farFront, LEGS.farHind].map((leg) => legArt(leg, top, ground, shapeOf(leg))),
    body: [
      { ...STAND_BODY_AT, rows: STAND_BODY },
      shift(tail, spec.tailDx ?? 0, spec.tailDy ?? 0),
      ...[LEGS.nearFront, LEGS.nearHind].map((leg) => legArt(leg, top, ground, shapeOf(leg))),
      { ...STAND_BELLY_AT, rows: STAND_BELLY },
      { ...STAND_MARKS_AT, rows: STAND_MARKS },
    ],
    front: [],
  };
}

/**
 * @param {CatSpec} spec
 * @returns {Layers}
 */
function hangLayers(spec) {
  const swing = spec.step ?? 0;
  return {
    behind: [postArt(13 - swing, 16, 24, 'far')],
    body: [
      { ...HANG_BODY_AT, rows: HANG_BODY },
      shift({ ...TAIL_HANG_AT, rows: TAIL_HANG }, spec.tailDx ?? 0, 0),
      postArt(15 + swing, 16, 26, 'near'),
      postArt(20 + swing, 16, 25, 'near'),
      { ...HANG_MARKS_AT, rows: HANG_MARKS },
    ],
    front: [],
  };
}

/**
 * @param {CatSpec} spec
 * @returns {Layers}
 */
function jumpLayers(spec) {
  const reach = spec.step ?? 0;
  return {
    behind: [{ ...TAIL_JUMP_AT, rows: TAIL_JUMP }],
    body: [
      { ...JUMP_BODY_AT, rows: JUMP_BODY },
      postArt(12, 19, 26, 'far'),
      postArt(16, 19, 26, 'near'),
      { ...JUMP_MARKS_AT, rows: JUMP_MARKS },
    ],
    front: [
      shift({ ...ARM_LEFT_AT, rows: ARM_LEFT }, 0, reach),
      shift({ ...ARM_RIGHT_AT, rows: ARM_RIGHT }, 0, reach),
    ],
  };
}

/**
 * @param {CatSpec} spec
 * @returns {Layers}
 */
function poseLayers(spec) {
  if (spec.kind === 'sit') {
    const tail = { ...TAIL_SIT_AT, rows: spec.tailFlick ? TAIL_SIT_FLICK : TAIL_SIT };
    return {
      behind: [],
      body: [
        shift(tail, spec.tailDx ?? 0, spec.tailDy ?? 0),
        { ...SIT_BODY_AT, rows: SIT_BODY },
        { ...SIT_CREASE_AT, rows: SIT_CREASE },
        { ...SIT_MARKS_AT, rows: SIT_MARKS },
        { ...SIT_PAW_AT, rows: SIT_PAW },
      ],
      front: [],
    };
  }
  if (spec.kind === 'curl') {
    return {
      behind: [],
      body: [
        { ...TAIL_SLEEP_AT, rows: TAIL_SLEEP },
        { ...CURL_BODY_AT, rows: CURL_BODY },
        { ...CURL_MARKS_AT, rows: CURL_MARKS },
      ],
      front: [],
    };
  }
  if (spec.kind === 'stand') return standLayers(spec);
  if (spec.kind === 'hang') return hangLayers(spec);
  return jumpLayers(spec);
}

/** @param {CatSpec} spec */
function draw(spec) {
  const canvas = new Canvas(FRAME, FRAME, PALETTE);
  const dx = spec.dx ?? 0;
  const dy = spec.dy ?? 0;
  const head = headOrigin(spec);
  const layers = poseLayers(spec);
  /** @param {Art[]} parts */
  const moved = (parts) => parts.map((part) => shift(part, dx, dy));
  paintParts(canvas, moved(layers.behind), spec.kind === 'stand' ? 'far' : 'body');
  paintParts(canvas, moved(layers.body));
  paintParts(canvas, headParts(head.x, head.y, spec.ears ?? 'up'));
  paintFace(canvas, head.x, head.y, spec.mouth ?? false);
  paintCatEyes(
    canvas,
    head.x + EYE_LEFT_DX,
    head.x + EYE_RIGHT_DX,
    head.y + EYE_BOTTOM_DY,
    spec.eyes ?? 'open',
  );
  paintParts(canvas, moved(layers.front));
  if (spec.zAt) paintZ(canvas, spec.zAt[0], spec.zAt[1], PALETTE.light);
  return canvas;
}

/** @type {CatSpec} */
const base = { kind: 'sit' };
const baseHead = headOrigin(base);

/** @param {CatSpec} spec */
function bob(spec) {
  const head = headOrigin(spec);
  return { ...spec, bobX: head.x - baseHead.x, bobY: head.y - baseHead.y };
}

// Idle breathes: the head settles a pixel, the ears drop with it, the lids come halfway down and
// the tail tip flicks. The walk is carried by the legs: the body lifts one pixel on the two
// frames where a near paw is off the ground and sits back down on the contacts, and no more than
// that, because a torso bouncing to sell a walk is covering for legs that are not striding.
// Alert stands tall with the ears up and the tail straight.
/** @type {Record<string, CatSpec[]>} */
const FRAMES = {
  idle: [
    bob({ kind: 'sit' }),
    bob({ kind: 'sit', headDy: 1, ears: 'relaxed', eyes: 'half', tailFlick: true }),
  ],
  walk: [
    bob({ kind: 'stand', walk: 0, headDx: 1, tailDx: -1 }),
    bob({ kind: 'stand', walk: 1, dy: -1, tailDy: -1 }),
    bob({ kind: 'stand', walk: 2, headDx: 1, tailDx: 1 }),
    bob({ kind: 'stand', walk: 3, dy: -1, tailDy: -1, tailDx: 1, ears: 'relaxed' }),
  ],
  sit: [
    bob({ kind: 'sit', headDy: 1, ears: 'relaxed' }),
    bob({ kind: 'sit', headDy: 2, ears: 'relaxed', tailFlick: true }),
  ],
  sleep: [
    bob({ kind: 'curl', eyes: 'closed', ears: 'flat', zAt: [27, 12] }),
    bob({ kind: 'curl', eyes: 'closed', ears: 'flat', headDy: 1, zAt: [28, 9] }),
  ],
  alert: [
    bob({ kind: 'stand', tailUp: true }),
    bob({ kind: 'stand', headDy: -1, tailUp: true, tailDy: -1, tailDx: 1 }),
  ],
  drag: [
    bob({ kind: 'hang', step: 0, ears: 'flat', mouth: true }),
    bob({ kind: 'hang', step: 1, dx: 1, ears: 'flat', mouth: true, tailDx: 1 }),
  ],
  celebrate: [
    bob({ kind: 'sit', dy: 1, eyes: 'wide', mouth: true }),
    bob({ kind: 'jump', dy: -3, step: 0, eyes: 'wide', mouth: true }),
    bob({ kind: 'jump', dy: -1, step: 1, eyes: 'wide', mouth: true }),
  ],
};

/**
 * Clears the eye band of the idle head, then paints the mood's eyes on it. The band is the five
 * rows the widest eye can reach, all of them inside the head, so the clear never shows a seam.
 * @param {Expression} expression
 */
function drawExpression(expression) {
  const canvas = new Canvas(FRAME, FRAME, PALETTE);
  const leftX = baseHead.x + EYE_LEFT_DX;
  const rightX = baseHead.x + EYE_RIGHT_DX;
  const bottom = baseHead.y + EYE_BOTTOM_DY;
  for (let y = baseHead.y + EYE_TOP_DY; y <= bottom; y++) {
    for (let x = leftX; x <= rightX + 2; x++) canvas.set(x, y, PALETTE.body);
  }
  paintExpression(canvas, leftX, rightX, bottom, expression);
  return canvas;
}

// The tray is a portrait, not the whole animal: at 22 pixels a sitting cat loses its legs and
// its face at the same time, and the ears are what read at that size.
const TRAY_HEAD = [
  '.##############.',
  '.##############.',
  '################',
  '################',
  '################',
  '################',
  '################',
  '################',
  '.##############.',
  '..############..',
];
/** @type {Record<string, string[]>} */
const TRAY_EARS = {
  up: [
    '.##..........##.',
    '.###........###.',
    '.####......####.',
    '.#####....#####.',
    '.######..######.',
  ],
  flat: ['.####......####.', '.#####....#####.'],
};
const TRAY_EYE_LEFT_DX = 3;
const TRAY_EYE_RIGHT_DX = 10;

/**
 * @param {Expression} expression
 * @param {number} brightness
 * @param {number} saturation
 */
function drawTray(expression, brightness, saturation) {
  const tray = new Canvas(22, 22, tintPalette(PALETTE, brightness, saturation, TINT_SKIP));
  const ears = expression === 'low' ? TRAY_EARS.flat : TRAY_EARS.up;
  if (!ears) throw new Error('Missing tray ears.');
  const x = 3;
  const y = 8;
  paintParts(tray, [
    { x, y: y - ears.length, rows: ears },
    { x, y, rows: TRAY_HEAD },
  ]);
  const { palette } = tray;
  for (let dx = 7; dx <= 8; dx++) tray.set(x + dx, y + 7, palette.pink);
  paintExpression(tray, x + TRAY_EYE_LEFT_DX, x + TRAY_EYE_RIGHT_DX, y + 5, expression);
  return tray;
}

function drawIcon() {
  const first = FRAMES.idle?.[0];
  if (!first) throw new Error('Missing idle frame.');
  return draw(first);
}

/** @type {import('../mascot.mjs').Mascot<CatSpec>} */
// Measured off the drawn frames rather than assumed: every paw that is on the ground travels two
// pixels back against the body from one frame to the next (the near front paw sits at 26.5, 24.5
// and 22.5 across its three planted frames, and the other three legs match it a quarter cycle
// apart). A leg is planted for two of the four intervals, so the body has to cover two pixels a
// frame for those paws to stay still on the ground, which is eight pixels for the whole cycle.
const stridePx = 8;

export const cat = {
  id: 'cat',
  stridePx,
  frames: FRAMES,
  draw,
  drawExpression,
  drawTray,
  drawIcon,
};
