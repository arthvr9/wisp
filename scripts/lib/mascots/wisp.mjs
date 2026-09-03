// The namesake: a will-o'-the-wisp, a small ball of purple light that hovers a little off the
// ground with a flame growing out of the top of it.
//
// The old placeholder read as a grape, and it is worth writing down why, because the fixes are
// all reactions to it:
//   - the flame was one pixel wide and leaned to one side, which is a stalk. A flame leaves what
//     is burning on a neck, swells above it, curls to one side and ends in a single bright
//     pixel. This one is five across at the neck, seven at its widest, and it is drawn into the
//     same mask as the body so the two share one outline: a flame with its own outline around
//     the base sits on the head like a hat.
//   - the body was one flat purple with a two pixel highlight, which is a solid object. A wisp is
//     a light source, so the light has to come from inside: a pale patch under the flame, a
//     darker band along the underside where no light reaches, and a faint halo outside the
//     silhouette. The halo and the mark on the floor are the only things drawn with alpha, which
//     is what lets them read over a wallpaper of any tone.
//   - the eyes were four flat dots. Pupils are what the cat gained in review and what turned it
//     from a shape into an animal, so these are pale eyes with a dark pupil and one white glint.
//   - the two dark pixels under the body read as the base of a fruit. It floats now: nothing
//     touches the ground but a soft mark that shrinks as it rises.
//
// Two constraints the geometry is built around, both from the renderer:
//   - the expression overlay repaints a band across the eyes on every pose but sleep and
//     celebrate, so every pose has to keep that band the same flat body colour and the same
//     distance from the body centre. `RY_TOP` is therefore the same in every frame and only the
//     width and the underside change; squashing the top would move the eyes into the core glow.
//   - the overlay is one still frame per mood, chosen by mood and not by time, so there is no
//     frame of it to blink on. The idle spends its life on the flame, the hover and the embers
//     instead, which are all outside the band.
import { Canvas, tintPalette } from '../canvas.mjs';
import { paintMask, paintZ } from '../parts.mjs';
import { FRAME } from '../sheet.mjs';

/** @typedef {import('../mascot.mjs').Expression} Expression */
/** @typedef {import('../mascot.mjs').FrameSpec} FrameSpec */
/** @typedef {'open' | 'wide' | 'half' | 'closed' | 'happy'} EyeStyle */
/** @typedef {'smile' | 'soft' | 'frown'} MouthStyle */

/** @type {Record<string, import('../canvas.mjs').Rgba>} */
const PALETTE = {
  outline: [58, 24, 108, 255],
  // The underside, where the flame above does not reach.
  deep: [92, 40, 176, 255],
  body: [130, 66, 240, 255],
  light: [172, 132, 252, 255],
  core: [234, 226, 255, 255],
  eye: [36, 24, 72, 255],
  white: [255, 255, 255, 255],
  // The only two colours with alpha: a halo just outside the flame and the mark on the ground.
  // Over a pale wallpaper they read as a faint violet tint, over a dark one as light.
  halo: [176, 140, 255, 74],
  ground: [72, 36, 132, 78],
};
const TINT_SKIP = ['eye', 'white'];

const CX = 15;
const CY = 20;
// Fixed in every pose: the eye band, the core glow and the mouth are all measured off the body
// centre, and a shorter dome would push the band up into the glow.
const RY_TOP = 8;
const GROUND = 28;

// The eye band the expression overlay clears, as offsets from the body centre. Eyes are four
// wide with three pixels of body between them, and the band keeps a pixel of margin around them.
const EYE_W = 4;
const EYE_LEFT_DX = -5;
const EYE_RIGHT_DX = 2;
const EYE_TOP_DY = -4;
const EYE_BOTTOM_DY = 0;
const BAND_DX = 6;
const MOUTH_DY = 3;

/**
 * The body silhouette. The crown is deliberately flatter than a circle (the cube on `nx` is what
 * does it) so the flame has a pair of shoulders to stand on: on a true circle the dome comes to
 * a point, the flame carries on from that point, and the two of them read as one onion.
 * @param {number} cx
 * @param {number} cy
 * @param {number} halfW
 * @param {number} ryBot
 * @param {number} width
 * @param {number} height
 */
function bodyMask(cx, cy, halfW, ryBot, width, height) {
  const mask = new Uint8Array(width * height);
  for (let dx = -halfW; dx <= halfW; dx++) {
    const nx = Math.abs(dx) / (halfW + 0.5);
    const top = cy - Math.round(RY_TOP * Math.sqrt(Math.max(0, 1 - nx * nx * nx)));
    const bottom = cy + Math.round(ryBot * Math.sqrt(Math.max(0, 1 - nx * nx)));
    for (let y = top; y <= bottom; y++) {
      const x = cx + dx;
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      mask[y * width + x] = 1;
    }
  }
  return mask;
}

// A flame is not a cone. It leaves the body on a narrow neck, swells to its widest a third of
// the way up and only then tapers to a single bright pixel. The neck is the important part: the
// first pass put the widest rows at the base, where the body hides them, and what was left above
// the head was a monotonic taper, which is a horn.
const FLAME_PROFILE = [
  { upTo: 0.12, halfWidth: 2 },
  { upTo: 0.5, halfWidth: 3 },
  { upTo: 0.72, halfWidth: 2 },
  { upTo: 0.9, halfWidth: 1 },
];

/**
 * One row of the flame, as the columns it covers. Three things shape it and all three matter:
 *   - the profile above, capped at a proportion of the height so a short flame stays slim.
 *     Without the cap a four pixel ember comes out nine across.
 *   - `lean`, where the tip ends up, on a square curve so the base stays planted and only the
 *     top travels, and `sway`, which bows the middle the other way into an S.
 *   - the lick: one extra pixel on the leaning side, over the rows just above the widest part.
 *     A flame that is the same width either side of its centre line is a droplet, whatever else
 *     is done to it, and a droplet with a face on the body below reads as a bulb.
 * @param {number} i
 * @param {number} height
 * @param {number} lean
 * @param {number} sway
 */
function flameRow(i, height, lean, sway) {
  const f = height > 1 ? i / (height - 1) : 1;
  const shape = FLAME_PROFILE.find((step) => f <= step.upTo)?.halfWidth ?? 0;
  const half = Math.min(shape, Math.max(1, Math.round(height / 3.5)));
  const centre = Math.round(lean * f * f) + Math.round(sway * Math.sin(f * Math.PI));
  const lick = half > 0 && f > 0.3 && f < 0.62 ? 1 : 0;
  const side = lean < 0 ? -1 : 1;
  return {
    centre,
    left: half + (side < 0 ? lick : 0),
    right: half + (side > 0 ? lick : 0),
  };
}

/**
 * @param {number} cx
 * @param {number} baseY
 * @param {number} height
 * @param {number} lean
 * @param {number} sway
 * @param {number} width
 * @param {number} imageHeight
 */
function flameMask(cx, baseY, height, lean, sway, width, imageHeight) {
  const mask = new Uint8Array(width * imageHeight);
  for (let i = 0; i < height; i++) {
    const y = baseY - i;
    const row = flameRow(i, height, lean, sway);
    const c = cx + row.centre;
    for (let dx = -row.left; dx <= row.right; dx++) {
      const x = c + dx;
      if (x < 0 || y < 0 || x >= width || y >= imageHeight) continue;
      mask[y * width + x] = 1;
    }
  }
  return mask;
}

/**
 * Repaints a pixel only if it is still the flat body colour, so shading never eats the outline
 * the mask pass drew.
 * @param {Canvas} canvas
 * @param {number} x
 * @param {number} y
 * @param {import('../canvas.mjs').Rgba} color
 */
function shade(canvas, x, y, color) {
  const [r, g, b] = canvas.get(x, y);
  const body = canvas.palette.body ?? [];
  if (r !== body[0] || g !== body[1] || b !== body[2]) return;
  canvas.set(x, y, color);
}

/**
 * The flame is painted as a heat ramp rather than as an outlined shape: purple at the rim,
 * lilac inside that, near white in the middle. Given the hard dark outline the rest of the
 * silhouette gets, the top of a flame three pixels wide comes out as two outline pixels around
 * one, which reads as a dark thread and not as fire. Only the rows above the body are repainted;
 * below that the flame is inside the head and the body's own shading owns those pixels.
 * @param {Canvas} canvas
 * @param {Uint8Array} solid the body mask, whose pixels the flame does not repaint
 * @param {number} cx
 * @param {number} baseY
 * @param {number} height
 * @param {number} lean
 * @param {number} sway
 */
function shadeFlame(canvas, solid, cx, baseY, height, lean, sway) {
  const { palette, width } = canvas;
  for (let i = 0; i < height; i++) {
    const y = baseY - i;
    const row = flameRow(i, height, lean, sway);
    const c = cx + row.centre;
    // The rim runs dark at the base, mid purple through the body of the flame and lilac over the
    // last rows, so the shape keeps a defined edge against a pale wallpaper down where it is
    // wide, and burns out at the tip.
    const rim =
      i >= height - 2 ? palette.light : i >= height * 0.55 ? palette.deep : palette.outline;
    for (let dx = -row.left; dx <= row.right; dx++) {
      const x = c + dx;
      if (x < 0 || y < 0 || x >= width || y >= canvas.height) continue;
      if (solid[y * width + x] === 1) continue;
      const depth = Math.min(row.left + dx, row.right - dx);
      const color = depth >= 2 ? palette.core : depth === 1 ? palette.light : rim;
      canvas.set(x, y, row.left + row.right === 0 ? palette.core : color);
    }
  }
}

/**
 * The light inside the body: a small pale core right under the flame, and a darker band along
 * the underside. Both stay clear of the eye band, which has to be flat for the overlay.
 * @param {Canvas} canvas
 * @param {number} cx
 * @param {number} cy
 * @param {number} halfW
 */
function shadeBody(canvas, cx, cy, halfW) {
  const { palette } = canvas;
  const top = cy - RY_TOP;
  // Light, not core: the near white belongs to the flame alone, and a pale column running from
  // the tip of the flame down into the body turns the two of them into one ice cream cone.
  for (let dx = -4; dx <= 4; dx++) {
    if (Math.abs(dx) <= 2) shade(canvas, cx + dx, top + 1, palette.light);
    shade(canvas, cx + dx, top + 2, palette.light);
  }
  for (let y = cy + 4; y <= cy + 12; y++) {
    for (let dx = -halfW; dx <= halfW; dx++) shade(canvas, cx + dx, y, palette.deep);
  }
}

/**
 * A one pixel halo just outside the silhouette. It is what makes the thing look like it is
 * giving off light rather than being cut out of paper: over a dark wallpaper it is a glow, over
 * a pale one a faint lilac fringe, and at this alpha it never competes with the outline. It
 * never paints over what is already there, so the mark on the ground survives it.
 * @param {Canvas} canvas
 * @param {Uint8Array} mask
 */
function paintHalo(canvas, mask) {
  const { width, height, palette } = canvas;
  const inside = (/** @type {number} */ x, /** @type {number} */ y) =>
    x >= 0 && y >= 0 && x < width && y < height && mask[y * width + x] === 1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (inside(x, y) || canvas.get(x, y)[3] !== 0) continue;
      if (!inside(x - 1, y) && !inside(x + 1, y) && !inside(x, y - 1) && !inside(x, y + 1))
        continue;
      canvas.set(x, y, palette.halo);
    }
  }
}

/**
 * The mark it floats over. It is the mascot's own light on the floor, not a cast shadow, so it
 * fades and narrows as the wisp rises instead of sharpening.
 * @param {Canvas} canvas
 * @param {number} cx
 * @param {number} lift how far above its resting height this frame sits
 */
function paintGround(canvas, cx, lift) {
  const { palette } = canvas;
  const half = Math.max(2, 5 - lift);
  for (let dx = -half; dx <= half; dx++) canvas.set(cx + dx, GROUND, palette.ground);
  for (let dx = -half + 3; dx <= half - 3; dx++) canvas.set(cx + dx, GROUND + 1, palette.ground);
}

// The eye shapes, as rows of a four wide box whose bottom row sits on EYE_BOTTOM_DY. `w` is the
// pale of the eye, `p` the pupil, `g` the glint inside it and `-` the lid line. Every open style
// keeps the pupil off the edge of the eye on at least two sides: a pupil that touches the rim is
// a bead, and a bead does not look back at you.
/** @type {Record<EyeStyle, string[]>} */
const EYES = {
  open: ['.ww.', 'wgpw', 'wppw', 'wppw', '.pp.'],
  wide: ['.ww.', 'wwww', 'wgpw', 'wppw', '.pp.'],
  half: ['....', '....', '----', 'wppw', '.pp.'],
  closed: ['....', '....', 'pp.p', '..pp', '....'],
  happy: ['....', '....', '.pp.', 'p..p', '....'],
};
/** @type {Record<string, string>} */
const EYE_COLORS = { w: 'core', p: 'eye', g: 'white', '-': 'outline' };

/**
 * @param {Canvas} canvas
 * @param {number} cx
 * @param {number} cy
 * @param {EyeStyle} style
 */
function paintWispEyes(canvas, cx, cy, style) {
  const { palette } = canvas;
  const rows = EYES[style];
  const top = cy + EYE_BOTTOM_DY - (rows.length - 1);
  for (const dx of [EYE_LEFT_DX, EYE_RIGHT_DX]) {
    // The glint is on the same side of both eyes, since one light source lights both of them.
    rows.forEach((row, dy) => {
      for (let i = 0; i < EYE_W; i++) {
        const key = EYE_COLORS[row[i] ?? '.'];
        const color = key ? palette[key] : undefined;
        if (color) canvas.set(cx + dx + i, top + dy, color);
      }
    });
  }
}

/**
 * @param {Canvas} canvas
 * @param {number} cx
 * @param {number} y
 * @param {MouthStyle} style
 */
function paintWispMouth(canvas, cx, y, style) {
  const { palette } = canvas;
  const dark = palette.outline;
  if (!dark) return;
  for (let dx = -1; dx <= 1; dx++) canvas.set(cx + dx, y, dark);
  if (style === 'smile') {
    canvas.set(cx - 2, y - 1, dark);
    canvas.set(cx + 2, y - 1, dark);
  }
  if (style === 'frown') {
    canvas.set(cx - 2, y + 1, dark);
    canvas.set(cx + 2, y + 1, dark);
  }
}

/**
 * @typedef {FrameSpec & {
 *   dx?: number,
 *   dy?: number,
 *   halfW?: number,
 *   ryBot?: number,
 *   flameH: number,
 *   lean?: number,
 *   sway?: number,
 *   eyes?: EyeStyle,
 *   mouth?: MouthStyle,
 *   embers?: [number, number][],
 *   zAt?: [number, number],
 * }} WispSpec
 */

/** @param {WispSpec} spec */
function draw(spec) {
  const canvas = new Canvas(FRAME, FRAME, PALETTE);
  const dx = spec.dx ?? 0;
  const dy = spec.dy ?? 0;
  const cx = CX + dx;
  const cy = CY + dy;
  const halfW = spec.halfW ?? 8;
  const ryBot = spec.ryBot ?? 7;
  const lean = spec.lean ?? 0;
  const sway = spec.sway ?? 0;
  // The flame's base row sits on the crown, not one row inside it: buried a row deeper, the
  // narrow neck disappears behind the body and all that shows above the head is the taper.
  const baseY = cy - RY_TOP;

  paintGround(canvas, CX, -dy);

  // Flame and body share one mask, so they share one outline and the flame grows out of the
  // wisp. Outlined separately, the flame's own base line reads as the brim of a hat.
  const body = bodyMask(cx, cy, halfW, ryBot, FRAME, FRAME);
  const flame = flameMask(cx, baseY, spec.flameH, lean, sway, FRAME, FRAME);
  const mask = new Uint8Array(FRAME * FRAME);
  for (let i = 0; i < mask.length; i++) mask[i] = body[i] || flame[i] ? 1 : 0;
  paintHalo(canvas, mask);
  paintMask(canvas, mask, PALETTE.body, PALETTE.outline);
  shadeFlame(canvas, body, cx, baseY, spec.flameH, lean, sway);
  shadeBody(canvas, cx, cy, halfW);

  paintWispEyes(canvas, cx, cy, spec.eyes ?? 'open');
  if (spec.mouth) paintWispMouth(canvas, cx, cy + MOUTH_DY, spec.mouth);
  for (const [ex, ey] of spec.embers ?? []) {
    canvas.set(cx + ex, cy + ey, PALETTE.core);
  }
  if (spec.zAt) paintZ(canvas, spec.zAt[0], spec.zAt[1], PALETTE.core);
  return canvas;
}

/** @param {WispSpec} spec */
function bob(spec) {
  return { ...spec, bobX: spec.dx ?? 0, bobY: spec.dy ?? 0 };
}

// The idle is what a user looks at for hours, so it gets eight frames rather than two and holds
// each for 120ms: just under a second for one hover, and fast enough that the flame flickers
// instead of ticking. Three things move on different beats and never line up into a pulse:
// the flame changes shape every frame, the body rises and falls two pixels over the cycle, and
// two embers drift up out of the flame and go out. The eyes cannot join in: the overlay that
// covers them is picked by mood, not by frame, so a blink drawn here would never be seen.
const IDLE_LIFT = [0, -1, -1, -2, -2, -1, -1, 0];
// The flame never reaches the top of the frame: the halo needs the row above the tip, and a
// glow cut off by the window edge is what gives a sprite away. That caps the height at
// 11 + dy, which is why the tallest flames are on the frames where the body is lowest.
const IDLE_FLAME = [
  { flameH: 11, lean: 1, sway: 0 },
  { flameH: 10, lean: 1, sway: 1 },
  { flameH: 10, lean: 0, sway: 1 },
  { flameH: 9, lean: -1, sway: 0 },
  { flameH: 9, lean: -1, sway: -1 },
  { flameH: 10, lean: 0, sway: -1 },
  { flameH: 10, lean: 1, sway: -1 },
  { flameH: 11, lean: 1, sway: 0 },
];
// Embers leave the flame, drift up and out, and go out. They have to clear the flame by a pixel
// or two: one drawn against its edge is read as a bump on the outline, not as a spark.
/** @type {([number, number][])[]} */
const IDLE_EMBERS = [
  [[5, -11]],
  [[5, -13]],
  [
    [6, -15],
    [-5, -10],
  ],
  [[-5, -12]],
  [[-6, -14]],
  [
    [-6, -16],
    [5, -10],
  ],
  [[5, -12]],
  [[6, -14]],
];

/** @type {WispSpec[]} */
const idle = IDLE_LIFT.map((lift, i) =>
  bob({
    dy: lift,
    ...(IDLE_FLAME[i] ?? { flameH: 10 }),
    embers: IDLE_EMBERS[i] ?? [],
    durationMs: 120,
  }),
);

// It floats, so the walk has no feet to place: what the cycle carries is the hover and the way
// the flame trails behind. Six frames rather than four, one full rise and fall, with the flame
// swept back hardest over the top of the arc, where a thing being carried along is moving
// fastest. It leans into the direction of travel on the way up and rocks back on the way down.
/** @type {WispSpec[]} */
const walk = [
  bob({ dy: 0, flameH: 11, lean: -1, sway: -1, durationMs: 150 }),
  bob({ dy: -1, dx: 1, flameH: 10, lean: -2, sway: -1, durationMs: 150 }),
  bob({ dy: -2, dx: 1, flameH: 9, lean: -3, sway: 0, durationMs: 150 }),
  bob({ dy: -2, flameH: 9, lean: -3, sway: 0, durationMs: 150 }),
  bob({ dy: -1, dx: -1, flameH: 10, lean: -2, sway: 1, durationMs: 150 }),
  bob({ dy: 0, dx: -1, flameH: 10, lean: -1, sway: 1, durationMs: 150 }),
];

// Settled almost on the floor and spread a little wider, the flame low and rocking. Four frames
// so the rock has a middle and does not read as a two frame twitch.
/** @type {WispSpec[]} */
const sit = [
  bob({ dy: 3, halfW: 9, ryBot: 5, flameH: 9, lean: 1, durationMs: 420 }),
  bob({ dy: 3, halfW: 9, ryBot: 5, flameH: 8, lean: 1, sway: 1, durationMs: 420 }),
  bob({ dy: 4, halfW: 9, ryBot: 4, flameH: 8, lean: -1, durationMs: 420 }),
  bob({ dy: 3, halfW: 9, ryBot: 5, flameH: 9, lean: -1, sway: -1, durationMs: 420 }),
];

// Asleep the flame is down to an ember that swells and sinks with the breath, which is the only
// clock a sleeping ball of light has. Sleep skips the overlay, so these eyes are the real ones.
/** @type {WispSpec[]} */
const sleep = [
  bob({ dy: 4, halfW: 9, ryBot: 5, flameH: 5, eyes: 'closed', zAt: [24, 13], durationMs: 700 }),
  bob({ dy: 5, halfW: 9, ryBot: 4, flameH: 4, eyes: 'closed', zAt: [25, 11], durationMs: 700 }),
  bob({
    dy: 5,
    halfW: 9,
    ryBot: 4,
    flameH: 4,
    lean: 1,
    eyes: 'closed',
    zAt: [25, 9],
    durationMs: 700,
  }),
  bob({
    dy: 4,
    halfW: 9,
    ryBot: 5,
    flameH: 6,
    lean: 1,
    eyes: 'closed',
    zAt: [26, 7],
    durationMs: 700,
  }),
];

// Startled: it pulls itself in narrow and tall and the flame roars straight up, throwing embers
// clear. The body barely leaves the ground, because a twelve row flare and a jump do not both
// fit in a thirty two pixel frame and the flare is the half that reads.
/** @type {WispSpec[]} */
const alert = [
  bob({ dy: 0, halfW: 7, ryBot: 8, flameH: 11, eyes: 'wide', durationMs: 110 }),
  bob({
    dy: 0,
    halfW: 7,
    ryBot: 8,
    flameH: 11,
    eyes: 'wide',
    embers: [
      [-7, -13],
      [7, -12],
    ],
    durationMs: 110,
  }),
  bob({
    dy: -1,
    halfW: 7,
    ryBot: 8,
    flameH: 10,
    sway: 1,
    eyes: 'wide',
    embers: [
      [-8, -16],
      [8, -15],
    ],
    durationMs: 110,
  }),
  bob({ dy: 0, halfW: 7, ryBot: 8, flameH: 11, sway: -1, eyes: 'wide', durationMs: 110 }),
];

// Held up by the pointer: it hangs, swings, and the flame streams sideways the way a candle does
// when you carry it. The swing is four frames so it comes back through the middle.
/** @type {WispSpec[]} */
const drag = [
  bob({ dy: -4, halfW: 7, ryBot: 8, flameH: 7, lean: 3, sway: 1, durationMs: 190 }),
  bob({ dy: -5, dx: 1, halfW: 7, ryBot: 8, flameH: 6, lean: 4, sway: 2, durationMs: 190 }),
  bob({ dy: -4, halfW: 7, ryBot: 8, flameH: 7, lean: -3, sway: -1, durationMs: 190 }),
  bob({ dy: -5, dx: -1, halfW: 7, ryBot: 8, flameH: 6, lean: -4, sway: -2, durationMs: 190 }),
];

// Celebrate skips the overlay too, so it owns its face. Crouch, launch, hang at the top with the
// flame flattened by the climb and embers thrown off it, drop, land squashed.
/** @type {WispSpec[]} */
const celebrate = [
  bob({ dy: 4, halfW: 9, ryBot: 5, flameH: 6, eyes: 'happy', mouth: 'smile', durationMs: 140 }),
  bob({ dy: -2, halfW: 7, ryBot: 8, flameH: 9, eyes: 'happy', mouth: 'smile', durationMs: 140 }),
  bob({
    dy: -4,
    halfW: 8,
    ryBot: 7,
    flameH: 7,
    lean: 2,
    sway: 1,
    eyes: 'happy',
    mouth: 'smile',
    embers: [
      [-8, -10],
      [8, -9],
      [-5, -13],
      [5, -12],
      [0, -14],
    ],
    durationMs: 180,
  }),
  bob({ dy: -2, halfW: 8, ryBot: 7, flameH: 9, eyes: 'happy', mouth: 'smile', durationMs: 140 }),
  bob({ dy: 4, halfW: 10, ryBot: 4, flameH: 8, eyes: 'happy', mouth: 'smile', durationMs: 160 }),
];

/** @type {Record<string, WispSpec[]>} */
const FRAMES = { idle, walk, sit, sleep, alert, drag, celebrate };

/**
 * Clears the band across the eyes with flat body colour, then paints the mood's eyes and mouth
 * on it. Every pose keeps that band flat and the same distance below the body centre, so the
 * clear never leaves a seam and the overlay lands wherever the bob offsets put it.
 * @param {Expression} expression
 */
function drawExpression(expression) {
  const canvas = new Canvas(FRAME, FRAME, PALETTE);
  for (let y = CY + EYE_TOP_DY - 1; y <= CY + EYE_BOTTOM_DY + 1; y++) {
    for (let x = CX - BAND_DX; x <= CX + BAND_DX; x++) canvas.set(x, y, PALETTE.body);
  }
  const style = expression === 'bright' ? 'wide' : expression === 'low' ? 'half' : 'open';
  paintWispEyes(canvas, CX, CY, style);
  const mouth = expression === 'bright' ? 'smile' : expression === 'low' ? 'frown' : 'soft';
  paintWispMouth(canvas, CX, CY + MOUTH_DY, mouth);
  return canvas;
}

// The tray is 22 pixels: the whole creature at that size loses the flame, and the flame is the
// half that says wisp. So the icon is a portrait, drawn to its own geometry rather than scaled.
const TRAY_CX = 11;
const TRAY_CY = 15;

/**
 * @param {Expression} expression
 * @param {number} brightness
 * @param {number} saturation
 */
function drawTray(expression, brightness, saturation) {
  const tray = new Canvas(22, 22, tintPalette(PALETTE, brightness, saturation, TINT_SKIP));
  const halfW = 8;
  const baseY = TRAY_CY - RY_TOP;
  const flameH = expression === 'low' ? 5 : expression === 'bright' ? 8 : 7;
  const body = bodyMask(TRAY_CX, TRAY_CY, halfW, 6, 22, 22);
  const flame = flameMask(TRAY_CX, baseY, flameH, 0, 1, 22, 22);
  const mask = new Uint8Array(22 * 22);
  for (let i = 0; i < mask.length; i++) mask[i] = body[i] || flame[i] ? 1 : 0;
  paintMask(tray, mask, tray.palette.body, tray.palette.outline);
  shadeFlame(tray, body, TRAY_CX, baseY, flameH, 0, 1);
  shadeBody(tray, TRAY_CX, TRAY_CY, halfW);
  const style = expression === 'bright' ? 'wide' : expression === 'low' ? 'half' : 'open';
  paintWispEyes(tray, TRAY_CX, TRAY_CY, style);
  paintWispMouth(
    tray,
    TRAY_CX,
    TRAY_CY + MOUTH_DY,
    expression === 'bright' ? 'smile' : expression === 'low' ? 'frown' : 'soft',
  );
  return tray;
}

function drawIcon() {
  const first = FRAMES.idle?.[0];
  if (!first) throw new Error('Missing idle frame.');
  return draw({ ...first, mouth: 'soft' });
}

// Nothing touches the ground, so there is no footfall to measure: for a floating mascot the
// stride is the hover period expressed as distance. The mascot cruises at 70 screen pixels a
// second and the sheet is drawn at 1:3, so it covers 23 sprite pixels a second; 20 pixels a
// cycle puts one bob at 1.17 Hz, a shade quicker than the 1.04 Hz of the idle hover so it looks
// like it is pushing along, and slow enough that it never reads as bouncing. At the old value of
// 8, inherited from a walk that had feet, it bobbed three times a second and looked frantic.
const stridePx = 20;

/** @type {import('../mascot.mjs').Mascot<WispSpec>} */
export const wisp = {
  id: 'wisp',
  stridePx,
  frames: FRAMES,
  draw,
  drawExpression,
  drawTray,
  drawIcon,
};
