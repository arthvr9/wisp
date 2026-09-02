import type { PoseUpdate } from './actor';
import type { Config } from './config';

export const IPC = {
  dragStart: 'wisp:drag-start',
  dragEnd: 'wisp:drag-end',
  contextMenu: 'wisp:context-menu',
  pose: 'wisp:pose',
  configGet: 'wisp:config-get',
  configSet: 'wisp:config-set',
  configChanged: 'wisp:config-changed',
  environmentGet: 'wisp:environment-get',
} as const;

export interface DragStart {
  offsetX: number;
  offsetY: number;
}

export interface EnvironmentInfo {
  trayAvailable: boolean;
  shortcut: string;
  shortcutRegistered: boolean;
  autostartPath: string;
}

export interface WispApi {
  dragStart(offset: DragStart): void;
  dragEnd(): void;
  contextMenu(): void;
  onPose(listener: (update: PoseUpdate) => void): () => void;
  getConfig(): Promise<Config>;
  setConfig(patch: Partial<Config>): Promise<Config>;
  onConfigChanged(listener: (config: Config) => void): () => void;
  getEnvironment(): Promise<EnvironmentInfo>;
}
