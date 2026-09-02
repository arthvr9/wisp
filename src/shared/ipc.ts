export const IPC = {
  dragStart: 'wisp:drag-start',
  dragEnd: 'wisp:drag-end',
} as const;

export interface DragStart {
  offsetX: number;
  offsetY: number;
}

export interface WispApi {
  dragStart(offset: DragStart): void;
  dragEnd(): void;
}
