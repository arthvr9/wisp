import { BrowserWindow, dialog, ipcMain } from 'electron';
import type { IpcMainInvokeEvent, OpenDialogOptions } from 'electron';
import { basename } from 'node:path';

import { isCustomMascotSlug } from '../../shared/custom-art';
import type {
  CustomArtError,
  CustomArtImportResult,
  CustomMascot,
  CustomMascotSummary,
} from '../../shared/custom-art';
import type { Translate } from '../../shared/i18n';
import { IPC } from '../../shared/ipc';
import type { CustomArtCheck, CustomArtExport } from '../../shared/ipc';
import {
  checkCustomArtFolder,
  deleteCustomMascot,
  exportCustomArtTemplate,
  importCustomMascot,
  listCustomMascots,
  loadCustomMascot,
} from './index';
import type { TemplateExport } from './template';

// The same cap `normalizeConfig` puts on the creature's name. A name reaches the manifest, the
// settings list and the folder name, so it is cut before any of them.
const NAME_MAX = 24;

/** The half of `./index` these handlers use, as an interface so a test can stand in for it. */
export interface MascotStore {
  exportTemplate(dir: string): TemplateExport;
  check(dir: string): CustomArtError[];
  import(dir: string, name: string): CustomArtImportResult;
  list(): CustomMascotSummary[];
  load(slug: string): CustomMascot | null;
  remove(slug: string): boolean;
}

/** Opens a directory picker and resolves the chosen path, or null when it was closed. */
export type DirectoryPicker = (
  title: string,
  parent: BrowserWindow | null,
) => Promise<string | null>;

export interface MascotIpcDeps {
  /** A getter rather than a translator, because main replaces it when the locale changes. */
  t: () => Translate;
  store?: MascotStore;
  pick?: DirectoryPicker;
}

const defaultStore: MascotStore = {
  exportTemplate: exportCustomArtTemplate,
  check: checkCustomArtFolder,
  import: importCustomMascot,
  list: listCustomMascots,
  load: loadCustomMascot,
  remove: deleteCustomMascot,
};

const defaultPicker: DirectoryPicker = async (title, parent) => {
  const options: OpenDialogOptions = {
    title,
    properties: ['openDirectory', 'createDirectory'],
  };
  const result = parent
    ? await dialog.showOpenDialog(parent, options)
    : await dialog.showOpenDialog(options);
  const dir = result.filePaths[0];
  return result.canceled || dir === undefined ? null : dir;
};

// The folder the user picked is the name they already gave the mascot, so nothing has to be
// typed twice. A name sent by the renderer wins, and both are cut to the same length.
function mascotName(supplied: unknown, dir: string): string {
  const typed = typeof supplied === 'string' ? supplied.trim().slice(0, NAME_MAX).trim() : '';
  if (typed.length > 0) return typed;
  return basename(dir).trim().slice(0, NAME_MAX).trim();
}

/** Registers every custom art channel. Call it once, after the windows exist. */
export function registerMascotIpc(deps: MascotIpcDeps): void {
  const store = deps.store ?? defaultStore;
  const pick = deps.pick ?? defaultPicker;
  const parentOf = (event: IpcMainInvokeEvent): BrowserWindow | null =>
    BrowserWindow.fromWebContents(event.sender);

  ipcMain.handle(IPC.customArtExport, async (event): Promise<CustomArtExport | null> => {
    const dir = await pick(deps.t()('settings.customArt.exportTemplate'), parentOf(event));
    if (dir === null) return null;
    const written = store.exportTemplate(dir);
    return { dir: written.dir, count: written.written.length };
  });

  ipcMain.handle(IPC.customArtCheck, async (event): Promise<CustomArtCheck | null> => {
    const dir = await pick(deps.t()('settings.customArt.import'), parentOf(event));
    if (dir === null) return null;
    return { dir, errors: store.check(dir) };
  });

  ipcMain.handle(
    IPC.customArtImport,
    async (event, name: unknown): Promise<CustomArtImportResult | null> => {
      const dir = await pick(deps.t()('settings.customArt.import'), parentOf(event));
      if (dir === null) return null;
      return store.import(dir, mascotName(name, dir));
    },
  );

  ipcMain.handle(IPC.customMascotList, (): CustomMascotSummary[] => store.list());

  // A slug arrives from the renderer and is joined onto a path, so it is checked here rather
  // than trusted. Anything that is not a slug of ours reads and deletes nothing.
  ipcMain.handle(IPC.customMascotLoad, (_event, slug: unknown): CustomMascot | null =>
    isCustomMascotSlug(slug) ? store.load(slug) : null,
  );

  ipcMain.handle(IPC.customMascotDelete, (_event, slug: unknown): CustomMascotSummary[] => {
    if (isCustomMascotSlug(slug)) store.remove(slug);
    return store.list();
  });
}
