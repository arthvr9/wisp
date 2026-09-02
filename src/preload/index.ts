import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';

import type { PoseUpdate } from '../shared/actor';
import type { Config } from '../shared/config';
import { IPC } from '../shared/ipc';
import type { BubbleMessage, DragStart, EnvironmentInfo, WispApi } from '../shared/ipc';
import type { Mood } from '../shared/mood';
import type { Signal, SignalsStatus } from '../shared/signals';
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
  clickupConnect() {
    return ipcRenderer.invoke(IPC.clickupConnect) as Promise<SignalsStatus>;
  },
  clickupDisconnect() {
    return ipcRenderer.invoke(IPC.clickupDisconnect) as Promise<SignalsStatus>;
  },
  clickupSyncNow() {
    return ipcRenderer.invoke(IPC.clickupSyncNow) as Promise<SignalsStatus>;
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
};

contextBridge.exposeInMainWorld('wisp', api);
