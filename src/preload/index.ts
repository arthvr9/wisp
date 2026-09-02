import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';

import type { PoseUpdate } from '../shared/actor';
import type { Config } from '../shared/config';
import { IPC } from '../shared/ipc';
import type { DragStart, EnvironmentInfo, WispApi } from '../shared/ipc';

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
};

contextBridge.exposeInMainWorld('wisp', api);
