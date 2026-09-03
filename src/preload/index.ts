import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';

import type { PoseUpdate } from '../shared/actor';
import type { Config } from '../shared/config';
import type {
  CustomArtImportResult,
  CustomMascot,
  CustomMascotSummary,
} from '../shared/custom-art';
import { IPC } from '../shared/ipc';
import type {
  BubbleMessage,
  CustomArtCheck,
  CustomArtExport,
  DragStart,
  EnvironmentInfo,
  WispApi,
} from '../shared/ipc';
import type { Mood } from '../shared/mood';
import type { DayItem, Signal, SignalsStatus } from '../shared/signals';
import type { SpeechStatus } from '../shared/speech';

function subscribe(channel: string, listener: (payload: unknown) => void): () => void {
  const handler = (_event: IpcRendererEvent, payload: unknown) => {
    listener(payload);
  };
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
}

const api: WispApi = {
  dragStart(offset: DragStart) {
    ipcRenderer.send(IPC.dragStart, offset);
  },
  dragEnd() {
    ipcRenderer.send(IPC.dragEnd);
  },
  contextMenu() {
    ipcRenderer.send(IPC.contextMenu);
  },
  onPose(listener) {
    return subscribe(IPC.pose, (p) => {
      listener(p as PoseUpdate);
    });
  },
  getConfig() {
    return ipcRenderer.invoke(IPC.configGet) as Promise<Config>;
  },
  setConfig(patch) {
    return ipcRenderer.invoke(IPC.configSet, patch) as Promise<Config>;
  },
  onConfigChanged(listener) {
    return subscribe(IPC.configChanged, (c) => {
      listener(c as Config);
    });
  },
  getEnvironment() {
    return ipcRenderer.invoke(IPC.environmentGet) as Promise<EnvironmentInfo>;
  },
  onBubble(listener) {
    return subscribe(IPC.bubble, (m) => {
      listener(m as BubbleMessage | null);
    });
  },
  connect(source) {
    return ipcRenderer.invoke(IPC.connectorConnect, source) as Promise<SignalsStatus>;
  },
  disconnect(source) {
    return ipcRenderer.invoke(IPC.connectorDisconnect, source) as Promise<SignalsStatus>;
  },
  syncNow() {
    return ipcRenderer.invoke(IPC.syncNow) as Promise<SignalsStatus>;
  },
  getSignalsStatus() {
    return ipcRenderer.invoke(IPC.signalsStatusGet) as Promise<SignalsStatus>;
  },
  onSignalsStatusChanged(listener) {
    return subscribe(IPC.signalsStatusChanged, (s) => {
      listener(s as SignalsStatus);
    });
  },
  listSignals() {
    return ipcRenderer.invoke(IPC.signalsList) as Promise<Signal[]>;
  },
  listDay() {
    return ipcRenderer.invoke(IPC.dayList) as Promise<DayItem[]>;
  },
  onDayChanged(listener) {
    return subscribe(IPC.dayChanged, (items) => {
      listener(items as DayItem[]);
    });
  },
  runAction(signalId, action) {
    return ipcRenderer.invoke(IPC.actionRun, signalId, action) as Promise<DayItem[]>;
  },
  pet() {
    ipcRenderer.send(IPC.pet);
  },
  togglePanel() {
    ipcRenderer.send(IPC.panelToggle);
  },
  closePanel() {
    ipcRenderer.send(IPC.panelClose);
  },
  setSecret(name, value) {
    return ipcRenderer.invoke(IPC.secretSet, name, value) as Promise<Record<string, boolean>>;
  },
  secretStatus() {
    return ipcRenderer.invoke(IPC.secretStatus) as Promise<Record<string, boolean>>;
  },
  getSpeechStatus() {
    return ipcRenderer.invoke(IPC.speechStatusGet) as Promise<SpeechStatus>;
  },
  onSpeechStatusChanged(listener) {
    return subscribe(IPC.speechStatusChanged, (s) => {
      listener(s as SpeechStatus);
    });
  },
  setSpeechApiKey(key) {
    return ipcRenderer.invoke(IPC.speechSetApiKey, key) as Promise<SpeechStatus>;
  },
  testSpeech() {
    return ipcRenderer.invoke(IPC.speechTest) as Promise<{
      text: string;
      source: 'model' | 'fallback';
      latencyMs: number;
    }>;
  },
  getMood() {
    return ipcRenderer.invoke(IPC.moodGet) as Promise<Mood>;
  },
  onMoodChanged(listener) {
    return subscribe(IPC.moodChanged, (m) => {
      listener(m as Mood);
    });
  },
  exportArtTemplate() {
    return ipcRenderer.invoke(IPC.customArtExport) as Promise<CustomArtExport | null>;
  },
  checkArtFolder() {
    return ipcRenderer.invoke(IPC.customArtCheck) as Promise<CustomArtCheck | null>;
  },
  importCustomMascot(name) {
    return ipcRenderer.invoke(IPC.customArtImport, name) as Promise<CustomArtImportResult | null>;
  },
  listCustomMascots() {
    return ipcRenderer.invoke(IPC.customMascotList) as Promise<CustomMascotSummary[]>;
  },
  loadCustomMascot(slug) {
    return ipcRenderer.invoke(IPC.customMascotLoad, slug) as Promise<CustomMascot | null>;
  },
  deleteCustomMascot(slug) {
    return ipcRenderer.invoke(IPC.customMascotDelete, slug) as Promise<CustomMascotSummary[]>;
  },
};

// The theme arrives on the URL and is applied here, before any of the page's own scripts run, so
// the first paint is already in the right palette. Doing it from the page would mean an IPC round
// trip, and the window is shown before that lands.
//
// The preload compiles under the main process tsconfig, which has no DOM library on purpose: main
// must not be able to reach for `document` by accident. So the two globals this needs are reached
// through a narrow local shape rather than by adding DOM to the whole project.
interface ThemeTarget {
  documentElement: { setAttribute(name: string, value: string): void } | null;
  addEventListener(type: string, listener: () => void, options: { once: boolean }): void;
}
const globals = globalThis as { document?: ThemeTarget; location?: { search: string } };
const theme =
  new URLSearchParams(globals.location?.search ?? '').get('theme') === 'dark' ? 'dark' : 'light';

function applyTheme(): void {
  globals.document?.documentElement?.setAttribute('data-theme', theme);
}
applyTheme();
// Depending on how early this runs there may be no root element yet, so try again once there is.
globals.document?.addEventListener('DOMContentLoaded', applyTheme, { once: true });

contextBridge.exposeInMainWorld('wisp', api);
