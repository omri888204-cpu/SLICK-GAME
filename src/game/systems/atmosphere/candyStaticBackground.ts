const GAME_ASSETS = `${import.meta.env.BASE_URL}assets`;
const BG_TESET_DIR = `${GAME_ASSETS}/${encodeURIComponent('backgroud teset')}`;

const LAYER_ASSET_REVISION = '20260527-rocks-speck-v4';
/** Letterbox / hole fill behind back 5000 sky (matches asset purple). */
export const BACK_5000_BACKDROP_COLOR = 0x2a1048;

function layerAssetUrl(fileName: string): string {
  return `${BG_TESET_DIR}/${encodeURIComponent(fileName)}?v=${LAYER_ASSET_REVISION}`;
}

/** layer 11 — legacy tiled sky (replaced below 5k m by {@link CANDY_SPACE_2_SKY_URL}). */
export const CANDY_LAYER1_SKY_URL = layerAssetUrl('layer 11.png');
/** back space — far sky below {@link BACKGROUND_TIER_SWITCH_METERS}; vertical film-roll tile while climbing. */
export const CANDY_BACK_SPACE_SKY_URL = layerAssetUrl('back space.png');
/** @deprecated Use {@link CANDY_BACK_SPACE_SKY_URL}. */
export const CANDY_SPACE_2_SKY_URL = CANDY_BACK_SPACE_SKY_URL;
/** Screen-px film unroll per px of upward camera travel — low = very slow reel. */
export const BACK_SPACE_SKY_CAMERA_PARALLAX = 0.08;
/** @deprecated Use {@link BACK_SPACE_SKY_CAMERA_PARALLAX}. */
export const SPACE_2_SKY_CAMERA_PARALLAX = BACK_SPACE_SKY_CAMERA_PARALLAX;
/** back 5000 — far sky from {@link BACKGROUND_TIER_SWITCH_METERS} upward. */
export const CANDY_LAYER1_SKY_HIGH_URL = layerAssetUrl('back 5000.png');
/** space mid — static layer between {@link CANDY_SPACE_2_SKY_URL} and {@link CANDY_LAYER2_MIDDLE_URL}. */
export const CANDY_SPACE_MID_URL = `${BG_TESET_DIR}/${encodeURIComponent('space mid.png')}?v=${LAYER_ASSET_REVISION}`;
/** space 1 — foreground midground below {@link BACKGROUND_TIER_SWITCH_METERS}. */
export const CANDY_LAYER2_MIDDLE_URL = layerAssetUrl('space 1.png');
/** Gentle vertical bob on space 1 (screen px, peak amplitude). */
export const SPACE_1_MIDDLE_BOB_RANGE_PX = 8;
/** Bob phase speed — 1 rad/s (~6.3 s full cycle), matches legacy teset-2 oscillation. */
export const SPACE_1_MIDDLE_BOB_SPEED_RAD_PER_SEC = 1;
/** 5000 factory — midground [5000, {@link BACKGROUND_TIER_2_SWITCH_METERS}) m. */
export const CANDY_LAYER2_MIDDLE_HIGH_URL = layerAssetUrl('5000 factory.png');
/** castle 10000 — midground from {@link BACKGROUND_TIER_2_SWITCH_METERS} upward. */
export const CANDY_LAYER2_MIDDLE_ULTRA_URL = layerAssetUrl('castle 10000.png');
/** HUD climb (m) at which sky switches to 5k assets. */
export const BACKGROUND_TIER_SWITCH_METERS = 5000;
/** HUD climb (m) — second tier switch for midground + front walls (10k assets). */
export const BACKGROUND_TIER_2_SWITCH_METERS = 10000;
/** @deprecated Use {@link BACKGROUND_TIER_2_SWITCH_METERS}. */
export const FRONT_WALL_TIER_2_SWITCH_METERS = BACKGROUND_TIER_2_SWITCH_METERS;
/** 5000 wall — foreground side walls [5000, {@link BACKGROUND_TIER_2_SWITCH_METERS}) m. */
export const CANDY_LAYER3_FRONT_HIGH_URL = layerAssetUrl('5000 wall.png');
/** 10000 walls — foreground side walls from {@link BACKGROUND_TIER_2_SWITCH_METERS} upward. */
export const CANDY_LAYER3_FRONT_ULTRA_URL = layerAssetUrl('10000 walls.png');

export const Z_SKY = -45;
export const Z_FX = -44;
/** Between space 2 (sky) and space 1 (middle). */
export const Z_SPACE_MID = -42;
/** Floating `rocks 1` inside the bottom-right triangle (below 5k m). */
export const Z_SPACE_ROCKS = -41;
export const Z_MIDDLE = -40;
/** `rocks 1.png` — three separated islands extracted for triangle floaters. */
export const CANDY_ROCKS_1_URL = layerAssetUrl('rocks 1.png');
/** Yellow-frame triangle: top vertex on the right edge (ratio of {@link LayerBackgroundLayout.fillH}). */
export const SPACE_ROCKS_TRI_TOP_Y_RATIO = 0.5;
/** Yellow-frame triangle: bottom edge meets the hypotenuse (ratio of viewport width). */
export const SPACE_ROCKS_TRI_LEFT_X_RATIO = 0.34;
export const Z_FRONT = -35;

/** Phaser ref: `tilePositionY -= 0.15` at 60 fps — sky ambient drift. */
export const SKY_TILE_SCROLL_PX_PER_SEC = 0.15 * 60;

/** Foreground walls (5k+) drift upward slowly while the player climbs. */
export const FRONT_WALL_CAMERA_PARALLAX = 0.32;
/** Tiled side walls (`5000 wall`, `10000 walls`) — off for now. */
export const ENABLE_CANDY_FRONT_WALLS = false;

/** Portrait-first — logical aspect height / width. */
export const PORTRAIT_MIN_ASPECT = 1.05;

export type LayerBackgroundLayout = {
  viewportW: number;
  viewportH: number;
  fillH: number;
  centerX: number;
  centerY: number;
};

export function buildLayerBackgroundLayout(
  viewportW: number,
  viewportH: number,
  bottomAnchorY: number,
): LayerBackgroundLayout {
  const fillH = Math.max(1, bottomAnchorY);
  return {
    viewportW,
    viewportH,
    fillH,
    centerX: viewportW * 0.5,
    centerY: fillH * 0.5,
  };
}

/** Width-fit uniform scale — keeps side walls aligned to screen edges without stretch. */
export function widthFitTileScale(viewportW: number, texW: number): number {
  return viewportW / Math.max(1, texW);
}

/** Uniform cover — fills viewport without non-uniform stretch. */
export function coverScaleForTexture(
  viewportW: number,
  fillH: number,
  texW: number,
  texH: number,
): number {
  const byHeight = fillH / Math.max(1, texH);
  const byWidth = viewportW / Math.max(1, texW);
  return Math.max(byHeight, byWidth);
}
