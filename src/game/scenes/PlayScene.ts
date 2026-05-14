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
  COLLECTIBLES,
  GRAPPLE,
  RENDER,
  SCORE_UI,
  STAIRS,
  WALK,
} from '../../config/game.config';
import { HyperScoreboard } from '../ui/HyperScoreboard';
import {
  ComboBadge,
  COMBO_BADGE_H,
  COMBO_BADGE_W,
  comboStreakToWordTier,
} from '../ui/ComboBadge';
import { ComboSynth } from '../audio/ComboSynth';
import { Player } from '../entities/Player';
import {
  fetchTopLeaderboard,
  mergeSessionIntoTop,
  saveLeaderboardRun,
  type LeaderboardEntry,
} from '../services/leaderboard';
import { getSavedNickname } from '../services/playerProfile';
import { isQuickStartMobileDevice } from '../utils/quickStartDevice';
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
import type { Scene } from './Scene';

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

type RecordedPlatform = {
  x: number;
  y: number;
  width: number;
  height: number;
  stairId: number;
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

/** Game binaries live in `public/assets/` and grouped subfolders. */
const GAME_ASSETS = `${import.meta.env.BASE_URL}assets`;
/** Gameplay BGM: random track from `public/assets/game music/` on each fresh run (see `pickRandomGameMusicBgmUrl`). */
const GAME_MUSIC_DIR_URL = `${GAME_ASSETS}/${encodeURIComponent('game music')}`;
const GAME_MUSIC_BGM_FILENAMES = [
  'Dream Sakura_Loop.ogg',
  'Honobono Teahouse.mp3',
  'Moonlight Japanese Harp.mp3',
  "Mountain God's Shrine.mp3",
  'Mysterious Kyoto.mp3',
  'Shamisen Samurai Rock.mp3',
  'Voice of Evening Calm.mp3',
] as const;
const GAME_MUSIC_BGM_TRACKS: readonly string[] = GAME_MUSIC_BGM_FILENAMES.map(
  (name) => `${GAME_MUSIC_DIR_URL}/${encodeURIComponent(name)}`,
);
/** If the curated list is empty (should not happen), fall back to legacy loop under `assets/music/`. */
const BGM_FALLBACK_URL = `${GAME_ASSETS}/music/${encodeURIComponent('Dream Sakura_Loop.ogg')}`;
const REST_FLOOR_HOUSE_CANDIDATES = [
  `${GAME_ASSETS}/house/isohome.png.png`,
  `${GAME_ASSETS}/house/${encodeURIComponent('House 1.png')}`,
] as const;
const REST_FLOOR_CLOUD_URL = `${GAME_ASSETS}/objects/Cloud.png`;
const REST_FLOOR_SUPPLIES_URL = `${GAME_ASSETS}/objects/supplies_objects.png`;

const SFX_LOCAL: Record<SfxId, string> = {
  tongue_shoot: `${import.meta.env.BASE_URL}audio/tongue_shoot.mp3`,
  tongue_hit: `${import.meta.env.BASE_URL}audio/tongue_hit.mp3`,
  collect_coin: `${import.meta.env.BASE_URL}audio/collect_coin.mp3`,
  collect_diamond: `${GAME_ASSETS}/${encodeURIComponent('sound effect')}/diamond_collect.mp3`,
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
  readonly padToTierBounds?: boolean;
};

type BackgroundTierId = '0-1000m' | '1000-2000m' | '2000m';

type BackgroundTierSpec = {
  readonly id: BackgroundTierId;
  readonly minMeters: number;
  readonly artWidth: number;
  readonly artHeight: number;
  readonly layers: readonly Bg7ParallaxLayerSpec[];
  readonly fallbackCandidates: readonly string[];
  readonly fallbackSpeed: number;
};

type LoadedBackgroundTier = {
  readonly id: BackgroundTierId;
  readonly layers: readonly { readonly texture: Texture; readonly speed: number }[];
};

const BACKGROUND_TIERS: readonly BackgroundTierSpec[] = [
  {
    id: '0-1000m',
    minMeters: 0,
    artWidth: 1456,
    artHeight: 816,
    layers: [
      {
        candidates: [`${GAME_ASSETS}/0-1000M/bg_7_0003_layer_3.png`],
        speed: 0.1,
      },
      {
        candidates: [`${GAME_ASSETS}/0-1000M/bg_7_0002_layer_2.png`],
        speed: 0.3,
      },
      {
        candidates: [`${GAME_ASSETS}/0-1000M/bg_7_0001_layer_1.png`],
        speed: 0.6,
      },
    ],
    fallbackCandidates: [`${GAME_ASSETS}/0-1000M/bg_7.png`],
    fallbackSpeed: 0.45,
  },
  {
    id: '1000-2000m',
    minMeters: 1000,
    artWidth: 1456,
    artHeight: 816,
    layers: [
      {
        candidates: [`${GAME_ASSETS}/1K-2KM/bg_4_0002_layer_2.png`],
        speed: 0.1,
      },
      {
        candidates: [`${GAME_ASSETS}/1K-2KM/bg_4_0001_layer_1.png`],
        speed: 0.3,
        padToTierBounds: true,
      },
      {
        candidates: [`${GAME_ASSETS}/1K-2KM/bg_4_0000_layer_0.png`],
        speed: 1.0,
      },
    ],
    fallbackCandidates: [`${GAME_ASSETS}/1K-2KM/bg_4.png`],
    fallbackSpeed: 0.45,
  },
  {
    id: '2000m',
    minMeters: 2000,
    artWidth: 1456,
    artHeight: 816,
    layers: [
      {
        candidates: [`${GAME_ASSETS}/2K-3KM/bg_1_layer_3.png`],
        speed: 0.1,
      },
      {
        candidates: [`${GAME_ASSETS}/2K-3KM/bg_1_layer_2.png`],
        speed: 0.3,
        padToTierBounds: true,
      },
    ],
    fallbackCandidates: [`${GAME_ASSETS}/2K-3KM/bg_1.png`],
    fallbackSpeed: 0.45,
  },
] as const;

/**
 * Mushroom enemy spritesheets.
 *
 * Each strip is a single 64-px tall row of 80×64 frames; the asset pack splits idle / run /
 * attack into separate files (rather than one combined sheet). Frame counts come from
 * `width / 80`: idle = 7, run = 8, attack = 10.
 */
const MUSHROOM_IDLE_URL = `${GAME_ASSETS}/monsters/Mushroom-Idle.png`;
const MUSHROOM_RUN_URL = `${GAME_ASSETS}/monsters/Mushroom-Run.png`;
const MUSHROOM_ATTACK_URL = `${GAME_ASSETS}/monsters/Mushroom-Attack.png`;
/** Horizontal strip: same frame size as idle/run/attack; plays before `blood.png` burst. */
const MUSHROOM_DIE_URL = `${GAME_ASSETS}/monsters/Mushroom-Die.png`;
const MUSHROOM_DIE_FRAME_COUNT = 16;
/** 6×6 sheet, first 22 frames = splatter sequence. */
const BLOOD_SHEET_URL = `${GAME_ASSETS}/monsters/blood.png`;
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
/** First stair index that may host a mushroom — skips Floor 0 spawn deck + early climb. */
const MUSHROOM_PLATFORM_START_INDEX = 5;
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
/** `public/assets/Player staff/heart_counter-Sheet.png` — 192×992, 31 rows × 192×32. */
const HEART_COUNTER_SHEET_URL = `${GAME_ASSETS}/${encodeURIComponent('Player staff')}/heart_counter-Sheet.png`;
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
/**
 * Extra scroll / drift multiplier from run time (stacks with altitude). Avoids a soft ceiling around ~×5
 * when climb height stalls against auto-scroll so late runs keep getting faster.
 */
const SCROLL_SPEED_RUNTIME_START_SEC = 30;
const SCROLL_SPEED_RUNTIME_STEP_SEC = 18;
const SCROLL_SPEED_RUNTIME_DELTA = 0.07;
/**
 * Extra mult from total run score so SPD keeps rising while the player earns points even if HUD climb (m) plateaus vs auto-scroll.
 */
const SCROLL_SPEED_SCORE_STEP = 1500;
const SCROLL_SPEED_SCORE_DELTA = 0.055;
/**
 * Past this HUD altitude (m), each further {@link SCROLL_SPEED_STEP_METERS} band adds
 * {@link SCROLL_SPEED_HIGH_TIER_DELTA} instead of {@link SCROLL_SPEED_STEP_DELTA} (~×5 / ~6000m is no longer a practical cap).
 */
const SCROLL_SPEED_HIGH_TIER_FROM_METERS = 5200;
/** Steeper per-step mult above {@link SCROLL_SPEED_HIGH_TIER_FROM_METERS} (same 200m banding as base). */
const SCROLL_SPEED_HIGH_TIER_DELTA = 0.26;
/**
 * Hard ceiling for the total scroll multiplier once climb reaches this altitude (HUD-equivalent m).
 * No combos / score / runtime extras can push {@link getAltitudeSpeedMultiplier} above this.
 */
const HARD_SPEED_CAP_FROM_METERS = 5000;
const HARD_SPEED_CAP_MULT = 5.0;
/** Continuous altitude shake disabled; it became visible jitter around the 3000m+ tiers. */
const ALTITUDE_STRESS_SHAKE_MULT_THRESHOLD = Number.POSITIVE_INFINITY;
const SPEED_TIER_SHAKE_SEC = 0;
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
const REST_FLOOR_HOUSE_SCALE_MOBILE = 0.68;
const REST_FLOOR_HOUSE_SINK_PX = 48;
const REST_FLOOR_CLOUD_DEPTH = 90;
const REST_FLOOR_CLOUD_WIDTH_PX = 580;
const REST_FLOOR_CLOUD_SINK_PX = 10;
const REST_FLOOR_CLOUD_OFFSET_X_PX = -130;
const REST_FLOOR_CLOUD_RIGHT_OFFSET_X_PX = 170;
const REST_FLOOR_CLOUD_ROTATION_DEG = -3;
const REST_FLOOR_CLOUD_BREATH_AMPLITUDE_PX = 4;
const REST_FLOOR_CLOUD_BREATH_SCALE = 0.018;
const REST_FLOOR_CLOUD_BREATH_HZ = 0.45;
const REST_FLOOR_SUPPLIES_START_X_PX = 100;
const REST_FLOOR_SUPPLIES_SCALE_DESKTOP = 1.25;
const REST_FLOOR_SUPPLIES_SCALE_MOBILE = 1.05;
const REST_FLOOR_SUPPLY_PROPS = [
  { x: 0, y: 356, w: 206, h: 50, spacingAfter: 88, scale: 1.848 },
] as const;
const PLAYER_SPAWN_CLEARANCE_PX = 14;
const GRAPPLE_VERTICAL_REACH_PLATFORMS = 2;
const GRAPPLE_MIN_TARGET_DISTANCE_PX = 150;
/** Minimum upward speed while tongue-pulling (px/s, negative = up); higher magnitude = faster climb. */
const GRAPPLE_VERTICAL_BOOST_VY = -640;
/** Horizontal easing toward the stair center during tongue pull (× dt). */
const GRAPPLE_PULL_HORIZONTAL_LERP_PER_SEC = 17;
const GRAPPLE_STOP_ABOVE_PLATFORM_PX = 20;
const LEVEL_MAX = 100;
const LEVEL_SCORE_STEP = 1000;
const LEVEL_PLATFORM_SPEED_BASE = 24;
const LEVEL_PLATFORM_SPEED_PER_LEVEL = 5;
const LEVEL_PLATFORM_WIDTH_DECAY_RATIO_PER_LEVEL = 0.005;
const LEVEL_PLATFORM_MIN_BASE_WIDTH = 72;
const LEVEL_MILESTONE_STEP = 10;
/** Spend this much from gold/diamond bank to activate one fall-protection shield. */
const SHIELD_BANK_GOLD = 10;
const SHIELD_BANK_DIAMOND = 5;
/** On fall-save, place the player exactly this many platform gaps above the last recorded platform. */
const SHIELD_BOUNCE_PLATFORM_RISE_COUNT = 5;
/** After teleport, recycle passes so low stairs repack above the new camera. */
const SHIELD_LAUNCH_RECYCLE_PASSES = 28;
const SHIELD_SAVE_FLASH_SEC = 0.42;
const JUMP_BUFFER_SEC = 0.1;
/**
 * Combo chain rules:
 *   - Each successful jump within {@link COMBO_CHAIN_WINDOW_SEC} of the previous one **and**
 *     starting from a higher world position (y smaller) increments `comboCount`.
 *   - Jumping in place, falling between jumps, or pausing >= {@link COMBO_CHAIN_WINDOW_SEC} resets it.
 *   - Streak {@link COMBO_GLOW_STREAK} → character glow + tint pulse turns on.
 *   - Skill pair (`SUPER JUMP` + `PULL UP`): {@link PULL_UP_JUMPS_REQUIRED} grounded jumps (`pullUpJumpsAccum`).
 *   - Mega jump uses {@link registerComboJump} like normal hops (`skipClimbCheck`) plus post-jump grace
 *     ({@link SUPER_JUMP_COMBO_GRACE_EXTEND_SEC}) so the chain survives longer air time.
 *   - During SUPER JUMP ascent, each distinct stair top crossed under the player (horizontal overlap)
 *     adds another combo step ({@link applySuperJumpAscendingStairCombo}); landing re-syncs the climb
 *     anchor (`comboLastJumpY`) so the next grounded jump chains normally.
 */
const COMBO_CHAIN_WINDOW_SEC = 5;
const COMBO_MIN_CLIMB_PX = 6;
/** Manual SUPER JUMP only (`SUPER_JUMP_VY_SCALE`× upward vs normal jump formula). */
const SUPER_JUMP_VY_SCALE = 2;
const SUPER_JUMP_SPARK_COUNT = 14;
/** After `PULL UP`, window to tap `SUPER JUMP` for extra score bonus (combo uses normal jump rules). */
const SKILL_CHAIN_WINDOW_SEC = 5.35;
const SKILL_CHAIN_BASE_SCORE = 160;
const SKILL_CHAIN_SCORE_PER_COMBO = 32;
/** Extra time after mega jump before the combo chain can expire (air time + next landing). */
const SUPER_JUMP_COMBO_GRACE_EXTEND_SEC = 2.0;
/**
 * Feet vs stair-top line test during SUPER JUMP (world Y, px). Smooths float noise and single-frame
 * micro-movement without risking double-count (stair gaps ≫ this value).
 */
const SUPER_JUMP_STAIR_CROSS_EPS = 3;
const COMBO_GLOW_STREAK = 15;
/** Grounded jumps before the skill pair unlocks (both buttons; counter resets after mega jump / expiry). */
const PULL_UP_JUMPS_REQUIRED = 6;
/** Combo HUD anchor X; Y is computed under the skill pair in `layoutComboHudRoot`. */
const COMBO_HUD_SCREEN_X = 20;
/** Vertical gap between skill buttons strip and combo badge. */
const COMBO_BELOW_SKILL_PAIR_GAP_PX = 8;
/** Uniform scale for combo badge only (`uiLayer`, screen-fixed — equivalent to scrollFactor 0). */
const COMBO_HUD_ROOT_SCALE = 0.33;
/** Skill pair (`SUPER JUMP` + `PULL UP`): screen-fixed on `uiLayer` — Phaser `scrollFactor` 0 equivalent. */
const PULL_UP_BTN_W = 152;
const PULL_UP_BTN_H = 44;
/** Horizontal gap between `SUPER JUMP` (left) and `PULL UP` (right) inside the pair. */
const SKILL_PAIR_BTN_GAP_PX = 14;
/** Top-left anchor under main HUD / health stack (unscaled layout coords before `skillPairRoot.scale`). */
const SKILL_PAIR_HUD_X = 100;
/** Tight offset below the main header panel bottom (`UI_SAFE_PAD_TOP` + `UI_HEADER_H`). */
const SKILL_PAIR_BELOW_HEADER_GAP_PX = 4;
/** Uniform scale on `skillPairRoot` (mobile tap targets). */
const PULL_UP_BTN_SCALE = 0.65;
/** Super Tongue effects (matches the user-confirmed "B" recipe). */
const SUPER_TONGUE_STAIRS_UP = 4;
const SUPER_TONGUE_BUFF_DURATION_SEC = 3.0;
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
  private readonly bgOverlayRoot = new Container();
  private readonly bgOverlayMask = new Graphics();
  /** Back → front: matches the active entry from `BACKGROUND_TIERS`. */
  private bgParallaxLayers: { tile: TilingSprite; speed: number }[] = [];
  private bgOverlayLayers: { tile: TilingSprite; speed: number }[] = [];
  private loadedBackgroundTiers = new Map<BackgroundTierId, LoadedBackgroundTier>();
  private activeBackgroundTierId?: BackgroundTierId;
  private activeOverlayBackgroundTierId?: BackgroundTierId;
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
  /** Player `body.y` at run start — climb height = baseline minus current y (px). */
  private climbBaselineY = 0;
  private windParticles: WindParticle[] = [];
  private windSpawnAcc = 0;
  private climbHudText?: Text;
  /** New jump-counter HUD line beneath the climb readout. Driven by `this.jumpCount`. */
  private jumpsHudText?: Text;
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
  private leaderboardSubtitle?: Text;
  private leaderboardRows: Text[] = [];
  private leaderboardCloseBtn = new Graphics();
  private leaderboardCloseLabel?: Text;
  private leaderboardLoadingText?: Text;
  private finalMetersAtDeath = 0;
  /** Peak HUD climb (m) this run — for leaderboard max height. */
  private peakClimbMetersThisRun = 0;
  /** Peak {@link comboCount} this run — for leaderboard best combo. */
  private peakComboThisRun = 0;
  private deathSubmitted = false;
  /** Latest Top 5 from Firestore (refreshed after each save and when opening leaderboard). */
  private lastLeaderboardTop: LeaderboardEntry[] = [];
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
  private restFloorHouseTexture?: Texture;
  private restFloorHouseSprite?: Sprite;
  private restFloorCloudTexture?: Texture;
  private restFloorCloudSprite?: Sprite;
  private restFloorCloudRightSprite?: Sprite;
  private restFloorSuppliesTexture?: Texture;
  private restFloorSupplyTextures: Texture[] = [];
  private restFloorSupplySprites: Sprite[] = [];
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
  /**
   * Until the first jump off the Floor 0 spawn deck (`kind === 'spawn'`), skip auto-scroll and
   * vertical follow — framing stays at {@link snapCameraToPlayer} after each reset.
   */
  private cameraFrozenUntilFirstFloor0Jump = true;
  private activeRestFloorY: number | null = null;
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

  /**
   * Total successful jumps this run. Incremented by `triggerJumpAction`; displayed in the HUD.
   * Drives the combo chain together with `comboCount` (consecutive climbing jumps only).
   */
  private jumpCount = 0;
  /** Active combo streak length (≥ 2 = badge visible). Reset by expiry, non-climbing jumps, or death. */
  private comboCount = 0;
  /** `body.y` at the moment of the last counted jump — used to verify the next jump climbed higher. */
  private comboLastJumpY = Number.POSITIVE_INFINITY;
  /** `runTime` at the moment of the last counted jump — used for the chain-window expiry. */
  private comboLastJumpTime = -1e9;
  /** Until this `runTime`, combo timeout is suspended after a mega jump (see {@link SUPER_JUMP_COMBO_GRACE_EXTEND_SEC}). */
  private superJumpComboGraceUntil = Number.NEGATIVE_INFINITY;
  /** True after SUPER JUMP until first landing — re-sync climb anchor after mid-air stair combo ticks. */
  private megaJumpReanchorComboOnLanding = false;
  /** While true and `vy < 0`, feet crossing platform tops upward award combo (mega jump only). */
  private superJumpStairTrackActive = false;
  /** Stair ids already counted for this mega jump arc (includes launch stair — skipped for increments). */
  private readonly superJumpCrossedStairIds = new Set<number>();
  /** Visual badge in the upper-left; created in `setupComboHud`. */
  private comboBadge?: ComboBadge;
  /** Wraps combo badge only; scaled — stays screen-fixed (parent `uiLayer`, never `world`). */
  private comboHudRoot = new Container();
  /** Lazy WebAudio synth that plays the tier hit on each combo increment. */
  private comboSynth?: ComboSynth;
  /** Successful grounded jumps since last Pull-up press (or run start); caps visibility unlock at {@link PULL_UP_JUMPS_REQUIRED}. */
  private pullUpJumpsAccum = 0;
  /** `SUPER JUMP` + `PULL UP` wrapper — top-left `uiLayer`; hidden until {@link pullUpJumpsAccum} ≥ threshold. */
  private skillPairRoot = new Container();
  private superJumpBtnRoot = new Container();
  private superJumpBtnGfx = new Graphics();
  private superJumpBtnLabel?: Text;
  /** Pull-up (`PULL UP`) inside {@link skillPairRoot}. */
  private superTongueBtnRoot = new Container();
  private superTongueBtnGfx = new Graphics();
  private superTongueBtnLabel?: Text;
  private skillPairAvailable = false;
  /** Pull-up used this offer — Super Jump remains until chain window ends or spend. */
  private skillPullUpSpent = false;
  private skillSuperJumpSpent = false;
  private skillChainWindowEnd = 0;
  private superTongueBtnPulse = 0;
  /** Seconds left of "free chain grapple" buff after pressing Super Tongue. */
  private superTongueBuffTime = 0;
  private jumpBufferTimeLeft = 0;
  private runTime = 0;
  private hurryUpTimeLeft = 0;
  private hurryBannerX = 0;
  private diamondShineSparks: DiamondShineSpark[] = [];
  private shakeTime = 0;
  private shakeOffsetX = 0;
  private shakeOffsetY = 0;
  /** Phase accumulator for speed-stress screenshake (continuous, not impact bursts). */
  private velocityStressShakePhase = 0;
  private bgm?: HTMLAudioElement;
  /** Last picked `game music` URL — avoids playing the same track twice in a row when possible. */
  private lastGameMusicBgmUrl: string | null = null;
  private level = 1;
  private levelUpBannerTime = 0;
  private levelUpParticles: LevelUpParticle[] = [];
  /** Brief teal sparks + avatar pop when a combo-milestone super jump fires. */
  private comboSuperJumpParticles: LevelUpParticle[] = [];
  private currentBackgroundColor = 0x000000;
  private levelUpFloatText?: Text;
  private jumpArcAssistTime = 0;
  private jumpArcAssistDuration = 0;
  private jumpArcStartCenterX = 0;
  private jumpArcTargetCenterX = 0;
  /**
   * Fall-protection shield state. An active shield is bought from the gold/diamond bank and is
   * consumed only by the death-zone fall save.
   */
  private shieldSaveFlashTime = 0;
  private lastRecordedPlatform: RecordedPlatform | null = null;
  async init(app: Application): Promise<void> {
    this.app = app;
    this.width = app.screen.width;
    this.height = app.screen.height;
    this.refreshWorldViewport();

    this.lavaLayer.addChild(this.deathZoneFallback);
    const quickMobile = isQuickStartMobileDevice();
    await Promise.all([
      quickMobile ? this.loadPlatformSpriteCore() : this.loadPlatformSprite(),
      this.player.load(),
      this.sfx.load(),
      this.loadDeathZoneStrip(),
      quickMobile ? this.loadBackgroundTextureEssentialForQuickMobile() : this.loadBackgroundTexture(),
      quickMobile ? Promise.resolve() : this.loadMushroomTextures(),
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
    this.setupClimbHud(app);
    this.setupComboHud();
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

    if (quickMobile) {
      void this.finishDeferredPlaySceneLoadsForMobile().catch(() => {});
    } else {
      await this.tryLoadTongueArmature();
    }
    this.resetRun({ pickNewBgm: true });
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
    this.grappleCooldown = Math.max(0, this.grappleCooldown - dt);
    this.updateTouchRipples(dt);
    this.updateGrappleCooldownFeedback();
    this.updateLevelProgress();
    this.updatePlatformDifficulty(dt);
    this.updateLevelUpParticles(dt);
    this.updateComboSuperJumpParticles(dt);
    this.updateTouchFollowAxis();
    this.input?.smoothTouchJoystickAxis(dt, this.player.body.grounded);
    this.tickPlayerShield(dt);
    this.tickJumpBuffer(dt);
    this.tickComboHud(dt);
    this.updateRestFloorHoldState();

    const pullVyCap = GRAPPLE_VERTICAL_BOOST_VY;
    const pullHLerp = GRAPPLE_PULL_HORIZONTAL_LERP_PER_SEC;

    if (this.grapple?.phase === 'extend') {
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

    if (this.grapple?.phase === 'pull') {
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
            this.score += grappleGain;
            this.lastScoredStairId = hookId;
            this.lastScoredLandWorldTopY = Math.min(this.lastScoredLandWorldTopY, hookPlatform.y);
            this.scoreboard?.onPointsGained(grappleGain);
            this.maybeTriggerScreenShake(grappleGain);
          }
          this.grapple = null;
          this.grappleReleaseDampingLeft = GRAPPLE.releaseDampingDurationSec;
        }
      }
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
    const preBodyX = this.player.body.x;
    const prePhysicsFeetY = this.player.body.y + this.player.body.height;
    const result = this.physics.update(
      this.player.body,
      this.platforms,
      this.worldWidth,
      dt,
      gravityScale,
    );

    if (this.superJumpStairTrackActive) {
      const postFeetY = this.player.body.y + this.player.body.height;
      const postBodyX = this.player.body.x;
      if (this.player.body.vy >= 0) {
        this.superJumpStairTrackActive = false;
      } else {
        this.applySuperJumpAscendingStairCombo(
          prePhysicsFeetY,
          postFeetY,
          preBodyX,
          postBodyX,
        );
      }
    }

    if (result.landedPlatform) {
      this.currentGroundPlatform = result.landedPlatform;
      this.player.onLand(result.impactVy);
      if (!wasGrounded) {
        const landVol = Math.min(1, result.impactVy / 520);
        this.sfx.play('player_land', 0.35 + landVol * 0.65);
      }
      const p = result.landedPlatform;
      const idDelta = p.stairId - this.lastScoredStairId;
      /** Recycle can rotate stair ids backwards; world Y is the true tiebreaker. */
      const climbedHigherPhysically = p.y < this.lastScoredLandWorldTopY - 6;
      const landGain =
        idDelta > 0 ? idDelta : climbedHigherPhysically ? 1 : 0;
      if (landGain > 0) {
        this.score += landGain;
        this.lastScoredStairId = p.stairId;
        this.lastScoredLandWorldTopY = Math.min(this.lastScoredLandWorldTopY, p.y);
        this.scoreboard?.onPointsGained(landGain);
        this.maybeTriggerScreenShake(landGain);
      }
      if (this.megaJumpReanchorComboOnLanding) {
        /**
         * Standalone grounded jumps compare against {@link comboLastJumpY}. Setting it equal to
         * `body.y` makes the next hop read as same-altitude (`climbed` false) and breaks the chain.
         * Bias downward (+Y) so the first post–mega jump counts as climbing without weakening normal rules.
         */
        this.comboLastJumpY = this.player.body.y + COMBO_MIN_CLIMB_PX + 1;
        this.comboLastJumpTime = this.runTime;
        this.megaJumpReanchorComboOnLanding = false;
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
    if (!this.shouldPausePlatformGeneration()) {
      this.recycleStairsOffscreen();
    }
    this.syncPlatformSpritesFromPlatforms();
    this.checkFallGameOver();
    this.updateRipples(dt);
    this.updateDiamondShineSparks(dt);
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
    /**
     * `comboActive` lights the avatar's combo accent; `beastMode` enables the orange glow rings
     * and tint pulse. Streak ≥ 15 turns on both for the persistent "COSMIC+" visual reward.
     */
    const comboGlow = this.comboCount >= COMBO_GLOW_STREAK;
    this.player.update(
      dt,
      axis,
      this.comboCount >= 2,
      this.grapple,
      comboGlow,
      this.player.isShielded,
    );
    this.tickAltitudePresentation(dt);
    this.drawDynamicWorld();
    this.updateSpeedTierUiFlash(dt);
    this.updateScreenShake(dt);
    const heightMeters = Math.max(0, Math.floor(-this.highestY / 12));
    this.scoreboard?.update(dt, this.score, this.jumpCount, heightMeters, this.runTime, this.level);
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
    this.layoutSkillPairHud();
    this.layoutComboHudRoot();
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
    this.uiLayer.destroy({ children: true });
    this.sfx.dispose();
    this.comboSynth?.dispose();
    this.comboSynth = undefined;
    this.stopBackgroundMusic();
    this.tongueArmature?.dispose(true);
    this.tongueArmature = null;
    this.tongueDbReady = false;
    this.gameShake.destroy({ children: true });
  }

  private handleActions(): void {
    const wantGrapple = this.input?.consumeGrapple() ?? false;
    if (wantGrapple && this.canUseTongueGrapple()) {
      this.triggerGrappleAction();
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
    const body = this.player.body;
    const shootX = body.x + body.width * 0.5;
    const shootY = body.y + body.height * 0.5;
    const maxReach = Math.max(350, STAIRS.stepPx * GRAPPLE_VERTICAL_REACH_PLATFORMS + 100);
    const verticalRayHalfWidth = Math.max(8, body.width * 0.8);
    return Physics.castGrappleTarget(
      this.platforms,
      shootX,
      shootY,
      GRAPPLE_MIN_TARGET_DISTANCE_PX,
      maxReach,
      verticalRayHalfWidth,
      false,
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
    /** Super Tongue buff window grants follow-up grapples at zero cooldown (recipe B). */
    this.grappleCooldown = this.superTongueBuffTime > 0 ? 0 : GRAPPLE.cooldownSec;
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

  private triggerJumpAction(fromRightSwipe = false): boolean {
    if (!this.player.body.grounded || !!this.grapple) {
      return false;
    }
    this.maybeEndFloor0IntroCameraFreeze();
    this.physics.jump(this.player.body);
    this.jumpCount += 1;
    this.registerComboJump();
    this.maybeIncrementPullUpJumpCounter();
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

  /**
   * Called from each successful `triggerJumpAction`. Implements the streak rules:
   *  - Within {@link COMBO_CHAIN_WINDOW_SEC} of the previous jump *and* current `body.y`
   *    is at least {@link COMBO_MIN_CLIMB_PX} higher than the previous jump → `comboCount += 1`.
   *  - Otherwise the streak resets to 1 (this jump is the new chain anchor).
   *
   * On `comboCount >= 2` we play the combo synth + bump the badge (word tier rises every
   * `COMBO.jumpsPerWord` counted jumps in `game.config`).
   */
  private registerComboJump(opts?: { skipClimbCheck?: boolean }): void {
    const currentY = this.player.body.y;
    const withinWindow =
      this.runTime - this.comboLastJumpTime <= COMBO_CHAIN_WINDOW_SEC;
    const climbed = currentY < this.comboLastJumpY - COMBO_MIN_CLIMB_PX;
    const countsAsClimb = opts?.skipClimbCheck ? true : climbed;

    if (this.comboCount > 0 && withinWindow && countsAsClimb) {
      this.comboCount += 1;
    } else if (this.comboCount > 0 && withinWindow && !countsAsClimb) {
      /** Same-altitude or downward jump within the window breaks the chain (anti-spam). */
      this.breakCombo();
      this.comboCount = 1;
    } else {
      /** Cold start or post-expiry — this jump anchors a fresh chain. */
      this.breakCombo();
      this.comboCount = 1;
    }

    this.comboLastJumpY = currentY;
    this.comboLastJumpTime = this.runTime;

    if (this.comboCount >= 2) {
      const wordTier = comboStreakToWordTier(this.comboCount);
      this.comboBadge?.bumpTo(this.comboCount);
      this.comboSynth?.resume();
      this.comboSynth?.play(wordTier);
    }
  }

  /** Same horizontal overlap rule as {@link Physics.resolvePlatformLanding} (narrower feet band). */
  private playerBodyOverlapsPlatform(platform: Platform): boolean {
    const body = this.player.body;
    return (
      body.x + body.width * 0.42 > platform.x &&
      body.x < platform.x + platform.width
    );
  }

  /**
   * True if, at some horizontal body position along the frame sweep (before → after physics),
   * the feet band matches {@link playerBodyOverlapsPlatform} (narrower X vs landing).
   */
  private superJumpFeetBandSweptOverlapsPlatform(
    prevBodyX: number,
    currBodyX: number,
    bodyWidth: number,
    platform: Platform,
  ): boolean {
    const x0 = Math.min(prevBodyX, currBodyX);
    const x1 = Math.max(prevBodyX, currBodyX);
    return x1 > platform.x - bodyWidth * 0.42 && x0 < platform.x + platform.width;
  }

  /**
   * Each stair top crossed while ascending on a mega jump (feet move upward through `platform.y`)
   * adds one combo step. Launch stair is pre-seeded into {@link superJumpCrossedStairIds} so leaving
   * it does not double-count the takeoff already handled by {@link registerComboJump}.
   * Uses a horizontal sweep so fast sideways motion in one frame does not miss a stair the feet crossed.
   */
  private applySuperJumpAscendingStairCombo(
    prevFeetY: number,
    currFeetY: number,
    prevBodyX: number,
    currBodyX: number,
  ): void {
    if (currFeetY >= prevFeetY) {
      return;
    }
    const eps = SUPER_JUMP_STAIR_CROSS_EPS;
    const w = this.player.body.width;
    for (const platform of this.platforms) {
      if (!this.superJumpFeetBandSweptOverlapsPlatform(prevBodyX, currBodyX, w, platform)) {
        continue;
      }
      const top = platform.y;
      const crossedUpward =
        currFeetY < top + eps &&
        prevFeetY >= top - eps;
      if (!crossedUpward || this.superJumpCrossedStairIds.has(platform.stairId)) {
        continue;
      }
      this.superJumpCrossedStairIds.add(platform.stairId);
      this.incrementComboForSuperJumpStairPass();
    }
  }

  /** One combo step from clearing a stair plane during SUPER JUMP ascent (no climb/window rules). */
  private incrementComboForSuperJumpStairPass(): void {
    this.comboCount += 1;
    this.comboLastJumpY = this.player.body.y;
    this.comboLastJumpTime = this.runTime;
    this.superJumpComboGraceUntil = Math.max(
      this.superJumpComboGraceUntil,
      this.runTime + SUPER_JUMP_COMBO_GRACE_EXTEND_SEC,
    );
    if (this.comboCount >= 2) {
      const wordTier = comboStreakToWordTier(this.comboCount);
      this.comboBadge?.bumpTo(this.comboCount);
      this.comboSynth?.resume();
      this.comboSynth?.play(wordTier);
    }
  }

  /** Grounded jumps toward unlocking `SUPER JUMP` + `PULL UP`; skips while the skill pair offer is active. */
  private maybeIncrementPullUpJumpCounter(): void {
    if (this.skillPairAvailable || this.skillPullUpSpent) {
      return;
    }
    this.pullUpJumpsAccum += 1;
    if (this.pullUpJumpsAccum >= PULL_UP_JUMPS_REQUIRED) {
      this.setSkillPairAvailable(true);
    }
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
        kind: index === 0 ? 'spawn' : 'normal',
      };
      this.applyResponsivePlatformWidth(platform);
      if (index === 0) {
        /** Wide Floor 0 deck — span comes from {@link getFloorZeroSpawnPlatformBounds}; skip narrow stair centering. */
        if (platform.kind !== 'spawn') {
          const ideal = layoutCamX + viewportW * 0.5 - platform.width * 0.5;
          const { minX, maxX } = this.getPlatformSpawnHorizontalRange(platform.width, layoutCamX);
          platform.x = Math.max(minX, Math.min(ideal, maxX));
        }
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
    if (this.shouldPausePlatformGeneration()) {
      return;
    }
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
    /** Next recycled stair id (assigned inside the loop before gap math). */
    const firstRecycledStairId = this.nextStairId + 1;
    /**
     * One normal gap above the current top stair. Do **not** mix in `cameraY` here: using
     * `Math.min(cameraY-2000, …)` snapped new steps to the sky and left huge voids once the camera
     * had scrolled far (large |cameraY|).
     */
    let spawnY = previousTopY - this.computeStairGapPx(firstRecycledStairId);

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
      } else {
        this.maybeSpawnFirstRestFloorProps(p);
        break;
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

  private getPlatformMeters(platform: Platform): number {
    return Math.max(
      0,
      Math.floor((this.climbBaselineY - (platform.y - this.player.body.height)) / 12),
    );
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
    if (platform.kind === 'spawn') {
      const bounds = this.getFloorZeroSpawnPlatformBounds();
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
    /** Wide Floor 0 deck — X/width already tied to camera in {@link getFloorZeroSpawnPlatformBounds}. */
    if (p.kind === 'spawn') {
      return;
    }
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
    /** Same slight air gap as legacy spawn — feet a few px above the deck top (`worldMaxY - 100` when stair 0 sat at `worldMaxY - 96`). */
    b.y = Math.round(p.y - b.height - 4);
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
      if (p.kind === 'spawn') {
        const bounds = this.getFloorZeroSpawnPlatformBounds();
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

    for (let i = 0; i < this.platforms.length; i += 1) {
      const platform = this.platforms[i];
      const root = this.platformSprites[i];
      if (!root) {
        continue;
      }

      if (platform.kind === 'rest' || platform.kind === 'spawn') {
        root.visible = false;
        continue;
      }
      root.visible = true;

      const platformM = this.getPlatformMeters(platform);
      let tex: Texture = this.platformTexture;
      let artMul = 1;

      if (platformM >= STAIRS.stormPlatformAfterMeters && this.restFloorCloudTexture !== undefined) {
        tex = this.restFloorCloudTexture;
        artMul = STAIRS.stormPlatformArtScale;
      } else if (platformM >= STAIRS.volcanoPlatformAfterMeters && this.platformTextureVolcano !== undefined) {
        tex = this.platformTextureVolcano;
        artMul = STAIRS.volcanoPlatformArtScale;
      } else if (platformM >= STAIRS.slimePlatformAfterMeters && this.platformTextureSlime !== undefined) {
        tex = this.platformTextureSlime;
        artMul = STAIRS.slimePlatformArtScale;
      } else if (platformM >= STAIRS.compactPlatformArtAfterMeters) {
        artMul = STAIRS.compactPlatformArtScale;
      }

      const useBeadBridge = platformM <= BEAD_BRIDGE_MAX_METERS;
      if (useBeadBridge) {
        this.syncBeadBridgePlatformSprite(i, root, platform);
      } else {
        this.syncLegacyPlatformSprite(i, root, platform, tex, artMul);
      }
    }
  }

  private resetRun(opts?: { pickNewBgm?: boolean }): void {
    this.gameOver = false;
    this.finalMetersAtDeath = 0;
    this.peakClimbMetersThisRun = 0;
    this.peakComboThisRun = 0;
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
    this.score = 0;
    this.lastScoredStairId = -1;
    this.lastScoredLandWorldTopY = Number.POSITIVE_INFINITY;
    this.cameraX = 0;
    this.cameraY = 0;
    this.cameraFrozenUntilFirstFloor0Jump = true;
    this.activeRestFloorY = null;
    this.restFloorHoldY = null;
    this.highestY = 0;
    this.goldCount = 0;
    this.diamondCount = 0;
    this.collectibles = [];
    this.jumpCount = 0;
    this.comboCount = 0;
    this.comboLastJumpY = Number.POSITIVE_INFINITY;
    this.comboLastJumpTime = -1e9;
    this.superJumpComboGraceUntil = Number.NEGATIVE_INFINITY;
    this.megaJumpReanchorComboOnLanding = false;
    this.superJumpStairTrackActive = false;
    this.superJumpCrossedStairIds.clear();
    this.comboBadge?.resetState();
    this.pullUpJumpsAccum = 0;
    this.setSkillPairAvailable(false);
    this.superTongueBuffTime = 0;
    this.jumpBufferTimeLeft = 0;
    this.runTime = 0;
    this.hurryUpTimeLeft = 0;
    this.paused = false;
    this.pauseOverlay.visible = false;
    this.headerPauseRoot.visible = true;
    this.attackBtnRoot.visible = true;
    this.healthHudRoot.visible = true;
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
    this.comboSuperJumpParticles = [];
    this.player.rotation = 0;
    this.windParticles = [];
    this.windSpawnAcc = 0;
    this.jumpArcAssistTime = 0;
    this.jumpArcAssistDuration = 0;
    this.shieldSaveFlashTime = 0;
    this.lastRecordedPlatform = null;
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
    this.clearRestFloorProps();
    this.scoreboard?.reset();
    this.hudGoldShown = this.goldCount;
    this.hudDiamondShown = this.diamondCount;
    this.collectibleHudBump = 0;
    this.collectibleHudRoot.scale.set(1);
    this.refreshCollectibleHudText();
    this.scoreboard?.setLevel(this.level);
    this.refreshAutoScrollHud();
    this.syncScrollSpeedTierBaseline();
    if (opts?.pickNewBgm === true) {
      this.startBackgroundMusic();
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
    this.activeRestFloorY = null;
    this.restFloorHoldY = null;
    this.currentGroundPlatform = null;
    /** Shield bounce teleports the player upwards — treat as a fresh chain anchor, not a climb step. */
    this.breakCombo();

    const anchor = this.lastRecordedPlatform ?? this.platforms[0];
    if (!anchor) {
      this.triggerGameOver();
      return;
    }
    const targetStairId = anchor.stairId + SHIELD_BOUNCE_PLATFORM_RISE_COUNT;
    const targetPlatform = this.platforms.find((platform) => platform.stairId === targetStairId);
    const targetY = targetPlatform?.y ?? anchor.y - STAIRS.stepPx * SHIELD_BOUNCE_PLATFORM_RISE_COUNT;
    const targetCenterX = targetPlatform
      ? targetPlatform.x + targetPlatform.width * 0.5
      : anchor.x + anchor.width * 0.5;
    this.player.body.x = Math.max(
      0,
      Math.min(this.worldWidth - this.player.body.width, targetCenterX - this.player.body.width * 0.5),
    );
    this.player.body.y = targetY - this.player.body.height;
    this.player.body.vx = 0;
    this.player.body.vy = -980;
    this.player.body.grounded = false;
    this.highestY = Math.min(this.highestY, this.player.body.y);
    this.player.onJump();
    this.shieldSaveFlashTime = SHIELD_SAVE_FLASH_SEC;
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

  /**
   * Pause stair recycle only while the player is **holding** on a rest floor (camera + gameplay frozen there).
   * Do **not** use `activeRestFloorY !== null` alone: recycle assigns upcoming rest tiles above the player and would
   * wrongly pause forever (stairs stop recycling → they “vanish” deep into a run, e.g. near 8000m rest intervals).
   */
  private shouldPausePlatformGeneration(): boolean {
    return this.isRestFloorHolding();
  }

  private updateRestFloorHoldState(): void {
    if (this.activeRestFloorY !== null && this.restFloorHoldY === null) {
      this.tryStartRestFloorHoldFromWorldPosition();
      return;
    }

    const holdY = this.restFloorHoldY;
    if (holdY === null) {
      this.tryStartRestFloorHoldFromWorldPosition();
      return;
    }
    const feetY = this.player.body.y + this.player.body.height;
    if (!this.player.body.grounded && feetY <= holdY - REST_FLOOR_RESUME_ABOVE_PX) {
      this.resumePlatformsAboveRestFloor(holdY);
      this.activeRestFloorY = null;
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
      this.activeRestFloorY = restPlatform.y;
      this.restFloorHoldY = restPlatform.y;
      this.maybeSpawnFirstRestFloorProps(restPlatform);
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

  /** Match {@link getRestFloorPlatformBounds} — shared wide span for Floor 0 spawn deck (no rest-floor gameplay hooks). */
  private getFloorZeroSpawnPlatformBounds(): { x: number; width: number } {
    return this.getRestFloorPlatformBounds();
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
    if (this.platforms[0]) {
      this.recordLastPlatform(this.platforms[0]);
    }
    this.player.update(0, 0, false, null, false, this.player.isShielded);
  }

  private recordLastPlatform(platform: Platform): void {
    this.lastRecordedPlatform = {
      x: platform.x,
      y: platform.y,
      width: platform.width,
      height: platform.height,
      stairId: platform.stairId,
    };
  }

  private landOn(platform: Platform): void {
    this.recordLastPlatform(platform);
    if (platform.kind === 'rest') {
      this.activeRestFloorY = platform.y;
      this.restFloorHoldY = platform.y;
      this.maybeSpawnFirstRestFloorProps(platform);
      this.clearPlatformsBelowRestFloor(platform);
    }
    this.ripples.push({
      x: this.player.body.x + this.player.body.width / 2,
      y: platform.y + 46,
      age: 0,
    });
  }

  private clearPlatformsBelowRestFloor(restPlatform: Platform): void {
    const previousPlatforms = this.platforms;
    const nextPlatforms = previousPlatforms.filter(
      (platform) => platform === restPlatform || platform.y <= restPlatform.y,
    );
    if (nextPlatforms.length === previousPlatforms.length) {
      return;
    }

    const nextIndexByPlatform = new Map<Platform, number>();
    nextPlatforms.forEach((platform, index) => nextIndexByPlatform.set(platform, index));

    this.collectibles = this.collectibles
      .map((collectible) => {
        const platform = previousPlatforms[collectible.platformIdx];
        const nextIndex = platform ? nextIndexByPlatform.get(platform) : undefined;
        return nextIndex === undefined ? null : { ...collectible, platformIdx: nextIndex };
      })
      .filter((collectible): collectible is Collectible => collectible !== null);

    const nextMushrooms: MushroomEnemy[] = [];
    const nextMushroomSprites: Sprite[] = [];
    for (let i = 0; i < this.mushroomEnemies.length; i += 1) {
      const enemy = this.mushroomEnemies[i];
      const platform = previousPlatforms[enemy.platformIdx];
      const nextIndex = platform ? nextIndexByPlatform.get(platform) : undefined;
      const sprite = this.mushroomEnemySprites[i];
      if (nextIndex === undefined) {
        if (sprite) {
          this.mushroomEnemyLayer.removeChild(sprite);
          sprite.destroy();
        }
        continue;
      }
      if (!sprite) {
        continue;
      }
      enemy.platformIdx = nextIndex;
      nextMushrooms.push(enemy);
      nextMushroomSprites.push(sprite);
    }
    this.mushroomEnemies = nextMushrooms;
    this.mushroomEnemySprites = nextMushroomSprites;

    this.platforms = nextPlatforms;
    this.currentGroundPlatform = restPlatform;
    if (this.grapple && !this.platforms.some((platform) => platform.stairId === this.grapple?.hookStairId)) {
      this.grapple = null;
    }
    this.rebuildPlatformSprites();
  }

  private resumePlatformsAboveRestFloor(restY: number): void {
    if (this.platforms.some((platform) => platform.y < restY && platform.kind !== 'rest')) {
      return;
    }

    let previousTopY = restY;
    for (let i = 1; i < STAIRS.poolCount; i += 1) {
      this.nextStairId += 1;
      const y = previousTopY - this.computeStairGapPx(this.nextStairId);
      const platform: Platform = {
        x: 0,
        y,
        width: 0,
        height: STAIRS.platformHeight,
        baseWidth: 150 + ((this.nextStairId * 37) % 80),
        driftDir: Math.random() < 0.5 ? -1 : 1,
        driftVx: 0,
        stairId: this.nextStairId,
        kind: 'normal',
      };
      this.applyResponsivePlatformWidth(platform);
      platform.x = this.computePlatformSpawnX(this.nextStairId, platform.width);
      this.platforms.push(platform);
      previousTopY = y;
    }

    this.rebuildPlatformSprites();
    this.spawnCollectibleField();
    this.spawnMushroomEnemies();
  }

  /** Grounded on {@link platforms}[0] when it is the wide Floor 0 spawn deck (feet band matches physics landing). */
  private isPlayerGroundedOnFloor0SpawnDeck(): boolean {
    const deck = this.platforms[0];
    if (!deck || deck.kind !== 'spawn' || !this.player.body.grounded) {
      return false;
    }
    const b = this.player.body;
    const feetY = b.y + b.height;
    if (feetY < deck.y - 10 || feetY > deck.y + deck.height + 14) {
      return false;
    }
    return b.x + b.width * 0.42 > deck.x && b.x < deck.x + deck.width;
  }

  private maybeEndFloor0IntroCameraFreeze(): void {
    if (!this.cameraFrozenUntilFirstFloor0Jump || !this.isPlayerGroundedOnFloor0SpawnDeck()) {
      return;
    }
    this.cameraFrozenUntilFirstFloor0Jump = false;
  }

  private updateCamera(dt: number): void {
    this.highestY = Math.min(this.highestY, this.player.body.y);

    const viewportW = this.worldWidthFromScreen();
    const viewportH = this.worldHeightFromScreen();
    const playerCy = this.player.body.y + this.player.body.height * 0.5;
    this.cameraX = (this.worldWidth - viewportW) * 0.5;
    if (this.cameraFrozenUntilFirstFloor0Jump) {
      const maxCamXFrozen = Math.max(0, this.worldWidth - viewportW);
      this.cameraX = Math.max(0, Math.min(this.cameraX, maxCamXFrozen));
      this.world.position.set(-this.cameraX, -this.cameraY);
      this.layoutBackground();
      return;
    }
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

  private async loadBackgroundLayerTexture(
    spec: Bg7ParallaxLayerSpec,
    tier: BackgroundTierSpec,
  ): Promise<Texture> {
    if (!spec.padToTierBounds) {
      return this.loadTextureFromCandidates(spec.candidates);
    }

    for (const url of spec.candidates) {
      try {
        const fallback = (await Assets.load(url)) as Texture;
        if (fallback.source.width === tier.artWidth && fallback.source.height === tier.artHeight) {
          return fallback;
        }

        const image = new Image();
        image.src = url;
        await image.decode();

        const canvas = document.createElement('canvas');
        canvas.width = tier.artWidth;
        canvas.height = tier.artHeight;

        const context = canvas.getContext('2d');
        if (!context) {
          return fallback;
        }

        context.drawImage(
          image,
          0,
          Math.max(0, tier.artHeight - image.naturalHeight),
        );
        return Texture.from(canvas);
      } catch {
        /* try next candidate */
      }
    }

    throw new Error(`No texture loaded for: ${spec.candidates.join(' | ')}`);
  }

  private getBackgroundTierSpecForMeters(meters: number): BackgroundTierSpec {
    let selected = BACKGROUND_TIERS[0];
    for (const tier of BACKGROUND_TIERS) {
      if (meters >= tier.minMeters) {
        selected = tier;
      }
    }
    return selected;
  }

  private getLoadedBackgroundTierForMeters(meters: number): LoadedBackgroundTier | undefined {
    const desired = this.getBackgroundTierSpecForMeters(meters);
    return this.loadedBackgroundTiers.get(desired.id) ?? this.loadedBackgroundTiers.get(BACKGROUND_TIERS[0].id);
  }

  private getBackgroundTierSpecById(id: BackgroundTierId): BackgroundTierSpec {
    return BACKGROUND_TIERS.find((tier) => tier.id === id) ?? BACKGROUND_TIERS[0];
  }

  private getBackgroundTransitionMeters(viewportHeight: number): number {
    const viewportBottomWorldY = this.cameraY + viewportHeight;
    return Math.max(
      0,
      (this.climbBaselineY - (viewportBottomWorldY - this.player.body.height)) / 12,
    );
  }

  private ensureBackgroundBackdropFill(): void {
    if (!this.backgroundRoot.children.includes(this.bgBackdropFill)) {
      this.backgroundRoot.addChildAt(this.bgBackdropFill, 0);
    } else {
      this.backgroundRoot.setChildIndex(this.bgBackdropFill, 0);
    }
  }

  private ensureBackgroundOverlayRoot(): void {
    if (!this.backgroundRoot.children.includes(this.bgOverlayRoot)) {
      this.bgOverlayRoot.eventMode = 'none';
      this.bgOverlayRoot.mask = this.bgOverlayMask;
      this.backgroundRoot.addChild(this.bgOverlayRoot);
    }
    if (!this.backgroundRoot.children.includes(this.bgOverlayMask)) {
      this.backgroundRoot.addChild(this.bgOverlayMask);
    }
    this.backgroundRoot.setChildIndex(this.bgOverlayRoot, this.backgroundRoot.children.length - 1);
    this.backgroundRoot.setChildIndex(this.bgOverlayMask, this.backgroundRoot.children.length - 1);
  }

  private clearBackgroundOverlay(): void {
    for (const { tile } of this.bgOverlayLayers) {
      this.bgOverlayRoot.removeChild(tile);
      tile.destroy({ texture: false });
    }
    this.bgOverlayLayers = [];
    this.activeOverlayBackgroundTierId = undefined;
    this.bgOverlayMask.clear();
  }

  private rebuildBackgroundLayerTiles(
    target: Container,
    layers: readonly { readonly texture: Texture; readonly speed: number }[],
    out: { tile: TilingSprite; speed: number }[],
    vw: number,
    vh: number,
  ): void {
    for (const { texture, speed } of layers) {
      const tile = new TilingSprite({
        texture,
        width: vw,
        height: vh,
      });
      tile.eventMode = 'none';
      tile.roundPixels = false;
      target.addChild(tile);
      out.push({ tile, speed });
    }
  }

  private rebuildBackgroundTiles(tier: LoadedBackgroundTier, vw: number, vh: number): void {
    for (const { tile } of this.bgParallaxLayers) {
      this.backgroundRoot.removeChild(tile);
      tile.destroy({ texture: false });
    }
    this.bgParallaxLayers = [];
    this.activeBackgroundTierId = tier.id;
    this.ensureBackgroundBackdropFill();
    this.rebuildBackgroundLayerTiles(this.backgroundRoot, tier.layers, this.bgParallaxLayers, vw, vh);
    this.ensureBackgroundOverlayRoot();
  }

  private rebuildBackgroundOverlay(tier: LoadedBackgroundTier, vw: number, vh: number): void {
    this.clearBackgroundOverlay();
    this.activeOverlayBackgroundTierId = tier.id;
    this.ensureBackgroundOverlayRoot();
    this.rebuildBackgroundLayerTiles(this.bgOverlayRoot, tier.layers, this.bgOverlayLayers, vw, vh);
  }

  private syncBackgroundTierForCurrentAltitude(vw: number, vh: number): void {
    const baseTier = this.getLoadedBackgroundTierForMeters(this.getBackgroundTransitionMeters(vh));
    if (baseTier && baseTier.id !== this.activeBackgroundTierId) {
      this.rebuildBackgroundTiles(baseTier, vw, vh);
    }

    const overlayTier = this.getLoadedBackgroundTierForMeters(this.getHudClimbMeters());
    if (!overlayTier || !baseTier || overlayTier.id === baseTier.id) {
      this.clearBackgroundOverlay();
      return;
    }

    if (overlayTier.id !== this.activeOverlayBackgroundTierId) {
      this.rebuildBackgroundOverlay(overlayTier, vw, vh);
    }

    const overlaySpec = this.getBackgroundTierSpecById(overlayTier.id);
    const dividerScreenY = this.getRestFloorTopY(overlaySpec.minMeters) - this.cameraY;
    const clipHeight = Math.max(0, Math.min(vh, dividerScreenY));
    this.bgOverlayMask.clear();
    this.bgOverlayMask.rect(0, 0, vw, clipHeight).fill({ color: 0xffffff, alpha: 1 });
  }
  
  /**
   * Clears parallax state before (re)loading background tiers. Does not touch `bgBackdropFill` ordering.
   */
  private resetBackgroundTextureLoadState(): void {
    for (const { tile } of this.bgParallaxLayers) {
      this.backgroundRoot.removeChild(tile);
      tile.destroy({ texture: false });
    }
    this.bgParallaxLayers = [];
    this.clearBackgroundOverlay();
    this.loadedBackgroundTiers.clear();
    this.activeBackgroundTierId = undefined;
  }

  /** Load one altitude tier into {@link loadedBackgroundTiers} (skips if already present). */
  private async loadBackgroundTierIntoMap(tier: BackgroundTierSpec): Promise<void> {
    if (this.loadedBackgroundTiers.has(tier.id)) {
      return;
    }
    const loadedLayers: { texture: Texture; speed: number }[] = [];
    try {
      for (const spec of tier.layers) {
        const tex = await this.loadBackgroundLayerTexture(spec, tier);
        this.prepareTextureForInfiniteTile(tex);
        loadedLayers.push({ texture: tex, speed: spec.speed });
      }
    } catch {
      try {
        const tex = await this.loadTextureFromCandidates(tier.fallbackCandidates);
        this.prepareTextureForInfiniteTile(tex);
        loadedLayers.splice(0, loadedLayers.length, { texture: tex, speed: tier.fallbackSpeed });
      } catch {
        return;
      }
    }
    if (loadedLayers.length > 0) {
      this.loadedBackgroundTiers.set(tier.id, { id: tier.id, layers: loadedLayers });
    }
  }

  /**
   * Mobile quick-start: only the first parallax tier (~0–1000m). Remaining tiers load in
   * {@link finishDeferredPlaySceneLoadsForMobile}.
   */
  private async loadBackgroundTextureEssentialForQuickMobile(): Promise<void> {
    this.resetBackgroundTextureLoadState();
    const vw = Math.max(1, this.worldWidthFromScreen());
    const vh = Math.max(1, this.worldHeightFromScreen());
    await this.loadBackgroundTierIntoMap(BACKGROUND_TIERS[0]);
    this.ensureBackgroundBackdropFill();
    const initialTier = this.getLoadedBackgroundTierForMeters(0);
    if (initialTier) {
      this.rebuildBackgroundTiles(initialTier, vw, vh);
    }
  }

  /**
   * After the first frame of gameplay: extra BG tiers, decorative platform atlases, mushrooms, DragonBones tongue.
   */
  private async finishDeferredPlaySceneLoadsForMobile(): Promise<void> {
    for (let i = 1; i < BACKGROUND_TIERS.length; i += 1) {
      await this.loadBackgroundTierIntoMap(BACKGROUND_TIERS[i]);
    }
    this.layoutBackground();
    await this.loadPlatformSpriteDecorAndAltTextures();
    await this.loadMushroomTextures();
    if (!this.gameOver && this.mushroomRunTextures.length > 0 && this.mushroomEnemies.length === 0) {
      this.spawnMushroomEnemies();
    }
    await this.tryLoadTongueArmature();
  }

  /**
   * Builds `TilingSprite` layers (farthest → nearest). Tiers load up front so altitude changes can
   * swap texture sets instantly: 0-1000M, 1K-2KM, then 2K-3KM.
   */
  private async loadBackgroundTexture(): Promise<void> {
    this.resetBackgroundTextureLoadState();

    const vw = Math.max(1, this.worldWidthFromScreen());
    const vh = Math.max(1, this.worldHeightFromScreen());

    for (const tier of BACKGROUND_TIERS) {
      await this.loadBackgroundTierIntoMap(tier);
    }

    this.ensureBackgroundBackdropFill();
    const initialTier = this.getLoadedBackgroundTierForMeters(0);
    if (initialTier) {
      this.rebuildBackgroundTiles(initialTier, vw, vh);
    }
  }

  /** Slices `heart_counter-Sheet.png` into row frames for the top HUD. */
  private async loadHeartCounterSheet(): Promise<void> {
    const heartSheet = (await Assets.load(HEART_COUNTER_SHEET_URL)) as Texture;
    const source = heartSheet.source;
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
    this.syncBackgroundTierForCurrentAltitude(vw, vh);

    this.bgBackdropFill.clear();
    this.bgBackdropFill.rect(0, 0, vw, vh).fill({ color: this.currentBackgroundColor, alpha: 1 });

    for (const { tile, speed } of this.bgParallaxLayers) {
      tile.position.set(0, 0);
      tile.width = vw;
      tile.height = vh;
      tile.tilePosition.set(-this.cameraX * speed, -this.cameraY * speed);
    }

    for (const { tile, speed } of this.bgOverlayLayers) {
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

  private maybeTriggerScreenShake(pointsDelta: number): void {
    if (pointsDelta >= SCORE_UI.bigPointsThreshold) {
      this.shakeTime = Math.max(this.shakeTime, SCORE_UI.shakeDurationSec);
    }
  }

  private updateRipples(dt: number): void {
    this.ripples = this.ripples
      .map((ripple) => ({ ...ripple, age: ripple.age + dt }))
      .filter((ripple) => ripple.age < 0.8);
  }

  private pickRandomGameMusicBgmUrl(): string {
    const tracks = GAME_MUSIC_BGM_TRACKS;
    if (tracks.length === 0) {
      return BGM_FALLBACK_URL;
    }
    if (tracks.length === 1) {
      const only = tracks[0];
      this.lastGameMusicBgmUrl = only;
      return only;
    }
    let choice = tracks[Math.floor(Math.random() * tracks.length)];
    let guard = 0;
    while (choice === this.lastGameMusicBgmUrl && guard++ < 12) {
      choice = tracks[Math.floor(Math.random() * tracks.length)];
    }
    this.lastGameMusicBgmUrl = choice;
    return choice;
  }

  private startBackgroundMusic(): void {
    this.stopBackgroundMusic();
    const bgm = new Audio(this.pickRandomGameMusicBgmUrl());
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
    this.level = nextLevel;
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
      if (p.kind === 'spawn') {
        const bounds = this.getFloorZeroSpawnPlatformBounds();
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

  private spawnComboSuperJumpParticles(): void {
    const cx = this.player.body.x + this.player.body.width * 0.5;
    const cy = this.player.body.y + this.player.body.height * 0.42;
    for (let i = 0; i < SUPER_JUMP_SPARK_COUNT; i += 1) {
      const a = Math.random() * Math.PI * 2;
      const speed = 95 + Math.random() * 155;
      this.comboSuperJumpParticles.push({
        x: cx + (Math.random() - 0.5) * 14,
        y: cy + (Math.random() - 0.5) * 10,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed - 210,
        age: 0,
        life: 0.26 + Math.random() * 0.16,
      });
    }
  }

  private updateComboSuperJumpParticles(dt: number): void {
    this.comboSuperJumpParticles = this.comboSuperJumpParticles
      .map((p) => ({
        ...p,
        age: p.age + dt,
        x: p.x + p.vx * dt,
        y: p.y + p.vy * dt,
        vy: p.vy + 520 * dt,
      }))
      .filter((p) => p.age < p.life);
  }

  private drawComboSuperJumpParticles(): void {
    for (const p of this.comboSuperJumpParticles) {
      const u = p.age / p.life;
      const alpha = (1 - u) * 0.88;
      const r = 1.4 + 2.4 * (1 - u);
      this.fxLayer.circle(p.x, p.y, r).fill({ color: 0x66ffe8, alpha });
      this.fxLayer.circle(p.x + 0.8, p.y - 1.1, r * 0.42).fill({
        color: 0xffffff,
        alpha: alpha * 0.72,
      });
    }
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

  private drawShieldSaveEffect(): void {
    if (this.shieldSaveFlashTime <= 0) {
      return;
    }

    const u = this.shieldSaveFlashTime / SHIELD_SAVE_FLASH_SEC;
    const cx = this.player.body.x + this.player.body.width * 0.5;
    const cy = this.player.body.y + this.player.body.height * 0.45;
    const radius = 32 + (1 - u) * 42;
    this.fxLayer.circle(cx, cy, radius).stroke({
      color: 0x66ccff,
      alpha: u * 0.9,
      width: 4,
    });
    this.fxLayer.circle(cx, cy, radius * 0.72).fill({
      color: 0x66ccff,
      alpha: u * 0.12,
    });
    this.fxLayer
      .moveTo(cx, cy - 28)
      .lineTo(cx + 24, cy - 4)
      .lineTo(cx + 13, cy + 30)
      .lineTo(cx, cy + 42)
      .lineTo(cx - 13, cy + 30)
      .lineTo(cx - 24, cy - 4)
      .closePath()
      .stroke({ color: 0xc8ffff, alpha: u * 0.95, width: 3 });
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

  /**
   * Best scored landing altitude in the same HUD “m” units as {@link getHudClimbMeters} (see {@link getPlatformMeters}).
   * When auto-scroll + camera follow keep the player body’s Y in a narrow band, raw climb-from-body can plateau even
   * though {@link lastScoredLandWorldTopY} keeps moving up — use this so SPD / peak height track real progress.
   */
  private getBestLandedClimbMeters(): number {
    if (this.lastScoredLandWorldTopY === Number.POSITIVE_INFINITY) {
      return 0;
    }
    return Math.max(
      0,
      (this.climbBaselineY - (this.lastScoredLandWorldTopY - this.player.body.height)) / 12,
    );
  }

  /**
   * Scroll / difficulty: **continuous** climb scaling (not floor’d to 200 m steps) so SPD rises smoothly
   * while ascending; steeper slope above {@link SCROLL_SPEED_HIGH_TIER_FROM_METERS}; plus runtime + score.
   */
  private getAltitudeSpeedMultiplier(): number {
    const m = Math.max(
      this.getHudClimbMeters(),
      this.peakClimbMetersThisRun,
      this.getBestLandedClimbMeters(),
    );
    const w = SCROLL_SPEED_WARMUP_METERS;
    const band = SCROLL_SPEED_STEP_METERS;
    let altitudeMult = 1;
    if (m > w) {
      const effM = m - w;
      const lowSpanM = SCROLL_SPEED_HIGH_TIER_FROM_METERS - w;
      const lowM = Math.min(effM, lowSpanM);
      const highM = Math.max(0, effM - lowSpanM);
      altitudeMult =
        1 +
        SCROLL_SPEED_STEP_DELTA * (lowM / band) +
        SCROLL_SPEED_HIGH_TIER_DELTA * (highM / band);
    }
    const runtimeSteps = Math.max(
      0,
      Math.floor((this.runTime - SCROLL_SPEED_RUNTIME_START_SEC) / SCROLL_SPEED_RUNTIME_STEP_SEC),
    );
    const scoreSteps = Math.max(0, Math.floor(this.score / SCROLL_SPEED_SCORE_STEP));
    let mult =
      altitudeMult +
      SCROLL_SPEED_RUNTIME_DELTA * runtimeSteps +
      SCROLL_SPEED_SCORE_DELTA * scoreSteps;
    if (m >= HARD_SPEED_CAP_FROM_METERS) {
      mult = Math.min(mult, HARD_SPEED_CAP_MULT);
    }
    return mult;
  }

  private getCameraScrollSpeedPx(): number {
    return AUTO_SCROLL_BASE_SPEED_PX * this.getAltitudeSpeedMultiplier();
  }

  /** Tier index for speed feedback; tracks whole {@link SCROLL_SPEED_STEP_DELTA} steps of {@link getAltitudeSpeedMultiplier} (altitude + runtime). */
  private getScrollSpeedTier(): number {
    const mult = this.getAltitudeSpeedMultiplier();
    if (mult <= 1.0001) {
      return 0;
    }
    return Math.floor((mult - 1) / SCROLL_SPEED_STEP_DELTA);
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
    return this.getLevelScrollSpeedPx() * this.getAltitudeSpeedMultiplier();
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
      if (this.tongueDbReady && this.tongueArmature) {
        this.syncTongueArmatureToGrapple(mouth, tip, false);
      } else {
        this.drawGrappleTongue(mouth, tip, false);
      }
    }

    this.drawCollectibles();
    this.drawDiamondShineSparks();
    this.drawLevelUpParticles();
    this.drawComboSuperJumpParticles();
    this.drawShieldSaveEffect();
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

  /** Grapple is available whenever it is not on cooldown (no skill-gating layer). */
  private canUseTongueGrapple(): boolean {
    return true;
  }

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

    this.jumpsHudText = new Text({
      text: '↑ 0',
      style: this.createNeonGoldTextStyle(17, 3),
    });
    this.jumpsHudText.anchor.set(1, 0);
    this.jumpsHudText.zIndex = 1003;
    this.jumpsHudText.alpha = 0.95;
    this.uiLayer.addChild(this.jumpsHudText);

    this.layoutClimbHud();
    this.refreshClimbHudText();
  }

  private layoutClimbHud(): void {
    if (this.climbHudText) {
      this.climbHudText.position.set(this.width - 20, UI_SAFE_PAD_TOP + 34);
    }
    if (this.jumpsHudText) {
      this.jumpsHudText.position.set(this.width - 20, UI_SAFE_PAD_TOP + 54);
    }
  }

  private refreshClimbHudText(): void {
    if (this.climbHudText) {
      const mult = this.getAltitudeSpeedMultiplier();
      const mApprox = Math.round(this.getClimbHeightPx() / 12);
      this.climbHudText.text = `${mApprox}M  |  SPD x${mult.toFixed(2)}`;
    }
    if (this.jumpsHudText) {
      this.jumpsHudText.text = `↑ ${this.jumpCount}`;
    }
  }

  /**
   * Combo UI lives under `uiLayer` only (never under `world` / `gameShake`) — fixed on screen while climbing,
   * equivalent to Phaser `scrollFactor(0)` / camera‑fixed HUD.
   */
  private layoutComboHudRoot(): void {
    const skillBarTop = UI_SAFE_PAD_TOP + UI_HEADER_H + SKILL_PAIR_BELOW_HEADER_GAP_PX;
    const skillBarBottom = skillBarTop + PULL_UP_BTN_H * PULL_UP_BTN_SCALE;
    const comboY = skillBarBottom + COMBO_BELOW_SKILL_PAIR_GAP_PX;
    this.comboHudRoot.position.set(COMBO_HUD_SCREEN_X, comboY);
    this.comboHudRoot.scale.set(COMBO_HUD_ROOT_SCALE);
  }

  /**
   * Combo badge → scaled `comboHudRoot`. Skill pair (`SUPER JUMP` + `PULL UP`) is a sibling on
   * `uiLayer` under the health/header strip (`scrollFactor` 0 equivalent).
   */
  private setupComboHud(): void {
    this.comboHudRoot.eventMode = 'none';
    this.comboHudRoot.sortableChildren = true;
    this.comboHudRoot.zIndex = 1004;

    this.comboBadge = new ComboBadge();
    this.comboBadge.zIndex = 1;
    /** Position is the badge **center** because the inner pivot is the geometric center. */
    this.comboBadge.position.set(COMBO_BADGE_W * 0.5, COMBO_BADGE_H * 0.5);

    this.comboSynth = new ComboSynth();

    this.skillPairRoot.zIndex = 1010;
    this.skillPairRoot.sortableChildren = true;
    this.skillPairRoot.visible = false;
    this.skillPairRoot.scale.set(PULL_UP_BTN_SCALE);
    this.skillPairRoot.alpha = 0.85;

    this.superJumpBtnRoot.position.set(0, 0);
    this.superJumpBtnGfx.cursor = 'pointer';
    this.superJumpBtnGfx.eventMode = 'none';
    this.superJumpBtnLabel = new Text({
      text: 'SUPER JUMP',
      style: this.createNeonGoldTextStyle(12, 2.5),
    });
    this.superJumpBtnLabel.anchor.set(0.5);
    this.superJumpBtnLabel.position.set(PULL_UP_BTN_W * 0.5, PULL_UP_BTN_H * 0.5);
    this.superJumpBtnLabel.eventMode = 'none';
    this.superJumpBtnRoot.addChild(this.superJumpBtnGfx, this.superJumpBtnLabel);
    this.superJumpBtnGfx.on('pointertap', (event) => {
      event.stopPropagation();
      this.fireManualSuperJump();
    });

    this.superTongueBtnRoot.position.set(PULL_UP_BTN_W + SKILL_PAIR_BTN_GAP_PX, 0);
    this.superTongueBtnGfx.cursor = 'pointer';
    this.superTongueBtnGfx.eventMode = 'none';
    this.superTongueBtnLabel = new Text({
      text: 'PULL UP',
      style: this.createNeonGoldTextStyle(14, 3),
    });
    this.superTongueBtnLabel.anchor.set(0.5);
    this.superTongueBtnLabel.position.set(PULL_UP_BTN_W * 0.5, PULL_UP_BTN_H * 0.5);
    this.superTongueBtnLabel.eventMode = 'none';
    this.superTongueBtnRoot.addChild(this.superTongueBtnGfx, this.superTongueBtnLabel);
    this.superTongueBtnGfx.on('pointertap', (event) => {
      event.stopPropagation();
      this.fireSuperTongue();
    });

    this.skillPairRoot.addChild(this.superJumpBtnRoot, this.superTongueBtnRoot);

    this.comboHudRoot.addChild(this.comboBadge);
    this.uiLayer.addChild(this.comboHudRoot);
    this.uiLayer.addChild(this.skillPairRoot);
    this.layoutSkillPairHud();
    this.layoutComboHudRoot();
    this.drawSuperJumpButton();
    this.drawSuperTongueButton();
  }

  /**
   * Skill pair on `uiLayer` only — fixed to the camera (`scrollFactor` 0 equivalent).
   * Y sits flush under the purple header bar bottom: `UI_SAFE_PAD_TOP + UI_HEADER_H` + {@link SKILL_PAIR_BELOW_HEADER_GAP_PX}.
   */
  private layoutSkillPairHud(): void {
    this.skillPairRoot.pivot.set(0, 0);
    this.skillPairRoot.position.set(
      SKILL_PAIR_HUD_X,
      UI_SAFE_PAD_TOP + UI_HEADER_H + SKILL_PAIR_BELOW_HEADER_GAP_PX,
    );
    this.superJumpBtnGfx.hitArea = new Rectangle(0, 0, PULL_UP_BTN_W, PULL_UP_BTN_H);
    this.superTongueBtnGfx.hitArea = new Rectangle(0, 0, PULL_UP_BTN_W, PULL_UP_BTN_H);
  }

  private drawHudSkillButton(gfx: Graphics, pulseT: number, cyanAccent: boolean): void {
    gfx.clear();
    const pulse = 0.5 + 0.5 * Math.sin(pulseT * 6);
    const accent = cyanAccent
      ? pulse > 0.5
        ? 0x88fff4
        : 0x44ccb8
      : pulse > 0.5
        ? 0xffd700
        : 0xff9900;
    gfx.roundRect(0, 0, PULL_UP_BTN_W, PULL_UP_BTN_H, 12).fill({
      color: 0x2a0040,
      alpha: 0.92,
    });
    gfx.roundRect(0, 0, PULL_UP_BTN_W, PULL_UP_BTN_H, 12).stroke({
      width: 3,
      color: accent,
      alpha: 0.95,
    });
    gfx.roundRect(3, 3, PULL_UP_BTN_W - 6, PULL_UP_BTN_H - 6, 9).stroke({
      width: 1.4,
      color: accent,
      alpha: 0.4 + 0.3 * pulse,
    });
  }

  private drawSuperJumpButton(): void {
    this.drawHudSkillButton(this.superJumpBtnGfx, this.superTongueBtnPulse + 0.35, true);
  }

  private drawSuperTongueButton(): void {
    this.drawHudSkillButton(this.superTongueBtnGfx, this.superTongueBtnPulse, false);
  }

  /**
   * Tick combo expiry (no-jump window) + advance badge animations. Drives skill pair pulse / chain
   * window expiry and post-pull grapple buff timer.
   */
  private tickComboHud(dt: number): void {
    const skillChainGrace =
      this.skillPullUpSpent &&
      !this.skillSuperJumpSpent &&
      this.skillChainWindowEnd > 0 &&
      this.runTime <= this.skillChainWindowEnd;
    const superJumpGrace =
      this.comboCount > 0 && this.runTime <= this.superJumpComboGraceUntil;
    if (
      !skillChainGrace &&
      !superJumpGrace &&
      this.comboCount > 0 &&
      this.runTime - this.comboLastJumpTime > COMBO_CHAIN_WINDOW_SEC
    ) {
      this.breakCombo();
    }
    this.comboBadge?.tick(dt);
    this.superTongueBtnPulse += dt;
    if (this.skillPairAvailable) {
      this.syncSkillPairChildVisibility();
      if (this.superJumpBtnRoot.visible) {
        this.drawSuperJumpButton();
      }
      if (this.superTongueBtnRoot.visible) {
        this.drawSuperTongueButton();
      }
    }
    this.tickSkillPairChainWindow();
    if (this.superTongueBuffTime > 0) {
      this.superTongueBuffTime = Math.max(0, this.superTongueBuffTime - dt);
    }
  }

  private syncSkillPairChildVisibility(): void {
    if (!this.skillPairAvailable) {
      return;
    }
    const sjOk =
      !this.skillSuperJumpSpent &&
      (!this.skillPullUpSpent || this.runTime <= this.skillChainWindowEnd);
    this.superJumpBtnRoot.visible = sjOk;
    this.superJumpBtnGfx.eventMode = sjOk ? 'static' : 'none';
    const puOk = !this.skillPullUpSpent;
    this.superTongueBtnRoot.visible = puOk;
    this.superTongueBtnGfx.eventMode = puOk ? 'static' : 'none';
  }

  private tickSkillPairChainWindow(): void {
    if (
      !this.skillPullUpSpent ||
      this.skillSuperJumpSpent ||
      this.skillChainWindowEnd <= 0 ||
      this.runTime <= this.skillChainWindowEnd
    ) {
      return;
    }
    this.expireSkillPairWithoutMegaJump();
  }

  /** Pull-up spent but mega jump never fired before the chain timer expired. */
  private expireSkillPairWithoutMegaJump(): void {
    this.pullUpJumpsAccum = 0;
    this.setSkillPairAvailable(false);
    this.superTongueBtnRoot.visible = true;
    this.superJumpBtnRoot.visible = true;
  }

  /** Streak reset path — called by expiry, non-climbing jumps, fall save, or death. */
  private breakCombo(): void {
    if (this.comboCount === 0 && !this.skillPairAvailable && !this.skillPullUpSpent) {
      this.superJumpStairTrackActive = false;
      this.superJumpCrossedStairIds.clear();
      this.megaJumpReanchorComboOnLanding = false;
      return;
    }
    this.comboCount = 0;
    this.superJumpComboGraceUntil = Number.NEGATIVE_INFINITY;
    this.megaJumpReanchorComboOnLanding = false;
    this.superJumpStairTrackActive = false;
    this.superJumpCrossedStairIds.clear();
    this.comboBadge?.expire();
  }

  /** Show / hide the skill pair offer (`SUPER JUMP` + `PULL UP`). Does not clear grapple buff. */
  private setSkillPairAvailable(available: boolean): void {
    if (available === this.skillPairAvailable) {
      return;
    }
    this.skillPairAvailable = available;
    this.skillPairRoot.visible = available;
    if (!available) {
      this.skillPullUpSpent = false;
      this.skillSuperJumpSpent = false;
      this.skillChainWindowEnd = 0;
      this.superJumpBtnGfx.eventMode = 'none';
      this.superTongueBtnGfx.eventMode = 'none';
      return;
    }
    this.skillPullUpSpent = false;
    this.skillSuperJumpSpent = false;
    this.skillChainWindowEnd = 0;
    this.superTongueBtnPulse = 0;
    this.superJumpBtnRoot.visible = true;
    this.superTongueBtnRoot.visible = true;
    this.superJumpBtnGfx.eventMode = 'static';
    this.superTongueBtnGfx.eventMode = 'static';
    this.drawSuperJumpButton();
    this.drawSuperTongueButton();
    this.layoutSkillPairHud();
  }

  /**
   * Pull-up grapple: fires ~{@link SUPER_TONGUE_STAIRS_UP} stairs up + grapple buff. Opens a short
   * {@link SKILL_CHAIN_WINDOW_SEC} window to tap {@link fireManualSuperJump} for a chain bonus.
   */
  private fireSuperTongue(): void {
    if (!this.skillPairAvailable || this.skillPullUpSpent || this.grapple) {
      return;
    }
    const hit = this.findSuperTongueTarget();
    if (!hit) {
      return;
    }
    this.grappleCooldown = 0;
    this.beginGrappleFromHit(hit);
    this.superTongueBuffTime = SUPER_TONGUE_BUFF_DURATION_SEC;
    /**
     * Pressing the unlocked button is a positive action: extend the chain window so the player has
     * time to land + jump again before expiry, and play the next tier hit on the badge so the
     * audio/visual response is immediate (the actual grapple flight can take >1s).
     */
    this.comboLastJumpTime = this.runTime;
    /** Pull-up counts as one combo step (grants progression toward the next tier word). */
    this.comboCount += 1;
    const wordTier = comboStreakToWordTier(this.comboCount);
    this.comboBadge?.bumpTo(this.comboCount);
    this.comboSynth?.play(wordTier);
    /** Mid-air shake + camera punch makes the moment feel earned. */
    this.shakeTime = Math.max(this.shakeTime, 0.18);
    this.skillPullUpSpent = true;
    this.skillChainWindowEnd = this.runTime + SKILL_CHAIN_WINDOW_SEC;
    this.syncSkillPairChildVisibility();
  }

  /**
   * Manual mega jump (`SUPER_JUMP_VY_SCALE`× upward). Combo: {@link registerComboJump} on takeoff
   * (`skipClimbCheck`), then one extra combo per stair top crossed while ascending (horizontal overlap).
   * Pull-up → mega within {@link SKILL_CHAIN_WINDOW_SEC} adds a score bonus only.
   */
  private fireManualSuperJump(): void {
    if (!this.skillPairAvailable || this.skillSuperJumpSpent) {
      return;
    }
    if (this.skillPullUpSpent && this.runTime > this.skillChainWindowEnd) {
      return;
    }
    if (!this.player.body.grounded || this.grapple) {
      return;
    }

    const chained =
      this.skillPullUpSpent &&
      this.skillChainWindowEnd > 0 &&
      this.runTime <= this.skillChainWindowEnd;

    const launchPlatform = this.currentGroundPlatform;

    this.maybeEndFloor0IntroCameraFreeze();
    this.physics.jump(this.player.body);
    this.player.body.vy *= SUPER_JUMP_VY_SCALE;
    this.jumpCount += 1;

    /**
     * Combo registration must run **before** mega-jump stair tracking: a cold chain calls
     * {@link breakCombo}, which clears {@link superJumpStairTrackActive} / {@link superJumpCrossedStairIds}
     * / {@link megaJumpReanchorComboOnLanding}. Those flags are set immediately after.
     */
    this.registerComboJump({ skipClimbCheck: true });

    this.superJumpCrossedStairIds.clear();
    if (launchPlatform) {
      this.superJumpCrossedStairIds.add(launchPlatform.stairId);
    }
    this.superJumpStairTrackActive = true;
    this.megaJumpReanchorComboOnLanding = true;

    if (chained) {
      const bonus = SKILL_CHAIN_BASE_SCORE + this.comboCount * SKILL_CHAIN_SCORE_PER_COMBO;
      this.score += bonus;
      this.scoreboard?.onPointsGained(bonus);
      this.maybeTriggerScreenShake(Math.min(10, 2 + Math.floor(bonus / 35)));
    }

    this.superJumpComboGraceUntil = this.runTime + SUPER_JUMP_COMBO_GRACE_EXTEND_SEC;

    if (this.comboCount >= 2) {
      this.comboBadge?.bumpTo(this.comboCount);
    }

    this.spawnComboSuperJumpParticles();
    this.player.onJump();
    this.player.onComboSuperJumpBoost();

    this.skillSuperJumpSpent = true;
    this.finishSkillPairAfterMegaJump();
    this.maybeIncrementPullUpJumpCounter();
  }

  private finishSkillPairAfterMegaJump(): void {
    this.pullUpJumpsAccum = 0;
    this.setSkillPairAvailable(false);
    this.superTongueBtnRoot.visible = true;
    this.superJumpBtnRoot.visible = true;
  }

  /**
   * Pick the platform roughly {@link SUPER_TONGUE_STAIRS_UP} stairs above the player's current
   * footing (current stair or last scored stair as fallback). Falls back to a wide overhead
   * raycast if the exact stair was recycled out.
   */
  private findSuperTongueTarget():
    | { x: number; y: number; platform: Platform }
    | undefined {
    const baseStairId =
      this.currentGroundPlatform?.stairId ??
      this.platforms
        .filter((p) => p.y >= this.player.body.y - 8)
        .reduce(
          (best, p) => (best ? (p.y < best.y ? p : best) : p),
          undefined as Platform | undefined,
        )?.stairId ??
      this.lastScoredStairId;
    const targetStairId = baseStairId + SUPER_TONGUE_STAIRS_UP;
    const exact = this.platforms.find(
      (p) =>
        p.stairId === targetStairId && p.y + p.height < this.player.body.y,
    );
    if (exact) {
      return {
        x: exact.x + exact.width * 0.5,
        y: exact.y + exact.height - 3,
        platform: exact,
      };
    }
    /** Recycle moved the exact target away — pick the closest stair within an extended reach. */
    const reach = STAIRS.stepPx * (SUPER_TONGUE_STAIRS_UP + 2);
    let best:
      | { score: number; x: number; y: number; platform: Platform }
      | undefined;
    const shootX = this.player.body.x + this.player.body.width * 0.5;
    const shootY = this.player.body.y + this.player.body.height * 0.5;
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
      const score = dy * 1.3 + dx * 0.3;
      if (!best || score < best.score) {
        best = { score, x: px, y: bottom - 3, platform: p };
      }
    }
    return best ? { x: best.x, y: best.y, platform: best.platform } : undefined;
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
      this.resetRun({ pickNewBgm: true });
    });
    this.gameOverRestartBtn.on('pointertap', (event) => {
      event.stopPropagation();
      this.resetRun({ pickNewBgm: true });
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
    this.leaderboardSubtitle = new Text({
      text: 'Places 1–5: highest total score first',
      style: this.createNeonGoldTextStyle(13, 2),
    });
    this.leaderboardSubtitle.anchor.set(0.5);
    this.leaderboardSubtitle.eventMode = 'none';
    this.leaderboardSubtitle.alpha = 0.88;
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
      this.leaderboardSubtitle,
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

  /** Top HUD: animated HP counter below the timer / header. */
  private setupHealthHud(): void {
    this.healthHudRoot.zIndex = 1006;
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
      const stackWidth = HEART_HUD_DISPLAY_WIDTH_PX;
      const heartX =
        this.timerHudText.position.x -
        stackWidth * 0.5 +
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
    this.heartHudPulseAcc += dt;
    const pulse = Math.floor(this.heartHudPulseAcc * HEART_HUD_PULSE_HZ * 2) % 2;

    if (this.heartCounterTextures.length === 0) {
      return;
    }
    if (this.heartHudTransTime > 0) {
      this.heartHudTransTime = Math.max(0, this.heartHudTransTime - dt);
      const idx = heartHudTransitionFrameIndex(this.heartHudTransFromL);
      this.heartHudSprite.texture = this.heartCounterTextures[idx];
      return;
    }
    const pair = heartHudSteadyFrameIndices(this.heartHudSegmentL);
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
    this.refreshCollectibleHudText();
  }

  private tickPlayerShield(dt: number): void {
    this.shieldSaveFlashTime = Math.max(0, this.shieldSaveFlashTime - dt);
  }

  private consumePlayerShield(): boolean {
    if (!this.player.isShielded) {
      return false;
    }
    this.player.isShielded = false;
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
    this.playerHealth = Math.max(
      0,
      this.playerHealth - MUSHROOM_DAMAGE_PER_HIT,
    );
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
    if (this.leaderboardSubtitle) {
      this.leaderboardSubtitle.position.set(overlayW * 0.5, titleY + 24);
    }

    for (const row of this.leaderboardRows) {
      row.destroy();
    }
    this.leaderboardRows = [];

    const rowsStartY = titleY + 52;
    const rowH = 72;
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
        ? `${placeLabel} ${entry.nickname.toUpperCase()}\n${entry.totalScore.toLocaleString()} pts · ${entry.maxHeightMeters.toLocaleString()} m · combo ${entry.bestCombo}`
        : loading
          ? `${placeLabel} …loading`
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
    this.peakComboThisRun = Math.max(this.peakComboThisRun, this.comboCount);
    this.breakCombo();
    this.speedTierUiFlashTime = 0;
    this.speedPulseGfx.visible = false;
    this.speedPulseGfx.alpha = 1;
    this.paused = false;
    this.pauseOverlay.visible = false;
    this.headerPauseRoot.visible = false;
    this.attackBtnRoot.visible = false;
    this.healthHudRoot.visible = false;
    this.finalMetersAtDeath = Math.max(0, Math.floor(-this.highestY / 12));
    this.peakClimbMetersThisRun = Math.max(
      this.peakClimbMetersThisRun,
      this.finalMetersAtDeath,
      Math.floor(this.getHudClimbMeters()),
      Math.floor(this.getBestLandedClimbMeters()),
    );
    this.refreshGameOverScoreText();
    this.gameOverOverlay.visible = true;
    this.leaderboardOverlay.visible = false;
    this.touchPointers.clear();
    this.touchControlPointerId = null;
    this.input?.setTouchFollowAxis(0);
    this.touchControlsLayer.visible = false;
    if (!this.deathSubmitted) {
      this.deathSubmitted = true;
      const nicknameRaw = getSavedNickname() || 'Player';
      const nickname = nicknameRaw.trim().slice(0, 20) || 'Player';
      const sessionRow: LeaderboardEntry = {
        nickname,
        totalScore: Math.max(0, Math.floor(this.score)),
        maxHeightMeters: Math.max(0, Math.floor(this.peakClimbMetersThisRun)),
        bestCombo: Math.max(0, Math.floor(this.peakComboThisRun)),
        createdAtMs: Date.now(),
      };
      void (async () => {
        try {
          await saveLeaderboardRun({
            nickname,
            totalScore: sessionRow.totalScore,
            maxHeightMeters: sessionRow.maxHeightMeters,
            bestCombo: sessionRow.bestCombo,
          });
          console.info('[PlayScene] leaderboard run saved', sessionRow);
          this.showScoreSavedHint();
          const remote = await fetchTopLeaderboard(5);
          this.lastLeaderboardTop = mergeSessionIntoTop(remote, sessionRow, 5);
          if (this.leaderboardOverlay.visible) {
            this.renderLeaderboardShell(this.lastLeaderboardTop, false);
          }
        } catch (err) {
          console.error('[PlayScene] leaderboard save failed', err);
          this.lastLeaderboardTop = mergeSessionIntoTop([], sessionRow, 5);
          if (this.leaderboardOverlay.visible) {
            this.renderLeaderboardShell(this.lastLeaderboardTop, false);
          }
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
    const top = await fetchTopLeaderboard(5).catch((err) => {
      console.error('[PlayScene] fetchTopLeaderboard failed', err);
      return [] as LeaderboardEntry[];
    });
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
    if (!this.gameOver) {
      this.peakClimbMetersThisRun = Math.max(
        this.peakClimbMetersThisRun,
        Math.floor(this.getHudClimbMeters()),
        Math.floor(this.getBestLandedClimbMeters()),
      );
      this.peakComboThisRun = Math.max(this.peakComboThisRun, this.comboCount);
    }
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

  /** Top header placement for collectible counters. */
  private syncCollectibleHudPosition(): void {
    this.collectibleHudRoot.pivot.set(0, 0.5);
    this.collectibleHudRoot.position.set(26, UI_HEADER_INFO_ROW_Y);
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

  /** HUD count shows the currently active one-use fall shield. */
  private getShieldHudStock(): number {
    return this.player.isShielded ? 1 : 0;
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

  /** Auto-activate one fall-protection shield when the bank can pay the 10 Gold / 5 Diamond cost. */
  private maybePurchaseShieldFromBank(): void {
    if (
      this.player.isShielded ||
      this.goldCount < SHIELD_BANK_GOLD ||
      this.diamondCount < SHIELD_BANK_DIAMOND
    ) {
      return;
    }

    this.goldCount -= SHIELD_BANK_GOLD;
    this.diamondCount -= SHIELD_BANK_DIAMOND;
    this.activatePlayerShield();
    this.sfx.play('collect_diamond', 0.72);
    this.collectibleHudBump = 1;
    this.hudGoldShown = this.goldCount;
    this.hudDiamondShown = this.diamondCount;
    this.refreshCollectibleHudText();
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
    this.score += add;
    this.scoreboard?.onPointsGained(add);
    if (c.kind === 'coin') {
      this.goldCount += 1;
      this.sfx.play('collect_coin', 0.9);
    } else if (c.kind === 'diamond') {
      this.diamondCount += 1;
      this.sfx.play('collect_diamond', 0.92);
      this.spawnDiamondCollectShine(pos.x, pos.y);
    } else {
      this.maybePurchaseShieldFromBank();
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
    if (platform.kind === 'rest' || platform.kind === 'spawn') {
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
    const spawnDeck = platform.kind === 'spawn';
    const h = Math.max(platform.height * 1.18, platform.height + 12);
    const tile = REST_FLOOR_TILE_PX;
    const x = platform.x;
    const width = platform.width;
    const baseFill = spawnDeck ? 0x142820 : 0x1a1630;
    const trim = spawnDeck ? 0x7ae8a8 : 0xb8f7ff;
    const capFill = spawnDeck ? 0x285038 : 0x39336c;
    this.platformLayer
      .rect(x, platform.y - 4, width, h + 8)
      .fill({ color: baseFill, alpha: 0.96 })
      .stroke({ color: trim, width: 2.5, alpha: 0.88 });
    this.platformLayer
      .rect(x, platform.y, width, h * 0.35)
      .fill({ color: capFill, alpha: 0.9 });
    const cols = Math.ceil(width / tile);
    for (let i = 0; i < cols; i += 1) {
      const tileX = x + i * tile;
      const color =
        i % 2 === 0 ? (spawnDeck ? 0x243d30 : 0x302a58) : spawnDeck ? 0x1c3028 : 0x262044;
      this.platformLayer
        .rect(tileX, platform.y + h * 0.35, Math.min(tile, width - i * tile), h * 0.65)
        .fill({ color, alpha: 0.95 });
      this.platformLayer
        .rect(tileX, platform.y - 4, 2, h + 8)
        .fill({ color: spawnDeck ? 0x60d898 : 0x80f7ff, alpha: 0.18 });
    }
    this.platformLayer
      .rect(x, platform.y - 6, width, 6)
      .fill({ color: spawnDeck ? 0xa8ffd8 : 0xc8ffff, alpha: 0.78 });
  }

  private async loadPlatformSpriteCore(): Promise<void> {
    this.platformTexture = await this.createCheckerTransparentTexture(crystalPlatformUrl);
  }

  /** Rest-floor props + slime/volcano tiles — safe to defer on mobile until after first paint. */
  private async loadPlatformSpriteDecorAndAltTextures(): Promise<void> {
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
      this.restFloorSuppliesTexture = (await Assets.load<Texture>(REST_FLOOR_SUPPLIES_URL)) as Texture;
      this.createRestFloorSupplyTextures();
    } catch {
      this.restFloorSuppliesTexture = undefined;
      this.restFloorSupplyTextures = [];
      console.warn('Failed to load rest floor supplies asset:', REST_FLOOR_SUPPLIES_URL);
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
  }

  private async loadPlatformSprite(): Promise<void> {
    await this.loadPlatformSpriteCore();
    await this.loadPlatformSpriteDecorAndAltTextures();
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

  private createRestFloorSupplyTextures(): void {
    const sheet = this.restFloorSuppliesTexture;
    if (!sheet) {
      this.restFloorSupplyTextures = [];
      return;
    }

    const source = sheet.source;
    this.restFloorSupplyTextures = REST_FLOOR_SUPPLY_PROPS.map(
      (prop) =>
        new Texture({
          source,
          frame: new Rectangle(prop.x, prop.y, prop.w, prop.h),
        }),
    );
  }

  private maybeSpawnFirstRestFloorProps(platform: Platform): void {
    if (this.getRestFloorMeters(platform) !== REST_FLOOR_HOUSE_METERS) {
      return;
    }
    this.spawnRestFloorSupplies();
  }

  private spawnRestFloorSupplies(): void {
    if (this.restFloorSupplyTextures.length === 0) {
      return;
    }

    for (let i = this.restFloorSupplyTextures.length; i < this.restFloorSupplySprites.length; i += 1) {
      const sprite = this.restFloorSupplySprites[i];
      if (sprite) {
        this.restFloorPropLayer.removeChild(sprite);
        sprite.destroy();
      }
    }
    this.restFloorSupplySprites.length = this.restFloorSupplyTextures.length;

    for (let i = 0; i < this.restFloorSupplyTextures.length; i += 1) {
      let sprite = this.restFloorSupplySprites[i];
      if (!sprite) {
        sprite = new Sprite(this.restFloorSupplyTextures[i]);
        // Pixi display-only props: no physics body is registered, so they remain static scenery.
        sprite.anchor.set(0.5, 1);
        sprite.roundPixels = RENDER.pixelArt;
        sprite.eventMode = 'none';
        sprite.zIndex = REST_FLOOR_HOUSE_DEPTH + i + 1;
        this.restFloorSupplySprites[i] = sprite;
        this.restFloorPropLayer.addChild(sprite);
      } else {
        sprite.texture = this.restFloorSupplyTextures[i];
      }
      sprite.visible = true;
      sprite.alpha = 1;
    }

    this.layoutRestFloorSupplies();
  }

  private layoutRestFloorSupplies(): void {
    if (this.restFloorSupplySprites.length === 0) {
      return;
    }

    const floorY = this.getRestFloorTopY(REST_FLOOR_HOUSE_METERS);
    const viewLeft = this.cameraX;
    const baseScale =
      this.width < REST_FLOOR_PROPS_MOBILE_SCREEN_W
        ? REST_FLOOR_SUPPLIES_SCALE_MOBILE
        : REST_FLOOR_SUPPLIES_SCALE_DESKTOP;

    let x = viewLeft + REST_FLOOR_SUPPLIES_START_X_PX;
    for (let i = 0; i < REST_FLOOR_SUPPLY_PROPS.length; i += 1) {
      const sprite = this.restFloorSupplySprites[i];
      if (!sprite || !sprite.visible) {
        continue;
      }
      const prop = REST_FLOOR_SUPPLY_PROPS[i];
      const scale = baseScale * prop.scale;
      sprite.scale.set(scale);
      sprite.position.set(x, floorY);
      x += prop.spacingAfter;
    }
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

  private clearRestFloorProps(): void {
    this.restFloorPropLayer.removeChildren().forEach((child) => child.destroy());
    this.restFloorHouseSprite = undefined;
    this.restFloorCloudSprite = undefined;
    this.restFloorCloudRightSprite = undefined;
    this.restFloorSupplySprites = [];
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
    this.layoutRestFloorSupplies();
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

  private rebuildPlatformSprites(): void {
    this.clearPlatformSprites();
    this.createPlatformSprites();
    this.syncPlatformSpritesFromPlatforms();
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
        if (this.damagePlayer()) {
          // Stop scanning this frame — `damagePlayer` already updated invuln/UI; subsequent
          // overlaps in the same frame would be wasted (one hit per swing window is enough).
          return;
        }
      }
    }
  }

  private canMushroomOccupyPlatform(platform: Platform): boolean {
    if (platform.kind === 'rest' || platform.kind === 'spawn') {
      return false;
    }
    const clearPx = REST_FLOOR_MONSTER_CLEAR_METERS * 12;
    return !this.platforms.some(
      (p) =>
        (p.kind === 'rest' || p.kind === 'spawn') && Math.abs(p.y - platform.y) <= clearPx,
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
