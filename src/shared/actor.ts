export type Pose = 'idle' | 'walk' | 'sit' | 'sleep' | 'alert' | 'drag' | 'celebrate';
export type Facing = 'left' | 'right';

import type { Expression } from './mood';

export interface PoseUpdate {
  pose: Pose;
  facing: Facing;
  expression: Expression;
  speedFactor: number;
  intensity?: 1 | 2 | 3;
}
