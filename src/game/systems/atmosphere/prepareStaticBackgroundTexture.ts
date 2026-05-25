import { Texture } from 'pixi.js';
import { keyImageDataCenterBandFromTop, keyImageDataFromEdges } from '../../utils/logoTexture';

export type StaticBackgroundTexturePrep = {
  /** Enable vertical repeat for TilingSprite layers. */
  verticalRepeat?: boolean;
  /** Skip flood-fill keying — keeps seamless vertical tile art opaque (e.g. back 5000). */
  skipEdgeKeying?: boolean;
  /**
   * Key black from the top row inside `[margin×W, (1-margin)×W)` only.
   * Preserves side wall columns (e.g. `10000 walls.png` tier seams on the edges).
   */
  centerBandEdgeKeyMarginRatio?: number;
  /** Nearest sampling — avoids linear-filter gaps on tile seams. */
  nearestScale?: boolean;
};

function applyTextureSampling(
  tex: Texture,
  prep: StaticBackgroundTexturePrep,
): void {
  tex.source.style.addressModeU = 'clamp-to-edge';
  tex.source.style.addressModeV = prep.verticalRepeat ? 'repeat' : 'clamp-to-edge';
  tex.source.style.scaleMode = prep.nearestScale ? 'nearest' : 'linear';
}

/** Keys export black edges; optional vertical repeat for tiled layers. */
export async function prepareStaticBackgroundTexture(
  sourceUrl: string,
  prep: StaticBackgroundTexturePrep = {},
): Promise<Texture> {
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.src = sourceUrl;
  await image.decode();

  const width = image.naturalWidth;
  const height = image.naturalHeight;
  if (width <= 0 || height <= 0) {
    throw new Error(`Invalid background layer: ${sourceUrl}`);
  }

  if (prep.skipEdgeKeying) {
    const tex = Texture.from(image);
    applyTextureSampling(tex, prep);
    return tex;
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    throw new Error(`Canvas unavailable for background layer: ${sourceUrl}`);
  }

  ctx.drawImage(image, 0, 0);
  const imageData = ctx.getImageData(0, 0, width, height);
  if (prep.centerBandEdgeKeyMarginRatio != null) {
    keyImageDataCenterBandFromTop(
      imageData.data,
      width,
      height,
      prep.centerBandEdgeKeyMarginRatio,
      24,
    );
  } else {
    // Vertical tiles: keep top/bottom opaque so repeat seams stay flush.
    keyImageDataFromEdges(imageData.data, width, height, 24, prep.verticalRepeat === true);
  }
  ctx.putImageData(imageData, 0, 0);

  const tex = Texture.from(canvas);
  applyTextureSampling(tex, prep);
  return tex;
}
