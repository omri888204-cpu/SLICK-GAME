import { Texture } from 'pixi.js';
import { keyImageDataFromEdges } from '../../utils/logoTexture';

export type ParallaxTexturePrepOptions = {
  /** Soft alpha fade at top/bottom for seamless sky loop seams (px). */
  loopSeamFadePx?: number;
};

/** Keys export black edges; optional seam fade for the scrolling sky strip. */
export async function prepareParallaxLayerTexture(
  sourceUrl: string,
  prep: ParallaxTexturePrepOptions = {},
): Promise<Texture> {
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.src = sourceUrl;
  await image.decode();

  const width = image.naturalWidth;
  const height = image.naturalHeight;
  if (width <= 0 || height <= 0) {
    throw new Error(`Invalid parallax image: ${sourceUrl}`);
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    throw new Error(`Canvas unavailable for parallax image: ${sourceUrl}`);
  }

  ctx.drawImage(image, 0, 0);
  const imageData = ctx.getImageData(0, 0, width, height);
  keyImageDataFromEdges(imageData.data, width, height, 24);

  if (prep.loopSeamFadePx && prep.loopSeamFadePx > 0) {
    applyVerticalAlphaFade(imageData.data, width, height, prep.loopSeamFadePx);
  }

  ctx.putImageData(imageData, 0, 0);

  const tex = Texture.from(canvas);
  tex.source.style.addressModeU = 'clamp-to-edge';
  tex.source.style.addressModeV = 'clamp-to-edge';
  return tex;
}

function applyVerticalAlphaFade(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  fadePx: number,
): void {
  const fade = Math.max(1, Math.min(fadePx, Math.floor(height / 2)));
  for (let y = 0; y < height; y += 1) {
    let mul = 1;
    if (y < fade) {
      mul = y / fade;
    } else if (y >= height - fade) {
      mul = (height - 1 - y) / fade;
    }
    if (mul >= 1) {
      continue;
    }
    for (let x = 0; x < width; x += 1) {
      const alphaIndex = (y * width + x) * 4 + 3;
      pixels[alphaIndex] = Math.round(pixels[alphaIndex] * mul);
    }
  }
}
