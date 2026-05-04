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
  speedPxPerSecond: 420,
  acceleration: 4200,
  airAcceleration: 2400,
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
  maxSpeed: 620,
  baseJump: 760,
  speedJumpBonus: 0.75,
};

/** Tongue grapple: Spider-Man style swing/pull from mouth to anchor. */
export const GRAPPLE = {
  cooldownSec: 0.42,
  maxRangePx: 540,
  extendSec: 0.12,
  pullAcceleration: 5200,
  maxPullSpeed: 840,
  /** Feeds gravity along rope tangent (pendulum-style swing, y-down coords). */
  swingTangentialScale: 0.26,
  gravityMultiplierWhilePulling: 0.14,
  detachDistancePx: 58,
  /** Swing “peak”: release when moving away from anchor along the tongue. */
  peakReleaseTowardSpeed: -140,
  peakReleaseMinDist: 36,
  peakReleaseMaxDist: 280,
  peakLaunchVyMul: 1.14,
  peakLaunchVxMul: 1.18,
  launchVy: -1260,
  /** Extra upward impulse from pull speed toward the anchor (slingshot). */
  slingshotUpwardBoost: 0.52,
  launchVxBoost: 280,
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
  poolCount: 20,
  /** Vertical gap between step tops (matches legacy climb rhythm). */
  stepPx: 118,
  platformHeight: 28,
  /** When a platform’s top is this far below the camera, recycle it to the top. */
  recycleBelowScreenPx: 220,
  /** Player feet past bottom of view + this → game over / reset. */
  fallDeathBelowViewportPx: 140,
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
