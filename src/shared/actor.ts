export type Pose = 'idle' | 'walk' | 'sit' | 'sleep' | 'alert' | 'drag';
export type Facing = 'left' | 'right';

export interface PoseUpdate {
  pose: Pose;
  facing: Facing;
}
