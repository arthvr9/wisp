import { app } from 'electron';
import { join } from 'node:path';

import {
  customMascotExists,
  deleteCustomMascot as deleteIn,
  importMascotFolder,
  listCustomMascots as listIn,
  loadCustomMascot as loadIn,
} from './import';
import { exportTemplate, type TemplateExport } from './template';
import { readBuiltInSheet, validateArtDirectory } from './validate';
import type {
  CustomArtError,
  CustomArtImportResult,
  CustomMascot,
  CustomMascotSummary,
} from '../../shared/custom-art';

export type { TemplateExport } from './template';
export type { ValidateResult } from './validate';

/** Custom mascots sit beside config.json and the signal store, one folder per mascot. */
export function customMascotsRoot(): string {
  return join(app.getPath('userData'), 'mascots');
}

function spritesDir(): string {
  return join(app.getAppPath(), 'resources', 'sprites');
}

/** Writes the starter kit the user draws over: one PNG per frame, a reference image, a guide. */
export function exportCustomArtTemplate(targetDir: string): TemplateExport {
  return exportTemplate(targetDir, spritesDir());
}

/** Checks a folder without importing it, for a preview in the settings screen. */
export function checkCustomArtFolder(sourceDir: string): CustomArtError[] {
  const { spec } = readBuiltInSheet(spritesDir());
  return validateArtDirectory(sourceDir, spec).errors;
}

export function importCustomMascot(sourceDir: string, name: string): CustomArtImportResult {
  return importMascotFolder({
    sourceDir,
    name,
    root: customMascotsRoot(),
    spritesDir: spritesDir(),
  });
}

export function listCustomMascots(): CustomMascotSummary[] {
  return listIn(customMascotsRoot());
}

export function loadCustomMascot(slug: string): CustomMascot | null {
  return loadIn(customMascotsRoot(), slug);
}

export function hasCustomMascot(slug: string): boolean {
  return customMascotExists(customMascotsRoot(), slug);
}

export function deleteCustomMascot(slug: string): boolean {
  return deleteIn(customMascotsRoot(), slug);
}
