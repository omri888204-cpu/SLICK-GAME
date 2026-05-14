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

export type MushroomEnemyState = 'idle' | 'run' | 'attack';

/**
 * Mushroom enemy bound to a platform slot. The enemy walks between left/right
 * edges of `platforms[platformIdx]`; `along` is the normalized 0..1 position
 * (0 = platform left, 1 = right). Following the platform-index pattern means
 * recycling stairs automatically carries enemies along with them.
 */
export type MushroomEnemy = {
  platformIdx: number;
  along: number;
  direction: Direction;
  state: MushroomEnemyState;
  animTime: number;
  edgePauseLeft: number;
};

/** Active tongue grapple (scene-owned; passed into Player each tick). */
export type ActiveGrapple = {
  phase: 'extend' | 'pull';
  targetX: number;
  targetY: number;
  extendT: number;
  hookStairId: number;
  pullStartX: number;
  pullStartY: number;
};
