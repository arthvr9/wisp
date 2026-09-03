import { Buffer } from 'node:buffer';
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  CUSTOM_ART_MANIFEST,
  CUSTOM_ART_VERSION,
  frameFileName,
  isCustomMascotSlug,
  isPose,
  slugForMascotName,
} from '../../shared/custom-art';
import type {
  CustomArtImportResult,
  CustomMascot,
  CustomMascotSummary,
} from '../../shared/custom-art';
import type { Pose } from '../../shared/actor';
import { MAX_FILE_BYTES, readBuiltInSheet, validateArtDirectory } from './validate';
import type { ValidateOptions } from './validate';

const NAME_MAX = 32;
const SLUG_ATTEMPTS = 200;

interface Manifest {
  version: number;
  slug: string;
  name: string;
  frameWidth: number;
  frameHeight: number;
  stridePx: number;
  poses: Partial<Record<Pose, number>>;
  createdAt: string;
}

export interface ImportInput {
  /** The folder the user picked. Everything read from it is checked and capped. */
  sourceDir: string;
  name: string;
  /** Where custom mascots live, from `customMascotsRoot()`. */
  root: string;
  /** resources/sprites, the built-in art the drawing has to match. */
  spritesDir: string;
  limits?: ValidateOptions;
}

function displayName(name: string, slug: string): string {
  const trimmed = name.trim().slice(0, NAME_MAX).trim();
  return trimmed.length > 0 ? trimmed : slug;
}

// Two mascots called "Cat" cannot share a folder, and the check has to be the mkdir itself:
// asking whether the folder exists first and creating it after leaves a gap.
function claimDir(root: string, base: string): string {
  mkdirSync(root, { recursive: true });
  for (let attempt = 1; attempt <= SLUG_ATTEMPTS; attempt++) {
    const slug = attempt === 1 ? base : `${base}-${attempt}`;
    try {
      mkdirSync(join(root, slug));
      return slug;
    } catch {
      continue;
    }
  }
  throw new Error(`No free folder name for "${base}" under ${root}.`);
}

function readManifest(root: string, slug: string): Manifest | null {
  if (!isCustomMascotSlug(slug)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(join(root, slug, CUSTOM_ART_MANIFEST), 'utf8'));
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const raw = parsed as Record<string, unknown>;
  const poses: Partial<Record<Pose, number>> = {};
  const rawPoses = raw.poses;
  if (typeof rawPoses === 'object' && rawPoses !== null) {
    for (const [pose, count] of Object.entries(rawPoses as Record<string, unknown>)) {
      if (isPose(pose) && typeof count === 'number' && count > 0) poses[pose] = count;
    }
  }
  const width = raw.frameWidth;
  const height = raw.frameHeight;
  if (typeof width !== 'number' || typeof height !== 'number') return null;
  return {
    version: typeof raw.version === 'number' ? raw.version : 0,
    slug,
    name: typeof raw.name === 'string' && raw.name.length > 0 ? raw.name : slug,
    frameWidth: width,
    frameHeight: height,
    stridePx: typeof raw.stridePx === 'number' ? raw.stridePx : 0,
    poses,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : '',
  };
}

function summaryOf(manifest: Manifest): CustomMascotSummary {
  return {
    slug: manifest.slug,
    name: manifest.name,
    poses: Object.keys(manifest.poses).filter(isPose),
    frameWidth: manifest.frameWidth,
    frameHeight: manifest.frameHeight,
    stridePx: manifest.stridePx,
  };
}

/**
 * Checks a folder the user drew in and, if every file is good, copies it into the mascots
 * directory under a slug of its own.
 */
export function importMascotFolder(input: ImportInput): CustomArtImportResult {
  const { spec } = readBuiltInSheet(input.spritesDir);
  const checked = validateArtDirectory(input.sourceDir, spec, input.limits);
  if (checked.errors.length > 0) return { ok: false, errors: checked.errors };

  const slug = claimDir(input.root, slugForMascotName(input.name));
  const dir = join(input.root, slug);
  const poses: Partial<Record<Pose, number>> = {};
  try {
    for (const entry of spec.poses) {
      const frames = checked.poses[entry.pose];
      if (!frames) continue;
      // The bytes come from the validated read, not from a second pass over the picked folder:
      // a file swapped between the check and the copy would otherwise land unchecked.
      frames.forEach((frame, index) => {
        writeFileSync(join(dir, frameFileName(entry.pose, index + 1)), frame.bytes);
      });
      poses[entry.pose] = frames.length;
    }
    const manifest: Manifest = {
      version: CUSTOM_ART_VERSION,
      slug,
      name: displayName(input.name, slug),
      frameWidth: spec.frameWidth,
      frameHeight: spec.frameHeight,
      stridePx: spec.stridePx,
      poses,
      createdAt: new Date().toISOString(),
    };
    writeFileSync(join(dir, CUSTOM_ART_MANIFEST), JSON.stringify(manifest, null, 2) + '\n');
    return { ok: true, mascot: summaryOf(manifest) };
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

/** Every mascot with a readable manifest. A folder that is half written or gone is skipped. */
export function listCustomMascots(root: string): CustomMascotSummary[] {
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const mascots: CustomMascotSummary[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    const manifest = readManifest(root, entry.name);
    if (manifest) mascots.push(summaryOf(manifest));
  }
  return mascots;
}

export function customMascotExists(root: string, slug: string): boolean {
  return readManifest(root, slug) !== null;
}

/**
 * The mascot with its pixels, as data URLs the renderer can draw without a file read of its
 * own. Null when the folder is gone, which is what happens when the user deletes it behind the
 * app's back; the caller falls back to the built-in art.
 */
export function loadCustomMascot(root: string, slug: string): CustomMascot | null {
  const manifest = readManifest(root, slug);
  if (!manifest) return null;
  const dir = join(root, slug);
  const frames: Partial<Record<Pose, string[]>> = {};
  const poses: Pose[] = [];
  for (const [pose, count] of Object.entries(manifest.poses)) {
    if (!isPose(pose)) continue;
    const urls: string[] = [];
    for (let index = 1; index <= count; index++) {
      const path = join(dir, frameFileName(pose, index));
      try {
        // Same cap as the import: a frame that grew past it since is not one of ours.
        if (statSync(path).size > MAX_FILE_BYTES) break;
        urls.push(`data:image/png;base64,${Buffer.from(readFileSync(path)).toString('base64')}`);
      } catch {
        break;
      }
    }
    // A pose missing a frame is dropped whole, so a half deleted folder falls back to the
    // built-in art for that pose instead of animating a gap.
    if (urls.length !== count) continue;
    frames[pose] = urls;
    poses.push(pose);
  }
  return { ...summaryOf(manifest), poses, frames };
}

export function deleteCustomMascot(root: string, slug: string): boolean {
  if (!isCustomMascotSlug(slug)) return false;
  const dir = join(root, slug);
  if (readManifest(root, slug) === null) return false;
  rmSync(dir, { recursive: true, force: true });
  return true;
}
