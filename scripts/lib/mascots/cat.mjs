// A small black cat with white socks and a white front. The silhouette is a whole animal, not a
// portrait: a head narrower than the body, a sloping back, four legs, and a tail that leaves the
// body rather than the head.
//
// Conventions borrowed from small sprite practice: ears are matched triangles grown out of the
// head outline with a notch between them, the sitting pose is a rounded triangle with the tail
// wrapped in front of the front paws, the walk is contact, passing, contact, passing with two
// pixels of leg travel and one pixel of body lift, and the paws take a lighter tone so the legs
// read against the body at this size.
//
// Frames are pixel maps rather than ellipses: `#` is fur, `l` a lighter patch, `-` a crease
// inside the silhouette. Each layer (legs behind the body, the body, the head, the tail) is one
// mask outlined in one pass, which is what makes a leg behind the body or a tail in front of the
// paws read as being there rather than merging into the mass.
import { Canvas, tintPalette } from '../canvas.mjs';
import { paintEyes, paintMask, paintZ } from '../parts.mjs';
import { FRAME } from '../sheet.mjs';

/** @typedef {import('../mascot.mjs').Expression} Expression */
/** @typedef {import('../mascot.mjs').FrameSpec} FrameSpec */
/** @typedef {{ x: number; y: number; rows: string[] }} Art a pixel map placed at x, y */

/** @type {Record<string, import('../canvas.mjs').Rgba>} */
const PALETTE = {
  outline: [13, 13, 17, 255],
  body: [52, 52, 62, 255],
  light: [226, 226, 233, 255],
  whisker: [138, 138, 150, 255],
  eye: [116, 214, 120, 255],
  white: [255, 255, 255, 255],
};
const TINT_SKIP = ['eye', 'white'];

// The head is the same ten by seven block in every pose, so the expression overlay lands on the
// eyes wherever the head goes: the eyes sit at (x + 3, y + 3) of the block and the widest pair
// fills exactly the block's interior.
const HEAD = [
  '.########.',
  '##########',
  '##########',
  '##########',
  '##########',
  '.########.',
  '..######..',
];
const EYE_DX = 3;
const EYE_DY = 3;

/** @type {Record<string, string[]>} */
const EARS = {
  up: ['.#......#.', '###....###', '####..####'],
  relaxed: ['##......##', '####..####'],
  flat: ['###....###'],
};

const SIT_BODY = [
  '.........#######..',
  '.......##########.',
  '......###########.',
  '.....########lll#.',
  '....#########lll#.',
  '...##########lll#.',
  '...##########lll#.',
  '..###########lll#.',
  '..##########-lll#.',
  '.###########-lll#.',
  '.##########-ll-ll.',
  '.##########-ll-ll.',
  '..###############.',
];
const SIT_BODY_AT = { x: 6, y: 13 };

const TAIL_CURL = [
  '...............##.',
  '................##',
  '................##',
  '...............##.',
  '.###############..',
  '..##############..',
];
const TAIL_CURL_AT = { x: 8, y: 21 };

const STAND_BODY = [
  '..............####.',
  '.............#####.',
  '....###############',
  '.##################',
  '.##################',
  '.##################',
  '..################.',
  '...##############..',
];
const STAND_BODY_AT = { x: 4, y: 12 };

const TAIL_UP = [
  '.##....',
  '##.....',
  '##.....',
  '##.....',
  '.##....',
  '..##...',
  '...##..',
  '....##.',
  '.....##',
];
const TAIL_UP_AT = { x: 1, y: 7 };

const TAIL_STRAIGHT = Array.from({ length: 10 }, () => '##');
const TAIL_STRAIGHT_AT = { x: 4, y: 6 };

const CURL_BODY = [
  '...#######..........',
  '.############.......',
  '#################...',
  '###################.',
  '####################',
  '####################',
  '####################',
  '####################',
  '.##################.',
  '...##############...',
];
const CURL_BODY_AT = { x: 5, y: 16 };

const TAIL_SLEEP = ['.............######', '###############....', '.##############....'];
const TAIL_SLEEP_AT = { x: 8, y: 24 };

const HANG_BODY = [
  '...#####..',
  '..#######.',
  '.#########',
  '.#########',
  '.#########',
  '..#######.',
  '..#######.',
  '..#######.',
  '...#####..',
  '...#####..',
];
const HANG_BODY_AT = { x: 11, y: 13 };

const TAIL_HANG = ['..##', '.##.', '##..', '##..', '.##.'];
const TAIL_HANG_AT = { x: 10, y: 22 };

const JUMP_BODY = [
  '....########..',
  '..###########.',
  '.#############',
  '.#############',
  '.#############',
  '..###########.',
  '...#########..',
  '....#######...',
];
const JUMP_BODY_AT = { x: 9, y: 14 };

const TAIL_JUMP = ['##....', '##....', '.##...', '..##..', '...##.', '....##'];
const TAIL_JUMP_AT = { x: 5, y: 11 };

// Both front legs thrown up and out, one either side of the head, with the paws on top.
const ARM_LEFT = ['lll..', '.###.', '..###'];
const ARM_LEFT_AT = { x: 7, y: 11 };
const ARM_RIGHT = ['..lll', '.###.', '###..'];
const ARM_RIGHT_AT = { x: 20, y: 11 };

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

/**
 * The `l` and `-` cells, painted after the outline pass so they sit inside the silhouette.
 * @param {Canvas} canvas
 * @param {Art} art
 */
function paintDetail(canvas, art) {
  const { palette } = canvas;
  art.rows.forEach((row, dy) => {
    for (let dx = 0; dx < row.length; dx++) {
      const cell = row[dx];
      if (cell === 'l') canvas.set(art.x + dx, art.y + dy, palette.light);
      else if (cell === '-') canvas.set(art.x + dx, art.y + dy, palette.outline);
    }
  });
}

/**
 * One layer: the parts share a mask, so they share one outline. Later layers paint over earlier
 * ones, which is how a leg reads as being behind the body and a tail as being in front of it.
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
 * A leg. Near legs are three pixels wide with a light paw, far legs two and dark, which is the
 * cheapest way to say which pair is closer.
 * @param {number} x
 * @param {number} top
 * @param {number} bottom paw row
 * @param {'near' | 'far' | 'raised'} kind
 * @returns {Art}
 */
function legArt(x, top, bottom, kind) {
  const shaft = kind === 'far' ? '##' : '###';
  const paw = kind === 'far' ? '##' : 'lll';
  /** @type {string[]} */
  const rows = [];
  for (let y = top; y <= bottom; y++) rows.push(shaft);
  rows[kind === 'raised' ? 0 : rows.length - 1] = paw;
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
 * Muzzle, nose and whiskers. The eyes are painted by the caller, since the expression overlay
 * repaints them from a frame of its own.
 * @param {Canvas} canvas
 * @param {number} hx
 * @param {number} hy
 */
function paintFace(canvas, hx, hy) {
  const { palette } = canvas;
  for (let dx = 3; dx <= 6; dx++) canvas.set(hx + dx, hy + 5, palette.light);
  for (let dx = 4; dx <= 5; dx++) canvas.set(hx + dx, hy + 6, palette.light);
  canvas.set(hx + 4, hy + 5, palette.outline);
  canvas.set(hx + 5, hy + 5, palette.outline);
  canvas.set(hx - 2, hy + 4, palette.whisker);
  canvas.set(hx - 1, hy + 5, palette.whisker);
  canvas.set(hx + 11, hy + 4, palette.whisker);
  canvas.set(hx + 10, hy + 5, palette.whisker);
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
 *   headDy?: number,
 *   ears?: 'up' | 'relaxed' | 'flat',
 *   eyes?: 'open' | 'wide' | 'half' | 'closed' | 'happy',
 *   step?: number,
 *   tailUp?: boolean,
 *   zAt?: [number, number],
 * }} CatSpec
 */

/** @type {Record<string, [number, number]>} */
const HEAD_AT = {
  sit: [15, 7],
  stand: [17, 6],
  curl: [18, 17],
  hang: [11, 6],
  jump: [11, 7],
};

/** @param {CatSpec} spec */
function headOrigin(spec) {
  const at = HEAD_AT[spec.kind];
  if (!at) throw new Error(`Unknown pose kind ${spec.kind}.`);
  return { x: at[0] + (spec.dx ?? 0), y: at[1] + (spec.dy ?? 0) + (spec.headDy ?? 0) };
}

// Contact, passing, contact, passing: the near pair swings one way and the far pair the other,
// and a passing frame lifts the far paw a pixel off the ground. The last entry is not part of
// the cycle: it is the planted stance the alert pose stands in.
/** @type {{ near: number; far: number; lift: number }[]} */
const LEG_STEPS = [
  { near: 2, far: -2, lift: 0 },
  { near: 0, far: 0, lift: 1 },
  { near: -2, far: 2, lift: 0 },
  { near: 0, far: 0, lift: 1 },
  { near: 1, far: -2, lift: 0 },
];

const GROUND = 26;

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
  const top = 17;
  // The whole frame is moved by dy later, so the legs grow by that much instead: a body that
  // lifts a pixel must not take its planted paws with it.
  const dy = spec.dy ?? 0;
  const near = GROUND - dy;
  const far = near - step.lift;
  return {
    behind: [legArt(14 + step.far, top, far, 'far'), legArt(5 + step.far, top, far, 'far')],
    body: [
      { ...STAND_BODY_AT, rows: STAND_BODY },
      legArt(17 + step.near, top, near, 'near'),
      legArt(8 + step.near, top, near, 'near'),
    ],
    front: [
      spec.tailUp ? { ...TAIL_STRAIGHT_AT, rows: TAIL_STRAIGHT } : { ...TAIL_UP_AT, rows: TAIL_UP },
    ],
  };
}

/**
 * @param {CatSpec} spec
 * @returns {Layers}
 */
function hangLayers(spec) {
  const swing = spec.step ?? 0;
  return {
    behind: [legArt(9 + swing, 16, 21, 'far'), legArt(13 - swing, 22, 25, 'far')],
    body: [
      { ...HANG_BODY_AT, rows: HANG_BODY },
      legArt(20 - swing, 16, 22, 'near'),
      legArt(16 + swing, 22, 26, 'near'),
    ],
    front: [{ ...TAIL_HANG_AT, rows: TAIL_HANG }],
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
      legArt(12, 20, 22, 'far'),
      legArt(16, 20, 22, 'near'),
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
    return {
      behind: [],
      body: [{ ...SIT_BODY_AT, rows: SIT_BODY }],
      front: [{ ...TAIL_CURL_AT, rows: TAIL_CURL }],
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
  if (spec.zAt) paintZ(canvas, spec.zAt[0], spec.zAt[1], PALETTE.whisker);
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
  idle: [bob({ kind: 'sit' }), bob({ kind: 'sit', headDy: 1, ears: 'relaxed' })],
  walk: [
    bob({ kind: 'stand', step: 0 }),
    bob({ kind: 'stand', step: 1, dy: -1 }),
    bob({ kind: 'stand', step: 2 }),
    bob({ kind: 'stand', step: 3, dy: -1 }),
  ],
  sit: [
    bob({ kind: 'sit', dy: 1, headDy: 1, ears: 'relaxed' }),
    bob({ kind: 'sit', dy: 1, headDy: 2, ears: 'relaxed' }),
  ],
  sleep: [
    bob({ kind: 'curl', eyes: 'closed', ears: 'flat', zAt: [25, 9] }),
    bob({ kind: 'curl', eyes: 'closed', ears: 'flat', headDy: 1, zAt: [26, 6] }),
  ],
  alert: [
    bob({ kind: 'stand', step: 4, tailUp: true }),
    bob({ kind: 'stand', step: 4, headDy: -1, tailUp: true }),
  ],
  drag: [
    bob({ kind: 'hang', step: 0, ears: 'relaxed' }),
    bob({ kind: 'hang', step: 1, dx: 1, ears: 'relaxed' }),
  ],
  celebrate: [
    bob({ kind: 'sit', dy: 2, eyes: 'happy' }),
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
  '.##############.',
  '.##############.',
  '################',
  '################',
  '################',
  '################',
  '################',
  '.##############.',
  '..############..',
  '....########....',
];
/** @type {Record<string, string[]>} */
const TRAY_EARS = {
  up: ['..##........##..', '.####......####.', '.#####....#####.'],
  flat: ['.###........###.', '.#####....#####.'],
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
  for (let dx = 6; dx <= 9; dx++) tray.set(x + dx, y + 6, palette.light);
  for (let dx = 7; dx <= 8; dx++) {
    tray.set(x + dx, y + 5, palette.outline);
    tray.set(x + dx, y + 7, palette.light);
  }
  for (const [wx, wy] of [
    [x - 2, y + 5],
    [x - 1, y + 6],
    [x + 17, y + 5],
    [x + 16, y + 6],
  ]) {
    tray.set(wx ?? 0, wy ?? 0, palette.whisker);
  }
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
