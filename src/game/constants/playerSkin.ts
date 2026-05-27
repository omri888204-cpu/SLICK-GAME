/** Playable runner skin id (distinct from onboarding `selectedCharacterId`). */
export const PLAYER_SKIN = {
  CANDY_BOY: 'CANDY_BOY',
  FIGHTER: 'FIGHTER',
} as const;

/** Legacy Firebase values — normalized to {@link PLAYER_SKIN.CANDY_BOY}. */
export const LEGACY_PLAYER_SKIN_NINJA_SLICK = 'NINJA_SLICK';
const LEGACY_PLAYER_SKIN_DARK_ORACLE = 'DARK_ORACLE';

export type PlayerSkinName = (typeof PLAYER_SKIN)[keyof typeof PLAYER_SKIN];

export const DEFAULT_PLAYER_SKIN: PlayerSkinName = PLAYER_SKIN.CANDY_BOY;

export function normalizeSelectedCharacterSkin(raw: unknown): PlayerSkinName {
  if (raw === PLAYER_SKIN.CANDY_BOY) {
    return PLAYER_SKIN.CANDY_BOY;
  }
  if (raw === PLAYER_SKIN.FIGHTER) {
    return PLAYER_SKIN.FIGHTER;
  }
  if (
    raw === LEGACY_PLAYER_SKIN_NINJA_SLICK ||
    raw === LEGACY_PLAYER_SKIN_DARK_ORACLE
  ) {
    return PLAYER_SKIN.CANDY_BOY;
  }
  return DEFAULT_PLAYER_SKIN;
}

const BASE_URL = import.meta.env.BASE_URL;
export const PLAYABLE_STAFF = `${BASE_URL}assets/${encodeURIComponent('Player staff')}/`;
const FIGHTER_DIR = `${PLAYABLE_STAFF}${encodeURIComponent('Fighter')}/`;

/** Per-clip feet anchor Y (normalized 0 = top, 1 = bottom of frame). */
export type SkinFeetAnchors = {
  idle: number;
  run: number;
  jump: number;
  /** When set, used for jump frames at/after {@link SkinRenderBundle.jumpLoopFrameStart}. */
  jumpLoop?: number;
  slide: number;
  attack: number;
  /** Dedicated landing strip (e.g. candy boy row 4). */
  landing?: number;
};

/** Fighter horizontal strips in `public/assets/Player staff/Fighter/` (128×128 cells). */
export const FIGHTER_FRAME_SIZE = 128;

export const FIGHTER_SHEETS = {
  idle: { file: 'Idle.png', frameCount: 6 },
  /** Ground locomotion uses Run.png (Walk.png is unused). */
  run: { file: 'Run.png', frameCount: 8 },
  jump: { file: 'Jump.png', frameCount: 10 },
  slide: { file: 'Shield.png', frameCount: 2 },
  attack1: { file: 'Attack_1.png', frameCount: 4 },
  attack2: { file: 'Attack_2.png', frameCount: 3 },
  attack3: { file: 'Attack_3.png', frameCount: 4 },
} as const;

/** Fighter art fills the cell bottom — feet sit on the frame baseline. */
export const FIGHTER_FEET_ANCHOR_Y: SkinFeetAnchors = {
  idle: 1,
  run: 1,
  jump: 1,
  slide: 1,
  attack: 1,
};

export function fighterSheetUrl(filename: string): string {
  return `${FIGHTER_DIR}${encodeURIComponent(filename)}`;
}

/** Playable character — `mobi 2 movement.png` (raw column slices, no auto-crop). */
export const CANDY_BOY_SHEET_URL = `${PLAYABLE_STAFF}${encodeURIComponent('mobi 2 movement.png')}`;
export const CANDY_BOY_ROW_BANDS = [
  {
    row: 0,
    y0: 78,
    y1: 256,
    columns: [
      { x0: 112, x1: 198 },
      { x0: 268, x1: 354 },
      { x0: 433, x1: 518 },
      { x0: 598, x1: 682 },
      { x0: 762, x1: 847 },
      { x0: 926, x1: 1012 },
      { x0: 1087, x1: 1172 },
      { x0: 1249, x1: 1335 },
    ],
  },
  {
    row: 1,
    y0: 289,
    y1: 491,
    columns: [
      { x0: 107, x1: 195 },
      { x0: 265, x1: 358 },
      { x0: 419, x1: 517 },
      { x0: 601, x1: 687 },
      { x0: 763, x1: 852 },
      { x0: 932, x1: 1020 },
      { x0: 1083, x1: 1180 },
      { x0: 1245, x1: 1339 },
    ],
  },
  {
    row: 2,
    y0: 531,
    y1: 744,
    columns: [
      { x0: 104, x1: 195 },
      { x0: 288, x1: 380 },
      { x0: 460, x1: 553 },
      { x0: 637, x1: 718 },
      { x0: 811, x1: 900 },
      { x0: 977, x1: 1065 },
      { x0: 1141, x1: 1227 },
    ],
  },
  {
    row: 3,
    y0: 782,
    y1: 969,
    columns: [
      { x0: 91, x1: 197 },
      { x0: 267, x1: 366 },
      { x0: 454, x1: 533 },
      { x0: 613, x1: 692 },
    ],
  },
] as const;
/** Playable avatar scale — sprite width + physics hitbox (0.8 = 20% smaller). */
export const PLAYER_AVATAR_SCALE = 0.8;
/** On-screen width for mobi 2 movement frames. */
export const CANDY_BOY_DISPLAY_WIDTH = 178 * PLAYER_AVATAR_SCALE;
/** Airborne loop — frame index in the 6-frame jump strip. */
export const CANDY_BOY_JUMP_LOOP_FRAME_START = 3;
/** Feet on frame bottom (measured rects include full character height). */
export const CANDY_BOY_FEET_ANCHOR_Y: SkinFeetAnchors = {
  idle: 1,
  run: 1,
  jump: 1,
  jumpLoop: 1,
  slide: 1,
  attack: 1,
  landing: 1,
};

/** Main-menu still — full portrait, no sheet trim (`new mobi 2.png`). */
export const MENU_PLAYER_STILL_URL = `${PLAYABLE_STAFF}${encodeURIComponent('new mobi 2.png')}`;
const MENU_PLAYER_STILL_REVISION = '20260528-menu-still-restore';
export const MENU_PLAYER_STILL_SRC = `${MENU_PLAYER_STILL_URL}?v=${MENU_PLAYER_STILL_REVISION}`;
export const MENU_PLAYER_STILL_FEET_ANCHOR_Y = 0.94;

/** Main-menu mood portraits — cycle order on the home screen. */
export const MENU_MOOD_PORTRAIT_FILES = [
  'mobi joke.png',
  'mobi happy.png',
  'mobi think.png',
  'mobi mad.png',
] as const;
const MENU_MOOD_REVISION = '20260528-moods-v1';
export const MENU_MOOD_CYCLE_SEC = 2;
export const MENU_MOOD_FEET_ANCHOR_Y = MENU_PLAYER_STILL_FEET_ANCHOR_Y;

export function menuMoodPortraitSrc(file: (typeof MENU_MOOD_PORTRAIT_FILES)[number]): string {
  return `${PLAYABLE_STAFF}${encodeURIComponent(file)}?v=${MENU_MOOD_REVISION}`;
}

export const MENU_PLAYER_IDLE_FPS = 1;
export const MENU_PLAYER_JUMP_FPS = 10;
/** Menu avatar scale vs default avatar height. */
export const MENU_PLAYER_SCALE_MULT = 1.89;
