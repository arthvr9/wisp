import type { WispApi } from '../shared/ipc';

declare global {
  interface Window {
    wisp: WispApi;
  }
}

export {};
