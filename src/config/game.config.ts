/**
 * PixiJS rendering / ticker tuning (maps Phaser-style “forceSingleUpdate” / “pixelArt” ideas to Pixi v8).
 * @see Game.ts — applies ticker + default texture sampling after `Application.init`.
 *
 * {@link PLAY_SCENE} — values that must stay in sync with {@link PlayScene} layout (stair deck world size).
 */
/** Uniform scale for stair deck hitbox + sprite width (0.8 = 20% smaller). */
export const PLATFORM_WORLD_SCALE = 0.8;

export const PLAY_SCENE = {
  /** Visual/body scale for infinite stair platforms — matches `PLATFORM_SCALE` in `PlayScene`. */
  stairPlatformScale: 2.1 * PLATFORM_WORLD_SCALE,
} as const;

/**
 * Uniform normal-stair sizing (mobile portrait). Walkable width is fixed; sprite art uses
 * {@link spriteWorldWidthPx} so PNG scale stays constant when hitbox width changes.
 */
export const PLATFORM_SIZING = {
  uniformBaseWidth: 162 * PLATFORM_WORLD_SCALE,
  normalWorldWidthPx: 318 * PLATFORM_WORLD_SCALE,
  spriteWorldWidthPx: 318 * PLATFORM_WORLD_SCALE,
  /** Cap vs visible world width minus spawn margins. */
  maxViewportWidthFraction: 0.46,
} as const;

export const RENDER = {
  /**
   * When true, clamp the app ticker to `maxTickerFps` so high-refresh mobile displays don’t run
   * multiple logical steps per vsync (smoother, more consistent dt).
   */
  forceSingleUpdate: true,
  maxTickerFps: 120,
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
  airStopDeceleration: 980,
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
  /** Raised so late-run horizontal speed isn’t capped while scroll difficulty ramps. */
  maxSpeed: 2600,
  /**
   * Standing jump apex ≈ `baseJump² / (2·gravity)`; tuned to clear typical stair gaps (~250–350px).
   */
  /** +25% vs legacy baseline for punchier default jumps. */
  baseJump: Math.round(1310 * 1.25),
  speedJumpBonus: 0.75,
  /** Horizontal bounce when hitting left/right world bounds (custom physics, not Phaser). */
  worldWallRestitution: 0,
  /**
   * Decorative viewport fascia (y-down coords): max downward vy while brushing a slab (`applyViewportFasciaAssist`).
   * Higher = faster, freer wall slide (less “braking” vs gravity).
   */
  viewportFasciaFallVyCap: 320,
  /** Stick beyond this ± threshold steers away from the contacted fascia — skips assist instantly. */
  viewportFasciaAxisDeadzone: 0.12,
  /** Exponential scaling (1/s) for velocity pushing *into* the slab (`0` = cap-only “slide”). */
  viewportFasciaIntoWallVxDampPerSec: 0,
  /** Separate from world bounds — soft bounce while camera viewport clamps player X ({@link PlayScene}). */
  viewportClampWallRestitution: 0.2,
  // —— Rest fascia: Icy Tower wall kicks (normal movement; kick whenever speed/charge warrants) ——
  icyRunChargeMax: 1100,
  icyRunChargeDecayPerSec: 2.2,
  /** Same-direction input builds charge (× |vx| per second). */
  icyRunChargeBuildPerSec: 0.72,
  icyWallKickMinVx: 480,
  icyWallKickRestitution: 1.22,
  icyWallKickMinImpactVx: 56,
  icyWallKickSpeedForMax: 680,
  icyWallKickMinVy: 290,
  icyWallKickMaxVy: 820,
  icyWallKickDiagonalVyPerVxMin: 0.62,
  icyWallKickDiagonalVyPerVxMax: 1.22,
  /** Min seconds between wall kicks (stops clamp double-fire, allows chains). */
  icyWallKickCooldownSec: 0.07,
  /** Subpixel slack so fascia assist still engages when the viewport clamp leaves the AABB flush with a slab inner edge. */
  viewportFasciaOverlapEpsPx: 0.75,
  /**
   * Viewport fascia elevator: max slide duration & per-wall cooldown (`gameTimeMs` in {@link update}).
   */
  wallSlideElevatorSpeedPxPerSec: 1370,
  /** Ms while overlapping the slab before forced detach + downward impulse (see `wallSlideCutoffDropVy`). */
  wallSlideMaxDurationMs: 750,
  /** Ms after the max-duration slide before the same fascia (left/right/both) can be grabbed again. */
  wallSlideCooldownMs: 2000,
  /** Downward vy (y-down coords) applied when max slide time elapses — heavy drop off the wall. */
  wallSlideCutoffDropVy: 760,
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

/**
 * Jump tracking — new minimal system. Counts the player's successful jumps for HUD display.
 * Combo/Flash/Tongue-Boost/360 layered systems were removed; future combo work hangs off this counter.
 */
export const JUMP_TRACKING = {
  /** Reset every run; only `triggerJumpAction` increments. */
  resetOnRunStart: true,
} as const;

/** Combo chain HUD: tier words + synth (see PlayScene + ComboBadge). */
export const COMBO = {
  /**
   * Chain jumps at `comboCount` ≥ 2 before the badge advances to the next word
   * (`QUICK!` → `SLICK!` → …).
   */
  jumpsPerWord: 6,
} as const;

/** Procedural infinite stairs + run reset thresholds. */
export const STAIR_GAP_MIN_PX = 250;
export const STAIR_GAP_MAX_PX = 350;

export const STAIRS = {
  /** Fixed pool: stairs are recycled in-place (no per-frame alloc); see `recycleStairsOffscreen`. */
  poolCount: 20,
  /** Vertical gap between step tops (larger climb cadence for clearer jumps). */
  stepPx: 172,
  platformHeight: 28,
  /** When a platform’s top is this far below the viewport bottom (world space), recycle it to the top. */
  recycleBelowScreenPx: 500,
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
   * Slide segment: while airborne and falling faster than this (y-down vy), do not recycle stairs
   * so platforms stay visible under a drop off the fascia wall.
   */
  slideFallPauseRecycleVy: 120,
  /**
   * Game over when feet fall more than this far **past** the top of the Nth next-lower stair (`safetyStairBufferDrops`).
   */
  fallPastLastSafetyStairPx: 175,
  /**
   * @deprecated Use {@link PLATFORM_LEVEL_ART} JPEG tiers in `PlayScene` instead.
   * Kept for save-data / docs compatibility.
   */
  slimePlatformAfterMeters: 1000,
  slimePlatformArtScale: 0.72,
  volcanoPlatformAfterMeters: 2000,
  volcanoPlatformArtScale: 0.72,
  stormPlatformAfterMeters: 3000,
  stormPlatformArtScale: 0.72,
  /**
   * Crystal PNG: above this altitude, shrink sprites to better match the purple slab (legacy crystal tier).
   */
  compactPlatformArtAfterMeters: 1000,
  compactPlatformArtScale: 0.72,
};

/**
 * Stair PNG art (`public/assets/Platforms/`) — half-open HUD ranges `[minMeters, maxMeters)`.
 * `platforms marshmelo.png` — marshmallow [0, 5000) m; chocolate [5000, 10000) m.
 * `stairs 10000.png` — candy stair art from 10000 m upward.
 */
export const PLATFORM_LEVEL_ART = {
  marshmallow: { minMeters: 0, maxMeters: 5000 },
  chocolate: { minMeters: 5000, maxMeters: 10000 },
  stairs10000: { minMeters: 10000, maxMeters: Number.POSITIVE_INFINITY },
} as const;

/** Walkable deck anchor — center of stair art aligns with physics landing (`platform.y`). */
export const PLATFORM_LEVEL_DECK_ANCHOR_Y = {
  marshmallow: 0.5,
  chocolate: 0.5,
  stairs10000: 0.5,
} as const;

/**
 * Stair deck thickness in world px — `{@link STAIRS.platformHeight}` × `{@link PLAY_SCENE.stairPlatformScale}`.
 * Same as `PlayScene` scaled platform body height (`platform.height`).
 */
export const PLATFORM_HEIGHT_WORLD_PX =
  STAIRS.platformHeight * PLAY_SCENE.stairPlatformScale;

/** Pickups: placement on platform tops, motion, collect VFX. */
export const COLLECTIBLES = {
  coinPoints: 10,
  diamondPoints: 50,
  /** Unused: world shield orbs no longer spawn; kept for data compatibility. Score bonus was for orb pickup. */
  shieldPickupPoints: 40,
  shieldDurationSec: 5,
  shieldSpawnChance: 0.12,
  diamondSpawnChance: 0.24,
  /** One pickup per platform slot; capped by stair pool size. */
  maxActive: 16,
  coinRadius: 18,
  diamondRadius: 20,
  shieldRadius: 18,
  /** Pixels above platform top surface (negative Y = toward sky in spawn math: y = platform.y - this). */
  aboveSurfacePx: 32,
  /** Keep pickups inset from platform left/right edges. */
  platformEdgeMarginPx: 24,
  /** Fake “coin spin”: horizontal scale oscillates (Hz). */
  coinSpinHz: 0.5,
  coinMinScaleX: 0.2,
  /** Idle bob amplitude (px), visual only. */
  bobAmplitudePx: 3.2,
  bobHz: 2.2,
  diamondPulseHz: 2.6,
  diamondPulseScale: 0.14,
  diamondAlphaMin: 0.78,
  diamondAlphaMax: 1,
  collectDurationSec: 0.4,
  collectRisePx: 80,
  /** Soft glow rings (px beyond main shape). */
  glowOuterPx: 8,
  glowMidPx: 4,
};

/** Global bloom/blur vs HUD legibility (0.8 = 20% less glow, 1.2 = 20% sharper UI). */
export const VISUAL_TUNING = {
  bloomBlurScale: 0.8,
  uiReadabilityScale: 1.2,
} as const;

export function tunedBlur(px: number): number {
  return Math.max(0, px * VISUAL_TUNING.bloomBlurScale);
}

export function tunedBloom(value: number): number {
  return value * VISUAL_TUNING.bloomBlurScale;
}

export function tunedUiAlpha(alpha: number): number {
  return Math.min(1, alpha * VISUAL_TUNING.uiReadabilityScale);
}

export function tunedUiStroke(px: number): number {
  return px * VISUAL_TUNING.uiReadabilityScale;
}

/** Hyper scoreboard: punch, bloom, shake. */
export const SCORE_UI = {
  /** When false, world/camera jitter from impacts and score spikes is fully disabled. */
  screenShakeEnabled: false,
  shakeDurationSec: 0.22,
  shakeMaxPx: 4.8,
  bigPointsThreshold: 14,
  shakePointsFloor: 8,
  climbBloomSaturationMeters: 380,
  punchDurationSec: 0.2,
  punchPeakScale: 1.52,
  punchMaxRotationRad: (5 * Math.PI) / 180,
  rainbowPulseHz: 1.15,
};

