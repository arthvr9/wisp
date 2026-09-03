// A chunky black and white mascot cat. The proportions are the ones that make a small animal
// read as cute at 32 pixels: a head almost as tall as the torso, a compact rounded body with a
// white chest, short thick legs with socks, and a tail that is five pixels thick where it
// leaves the rump.
//
// Conventions borrowed from small sprite practice: the head is a rounded block with the eyes low
// in it and a light muzzle under them, the ears are matched triangles with a pink inside, the
// sitting pose is a wedge with a heavy haunch, and the walk is contact, passing, contact,
// passing with the body dropping on contact and lifting on the pass.
//
// Frames are pixel maps: `#` is fur, `l` a light patch, `s` a shaded one, `p` the pink of an ear
// or a nose, `-` a crease inside the silhouette. Each layer (far legs behind the body, the body
// with its tail and near legs, the head, whatever wraps in front) is one mask outlined in one
// pass. The tail of a standing cat belongs to the body layer on purpose: sharing the rump
// outline is what stops it from reading as a fifth limb.
//
// There are no whiskers. Two or three grey pixels beside a dark head at this size read as dirt
// on the screen, so the ears, the pink nose and the muzzle carry the cat instead.
import { Canvas, tintPalette } from '../canvas.mjs';
import { paintEyes, paintMask, paintZ } from '../parts.mjs';
import { FRAME } from '../sheet.mjs';

/** @typedef {import('../mascot.mjs').Expression} Expression */
/** @typedef {import('../mascot.mjs').FrameSpec} FrameSpec */
/** @typedef {{ x: number; y: number; rows: string[] }} Art a pixel map placed at x, y */

/** @type {Record<string, import('../canvas.mjs').Rgba>} */
const PALETTE = {
  outline: [16, 16, 22, 255],
  body: [58, 58, 70, 255],
  shade: [36, 36, 46, 255],
  light: [234, 234, 240, 255],
  pink: [226, 146, 158, 255],
  eye: [124, 220, 128, 255],
  white: [255, 255, 255, 255],
};
const TINT_SKIP = ['eye', 'white'];

// The head is the same twelve by ten block in every pose, so the expression overlay lands on the
// eyes wherever the head goes: the eyes sit at (x + 4, y + 5) of the block and the widest pair
// fills columns 2 to 9 of rows 4 to 6, which are full width rows.
const HEAD = [
  '..########..',
  '.##########.',
  '############',
  '############',
  '############',
  '############',
  '############',
  '.##########.',
  '.##########.',
  '..########..',
];
const EYE_DX = 4;
const EYE_DY = 5;

/** @type {Record<string, string[]>} */
const EARS = {
  up: ['.###....###.', '.#pp#..#pp#.', '.#pp#..#pp#.'],
  relaxed: ['.###....###.', '.#pp#..#pp#.'],
  flat: ['.####..####.'],
};

const GROUND = 28;

// Standing. Twenty two wide and eleven tall, with the back running level out of the tail and up
// into the head, so the head sits on a shoulder rather than on a plank.
const STAND_BODY = [
  '.....############.....',
  '...##################.',
  '..###################.',
  '.####################.',
  '######################',
  '######################',
  '######################',
  '######################',
  '.####################.',
  '..##################..',
  '...################...',
];
const STAND_BODY_AT = { x: 4, y: 14 };

// One shaded row along the underside, so a body eleven pixels tall reads as round, not flat.
const STAND_SHADE = ['ssssssssssssssss'];
const STAND_SHADE_AT = { x: 7, y: 23 };

// The white chest, low and forward, between the front legs and under the chin.
const STAND_MARKS = ['.ll.', '.lll', '.lll', '.lll', '.lll', '.ll.', '.l..'];
const STAND_MARKS_AT = { x: 21, y: 17 };

// Three pixels at the hooked tip, five where it merges into the rump, and three rows of overlap
// with the back so the base is unmistakably part of the animal.
const TAIL_UP = [
  '...####..',
  '..###....',
  '..###....',
  '..###....',
  '..###....',
  '..####...',
  '..####...',
  '...####..',
  '...#####.',
  '....#####',
  '....#####',
  '.....####',
];
const TAIL_UP_AT = { x: 0, y: 4 };

// The alert tail: up, but still tapered and still hooked at the tip, because a constant width
// column reads as a plank rather than as an animal.
const TAIL_STRAIGHT = [
  '...##..',
  '..###..',
  '.####..',
  '.####..',
  '.####..',
  '.####..',
  '.####..',
  '.####..',
  '.####..',
  '#####..',
  '#####..',
  '#####..',
  '#####..',
  '.#####.',
  '..#####',
];
const TAIL_STRAIGHT_AT = { x: 2, y: 2 };

// Sitting: a wedge with a vertical chest at the front and the back curving down to a heavy
// rump, steep at the shoulder and flattening at the base, which is the shape a cat actually
// makes. A straight forty five degree back reads as a doorstop.
const SIT_BODY = [
  '............#########.',
  '..........###########.',
  '........#############.',
  '.......##############.',
  '......###############.',
  '.....################.',
  '....#################.',
  '...##################.',
  '...##################.',
  '..###################.',
  '.####################.',
  '.####################.',
  '#####################.',
  '#####################.',
  '#####################.',
  '.###################..',
];
const SIT_BODY_AT = { x: 6, y: 13 };

// The chest bib, the crease that separates the front legs from the haunch, and the two paws
// they stand on, which have to sit on the bottom two rows or they read as knees.
const SIT_MARKS = [
  '.....llll',
  '....lllll',
  '....lllll',
  '....lllll',
  '.....llll',
  '.....llll',
  '.....llll',
  '..-..llll',
  '..-..llll',
  '..-..llll',
  '..-..llll',
  '..lll-lll',
  '..lll-lll',
];
const SIT_MARKS_AT = { x: 17, y: 15 };

// The tail comes around the near side as a comma: five pixels where it leaves the rump, then a
// diagonal down to the ground rather than a right angle, then a sweep that lifts at the tip. It
// stops well short of the front paws, so nothing about it can be read as a leg.
const TAIL_SIT = [
  '..#####......',
  '.#####.......',
  '#####.....###',
  '#####....####',
  '######..#####',
  '#############',
  '.###########.',
];
const TAIL_SIT_FLICK = [
  '..#####...###',
  '.#####...####',
  '#####....####',
  '#####....####',
  '######..#####',
  '#############',
  '.###########.',
];
const TAIL_SIT_AT = { x: 4, y: 22 };

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

const TAIL_SLEEP = [
  '.###......',
  '####......',
  '####......',
  '.#####....',
  '..########',
  '..########',
  '...######.',
];
const TAIL_SLEEP_AT = { x: 0, y: 21 };

// Held up by the scruff: a short hanging body with the legs dangling clear of it, rather than
// legs drawn inside a long body where nothing of them shows.
const HANG_BODY = [
  '...########...',
  '.############.',
  '##############',
  '##############',
  '##############',
  '##############',
  '.############.',
  '..##########..',
  '...########...',
];
const HANG_BODY_AT = { x: 11, y: 13 };

const HANG_MARKS = ['..llll..', '.llllll.', '.llllll.', '..llll..', '..llll..', '...ll...'];
const HANG_MARKS_AT = { x: 14, y: 15 };

// It leaves the flank sideways before it drops, and it is four or five pixels thick all the way
// down. A three pixel tail hanging beside a dangling leg is the one shape that must not happen.
const TAIL_HANG = [
  '........###',
  '.....######',
  '...#######.',
  '..#####....',
  '.#####.....',
  '.####......',
  '.####......',
  '..####.....',
  '..####.....',
  '...###.....',
];
const TAIL_HANG_AT = { x: 3, y: 15 };

// Mid hop: a shorter, rounder body with the hind legs tucked and both front paws thrown up.
const JUMP_BODY = [
  '...########...',
  '.############.',
  '##############',
  '##############',
  '##############',
  '##############',
  '.############.',
  '..##########..',
  '...########...',
];
const JUMP_BODY_AT = { x: 9, y: 15 };

const JUMP_MARKS = ['..llll..', '.llllll.', '.llllll.', '..llll..'];
const JUMP_MARKS_AT = { x: 12, y: 17 };

const TAIL_JUMP = [
  '.###......',
  '###.......',
  '###.......',
  '.####.....',
  '..#####...',
  '....######',
];
const TAIL_JUMP_AT = { x: 2, y: 15 };

// Both front legs thrown up and out, one either side of the head, paws on top.
const ARM_LEFT = ['#ll#.', '####.', '.###.', '..###'];
const ARM_LEFT_AT = { x: 5, y: 10 };
const ARM_RIGHT = ['.#ll#', '.####', '.###.', '###..'];
const ARM_RIGHT_AT = { x: 22, y: 10 };

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
const DETAIL = { l: 'light', s: 'shade', p: 'pink', '-': 'outline' };

/**
 * The `l`, `s`, `p` and `-` cells, painted after the outline pass so they sit inside the
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
 */
function paintParts(canvas, parts) {
  if (parts.length === 0) return;
  const mask = new Uint8Array(canvas.width * canvas.height);
  for (const part of parts) stamp(mask, part, canvas.width, canvas.height);
  paintMask(canvas, mask, canvas.palette.body, canvas.palette.outline);
  for (const part of parts) paintDetail(canvas, part);
}

/**
 * A leg. Near legs are four pixels wide and get a white sock one row above the paw, far legs are
 * three and stay dark, which is the cheapest way to say which pair is closer.
 * @param {number} x
 * @param {number} top
 * @param {number} bottom paw row
 * @param {'near' | 'far'} kind
 * @returns {Art}
 */
function legArt(x, top, bottom, kind) {
  const near = kind === 'near';
  /** @type {string[]} */
  const rows = [];
  for (let y = top; y <= bottom; y++) rows.push(near ? '####' : '#s#');
  if (near && rows.length >= 2) rows[rows.length - 2] = '#ll#';
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
 * A pink nose with a four pixel light muzzle under it. The eyes are painted by the caller, since
 * the expression overlay repaints them from a frame of its own.
 * @param {Canvas} canvas
 * @param {number} hx
 * @param {number} hy
 */
function paintFace(canvas, hx, hy) {
  const { palette } = canvas;
  for (let dx = 4; dx <= 7; dx++) canvas.set(hx + dx, hy + 8, palette.light);
  canvas.set(hx + 5, hy + 7, palette.pink);
  canvas.set(hx + 6, hy + 7, palette.pink);
}

/**
 * @param {Canvas} canvas
 * @param {number} cx
 * @param {number} cy
 * @param {Expression} expression
 */
function paintExpression(canvas, cx, cy, expression) {
  const { palette } = canvas;
  const style = expression === 'bright' ? 'wide' : expression === 'low' ? 'half' : 'open';
  paintEyes(canvas, cx, cy, style, palette.eye, palette.white);
}

/**
 * @typedef {FrameSpec & {
 *   kind: 'sit' | 'stand' | 'curl' | 'hang' | 'jump',
 *   dx?: number,
 *   dy?: number,
 *   headDx?: number,
 *   headDy?: number,
 *   ears?: 'up' | 'relaxed' | 'flat',
 *   eyes?: 'open' | 'wide' | 'half' | 'closed' | 'happy',
 *   step?: number,
 *   tailUp?: boolean,
 *   tailFlick?: boolean,
 *   tailDy?: number,
 *   zAt?: [number, number],
 * }} CatSpec
 */

/** @type {Record<string, [number, number]>} */
const HEAD_AT = {
  sit: [16, 5],
  stand: [18, 7],
  curl: [15, 18],
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

// Contact, passing, contact, passing. The near front and near hind swing against each other,
// which is the diagonal a cat actually walks; the far pair stays planted and only lifts a pixel
// on the passing frames, because four legs crossing on a twenty two pixel body turns into one
// blob. The last entry is not part of the cycle: it is the stance the alert pose stands in.
/** @type {{ hind: number; front: number; lift: number }[]} */
const LEG_STEPS = [
  { hind: 2, front: -2, lift: 0 },
  { hind: 0, front: 0, lift: 1 },
  { hind: -2, front: 2, lift: 0 },
  { hind: 0, front: 0, lift: 1 },
  { hind: 0, front: 1, lift: 0 },
];

/**
 * @typedef {{ behind: Art[]; body: Art[]; front: Art[] }} Layers
 */

/**
 * @param {CatSpec} spec
 * @returns {Layers}
 */
function standLayers(spec) {
  const step = LEG_STEPS[spec.step ?? 1];
  if (!step) throw new Error(`Unknown leg step ${String(spec.step)}.`);
  const top = 21;
  // The whole frame is moved by dy later, so the legs grow by that much instead: a body that
  // lifts a pixel must not take its planted paws with it.
  const dy = spec.dy ?? 0;
  const near = GROUND - dy;
  const far = near - step.lift;
  const tail = spec.tailUp
    ? { ...TAIL_STRAIGHT_AT, rows: TAIL_STRAIGHT }
    : { ...TAIL_UP_AT, rows: TAIL_UP };
  return {
    behind: [legArt(15, top, far, 'far'), legArt(4, top, far, 'far')],
    body: [
      { ...STAND_BODY_AT, rows: STAND_BODY },
      { ...STAND_SHADE_AT, rows: STAND_SHADE },
      shift(tail, 0, spec.tailDy ?? 0),
      legArt(19 + step.front, top, near, 'near'),
      legArt(8 + step.hind, top, near, 'near'),
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
    behind: [legArt(13 - swing, 17, 24, 'far')],
    body: [
      { ...HANG_BODY_AT, rows: HANG_BODY },
      { ...TAIL_HANG_AT, rows: TAIL_HANG },
      legArt(15 + swing, 17, 26, 'near'),
      legArt(20 + swing, 17, 25, 'near'),
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
      legArt(11, 20, 26, 'far'),
      legArt(17, 20, 26, 'near'),
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
        { ...SIT_BODY_AT, rows: SIT_BODY },
        { ...SIT_MARKS_AT, rows: SIT_MARKS },
      ],
      front: [shift(tail, 0, spec.tailDy ?? 0)],
    };
  }
  if (spec.kind === 'curl') {
    return {
      behind: [],
      body: [{ ...CURL_BODY_AT, rows: CURL_BODY }],
      front: [{ ...TAIL_SLEEP_AT, rows: TAIL_SLEEP }],
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
  paintParts(canvas, moved(layers.behind));
  paintParts(canvas, moved(layers.body));
  paintParts(canvas, headParts(head.x, head.y, spec.ears ?? 'up'));
  paintFace(canvas, head.x, head.y);
  paintEyes(
    canvas,
    head.x + EYE_DX,
    head.y + EYE_DY,
    spec.eyes ?? 'open',
    PALETTE.eye,
    PALETTE.white,
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

/** @type {Record<string, CatSpec[]>} */
const FRAMES = {
  idle: [bob({ kind: 'sit' }), bob({ kind: 'sit', headDy: 1, ears: 'relaxed', tailFlick: true })],
  walk: [
    bob({ kind: 'stand', step: 0, dy: 1, headDx: 1 }),
    bob({ kind: 'stand', step: 1, dy: -1, headDy: -1, tailDy: -1 }),
    bob({ kind: 'stand', step: 2, dy: 1, headDx: 1 }),
    bob({ kind: 'stand', step: 3, dy: -1, headDy: -1, tailDy: -1 }),
  ],
  sit: [
    bob({ kind: 'sit', headDy: 1, ears: 'relaxed' }),
    bob({ kind: 'sit', headDy: 2, ears: 'relaxed', tailDy: -1 }),
  ],
  sleep: [
    bob({ kind: 'curl', eyes: 'closed', ears: 'relaxed', zAt: [27, 12] }),
    bob({ kind: 'curl', eyes: 'closed', ears: 'relaxed', headDy: 1, zAt: [28, 9] }),
  ],
  alert: [
    bob({ kind: 'stand', step: 4, tailUp: true }),
    bob({ kind: 'stand', step: 4, headDy: -1, tailUp: true, tailDy: -1 }),
  ],
  drag: [
    bob({ kind: 'hang', step: 0, ears: 'relaxed' }),
    bob({ kind: 'hang', step: 1, dx: 1, ears: 'relaxed' }),
  ],
  celebrate: [
    bob({ kind: 'sit', dy: 1, eyes: 'happy' }),
    bob({ kind: 'jump', dy: -3, step: 0, eyes: 'happy' }),
    bob({ kind: 'jump', dy: -1, step: 1, eyes: 'happy' }),
  ],
};

/**
 * @param {Expression} expression
 */
function drawExpression(expression) {
  const canvas = new Canvas(FRAME, FRAME, PALETTE);
  const cx = baseHead.x + EYE_DX;
  const cy = baseHead.y + EYE_DY;
  for (let y = cy - 1; y <= cy + 1; y++) {
    for (let x = cx - 2; x <= cx + 5; x++) canvas.set(x, y, PALETTE.body);
  }
  paintExpression(canvas, cx, cy, expression);
  return canvas;
}

// The tray is a portrait, not the whole animal: at 22 pixels a sitting cat loses its legs and
// its face at the same time, and the ears are what read at that size.
const TRAY_HEAD = [
  '..############..',
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
  up: ['..##........##..', '.#pp#......#pp#.', '.#ppp#....#ppp#.'],
  flat: ['.####......####.', '.#ppp#....#ppp#.'],
};

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
  for (let dx = 5; dx <= 10; dx++) tray.set(x + dx, y + 7, palette.light);
  for (let dx = 7; dx <= 8; dx++) tray.set(x + dx, y + 6, palette.pink);
  paintExpression(tray, x + 5, y + 4, expression);
  return tray;
}

function drawIcon() {
  const first = FRAMES.idle?.[0];
  if (!first) throw new Error('Missing idle frame.');
  return draw(first);
}

/** @type {import('../mascot.mjs').Mascot<CatSpec>} */
export const cat = { id: 'cat', frames: FRAMES, draw, drawExpression, drawTray, drawIcon };
