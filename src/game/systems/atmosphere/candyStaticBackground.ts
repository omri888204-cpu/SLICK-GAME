const GAME_ASSETS = `${import.meta.env.BASE_URL}assets`;
const BG_TESET_DIR = `${GAME_ASSETS}/${encodeURIComponent('backgroud teset')}`;

const LAYER_ASSET_REVISION = '20260523-back5000-v4';
/** Letterbox / hole fill behind back 5000 sky (matches asset purple). */
export const BACK_5000_BACKDROP_COLOR = 0x2a1048;

function layerAssetUrl(fileName: string): string {
  return `${BG_TESET_DIR}/${encodeURIComponent(fileName)}?v=${LAYER_ASSET_REVISION}`;
}

/** layer 11 — far sky background below {@link BACKGROUND_TIER_SWITCH_METERS} (slow vertical tile scroll). */
export const CANDY_LAYER1_SKY_URL = layerAssetUrl('layer 11.png');
/** back 5000 — far sky from {@link BACKGROUND_TIER_SWITCH_METERS} upward. */
export const CANDY_LAYER1_SKY_HIGH_URL = layerAssetUrl('back 5000.png');
/** layer2 — candy castle midground below {@link BACKGROUND_TIER_SWITCH_METERS}. */
export const CANDY_LAYER2_MIDDLE_URL = layerAssetUrl('layer2.png');
/** 5000 factory — midground from {@link BACKGROUND_TIER_SWITCH_METERS} upward. */
export const CANDY_LAYER2_MIDDLE_HIGH_URL = layerAssetUrl('5000 factory.png');
/** HUD climb (m) at which sky / midground / front walls switch to 5k assets. */
export const BACKGROUND_TIER_SWITCH_METERS = 5000;
/** @deprecated Use {@link BACKGROUND_TIER_SWITCH_METERS}. */
export const FRONT_WALL_TIER_SWITCH_METERS = BACKGROUND_TIER_SWITCH_METERS;
/** loop wall 2 — foreground side walls below {@link BACKGROUND_TIER_SWITCH_METERS}. */
export const CANDY_LAYER3_FRONT_URL = layerAssetUrl('loop wall 2.png');
/** 5000 wall — foreground side walls from {@link BACKGROUND_TIER_SWITCH_METERS} upward. */
export const CANDY_LAYER3_FRONT_HIGH_URL = layerAssetUrl('5000 wall.png');

export const Z_SKY = -45;
export const Z_FX = -44;
export const Z_MIDDLE = -40;
export const Z_FRONT = -35;

/** Phaser ref: `tilePositionY -= 0.15` at 60 fps — sky ambient drift. */
export const SKY_TILE_SCROLL_PX_PER_SEC = 0.15 * 60;

/** Foreground walls drift upward slowly while the player climbs (camera parallax). */
export const FRONT_WALL_CAMERA_PARALLAX = 0.32;

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
