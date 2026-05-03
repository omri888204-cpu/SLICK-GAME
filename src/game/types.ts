export type Platform = {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Monotonic id for higher steps (used for score / grapple bonus). */
  stairId: number;
};

export type Ripple = {
  x: number;
  y: number;
  age: number;
};

export type DustParticle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
};

export type Direction = -1 | 1;

/** Active tongue grapple (scene-owned; passed into Player each tick). */
export type ActiveGrapple = {
  phase: 'extend' | 'pull';
  targetX: number;
  targetY: number;
  extendT: number;
  hookStairId: number;
};
