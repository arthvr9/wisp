export type Pose =
  'idle' | 'walk' | 'sit' | 'sleep' | 'alert' | 'drag' | 'celebrate' | 'dance' | 'pet' | 'startle';
export type Facing = 'left' | 'right';

import type { Expression } from './mood';

export interface PoseUpdate {
  pose: Pose;
  facing: Facing;
  expression: Expression;
  speedFactor: number;
  intensity?: 1 | 2 | 3;
  // Screen pixels walked since the walk pose started, sent only for that pose. The walk cycle
  // advances by distance rather than by elapsed time, so the paws keep up with whatever speed
  // the mascot is moving at, mood factor included. The renderer divides it by the stride the
  // sprite sheet declares: the stride belongs to the art, and main never reads sprite sheets.
  walkPx?: number;
}
