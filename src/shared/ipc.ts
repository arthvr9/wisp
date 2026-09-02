import type { PoseUpdate } from './actor';
import type { Config } from './config';
import type { Mood } from './mood';
import type { Signal, SignalsStatus } from './signals';
import type { SpeechStatus } from './speech';

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
  speechStatusGet: 'wisp:speech-status-get',
  speechStatusChanged: 'wisp:speech-status-changed',
  speechSetApiKey: 'wisp:speech-set-api-key',
  speechTest: 'wisp:speech-test',
  moodGet: 'wisp:mood-get',
  moodChanged: 'wisp:mood-changed',
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
  getSpeechStatus(): Promise<SpeechStatus>;
  onSpeechStatusChanged(listener: (status: SpeechStatus) => void): () => void;
  setSpeechApiKey(key: string): Promise<SpeechStatus>;
  testSpeech(): Promise<{ text: string; source: 'model' | 'fallback'; latencyMs: number }>;
  getMood(): Promise<Mood>;
  onMoodChanged(listener: (mood: Mood) => void): () => void;
}
