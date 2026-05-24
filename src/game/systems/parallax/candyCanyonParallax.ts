const GAME_ASSETS = `${import.meta.env.BASE_URL}assets`;
const BG_TESET_DIR = `${GAME_ASSETS}/${encodeURIComponent('backgroud teset')}`;

/** Bump when replacing `teset12/13/14.png` so browsers reload cached art. */
const PARALLAX_ASSET_REVISION = '20260521';

function parallaxAssetUrl(fileName: string): string {
  return `${BG_TESET_DIR}/${encodeURIComponent(fileName)}?v=${PARALLAX_ASSET_REVISION}`;
}

export const CANDY_PARALLAX_TESET14_URL = parallaxAssetUrl('teset14.png');
export const CANDY_PARALLAX_TESET13_URL = parallaxAssetUrl('teset13.png');
export const CANDY_PARALLAX_TESET12_URL = parallaxAssetUrl('teset12.png');

export type ParallaxLayerMode = 'skyScroll' | 'staticOverlay';

/** Only the far sky layer scrolls. */
export const PARALLAX_SKY_SCROLL_FACTOR = 0.08;

/** Recycled sky copies for vertical loop. */
export const PARALLAX_SKY_COPY_COUNT = 3;

/** Overlap between sky copies to hide loop seams (px). */
export const PARALLAX_SKY_LOOP_OVERLAP_PX = 100;

/** Seam fade baked into sky texture (px). */
export const PARALLAX_SKY_SEAM_FADE_PX = 64;

export type CandyParallaxLayerDef = {
  readonly id: string;
  readonly url: string;
  readonly zIndex: number;
  readonly mode: ParallaxLayerMode;
  readonly alpha?: number;
};

/**
 * teset14 → far sky (scrolls + loops)
 * teset13 → mid side candy city (camera-locked)
 * teset12 → foreground side frame (camera-locked)
 */
export const CANDY_CANYON_PARALLAX_LAYERS: readonly CandyParallaxLayerDef[] = [
  {
    id: 'sky',
    url: CANDY_PARALLAX_TESET14_URL,
    zIndex: -45,
    mode: 'skyScroll',
    alpha: 1,
  },
  {
    id: 'mid',
    url: CANDY_PARALLAX_TESET13_URL,
    zIndex: -40,
    mode: 'staticOverlay',
    alpha: 1,
  },
  {
    id: 'fore',
    url: CANDY_PARALLAX_TESET12_URL,
    zIndex: -35,
    mode: 'staticOverlay',
    alpha: 1,
  },
] as const;

/** Light candy fog overlay. */
export const PARALLAX_FOG_COLOR = 0xff99ff;
export const PARALLAX_FOG_ALPHA = 0.04;
export const PARALLAX_Z_FOG = -34;

/** Portrait-first — logical aspect height / width. */
export const PORTRAIT_MIN_ASPECT = 1.05;

export type ParallaxViewportLayout = {
  viewportW: number;
  viewportH: number;
  /** Full drawable height above the orange death strip. */
  fillH: number;
  centerX: number;
  centerY: number;
};

export function buildParallaxViewportLayout(
  viewportW: number,
  viewportH: number,
  bottomAnchorY: number,
): ParallaxViewportLayout {
  const fillH = Math.max(1, bottomAnchorY);
  return {
    viewportW,
    viewportH,
    fillH,
    centerX: viewportW * 0.5,
    centerY: fillH * 0.5,
  };
}

/** Fit by height — fills portrait drawable area without aggressive zoom-in. */
export function heightFitScaleForTexture(fillH: number, texH: number): number {
  return fillH / Math.max(1, texH);
}

/** Fit entire 9:16 art inside the viewport — no crop, no stretch. */
export function containScaleForTexture(
  viewportW: number,
  fillH: number,
  texW: number,
  texH: number,
): number {
  const byHeight = fillH / Math.max(1, texH);
  const byWidth = viewportW / Math.max(1, texW);
  return Math.min(byHeight, byWidth);
}
