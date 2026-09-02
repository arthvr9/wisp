import { contextBridge, ipcRenderer } from 'electron';

import { IPC } from '../shared/ipc';
import type { DragStart, WispApi } from '../shared/ipc';

const api: WispApi = {
  dragStart(offset: DragStart) {
    ipcRenderer.send(IPC.dragStart, offset);
  },
  dragEnd() {
    ipcRenderer.send(IPC.dragEnd);
  },
};

contextBridge.exposeInMainWorld('wisp', api);
