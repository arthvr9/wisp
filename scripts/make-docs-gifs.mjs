// Builds the animated GIFs the README shows out of the sprite sheets in resources/sprites.
// A still sheet says nothing about a mascot that moves, so the README needs the motion.
// Aseprite is the only tool here that writes animated GIF (no ffmpeg, no ImageMagick), so
// this generates a Lua script and runs it headless.
// Run with: node scripts/make-docs-gifs.mjs
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { argv, env, exit, stderr, stdout } from 'node:process';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'docs', 'images');
const spritesDir = join(root, 'resources', 'sprites');

/** The README background. Transparency in GIF is one bit and fringes badly, so composite. */
const BACKGROUND = { r: 250, g: 250, b: 250 };

/** Pixel art only survives integer nearest neighbour scaling. */
const SCALE = 4;

/** Blank source pixels kept around every mascot so nothing touches the GIF border. */
const MARGIN = 2;

/** The mascot the owner likes most, used for the single mascot GIFs. */
// The wisp is the namesake and the default, so it is the one the README leads with.
const HERO = 'wisp';

/** The picker order, matching scripts/lib/mascots/index.mjs. */
const MASCOTS = ['wisp', 'coffee', 'cat', 'ghost', 'plant'];

/** Poses in the order the README talks about them. */
const POSES = ['idle', 'walk', 'sit', 'sleep', 'alert', 'celebrate', 'dance', 'pet', 'startle'];

/** How long one pose stays on screen in poses.gif, in milliseconds. */
const POSE_HOLD = 1500;

/** Upper bound on the merged loop of mascots.gif, in milliseconds. */
const MAX_LOOP = 8000;

/** @typedef {{ x: number; y: number; w: number; h: number }} Rect */
/** @typedef {{ rect: Rect; duration: number }} SheetFrame */
/** @typedef {{ path: string; frames: SheetFrame[]; tags: Map<string, SheetFrame[]>; stridePx?: number }} Sheet */
/** @typedef {{ sheet: number; rect: Rect; dx: number; dy: number }} Cell */
/** @typedef {{ duration: number; cells: Cell[] }} OutFrame */
/**
 * @typedef {{
 *   out: string;
 *   sheets: string[];
 *   width: number;
 *   height: number;
 *   frames: OutFrame[];
 * }} Spec
 */

/**
 * @param {unknown} value
 * @param {string} what
 * @returns {Record<string, unknown>}
 */
function asRecord(value, what) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Expected an object for ${what}.`);
  }
  return /** @type {Record<string, unknown>} */ (value);
}

/**
 * @param {unknown} value
 * @param {string} what
 */
function asNumber(value, what) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Expected a number for ${what}.`);
  }
  return value;
}

/**
 * @param {Record<string, unknown>} source
 * @param {string} what
 * @returns {Rect}
 */
function asRect(source, what) {
  return {
    x: asNumber(source.x, `${what}.x`),
    y: asNumber(source.y, `${what}.y`),
    w: asNumber(source.w, `${what}.w`),
    h: asNumber(source.h, `${what}.h`),
  };
}

/**
 * Reads an Aseprite hash export: `frames` keyed by name in frame order, and `meta.frameTags`
 * naming the pose ranges. Both the source rectangles and the durations come from here.
 * @param {string} id
 * @returns {Sheet}
 */
function readSheet(id) {
  const jsonPath = join(spritesDir, `${id}.json`);
  const pngPath = join(spritesDir, `${id}.png`);
  if (!existsSync(jsonPath) || !existsSync(pngPath)) {
    throw new Error(`Missing sprite sheet for ${id}. Run npm run sprites first.`);
  }
  const parsed = asRecord(JSON.parse(readFileSync(jsonPath, 'utf8')), `${id}.json`);
  const framesByName = asRecord(parsed.frames, `${id}.json frames`);
  /** @type {SheetFrame[]} */
  const frames = Object.keys(framesByName).map((name) => {
    const entry = asRecord(framesByName[name], `frame ${name}`);
    return {
      rect: asRect(asRecord(entry.frame, `frame ${name} rect`), `frame ${name} rect`),
      duration: asNumber(entry.duration, `frame ${name} duration`),
    };
  });
  const meta = asRecord(parsed.meta, `${id}.json meta`);
  const rawTags = meta.frameTags;
  if (!Array.isArray(rawTags)) throw new Error(`Expected meta.frameTags in ${id}.json.`);
  /** @type {Map<string, SheetFrame[]>} */
  const tags = new Map();
  for (const raw of rawTags) {
    const tag = asRecord(raw, `${id}.json frame tag`);
    const name = tag.name;
    if (typeof name !== 'string') throw new Error(`Expected a name on a tag in ${id}.json.`);
    const from = asNumber(tag.from, `tag ${name}.from`);
    const to = asNumber(tag.to, `tag ${name}.to`);
    tags.set(name, frames.slice(from, to + 1));
  }
  const wisp =
    typeof meta.wisp === 'object' && meta.wisp !== null ? asRecord(meta.wisp, 'meta.wisp') : {};
  const stride = wisp.stridePx;
  return {
    path: pngPath,
    frames,
    tags,
    ...(typeof stride === 'number' ? { stridePx: stride } : {}),
  };
}

/**
 * @param {Sheet} sheet
 * @param {string} name
 * @returns {SheetFrame[]}
 */
function tagFrames(sheet, name) {
  const frames = sheet.tags.get(name);
  if (!frames || frames.length === 0) throw new Error(`No frames tagged ${name}.`);
  return frames;
}

/**
 * @param {SheetFrame[]} frames
 */
function cycleLength(frames) {
  return frames.reduce((total, frame) => total + frame.duration, 0);
}

/**
 * @param {number} a
 * @param {number} b
 */
function gcd(a, b) {
  let left = a;
  let right = b;
  while (right !== 0) {
    const rest = left % right;
    left = right;
    right = rest;
  }
  return left;
}

/**
 * The frame showing at a given point in a looping cycle.
 * @param {SheetFrame[]} frames
 * @param {number} time
 * @returns {SheetFrame}
 */
function frameAt(frames, time) {
  let left = time % cycleLength(frames);
  for (const frame of frames) {
    if (left < frame.duration) return frame;
    left -= frame.duration;
  }
  return frames[0] ?? { rect: { x: 0, y: 0, w: 0, h: 0 }, duration: 0 };
}

/**
 * @param {number} columns
 * @param {number} cell
 */
function canvas(columns, cell) {
  const step = cell + MARGIN;
  return {
    width: (columns * step + MARGIN) * SCALE,
    height: (cell + MARGIN * 2) * SCALE,
    /** @param {number} column */
    x: (column) => (MARGIN + column * step) * SCALE,
    y: MARGIN * SCALE,
  };
}

/**
 * One mascot animating one tag, at the durations the sheet asks for.
 * @param {string} out
 * @param {Sheet} sheet
 * @param {SheetFrame[]} frames
 * @returns {Spec}
 */
function singleSpec(out, sheet, frames) {
  const first = frames[0];
  if (!first) throw new Error('An animation needs at least one frame.');
  const box = canvas(1, first.rect.w);
  return {
    out,
    sheets: [sheet.path],
    width: box.width,
    height: box.height,
    frames: frames.map((frame) => ({
      duration: frame.duration,
      cells: [{ sheet: 0, rect: frame.rect, dx: box.x(0), dy: box.y }],
    })),
  };
}

/**
 * Several mascots on one row, each looping its own cycle on a shared timeline. Output frames
 * are cut at every point where any of them changes, so nobody's timing is rounded away.
 * @param {string} out
 * @param {Sheet[]} sheets
 * @param {SheetFrame[][]} tracks
 * @returns {Spec}
 */
function rowSpec(out, sheets, tracks) {
  const first = tracks[0]?.[0];
  if (!first) throw new Error('A row needs at least one animation.');
  const box = canvas(tracks.length, first.rect.w);
  let loop = tracks.reduce((total, track) => {
    const length = cycleLength(track);
    return (total * length) / gcd(total, length);
  }, 1);
  if (loop > MAX_LOOP) loop = MAX_LOOP;
  /** @type {Set<number>} */
  const cuts = new Set([0, loop]);
  for (const track of tracks) {
    for (let time = 0; time < loop; time += cycleLength(track)) {
      let offset = time;
      for (const frame of track) {
        if (offset >= loop) break;
        cuts.add(offset);
        offset += frame.duration;
      }
    }
  }
  const times = [...cuts].sort((a, b) => a - b);
  /** @type {OutFrame[]} */
  const frames = [];
  for (let i = 0; i < times.length - 1; i++) {
    const start = times[i] ?? 0;
    const duration = (times[i + 1] ?? loop) - start;
    if (duration <= 0) continue;
    frames.push({
      duration,
      cells: tracks.map((track, column) => ({
        sheet: column,
        rect: frameAt(track, start).rect,
        dx: box.x(column),
        dy: box.y,
      })),
    });
  }
  return {
    out,
    sheets: sheets.map((sheet) => sheet.path),
    width: box.width,
    height: box.height,
    frames,
  };
}

/**
 * One pose after another, each looping its own cycle for about POSE_HOLD.
 * @param {string} out
 * @param {Sheet} sheet
 * @param {string[]} poses
 * @returns {Spec}
 */
function posesSpec(out, sheet, poses) {
  /** @type {SheetFrame[]} */
  const timeline = [];
  for (const pose of poses) {
    const frames = tagFrames(sheet, pose);
    let held = 0;
    for (let i = 0; held < POSE_HOLD; i++) {
      const frame = frames[i % frames.length];
      if (!frame) break;
      timeline.push(frame);
      held += frame.duration;
    }
  }
  return singleSpec(out, sheet, timeline);
}

/** @param {string} value */
function luaString(value) {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * The Lua side is deliberately dumb: it opens each sheet once, then paints rectangles onto a
 * solid background with an integer nearest neighbour loop. All the timing decisions are above.
 * @param {Spec} spec
 */
function luaFor(spec) {
  const lines = [
    `local out = ${luaString(spec.out)}`,
    `local width, height, scale = ${spec.width}, ${spec.height}, ${SCALE}`,
    `local bg = { r = ${BACKGROUND.r}, g = ${BACKGROUND.g}, b = ${BACKGROUND.b} }`,
    `local paths = { ${spec.sheets.map(luaString).join(', ')} }`,
    'local frames = {',
  ];
  for (const frame of spec.frames) {
    const cells = frame.cells
      .map(
        (cell) =>
          `{ s = ${cell.sheet + 1}, x = ${cell.rect.x}, y = ${cell.rect.y}, ` +
          `w = ${cell.rect.w}, h = ${cell.rect.h}, dx = ${cell.dx}, dy = ${cell.dy} }`,
      )
      .join(', ');
    lines.push(`  { duration = ${frame.duration}, cells = { ${cells} } },`);
  }
  lines.push(
    '}',
    '',
    'local pc = app.pixelColor',
    'local sheets = {}',
    'for i, path in ipairs(paths) do',
    '  local sprite = app.open(path)',
    '  if sprite == nil then error("cannot open " .. path) end',
    '  local image = Image(sprite.width, sprite.height, ColorMode.RGB)',
    '  image:drawSprite(sprite, 1)',
    '  sheets[i] = image',
    '  sprite:close()',
    'end',
    '',
    'local fill = pc.rgba(bg.r, bg.g, bg.b, 255)',
    '',
    'local function paint(dst, src, cell)',
    '  for sy = 0, cell.h - 1 do',
    '    for sx = 0, cell.w - 1 do',
    '      local p = src:getPixel(cell.x + sx, cell.y + sy)',
    '      local a = pc.rgbaA(p)',
    '      if a > 0 then',
    '        local r, g, b = pc.rgbaR(p), pc.rgbaG(p), pc.rgbaB(p)',
    '        if a < 255 then',
    '          r = math.floor((r * a + bg.r * (255 - a)) / 255)',
    '          g = math.floor((g * a + bg.g * (255 - a)) / 255)',
    '          b = math.floor((b * a + bg.b * (255 - a)) / 255)',
    '        end',
    '        local c = pc.rgba(r, g, b, 255)',
    '        for py = 0, scale - 1 do',
    '          for px = 0, scale - 1 do',
    '            dst:drawPixel(cell.dx + sx * scale + px, cell.dy + sy * scale + py, c)',
    '          end',
    '        end',
    '      end',
    '    end',
    '  end',
    'end',
    '',
    'local sprite = Sprite(width, height, ColorMode.RGB)',
    'local layer = sprite.layers[1]',
    'while #sprite.frames < #frames do sprite:newEmptyFrame() end',
    'for i, frame in ipairs(frames) do',
    '  local image = Image(width, height, ColorMode.RGB)',
    '  image:clear(fill)',
    '  for _, cell in ipairs(frame.cells) do paint(image, sheets[cell.s], cell) end',
    '  sprite:newCel(layer, i, image, Point(0, 0))',
    '  sprite.frames[i].duration = frame.duration / 1000',
    'end',
    'sprite:saveAs(out)',
  );
  return `${lines.join('\n')}\n`;
}

/**
 * Aseprite is not on PATH in a normal install, so look where it usually lands. WISP_ASEPRITE
 * overrides for CI.
 * @returns {string | undefined}
 */
function findAseprite() {
  /** @type {string[]} */
  const candidates = [];
  if (env.WISP_ASEPRITE) candidates.push(env.WISP_ASEPRITE);
  candidates.push(join(homedir(), '.local', 'opt', 'aseprite', 'aseprite'));
  candidates.push('/usr/bin/aseprite', '/usr/local/bin/aseprite');
  for (const dir of (env.PATH ?? '').split(delimiter)) {
    if (dir) candidates.push(join(dir, 'aseprite'));
  }
  return candidates.find((candidate) => existsSync(candidate));
}

// The app advances the walk frame by ground covered, not by the sheet's own durations, so a
// GIF that used those durations would show the cat walking at a pace it never walks at.
// One cycle covers stridePx sprite pixels at WALK_SPEED_PX_S screen pixels per second.
const WALK_SPEED_PX_S = 70;
const SPRITE_SCALE = 3;

/**
 * @param {Sheet} sheet
 * @param {SheetFrame[]} frames
 * @returns {SheetFrame[]}
 */
function atWalkingPace(sheet, frames) {
  const stride = sheet.stridePx;
  if (stride === undefined || frames.length === 0) return frames;
  const cycleMs = (stride * SPRITE_SCALE * 1000) / WALK_SPEED_PX_S;
  const each = Math.round(cycleMs / frames.length);
  return frames.map((frame) => ({ ...frame, duration: each }));
}

/**
 * @param {string} binary
 * @param {string} workDir
 * @param {Spec} spec
 */

function render(binary, workDir, spec) {
  const script = join(workDir, 'render.lua');
  writeFileSync(script, luaFor(spec));
  execFileSync(binary, ['-b', '--script', script], { stdio: ['ignore', 'ignore', 'inherit'] });
  if (!existsSync(spec.out)) throw new Error(`Aseprite wrote nothing to ${spec.out}.`);
}

function main() {
  const binary = findAseprite();
  // The GIFs need Aseprite, which is a paid app compiled locally and is not on a CI runner.
  // The committed GIFs stay as they are rather than failing the whole art regeneration, which
  // is also what lets CI check that the sprite sheets match their generator.
  if (binary === undefined) {
    const strict = argv.includes('--require-aseprite');
    const message =
      'Aseprite was not found, so the GIFs in docs/images were left as they are.\n' +
      'Install it, or point WISP_ASEPRITE at the binary, then run this script again.\n';
    if (!strict) {
      stdout.write(message);
      return;
    }
    throw new Error(message);
  }
  mkdirSync(outDir, { recursive: true });
  const workDir = mkdtempSync(join(tmpdir(), 'wisp-gifs-'));
  try {
    const hero = readSheet(HERO);
    /** @type {Spec[]} */
    const specs = [
      singleSpec(join(outDir, 'walk.gif'), hero, atWalkingPace(hero, tagFrames(hero, 'walk'))),
      posesSpec(join(outDir, 'poses.gif'), hero, POSES),
    ];
    const sheets = MASCOTS.map(readSheet);
    specs.push(
      rowSpec(
        join(outDir, 'mascots.gif'),
        sheets,
        sheets.map((sheet) => tagFrames(sheet, 'idle')),
      ),
    );
    for (const spec of specs) {
      render(binary, workDir, spec);
      const size = statSync(spec.out).size;
      stdout.write(
        `wrote ${spec.out} (${spec.width}x${spec.height}, ${spec.frames.length} frames, ` +
          `${Math.round(size / 1024)} kB)\n`,
      );
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  exit(1);
}
