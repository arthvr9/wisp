import type { PoseUpdate } from './actor';
import type { Config } from './config';
import type { Signal, SignalsStatus } from './signals';

export const IPC = {
  dragStart: 'wisp:drag-start',
  dragEnd: 'wisp:drag-end',
  contextMenu: 'wisp:context-menu',
  pose: 'wisp:pose',
  configGet: 'wisp:config-get',
  configSet: 'wisp:config-set',
  configChanged: 'wisp:config-changed',
  environmentGet: 'wisp:environment-get',
  bubble: 'wisp:bubble',
  clickupConnect: 'wisp:clickup-connect',
  clickupDisconnect: 'wisp:clickup-disconnect',
  clickupSyncNow: 'wisp:clickup-sync-now',
  signalsStatusGet: 'wisp:signals-status-get',
  signalsStatusChanged: 'wisp:signals-status-changed',
  signalsList: 'wisp:signals-list',
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

export interface BubbleMessage {
  text: string;
  url?: string;
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
  onBubble(listener: (message: BubbleMessage | null) => void): () => void;
  clickupConnect(): Promise<SignalsStatus>;
  clickupDisconnect(): Promise<SignalsStatus>;
  clickupSyncNow(): Promise<SignalsStatus>;
  getSignalsStatus(): Promise<SignalsStatus>;
  onSignalsStatusChanged(listener: (status: SignalsStatus) => void): () => void;
  listSignals(): Promise<Signal[]>;
}
