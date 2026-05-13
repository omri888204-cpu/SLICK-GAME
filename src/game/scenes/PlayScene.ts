import {
  Application,
  Assets,
  Circle,
  Container,
  FederatedPointerEvent,
  Graphics,
  Rectangle,
  Sprite,
  Text,
  TextStyle,
  Texture,
  TilingSprite,
  type Ticker,
} from 'pixi.js';
import { PixiFactory, type PixiArmatureDisplay } from 'pixi-dragonbones-runtime';
import {
  COMBO,
  COLLECTIBLES,
  GRAPPLE,
  PHYSICS,
  RENDER,
  SCORE_UI,
  STAIRS,
  WALK,
} from '../../config/game.config';
import { HyperScoreboard } from '../ui/HyperScoreboard';
import { Player } from '../entities/Player';
import { fetchTopLeaderboard, saveScore, type LeaderboardEntry } from '../services/leaderboard';
import { getSavedNickname } from '../services/playerProfile';
import { InputManager } from '../systems/InputManager';
import { Physics } from '../systems/Physics';
import type {
  ActiveGrapple,
  MushroomEnemy,
  MushroomEnemyState,
  Platform,
  Ripple,
} from '../types';
import crystalPlatformUrl from '../../assets/sprites/crystal-platform.png';
import slimePlatformUrl from '../../assets/sprites/slime-platform.png';
import volcanoPlatformUrl from '../../assets/sprites/volcano-platform.png';
import stormPlatformUrl from '../../assets/sprites/storm-platform.png';
import type { Scene } from './Scene';

type ComboPopup = {
  label: Text;
  t: number;
  wx: number;
  wy: number;
};

type BeastParticle = {
  x: number;
  y: number;
  age: number;
};

type DiamondShineSpark = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  age: number;
};

type LevelUpParticle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
};

type Action360Phase = 'attach' | 'rotate';

type Action360State = {
  phase: Action360Phase;
  timeLeft: number;
  hookStairId: number;
  hookX: number;
  hookY: number;
  orbitRadius: number;
  orbitBaseAngle: number;
};

type Action360Spark = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
};

type TouchPointerTrack = {
  side: 'left' | 'right';
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  swipeBaselineY: number;
  swipeBaselineX: number;
  startMs: number;
  swipeHandled: boolean;
};

type TouchRipple = {
  x: number;
  y: number;
  age: number;
  life: number;
};

type MushroomDeathEffect = {
  sprite: Sprite;
  phase: 'die' | 'blood';
  timeInPhase: number;
};

type CollectibleKind = 'coin' | 'diamond' | 'shield';

type Collectible = {
  kind: CollectibleKind;
  /** Stable index into `this.platforms` — world position derived from platform top each frame. */
  platformIdx: number;
  /** 0..1 along usable width (between edge margins). */
  along: number;
  r: number;
  phase: 'active' | 'collecting';
  /** Normalized collect tween 0..1. */
  collectT: number;
  collectStartX: number;
  collectStartY: number;
};

type SfxId =
  | 'tongue_shoot'
  | 'tongue_hit'
  | 'collect_coin'
  | 'collect_diamond'
  | 'player_land';

/** Remote clips when `public/audio/<name>.*` is missing (see `SFX_LOCAL`). */
const SFX_REMOTE: Record<SfxId, string> = {
  tongue_shoot:
    'https://assets.mixkit.co/active_storage/sfx/3169/3169-preview.mp3',
  tongue_hit:
    'https://assets.mixkit.co/active_storage/sfx/2180/2180-preview.mp3',
  collect_coin:
    'https://labs.phaser.io/assets/audio/SoundEffects/p-ping.mp3',
  collect_diamond: 'https://labs.phaser.io/assets/audio/SoundEffects/pickup.wav',
  player_land:
    'https://assets.mixkit.co/active_storage/sfx/2070/2070-preview.mp3',
};

/** Game binaries (music, DragonBones, diamond SFX) live in `public/assets/`. */
const GAME_ASSETS = `${import.meta.env.BASE_URL}assets`;
/** Looping gameplay BGM — `public/assets/Dream Sakura_Loop.ogg`. */
const BGM_URL = `${GAME_ASSETS}/${encodeURIComponent('Dream Sakura_Loop.ogg')}`;
const REST_FLOOR_HOUSE_CANDIDATES = [
  `${GAME_ASSETS}/isohome.png`,
  `${GAME_ASSETS}/isohome.png.png`,
  `${GAME_ASSETS}/${encodeURIComponent('isohome #1.png')}`,
] as const;
const REST_FLOOR_CLOUD_URL = `${GAME_ASSETS}/Cloud-7.png`;

const SFX_LOCAL: Record<SfxId, string> = {
  tongue_shoot: `${import.meta.env.BASE_URL}audio/tongue_shoot.mp3`,
  tongue_hit: `${import.meta.env.BASE_URL}audio/tongue_hit.mp3`,
  collect_coin: `${import.meta.env.BASE_URL}audio/collect_coin.mp3`,
  collect_diamond: `${GAME_ASSETS}/diamond_collect.mp3`,
  player_land: `${import.meta.env.BASE_URL}audio/player_land.mp3`,
};

/**
 * Parallax tiling backgrounds: **draw back → front** = farthest sky first, closest details last.
 * Each row: preferred `.jpg` then `.png` under `public/assets/`. Speeds are fractions of **camera**
 * motion on `tilePosition` (layer 0 = 100% = matches scroll feel with world).
 */
type Bg7ParallaxLayerSpec = {
  readonly candidates: readonly string[];
  readonly speed: number;
};

const BG7_PARALLAX_LAYERS: readonly Bg7ParallaxLayerSpec[] = [
  {
    candidates: [
      `${GAME_ASSETS}/bg_7_0003_layer_3.jpg`,
      `${GAME_ASSETS}/bg_7_0003_layer_3.png`,
    ],
    speed: 0.1,
  },
  {
    candidates: [
      `${GAME_ASSETS}/bg_7_0002_layer_2.jpg`,
      `${GAME_ASSETS}/bg_7_0002_layer_2.png`,
    ],
    speed: 0.3,
  },
  {
    candidates: [
      `${GAME_ASSETS}/bg_7_0001_layer_1.jpg`,
      `${GAME_ASSETS}/bg_7_0001_layer_1.png`,
    ],
    speed: 0.6,
  },
  {
    candidates: [
      `${GAME_ASSETS}/bg_7_0000_layer_0.jpg`,
      `${GAME_ASSETS}/bg_7_0000_layer_0.png`,
    ],
    speed: 1.0,
  },
] as const;

const BG7_FALLBACK_CANDIDATES = [
  `${GAME_ASSETS}/bg_7.jpg`,
  `${GAME_ASSETS}/bg_7.png`,
] as const;

/**
 * Mushroom enemy spritesheets.
 *
 * Each strip is a single 64-px tall row of 80×64 frames; the asset pack splits idle / run /
 * attack into separate files (rather than one combined sheet). Frame counts come from
 * `width / 80`: idle = 7, run = 8, attack = 10.
 */
const MUSHROOM_IDLE_URL = `${GAME_ASSETS}/Mushroom-Idle.png`;
const MUSHROOM_RUN_URL = `${GAME_ASSETS}/Mushroom-Run.png`;
const MUSHROOM_ATTACK_URL = `${GAME_ASSETS}/Mushroom-Attack.png`;
/** Horizontal strip: same frame size as idle/run/attack; plays before `blood.png` burst. */
const MUSHROOM_DIE_URL = `${GAME_ASSETS}/Mushroom-Die.png`;
const MUSHROOM_DIE_FRAME_COUNT = 16;
/** 6×6 sheet, first 22 frames = splatter sequence (see `public/assets/blood.png`). */
const BLOOD_SHEET_URL = `${GAME_ASSETS}/blood.png`;
const BLOOD_SHEET_COLS = 6;
const BLOOD_EFFECT_FRAME_COUNT = 22;
const MUSHROOM_DEATH_DIE_FPS = 18;
const MUSHROOM_DEATH_BLOOD_FPS = 22;
const MUSHROOM_DEATH_BLOOD_SCALE = 2.65;
const MUSHROOM_FRAME_W = 80;
const MUSHROOM_FRAME_H = 64;
const MUSHROOM_IDLE_FRAME_COUNT = 7;
const MUSHROOM_RUN_FRAME_COUNT = 8;
const MUSHROOM_ATTACK_FRAME_COUNT = 10;
const MUSHROOM_ANIM_FPS = 10;
const MUSHROOM_WALK_SPEED_PX = 60;
const MUSHROOM_SPRITE_SCALE = 2.4;
/** Tight collision box around the mushroom body (smaller than the visible sprite). */
const MUSHROOM_HITBOX_W = 46;
const MUSHROOM_HITBOX_H = 60;
const MUSHROOM_EDGE_MARGIN = 0.06;
const MUSHROOM_EDGE_PAUSE_SEC = 0.32;
const MUSHROOM_ATTACK_RANGE_PX = 220;
/** First platform index that may carry an enemy. Skips the starting platform (index 0). */
const MUSHROOM_PLATFORM_START_INDEX = 2;
const MUSHROOM_PLATFORM_STRIDE = 3;

/** Player melee attack — virtual button (bottom-right) + KeyF, plays the attack row of the character spritesheet. */
const ATTACK_BTN_RADIUS_PX = 44;
const ATTACK_BTN_MARGIN_PX = 24;
const ATTACK_BTN_FILL_COLOR = 0xff4d1a;
const ATTACK_BTN_STROKE_COLOR = 0xffd64a;
/** Forward reach of the attack hitbox (px in world coords) from the player center. */
const PLAYER_ATTACK_REACH_PX = 110;
/** Vertical generosity applied to the attack hitbox (tops/bottoms) — slightly forgiving. */
const PLAYER_ATTACK_VERT_PAD_PX = 16;

/**
 * Large HP pool so mushroom touches chip **very little**; HUD still maps 0..max → 10 segments.
 * Tune `MUSHROOM_DAMAGE_PER_HIT` (not max) for per-hit sting.
 */
const PLAYER_MAX_HEALTH = 120;
/** HP lost on each mushroom hit (after i-frames). 1 ≈ 0.8% of the bar per contact. */
const MUSHROOM_DAMAGE_PER_HIT = 1;
/** Seconds of i-frames granted after a hit (no further mushroom damage during this window). */
const PLAYER_INVULN_SEC = 1.5;
/** Blink frequency while invulnerable. Higher = faster strobe. */
const PLAYER_HURT_BLINK_HZ = 12;
/** Top-left placement for the health HUD (below the header panel). */
const HEALTH_HUD_X_PX = 18;
/** Extra X so the bar clears the shield counter column (same row as diamond). */
const HEALTH_HUD_CLEAR_LEFT_COLUMN_PX = 16;
const HEALTH_HUD_Y_OFFSET_PX = 6;
/** Vertical gap between timer text and heart HUD. */
const HEALTH_BAR_UNDER_TIMER_GAP_PX = 8;
/** `public/assets/heart_counter-Sheet.png` — 192×992, 31 rows × 192×32 (see `heartHudSteadyFrameIndices`). */
const HEART_COUNTER_SHEET_URL = `${GAME_ASSETS}/heart_counter-Sheet.png`;
const HEART_COUNTER_FRAME_W = 192;
const HEART_COUNTER_FRAME_H = 32;
const HEART_COUNTER_FRAME_COUNT = 31;
const HEART_HUD_DISPLAY_WIDTH_PX = 160;
const HEART_HUD_SCALE = HEART_HUD_DISPLAY_WIDTH_PX / HEART_COUNTER_FRAME_W;
const HEART_HUD_PULSE_HZ = 2.8;
const HEART_HUD_HIT_FLASH_SEC = 0.16;

/** Map run HP (0..`PLAYER_MAX_HEALTH`) to the sheet’s 0..10 segment bar so full HP reads as a full meter. */
function heartHudSegmentsFromPlayerHealth(health: number): number {
  if (health <= 0) {
    return 0;
  }
  return Math.max(1, Math.min(10, Math.round((health / PLAYER_MAX_HEALTH) * 10)));
}

function heartHudSteadyFrameIndices(segmentL: number): [number, number] {
  if (segmentL <= 0) {
    return [HEART_COUNTER_FRAME_COUNT - 1, HEART_COUNTER_FRAME_COUNT - 1];
  }
  if (segmentL >= 10) {
    return [0, 1];
  }
  const start = 3 * (10 - segmentL);
  return [start, start + 1];
}

/** “Pink slot” frame when dropping from `fromL` filled segments to `fromL - 1`. */
function heartHudTransitionFrameIndex(fromL: number): number {
  if (fromL <= 0 || fromL > 10) {
    return HEART_COUNTER_FRAME_COUNT - 1;
  }
  return 2 + (10 - fromL) * 3;
}
/** Rope “bead” bridge look for low altitude (HUD meters). Physics stays the same AABB. */
const BEAD_BRIDGE_MAX_METERS = 1000;
/** Approximate stair span for the first phase — used with optional width variation. */
const SPRING_PHASE_STAIR_COUNT = 72;

const BEAD_BRIDGE_PALETTES: ReadonlyArray<{
  body: number;
  shadow: number;
  hi: number;
}> = [
  { body: 0xc17c5b, shadow: 0x5a3a28, hi: 0xe8c4a8 },
  { body: 0x9a8a78, shadow: 0x4a4038, hi: 0xd8d0c4 },
  { body: 0xc99a7a, shadow: 0x6a4838, hi: 0xf0d0b8 },
  { body: 0xa89c62, shadow: 0x485028, hi: 0xd8e8a0 },
];

/** DragonBones export: `*_ske.json`, `*_tex.json`, `*_tex.png` in `public/assets/`. */
const TONGUE_DB_SKE = `${GAME_ASSETS}/tongue_ske.json`;
const TONGUE_DB_TEX_JSON = `${GAME_ASSETS}/tongue_tex.json`;
const TONGUE_DB_TEX_PNG = `${GAME_ASSETS}/tongue_tex.png`;
/** Rest length of the rig in data space; tune if tongue appears too short/long. */
const TONGUE_DB_REST_LENGTH_PX = 118;
const TONGUE_DB_BASE_SCALE = 1;

/**
 * HTMLAudio-based SFX with pooled `cloneNode` playback and local → remote fallback URLs.
 */
class PlaySceneSfx {
  private readonly prototypes = new Map<SfxId, HTMLAudioElement>();
  private master = 0.42;

  async load(): Promise<void> {
    await Promise.all(
      (Object.keys(SFX_REMOTE) as SfxId[]).map((id) => this.loadOne(id)),
    );
  }

  private loadOne(id: SfxId): Promise<void> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (): void => {
        if (settled) {
          return;
        }
        settled = true;
        this.prototypes.set(id, audio);
        resolve();
      };

      const audio = new Audio();
      audio.preload = 'auto';

      const useRemote = (): void => {
        audio.removeEventListener('error', onLocalError);
        audio.src = SFX_REMOTE[id];
        audio.load();
        audio.addEventListener('canplaythrough', () => finish(), { once: true });
        audio.addEventListener('error', () => finish(), { once: true });
      };

      const onLocalError = (): void => {
        useRemote();
      };

      audio.addEventListener('canplaythrough', () => finish(), { once: true });
      audio.addEventListener('error', onLocalError, { once: true });
      audio.src = SFX_LOCAL[id];
      audio.load();
    });
  }

  play(id: SfxId, volume = 1): void {
    const template = this.prototypes.get(id);
    if (!template?.src) {
      return;
    }
    const clip = template.cloneNode(true) as HTMLAudioElement;
    clip.volume = Math.max(0, Math.min(1, volume * this.master));
    void clip.play().catch(() => {
      /* autoplay policy / decode */
    });
  }

  dispose(): void {
    for (const a of this.prototypes.values()) {
      a.pause();
      a.removeAttribute('src');
      a.load();
    }
    this.prototypes.clear();
  }
}

const CHECKER_BACKGROUND_COLOR_SPREAD = 10;
/** Pixels at image edges this dark (and connected) are cleared — removes black letterbox around Photoroom exports. */
const DARK_BG_MAX_CHANNEL = 42;

/** Vertical half-gap between Gold and Diamond lines (stack centered on scoreboard bar midline). */
const COLLECTIBLE_LINES_HALF_GAP_PX = 13;
/** Vertical offset from the diamond HUD icon row to the shield row (same column as diamond). */
const COLLECTIBLE_SHIELD_ICON_BELOW_DIAMOND_PX = 22;
/** Touch-only boost tongue button — sits under Gold/Diamonds (right-aligned). */
const TONGUE_BOOST_BTN_W = 118;
const TONGUE_BOOST_BTN_H = 38;
/**
 * TONGUE combo boost: longer gap between landings, then the chain **resets** after this many seconds
 * (so the sequence cannot run forever from landings alone).
 */
const TONGUE_COMBO_BOOST_DURATION_SEC = 10;
/** Landing combo when `stairId` regresses after recycle — must climb ≥ this many px higher (world Y↓). */
const COMBO_LAND_MIN_WORLD_Y_DELTA_PX = 6;
const PLATFORM_SCALE = 2.1;
/** Horizontal repeat width of one grass/dirt block inside `slime-platform.png` (atlas is tiled). */
const SLIME_PLATFORM_TILE_PX = 46;
const PLATFORM_EDGE_PADDING_PX = 8;
const CAMERA_ZOOM = 0.5;
const MOBILE_CAMERA_ZOOM = 0.42;
const CAMERA_PLAYER_SCREEN_Y_RATIO = 0.62;
const AUTO_SCROLL_BASE_SPEED_PX = 120;
const HURRY_UP_FLASH_SEC = 2.6;
/** HUD climb (m): no multiplier gain below this, then +`SCROLL_SPEED_STEP_DELTA` every `SCROLL_SPEED_STEP_METERS`. */
const SCROLL_SPEED_WARMUP_METERS = 300;
const SCROLL_SPEED_STEP_METERS = 200;
/** Per milestone delta (3× legacy 0.05 → faster difficulty ramp). */
const SCROLL_SPEED_STEP_DELTA = 0.15;
/** Combo / tongue timing: extra chain-window mult from climb height (HUD m), independent of scroll warmup. */
const COMBO_CLIMB_EASE_METERS_STEP = 160;
const COMBO_CLIMB_EASE_PER_STEP = 0.12;
const COMBO_CLIMB_EASE_MAX = 1.25;
/** Extra combo ease from post-warmup scroll-speed tier (stacks with climb ease). */
const COMBO_SCROLL_EASE_COEF = 0.34;
const COMBO_SCROLL_EASE_MAX_STEPS = 6;
/** Start subtle sustained camera shake once altitude scroll mult ≥ this × base (see `getAltitudeSpeedMultiplier`). */
const ALTITUDE_STRESS_SHAKE_MULT_THRESHOLD = 3;
const SPEED_TIER_SHAKE_SEC = 0.2;
const SPEED_TIER_UI_FLASH_SEC = 0.22;
/** Cool lavender pulse — avoids harsh fullscreen white flash (read as glitch on some GPUs). */
const SPEED_TIER_PULSE_COLOR = 0xb8a0ff;
const SPEED_TIER_PULSE_FILL_ALPHA = 0.11;
const PAUSE_RESUME_BTN_MIN_H = 64;
/** Compact pause control: left column under main header bar (`drawTopHeaderPanel`). */
const HEADER_PAUSE_BTN_W = 40;
const HEADER_PAUSE_BTN_H = 34;
const HEADER_PAUSE_LEFT_MARGIN_PX = 12;
const HEADER_PAUSE_BELOW_HEADER_GAP_PX = 8;
const UI_BG_BLACK = 0x000000;
const UI_PANEL_PURPLE = 0x2e004b;
const UI_NEON_GREEN = 0x39ff14;
const UI_GOLD = 0xffd700;
const UI_HEADER_H = 92;
const UI_SAFE_PAD_TOP = 10;
const UI_SAFE_PAD_BOTTOM = 12;
const UI_HEADER_INFO_ROW_Y = UI_SAFE_PAD_TOP + 40;
const HURRY_BANNER_H = 46;
const HURRY_BANNER_SLIDE_SPEED = 760;
const OVERLAY_BG_ALPHA = 0.72;
const WORLD_BOUNDS_X = 0;
const WORLD_BOUNDS_Y = -1000000;
const WORLD_BOUNDS_W = 1400;
const WORLD_BOUNDS_H = 1001000;
/** Screen-space inset (px) from each side; converted to world px via zoom for spawn + player clamp. */
const VIEWPORT_SAFE_MARGIN_SCREEN_PX = 40;
/** When true, stairs spawn in a band around the player (world X) so they stay on-screen on mobile. */
const MOBILE_NARROW_UI_MAX_W = 520;
const STAIR_GAP_MIN_PX = 250;
const STAIR_GAP_MAX_PX = 350;
const REST_FLOOR_INTERVAL_METERS = 1000;
const REST_FLOOR_MONSTER_CLEAR_METERS = 100;
const REST_FLOOR_RESUME_ABOVE_PX = 50;
const REST_FLOOR_TILE_PX = 64;
const REST_FLOOR_HOUSE_METERS = 1000;
const REST_FLOOR_HOUSE_DEPTH = 100;
/** Place the house at this fraction of the visible screen width so it stays on-screen on any aspect ratio. */
const REST_FLOOR_HOUSE_SCREEN_X_RATIO = 0.8;
/** Below this screen width (phones/small viewports) we render the house and clouds smaller so they're not cropped. */
const REST_FLOOR_PROPS_MOBILE_SCREEN_W = 600;
const REST_FLOOR_HOUSE_SCALE_DESKTOP = 0.8;
const REST_FLOOR_HOUSE_SCALE_MOBILE = 0.5;
const REST_FLOOR_HOUSE_SINK_PX = 0;
const REST_FLOOR_CLOUD_DEPTH = 90;
const REST_FLOOR_CLOUD_WIDTH_PX = 580;
const REST_FLOOR_CLOUD_SINK_PX = 10;
const REST_FLOOR_CLOUD_OFFSET_X_PX = -130;
const REST_FLOOR_CLOUD_RIGHT_OFFSET_X_PX = 170;
const REST_FLOOR_CLOUD_ROTATION_DEG = -3;
const REST_FLOOR_CLOUD_BREATH_AMPLITUDE_PX = 4;
const REST_FLOOR_CLOUD_BREATH_SCALE = 0.018;
const REST_FLOOR_CLOUD_BREATH_HZ = 0.45;
const PLAYER_SPAWN_CLEARANCE_PX = 14;
const GRAPPLE_VERTICAL_REACH_PLATFORMS = 2;
const GRAPPLE_MIN_TARGET_DISTANCE_PX = 150;
/** Minimum upward speed while tongue-pulling (px/s, negative = up); higher magnitude = faster climb. */
const GRAPPLE_VERTICAL_BOOST_VY = -640;
/** Horizontal easing toward the stair center during tongue pull (× dt). */
const GRAPPLE_PULL_HORIZONTAL_LERP_PER_SEC = 17;
/** Gap between TONGUE and 360 boost HUD buttons (screen px). */
const BOOST_ACTION_BTN_GAP_PX = 8;
/** Top-right HUD slot for boost buttons (screen px, `PlayScene` / `uiLayer` space). */
const BOOST_BTN_SCREEN_MARGIN_RIGHT_PX = 14;
/** Below the scoreboard band — larger Y moves TONGUE/360 further down (still right-aligned). */
const BOOST_BTN_SCREEN_MARGIN_TOP_PX = 104;
const GRAPPLE_STOP_ABOVE_PLATFORM_PX = 20;
const LEVEL_MAX = 100;
const LEVEL_SCORE_STEP = 1000;
const LEVEL_PLATFORM_SPEED_BASE = 24;
const LEVEL_PLATFORM_SPEED_PER_LEVEL = 5;
const LEVEL_PLATFORM_WIDTH_DECAY_RATIO_PER_LEVEL = 0.005;
const LEVEL_PLATFORM_MIN_BASE_WIDTH = 72;
const LEVEL_MILESTONE_STEP = 10;
/** After each new level (score tier), short move + jump feel boost. */
const LEVEL_UP_BOOST_DURATION_SEC = 4.5;
/** Cap total stacked duration when multiple levels are gained in one score tick. */
const LEVEL_UP_BOOST_TIME_CAP_SEC = 14;
const LEVEL_UP_BOOST_JUMP_MUL = 1.2;
const LEVEL_UP_BOOST_SCROLL_MUL = 1.1;
/** Spend this much from gold/diamond bank to auto-grant one shield (no world pickup). */
const SHIELD_BANK_GOLD = 10;
const SHIELD_BANK_DIAMOND = 5;
/** Shield break: teleport climb (few stair gaps) + upward impulse — large values strand the player above the pool. */
const SHIELD_SUPER_LAUNCH_STAIR_COUNT = 4;
/**
 * After launch, feet must stay at/under the pool's top tread (world Y grows downward).
 * Max rise uses `feetY - minTopY + this` so feet end near `minTopY` (tiny slack for one frame of vy).
 */
const SHIELD_LAUNCH_MAX_FEET_ABOVE_TOP_PX = 28;
/** After teleport, recycle passes so low stairs repack above the new camera. */
const SHIELD_LAUNCH_RECYCLE_PASSES = 28;
const FLASH_SKILL_BOOST_DURATION_SEC = 4;
const JUMP_BUFFER_SEC = 0.1;
const COMBO_BOOST_JUMP_THRESHOLD = 3;
const COMBO_BOOST_SPEED_MULT = 1.5;
/**
 * HUD climb (m): while ×6+ beast combo, Flash skill (tongue / 360 window) stays pegged — deep-run relief,
 * especially on touch where scroll + cadence punish drop-offs.
 */
const FLASH_SKILL_PERPETUAL_AFTER_HUD_METERS = 4000;
/** Extra combo-window / Flash-duration multiplier once deep (stacks with climb + scroll ease caps). */
const COMBO_DEEP_RUN_EXTRA_ALTITUDE_EASE = 1.75;
/** Stronger baseline / Flash jumps once deep (HUD m, same threshold as combo peg). */
const DEEP_RUN_JUMP_MULTIPLIER = 1.42;
/** Tongue pull / lateral snap vs base grapple tuning (`GRAPPLE_VERTICAL_BOOST_VY`, horizontal lerp). */
const DEEP_RUN_GRAPPLE_PULL_SPEED_MULT = 4.25;
const FLASH_TONGUE_COOLDOWN_SPEEDUP = 2;
const FLASH_BOOST_STAIR_COUNT = 4;
const FLASH_TONGUE_RAY_WIDTH_MULTIPLIER = 2.4;
const ACTION360_ATTACH_SEC = 0.72;
const ACTION360_ROTATE_SEC = 2.6;
const ACTION360_ROTATIONS = 2;
const ACTION360_TARGET_STAIRS_UP = 3;
const TOUCH_SWIPE_UP_MIN_PX = 18;
const TOUCH_SWIPE_JUMP_MIN_DISTANCE_PX = 20;
const TOUCH_SWIPE_UPWARD_RATIO_MIN = 0.4;
const TOUCH_FOLLOW_DISTANCE_PX = 70;
const TOUCH_LOCK_RADIUS_PX = 120;
const TOUCH_ACTION_RETRIGGER_MS = 110;
/** localStorage: accessibility — steer from first touch anywhere on screen (no “near character” gate). */
const LS_TOUCH_GLOBAL_STEERING = 'sky_climber_touch_global_steering';

/** Blend toward this cool color on background as altitude speed mult rises (0..1). */
const ALTITUDE_WIND_MAX_PARTICLES = 48;
type WindParticle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  len: number;
};

export class PlayScene implements Scene {
  readonly name = 'play';

  private app?: Application;
  private input?: InputManager;
  private physics = new Physics();
  private world = new Container();
  /**
   * Camera-locked backdrop (sibling of `world` inside `gameShake`): multi-layer `bg_7` art,
   * rotated 90° and scaled with `contain` so the entire bitmap stays visible.
   */
  private backgroundRoot = new Container();
  private readonly bgBackdropFill = new Graphics();
  /** Back → front: matches `BG7_PARALLAX_LAYERS` order (sky … flowers). */
  private bgParallaxLayers: { tile: TilingSprite; speed: number }[] = [];
  private jelly = new Graphics();
  private fxLayer = new Graphics();
  private platformSpriteLayer = new Container();
  private platformLayer = new Graphics();
  private restFloorPropLayer = new Container();
  private rippleLayer = new Graphics();
  private collectiblesGfx = new Graphics();
  /** Bottom hazard strip (vector lava fallback; crystal/ice asset removed). */
  private lavaLayer = new Container();
  private deathZoneFallback = new Graphics();
  private gameShake = new Container();
  /** HUD + touch: never parented under `world` / `gameShake` so it isn’t redrawn with the camera. */
  private uiLayer = new Container();
  private headerPanel = new Graphics();
  private headerPauseRoot = new Container();
  private headerPauseBtn = new Graphics();
  private headerPauseIcon?: Text;
  /** Bottom-right virtual ATTACK button — taps call `playerAttack()`. */
  private attackBtnRoot = new Container();
  private attackBtn = new Graphics();
  private attackBtnIcon = new Graphics();
  /**
   * Player health & i-frame state.
   *
   * `playerHealth` is decremented by mushroom contact by `MUSHROOM_DAMAGE_PER_HIT` (capped at
   * 0 = game over). Falls into the death plane consume an active shield once before
   * the regular game-over path. `playerInvulnTime` counts
   * down each frame; while it is positive the player can absorb further hits without
   * losing HP, and the sprite strobes via `playerInvulnBlinkPhase`.
   */
  private playerHealth = PLAYER_MAX_HEALTH;
  /**
   * No heal mechanics exist right now, so HP should never increase during a run.
   * This guard prevents accidental restores from unrelated state flows.
   */
  private playerHealthCeilingThisRun = PLAYER_MAX_HEALTH;
  private playerInvulnTime = 0;
  private playerInvulnBlinkPhase = 0;
  private healthHudRoot = new Container();
  private heartCounterTextures: Texture[] = [];
  private heartHudSprite = new Sprite();
  /** Filled segment count (0..10) shown after transitions; matches `heartHudSegmentsFromPlayerHealth`. */
  private heartHudSegmentL = heartHudSegmentsFromPlayerHealth(PLAYER_MAX_HEALTH);
  private heartHudTransTime = 0;
  private heartHudTransFromL = heartHudSegmentsFromPlayerHealth(PLAYER_MAX_HEALTH);
  /** Pulse phase independent of `runTime` (paused runs freeze `runTime`). */
  private heartHudPulseAcc = 0;
  private paused = false;
  private pauseOverlay = new Container();
  private pauseBackdrop = new Graphics();
  private pausePanel = new Graphics();
  private pauseTitle?: Text;
  private pauseResumeBtn = new Graphics();
  private pauseResumeLabel?: Text;
  private pauseTouchLockLabel?: Text;
  /** Touch accessibility: first finger locks steering without needing to tap near the player (default on). */
  private touchGlobalAnywhereLock = true;
  /** Full-screen HUD flash when scroll speed tier increases (see `getScrollSpeedTier`). */
  private speedPulseGfx = new Graphics();
  private speedTierUiFlashTime = 0;
  private lastScrollSpeedTier = 0;
  private tongueRoot = new Container();
  private tongueVector = new Graphics();
  private tongueArmature: PixiArmatureDisplay | null = null;
  private tongueDbReady = false;
  private player = new Player();
  private scoreboard?: HyperScoreboard;
  private collectibleHudRoot = new Container();
  private collectibleHudGoldIcon = new Graphics();
  private collectibleHudDiamondIcon = new Graphics();
  private collectibleHudShieldIcon = new Graphics();
  private touchControlsLayer = new Container();
  private touchFeedbackLayer = new Graphics();
  private touchPointers = new Map<number, TouchPointerTrack>();
  private touchControlPointerId: number | null = null;
  private touchRipples: TouchRipple[] = [];
  private touchLastJumpMs = 0;
  private collectibleHudGoldText?: Text;
  private collectibleHudDiamondText?: Text;
  private collectibleHudShieldText?: Text;
  private tongueBoostButtonRoot = new Container();
  private tongueBoostButtonGfx = new Graphics();
  private tongueBoostLabel?: Text;
  private tongueBoostButtonPressed = false;
  private action360ButtonRoot = new Container();
  private action360ButtonGfx = new Graphics();
  private action360ButtonLabel?: Text;
  private action360ButtonPressed = false;
  /** Player `body.y` at run start — climb height = baseline minus current y (px). */
  private climbBaselineY = 0;
  private windParticles: WindParticle[] = [];
  private windSpawnAcc = 0;
  private climbHudText?: Text;
  private timerHudText?: Text;
  private hurryBannerRoot = new Container();
  private hurryBannerGfx = new Graphics();
  private hurryBannerText?: Text;
  private gameOver = false;
  private gameOverOverlay = new Container();
  private gameOverBackdrop = new Graphics();
  private gameOverPanel = new Graphics();
  private gameOverTitle?: Text;
  private gameOverScoreText?: Text;
  private gameOverRestartBtn = new Graphics();
  private gameOverRestartLabel?: Text;
  private gameOverLeaderboardBtn = new Graphics();
  private gameOverLeaderboardLabel?: Text;
  /** Brief non-blocking confirmation after Firebase save (fades in `update` while game over). */
  private gameOverScoreSavedHint?: Text;
  private scoreSavedHintTimeLeft = 0;
  private leaderboardOverlay = new Container();
  private leaderboardBackdrop = new Graphics();
  private leaderboardPanel = new Graphics();
  private leaderboardTitle?: Text;
  private leaderboardRows: Text[] = [];
  private leaderboardCloseBtn = new Graphics();
  private leaderboardCloseLabel?: Text;
  private leaderboardLoadingText?: Text;
  private finalMetersAtDeath = 0;
  private deathSubmitted = false;
  /** Latest Top 5 from Firestore (refreshed after each save and when opening leaderboard). */
  private lastLeaderboardTop: LeaderboardEntry[] = [];
  /** While `runTime < this`, climbing combo expires using `TONGUE_COMBO_BOOST_DURATION_SEC` instead of `COMBO.chainWindowSec`. */
  private tongueBoostComboExtendUntil = -Infinity;
  /** When reached, combo boost ends: chain clears (see `expireComboIfNeeded`). Refreshed on each TONGUE boost press. */
  private tongueBoostComboResetAt: number | null = null;
  /** Max seconds between landings while TONGUE boost extend is active (set at press, matches `tongueBoostComboResetAt`). */
  private tongueBoostChainWindowSec: number | null = null;
  private collectibles: Collectible[] = [];
  private goldCount = 0;
  private diamondCount = 0;
  /**
   * Mushroom enemies live in their own world-space container so they sort above platforms but
   * below the player. The `mushroomEnemies` / `mushroomEnemySprites` arrays are kept in
   * lockstep — index `i` of one mirrors index `i` of the other.
   */
  private mushroomEnemies: MushroomEnemy[] = [];
  private mushroomEnemySprites: Sprite[] = [];
  private mushroomEnemyLayer = new Container();
  /** One-shot die → blood VFX at enemy world position (above living mushrooms). */
  private mushroomDeathFxLayer = new Container();
  private mushroomDeathEffects: MushroomDeathEffect[] = [];
  private mushroomIdleTextures: Texture[] = [];
  private mushroomRunTextures: Texture[] = [];
  private mushroomAttackTextures: Texture[] = [];
  private mushroomDieTextures: Texture[] = [];
  private bloodEffectTextures: Texture[] = [];
  /** Displayed counts (lerp toward real counts for smooth HUD). */
  private hudGoldShown = 0;
  private hudDiamondShown = 0;
  /** 1 = full collectible HUD punch, decays each frame. */
  private collectibleHudBump = 0;
  private sfx = new PlaySceneSfx();
  private platformTexture?: Texture;
  private platformTextureSlime?: Texture;
  private platformTextureVolcano?: Texture;
  private platformTextureStorm?: Texture;
  private restFloorHouseTexture?: Texture;
  private restFloorHouseSprite?: Sprite;
  private restFloorCloudTexture?: Texture;
  private restFloorCloudSprite?: Sprite;
  private restFloorCloudRightSprite?: Sprite;
  private platformSprites: Container[] = [];
  private platformSpriteModes: Array<'legacy' | 'bead'> = [];
  private platformSpriteCols: number[] = [];
  /** Rebuild bead-rope art when width/height/count palette changes. */
  private beadBridgeLayoutSig: number[] = [];
  private platforms: Platform[] = [];
  /** Stair the player is standing on (kinematic carry uses `driftVx`). */
  private currentGroundPlatform: Platform | null = null;
  private ripples: Ripple[] = [];
  private width = 0;
  private height = 0;
  private worldWidth = 0;
  private worldHeight = 0;
  private worldMinY = 0;
  private worldMaxY = 0;
  private cameraX = 0;
  private cameraY = 0;
  private restFloorHoldY: number | null = null;
  private highestY = 0;
  private grappleCooldown = 0;
  private grapple: ActiveGrapple | null = null;
  private grappleReleaseDampingLeft = 0;
  private grappleReloadingLogged = false;
  private score = 0;
  /** Highest stair id that has already awarded points (landing or grapple). */
  private lastScoredStairId = -1;
  /** Last landing we scored points on — platform top Y (smaller = higher climb). Used when recycle breaks id order. */
  private lastScoredLandWorldTopY = Number.POSITIVE_INFINITY;
  /** Next id assigned to a stair recycled to the top. */
  private nextStairId = 0;

  /** Successful chains within `COMBO.chainWindowSec`; 0 = idle. */
  private comboChain = 0;
  private platformJumpChain = 0;
  private jumpBufferTimeLeft = 0;
  private lastChainTime = -1e9;
  private runTime = 0;
  private hurryUpTimeLeft = 0;
  private hurryBannerX = 0;
  private comboPopups: ComboPopup[] = [];
  private beastParticles: BeastParticle[] = [];
  private diamondShineSparks: DiamondShineSpark[] = [];
  private beastParticleSpawnAcc = 0;
  private shakeTime = 0;
  private shakeOffsetX = 0;
  private shakeOffsetY = 0;
  /** Phase accumulator for speed-stress screenshake (continuous, not impact bursts). */
  private velocityStressShakePhase = 0;
  private bgm?: HTMLAudioElement;
  private level = 1;
  private levelUpBannerTime = 0;
  private levelUpParticles: LevelUpParticle[] = [];
  private currentBackgroundColor = 0x000000;
  private levelUpFloatText?: Text;
  private flashSkillBoostTime = 0;
  /** Tracks ×6+ combo threshold for one-shot Flash arm only (avoids refreshing boost every frame). */
  private beastComboAtLeastSixPrev = false;
  private action360State: Action360State | null = null;
  private action360Sparks: Action360Spark[] = [];
  private jumpArcAssistTime = 0;
  private jumpArcAssistDuration = 0;
  private jumpArcStartCenterX = 0;
  private jumpArcTargetCenterX = 0;
  /** Level-up reward: faster scroll + stronger jumps for a few seconds. */
  private levelUpBoostTime = 0;
  /**
   * Reserve shield charges from the gold/diamond bank. An active shield lives on
   * `player.isShielded` and expires or breaks independently.
   */
  private shieldStock = 0;
  private shieldTimeLeft = 0;
  async init(app: Application): Promise<void> {
    this.app = app;
    this.width = app.screen.width;
    this.height = app.screen.height;
    this.refreshWorldViewport();

    this.lavaLayer.addChild(this.deathZoneFallback);
    await Promise.all([
      this.loadPlatformSprite(),
      this.player.load(),
      this.sfx.load(),
      this.loadDeathZoneStrip(),
      this.loadBackgroundTexture(),
      this.loadMushroomTextures(),
      this.loadHeartCounterSheet(),
    ]);

    this.uiLayer.sortableChildren = true;
    app.stage.addChild(this.gameShake);
    app.stage.addChild(this.uiLayer);
    this.bgBackdropFill.eventMode = 'none';
    this.gameShake.addChild(this.backgroundRoot);
    this.gameShake.addChild(this.world);
    this.world.sortableChildren = true;
    this.world.addChild(
      this.jelly,
      this.platformSpriteLayer,
      this.platformLayer,
      this.restFloorPropLayer,
      this.mushroomEnemyLayer,
      this.mushroomDeathFxLayer,
      this.lavaLayer,
      this.rippleLayer,
      this.collectiblesGfx,
      this.tongueRoot,
      this.fxLayer,
      this.player,
    );
    this.jelly.zIndex = 0;
    this.platformSpriteLayer.zIndex = 2;
    this.platformLayer.zIndex = 3;
    this.restFloorPropLayer.zIndex = REST_FLOOR_HOUSE_DEPTH;
    this.restFloorPropLayer.sortableChildren = true;
    /** Above platforms, below FX/player so jumps visually pass in front of enemies. */
    this.mushroomEnemyLayer.zIndex = 4;
    this.mushroomEnemyLayer.sortableChildren = false;
    this.mushroomDeathFxLayer.zIndex = 4.5;
    this.mushroomDeathFxLayer.sortableChildren = false;
    /** Stairs drift behind the death-zone art; player / FX / ripples stay in front. */
    this.lavaLayer.zIndex = 25;
    this.rippleLayer.zIndex = 30;
    this.collectiblesGfx.zIndex = 31;
    this.tongueRoot.zIndex = 32;
    this.fxLayer.zIndex = 33;
    this.player.zIndex = 40;
    this.levelUpFloatText = new Text({
      text: 'LEVEL UP!',
      style: new TextStyle({
        fill: '#ffff66',
        fontFamily: 'Urbanist, Heebo, Arial Black, sans-serif',
        fontSize: 18,
        fontWeight: '800',
        stroke: { color: '#301050', width: 4 },
      }),
    });
    this.levelUpFloatText.anchor.set(0.5);
    this.levelUpFloatText.visible = false;
    this.world.addChild(this.levelUpFloatText);
    this.levelUpFloatText.zIndex = 45;
    this.tongueRoot.addChild(this.tongueVector);

    this.scoreboard = new HyperScoreboard();
    this.scoreboard.position.set(10, 6);
    this.scoreboard.onResize(this.width);
    this.uiLayer.addChild(this.scoreboard);

    this.setupCollectibleHud(app);
    this.layoutCollectibleHud();

    this.input = new InputManager(app);
    this.input.attach();
    this.setupTouchControlsOverlay(app);
    this.setupTongueBoostButton(app);
    this.setupAction360Button(app);
    this.setupClimbHud(app);
    this.setupAutoScrollHud();
    this.setupGameOverUi();
    this.touchGlobalAnywhereLock = this.loadTouchGlobalSteeringPreference();
    this.setupPauseUi();
    this.setupHeaderPauseButton();
    this.setupAttackButton();
    this.setupHealthHud();
    this.setupSpeedTierPulseOverlay();
    this.drawTopHeaderPanel();
    this.layoutHeaderPauseButton();
    if (this.scoreboard) {
      this.scoreboard.visible = false;
    }

    await this.tryLoadTongueArmature();
    this.startBackgroundMusic();

    this.resetRun();
    this.drawStaticWorld();
    this.applyCameraTransform();
    this.drawDynamicWorld();
  }

  update(ticker: Ticker): void {
    // Use real frame delta on mobile — capping to 1/30s made slow frames *lose* time so drifting
    // platforms and the camera looked stuttery. Only cap huge spikes (tab resume).
    const dt = Math.min(Math.max(ticker.deltaMS, 0) / 1000, 1 / 8);
    this.tickHeartHud(dt);
    this.enforceHealthInvariant();
    if (this.gameOver) {
      this.updateScreenShake(dt);
      this.refreshGameOverScoreText();
      this.updateScoreSavedHint(dt);
      return;
    }
    if (this.paused) {
      this.updateSpeedTierUiFlash(dt);
      this.applyCameraTransform();
      return;
    }
    this.runTime += dt;
    if (this.levelUpBoostTime > 0) {
      this.levelUpBoostTime = Math.max(0, this.levelUpBoostTime - dt);
    }
    this.expireComboIfNeeded();
    this.grappleCooldown = Math.max(0, this.grappleCooldown - dt);
    this.updateFlashSkillBoost(dt);
    this.syncBoostHudButtonsVisibility();
    this.updateTouchRipples(dt);
    this.updateGrappleCooldownFeedback();
    this.updateLevelProgress();
    this.updatePlatformDifficulty(dt);
    this.updateLevelUpParticles(dt);
    this.update360Action(dt);
    this.updateTouchFollowAxis();
    this.input?.smoothTouchJoystickAxis(dt, this.player.body.grounded);
    this.tickPlayerShield(dt);
    this.tickJumpBuffer(dt);
    this.updateRestFloorHoldState();

    const deepPullMul = this.getDeepRunGrapplePullMul();
    const pullVyCap = GRAPPLE_VERTICAL_BOOST_VY * deepPullMul;
    const pullHLerp = GRAPPLE_PULL_HORIZONTAL_LERP_PER_SEC * deepPullMul;

    if (!this.action360State && this.grapple?.phase === 'extend') {
      this.grapple.extendT += dt;
      if (this.grapple.extendT >= GRAPPLE.extendSec) {
        this.grapple.phase = 'pull';
        this.grapple.pullStartX = this.player.body.x + this.player.body.width * 0.5;
        this.grapple.pullStartY = this.player.body.y + this.player.body.height * 0.5;
        this.player.body.vy = Math.min(this.player.body.vy, pullVyCap);
        this.player.body.grounded = false;
        this.sfx.play('tongue_hit', 0.95);
      }
    }

    if (!this.action360State && this.grapple?.phase === 'pull') {
      const body = this.player.body;
      const hookPlatform = this.platforms.find((platform) => platform.stairId === this.grapple?.hookStairId);
      if (!hookPlatform) {
        this.grapple = null;
      } else {
        const pullTargetY = hookPlatform.y - body.height - GRAPPLE_STOP_ABOVE_PLATFORM_PX;
        const hookCenterX = hookPlatform.x + hookPlatform.width * 0.5;
        const targetBodyX = hookCenterX - body.width * 0.5;
        body.x += (targetBodyX - body.x) * Math.min(1, dt * pullHLerp);
        body.vx *= Math.max(0, 1 - 12 * dt);
        body.vy = Math.min(body.vy, pullVyCap);
        if (body.y <= pullTargetY) {
          body.y = pullTargetY;
          body.vy = 0;
          body.vx = 0;
          body.grounded = false;
          const hookId = this.grapple.hookStairId;
          const grappleGain = Math.max(0, hookId - this.lastScoredStairId);
          if (grappleGain > 0) {
            const launchSpeed = Math.hypot(body.vx, Math.abs(body.vy));
            this.feedComboFromGrapple(grappleGain, false, launchSpeed);
            const mult = this.getComboMultiplier();
            const delta = grappleGain * mult;
            this.score += delta * this.getScoreGainMultiplier();
            this.lastScoredStairId = hookId;
            this.lastScoredLandWorldTopY = Math.min(this.lastScoredLandWorldTopY, hookPlatform.y);
            this.maybeSpawnComboPopup(mult);
            this.scoreboard?.onPointsGained(delta);
            this.maybeTriggerScreenShake(delta, mult);
          }
          this.grapple = null;
          this.grappleReleaseDampingLeft = GRAPPLE.releaseDampingDurationSec;
        }
      }
    }

    if (this.action360State) {
      this.currentGroundPlatform = null;
      this.updateRestFloorHoldState();
      this.updateCamera(dt);
      this.maybeAdvanceScrollSpeedTierFeedback();
      if (!this.isRestFloorHolding()) {
        this.recycleStairsOffscreen();
      }
      this.syncPlatformSpritesFromPlatforms();
      this.checkFallGameOver();
      this.updateRipples(dt);
      this.updateBeastParticles(dt);
      this.updateComboPopups(dt);
      this.updateDiamondShineSparks(dt);
      this.updateAction360Sparks(dt);
      this.updateCollectibles(dt);
      this.tickPlayerInvuln(dt);
      this.maybePurchaseShieldFromBank();
      this.updateCollectibleHudSmooth(dt);
      const mult = this.getComboMultiplier();
      this.player.update(
        dt,
        0,
        this.highestY < -650,
        this.grapple,
        mult >= COMBO.beastModeMinMultiplier,
        this.player.isShielded,
      );
    this.physics.applyWorldBounds(this.player.body, this.worldWidth);
    this.clampPlayerToCameraViewport();
    this.tickAltitudePresentation(dt);
    this.drawDynamicWorld();
    this.updateSpeedTierUiFlash(dt);
    this.updateScreenShake(dt);
    const heightMeters = Math.max(0, Math.floor(-this.highestY / 12));
    this.scoreboard?.update(dt, this.score, mult, heightMeters, this.runTime, this.level);
    this.syncCollectibleHudPosition();
    return;
  }

    const axis = this.input?.getHorizontalAxis() ?? 0;
    const pulling = this.grapple?.phase === 'pull';
    const axisScale = pulling ? 0 : 1;
    const jumpArcAssistActive = this.jumpArcAssistTime > 0 && !this.player.body.grounded;
    const effectiveAxis = jumpArcAssistActive ? 0 : axis;
    const touchAirControl =
      this.input?.isTouchControlsActive() && !this.player.body.grounded
        ? WALK.touchAirControlScale
        : 1;
    const ax = effectiveAxis * axisScale;
    let touchGroundMul = 1;
    if (this.input?.isTouchControlsActive() && this.player.body.grounded && ax !== 0) {
      touchGroundMul = WALK.touchGroundCarveAccelScale;
      const vx = this.player.body.vx;
      if (Math.sign(ax) !== Math.sign(vx) && Math.abs(vx) > 42) {
        touchGroundMul *= WALK.touchReverseCarveBoost;
      }
    }

    this.physics.applyHorizontalInput(
      this.player.body,
      ax,
      dt,
      touchAirControl,
      touchGroundMul,
      this.isFlashSkillBoostActive() ? COMBO_BOOST_SPEED_MULT : 1,
    );
    if (jumpArcAssistActive) {
      this.jumpArcAssistTime = Math.max(0, this.jumpArcAssistTime - dt);
      const body = this.player.body;
      const bodyCenterX = body.x + body.width * 0.5;
      const elapsed = Math.max(0, this.jumpArcAssistDuration - this.jumpArcAssistTime);
      const t = this.jumpArcAssistDuration > 0 ? Math.min(1, elapsed / this.jumpArcAssistDuration) : 1;
      const curveT = 1 - Math.pow(1 - t, 2);
      const desiredCenterX =
        this.jumpArcStartCenterX +
        (this.jumpArcTargetCenterX - this.jumpArcStartCenterX) * curveT;
      const toDesired = desiredCenterX - bodyCenterX;
      const touchArc = this.input?.isTouchControlsActive() ?? false;
      const targetVx = Math.max(-300, Math.min(220, toDesired * (touchArc ? 5.35 : 4.8)));
      const steer = Math.min(1, dt * (touchArc ? 7.8 : 6));
      body.vx += (targetVx - body.vx) * steer;
      // Keep momentum bending inward while arc assist is active.
      if (this.jumpArcTargetCenterX < bodyCenterX) {
        body.vx = Math.min(body.vx, -70);
      }
    } else if (this.player.body.grounded) {
      this.jumpArcAssistTime = 0;
      this.jumpArcAssistDuration = 0;
    }
    this.handleActions();
    this.applyPostGrappleReleaseDamping(dt);

    const gravityScale = pulling ? 0 : this.getGravityScaleForLevel();
    const wasGrounded = this.player.body.grounded;
    const result = this.physics.update(
      this.player.body,
      this.platforms,
      this.worldWidth,
      dt,
      gravityScale,
    );
    if (result.landedPlatform) {
      this.currentGroundPlatform = result.landedPlatform;
      this.player.onLand(result.impactVy);
      if (!wasGrounded) {
        const landVol = Math.min(1, result.impactVy / 520);
        this.sfx.play('player_land', 0.35 + landVol * 0.65);
      }
      const p = result.landedPlatform;
      const idDelta = p.stairId - this.lastScoredStairId;
      const climbedHigherPhysically =
        p.y < this.lastScoredLandWorldTopY - COMBO_LAND_MIN_WORLD_Y_DELTA_PX;
      const landGain =
        idDelta > 0 ? idDelta : climbedHigherPhysically ? 1 : 0;
      if (landGain > 0) {
        this.feedComboFromLand();
        const mult = this.getComboMultiplier();
        const delta = landGain * mult;
        this.score += delta * this.getScoreGainMultiplier();
        this.lastScoredStairId = p.stairId;
        this.lastScoredLandWorldTopY = Math.min(this.lastScoredLandWorldTopY, p.y);
        this.maybeSpawnComboPopup(mult);
        this.scoreboard?.onPointsGained(delta);
        this.maybeTriggerScreenShake(delta, mult);
      }
      this.landOn(p);
      this.tryConsumeBufferedJump();
    } else if (!this.player.body.grounded) {
      this.currentGroundPlatform = null;
    }

    this.updateRestFloorHoldState();
    this.updateCamera(dt);
    this.maybeAdvanceScrollSpeedTierFeedback();
    this.clampPlayerToCameraViewport();
    if (!this.isRestFloorHolding()) {
      this.recycleStairsOffscreen();
    }
    this.syncPlatformSpritesFromPlatforms();
    this.checkFallGameOver();
    this.updateRipples(dt);
    this.updateBeastParticles(dt);
    this.updateComboPopups(dt);
    this.updateDiamondShineSparks(dt);
    this.updateAction360Sparks(dt);
    this.updateCollectibles(dt);
    this.tickPlayerInvuln(dt);
    this.updateMushroomEnemies(dt);
    this.updateMushroomDeathEffects(dt);
    if (this.input?.consumeAttack()) {
      this.playerAttack();
    }
    this.tickPlayerAttackHitbox();
    this.refreshAttackButtonCooldownVisual();
    this.maybePurchaseShieldFromBank();
    this.updateCollectibleHudSmooth(dt);
    const mult = this.getComboMultiplier();
    const boostVisualActive = this.isFlashSkillBoostActive();
    this.player.update(
      dt,
      axis,
      this.highestY < -650,
      this.grapple,
      boostVisualActive,
      this.player.isShielded,
    );
    this.tickAltitudePresentation(dt);
    this.drawDynamicWorld();
    this.updateSpeedTierUiFlash(dt);
    this.updateScreenShake(dt);
    const heightMeters = Math.max(0, Math.floor(-this.highestY / 12));
    this.scoreboard?.update(dt, this.score, mult, heightMeters, this.runTime, this.level);
    this.syncCollectibleHudPosition();
  }

  resize(width: number, height: number): void {
    const prevW = this.width;
    const prevH = this.height;
    const dw = Math.abs(width - prevW);
    const dh = Math.abs(height - prevH);
    this.width = width;
    this.height = height;
    this.refreshWorldViewport();

    if (this.scoreboard) {
      this.scoreboard.onResize(width);
      this.scoreboard.position.set(10, 6);
    }
    this.layoutCollectibleHud();
    this.layoutClimbHud();
    this.layoutAutoScrollHud();
    this.layoutGameOverUi();
    this.layoutHeaderPauseButton();
    this.layoutAttackButton();
    this.layoutHealthHud();
    this.layoutPauseOverlay();
    this.redrawSpeedPulseOverlay();
    this.drawTopHeaderPanel();
    this.input?.onResize();

    // Mobile browser chrome toggles height in small steps; resetting the whole run felt like “stuck” stairs.
    const minorViewportJitter =
      prevW > 0 && this.platforms.length > 0 && dw <= 36 && dh <= 96;
    if (minorViewportJitter) {
      this.drawStaticWorld();
      this.drawTopHeaderPanel();
      this.layoutHeaderPauseButton();
      this.layoutAttackButton();
      this.layoutHealthHud();
      this.layoutPauseOverlay();
      this.redrawSpeedPulseOverlay();
      this.clampEntitiesToWorldBounds();
      this.syncPlatformSpritesFromPlatforms();
      this.drawDynamicWorld();
      return;
    }

    this.resetRun();
    this.drawStaticWorld();
    this.drawTopHeaderPanel();
    this.drawDynamicWorld();
  }

  destroy(): void {
    if (this.input?.isTouchControlsActive()) {
      this.app?.stage.off('pointerdown', this.handleTouchPointerDown);
      this.app?.stage.off('pointermove', this.handleTouchPointerMove);
      this.app?.stage.off('pointerup', this.handleTouchPointerUpOrCancel);
      this.app?.stage.off('pointerupoutside', this.handleTouchPointerUpOrCancel);
      this.app?.stage.off('pointercancel', this.handleTouchPointerUpOrCancel);
      this.touchPointers.clear();
      this.touchControlPointerId = null;
      this.input?.clearTouchHolds();
    }
    this.input?.destroy();
    this.player.rotation = 0;
    this.clearPlatformSprites();
    this.clearFloatingComboUi();
    this.uiLayer.destroy({ children: true });
    this.sfx.dispose();
    this.stopBackgroundMusic();
    this.tongueArmature?.dispose(true);
    this.tongueArmature = null;
    this.tongueDbReady = false;
    this.gameShake.destroy({ children: true });
  }

  private handleActions(): void {
    if (this.action360State) {
      return;
    }
    const wantGrapple = this.input?.consumeGrapple() ?? false;
    const want360 = this.input?.consumeAction360() ?? false;
    if (wantGrapple && this.canUseTongueGrapple()) {
      this.triggerGrappleAction();
    } else if (want360 && this.canUseTongueGrapple()) {
      this.perform360Action();
    }

    const jumpPressed = this.input?.consumeJump() ?? false;

    if (jumpPressed) {
      this.jumpBufferTimeLeft = JUMP_BUFFER_SEC;
    }
    this.tryConsumeBufferedJump();
  }

  private computeGrappleTargetHit():
    | { x: number; y: number; platform: Platform }
    | undefined {
    const flashBoost = this.isFlashSkillBoostActive();
    const body = this.player.body;
    const shootX = body.x + body.width * 0.5;
    const shootY = body.y + body.height * 0.5;
    const baseReach = Math.max(350, STAIRS.stepPx * GRAPPLE_VERTICAL_REACH_PLATFORMS + 100);
    const boostedReach = STAIRS.stepPx * FLASH_BOOST_STAIR_COUNT + 70;
    const maxReach = flashBoost ? boostedReach : baseReach;
    const baseRayHalfWidth = Math.max(8, body.width * 0.8);
    const verticalRayHalfWidth = flashBoost
      ? baseRayHalfWidth * FLASH_TONGUE_RAY_WIDTH_MULTIPLIER
      : baseRayHalfWidth;
    return Physics.castGrappleTarget(
      this.platforms,
      shootX,
      shootY,
      GRAPPLE_MIN_TARGET_DISTANCE_PX,
      maxReach,
      verticalRayHalfWidth,
      flashBoost,
    );
  }

  private beginGrappleFromHit(hit: { x: number; y: number; platform: Platform }): void {
    if (!this.canUseTongueGrapple()) {
      return;
    }
    this.grapple = {
      phase: 'extend',
      targetX: hit.x,
      targetY: hit.y,
      extendT: 0,
      hookStairId: hit.platform.stairId,
      pullStartX: this.player.body.x + this.player.body.width * 0.5,
      pullStartY: this.player.body.y + this.player.body.height * 0.5,
    };
    const cooldownSpeedup = this.isFlashSkillBoostActive() ? FLASH_TONGUE_COOLDOWN_SPEEDUP : 1;
    this.grappleCooldown = GRAPPLE.cooldownSec / cooldownSpeedup;
    this.grappleReloadingLogged = false;
    this.player.onGrappleLaunch();
    this.sfx.play('tongue_shoot', 0.88);
  }

  private triggerGrappleAction(): void {
    if (!this.canUseTongueGrapple() || this.grappleCooldown > 0 || this.grapple) {
      return;
    }
    const hit = this.computeGrappleTargetHit();
    if (!hit) {
      return;
    }
    this.beginGrappleFromHit(hit);
  }

  private applyPostGrappleReleaseDamping(dt: number): void {
    if (this.grapple !== null || this.grappleReleaseDampingLeft <= 0) {
      return;
    }
    this.grappleReleaseDampingLeft = Math.max(0, this.grappleReleaseDampingLeft - dt);
    const damp = Math.max(0, 1 - GRAPPLE.releaseDampingPerSec * dt);
    this.player.body.vx *= damp;
    this.player.body.vy *= damp;
  }

  private updateGrappleCooldownFeedback(): void {
    if (!this.canUseTongueGrapple()) {
      return;
    }
    if (this.grappleCooldown > 0) {
      if (!this.grappleReloadingLogged) {
        this.grappleReloadingLogged = true;
        console.log('Tongue reloading...');
      }
      return;
    }

    if (this.grappleReloadingLogged) {
      this.grappleReloadingLogged = false;
      console.log('Tongue ready!');
    }
  }

  private tickJumpBuffer(dt: number): void {
    if (this.jumpBufferTimeLeft > 0) {
      this.jumpBufferTimeLeft = Math.max(0, this.jumpBufferTimeLeft - dt);
    }
  }

  private tryConsumeBufferedJump(): void {
    if (this.jumpBufferTimeLeft <= 0) {
      return;
    }
    if (this.triggerJumpAction()) {
      this.jumpBufferTimeLeft = 0;
    }
  }

  private activateComboBoostFromPlatformJumps(): void {
    this.flashSkillBoostTime = FLASH_SKILL_BOOST_DURATION_SEC;
    this.platformJumpChain = 0;
    this.spawnComboPopup('COMBO BOOST!');
    this.scoreboard?.triggerBeastBurst();
  }

  private triggerJumpAction(fromRightSwipe = false): boolean {
    if (!this.player.body.grounded || !!this.grapple) {
      return false;
    }
    this.physics.jump(this.player.body);
    if (!this.isFlashSkillBoostActive()) {
      this.platformJumpChain += 1;
      if (this.platformJumpChain >= COMBO_BOOST_JUMP_THRESHOLD) {
        this.activateComboBoostFromPlatformJumps();
      }
    }
    if (this.isFlashSkillBoostActive()) {
      const maxBoostJumpHeight = STAIRS.stepPx * FLASH_BOOST_STAIR_COUNT;
      const maxBoostJumpVy = -Math.sqrt(2 * PHYSICS.gravity * maxBoostJumpHeight);
      this.player.body.vy = maxBoostJumpVy;
    } else if (this.levelUpBoostTime > 0) {
      this.player.body.vy *= LEVEL_UP_BOOST_JUMP_MUL;
    }
    if (this.getHudClimbMeters() >= FLASH_SKILL_PERPETUAL_AFTER_HUD_METERS) {
      this.player.body.vy *= DEEP_RUN_JUMP_MULTIPLIER;
    }
    if (fromRightSwipe) {
      const body = this.player.body;
      const centerX = this.worldWidth * 0.5;
      const bodyCenterX = body.x + body.width * 0.5;
      const rightBias = Math.max(0, (bodyCenterX - centerX) / Math.max(1, this.worldWidth * 0.5));
      const inwardAssistVx = -(170 + rightBias * 250);
      // Keep existing stronger inward motion, otherwise bend trajectory toward screen center.
      body.vx = Math.min(body.vx, inwardAssistVx);
      this.jumpArcAssistDuration = this.input?.isTouchControlsActive() ? 0.4 : 0.28;
      this.jumpArcAssistTime = this.jumpArcAssistDuration;
      this.jumpArcStartCenterX = bodyCenterX;
      this.jumpArcTargetCenterX = centerX;
    }
    this.player.onJump();
    return true;
  }

  private createPlatforms(): void {
    this.platforms = [];
    this.clearPlatformSprites();
    const baseY = this.worldMaxY - 96;
    let y = baseY;
    // `resetRun` clears `cameraX` to 0 before this; spawn must use the same horizontal view as `snapCameraToPlayer`
    // (world-centered camera), otherwise every stair is laid out for the left edge of the world and disappears on mobile.
    const viewportW = this.worldWidthFromScreen();
    const maxCamX = Math.max(0, this.worldWidth - viewportW);
    const layoutCamX = Math.max(0, Math.min((this.worldWidth - viewportW) * 0.5, maxCamX));

    for (let index = 0; index < STAIRS.poolCount; index += 1) {
      const baseWidth = 150 + ((index * 37) % 80);
      const platform: Platform = {
        x: 0,
        y,
        width: 0,
        height: STAIRS.platformHeight,
        baseWidth,
        driftDir: Math.random() < 0.5 ? -1 : 1,
        driftVx: 0,
        stairId: index,
        kind: 'normal',
      };
      this.applyResponsivePlatformWidth(platform);
      if (index === 0) {
        const ideal = layoutCamX + viewportW * 0.5 - platform.width * 0.5;
        const { minX, maxX } = this.getPlatformSpawnHorizontalRange(platform.width, layoutCamX);
        platform.x = Math.max(minX, Math.min(ideal, maxX));
      } else {
        platform.x = this.computePlatformSpawnX(index, platform.width, layoutCamX);
      }
      this.platforms.push(platform);
      y -= this.computeStairGapPx(index);
    }

    this.nextStairId = STAIRS.poolCount - 1;
    this.createPlatformSprites();
  }

  /**
   * Steps that scroll below visible area move to the top with a new stairId so climbing is endless.
   */
  private recycleStairsOffscreen(): void {
    const feetY = this.player.body.y + this.player.body.height;
    const cameraCutoff = this.cameraY + this.worldHeightFromScreen() + STAIRS.recycleBelowScreenPx;
    const keepBelowPlayer =
      feetY + STAIRS.safetyStairBufferDrops * STAIRS.fallDeathStairRiseReferencePx;
    const cutoff = Math.max(cameraCutoff, keepBelowPlayer);
    const staying = this.platforms.filter((p) => p.y <= cutoff);
    if (staying.length === 0 || staying.length === this.platforms.length) {
      return;
    }

    const toRecycle = this.platforms.filter((p) => p.y > cutoff).sort((a, b) => b.y - a.y);
    let previousTopY = Math.min(...staying.map((p) => p.y));
    let spawnY = Math.min(
      Math.min(...staying.map((p) => p.y)) - STAIRS.stepPx,
      this.cameraY - 2000,
    );

    for (const p of toRecycle) {
      this.nextStairId += 1;
      p.stairId = this.nextStairId;
      p.y = this.pickNextPlatformY(previousTopY, spawnY);
      p.baseWidth = 150 + ((this.nextStairId * 37) % 80);
      p.driftDir = Math.random() < 0.5 ? -1 : 1;
      p.driftVx = 0;
      p.kind = this.isRestFloorY(p.y) ? 'rest' : 'normal';
      this.applyResponsivePlatformWidth(p);
      if (p.kind !== 'rest') {
        p.x = this.computePlatformSpawnX(this.nextStairId, p.width);
      }
      previousTopY = p.y;
      spawnY = p.y - this.computeStairGapPx(this.nextStairId);
    }
  }

  private pickNextPlatformY(previousTopY: number, normalY: number): number {
    const restY = this.getNextRestFloorYAbove(previousTopY);
    if (restY < previousTopY && restY >= normalY) {
      return restY;
    }
    return normalY;
  }

  private getNextRestFloorYAbove(worldY: number): number {
    const currentMeters = Math.max(0, (this.climbBaselineY - (worldY - this.player.body.height)) / 12);
    const nextMeters =
      Math.floor(currentMeters / REST_FLOOR_INTERVAL_METERS + 1) * REST_FLOOR_INTERVAL_METERS;
    return this.getRestFloorTopY(nextMeters);
  }

  private getRestFloorTopY(meters: number): number {
    return this.climbBaselineY - meters * 12 + this.player.body.height;
  }

  private getRestFloorMeters(platform: Platform): number | null {
    if (platform.kind !== 'rest') {
      return null;
    }
    const meters = Math.round((this.climbBaselineY - (platform.y - this.player.body.height)) / 12);
    return meters > 0 && meters % REST_FLOOR_INTERVAL_METERS === 0 ? meters : null;
  }

  private isRestFloorY(worldY: number): boolean {
    const meters = Math.round((this.climbBaselineY - (worldY - this.player.body.height)) / 12);
    if (meters <= 0 || meters % REST_FLOOR_INTERVAL_METERS !== 0) {
      return false;
    }
    return Math.abs(worldY - this.getRestFloorTopY(meters)) < 0.5;
  }

  private computeStairGapPx(stairId: number): number {
    const raw = Math.sin((stairId + 17) * 19.357) * 43758.5453;
    const unit = raw - Math.floor(raw);
    return STAIR_GAP_MIN_PX + unit * (STAIR_GAP_MAX_PX - STAIR_GAP_MIN_PX);
  }

  /** Left/right screen margin expressed in world pixels (matches visible “safe zone”). */
  private getViewportSafeMarginWorld(): number {
    return VIEWPORT_SAFE_MARGIN_SCREEN_PX / this.getCameraZoom();
  }

  /** Slightly narrower platforms on small screens so they don’t fill the whole view. */
  private getPlatformResponsiveWidthMul(): number {
    if (this.width <= 380) {
      return 0.78;
    }
    if (this.width <= MOBILE_NARROW_UI_MAX_W) {
      return 0.88;
    }
    return 1;
  }

  private applyResponsivePlatformWidth(platform: Platform): void {
    if (platform.kind === 'rest') {
      const bounds = this.getRestFloorPlatformBounds();
      platform.x = bounds.x;
      platform.width = bounds.width;
      this.updatePlatformBodyFromScale(platform);
      return;
    }
    const springPhaseMul = this.getSpringPhasePlatformWidthMul(platform.stairId);
    platform.width =
      platform.baseWidth *
      PLATFORM_SCALE *
      this.getPlatformResponsiveWidthMul() *
      springPhaseMul;
    this.updatePlatformBodyFromScale(platform);
  }

  /**
   * In the first Spring phase, widen some stairs so early gameplay uses both narrow and
   * noticeably wide layouts (requested "use all", including wider stairs).
   */
  private getSpringPhasePlatformWidthMul(stairId: number): number {
    if (stairId > SPRING_PHASE_STAIR_COUNT) {
      return 1;
    }
    // Deterministic pseudo-random by stair id: stable across frames/rebuilds.
    const raw = Math.sin((stairId + 11) * 31.719) * 43758.5453;
    const unit = raw - Math.floor(raw);
    if (unit < 0.22) {
      return 0.88;
    }
    if (unit < 0.52) {
      return 1;
    }
    if (unit < 0.8) {
      return 1.18;
    }
    return 1.32;
  }

  /**
   * Safe horizontal span for platform **left edge** X: current camera view minus margins,
   * clamped to world bounds (Phaser-style: between margin and gameWidth - margin - width).
   */
  private getPlatformSpawnHorizontalRange(
    platformWidth: number,
    viewOriginX: number = this.cameraX,
  ): { minX: number; maxX: number } {
    const marginW = this.getViewportSafeMarginWorld();
    const vw = this.worldWidthFromScreen();
    const viewLeft = viewOriginX + marginW;
    const viewRight = viewOriginX + vw - marginW;
    const pad = PLATFORM_EDGE_PADDING_PX;
    const minX = Math.max(WORLD_BOUNDS_X + pad, viewLeft);
    const maxX = Math.min(this.worldWidth - pad - platformWidth, viewRight - platformWidth);
    if (maxX <= minX) {
      const cx = viewOriginX + vw * 0.5 - platformWidth * 0.5;
      const clamped = Math.max(WORLD_BOUNDS_X + pad, Math.min(cx, this.worldWidth - pad - platformWidth));
      return { minX: clamped, maxX: clamped };
    }
    return { minX, maxX };
  }

  private computePlatformSpawnX(
    stairId: number,
    platformWidth: number,
    viewOriginX: number = this.cameraX,
  ): number {
    const { minX, maxX } = this.getPlatformSpawnHorizontalRange(platformWidth, viewOriginX);
    if (maxX <= minX) {
      return minX;
    }
    const raw = Math.sin((stairId + 1) * 12.9898) * 43758.5453;
    const unit = raw - Math.floor(raw);
    return minX + unit * (maxX - minX);
  }

  /** Keep chameleon inside the visible viewport (with safe margins), not only full world width. */
  private clampPlayerToCameraViewport(): void {
    const body = this.player.body;
    const marginW = this.getViewportSafeMarginWorld();
    const vw = this.worldWidthFromScreen();
    const viewLeft = this.cameraX + marginW;
    const viewRight = this.cameraX + vw - marginW - body.width;
    const worldMin = 0;
    const worldMax = this.worldWidth - body.width;
    const left = Math.max(worldMin, viewLeft);
    const right = Math.min(worldMax, viewRight);
    if (right < left) {
      body.x = Math.max(worldMin, Math.min(this.cameraX + vw * 0.5 - body.width * 0.5, worldMax));
      return;
    }
    if (body.x < left) {
      body.x = left;
      if (body.vx < 0) {
        body.vx = 0;
      }
    } else if (body.x > right) {
      body.x = right;
      if (body.vx > 0) {
        body.vx = 0;
      }
    }
  }

  /** After camera snap, keep the starting stair centered in the safe view band. */
  private centerStairZeroUnderCamera(): void {
    const p = this.platforms[0];
    if (!p) {
      return;
    }
    this.applyResponsivePlatformWidth(p);
    const vw = this.worldWidthFromScreen();
    const ideal = this.cameraX + vw * 0.5 - p.width * 0.5;
    const { minX, maxX } = this.getPlatformSpawnHorizontalRange(p.width);
    p.x = Math.max(minX, Math.min(ideal, maxX));
  }

  /**
   * Horizontally center on stair 0 (mobile layout). Vertically use the legacy spawn offset so the feet sit a few
   * pixels above the deck — exact feet-on-surface made the first physics frames look like a harsh drop/land.
   */
  private snapPlayerOntoStairZero(): void {
    const p = this.platforms[0];
    if (!p) {
      return;
    }
    const b = this.player.body;
    b.x = Math.round(p.x + p.width * 0.5 - b.width * 0.5);
    b.y = Math.round(this.worldMaxY - 100 - b.height);
  }

  private updatePlatformBodyFromScale(platform: Platform): void {
    // Custom physics uses this body directly; keep collider scale in exact sync with art scale.
    platform.height = STAIRS.platformHeight * PLATFORM_SCALE;
  }

  /** After a small viewport change (mobile URL bar), keep platforms and player inside the new width. */
  private clampEntitiesToWorldBounds(): void {
    const margin = PLATFORM_EDGE_PADDING_PX;
    const maxPx = Math.max(margin + 1, this.worldWidth - margin);
    for (const p of this.platforms) {
      if (p.kind === 'rest') {
        const bounds = this.getRestFloorPlatformBounds();
        p.x = bounds.x;
        p.width = bounds.width;
        this.updatePlatformBodyFromScale(p);
        continue;
      }
      if (p.x < margin) {
        p.x = margin;
      }
      if (p.x + p.width > maxPx) {
        p.x = Math.max(margin, maxPx - p.width);
      }
      this.updatePlatformBodyFromScale(p);
    }
    const body = this.player.body;
    body.x = Math.max(0, Math.min(body.x, this.worldWidth - body.width));
  }

  private syncPlatformSpritesFromPlatforms(): void {
    if (!this.platformTexture) {
      return;
    }

    const climbM = Math.max(0, Math.floor(-this.highestY / 12));

    let tex: Texture = this.platformTexture;
    let artMul = 1;

    if (climbM >= STAIRS.stormPlatformAfterMeters && this.platformTextureStorm !== undefined) {
      tex = this.platformTextureStorm;
      artMul = STAIRS.stormPlatformArtScale;
    } else if (climbM >= STAIRS.volcanoPlatformAfterMeters && this.platformTextureVolcano !== undefined) {
      tex = this.platformTextureVolcano;
      artMul = STAIRS.volcanoPlatformArtScale;
    } else if (climbM >= STAIRS.slimePlatformAfterMeters && this.platformTextureSlime !== undefined) {
      tex = this.platformTextureSlime;
      artMul = STAIRS.slimePlatformArtScale;
    } else if (climbM >= STAIRS.compactPlatformArtAfterMeters) {
      artMul = STAIRS.compactPlatformArtScale;
    }

    const useBeadBridge = climbM <= BEAD_BRIDGE_MAX_METERS;

    for (let i = 0; i < this.platforms.length; i += 1) {
      const platform = this.platforms[i];
      const root = this.platformSprites[i];
      if (!root) {
        continue;
      }

      if (platform.kind === 'rest') {
        root.visible = false;
        continue;
      }
      root.visible = true;

      if (useBeadBridge) {
        this.syncBeadBridgePlatformSprite(i, root, platform);
      } else {
        this.syncLegacyPlatformSprite(i, root, platform, tex, artMul);
      }
    }
  }

  private resetRun(): void {
    this.gameOver = false;
    this.finalMetersAtDeath = 0;
    this.deathSubmitted = false;
    this.lastLeaderboardTop = [];
    this.gameOverOverlay.visible = false;
    this.leaderboardOverlay.visible = false;
    this.scoreSavedHintTimeLeft = 0;
    if (this.gameOverScoreSavedHint) {
      this.gameOverScoreSavedHint.visible = false;
    }
    this.touchControlsLayer.visible = true;
    this.currentGroundPlatform = null;
    this.clearFloatingComboUi();
    this.score = 0;
    this.lastScoredStairId = -1;
    this.cameraX = 0;
    this.cameraY = 0;
    this.restFloorHoldY = null;
    this.highestY = 0;
    this.goldCount = 0;
    this.diamondCount = 0;
    this.collectibles = [];
    this.comboChain = 0;
    this.platformJumpChain = 0;
    this.jumpBufferTimeLeft = 0;
    this.lastChainTime = -1e9;
    this.runTime = 0;
    this.hurryUpTimeLeft = 0;
    this.paused = false;
    this.pauseOverlay.visible = false;
    this.headerPauseRoot.visible = true;
    this.attackBtnRoot.visible = true;
    this.healthHudRoot.visible = true;
    this.beastParticles = [];
    this.beastParticleSpawnAcc = 0;
    this.shakeTime = 0;
    this.shakeOffsetX = 0;
    this.shakeOffsetY = 0;
    this.velocityStressShakePhase = 0;
    this.speedTierUiFlashTime = 0;
    this.speedPulseGfx.visible = false;
    this.speedPulseGfx.alpha = 1;
    this.diamondShineSparks = [];
    this.level = 1;
    this.levelUpBannerTime = 0;
    this.levelUpParticles = [];
    this.action360State = null;
    this.action360Sparks = [];
    this.player.rotation = 0;
    this.flashSkillBoostTime = 0;
    this.beastComboAtLeastSixPrev = false;
    this.windParticles = [];
    this.windSpawnAcc = 0;
    this.syncBoostHudButtonsVisibility();
    this.jumpArcAssistTime = 0;
    this.jumpArcAssistDuration = 0;
    this.levelUpBoostTime = 0;
    this.shieldStock = 0;
    this.shieldTimeLeft = 0;
    this.player.isShielded = false;
    this.playerHealth = PLAYER_MAX_HEALTH;
    this.playerHealthCeilingThisRun = PLAYER_MAX_HEALTH;
    this.playerInvulnTime = 0;
    this.playerInvulnBlinkPhase = 0;
    this.player.alpha = 1;
    this.heartHudTransTime = 0;
    this.heartHudPulseAcc = 0;
    this.heartHudSegmentL = heartHudSegmentsFromPlayerHealth(this.playerHealth);
    this.heartHudTransFromL = this.heartHudSegmentL;
    this.refreshHealthHud();
    this.tongueBoostComboExtendUntil = -Infinity;
    this.tongueBoostComboResetAt = null;
    this.tongueBoostChainWindowSec = null;
    this.clearMushroomDeathEffects();
    this.currentBackgroundColor = this.getBackgroundColorForLevel(this.level);
    if (this.levelUpFloatText) {
      this.levelUpFloatText.visible = false;
    }
    this.createPlatforms();
    this.spawnCollectibleField();
    this.spawnMushroomEnemies();
    this.resetPlayer();
    this.snapCameraToPlayer();
    this.centerStairZeroUnderCamera();
    this.snapPlayerOntoStairZero();
    this.climbBaselineY = this.player.body.y;
    console.log(
      `1000m Rest Floor Y: ${this.getRestFloorTopY(REST_FLOOR_HOUSE_METERS).toFixed(2)}`,
    );
    this.spawnRestFloorHouse();
    this.scoreboard?.reset();
    this.hudGoldShown = this.goldCount;
    this.hudDiamondShown = this.diamondCount;
    this.collectibleHudBump = 0;
    this.collectibleHudRoot.scale.set(1);
    this.refreshCollectibleHudText();
    this.scoreboard?.setLevel(this.level);
    this.refreshAutoScrollHud();
    this.syncScrollSpeedTierBaseline();
  }

  private updateFlashSkillBoost(dt: number): void {
    const wasBoostActive = this.flashSkillBoostTime > 0;
    const beastModeActiveNow = this.getComboMultiplier() >= COMBO.beastModeMinMultiplier;

    if (this.flashSkillBoostTime > 0) {
      this.flashSkillBoostTime = Math.max(0, this.flashSkillBoostTime - dt);
    }
    // Arm a single `FLASH_SKILL_BOOST_DURATION_SEC` window when crossing into ×6+, then count down — never
    // refresh every frame while combo stays high (that trapped glow/jump boost and HUD buttons forever).
    if (beastModeActiveNow && !this.beastComboAtLeastSixPrev) {
      this.flashSkillBoostTime = FLASH_SKILL_BOOST_DURATION_SEC * this.getComboWindowAltitudeMultiplier();
    }
    this.beastComboAtLeastSixPrev = beastModeActiveNow;

    const deepRun =
      this.getHudClimbMeters() >= FLASH_SKILL_PERPETUAL_AFTER_HUD_METERS && beastModeActiveNow;
    if (deepRun) {
      const peg = FLASH_SKILL_BOOST_DURATION_SEC * this.getComboWindowAltitudeMultiplier();
      this.flashSkillBoostTime = Math.max(this.flashSkillBoostTime, peg);
    }

    // Requested behavior: while Combo/Flash boost is active, HP is fully restored.
    if (this.flashSkillBoostTime > 0 && this.playerHealth < PLAYER_MAX_HEALTH) {
      this.playerHealth = PLAYER_MAX_HEALTH;
      this.playerHealthCeilingThisRun = PLAYER_MAX_HEALTH;
      this.refreshHealthHud();
    }

    if (wasBoostActive && this.flashSkillBoostTime <= 0) {
      this.platformJumpChain = 0;
      this.resetBoostAbilitiesToNormal();
    }
    this.syncBoostHudButtonsVisibility();
  }

  private isFlashSkillBoostActive(): boolean {
    return this.flashSkillBoostTime > 0;
  }

  private resetBoostAbilitiesToNormal(): void {
    if (this.action360State) {
      this.stop360Action(true);
      return;
    }
    if (this.player.body.vy < 0) {
      const deepJumpMul =
        this.getHudClimbMeters() >= FLASH_SKILL_PERPETUAL_AFTER_HUD_METERS
          ? DEEP_RUN_JUMP_MULTIPLIER
          : 1;
      const normalJumpVy =
        -(PHYSICS.baseJump + Math.abs(this.player.body.vx) * PHYSICS.speedJumpBonus) * deepJumpMul;
      // If boost expired mid-air, clamp remaining upward speed back to normal jump ceiling.
      this.player.body.vy = Math.max(this.player.body.vy, normalJumpVy);
    }
  }

  private getScoreGainMultiplier(): number {
    return this.action360State?.phase === 'rotate' ? 3 : 1;
  }

  private perform360Action(): void {
    if (!this.canUseTongueGrapple() || this.action360State || this.grapple) {
      return;
    }
    const body = this.player.body;
    const shootX = body.x + body.width * 0.5;
    const shootY = body.y + body.height * 0.5;
    const hit = this.find360AttachTarget(shootX, shootY, body.width);
    if (!hit) {
      return;
    }
    this.action360State = {
      phase: 'attach',
      timeLeft: ACTION360_ATTACH_SEC,
      hookStairId: hit.platform.stairId,
      hookX: hit.x,
      hookY: hit.y,
      orbitRadius: 0,
      orbitBaseAngle: 0,
    };
    this.grapple = {
      phase: 'extend',
      targetX: hit.x,
      targetY: hit.y,
      extendT: 0,
      hookStairId: hit.platform.stairId,
      pullStartX: shootX,
      pullStartY: shootY,
    };
    body.vx = 0;
    body.vy = 0;
    body.grounded = false;
    this.touchPointers.clear();
    this.input?.clearTouchHolds();
  }

  private find360AttachTarget(
    shootX: number,
    shootY: number,
    bodyWidth: number,
  ): { x: number; y: number; platform: Platform } | undefined {
    const baseStairId =
      this.currentGroundPlatform?.stairId ??
      this.platforms
        .filter((p) => p.y >= this.player.body.y - 8)
        .reduce((best, p) => (best ? (p.y < best.y ? p : best) : p), undefined as Platform | undefined)
        ?.stairId ??
      this.lastScoredStairId;
    const targetStairId = baseStairId + ACTION360_TARGET_STAIRS_UP;
    const exactThirdUp = this.platforms.find(
      (p) => p.stairId === targetStairId && p.y + p.height < shootY,
    );
    if (exactThirdUp) {
      return {
        x: exactThirdUp.x + exactThirdUp.width * 0.5,
        y: exactThirdUp.y + exactThirdUp.height - 3,
        platform: exactThirdUp,
      };
    }

    const reach = STAIRS.stepPx * 5.2;
    const direct = Physics.castGrappleTarget(
      this.platforms,
      shootX,
      shootY,
      18,
      reach,
      Math.max(18, bodyWidth * 2.6),
      true,
    );
    if (direct) {
      return direct;
    }

    let best:
      | {
          score: number;
          x: number;
          y: number;
          platform: Platform;
        }
      | undefined;
    for (const p of this.platforms) {
      const bottom = p.y + p.height;
      if (bottom >= shootY) {
        continue;
      }
      const dy = shootY - bottom;
      if (dy > reach || dy < 18) {
        continue;
      }
      const px = p.x + p.width * 0.5;
      const dx = Math.abs(px - shootX);
      const score = dy * 1.35 + dx * 0.35;
      if (!best || score < best.score) {
        best = {
          score,
          x: px,
          y: bottom - 3,
          platform: p,
        };
      }
    }
    return best
      ? { x: best.x, y: best.y, platform: best.platform }
      : undefined;
  }

  private update360Action(dt: number): void {
    const state = this.action360State;
    if (!state) {
      this.player.rotation = 0;
      return;
    }
    const body = this.player.body;
    const attachPlatform = this.platforms.find((p) => p.stairId === state.hookStairId);
    if (!attachPlatform) {
      this.stop360Action(false);
      return;
    }
    if (state.phase === 'attach') {
      state.timeLeft = Math.max(0, state.timeLeft - dt);
      const attachProgress = 1 - state.timeLeft / ACTION360_ATTACH_SEC;
      if (this.grapple) {
        this.grapple.phase = 'extend';
        this.grapple.extendT = Math.min(GRAPPLE.extendSec, attachProgress * GRAPPLE.extendSec);
      }
      body.vx = 0;
      body.vy = 0;
      body.grounded = this.player.body.grounded;
      if (state.timeLeft <= 0) {
        const centerX = body.x + body.width * 0.5;
        const centerY = body.y + body.height * 0.5;
        if (this.grapple) {
          this.grapple.phase = 'pull';
          this.grapple.extendT = GRAPPLE.extendSec;
          this.grapple.pullStartX = centerX;
          this.grapple.pullStartY = centerY;
        }
        state.phase = 'rotate';
        state.timeLeft = ACTION360_ROTATE_SEC;
        const ox = centerX - state.hookX;
        const oy = centerY - state.hookY;
        const baseRadius = Math.hypot(ox, oy) * 1.62;
        const minOrbitRadius = Math.max(150, this.height * 0.24);
        const maxOrbitRadius = Math.max(minOrbitRadius + 20, this.height * 0.42);
        state.orbitRadius = Math.max(minOrbitRadius, Math.min(maxOrbitRadius, baseRadius));
        state.orbitBaseAngle = Math.atan2(oy, ox);
      }
      this.player.rotation = 0;
      return;
    }

    state.timeLeft = Math.max(0, state.timeLeft - dt);
    const t = 1 - state.timeLeft / ACTION360_ROTATE_SEC;
    const angle = state.orbitBaseAngle + t * Math.PI * 2 * ACTION360_ROTATIONS;
    const cx = state.hookX + Math.cos(angle) * state.orbitRadius;
    const cy = state.hookY + Math.sin(angle) * state.orbitRadius;
    body.x = cx - body.width * 0.5;
    body.y = cy - body.height * 0.5;
    body.vx = 0;
    body.vy = 0;
    body.grounded = false;
    this.player.rotation = angle + Math.PI * 0.5;
    this.spawnAction360Sparks(state.hookX, state.hookY);

    if (state.timeLeft <= 0) {
      this.stop360Action(true);
    }
  }

  private stop360Action(landOnPlatform: boolean): void {
    const state = this.action360State;
    this.action360State = null;
    this.player.rotation = 0;
    this.action360Sparks = [];
    if (landOnPlatform && state) {
      const platform = this.platforms.find((p) => p.stairId === state.hookStairId);
      if (platform) {
        this.player.body.x = platform.x + platform.width * 0.5 - this.player.body.width * 0.5;
        this.physics.snapToPlatform(this.player.body, platform);
        this.currentGroundPlatform = platform;
      }
    }
    this.grapple = null;
    this.flashSkillBoostTime = 0;
    this.syncBoostHudButtonsVisibility();
  }

  private spawnAction360Sparks(x: number, y: number): void {
    for (let i = 0; i < 3; i += 1) {
      const a = Math.random() * Math.PI * 2;
      const sp = 70 + Math.random() * 130;
      this.action360Sparks.push({
        x: x + (Math.random() - 0.5) * 18,
        y: y + (Math.random() - 0.5) * 18,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        age: 0,
        life: 0.28 + Math.random() * 0.2,
      });
    }
  }

  private updateAction360Sparks(dt: number): void {
    this.action360Sparks = this.action360Sparks
      .map((s) => ({
        ...s,
        age: s.age + dt,
        x: s.x + s.vx * dt,
        y: s.y + s.vy * dt,
        vx: s.vx * (1 - dt * 2.6),
        vy: s.vy * (1 - dt * 2.6),
      }))
      .filter((s) => s.age < s.life);
    if (this.action360Sparks.length > 180) {
      this.action360Sparks.splice(0, this.action360Sparks.length - 180);
    }
  }

  private drawAction360Sparks(): void {
    for (const s of this.action360Sparks) {
      const u = s.age / s.life;
      const alpha = (1 - u) * 0.95;
      const r = 2 + 4 * (1 - u);
      this.fxLayer.circle(s.x, s.y, r + 2).fill({ color: 0xffaa33, alpha: alpha * 0.25 });
      this.fxLayer.circle(s.x, s.y, r).fill({ color: 0xffe066, alpha });
      this.fxLayer.circle(s.x - 0.9, s.y - 0.9, r * 0.38).fill({ color: 0xffffff, alpha: alpha * 0.8 });
    }
  }

  private checkFallGameOver(): void {
    if (this.isRestFloorHolding()) {
      return;
    }
    const feetY = this.player.body.y + this.player.body.height;
    const deathLineY = this.getDeathPlaneWorldY();
    if (feetY <= deathLineY) {
      return;
    }
    this.platformJumpChain = 0;
    this.jumpBufferTimeLeft = 0;
    if (this.consumePlayerShield()) {
      this.performShieldSuperLaunch();
      return;
    }
    this.triggerGameOver();
  }

  private performShieldSuperLaunch(): void {
    this.grapple = null;
    this.grappleCooldown = 0;
    this.grappleReleaseDampingLeft = 0;
    this.currentGroundPlatform = null;
    const desiredRise = STAIRS.stepPx * SHIELD_SUPER_LAUNCH_STAIR_COUNT;
    let rise = desiredRise;
    if (this.platforms.length > 0) {
      const minTopY = Math.min(...this.platforms.map((p) => p.y));
      const feetY = this.player.body.y + this.player.body.height;
      const maxRise = feetY - minTopY + SHIELD_LAUNCH_MAX_FEET_ABOVE_TOP_PX;
      rise = Math.min(desiredRise, Math.max(0, maxRise));
    }
    this.player.body.y -= rise;
    this.player.body.vy = -Math.min(1750, 920 + rise * 0.38);
    /** Strong forward speed + no stair under that X reads as “black void”; damp hard after warp. */
    this.player.body.vx *= 0.32;
    this.player.body.grounded = false;
    this.highestY = Math.min(this.highestY, this.player.body.y);
    this.player.onJump();
    this.shakeTime = Math.max(this.shakeTime, 0.42);
    this.snapCameraToPlayer();
    for (let i = 0; i < SHIELD_LAUNCH_RECYCLE_PASSES; i += 1) {
      this.recycleStairsOffscreen();
    }
    this.syncPlatformSpritesFromPlatforms();
    const cx = this.player.body.x + this.player.body.width * 0.5;
    const cy = this.player.body.y + this.player.body.height * 0.45;
    for (let i = 0; i < 18; i += 1) {
      const a = (i / 18) * Math.PI * 2;
      const sp = 140 + Math.random() * 200;
      this.levelUpParticles.push({
        x: cx,
        y: cy,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 140,
        age: 0,
        life: 0.45 + Math.random() * 0.2,
      });
    }
  }

  /** Single source of truth for the bottom of the camera view in world space (death check + hazard art). */
  private getDeathPlaneWorldY(): number {
    return this.cameraY + this.worldHeightFromScreen();
  }

  private isRestFloorHolding(): boolean {
    return this.restFloorHoldY !== null;
  }

  private updateRestFloorHoldState(): void {
    const holdY = this.restFloorHoldY;
    if (holdY === null) {
      this.tryStartRestFloorHoldFromWorldPosition();
      return;
    }
    const feetY = this.player.body.y + this.player.body.height;
    if (!this.player.body.grounded && feetY <= holdY - REST_FLOOR_RESUME_ABOVE_PX) {
      this.restFloorHoldY = null;
    }
  }

  private tryStartRestFloorHoldFromWorldPosition(): void {
    const feetY = this.player.body.y + this.player.body.height;
    const restPlatform = this.platforms.find((p) => {
      if (p.kind !== 'rest') {
        return false;
      }
      const nearRestTop = feetY >= p.y - 2 && feetY <= p.y + p.height;
      const horizontallyOverRest =
        this.player.body.x + this.player.body.width > p.x && this.player.body.x < p.x + p.width;
      return nearRestTop && horizontallyOverRest;
    });
    if (restPlatform) {
      this.restFloorHoldY = restPlatform.y;
    }
  }

  private getRestFloorPlatformBounds(): { x: number; width: number } {
    const visibleWorldW = this.worldWidthFromScreen();
    const width = visibleWorldW * 2;
    return {
      x: this.cameraX - visibleWorldW * 0.5,
      width,
    };
  }

  private resetPlayer(): void {
    this.snapPlayerOntoStairZero();
    this.player.body.vx = 0;
    this.player.body.vy = 0;
    this.player.body.grounded = true;
    this.grapple = null;
    this.grappleCooldown = 0;
    this.grappleReleaseDampingLeft = 0;
    this.grappleReloadingLogged = false;
    this.lastScoredStairId = this.platforms[0]?.stairId ?? 0;
    this.lastScoredLandWorldTopY = this.platforms[0]?.y ?? Number.POSITIVE_INFINITY;
    this.player.update(0, 0, false, null, false, this.player.isShielded);
  }

  private landOn(platform: Platform): void {
    if (platform.kind === 'rest') {
      this.restFloorHoldY = platform.y;
    }
    this.ripples.push({
      x: this.player.body.x + this.player.body.width / 2,
      y: platform.y + 46,
      age: 0,
    });
  }

  private updateCamera(dt: number): void {
    this.highestY = Math.min(this.highestY, this.player.body.y);

    const viewportW = this.worldWidthFromScreen();
    const viewportH = this.worldHeightFromScreen();
    const playerCy = this.player.body.y + this.player.body.height * 0.5;
    this.cameraX = (this.worldWidth - viewportW) * 0.5;
    if (this.isRestFloorHolding()) {
      const maxCamX = Math.max(0, this.worldWidth - viewportW);
      this.cameraX = Math.max(0, Math.min(this.cameraX, maxCamX));
      this.world.position.set(-this.cameraX, -this.cameraY);
      this.layoutBackground();
      return;
    }
    // Death check uses `cameraY + worldHeightFromScreen()` — same as `drawBottomDeathLine` (viewport bottom in world space).
    this.cameraY -= this.getCameraScrollSpeedPx() * dt;
    const desiredPlayerScreenY = viewportH * 0.36;
    const forceUpCamY = playerCy - desiredPlayerScreenY;
    if (forceUpCamY < this.cameraY) {
      this.cameraY = forceUpCamY;
    }
    const maxCamX = Math.max(0, this.worldWidth - viewportW);
    this.cameraX = Math.max(0, Math.min(this.cameraX, maxCamX));
    this.cameraY = Math.min(0, this.cameraY);

    this.world.position.set(-this.cameraX, -this.cameraY);
    this.layoutBackground();
  }

  private snapCameraToPlayer(): void {
    const viewportW = this.worldWidthFromScreen();
    const viewportH = this.worldHeightFromScreen();
    this.cameraX = (this.worldWidth - viewportW) * 0.5;
    const maxCamX = Math.max(0, this.worldWidth - viewportW);
    this.cameraX = Math.max(0, Math.min(this.cameraX, maxCamX));
    const playerCy = this.player.body.y + this.player.body.height * 0.5;
    const desiredPlayerScreenY = viewportH * CAMERA_PLAYER_SCREEN_Y_RATIO;
    this.cameraY = playerCy - desiredPlayerScreenY;
    this.cameraY = Math.min(0, this.cameraY);
    this.cameraY = Math.max(this.worldMinY, this.cameraY);
    this.world.position.set(-this.cameraX, -this.cameraY);
    this.layoutBackground();
  }

  private prepareTextureForInfiniteTile(tex: Texture): void {
    tex.source.style.addressModeU = 'repeat';
    tex.source.style.addressModeV = 'repeat';
  }

  private async loadTextureFromCandidates(candidates: readonly string[]): Promise<Texture> {
    for (const url of candidates) {
      try {
        return (await Assets.load(url)) as Texture;
      } catch {
        /* try next extension */
      }
    }
    throw new Error(`No texture loaded for: ${candidates.join(' | ')}`);
  }

  /**
   * Builds `TilingSprite` layers (farthest → nearest). All layers must load, else one fallback
   * tiling sheet. Textures use **repeat** wrap for seamless `tilePosition` scrolling.
   */
  private async loadBackgroundTexture(): Promise<void> {
    for (const { tile } of this.bgParallaxLayers) {
      this.backgroundRoot.removeChild(tile);
      tile.destroy({ texture: false });
    }
    this.bgParallaxLayers = [];

    const pushTilingLayer = (tex: Texture, speed: number, vw: number, vh: number): void => {
      this.prepareTextureForInfiniteTile(tex);
      const tile = new TilingSprite({
        texture: tex,
        width: vw,
        height: vh,
      });
      tile.eventMode = 'none';
      tile.roundPixels = false;
      this.backgroundRoot.addChild(tile);
      this.bgParallaxLayers.push({ tile, speed });
    };

    const vw = Math.max(1, this.worldWidthFromScreen());
    const vh = Math.max(1, this.worldHeightFromScreen());

    try {
      for (const spec of BG7_PARALLAX_LAYERS) {
        const tex = await this.loadTextureFromCandidates(spec.candidates);
        pushTilingLayer(tex, spec.speed, vw, vh);
      }
    } catch {
      try {
        const tex = await this.loadTextureFromCandidates(BG7_FALLBACK_CANDIDATES);
        pushTilingLayer(tex, 0.45, vw, vh);
      } catch {
        /* leave empty — solid stage color shows through */
      }
    }

    if (!this.backgroundRoot.children.includes(this.bgBackdropFill)) {
      this.backgroundRoot.addChildAt(this.bgBackdropFill, 0);
    } else {
      this.backgroundRoot.setChildIndex(this.bgBackdropFill, 0);
    }
  }

  /** Slices `heart_counter-Sheet.png` into row frames for the animated HP HUD. */
  private async loadHeartCounterSheet(): Promise<void> {
    const sheet = (await Assets.load(HEART_COUNTER_SHEET_URL)) as Texture;
    const source = sheet.source;
    this.heartCounterTextures = [];
    for (let i = 0; i < HEART_COUNTER_FRAME_COUNT; i += 1) {
      this.heartCounterTextures.push(
        new Texture({
          source,
          frame: new Rectangle(0, i * HEART_COUNTER_FRAME_H, HEART_COUNTER_FRAME_W, HEART_COUNTER_FRAME_H),
        }),
      );
    }
  }

  /**
   * Letterbox under tiles + each `TilingSprite` sized to the logical canvas. Parallax: each
   * layer’s `tilePosition` tracks **camera** at its speed (10% / 30% / 60% / 100%) so depth reads
   * as the world scrolls. Textures tile infinitely via repeat wrap.
   */
  private layoutBackground(): void {
    const vw = this.worldWidthFromScreen();
    const vh = this.worldHeightFromScreen();
    this.backgroundRoot.position.set(0, 0);

    this.bgBackdropFill.clear();
    this.bgBackdropFill.rect(0, 0, vw, vh).fill({ color: this.currentBackgroundColor, alpha: 1 });

    for (const { tile, speed } of this.bgParallaxLayers) {
      tile.position.set(0, 0);
      tile.width = vw;
      tile.height = vh;
      tile.tilePosition.set(-this.cameraX * speed, -this.cameraY * speed);
    }
  }

  private updateScreenShake(dt: number): void {
    let ox = 0;
    let oy = 0;
    if (this.shakeTime > 0) {
      this.shakeTime -= dt;
      const k = Math.max(0, this.shakeTime / SCORE_UI.shakeDurationSec);
      const mag = SCORE_UI.shakeMaxPx * k;
      ox += (Math.random() - 0.5) * 2 * mag;
      oy += (Math.random() - 0.5) * 2 * mag;
    }

    const scrollMult = this.getAltitudeSpeedMultiplier();
    if (scrollMult >= ALTITUDE_STRESS_SHAKE_MULT_THRESHOLD) {
      const over = scrollMult - ALTITUDE_STRESS_SHAKE_MULT_THRESHOLD;
      const ramp = Math.min(1, over / 6);
      const stressMag = 1.2 + ramp * 6.5;
      this.velocityStressShakePhase += dt * (11 + scrollMult * 2.4);
      const ph = this.velocityStressShakePhase;
      ox += Math.sin(ph * 2.08) * stressMag * 0.52;
      oy += Math.cos(ph * 1.66) * stressMag * 0.42;
      ox += (Math.random() - 0.5) * stressMag * 0.34;
      oy += (Math.random() - 0.5) * stressMag * 0.34;
    }

    this.shakeOffsetX = ox;
    this.shakeOffsetY = oy;
    this.applyCameraTransform();
  }

  private maybeTriggerScreenShake(pointsDelta: number, mult: number): void {
    if (
      pointsDelta >= SCORE_UI.bigPointsThreshold ||
      (pointsDelta >= SCORE_UI.shakePointsFloor && mult >= SCORE_UI.shakeMinMultForFloor)
    ) {
      this.shakeTime = Math.max(this.shakeTime, SCORE_UI.shakeDurationSec);
    }
  }

  private updateRipples(dt: number): void {
    this.ripples = this.ripples
      .map((ripple) => ({ ...ripple, age: ripple.age + dt }))
      .filter((ripple) => ripple.age < 0.8);
  }

  private expireComboIfNeeded(): void {
    if (this.tongueBoostComboResetAt !== null && this.runTime >= this.tongueBoostComboResetAt) {
      this.tongueBoostComboResetAt = null;
      this.tongueBoostComboExtendUntil = -Infinity;
      this.tongueBoostChainWindowSec = null;
      this.comboChain = 0;
      this.lastChainTime = -1e9;
      return;
    }
    if (this.comboChain <= 0) {
      return;
    }
    const altEase = this.getComboWindowAltitudeMultiplier();
    const chainWindowSec =
      this.runTime < this.tongueBoostComboExtendUntil
        ? (this.tongueBoostChainWindowSec ?? TONGUE_COMBO_BOOST_DURATION_SEC)
        : COMBO.chainWindowSec * altEase;
    if (this.runTime - this.lastChainTime > chainWindowSec) {
      this.comboChain = 0;
    }
  }

  private getComboMultiplier(): number {
    if (this.comboChain <= 0) {
      return 1;
    }

    return Math.min(COMBO.maxMultiplier, this.comboChain);
  }

  private feedComboFromLand(): void {
    this.comboChain += 1;
    this.lastChainTime = this.runTime;
  }

  private feedComboFromGrapple(
    grappleGain: number,
    peakBonus: boolean,
    launchSpeed: number,
  ): void {
    let add = 1 + Math.max(0, grappleGain - 1);
    const launchNeed = COMBO.highLaunchSpeedPx / this.getComboWindowAltitudeMultiplier();
    if (peakBonus && launchSpeed >= launchNeed) {
      add += 1;
    }

    this.comboChain += add;
    this.lastChainTime = this.runTime;
  }

  private maybeSpawnComboPopup(mult: number): void {
    if (mult < 2) {
      return;
    }

    if (mult === SCORE_UI.apexComboMultiplier) {
      this.scoreboard?.triggerApexBurst();
    }

    if (mult >= COMBO.beastModeMinMultiplier) {
      this.scoreboard?.triggerBeastBurst();
    }

    const wordIndex = Math.min(
      COMBO.words.length - 1,
      Math.max(0, mult - 2),
    );
    this.spawnComboPopup(COMBO.words[wordIndex]);
  }

  private spawnComboPopup(text: string): void {
    const wx = this.player.body.x + this.player.body.width * 0.5;
    const wy = this.player.body.y + this.player.body.height * 0.4;
    const label = new Text({
      text,
      style: {
        fill: '#fff5e6',
        fontFamily: 'Arial Black, Impact, sans-serif',
        fontSize: 28,
        stroke: { color: '#4a1530', width: 5 },
        dropShadow: {
          alpha: 0.55,
          angle: Math.PI / 4,
          blur: 4,
          color: '#ff2288',
          distance: 3,
        },
      },
    });
    label.anchor.set(0.5);
    label.position.set(wx, wy);
    label.scale.set(0.35);
    label.alpha = 1;
    this.world.addChild(label);
    this.comboPopups.push({ label, t: 0, wx, wy });
  }

  private updateComboPopups(dt: number): void {
    const life = COMBO.floatLifeSec;
    const next: ComboPopup[] = [];

    for (const p of this.comboPopups) {
      p.t += dt;
      const u = p.t / life;
      if (u >= 1) {
        p.label.destroy();
        continue;
      }

      const popT = Math.min(1, p.t / COMBO.popInSec);
      const popScale = 0.4 + 0.8 * Math.sin((popT * Math.PI) / 2);
      const drift = COMBO.floatDriftPxPerSec * p.t;
      p.label.position.set(p.wx, p.wy - drift);
      p.label.alpha = 1 - u * u;
      p.label.scale.set(popScale * (1 - 0.12 * u));

      next.push(p);
    }

    this.comboPopups = next;
  }

  private updateBeastParticles(dt: number): void {
    const beast = this.isFlashSkillBoostActive();
    const spd = Math.hypot(this.player.body.vx, this.player.body.vy);

    if (beast && spd >= COMBO.beastParticleMinSpeed) {
      this.beastParticleSpawnAcc += dt;
      while (this.beastParticleSpawnAcc >= COMBO.beastParticleSpawnIntervalSec) {
        this.beastParticleSpawnAcc -= COMBO.beastParticleSpawnIntervalSec;
        const px =
          this.player.body.x +
          this.player.body.width * 0.5 +
          (Math.random() - 0.5) * 36;
        const py =
          this.player.body.y +
          this.player.body.height * 0.5 +
          (Math.random() - 0.5) * 28;
        this.beastParticles.push({ x: px, y: py, age: 0 });
      }
    } else {
      this.beastParticleSpawnAcc = 0;
    }

    this.beastParticles = this.beastParticles
      .map((p) => ({ ...p, age: p.age + dt }))
      .filter((p) => p.age < COMBO.beastParticleLifeSec);

    if (this.beastParticles.length > 40) {
      this.beastParticles.splice(0, this.beastParticles.length - 40);
    }
  }

  private clearFloatingComboUi(): void {
    for (const p of this.comboPopups) {
      p.label.destroy();
    }

    this.comboPopups = [];
  }

  private startBackgroundMusic(): void {
    this.stopBackgroundMusic();
    const bgm = new Audio(BGM_URL);
    bgm.loop = true;
    bgm.volume = 0.2;
    this.bgm = bgm;
    void bgm.play().catch(() => {
      /* autoplay: may need user gesture */
    });
  }

  private stopBackgroundMusic(): void {
    if (this.bgm) {
      this.bgm.pause();
      this.bgm.removeAttribute('src');
      this.bgm.load();
    }
    this.bgm = undefined;
  }

  private async tryLoadTongueArmature(): Promise<void> {
    this.tongueDbReady = false;
    this.tongueArmature?.dispose(true);
    this.tongueArmature = null;
    try {
      const [skeRes, texJsonRes] = await Promise.all([
        fetch(TONGUE_DB_SKE),
        fetch(TONGUE_DB_TEX_JSON),
      ]);
      if (!skeRes.ok || !texJsonRes.ok) {
        return;
      }
      const ske = (await skeRes.json()) as { armature?: Array<{ name?: string }> };
      const texJson = await texJsonRes.json();
      const tex = await Assets.load<Texture>(TONGUE_DB_TEX_PNG);
      const factory = PixiFactory.factory;
      factory.parseDragonBonesData(ske, 'tongue');
      factory.parseTextureAtlasData(texJson, tex, 'tongue');
      const armName = ske.armature?.[0]?.name ?? 'Armature';
      const display = factory.buildArmatureDisplay(armName, 'tongue');
      if (!display) {
        return;
      }
      display.eventMode = 'none';
      display.visible = false;
      display.animation.play(null, 0);
      this.tongueRoot.addChild(display);
      this.tongueArmature = display;
      this.tongueDbReady = true;
    } catch {
      this.tongueDbReady = false;
    }
  }

  private syncTongueArmatureToGrapple(
    mouth: { x: number; y: number },
    tip: { x: number; y: number },
    _beastMode: boolean,
  ): void {
    const arm = this.tongueArmature;
    if (!arm || !this.tongueDbReady) {
      return;
    }
    const dx = tip.x - mouth.x;
    const dy = tip.y - mouth.y;
    const len = Math.hypot(dx, dy);
    if (len < 4) {
      arm.visible = false;
      return;
    }
    arm.visible = true;
    arm.position.set(mouth.x, mouth.y);
    arm.rotation = Math.atan2(dy, dx) - Math.PI / 2;
    const stretch = (len / TONGUE_DB_REST_LENGTH_PX) * TONGUE_DB_BASE_SCALE;
    arm.scale.set(stretch);
    arm.tint = 0xffffff;
  }

  private spawnDiamondCollectShine(x: number, y: number): void {
    const n = 16;
    for (let i = 0; i < n; i += 1) {
      const a = (i / n) * Math.PI * 2 + (Math.random() - 0.5) * 0.55;
      const sp = 160 + Math.random() * 140;
      this.diamondShineSparks.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 0.34 + Math.random() * 0.14,
        age: 0,
      });
    }
  }

  private updateDiamondShineSparks(dt: number): void {
    this.diamondShineSparks = this.diamondShineSparks
      .map((s) => ({
        ...s,
        age: s.age + dt,
        x: s.x + s.vx * dt * 0.42,
        y: s.y + s.vy * dt * 0.42,
        vx: s.vx * (1 - dt * 2.8),
        vy: s.vy * (1 - dt * 2.8),
      }))
      .filter((s) => s.age < s.life);
    if (this.diamondShineSparks.length > 120) {
      this.diamondShineSparks.splice(0, this.diamondShineSparks.length - 120);
    }
  }

  private drawDiamondShineSparks(): void {
    for (const s of this.diamondShineSparks) {
      const u = s.age / s.life;
      const alpha = (1 - u) * 0.88;
      const r = 1.8 + 4.2 * (1 - u);
      this.fxLayer.circle(s.x, s.y, r + 2.5).fill({ color: 0x6af0ff, alpha: alpha * 0.22 });
      this.fxLayer.circle(s.x, s.y, r).fill({ color: 0xe8ffff, alpha });
      this.fxLayer.circle(s.x - 0.8, s.y - 0.8, r * 0.35).fill({ color: 0xffffff, alpha: alpha * 0.9 });
    }
  }

  private updateLevelProgress(): void {
    const nextLevel = Math.max(1, Math.min(LEVEL_MAX, 1 + Math.floor(this.score / LEVEL_SCORE_STEP)));
    if (nextLevel <= this.level) {
      return;
    }
    const previousMilestone = Math.floor(this.level / LEVEL_MILESTONE_STEP);
    const prevLevel = this.level;
    const gained = nextLevel - prevLevel;
    this.level = nextLevel;
    /** Combo boost: extend duration for each level tier crossed in one update (capped). */
    this.levelUpBoostTime = Math.min(
      LEVEL_UP_BOOST_TIME_CAP_SEC,
      this.levelUpBoostTime + LEVEL_UP_BOOST_DURATION_SEC * gained,
    );
    this.levelUpBannerTime = 1;
    this.spawnLevelUpParticles();
    this.scoreboard?.setLevel(this.level);
    this.scoreboard?.triggerLevelUp();
    const nextMilestone = Math.floor(this.level / LEVEL_MILESTONE_STEP);
    if (nextMilestone > previousMilestone) {
      this.currentBackgroundColor = this.getBackgroundColorForLevel(this.level);
      this.drawStaticWorld();
    }
  }

  private updatePlatformDifficulty(dt: number): void {
    void dt;
    const widthRatio = Math.max(0.5, 1 - this.level * LEVEL_PLATFORM_WIDTH_DECAY_RATIO_PER_LEVEL);
    const edgePad = PLATFORM_EDGE_PADDING_PX;
    for (const p of this.platforms) {
      if (p.kind === 'rest') {
        const bounds = this.getRestFloorPlatformBounds();
        p.x = bounds.x;
        p.width = bounds.width;
        p.driftVx = 0;
        this.updatePlatformBodyFromScale(p);
        continue;
      }
      const targetBaseWidth = Math.max(
        LEVEL_PLATFORM_MIN_BASE_WIDTH,
        p.baseWidth * widthRatio,
      );
      p.width = targetBaseWidth * PLATFORM_SCALE * this.getPlatformResponsiveWidthMul();
      p.driftVx = 0;
      if (p.x < edgePad) {
        p.x = edgePad;
      } else if (p.x + p.width > this.worldWidth - edgePad) {
        p.x = this.worldWidth - edgePad - p.width;
      }
      this.updatePlatformBodyFromScale(p);
    }
  }

  private getGravityScaleForLevel(): number {
    const gravityTier = Math.floor(this.level / 10);
    return 1 + gravityTier * 0.02;
  }

  private spawnLevelUpParticles(): void {
    const cx = this.player.body.x + this.player.body.width * 0.5;
    const cy = this.player.body.y + this.player.body.height * 0.5;
    for (let i = 0; i < 22; i += 1) {
      const a = (i / 22) * Math.PI * 2;
      const speed = 110 + Math.random() * 170;
      this.levelUpParticles.push({
        x: cx,
        y: cy,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed - 60,
        age: 0,
        life: 0.5 + Math.random() * 0.3,
      });
    }
  }

  private updateLevelUpParticles(dt: number): void {
    if (this.levelUpBannerTime > 0) {
      this.levelUpBannerTime = Math.max(0, this.levelUpBannerTime - dt);
    }
    this.levelUpParticles = this.levelUpParticles
      .map((p) => ({
        ...p,
        age: p.age + dt,
        x: p.x + p.vx * dt,
        y: p.y + p.vy * dt,
        vy: p.vy + 420 * dt,
      }))
      .filter((p) => p.age < p.life);
    if (!this.levelUpFloatText) {
      return;
    }
    if (this.levelUpBannerTime <= 0) {
      this.levelUpFloatText.visible = false;
      return;
    }
    const u = 1 - this.levelUpBannerTime;
    this.levelUpFloatText.visible = true;
    this.levelUpFloatText.position.set(
      this.player.body.x + this.player.body.width * 0.5,
      this.player.body.y - 26 - u * 24,
    );
    this.levelUpFloatText.alpha = (1 - u) * 0.95;
    this.levelUpFloatText.scale.set(0.92 + 0.22 * Math.sin(Math.min(1, u) * Math.PI));
  }

  private drawLevelUpParticles(): void {
    for (const p of this.levelUpParticles) {
      const u = p.age / p.life;
      const alpha = (1 - u) * 0.9;
      const r = 2 + 3 * (1 - u);
      this.fxLayer.circle(p.x, p.y, r).fill({ color: 0xffe066, alpha });
      this.fxLayer.circle(p.x - 1.2, p.y - 1.2, r * 0.45).fill({ color: 0xffffff, alpha: alpha * 0.7 });
    }
  }

  private getBackgroundColorForLevel(level: number): number {
    void level;
    return UI_BG_BLACK;
  }

  /** Pixels climbed upward from this run’s spawn baseline (`player.y` decreases when going up). */
  private getClimbHeightPx(): number {
    return Math.max(0, this.climbBaselineY - this.player.body.y);
  }

  /** Same climb units as HUD “m” (approx). */
  private getHudClimbMeters(): number {
    return this.getClimbHeightPx() / 12;
  }

  /** Faster tongue pull + lateral snap in deep runs (same HUD threshold as combo peg). */
  private getDeepRunGrapplePullMul(): number {
    return this.getHudClimbMeters() >= FLASH_SKILL_PERPETUAL_AFTER_HUD_METERS
      ? DEEP_RUN_GRAPPLE_PULL_SPEED_MULT
      : 1;
  }

  /**
   * Scroll / difficulty multiplier: 1× until `SCROLL_SPEED_WARMUP_METERS`, then +`SCROLL_SPEED_STEP_DELTA`
   * each `SCROLL_SPEED_STEP_METERS` (no cap; delta tripled vs legacy for faster scaling).
   */
  private getAltitudeSpeedMultiplier(): number {
    const m = this.getHudClimbMeters();
    if (m <= SCROLL_SPEED_WARMUP_METERS) {
      return 1;
    }
    const steps = Math.floor((m - SCROLL_SPEED_WARMUP_METERS) / SCROLL_SPEED_STEP_METERS);
    return 1 + SCROLL_SPEED_STEP_DELTA * steps;
  }

  /**
   * Widen combo / tongue timing as you climb: direct climb-height ease plus post-warmup scroll tier
   * (faster world still gets more chain window so boosts stay achievable).
   */
  private getComboWindowAltitudeMultiplier(): number {
    const m = Math.max(0, this.getHudClimbMeters());
    const climbSteps = Math.floor(m / COMBO_CLIMB_EASE_METERS_STEP);
    const climbEase = Math.min(COMBO_CLIMB_EASE_MAX, COMBO_CLIMB_EASE_PER_STEP * climbSteps);

    const scrollMult = this.getAltitudeSpeedMultiplier();
    const scrollSteps = Math.min(
      COMBO_SCROLL_EASE_MAX_STEPS,
      Math.max(0, scrollMult - 1),
    );
    const scrollEase = COMBO_SCROLL_EASE_COEF * scrollSteps;

    const deepEase =
      m >= FLASH_SKILL_PERPETUAL_AFTER_HUD_METERS ? COMBO_DEEP_RUN_EXTRA_ALTITUDE_EASE : 0;
    return 1 + climbEase + scrollEase + deepEase;
  }

  private getLevelUpBoostScrollMul(): number {
    return this.levelUpBoostTime > 0 ? LEVEL_UP_BOOST_SCROLL_MUL : 1;
  }

  private getCameraScrollSpeedPx(): number {
    return (
      AUTO_SCROLL_BASE_SPEED_PX * this.getAltitudeSpeedMultiplier() * this.getLevelUpBoostScrollMul()
    );
  }

  /** Tier index for speed feedback; 0 = warmup, 1 = first step above warmup, … */
  private getScrollSpeedTier(): number {
    const m = this.getHudClimbMeters();
    if (m <= SCROLL_SPEED_WARMUP_METERS) {
      return 0;
    }
    return Math.floor((m - SCROLL_SPEED_WARMUP_METERS) / SCROLL_SPEED_STEP_METERS);
  }

  private syncScrollSpeedTierBaseline(): void {
    this.lastScrollSpeedTier = this.getScrollSpeedTier();
  }

  private maybeAdvanceScrollSpeedTierFeedback(): void {
    const tier = this.getScrollSpeedTier();
    if (tier > this.lastScrollSpeedTier) {
      this.lastScrollSpeedTier = tier;
      if (tier > 0) {
        this.shakeTime = Math.max(this.shakeTime, SPEED_TIER_SHAKE_SEC);
        // Full-screen tier pulse removed — read as random white flashes / “cancelled overlay” on scroll.
      }
    }
  }

  private redrawSpeedPulseOverlay(): void {
    const g = this.speedPulseGfx;
    g.clear();
    g.rect(0, 0, this.width, this.height).fill({
      color: SPEED_TIER_PULSE_COLOR,
      alpha: SPEED_TIER_PULSE_FILL_ALPHA,
    });
  }

  private updateSpeedTierUiFlash(dt: number): void {
    if (this.speedTierUiFlashTime <= 0 || !this.speedPulseGfx.visible) {
      return;
    }
    this.speedTierUiFlashTime -= dt;
    const u = Math.max(0, this.speedTierUiFlashTime / SPEED_TIER_UI_FLASH_SEC);
    this.speedPulseGfx.alpha = u * 0.95;
    if (this.speedTierUiFlashTime <= 0) {
      this.speedPulseGfx.visible = false;
      this.speedPulseGfx.alpha = 1;
    }
  }

  /** Level-based horizontal stair drift before altitude scaling. */
  private getLevelScrollSpeedPx(): number {
    return LEVEL_PLATFORM_SPEED_BASE + this.level * LEVEL_PLATFORM_SPEED_PER_LEVEL;
  }

  /**
   * Effective platform drift speed (px/s): scales with climb height (same multiplier as camera scroll).
   */
  private getBaseScrollSpeedPx(): number {
    return (
      this.getLevelScrollSpeedPx() *
      this.getAltitudeSpeedMultiplier() *
      this.getLevelUpBoostScrollMul()
    );
  }

  private drawStaticWorld(): void {
    this.layoutBackground();
  }

  private drawDynamicWorld(): void {
    this.jelly.clear();
    this.platformLayer.clear();
    this.rippleLayer.clear();
    this.collectiblesGfx.clear();
    this.tongueVector.clear();
    this.fxLayer.clear();
    this.updateRestFloorCloudBreathing();

    if (this.tongueArmature && this.tongueDbReady) {
      this.tongueArmature.visible = false;
    }

    for (const ripple of this.ripples) {
      const radius = 28 + ripple.age * 130;
      const alpha = 1 - ripple.age / 0.8;
      this.rippleLayer
        .ellipse(ripple.x, ripple.y, radius, radius * 0.28)
        .stroke({ color: 0x8b5cff, alpha: alpha * 0.12, width: 1 });
    }

    this.drawWindParticles();
    this.drawBottomDeathLine();

    for (const platform of this.platforms) {
      this.drawCrystalPlatform(platform);
    }

    const grappleProgress = Player.computeGrappleAnimProgress(this.grapple, GRAPPLE.extendSec);
    const drawProceduralTongue =
      !!this.grapple &&
      (this.grapple.phase === 'pull' || grappleProgress < GRAPPLE.proceduralTongueUntil);
    if (drawProceduralTongue) {
      const mouth = this.getMouthWorld();
      const tip = this.getTongueTipWorld(mouth);
      const beastMode = this.getComboMultiplier() >= COMBO.beastModeMinMultiplier;
      if (this.tongueDbReady && this.tongueArmature) {
        this.syncTongueArmatureToGrapple(mouth, tip, beastMode);
      } else {
        this.drawGrappleTongue(mouth, tip, beastMode);
      }
    }

    this.drawCollectibles();
    this.drawDiamondShineSparks();
    this.drawAction360Sparks();
    this.drawLevelUpParticles();

    for (const p of this.beastParticles) {
      const u = p.age / COMBO.beastParticleLifeSec;
      const alpha = (1 - u) * 0.5;
      const r = 6 + 10 * (1 - u);
      this.fxLayer.circle(p.x, p.y, r).fill({ color: 0xff9933, alpha });
      this.fxLayer.circle(p.x - 2, p.y - 2, r * 0.45).fill({ color: 0xffeeaa, alpha: alpha * 0.9 });
    }
  }

  private getMouthWorld(): { x: number; y: number } {
    const b = this.player.body;
    const cx = b.x + b.width * 0.5;
    const cy = b.y + b.height * 0.5;
    const grappleVerticalX = this.grapple ? cx : cx + this.player.direction * GRAPPLE.mouthOffsetX;
    return {
      x: grappleVerticalX,
      y: cy + GRAPPLE.mouthOffsetY,
    };
  }

  private getTongueTipWorld(mouth: { x: number; y: number }): { x: number; y: number } {
    if (!this.grapple) {
      return mouth;
    }

    if (this.grapple.phase === 'extend') {
      const t = Math.min(1, this.grapple.extendT / GRAPPLE.extendSec);
      return {
        x: mouth.x + (this.grapple.targetX - mouth.x) * t,
        y: mouth.y + (this.grapple.targetY - mouth.y) * t,
      };
    }

    return { x: this.grapple.targetX, y: this.grapple.targetY };
  }

  private setupCollectibleHud(app: Application): void {
    void app;
    this.collectibleHudGoldText = new Text({
      text: '0',
      style: this.createNeonGoldTextStyle(19, 3),
    });
    this.collectibleHudDiamondText = new Text({
      text: '0',
      style: this.createNeonGoldTextStyle(19, 3),
    });
    this.collectibleHudShieldText = new Text({
      text: '0',
      style: this.createNeonGoldTextStyle(19, 3),
    });
    this.collectibleHudGoldText.anchor.set(0, 0.5);
    this.collectibleHudDiamondText.anchor.set(0, 0.5);
    this.collectibleHudShieldText.anchor.set(0, 0.5);
    this.collectibleHudRoot.addChild(
      this.collectibleHudGoldIcon,
      this.collectibleHudDiamondIcon,
      this.collectibleHudShieldIcon,
      this.collectibleHudGoldText,
      this.collectibleHudDiamondText,
      this.collectibleHudShieldText,
    );
    this.collectibleHudRoot.zIndex = 1008;
    this.uiLayer.addChild(this.collectibleHudRoot);
    this.drawCollectibleIcons();
  }

  /** Tongue grapple is only available during Flash skill boost (beast combo activation window). */
  private canUseTongueGrapple(): boolean {
    return this.isFlashSkillBoostActive();
  }

  private setupTongueBoostButton(app: Application): void {
    void app;
    this.tongueBoostButtonRoot.zIndex = 1002;
    this.tongueBoostButtonGfx.eventMode = 'static';
    this.tongueBoostButtonGfx.cursor = 'pointer';
    this.tongueBoostLabel = new Text({
      text: 'TONGUE',
      style: this.createNeonGoldTextStyle(12, 2),
    });
    this.tongueBoostLabel.anchor.set(0.5);
    this.tongueBoostLabel.position.set(TONGUE_BOOST_BTN_W * 0.5, TONGUE_BOOST_BTN_H * 0.5);
    this.tongueBoostLabel.eventMode = 'none';
    this.tongueBoostButtonRoot.addChild(this.tongueBoostButtonGfx, this.tongueBoostLabel);
    this.tongueBoostButtonGfx.on('pointerdown', this.handleTongueBoostButtonDown);
    this.tongueBoostButtonGfx.on('pointerup', this.handleTongueBoostButtonUp);
    this.tongueBoostButtonGfx.on('pointerupoutside', this.handleTongueBoostButtonUp);
    this.tongueBoostButtonGfx.on('pointercancel', this.handleTongueBoostButtonUp);
    this.uiLayer.addChild(this.tongueBoostButtonRoot);
    this.redrawTongueBoostButton(false);
    this.syncBoostHudButtonsVisibility();
  }

  private setupAction360Button(app: Application): void {
    void app;
    this.action360ButtonRoot.zIndex = 1001;
    this.action360ButtonGfx.eventMode = 'static';
    this.action360ButtonGfx.cursor = 'pointer';
    this.action360ButtonLabel = new Text({
      text: '360',
      style: this.createNeonGoldTextStyle(12, 2),
    });
    this.action360ButtonLabel.anchor.set(0.5);
    this.action360ButtonLabel.position.set(TONGUE_BOOST_BTN_W * 0.5, TONGUE_BOOST_BTN_H * 0.5);
    this.action360ButtonLabel.eventMode = 'none';
    this.action360ButtonRoot.addChild(this.action360ButtonGfx, this.action360ButtonLabel);
    this.action360ButtonGfx.on('pointerdown', this.handleAction360ButtonDown);
    this.action360ButtonGfx.on('pointerup', this.handleAction360ButtonUp);
    this.action360ButtonGfx.on('pointerupoutside', this.handleAction360ButtonUp);
    this.action360ButtonGfx.on('pointercancel', this.handleAction360ButtonUp);
    this.uiLayer.addChild(this.action360ButtonRoot);
    this.redrawAction360Button(false);
    this.syncBoostHudButtonsVisibility();
  }

  private redrawAction360Button(pressed: boolean): void {
    const gfx = this.action360ButtonGfx;
    gfx.clear();
    const accent = UI_NEON_GREEN;
    const boost = pressed ? 1.25 : 1;
    gfx.roundRect(0, 0, TONGUE_BOOST_BTN_W, TONGUE_BOOST_BTN_H, 10).fill({
      color: UI_PANEL_PURPLE,
      alpha: pressed ? 0.9 : 0.78,
    });
    gfx.roundRect(0, 0, TONGUE_BOOST_BTN_W, TONGUE_BOOST_BTN_H, 10).stroke({
      color: accent,
      alpha: pressed ? 0.98 : 0.85,
      width: pressed ? 2.4 : 2,
    });
    gfx.roundRect(2, 2, TONGUE_BOOST_BTN_W - 4, TONGUE_BOOST_BTN_H - 4, 8).stroke({
      color: accent,
      alpha: 0.22 * boost,
      width: 1,
    });
    if (this.action360ButtonLabel) {
      this.action360ButtonLabel.alpha = pressed ? 1 : 0.92;
    }
  }

  private readonly handleAction360ButtonDown = (event: FederatedPointerEvent): void => {
    if (!this.isFlashSkillBoostActive()) {
      return;
    }
    event.stopPropagation();
    this.action360ButtonPressed = true;
    this.redrawAction360Button(true);
    this.perform360Action();
  };

  private readonly handleAction360ButtonUp = (): void => {
    this.action360ButtonPressed = false;
    this.redrawAction360Button(false);
  };

  private setupClimbHud(app: Application): void {
    void app;
    this.climbHudText = new Text({
      text: '',
      style: this.createNeonGoldTextStyle(13, 2),
    });
    this.climbHudText.anchor.set(1, 0);
    this.climbHudText.zIndex = 1003;
    this.climbHudText.alpha = 0.9;
    this.uiLayer.addChild(this.climbHudText);
    this.layoutClimbHud();
    this.refreshClimbHudText();
  }

  private layoutClimbHud(): void {
    if (!this.climbHudText) {
      return;
    }
    this.climbHudText.position.set(this.width - 20, UI_SAFE_PAD_TOP + 34);
  }

  private refreshClimbHudText(): void {
    if (!this.climbHudText) {
      return;
    }
    const mult = this.getAltitudeSpeedMultiplier();
    const mApprox = Math.round(this.getClimbHeightPx() / 12);
    this.climbHudText.text = `${mApprox}M  |  SPD x${mult.toFixed(2)}`;
  }

  private createNeonGoldTextStyle(size: number, strokeWidth: number): TextStyle {
    return new TextStyle({
      fontFamily: 'Orbitron, "Press Start 2P", Arial Black, sans-serif',
      fontSize: size,
      fontWeight: '800',
      fill: '#FFD700',
      stroke: { color: '#5a3d00', width: strokeWidth },
      letterSpacing: 1.1,
      dropShadow: {
        color: '#ffd700',
        alpha: 0.65,
        blur: 6,
        angle: Math.PI / 4,
        distance: 0,
      },
    });
  }

  /** Compact gold style for leaderboard rows — fits narrow panels without clipping. */
  private createLeaderboardRowTextStyle(wordWrapWidth: number): TextStyle {
    const narrow = this.width <= MOBILE_NARROW_UI_MAX_W;
    return new TextStyle({
      fontFamily: 'Orbitron, "Press Start 2P", Arial Black, sans-serif',
      fontSize: narrow ? 11 : 13,
      fontWeight: '800',
      fill: '#FFD700',
      stroke: { color: '#5a3d00', width: narrow ? 1.2 : 1.6 },
      letterSpacing: narrow ? 0.2 : 0.4,
      wordWrap: true,
      wordWrapWidth: Math.max(40, wordWrapWidth),
      breakWords: true,
      dropShadow: {
        color: '#ffd700',
        alpha: 0.55,
        blur: 4,
        angle: Math.PI / 4,
        distance: 0,
      },
    });
  }

  private drawTopHeaderPanel(): void {
    const w = this.width;
    const y = UI_SAFE_PAD_TOP;
    const r = 18;
    this.headerPanel.clear();
    this.headerPanel.roundRect(12, y, w - 24, UI_HEADER_H, r).fill({
      color: UI_PANEL_PURPLE,
      alpha: 0.42,
    });
    this.headerPanel.roundRect(12, y, w - 24, UI_HEADER_H, r).stroke({
      color: UI_NEON_GREEN,
      width: 2,
      alpha: 0.66,
    });
    this.headerPanel.roundRect(15, y + 3, w - 30, UI_HEADER_H - 6, r - 3).fill({
      color: 0x6f33a6,
      alpha: 0.12,
    });
    if (!this.uiLayer.children.includes(this.headerPanel)) {
      this.headerPanel.zIndex = 1000;
      this.uiLayer.addChild(this.headerPanel);
    }
  }

  private drawCollectibleIcons(): void {
    this.collectibleHudGoldIcon.clear();
    this.collectibleHudGoldIcon.circle(10, 0, 9).fill({ color: UI_GOLD, alpha: 0.9 });
    this.collectibleHudGoldIcon.circle(10, 0, 9).stroke({ color: UI_NEON_GREEN, width: 1.5, alpha: 0.75 });
    this.collectibleHudGoldIcon
      .moveTo(10, -5)
      .lineTo(12, -1)
      .lineTo(16, -1)
      .lineTo(13, 1.8)
      .lineTo(14.3, 6)
      .lineTo(10, 3.4)
      .lineTo(5.7, 6)
      .lineTo(7, 1.8)
      .lineTo(4, -1)
      .lineTo(8, -1)
      .lineTo(10, -5)
      .fill({ color: 0xffffff, alpha: 0.45 });

    this.collectibleHudDiamondIcon.clear();
    this.collectibleHudDiamondIcon
      .moveTo(10, -9)
      .lineTo(18, 0)
      .lineTo(10, 10)
      .lineTo(2, 0)
      .lineTo(10, -9)
      .fill({ color: 0x9fe8ff, alpha: 0.95 });
    this.collectibleHudDiamondIcon
      .moveTo(10, -9)
      .lineTo(18, 0)
      .lineTo(10, 10)
      .lineTo(2, 0)
      .lineTo(10, -9)
      .stroke({ color: UI_NEON_GREEN, width: 1.5, alpha: 0.82 });
    this.collectibleHudDiamondIcon
      .moveTo(10, -8)
      .lineTo(10, 9)
      .moveTo(2, 0)
      .lineTo(18, 0)
      .stroke({ color: 0xffffff, width: 1, alpha: 0.35 });

    this.collectibleHudShieldIcon.clear();
    this.collectibleHudShieldIcon
      .moveTo(10, -7)
      .lineTo(16, 3)
      .lineTo(10, 9)
      .lineTo(4, 3)
      .closePath()
      .fill({ color: 0x66ccff, alpha: 0.92 })
      .stroke({ color: UI_NEON_GREEN, width: 1.5, alpha: 0.82 });
    this.collectibleHudShieldIcon
      .roundRect(6.5, -4, 7, 7, 1.5)
      .fill({ color: 0x4060a0, alpha: 0.45 })
      .stroke({ color: 0xc8ffff, width: 1, alpha: 0.7 });
  }

  private drawHurryBanner(): void {
    const w = 440;
    const h = HURRY_BANNER_H;
    const r = h * 0.5;
    this.hurryBannerGfx.clear();
    this.hurryBannerGfx.roundRect(0, 0, w, h, r).fill({ color: UI_PANEL_PURPLE, alpha: 0.94 });
    this.hurryBannerGfx.roundRect(0, 0, w, h, r).stroke({ color: UI_NEON_GREEN, width: 2.2, alpha: 0.95 });
    this.hurryBannerGfx.roundRect(3, 3, w - 6, h - 6, r - 3).stroke({
      color: UI_NEON_GREEN,
      width: 1,
      alpha: 0.26,
    });
    this.hurryBannerText?.position.set(w * 0.5, h * 0.5);
  }

  private setupGameOverUi(): void {
    this.gameOverOverlay.eventMode = 'passive';
    this.gameOverOverlay.interactiveChildren = true;
    this.gameOverBackdrop.eventMode = 'static';
    this.gameOverBackdrop.on('pointerdown', (event) => {
      event.stopPropagation();
    });
    this.gameOverBackdrop.on('pointertap', (event) => {
      event.stopPropagation();
    });
    this.gameOverPanel.eventMode = 'none';
    this.gameOverOverlay.visible = false;
    this.gameOverOverlay.zIndex = 1200;
    this.gameOverBackdrop.alpha = OVERLAY_BG_ALPHA;
    this.gameOverOverlay.addChild(this.gameOverBackdrop, this.gameOverPanel);

    this.gameOverTitle = new Text({
      text: 'GAME OVER',
      style: this.createNeonGoldTextStyle(36, 4),
    });
    this.gameOverTitle.anchor.set(0.5);
    this.gameOverTitle.eventMode = 'none';
    this.gameOverScoreText = new Text({
      text: '0 m',
      style: this.createNeonGoldTextStyle(24, 3),
    });
    this.gameOverScoreText.anchor.set(0.5);
    this.gameOverScoreText.eventMode = 'none';

    this.gameOverRestartBtn.eventMode = 'static';
    this.gameOverRestartBtn.cursor = 'pointer';
    this.gameOverRestartBtn.on('pointerdown', (event) => {
      event.stopPropagation();
      this.resetRun();
    });
    this.gameOverRestartBtn.on('pointertap', (event) => {
      event.stopPropagation();
      this.resetRun();
    });
    this.gameOverRestartLabel = new Text({
      text: 'PLAY AGAIN',
      style: this.createNeonGoldTextStyle(16, 2),
    });
    this.gameOverRestartLabel.anchor.set(0.5);
    this.gameOverRestartLabel.eventMode = 'none';

    this.gameOverLeaderboardBtn.eventMode = 'static';
    this.gameOverLeaderboardBtn.cursor = 'pointer';
    this.gameOverLeaderboardBtn.on('pointerdown', (event) => {
      event.stopPropagation();
      void this.openLeaderboardOverlay();
    });
    this.gameOverLeaderboardBtn.on('pointertap', (event) => {
      event.stopPropagation();
      void this.openLeaderboardOverlay();
    });
    this.gameOverLeaderboardLabel = new Text({
      text: 'LEADERBOARD',
      style: this.createNeonGoldTextStyle(16, 2),
    });
    this.gameOverLeaderboardLabel.anchor.set(0.5);
    this.gameOverLeaderboardLabel.eventMode = 'none';

    this.gameOverScoreSavedHint = new Text({
      text: 'Score saved',
      style: new TextStyle({
        fontFamily: 'Urbanist, Orbitron, sans-serif',
        fontSize: 12,
        fontWeight: '600',
        fill: '#7dffa8',
        letterSpacing: 0.6,
      }),
    });
    this.gameOverScoreSavedHint.anchor.set(0.5, 1);
    this.gameOverScoreSavedHint.eventMode = 'none';
    this.gameOverScoreSavedHint.visible = false;

    this.gameOverOverlay.addChild(
      this.gameOverTitle,
      this.gameOverScoreText,
      this.gameOverRestartBtn,
      this.gameOverRestartLabel,
      this.gameOverLeaderboardBtn,
      this.gameOverLeaderboardLabel,
      this.gameOverScoreSavedHint,
    );

    this.leaderboardOverlay.eventMode = 'passive';
    this.leaderboardOverlay.interactiveChildren = true;
    this.leaderboardBackdrop.eventMode = 'static';
    this.leaderboardBackdrop.on('pointerdown', (event) => {
      event.stopPropagation();
    });
    this.leaderboardBackdrop.on('pointertap', (event) => {
      event.stopPropagation();
    });
    this.leaderboardPanel.eventMode = 'none';
    this.leaderboardOverlay.visible = false;
    this.leaderboardOverlay.zIndex = 1250;
    this.leaderboardBackdrop.alpha = OVERLAY_BG_ALPHA;
    this.leaderboardOverlay.addChild(
      this.leaderboardBackdrop,
      this.leaderboardPanel,
    );
    this.leaderboardTitle = new Text({
      text: 'GLOBAL TOP 5',
      style: this.createNeonGoldTextStyle(30, 3),
    });
    this.leaderboardTitle.anchor.set(0.5);
    this.leaderboardTitle.eventMode = 'none';
    this.leaderboardLoadingText = new Text({
      text: 'Loading...',
      style: this.createNeonGoldTextStyle(18, 2),
    });
    this.leaderboardLoadingText.anchor.set(0.5);
    this.leaderboardLoadingText.eventMode = 'none';

    this.leaderboardCloseBtn.eventMode = 'static';
    this.leaderboardCloseBtn.cursor = 'pointer';
    this.leaderboardCloseBtn.on('pointerdown', (event) => {
      event.stopPropagation();
      this.leaderboardOverlay.visible = false;
    });
    this.leaderboardCloseBtn.on('pointertap', (event) => {
      event.stopPropagation();
      this.leaderboardOverlay.visible = false;
    });
    this.leaderboardCloseLabel = new Text({
      text: 'CLOSE',
      style: this.createNeonGoldTextStyle(20, 2),
    });
    this.leaderboardCloseLabel.anchor.set(0.5);
    this.leaderboardCloseLabel.eventMode = 'none';

    this.leaderboardOverlay.addChild(
      this.leaderboardTitle,
      this.leaderboardLoadingText,
      this.leaderboardCloseBtn,
      this.leaderboardCloseLabel,
    );

    this.uiLayer.addChild(this.gameOverOverlay, this.leaderboardOverlay);
    this.layoutGameOverUi();
  }

  private layoutGameOverUi(): void {
    const overlayW = this.width;
    const overlayH = this.height;
    const panelW = Math.min(560, overlayW - 44);
    const panelH = Math.min(460, overlayH - 120);
    const px = (overlayW - panelW) * 0.5;
    const py = (overlayH - panelH) * 0.5;

    this.gameOverBackdrop.clear();
    this.gameOverBackdrop.rect(0, 0, overlayW, overlayH).fill({ color: 0x000000, alpha: 1 });
    this.gameOverPanel.clear();
    this.gameOverPanel.roundRect(px, py, panelW, panelH, 18).fill({ color: UI_PANEL_PURPLE, alpha: 0.78 });
    this.gameOverPanel.roundRect(px, py, panelW, panelH, 18).stroke({
      color: UI_NEON_GREEN,
      width: 2,
      alpha: 0.7,
    });

    this.gameOverTitle?.position.set(overlayW * 0.5, py + 68);
    this.gameOverScoreText?.position.set(overlayW * 0.5, py + 128);

    const btnW = Math.min(320, panelW - 70);
    const btnH = 54;
    const btnX = overlayW * 0.5 - btnW * 0.5;
    const restartY = py + panelH - 168;
    const boardY = py + panelH - 98;
    this.drawOverlayButton(this.gameOverRestartBtn, btnX, restartY, btnW, btnH);
    this.drawOverlayButton(this.gameOverLeaderboardBtn, btnX, boardY, btnW, btnH);
    this.gameOverRestartBtn.hitArea = new Rectangle(btnX, restartY, btnW, btnH);
    this.gameOverLeaderboardBtn.hitArea = new Rectangle(btnX, boardY, btnW, btnH);
    this.gameOverRestartLabel?.position.set(overlayW * 0.5, restartY + btnH * 0.5);
    this.gameOverLeaderboardLabel?.position.set(overlayW * 0.5, boardY + btnH * 0.5);
    this.gameOverScoreSavedHint?.position.set(overlayW * 0.5, overlayH - 18);

    this.leaderboardBackdrop.clear();
    this.leaderboardBackdrop.rect(0, 0, overlayW, overlayH).fill({ color: 0x000000, alpha: 1 });
    this.renderLeaderboardShell();
  }

  private setupPauseUi(): void {
    this.pauseOverlay.eventMode = 'passive';
    this.pauseOverlay.interactiveChildren = true;
    this.pauseOverlay.visible = false;
    this.pauseOverlay.zIndex = 1260;
    this.pauseBackdrop.eventMode = 'static';
    this.pauseBackdrop.on('pointerdown', (event) => {
      event.stopPropagation();
    });
    this.pauseBackdrop.on('pointertap', (event) => {
      event.stopPropagation();
    });
    this.pausePanel.eventMode = 'none';
    this.pauseTitle = new Text({
      text: 'PAUSED',
      style: this.createNeonGoldTextStyle(34, 4),
    });
    this.pauseTitle.anchor.set(0.5);
    this.pauseTitle.eventMode = 'none';
    this.pauseResumeBtn.eventMode = 'static';
    this.pauseResumeBtn.cursor = 'pointer';
    this.pauseResumeBtn.on('pointerdown', (event) => {
      event.stopPropagation();
      this.resumeFromPause();
    });
    this.pauseResumeBtn.on('pointertap', (event) => {
      event.stopPropagation();
      this.resumeFromPause();
    });
    this.pauseResumeLabel = new Text({
      text: 'RESUME',
      style: this.createNeonGoldTextStyle(22, 3),
    });
    this.pauseResumeLabel.anchor.set(0.5);
    this.pauseResumeLabel.eventMode = 'none';
    this.pauseTouchLockLabel = new Text({
      text: '',
      style: new TextStyle({
        fontFamily: 'Heebo, Orbitron, Arial, sans-serif',
        fontSize: 12,
        fontWeight: '700',
        fill: '#b8ffd4',
        stroke: { color: '#102818', width: 3 },
        align: 'center',
        wordWrap: true,
        wordWrapWidth: Math.min(340, Math.max(220, this.width - 48)),
      }),
    });
    this.pauseTouchLockLabel.anchor.set(0.5);
    this.pauseTouchLockLabel.eventMode = 'static';
    this.pauseTouchLockLabel.cursor = 'pointer';
    this.pauseTouchLockLabel.on('pointerdown', (event) => {
      event.stopPropagation();
    });
    this.pauseTouchLockLabel.on('pointertap', (event) => {
      event.stopPropagation();
      this.toggleTouchGlobalSteeringSetting();
    });
    this.pauseOverlay.addChild(
      this.pauseBackdrop,
      this.pausePanel,
      this.pauseTitle,
      this.pauseTouchLockLabel,
      this.pauseResumeBtn,
      this.pauseResumeLabel,
    );
    this.uiLayer.addChild(this.pauseOverlay);
    this.layoutPauseOverlay();
  }

  private layoutPauseOverlay(): void {
    const overlayW = this.width;
    const overlayH = this.height;
    this.pauseBackdrop.clear();
    this.pauseBackdrop.rect(0, 0, overlayW, overlayH).fill({ color: 0x000000, alpha: 0.62 });
    const panelW = Math.min(400, overlayW - 40);
    const panelH = Math.min(360, overlayH - 72);
    const px = (overlayW - panelW) * 0.5;
    const py = (overlayH - panelH) * 0.5;
    this.pausePanel.clear();
    this.pausePanel.roundRect(px, py, panelW, panelH, 18).fill({ color: UI_PANEL_PURPLE, alpha: 0.88 });
    this.pausePanel.roundRect(px, py, panelW, panelH, 18).stroke({
      color: UI_NEON_GREEN,
      width: 2,
      alpha: 0.82,
    });
    this.pauseTitle?.position.set(overlayW * 0.5, py + 62);
    if (this.pauseTouchLockLabel?.style) {
      const nw = Math.min(340, panelW - 24);
      this.pauseTouchLockLabel.style.wordWrapWidth = nw;
    }
    this.pauseTouchLockLabel?.position.set(overlayW * 0.5, py + 118);
    const resumeW = Math.min(340, panelW - 28);
    const resumeH = Math.max(PAUSE_RESUME_BTN_MIN_H, 60);
    const resumeX = overlayW * 0.5 - resumeW * 0.5;
    const resumeY = py + panelH - resumeH - 32;
    this.drawOverlayButton(this.pauseResumeBtn, resumeX, resumeY, resumeW, resumeH);
    this.pauseResumeBtn.hitArea = new Rectangle(resumeX, resumeY, resumeW, resumeH);
    this.pauseResumeLabel?.position.set(overlayW * 0.5, resumeY + resumeH * 0.5);
    this.refreshPauseTouchLockLabel();
  }

  private loadTouchGlobalSteeringPreference(): boolean {
    try {
      if (typeof localStorage === 'undefined') {
        return true;
      }
      const v = localStorage.getItem(LS_TOUCH_GLOBAL_STEERING);
      if (v === '0') {
        return false;
      }
      // unset or '1' — full-screen steering is the primary default for new sessions.
      return true;
    } catch {
      return true;
    }
  }

  private saveTouchGlobalSteeringPreference(on: boolean): void {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(LS_TOUCH_GLOBAL_STEERING, on ? '1' : '0');
      }
    } catch {
      /* private mode / quota */
    }
  }

  private toggleTouchGlobalSteeringSetting(): void {
    this.touchGlobalAnywhereLock = !this.touchGlobalAnywhereLock;
    this.saveTouchGlobalSteeringPreference(this.touchGlobalAnywhereLock);
    this.refreshPauseTouchLockLabel();
  }

  private refreshPauseTouchLockLabel(): void {
    const label = this.pauseTouchLockLabel;
    if (!label) {
      return;
    }
    const touchActive = this.input?.isTouchControlsActive() ?? false;
    label.visible = touchActive;
    label.text = this.touchGlobalAnywhereLock
      ? 'נגישות — נעילת שליטה מכל המסך: פועל (הקש לכיבוי)'
      : 'נגישות — נעילת שליטה מכל המסך: כבוי (הקש להפעלה)';
  }

  private setupHeaderPauseButton(): void {
    this.headerPauseRoot.zIndex = 1001;
    this.headerPauseBtn.eventMode = 'static';
    this.headerPauseBtn.cursor = 'pointer';
    this.headerPauseBtn.on('pointerdown', (event) => {
      event.stopPropagation();
    });
    this.headerPauseBtn.on('pointertap', (event) => {
      event.stopPropagation();
      this.requestPause();
    });
    this.headerPauseIcon = new Text({
      text: '||',
      style: new TextStyle({
        fontFamily: 'Orbitron, "Press Start 2P", Arial Black, sans-serif',
        fontSize: 15,
        fontWeight: '800',
        fill: '#FFD700',
        stroke: { color: '#4a3200', width: 2 },
      }),
    });
    this.headerPauseIcon.anchor.set(0.5);
    this.headerPauseIcon.eventMode = 'none';
    this.headerPauseRoot.addChild(this.headerPauseBtn, this.headerPauseIcon);
    this.uiLayer.addChild(this.headerPauseRoot);
    this.layoutHeaderPauseButton();
  }

  private layoutHeaderPauseButton(): void {
    const btnW = HEADER_PAUSE_BTN_W;
    const btnH = HEADER_PAUSE_BTN_H;
    const x = HEADER_PAUSE_LEFT_MARGIN_PX;
    const y = UI_SAFE_PAD_TOP + UI_HEADER_H + HEADER_PAUSE_BELOW_HEADER_GAP_PX;
    this.headerPauseBtn.clear();
    this.headerPauseBtn.roundRect(0, 0, btnW, btnH, 8).fill({ color: UI_BG_BLACK, alpha: 0.48 });
    this.headerPauseBtn.roundRect(0, 0, btnW, btnH, 8).stroke({
      color: UI_NEON_GREEN,
      width: 1.5,
      alpha: 0.82,
    });
    this.headerPauseBtn.hitArea = new Rectangle(0, 0, btnW, btnH);
    this.headerPauseRoot.position.set(x, y);
    this.headerPauseIcon?.position.set(btnW * 0.5, btnH * 0.5);
  }

  /**
   * Bottom-right virtual attack button. Tapping or clicking it triggers `playerAttack()`,
   * matching the keyboard `F` binding. Uses `stopPropagation` so the underlying full-screen
   * touch handler (which would otherwise interpret the press as a jump-swipe baseline)
   * never sees this pointer.
   */
  private setupAttackButton(): void {
    this.attackBtnRoot.zIndex = 1002;
    this.attackBtnRoot.sortableChildren = false;
    this.attackBtn.eventMode = 'static';
    this.attackBtn.cursor = 'pointer';
    this.attackBtn.on('pointerdown', (event) => {
      event.stopPropagation();
      this.playerAttack();
    });
    this.attackBtnIcon.eventMode = 'none';
    this.attackBtnRoot.addChild(this.attackBtn, this.attackBtnIcon);
    this.uiLayer.addChild(this.attackBtnRoot);
    this.layoutAttackButton();
  }

  private layoutAttackButton(): void {
    const r = ATTACK_BTN_RADIUS_PX;
    this.attackBtn.clear();
    this.attackBtn
      .circle(0, 0, r)
      .fill({ color: ATTACK_BTN_FILL_COLOR, alpha: 0.94 });
    this.attackBtn
      .circle(0, 0, r)
      .stroke({ color: ATTACK_BTN_STROKE_COLOR, width: 3, alpha: 0.95 });
    this.attackBtn
      .circle(0, 0, r - 6)
      .stroke({ color: 0xffffff, width: 1.2, alpha: 0.35 });
    this.attackBtn.hitArea = new Circle(0, 0, r);

    this.attackBtnIcon.clear();
    this.drawAttackButtonIcon(this.attackBtnIcon);

    this.attackBtnRoot.position.set(
      this.width - r - ATTACK_BTN_MARGIN_PX,
      this.height - r - ATTACK_BTN_MARGIN_PX,
    );
  }

  /**
   * Hand-drawn sword glyph so the button doesn't depend on emoji-font fallbacks.
   * Coordinates are in the button's local space (centered on origin); ~30 px tall.
   */
  private drawAttackButtonIcon(g: Graphics): void {
    g.poly([
      -14, 12,
      -8, 16,
      14, -8,
      10, -16,
      -16, 8,
    ]).fill({ color: 0xffffff, alpha: 0.95 });
    g.poly([
      -14, 12,
      -8, 16,
      14, -8,
      10, -16,
      -16, 8,
    ]).stroke({ color: 0x3a0e00, width: 1.6, alpha: 0.85 });
    g.rect(-22, 4, 12, 5).fill({ color: 0xffd64a }).stroke({
      color: 0x3a0e00,
      width: 1.2,
      alpha: 0.9,
    });
    g.rect(-26, 8, 6, 8).fill({ color: 0x8a4a16 }).stroke({
      color: 0x3a0e00,
      width: 1.2,
      alpha: 0.9,
    });
  }

  /**
   * Update the button's tint/alpha so the cooldown lock is visually obvious — dimmer while
   * `player.isAttacking()` is true, full opacity otherwise.
   */
  private refreshAttackButtonCooldownVisual(): void {
    const cooling = this.player.isAttacking();
    this.attackBtnRoot.alpha = cooling ? 0.55 : 1;
  }

  /**
   * Public action triggered by virtual button or `F` key. Starts the attack animation;
   * returns immediately (no animation, no hit window) if a previous swing is still active —
   * this is the "can't attack until current animation finishes" cooldown requirement.
   */
  private playerAttack(): void {
    if (this.gameOver || this.paused) {
      return;
    }
    if (this.player.isAttacking()) {
      return;
    }
    this.player.startAttack(this.player.direction);
  }

  /**
   * While the player is mid-swing AND inside the active hit window, sweep a forward-facing
   * AABB through the enemy list and destroy any mushroom it overlaps. Iterates backwards so
   * splicing during iteration is safe.
   */
  private tickPlayerAttackHitbox(): void {
    if (!this.player.isAttackHitActive()) {
      return;
    }
    if (this.mushroomEnemies.length === 0) {
      return;
    }

    const pb = this.player.body;
    const facing = this.player.direction;
    const playerCx = pb.x + pb.width * 0.5;
    const reach = PLAYER_ATTACK_REACH_PX;
    const hx1 = facing >= 0 ? playerCx - 6 : playerCx - reach;
    const hx2 = facing >= 0 ? playerCx + reach : playerCx + 6;
    const hy1 = pb.y - PLAYER_ATTACK_VERT_PAD_PX;
    const hy2 = pb.y + pb.height + PLAYER_ATTACK_VERT_PAD_PX;

    const halfW = MUSHROOM_HITBOX_W * 0.5;
    for (let i = this.mushroomEnemies.length - 1; i >= 0; i -= 1) {
      const enemy = this.mushroomEnemies[i];
      const platform = this.platforms[enemy.platformIdx];
      if (!platform) {
        continue;
      }
      const ex = platform.x + enemy.along * platform.width;
      const ey = platform.y;
      const ex1 = ex - halfW;
      const ex2 = ex + halfW;
      const ey1 = ey - MUSHROOM_HITBOX_H;
      const ey2 = ey;
      if (ex1 < hx2 && ex2 > hx1 && ey1 < hy2 && ey2 > hy1) {
        this.destroyMushroomEnemy(i);
      }
    }
  }

  /**
   * Tear down a single mushroom: remove it from the parallel `mushroomEnemies` /
   * `mushroomEnemySprites` arrays and destroy its sprite. The enemy is gone for the rest
   * of the run — the slot will be repopulated on the next `resetRun()` only.
   */
  private destroyMushroomEnemy(index: number): void {
    const enemy = this.mushroomEnemies[index];
    if (enemy) {
      const platform = this.platforms[enemy.platformIdx];
      if (platform) {
        const wx = platform.x + enemy.along * platform.width;
        const wy = platform.y;
        this.spawnMushroomDeathEffect(wx, wy + 2, enemy.direction);
      }
    }
    const sprite = this.mushroomEnemySprites[index];
    if (sprite) {
      this.mushroomEnemyLayer.removeChild(sprite);
      sprite.destroy();
    }
    this.mushroomEnemies.splice(index, 1);
    this.mushroomEnemySprites.splice(index, 1);
  }

  private clearMushroomDeathEffects(): void {
    for (const e of this.mushroomDeathEffects) {
      e.sprite.destroy();
    }
    this.mushroomDeathEffects = [];
  }

  /** Mushroom-Die strip, then `blood.png` burst at the same world anchor as the live sprite. */
  private spawnMushroomDeathEffect(wx: number, wy: number, direction: number): void {
    if (this.mushroomDieTextures.length === 0) {
      return;
    }
    const s = new Sprite(this.mushroomDieTextures[0]);
    s.anchor.set(0.5, 1);
    s.roundPixels = RENDER.pixelArt;
    s.eventMode = 'none';
    s.position.set(wx, wy);
    const flip = direction < 0 ? -1 : 1;
    s.scale.set(MUSHROOM_SPRITE_SCALE * flip, MUSHROOM_SPRITE_SCALE);
    this.mushroomDeathFxLayer.addChild(s);
    this.mushroomDeathEffects.push({ sprite: s, phase: 'die', timeInPhase: 0 });
  }

  private updateMushroomDeathEffects(dt: number): void {
    if (this.mushroomDeathEffects.length === 0) {
      return;
    }
    const dieFrameDur = 1 / MUSHROOM_DEATH_DIE_FPS;
    const bloodFrameDur = 1 / MUSHROOM_DEATH_BLOOD_FPS;
    const dieEnd = this.mushroomDieTextures.length * dieFrameDur;
    const bloodEnd = this.bloodEffectTextures.length * bloodFrameDur;

    for (let i = this.mushroomDeathEffects.length - 1; i >= 0; i -= 1) {
      const e = this.mushroomDeathEffects[i];
      e.timeInPhase += dt;

      if (e.phase === 'die') {
        const f = Math.min(
          this.mushroomDieTextures.length - 1,
          Math.floor(e.timeInPhase / dieFrameDur),
        );
        e.sprite.texture = this.mushroomDieTextures[f];
        if (e.timeInPhase >= dieEnd) {
          if (this.bloodEffectTextures.length > 0) {
            e.phase = 'blood';
            e.timeInPhase = 0;
            e.sprite.texture = this.bloodEffectTextures[0];
            e.sprite.anchor.set(0.5, 0.5);
            e.sprite.position.set(
              e.sprite.position.x,
              e.sprite.position.y - MUSHROOM_HITBOX_H * 0.48,
            );
            e.sprite.scale.set(MUSHROOM_DEATH_BLOOD_SCALE, MUSHROOM_DEATH_BLOOD_SCALE);
          } else {
            e.sprite.destroy();
            this.mushroomDeathEffects.splice(i, 1);
          }
        }
      } else {
        const f = Math.min(
          this.bloodEffectTextures.length - 1,
          Math.floor(e.timeInPhase / bloodFrameDur),
        );
        e.sprite.texture = this.bloodEffectTextures[f];
        if (e.timeInPhase >= bloodEnd) {
          e.sprite.destroy();
          this.mushroomDeathEffects.splice(i, 1);
        }
      }
    }
  }

  /** Top HUD: animated `heart_counter-Sheet` (pulse + hit flash). */
  private setupHealthHud(): void {
    this.healthHudRoot.zIndex = 1004;
    this.healthHudRoot.sortableChildren = false;
    this.healthHudRoot.eventMode = 'none';
    this.heartHudSprite.eventMode = 'none';
    this.heartHudSprite.roundPixels = RENDER.pixelArt;
    this.heartHudSprite.texture = this.heartCounterTextures[0] ?? Texture.EMPTY;
    this.heartHudSprite.scale.set(HEART_HUD_SCALE);
    this.healthHudRoot.addChild(this.heartHudSprite);
    this.uiLayer.addChild(this.healthHudRoot);
    this.layoutHealthHud();
    this.refreshHealthHud();
  }

  private layoutHealthHud(): void {
    if (this.timerHudText) {
      const timerBottomY = this.timerHudText.position.y + this.timerHudText.height;
      const heartX =
        this.timerHudText.position.x -
        HEART_HUD_DISPLAY_WIDTH_PX * 0.5 +
        HEALTH_HUD_CLEAR_LEFT_COLUMN_PX;
      const barY = timerBottomY + HEALTH_BAR_UNDER_TIMER_GAP_PX;
      this.healthHudRoot.position.set(heartX, barY);
      return;
    }
    const fallbackY = UI_SAFE_PAD_TOP + UI_HEADER_H + HEALTH_HUD_Y_OFFSET_PX;
    this.healthHudRoot.position.set(
      HEALTH_HUD_X_PX + HEALTH_HUD_CLEAR_LEFT_COLUMN_PX,
      fallbackY,
    );
  }

  /** Sync segment level / hit-flash when `playerHealth` changes; frame cycling runs in `tickHeartHud`. */
  private refreshHealthHud(): void {
    const newL = heartHudSegmentsFromPlayerHealth(this.playerHealth);
    const prevL = this.heartHudSegmentL;
    if (this.heartCounterTextures.length > 0 && newL < prevL && prevL > 0) {
      this.heartHudTransTime = HEART_HUD_HIT_FLASH_SEC;
      this.heartHudTransFromL = prevL;
    }
    this.heartHudSegmentL = newL;
  }

  private tickHeartHud(dt: number): void {
    if (this.heartCounterTextures.length === 0) {
      return;
    }
    if (this.heartHudTransTime > 0) {
      this.heartHudTransTime = Math.max(0, this.heartHudTransTime - dt);
      const idx = heartHudTransitionFrameIndex(this.heartHudTransFromL);
      this.heartHudSprite.texture = this.heartCounterTextures[idx];
      return;
    }
    this.heartHudPulseAcc += dt;
    const pair = heartHudSteadyFrameIndices(this.heartHudSegmentL);
    const pulse = Math.floor(this.heartHudPulseAcc * HEART_HUD_PULSE_HZ * 2) % 2;
    const idx = pulse === 0 ? pair[0] : pair[1];
    this.heartHudSprite.texture = this.heartCounterTextures[idx];
  }

  /**
   * Defensive clamp: in the current design HP may go down from damage but should not
   * increase until `resetRun()` starts a fresh attempt.
   */
  private enforceHealthInvariant(): void {
    if (this.playerHealth > this.playerHealthCeilingThisRun) {
      this.playerHealth = this.playerHealthCeilingThisRun;
      this.refreshHealthHud();
    }
  }

  private activatePlayerShield(): void {
    this.player.isShielded = true;
    this.shieldTimeLeft = COLLECTIBLES.shieldDurationSec;
    this.refreshCollectibleHudText();
  }

  private tickPlayerShield(dt: number): void {
    if (!this.player.isShielded) {
      return;
    }
    this.shieldTimeLeft = Math.max(0, this.shieldTimeLeft - dt);
    if (this.shieldTimeLeft <= 0) {
      this.player.isShielded = false;
      this.refreshCollectibleHudText();
    }
  }

  private consumePlayerShield(): boolean {
    if (!this.player.isShielded) {
      return false;
    }
    this.player.isShielded = false;
    this.shieldTimeLeft = 0;
    this.playerInvulnTime = PLAYER_INVULN_SEC;
    this.playerInvulnBlinkPhase = 0;
    this.player.alpha = 1;
    this.shakeTime = Math.max(this.shakeTime, 0.24);
    this.refreshCollectibleHudText();
    return true;
  }

  /**
   * Apply mushroom damage (`MUSHROOM_DAMAGE_PER_HIT`). Returns `true` when the hit landed (so
   * the caller can stop scanning further enemies this frame), or `false` when the player is
   * currently invulnerable. Triggers the game-over flow only when health drops to zero.
   */
  private damagePlayer(): boolean {
    if (this.gameOver) {
      return false;
    }
    if (this.playerInvulnTime > 0) {
      return false;
    }
    if (this.consumePlayerShield()) {
      return true;
    }
    this.playerHealth = Math.max(0, this.playerHealth - MUSHROOM_DAMAGE_PER_HIT);
    this.playerHealthCeilingThisRun = this.playerHealth;
    this.playerInvulnTime = PLAYER_INVULN_SEC;
    this.playerInvulnBlinkPhase = 0;
    this.refreshHealthHud();
    this.shakeTime = Math.max(this.shakeTime, 0.22);
    if (this.playerHealth <= 0) {
      this.triggerGameOver();
    }
    return true;
  }

  /**
   * Per-frame upkeep for the invulnerability window. While `playerInvulnTime > 0` the
   * player sprite strobes (alpha pulsing) so the hit-recovery state is obvious; once it
   * hits zero we restore full opacity.
   */
  private tickPlayerInvuln(dt: number): void {
    if (this.playerInvulnTime <= 0) {
      if (this.player.alpha !== 1) {
        this.player.alpha = 1;
      }
      return;
    }
    this.playerInvulnTime = Math.max(0, this.playerInvulnTime - dt);
    this.playerInvulnBlinkPhase += dt * PLAYER_HURT_BLINK_HZ * Math.PI * 2;
    const strobe = 0.5 + 0.5 * Math.cos(this.playerInvulnBlinkPhase);
    this.player.alpha = 0.32 + 0.58 * strobe;
    if (this.playerInvulnTime === 0) {
      this.player.alpha = 1;
    }
  }

  private setupSpeedTierPulseOverlay(): void {
    this.speedPulseGfx.eventMode = 'none';
    this.speedPulseGfx.visible = false;
    this.speedPulseGfx.zIndex = 1105;
    this.uiLayer.addChild(this.speedPulseGfx);
    this.redrawSpeedPulseOverlay();
  }

  private requestPause(): void {
    if (this.gameOver || this.paused) {
      return;
    }
    this.touchPointers.clear();
    this.touchControlPointerId = null;
    this.input?.setTouchFollowAxis(0);
    this.paused = true;
    this.pauseOverlay.visible = true;
    this.layoutPauseOverlay();
    this.bgm?.pause();
  }

  private resumeFromPause(): void {
    if (!this.paused) {
      return;
    }
    this.paused = false;
    this.pauseOverlay.visible = false;
    void this.bgm?.play().catch(() => {
      /* autoplay */
    });
  }

  private renderLeaderboardShell(entries: LeaderboardEntry[] = [], loading = false): void {
    const overlayW = this.width;
    const overlayH = this.height;
    const panelW = Math.min(620, overlayW - 32);
    const panelH = Math.min(560, overlayH - 52);
    const px = (overlayW - panelW) * 0.5;
    const py = (overlayH - panelH) * 0.5;
    const titleY = py + 52;

    this.leaderboardPanel.clear();
    this.leaderboardPanel.roundRect(px, py, panelW, panelH, 18).fill({ color: UI_PANEL_PURPLE, alpha: 0.86 });
    this.leaderboardPanel.roundRect(px, py, panelW, panelH, 18).stroke({
      color: UI_NEON_GREEN,
      width: 2,
      alpha: 0.74,
    });
    this.leaderboardTitle?.position.set(overlayW * 0.5, titleY);

    for (const row of this.leaderboardRows) {
      row.destroy();
    }
    this.leaderboardRows = [];

    const rowsStartY = titleY + 36;
    const rowH = 62;
    const tablePad = 22;
    const rowW = panelW - tablePad * 2;
    const rowX = px + tablePad;
    const data = entries.slice(0, 5);
    for (let i = 0; i < 5; i += 1) {
      const y = rowsStartY + i * rowH;
      const bg = i % 2 === 0 ? 0x12001d : 0x000000;
      this.leaderboardPanel.roundRect(rowX, y, rowW, rowH - 8, 10).fill({ color: bg, alpha: 0.78 });
      this.leaderboardPanel.roundRect(rowX, y, rowW, rowH - 8, 10).stroke({
        color: UI_NEON_GREEN,
        width: 1,
        alpha: 0.35,
      });
      const entry = data[i];
      const placeLabel = i === 0 ? '#1 ★' : `#${i + 1}`;
      const line = entry
        ? `${placeLabel} ${entry.nickname.toUpperCase()} · ${entry.score}m`
        : loading
          ? `${placeLabel} …`
          : `${placeLabel} —`;
      const padX = 10;
      const innerW = rowW - padX * 2;
      const rowText = new Text({
        text: line,
        style: this.createLeaderboardRowTextStyle(innerW),
      });
      rowText.anchor.set(0, 0.5);
      rowText.position.set(rowX + padX, y + (rowH - 8) * 0.5);
      this.leaderboardRows.push(rowText);
      this.leaderboardOverlay.addChild(rowText);
    }

    const closeW = Math.min(240, panelW - 48);
    const closeH = Math.max(56, this.width <= MOBILE_NARROW_UI_MAX_W ? 64 : 56);
    const closeX = overlayW * 0.5 - closeW * 0.5;
    const closeY = py + panelH - closeH - 16;
    this.drawOverlayButton(this.leaderboardCloseBtn, closeX, closeY, closeW, closeH);
    this.leaderboardCloseBtn.hitArea = new Rectangle(closeX, closeY, closeW, closeH);
    this.leaderboardCloseLabel?.position.set(overlayW * 0.5, closeY + closeH * 0.5);

    if (this.leaderboardLoadingText) {
      this.leaderboardLoadingText.visible = loading;
      this.leaderboardLoadingText.position.set(overlayW * 0.5, rowsStartY + rowH * 1.5);
    }
  }

  private drawOverlayButton(target: Graphics, x: number, y: number, w: number, h: number): void {
    target.clear();
    target.roundRect(x, y, w, h, 12).fill({ color: UI_BG_BLACK, alpha: 0.52 });
    target.roundRect(x, y, w, h, 12).stroke({ color: UI_NEON_GREEN, width: 2, alpha: 0.78 });
    target.roundRect(x + 3, y + 3, w - 6, h - 6, 9).stroke({ color: UI_NEON_GREEN, width: 1, alpha: 0.2 });
  }

  private refreshGameOverScoreText(): void {
    if (!this.gameOverScoreText) {
      return;
    }
    this.gameOverScoreText.text = `${this.finalMetersAtDeath} m`;
  }

  private showScoreSavedHint(): void {
    const hint = this.gameOverScoreSavedHint;
    if (!hint) {
      return;
    }
    hint.visible = true;
    hint.alpha = 0.88;
    this.scoreSavedHintTimeLeft = 2.25;
  }

  private updateScoreSavedHint(dt: number): void {
    const hint = this.gameOverScoreSavedHint;
    if (!hint || this.scoreSavedHintTimeLeft <= 0 || !hint.visible) {
      return;
    }
    this.scoreSavedHintTimeLeft -= dt;
    const fadeDur = 0.55;
    if (this.scoreSavedHintTimeLeft <= 0) {
      hint.visible = false;
      return;
    }
    if (this.scoreSavedHintTimeLeft < fadeDur) {
      hint.alpha = Math.max(0, (this.scoreSavedHintTimeLeft / fadeDur) * 0.88);
    } else {
      hint.alpha = 0.88;
    }
  }

  private triggerGameOver(): void {
    if (this.gameOver) {
      return;
    }
    this.gameOver = true;
    this.speedTierUiFlashTime = 0;
    this.speedPulseGfx.visible = false;
    this.speedPulseGfx.alpha = 1;
    this.paused = false;
    this.pauseOverlay.visible = false;
    this.headerPauseRoot.visible = false;
    this.attackBtnRoot.visible = false;
    this.healthHudRoot.visible = false;
    this.finalMetersAtDeath = Math.max(0, Math.floor(-this.highestY / 12));
    this.refreshGameOverScoreText();
    this.gameOverOverlay.visible = true;
    this.leaderboardOverlay.visible = false;
    this.touchPointers.clear();
    this.touchControlPointerId = null;
    this.input?.setTouchFollowAxis(0);
    this.touchControlsLayer.visible = false;
    if (!this.deathSubmitted) {
      this.deathSubmitted = true;
      const nickname = getSavedNickname() || 'Player';
      void (async () => {
        try {
          await saveScore(nickname, this.finalMetersAtDeath);
          console.info('[PlayScene] leaderboard score saved', {
            nickname,
            meters: this.finalMetersAtDeath,
          });
          this.showScoreSavedHint();
          this.lastLeaderboardTop = await fetchTopLeaderboard(5);
          if (this.leaderboardOverlay.visible) {
            this.renderLeaderboardShell(this.lastLeaderboardTop, false);
          }
        } catch (err) {
          console.error('[PlayScene] leaderboard save failed', err);
        }
      })();
    }
  }

  private async openLeaderboardOverlay(): Promise<void> {
    this.leaderboardOverlay.visible = true;
    if (this.lastLeaderboardTop.length > 0) {
      this.renderLeaderboardShell(this.lastLeaderboardTop, false);
    } else {
      this.renderLeaderboardShell([], true);
    }
    const top = await fetchTopLeaderboard(5).catch(() => []);
    this.lastLeaderboardTop = top;
    this.renderLeaderboardShell(top, false);
  }

  private setupAutoScrollHud(): void {
    this.timerHudText = new Text({
      text: '',
      style: this.createNeonGoldTextStyle(38, 4),
    });
    this.timerHudText.anchor.set(0.5, 0);
    this.timerHudText.zIndex = 1005;
    this.uiLayer.addChild(this.timerHudText);

    this.hurryBannerText = new Text({
      text: 'HURRY UP!',
      style: this.createNeonGoldTextStyle(26, 3),
    });
    this.hurryBannerText.anchor.set(0.5);
    this.hurryBannerText.position.set(220, HURRY_BANNER_H * 0.5);
    this.hurryBannerRoot.zIndex = 1007;
    this.hurryBannerRoot.visible = false;
    this.hurryBannerRoot.addChild(this.hurryBannerGfx, this.hurryBannerText);
    this.uiLayer.addChild(this.hurryBannerRoot);
    this.layoutAutoScrollHud();
    this.refreshAutoScrollHud();
  }

  private layoutAutoScrollHud(): void {
    if (this.timerHudText) {
      const mobile = this.width <= MOBILE_NARROW_UI_MAX_W;
      const timerX = mobile ? this.width * 0.37 : this.width * 0.5;
      const timerScale = mobile ? 0.82 : 1;
      this.timerHudText.scale.set(timerScale);
      this.timerHudText.position.set(timerX, UI_HEADER_INFO_ROW_Y - 20);
    }
    this.hurryBannerRoot.position.set(-460, UI_SAFE_PAD_TOP + 8);
    this.hurryBannerX = this.hurryBannerRoot.position.x;
    this.drawHurryBanner();
  }

  private refreshAutoScrollHud(): void {
    if (this.timerHudText) {
      const totalSec = Math.floor(this.runTime);
      const minutes = Math.floor(totalSec / 60)
        .toString()
        .padStart(2, '0');
      const seconds = (totalSec % 60).toString().padStart(2, '0');
      this.timerHudText.text = `${minutes}:${seconds}`;
    }
    if (this.hurryBannerText) {
      this.hurryBannerRoot.visible = false;
    }
  }

  private drawBottomDeathLine(): void {
    /**
     * `lavaLayer` lives in `world` with `zIndex` above platforms so stairs pass **behind** the hazard art.
     * Death line = `getDeathPlaneWorldY()`.
     */
    const deathY = this.getDeathPlaneWorldY();
    const vw = this.worldWidthFromScreen();
    const padX = 30;
    const x = this.cameraX - padX;
    const w = vw + padX * 2;

    this.deathZoneFallback.visible = true;
    const lavaTop = deathY - 32;
    this.deathZoneFallback.clear();
    this.deathZoneFallback
      .rect(x, lavaTop, w, 32)
      .fill({ color: 0xff4b00, alpha: 0.78 });
    this.deathZoneFallback
      .rect(x, deathY - 9, w, 9)
      .fill({ color: 0xffa621, alpha: 0.95 });
  }

  /** Crystal strip removed from repo — keep hook for init ordering; hazard is vector-only. */
  private async loadDeathZoneStrip(): Promise<void> {
    this.deathZoneFallback.visible = true;
  }

  private tickAltitudePresentation(dt: number): void {
    this.updateWindParticles(dt);
    this.spawnWindParticlesForAltitude(dt);
    this.refreshClimbHudText();
    this.refreshAutoScrollHud();
  }

  private spawnWindParticlesForAltitude(dt: number): void {
    const mult = this.getAltitudeSpeedMultiplier();
    if (mult <= 1.001 || this.windParticles.length >= ALTITUDE_WIND_MAX_PARTICLES) {
      return;
    }
    this.windSpawnAcc += dt * (mult - 1) * 12;
    const vw = this.worldWidthFromScreen();
    const vh = this.worldHeightFromScreen();
    while (this.windSpawnAcc >= 1 && this.windParticles.length < ALTITUDE_WIND_MAX_PARTICLES) {
      this.windSpawnAcc -= 1;
      const x = this.cameraX + vw + 40 + Math.random() * 120;
      const y = this.cameraY + Math.random() * vh;
      const speed = 280 + (mult - 1) * 210;
      this.windParticles.push({
        x,
        y,
        vx: -speed - Math.random() * 180,
        vy: -40 + Math.random() * 80,
        age: 0,
        life: 0.38 + Math.random() * 0.28,
        len: 22 + Math.random() * 44,
      });
    }
  }

  private updateWindParticles(dt: number): void {
    const leftCull = this.cameraX - 260;
    this.windParticles = this.windParticles
      .map((p) => ({
        ...p,
        age: p.age + dt,
        x: p.x + p.vx * dt,
        y: p.y + p.vy * dt,
      }))
      .filter((p) => p.age < p.life && p.x > leftCull);
  }

  private drawWindParticles(): void {
    for (const p of this.windParticles) {
      const u = p.age / p.life;
      const alpha = (1 - u) * 0.2;
      const x1 = p.x;
      const y1 = p.y;
      const x2 = p.x + p.len * 0.94;
      const y2 = p.y + (p.vy / Math.max(120, Math.abs(p.vx))) * p.len * 0.12;
      this.fxLayer.moveTo(x1, y1).lineTo(x2, y2).stroke({
        width: 1,
        color: 0x5a8cbb,
        alpha,
      });
    }
  }

  /** Positions TONGUE (right) and 360 (left) under the top header. */
  private layoutBoostHudButtons(): void {
    const tongueRightX = this.width - BOOST_BTN_SCREEN_MARGIN_RIGHT_PX;
    const by = UI_SAFE_PAD_TOP + UI_HEADER_H + 8;
    const tongueLeftX = tongueRightX - TONGUE_BOOST_BTN_W;
    const action360RightX = tongueLeftX - BOOST_ACTION_BTN_GAP_PX;
    this.action360ButtonRoot.pivot.set(TONGUE_BOOST_BTN_W, 0);
    this.action360ButtonRoot.position.set(action360RightX, by);
    this.action360ButtonGfx.hitArea = new Rectangle(0, 0, TONGUE_BOOST_BTN_W, TONGUE_BOOST_BTN_H);
    this.tongueBoostButtonRoot.pivot.set(TONGUE_BOOST_BTN_W, 0);
    this.tongueBoostButtonRoot.position.set(tongueRightX, by);
    this.tongueBoostButtonGfx.hitArea = new Rectangle(0, 0, TONGUE_BOOST_BTN_W, TONGUE_BOOST_BTN_H);
  }

  private redrawTongueBoostButton(pressed: boolean): void {
    const gfx = this.tongueBoostButtonGfx;
    gfx.clear();
    const gold = UI_NEON_GREEN;
    const boost = pressed ? 1.25 : 1;
    gfx.roundRect(0, 0, TONGUE_BOOST_BTN_W, TONGUE_BOOST_BTN_H, 10).fill({
      color: UI_PANEL_PURPLE,
      alpha: pressed ? 0.9 : 0.78,
    });
    gfx.roundRect(0, 0, TONGUE_BOOST_BTN_W, TONGUE_BOOST_BTN_H, 10).stroke({
      color: gold,
      alpha: pressed ? 0.98 : 0.85,
      width: pressed ? 2.4 : 2,
    });
    gfx.roundRect(2, 2, TONGUE_BOOST_BTN_W - 4, TONGUE_BOOST_BTN_H - 4, 8).stroke({
      color: gold,
      alpha: 0.22 * boost,
      width: 1,
    });
    if (this.tongueBoostLabel) {
      this.tongueBoostLabel.alpha = pressed ? 1 : 0.92;
    }
  }

  private syncBoostHudButtonsVisibility(): void {
    const show = this.isFlashSkillBoostActive();
    this.tongueBoostButtonRoot.visible = show;
    this.action360ButtonRoot.visible = show;
    if (!show) {
      this.tongueBoostButtonPressed = false;
      this.redrawTongueBoostButton(false);
      this.action360ButtonPressed = false;
      this.redrawAction360Button(false);
    }
  }

  private applyTongueBoostButtonAction(): void {
    if (!this.isFlashSkillBoostActive()) {
      return;
    }
    const d = TONGUE_COMBO_BOOST_DURATION_SEC * this.getComboWindowAltitudeMultiplier();
    this.tongueBoostChainWindowSec = d;
    this.tongueBoostComboExtendUntil = this.runTime + d;
    this.tongueBoostComboResetAt = this.runTime + d;
    this.feedComboFromLand();
    const mult = this.getComboMultiplier();
    this.maybeSpawnComboPopup(mult);
    this.triggerGrappleAction();
  }

  private readonly handleTongueBoostButtonDown = (event: FederatedPointerEvent): void => {
    if (!this.isFlashSkillBoostActive()) {
      return;
    }
    event.stopPropagation();
    this.tongueBoostButtonPressed = true;
    this.redrawTongueBoostButton(true);
    this.applyTongueBoostButtonAction();
  };

  private readonly handleTongueBoostButtonUp = (): void => {
    this.tongueBoostButtonPressed = false;
    this.redrawTongueBoostButton(false);
  };

  private setupTouchControlsOverlay(app: Application): void {
    if (!this.input?.isTouchControlsActive()) {
      return;
    }
    // Full-screen touch + swipe; on-screen JUMP/TONGUE buttons removed for now.
    this.touchControlsLayer.eventMode = 'passive';
    this.touchControlsLayer.sortableChildren = true;
    this.touchControlsLayer.zIndex = 999;
    this.touchFeedbackLayer.eventMode = 'none';
    this.touchControlsLayer.addChild(this.touchFeedbackLayer);
    this.uiLayer.addChild(this.touchControlsLayer);
    app.stage.on('pointerdown', this.handleTouchPointerDown);
    app.stage.on('pointermove', this.handleTouchPointerMove);
    app.stage.on('pointerup', this.handleTouchPointerUpOrCancel);
    app.stage.on('pointerupoutside', this.handleTouchPointerUpOrCancel);
    app.stage.on('pointercancel', this.handleTouchPointerUpOrCancel);
  }

  private readonly handleTouchPointerDown = (event: FederatedPointerEvent): void => {
    if (this.gameOver || this.leaderboardOverlay.visible || this.paused) {
      return;
    }
    if (!this.input?.isTouchControlsActive()) {
      return;
    }
    event.preventDefault();
    const pointerId = event.pointerId;
    if (this.touchPointers.has(pointerId)) {
      return;
    }
    const side = event.global.x < this.width * 0.5 ? 'left' : 'right';
    this.touchPointers.set(pointerId, {
      side,
      startX: event.global.x,
      startY: event.global.y,
      lastX: event.global.x,
      lastY: event.global.y,
      swipeBaselineY: event.global.y,
      swipeBaselineX: event.global.x,
      startMs: performance.now(),
      swipeHandled: false,
    });
    const takeLock =
      this.touchGlobalAnywhereLock || this.isTouchNearChameleon(event.global.x, event.global.y);
    if (this.touchControlPointerId === null && takeLock) {
      this.touchControlPointerId = pointerId;
    }
    this.spawnTouchRipple(event.global.x, event.global.y, 0.26);
  };

  private readonly handleTouchPointerMove = (event: FederatedPointerEvent): void => {
    if (this.gameOver || this.leaderboardOverlay.visible || this.paused) {
      return;
    }
    if (!this.input?.isTouchControlsActive()) {
      return;
    }
    const p = this.touchPointers.get(event.pointerId);
    if (!p) {
      return;
    }
    p.lastX = event.global.x;
    p.lastY = event.global.y;
    p.side = p.lastX < this.width * 0.5 ? 'left' : 'right';
    const takeLock =
      this.touchGlobalAnywhereLock || this.isTouchNearChameleon(p.lastX, p.lastY);
    if (this.touchControlPointerId === null && takeLock) {
      this.touchControlPointerId = event.pointerId;
    }
    this.tryHandleSwipeUp(event.pointerId, false);
  };

  private readonly handleTouchPointerUpOrCancel = (event: FederatedPointerEvent): void => {
    if (this.gameOver || this.leaderboardOverlay.visible || this.paused) {
      return;
    }
    if (!this.input?.isTouchControlsActive()) {
      return;
    }
    this.tryHandleSwipeUp(event.pointerId, true);
    this.touchPointers.delete(event.pointerId);
    if (this.touchControlPointerId === event.pointerId) {
      this.touchControlPointerId = null;
      this.input?.setTouchFollowAxis(0);
    }
  };

  private applyTouchHoldState(): void {
    // Drag-locked mode: movement is driven by relative drag axis.
    this.input?.setTouchHoldLeft(false);
    this.input?.setTouchHoldRight(false);
  }

  private updateTouchFollowAxis(): void {
    if (!this.input?.isTouchControlsActive()) {
      return;
    }
    if (this.touchControlPointerId === null) {
      this.input.setTouchFollowAxis(0);
      return;
    }
    const touch = this.touchPointers.get(this.touchControlPointerId);
    if (!touch) {
      this.touchControlPointerId = null;
      this.input.setTouchFollowAxis(0);
      return;
    }
    const zoom = this.getCameraZoom();
    const padX = 0;
    const playerCx = this.player.body.x + this.player.body.width * 0.5;
    const playerScreenX = (playerCx - this.cameraX) * zoom + padX;
    const fingerDeltaX = touch.lastX - playerScreenX;
    let axis = fingerDeltaX / TOUCH_FOLLOW_DISTANCE_PX;
    if (Math.abs(fingerDeltaX) < 5) {
      axis = 0;
    }
    this.input.setTouchFollowAxis(Math.max(-1, Math.min(1, axis)));
  }

  private tryHandleSwipeUp(pointerId: number, finalize: boolean): void {
    const p = this.touchPointers.get(pointerId);
    if (!p) {
      return;
    }
    // Re-arm upward swipe while finger stays down: moving down refreshes baseline.
    p.swipeBaselineY = Math.max(p.swipeBaselineY, p.lastY);
    if (p.lastY > p.swipeBaselineY) {
      p.swipeBaselineX = p.lastX;
      p.swipeBaselineY = p.lastY;
    }
    const vecX = p.lastX - p.swipeBaselineX;
    const vecY = p.lastY - p.swipeBaselineY;
    const swipeDist = Math.hypot(vecX, vecY);
    const upwardRatio = swipeDist > 1e-5 ? (-vecY / swipeDist) : 0;
    void finalize;
    if (
      swipeDist >= TOUCH_SWIPE_JUMP_MIN_DISTANCE_PX &&
      upwardRatio >= TOUCH_SWIPE_UPWARD_RATIO_MIN &&
      -vecY >= TOUCH_SWIPE_UP_MIN_PX
    ) {
      const now = performance.now();
      if (now - this.touchLastJumpMs >= TOUCH_ACTION_RETRIGGER_MS) {
        this.touchLastJumpMs = now;
        this.input?.queueJump();
      }
      p.swipeBaselineX = p.lastX;
      p.swipeBaselineY = p.lastY;
      this.spawnTouchRipple(p.lastX, p.lastY, 0.34);
    }
  }

  private isTouchNearChameleon(screenX: number, screenY: number): boolean {
    const zoom = this.getCameraZoom();
    const padX = 0;
    const padY = 0;
    const playerLeft = (this.player.body.x - this.cameraX) * zoom + padX;
    const playerTop = (this.player.body.y - this.cameraY) * zoom + padY;
    const playerW = Math.max(1, this.player.body.width * zoom);
    const playerH = Math.max(1, this.player.body.height * zoom);
    const margin = Math.max(TOUCH_LOCK_RADIUS_PX * 0.28, Math.min(playerW, playerH) * 0.35);
    const left = playerLeft - margin;
    const right = playerLeft + playerW + margin;
    const top = playerTop - margin;
    const bottom = playerTop + playerH + margin;
    return screenX >= left && screenX <= right && screenY >= top && screenY <= bottom;
  }

  private spawnTouchRipple(x: number, y: number, life: number): void {
    this.touchRipples.push({ x, y, age: 0, life });
    if (this.touchRipples.length > 40) {
      this.touchRipples.splice(0, this.touchRipples.length - 40);
    }
  }

  private updateTouchRipples(dt: number): void {
    if (!this.input?.isTouchControlsActive()) {
      return;
    }
    this.touchRipples = this.touchRipples
      .map((r) => ({ ...r, age: r.age + dt }))
      .filter((r) => r.age < r.life);
    this.touchFeedbackLayer.clear();
    for (const r of this.touchRipples) {
      const u = r.age / r.life;
      const alpha = (1 - u) * 0.28;
      const radius = 10 + 48 * u;
      this.touchFeedbackLayer.circle(r.x, r.y, radius).stroke({
        color: 0xffffff,
        width: 2.2 - u,
        alpha,
      });
      this.touchFeedbackLayer.circle(r.x, r.y, 4 + 10 * (1 - u)).fill({
        color: 0xffffff,
        alpha: alpha * 0.35,
      });
    }
  }

  /** Top header placement for collectible counters and bottom placement for boost buttons. */
  private syncCollectibleHudPosition(): void {
    this.collectibleHudRoot.pivot.set(0, 0.5);
    this.collectibleHudRoot.position.set(26, UI_HEADER_INFO_ROW_Y);
    this.layoutBoostHudButtons();
  }

  private layoutCollectibleHud(): void {
    this.syncCollectibleHudPosition();
    const g = COLLECTIBLE_LINES_HALF_GAP_PX;
    const shieldRowY = g - 2 + COLLECTIBLE_SHIELD_ICON_BELOW_DIAMOND_PX;
    this.collectibleHudGoldIcon.position.set(0, -g - 2);
    this.collectibleHudGoldText?.position.set(28, -g);
    this.collectibleHudDiamondIcon.position.set(0, g - 2);
    this.collectibleHudDiamondText?.position.set(28, g);
    this.collectibleHudShieldIcon.position.set(0, shieldRowY);
    this.collectibleHudShieldText?.position.set(28, shieldRowY);
  }

  /** HUD count includes the active shield plus any reserve bank charges. */
  private getShieldHudStock(): number {
    return this.shieldStock + (this.player.isShielded ? 1 : 0);
  }

  private refreshCollectibleHudText(): void {
    if (this.collectibleHudGoldText) {
      this.collectibleHudGoldText.text = `${Math.round(this.hudGoldShown)}`;
    }
    if (this.collectibleHudDiamondText) {
      this.collectibleHudDiamondText.text = `${Math.round(this.hudDiamondShown)}`;
    }
    if (this.collectibleHudShieldText) {
      this.collectibleHudShieldText.text = `${this.getShieldHudStock()}`;
    }
  }

  private updateCollectibleHudSmooth(dt: number): void {
    const k = 1 - Math.exp(-13 * dt);
    this.hudGoldShown += (this.goldCount - this.hudGoldShown) * k;
    this.hudDiamondShown += (this.diamondCount - this.hudDiamondShown) * k;
    this.refreshCollectibleHudText();

    if (this.collectibleHudBump > 0) {
      this.collectibleHudBump = Math.max(0, this.collectibleHudBump - dt * 4.5);
      const s = 1 + 0.08 * this.collectibleHudBump;
      this.collectibleHudRoot.scale.set(s);
    } else {
      this.collectibleHudRoot.scale.set(1);
    }
  }

  private getOccupiedActivePlatformIndices(): Set<number> {
    const s = new Set<number>();
    for (const c of this.collectibles) {
      if (c.phase === 'active') {
        s.add(c.platformIdx);
      }
    }
    return s;
  }

  private pickPlatformSpawnSlot(
    r: number,
    occupied: Set<number>,
  ): { platformIdx: number; along: number } | null {
    const candidates: number[] = [];
    const margin = COLLECTIBLES.platformEdgeMarginPx;
    for (let i = 0; i < this.platforms.length; i += 1) {
      if (occupied.has(i)) {
        continue;
      }
      const p = this.platforms[i];
      const innerW = p.width - 2 * margin - 2 * r;
      if (innerW < 4) {
        continue;
      }
      candidates.push(i);
    }
    if (candidates.length === 0) {
      return null;
    }
    const platformIdx = candidates[Math.floor(Math.random() * candidates.length)];
    return { platformIdx, along: Math.random() };
  }

  private getCollectibleAnchor(c: Collectible): { x: number; y: number } | null {
    const p = this.platforms[c.platformIdx];
    if (!p) {
      return null;
    }
    const margin = COLLECTIBLES.platformEdgeMarginPx;
    const innerW = p.width - 2 * margin - 2 * c.r;
    if (innerW < 4) {
      return null;
    }
    const x = p.x + margin + c.r + c.along * innerW;
    const y = p.y - COLLECTIBLES.aboveSurfacePx;
    return { x, y };
  }

  private pickCollectibleKind(): CollectibleKind {
    const roll = Math.random();
    if (roll < COLLECTIBLES.shieldSpawnChance) {
      return 'shield';
    }
    if (roll < COLLECTIBLES.shieldSpawnChance + COLLECTIBLES.diamondSpawnChance) {
      return 'diamond';
    }
    return 'coin';
  }

  private getCollectibleRadius(kind: CollectibleKind): number {
    if (kind === 'coin') {
      return COLLECTIBLES.coinRadius;
    }
    if (kind === 'diamond') {
      return COLLECTIBLES.diamondRadius;
    }
    return COLLECTIBLES.shieldRadius;
  }

  private getCollectiblePoints(kind: CollectibleKind): number {
    if (kind === 'coin') {
      return COLLECTIBLES.coinPoints;
    }
    if (kind === 'diamond') {
      return COLLECTIBLES.diamondPoints;
    }
    return COLLECTIBLES.shieldPickupPoints;
  }

  /** While bank has 10+ gold and 5+ diamonds, spend and add shield charges (capped). No refill at end of fall launch. */
  private maybePurchaseShieldFromBank(): void {
    const maxStock = 99;
    let gained = 0;
    while (
      this.shieldStock < maxStock &&
      this.goldCount >= SHIELD_BANK_GOLD &&
      this.diamondCount >= SHIELD_BANK_DIAMOND
    ) {
      this.goldCount -= SHIELD_BANK_GOLD;
      this.diamondCount -= SHIELD_BANK_DIAMOND;
      this.shieldStock += 1;
      gained += 1;
      const add = COLLECTIBLES.shieldPickupPoints;
      this.score += add * this.getScoreGainMultiplier();
      this.scoreboard?.onPointsGained(add);
    }
    if (gained > 0) {
      if (!this.player.isShielded && this.shieldStock > 0) {
        this.shieldStock -= 1;
        this.activatePlayerShield();
      }
      this.sfx.play('collect_diamond', 0.72);
      this.collectibleHudBump = 1;
      this.hudGoldShown = this.goldCount;
      this.hudDiamondShown = this.diamondCount;
      this.refreshCollectibleHudText();
    }
  }

  private spawnCollectibleField(): void {
    this.collectibles = [];
    const n = Math.min(COLLECTIBLES.maxActive, this.platforms.length);
    let occupied = this.getOccupiedActivePlatformIndices();
    for (let i = 0; i < n; i += 1) {
      const kind = this.pickCollectibleKind();
      const r = this.getCollectibleRadius(kind);
      const slot = this.pickPlatformSpawnSlot(r, occupied);
      if (!slot) {
        break;
      }
      occupied = new Set(occupied);
      occupied.add(slot.platformIdx);
      this.collectibles.push({
        kind,
        platformIdx: slot.platformIdx,
        along: slot.along,
        r,
        phase: 'active',
        collectT: 0,
        collectStartX: 0,
        collectStartY: 0,
      });
    }
  }

  private distPointToSegment(
    px: number,
    py: number,
    ax: number,
    ay: number,
    bx: number,
    by: number,
  ): number {
    const abx = bx - ax;
    const aby = by - ay;
    const abLenSq = abx * abx + aby * aby;
    if (abLenSq < 1e-6) {
      return Math.hypot(px - ax, py - ay);
    }
    const apx = px - ax;
    const apy = py - ay;
    const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / abLenSq));
    const qx = ax + t * abx;
    const qy = ay + t * aby;
    return Math.hypot(px - qx, py - qy);
  }

  private getTongueHitHalfWidth(): number {
    return Math.max(GRAPPLE.tongueOutlineWidth, GRAPPLE.tongueWidth) * 0.5 + 6;
  }

  private circleHitsTongue(cx: number, cy: number, r: number): boolean {
    if (!this.grapple) {
      return false;
    }
    const grappleProgress = Player.computeGrappleAnimProgress(this.grapple, GRAPPLE.extendSec);
    const tongueOut =
      this.grapple.phase === 'pull' || grappleProgress < GRAPPLE.proceduralTongueUntil;
    if (!tongueOut) {
      return false;
    }
    const mouth = this.getMouthWorld();
    const tip = this.getTongueTipWorld(mouth);
    const dx = tip.x - mouth.x;
    const dy = tip.y - mouth.y;
    const len = Math.hypot(dx, dy);
    if (len < 4) {
      return false;
    }
    const nx = (-dy / len) * 16;
    const ny = (dx / len) * 16;
    const mx = (mouth.x + tip.x) * 0.5 + nx;
    const my = (mouth.y + tip.y) * 0.5 + ny;
    const half = this.getTongueHitHalfWidth() + r;
    const d = Math.min(
      this.distPointToSegment(cx, cy, mouth.x, mouth.y, mx, my),
      this.distPointToSegment(cx, cy, mx, my, tip.x, tip.y),
    );
    return d <= half;
  }

  private circleHitsPlayerBody(cx: number, cy: number, r: number): boolean {
    const b = this.player.body;
    const tx = Math.max(b.x, Math.min(cx, b.x + b.width));
    const ty = Math.max(b.y, Math.min(cy, b.y + b.height));
    const dx = cx - tx;
    const dy = cy - ty;
    return dx * dx + dy * dy < r * r;
  }

  private tryPickupCollectible(c: Collectible): void {
    if (c.phase !== 'active') {
      return;
    }
    const pos = this.getCollectibleAnchor(c);
    if (!pos) {
      return;
    }
    const hit =
      this.circleHitsPlayerBody(pos.x, pos.y, c.r) ||
      this.circleHitsTongue(pos.x, pos.y, c.r);
    if (!hit) {
      return;
    }
    const add = this.getCollectiblePoints(c.kind);
    this.score += add * this.getScoreGainMultiplier();
    this.scoreboard?.onPointsGained(add);
    if (c.kind === 'coin') {
      this.goldCount += 1;
      this.sfx.play('collect_coin', 0.9);
    } else if (c.kind === 'diamond') {
      this.diamondCount += 1;
      this.sfx.play('collect_diamond', 0.92);
      this.spawnDiamondCollectShine(pos.x, pos.y);
    } else {
      this.activatePlayerShield();
      this.sfx.play('collect_diamond', 0.92);
      this.spawnDiamondCollectShine(pos.x, pos.y);
    }
    this.hudGoldShown = this.goldCount;
    this.hudDiamondShown = this.diamondCount;
    this.collectibleHudBump = 1;
    c.phase = 'collecting';
    c.collectT = 0;
    c.collectStartX = pos.x;
    c.collectStartY = pos.y;
  }

  private respawnCollectible(c: Collectible): void {
    const kind = this.pickCollectibleKind();
    c.kind = kind;
    c.r = this.getCollectibleRadius(kind);
    c.phase = 'active';
    c.collectT = 0;
    const occupied = this.getOccupiedActivePlatformIndices();
    const slot = this.pickPlatformSpawnSlot(c.r, occupied);
    if (slot) {
      c.platformIdx = slot.platformIdx;
      c.along = slot.along;
    } else {
      c.platformIdx = Math.floor(Math.random() * this.platforms.length);
      c.along = Math.random();
    }
  }

  private updateCollectibles(dt: number): void {
    const dur = Math.max(1e-6, COLLECTIBLES.collectDurationSec);
    for (const c of this.collectibles) {
      if (c.phase === 'collecting') {
        c.collectT = Math.min(1, c.collectT + dt / dur);
        if (c.collectT >= 1) {
          this.respawnCollectible(c);
        }
        continue;
      }
      this.tryPickupCollectible(c);
    }
  }

  private drawCollectibles(): void {
    const t = this.runTime;
    for (const c of this.collectibles) {
      let cx: number;
      let cy: number;
      let alphaMul = 1;

      if (c.phase === 'collecting') {
        const u = c.collectT;
        const ease = 1 - (1 - u) * (1 - u);
        cx = c.collectStartX;
        cy = c.collectStartY - COLLECTIBLES.collectRisePx * ease;
        alphaMul = 1 - u;
      } else {
        const anchor = this.getCollectibleAnchor(c);
        if (!anchor) {
          continue;
        }
        const bob =
          Math.sin(t * Math.PI * 2 * COLLECTIBLES.bobHz + c.platformIdx * 0.71 + c.along * 3.1) *
          COLLECTIBLES.bobAmplitudePx;
        cx = anchor.x;
        cy = anchor.y + bob;
      }

      const baseR = c.r;

      if (c.kind === 'coin') {
        const spin01 =
          (Math.cos(t * Math.PI * 2 * COLLECTIBLES.coinSpinHz + c.along * 4.2) + 1) * 0.5;
        const scaleX = COLLECTIBLES.coinMinScaleX + (1 - COLLECTIBLES.coinMinScaleX) * spin01;
        const rx = baseR * scaleX;
        const ry = baseR;
        const go = COLLECTIBLES.glowOuterPx;
        const gm = COLLECTIBLES.glowMidPx;
        this.collectiblesGfx
          .ellipse(cx, cy, rx + go, ry + go)
          .fill({ color: 0xffaa33, alpha: 0.1 * alphaMul });
        this.collectiblesGfx
          .ellipse(cx, cy, rx + gm, ry + gm)
          .fill({ color: 0xffcc55, alpha: 0.2 * alphaMul });
        this.collectiblesGfx
          .ellipse(cx, cy, rx, ry)
          .fill({ color: 0xffd24a, alpha: alphaMul })
          .stroke({ width: 2.2, color: 0xaa7010, alpha: alphaMul * 0.95 });
        this.collectiblesGfx
          .ellipse(cx - rx * 0.32, cy - ry * 0.22, rx * 0.38, ry * 0.24)
          .fill({ color: 0xfff2a0, alpha: alphaMul * 0.65 });
      } else if (c.kind === 'shield') {
        const pulse = Math.sin(t * Math.PI * 2 * COLLECTIBLES.diamondPulseHz + c.platformIdx * 0.45);
        const pulse01 = (pulse + 1) * 0.5;
        const r = baseR * (1 + 0.08 * pulse);
        const alpha = (0.72 + 0.28 * pulse01) * alphaMul;
        this.collectiblesGfx
          .circle(cx, cy, r + COLLECTIBLES.glowOuterPx)
          .fill({ color: 0x2aa8ff, alpha: alpha * 0.16 });
        this.collectiblesGfx
          .circle(cx, cy, r + COLLECTIBLES.glowMidPx)
          .stroke({ width: 4, color: 0x7af0ff, alpha: alpha * 0.5 });
        this.collectiblesGfx
          .circle(cx, cy, r)
          .stroke({ width: 3.4, color: 0xc8ffff, alpha })
          .fill({ color: 0x2266ff, alpha: alpha * 0.22 });
        this.collectiblesGfx
          .circle(cx, cy, r * 0.58)
          .stroke({ width: 2, color: 0xffffff, alpha: alpha * 0.58 });
      } else {
        const pulse = Math.sin(t * Math.PI * 2 * COLLECTIBLES.diamondPulseHz + c.platformIdx * 0.45);
        const pulse01 = (pulse + 1) * 0.5;
        const scale = 1 + COLLECTIBLES.diamondPulseScale * pulse;
        let collectBurst = 1;
        if (c.phase === 'collecting') {
          const u = c.collectT;
          collectBurst = 1 + 0.62 * Math.sin(Math.min(1, u / 0.22) * Math.PI * 0.92);
        }
        const diamondAlpha =
          COLLECTIBLES.diamondAlphaMin +
          (COLLECTIBLES.diamondAlphaMax - COLLECTIBLES.diamondAlphaMin) * pulse01;
        const alpha = diamondAlpha * alphaMul;
        const s = baseR * 1.05 * scale * collectBurst;
        const go = COLLECTIBLES.glowOuterPx;
        const gm = COLLECTIBLES.glowMidPx;

        this.collectiblesGfx
          .moveTo(cx, cy - s - go * 0.65)
          .lineTo(cx + (s + go) * 0.92, cy)
          .lineTo(cx, cy + s + go * 0.65)
          .lineTo(cx - (s + go) * 0.92, cy)
          .lineTo(cx, cy - s - go * 0.65)
          .fill({ color: 0x44eeff, alpha: alpha * 0.12 });

        this.collectiblesGfx
          .moveTo(cx, cy - s - gm * 0.45)
          .lineTo(cx + (s + gm) * 0.92, cy)
          .lineTo(cx, cy + s + gm * 0.45)
          .lineTo(cx - (s + gm) * 0.92, cy)
          .lineTo(cx, cy - s - gm * 0.45)
          .fill({ color: 0x7af0ff, alpha: alpha * 0.28 });

        this.collectiblesGfx
          .moveTo(cx, cy - s)
          .lineTo(cx + s * 0.92, cy)
          .lineTo(cx, cy + s)
          .lineTo(cx - s * 0.92, cy)
          .lineTo(cx, cy - s)
          .fill({ color: 0x7af0ff, alpha })
          .stroke({ width: 2.2, color: 0x208899, alpha: alpha * 0.95 });

        const hx = pulse01;
        this.collectiblesGfx
          .moveTo(cx - s * 0.15, cy - s * 0.72)
          .lineTo(cx + s * 0.35 * hx, cy - s * 0.35)
          .lineTo(cx + s * 0.12, cy - s * 0.05)
          .lineTo(cx - s * 0.22, cy - s * 0.5)
          .lineTo(cx - s * 0.15, cy - s * 0.72)
          .fill({ color: 0xe8ffff, alpha: alpha * 0.55 * hx });
      }
    }
  }

  private drawGrappleTongue(
    mouth: { x: number; y: number },
    tip: { x: number; y: number },
    beastMode: boolean,
  ): void {
    const dx = tip.x - mouth.x;
    const dy = tip.y - mouth.y;
    const len = Math.hypot(dx, dy);
    if (len < 4) {
      return;
    }

    const progress = Player.computeGrappleAnimProgress(this.grapple, GRAPPLE.extendSec);
    const wave = Math.sin(this.runTime * 18) * 0.45 + Math.cos(this.runTime * 11) * 0.2;
    const points = this.buildPaintedTongueSpine(mouth, tip, wave);
    const left: Array<{ x: number; y: number }> = [];
    const right: Array<{ x: number; y: number }> = [];
    const maxIndex = Math.max(1, points.length - 1);

    for (let i = 0; i < points.length; i += 1) {
      const p = points[i];
      const next = i < maxIndex ? points[i + 1] : points[i - 1];
      const tx = next.x - p.x;
      const ty = next.y - p.y;
      const tLen = Math.hypot(tx, ty) || 1;
      const nx = -ty / tLen;
      const ny = tx / tLen;
      const u = i / maxIndex;
      const tipBlob = Math.pow(Math.min(1, u * 1.2), 2) * 16;
      const body = Math.sin(u * Math.PI) * 12;
      const rootTaper = Math.max(0.16, u);
      const w = (tipBlob + body + 4) * rootTaper * (0.85 + progress * 0.15);
      left.push({ x: p.x + nx * w, y: p.y + ny * w });
      right.push({ x: p.x - nx * w, y: p.y - ny * w });
    }

    const baseFill = 0xe85a76;
    const shadowFill = 0x621426;
    const rimColor = 0xa02240;
    const highlight = 0xffd8e4;

    this.tongueVector
      .moveTo(left[0].x + 3, left[0].y + 4)
      .poly([...left.slice(1), ...right.slice().reverse()].map((p) => [p.x + 3, p.y + 4]).flat())
      .fill({ color: shadowFill, alpha: 0.28 });

    this.tongueVector
      .moveTo(left[0].x, left[0].y)
      .poly([...left.slice(1), ...right.slice().reverse()].map((p) => [p.x, p.y]).flat())
      .fill({ color: baseFill, alpha: 0.96 })
      .stroke({ width: 1.8, color: rimColor, alpha: 0.9 });

    this.tongueVector
      .moveTo(points[0].x, points[0].y)
      .poly(points.slice(1).map((p) => [p.x, p.y]).flat())
      .stroke({
        width: 2.2,
        color: shadowFill,
        alpha: 0.35,
        cap: 'round',
        join: 'round',
      });

    // glossy highlight strip slightly offset on one side.
    const hlPath: number[] = [];
    for (let i = 0; i < points.length; i += 1) {
      const p = points[i];
      const next = i < maxIndex ? points[i + 1] : points[i - 1];
      const tx = next.x - p.x;
      const ty = next.y - p.y;
      const tLen = Math.hypot(tx, ty) || 1;
      const nx = -ty / tLen;
      const ny = tx / tLen;
      const u = i / maxIndex;
      const body = Math.sin(u * Math.PI) * 7;
      const off = 4 + body * 0.24;
      hlPath.push(p.x + nx * off, p.y + ny * off);
    }
    this.tongueVector
      .moveTo(hlPath[0], hlPath[1])
      .poly(hlPath.slice(2))
      .stroke({ width: 2.6, color: highlight, alpha: 0.45, cap: 'round', join: 'round' });

    const tipRadius = 11 + progress * 5;
    this.tongueVector
      .circle(tip.x, tip.y, tipRadius)
      .fill({ color: baseFill, alpha: 0.95 })
      .stroke({ width: 1.6, color: rimColor, alpha: 0.85 });
    this.tongueVector.circle(tip.x - tipRadius * 0.28, tip.y - tipRadius * 0.24, tipRadius * 0.32).fill({
      color: highlight,
      alpha: 0.68,
    });
  }

  private buildPaintedTongueSpine(
    mouth: { x: number; y: number },
    tip: { x: number; y: number },
    wave: number,
  ): Array<{ x: number; y: number }> {
    const steps = 44;
    const dx = tip.x - mouth.x;
    const dy = tip.y - mouth.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const px = -uy;
    const py = ux;
    const c1x = mouth.x + ux * len * 0.35 + px * len * 0.12 * Math.cos(wave);
    const c1y = mouth.y + uy * len * 0.35 + py * len * 0.12 * Math.cos(wave);
    const c2x = mouth.x + ux * len * 0.7 - px * len * 0.1 * Math.sin(wave * 0.9);
    const c2y = mouth.y + uy * len * 0.7 - py * len * 0.1 * Math.sin(wave * 0.9);
    const points: Array<{ x: number; y: number }> = [];
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      const m = 1 - t;
      points.push({
        x: m * m * m * mouth.x + 3 * m * m * t * c1x + 3 * m * t * t * c2x + t * t * t * tip.x,
        y: m * m * m * mouth.y + 3 * m * m * t * c1y + 3 * m * t * t * c2y + t * t * t * tip.y,
      });
    }
    return points;
  }

  private drawCrystalPlatform(platform: Platform): void {
    if (platform.kind === 'rest') {
      this.drawRestFloorPlatform(platform);
      return;
    }
    if (!this.platformTexture) {
      this.platformLayer
        .roundRect(platform.x, platform.y, platform.width, platform.height, 6)
        .fill({ color: 0x8c7ac2, alpha: 0.55 });
    }
  }

  private drawRestFloorPlatform(platform: Platform): void {
    const h = Math.max(platform.height * 1.18, platform.height + 12);
    const tile = REST_FLOOR_TILE_PX;
    const x = platform.x;
    const width = platform.width;
    this.platformLayer
      .rect(x, platform.y - 4, width, h + 8)
      .fill({ color: 0x1a1630, alpha: 0.96 })
      .stroke({ color: 0xb8f7ff, width: 2.5, alpha: 0.88 });
    this.platformLayer
      .rect(x, platform.y, width, h * 0.35)
      .fill({ color: 0x39336c, alpha: 0.9 });
    const cols = Math.ceil(width / tile);
    for (let i = 0; i < cols; i += 1) {
      const tileX = x + i * tile;
      const color = i % 2 === 0 ? 0x302a58 : 0x262044;
      this.platformLayer
        .rect(tileX, platform.y + h * 0.35, Math.min(tile, width - i * tile), h * 0.65)
        .fill({ color, alpha: 0.95 });
      this.platformLayer
        .rect(tileX, platform.y - 4, 2, h + 8)
        .fill({ color: 0x80f7ff, alpha: 0.18 });
    }
    this.platformLayer
      .rect(x, platform.y - 6, width, 6)
      .fill({ color: 0xc8ffff, alpha: 0.78 });
  }

  private async loadPlatformSprite(): Promise<void> {
    this.platformTexture = await this.createCheckerTransparentTexture(crystalPlatformUrl);
    try {
      this.restFloorHouseTexture = await this.loadTextureFromCandidates(REST_FLOOR_HOUSE_CANDIDATES);
      console.log('Loaded rest floor house:', REST_FLOOR_HOUSE_CANDIDATES[0]);
    } catch {
      this.restFloorHouseTexture = undefined;
      console.warn('Failed to load rest floor house asset:', [...REST_FLOOR_HOUSE_CANDIDATES]);
    }
    try {
      this.restFloorCloudTexture = (await Assets.load<Texture>(REST_FLOOR_CLOUD_URL)) as Texture;
      console.log('Loaded rest floor cloud:', REST_FLOOR_CLOUD_URL);
    } catch {
      this.restFloorCloudTexture = undefined;
      console.warn('Failed to load rest floor cloud asset:', REST_FLOOR_CLOUD_URL);
    }
    try {
      // Slime tier uses hand-painted grass/dirt tiles (from `spring_.png`); do not run
      // `createEdgeDarkTransparentTexture` — dark soil pixels touch the edges and would be
      // flood-cleared, corrupting the GPU texture.
      this.platformTextureSlime = (await Assets.load<Texture>(slimePlatformUrl)) as Texture;
    } catch {
      this.platformTextureSlime = undefined;
    }
    try {
      this.platformTextureVolcano = await this.createEdgeDarkTransparentTexture(volcanoPlatformUrl);
    } catch {
      this.platformTextureVolcano = undefined;
    }
    try {
      this.platformTextureStorm = await this.createEdgeDarkTransparentTexture(stormPlatformUrl);
    } catch {
      this.platformTextureStorm = undefined;
    }
  }

  /**
   * Compute the responsive layout for the rest-floor props.
   * - `propX` anchors the house to {@link REST_FLOOR_HOUSE_SCREEN_X_RATIO} of the current visible viewport
   *   (in world space), so it stays on-screen across desktop and mobile aspect ratios.
   * - `propScale` shrinks the house and its clouds on narrow viewports so they aren't cropped.
   * Y is always pinned to the 1000m rest-floor top (`floorY`) so clouds and house never drift
   * away from the floor when the window resizes or aspect ratio changes.
   */
  private getRestFloorPropLayout(): { propX: number; propScale: number; floorY: number } {
    const floorY = this.getRestFloorTopY(REST_FLOOR_HOUSE_METERS);
    const propX = this.cameraX + this.worldWidthFromScreen() * REST_FLOOR_HOUSE_SCREEN_X_RATIO;
    const propScale =
      this.width < REST_FLOOR_PROPS_MOBILE_SCREEN_W
        ? REST_FLOOR_HOUSE_SCALE_MOBILE
        : REST_FLOOR_HOUSE_SCALE_DESKTOP;
    return { propX, propScale, floorY };
  }

  private spawnRestFloorHouse(): void {
    const texture = this.restFloorHouseTexture;
    if (!texture) {
      return;
    }
    const { propX, propScale, floorY } = this.getRestFloorPropLayout();
    this.spawnRestFloorCloud(propX, floorY, 'left', propScale);
    this.spawnRestFloorCloud(propX, floorY, 'right', propScale);
    let house = this.restFloorHouseSprite;
    if (!house) {
      house = new Sprite(texture);
      house.anchor.set(0.5, 1);
      house.roundPixels = RENDER.pixelArt;
      house.eventMode = 'none';
      house.zIndex = REST_FLOOR_HOUSE_DEPTH;
      this.restFloorHouseSprite = house;
      this.restFloorPropLayer.addChild(house);
    } else {
      house.texture = texture;
    }
    (house as Sprite & { setScrollFactor?: (value: number) => void }).setScrollFactor?.(1);

    house.anchor.set(0.5, 1);
    house.scale.set(propScale);
    house.rotation = 0;
    house.position.set(propX, floorY + REST_FLOOR_HOUSE_SINK_PX);
    house.visible = true;
    house.alpha = 1;
  }

  private spawnRestFloorCloud(
    x: number,
    floorY: number,
    side: 'left' | 'right',
    propScale: number,
  ): void {
    const texture = this.restFloorCloudTexture;
    if (!texture) {
      return;
    }
    let cloud = side === 'left' ? this.restFloorCloudSprite : this.restFloorCloudRightSprite;
    if (!cloud) {
      cloud = new Sprite(texture);
      cloud.anchor.set(0.5);
      cloud.roundPixels = RENDER.pixelArt;
      cloud.eventMode = 'none';
      cloud.zIndex = REST_FLOOR_CLOUD_DEPTH;
      if (side === 'left') {
        this.restFloorCloudSprite = cloud;
      } else {
        this.restFloorCloudRightSprite = cloud;
      }
      this.restFloorPropLayer.addChild(cloud);
    } else {
      cloud.texture = texture;
    }

    cloud.width = REST_FLOOR_CLOUD_WIDTH_PX * propScale;
    cloud.scale.y = Math.abs(cloud.scale.x);
    cloud.rotation = (REST_FLOOR_CLOUD_ROTATION_DEG * Math.PI) / 180;
    const baseOffsetX =
      side === 'left' ? REST_FLOOR_CLOUD_OFFSET_X_PX : REST_FLOOR_CLOUD_RIGHT_OFFSET_X_PX;
    cloud.position.set(x + baseOffsetX * propScale, floorY + REST_FLOOR_CLOUD_SINK_PX);
    cloud.visible = true;
    cloud.alpha = 1;
  }

  /**
   * Per-frame: refresh the rest-floor house+clouds layout so they track viewport resizes
   * (mobile browser chrome toggling, orientation change) and stay anchored to the rest floor.
   */
  private updateRestFloorCloudBreathing(): void {
    const { propX, propScale, floorY } = this.getRestFloorPropLayout();
    const house = this.restFloorHouseSprite;
    if (house && house.visible) {
      house.anchor.set(0.5, 1);
      house.scale.set(propScale);
      house.position.set(propX, floorY + REST_FLOOR_HOUSE_SINK_PX);
    }
    const breath = Math.sin(this.runTime * Math.PI * 2 * REST_FLOOR_CLOUD_BREATH_HZ);
    const breathScale = 1 + breath * REST_FLOOR_CLOUD_BREATH_SCALE;
    const y = floorY + REST_FLOOR_CLOUD_SINK_PX + breath * REST_FLOOR_CLOUD_BREATH_AMPLITUDE_PX;

    this.applyRestFloorCloudBreath(
      this.restFloorCloudSprite,
      propX + REST_FLOOR_CLOUD_OFFSET_X_PX * propScale,
      y,
      breathScale * propScale,
    );
    this.applyRestFloorCloudBreath(
      this.restFloorCloudRightSprite,
      propX + REST_FLOOR_CLOUD_RIGHT_OFFSET_X_PX * propScale,
      y,
      breathScale * propScale,
    );
  }

  private applyRestFloorCloudBreath(
    cloud: Sprite | undefined,
    x: number,
    y: number,
    scale: number,
  ): void {
    if (!cloud || !cloud.visible) {
      return;
    }
    cloud.width = REST_FLOOR_CLOUD_WIDTH_PX * scale;
    cloud.scale.y = Math.abs(cloud.scale.x);
    cloud.position.set(x, y);
  }

  private createPlatformSprites(): void {
    if (!this.platformTexture) {
      return;
    }

    for (const platform of this.platforms) {
      const root = new Container();
      root.eventMode = 'none';
      root.position.set(platform.x, platform.y);
      root.alpha = 0.98;
      this.platformSpriteLayer.addChild(root);
      this.platformSprites.push(root);
      this.platformSpriteModes.push('legacy');
      this.platformSpriteCols.push(-1);
      this.beadBridgeLayoutSig.push(-1);
    }
  }

  private clearPlatformSprites(): void {
    for (const root of this.platformSprites) {
      root.destroy({ children: true });
    }

    this.platformSprites = [];
    this.platformSpriteModes = [];
    this.platformSpriteCols = [];
    this.beadBridgeLayoutSig = [];
    this.platformSpriteLayer.removeChildren();
  }

  private syncLegacyPlatformSprite(
    index: number,
    root: Container,
    platform: Platform,
    tex: Texture,
    artMul: number,
  ): void {
    let sprite = root.children.find((c): c is Sprite => c instanceof Sprite);
    if (this.platformSpriteModes[index] !== 'legacy' || !sprite) {
      root.removeChildren().forEach((child) => child.destroy());
      sprite = new Sprite(tex);
      sprite.anchor.set(0.5);
      root.addChild(sprite);
      this.platformSpriteModes[index] = 'legacy';
      this.platformSpriteCols[index] = -1;
    } else if (sprite.texture !== tex) {
      sprite.texture = tex;
    }
    if (!sprite) {
      return;
    }
    sprite.roundPixels = RENDER.pixelArt;
    let scaleMul = artMul;
    if (tex === this.platformTextureSlime) {
      const w = Math.max(1, platform.width);
      const beadR = this.beadBridgeBeadRadius(platform);
      const targetTilePx = 2 * beadR;
      scaleMul = (targetTilePx * tex.width) / (SLIME_PLATFORM_TILE_PX * w);
    }
    sprite.width = platform.width * scaleMul;
    sprite.scale.y = Math.abs(sprite.scale.x);
    sprite.position.set(platform.width * 0.5, platform.height * 0.5 + 6);
    root.position.set(platform.x, platform.y);
    root.alpha = 0.98;

    const isSlime = tex === this.platformTextureSlime;
    if (isSlime) {
      const tw = tex.width;
      const th = tex.height;
      const sw = sprite.width;
      const sh = (th / tw) * sw;
      const cx = platform.width * 0.5;
      const cy = platform.height * 0.5 + 6;
      const halfH = sh * 0.5;
      const top = cy - halfH;
      const bottom = cy + halfH;
      const maskY = Math.min(0, top);
      const maskH = Math.max(platform.height, bottom) - maskY;

      let maskGfx = root.children.find(
        (c): c is Graphics => c instanceof Graphics && c.label === 'slime-platform-mask',
      );
      if (!maskGfx) {
        maskGfx = new Graphics();
        maskGfx.label = 'slime-platform-mask';
        maskGfx.eventMode = 'none';
        root.addChildAt(maskGfx, 0);
      }
      maskGfx.clear();
      maskGfx.rect(0, maskY, platform.width, maskH).fill({ color: 0xffffff });
      root.mask = maskGfx;
    } else {
      root.mask = null;
      for (const c of [...root.children]) {
        if (c instanceof Graphics && c.label === 'slime-platform-mask') {
          root.removeChild(c);
          c.destroy();
        }
      }
    }
  }

  /** Same bead radius as `syncBeadBridgePlatformSprite` (visual sizing only). */
  private beadBridgeBeadRadius(platform: Platform): number {
    const w = platform.width;
    const h = platform.height;
    return Math.max(5.5, Math.min(h * 0.4, w * 0.09));
  }

  /**
   * Rope “bead” bridge along the stair top: round segments + sagging cord (visual only).
   * Physics stays the full `platform` AABB.
   */
  private syncBeadBridgePlatformSprite(
    index: number,
    root: Container,
    platform: Platform,
  ): void {
    const sid = Math.max(0, platform.stairId);
    const w = platform.width;
    const h = platform.height;
    const beadR = this.beadBridgeBeadRadius(platform);
    const margin = beadR * 1.15;
    const span = Math.max(w - margin * 2, beadR * 3.5);
    const step = beadR * 2.05;
    const n = Math.max(5, Math.min(16, Math.floor(span / step)));
    const sag = beadR * (0.58 + (sid % 6) * 0.045);
    const cy = h * 0.5 + 4;
    const palIdx = sid % BEAD_BRIDGE_PALETTES.length;
    const layoutSig =
      Math.round(w * 10) +
      Math.round(h * 10) * 10_000 +
      n * 100_000_000 +
      palIdx * 2_000_000_000 +
      Math.round(beadR * 50) * 10_000_000_000 +
      Math.round(sag * 40) * 1_000_000_000_000;

    const first = root.children[0];
    const needRebuild =
      this.platformSpriteModes[index] !== 'bead' ||
      this.beadBridgeLayoutSig[index] !== layoutSig ||
      !(first instanceof Graphics) ||
      first.label !== 'bead-bridge';

    if (needRebuild) {
      root.removeChildren().forEach((c) => c.destroy());
      const g = new Graphics();
      g.label = 'bead-bridge';
      g.roundPixels = RENDER.pixelArt;
      const pal = BEAD_BRIDGE_PALETTES[palIdx] ?? BEAD_BRIDGE_PALETTES[0];
      const xs: number[] = [];
      const ys: number[] = [];
      const x0 = margin;
      for (let i = 0; i < n; i += 1) {
        const t = n <= 1 ? 0.5 : i / (n - 1);
        const x = x0 + t * span;
        const sagY = sag * 4 * t * (1 - t);
        xs.push(x);
        ys.push(cy + sagY);
      }

      if (xs.length >= 2) {
        g.moveTo(xs[0], ys[0]);
        for (let i = 1; i < xs.length; i += 1) {
          g.lineTo(xs[i], ys[i]);
        }
        g.stroke({
          width: Math.max(1.25, beadR * 0.16),
          color: 0x000000,
          alpha: 1,
        });
      }

      const outlineW = Math.max(1.15, beadR * 0.14);
      for (let i = 0; i < n; i += 1) {
        const x = xs[i];
        const y = ys[i];
        g.circle(x, y + beadR * 0.1, beadR * 0.9).fill({ color: pal.shadow, alpha: 1 });
        g.circle(x, y, beadR)
          .fill({ color: pal.body, alpha: 1 })
          .stroke({ width: outlineW, color: 0x000000, alpha: 1 });
        g.circle(x - beadR * 0.22, y - beadR * 0.28, beadR * 0.3).fill({
          color: pal.hi,
          alpha: 0.95,
        });
      }

      root.addChild(g);
      this.platformSpriteModes[index] = 'bead';
      this.platformSpriteCols[index] = n;
      this.beadBridgeLayoutSig[index] = layoutSig;
    }

    root.scale.set(1);
    root.position.set(platform.x, platform.y);
    root.alpha = 0.98;
  }

  /**
   * Load and slice the three mushroom strips (idle / run / attack) into per-frame textures.
   * Each strip is a single 64-px tall row of 80×80 frames placed left-to-right; we reuse the
   * same `TextureSource` and just hand each frame a unique source rectangle.
   */
  private async loadMushroomTextures(): Promise<void> {
    try {
      const [idleSheet, runSheet, attackSheet, dieSheet, bloodSheet] = (await Promise.all([
        Assets.load(MUSHROOM_IDLE_URL),
        Assets.load(MUSHROOM_RUN_URL),
        Assets.load(MUSHROOM_ATTACK_URL),
        Assets.load(MUSHROOM_DIE_URL),
        Assets.load(BLOOD_SHEET_URL),
      ])) as Texture[];

      const slice = (sheet: Texture, count: number): Texture[] => {
        const out: Texture[] = [];
        const source = sheet.source;
        for (let i = 0; i < count; i += 1) {
          out.push(
            new Texture({
              source,
              frame: new Rectangle(
                i * MUSHROOM_FRAME_W,
                0,
                MUSHROOM_FRAME_W,
                MUSHROOM_FRAME_H,
              ),
            }),
          );
        }
        return out;
      };

      this.mushroomIdleTextures = slice(idleSheet, MUSHROOM_IDLE_FRAME_COUNT);
      this.mushroomRunTextures = slice(runSheet, MUSHROOM_RUN_FRAME_COUNT);
      this.mushroomAttackTextures = slice(attackSheet, MUSHROOM_ATTACK_FRAME_COUNT);

      const dieSource = dieSheet.source;
      const dieFrameCount = Math.min(
        MUSHROOM_DIE_FRAME_COUNT,
        Math.max(1, Math.floor(dieSource.width / MUSHROOM_FRAME_W)),
      );
      this.mushroomDieTextures = [];
      for (let i = 0; i < dieFrameCount; i += 1) {
        this.mushroomDieTextures.push(
          new Texture({
            source: dieSource,
            frame: new Rectangle(i * MUSHROOM_FRAME_W, 0, MUSHROOM_FRAME_W, MUSHROOM_FRAME_H),
          }),
        );
      }

      const bloodSource = bloodSheet.source;
      const cellW = Math.max(1, Math.floor(bloodSource.width / BLOOD_SHEET_COLS));
      const cellH = Math.max(1, Math.floor(bloodSource.height / BLOOD_SHEET_COLS));
      this.bloodEffectTextures = [];
      for (let i = 0; i < BLOOD_EFFECT_FRAME_COUNT; i += 1) {
        const col = i % BLOOD_SHEET_COLS;
        const row = Math.floor(i / BLOOD_SHEET_COLS);
        this.bloodEffectTextures.push(
          new Texture({
            source: bloodSource,
            frame: new Rectangle(col * cellW, row * cellH, cellW, cellH),
          }),
        );
      }
    } catch {
      this.mushroomIdleTextures = [];
      this.mushroomRunTextures = [];
      this.mushroomAttackTextures = [];
      this.mushroomDieTextures = [];
      this.bloodEffectTextures = [];
    }
  }

  private pickMushroomFrames(state: MushroomEnemyState): Texture[] {
    if (state === 'idle' && this.mushroomIdleTextures.length > 0) {
      return this.mushroomIdleTextures;
    }
    if (state === 'attack' && this.mushroomAttackTextures.length > 0) {
      return this.mushroomAttackTextures;
    }
    return this.mushroomRunTextures;
  }

  /**
   * (Re)spawn the enemy roster from scratch. Mushrooms are bound to fixed platform indices
   * (every Nth slot starting at `MUSHROOM_PLATFORM_START_INDEX`) so the recycled stair pool
   * automatically carries enemies with it as the player climbs.
   */
  private spawnMushroomEnemies(): void {
    for (const sprite of this.mushroomEnemySprites) {
      sprite.destroy();
    }
    this.mushroomEnemySprites = [];
    this.mushroomEnemies = [];
    this.mushroomEnemyLayer.removeChildren();

    if (this.mushroomRunTextures.length === 0) {
      return;
    }

    for (
      let i = MUSHROOM_PLATFORM_START_INDEX;
      i < this.platforms.length;
      i += MUSHROOM_PLATFORM_STRIDE
    ) {
      const platform = this.platforms[i];
      if (!platform || !this.canMushroomOccupyPlatform(platform)) {
        continue;
      }
      const enemy: MushroomEnemy = {
        platformIdx: i,
        along: 0.3 + Math.random() * 0.4,
        direction: Math.random() < 0.5 ? -1 : 1,
        state: 'run',
        animTime: Math.random() * 0.6,
        edgePauseLeft: 0,
      };
      this.mushroomEnemies.push(enemy);

      const sprite = new Sprite(this.mushroomRunTextures[0]);
      sprite.anchor.set(0.5, 1);
      sprite.roundPixels = RENDER.pixelArt;
      sprite.scale.set(MUSHROOM_SPRITE_SCALE);
      sprite.eventMode = 'none';
      this.mushroomEnemyLayer.addChild(sprite);
      this.mushroomEnemySprites.push(sprite);
    }
  }

  /**
   * Per-frame enemy tick: drives the simple walk / edge-flip AI, picks the right animation
   * frame, syncs the sprite to its platform, and tests AABB overlap with the player. Any
   * overlap ends the run via `triggerGameOver()`.
   */
  private updateMushroomEnemies(dt: number): void {
    if (this.mushroomEnemies.length === 0 || this.gameOver) {
      return;
    }

    const pb = this.player.body;
    const playerCx = pb.x + pb.width * 0.5;
    const playerGrounded = pb.grounded;

    for (let i = 0; i < this.mushroomEnemies.length; i += 1) {
      const enemy = this.mushroomEnemies[i];
      const platform = this.platforms[enemy.platformIdx];
      const sprite = this.mushroomEnemySprites[i];
      if (!platform || !sprite) {
        continue;
      }
      if (!this.canMushroomOccupyPlatform(platform)) {
        sprite.visible = false;
        continue;
      }
      sprite.visible = true;

      enemy.animTime += dt;
      if (enemy.edgePauseLeft > 0) {
        enemy.edgePauseLeft = Math.max(0, enemy.edgePauseLeft - dt);
      }

      const onSamePlatform =
        playerGrounded && this.currentGroundPlatform === platform;
      const enemyCx = platform.x + enemy.along * platform.width;
      const closeToPlayer =
        onSamePlatform && Math.abs(enemyCx - playerCx) < MUSHROOM_ATTACK_RANGE_PX;

      let nextState: MushroomEnemyState;
      if (closeToPlayer) {
        nextState = 'attack';
      } else if (enemy.edgePauseLeft > 0) {
        nextState = 'idle';
      } else {
        nextState = 'run';
      }
      if (nextState !== enemy.state) {
        enemy.state = nextState;
        enemy.animTime = 0;
      }

      if (enemy.state === 'run') {
        const widthPx = Math.max(1, platform.width);
        const alongDelta = (MUSHROOM_WALK_SPEED_PX * dt) / widthPx;
        enemy.along += alongDelta * enemy.direction;
        if (enemy.along <= MUSHROOM_EDGE_MARGIN) {
          enemy.along = MUSHROOM_EDGE_MARGIN;
          enemy.direction = 1;
          enemy.edgePauseLeft = MUSHROOM_EDGE_PAUSE_SEC;
        } else if (enemy.along >= 1 - MUSHROOM_EDGE_MARGIN) {
          enemy.along = 1 - MUSHROOM_EDGE_MARGIN;
          enemy.direction = -1;
          enemy.edgePauseLeft = MUSHROOM_EDGE_PAUSE_SEC;
        }
      }

      const frames = this.pickMushroomFrames(enemy.state);
      if (frames.length > 0) {
        const idx = Math.floor(enemy.animTime * MUSHROOM_ANIM_FPS) % frames.length;
        sprite.texture = frames[idx];
      }

      const wx = platform.x + enemy.along * platform.width;
      const wy = platform.y;
      sprite.position.set(wx, wy + 2);
      sprite.scale.x = MUSHROOM_SPRITE_SCALE * enemy.direction;
      sprite.scale.y = MUSHROOM_SPRITE_SCALE;

      if (this.mushroomHitsPlayer(wx, wy)) {
        // Flash / beast combo boost: body contact vaporizes mushrooms (matches the pulsing
        // “charged” look on the avatar). No HP loss while boost is active.
        if (this.isFlashSkillBoostActive()) {
          this.destroyMushroomEnemy(i);
          i -= 1;
          continue;
        }
        if (this.damagePlayer()) {
          // Stop scanning this frame — `damagePlayer` already updated invuln/UI; subsequent
          // overlaps in the same frame would be wasted (one hit per swing window is enough).
          return;
        }
      }
    }
  }

  private canMushroomOccupyPlatform(platform: Platform): boolean {
    if (platform.kind === 'rest') {
      return false;
    }
    const clearPx = REST_FLOOR_MONSTER_CLEAR_METERS * 12;
    return !this.platforms.some(
      (p) => p.kind === 'rest' && Math.abs(p.y - platform.y) <= clearPx,
    );
  }

  /** AABB hit between a tight mushroom hitbox (centered on `wx`, anchored above `wy`) and the player body. */
  private mushroomHitsPlayer(wx: number, wy: number): boolean {
    const halfW = MUSHROOM_HITBOX_W * 0.5;
    const ex1 = wx - halfW;
    const ex2 = wx + halfW;
    const ey1 = wy - MUSHROOM_HITBOX_H;
    const ey2 = wy;
    const pb = this.player.body;
    return (
      ex1 < pb.x + pb.width &&
      ex2 > pb.x &&
      ey1 < pb.y + pb.height &&
      ey2 > pb.y
    );
  }

  private async createCheckerTransparentTexture(url: string): Promise<Texture> {
    const sourceTexture = await Assets.load<Texture>(url);
    const image = new Image();
    image.src = url;
    await image.decode();

    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;

    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) {
      return sourceTexture;
    }

    context.drawImage(image, 0, 0);
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    this.removeConnectedCheckerBackground(imageData.data, canvas.width, canvas.height);
    context.putImageData(imageData, 0, 0);

    return Texture.from(canvas);
  }

  /** Removes solid black / near-black regions connected to image edges (exported UI art). */
  private async createEdgeDarkTransparentTexture(url: string): Promise<Texture> {
    const fallback = await Assets.load<Texture>(url);
    const image = new Image();
    image.src = url;
    await image.decode();

    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;

    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) {
      return fallback;
    }

    context.drawImage(image, 0, 0);
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    this.removeConnectedDarkEdgeBackground(imageData.data, canvas.width, canvas.height);
    context.putImageData(imageData, 0, 0);

    return Texture.from(canvas);
  }

  private removeConnectedDarkEdgeBackground(
    pixels: Uint8ClampedArray,
    width: number,
    height: number,
  ): void {
    const visited = new Uint8Array(width * height);
    const queue: number[] = [];

    const enqueue = (x: number, y: number): void => {
      if (x < 0 || y < 0 || x >= width || y >= height) {
        return;
      }

      const pixelIndex = y * width + x;
      if (visited[pixelIndex]) {
        return;
      }

      visited[pixelIndex] = 1;

      if (this.isDarkEdgeBackgroundPixel(pixels, pixelIndex)) {
        queue.push(pixelIndex);
      }
    };

    for (let x = 0; x < width; x += 1) {
      enqueue(x, 0);
      enqueue(x, height - 1);
    }

    for (let y = 0; y < height; y += 1) {
      enqueue(0, y);
      enqueue(width - 1, y);
    }

    while (queue.length > 0) {
      const pixelIndex = queue.pop() ?? 0;
      pixels[pixelIndex * 4 + 3] = 0;

      const x = pixelIndex % width;
      const y = Math.floor(pixelIndex / width);
      enqueue(x + 1, y);
      enqueue(x - 1, y);
      enqueue(x, y + 1);
      enqueue(x, y - 1);
    }
  }

  private removeConnectedCheckerBackground(
    pixels: Uint8ClampedArray,
    width: number,
    height: number,
  ): void {
    const visited = new Uint8Array(width * height);
    const queue: number[] = [];

    const enqueue = (x: number, y: number): void => {
      if (x < 0 || y < 0 || x >= width || y >= height) {
        return;
      }

      const pixelIndex = y * width + x;
      if (visited[pixelIndex]) {
        return;
      }

      visited[pixelIndex] = 1;

      if (this.isCheckerBackgroundPixel(pixels, pixelIndex)) {
        queue.push(pixelIndex);
      }
    };

    for (let x = 0; x < width; x += 1) {
      enqueue(x, 0);
      enqueue(x, height - 1);
    }

    for (let y = 0; y < height; y += 1) {
      enqueue(0, y);
      enqueue(width - 1, y);
    }

    while (queue.length > 0) {
      const pixelIndex = queue.pop() ?? 0;
      pixels[pixelIndex * 4 + 3] = 0;

      const x = pixelIndex % width;
      const y = Math.floor(pixelIndex / width);
      enqueue(x + 1, y);
      enqueue(x - 1, y);
      enqueue(x, y + 1);
      enqueue(x, y - 1);
    }
  }

  private isDarkEdgeBackgroundPixel(pixels: Uint8ClampedArray, pixelIndex: number): boolean {
    const dataIndex = pixelIndex * 4;
    const red = pixels[dataIndex];
    const green = pixels[dataIndex + 1];
    const blue = pixels[dataIndex + 2];
    const alpha = pixels[dataIndex + 3];
    if (alpha < 12) {
      return true;
    }

    return Math.max(red, green, blue) <= DARK_BG_MAX_CHANNEL;
  }

  private isCheckerBackgroundPixel(pixels: Uint8ClampedArray, pixelIndex: number): boolean {
    const dataIndex = pixelIndex * 4;
    const red = pixels[dataIndex];
    const green = pixels[dataIndex + 1];
    const blue = pixels[dataIndex + 2];
    const alpha = pixels[dataIndex + 3];
    const brightness = Math.max(red, green, blue);
    const colorSpread = Math.max(red, green, blue) - Math.min(red, green, blue);

    return (
      alpha > 0 &&
      brightness > 70 &&
      brightness < 220 &&
      colorSpread <= CHECKER_BACKGROUND_COLOR_SPREAD
    );
  }

  private refreshWorldViewport(): void {
    this.worldWidth = WORLD_BOUNDS_W;
    this.worldHeight = WORLD_BOUNDS_H;
    this.worldMinY = WORLD_BOUNDS_Y;
    this.worldMaxY = WORLD_BOUNDS_Y + WORLD_BOUNDS_H;
  }

  private applyCameraTransform(): void {
    this.gameShake.scale.set(this.getCameraZoom());
    this.gameShake.position.set(this.shakeOffsetX, this.shakeOffsetY);
    this.uiLayer.scale.set(1);
    this.uiLayer.position.set(0, 0);
  }

  private worldWidthFromScreen(): number {
    return this.width / this.getCameraZoom();
  }

  private worldHeightFromScreen(): number {
    return this.height / this.getCameraZoom();
  }

  private getCameraZoom(): number {
    return this.width <= 430 ? MOBILE_CAMERA_ZOOM : CAMERA_ZOOM;
  }
}
