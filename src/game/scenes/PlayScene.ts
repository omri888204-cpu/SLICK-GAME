import {
  Application,
  Assets,
  Circle,
  Container,
  FederatedPointerEvent,
  FederatedWheelEvent,
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
  PHYSICS,
  PLATFORM_LEVEL_ART,
  PLATFORM_LEVEL_DECK_ANCHOR_Y,
  PLATFORM_SIZING,
  PLAY_SCENE,
  RENDER,
  SCORE_UI,
  STAIR_GAP_MAX_PX,
  STAIR_GAP_MIN_PX,
  STAIRS,
  tunedBlur,
  tunedUiAlpha,
  tunedUiStroke,
  WALK,
} from '../../config/game.config';
import {
  ComboBadge,
  COMBO_BADGE_H,
  COMBO_BADGE_W,
  comboStreakToWordTier,
} from '../ui/ComboBadge';
import { ComboSynth } from '../audio/ComboSynth';
import {
  loadSkillButtonTextures,
  preloadSkillButtonAssets,
} from '../constants/skillButtons';
import { Player } from '../entities/Player';
import { CandyAtmosphereManager } from '../systems/atmosphere/CandyAtmosphereManager';
import {
  BACK_5000_BACKDROP_COLOR,
  BACKGROUND_TIER_SWITCH_METERS,
} from '../systems/atmosphere/candyStaticBackground';
import {
  buildLeaderboardRowFromSyncedUser,
  fetchTopLeaderboard,
  LEADERBOARD_DISPLAY_LIMIT,
  mergeSessionIntoTop,
  saveLeaderboardRun,
  sessionQualifiesForTop,
  subscribeTopLeaderboard,
  type LeaderboardEntry,
} from '../services/leaderboard';
import {
  incrementUserBagBalances,
  subscribeUserBagBalances,
  upsertPersonalBestIfBetter,
} from '../services/rtdbUsers';
import { writeMenuBagCache } from '../services/menuBagCache';
import { getGameUserSession, patchSessionPersonalBest } from '../services/userSession';
import {
  getSavedSelectedCharacterSkin,
} from '../services/playerProfile';
import { normalizeSelectedCharacterSkin } from '../constants/playerSkin';
import { auth } from '../../firebase.js';
import { logoutAndReturnToLogin } from '../landing/runLandingGate';
import { isQuickStartMobileDevice } from '../utils/quickStartDevice';
import { InputManager } from '../systems/InputManager';
import { Physics } from '../systems/Physics';
import {
  extractPlatformFoodSheetFrameRows,
  loadKeyedSheetCanvas,
  type SheetRowBand,
} from '../utils/spriteSheetExtract';
import {
  loadKeyedTrimmedTexture,
  PLATFORM_FOOD_SHEET_DARK_BG_MAX_CHANNEL,
} from '../utils/logoTexture';
import { SkillHudButton } from '../ui/SkillHudButton';
import type { ActiveGrapple, Platform, Ripple } from '../types';
import { MENU_PLAY_TRANSITION } from '../ui/MenuPlayTransition';
import { PlatformSystem } from '../../scenes/play/world/PlatformSystem';
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

type CollectibleKind = 'coin' | 'diamond' | 'shield';

/** `platforms marshmelo.png` squash — physics {@link Platform} hitbox unchanged. */
type PlatformJuiceLayer = Container & {
  isBouncing: boolean;
  bounceElapsedSec?: number;
};

const PLATFORM_SPRITE_DATA_IS_BOUNCING = 'isBouncing';

type PlatformSpriteWithData = Sprite & {
  platformSpriteData?: Map<string, unknown>;
};

function setPlatformSpriteData(sprite: Sprite, key: string, value: unknown): void {
  const s = sprite as PlatformSpriteWithData;
  if (!s.platformSpriteData) {
    s.platformSpriteData = new Map();
  }
  s.platformSpriteData.set(key, value);
}

function getPlatformSpriteData(sprite: Sprite, key: string): unknown {
  return (sprite as PlatformSpriteWithData).platformSpriteData?.get(key);
}

type BagItemKind = 'gold' | 'diamond';

type BagSlotItem = {
  kind: BagItemKind;
};

type BagDragState = {
  fromSlot: number;
  item: BagSlotItem;
};

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
  | 'player_land'
  | 'super_jump_woohoo'
  | 'wall_slide';

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
  super_jump_woohoo:
    'https://assets.mixkit.co/active_storage/sfx/2019/2019-preview.mp3',
  wall_slide:
    'https://assets.mixkit.co/active_storage/sfx/705/705-preview.mp3',
};

/** Game binaries live in `public/assets/` and grouped subfolders. */
const GAME_ASSETS = `${import.meta.env.BASE_URL}assets`;
const PLATFORMS_DIR = `${GAME_ASSETS}/Platforms`;
const MARSHMELO_SHEET_URL = `${PLATFORMS_DIR}/${encodeURIComponent('platforms marshmelo.png')}`;
/**
 * Marshmallow grid only (top section) — left→right, top→bottom. Oreo (row 3 col 2) omitted.
 * Column `x1` is exclusive (see {@link SheetRowBand}).
 */
const MARSHMELO_ROW_BANDS: readonly SheetRowBand[] = [
  {
    y0: 173,
    y1: 273,
    columns: [
      { x0: 50, x1: 323 },
      { x0: 369, x1: 656 },
      { x0: 697, x1: 976 },
    ],
  },
  {
    y0: 367,
    y1: 487,
    columns: [
      { x0: 46, x1: 322 },
      { x0: 372, x1: 657 },
      { x0: 696, x1: 989 },
    ],
  },
  {
    y0: 553,
    y1: 701,
    columns: [
      { x0: 47, x1: 327 },
      { x0: 694, x1: 983 },
    ],
  },
] as const;
/** Chocolate grid (bottom section) — measured cells, x1 exclusive. */
const CHOCOLATE_ROW_BANDS: readonly SheetRowBand[] = [
  {
    y0: 895,
    y1: 1035,
    columns: [
      { x0: 44, x1: 330 },
      { x0: 368, x1: 656 },
      { x0: 695, x1: 999 },
    ],
  },
  {
    y0: 1106,
    y1: 1254,
    columns: [
      { x0: 47, x1: 341 },
      { x0: 341, x1: 666 },
      { x0: 694, x1: 1003 },
    ],
  },
  {
    y0: 1317,
    y1: 1455,
    columns: [
      { x0: 25, x1: 341 },
      { x0: 341, x1: 676 },
      { x0: 694, x1: 1005 },
    ],
  },
] as const;
const PLATFORM_SQUASH_SCALE_X = 1.2;
const PLATFORM_SQUASH_SCALE_Y = 0.7;
const PLATFORM_SQUASH_DURATION_MS = 150;
const PLATFORM_SQUASH_JUICE_LABEL = 'platform-squash-juice';
const BG_TESET_DIR_URL = `${GAME_ASSETS}/${encodeURIComponent('backgroud teset')}`;
/** Bottom death hazard — full `lava 2.png` scaled to viewport width (see {@link drawBottomDeathLine}). */
const DEATH_LINE_IMAGE_URL = `${BG_TESET_DIR_URL}/${encodeURIComponent('lava 2.png')}`;
const CANDY_BG_URL = `${BG_TESET_DIR_URL}/${encodeURIComponent('canndy.png')}?v=20260521`;
/** Full candy scene (sky + cliffs + foreground) — replaces teset 1/2/3 and altitude sky swaps. */
const CANDY_BG_CANDIDATES = [CANDY_BG_URL] as const;
const STATIC_BG_TESET3_CANDIDATES = CANDY_BG_CANDIDATES;
const STATIC_BG_TESET3_POST_REST_1K_CANDIDATES = CANDY_BG_CANDIDATES;
const STATIC_BG_TESET3_POST_REST_2K_CANDIDATES = CANDY_BG_CANDIDATES;
const STATIC_BG_TESET3_POST_REST_3K_CANDIDATES = CANDY_BG_CANDIDATES;
const STATIC_BG_TESET3_POST_REST_5K_CANDIDATES = CANDY_BG_CANDIDATES;
/** Letterbox fill behind tiles / Photoroom stack. */
const BG_Z_BACKDROP_FILL = -50;
/** Candy backdrop — `TilingSprite` + light parallax via {@link syncTeset3PhotoroomTileScroll}. */
const BG_Z_TESET3_STATIC = -30;
/** ~`setScrollFactor(0.1)` — `tilePosition` tracks camera at 10%. */
const TESET3_PHOTOROOM_SCROLL_FACTOR = 0.1;
/** Photoroom mid/foreground — Phaser depth −20; `backgroundRoot` + scrollFactor 0 (viewport/HUD–locked). */
const BG_Z_TESET2_SPRITE = -20;
/** Photoroom mid/foreground — Phaser depth −10. */
const BG_Z_TESET1_SPRITE = -10;
/** Only Photoroom stack + fill — skip altitude tier parallax (set `false` to restore `BACKGROUND_TIERS`). */
const STATIC_BACKGROUND_TESET3_PHOTOROOM_ONLY = true;
/** Static candy layers — `layer1/2` + `loop wall 2` + lightweight FX. */
const USE_CANDY_STATIC_ATMOSPHERE = true;
/** Legacy multi-layer parallax — disabled when static atmosphere is active. */
const USE_CANDY_CANYON_PARALLAX = false;
/** Orange strip at viewport bottom — vector fallback only (see {@link drawBottomDeathLine}). */
const DEATH_ORANGE_BAR_HEIGHT_PX = 18;
/** Full viewport-bottom hazard band height (matches legacy vector lava block). */
const DEATH_HAZARD_BAND_PX = 32;
/**
 * `lava 2.png` — compact strip at rest (teeth + gum); full content frame when rising/holding/descending.
 */
const DEATH_LAVA2_STRIP_FRAME = { x: 0, y: 392, width: 572, height: 188 } as const;
const DEATH_LAVA2_FULL_FRAME = { x: 0, y: 392, width: 572, height: 632 } as const;
/**
 * Invisible disqualify row in `lava 2.png` frame space (teeth → molten lava seam).
 * Mapped to world Y via {@link getLava2DisqualifyLineWorldY} — same rule as legacy death line (feet cross).
 */
/** Teeth → molten lava seam in strip/full frame space (row scan on `lava 2.png`). */
const DEATH_LAVA2_STRIP_DISQUALIFY_LOCAL_Y = 110;
const DEATH_LAVA2_FULL_DISQUALIFY_LOCAL_Y = 110;
/** Physics AABB sits above visible feet — extend for depth sort vs lava pool. */
const PLAYER_LAVA_DEPTH_FEET_PAD_PX = 52;
const PLAYER_LAVA_DEPTH_HEAD_PAD_PX = 24;
/** +Y nudge so lava/teeth art meets the viewport baseline without a hairline gap. */
const LINE_POWER_NUDGE_DOWN_PX = 60;
/** Lava strip rise/fall cycle (6500m): rest → rise → hold → descend. */
const DEATH_LAVA_LIFT_CYCLE_METERS = 6500;
/** Landed meters gate — crossing starts the timed rise (not climb speed). */
const DEATH_LAVA_LIFT_RISE_START_METERS = 3500;
/** Landed meters — hold at marked height until {@link DEATH_LAVA_LIFT_HOLD_END_METERS}. */
const DEATH_LAVA_LIFT_RISE_END_METERS = 4000;
const DEATH_LAVA_LIFT_HOLD_END_METERS = 6000;
/** Shorter than rise — fast elevator-style return to rest (6000 → this). */
const DEATH_LAVA_LIFT_DESCEND_END_METERS = 6250;
/** Teeth top cap at max lift — viewport fraction from camera top (red-line ref ~67%). */
const DEATH_LAVA_LIFT_TARGET_TEETH_TOP_RATIO = 0.67;
/**
 * Steady tap-fill duration after the 3500m gate — skills / air altitude never affect rise speed.
 * Player may pass 4000m before the fill completes.
 */
const DEATH_LAVA_LIFT_RISE_DURATION_SEC = 12;
/** Display smoothing on descent only (rise snaps to timer target). */
const DEATH_LAVA_LIFT_DESCEND_SMOOTH_RATE = 9.5;

/** Accel → cruise → decel — elevator-style ease for lava descent. */
function easeInOutElevator01(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
}
const PLAYER_WORLD_Z_INDEX = 40;
/** Below teeth (23) while sinking; molten pool (45) paints on top. */
const PLAYER_BEHIND_LAVA_Z_INDEX = 22;
const LAVA_TEETH_LAYER_Z_INDEX = 23;
const LAVA_LAYER_Z_INDEX = 25;
/** Stairs above death-zone art (25) but below the player (40) so they stay visible on disqualify. */
const PLATFORM_SPRITE_LAYER_Z_INDEX = 28;
/** Always above player (40) so molten pool covers the avatar on overlap. */
const LAVA_POOL_LAYER_Z_INDEX = 45;
/** Gameplay BGM — `public/assets/game music/Gummy Moon Arcade.mp3`. */
const GAME_MUSIC_DIR_URL = `${GAME_ASSETS}/${encodeURIComponent('game music')}`;
const GAME_MUSIC_BGM_FILENAMES = ['Gummy Moon Arcade.mp3'] as const;
const GAME_MUSIC_BGM_TRACKS: readonly string[] = GAME_MUSIC_BGM_FILENAMES.map(
  (name) => `${GAME_MUSIC_DIR_URL}/${encodeURIComponent(name)}`,
);
const BGM_FALLBACK_URL = `${GAME_MUSIC_DIR_URL}/${encodeURIComponent('Gummy Moon Arcade.mp3')}`;
/** Lava-rise tension loop — `public/assets/sound effect/stress mode.m4a` (3500→6000 landed m). */
const STRESS_MODE_BGM_URL = `${GAME_ASSETS}/${encodeURIComponent('sound effect')}/${encodeURIComponent('stress mode.m4a')}`;
const ENABLE_STRESS_MODE_BGM = false;
const ENABLE_WALL_SLIDE_LOOP_SFX = false;
const REST_FLOOR_HOUSE_CANDIDATES = [
  `${GAME_ASSETS}/house/isohome.png.png`,
  `${GAME_ASSETS}/house/${encodeURIComponent('House 1.png')}`,
] as const;
const REST_FLOOR_CLOUD_URL = `${GAME_ASSETS}/objects/Cloud.png`;
const REST_FLOOR_SUPPLIES_URL = `${GAME_ASSETS}/objects/supplies_objects.png`;
/** Wide rest/spawn deck art — top strip marshmallow [0, 5000) m, bottom strip chocolate [5000, 10000) m. */
const REST_PLATFORM_SHEET_URL = `${GAME_ASSETS}/${encodeURIComponent('backgroud teset')}/${encodeURIComponent('rest platform.png')}`;
/** Texture-space Y split between marshmallow (top) and chocolate (bottom) in {@link REST_PLATFORM_SHEET_URL}. */
const REST_PLATFORM_SHEET_SPLIT_Y = 512;
/** Left/right cap width in texture px — keeps swirl/star art crisp; center tiles at uniform scale. */
const REST_PLATFORM_END_CAP_TEX_PX = 260;

type RestPlatformStripSlices = {
  full: Texture;
  leftCap: Texture;
  center: Texture;
  rightCap: Texture;
};

const SFX_LOCAL: Record<SfxId, string> = {
  tongue_shoot: `${import.meta.env.BASE_URL}audio/tongue_shoot.mp3`,
  tongue_hit: `${import.meta.env.BASE_URL}audio/tongue_hit.mp3`,
  collect_coin: `${import.meta.env.BASE_URL}audio/collect_coin.mp3`,
  collect_diamond: `${GAME_ASSETS}/${encodeURIComponent('sound effect')}/diamond_collect.mp3`,
  player_land: `${import.meta.env.BASE_URL}audio/player_land.mp3`,
  super_jump_woohoo: `${GAME_ASSETS}/${encodeURIComponent('sound effect')}/woohoohoo.mp3`,
  /** לולאת גלידה — `public/assets/sound effect/slide 2.m4a` */
  wall_slide: `${GAME_ASSETS}/${encodeURIComponent('sound effect')}/${encodeURIComponent('slide 2.m4a')}`,
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

/** Player melee attack — virtual button (bottom-right) + KeyF, plays the attack row of the character spritesheet. */
/** When false, hides the on-screen attack circle; `KeyF` still triggers {@link PlayScene.playerAttack} via `InputManager`. */
const ATTACK_VIRTUAL_BUTTON_VISIBLE = false;
const ATTACK_BTN_RADIUS_PX = 44;
const ATTACK_BTN_MARGIN_PX = 24;
const ATTACK_BTN_FILL_COLOR = 0xff4d1a;
const ATTACK_BTN_STROKE_COLOR = 0xffd64a;
/** Forward reach of the attack hitbox (px in world coords) from the player center. */
const PLAYER_ATTACK_REACH_PX = 110;
/** Vertical generosity applied to the attack hitbox (tops/bottoms) — slightly forgiving. */
const PLAYER_ATTACK_VERT_PAD_PX = 16;

/** Rope “bead” bridge look for low altitude (HUD meters). Physics stays the same AABB. */
const BEAD_BRIDGE_MAX_METERS = 1000;

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
  constructor(private readonly isSlidePhaseActive: () => boolean) {}

  private readonly prototypes = new Map<SfxId, HTMLAudioElement>();
  private master = 0.42;
  /** Dedicated loop clip — analogous to Phaser `sound.add('slide', { loop: true, volume: 0.5 })`. */
  private wallSlideLoop: HTMLAudioElement | null = null;
  /** Boost vs one-shots × {@link master} — capped inside {@link refreshWallSlideLoopVolume}. */
  private static readonly WALL_SLIDE_LOOP_LOUDNESS = 2.45;

  async load(): Promise<void> {
    await Promise.all(
      (Object.keys(SFX_REMOTE) as SfxId[])
        .filter((id) => ENABLE_WALL_SLIDE_LOOP_SFX || id !== 'wall_slide')
        .map((id) => this.loadOne(id)),
    );
    if (ENABLE_WALL_SLIDE_LOOP_SFX) {
      this.initWallSlideLoopFromPrototype();
    }
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

  private initWallSlideLoopFromPrototype(): void {
    const proto = this.prototypes.get('wall_slide');
    const src = proto?.currentSrc || proto?.src;
    if (!src || this.wallSlideLoop != null) {
      return;
    }
    const a = new Audio(src);
    a.preload = 'auto';
    a.loop = true;
    this.refreshWallSlideLoopVolume(a);
    this.wallSlideLoop = a;
  }

  private refreshWallSlideLoopVolume(a: HTMLAudioElement): void {
    const m = Math.max(this.master, 0.34);
    a.volume = Math.min(
      1,
      PlaySceneSfx.WALL_SLIDE_LOOP_LOUDNESS * m,
    );
  }

  /**
   * Call every frame while sliding — retries `play()` after autoplay blocks and keeps volume current.
   */
  ensureWallSlideLoopPlaying(): void {
    if (!ENABLE_WALL_SLIDE_LOOP_SFX || !this.isSlidePhaseActive()) {
      return;
    }
    if (this.wallSlideLoop == null) {
      this.initWallSlideLoopFromPrototype();
    }
    if (this.wallSlideLoop == null) {
      return;
    }
    this.refreshWallSlideLoopVolume(this.wallSlideLoop);
    if (this.wallSlideLoop.paused) {
      void this.wallSlideLoop.play().catch(() => {
        /* autoplay / decode */
      });
    }
  }

  /** @deprecated Prefer {@link ensureWallSlideLoopPlaying} each tick while streaming. */
  beginWallSlideLoop(): void {
    this.ensureWallSlideLoopPlaying();
  }

  /** Hard stop — cutoff / detach / pause / teardown. */
  endWallSlideLoop(): void {
    if (!this.wallSlideLoop) {
      return;
    }
    this.wallSlideLoop.pause();
    this.wallSlideLoop.currentTime = 0;
  }

  dispose(): void {
    this.endWallSlideLoop();
    if (this.wallSlideLoop) {
      this.wallSlideLoop.removeAttribute('src');
      this.wallSlideLoop.load();
      this.wallSlideLoop = null;
    }
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
const PLATFORM_SCALE = PLAY_SCENE.stairPlatformScale;
const PLATFORM_EDGE_PADDING_PX = 8;
const CAMERA_ZOOM = 0.5;
const MOBILE_CAMERA_ZOOM = 0.42;
const CAMERA_PLAYER_SCREEN_Y_RATIO = 0.62;
/** Menu handoff: in-game fall duration — synced with white overlay {@link MENU_PLAY_TRANSITION.fadeOutSec}. */
const MENU_SKY_DROP_INTRO_SEC = MENU_PLAY_TRANSITION.fadeOutSec;
const MENU_SKY_DROP_FALL_VIEWPORT_RATIO = 0.82;
const AUTO_SCROLL_BASE_SPEED_PX = 120;
/** HUD climb (m): flat ×1 SPD below this, then linear ramp to {@link SCROLL_SPEED_MAX_MULT}. */
const SCROLL_SPEED_WARMUP_METERS = 300;
/** Linear SPD ramp ends here — reaches ×{@link SCROLL_SPEED_MAX_MULT} at 10k m. */
const SCROLL_SPEED_RAMP_END_METERS = 10000;
const SCROLL_SPEED_MAX_MULT = 2.5;
/** UI tier feedback — one tier per this multiplier step above ×1. */
const SCROLL_SPEED_STEP_DELTA = 0.15;
/** Continuous altitude shake disabled; it became visible jitter around the 3000m+ tiers. */
const ALTITUDE_STRESS_SHAKE_MULT_THRESHOLD = Number.POSITIVE_INFINITY;
const SPEED_TIER_SHAKE_SEC = 0;
const SPEED_TIER_UI_FLASH_SEC = 0.22;
/** Cool lavender pulse — avoids harsh fullscreen white flash (read as glitch on some GPUs). */
const SPEED_TIER_PULSE_COLOR = 0xb8a0ff;
const SPEED_TIER_PULSE_FILL_ALPHA = 0.11;
const PAUSE_RESUME_BTN_MIN_H = 64;
/** Pause coin — full-res PNG on disk; crop + scale in Pixi only. */
const PAUSE_BTN_TEXTURE_URL = `${GAME_ASSETS}/objects/${encodeURIComponent('pause.png')}`;
const MUSIC_BTN_SHEET_URL = `${GAME_ASSETS}/objects/${encodeURIComponent('music buttons.png')}`;
/** Gap between stacked pause + music HUD icons (screen px). */
const HEADER_HUD_BTN_GAP_PX = 4;
/** On-screen pause button size (tuned for former `buttons 2.png` HUD slot). */
const HEADER_PAUSE_BTN_DISPLAY_SIZE_PX_MOBILE = 80;
const HEADER_PAUSE_BTN_DISPLAY_SIZE_PX_DESKTOP = 88;
/** 30% smaller baseline, then −15%, then −10% on screen. */
const HEADER_PAUSE_BTN_DISPLAY_SCALE = 0.7 * 0.85 * 0.85 * 0.9;
/** Top-right inset — lower X nudges the pause button right. */
const HEADER_PAUSE_BTN_SCREEN_MARGIN_X = 10;
const HEADER_PAUSE_BTN_SCREEN_Y = 12;
const HEADER_PAUSE_BTN_Z_INDEX = 1000;
const HEADER_PAUSE_BTN_Z_INDEX_PAUSED = 1275;
const HEADER_PAUSE_BTN_HOVER_SCALE = 1.04;
const HEADER_PAUSE_BTN_PRESS_SCALE = 1.08;
const HEADER_PAUSE_BTN_GLOW_PULSE_SEC = 2.2;
/** Min alpha for pause tap — ignores transparent padding around the coin art. */
const HEADER_PAUSE_BTN_HIT_ALPHA_THRESHOLD = 48;
/** Premium floating chip styling (Candy Crush–style, no neon frame). */
const FLOATING_HUD_CHIP_FILL = 0x1a0a2e;
const FLOATING_HUD_CHIP_ALPHA = 0.5;
const FLOATING_HUD_CHIP_STROKE = 0xffffff;
const FLOATING_HUD_CHIP_STROKE_ALPHA = 0.16;
const FLOATING_HUD_SHADOW_ALPHA = 0.22;
/** Right sidebar hamburger menu (stats / bag / leaderboard). Disabled for now. */
const STATUS_PANEL_ENABLED = false;
/** Right sidebar status panel: toggle sits on the far right; expanded body grows left (below header strip). */
const STATUS_PANEL_RIGHT_MARGIN_PX = 12;
const STATUS_PANEL_TOGGLE_W_PX = 40;
const STATUS_PANEL_TOGGLE_H_PX = 34;
const STATUS_PANEL_BODY_W_PX = 220;
const STATUS_PANEL_BODY_PAD_PX = 10;
const STATUS_PANEL_BODY_TOP_PAD_PX = 8;
const STATUS_PANEL_TOGGLE_GAP_PX = 6;
const STATUS_PANEL_ROUND_PX = 12;
const STATUS_PANEL_LOGOUT_BTN_H_PX = 38;
const STATUS_PANEL_STATS_LOGOUT_GAP_PX = 10;
/** Tab row below the PAUSED-style panel top padding. */
const STATUS_PANEL_TAB_BAR_H_PX = 30;
const STATUS_PANEL_TAB_GAP_PX = 6;
/** Gap between tab row and shared stats / leaderboard content region. */
const STATUS_PANEL_TAB_INNER_GAP_PX = 4;
/** Shared slot: MY STATS block and global leaderboard viewport occupy the same vertical space. */
const STATUS_PANEL_CONTENT_AREA_H_PX = 138;
const STATUS_PANEL_LB_VIEWPORT_H_PX = 138;
const STATUS_PANEL_CONTENT_TO_SEP_GAP_PX = 8;
const STATUS_PANEL_LB_ROW_LINE_PX = 16;
const STATUS_PANEL_BAG_SLOT_COUNT = 24;
const STATUS_PANEL_BAG_COLS = 6;
const STATUS_PANEL_BAG_SLOT_PX = 27;
const STATUS_PANEL_BAG_SLOT_GAP_PX = 4;

function getStatusPanelExpandedBodyHeightPx(): number {
  const pad = STATUS_PANEL_BODY_PAD_PX;
  const top = STATUS_PANEL_BODY_TOP_PAD_PX;
  const innerAboveLogout =
    top +
    STATUS_PANEL_TAB_BAR_H_PX +
    STATUS_PANEL_TAB_INNER_GAP_PX +
    STATUS_PANEL_CONTENT_AREA_H_PX +
    STATUS_PANEL_CONTENT_TO_SEP_GAP_PX +
    STATUS_PANEL_STATS_LOGOUT_GAP_PX +
    STATUS_PANEL_LOGOUT_BTN_H_PX;
  return innerAboveLogout + pad;
}
const UI_BG_BLACK = 0x000000;
const UI_PANEL_PURPLE = 0x2e004b;
const UI_NEON_GREEN = 0x39ff14;
const UI_GOLD = 0xffd700;
const UI_HEADER_H = 92;
const UI_SAFE_PAD_TOP = 10;
const UI_SAFE_PAD_BOTTOM = 12;
const UI_HEADER_INFO_ROW_Y = UI_SAFE_PAD_TOP + 40;
/** Shared top HUD row — aligned with pause button (top-right). */
const TIMER_CLIMB_HUD_ROW_Y = HEADER_PAUSE_BTN_SCREEN_Y;
const TIMER_HUD_FILL = '#fff6cc';
const TIMER_HUD_STROKE = '#4a3200';
const TIMER_HUD_STROKE_WIDTH = 2.4;
const TIMER_HUD_SHIFT_LEFT_PX = 24;
const TIMER_HUD_SHIFT_UP_PX = 6;
const TIMER_CLIMB_HUD_GAP_PX = 8;
/** Left reserve for collectibles; combo + meters cluster starts here. */
const TIMER_HUD_LEFT_RESERVE_PX = 108;
const CLIMB_HUD_SHIFT_LEFT_PX = 14;
/** Floating row for pause + menu toggle (no header bar frame). */
const FLOATING_HUD_SECOND_ROW_Y = UI_SAFE_PAD_TOP + 56;
const OVERLAY_BG_ALPHA = 0.72;
const WORLD_BOUNDS_X = 0;
/** Room for >= 100000 HUD meters (/12 px per m) relative to baseline without leaving the playable band while rebasing catches up. */
const WORLD_BOUNDS_Y = -2_500_000;
const WORLD_BOUNDS_W = 1400;
const WORLD_BOUNDS_H = 2_501_000;
/** Remove disposable world objects this far below the bottom of the camera view (see {@link PlayScene.cullDisposableWorldFarBelowViewport}). */
const VIEWPORT_BOTTOM_CULL_EXTRA_PX = 500;
/**
 * Periodic floating-origin shift: applied while `player.body.y` dips below {@link WORLD_REBASE_LOW_WATER_Y}.
 * Uses a multiple of 12 px so HUD integer meters stay stable across rebases when derived from deltas.
 */
const WORLD_REBASE_SHIFT_PX = 360_000;
const WORLD_REBASE_LOW_WATER_Y = -340_000;
/** Cap transient VFX allocations after each 1000m milestone sweep ({@link maybeRunPeriodicPoolMaintenance}). */
const MAX_LEVEL_UP_PARTICLES_AFTER_CLEANUP = 48;
const MAX_COMBO_SUPER_JUMP_PARTICLES_AFTER_CLEANUP = 40;
/** Screen-space inset (px) from each visible side — platform spawn, HUD band, and {@link clampPlayerToCameraViewport}. */
const VIEWPORT_SAFE_MARGIN_SCREEN_PX = 40;
/** When true, stairs spawn in a band around the player (world X) so they stay on-screen on mobile. */
const MOBILE_NARROW_UI_MAX_W = 520;
const REST_FLOOR_INTERVAL_METERS = 1000;
const REST_FLOOR_MONSTER_CLEAR_METERS = 100;
const REST_FLOOR_RESUME_ABOVE_PX = 50;
const REST_FLOOR_TILE_PX = 64;
/**
 * Fascia spanning screen edges — ~1¼× אריח הרסט (עצמות בצדי המסך וכו').
 * Same geometry drives {@link drawWorldEdgeRestWalls}, {@link clampPlayerToCameraViewport}, and fascia assist in {@link Physics}.
 */
const WORLD_EDGE_REST_WALL_PX = Math.round(REST_FLOOR_TILE_PX * 1.25);
/** Vertical cushion (world px) added above/below the viewport when fascia strips are tiled/drawn. */
const WORLD_EDGE_FASCIA_STRIP_VERTICAL_PAD_PX = 4200;
/**
 * Shift both fascia slab **left edges** toward playfield center (world px). Left strip moves +X, right strip −X;
 * clamps/physics/overlap follow {@link getViewportEdgeWallSlabsWorld}.
 */
const VIEWPORT_FASCIA_INWARD_NUDGE_WORLD_PX = 24;
/** Fascia cladding — `bone 1` / `bone 2` (rest) and `chain 1` / `chain 2` (slide) ב־`public/assets/objects/`. */
const WORLD_EDGE_WALL_BONE_LEFT_URL = `${GAME_ASSETS}/objects/${encodeURIComponent('bone 1.png')}`;
const WORLD_EDGE_WALL_BONE_RIGHT_URL = `${GAME_ASSETS}/objects/${encodeURIComponent('bone 2.png')}`;
const WORLD_EDGE_WALL_CHAIN_LEFT_URL = `${GAME_ASSETS}/objects/${encodeURIComponent('chain 1.png')}`;
const WORLD_EDGE_WALL_CHAIN_RIGHT_URL = `${GAME_ASSETS}/objects/${encodeURIComponent('chain 2.png')}`;
/** כפל קנה‑אחיד לטקסטורת העצם (שלב rest) — רוחב הפס = קוליזיה, רק הטקסטורה גדלה. */
const WORLD_EDGE_BONE_TILE_SCALE_MUL = 1.4;
/** כפל קנה‑אחיד לטקסטורת השרשרת בלבד (שלב slide). */
const WORLD_EDGE_CHAIN_TILE_SCALE_MUL = 1.32;
/** מחזור מרחק HUD — slide פעיל ב־4000–6000 מ׳ בתוך כל מחזור. */
const SLIDE_PHASE_CYCLE_METERS = 6000;
const SLIDE_PHASE_START_METERS = 4000;
const SLIDE_PHASE_END_METERS = 6000;
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
/** When false, skip `supplies_objects.png` props (weapon racks) on the 1000m rest floor. */
const REST_FLOOR_SUPPLIES_ENABLED = false;
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
const LEVEL_SCORE_STEP = 2800;
/**
 * Live total score: `(max climb m × {@link SCORE_METERS_MULTIPLIER}) + (combo × {@link SCORE_COMBO_MULTIPLIER})`.
 * Height step weight is double the combo step (10 vs 5). Re-derived every frame so points track altitude smoothly.
 */
const SCORE_METERS_MULTIPLIER = 10;
const SCORE_COMBO_MULTIPLIER = 5;
const LEVEL_PLATFORM_SPEED_BASE = 24;
const LEVEL_PLATFORM_SPEED_PER_LEVEL = 5;
const LEVEL_MILESTONE_STEP = 10;
/** Structural fall shields: fixed stock per run, never above this cap; not granted by gold/diamond/items. */
const MAX_FALL_SHIELDS = 3;
/** On fall-save, place the player exactly this many platform gaps above the last recorded platform. */
const SHIELD_BOUNCE_PLATFORM_RISE_COUNT = 8;
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
 *   - Viewport fascia wall-slide elevator: while a chain is active, combo steps tick at a fixed cadence
 *     ({@link FACIA_WALL_SLIDE_COMBO_STEP_INTERVAL_SEC}, same slide predicate as friction SFX in {@link shouldEmitWallSlideFasciaFrictionStream}).
 */
const COMBO_CHAIN_WINDOW_SEC = 5;
const COMBO_MIN_CLIMB_PX = 6;
/** Horizontal push away from the fascia when consuming a buffered jump mid–wall-slide (world vx, px/s scale). */
const FACIA_WALL_SLIDE_BUFFER_JUMP_KICK_VX = 320;
/** Seconds between fascia slide combo steps while on the elevator (steady pace vs raw climb speed). */
const FACIA_WALL_SLIDE_COMBO_STEP_INTERVAL_SEC = 0.48;
/** Manual SUPER JUMP only (`SUPER_JUMP_VY_SCALE`× upward vs normal jump formula). */
const SUPER_JUMP_VY_SCALE = 2;
const SUPER_JUMP_SPARK_COUNT = 14;
/** After `PULL UP`, window to tap `SUPER JUMP` for extra score bonus (combo uses normal jump rules). */
const SKILL_CHAIN_WINDOW_SEC = 5.35;
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
/** Uniform scale for combo badge only (`uiLayer`, screen-fixed — equivalent to scrollFactor 0). */
const COMBO_HUD_ROOT_SCALE = 0.33;
/** Skill pair (`SUPER JUMP` + `PULL UP`): screen-fixed on `uiLayer`. */
/** Native crop width per button in `skill-buttons.png` (482×250 px each half). */
const SKILL_BTN_NATIVE_CROP_W = 482;
const SKILL_BTN_DISPLAY_W_MIN = 120;
const SKILL_BTN_DISPLAY_W_MAX_MOBILE = 196;
const SKILL_BTN_DISPLAY_W_MAX_DESKTOP = 236;
/** Horizontal gap between side-by-side skill buttons (local px, before root scale). */
const SKILL_PAIR_BTN_GAP_PX = 10;
/** Pull Up only — nudge left toward Super Jump (local px). */
const SKILL_PULL_UP_NUDGE_LEFT_PX = 14;
/** Gap below meters/speed row (screen px, before `skillPairRoot` scale). */
const SKILL_PAIR_BELOW_CLIMB_GAP_PX = 6;
/** Nudge skill pair left under the meters/speed HUD (screen px). */
const SKILL_PAIR_SHIFT_LEFT_PX = 28;
/** Uniform scale on `skillPairRoot` — keep at 1 to preserve PNG sharpness. */
const PULL_UP_BTN_SCALE = 1;
/** Legacy vector fallback when the PNG sheet fails to load. */
const SKILL_FALLBACK_BTN_W = 152;
const SKILL_FALLBACK_BTN_H = 44;
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
/** Wall-slide sparks — ADD sprites ({@link PlayScene.wallSparkParticleRoot}); ~{@link WALL_SPARK_SPAWN_PER_SEC}/s during elevator slide. */
const WALL_SPARK_MAX_PARTICLES = 720;
/** Continuous stream while elevator spark overlap is physically active (~400/sec). */
const WALL_SPARK_SPAWN_PER_SEC = 400;
/** Latch-touch ignite debt — Phaser-style `particleEmitter.start()` same frame ignition. */
const WALL_SPARK_LATCH_TOUCH_DEBT = 40;
const WALL_SPARK_GRAVITY_Y = 500;
const WALL_SPARK_SCALE_START = 3.25;
const WALL_SPARK_SCALE_END = 0.18;
/** Gold-yellow + bright orange only. */
const WALL_SPARK_TINT_PALETTE = [0xffcc00, 0xff6600] as const;
/** Smoke disabled — keep trail clean (see {@link PlayScene.drawWallSlideSmokeParticles}). */
const WALL_SLIDE_SMOKE_MAX_PARTICLES = 42;
const WALL_SLIDE_SMOKE_SPAWN_PER_SEC = 0;

/**
 * 7×7 with solid 3×3 white core (`heavy-spark`) — visible under ADD + above player at fascia seam.
 */
function createWallSparkSharpDotTexture(): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 7;
  canvas.height = 7;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('heavy-spark: CanvasRenderingContext2D unavailable');
  }
  ctx.clearRect(0, 0, 7, 7);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(2, 2, 3, 3);
  return Texture.from(canvas);
}
type WindParticle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  len: number;
};

type WallSparkFxParticle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  /** One of {@link WALL_SPARK_TINT_PALETTE} applied via {@link Sprite.tint}. */
  tint: number;
  sprite: Sprite;
};

type WallSlideSmokeFxParticle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  radius: number;
  color: number;
};

export type PlaySceneOptions = {
  menuHandoff?: boolean;
  onBackToMenu?: () => void | Promise<void>;
};

export class PlayScene implements Scene {
  readonly name = 'play';

  private fromMenuHandoff = false;
  private readonly onBackToMenu?: () => void | Promise<void>;
  private menuSkyDropIntroActive = false;
  private menuSkyDropIntroElapsedSec = 0;
  private menuSkyDropIntroStartY = 0;
  private menuSkyDropIntroTargetY = 0;
  private gameplayUnlocked = true;
  private gameplayActive = false;
  private app?: Application;
  private input?: InputManager;
  private physics = new Physics();
  private platformSystem: PlatformSystem;
  /**
   * Viewport fascia has no Phaser Arcade collider — overlap is custom AABB in {@link Physics}.
   * This mirrors `collider.active`: when `false`, fascia assist is not passed to physics (breaks slide re-latch).
   */
  readonly wallCollider: { active: boolean } = { active: true };
  private wallColliderRestoreTimeout: ReturnType<typeof setTimeout> | null = null;
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
  /** Photoroom sky (teset 3) — `TilingSprite` at −30; parallax via `tilePosition`. */
  private bgStaticTeset3Tile: TilingSprite | null = null;
  private bgStaticTeset3BaseTexture?: Texture;
  /** Preloaded `sky.png` — החלפה מ־1000 מ׳ (ראה {@link STATIC_BG_TESET3_POST_REST_1K_CANDIDATES}). */
  private background1kTexture?: Texture;
  /** Preloaded `sky 3.png` — החלפה מ־2000 מ׳ (ראה {@link STATIC_BG_TESET3_POST_REST_2K_CANDIDATES}). */
  private background2kSkyTexture?: Texture;
  /** Preloaded `sky 4.png` — החלפה מ־3000 מ׳ (ראה {@link STATIC_BG_TESET3_POST_REST_3K_CANDIDATES}). */
  private background3kSkyTexture?: Texture;
  /** Preloaded `sky 5.png` — החלפה מ־5000 מ׳ (ראה {@link STATIC_BG_TESET3_POST_REST_5K_CANDIDATES}). */
  private background5kSkyTexture?: Texture;
  /** Milestone: החלפה ל־`sky.png` פעם אחת אחרי 1000 מ׳. */
  private bgChangedAt1k = false;
  /** Milestone: החלפה ל־`sky 3.png` פעם אחת אחרי 2000 מ׳. */
  private bgChangedAt2k = false;
  /** Milestone: החלפה ל־`sky 4.png` פעם אחת אחרי 3000 מ׳. */
  private bgChangedAt3k = false;
  /** Milestone: החלפה ל־`sky 5.png` פעם אחת אחרי 5000 מ׳. */
  private bgChangedAt5k = false;
  /**
   * teset 2/1: viewport-locked on `backgroundRoot` (`setScrollFactor(0)`). Positions finalized in
   * {@link syncPhotoroomTeset12ScreenAnchoredOscillation} so {@link layoutBackground} does not reset Y each frame.
   */
  private bgStaticTeset2Sprite: Sprite | null = null;
  private bgStaticTeset1Sprite: Sprite | null = null;
  private bgOverlayLayers: { tile: TilingSprite; speed: number }[] = [];
  private atmosphereManager: CandyAtmosphereManager | null = null;
  private loadedBackgroundTiers = new Map<BackgroundTierId, LoadedBackgroundTier>();
  private activeBackgroundTierId?: BackgroundTierId;
  private activeOverlayBackgroundTierId?: BackgroundTierId;
  private jelly = new Graphics();
  private fxLayer = new Graphics();
  /** Viewport fascia — `bone 1`/`bone 2` (rest), `chain 1`/`chain 2` (slide 4000–6000m). */
  private viewportFasciaBoneLayer = new Container();
  private viewportFasciaBoneTexLeft?: Texture;
  private viewportFasciaBoneTexRight?: Texture;
  private viewportFasciaChainTexLeft?: Texture;
  private viewportFasciaChainTexRight?: Texture;
  private viewportFasciaBoneTileLeft: TilingSprite | null = null;
  private viewportFasciaBoneTileRight: TilingSprite | null = null;
  /**
   * When {@link isSlidePhase} is false (0–4000m and 6000m+ in each cycle): bone fascia uses this world-Y
   * anchor for tiling so vertical banding stays fixed while the camera scrolls.
   */
  private fasciaRestWallStripePhaseAnchorWorldYTop = 0;
  /** Wall-slide friction smoke — normal blend, sits under additive sparks. */
  private wallSparkSmokeGfx = new Graphics();
  /**
   * Wall-slide sparks — pooled {@link Sprite}s using programmatic **`heavy-spark`** texture (3×3 white).
   */
  private wallSparkParticleRoot = new Container();
  private wallSparkHeavySparkTex: Texture | null = null;
  private wallSparkSpritePool: Sprite[] = [];
  private platformSpriteLayer = new Container();
  private platformLayer = new Graphics();
  private restFloorPropLayer = new Container();
  private rippleLayer = new Graphics();
  private collectiblesGfx = new Graphics();
  /** Bottom hazard strip (vector lava fallback; crystal/ice asset removed). */
  private lavaLayer = new Container();
  private lavaTeethLayer = new Container();
  private lavaPoolLayer = new Container();
  private deathZoneFallback = new Graphics();
  /** Preloaded death-line art ({@link DEATH_LINE_IMAGE_URL}); vector lava if missing. */
  private deathHazardTextureStrip?: Texture;
  private deathHazardTextureFull?: Texture;
  private deathHazardTeethTextureStrip?: Texture;
  private deathHazardPoolTextureStrip?: Texture;
  private deathHazardTeethTextureFull?: Texture;
  private deathHazardPoolTextureFull?: Texture;
  /** Strip/full seam row in art pixels — {@link getLava2DisqualifyLineWorldY}. */
  private deathLava2StripDisqualifyLocalY = DEATH_LAVA2_STRIP_DISQUALIFY_LOCAL_Y;
  private deathLava2FullDisqualifyLocalY = DEATH_LAVA2_FULL_DISQUALIFY_LOCAL_Y;
  private deathHazardTeethSprite: Sprite | null = null;
  private deathHazardPoolSprite: Sprite | null = null;
  private get linePower(): Sprite | null {
    return this.deathHazardPoolSprite;
  }
  /** World-space line-power strip anchor Y when bob offset is zero (see {@link drawBottomDeathLine}). */
  private linePowerBaseY = 0;
  private gameShake = new Container();
  /** HUD + touch: never parented under `world` / `gameShake` so it isn’t redrawn with the camera. */
  private uiLayer = new Container();
  private headerPauseRoot = new Container();
  private headerPauseBtn = new Sprite();
  private headerPauseBtnTexture: Texture | null = null;
  private headerPauseBtnBaseScale = 1;
  private headerPauseBtnDisplayW = HEADER_PAUSE_BTN_DISPLAY_SIZE_PX_MOBILE;
  private headerPauseBtnDisplayH = HEADER_PAUSE_BTN_DISPLAY_SIZE_PX_MOBILE;
  private headerPauseBtnPressed = false;
  private headerPauseBtnHovered = false;
  private headerPauseGlowTimeSec = 0;
  private headerPauseBtnHitAlpha: Uint8Array | null = null;
  private headerPauseBtnHitW = 0;
  private headerPauseBtnHitH = 0;
  private readonly headerPauseBtnAlphaHitArea = {
    contains: (x: number, y: number) => this.testHeaderPauseBtnAlphaHit(x, y),
  };
  private headerMusicBtn = new Sprite();
  private headerMusicBtnTexture: Texture | null = null;
  private headerMusicBtnBaseScale = 1;
  private headerMusicBtnPressed = false;
  private headerMusicBtnHovered = false;
  private headerMusicBtnHitAlpha: Uint8Array | null = null;
  private headerMusicBtnHitW = 0;
  private headerMusicBtnHitH = 0;
  private readonly headerMusicBtnAlphaHitArea = {
    contains: (x: number, y: number) => this.testHeaderMusicBtnAlphaHit(x, y),
  };
  private bgmMuted = false;
  /** Bottom-right virtual ATTACK button — taps call `playerAttack()`. */
  private attackBtnRoot = new Container();
  private attackBtn = new Graphics();
  private attackBtnIcon = new Graphics();
  private paused = false;
  private pauseOverlay = new Container();
  private pauseBackdrop = new Graphics();
  private pausePanel = new Graphics();
  private pauseTitle?: Text;
  private pauseResumeBtn = new Graphics();
  private pauseResumeLabel?: Text;
  private pauseMenuBtn = new Graphics();
  private pauseMenuLabel?: Text;
  private pauseLogoutBtn = new Graphics();
  private pauseLogoutLabel?: Text;
  private pauseTouchLockLabel?: Text;
  /** Collapsible right sidebar: tabs (MY STATS / GLOBAL TOP 5), session stats, RTDB top list, LOG OUT. */
  private statusPanelRoot = new Container();
  private statusPanelExpanded = false;
  private statusPanelBodyGfx = new Graphics();
  private statusPanelToggleGfx = new Graphics();
  private statusPanelToggleHit = new Graphics();
  /** Right sidebar: `MY STATS` vs `YOUR BAG` vs `GLOBAL TOP 5` (mutually exclusive body content). */
  private statusPanelSidebarTab: 'stats' | 'bag' | 'global' = 'stats';
  private statusPanelTabStatsBtn = new Graphics();
  private statusPanelTabBagBtn = new Graphics();
  private statusPanelTabGlobalBtn = new Graphics();
  private statusPanelTabStatsLabel?: Text;
  private statusPanelTabBagLabel?: Text;
  private statusPanelTabGlobalLabel?: Text;
  private statusPanelMyStatsMainText?: Text;
  private statusPanelMyStatsPtsText?: Text;
  /** Gold chip behind MY STATS total points — sized to label each refresh so text stays centered. */
  private statusPanelPtsPillGfx = new Graphics();
  private statusPanelBagRoot = new Container();
  private statusPanelBagSlots: Graphics[] = [];
  private statusPanelBagItems = new Container();
  private statusPanelBagDragGhost = new Container();
  private statusPanelBagDragState: BagDragState | null = null;
  private statusPanelBagSlotItems: Array<BagSlotItem | null> = Array.from(
    { length: STATUS_PANEL_BAG_SLOT_COUNT },
    () => null,
  );
  private statusPanelSepGfx = new Graphics();
  private statusPanelLogoutBtn = new Graphics();
  private statusPanelLogoutLabel?: Text;
  private logoutConfirmOverlay = new Container();
  private logoutConfirmBackdrop = new Graphics();
  private logoutConfirmPanel = new Graphics();
  private logoutConfirmTitle?: Text;
  private logoutConfirmSubtitle?: Text;
  private logoutConfirmCancelBtn = new Graphics();
  private logoutConfirmCancelLabel?: Text;
  private logoutConfirmOkBtn = new Graphics();
  private logoutConfirmOkLabel?: Text;
  /** In-sidebar global top — fetch when the Global tab is selected. */
  private statusPanelLbViewport = new Container();
  private statusPanelLbMask = new Graphics();
  private statusPanelLbScroll = new Container();
  private statusPanelLbRowBg: Graphics[] = [];
  private statusPanelLbRows: Text[] = [];
  private statusPanelLbLoading?: Text;
  private statusPanelLbEmpty?: Text;
  private sidebarLbScrollPx = 0;
  private sidebarLbViewportW = 0;
  private sidebarLbContentH = 0;
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
  private wallSparkParticles: WallSparkFxParticle[] = [];
  /** Fractional spawn budget during active fascia elevator sparks (see {@link WALL_SPARK_SPAWN_PER_SEC}). */
  private wallSparkSlideSpawnAccumulator = 0;
  /**
   * Latch-touch debt queued by analogue {@link PlayScene.sparkEmitterAnalogueWallSlideStart} —
   * consumed instantly same tick inside {@link updateWallSparkParticles}.
   */
  private wallSparkSlideLatchIgniteDebt = 0;
  /** Prior tick: fascia elevator sparks were emitting (detach / hard-stop → analogue `emitter.stop()` for particles). */
  private wallSparkSlideElevatorPhysActiveMemo = false;
  /** Prior tick: looping wall-slide SFX was active (falling edge → {@link PlaySceneSfx.endWallSlideLoop}). */
  private wallSlideFasciaSfxStreamingMemo = false;
  private wallSlideSmokeParticles: WallSlideSmokeFxParticle[] = [];
  private climbHudText?: Text;
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
  private leaderboardEmptyHint?: Text;
  private finalMetersAtDeath = 0;
  /** Peak HUD climb (m) this run — for leaderboard max height. */
  private peakClimbMetersThisRun = 0;
  /** Peak {@link comboCount} this run — for leaderboard best combo. */
  private peakComboThisRun = 0;
  private deathSubmitted = false;
  /** Latest remote top N from RTDB — kept fresh via {@link subscribeTopLeaderboard} while PlayScene lives. */
  private lastLeaderboardTop: LeaderboardEntry[] = [];
  private leaderboardUnsubscribe: (() => void) | null = null;
  /** Lifetime YOUR BAG totals from `/users/{uid}/stats` — updated live via {@link subscribeUserBagBalances}. */
  private remoteBagGold = 0;
  private remoteBagDiamond = 0;
  private userBagUnsubscribe: (() => void) | null = null;
  private collectibles: Collectible[] = [];
  /** Last-milestone sweep (⌊max climb m / 1000⌋) — see {@link maybeRunPeriodicPoolMaintenance}. */
  private lastPoolSweepKmBand = -1;
  private goldCount = 0;
  private diamondCount = 0;
  private runGoldCollected = 0;
  private runDiamondCollected = 0;
  /** Displayed counts (lerp toward real counts for smooth HUD). */
  private hudGoldShown = 0;
  private hudDiamondShown = 0;
  /** 1 = full collectible HUD punch, decays each frame. */
  private collectibleHudBump = 0;
  /**
   * Updated at end of each {@link update} from the same integer climb “m” as {@link getHudScoreboardDisplayMeters}.
   * {@link Physics} read this on the following frame after it is updated.
   */
  isSlidePhase = false;
  /** Smoothed 0–1 lava lift — rise driven by timer; descent lerps for elevator feel. */
  private deathLavaLiftDisplayFactor = 0;
  /** Elapsed rise seconds in the current 6500m cycle (3500m gate → full). */
  private deathLavaRiseElapsedSec = 0;
  /** Tracks cycle wrap so rise timer resets with landed meters modulo. */
  private deathLavaLiftCycleIndex = -1;
  /** Latched while falling into lava — keeps avatar behind until back above the teeth. */
  private playerFallingBehindLava = false;
  private sfx = new PlaySceneSfx(() => this.isSlidePhase);
  private platformTexture?: Texture;
  /** Marshmallow frames — HUD [0, 5000) m. */
  private marshmallowTextures: Texture[] = [];
  private marshmallowFeetAnchorY = 1;
  /** Chocolate frames — HUD [5000, 10000) m. */
  private chocolateTextures: Texture[] = [];
  private chocolateFeetAnchorY = 1;
  /** `rest platform.png` top strip — wide rest/spawn decks [0, 5000) m. */
  private restPlatformMarshmallowSlices?: RestPlatformStripSlices;
  /** `rest platform.png` bottom strip — wide rest/spawn decks [5000, 10000) m. */
  private restPlatformChocolateSlices?: RestPlatformStripSlices;
  private restFloorHouseTexture?: Texture;
  private restFloorHouseSprite?: Sprite;
  private restFloorCloudTexture?: Texture;
  private restFloorCloudSprite?: Sprite;
  private restFloorCloudRightSprite?: Sprite;
  private restFloorSuppliesTexture?: Texture;
  private restFloorSupplyTextures: Texture[] = [];
  private restFloorSupplySprites: Sprite[] = [];
  private platformSprites: Container[] = [];
  private platformSpriteModes: Array<'legacy' | 'bead' | 'rest-tile'> = [];
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
  /** px/s — smoothed parallax accel easing in {@link ParallaxManager}. */
  private cameraScrollVelocityPx = 0;
  /**
   * Until the first jump off the Floor 0 spawn deck (`kind === 'spawn'`), skip auto-scroll and
   * vertical follow — framing stays at {@link snapCameraToPlayer} after each reset.
   */
  private cameraFrozenUntilFirstFloor0Jump = true;
  private activeRestFloorY: number | null = null;
  private restFloorHoldY: number | null = null;
  private grappleCooldown = 0;
  private grapple: ActiveGrapple | null = null;
  private grappleReleaseDampingLeft = 0;
  private grappleReloadingLogged = false;
  private score = 0;
  /** Last synced total — used only for HUD punch deltas when {@link score} rises. */
  private scoreHudSyncBaseline = 0;
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
  /**
   * Next {@link runTime} at which a fascia elevator slide may add a combo step
   * ({@link FACIA_WALL_SLIDE_COMBO_STEP_INTERVAL_SEC} cadence). `null` when not tracking.
   */
  private fasciaSlideComboNextStepAtRunTime: number | null = null;
  /** Visual badge in the upper-left; created in `setupComboHud`. */
  private comboBadge?: ComboBadge;
  /** Wraps combo badge only; scaled — stays screen-fixed (parent `uiLayer`, never `world`). */
  private comboHudRoot = new Container();
  /** Lazy WebAudio synth that plays the tier hit on each combo increment. */
  private comboSynth?: ComboSynth;
  /** Successful grounded jumps since last Pull-up press (or run start); caps visibility unlock at {@link PULL_UP_JUMPS_REQUIRED}. */
  private pullUpJumpsAccum = 0;
  /** `SUPER JUMP` + `PULL UP` wrapper — centered under meters/speed on `uiLayer`. */
  private skillPairRoot = new Container();
  private readonly superJumpHudBtn = new SkillHudButton(() => {
    this.fireManualSuperJump();
  });
  private readonly pullUpHudBtn = new SkillHudButton(() => {
    this.fireSuperTongue();
  });
  private readonly superJumpFallbackRoot = new Container();
  private readonly superJumpFallbackGfx = new Graphics();
  private superJumpFallbackLabel?: Text;
  private readonly pullUpFallbackRoot = new Container();
  private readonly pullUpFallbackGfx = new Graphics();
  private pullUpFallbackLabel?: Text;
  private skillButtonsUseImageArt = false;
  private skillButtonTextures: Awaited<ReturnType<typeof loadSkillButtonTextures>> | null = null;
  private skillBtnDisplayW = SKILL_BTN_DISPLAY_W_MAX_MOBILE;
  private superTongueBtnPulse = 0;
  private skillPairAvailable = false;
  /** Pull-up used this offer — Super Jump remains until chain window ends or spend. */
  private skillPullUpSpent = false;
  private skillSuperJumpSpent = false;
  private skillChainWindowEnd = 0;
  /** Seconds left of "free chain grapple" buff after pressing Super Tongue. */
  private superTongueBuffTime = 0;
  private jumpBufferTimeLeft = 0;
  private runTime = 0;
  /** MS accumulator from Pixi ticker — Phaser `update(time)` analogue for Photoroom sine. */
  private photoroomOscTimeMs = 0;
  private diamondShineSparks: DiamondShineSpark[] = [];
  private shakeTime = 0;
  private shakeOffsetX = 0;
  private shakeOffsetY = 0;
  /** Subtle spring bounce on jump/land — applied via {@link applyCameraTransform}. */
  private cameraJuiceY = 0;
  private cameraJuiceVelY = 0;
  /** Phase accumulator for speed-stress screenshake (continuous, not impact bursts). */
  private velocityStressShakePhase = 0;
  private bgm?: HTMLAudioElement;
  /** Last picked `game music` URL — avoids playing the same track twice in a row when possible. */
  private lastGameMusicBgmUrl: string | null = null;
  private bgmTrackKind: 'game' | 'stress' = 'game';
  /** Normal BGM to resume after the 3500–6000 m stress window. */
  private savedGameBgmUrl: string | null = null;
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
   * Structural fall-save shields (max {@link MAX_FALL_SHIELDS}, not from currency/items): consumed when feet
   * cross the viewport-bottom death hazard ({@link checkFallGameOver}). Visual FX via {@link performShieldSuperLaunch}.
   */
  private fallShields = MAX_FALL_SHIELDS;
  /** Brief FX timer after a fall-save consumes one shield ({@link performShieldSuperLaunch}). */
  private shieldSaveFlashTime = 0;
  /**
   * Last platform the player **stood on** (live object reference — survives stair recycle id churn so
   * fall-shield relaunch resolves the actual deck underfoot).
   */
  private lastLandedPlatform: Platform | null = null;
  /** Prevents double bounce when {@link clampPlayerToCameraViewport} runs twice per frame. */
  private restWallBounceAppliedThisFrame = false;
  /** Rest (bone) walls: icy kick only after landing on a stair; one wall chain per stair. */
  private restWallChainEligible = true;
  /** Rest phase: run charge → repeatable wall kicks while airborne. */
  private icyRunChargePxPerSec = 0;
  private restWallKickCooldownUntil = 0;

  constructor(opts?: PlaySceneOptions) {
    this.fromMenuHandoff = opts?.menuHandoff === true;
    this.onBackToMenu = opts?.onBackToMenu;
    this.gameplayUnlocked = !this.fromMenuHandoff;
    this.platformSystem = new PlatformSystem({
      playerProbe: {
        getClimbBaselineY: () => this.climbBaselineY,
        getPlayerBodyHeight: () => this.player.body.height,
      },
      worldProbe: {
        getCameraX: () => this.cameraX,
        getCameraY: () => this.cameraY,
        getWorldWidth: () => this.worldWidth,
        getViewportSafeMarginWorld: () => this.getViewportSafeMarginWorld(),
        getPlatformEdgePaddingPx: () => PLATFORM_EDGE_PADDING_PX,
        getWorldBoundsX: () => WORLD_BOUNDS_X,
        getWorldWidthFromScreen: () => this.worldWidthFromScreen(),
        getCameraZoom: () => this.getCameraZoom(),
      },
      renderProbe: {
        getPlatformCount: () => this.platforms.length,
      },
      callbacks: {
        maybeSpawnFirstRestFloorProps: (platform) => this.maybeSpawnFirstRestFloorProps(platform),
        rebuildPlatformSprites: () => this.rebuildPlatformSprites(),
        onRestFloorEncountered: (platform) => this.maybeSpawnFirstRestFloorProps(platform),
        getRestFloorTopY: (meters) => this.getRestFloorTopY(meters),
        clearRestFloorProps: () => this.clearRestFloorProps(),
        updateRestFloorCloudBreathing: () => this.updateRestFloorCloudBreathing(),
        loadTextureFromCandidates: (candidates) => this.loadTextureFromCandidates(candidates),
        getWorldWidthFromScreen: () => this.worldWidthFromScreen(),
        getCameraZoom: () => this.getCameraZoom(),
      },
    });
  }

  /** Starts the 2s sky fall in sync with the menu white overlay fade-out. */
  beginMenuSkyDropIntro(): void {
    if (!this.fromMenuHandoff || this.gameplayUnlocked) {
      return;
    }
    const deck = this.platforms[0];
    if (!deck || deck.kind !== 'spawn') {
      return;
    }

    this.snapPlayerOntoStairZero();
    this.menuSkyDropIntroTargetY = this.player.body.y;
    const fallPx = this.worldHeightFromScreen() * MENU_SKY_DROP_FALL_VIEWPORT_RATIO;
    this.menuSkyDropIntroStartY = this.menuSkyDropIntroTargetY - fallPx;
    this.player.body.y = Math.round(this.menuSkyDropIntroStartY);
    this.player.body.vx = 0;
    this.player.body.vy = 0;
    this.player.body.grounded = false;
    this.menuSkyDropIntroElapsedSec = 0;
    this.menuSkyDropIntroActive = true;
    this.touchControlsLayer.visible = false;
    this.attackBtnRoot.visible = false;
    this.input?.clearTouchHolds();
  }

  /** Lands on Floor 0 and unlocks normal gameplay (also called when the scripted fall completes). */
  finishMenuSkyDropIntro(): void {
    if (!this.fromMenuHandoff || this.gameplayUnlocked) {
      return;
    }

    this.menuSkyDropIntroActive = false;
    this.snapPlayerOntoStairZero();
    this.player.body.vx = 0;
    this.player.body.vy = 0;
    this.player.body.grounded = true;
    this.gameplayUnlocked = true;
    this.player.onLand(480);
    this.sfx.play('player_land', 0.72);
    this.pulseCameraJuiceLanding(480);
    this.touchControlsLayer.visible = true;
    this.attackBtnRoot.visible = true;
    const deck = this.platforms[0];
    if (deck) {
      this.lastLandedPlatform = deck;
      this.currentGroundPlatform = deck;
    }
  }

  async init(app: Application): Promise<void> {
    this.app = app;
    this.width = app.screen.width;
    this.height = app.screen.height;
    this.refreshWorldViewport();

    this.atmosphereManager = new CandyAtmosphereManager(this.backgroundRoot);

    this.lavaLayer.addChild(this.deathZoneFallback);
    this.lavaLayer.sortableChildren = true;
    this.deathZoneFallback.zIndex = 0;
    this.lavaTeethLayer.sortableChildren = true;
    this.lavaPoolLayer.sortableChildren = true;
    preloadSkillButtonAssets();
    const quickMobile = isQuickStartMobileDevice();
    const [, , , , , , , , skillButtonTextures] = await Promise.all([
      quickMobile ? this.loadPlatformSpriteCore() : this.loadPlatformSprite(),
      this.player.load(),
      this.sfx.load(),
      this.loadViewportFasciaBoneTextures(),
      this.loadDeathZoneStrip(),
      quickMobile ? this.loadBackgroundTextureEssentialForQuickMobile() : this.loadBackgroundTexture(),
      this.loadStaticTeset3BackgroundLayer(),
      this.loadPhotoroomStaticMidForegroundSprites(),
      loadSkillButtonTextures(),
    ]);

    const skin = normalizeSelectedCharacterSkin(
      getGameUserSession()?.selected_character ?? getSavedSelectedCharacterSkin(),
    );
    this.player.updatePlayerSkin(skin);

    this.uiLayer.sortableChildren = true;
    app.stage.addChild(this.gameShake);
    app.stage.addChild(this.uiLayer);
    this.bgBackdropFill.eventMode = 'none';
    this.backgroundRoot.sortableChildren = true;
    this.gameShake.addChild(this.backgroundRoot);
    this.gameShake.addChild(this.world);
    this.world.sortableChildren = true;
    this.world.addChild(
      this.jelly,
      this.platformSpriteLayer,
      this.platformLayer,
      this.viewportFasciaBoneLayer,
      this.restFloorPropLayer,
      this.lavaTeethLayer,
      this.lavaLayer,
      this.rippleLayer,
      this.collectiblesGfx,
      this.tongueRoot,
      this.fxLayer,
      this.wallSparkSmokeGfx,
      this.wallSparkParticleRoot,
      this.player,
      this.lavaPoolLayer,
    );
    this.jelly.zIndex = 0;
    this.platformSpriteLayer.zIndex = PLATFORM_SPRITE_LAYER_Z_INDEX;
    this.platformLayer.zIndex = 3;
    this.viewportFasciaBoneLayer.zIndex = 3;
    this.viewportFasciaBoneLayer.eventMode = 'none';
    this.viewportFasciaBoneLayer.sortableChildren = false;
    this.restFloorPropLayer.zIndex = REST_FLOOR_HOUSE_DEPTH;
    this.restFloorPropLayer.sortableChildren = true;
    /** Ripples + collectibles sit under the death strip so coins/diamonds don’t paint over it. */
    this.rippleLayer.zIndex = 22;
    this.collectiblesGfx.zIndex = 23;
    this.lavaTeethLayer.zIndex = LAVA_TEETH_LAYER_Z_INDEX;
    this.lavaLayer.zIndex = LAVA_LAYER_Z_INDEX;
    this.lavaPoolLayer.zIndex = LAVA_POOL_LAYER_Z_INDEX;
    this.tongueRoot.zIndex = 32;
    this.fxLayer.zIndex = 33;
    this.wallSparkSmokeGfx.zIndex = 34;
    this.wallSparkSmokeGfx.eventMode = 'none';
    /** Above player (40): otherwise sparks at the fascia seam render behind the silhouette. */
    this.wallSparkParticleRoot.zIndex = 41;
    this.wallSparkParticleRoot.blendMode = 'add';
    this.wallSparkParticleRoot.eventMode = 'none';
    this.player.zIndex = PLAYER_WORLD_Z_INDEX;
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

    this.setupCollectibleHud(app);
    this.layoutCollectibleHud();

    this.input = new InputManager(app);
    this.input.attach();
    this.setupTouchControlsOverlay(app);
    this.setupClimbHud(app);
    this.setupComboHud(skillButtonTextures);
    this.setupGameOverUi();
    this.touchGlobalAnywhereLock = this.loadTouchGlobalSteeringPreference();
    this.setupPauseUi();
    await this.loadHeaderHudButtonTextures();
    this.setupHeaderPauseButton();
    this.setupStatusPanel();
    this.setupAttackButton();
    this.setupSpeedTierPulseOverlay();
    this.layoutHeaderPauseButton();
    this.layoutClimbHud();
    this.layoutStatusPanel();
    this.uiLayer.sortChildren();

    if (quickMobile) {
      void this.finishDeferredPlaySceneLoadsForMobile().catch(() => {});
    } else {
      await this.tryLoadTongueArmature();
    }
    this.resetRun({ pickNewBgm: true });
    this.drawStaticWorld();
    this.applyCameraTransform();
    this.drawDynamicWorld();
    this.startLeaderboardRealtimeSubscription();
    this.startUserBagRealtimeSubscription();
    this.gameplayActive = true;
  }

  /** Pixi passes {@link Ticker}; `time`/`delta` below match Phaser-style `update(time, delta)`. */
  update(ticker: Ticker): void {
    if (!this.gameplayActive) {
      return;
    }
    // Use real frame delta on mobile — capping to 1/30s made slow frames *lose* time so drifting
    // platforms and the camera looked stuttery. Only cap huge spikes (tab resume).
    const dt = Math.min(Math.max(ticker.deltaMS, 0) / 1000, 1 / 8);
    this.updateHeaderPauseButtonFx(dt);
    if (this.gameOver) {
      this.updateScreenShake(dt);
      this.refreshGameOverScoreText();
      this.updateScoreSavedHint(dt);
      this.drawDynamicWorld();
      this.applyCameraTransform();
      return;
    }
    if (this.paused) {
      this.updateSpeedTierUiFlash(dt);
      this.applyCameraTransform();
      return;
    }
    this.runTime += dt;

    if (!this.gameplayUnlocked) {
      this.tickMenuSkyDropIntro(dt);
      this.updateCamera(dt);
      this.drawDynamicWorld();
      this.player.update(dt, 0, false, null, false, this.fallShields > 0, false);
      this.applyCameraTransform();
      this.updateScreenShake(dt);
      this.syncPlayerDepthRelativeToLava();
      this.tickAltitudePresentation(dt);
      this.tickDeathLavaLift(dt);
      if (this.atmosphereManager?.isReady) {
        this.atmosphereManager.update({
          dt,
          cameraY: this.cameraY,
          climbMeters: this.getHudClimbMeters(),
        });
      }
      return;
    }

    this.restWallBounceAppliedThisFrame = false;
    this.syncSlidePhaseFromHudMeters();
    this.photoroomOscTimeMs += Math.max(0, ticker.deltaMS);
    this.grappleCooldown = Math.max(0, this.grappleCooldown - dt);
    this.updateTouchRipples(dt);
    this.updateGrappleCooldownFeedback();
    this.updatePlatformDifficulty(dt);
    this.updateLevelUpParticles(dt);
    this.updateComboSuperJumpParticles(dt);
    this.updateTouchFollowAxis();
    this.input?.smoothTouchJoystickAxis(dt, this.player.body.grounded);
    this.tickPlayerShield(dt);
    this.tickJumpBuffer(dt);
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
            this.lastScoredStairId = hookId;
            this.lastScoredLandWorldTopY = Math.min(this.lastScoredLandWorldTopY, hookPlatform.y);
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
    if (!this.isSlidePhase) {
      this.tickRestPhaseRunMomentum(dt, ax);
    }
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

    /** Align body X to viewport fascia band before overlap + physics (matches {@link drawWorldEdgeRestWalls}). */
    this.clampPlayerToCameraViewport();

    const fascia = this.getViewportEdgeWallSlabsWorld();
    const fasciaAssistSpec =
      this.isSlidePhase && fascia && !pulling && this.wallCollider.active
        ? {
            slabW: fascia.slabW,
            leftSlabLeftX: fascia.leftSlabLeftX,
            rightSlabLeftX: fascia.rightSlabLeftX,
            horizontalAxis: ax,
          }
        : undefined;
    const fasciaOverlapClear =
      !fasciaAssistSpec ||
      Physics.viewportFasciaBodyOverlapSide(this.player.body, fasciaAssistSpec) === 'none';

    const result = this.physics.update(
      this.player.body,
      this.platforms,
      this.worldWidth,
      dt,
      gravityScale,
      fasciaAssistSpec
        ? {
            viewportFasciaAssist: fasciaAssistSpec,
            fasciaOverlapClear,
            gameTimeMs: this.runTime * 1000,
            allowViewportFasciaElevatorLatch:
              this.player.hasTouchedPlatformSinceLastSlide,
          }
        : { fasciaOverlapClear, gameTimeMs: this.runTime * 1000 },
    );

    if (this.isSlidePhase && result.fasciaSlideHardBreak) {
      this.onViewportFasciaSlideHardBreakForInfiniteSlideBypass();
    }

    if (
      this.isSlidePhase &&
      result.fasciaWallSlideLatched &&
      fasciaAssistSpec != null
    ) {
      this.sparkEmitterAnalogueWallSlideStart();
    }

    if (this.isSlidePhase && result.fasciaWallSlideLatched) {
      this.player.hasTouchedPlatformSinceLastSlide = false;
    }

    /** לולאת `slide`: כל פריים כשפרצי הגחיר על קיר הפאשיה פעילים (זהה לזרימת החיכוך). */
    const wallSlideStreamForSfx =
      this.isSlidePhase &&
      fasciaAssistSpec != null &&
      this.shouldEmitWallSlideFasciaFrictionStream(fasciaAssistSpec);
    if (wallSlideStreamForSfx) {
      this.sfx.ensureWallSlideLoopPlaying();
    } else if (this.wallSlideFasciaSfxStreamingMemo) {
      this.sfx.endWallSlideLoop();
    }
    this.wallSlideFasciaSfxStreamingMemo = wallSlideStreamForSfx;

    this.updateWallSparkParticles(dt, fasciaAssistSpec);

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
          fasciaAssistSpec,
        );
      }
    }

    if (result.landedPlatform) {
      this.player.hasTouchedPlatformSinceLastSlide = true;
      this.restWallChainEligible = true;
      this.currentGroundPlatform = result.landedPlatform;
      this.player.onLand(result.impactVy);
      if (!wasGrounded) {
        const landVol = Math.min(1, result.impactVy / 520);
        this.sfx.play('player_land', 0.35 + landVol * 0.65);
        this.pulseCameraJuiceLanding(result.impactVy);
      }
      const p = result.landedPlatform;
      const idDelta = p.stairId - this.lastScoredStairId;
      /** Recycle can rotate stair ids backwards; world Y is the true tiebreaker. */
      const climbedHigherPhysically = p.y < this.lastScoredLandWorldTopY - 6;
      const landGain =
        idDelta > 0 ? idDelta : climbedHigherPhysically ? 1 : 0;
      if (landGain > 0) {
        this.lastScoredStairId = p.stairId;
        this.lastScoredLandWorldTopY = Math.min(this.lastScoredLandWorldTopY, p.y);
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

    this.onPlatformSquashLandCollider(prePhysicsFeetY, wasGrounded, result.landedPlatform);
    this.tickPlatformSquashJuice(dt);

    /** Air jump off fascia before interval tick — avoids paying both {@link incrementComboForViewportFasciaSlideAscend} and {@link registerComboJump} same frame */
    this.maybeConsumeFasciaWallSlideBufferedJumpAfterPhysics(fasciaAssistSpec, !!result.landedPlatform);

    /** Combo steps during wall-slide friction stream — fixed cadence ({@link FACIA_WALL_SLIDE_COMBO_STEP_INTERVAL_SEC}). */
    this.tickViewportFasciaSlideAscendingCombo(fasciaAssistSpec);

    const wallElevatorKeepsComboChainClock =
      this.isSlidePhase &&
      fasciaAssistSpec != null &&
      this.physics.isViewportWallElevatorSparkActive(this.player.body, fasciaAssistSpec);
    /**
     * While friction SFX fires or the physics elevator latch is active, freeze the combo chain window
     * (covers mismatches between SFX predicates and latch).
     */
    if (
      this.isSlidePhase &&
      this.comboCount > 0 &&
      (wallSlideStreamForSfx || wallElevatorKeepsComboChainClock)
    ) {
      this.comboLastJumpTime = this.runTime;
    }
    this.tickComboHud(dt);

    this.maybeTriggerFarSkyTextureMilestones();

    this.updateRestFloorHoldState();
    /** Before camera scroll — otherwise auto-scroll outruns a fall into the disqualify row and stairs vanish off-screen. */
    this.checkFallGameOver();
    this.updateCamera(dt);
    this.maybeAdvanceScrollSpeedTierFeedback();
    this.maybeRebaseWorldVerticalOrigin();
    this.clampPlayerToCameraViewport();
    if (!this.shouldPausePlatformGeneration()) {
      this.recycleStairsOffscreen();
    }
    this.maybeRunPeriodicPoolMaintenance();
    this.cullDisposableWorldFarBelowViewport();
    this.syncPlatformSpritesFromPlatforms();
    this.updateRipples(dt);
    this.updateDiamondShineSparks(dt);
    this.updateCollectibles(dt);
    if (this.input?.consumeAttack()) {
      this.playerAttack();
    }
    this.refreshAttackButtonCooldownVisual();
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
      this.fallShields > 0,
      wallSlideStreamForSfx,
    );
    this.tickAltitudePresentation(dt);
    this.tickDeathLavaLift(dt);
    this.tickStressModeBgm();
    this.syncPlayerDepthRelativeToLava();
    this.drawDynamicWorld();
    this.updateSpeedTierUiFlash(dt);
    this.updateScreenShake(dt);
    this.updateCameraJuice(dt);
    this.recomputeDerivedTotalScore();
    this.updateLevelProgress();
    this.syncCollectibleHudPosition();

    const time = this.photoroomOscTimeMs;
    this.syncPhotoroomTeset12ScreenAnchoredOscillation(time);
    if (this.atmosphereManager?.isReady) {
      this.atmosphereManager.update({
        dt,
        cameraY: this.cameraY,
        climbMeters: this.getHudClimbMeters(),
      });
    }
  }

  resize(width: number, height: number): void {
    const prevW = this.width;
    const prevH = this.height;
    const dw = Math.abs(width - prevW);
    const dh = Math.abs(height - prevH);
    this.width = width;
    this.height = height;
    this.refreshWorldViewport();

    this.layoutCollectibleHud();
    this.layoutHeaderPauseButton();
    this.layoutClimbHud();
    this.layoutSkillPairHud();
    this.layoutComboHudRoot();
    this.layoutGameOverUi();
    this.layoutHeaderPauseButton();
    this.layoutStatusPanel();
    this.layoutAttackButton();
    this.layoutPauseOverlay();
    this.layoutLogoutConfirmOverlay();
    this.redrawSpeedPulseOverlay();
    this.uiLayer.sortChildren();
    this.input?.onResize();

    // Mobile browser chrome toggles height in small steps; resetting the whole run felt like “stuck” stairs.
    const minorViewportJitter =
      prevW > 0 && this.platforms.length > 0 && dw <= 36 && dh <= 96;
    if (minorViewportJitter) {
      this.drawStaticWorld();
      this.layoutHeaderPauseButton();
      this.layoutClimbHud();
      this.layoutStatusPanel();
      this.layoutAttackButton();
      this.layoutPauseOverlay();
      this.layoutLogoutConfirmOverlay();
      this.redrawSpeedPulseOverlay();
      this.clampEntitiesToWorldBounds();
      this.syncPlatformSpritesFromPlatforms();
      this.drawDynamicWorld();
      return;
    }

    this.resetRun();
    this.drawStaticWorld();
    this.drawDynamicWorld();
  }

  destroy(): void {
    this.clearWallColliderRestoreTimeout();
    this.app?.stage.off('pointermove', this.handleStatusPanelBagPointerMove);
    this.app?.stage.off('pointerup', this.handleStatusPanelBagPointerUp);
    this.app?.stage.off('pointerupoutside', this.handleStatusPanelBagPointerUp);
    this.app?.stage.off('pointercancel', this.handleStatusPanelBagPointerUp);
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
    this.leaderboardUnsubscribe?.();
    this.leaderboardUnsubscribe = null;
    this.userBagUnsubscribe?.();
    this.userBagUnsubscribe = null;
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

  /**
   * After physics: if the jump buffer is still held and the player rides the fascia elevator, treat it
   * as a real jump (counts toward {@link jumpCount} / combo), like a coyote jump off the wall.
   */
  private maybeConsumeFasciaWallSlideBufferedJumpAfterPhysics(
    fasciaAssistSpec:
      | {
          slabW: number;
          leftSlabLeftX: number;
          rightSlabLeftX: number;
          horizontalAxis: number;
        }
      | undefined,
    landedThisFrame: boolean,
  ): void {
    if (
      !this.isSlidePhase ||
      landedThisFrame ||
      this.jumpBufferTimeLeft <= 0 ||
      this.grapple ||
      this.player.body.grounded ||
      !fasciaAssistSpec
    ) {
      return;
    }
    if (
      !this.physics.isViewportWallElevatorSparkActive(this.player.body, fasciaAssistSpec)
    ) {
      return;
    }
    this.maybeEndFloor0IntroCameraFreeze();
    this.physics.jump(this.player.body);
    this.physics.resetWallSlideSession();
    this.player.hasTouchedPlatformSinceLastSlide = false;

    let wall: 'left' | 'right' | null = this.physics.getActiveViewportWallSlideKickSide();
    if (wall == null) {
      const o = Physics.viewportFasciaBodyOverlapSide(this.player.body, fasciaAssistSpec);
      if (o === 'left') {
        wall = 'left';
      } else if (o === 'right') {
        wall = 'right';
      } else if (o === 'both') {
        const cx = this.player.body.x + this.player.body.width * 0.5;
        const axis = fasciaAssistSpec.horizontalAxis;
        const vw = Math.max(1, this.worldWidthFromScreen());
        const midCam = this.cameraX + vw * 0.5;
        wall =
          axis < -0.08 ? 'left' : axis > 0.08 ? 'right' : cx < midCam ? 'left' : 'right';
      }
    }
    const body = this.player.body;
    if (wall === 'left') {
      body.vx = Math.max(body.vx, FACIA_WALL_SLIDE_BUFFER_JUMP_KICK_VX);
    } else if (wall === 'right') {
      body.vx = Math.min(body.vx, -FACIA_WALL_SLIDE_BUFFER_JUMP_KICK_VX);
    }

    this.jumpCount += 1;
    this.registerComboJump();
    this.maybeIncrementPullUpJumpCounter();
    this.player.onJump();
    this.jumpBufferTimeLeft = 0;
    if (this.wallSlideFasciaSfxStreamingMemo) {
      this.sfx.endWallSlideLoop();
    }
    this.wallSlideFasciaSfxStreamingMemo = false;
    this.sparkEmitterAnalogueWallSlideStop();
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
    this.pulseCameraJuiceJump();
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
    fasciaAssistSpec:
      | {
          slabW: number;
          leftSlabLeftX: number;
          rightSlabLeftX: number;
          horizontalAxis: number;
        }
      | undefined,
  ): void {
    /**
     * While the fascia wall-slide friction stream is active ({@link shouldEmitWallSlideFasciaFrictionStream}),
     * ascent is mechanically coupled to that surface — awarding both stair-plane steps and timed slide combo
     * double-pays each moment. Omit stair-plane awards until friction stream ends (free mega arc elsewhere unchanged).
     */
    if (
      this.isSlidePhase &&
      fasciaAssistSpec != null &&
      this.shouldEmitWallSlideFasciaFrictionStream(fasciaAssistSpec)
    ) {
      return;
    }
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

  /** One combo step from riding the viewport fascia elevator (paced by {@link FACIA_WALL_SLIDE_COMBO_STEP_INTERVAL_SEC}). */
  private incrementComboForViewportFasciaSlideAscend(): void {
    this.comboCount += 1;
    this.comboLastJumpY = this.player.body.y;
    this.comboLastJumpTime = this.runTime;
    if (this.comboCount >= 2) {
      const wordTier = comboStreakToWordTier(this.comboCount);
      this.comboBadge?.bumpTo(this.comboCount);
      this.comboSynth?.resume();
      this.comboSynth?.play(wordTier);
    }
  }

  /**
   * Awards combo during fascia wall-slide at a steady cadence ({@link FACIA_WALL_SLIDE_COMBO_STEP_INTERVAL_SEC}).
   * Active when {@link shouldEmitWallSlideFasciaFrictionStream} is true (same notion as slide SFX / sparks), not only physics `isSliding`.
   */
  private tickViewportFasciaSlideAscendingCombo(
    fasciaAssistSpec:
      | {
          slabW: number;
          leftSlabLeftX: number;
          rightSlabLeftX: number;
          horizontalAxis: number;
        }
      | undefined,
  ): void {
    if (!this.isSlidePhase) {
      this.fasciaSlideComboNextStepAtRunTime = null;
      return;
    }
    /** Match slide SFX / sparks: latch elevator **or** fascia assist friction with overlap (`isSliding` alone is too narrow). */
    const slideCountsCombo =
      fasciaAssistSpec != null &&
      this.shouldEmitWallSlideFasciaFrictionStream(fasciaAssistSpec);

    if (!slideCountsCombo || this.comboCount <= 0) {
      this.fasciaSlideComboNextStepAtRunTime = null;
      return;
    }

    if (this.fasciaSlideComboNextStepAtRunTime === null) {
      /** First latch this session: eligible immediately, then spaced by the interval from each award. */
      this.fasciaSlideComboNextStepAtRunTime = this.runTime;
    }

    if (this.runTime < this.fasciaSlideComboNextStepAtRunTime) {
      return;
    }

    this.incrementComboForViewportFasciaSlideAscend();
    this.fasciaSlideComboNextStepAtRunTime =
      this.runTime + FACIA_WALL_SLIDE_COMBO_STEP_INTERVAL_SEC;
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
      const baseWidth = PLATFORM_SIZING.uniformBaseWidth;
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
    if (this.gameOver || this.shouldPausePlatformGeneration()) {
      return;
    }
    if (this.shouldPauseStairRecycleDuringSlideFall()) {
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
      p.baseWidth = PLATFORM_SIZING.uniformBaseWidth;
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
    return this.platformSystem.pickNextPlatformY(previousTopY, normalY);
  }

  private getNextRestFloorYAbove(worldY: number): number {
    return this.platformSystem.getNextRestFloorYAbove(worldY);
  }

  private getRestFloorTopY(meters: number): number {
    return this.platformSystem.getRestFloorTopY(meters);
  }

  private getRestFloorMeters(platform: Platform): number | null {
    if (platform.kind !== 'rest') {
      return null;
    }
    const meters = Math.round((this.climbBaselineY - (platform.y - this.player.body.height)) / 12);
    return meters > 0 && meters % REST_FLOOR_INTERVAL_METERS === 0 ? meters : null;
  }

  private getPlatformMeters(platform: Platform): number {
    return this.platformSystem.getPlatformMeters(platform);
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

  /** Left/right screen margin expressed in world pixels — platform spawn + HUD + viewport player X clamp. */
  private getViewportSafeMarginWorld(): number {
    return VIEWPORT_SAFE_MARGIN_SCREEN_PX / this.getCameraZoom();
  }

  /**
   * Viewport-pinned vertical fascia strips — **same** extents as {@link drawWorldEdgeRestWalls} and fascia physics.
   * Positions are nudged inward by {@link VIEWPORT_FASCIA_INWARD_NUDGE_WORLD_PX}.
   */
  private getViewportEdgeWallSlabsWorld():
    | { slabW: number; leftSlabLeftX: number; rightSlabLeftX: number }
    | null {
    const ww = Math.max(1, this.worldWidth);
    const w = Math.min(WORLD_EDGE_REST_WALL_PX, Math.floor(ww * 0.3));
    if (w < 8) {
      return null;
    }
    const vw = Math.max(1, this.worldWidthFromScreen());
    const leftX = Math.max(0, Math.min(this.cameraX, ww - w));
    const rightX = Math.max(leftX + w, Math.min(this.cameraX + vw - w, ww - w));
    if (rightX <= leftX + w) {
      return null;
    }
    const nudge = VIEWPORT_FASCIA_INWARD_NUDGE_WORLD_PX;
    const leftN = Math.max(0, leftX + nudge);
    const rightN = Math.min(ww - w, rightX - nudge);
    if (rightN <= leftN + w) {
      return null;
    }
    return { slabW: w, leftSlabLeftX: leftN, rightSlabLeftX: rightN };
  }

  private getNormalPlatformWorldWidth(): number {
    return this.platformSystem.getNormalPlatformWorldWidth();
  }

  /** Fixed sprite width — decoupled from hitbox so PNG art scale stays constant. */
  private getPlatformSpriteWorldWidth(_platform: Platform): number {
    return PLATFORM_SIZING.spriteWorldWidthPx;
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
    platform.baseWidth = PLATFORM_SIZING.uniformBaseWidth;
    platform.width = this.getNormalPlatformWorldWidth();
    this.updatePlatformBodyFromScale(platform);
  }

  /**
   * Safe horizontal span for platform **left edge** X: current camera view minus margins,
   * clamped to world bounds (Phaser-style: between margin and gameWidth - margin - width).
   */
  private getPlatformSpawnHorizontalRange(
    platformWidth: number,
    viewOriginX: number = this.cameraX,
  ): { minX: number; maxX: number } {
    return this.platformSystem.getPlatformSpawnHorizontalRange(platformWidth, viewOriginX);
  }

  private computePlatformSpawnX(
    stairId: number,
    platformWidth: number,
    viewOriginX: number = this.cameraX,
  ): number {
    return this.platformSystem.computePlatformSpawnX(stairId, platformWidth, viewOriginX);
  }

  private clearWallColliderRestoreTimeout(): void {
    if (this.wallColliderRestoreTimeout !== null) {
      clearTimeout(this.wallColliderRestoreTimeout);
      this.wallColliderRestoreTimeout = null;
    }
  }

  /**
   * No Phaser collider exists for viewport fascia — toggling {@link wallCollider}.active gates fascia assist.
   * Mirrors “disable overlap” for {@link PHYSICS.wallSlideCooldownMs} to stop immediate re-latch after a max-duration slide.
   */
  private onViewportFasciaSlideHardBreakForInfiniteSlideBypass(): void {
    if (!this.isSlidePhase) {
      return;
    }
    this.wallCollider.active = false;
    this.player.body.vy = PHYSICS.wallSlideCutoffDropVy;
    this.clearWallColliderRestoreTimeout();
    this.wallColliderRestoreTimeout = setTimeout(() => {
      this.wallColliderRestoreTimeout = null;
      if (this.wallCollider) {
        this.wallCollider.active = true;
      }
    }, PHYSICS.wallSlideCooldownMs);
  }

  /**
   * Keep the avatar inside the camera band. When fascia exists, clamps to the **inner** playfield span between
   * the drawn strips (same geometry as {@link drawWorldEdgeRestWalls}), not the larger margin-only band.
   *
   * Rest phase (bone walls): Icy Tower–style bounce when eligible; slide phase unchanged (soft restitution only).
   */
  private clampPlayerToCameraViewport(): void {
    const body = this.player.body;
    const marginW = this.getViewportSafeMarginWorld();
    const fascia = this.getViewportEdgeWallSlabsWorld();
    const vw = this.worldWidthFromScreen();
    const worldMin = 0;
    const worldMax = this.worldWidth - body.width;

    let left: number;
    let right: number;
    if (fascia && fascia.slabW >= 8) {
      const w = fascia.slabW;
      const innerLeft = fascia.leftSlabLeftX + w;
      const innerRightPlayfieldEnd = fascia.rightSlabLeftX;
      left = Math.max(worldMin, innerLeft);
      right = Math.min(worldMax, innerRightPlayfieldEnd - body.width);
    } else {
      const viewLeft = this.cameraX + marginW;
      const viewRight = this.cameraX + vw - marginW - body.width;
      left = Math.max(worldMin, viewLeft);
      right = Math.min(worldMax, viewRight);
    }

    if (right < left) {
      body.x = Math.max(worldMin, Math.min(this.cameraX + vw * 0.5 - body.width * 0.5, worldMax));
      return;
    }

    const slideRest = PHYSICS.viewportClampWallRestitution;

    if (body.x < left) {
      const approachVx = body.vx;
      body.x = left;
      if (this.isSlidePhase) {
        if (approachVx < 0) {
          body.vx = -approachVx * slideRest;
        }
      } else {
        this.applyRestFasciaWallContact('left', approachVx);
      }
    } else if (body.x > right) {
      const approachVx = body.vx;
      body.x = right;
      if (this.isSlidePhase) {
        if (approachVx > 0) {
          body.vx = -approachVx * slideRest;
        }
      } else {
        this.applyRestFasciaWallContact('right', approachVx);
      }
    }
  }

  /**
   * Slide 4000–6000m vs rest bone walls — must run before physics so 6000m transition does not leave elevator latch on.
   */
  private syncSlidePhaseFromHudMeters(): void {
    const cycleProgress =
      Math.floor(this.getHudScoreboardDisplayMeters()) % SLIDE_PHASE_CYCLE_METERS;
    const next =
      cycleProgress >= SLIDE_PHASE_START_METERS && cycleProgress < SLIDE_PHASE_END_METERS;
    if (this.isSlidePhase && !next) {
      this.onRestSlidePhaseExited();
    }
    this.isSlidePhase = next;
  }

  /** Leaving slide segment (e.g. 6000m): clear wall-slide state so gameplay does not freeze on the fascia. */
  private onRestSlidePhaseExited(): void {
    this.fasciaRestWallStripePhaseAnchorWorldYTop =
      this.cameraY - WORLD_EDGE_FASCIA_STRIP_VERTICAL_PAD_PX;
    this.physics.resetWallSlideSession();
    this.clearWallColliderRestoreTimeout();
    this.wallCollider.active = true;
    this.sparkEmitterAnalogueWallSlideStop();
    if (this.wallSlideFasciaSfxStreamingMemo) {
      this.sfx.endWallSlideLoop();
    }
    this.wallSlideFasciaSfxStreamingMemo = false;
    this.wallSparkSlideElevatorPhysActiveMemo = false;
    this.fasciaSlideComboNextStepAtRunTime = null;
    this.player.hasTouchedPlatformSinceLastSlide = true;
  }

  /**
   * Rest wall: Icy Tower kick whenever impact speed/charge is high enough (repeatable in air).
   */
  private applyRestFasciaWallContact(side: 'left' | 'right', approachVx: number): void {
    const body = this.player.body;
    const stopInward = (): void => {
      if (side === 'left' && body.vx < 0) {
        body.vx = 0;
      } else if (side === 'right' && body.vx > 0) {
        body.vx = 0;
      }
    };

    if (this.restWallBounceAppliedThisFrame) {
      stopInward();
      return;
    }

    if (body.grounded) {
      stopInward();
      return;
    }

    const pushingInto =
      side === 'left'
        ? approachVx < -PHYSICS.icyWallKickMinImpactVx * 0.5
        : approachVx > PHYSICS.icyWallKickMinImpactVx * 0.5;

    if (!this.restWallChainEligible) {
      stopInward();
      return;
    }

    if (pushingInto) {
      this.restWallChainEligible = false;
    }

    if (this.runTime < this.restWallKickCooldownUntil) {
      stopInward();
      return;
    }

    const outward = side === 'left' ? 1 : -1;
    const approach = Math.abs(approachVx);
    const impact = Math.max(approach, this.icyRunChargePxPerSec);

    if (impact < PHYSICS.icyWallKickMinImpactVx || !pushingInto) {
      stopInward();
      return;
    }

    const kick01 = this.getRestWallKick01(impact);
    const outSpeed = Math.max(
      PHYSICS.icyWallKickMinVx,
      Math.min(PHYSICS.icyRunChargeMax, impact * PHYSICS.icyWallKickRestitution),
    );
    body.vx = outward * outSpeed;
    this.icyRunChargePxPerSec = Math.min(PHYSICS.icyRunChargeMax, outSpeed);

    const diagonalRatio =
      PHYSICS.icyWallKickDiagonalVyPerVxMin +
      (PHYSICS.icyWallKickDiagonalVyPerVxMax - PHYSICS.icyWallKickDiagonalVyPerVxMin) * kick01;

    const popVy = Math.max(
      PHYSICS.icyWallKickMinVy +
        kick01 * (PHYSICS.icyWallKickMaxVy - PHYSICS.icyWallKickMinVy),
      outSpeed * diagonalRatio,
    );
    body.vy = Math.min(body.vy, -popVy);

    this.restWallBounceAppliedThisFrame = true;
    this.restWallKickCooldownUntil = this.runTime + PHYSICS.icyWallKickCooldownSec;
    this.shakeTime = Math.max(this.shakeTime, 0.16 + kick01 * 0.14);
  }

  /** 0..1 kick strength from impact speed at the wall. */
  private getRestWallKick01(impactSpeed: number): number {
    const floor = WALK.speedPxPerSecond * 0.35;
    const span = Math.max(1, PHYSICS.icyWallKickSpeedForMax - floor);
    return Math.min(1, Math.max(0, (impactSpeed - floor) / span));
  }

  /** Banks run charge while steering — feeds repeatable wall kicks. */
  private tickRestPhaseRunMomentum(dt: number, axis: number): void {
    const body = this.player.body;
    const vx = Math.abs(body.vx);
    const decay = Math.exp(-PHYSICS.icyRunChargeDecayPerSec * dt);
    let charge = Math.max(vx, this.icyRunChargePxPerSec * decay);

    const ax = Math.max(-1, Math.min(1, axis));
    if (Math.abs(ax) > 0.12) {
      const sameDir = Math.sign(ax) === Math.sign(body.vx) || Math.abs(body.vx) < 28;
      if (sameDir && vx > WALK.vxThreshold) {
        charge += vx * PHYSICS.icyRunChargeBuildPerSec * dt;
      }
    }

    this.icyRunChargePxPerSec = Math.min(PHYSICS.icyRunChargeMax, charge);
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
    /** Feet on deck top — physics resolves landing on the same frame. */
    b.y = Math.round(p.y - b.height);
  }

  private tickMenuSkyDropIntro(dt: number): void {
    if (!this.menuSkyDropIntroActive) {
      return;
    }
    this.menuSkyDropIntroElapsedSec += dt;
    const t = Math.min(1, this.menuSkyDropIntroElapsedSec / MENU_SKY_DROP_INTRO_SEC);
    const eased = t * t;
    const span = this.menuSkyDropIntroTargetY - this.menuSkyDropIntroStartY;
    this.player.body.y = Math.round(this.menuSkyDropIntroStartY + span * eased);
    this.player.body.vy = (span * 2 * t) / MENU_SKY_DROP_INTRO_SEC;
    this.player.body.grounded = false;
    if (t >= 1) {
      this.finishMenuSkyDropIntro();
    }
  }

  private updatePlatformBodyFromScale(platform: Platform): void {
    this.platformSystem.updatePlatformBodyFromScale(platform);
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
    const hasStairArt =
      this.marshmallowTextures.length > 0 || this.chocolateTextures.length > 0;
    const hasRestArt = !!(this.restPlatformMarshmallowSlices || this.restPlatformChocolateSlices);
    if (!hasStairArt && !hasRestArt) {
      return;
    }

    for (let i = 0; i < this.platforms.length; i += 1) {
      const platform = this.platforms[i];
      const root = this.platformSprites[i];
      if (!root) {
        continue;
      }

      if (platform.kind === 'rest' || platform.kind === 'spawn') {
        if (hasRestArt) {
          this.syncRestFloorPlatformSprite(i, root, platform);
        } else {
          root.visible = false;
        }
        continue;
      }
      if (!hasStairArt) {
        root.visible = false;
        continue;
      }
      root.visible = true;

      const platformM = this.getPlatformMeters(platform);
      const levelTex = this.pickPlatformLevelTexture(platformM, platform);
      if (!levelTex) {
        continue;
      }

      this.syncLegacyPlatformSprite(i, root, platform, levelTex, 1);
    }
  }

  private resetRun(opts?: { pickNewBgm?: boolean }): void {
    this.gameOver = false;
    this.player.zIndex = PLAYER_WORLD_Z_INDEX;
    this.deathLavaLiftDisplayFactor = 0;
    this.deathLavaRiseElapsedSec = 0;
    this.deathLavaLiftCycleIndex = -1;
    this.playerFallingBehindLava = false;
    this.finalMetersAtDeath = 0;
    this.peakClimbMetersThisRun = 0;
    this.peakComboThisRun = 0;
    this.deathSubmitted = false;
    this.gameOverOverlay.visible = false;
    this.leaderboardOverlay.visible = false;
    this.scoreSavedHintTimeLeft = 0;
    if (this.gameOverScoreSavedHint) {
      this.gameOverScoreSavedHint.visible = false;
    }
    this.touchControlsLayer.visible = true;
    this.currentGroundPlatform = null;
    this.score = 0;
    this.scoreHudSyncBaseline = 0;
    this.lastScoredStairId = -1;
    this.lastScoredLandWorldTopY = Number.POSITIVE_INFINITY;
    this.cameraX = 0;
    this.cameraY = 0;
    this.cameraFrozenUntilFirstFloor0Jump = true;
    this.activeRestFloorY = null;
    this.restFloorHoldY = null;
    this.resetBackground1kSwapState();
    this.lastPoolSweepKmBand = -1;
    this.goldCount = 0;
    this.diamondCount = 0;
    this.runGoldCollected = 0;
    this.runDiamondCollected = 0;
    this.resetBagSlots();
    this.collectibles = [];
    this.jumpCount = 0;
    this.comboCount = 0;
    this.comboLastJumpY = Number.POSITIVE_INFINITY;
    this.comboLastJumpTime = -1e9;
    this.superJumpComboGraceUntil = Number.NEGATIVE_INFINITY;
    this.megaJumpReanchorComboOnLanding = false;
    this.superJumpStairTrackActive = false;
    this.superJumpCrossedStairIds.clear();
    this.fasciaSlideComboNextStepAtRunTime = null;
    this.comboBadge?.resetState();
    this.pullUpJumpsAccum = 0;
    this.setSkillPairAvailable(false);
    this.superTongueBuffTime = 0;
    this.jumpBufferTimeLeft = 0;
    this.runTime = 0;
    this.menuSkyDropIntroActive = false;
    this.menuSkyDropIntroElapsedSec = 0;
    this.fromMenuHandoff = false;
    this.gameplayUnlocked = true;
    this.photoroomOscTimeMs = 0;
    this.paused = false;
    this.pauseOverlay.visible = false;
    this.headerPauseRoot.visible = true;
    this.syncHeaderPauseHudLayer();
    this.statusPanelRoot.visible = STATUS_PANEL_ENABLED;
    this.attackBtnRoot.visible = true;
    this.shakeTime = 0;
    this.shakeOffsetX = 0;
    this.shakeOffsetY = 0;
    this.cameraJuiceY = 0;
    this.cameraJuiceVelY = 0;
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
    this.sparkEmitterAnalogueWallSlideStop();
    this.sfx.endWallSlideLoop();
    this.wallSlideFasciaSfxStreamingMemo = false;
    this.wallSparkSlideElevatorPhysActiveMemo = false;
    this.wallSlideSmokeParticles = [];
    this.wallSparkSmokeGfx.clear();
    this.jumpArcAssistTime = 0;
    this.jumpArcAssistDuration = 0;
    this.clearWallColliderRestoreTimeout();
    this.wallCollider.active = true;
    this.physics.resetWallSlideSession();
    this.physics.clearFasciaWallCooldowns();
    this.shieldSaveFlashTime = 0;
    this.fallShields = MAX_FALL_SHIELDS;
    this.lastLandedPlatform = null;
    this.restWallBounceAppliedThisFrame = false;
    this.icyRunChargePxPerSec = 0;
    this.restWallKickCooldownUntil = 0;
    this.currentBackgroundColor = this.getBackgroundColorForLevel(this.level);
    if (this.levelUpFloatText) {
      this.levelUpFloatText.visible = false;
    }
    this.createPlatforms();
    this.spawnCollectibleField();
    this.resetPlayer();
    this.snapCameraToPlayer();
    this.centerStairZeroUnderCamera();
    this.snapPlayerOntoStairZero();
    this.fasciaRestWallStripePhaseAnchorWorldYTop =
      this.cameraY - WORLD_EDGE_FASCIA_STRIP_VERTICAL_PAD_PX;
    this.climbBaselineY = this.player.body.y;
    console.log(
      `1000m Rest Floor Y: ${this.getRestFloorTopY(REST_FLOOR_HOUSE_METERS).toFixed(2)}`,
    );
    this.clearRestFloorProps();
    this.hudGoldShown = this.goldCount;
    this.hudDiamondShown = this.diamondCount;
    this.collectibleHudBump = 0;
    this.collectibleHudRoot.scale.set(1);
    this.refreshCollectibleHudText();
    this.syncScrollSpeedTierBaseline();
    if (opts?.pickNewBgm === true) {
      this.startBackgroundMusic();
    }
    if (this.statusPanelExpanded) {
      this.refreshStatusPanelContent();
    }
    this.touchPointers.clear();
    this.touchControlPointerId = null;
    this.input?.clearTouchHolds();
    this.drawStaticWorld();
    this.drawDynamicWorld();
    this.applyCameraTransform();
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
    if (this.consumeFallShield()) {
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

    const anchor =
      this.lastLandedPlatform !== null && this.platforms.includes(this.lastLandedPlatform)
        ? this.lastLandedPlatform
        : this.platforms[0];
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
    this.player.onJump();
    this.shieldSaveFlashTime = SHIELD_SAVE_FLASH_SEC;
    this.shakeTime = Math.max(this.shakeTime, 0.42);
    this.snapCameraToPlayer();
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

  /** Feet cross this Y → game over ({@link checkFallGameOver}); follows `lava 2` disqualify seam. */
  private getDeathPlaneWorldY(): number {
    return this.getLava2DisqualifyLineWorldY();
  }

  private getLava2DisqualifyLineLocalY(texture: Texture): number {
    return texture === this.deathHazardTextureFull
      ? this.deathLava2FullDisqualifyLocalY
      : this.deathLava2StripDisqualifyLocalY;
  }

  private getLava2SplitTextures(layout: {
    texture: Texture;
  }): { teeth: Texture; pool: Texture } | null {
    const isFull = layout.texture === this.deathHazardTextureFull;
    const teeth = isFull ? this.deathHazardTeethTextureFull : this.deathHazardTeethTextureStrip;
    const pool = isFull ? this.deathHazardPoolTextureFull : this.deathHazardPoolTextureStrip;
    if (!teeth || !pool) {
      return null;
    }
    return { teeth, pool };
  }

  private getLava2SplitDisplayHeights(
    layout: { texture: Texture; height: number },
  ): { teethH: number; poolH: number } {
    const texH = Math.max(1, layout.texture.height);
    const splitLocalY = this.getLava2DisqualifyLineLocalY(layout.texture);
    const poolH = layout.height * ((texH - splitLocalY) / texH);
    return { teethH: layout.height - poolH, poolH };
  }

  private createLava2PartTexture(
    source: Texture['source'],
    frame: { x: number; y: number; width: number; height: number },
    splitLocalY: number,
    part: 'teeth' | 'pool',
  ): Texture {
    const y = part === 'teeth' ? frame.y : frame.y + splitLocalY;
    const height = part === 'teeth' ? splitLocalY : frame.height - splitLocalY;
    return new Texture({
      source,
      frame: new Rectangle(frame.x, y, frame.width, height),
    });
  }

  /**
   * World Y of the invisible disqualify row baked into `lava 2.png` — scales/moves with drawn hazard art.
   */
  private getLava2DisqualifyLineWorldY(): number {
    const layout = this.getDeathLavaArtLayout();
    if (!layout) {
      return this.cameraY + this.worldHeightFromScreen();
    }
    const spriteBottom =
      layout.bottomWorldY + this.getLava2DrawBobOffsetY() + LINE_POWER_NUDGE_DOWN_PX;
    const texH = Math.max(1, layout.texture.height);
    const localY = Math.max(0, Math.min(texH - 1, this.getLava2DisqualifyLineLocalY(layout.texture)));
    const offsetFromTop = (localY / texH) * layout.height;
    return spriteBottom - layout.height + offsetFromTop;
  }

  /** Strip at rest; full `lava 2` rises on landed meters only — viewport-fixed, not jump physics. */
  private getDeathLavaArtLayout(): {
    texture: Texture;
    height: number;
    bottomWorldY: number;
  } | null {
    const stripTex = this.deathHazardTextureStrip;
    const fullTex = this.deathHazardTextureFull;
    if (!stripTex) {
      return null;
    }
    const padSpan = 60;
    const stripW = Math.max(1, this.worldWidthFromScreen()) + padSpan;
    const vh = Math.max(1, this.worldHeightFromScreen());
    const viewportBottom = this.cameraY + vh;
    const factor = this.getDeathLavaLiftFactor();
    const stripH = this.deathHazardStripHeightForWidth(stripW, stripTex);
    const fullH = fullTex
      ? this.deathHazardStripHeightForWidth(stripW, fullTex)
      : stripH;

    if (factor <= 0 || !fullTex) {
      return { texture: stripTex, height: stripH, bottomWorldY: viewportBottom };
    }

    const restTeethTopY = viewportBottom - stripH;
    const targetTeethTopY = this.cameraY + vh * DEATH_LAVA_LIFT_TARGET_TEETH_TOP_RATIO;
    const teethTopY = restTeethTopY + (targetTeethTopY - restTeethTopY) * factor;
    return {
      texture: fullTex,
      height: fullH,
      bottomWorldY: teethTopY + fullH,
    };
  }

  /**
   * Lava phase gates — {@link getBestLandedClimbMeters} only (never HUD air / super-jump altitude).
   */
  private getDeathLavaLiftMetersProgress(): number {
    const climbM = Math.max(0, this.getBestLandedClimbMeters());
    const cycleM = climbM % DEATH_LAVA_LIFT_CYCLE_METERS;
    return cycleM < 0 ? cycleM + DEATH_LAVA_LIFT_CYCLE_METERS : cycleM;
  }

  /**
   * Rise = steady tap-fill timer from 3500m gate (4000–6000m hold once full).
   * Descent = landed-meter elevator segment 6000→6250.
   */
  private tickDeathLavaLift(dt: number): void {
    const landedM = Math.max(0, this.getBestLandedClimbMeters());
    const m = this.getDeathLavaLiftMetersProgress();
    const cycleIndex = Math.floor(landedM / DEATH_LAVA_LIFT_CYCLE_METERS);
    if (cycleIndex !== this.deathLavaLiftCycleIndex) {
      this.deathLavaLiftCycleIndex = cycleIndex;
      this.deathLavaRiseElapsedSec = 0;
    }

    let target: number;
    const descending = m >= DEATH_LAVA_LIFT_HOLD_END_METERS && m < DEATH_LAVA_LIFT_DESCEND_END_METERS;

    if (m < DEATH_LAVA_LIFT_RISE_START_METERS) {
      target = 0;
      this.deathLavaRiseElapsedSec = 0;
    } else if (descending) {
      const t = (m - DEATH_LAVA_LIFT_HOLD_END_METERS) /
        (DEATH_LAVA_LIFT_DESCEND_END_METERS - DEATH_LAVA_LIFT_HOLD_END_METERS);
      target = 1 - easeInOutElevator01(t);
    } else if (m >= DEATH_LAVA_LIFT_DESCEND_END_METERS) {
      target = 0;
      this.deathLavaRiseElapsedSec = 0;
    } else {
      // 3500–6000: linear tap-fill — climb speed / skills cannot accelerate this.
      this.deathLavaRiseElapsedSec += dt;
      target = Math.min(1, this.deathLavaRiseElapsedSec / DEATH_LAVA_LIFT_RISE_DURATION_SEC);
    }

    if (m >= DEATH_LAVA_LIFT_RISE_START_METERS && m < DEATH_LAVA_LIFT_HOLD_END_METERS) {
      this.deathLavaLiftDisplayFactor = target;
      return;
    }

    const alpha = 1 - Math.exp(-DEATH_LAVA_LIFT_DESCEND_SMOOTH_RATE * dt);
    this.deathLavaLiftDisplayFactor += (target - this.deathLavaLiftDisplayFactor) * alpha;
    if (Math.abs(target - this.deathLavaLiftDisplayFactor) < 0.0008) {
      this.deathLavaLiftDisplayFactor = target;
    }
  }

  /** Smoothed lift factor used by hazard art. */
  private getDeathLavaLiftFactor(): number {
    return this.deathLavaLiftDisplayFactor;
  }

  private getLava2DrawBobOffsetY(): number {
    return (Math.sin(Date.now() * 0.005) + 0.4) * 5;
  }

  /** World AABB of drawn `lava 2` (matches {@link drawBottomDeathLine} + anchor 0,1). */
  private getLava2VisualWorldBounds(): {
    left: number;
    top: number;
    right: number;
    bottom: number;
  } {
    const padX = 30;
    const left = this.cameraX - padX;
    const width = Math.max(1, this.worldWidthFromScreen()) + padX * 2;
    const layout = this.getDeathLavaArtLayout();
    const bottom = layout
      ? layout.bottomWorldY + this.getLava2DrawBobOffsetY() + LINE_POWER_NUDGE_DOWN_PX
      : this.cameraY + this.worldHeightFromScreen() + LINE_POWER_NUDGE_DOWN_PX;
    const height = layout?.height ?? DEATH_HAZARD_BAND_PX;
    return { left, top: bottom - height, right: left + width, bottom };
  }

  /** Orange molten pool band only — depth sort uses this, not the teeth/disqualify seam. */
  private getLava2PoolWorldBounds(): {
    left: number;
    top: number;
    right: number;
    bottom: number;
  } {
    const padX = 30;
    const left = this.cameraX - padX;
    const width = Math.max(1, this.worldWidthFromScreen()) + padX * 2;
    const layout = this.getDeathLavaArtLayout();
    const bob = this.getLava2DrawBobOffsetY();
    const nudge = LINE_POWER_NUDGE_DOWN_PX;
    const bottom = layout
      ? layout.bottomWorldY + bob + nudge
      : this.cameraY + this.worldHeightFromScreen() + nudge;
    const poolH = layout
      ? this.getLava2SplitDisplayHeights(layout).poolH
      : DEATH_ORANGE_BAR_HEIGHT_PX;
    return { left, top: bottom - poolH, right: left + width, bottom };
  }

  /** Sprite extends below physics feet — use for lava depth sort. */
  private getPlayerLavaDepthBounds(): {
    left: number;
    top: number;
    right: number;
    bottom: number;
  } {
    const b = this.player.body;
    const cx = b.x + b.width * 0.5;
    const halfW = Math.max(b.width, 38) * 0.55;
    return {
      left: cx - halfW,
      right: cx + halfW,
      top: b.y - PLAYER_LAVA_DEPTH_HEAD_PAD_PX,
      bottom: b.y + b.height + PLAYER_LAVA_DEPTH_FEET_PAD_PX,
    };
  }

  /** Molten pool overlap — avatar below teeth (23); pool layer (45) covers on top. */
  private shouldPlayerRenderBehindLava(): boolean {
    const b = this.player.body;
    const pool = this.getLava2PoolWorldBounds();
    const p = this.getPlayerLavaDepthBounds();
    const horizOverlap = !(p.right < pool.left || p.left > pool.right);

    if (b.vy < -70) {
      if (p.bottom <= pool.top - 10) {
        this.playerFallingBehindLava = false;
      }
      return false;
    }

    const inPool =
      horizOverlap && p.bottom > pool.top - 2 && p.top < pool.bottom;

    if (inPool) {
      this.playerFallingBehindLava = true;
      return true;
    }

    if (this.playerFallingBehindLava && horizOverlap && p.bottom > pool.top - 8) {
      return true;
    }

    if (p.bottom <= pool.top - 12) {
      this.playerFallingBehindLava = false;
    }
    return false;
  }

  private syncPlayerDepthRelativeToLava(): void {
    this.player.zIndex = this.shouldPlayerRenderBehindLava()
      ? PLAYER_BEHIND_LAVA_Z_INDEX
      : PLAYER_WORLD_Z_INDEX;
    this.world.sortChildren();
  }

  /** Floating origin: keep stair / body Y in a moderate range so far climbs stay stable in JS + Pixi. */
  private maybeRebaseWorldVerticalOrigin(): void {
    if (
      this.shouldPausePlatformGeneration() ||
      this.gameOver ||
      this.cameraFrozenUntilFirstFloor0Jump
    ) {
      return;
    }
    let iterations = 0;
    while (
      this.player.body.y < WORLD_REBASE_LOW_WATER_Y &&
      iterations < 16
    ) {
      this.applyUniformWorldYOffset(WORLD_REBASE_SHIFT_PX);
      iterations += 1;
    }
  }

  /**
   * Applies the same +ΔY to every live world-space Y we own so climb metrics that use `climbBaseline − body`
   * stay unchanged while absolute coordinates move.
   */
  private applyUniformWorldYOffset(deltaY: number): void {
    for (const p of this.platforms) {
      p.y += deltaY;
    }

    const b = this.player.body;
    b.y += deltaY;
    this.climbBaselineY += deltaY;
    this.cameraY += deltaY;

    if (this.activeRestFloorY !== null) {
      this.activeRestFloorY += deltaY;
    }
    if (this.restFloorHoldY !== null) {
      this.restFloorHoldY += deltaY;
    }
    if (this.lastScoredLandWorldTopY !== Number.POSITIVE_INFINITY) {
      this.lastScoredLandWorldTopY += deltaY;
    }
    if (Number.isFinite(this.comboLastJumpY)) {
      this.comboLastJumpY += deltaY;
    }

    const g = this.grapple;
    if (g) {
      g.targetY += deltaY;
      g.pullStartY += deltaY;
    }

    for (const r of this.ripples) {
      r.y += deltaY;
    }
    for (const s of this.diamondShineSparks) {
      s.y += deltaY;
    }
    for (const p of this.levelUpParticles) {
      p.y += deltaY;
    }
    for (const p of this.comboSuperJumpParticles) {
      p.y += deltaY;
    }
    for (const w of this.windParticles) {
      w.y += deltaY;
    }

    this.world.position.set(-this.cameraX, -this.cameraY);
    this.layoutBackground();
  }

  /** World-Y threshold: anything farther below the camera bottom than this is culled aggressively. */
  private getCullBelowWorldY(): number {
    return this.getDeathPlaneWorldY() + VIEWPORT_BOTTOM_CULL_EXTRA_PX;
  }

  /**
   * Stairs recycle through {@link recycleStairsOffscreen}; this pass tears down pooled VFX and enemies whose
   * anchors sit well below the view so memory stays flat on long climbs.
   */
  private cullDisposableWorldFarBelowViewport(): void {
    const yCut = this.getCullBelowWorldY();

    this.ripples = this.ripples.filter((r) => r.y <= yCut);
    this.diamondShineSparks = this.diamondShineSparks.filter((s) => s.y <= yCut);
    this.windParticles = this.windParticles.filter((w) => w.y <= yCut);

    for (let i = this.levelUpParticles.length - 1; i >= 0; i -= 1) {
      if (this.levelUpParticles[i].y > yCut) {
        this.levelUpParticles.splice(i, 1);
      }
    }
    for (let i = this.comboSuperJumpParticles.length - 1; i >= 0; i -= 1) {
      if (this.comboSuperJumpParticles[i].y > yCut) {
        this.comboSuperJumpParticles.splice(i, 1);
      }
    }

  }

  /** Every 1000 climb meters, tighten transient particle pools so allocations do not creep upward. */
  private maybeRunPeriodicPoolMaintenance(): void {
    const m = Math.max(this.getHudClimbMeters(), this.getBestLandedClimbMeters());
    const band = Math.floor(Math.max(0, m) / 1000);
    if (band <= this.lastPoolSweepKmBand) {
      return;
    }
    this.lastPoolSweepKmBand = band;
    const yCut = this.getCullBelowWorldY();
    this.ripples = this.ripples.filter((r) => r.y <= yCut);
    this.diamondShineSparks = this.diamondShineSparks.slice(-64);
    this.windParticles = this.windParticles.slice(0, ALTITUDE_WIND_MAX_PARTICLES);
    if (this.levelUpParticles.length > MAX_LEVEL_UP_PARTICLES_AFTER_CLEANUP) {
      this.levelUpParticles = this.levelUpParticles.slice(-MAX_LEVEL_UP_PARTICLES_AFTER_CLEANUP);
    }
    if (this.comboSuperJumpParticles.length > MAX_COMBO_SUPER_JUMP_PARTICLES_AFTER_CLEANUP) {
      this.comboSuperJumpParticles = this.comboSuperJumpParticles.slice(
        -MAX_COMBO_SUPER_JUMP_PARTICLES_AFTER_CLEANUP,
      );
    }
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

  /** Slide wall-ride can drop the player — keep the stair pool fixed until they land again. */
  private shouldPauseStairRecycleDuringSlideFall(): boolean {
    return (
      this.isSlidePhase &&
      !this.player.body.grounded &&
      this.player.body.vy > STAIRS.slideFallPauseRecycleVy
    );
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
    return this.platformSystem.getRestFloorPlatformBounds();
  }

  /** Match {@link getRestFloorPlatformBounds} — shared wide span for Floor 0 spawn deck (no rest-floor gameplay hooks). */
  private getFloorZeroSpawnPlatformBounds(): { x: number; width: number } {
    return this.platformSystem.getFloorZeroSpawnPlatformBounds();
  }

  private resetPlayer(): void {
    this.snapPlayerOntoStairZero();
    this.player.body.vx = 0;
    this.player.body.vy = 0;
    this.player.body.grounded = true;
    this.restWallBounceAppliedThisFrame = false;
    this.restWallChainEligible = true;
    this.icyRunChargePxPerSec = 0;
    this.restWallKickCooldownUntil = 0;
    this.player.hasTouchedPlatformSinceLastSlide = true;
    this.grapple = null;
    this.grappleCooldown = 0;
    this.grappleReleaseDampingLeft = 0;
    this.grappleReloadingLogged = false;
    this.lastScoredStairId = this.platforms[0]?.stairId ?? 0;
    this.lastScoredLandWorldTopY = this.platforms[0]?.y ?? Number.POSITIVE_INFINITY;
    const deck = this.platforms[0];
    if (deck) {
      this.lastLandedPlatform = deck;
    }
    this.player.update(0, 0, false, null, false, this.fallShields > 0);
  }

  private landOn(platform: Platform): void {
    this.lastLandedPlatform = platform;
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

    this.platforms = nextPlatforms;
    this.currentGroundPlatform = restPlatform;
    if (this.lastLandedPlatform !== null && !this.platforms.includes(this.lastLandedPlatform)) {
      this.lastLandedPlatform = restPlatform;
    }
    if (this.grapple && !this.platforms.some((platform) => platform.stairId === this.grapple?.hookStairId)) {
      this.grapple = null;
    }
    this.rebuildPlatformSprites();
  }

  private resumePlatformsAboveRestFloor(restY: number): void {
    const restPlatform = this.platforms.find(
      (platform) => platform.kind === 'rest' && Math.abs(platform.y - restY) < 0.5,
    );
    if (!restPlatform) {
      return;
    }

    // Keep stairs that were already above the rest tier (already filtered by {@link clearPlatformsBelowRestFloor}).
    // Rebuilding `[rest]` from scratch used to regenerate x/gaps/stairIds and made the staircase "jump".
    this.collectibles = [];
    const maxStairId = Math.max(0, ...this.platforms.map((p) => p.stairId));
    this.nextStairId = maxStairId;

    let previousTopY = Math.min(...this.platforms.map((p) => p.y));
    while (this.platforms.length < STAIRS.poolCount) {
      this.nextStairId += 1;
      const y = previousTopY - this.computeStairGapPx(this.nextStairId);
      const platform: Platform = {
        x: 0,
        y,
        width: 0,
        height: STAIRS.platformHeight,
        baseWidth: PLATFORM_SIZING.uniformBaseWidth,
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

    this.currentGroundPlatform = null;
    this.lastLandedPlatform = restPlatform;
    if (this.grapple && !this.platforms.some((platform) => platform.stairId === this.grapple?.hookStairId)) {
      this.grapple = null;
    }
    this.rebuildPlatformSprites();
    this.spawnCollectibleField();
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

  /** First grounded jump off Floor 0 — ends {@link cameraFrozenUntilFirstFloor0Jump}. */
  private maybeEndFloor0IntroCameraFreeze(): void {
    if (!this.cameraFrozenUntilFirstFloor0Jump) {
      return;
    }
    this.cameraFrozenUntilFirstFloor0Jump = false;
  }

  private updateCamera(dt: number): void {

    const viewportW = this.worldWidthFromScreen();
    const viewportH = this.worldHeightFromScreen();
    const playerCy = this.player.body.y + this.player.body.height * 0.5;
    const cameraYBefore = this.cameraY;
    this.cameraX = (this.worldWidth - viewportW) * 0.5;
    if (this.cameraFrozenUntilFirstFloor0Jump) {
      const maxCamXFrozen = Math.max(0, this.worldWidth - viewportW);
      this.cameraX = Math.max(0, Math.min(this.cameraX, maxCamXFrozen));
      this.cameraScrollVelocityPx = 0;
      this.world.position.set(-this.cameraX, -this.cameraY);
      this.layoutBackground();
      return;
    }
    if (this.isRestFloorHolding()) {
      const maxCamX = Math.max(0, this.worldWidth - viewportW);
      this.cameraX = Math.max(0, Math.min(this.cameraX, maxCamX));
      this.cameraScrollVelocityPx = 0;
      this.world.position.set(-this.cameraX, -this.cameraY);
      this.layoutBackground();
      return;
    }
    if (this.gameOver) {
      const maxCamX = Math.max(0, this.worldWidth - viewportW);
      this.cameraX = Math.max(0, Math.min(this.cameraX, maxCamX));
      this.cameraScrollVelocityPx = 0;
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

    this.cameraScrollVelocityPx = (this.cameraY - cameraYBefore) / Math.max(dt, 1e-4);

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

  /** Single-scene backdrop (`canndy.png`) — clamp so parallax does not tile the art. */
  private prepareTextureForBackgroundScene(tex: Texture): void {
    tex.source.style.addressModeU = 'clamp-to-edge';
    tex.source.style.addressModeV = 'clamp-to-edge';
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
    this.bgBackdropFill.zIndex = BG_Z_BACKDROP_FILL;
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
    this.bgOverlayRoot.zIndex = 100;
    this.bgOverlayMask.zIndex = 101;
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
      tile.zIndex = 0;
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
    if (STATIC_BACKGROUND_TESET3_PHOTOROOM_ONLY) {
      return;
    }
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
    if (!STATIC_BACKGROUND_TESET3_PHOTOROOM_ONLY) {
      await this.loadBackgroundTierIntoMap(BACKGROUND_TIERS[0]);
    }
    this.ensureBackgroundBackdropFill();
    if (!STATIC_BACKGROUND_TESET3_PHOTOROOM_ONLY) {
      const initialTier = this.getLoadedBackgroundTierForMeters(0);
      if (initialTier) {
        this.rebuildBackgroundTiles(initialTier, vw, vh);
      }
    }
  }

  /**
   * After the first frame of gameplay: extra BG tiers, decorative platform atlases, DragonBones tongue.
   */
  private async finishDeferredPlaySceneLoadsForMobile(): Promise<void> {
    if (!STATIC_BACKGROUND_TESET3_PHOTOROOM_ONLY) {
      for (let i = 1; i < BACKGROUND_TIERS.length; i += 1) {
        await this.loadBackgroundTierIntoMap(BACKGROUND_TIERS[i]);
      }
    }
    this.layoutBackground();
    await this.loadPlatformSpriteDecorAndAltTextures();
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

    if (!STATIC_BACKGROUND_TESET3_PHOTOROOM_ONLY) {
      for (const tier of BACKGROUND_TIERS) {
        await this.loadBackgroundTierIntoMap(tier);
      }
    }

    this.ensureBackgroundBackdropFill();
    if (!STATIC_BACKGROUND_TESET3_PHOTOROOM_ONLY) {
      const initialTier = this.getLoadedBackgroundTierForMeters(0);
      if (initialTier) {
        this.rebuildBackgroundTiles(initialTier, vw, vh);
      }
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

    const backdropColor =
      USE_CANDY_STATIC_ATMOSPHERE &&
      this.atmosphereManager?.isReady &&
      this.getHudClimbMeters() >= BACKGROUND_TIER_SWITCH_METERS
        ? BACK_5000_BACKDROP_COLOR
        : this.currentBackgroundColor;
    this.bgBackdropFill.clear();
    this.bgBackdropFill.rect(0, 0, vw, vh).fill({ color: backdropColor, alpha: 1 });

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

    /** teset 3 — bottom aligns with top of orange death strip (tiles scroll slowly). teset 2/1: see {@link syncPhotoroomTeset12ScreenAnchoredOscillation}. */
    const orangeBarTopY = vh - DEATH_ORANGE_BAR_HEIGHT_PX;
    const hAboveOrange = Math.max(1, orangeBarTopY);

    const layPhotoroomAboveOrangeDeathLine = (node: Sprite | TilingSprite | null): void => {
      if (!node) {
        return;
      }
      node.anchor.set(0.5, 1);
      node.position.set(vw * 0.5, orangeBarTopY);
      node.width = vw;
      node.height = hAboveOrange;
    };
    layPhotoroomAboveOrangeDeathLine(this.bgStaticTeset3Tile);
    // teset 2/1: positioned after {@link layoutBackground} in {@link syncPhotoroomTeset12ScreenAnchoredOscillation}
    // so Y is not reset here every frame (would kill sine oscillation on layer 2).

    if (this.atmosphereManager?.isReady) {
      this.atmosphereManager.layout({
        viewportW: vw,
        viewportH: vh,
        bottomAnchorY: orangeBarTopY,
        cameraY: this.cameraY,
        climbMeters: this.getHudClimbMeters(),
      });
      if (this.bgStaticTeset3Tile) {
        this.bgStaticTeset3Tile.visible = false;
      }
    } else {
      this.syncTeset3PhotoroomTileScroll();
    }
  }

  /**
   * Phaser-style Photoroom placement: layer 1 locked to viewport center Y; layer 2 sine around that anchor.
   * `time` = accumulated ticker ms (never undefined). Runs last in {@link update} so nothing overrides Y after.
   */
  private syncPhotoroomTeset12ScreenAnchoredOscillation(time: number): void {
    const teset1Photoroom = this.bgStaticTeset1Sprite;
    const teset2Photoroom = this.bgStaticTeset2Sprite;
    const vw = this.worldWidthFromScreen();
    const vh = this.worldHeightFromScreen();
    const centerY = vh * 0.5;
    const orangeBarTopY = vh - DEATH_ORANGE_BAR_HEIGHT_PX;
    const hAboveOrange = Math.max(1, orangeBarTopY);

    if (teset1Photoroom) {
      teset1Photoroom.anchor.set(0.5, 0.5);
      teset1Photoroom.position.set(vw * 0.5, centerY);
      teset1Photoroom.width = vw;
      teset1Photoroom.height = hAboveOrange;
    }

    if (teset2Photoroom) {
      const slowSpeed = time * 0.001;
      const microRange = 8;
      teset2Photoroom.anchor.set(0.5, 0.5);
      teset2Photoroom.position.set(
        vw * 0.5,
        centerY + Math.sin(slowSpeed) * microRange,
      );
      teset2Photoroom.width = vw;
      teset2Photoroom.height = hAboveOrange;
    }
  }

  private syncTeset3PhotoroomTileScroll(): void {
    const tile = this.bgStaticTeset3Tile;
    if (!tile) {
      return;
    }
    tile.tilePosition.set(
      -this.cameraX * TESET3_PHOTOROOM_SCROLL_FACTOR,
      -this.cameraY * TESET3_PHOTOROOM_SCROLL_FACTOR,
    );
  }

  /** Integer HUD meters — matches altitude used for scoring (includes run peak). */
  private get playerDistance(): number {
    return Math.floor(
      Math.max(
        this.getHudClimbMeters(),
        this.getBestLandedClimbMeters(),
        this.peakClimbMetersThisRun,
      ),
    );
  }

  /** Strict-task — Phaser `teset1Photoroom`; Pixi foreground Photoroom sprite. */
  private get teset1Photoroom(): Sprite | null {
    return this.bgStaticTeset1Sprite;
  }

  /** Strict-task — Phaser `teset2Photoroom`; Pixi mid Photoroom sprite. */
  private get teset2Photoroom(): Sprite | null {
    return this.bgStaticTeset2Sprite;
  }

  private resetBackground1kSwapState(): void {
    this.bgChangedAt1k = false;
    this.bgChangedAt2k = false;
    this.bgChangedAt3k = false;
    this.bgChangedAt5k = false;
    const sky = this.bgStaticTeset3Tile;
    const b3 = this.bgStaticTeset3BaseTexture;
    if (sky && b3) {
      sky.texture = b3;
      this.syncTeset3FarSkyTileScaleForTexture(b3);
    }
  }

  /**
   * `sky 4.png` and siblings may export at different pixel sizes than the teset-3 base; normalize
   * {@link TilingSprite.tileScale} so horizontal/vertical repeat matches {@link bgStaticTeset3BaseTexture}.
   */
  private syncTeset3FarSkyTileScaleForTexture(tex: Texture): void {
    const tile = this.bgStaticTeset3Tile;
    const ref = this.bgStaticTeset3BaseTexture;
    if (!tile) {
      return;
    }
    const rw = ref?.source.width ?? tex.source.width;
    const rh = ref?.source.height ?? tex.source.height;
    const tw = tex.source.width;
    const th = tex.source.height;
    if (tw <= 0 || th <= 0 || rw <= 0 || rh <= 0) {
      tile.tileScale.set(1);
      return;
    }
    tile.tileScale.set(rw / tw, rh / th);
  }

  /**
   * מחיל את טקסטורת `sky.png` רק על שכבת השמיים **האחורית** (`bgStaticTeset3Tile` — tiling).
   */
  private applyBackground1kTextureToAllSkyLayers(tex: Texture): void {
    const skyTile = this.bgStaticTeset3Tile;
    if (skyTile) {
      skyTile.texture = tex;
      this.syncTeset3FarSkyTileScaleForTexture(tex);
    }
  }

  /**
   * Altitude milestones still run for save-state flags; all tiers use `canndy.png` so the art stays identical.
   */
  private maybeTriggerFarSkyTextureMilestones(): void {
    const d = this.playerDistance;
    if (d >= 5000 && !this.bgChangedAt5k) {
      const tex = this.background5kSkyTexture;
      if (tex) {
        this.applyBackground1kTextureToAllSkyLayers(tex);
        this.bgChangedAt5k = true;
      }
    } else if (d >= 3000 && !this.bgChangedAt3k) {
      const tex = this.background3kSkyTexture;
      if (tex) {
        this.applyBackground1kTextureToAllSkyLayers(tex);
        this.bgChangedAt3k = true;
      }
    } else if (d >= 2000 && !this.bgChangedAt2k) {
      const tex = this.background2kSkyTexture;
      if (tex) {
        this.applyBackground1kTextureToAllSkyLayers(tex);
        this.bgChangedAt2k = true;
      }
    } else if (d >= 1000 && !this.bgChangedAt1k) {
      const tex = this.background1kTexture;
      if (tex) {
        this.applyBackground1kTextureToAllSkyLayers(tex);
        this.bgChangedAt1k = true;
      }
    }
  }

  private async loadStaticTeset3BackgroundLayer(): Promise<void> {
    const vw = Math.max(1, this.worldWidthFromScreen());
    const vh = Math.max(1, this.worldHeightFromScreen());

    if (USE_CANDY_STATIC_ATMOSPHERE && this.atmosphereManager) {
      const loaded = await this.atmosphereManager.load();
      if (loaded) {
        this.hideLegacyCandyBackdropTile();
        return;
      }
      console.warn('[PlayScene] Candy static atmosphere failed — falling back to canndy.png');
    }

    if (USE_CANDY_CANYON_PARALLAX) {
      console.warn('[PlayScene] Candy canyon parallax is disabled — falling back to canndy.png');
    }

    try {
      const baseTex = await this.loadTextureFromCandidates(STATIC_BG_TESET3_CANDIDATES);
      this.prepareTextureForBackgroundScene(baseTex);
      this.bgStaticTeset3BaseTexture = baseTex;

      try {
        const skyTex = await this.loadTextureFromCandidates(
          STATIC_BG_TESET3_POST_REST_1K_CANDIDATES,
        );
        this.prepareTextureForBackgroundScene(skyTex);
        this.background1kTexture = skyTex;
      } catch (error) {
        console.error('CRITICAL ERROR: Failed to load canndy.png (1k milestone)!', error);
        this.background1kTexture = undefined;
      }

      try {
        const sky3Tex = await this.loadTextureFromCandidates(
          STATIC_BG_TESET3_POST_REST_2K_CANDIDATES,
        );
        this.prepareTextureForBackgroundScene(sky3Tex);
        this.background2kSkyTexture = sky3Tex;
      } catch (error) {
        console.error('CRITICAL ERROR: Failed to load canndy.png (2k milestone)!', error);
        this.background2kSkyTexture = undefined;
      }

      try {
        const sky4Tex = await this.loadTextureFromCandidates(
          STATIC_BG_TESET3_POST_REST_3K_CANDIDATES,
        );
        this.prepareTextureForBackgroundScene(sky4Tex);
        this.background3kSkyTexture = sky4Tex;
      } catch (error) {
        console.error('CRITICAL ERROR: Failed to load canndy.png (3k milestone)!', error);
        this.background3kSkyTexture = undefined;
      }

      try {
        const sky5Tex = await this.loadTextureFromCandidates(
          STATIC_BG_TESET3_POST_REST_5K_CANDIDATES,
        );
        this.prepareTextureForBackgroundScene(sky5Tex);
        this.background5kSkyTexture = sky5Tex;
      } catch (error) {
        console.error('CRITICAL ERROR: Failed to load canndy.png (5k milestone)!', error);
        this.background5kSkyTexture = undefined;
      }

      const hAboveOrange = Math.max(1, vh - DEATH_ORANGE_BAR_HEIGHT_PX);
      const orangeBarTopY = vh - DEATH_ORANGE_BAR_HEIGHT_PX;
      const tile = new TilingSprite({
        texture: baseTex,
        width: vw,
        height: hAboveOrange,
      });
      tile.eventMode = 'none';
      tile.roundPixels = false;
      tile.zIndex = BG_Z_TESET3_STATIC;
      tile.anchor.set(0.5, 1);
      tile.position.set(vw * 0.5, orangeBarTopY);
      tile.tilePosition.set(0, 0);
      this.bgStaticTeset3Tile = tile;
      this.attachStaticTeset3TileBehindParallax();
    } catch (error) {
      console.error(
        'CRITICAL ERROR: Failed to load base teset-3 background stack (outer load).',
        error,
      );
      this.bgStaticTeset3Tile = null;
      this.bgStaticTeset3BaseTexture = undefined;
      this.background1kTexture = undefined;
      this.background2kSkyTexture = undefined;
      this.background3kSkyTexture = undefined;
      this.background5kSkyTexture = undefined;
    }
  }

  private hideLegacyCandyBackdropTile(): void {
    if (this.bgStaticTeset3Tile) {
      this.bgStaticTeset3Tile.visible = false;
    }
  }

  private attachStaticTeset3TileBehindParallax(): void {
    const tile = this.bgStaticTeset3Tile;
    if (!tile || this.backgroundRoot.children.includes(tile)) {
      return;
    }
    this.ensureBackgroundBackdropFill();
    const fillIdx = this.backgroundRoot.children.indexOf(this.bgBackdropFill);
    const at = fillIdx >= 0 ? fillIdx + 1 : 0;
    this.backgroundRoot.addChildAt(tile, Math.min(at, this.backgroundRoot.children.length));
  }

  /** Legacy tree/grass Photoroom layers — superseded by full-scene `canndy.png`. */
  private async loadPhotoroomStaticMidForegroundSprites(): Promise<void> {
    if (this.bgStaticTeset1Sprite) {
      this.backgroundRoot.removeChild(this.bgStaticTeset1Sprite);
      this.bgStaticTeset1Sprite.destroy();
      this.bgStaticTeset1Sprite = null;
    }
    if (this.bgStaticTeset2Sprite) {
      this.backgroundRoot.removeChild(this.bgStaticTeset2Sprite);
      this.bgStaticTeset2Sprite.destroy();
      this.bgStaticTeset2Sprite = null;
    }
  }

  private updateScreenShake(dt: number): void {
    if (!SCORE_UI.screenShakeEnabled) {
      if (this.shakeTime > 0) {
        this.shakeTime = Math.max(0, this.shakeTime - dt);
      }
      this.shakeOffsetX = 0;
      this.shakeOffsetY = 0;
      this.applyCameraTransform();
      return;
    }

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

  /**
   * Single source for HUD + Firebase `totalScore`: continuous climb meters (same basis as HUD peak)
   * plus current combo streak. No per-stair or pickup spikes — the number ramps with altitude.
   */
  private recomputeDerivedTotalScore(): void {
    const meters = Math.max(
      0,
      Math.max(this.getHudClimbMeters(), this.peakClimbMetersThisRun, this.getBestLandedClimbMeters()),
    );
    const raw = meters * SCORE_METERS_MULTIPLIER + this.comboCount * SCORE_COMBO_MULTIPLIER;
    const next = Math.max(0, Math.floor(raw));
    const rise = next - this.scoreHudSyncBaseline;
    this.score = next;
    if (rise > 0) {
      this.maybeTriggerScreenShake(rise);
    }
    this.scoreHudSyncBaseline = next;
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

  /** Same landed-meter window as lava rise/hold ({@link tickDeathLavaLift}). */
  private shouldPlayStressModeBgm(): boolean {
    if (!ENABLE_STRESS_MODE_BGM) {
      return false;
    }
    const m = Math.max(0, this.getBestLandedClimbMeters());
    return m >= DEATH_LAVA_LIFT_RISE_START_METERS && m < DEATH_LAVA_LIFT_HOLD_END_METERS;
  }

  private tickStressModeBgm(): void {
    if (this.gameOver || !this.bgm) {
      return;
    }
    const wantStress = this.shouldPlayStressModeBgm();
    if (wantStress && this.bgmTrackKind !== 'stress') {
      this.savedGameBgmUrl = this.bgm.src || this.lastGameMusicBgmUrl;
      this.playBackgroundMusicTrack(STRESS_MODE_BGM_URL, 'stress');
      return;
    }
    if (!wantStress && this.bgmTrackKind === 'stress') {
      const resume =
        this.savedGameBgmUrl && this.savedGameBgmUrl !== STRESS_MODE_BGM_URL
          ? this.savedGameBgmUrl
          : this.pickRandomGameMusicBgmUrl();
      this.savedGameBgmUrl = null;
      this.playBackgroundMusicTrack(resume, 'game');
    }
  }

  private playBackgroundMusicTrack(url: string, kind: 'game' | 'stress'): void {
    this.stopBackgroundMusic();
    const bgm = new Audio(url);
    bgm.loop = true;
    bgm.volume = 0.2;
    this.bgm = bgm;
    this.bgmTrackKind = kind;
    if (kind === 'game') {
      this.lastGameMusicBgmUrl = url;
    }
    void bgm.play().catch(() => {
      /* autoplay: may need user gesture */
    });
  }

  private startBackgroundMusic(): void {
    this.bgmTrackKind = 'game';
    this.savedGameBgmUrl = null;
    this.playBackgroundMusicTrack(this.pickRandomGameMusicBgmUrl(), 'game');
    this.tickStressModeBgm();
  }

  private stopBackgroundMusic(): void {
    if (this.bgm) {
      this.bgm.pause();
      this.bgm.removeAttribute('src');
      this.bgm.load();
    }
    this.bgm = undefined;
    this.bgmTrackKind = 'game';
    this.savedGameBgmUrl = null;
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
    const nextMilestone = Math.floor(this.level / LEVEL_MILESTONE_STEP);
    if (nextMilestone > previousMilestone) {
      this.currentBackgroundColor = this.getBackgroundColorForLevel(this.level);
      this.drawStaticWorld();
    }
  }

  private updatePlatformDifficulty(dt: number): void {
    void dt;
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
      p.baseWidth = PLATFORM_SIZING.uniformBaseWidth;
      p.width = this.getNormalPlatformWorldWidth();
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

  /** Integer climb meters used for HUD text, scroll tiers, and derived score. */
  private getHudScoreboardDisplayMeters(): number {
    return Math.max(0, Math.floor(this.getHudClimbMeters()), Math.floor(this.getBestLandedClimbMeters()));
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
   * Scroll / difficulty: linear ×1 → ×{@link SCROLL_SPEED_MAX_MULT} from warmup to 10k m (HUD climb).
   */
  private getAltitudeSpeedMultiplier(): number {
    const m = Math.max(
      this.getHudClimbMeters(),
      this.peakClimbMetersThisRun,
      this.getBestLandedClimbMeters(),
    );
    if (m <= SCROLL_SPEED_WARMUP_METERS) {
      return 1;
    }
    const rampSpan = Math.max(1, SCROLL_SPEED_RAMP_END_METERS - SCROLL_SPEED_WARMUP_METERS);
    const effM = Math.min(m - SCROLL_SPEED_WARMUP_METERS, rampSpan);
    return 1 + (SCROLL_SPEED_MAX_MULT - 1) * (effM / rampSpan);
  }

  private getCameraScrollSpeedPx(): number {
    return AUTO_SCROLL_BASE_SPEED_PX * this.getAltitudeSpeedMultiplier();
  }

  /** Tier index for speed feedback; tracks whole {@link SCROLL_SPEED_STEP_DELTA} steps above ×1. */
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
    this.syncPhotoroomTeset12ScreenAnchoredOscillation(this.photoroomOscTimeMs);
  }

  private drawDynamicWorld(): void {
    this.jelly.clear();
    this.platformLayer.clear();
    this.rippleLayer.clear();
    this.collectiblesGfx.clear();
    this.tongueVector.clear();
    this.fxLayer.clear();
    this.wallSparkSmokeGfx.clear();
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
    this.drawWallSlideSmokeParticles();
    this.drawWallSparkParticles();
    this.drawBottomDeathLine();
    this.drawWorldEdgeRestWalls();

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
      style: this.createFloatingHudTextStyle(18, '#ffe566', '#4a3200', 2.2),
    });
    this.collectibleHudDiamondText = new Text({
      text: '0',
      style: this.createFloatingHudTextStyle(18, '#b8f0ff', '#1a3050', 2.2),
    });
    this.collectibleHudShieldText = new Text({
      text: `${MAX_FALL_SHIELDS}`,
      style: this.createFloatingHudTextStyle(18, '#cce8ff', '#1a3050', 2.2),
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
      style: this.createFloatingHudTextStyle(13, TIMER_HUD_FILL, TIMER_HUD_STROKE, TIMER_HUD_STROKE_WIDTH),
    });
    this.climbHudText.anchor.set(1, 0);
    this.climbHudText.zIndex = 1003;
    this.climbHudText.alpha = 0.96;
    this.uiLayer.addChild(this.climbHudText);

    this.layoutClimbHud();
    this.refreshClimbHudText();
  }

  private layoutClimbHud(): void {
    this.layoutTimerClimbHudRow();
    this.layoutComboHudRoot();
    this.layoutSkillPairHud();
  }

  /** Meters/speed row — left of pause coin, combo occupies the former timer slot. */
  private layoutTimerClimbHudRow(): void {
    const rowY = TIMER_CLIMB_HUD_ROW_Y;
    const leftLimit = TIMER_HUD_LEFT_RESERVE_PX;
    const comboW = COMBO_BADGE_W * COMBO_HUD_ROOT_SCALE;

    if (this.climbHudText) {
      this.climbHudText.anchor.set(0, 0);
      this.climbHudText.position.set(
        leftLimit + comboW + TIMER_CLIMB_HUD_GAP_PX - CLIMB_HUD_SHIFT_LEFT_PX,
        rowY,
      );
    }
  }

  private refreshClimbHudText(): void {
    if (this.climbHudText) {
      const mult = this.getAltitudeSpeedMultiplier();
      const mApprox = Math.round(this.getClimbHeightPx() / 12);
      this.climbHudText.text = `${mApprox}M  |  SPD x${mult.toFixed(2)}`;
    }
  }

  /**
   * Combo UI lives under `uiLayer` only (never under `world` / `gameShake`) — fixed on screen while climbing,
   * equivalent to Phaser `scrollFactor(0)` / camera‑fixed HUD.
   */
  private layoutComboHudRoot(): void {
    const comboX = TIMER_HUD_LEFT_RESERVE_PX - TIMER_HUD_SHIFT_LEFT_PX;
    const comboY = TIMER_CLIMB_HUD_ROW_Y - TIMER_HUD_SHIFT_UP_PX;
    this.comboHudRoot.position.set(comboX, comboY);
    this.comboHudRoot.scale.set(COMBO_HUD_ROOT_SCALE);
  }

  /**
   * Combo badge → scaled `comboHudRoot`. Skill pair (`SUPER JUMP` + `PULL UP`) is a sibling on
   * `uiLayer` under the timer/header strip (`scrollFactor` 0 equivalent).
   */
  private setupComboHud(skillTextures: Awaited<ReturnType<typeof loadSkillButtonTextures>>): void {
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

    this.setupSkillFallbackButtons();

    this.skillButtonTextures = skillTextures;
    this.skillButtonsUseImageArt = skillTextures != null;
    if (skillTextures) {
      this.applySkillButtonArtLayout();
    } else {
      this.drawSuperJumpFallbackButton();
      this.drawPullUpFallbackButton();
    }
    this.updateSkillButtonArtMode();

    this.skillPairRoot.addChild(
      this.superJumpHudBtn.root,
      this.pullUpHudBtn.root,
      this.superJumpFallbackRoot,
      this.pullUpFallbackRoot,
    );

    this.comboHudRoot.addChild(this.comboBadge);
    this.uiLayer.addChild(this.comboHudRoot);
    this.uiLayer.addChild(this.skillPairRoot);
    this.layoutSkillPairHud();
    this.layoutComboHudRoot();
  }

  private setupSkillFallbackButtons(): void {
    this.superJumpFallbackRoot.position.set(0, 0);
    this.superJumpFallbackGfx.cursor = 'pointer';
    this.superJumpFallbackGfx.eventMode = 'none';
    this.superJumpFallbackLabel = new Text({
      text: 'SUPER JUMP',
      style: this.createNeonGoldTextStyle(12, 2.5),
    });
    this.superJumpFallbackLabel.anchor.set(0.5);
    this.superJumpFallbackLabel.position.set(
      SKILL_FALLBACK_BTN_W * 0.5,
      SKILL_FALLBACK_BTN_H * 0.5,
    );
    this.superJumpFallbackLabel.eventMode = 'none';
    this.superJumpFallbackRoot.addChild(this.superJumpFallbackGfx, this.superJumpFallbackLabel);
    this.superJumpFallbackGfx.hitArea = new Rectangle(0, 0, SKILL_FALLBACK_BTN_W, SKILL_FALLBACK_BTN_H);
    this.superJumpFallbackGfx.on('pointertap', (event) => {
      event.stopPropagation();
      this.fireManualSuperJump();
    });

    this.pullUpFallbackRoot.position.set(
      SKILL_FALLBACK_BTN_W + SKILL_PAIR_BTN_GAP_PX - SKILL_PULL_UP_NUDGE_LEFT_PX,
      0,
    );
    this.pullUpFallbackGfx.cursor = 'pointer';
    this.pullUpFallbackGfx.eventMode = 'none';
    this.pullUpFallbackLabel = new Text({
      text: 'PULL UP',
      style: this.createNeonGoldTextStyle(14, 3),
    });
    this.pullUpFallbackLabel.anchor.set(0.5);
    this.pullUpFallbackLabel.position.set(
      SKILL_FALLBACK_BTN_W * 0.5,
      SKILL_FALLBACK_BTN_H * 0.5,
    );
    this.pullUpFallbackLabel.eventMode = 'none';
    this.pullUpFallbackRoot.addChild(this.pullUpFallbackGfx, this.pullUpFallbackLabel);
    this.pullUpFallbackGfx.hitArea = new Rectangle(0, 0, SKILL_FALLBACK_BTN_W, SKILL_FALLBACK_BTN_H);
    this.pullUpFallbackGfx.on('pointertap', (event) => {
      event.stopPropagation();
      this.fireSuperTongue();
    });
  }

  private updateSkillButtonArtMode(): void {
    const useImage = this.skillButtonsUseImageArt && this.skillButtonTextures != null;
    this.superJumpHudBtn.root.visible = useImage;
    this.pullUpHudBtn.root.visible = useImage;
    this.superJumpFallbackRoot.visible = !useImage;
    this.pullUpFallbackRoot.visible = !useImage;
  }

  /**
   * Skill pair on `uiLayer` only — fixed to the camera (`scrollFactor` 0 equivalent).
   * Centered under the meters/speed row; width auto-fits the HUD column without upscaling.
   */
  private layoutSkillPairHud(): void {
    if (this.skillButtonsUseImageArt && this.skillButtonTextures) {
      this.applySkillButtonArtLayout();
    }

    const useImage = this.skillButtonsUseImageArt && this.skillButtonTextures != null;
    const pullUpGap = SKILL_PAIR_BTN_GAP_PX - SKILL_PULL_UP_NUDGE_LEFT_PX;
    const pairLocalW = useImage
      ? this.superJumpHudBtn.width + pullUpGap + this.pullUpHudBtn.width
      : SKILL_FALLBACK_BTN_W * 2 + pullUpGap;
    const pairScreenW = pairLocalW * PULL_UP_BTN_SCALE;

    let centerX = this.width * 0.5;
    let rowY = TIMER_CLIMB_HUD_ROW_Y + 22;
    if (this.climbHudText) {
      centerX = this.climbHudText.x + this.climbHudText.width * 0.5;
      rowY = this.climbHudText.y + this.climbHudText.height + SKILL_PAIR_BELOW_CLIMB_GAP_PX;
    }

    this.skillPairRoot.pivot.set(0, 0);
    this.skillPairRoot.position.set(centerX - pairScreenW * 0.5 - SKILL_PAIR_SHIFT_LEFT_PX, rowY);

    if (!useImage) {
      this.pullUpFallbackRoot.position.set(
        SKILL_FALLBACK_BTN_W + SKILL_PAIR_BTN_GAP_PX - SKILL_PULL_UP_NUDGE_LEFT_PX,
        0,
      );
    }
  }

  /** Largest per-button width that fits under the meters/speed HUD without upscaling the PNG crop. */
  private getSkillPairDisplayW(): number {
    const maxCap =
      this.width <= MOBILE_NARROW_UI_MAX_W
        ? SKILL_BTN_DISPLAY_W_MAX_MOBILE
        : SKILL_BTN_DISPLAY_W_MAX_DESKTOP;

    const climb = this.climbHudText;
    if (!climb) {
      return maxCap;
    }

    const hudRight =
      this.width - HEADER_PAUSE_BTN_SCREEN_MARGIN_X - this.headerPauseBtnDisplayW - 8;
    const available = Math.max(0, hudRight - climb.x);
    const fromSpace = Math.floor((available - SKILL_PAIR_BTN_GAP_PX) * 0.5);

    return Math.max(
      SKILL_BTN_DISPLAY_W_MIN,
      Math.min(maxCap, fromSpace, SKILL_BTN_NATIVE_CROP_W),
    );
  }

  private applySkillButtonArtLayout(): void {
    if (!this.skillButtonTextures) {
      return;
    }
    this.skillBtnDisplayW = this.getSkillPairDisplayW();
    this.superJumpHudBtn.setTexture(
      this.skillButtonTextures.superJump,
      this.skillBtnDisplayW,
    );
    this.pullUpHudBtn.setTexture(this.skillButtonTextures.pullUp, this.skillBtnDisplayW);
    this.superJumpHudBtn.root.position.set(0, 0);
    this.pullUpHudBtn.root.position.set(
      this.superJumpHudBtn.width + SKILL_PAIR_BTN_GAP_PX - SKILL_PULL_UP_NUDGE_LEFT_PX,
      0,
    );
  }

  private drawHudSkillButton(
    gfx: Graphics,
    w: number,
    h: number,
    pulseT: number,
    cyanAccent: boolean,
  ): void {
    gfx.clear();
    const pulse = 0.5 + 0.5 * Math.sin(pulseT * 6);
    const accent = cyanAccent
      ? pulse > 0.5
        ? 0x88fff4
        : 0x44ccb8
      : pulse > 0.5
        ? 0xffd700
        : 0xff9900;
    gfx.roundRect(0, 0, w, h, 12).fill({
      color: 0x2a0040,
      alpha: 0.92,
    });
    gfx.roundRect(0, 0, w, h, 12).stroke({
      width: 3,
      color: accent,
      alpha: 0.95,
    });
    gfx.roundRect(3, 3, w - 6, h - 6, 9).stroke({
      width: 1.4,
      color: accent,
      alpha: 0.4 + 0.3 * pulse,
    });
  }

  private drawSuperJumpFallbackButton(): void {
    this.drawHudSkillButton(
      this.superJumpFallbackGfx,
      SKILL_FALLBACK_BTN_W,
      SKILL_FALLBACK_BTN_H,
      this.superTongueBtnPulse + 0.35,
      true,
    );
  }

  private drawPullUpFallbackButton(): void {
    this.drawHudSkillButton(
      this.pullUpFallbackGfx,
      SKILL_FALLBACK_BTN_W,
      SKILL_FALLBACK_BTN_H,
      this.superTongueBtnPulse,
      false,
    );
  }

  /** Top edge Y of the music HUD icon — matches {@link layoutHeaderPauseButton}. */
  private getHeaderMusicBtnScreenY(): number {
    return HEADER_PAUSE_BTN_SCREEN_Y + this.headerPauseBtnDisplayH + HEADER_HUD_BTN_GAP_PX;
  }

  /**
   * Tick combo expiry (no-jump window) + advance badge animations. Drives skill pair pulse / chain
   * window expiry and post-pull grapple buff timer.
   *
   * Invoked from `update()` after physics and landing so fascia wall-slide (friction/SFX predicate or
   * physics elevator latch) can bump `comboLastJumpTime` before this frame evaluates chain expiry.
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
      if (!this.skillButtonsUseImageArt) {
        if (this.superJumpFallbackRoot.visible) {
          this.drawSuperJumpFallbackButton();
        }
        if (this.pullUpFallbackRoot.visible) {
          this.drawPullUpFallbackButton();
        }
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
    const useImage = this.skillButtonsUseImageArt && this.skillButtonTextures != null;
    const sjOk =
      !this.skillSuperJumpSpent &&
      (!this.skillPullUpSpent || this.runTime <= this.skillChainWindowEnd);
    const puOk = !this.skillPullUpSpent;

    this.superJumpHudBtn.root.visible = useImage && sjOk;
    this.superJumpHudBtn.setInteractive(useImage && sjOk);
    this.pullUpHudBtn.root.visible = useImage && puOk;
    this.pullUpHudBtn.setInteractive(useImage && puOk);

    this.superJumpFallbackRoot.visible = !useImage && sjOk;
    this.superJumpFallbackGfx.eventMode = !useImage && sjOk ? 'static' : 'none';
    this.pullUpFallbackRoot.visible = !useImage && puOk;
    this.pullUpFallbackGfx.eventMode = !useImage && puOk ? 'static' : 'none';
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
  }

  /** Streak reset path — called by expiry, non-climbing jumps, fall save, or death. */
  private breakCombo(): void {
    if (this.comboCount === 0 && !this.skillPairAvailable && !this.skillPullUpSpent) {
      this.superJumpStairTrackActive = false;
      this.superJumpCrossedStairIds.clear();
      this.megaJumpReanchorComboOnLanding = false;
      this.fasciaSlideComboNextStepAtRunTime = null;
      return;
    }
    this.comboCount = 0;
    this.superJumpComboGraceUntil = Number.NEGATIVE_INFINITY;
    this.megaJumpReanchorComboOnLanding = false;
    this.superJumpStairTrackActive = false;
    this.superJumpCrossedStairIds.clear();
    this.fasciaSlideComboNextStepAtRunTime = null;
    this.comboBadge?.expire();
  }

  /** Show / hide the skill pair offer (`SUPER JUMP` + `PULL UP`). Does not clear grapple buff. */
  private setSkillPairAvailable(available: boolean): void {
    if (available && !this.skillButtonTextures) {
      void loadSkillButtonTextures().then((textures) => {
        if (!textures) {
          return;
        }
        this.skillButtonTextures = textures;
        this.skillButtonsUseImageArt = true;
        this.applySkillButtonArtLayout();
        this.updateSkillButtonArtMode();
        this.layoutSkillPairHud();
        if (this.skillPairAvailable) {
          this.skillPairRoot.visible = true;
          this.syncSkillPairChildVisibility();
        }
      });
    }
    if (available === this.skillPairAvailable) {
      return;
    }
    this.skillPairAvailable = available;
    this.skillPairRoot.visible = available;
    if (!available) {
      this.skillPullUpSpent = false;
      this.skillSuperJumpSpent = false;
      this.skillChainWindowEnd = 0;
      this.superJumpHudBtn.setInteractive(false);
      this.pullUpHudBtn.setInteractive(false);
      this.superJumpFallbackGfx.eventMode = 'none';
      this.pullUpFallbackGfx.eventMode = 'none';
      return;
    }
    this.skillPullUpSpent = false;
    this.skillSuperJumpSpent = false;
    this.skillChainWindowEnd = 0;
    this.superTongueBtnPulse = 0;
    this.updateSkillButtonArtMode();
    this.syncSkillPairChildVisibility();
    this.layoutSkillPairHud();
    if (!this.skillButtonsUseImageArt) {
      this.drawSuperJumpFallbackButton();
      this.drawPullUpFallbackButton();
    }
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
   * Pull-up → mega within {@link SKILL_CHAIN_WINDOW_SEC} adds a small screen shake; score stays height+combo only.
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
    this.sfx.play('super_jump_woohoo', 0.9);

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
      this.maybeTriggerScreenShake(Math.min(10, 2 + Math.floor(this.comboCount / 4)));
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
      stroke: { color: '#5a3d00', width: tunedUiStroke(strokeWidth) },
      letterSpacing: 1.1,
      dropShadow: {
        color: '#ffd700',
        alpha: 0.65,
        blur: tunedBlur(6),
        angle: Math.PI / 4,
        distance: 0,
      },
    });
  }

  /** Floating top HUD labels — soft shadow, minimal glow, no neon frame. */
  private createFloatingHudTextStyle(
    size: number,
    fill = '#fff4c8',
    strokeColor = '#3d2800',
    strokeWidth = 2.4,
  ): TextStyle {
    return new TextStyle({
      fontFamily: 'Urbanist, Heebo, Orbitron, Arial Black, sans-serif',
      fontSize: size,
      fontWeight: '800',
      fill,
      stroke: { color: strokeColor, width: tunedUiStroke(strokeWidth) },
      letterSpacing: 0.5,
      dropShadow: {
        color: '#000000',
        alpha: 0.58,
        blur: tunedBlur(5),
        angle: Math.PI / 2,
        distance: 2,
      },
    });
  }

  private drawFloatingHudChip(gfx: Graphics, w: number, h: number, radius: number): void {
    gfx.clear();
    gfx.roundRect(1.5, 2.5, w, h, radius).fill({ color: 0x000000, alpha: FLOATING_HUD_SHADOW_ALPHA });
    gfx.roundRect(0, 0, w, h, radius).fill({ color: FLOATING_HUD_CHIP_FILL, alpha: FLOATING_HUD_CHIP_ALPHA });
    gfx.roundRect(1, 1, w - 2, h - 2, Math.max(4, radius - 1)).stroke({
      color: FLOATING_HUD_CHIP_STROKE,
      width: 1,
      alpha: FLOATING_HUD_CHIP_STROKE_ALPHA,
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
      stroke: { color: '#5a3d00', width: tunedUiStroke(narrow ? 1.2 : 1.6) },
      letterSpacing: narrow ? 0.2 : 0.4,
      wordWrap: true,
      wordWrapWidth: Math.max(40, wordWrapWidth),
      breakWords: true,
      dropShadow: {
        color: '#ffd700',
        alpha: 0.55,
        blur: tunedBlur(4),
        angle: Math.PI / 4,
        distance: 0,
      },
    });
  }

  private drawCollectibleIcons(): void {
    this.collectibleHudGoldIcon.clear();
    this.collectibleHudGoldIcon.circle(10, 0, 9).fill({ color: UI_GOLD, alpha: 0.92 });
    this.collectibleHudGoldIcon.circle(10, 0, 9).stroke({ color: 0xfff0a8, width: 1.2, alpha: 0.45 });
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
    const hudDiamond = [10, -9, 18, 0, 10, 10, 2, 0];
    this.collectibleHudDiamondIcon.poly(hudDiamond).fill({ color: 0x9fe8ff, alpha: 0.95 });
    this.collectibleHudDiamondIcon.poly(hudDiamond).stroke({ color: 0xd8f8ff, width: 1.2, alpha: 0.5 });
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
      .stroke({ color: 0xb8ecff, width: 1.2, alpha: 0.45 });
    this.collectibleHudShieldIcon
      .roundRect(6.5, -4, 7, 7, 1.5)
      .fill({ color: 0x4060a0, alpha: 0.45 })
      .stroke({ color: 0xc8ffff, width: 1, alpha: 0.7 });
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
    this.leaderboardEmptyHint = new Text({
      text: 'No scores yet',
      style: this.createNeonGoldTextStyle(20, 2),
    });
    this.leaderboardEmptyHint.anchor.set(0.5);
    this.leaderboardEmptyHint.visible = false;
    this.leaderboardEmptyHint.eventMode = 'none';

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
      this.leaderboardEmptyHint,
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
    this.pauseMenuBtn.eventMode = 'static';
    this.pauseMenuBtn.cursor = 'pointer';
    this.pauseMenuBtn.on('pointerdown', (event) => {
      event.stopPropagation();
    });
    this.pauseMenuBtn.on('pointertap', (event) => {
      event.stopPropagation();
      this.returnToMainMenuFromPause();
    });
    this.pauseMenuLabel = new Text({
      text: 'BACK TO MENU',
      style: this.createNeonGoldTextStyle(18, 2),
    });
    this.pauseMenuLabel.anchor.set(0.5);
    this.pauseMenuLabel.eventMode = 'none';
    this.pauseLogoutBtn.eventMode = 'static';
    this.pauseLogoutBtn.cursor = 'pointer';
    this.pauseLogoutBtn.on('pointerdown', (event) => {
      event.stopPropagation();
    });
    this.pauseLogoutBtn.on('pointertap', (event) => {
      event.stopPropagation();
      this.showLogoutConfirm();
    });
    this.pauseLogoutLabel = new Text({
      text: 'LOG OUT',
      style: new TextStyle({
        fontFamily: 'Orbitron, "Press Start 2P", Arial Black, sans-serif',
        fontSize: 11,
        fontWeight: '800',
        fill: '#f0a0a0',
        stroke: { color: '#4a1515', width: 1.4 },
        letterSpacing: 0.5,
      }),
    });
    this.pauseLogoutLabel.anchor.set(0.5);
    this.pauseLogoutLabel.eventMode = 'none';
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
      this.pauseLogoutBtn,
      this.pauseLogoutLabel,
      this.pauseMenuBtn,
      this.pauseMenuLabel,
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
    const panelH = Math.min(400, overlayH - 64);
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
    const btnW = Math.min(340, panelW - 28);
    const resumeH = Math.max(PAUSE_RESUME_BTN_MIN_H, 56);
    const menuH = 44;
    const logoutH = STATUS_PANEL_LOGOUT_BTN_H_PX;
    const btnGap = 10;
    const resumeX = overlayW * 0.5 - btnW * 0.5;
    const resumeY = py + panelH - resumeH - 28;
    const menuY = resumeY - btnGap - menuH;
    const logoutY = menuY - btnGap - logoutH;
    this.drawOverlayButton(this.pauseLogoutBtn, resumeX, logoutY, btnW, logoutH);
    this.pauseLogoutBtn.hitArea = new Rectangle(resumeX, logoutY, btnW, logoutH);
    this.pauseLogoutLabel?.position.set(overlayW * 0.5, logoutY + logoutH * 0.5);
    this.drawOverlayButton(this.pauseMenuBtn, resumeX, menuY, btnW, menuH);
    this.pauseMenuBtn.hitArea = new Rectangle(resumeX, menuY, btnW, menuH);
    this.pauseMenuLabel?.position.set(overlayW * 0.5, menuY + menuH * 0.5);
    this.drawOverlayButton(this.pauseResumeBtn, resumeX, resumeY, btnW, resumeH);
    this.pauseResumeBtn.hitArea = new Rectangle(resumeX, resumeY, btnW, resumeH);
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

  private getHeaderPauseBtnTargetDisplayPx(): number {
    const base =
      this.width <= MOBILE_NARROW_UI_MAX_W
        ? HEADER_PAUSE_BTN_DISPLAY_SIZE_PX_MOBILE
        : HEADER_PAUSE_BTN_DISPLAY_SIZE_PX_DESKTOP;
    return base * HEADER_PAUSE_BTN_DISPLAY_SCALE;
  }

  private configureHeaderPauseButtonTexture(tex: Texture): void {
    tex.source.scaleMode = 'linear';
  }

  private async loadHeaderHudButtonTextures(): Promise<void> {
    await Promise.all([this.loadHeaderPauseButtonTexture(), this.loadHeaderMusicButtonTexture()]);
  }

  private async loadHeaderPauseButtonTexture(): Promise<void> {
    if (this.headerPauseBtnTexture) {
      return;
    }
    try {
      const tex = await loadKeyedTrimmedTexture(PAUSE_BTN_TEXTURE_URL);
      this.configureHeaderPauseButtonTexture(tex);
      this.buildHeaderPauseBtnAlphaHitMask(tex);
      this.headerPauseBtnTexture = tex;
    } catch (err) {
      console.warn('[PlayScene] pause button texture failed', PAUSE_BTN_TEXTURE_URL, err);
    }
  }

  private async loadHeaderMusicButtonTexture(): Promise<void> {
    if (this.headerMusicBtnTexture) {
      return;
    }
    try {
      const sheet = await loadKeyedTrimmedTexture(MUSIC_BTN_SHEET_URL);
      this.configureHeaderPauseButtonTexture(sheet);
      const frameH = Math.max(1, Math.round(sheet.height * 0.5));
      const tex = new Texture({
        source: sheet.source,
        frame: new Rectangle(0, 0, sheet.width, frameH),
      });
      this.buildHeaderMusicBtnAlphaHitMask(tex);
      this.headerMusicBtnTexture = tex;
    } catch (err) {
      console.warn('[PlayScene] music button texture failed', MUSIC_BTN_SHEET_URL, err);
    }
  }

  /** Fit trimmed pause art to the same HUD target size as the old `buttons 2` coin. */
  private computeHeaderPauseBtnBaseScale(tex: Texture): number {
    const w = tex.width;
    const h = tex.height;
    if (w <= 0 || h <= 0) {
      return 1;
    }
    const targetPx = this.getHeaderPauseBtnTargetDisplayPx();
    return Math.min(targetPx / w, targetPx / h);
  }

  private buildHeaderPauseBtnAlphaHitMask(tex: Texture): void {
    const w = tex.width;
    const h = tex.height;
    if (w <= 0 || h <= 0) {
      this.headerPauseBtnHitAlpha = null;
      this.headerPauseBtnHitW = 0;
      this.headerPauseBtnHitH = 0;
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      this.headerPauseBtnHitAlpha = null;
      return;
    }
    const resource = tex.source.resource;
    if (resource instanceof HTMLCanvasElement || resource instanceof HTMLImageElement) {
      ctx.drawImage(resource, 0, 0, w, h);
    } else {
      this.headerPauseBtnHitAlpha = null;
      return;
    }
    const imageData = ctx.getImageData(0, 0, w, h);
    const alpha = new Uint8Array(w * h);
    for (let i = 0; i < alpha.length; i += 1) {
      alpha[i] = imageData.data[i * 4 + 3];
    }
    this.headerPauseBtnHitAlpha = alpha;
    this.headerPauseBtnHitW = w;
    this.headerPauseBtnHitH = h;
  }

  private buildHeaderMusicBtnAlphaHitMask(tex: Texture): void {
    const w = tex.width;
    const h = tex.height;
    if (w <= 0 || h <= 0) {
      this.headerMusicBtnHitAlpha = null;
      this.headerMusicBtnHitW = 0;
      this.headerMusicBtnHitH = 0;
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      this.headerMusicBtnHitAlpha = null;
      return;
    }
    const resource = tex.source.resource;
    if (resource instanceof HTMLCanvasElement || resource instanceof HTMLImageElement) {
      ctx.drawImage(resource, tex.frame.x, tex.frame.y, w, h, 0, 0, w, h);
    } else {
      this.headerMusicBtnHitAlpha = null;
      return;
    }
    const imageData = ctx.getImageData(0, 0, w, h);
    const alpha = new Uint8Array(w * h);
    for (let i = 0; i < alpha.length; i += 1) {
      alpha[i] = imageData.data[i * 4 + 3];
    }
    this.headerMusicBtnHitAlpha = alpha;
    this.headerMusicBtnHitW = w;
    this.headerMusicBtnHitH = h;
  }

  /** Pixel-perfect hit (anchor top-right): pause only on visible button pixels. */
  private testHeaderPauseBtnAlphaHit(localX: number, localY: number): boolean {
    const alpha = this.headerPauseBtnHitAlpha;
    const w = this.headerPauseBtnHitW;
    const h = this.headerPauseBtnHitH;
    if (!alpha || w <= 0 || h <= 0) {
      return false;
    }
    const tx = Math.floor(localX + w);
    const ty = Math.floor(localY);
    if (tx < 0 || ty < 0 || tx >= w || ty >= h) {
      return false;
    }
    return alpha[ty * w + tx] >= HEADER_PAUSE_BTN_HIT_ALPHA_THRESHOLD;
  }

  private testHeaderMusicBtnAlphaHit(localX: number, localY: number): boolean {
    const alpha = this.headerMusicBtnHitAlpha;
    const w = this.headerMusicBtnHitW;
    const h = this.headerMusicBtnHitH;
    if (!alpha || w <= 0 || h <= 0) {
      return false;
    }
    const tx = Math.floor(localX + w);
    const ty = Math.floor(localY);
    if (tx < 0 || ty < 0 || tx >= w || ty >= h) {
      return false;
    }
    return alpha[ty * w + tx] >= HEADER_PAUSE_BTN_HIT_ALPHA_THRESHOLD;
  }

  private refreshHeaderPauseBtnDisplayMetrics(multiplier = 1): void {
    const tex = this.headerPauseBtn.texture;
    const scale = this.headerPauseBtnBaseScale * multiplier;
    if (tex && tex.width > 0 && tex.height > 0) {
      this.headerPauseBtnDisplayW = tex.width * scale;
      this.headerPauseBtnDisplayH = tex.height * scale;
    } else {
      this.headerPauseBtnDisplayW = this.getHeaderPauseBtnTargetDisplayPx() * multiplier;
      this.headerPauseBtnDisplayH = this.getHeaderPauseBtnTargetDisplayPx() * multiplier;
    }
  }

  private setupHeaderPauseButton(): void {
    this.headerPauseRoot.zIndex = HEADER_PAUSE_BTN_Z_INDEX;
    this.headerPauseBtn.anchor.set(1, 0);
    this.headerPauseBtn.roundPixels = false;
    this.headerPauseBtn.eventMode = 'static';
    this.headerPauseBtn.cursor = 'pointer';
    if (this.headerPauseBtnTexture) {
      this.headerPauseBtn.texture = this.headerPauseBtnTexture;
      this.configureHeaderPauseButtonTexture(this.headerPauseBtnTexture);
    }
    this.headerPauseBtn.hitArea = this.headerPauseBtnAlphaHitArea;
    this.headerPauseBtn.on('pointerdown', (event) => {
      event.stopPropagation();
      this.headerPauseBtnPressed = true;
      this.applyHeaderPauseBtnScale();
    });
    this.headerPauseBtn.on('pointerup', (event) => {
      event.stopPropagation();
      this.headerPauseBtnPressed = false;
      this.applyHeaderPauseBtnScale();
    });
    this.headerPauseBtn.on('pointerupoutside', (event) => {
      event.stopPropagation();
      this.headerPauseBtnPressed = false;
      this.applyHeaderPauseBtnScale();
    });
    this.headerPauseBtn.on('pointercancel', (event) => {
      event.stopPropagation();
      this.headerPauseBtnPressed = false;
      this.applyHeaderPauseBtnScale();
    });
    this.headerPauseBtn.on('pointerover', () => {
      this.headerPauseBtnHovered = true;
      if (!this.headerPauseBtnPressed) {
        this.applyHeaderPauseBtnScale();
      }
    });
    this.headerPauseBtn.on('pointerout', () => {
      this.headerPauseBtnHovered = false;
      this.headerPauseBtnPressed = false;
      this.applyHeaderPauseBtnScale();
    });
    this.headerPauseBtn.on('pointertap', (event) => {
      event.stopPropagation();
      this.headerPauseBtnPressed = false;
      this.headerPauseBtnHovered = false;
      this.applyHeaderPauseBtnScale();
      this.togglePauseFromHeaderButton();
    });
    this.headerMusicBtn.anchor.set(1, 0);
    this.headerMusicBtn.roundPixels = false;
    this.headerMusicBtn.eventMode = 'static';
    this.headerMusicBtn.cursor = 'pointer';
    if (this.headerMusicBtnTexture) {
      this.headerMusicBtn.texture = this.headerMusicBtnTexture;
      this.configureHeaderPauseButtonTexture(this.headerMusicBtnTexture);
    }
    this.headerMusicBtn.hitArea = this.headerMusicBtnAlphaHitArea;
    this.headerMusicBtn.on('pointerdown', (event) => {
      event.stopPropagation();
      this.headerMusicBtnPressed = true;
      this.applyHeaderMusicBtnScale();
    });
    this.headerMusicBtn.on('pointerup', (event) => {
      event.stopPropagation();
      this.headerMusicBtnPressed = false;
      this.applyHeaderMusicBtnScale();
    });
    this.headerMusicBtn.on('pointerupoutside', (event) => {
      event.stopPropagation();
      this.headerMusicBtnPressed = false;
      this.applyHeaderMusicBtnScale();
    });
    this.headerMusicBtn.on('pointercancel', (event) => {
      event.stopPropagation();
      this.headerMusicBtnPressed = false;
      this.applyHeaderMusicBtnScale();
    });
    this.headerMusicBtn.on('pointerover', () => {
      this.headerMusicBtnHovered = true;
      if (!this.headerMusicBtnPressed) {
        this.applyHeaderMusicBtnScale();
      }
    });
    this.headerMusicBtn.on('pointerout', () => {
      this.headerMusicBtnHovered = false;
      this.headerMusicBtnPressed = false;
      this.applyHeaderMusicBtnScale();
    });
    this.headerMusicBtn.on('pointertap', (event) => {
      event.stopPropagation();
      this.headerMusicBtnPressed = false;
      this.headerMusicBtnHovered = false;
      this.applyHeaderMusicBtnScale();
      this.toggleGameplayBgmMute();
    });
    this.headerPauseRoot.addChild(this.headerPauseBtn, this.headerMusicBtn);
    this.uiLayer.addChild(this.headerPauseRoot);
    this.layoutHeaderPauseButton();
  }

  private layoutHeaderPauseButton(): void {
    const tex = this.headerPauseBtn.texture;
    if (tex && tex.width > 0 && tex.height > 0) {
      this.headerPauseBtnBaseScale = this.computeHeaderPauseBtnBaseScale(tex);
    } else {
      this.headerPauseBtnBaseScale = 1;
    }
    this.headerPauseRoot.position.set(0, 0);
    this.headerPauseBtn.position.set(
      this.width - HEADER_PAUSE_BTN_SCREEN_MARGIN_X,
      HEADER_PAUSE_BTN_SCREEN_Y,
    );
    this.applyHeaderPauseBtnScale();
    const musicTex = this.headerMusicBtn.texture;
    if (musicTex && musicTex.width > 0 && musicTex.height > 0) {
      this.headerMusicBtnBaseScale = this.computeHeaderPauseBtnBaseScale(musicTex);
    } else {
      this.headerMusicBtnBaseScale = 1;
    }
    this.headerMusicBtn.position.set(
      this.width - HEADER_PAUSE_BTN_SCREEN_MARGIN_X,
      this.getHeaderMusicBtnScreenY(),
    );
    this.applyHeaderMusicBtnScale();
    this.layoutClimbHud();
  }

  private applyHeaderMusicBtnScale(): void {
    let multiplier = 1;
    if (this.headerMusicBtnPressed) {
      multiplier = HEADER_PAUSE_BTN_PRESS_SCALE;
    } else if (this.headerMusicBtnHovered) {
      multiplier = HEADER_PAUSE_BTN_HOVER_SCALE;
    }
    this.headerMusicBtn.scale.set(this.headerMusicBtnBaseScale * multiplier);
    const mutedAlpha = this.bgmMuted ? 0.52 : 1;
    this.headerMusicBtn.alpha = mutedAlpha * (this.headerMusicBtnPressed ? 0.92 : 1);
  }

  private toggleGameplayBgmMute(): void {
    this.bgmMuted = !this.bgmMuted;
    if (this.bgm) {
      this.bgm.volume = this.bgmMuted ? 0 : 0.2;
      if (!this.bgmMuted && !this.paused && !this.gameOver) {
        void this.bgm.play().catch(() => {
          /* autoplay */
        });
      }
    }
    this.applyHeaderMusicBtnScale();
  }

  private applyHeaderPauseBtnScale(): void {
    let multiplier = 1;
    if (this.headerPauseBtnPressed) {
      multiplier = HEADER_PAUSE_BTN_PRESS_SCALE;
    } else if (this.headerPauseBtnHovered) {
      multiplier = HEADER_PAUSE_BTN_HOVER_SCALE;
    }
    this.headerPauseBtn.scale.set(this.headerPauseBtnBaseScale * multiplier);
    this.refreshHeaderPauseBtnDisplayMetrics(multiplier);
  }

  private updateHeaderPauseButtonFx(dt: number): void {
    if (!this.headerPauseRoot.visible) {
      return;
    }
    this.headerPauseGlowTimeSec += dt;
    const wave =
      0.5 +
      0.5 * Math.sin((this.headerPauseGlowTimeSec * Math.PI * 2) / HEADER_PAUSE_BTN_GLOW_PULSE_SEC);
    const blink = wave * wave;
    // Soft pulse without GlowFilter blur (keeps pause art sharp).
    this.headerPauseBtn.alpha = 0.9 + blink * 0.1;
    if (!this.bgmMuted) {
      this.headerMusicBtn.alpha = 0.9 + blink * 0.1;
    }
  }

  private setupStatusPanel(): void {
    this.statusPanelRoot.zIndex = 1005;
    this.statusPanelBodyGfx.eventMode = 'none';
    this.statusPanelToggleGfx.eventMode = 'none';
    this.statusPanelToggleHit.eventMode = 'static';
    this.statusPanelToggleHit.cursor = 'pointer';
    this.statusPanelToggleHit.on('pointerdown', (event) => {
      event.stopPropagation();
    });
    this.statusPanelToggleHit.on('pointertap', (event) => {
      event.stopPropagation();
      const wasExpanded = this.statusPanelExpanded;
      this.statusPanelExpanded = !this.statusPanelExpanded;
      this.layoutStatusPanel();
      this.refreshStatusPanelContent();
      if (this.statusPanelExpanded && !wasExpanded && this.statusPanelSidebarTab === 'global') {
        void this.refreshSidebarLeaderboardFromRtdb();
      }
    });

    this.statusPanelSepGfx.eventMode = 'none';
    this.statusPanelLogoutBtn.eventMode = 'static';
    this.statusPanelLogoutBtn.cursor = 'pointer';
    this.statusPanelLogoutBtn.on('pointerdown', (event) => {
      event.stopPropagation();
    });
    this.statusPanelLogoutBtn.on('pointertap', (event) => {
      event.stopPropagation();
      this.showLogoutConfirm();
    });

    this.statusPanelTabStatsBtn.eventMode = 'static';
    this.statusPanelTabStatsBtn.cursor = 'pointer';
    this.statusPanelTabStatsBtn.on('pointerdown', (event) => {
      event.stopPropagation();
    });
    this.statusPanelTabStatsBtn.on('pointertap', (event) => {
      event.stopPropagation();
      this.selectStatusPanelTab('stats');
    });

    this.statusPanelTabBagBtn.eventMode = 'static';
    this.statusPanelTabBagBtn.cursor = 'pointer';
    this.statusPanelTabBagBtn.on('pointerdown', (event) => {
      event.stopPropagation();
    });
    this.statusPanelTabBagBtn.on('pointertap', (event) => {
      event.stopPropagation();
      this.selectStatusPanelTab('bag');
    });

    this.statusPanelTabGlobalBtn.eventMode = 'static';
    this.statusPanelTabGlobalBtn.cursor = 'pointer';
    this.statusPanelTabGlobalBtn.on('pointerdown', (event) => {
      event.stopPropagation();
    });
    this.statusPanelTabGlobalBtn.on('pointertap', (event) => {
      event.stopPropagation();
      this.selectStatusPanelTab('global');
    });

    this.statusPanelTabStatsLabel = new Text({
      text: 'MY STATS',
      style: new TextStyle({
        fontFamily: 'Orbitron, "Press Start 2P", Arial Black, sans-serif',
        fontSize: 8,
        fontWeight: '800',
        fill: '#cce8d8',
        stroke: { color: '#0f2814', width: 1 },
        letterSpacing: 0.2,
      }),
    });
    this.statusPanelTabStatsLabel.anchor.set(0.5);
    this.statusPanelTabStatsLabel.eventMode = 'none';
    this.statusPanelTabStatsLabel.visible = false;

    this.statusPanelTabBagLabel = new Text({
      text: 'YOUR BAG',
      style: new TextStyle({
        fontFamily: 'Orbitron, "Press Start 2P", Arial Black, sans-serif',
        fontSize: 8,
        fontWeight: '800',
        fill: '#cce8d8',
        stroke: { color: '#0f2814', width: 1 },
        letterSpacing: 0.2,
      }),
    });
    this.statusPanelTabBagLabel.anchor.set(0.5);
    this.statusPanelTabBagLabel.eventMode = 'none';
    this.statusPanelTabBagLabel.visible = false;

    this.statusPanelTabGlobalLabel = new Text({
      text: 'GLOBAL',
      style: new TextStyle({
        fontFamily: 'Orbitron, "Press Start 2P", Arial Black, sans-serif',
        fontSize: 8,
        fontWeight: '800',
        fill: '#cce8d8',
        stroke: { color: '#0f2814', width: 1 },
        letterSpacing: 0.2,
      }),
    });
    this.statusPanelTabGlobalLabel.anchor.set(0.5);
    this.statusPanelTabGlobalLabel.eventMode = 'none';
    this.statusPanelTabGlobalLabel.visible = false;

    this.statusPanelMyStatsMainText = new Text({
      text: '',
      style: new TextStyle({
        fontFamily: 'Orbitron, "Press Start 2P", Arial Black, sans-serif',
        fontSize: 11,
        fontWeight: '700',
        fill: '#e8fff0',
        stroke: { color: '#15301a', width: 1.2 },
        letterSpacing: 0.2,
        lineHeight: 16,
        wordWrap: true,
        wordWrapWidth: STATUS_PANEL_BODY_W_PX - STATUS_PANEL_BODY_PAD_PX * 2,
        breakWords: true,
      }),
    });
    this.statusPanelMyStatsMainText.eventMode = 'none';
    this.statusPanelMyStatsMainText.visible = false;

    this.statusPanelPtsPillGfx.eventMode = 'none';

    this.statusPanelMyStatsPtsText = new Text({
      text: 'TOTAL PTS  0',
      style: new TextStyle({
        fontFamily: 'Orbitron, Arial Black, Helvetica Neue, sans-serif',
        fontSize: 11,
        fontWeight: '700',
        fill: '#ffe066',
        stroke: { color: '#5a4a00', width: 1 },
        letterSpacing: 0,
        lineHeight: 16,
      }),
    });
    this.statusPanelMyStatsPtsText.anchor.set(0.5, 0.5);
    this.statusPanelMyStatsPtsText.eventMode = 'none';
    this.statusPanelMyStatsPtsText.visible = false;

    this.statusPanelBagRoot.eventMode = 'passive';
    this.statusPanelBagRoot.visible = false;
    this.statusPanelBagItems.eventMode = 'none';
    this.statusPanelBagDragGhost.eventMode = 'none';
    this.statusPanelBagDragGhost.visible = false;
    this.createStatusPanelBagSlots();
    this.statusPanelBagRoot.addChild(this.statusPanelBagItems, this.statusPanelBagDragGhost);

    this.statusPanelLogoutLabel = new Text({
      text: 'LOG OUT',
      style: new TextStyle({
        fontFamily: 'Orbitron, "Press Start 2P", Arial Black, sans-serif',
        fontSize: 11,
        fontWeight: '800',
        fill: '#f0a0a0',
        stroke: { color: '#4a1515', width: 1.4 },
        letterSpacing: 0.5,
      }),
    });
    this.statusPanelLogoutLabel.anchor.set(0.5);
    this.statusPanelLogoutLabel.eventMode = 'none';
    this.statusPanelLogoutLabel.visible = false;

    const lbMuted = new TextStyle({
      fontFamily: 'Orbitron, "Press Start 2P", Arial Black, sans-serif',
      fontSize: 10,
      fontWeight: '600',
      fill: '#6a8a7a',
      stroke: { color: '#0a120a', width: 1 },
    });
    this.statusPanelLbLoading = new Text({
      text: 'Loading…',
      style: lbMuted,
    });
    this.statusPanelLbLoading.anchor.set(0.5);
    this.statusPanelLbLoading.visible = false;
    this.statusPanelLbEmpty = new Text({
      text: 'No scores yet.',
      style: lbMuted,
    });
    this.statusPanelLbEmpty.anchor.set(0.5, 0);
    this.statusPanelLbEmpty.visible = false;

    this.statusPanelLbViewport.eventMode = 'static';
    this.statusPanelLbViewport.cursor = 'grab';
    this.statusPanelLbViewport.sortableChildren = true;
    this.statusPanelLbViewport.on('wheel', (e: FederatedWheelEvent) => {
      e.stopPropagation();
      if (!this.statusPanelExpanded) {
        return;
      }
      const maxScroll = Math.max(0, this.sidebarLbContentH - STATUS_PANEL_LB_VIEWPORT_H_PX);
      if (maxScroll <= 0) {
        return;
      }
      const delta = e.deltaY;
      this.sidebarLbScrollPx = Math.max(
        0,
        Math.min(maxScroll, this.sidebarLbScrollPx + delta * 0.45),
      );
      this.statusPanelLbScroll.position.y = -this.sidebarLbScrollPx;
    });

    this.statusPanelLbViewport.addChild(
      this.statusPanelLbMask,
      this.statusPanelLbScroll,
      this.statusPanelLbLoading,
      this.statusPanelLbEmpty,
    );
    this.statusPanelLbScroll.mask = this.statusPanelLbMask;

    this.statusPanelRoot.addChild(
      this.statusPanelBodyGfx,
      this.statusPanelTabStatsBtn,
      this.statusPanelTabBagBtn,
      this.statusPanelTabGlobalBtn,
      this.statusPanelTabStatsLabel,
      this.statusPanelTabBagLabel,
      this.statusPanelTabGlobalLabel,
      this.statusPanelMyStatsMainText,
      this.statusPanelPtsPillGfx,
      this.statusPanelMyStatsPtsText,
      this.statusPanelBagRoot,
      this.statusPanelLbViewport,
      this.statusPanelSepGfx,
      this.statusPanelLogoutBtn,
      this.statusPanelLogoutLabel,
      this.statusPanelToggleGfx,
      this.statusPanelToggleHit,
    );
    this.app?.stage.on('pointermove', this.handleStatusPanelBagPointerMove);
    this.app?.stage.on('pointerup', this.handleStatusPanelBagPointerUp);
    this.app?.stage.on('pointerupoutside', this.handleStatusPanelBagPointerUp);
    this.app?.stage.on('pointercancel', this.handleStatusPanelBagPointerUp);
    this.uiLayer.addChild(this.statusPanelRoot);
    this.setupLogoutConfirmOverlay();
    this.layoutStatusPanel();
    if (!STATUS_PANEL_ENABLED) {
      this.statusPanelRoot.visible = false;
      this.statusPanelToggleHit.eventMode = 'none';
    }
  }

  private layoutStatusPanel(): void {
    if (!STATUS_PANEL_ENABLED) {
      this.statusPanelRoot.visible = false;
      return;
    }
    const rowY = FLOATING_HUD_SECOND_ROW_Y;
    const tw = STATUS_PANEL_TOGGLE_W_PX;
    const th = STATUS_PANEL_TOGGLE_H_PX;
    const margin = STATUS_PANEL_RIGHT_MARGIN_PX;
    const gap = STATUS_PANEL_TOGGLE_GAP_PX;
    const bodyW = STATUS_PANEL_BODY_W_PX;
    const bodyH = this.statusPanelExpanded ? getStatusPanelExpandedBodyHeightPx() : 0;

    if (this.statusPanelExpanded) {
      const totalW = bodyW + gap + tw;
      this.statusPanelRoot.position.set(this.width - margin - totalW, rowY);
      this.statusPanelBodyGfx.position.set(0, 0);
      this.statusPanelToggleGfx.position.set(bodyW + gap, 0);
      this.statusPanelToggleHit.position.set(bodyW + gap, 0);
    } else {
      this.statusPanelRoot.position.set(this.width - margin - tw, rowY);
      this.statusPanelBodyGfx.position.set(0, 0);
      this.statusPanelToggleGfx.position.set(0, 0);
      this.statusPanelToggleHit.position.set(0, 0);
    }

    this.statusPanelToggleHit.clear();
    this.statusPanelToggleHit.rect(0, 0, tw, th).fill({ color: 0xffffff, alpha: 0.001 });
    this.statusPanelToggleHit.hitArea = new Rectangle(0, 0, tw, th);

    this.redrawStatusPanelChrome(bodyH);
    this.layoutStatusPanelInterior(bodyH);
  }

  private redrawStatusPanelChrome(bodyH: number): void {
    const tw = STATUS_PANEL_TOGGLE_W_PX;
    const th = STATUS_PANEL_TOGGLE_H_PX;
    const bodyW = STATUS_PANEL_BODY_W_PX;
    const inset = 11;
    const lineW = tw - inset * 2;

    this.statusPanelBodyGfx.clear();
    if (this.statusPanelExpanded && bodyH > 0) {
      this.statusPanelBodyGfx.roundRect(0, 0, bodyW, bodyH, STATUS_PANEL_ROUND_PX).fill({
        color: UI_PANEL_PURPLE,
        alpha: 0.88,
      });
      this.statusPanelBodyGfx.roundRect(0, 0, bodyW, bodyH, STATUS_PANEL_ROUND_PX).stroke({
        color: UI_NEON_GREEN,
        width: 2,
        alpha: 0.82,
      });
      this.statusPanelBodyGfx.visible = true;
    } else {
      this.statusPanelBodyGfx.visible = false;
    }

    this.statusPanelToggleGfx.clear();
    this.drawFloatingHudChip(this.statusPanelToggleGfx, tw, th, 10);

    if (!this.statusPanelExpanded) {
      const lineY1 = 10;
      const lineY2 = 16;
      const lineY3 = 22;
      this.statusPanelToggleGfx.rect(inset, lineY1, lineW, 2.5).fill({ color: UI_GOLD, alpha: 0.9 });
      this.statusPanelToggleGfx.rect(inset, lineY2, lineW, 2.5).fill({ color: UI_GOLD, alpha: 0.9 });
      this.statusPanelToggleGfx.rect(inset, lineY3, lineW, 2.5).fill({ color: UI_GOLD, alpha: 0.9 });
    } else {
      const my = th * 0.5 - 1.25;
      this.statusPanelToggleGfx.rect(inset, my, lineW, 2.5).fill({ color: UI_GOLD, alpha: 0.92 });
    }
  }

  private selectStatusPanelTab(tab: 'stats' | 'bag' | 'global'): void {
    if (this.statusPanelSidebarTab === tab) {
      return;
    }
    this.statusPanelSidebarTab = tab;
    if (tab === 'global') {
      void this.refreshSidebarLeaderboardFromRtdb();
    }
    this.layoutStatusPanel();
  }

  private drawStatusPanelTabButton(
    gfx: Graphics,
    x: number,
    y: number,
    w: number,
    h: number,
    active: boolean,
  ): void {
    gfx.clear();
    gfx.roundRect(x, y, w, h, 8).fill({
      color: UI_BG_BLACK,
      alpha: active ? 0.48 : 0.32,
    });
    const strokeColor = active ? UI_GOLD : UI_NEON_GREEN;
    gfx.roundRect(x, y, w, h, 8).stroke({
      color: strokeColor,
      width: active ? 2 : 1.5,
      alpha: active ? 0.92 : 0.55,
    });
    if (active) {
      gfx.rect(x + 5, y + h - 3, w - 10, 2.2).fill({ color: UI_GOLD, alpha: 0.88 });
      gfx.roundRect(x + 3, y + 3, w - 6, h - 6, 6).stroke({
        color: UI_NEON_GREEN,
        width: 1,
        alpha: 0.24,
      });
    }
    gfx.hitArea = new Rectangle(x, y, w, h);
  }

  private redrawStatusPanelTabs(
    tabStatsX: number,
    tabBagX: number,
    tabGlobalX: number,
    tabY: number,
    tabW: number,
    tabH: number,
  ): void {
    const statsActive = this.statusPanelSidebarTab === 'stats';
    const bagActive = this.statusPanelSidebarTab === 'bag';
    const globalActive = this.statusPanelSidebarTab === 'global';
    this.drawStatusPanelTabButton(
      this.statusPanelTabStatsBtn,
      tabStatsX,
      tabY,
      tabW,
      tabH,
      statsActive,
    );
    this.drawStatusPanelTabButton(
      this.statusPanelTabBagBtn,
      tabBagX,
      tabY,
      tabW,
      tabH,
      bagActive,
    );
    this.drawStatusPanelTabButton(
      this.statusPanelTabGlobalBtn,
      tabGlobalX,
      tabY,
      tabW,
      tabH,
      globalActive,
    );

    if (this.statusPanelTabStatsLabel) {
      this.statusPanelTabStatsLabel.position.set(tabStatsX + tabW * 0.5, tabY + tabH * 0.5);
      this.statusPanelTabStatsLabel.style.fill = statsActive ? '#fff8c8' : '#7a9a8a';
      this.statusPanelTabStatsLabel.style.stroke = statsActive
        ? { color: '#4a3200', width: 1.2 }
        : { color: '#0a120a', width: 1 };
    }
    if (this.statusPanelTabBagLabel) {
      this.statusPanelTabBagLabel.position.set(tabBagX + tabW * 0.5, tabY + tabH * 0.5);
      this.statusPanelTabBagLabel.style.fill = bagActive ? '#fff8c8' : '#7a9a8a';
      this.statusPanelTabBagLabel.style.stroke = bagActive
        ? { color: '#4a3200', width: 1.2 }
        : { color: '#0a120a', width: 1 };
    }
    if (this.statusPanelTabGlobalLabel) {
      this.statusPanelTabGlobalLabel.position.set(tabGlobalX + tabW * 0.5, tabY + tabH * 0.5);
      this.statusPanelTabGlobalLabel.style.fill = globalActive ? '#fff8c8' : '#7a9a8a';
      this.statusPanelTabGlobalLabel.style.stroke = globalActive
        ? { color: '#4a3200', width: 1.2 }
        : { color: '#0a120a', width: 1 };
    }
  }

  private applyStatusPanelTabVisibility(): void {
    const expanded = this.statusPanelExpanded;
    const statsTab = this.statusPanelSidebarTab === 'stats';
    const bagTab = this.statusPanelSidebarTab === 'bag';
    const globalTab = this.statusPanelSidebarTab === 'global';

    if (this.statusPanelMyStatsMainText) {
      this.statusPanelMyStatsMainText.visible = expanded && statsTab;
    }
    if (this.statusPanelMyStatsPtsText) {
      this.statusPanelMyStatsPtsText.visible = expanded && statsTab;
    }
    if (this.statusPanelPtsPillGfx) {
      this.statusPanelPtsPillGfx.visible = expanded && statsTab;
    }
    this.statusPanelBagRoot.visible = expanded && bagTab;

    this.statusPanelLbViewport.visible = expanded && globalTab;
    this.statusPanelLbViewport.eventMode = globalTab ? 'static' : 'none';

    if (this.statusPanelTabStatsBtn) {
      this.statusPanelTabStatsBtn.visible = expanded;
    }
    if (this.statusPanelTabBagBtn) {
      this.statusPanelTabBagBtn.visible = expanded;
    }
    if (this.statusPanelTabGlobalBtn) {
      this.statusPanelTabGlobalBtn.visible = expanded;
    }
    if (this.statusPanelTabStatsLabel) {
      this.statusPanelTabStatsLabel.visible = expanded;
    }
    if (this.statusPanelTabBagLabel) {
      this.statusPanelTabBagLabel.visible = expanded;
    }
    if (this.statusPanelTabGlobalLabel) {
      this.statusPanelTabGlobalLabel.visible = expanded;
    }

    if (!globalTab) {
      if (this.statusPanelLbLoading) {
        this.statusPanelLbLoading.visible = false;
      }
      if (this.statusPanelLbEmpty) {
        this.statusPanelLbEmpty.visible = false;
      }
    }
  }

  private refreshStatusPanelContent(): void {
    const main = this.statusPanelMyStatsMainText;
    const pts = this.statusPanelMyStatsPtsText;
    if (!main || !pts || !this.statusPanelExpanded) {
      return;
    }
    const session = getGameUserSession();
    const nick = session?.nickname?.trim() || '—';
    const pbH = session?.personalBest.maxHeightMeters ?? 0;
    const best = Math.max(pbH, this.peakClimbMetersThisRun);
    const comboPb = session?.personalBest.bestCombo ?? 0;
    const comboMax = Math.max(comboPb, this.peakComboThisRun, this.comboCount);
    const sessionPts = session?.personalBest.totalPoints ?? 0;
    const livePts = Math.max(0, Math.floor(this.score));
    const totalPts = Math.max(sessionPts, livePts);

    main.text = [
      `NICK  ${nick}`,
      `BEST HEIGHT  ${best.toLocaleString()} m`,
      `MAX COMBO   ${comboMax.toLocaleString()}`,
      `RUN LOOT   ${this.runGoldCollected.toLocaleString()} gold · ${this.runDiamondCollected.toLocaleString()} gems`,
    ].join('\n');
    pts.text = `TOTAL PTS  ${totalPts.toLocaleString()}`;

    const pad = STATUS_PANEL_BODY_PAD_PX;
    const innerW = STATUS_PANEL_BODY_W_PX - pad * 2;
    const top = STATUS_PANEL_BODY_TOP_PAD_PX;
    const yTab = top + STATUS_PANEL_TAB_BAR_H_PX + STATUS_PANEL_TAB_INNER_GAP_PX;
    const lh = 16;
    const gPts = 4;
    const ptsRowTop = yTab + lh * 4 + gPts;

    /** Horizontal padding inside the gold capsule (CSS padding-inline). */
    const pillPadInline = 12;
    /** Vertical padding above/below the line box inside the capsule. */
    const pillPadBlock = 6;

    const pill = this.statusPanelPtsPillGfx;
    pill.clear();

    const lineBoxH = Math.max(pts.height, lh);
    const textW = Math.max(pts.width, 8);
    const naturalW = Math.ceil(textW + pillPadInline * 2);
    const pillW = Math.min(naturalW, innerW);
    const pillH = Math.ceil(lineBoxH + pillPadBlock * 2);
    const pillX = pad;
    const pillY = ptsRowTop;

    const statsTab = this.statusPanelSidebarTab === 'stats';
    if (statsTab) {
      pill.roundRect(pillX, pillY, pillW, pillH, 10).fill({ color: 0x2a2210, alpha: 0.94 });
      pill.roundRect(pillX, pillY, pillW, pillH, 10).stroke({ color: 0xffcc33, width: 1.25, alpha: 0.72 });
    }

    main.position.set(pad, yTab);
    pts.position.set(pillX + pillW * 0.5, pillY + pillH * 0.5);
    this.statusPanelBagRoot.position.set(pad, yTab);
    this.renderStatusPanelBag();

    this.applyStatusPanelTabVisibility();
  }

  private resetBagSlots(): void {
    this.statusPanelBagSlotItems = Array.from({ length: STATUS_PANEL_BAG_SLOT_COUNT }, () => null);
    this.statusPanelBagDragState = null;
    this.statusPanelBagDragGhost.visible = false;
  }

  private createStatusPanelBagSlots(): void {
    for (let i = 0; i < STATUS_PANEL_BAG_SLOT_COUNT; i += 1) {
      const slot = new Graphics();
      slot.eventMode = 'static';
      slot.cursor = 'grab';
      slot.on('pointerdown', (event: FederatedPointerEvent) => {
        this.handleStatusPanelBagSlotPointerDown(i, event);
      });
      this.statusPanelBagRoot.addChild(slot);
      this.statusPanelBagSlots.push(slot);
    }
  }

  private ensureBagItemSlot(kind: BagItemKind): void {
    const existingIndex = this.statusPanelBagSlotItems.findIndex((item) => item?.kind === kind);
    if (existingIndex >= 0) {
      return;
    }
    const emptyIndex = this.statusPanelBagSlotItems.findIndex((item) => item === null);
    if (emptyIndex >= 0) {
      this.statusPanelBagSlotItems[emptyIndex] = { kind };
    }
  }

  private getBagItemCount(kind: BagItemKind): number {
    if (kind === 'gold') {
      return this.remoteBagGold;
    }
    return this.remoteBagDiamond;
  }

  private renderBagIcon(gfx: Graphics, kind: BagItemKind, cx: number, cy: number, scale = 1): void {
    if (kind === 'gold') {
      gfx.circle(cx, cy, 8 * scale).fill({ color: UI_GOLD, alpha: 0.96 });
      gfx.circle(cx, cy, 8 * scale).stroke({ color: UI_NEON_GREEN, width: 1.5 * scale, alpha: 0.74 });
      gfx
        .poly([
          cx,
          cy - 5 * scale,
          cx + 1.4 * scale,
          cy - 1.7 * scale,
          cx + 5.1 * scale,
          cy - 1.7 * scale,
          cx + 2.1 * scale,
          cy + 0.5 * scale,
          cx + 3.2 * scale,
          cy + 4.4 * scale,
          cx,
          cy + 2.1 * scale,
          cx - 3.2 * scale,
          cy + 4.4 * scale,
          cx - 2.1 * scale,
          cy + 0.5 * scale,
          cx - 5.1 * scale,
          cy - 1.7 * scale,
          cx - 1.4 * scale,
          cy - 1.7 * scale,
        ])
        .fill({ color: 0xffff88, alpha: 0.9 });
      return;
    }

    if (kind === 'diamond') {
      const diamond = [
        cx,
        cy - 9 * scale,
        cx + 8 * scale,
        cy,
        cx,
        cy + 9 * scale,
        cx - 8 * scale,
        cy,
      ];
      gfx.poly(diamond).fill({ color: 0x9fe8ff, alpha: 0.97 });
      gfx.poly(diamond).stroke({ color: UI_NEON_GREEN, width: 1.4 * scale, alpha: 0.82 });
      gfx.poly([cx, cy - 6 * scale, cx + 5 * scale, cy, cx, cy + 5 * scale, cx - 5 * scale, cy]).stroke({
        color: 0xffffff,
        width: 0.9 * scale,
        alpha: 0.55,
      });
      return;
    }
  }

  private renderStatusPanelBag(): void {
    this.ensureBagItemSlot('gold');
    this.ensureBagItemSlot('diamond');

    const slot = STATUS_PANEL_BAG_SLOT_PX;
    const gap = STATUS_PANEL_BAG_SLOT_GAP_PX;
    for (let i = 0; i < this.statusPanelBagSlots.length; i += 1) {
      const col = i % STATUS_PANEL_BAG_COLS;
      const row = Math.floor(i / STATUS_PANEL_BAG_COLS);
      const x = col * (slot + gap);
      const y = row * (slot + gap);
      const gfx = this.statusPanelBagSlots[i];
      gfx.position.set(x, y);
      gfx.clear();
      gfx.roundRect(0, 0, slot, slot, 5).fill({ color: UI_BG_BLACK, alpha: 0.5 });
      gfx.roundRect(0, 0, slot, slot, 5).stroke({ color: UI_NEON_GREEN, width: 1.2, alpha: 0.45 });
      gfx.hitArea = new Rectangle(0, 0, slot, slot);
    }

    this.statusPanelBagItems.removeChildren().forEach((child) => child.destroy({ children: true }));
    for (let i = 0; i < this.statusPanelBagSlotItems.length; i += 1) {
      const item = this.statusPanelBagSlotItems[i];
      if (!item || this.statusPanelBagDragState?.fromSlot === i) {
        continue;
      }
      const count = this.getBagItemCount(item.kind);
      this.statusPanelBagItems.addChild(this.createBagItemDisplay(item.kind, count, i));
    }
  }

  private createBagItemDisplay(kind: BagItemKind, count: number, slotIndex: number): Container {
    const slot = STATUS_PANEL_BAG_SLOT_PX;
    const gap = STATUS_PANEL_BAG_SLOT_GAP_PX;
    const col = slotIndex % STATUS_PANEL_BAG_COLS;
    const row = Math.floor(slotIndex / STATUS_PANEL_BAG_COLS);
    const root = new Container();
    const gfx = new Graphics();
    const label = new Text({
      text: count.toLocaleString(),
      style: new TextStyle({
        fontFamily: 'Orbitron, Arial Black, sans-serif',
        fontSize: 9,
        fontWeight: '900',
        fill: '#fff8c8',
        stroke: { color: '#0a120a', width: 2 },
      }),
    });
    label.anchor.set(1, 1);
    this.renderBagIcon(gfx, kind, slot * 0.5, slot * 0.43, 0.92);
    label.position.set(slot - 2, slot - 1);
    root.position.set(col * (slot + gap), row * (slot + gap));
    root.addChild(gfx, label);
    return root;
  }

  private handleStatusPanelBagSlotPointerDown(slotIndex: number, event: FederatedPointerEvent): void {
    event.stopPropagation();
    if (!this.statusPanelExpanded || this.statusPanelSidebarTab !== 'bag') {
      return;
    }
    const item = this.statusPanelBagSlotItems[slotIndex];
    if (!item || this.getBagItemCount(item.kind) <= 0) {
      return;
    }
    this.statusPanelBagDragState = { fromSlot: slotIndex, item: { ...item } };
    this.statusPanelBagDragGhost.visible = true;
    this.renderStatusPanelBagDragGhost(item.kind);
    this.updateStatusPanelBagDragGhost(event);
    this.renderStatusPanelBag();
  }

  private renderStatusPanelBagDragGhost(kind: BagItemKind): void {
    this.statusPanelBagDragGhost.removeChildren().forEach((child) => child.destroy({ children: true }));
    const gfx = new Graphics();
    gfx.roundRect(-15, -15, 30, 30, 6).fill({ color: UI_BG_BLACK, alpha: 0.6 });
    gfx.roundRect(-15, -15, 30, 30, 6).stroke({ color: UI_GOLD, width: 1.5, alpha: 0.88 });
    this.renderBagIcon(gfx, kind, 0, -1, 0.95);
    this.statusPanelBagDragGhost.addChild(gfx);
  }

  private updateStatusPanelBagDragGhost(event: FederatedPointerEvent): void {
    if (!this.statusPanelBagDragState) {
      return;
    }
    const local = this.statusPanelBagRoot.toLocal(event.global);
    this.statusPanelBagDragGhost.position.set(local.x, local.y);
  }

  private getBagSlotIndexAtLocal(x: number, y: number): number | null {
    const slot = STATUS_PANEL_BAG_SLOT_PX;
    const gap = STATUS_PANEL_BAG_SLOT_GAP_PX;
    const col = Math.floor(x / (slot + gap));
    const row = Math.floor(y / (slot + gap));
    if (col < 0 || col >= STATUS_PANEL_BAG_COLS || row < 0) {
      return null;
    }
    const cellX = x - col * (slot + gap);
    const cellY = y - row * (slot + gap);
    if (cellX < 0 || cellX > slot || cellY < 0 || cellY > slot) {
      return null;
    }
    const index = row * STATUS_PANEL_BAG_COLS + col;
    return index >= 0 && index < STATUS_PANEL_BAG_SLOT_COUNT ? index : null;
  }

  private readonly handleStatusPanelBagPointerMove = (event: FederatedPointerEvent): void => {
    this.updateStatusPanelBagDragGhost(event);
  };

  private readonly handleStatusPanelBagPointerUp = (event: FederatedPointerEvent): void => {
    const drag = this.statusPanelBagDragState;
    if (!drag) {
      return;
    }
    const local = this.statusPanelBagRoot.toLocal(event.global);
    const toSlot = this.getBagSlotIndexAtLocal(local.x, local.y);
    if (toSlot !== null && toSlot !== drag.fromSlot) {
      const target = this.statusPanelBagSlotItems[toSlot];
      this.statusPanelBagSlotItems[toSlot] = drag.item;
      this.statusPanelBagSlotItems[drag.fromSlot] = target;
    }
    this.statusPanelBagDragState = null;
    this.statusPanelBagDragGhost.visible = false;
    this.renderStatusPanelBag();
  };

  private createSidebarLbRowStyle(highlight: boolean): TextStyle {
    return new TextStyle({
      fontFamily: 'Orbitron, "Press Start 2P", Arial Black, sans-serif',
      fontSize: 9,
      fontWeight: highlight ? '800' : '700',
      fill: highlight ? '#FFD700' : '#b8d4c4',
      stroke: { color: highlight ? '#4a3200' : '#152218', width: highlight ? 1.15 : 1 },
      letterSpacing: 0.2,
    });
  }

  private clearSidebarLeaderboardVisuals(): void {
    const removed = this.statusPanelLbScroll.removeChildren();
    for (const c of removed) {
      c.destroy({ children: true });
    }
    this.statusPanelLbRowBg = [];
    this.statusPanelLbRows = [];
    this.sidebarLbContentH = 0;
    this.sidebarLbScrollPx = 0;
    this.statusPanelLbScroll.position.set(0, 0);
  }

  private rowIsCurrentPlayer(e: LeaderboardEntry): boolean {
    const uid = auth.currentUser?.uid;
    if (uid && e.playerUid && e.playerUid === uid) {
      return true;
    }
    const sess = getGameUserSession();
    if (!e.playerUid && sess?.nickname) {
      return (
        e.nickname.trim().toLowerCase() === sess.nickname.trim().toLowerCase()
      );
    }
    return false;
  }

  private renderSidebarLeaderboardRows(entries: LeaderboardEntry[]): void {
    this.clearSidebarLeaderboardVisuals();
    const vw = Math.max(40, this.sidebarLbViewportW);
    const lineH = STATUS_PANEL_LB_ROW_LINE_PX;

    if (entries.length === 0) {
      if (this.statusPanelLbEmpty) {
        this.statusPanelLbEmpty.visible = true;
        this.statusPanelLbEmpty.text = 'No scores yet.';
      }
      return;
    }

    if (this.statusPanelLbEmpty) {
      this.statusPanelLbEmpty.visible = false;
    }

    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const rank = i + 1;
      const nick = (e.nickname.trim() || 'Player').slice(0, 9);
      const pts = Math.max(0, Math.floor(e.totalScore));
      const h = Math.max(0, Math.floor(e.maxHeightMeters));
      const line = `${rank}  ${nick}  ${pts.toLocaleString()}p  ${h}m`;
      const hi = this.rowIsCurrentPlayer(e);

      const bg = new Graphics();
      bg.roundRect(0, i * lineH, vw, lineH - 1, 4).fill({
        color: hi ? UI_NEON_GREEN : UI_BG_BLACK,
        alpha: hi ? 0.2 : 0.14,
      });
      if (hi) {
        bg.roundRect(0, i * lineH, vw, lineH - 1, 4).stroke({
          color: UI_GOLD,
          width: 1,
          alpha: 0.55,
        });
      }
      const t = new Text({
        text: line,
        style: this.createSidebarLbRowStyle(hi),
      });
      t.position.set(5, i * lineH + 2);

      this.statusPanelLbScroll.addChild(bg, t);
      this.statusPanelLbRowBg.push(bg);
      this.statusPanelLbRows.push(t);
    }

    this.sidebarLbContentH = entries.length * lineH;
    const maxScroll = Math.max(0, this.sidebarLbContentH - STATUS_PANEL_LB_VIEWPORT_H_PX);
    this.sidebarLbScrollPx = Math.min(this.sidebarLbScrollPx, maxScroll);
    this.statusPanelLbScroll.position.y = -this.sidebarLbScrollPx;
  }

  private async refreshSidebarLeaderboardFromRtdb(): Promise<void> {
    if (!this.statusPanelExpanded || this.statusPanelSidebarTab !== 'global') {
      return;
    }
    if (this.statusPanelLbLoading) {
      this.statusPanelLbLoading.visible = true;
    }
    if (this.statusPanelLbEmpty) {
      this.statusPanelLbEmpty.visible = false;
    }
    try {
      const entries = await fetchTopLeaderboard(LEADERBOARD_DISPLAY_LIMIT);
      this.renderSidebarLeaderboardRows(entries);
    } catch {
      this.clearSidebarLeaderboardVisuals();
      if (this.statusPanelLbEmpty) {
        this.statusPanelLbEmpty.text = 'Could not load.';
        this.statusPanelLbEmpty.visible = true;
      }
    } finally {
      if (this.statusPanelLbLoading) {
        this.statusPanelLbLoading.visible = false;
      }
    }
  }

  private layoutStatusPanelInterior(bodyH: number): void {
    const bodyW = STATUS_PANEL_BODY_W_PX;
    const pad = STATUS_PANEL_BODY_PAD_PX;
    const btnW = bodyW - pad * 2;
    const btnH = STATUS_PANEL_LOGOUT_BTN_H_PX;
    const expanded = this.statusPanelExpanded && bodyH > 0;
    if (!expanded) {
      this.statusPanelSepGfx.clear();
      this.statusPanelSepGfx.visible = false;
      this.statusPanelLogoutBtn.clear();
      this.statusPanelLogoutBtn.visible = false;
      this.statusPanelLogoutBtn.hitArea = null;
      if (this.statusPanelLogoutLabel) {
        this.statusPanelLogoutLabel.visible = false;
      }
      if (this.statusPanelMyStatsMainText) {
        this.statusPanelMyStatsMainText.visible = false;
      }
      if (this.statusPanelMyStatsPtsText) {
        this.statusPanelMyStatsPtsText.visible = false;
      }
      if (this.statusPanelPtsPillGfx) {
        this.statusPanelPtsPillGfx.visible = false;
      }
      this.statusPanelBagRoot.visible = false;
      if (this.statusPanelTabStatsBtn) {
        this.statusPanelTabStatsBtn.clear();
        this.statusPanelTabStatsBtn.visible = false;
        this.statusPanelTabStatsBtn.hitArea = null;
      }
      if (this.statusPanelTabBagBtn) {
        this.statusPanelTabBagBtn.clear();
        this.statusPanelTabBagBtn.visible = false;
        this.statusPanelTabBagBtn.hitArea = null;
      }
      if (this.statusPanelTabGlobalBtn) {
        this.statusPanelTabGlobalBtn.clear();
        this.statusPanelTabGlobalBtn.visible = false;
        this.statusPanelTabGlobalBtn.hitArea = null;
      }
      if (this.statusPanelTabStatsLabel) {
        this.statusPanelTabStatsLabel.visible = false;
      }
      if (this.statusPanelTabBagLabel) {
        this.statusPanelTabBagLabel.visible = false;
      }
      if (this.statusPanelTabGlobalLabel) {
        this.statusPanelTabGlobalLabel.visible = false;
      }
      this.statusPanelLbViewport.visible = false;
      if (this.statusPanelLbLoading) {
        this.statusPanelLbLoading.visible = false;
      }
      if (this.statusPanelLbEmpty) {
        this.statusPanelLbEmpty.visible = false;
      }
      return;
    }

    const top = STATUS_PANEL_BODY_TOP_PAD_PX;
    const innerW = bodyW - pad * 2;
    const tabGap = STATUS_PANEL_TAB_GAP_PX;
    const tabW = (innerW - tabGap * 2) / 3;
    const tabStatsX = pad;
    const tabY = top;
    const tabBagX = pad + tabW + tabGap;
    const tabGlobalX = tabBagX + tabW + tabGap;
    const tabH = STATUS_PANEL_TAB_BAR_H_PX;
    this.redrawStatusPanelTabs(tabStatsX, tabBagX, tabGlobalX, tabY, tabW, tabH);

    const yContent = top + STATUS_PANEL_TAB_BAR_H_PX + STATUS_PANEL_TAB_INNER_GAP_PX;

    this.sidebarLbViewportW = innerW;
    const vw = this.sidebarLbViewportW;
    const vh = STATUS_PANEL_LB_VIEWPORT_H_PX;
    this.statusPanelLbViewport.position.set(pad, yContent);

    this.statusPanelLbMask.clear();
    this.statusPanelLbMask.roundRect(0, 0, vw, vh, 6).fill({ color: 0xffffff, alpha: 1 });
    this.statusPanelLbLoading?.position.set(vw * 0.5, vh * 0.5);
    this.statusPanelLbEmpty?.position.set(vw * 0.5, vh * 0.45);

    this.statusPanelSepGfx.visible = true;
    this.statusPanelLogoutBtn.visible = true;
    if (this.statusPanelLogoutLabel) {
      this.statusPanelLogoutLabel.visible = true;
    }

    const logoutY = bodyH - pad - btnH;
    const sepY = logoutY - STATUS_PANEL_STATS_LOGOUT_GAP_PX;

    this.statusPanelSepGfx.clear();
    this.statusPanelSepGfx.moveTo(pad, sepY).lineTo(bodyW - pad, sepY).stroke({
      color: UI_NEON_GREEN,
      width: 1,
      alpha: 0.42,
    });

    this.drawOverlayButton(this.statusPanelLogoutBtn, pad, logoutY, btnW, btnH);
    this.statusPanelLogoutBtn.hitArea = new Rectangle(pad, logoutY, btnW, btnH);
    this.statusPanelLogoutLabel?.position.set(pad + btnW * 0.5, logoutY + btnH * 0.5);

    this.refreshStatusPanelContent();
  }

  private setupLogoutConfirmOverlay(): void {
    this.logoutConfirmOverlay.zIndex = 1270;
    this.logoutConfirmOverlay.visible = false;
    this.logoutConfirmOverlay.eventMode = 'passive';
    this.logoutConfirmOverlay.interactiveChildren = true;

    this.logoutConfirmBackdrop.eventMode = 'static';
    this.logoutConfirmBackdrop.on('pointerdown', (event) => {
      event.stopPropagation();
    });
    this.logoutConfirmBackdrop.on('pointertap', (event) => {
      event.stopPropagation();
      this.hideLogoutConfirm();
    });

    this.logoutConfirmPanel.eventMode = 'none';

    this.logoutConfirmTitle = new Text({
      text: 'Log out?',
      style: this.createNeonGoldTextStyle(22, 3),
    });
    this.logoutConfirmTitle.anchor.set(0.5);
    this.logoutConfirmTitle.eventMode = 'none';

    this.logoutConfirmSubtitle = new Text({
      text: 'Are you sure?\nYou will return to the login screen.',
      style: new TextStyle({
        fontFamily: 'Orbitron, "Press Start 2P", Arial Black, sans-serif',
        fontSize: 12,
        fontWeight: '600',
        fill: '#9ab8a8',
        stroke: { color: '#0d180d', width: 1 },
        align: 'center',
        lineHeight: 17,
      }),
    });
    this.logoutConfirmSubtitle.anchor.set(0.5);
    this.logoutConfirmSubtitle.eventMode = 'none';

    this.logoutConfirmCancelBtn.eventMode = 'static';
    this.logoutConfirmCancelBtn.cursor = 'pointer';
    this.logoutConfirmCancelBtn.on('pointerdown', (event) => {
      event.stopPropagation();
    });
    this.logoutConfirmCancelBtn.on('pointertap', (event) => {
      event.stopPropagation();
      this.hideLogoutConfirm();
    });

    this.logoutConfirmCancelLabel = new Text({
      text: 'CANCEL',
      style: this.createNeonGoldTextStyle(14, 2.4),
    });
    this.logoutConfirmCancelLabel.anchor.set(0.5);
    this.logoutConfirmCancelLabel.eventMode = 'none';

    this.logoutConfirmOkBtn.eventMode = 'static';
    this.logoutConfirmOkBtn.cursor = 'pointer';
    this.logoutConfirmOkBtn.on('pointerdown', (event) => {
      event.stopPropagation();
    });
    this.logoutConfirmOkBtn.on('pointertap', (event) => {
      event.stopPropagation();
      void this.performLogoutAndReload();
    });

    this.logoutConfirmOkLabel = new Text({
      text: 'LOG OUT',
      style: new TextStyle({
        fontFamily: 'Orbitron, "Press Start 2P", Arial Black, sans-serif',
        fontSize: 14,
        fontWeight: '800',
        fill: '#f0a0a0',
        stroke: { color: '#4a1515', width: 1.5 },
        letterSpacing: 0.6,
      }),
    });
    this.logoutConfirmOkLabel.anchor.set(0.5);
    this.logoutConfirmOkLabel.eventMode = 'none';

    this.logoutConfirmOverlay.addChild(
      this.logoutConfirmBackdrop,
      this.logoutConfirmPanel,
      this.logoutConfirmTitle,
      this.logoutConfirmSubtitle,
      this.logoutConfirmCancelBtn,
      this.logoutConfirmCancelLabel,
      this.logoutConfirmOkBtn,
      this.logoutConfirmOkLabel,
    );
    this.uiLayer.addChild(this.logoutConfirmOverlay);
    this.layoutLogoutConfirmOverlay();
  }

  private layoutLogoutConfirmOverlay(): void {
    const overlayW = this.width;
    const overlayH = this.height;
    this.logoutConfirmBackdrop.clear();
    this.logoutConfirmBackdrop
      .rect(0, 0, overlayW, overlayH)
      .fill({ color: 0x000000, alpha: 0.6 });

    const panelW = Math.min(360, overlayW - 36);
    const panelH = Math.min(228, overlayH - 48);
    const px = (overlayW - panelW) * 0.5;
    const py = (overlayH - panelH) * 0.5;

    this.logoutConfirmPanel.clear();
    this.logoutConfirmPanel.roundRect(px, py, panelW, panelH, 18).fill({
      color: UI_PANEL_PURPLE,
      alpha: 0.9,
    });
    this.logoutConfirmPanel.roundRect(px, py, panelW, panelH, 18).stroke({
      color: UI_NEON_GREEN,
      width: 2,
      alpha: 0.82,
    });

    this.logoutConfirmTitle?.position.set(overlayW * 0.5, py + 48);
    this.logoutConfirmSubtitle?.position.set(overlayW * 0.5, py + 102);

    const btnW = Math.min(132, (panelW - 42) * 0.47);
    const btnH = 48;
    const gap = 12;
    const pairW = btnW * 2 + gap;
    const startX = overlayW * 0.5 - pairW * 0.5;
    const btnY = py + panelH - btnH - 28;

    this.drawOverlayButton(this.logoutConfirmCancelBtn, startX, btnY, btnW, btnH);
    this.logoutConfirmCancelBtn.hitArea = new Rectangle(startX, btnY, btnW, btnH);
    this.logoutConfirmCancelLabel?.position.set(startX + btnW * 0.5, btnY + btnH * 0.5);

    const okX = startX + btnW + gap;
    this.drawOverlayButton(this.logoutConfirmOkBtn, okX, btnY, btnW, btnH);
    this.logoutConfirmOkBtn.hitArea = new Rectangle(okX, btnY, btnW, btnH);
    this.logoutConfirmOkLabel?.position.set(okX + btnW * 0.5, btnY + btnH * 0.5);
  }

  private showLogoutConfirm(): void {
    this.logoutConfirmOverlay.visible = true;
    this.layoutLogoutConfirmOverlay();
  }

  private hideLogoutConfirm(): void {
    this.logoutConfirmOverlay.visible = false;
  }

  private async performLogoutAndReload(): Promise<void> {
    this.hideLogoutConfirm();
    await logoutAndReturnToLogin();
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
    if (ATTACK_VIRTUAL_BUTTON_VISIBLE) {
      this.attackBtn.eventMode = 'static';
      this.attackBtn.cursor = 'pointer';
      this.attackBtn.on('pointerdown', (event) => {
        event.stopPropagation();
        this.playerAttack();
      });
      this.attackBtnRoot.visible = true;
    } else {
      this.attackBtn.eventMode = 'none';
      this.attackBtn.cursor = 'default';
      this.attackBtnRoot.visible = false;
    }
    this.attackBtnIcon.eventMode = 'none';
    this.attackBtnRoot.addChild(this.attackBtn, this.attackBtnIcon);
    this.uiLayer.addChild(this.attackBtnRoot);
    this.layoutAttackButton();
  }

  private layoutAttackButton(): void {
    if (!ATTACK_VIRTUAL_BUTTON_VISIBLE) {
      return;
    }
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
    if (!ATTACK_VIRTUAL_BUTTON_VISIBLE) {
      return;
    }
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

  private tickPlayerShield(dt: number): void {
    this.shieldSaveFlashTime = Math.max(0, this.shieldSaveFlashTime - dt);
  }

  /**
   * One-shot fall-save: only {@link checkFallGameOver} may call this after feet cross the viewport-bottom
   * death hazard.
   */
  private consumeFallShield(): boolean {
    if (this.fallShields <= 0) {
      return false;
    }
    this.fallShields -= 1;
    this.refreshCollectibleHudText();
    return true;
  }

  private setupSpeedTierPulseOverlay(): void {
    this.speedPulseGfx.eventMode = 'none';
    this.speedPulseGfx.visible = false;
    this.speedPulseGfx.zIndex = 1105;
    this.uiLayer.addChild(this.speedPulseGfx);
    this.redrawSpeedPulseOverlay();
  }

  private syncHeaderPauseHudLayer(): void {
    // Keep the pause coin tappable above the dim overlay so a second tap resumes.
    this.headerPauseRoot.zIndex = this.paused ? HEADER_PAUSE_BTN_Z_INDEX_PAUSED : HEADER_PAUSE_BTN_Z_INDEX;
    this.uiLayer.sortChildren();
  }

  private togglePauseFromHeaderButton(): void {
    if (this.gameOver) {
      return;
    }
    if (this.paused) {
      this.resumeFromPause();
      return;
    }
    this.requestPause();
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
    this.refreshPauseTouchLockLabel();
    this.syncHeaderPauseHudLayer();
    this.bgm?.pause();
    this.sfx.endWallSlideLoop();
    this.wallSlideFasciaSfxStreamingMemo = false;
  }

  private resumeFromPause(): void {
    if (!this.paused) {
      return;
    }
    this.paused = false;
    this.pauseOverlay.visible = false;
    this.syncHeaderPauseHudLayer();
    void this.bgm?.play().catch(() => {
      /* autoplay */
    });
  }

  private returnToMainMenuFromPause(): void {
    if (!this.onBackToMenu) {
      return;
    }
    this.paused = false;
    this.pauseOverlay.visible = false;
    this.hideLogoutConfirm();
    this.stopBackgroundMusic();
    void Promise.resolve(this.onBackToMenu());
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
    const data = entries.slice(0, LEADERBOARD_DISPLAY_LIMIT);
    const showEmptyState = entries.length === 0 && !loading;

    if (this.leaderboardEmptyHint) {
      this.leaderboardEmptyHint.visible = showEmptyState;
      const emptyY = rowsStartY + LEADERBOARD_DISPLAY_LIMIT * rowH * 0.45;
      this.leaderboardEmptyHint.position.set(overlayW * 0.5, emptyY);
    }

    if (!showEmptyState) {
      for (let i = 0; i < LEADERBOARD_DISPLAY_LIMIT; i += 1) {
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
    this.cameraScrollVelocityPx = 0;
    this.sfx.endWallSlideLoop();
    this.wallSlideFasciaSfxStreamingMemo = false;
    this.peakComboThisRun = Math.max(this.peakComboThisRun, this.comboCount);
    this.speedTierUiFlashTime = 0;
    this.speedPulseGfx.visible = false;
    this.speedPulseGfx.alpha = 1;
    this.paused = false;
    this.pauseOverlay.visible = false;
    this.headerPauseRoot.visible = false;
    this.statusPanelRoot.visible = false;
    this.attackBtnRoot.visible = false;
    this.finalMetersAtDeath = Math.max(
      0,
      Math.floor(this.getHudClimbMeters()),
      Math.floor(this.getBestLandedClimbMeters()),
    );
    this.peakClimbMetersThisRun = Math.max(
      this.peakClimbMetersThisRun,
      this.finalMetersAtDeath,
      Math.floor(this.getHudClimbMeters()),
      Math.floor(this.getBestLandedClimbMeters()),
    );
    this.recomputeDerivedTotalScore();
    const totalForLeaderboard = this.score;
    this.breakCombo();
    this.refreshGameOverScoreText();
    this.gameOverOverlay.visible = true;
    this.leaderboardOverlay.visible = false;
    this.touchPointers.clear();
    this.touchControlPointerId = null;
    this.input?.setTouchFollowAxis(0);
    this.touchControlsLayer.visible = false;
    this.syncPlatformSpritesFromPlatforms();
    this.drawDynamicWorld();
    this.applyCameraTransform();
    if (!this.deathSubmitted) {
      this.deathSubmitted = true;
      void (async () => {
        const user = auth.currentUser;
        if (!user?.uid) {
          console.warn('[PlayScene] No signed-in user — leaderboard save skipped');
          return;
        }
        const hPB = Math.max(0, Math.floor(this.peakClimbMetersThisRun));
        const cPB = Math.max(0, Math.floor(this.peakComboThisRun));

        const goldEarned = this.runGoldCollected;
        const diamondEarned = this.runDiamondCollected;
        try {
          await incrementUserBagBalances(
            user.uid,
            goldEarned,
            diamondEarned,
            0,
          );
          writeMenuBagCache(
            this.remoteBagGold + goldEarned,
            this.remoteBagDiamond + diamondEarned,
            user.uid,
          );
        } catch (bagErr) {
          console.warn('[PlayScene] YOUR BAG persist failed — loot may not be saved', bagErr);
        }

        try {
          await upsertPersonalBestIfBetter(user, hPB, cPB, Math.floor(totalForLeaderboard));
          patchSessionPersonalBest(hPB, cPB, Math.floor(totalForLeaderboard));
          this.refreshStatusPanelContent();
        } catch {
          /* offline / rules — still try leaderboard with last known ledger */
        }

        let sessionRow: LeaderboardEntry;
        try {
          const synced = await buildLeaderboardRowFromSyncedUser(user.uid, totalForLeaderboard);
          if (!synced) {
            console.warn('[PlayScene] Missing /users/ ledger — leaderboard save skipped');
            return;
          }
          sessionRow = synced;
        } catch {
          console.error('[PlayScene] Failed building synced leaderboard row');
          return;
        }

        let remote: LeaderboardEntry[];
        try {
          remote = await fetchTopLeaderboard(LEADERBOARD_DISPLAY_LIMIT);
        } catch (fetchErr) {
          console.error(
            '[PlayScene] leaderboard qualifying fetch failed — run not saved',
            fetchErr,
          );
          return;
        }
        if (!sessionQualifiesForTop(remote, sessionRow, LEADERBOARD_DISPLAY_LIMIT)) {
          console.info('[PlayScene] leaderboard run below top five — not saved', sessionRow);
          return;
        }
        try {
          await saveLeaderboardRun({
            nickname: sessionRow.nickname,
            totalScore: sessionRow.totalScore,
            maxHeightMeters: sessionRow.maxHeightMeters,
            bestCombo: sessionRow.bestCombo,
            playerUid: user.uid,
          });
          console.info('[PlayScene] leaderboard run saved', sessionRow);
          this.showScoreSavedHint();
          this.lastLeaderboardTop = mergeSessionIntoTop(remote, sessionRow, LEADERBOARD_DISPLAY_LIMIT);
          if (this.leaderboardOverlay.visible) {
            this.renderLeaderboardShell(this.lastLeaderboardTop, false);
          }
        } catch (err) {
          console.error('[PlayScene] leaderboard save failed', err);
          if (this.leaderboardOverlay.visible) {
            void fetchTopLeaderboard(LEADERBOARD_DISPLAY_LIMIT)
              .then((top) => {
                this.lastLeaderboardTop = top;
                if (this.leaderboardOverlay.visible) {
                  this.renderLeaderboardShell(top, false);
                }
              })
              .catch(() => {});
          }
        }
      })();
    }
  }

  private startUserBagRealtimeSubscription(): void {
    if (this.userBagUnsubscribe) {
      return;
    }
    const uid = auth.currentUser?.uid;
    if (!uid) {
      return;
    }
    this.userBagUnsubscribe = subscribeUserBagBalances(
      uid,
      (b) => {
        this.remoteBagGold = b.bagGold;
        this.remoteBagDiamond = b.bagDiamonds;
        writeMenuBagCache(b.bagGold, b.bagDiamonds, uid);
        if (this.statusPanelExpanded) {
          this.refreshStatusPanelContent();
        }
      },
      (err) => {
        console.warn('[PlayScene] YOUR BAG stats subscribe failed', err);
      },
    );
  }

  private startLeaderboardRealtimeSubscription(): void {
    if (this.leaderboardUnsubscribe) {
      return;
    }
    this.leaderboardUnsubscribe = subscribeTopLeaderboard(
      LEADERBOARD_DISPLAY_LIMIT,
      (entries) => {
        this.lastLeaderboardTop = entries;
        if (this.leaderboardOverlay.visible) {
          this.renderLeaderboardShell(entries, false);
        }
      },
      () => {
        void fetchTopLeaderboard(LEADERBOARD_DISPLAY_LIMIT)
          .then((top) => {
            this.lastLeaderboardTop = top;
            if (this.leaderboardOverlay.visible) {
              this.renderLeaderboardShell(top, false);
            }
          })
          .catch(() => {});
      },
    );
  }

  private async openLeaderboardOverlay(): Promise<void> {
    this.startLeaderboardRealtimeSubscription();
    this.leaderboardOverlay.visible = true;
    this.renderLeaderboardShell(this.lastLeaderboardTop, this.lastLeaderboardTop.length === 0);
    void fetchTopLeaderboard(LEADERBOARD_DISPLAY_LIMIT)
      .then((top) => {
        this.lastLeaderboardTop = top;
        if (this.leaderboardOverlay.visible) {
          this.renderLeaderboardShell(this.lastLeaderboardTop, false);
        }
      })
      .catch((err) => {
        console.error('[PlayScene] fetchTopLeaderboard failed', err);
        if (this.leaderboardOverlay.visible) {
          this.renderLeaderboardShell(this.lastLeaderboardTop, false);
        }
      });
  }

  /**
   * Death-line art height when scaled to strip width `stripW` — entire texture visible, uniform scale.
   */
  private deathHazardStripHeightForWidth(stripW: number, tex?: Texture): number {
    const t = tex ?? this.deathHazardTextureStrip;
    if (!t) {
      return DEATH_HAZARD_BAND_PX;
    }
    const tw = Math.max(1, t.width);
    const th = Math.max(1, t.height);
    return Math.max(1, (stripW / tw) * th);
  }

  private drawBottomDeathLine(): void {
    const layout = this.getDeathLavaArtLayout();
    const vw = this.worldWidthFromScreen();
    const padX = 30;
    const x = this.cameraX - padX;
    const w = vw + padX * 2;
    const bob = this.getLava2DrawBobOffsetY();
    const nudge = LINE_POWER_NUDGE_DOWN_PX;

    const teethSprite = this.deathHazardTeethSprite;
    const poolSprite = this.deathHazardPoolSprite;
    const split = layout ? this.getLava2SplitTextures(layout) : null;

    if (teethSprite && poolSprite && layout && split) {
      const { teethH, poolH } = this.getLava2SplitDisplayHeights(layout);
      const bottom = layout.bottomWorldY + bob + nudge;
      const lineY = this.getLava2DisqualifyLineWorldY();

      this.deathZoneFallback.visible = false;
      teethSprite.visible = false;
      poolSprite.visible = true;
      this.linePowerBaseY = layout.bottomWorldY;

      poolSprite.texture = split.pool;
      poolSprite.position.set(x, bottom);
      poolSprite.width = w;
      poolSprite.height = poolH + teethH;
      return;
    }

    if (teethSprite) {
      teethSprite.visible = false;
    }
    if (poolSprite) {
      poolSprite.visible = false;
    }

    const deathY = this.getLava2DisqualifyLineWorldY();
    this.deathZoneFallback.visible = true;
    const lavaTop = deathY - DEATH_HAZARD_BAND_PX;
    const orangeTop = deathY - DEATH_ORANGE_BAR_HEIGHT_PX;
    const lavaBandH = Math.max(1, DEATH_HAZARD_BAND_PX - DEATH_ORANGE_BAR_HEIGHT_PX);
    const stripH = DEATH_ORANGE_BAR_HEIGHT_PX;
    this.deathZoneFallback.clear();
    this.deathZoneFallback.rect(x, lavaTop, w, lavaBandH).fill({ color: 0xff4b00, alpha: 0.78 });
    this.deathZoneFallback.rect(x, orangeTop, w, stripH).fill({ color: 0xffa621, alpha: 0.95 });
  }

  /** Fascia wall PNGs disabled — invisible slabs; physics unchanged in {@link getViewportEdgeWallSlabsWorld}. */
  private async loadViewportFasciaBoneTextures(): Promise<void> {
    this.viewportFasciaBoneTexLeft = undefined;
    this.viewportFasciaBoneTexRight = undefined;
    this.viewportFasciaChainTexLeft = undefined;
    this.viewportFasciaChainTexRight = undefined;
  }

  /** `lava 2.png` removed — vector strip at viewport bottom only. */
  private async loadDeathZoneStrip(): Promise<void> {
    this.deathHazardTextureStrip = undefined;
    this.deathHazardTextureFull = undefined;
    this.deathHazardTeethTextureStrip = undefined;
    this.deathHazardPoolTextureStrip = undefined;
    this.deathHazardTeethTextureFull = undefined;
    this.deathHazardPoolTextureFull = undefined;
    for (const sprite of [this.deathHazardTeethSprite, this.deathHazardPoolSprite]) {
      if (!sprite) {
        continue;
      }
      sprite.parent?.removeChild(sprite);
      sprite.destroy({ texture: false });
    }
    this.deathHazardTeethSprite = null;
    this.deathHazardPoolSprite = null;
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
    this.refreshStatusPanelContent();
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
    const bottomCull = this.getCullBelowWorldY();
    this.windParticles = this.windParticles
      .map((p) => ({
        ...p,
        age: p.age + dt,
        x: p.x + p.vx * dt,
        y: p.y + p.vy * dt,
      }))
      .filter((p) => p.age < p.life && p.x > leftCull && p.y <= bottomCull);
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

  private ensureWallSparkHeavyTexture(): Texture {
    if (!this.wallSparkHeavySparkTex) {
      this.wallSparkHeavySparkTex = createWallSparkSharpDotTexture();
    }
    return this.wallSparkHeavySparkTex;
  }

  private acquireWallSparkSprite(): Sprite | null {
    const tex = this.ensureWallSparkHeavyTexture();
    if (this.wallSparkSpritePool.length > 0) {
      const s = this.wallSparkSpritePool.pop()!;
      s.visible = true;
      return s;
    }
    if (this.wallSparkParticleRoot.children.length >= WALL_SPARK_MAX_PARTICLES) {
      return null;
    }
    const s = new Sprite(tex);
    s.anchor.set(0.5);
    this.wallSparkParticleRoot.addChild(s);
    s.visible = true;
    return s;
  }

  private recycleWallSparkSprite(s: Sprite): void {
    s.visible = false;
    this.wallSparkSpritePool.push(s);
  }

  private recycleAllWallSparkFxSprites(): void {
    for (const p of this.wallSparkParticles) {
      this.recycleWallSparkSprite(p.sprite);
    }
    this.wallSparkParticles = [];
  }

  /**
   * Same frame as fascia latch (`Physics` sets `isSliding`): queues ignite debt flushed immediately inside
   * {@link updateWallSparkParticles}, mirroring `{@link Emitter.start}`.
   */
  private sparkEmitterAnalogueWallSlideStart(): void {
    if (!this.isSlidePhase) {
      return;
    }
    this.wallSparkSlideLatchIgniteDebt += WALL_SPARK_LATCH_TOUCH_DEBT;
  }

  /** Hard stop slide spark stream — analogue `{@link Emitter.stop}` when overlap ends or cutoff fires. */
  private sparkEmitterAnalogueWallSlideStop(): void {
    this.recycleAllWallSparkFxSprites();
    this.wallSparkSlideSpawnAccumulator = 0;
    this.wallSparkSlideLatchIgniteDebt = 0;
  }

  /**
   * Narrow cone slightly away from fascia, then gravity pulls sparks down (+Y).
   */
  private wallSparkBurstVelocity(wall: 'left' | 'right', speed: number): { vx: number; vy: number } {
    const rad = Math.PI / 180;
    if (wall === 'left') {
      const angleDeg = -28 + Math.random() * 56;
      const a = angleDeg * rad;
      return { vx: Math.cos(a) * speed, vy: Math.sin(a) * speed };
    }
    const angleDeg = 152 + Math.random() * 56;
    const a = angleDeg * rad;
    return { vx: Math.cos(a) * speed, vy: Math.sin(a) * speed };
  }

  /** True while fascia wall friction stream should render + loop SFX (mid-air fascia brush / elevator). */
  private shouldEmitWallSlideFasciaFrictionStream(
    fasciaAssistSpec:
      | {
          slabW: number;
          leftSlabLeftX: number;
          rightSlabLeftX: number;
          horizontalAxis: number;
        }
      | undefined,
  ): boolean {
    if (!this.isSlidePhase) {
      return false;
    }
    const body = this.player.body;
    const spec = fasciaAssistSpec;
    if (!spec || body.grounded) {
      return false;
    }
    const fascialOverlap = Physics.viewportFasciaHasSlabOverlap(body, spec);
    const fasciaAssistFriction = Physics.viewportFasciaAssistWantsAssist(body, spec);
    const elevatorSparksPhys = this.physics.isViewportWallElevatorSparkActive(body, spec);
    return fascialOverlap && (elevatorSparksPhys || fasciaAssistFriction);
  }

  private updateWallSparkParticles(
    dt: number,
    fasciaAssistSpec:
      | {
          slabW: number;
          leftSlabLeftX: number;
          rightSlabLeftX: number;
          horizontalAxis: number;
        }
      | undefined,
  ): void {
    if (!this.isSlidePhase) {
      this.sparkEmitterAnalogueWallSlideStop();
      this.wallSlideSmokeParticles = [];
      this.wallSparkSlideElevatorPhysActiveMemo = false;
      return;
    }
    const body = this.player.body;
    const spec = fasciaAssistSpec;
    const emitElevatorSparkStream = this.shouldEmitWallSlideFasciaFrictionStream(spec);

    // Analogue ParticleEmitter.stop() — instant cutoff on detach, 750 ms expiry, fascia clear, hard break…
    if (!emitElevatorSparkStream && this.wallSparkSlideElevatorPhysActiveMemo) {
      this.sparkEmitterAnalogueWallSlideStop();
    }

    if (emitElevatorSparkStream && spec) {
      // Emitter anchor / spawn seam follows physics player body (`body.x`,`body.y`), not Pixi `{@link Player}.x`.

      const side = Physics.viewportFasciaBodyOverlapSide(body, spec);
      const innerLeftX = spec.leftSlabLeftX + spec.slabW;
      const innerRightX = spec.rightSlabLeftX;

      if (this.wallSparkSlideLatchIgniteDebt > 0) {
        this.wallSparkSlideSpawnAccumulator += this.wallSparkSlideLatchIgniteDebt;
        this.wallSparkSlideLatchIgniteDebt = 0;
      }
      this.wallSparkSlideSpawnAccumulator += WALL_SPARK_SPAWN_PER_SEC * dt;

      while (
        this.wallSparkSlideSpawnAccumulator >= 1 &&
        this.wallSparkParticles.length < WALL_SPARK_MAX_PARTICLES
      ) {
        this.wallSparkSlideSpawnAccumulator -= 1;

        const wall: 'left' | 'right' | null =
          side === 'both'
            ? Math.random() < 0.5
              ? 'left'
              : 'right'
            : side === 'left'
              ? 'left'
              : side === 'right'
                ? 'right'
                : null;
        if (!wall) {
          break;
        }
        const sprite = this.acquireWallSparkSprite();
        if (!sprite) {
          break;
        }
        const speed = 200 + Math.random() * 200;
        const ty =
          body.y + body.height * (0.28 + Math.random() * (0.72 - 0.28));
        const life = 0.1 + Math.random() * 0.15;
        const tint =
          WALL_SPARK_TINT_PALETTE[
            (Math.random() * WALL_SPARK_TINT_PALETTE.length) | 0
          ];
        sprite.tint = tint;
        sprite.alpha = 1;
        sprite.scale.set(WALL_SPARK_SCALE_START);
        const burst = this.wallSparkBurstVelocity(wall, speed);
        let px: number;
        if (wall === 'left') {
          px = (body.x + innerLeftX) * 0.5 + (Math.random() - 0.5) * 1.8;
        } else {
          px =
            (body.x + body.width + innerRightX) * 0.5 +
            (Math.random() - 0.5) * 1.8;
        }
        const py = ty + (Math.random() - 0.5) * 8;
        this.wallSparkParticles.push({
          x: px,
          y: py,
          vx: burst.vx,
          vy: burst.vy,
          age: 0,
          life,
          tint,
          sprite,
        });
      }

      let smokeBudget = Math.ceil(WALL_SLIDE_SMOKE_SPAWN_PER_SEC * dt);
      smokeBudget = Math.max(0, smokeBudget);
      while (
        smokeBudget > 0 &&
        this.wallSlideSmokeParticles.length < WALL_SLIDE_SMOKE_MAX_PARTICLES
      ) {
        const wall: 'left' | 'right' | null =
          side === 'both'
            ? Math.random() < 0.5
              ? 'left'
              : 'right'
            : side === 'left'
              ? 'left'
              : side === 'right'
                ? 'right'
                : null;
        if (!wall) {
          break;
        }
        const ty =
          body.y + body.height * (0.24 + Math.random() * (0.76 - 0.24));
        let px: number;
        let vx: number;
        const outward = 22 + Math.random() * 48;
        const vy = -(42 + Math.random() * 72);
        const grayRoll = Math.random();
        const color =
          grayRoll < 0.42
            ? 0x7a7268
            : grayRoll < 0.78
              ? 0x8f4e28
              : 0x5a3820;
        if (wall === 'left') {
          px = (body.x + innerLeftX) * 0.5 + (Math.random() - 0.5) * 6;
          vx = outward + (Math.random() - 0.5) * 18;
        } else {
          px =
            (body.x + body.width + innerRightX) * 0.5 +
            (Math.random() - 0.5) * 6;
          vx = -outward + (Math.random() - 0.5) * 18;
        }
        const py = ty + (Math.random() - 0.5) * 18;
        this.wallSlideSmokeParticles.push({
          x: px,
          y: py,
          vx,
          vy,
          age: 0,
          life: 0.72 + Math.random() * 0.55,
          radius: 10 + Math.random() * 16,
          color,
        });
        smokeBudget -= 1;
      }
    }

    this.wallSparkSlideElevatorPhysActiveMemo = emitElevatorSparkStream;

    const grav = WALL_SPARK_GRAVITY_Y;
    const sparkDrag = Math.pow(0.992, dt * 60);
    this.wallSparkParticles = this.wallSparkParticles.filter((p) => {
      p.age += dt;
      if (p.age >= p.life) {
        this.recycleWallSparkSprite(p.sprite);
        return false;
      }
      p.vy += grav * dt;
      p.vx *= sparkDrag;
      p.vy *= sparkDrag;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      return true;
    });

    const smokeGrav = 155;
    const smokeDrag = Math.pow(0.987, dt * 60);
    this.wallSlideSmokeParticles = this.wallSlideSmokeParticles.filter((p) => {
      p.age += dt;
      if (p.age >= p.life) {
        return false;
      }
      p.vy += smokeGrav * dt;
      p.vx *= smokeDrag;
      p.vy *= smokeDrag;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      return true;
    });
  }

  private drawWallSlideSmokeParticles(): void {
    if (!this.isSlidePhase) {
      return;
    }
    const gfx = this.wallSparkSmokeGfx;
    for (const p of this.wallSlideSmokeParticles) {
      const u = Math.min(1, p.age / p.life);
      const alphaStart = 0.3;
      const alpha = alphaStart * (1 - u);
      if (alpha < 0.012) {
        continue;
      }
      const spread = 1 + u * 2.35;
      const r = Math.max(2.8, p.radius * spread);
      gfx.circle(p.x, p.y, r).fill({ color: p.color, alpha });
      gfx.circle(p.x + r * 0.22, p.y - r * 0.18, r * 0.55).fill({
        color: 0x4a433c,
        alpha: alpha * 0.45,
      });
    }
  }

  private drawWallSparkParticles(): void {
    if (!this.isSlidePhase) {
      return;
    }
    for (const p of this.wallSparkParticles) {
      const u = Math.min(1, p.age / p.life);
      const scaleMul =
        WALL_SPARK_SCALE_START + (WALL_SPARK_SCALE_END - WALL_SPARK_SCALE_START) * u;
      const s = p.sprite;
      s.position.set(p.x, p.y);
      const sc = Math.max(0.001, scaleMul);
      s.scale.set(sc);
      s.tint = p.tint;
      s.alpha = 1;
      s.visible = scaleMul > 0.015;
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

  /** HUD: remaining fall shields (never exceeds {@link MAX_FALL_SHIELDS}). */
  private getShieldHudStock(): number {
    return Math.min(MAX_FALL_SHIELDS, Math.max(0, this.fallShields));
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
    /** Former rolls included {@link COLLECTIBLES.shieldSpawnChance}; shields no longer spawn — rescale diamond threshold. */
    const diamondThreshold =
      COLLECTIBLES.diamondSpawnChance / (1 - COLLECTIBLES.shieldSpawnChance);
    if (roll < diamondThreshold) {
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
    if (c.kind === 'coin') {
      this.goldCount += 1;
      this.runGoldCollected += 1;
      this.sfx.play('collect_coin', 0.9);
    } else if (c.kind === 'diamond') {
      this.diamondCount += 1;
      this.runDiamondCollected += 1;
      this.sfx.play('collect_diamond', 0.92);
      this.spawnDiamondCollectShine(pos.x, pos.y);
    }
    this.hudGoldShown = this.goldCount;
    this.hudDiamondShown = this.diamondCount;
    this.collectibleHudBump = 1;
    this.refreshStatusPanelContent();
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

        const outerRhomb = [
          cx,
          cy - s - go * 0.65,
          cx + (s + go) * 0.92,
          cy,
          cx,
          cy + s + go * 0.65,
          cx - (s + go) * 0.92,
          cy,
        ];
        const midRhomb = [
          cx,
          cy - s - gm * 0.45,
          cx + (s + gm) * 0.92,
          cy,
          cx,
          cy + s + gm * 0.45,
          cx - (s + gm) * 0.92,
          cy,
        ];
        const coreRhomb = [cx, cy - s, cx + s * 0.92, cy, cx, cy + s, cx - s * 0.92, cy];

        this.collectiblesGfx.poly(outerRhomb).fill({ color: 0x44eeff, alpha: alpha * 0.12 });
        this.collectiblesGfx.poly(midRhomb).fill({ color: 0x7af0ff, alpha: alpha * 0.28 });
        this.collectiblesGfx.poly(coreRhomb).fill({ color: 0x7af0ff, alpha });
        this.collectiblesGfx.poly(coreRhomb).stroke({ width: 2.2, color: 0x208899, alpha: alpha * 0.95 });

        const hx = pulse01;
        const facet = [
          cx - s * 0.15,
          cy - s * 0.72,
          cx + s * 0.35 * hx,
          cy - s * 0.35,
          cx + s * 0.12,
          cy - s * 0.05,
          cx - s * 0.22,
          cy - s * 0.5,
        ];
        this.collectiblesGfx.poly(facet).fill({ color: 0xe8ffff, alpha: alpha * 0.55 * hx });
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

  private hideViewportFasciaBoneTiles(): void {
    if (this.viewportFasciaBoneTileLeft) {
      this.viewportFasciaBoneTileLeft.visible = false;
    }
    if (this.viewportFasciaBoneTileRight) {
      this.viewportFasciaBoneTileRight.visible = false;
    }
  }

  private syncViewportFasciaBoneStripTile(
    tile: TilingSprite | null,
    tex: Texture,
    x: number,
    yTop: number,
    slabW: number,
    stripH: number,
    tileScaleMul = 1,
  ): TilingSprite {
    let t = tile;
    if (!t) {
      t = new TilingSprite({ texture: tex, width: slabW, height: stripH });
      t.anchor.set(0, 0);
      t.roundPixels = true;
      t.eventMode = 'none';
      this.viewportFasciaBoneLayer.addChild(t);
    } else if (t.texture !== tex) {
      t.texture = tex;
    }
    t.visible = true;
    const wPx = Math.max(12, slabW);
    const hPx = Math.max(1, Math.ceil(stripH));
    t.position.set(Math.floor(x), Math.floor(yTop));
    t.width = wPx;
    t.height = hPx;
    const tw = Math.max(1e-6, tex.source.width);
    const th = Math.max(1e-6, tex.source.height);
    const s = (wPx / tw) * tileScaleMul;
    t.tileScale.set(s, s);
    const period = th * s;
    const stripePhaseYTop =
      !this.isSlidePhase ? this.fasciaRestWallStripePhaseAnchorWorldYTop : yTop;
    const ty = ((-stripePhaseYTop * s % period) + period) % period;
    t.tilePosition.set(0, -ty);
    return t;
  }

  /**
   * Twin vertical fascia — same X extents as fascia physics + viewport clamp.
   * Bone/chain PNG art disabled; slabs stay invisible (physics unchanged).
   */
  private drawWorldEdgeRestWalls(): void {
    this.hideViewportFasciaBoneTiles();
  }

  /** Vector fascia (when bone/chain PNGs are unavailable). */
  private drawViewportFasciaWallsProcedural(
    fascia: { slabW: number; leftSlabLeftX: number; rightSlabLeftX: number },
    yTop: number,
    stripH: number,
  ): void {
    const w = fascia.slabW;
    const leftX = fascia.leftSlabLeftX;
    const rightX = fascia.rightSlabLeftX;

    /** Match bone tiling: procedural brick phase scrolls only during {@link isSlidePhase}. */
    const stripeAnchorWorldY = !this.isSlidePhase ? this.fasciaRestWallStripePhaseAnchorWorldYTop : yTop;

    const baseFill = 0x1a1630;
    const trim = 0xb8f7ff;
    const rim = 0xc8ffff;
    const brickA = 0x302a58;
    const brickB = 0x262044;
    const groove = 0x80f7ff;

    const rimH = Math.max(6, Math.round(REST_FLOOR_TILE_PX * 0.125));

    const drawFilledStripe = (x: number): void => {
      this.platformLayer.rect(x, yTop, w, stripH).fill({ color: baseFill, alpha: 1 }).stroke({
        color: trim,
        width: Math.min(2.5, w * 0.1),
        alpha: 0.94,
      });
    };

    const bandH = Math.max(8, REST_FLOOR_TILE_PX * 0.32);
    const bandStripe = (x: number): void => {
      for (let y = yTop; y < yTop + stripH - 1; y += bandH) {
        const h = Math.min(bandH, yTop + stripH - y);
        const patternRow = Math.floor((y - stripeAnchorWorldY) / bandH);
        const parity = ((patternRow % 2) + 2) % 2;
        const c = parity === 0 ? brickA : brickB;
        this.platformLayer.rect(x, y, w, h).fill({ color: c, alpha: 1 });
      }
    };

    const verticalGrooves = (x: number): void => {
      const lineW = 2;
      const step = REST_FLOOR_TILE_PX >> 3;
      for (let gx = x + Math.max(step * 0.35, lineW); gx < x + w - lineW * 1.75; gx += step) {
        this.platformLayer.rect(Math.round(gx), yTop, lineW, stripH).fill({ color: groove, alpha: 0.2 });
      }
    };

    const topRim = (x: number): void => {
      this.platformLayer.rect(x, yTop - rimH, w, rimH).fill({ color: rim, alpha: 1 });
    };

    drawFilledStripe(leftX);
    bandStripe(leftX);
    verticalGrooves(leftX);
    topRim(leftX);

    drawFilledStripe(rightX);
    bandStripe(rightX);
    verticalGrooves(rightX);
    topRim(rightX);
  }

  private drawCrystalPlatform(platform: Platform): void {
    if (platform.kind === 'rest' || platform.kind === 'spawn') {
      this.drawRestFloorPlatform(platform);
    }
  }

  private drawRestFloorPlatform(platform: Platform): void {
    if (this.restPlatformMarshmallowSlices || this.restPlatformChocolateSlices) {
      return;
    }
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

  private isPlatformSquashBouncePlatform(platform: Platform): boolean {
    if (platform.kind === 'rest' || platform.kind === 'spawn') {
      return false;
    }
    const m = this.getPlatformMeters(platform);
    const L = PLATFORM_LEVEL_ART;
    if (m >= L.marshmallow.minMeters && m < L.marshmallow.maxMeters) {
      return this.marshmallowTextures.length > 0;
    }
    if (m >= L.chocolate.minMeters && m < L.chocolate.maxMeters) {
      return this.chocolateTextures.length > 0;
    }
    return false;
  }

  private getPlatformSquashJuiceLayer(root: Container): PlatformJuiceLayer | undefined {
    const juice = root.children.find((c) => c.label === PLATFORM_SQUASH_JUICE_LABEL);
    return juice as PlatformJuiceLayer | undefined;
  }

  /** Landing on squash platforms [0, 4000) m — one squash per impact (`isBouncing` latch). */
  private readonly onPlatformSquashLandCollider = (
    previousBottom: number,
    wasGrounded: boolean,
    landedPlatform: Platform | undefined,
  ): void => {
    if (!landedPlatform || wasGrounded || !this.isPlatformSquashBouncePlatform(landedPlatform)) {
      return;
    }

    const platformIndex = this.platforms.indexOf(landedPlatform);
    if (platformIndex < 0) {
      return;
    }

    const root = this.platformSprites[platformIndex];
    const juice = root ? this.getPlatformSquashJuiceLayer(root) : undefined;
    const platformSprite = juice?.children.find((c): c is Sprite => c instanceof Sprite);
    if (!juice || !platformSprite) {
      return;
    }

    if (getPlatformSpriteData(platformSprite, PLATFORM_SPRITE_DATA_IS_BOUNCING) === true) {
      return;
    }

    const body = this.player.body;
    const platform = landedPlatform;
    const feetY = body.y + body.height;
    const overlapX =
      body.x + body.width * 0.42 > platform.x && body.x < platform.x + platform.width;

    const playerTouchingDown =
      body.grounded && body.vy >= 0 && overlapX && Math.abs(feetY - platform.y) <= 8;

    const platformTouchingUp =
      overlapX &&
      previousBottom <= platform.y + STAIRS.stepPx &&
      feetY >= platform.y - 4;

    if (!playerTouchingDown || !platformTouchingUp) {
      return;
    }

    setPlatformSpriteData(platformSprite, PLATFORM_SPRITE_DATA_IS_BOUNCING, true);
    juice.isBouncing = true;
    juice.bounceElapsedSec = 0;
    juice.scale.set(1);
  };

  /** Squash/stretch on juice only — platform AABB stays fixed. */
  private tickPlatformSquashJuice(dt: number): void {
    const seg = PLATFORM_SQUASH_DURATION_MS / 1000;
    const total = seg * 2;

    for (const root of this.platformSprites) {
      const juice = this.getPlatformSquashJuiceLayer(root);
      if (!juice?.isBouncing || juice.bounceElapsedSec === undefined) {
        continue;
      }

      const platformSprite = juice.children.find((c): c is Sprite => c instanceof Sprite);
      juice.bounceElapsedSec += dt;
      const elapsed = juice.bounceElapsedSec;

      if (elapsed >= total) {
        juice.scale.set(1);
        juice.isBouncing = false;
        juice.bounceElapsedSec = undefined;
        if (platformSprite) {
          setPlatformSpriteData(platformSprite, PLATFORM_SPRITE_DATA_IS_BOUNCING, false);
        }
        continue;
      }

      let sx = 1;
      let sy = 1;
      if (elapsed < seg) {
        const t = elapsed / seg;
        sx = 1 + (PLATFORM_SQUASH_SCALE_X - 1) * t;
        sy = 1 + (PLATFORM_SQUASH_SCALE_Y - 1) * t;
      } else {
        const t = (elapsed - seg) / seg;
        const ease = 1 - (1 - t) ** 2;
        sx = PLATFORM_SQUASH_SCALE_X + (1 - PLATFORM_SQUASH_SCALE_X) * ease;
        sy = PLATFORM_SQUASH_SCALE_Y + (1 - PLATFORM_SQUASH_SCALE_Y) * ease;
      }
      juice.scale.set(sx, sy);
    }
  }

  private async loadPlatformSpriteCore(): Promise<void> {
    await this.loadPlatformLevelTextures();
    this.platformTexture = this.marshmallowTextures[0];
  }

  private async loadMarshmallowTextures(): Promise<void> {
    try {
      const canvas = await loadKeyedSheetCanvas(MARSHMELO_SHEET_URL, {
        darkMaxChannel: PLATFORM_FOOD_SHEET_DARK_BG_MAX_CHANNEL,
      });
      if (!canvas) {
        throw new Error('Failed to decode marshmallow sheet');
      }
      const marshmallowRows = extractPlatformFoodSheetFrameRows(canvas, MARSHMELO_ROW_BANDS, {
        cellPadPx: 4,
        boundsPadPx: 2,
      });
      const chocolateRows = extractPlatformFoodSheetFrameRows(canvas, CHOCOLATE_ROW_BANDS, {
        cellPadPx: 6,
        boundsPadPx: 4,
      });
      this.marshmallowTextures = marshmallowRows.flatMap((row) => row.textures);
      this.chocolateTextures = chocolateRows.flatMap((row) => row.textures);
      this.marshmallowFeetAnchorY = PLATFORM_LEVEL_DECK_ANCHOR_Y.marshmallow;
      this.chocolateFeetAnchorY = PLATFORM_LEVEL_DECK_ANCHOR_Y.chocolate;
    } catch {
      this.marshmallowTextures = [];
      this.chocolateTextures = [];
      console.warn('Failed to load platform art:', MARSHMELO_SHEET_URL);
    }
  }

  private getMarshmallowFrameIndex(platform: Platform): number {
    const count = this.marshmallowTextures.length;
    if (count === 0) {
      return 0;
    }
    return Math.max(0, platform.stairId) % count;
  }

  private getChocolateFrameIndex(platform: Platform): number {
    const count = this.chocolateTextures.length;
    if (count === 0) {
      return 0;
    }
    return Math.max(0, platform.stairId) % count;
  }

  private isMarshmallowTexture(tex: Texture): boolean {
    return this.marshmallowTextures.includes(tex);
  }

  private isChocolateTexture(tex: Texture): boolean {
    return this.chocolateTextures.includes(tex);
  }

  private platformArtTierForTexture(tex: Texture): 'marshmallow' | 'chocolate' | 'none' {
    if (this.isChocolateTexture(tex)) {
      return 'chocolate';
    }
    if (this.isMarshmallowTexture(tex)) {
      return 'marshmallow';
    }
    return 'none';
  }

  private async loadPlatformLevelTextures(): Promise<void> {
    await Promise.all([this.loadMarshmallowTextures(), this.loadRestPlatformSheetTextures()]);
  }

  /** Split `rest platform.png` into marshmallow (top) and chocolate (bottom) wide-deck strips. */
  private async loadRestPlatformSheetTextures(): Promise<void> {
    try {
      const sheet = await this.loadTextureFromCandidates([REST_PLATFORM_SHEET_URL]);
      sheet.source.scaleMode = RENDER.pixelArt ? 'nearest' : 'linear';
      const w = Math.max(1, sheet.width);
      const h = Math.max(1, sheet.height);
      const splitY = Math.min(REST_PLATFORM_SHEET_SPLIT_Y, h - 1);
      this.restPlatformMarshmallowSlices = this.buildRestPlatformStripSlices(
        sheet.source,
        new Rectangle(0, 0, w, splitY),
      );
      this.restPlatformChocolateSlices = this.buildRestPlatformStripSlices(
        sheet.source,
        new Rectangle(0, splitY, w, h - splitY),
      );
    } catch {
      this.restPlatformMarshmallowSlices = undefined;
      this.restPlatformChocolateSlices = undefined;
      console.warn('Failed to load rest platform art:', REST_PLATFORM_SHEET_URL);
    }
  }

  private buildRestPlatformStripSlices(
    source: Texture['source'],
    frame: Rectangle,
  ): RestPlatformStripSlices {
    const cap = Math.min(
      REST_PLATFORM_END_CAP_TEX_PX,
      Math.max(32, Math.floor(frame.width * 0.18)),
    );
    const midW = Math.max(1, frame.width - cap * 2);
    const full = new Texture({ source, frame });
    return {
      full,
      leftCap: new Texture({
        source,
        frame: new Rectangle(frame.x, frame.y, cap, frame.height),
      }),
      center: new Texture({
        source,
        frame: new Rectangle(frame.x + cap, frame.y, midW, frame.height),
      }),
      rightCap: new Texture({
        source,
        frame: new Rectangle(frame.x + cap + midW, frame.y, cap, frame.height),
      }),
    };
  }

  /** Marshmallow strip [0, 5000) m; chocolate strip [5000, 10000) m (same bands as stair art). */
  private pickRestPlatformSlices(platformM: number): RestPlatformStripSlices | undefined {
    const L = PLATFORM_LEVEL_ART;
    if (
      platformM >= L.chocolate.minMeters &&
      platformM < L.chocolate.maxMeters &&
      this.restPlatformChocolateSlices
    ) {
      return this.restPlatformChocolateSlices;
    }
    if (platformM >= L.chocolate.maxMeters && this.restPlatformChocolateSlices) {
      return this.restPlatformChocolateSlices;
    }
    return this.restPlatformMarshmallowSlices;
  }

  /**
   * 9-slice rest deck — end caps at uniform scale (no stretch blur); center repeats horizontally.
   */
  private syncRestFloorPlatformSprite(index: number, root: Container, platform: Platform): void {
    const slices = this.pickRestPlatformSlices(this.getPlatformMeters(platform));
    if (!slices) {
      root.visible = false;
      return;
    }

    root.visible = true;
    root.position.set(platform.x, platform.y);
    this.platformSpriteModes[index] = 'rest-tile';

    const visualH = Math.max(platform.height * 1.18, platform.height + 12);
    const scale = visualH / Math.max(1, slices.full.height);
    const capW = slices.leftCap.width * scale;
    const centerW = Math.max(0, platform.width - capW * 2);

    let left = root.children.find(
      (c): c is Sprite => c instanceof Sprite && c.label === 'rest-floor-left',
    );
    let center = root.children.find(
      (c): c is TilingSprite => c instanceof TilingSprite && c.label === 'rest-floor-center',
    );
    let right = root.children.find(
      (c): c is Sprite => c instanceof Sprite && c.label === 'rest-floor-right',
    );

    const rebuild =
      !left ||
      !center ||
      !right ||
      left.texture !== slices.leftCap ||
      center.texture !== slices.center ||
      right.texture !== slices.rightCap;

    if (rebuild) {
      root.removeChildren().forEach((c) => c.destroy());
      left = new Sprite(slices.leftCap);
      left.label = 'rest-floor-left';
      left.anchor.set(0, 0);
      left.eventMode = 'none';

      center = new TilingSprite({ texture: slices.center, width: centerW, height: visualH });
      center.label = 'rest-floor-center';
      center.eventMode = 'none';

      right = new Sprite(slices.rightCap);
      right.label = 'rest-floor-right';
      right.anchor.set(0, 0);
      right.eventMode = 'none';

      root.addChild(left, center, right);
    }

    left!.width = capW;
    left!.height = visualH;
    left!.position.set(0, 0);

    center!.width = centerW;
    center!.height = visualH;
    center!.tileScale.set(scale);
    center!.position.set(capW, 0);

    right!.width = capW;
    right!.height = visualH;
    right!.position.set(platform.width - capW, 0);
  }

  /** Rest-floor props — safe to defer on mobile until after first paint. */
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
      if (REST_FLOOR_SUPPLIES_ENABLED) {
        this.restFloorSuppliesTexture = (await Assets.load<Texture>(REST_FLOOR_SUPPLIES_URL)) as Texture;
        this.createRestFloorSupplyTextures();
      } else {
        this.destroyRestFloorSupplySprites();
      }
    } catch {
      this.restFloorSuppliesTexture = undefined;
      this.restFloorSupplyTextures = [];
      console.warn('Failed to load rest floor supplies asset:', REST_FLOOR_SUPPLIES_URL);
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
    if (!REST_FLOOR_SUPPLIES_ENABLED) {
      return;
    }
    if (this.getRestFloorMeters(platform) !== REST_FLOOR_HOUSE_METERS) {
      return;
    }
    this.spawnRestFloorSupplies();
  }

  private spawnRestFloorSupplies(): void {
    if (!REST_FLOOR_SUPPLIES_ENABLED) {
      this.destroyRestFloorSupplySprites();
      return;
    }
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
    if (!REST_FLOOR_SUPPLIES_ENABLED || this.restFloorSupplySprites.length === 0) {
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

  /** Remove supply rack sprites only (house/clouds unaffected). */
  private destroyRestFloorSupplySprites(): void {
    for (const sprite of this.restFloorSupplySprites) {
      sprite.parent?.removeChild(sprite);
      sprite.destroy();
    }
    this.restFloorSupplySprites = [];
    this.restFloorSupplyTextures = [];
    this.restFloorSuppliesTexture = undefined;
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
    const hasStairArt =
      this.marshmallowTextures.length > 0 || this.chocolateTextures.length > 0;
    const hasRestArt = !!(this.restPlatformMarshmallowSlices || this.restPlatformChocolateSlices);
    if (!hasStairArt && !hasRestArt) {
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
    const useSquashJuice = this.isPlatformLevelPngTexture(tex);
    let juice = useSquashJuice ? this.getPlatformSquashJuiceLayer(root) : undefined;
    let sprite =
      juice?.children.find((c): c is Sprite => c instanceof Sprite) ??
      root.children.find((c): c is Sprite => c instanceof Sprite);

    const needsRebuild =
      this.platformSpriteModes[index] !== 'legacy' ||
      !sprite ||
      (useSquashJuice && !juice) ||
      (sprite &&
        this.platformArtTierForTexture(tex) !== this.platformArtTierForTexture(sprite.texture));

    if (needsRebuild) {
      root.removeChildren().forEach((child) => child.destroy());
      if (useSquashJuice) {
        juice = new Container() as PlatformJuiceLayer;
        juice.label = PLATFORM_SQUASH_JUICE_LABEL;
        juice.isBouncing = false;
        juice.scale.set(1);
        sprite = new Sprite(tex);
        setPlatformSpriteData(sprite, PLATFORM_SPRITE_DATA_IS_BOUNCING, false);
        juice.addChild(sprite);
        root.addChild(juice);
      } else {
        sprite = new Sprite(tex);
        sprite.anchor.set(0.5);
        root.addChild(sprite);
        juice = undefined;
      }
      this.platformSpriteModes[index] = 'legacy';
      this.platformSpriteCols[index] = -1;
    } else if (sprite && sprite.texture !== tex) {
      sprite.texture = tex;
    }

    if (!sprite) {
      return;
    }

    root.position.set(platform.x, platform.y);
    root.alpha = 0.98;
    root.mask = null;

    sprite.roundPixels = RENDER.pixelArt;
    const isLevelPng = this.isPlatformLevelPngTexture(tex);
    const spriteWorldW = this.getPlatformSpriteWorldWidth(platform);
    sprite.width = spriteWorldW * artMul;
    sprite.scale.y = Math.abs(sprite.scale.x);
    if (isLevelPng) {
      sprite.anchor.set(0.5, this.getPlatformDeckAnchorY(tex));
      sprite.position.set(platform.width * 0.5, 0);
    } else {
      sprite.anchor.set(0.5);
      sprite.position.set(platform.width * 0.5, platform.height * 0.5 + 6);
    }

    if (juice?.isBouncing || juice?.bounceElapsedSec !== undefined) {
      return;
    }

    for (const c of [...root.children]) {
      if (c instanceof Graphics && c.label === 'slime-platform-mask') {
        root.removeChild(c);
        c.destroy();
      }
    }
  }

  /**
   * `platforms marshmelo.png` — marshmallow [0, 5000) m, chocolate [5000, 10000) m; sequential by `stairId`.
   */
  private pickPlatformLevelTexture(platformM: number, platform: Platform): Texture | undefined {
    const L = PLATFORM_LEVEL_ART;
    if (
      platformM >= L.chocolate.minMeters &&
      platformM < L.chocolate.maxMeters &&
      this.chocolateTextures.length > 0
    ) {
      return this.chocolateTextures[this.getChocolateFrameIndex(platform)];
    }
    if (
      platformM >= L.marshmallow.minMeters &&
      platformM < L.marshmallow.maxMeters &&
      this.marshmallowTextures.length > 0
    ) {
      return this.marshmallowTextures[this.getMarshmallowFrameIndex(platform)];
    }
    if (platformM >= L.chocolate.maxMeters && this.chocolateTextures.length > 0) {
      return this.chocolateTextures[this.getChocolateFrameIndex(platform)];
    }
    return this.marshmallowTextures[0] ?? this.chocolateTextures[0];
  }

  private getPlatformDeckAnchorY(tex: Texture): number {
    if (this.isChocolateTexture(tex)) {
      return this.chocolateFeetAnchorY;
    }
    if (this.isMarshmallowTexture(tex)) {
      return this.marshmallowFeetAnchorY;
    }
    return 1;
  }

  private isPlatformLevelPngTexture(tex: Texture): boolean {
    return this.isMarshmallowTexture(tex) || this.isChocolateTexture(tex);
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

  private updateCameraJuice(dt: number): void {
    const spring = 220;
    const damp = 16;
    const accel = -this.cameraJuiceY * spring - this.cameraJuiceVelY * damp;
    this.cameraJuiceVelY += accel * dt;
    this.cameraJuiceY += this.cameraJuiceVelY * dt;
    if (Math.abs(this.cameraJuiceY) < 0.04 && Math.abs(this.cameraJuiceVelY) < 0.04) {
      this.cameraJuiceY = 0;
      this.cameraJuiceVelY = 0;
    }
  }

  private pulseCameraJuiceJump(): void {
    this.cameraJuiceVelY -= 1.4;
  }

  private pulseCameraJuiceLanding(impactVy: number): void {
    const strength = Math.min(1, impactVy / 520);
    this.cameraJuiceVelY += 2.2 + strength * 2.5;
    this.shakeTime = Math.max(this.shakeTime, 0.07 + strength * 0.05);
  }

  private applyCameraTransform(): void {
    this.gameShake.scale.set(this.getCameraZoom());
    this.gameShake.position.set(this.shakeOffsetX, this.shakeOffsetY + this.cameraJuiceY);
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

