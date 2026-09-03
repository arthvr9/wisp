import type { PoseUpdate } from './actor';
import type { Config } from './config';
import type { Mood } from './mood';
import type { DayItem, Signal, SignalAction, SignalSource, SignalsStatus } from './signals';
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
  connectorConnect: 'wisp:connector-connect',
  connectorDisconnect: 'wisp:connector-disconnect',
  syncNow: 'wisp:sync-now',
  signalsStatusGet: 'wisp:signals-status-get',
  signalsStatusChanged: 'wisp:signals-status-changed',
  signalsList: 'wisp:signals-list',
  dayList: 'wisp:day-list',
  dayChanged: 'wisp:day-changed',
  actionRun: 'wisp:action-run',
  panelToggle: 'wisp:panel-toggle',
  panelClose: 'wisp:panel-close',
  secretSet: 'wisp:secret-set',
  secretStatus: 'wisp:secret-status',
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
  connect(source: SignalSource): Promise<SignalsStatus>;
  disconnect(source: SignalSource): Promise<SignalsStatus>;
  syncNow(): Promise<SignalsStatus>;
  getSignalsStatus(): Promise<SignalsStatus>;
  onSignalsStatusChanged(listener: (status: SignalsStatus) => void): () => void;
  listSignals(): Promise<Signal[]>;
  listDay(): Promise<DayItem[]>;
  onDayChanged(listener: (items: DayItem[]) => void): () => void;
  runAction(signalId: string, action: SignalAction): Promise<DayItem[]>;
  togglePanel(): void;
  closePanel(): void;
  setSecret(name: 'gruply', value: string): Promise<Record<string, boolean>>;
  secretStatus(): Promise<Record<string, boolean>>;
  getSpeechStatus(): Promise<SpeechStatus>;
  onSpeechStatusChanged(listener: (status: SpeechStatus) => void): () => void;
  setSpeechApiKey(key: string): Promise<SpeechStatus>;
  testSpeech(): Promise<{ text: string; source: 'model' | 'fallback'; latencyMs: number }>;
  getMood(): Promise<Mood>;
  onMoodChanged(listener: (mood: Mood) => void): () => void;
}
