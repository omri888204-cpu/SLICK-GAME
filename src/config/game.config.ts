/**
 * PixiJS rendering / ticker tuning (maps Phaser-style “forceSingleUpdate” / “pixelArt” ideas to Pixi v8).
 * @see Game.ts — applies ticker + default texture sampling after `Application.init`.
 */
export const RENDER = {
  /**
   * When true, clamp the app ticker to `maxTickerFps` so high-refresh mobile displays don’t run
   * multiple logical steps per vsync (smoother, more consistent dt).
   */
  forceSingleUpdate: true,
  maxTickerFps: 60,
  /** Floor for FPS cap on the ticker (limits how large deltaMS can grow between ticks). */
  minTickerFps: 10,
  /**
   * false → default linear texture filtering (smooth scaled sprites on mobile).
   * true → nearest-neighbor (“pixel art” look).
   */
  pixelArt: false,
  /**
   * Custom physics: no engine friction. Platforms are kinematic; horizontal motion is `driftVx` only.
   */
  platformSurfaceFriction: 0,
} as const;

export const EYES = {
  baseColor: 0xffe066,
  comboColor: 0x66e0ff,
  superColor: 0xff5577,
  pulseSpeed: 3,
  baseStrength: 2,
  pulseAmplitude: 1.5,
  comboStrengthMultiplier: 2.5,
};

export const WALK = {
  speedPxPerSecond: 588,
  /**
   * Scales joystick / touch analog axis toward max horizontal speed (`speedPxPerSecond`).
   * Keyboard arrow keys unchanged (they bypass this by not using smoothed joystick).
   */
  touchJoystickWalkScale: 0.646,
  /**
   * Air control multiplier while touch mode is active (Spider-Man style mid-air steering).
   * 1 = same as keyboard; >1 = tighter, more responsive arcs.
   */
  touchAirControlScale: 1.58,
  /**
   * Touch follow smoothing: snappier on ground so horseshoe / figure-eight carving builds |vx|
   * before jump (jump height scales with |vx| via `PHYSICS.speedJumpBonus`).
   */
  touchAxisLerpPerSecGround: 38,
  /** Softer smoothing in the air for fluid swing after leaving the platform. */
  touchAxisLerpPerSecAir: 18,
  /**
   * Ground acceleration multiplier (touch only). Rewards carving left–right–left before jump.
   */
  touchGroundCarveAccelScale: 1.28,
  /**
   * Extra ground accel (touch only) when steering opposes current `vx` — crisp reversals for horseshoe flow.
   */
  touchReverseCarveBoost: 1.16,
  acceleration: 5880,
  airAcceleration: 3360,
  stopDeceleration: 2200,
  vxThreshold: 24,
  bobAmplitude: 1.2,
  bobFrequency: 0.1,
  swayAmplitude: 4,
  tiltAmplitude: 0.04,
  stretchAmplitude: 0.018,
  blendSpeed: 24,
  runFrameDistance: 24,
};

export const ALIVE = {
  idleBreathSpeed: 1.5,
  idleBreathScale: 0.018,
  idleFloatPx: 2,
  idleSwaySpeed: 0.8,
  idleTilt: 0.022,
  tailWagFrequency: 0.04,
  tailIdleInfluence: 0.3,
  tailSkew: 0.045,
  jumpPulseMs: 280,
  jumpAnticipationMs: 80,
  jumpAnticipationSquash: 0.25,
  jumpAnticipationStretch: 0.15,
  landingPulseMs: 220,
  landingImpactVy: 420,
  landingSquash: 0.35,
  landingStretch: 0.25,
};

export const PHYSICS = {
  gravity: 2100,
  maxSpeed: 868,
  /**
   * Standing jump apex ≈ `baseJump² / (2·gravity)`; tuned to clear typical stair gaps (~250–350px).
   */
  baseJump: 1310,
  speedJumpBonus: 0.75,
  /** Horizontal bounce when hitting left/right world bounds (custom physics, not Phaser). */
  worldWallRestitution: 0,
};

/** Tongue grapple: Spider-Man style swing/pull from mouth to anchor. */
export const GRAPPLE = {
  cooldownSec: 2,
  maxRangePx: 540,
  extendSec: 0.12,
  pullAcceleration: 2500,
  maxPullSpeed: 420,
  /** Feeds gravity along rope tangent (pendulum-style swing, y-down coords). */
  swingTangentialScale: 0.12,
  gravityMultiplierWhilePulling: 0.14,
  detachDistancePx: 58,
  /** Cap pull travel to around four platform gaps. */
  maxPullTravelPx: 472,
  /** Swing “peak”: release when moving away from anchor along the tongue. */
  peakReleaseTowardSpeed: -85,
  peakReleaseMinDist: 36,
  peakReleaseMaxDist: 280,
  peakLaunchVyMul: 1.05,
  peakLaunchVxMul: 1.08,
  launchVy: -760,
  /** Extra upward impulse from pull speed toward the anchor (slingshot). */
  slingshotUpwardBoost: 0.2,
  launchVxBoost: 120,
  /** Continuous speed damping while attached to keep pull smooth. */
  pullVelocityDampingPerSec: 0.14,
  /** Short damping window right after release to curb overshoot. */
  releaseDampingDurationSec: 0.28,
  releaseDampingPerSec: 0.32,
  /** Mouth position offset from player body center (world follows facing). */
  mouthOffsetX: 54,
  mouthOffsetY: -44,
  rayHalfWidth: 10,
  tongueWidth: 11,
  tongueOutlineWidth: 15,
  tongueColor: 0xf0a0c8,
  tongueOutline: 0x6a2a4a,
  horizontalInputScaleWhilePulling: 0.52,
  poseTilt: -0.38,
  poseStretch: 1.06,
  /** During extend: hide procedural line after this progress before switching to pull rope. */
  proceduralTongueUntil: 0.92,
  /** Multiply tilt during grapple pull (`pull` phase). */
  artExtraTiltScale: 0.28,
};

/** Beast-mode combo: chain window, score multiplier, floating shoutouts. */
export const COMBO = {
  chainWindowSec: 2,
  maxMultiplier: 7,
  words: [
    'STICKY!',
    'SNAP!',
    'LIZARD MODE!',
    'APEX!',
    'UNSTOPPABLE!',
    'PREDATOR!',
  ] as const,
  /** Peak grapple + launch speed above this (px/s, with vy weighted) counts as “high velocity”. */
  highLaunchSpeedPx: 920,
  floatLifeSec: 1.05,
  floatDriftPxPerSec: 72,
  popInSec: 0.14,
  /** Combo mult at or above this enables beast visuals (tongue + trail). “> x5” → 6+. */
  beastModeMinMultiplier: 6,
  beastTongueOutline: 0xff4400,
  beastTongueFill: 0xffcc33,
  beastParticleLifeSec: 0.45,
  beastParticleSpawnIntervalSec: 0.04,
  beastParticleMinSpeed: 220,
};

/** Procedural infinite stairs + run reset thresholds. */
export const STAIRS = {
  /** Fixed pool: stairs are recycled in-place (no per-frame alloc); see `recycleStairsOffscreen`. */
  poolCount: 20,
  /** Vertical gap between step tops (larger climb cadence for clearer jumps). */
  stepPx: 172,
  platformHeight: 28,
  /** When a platform’s top is this far below the camera, recycle it to the top. */
  recycleBelowScreenPx: 220,
  /** Fallback: player feet past bottom of view + this → reset (only if fewer than `safetyStairBufferDrops` steps below). */
  fallDeathBelowViewportPx: 140,
  /**
   * Nominal vertical gap between step tops (aligns with `STAIR_GAP_*` average in PlayScene).
   * Used to keep a stair “safety column” below the player during recycle.
   */
  fallDeathStairRiseReferencePx: 300,
  /**
   * Always keep at least this many step surfaces **below** the player’s feet before recycling platforms away.
   * Matches camera framing: ~3 stairs visible under the player before the abyss.
   */
  safetyStairBufferDrops: 3,
  /**
   * Game over when feet fall more than this far **past** the top of the Nth next-lower stair (`safetyStairBufferDrops`).
   */
  fallPastLastSafetyStairPx: 175,
  /**
   * From this HUD altitude (meters), switch to slime platform art and apply `slimePlatformArtScale`.
   */
  slimePlatformAfterMeters: 1000,
  /** Scale for slime stairs so footprint matches the purple procedural slab (~28px hit height). */
  slimePlatformArtScale: 0.72,
  /**
   * Volcanic / lava platform art from this HUD altitude (meters).
   */
  volcanoPlatformAfterMeters: 2000,
  volcanoPlatformArtScale: 0.72,
  /**
   * Storm / electric crystal platform art from this HUD altitude (meters).
   */
  stormPlatformAfterMeters: 3000,
  stormPlatformArtScale: 0.72,
  /**
   * Crystal PNG: above this altitude, shrink sprites to better match the purple slab (legacy crystal tier).
   */
  compactPlatformArtAfterMeters: 1000,
  compactPlatformArtScale: 0.72,
};

/** Pickups: placement on platform tops, motion, collect VFX. */
export const COLLECTIBLES = {
  coinPoints: 10,
  diamondPoints: 50,
  diamondSpawnChance: 0.24,
  /** One pickup per platform slot; capped by stair pool size. */
  maxActive: 16,
  coinRadius: 15,
  diamondRadius: 17,
  /** Pixels above platform top surface (negative Y = toward sky in spawn math: y = platform.y - this). */
  aboveSurfacePx: 8,
  /** Keep pickups inset from platform left/right edges. */
  platformEdgeMarginPx: 24,
  /** Fake “coin spin”: horizontal scale oscillates (Hz). */
  coinSpinHz: 0.5,
  coinMinScaleX: 0.2,
  /** Idle bob amplitude (px), visual only. */
  bobAmplitudePx: 2.6,
  bobHz: 2.2,
  diamondPulseHz: 2.6,
  diamondPulseScale: 0.12,
  diamondAlphaMin: 0.68,
  diamondAlphaMax: 1,
  collectDurationSec: 0.4,
  collectRisePx: 80,
  /** Soft glow rings (px beyond main shape). */
  glowOuterPx: 6,
  glowMidPx: 3,
};

/** Hyper scoreboard: punch, bloom, shake. */
export const SCORE_UI = {
  shakeDurationSec: 0.22,
  shakeMaxPx: 4.8,
  bigPointsThreshold: 14,
  shakePointsFloor: 8,
  shakeMinMultForFloor: 5,
  climbBloomSaturationMeters: 380,
  apexComboMultiplier: 5,
  punchDurationSec: 0.2,
  punchPeakScale: 1.52,
  punchMaxRotationRad: (5 * Math.PI) / 180,
  rainbowPulseHz: 1.15,
};
