export type Platform = {
  x: number;
  y: number;
  width: number;
  height: number;
  baseWidth: number;
  driftDir: -1 | 1;
  /** Horizontal drift speed (px/s); sign matches `driftDir` after difficulty update. */
  driftVx: number;
  /** Monotonic id for higher steps (used for score / grapple bonus). */
  stairId: number;
  /** `spawn` = wide Floor 0 deck only — no rest-floor pause/house logic (see PlayScene). */
  kind?: 'normal' | 'rest' | 'spawn';
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
  pullStartX: number;
  pullStartY: number;
  /** Default/platform pull — `gummy` pulls a side bear toward the mouth. */
  targetKind?: 'platform' | 'gummy';
  gummyPlacementId?: number;
};
