import { Assets, Texture } from 'pixi.js';

export const DARK_BG_MAX_CHANNEL = 42;
/** Stricter edge key for character sheets — avoids eating dark line art in limb gaps. */
export const CHARACTER_SHEET_DARK_BG_MAX_CHANNEL = 18;
/** Platform food sheets (chocolate) — keeps dark brown pixels; default 42 punches holes. */
export const PLATFORM_FOOD_SHEET_DARK_BG_MAX_CHANNEL = 12;
const CHECKER_BACKGROUND_COLOR_SPREAD = 10;

function isDarkEdgeBackgroundPixel(
  pixels: Uint8ClampedArray,
  pixelIndex: number,
  darkMaxChannel: number,
): boolean {
  const dataIndex = pixelIndex * 4;
  const red = pixels[dataIndex];
  const green = pixels[dataIndex + 1];
  const blue = pixels[dataIndex + 2];
  const alpha = pixels[dataIndex + 3];
  if (alpha < 12) {
    return true;
  }

  return Math.max(red, green, blue) <= darkMaxChannel;
}

function isCheckerBackgroundPixel(pixels: Uint8ClampedArray, pixelIndex: number): boolean {
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

function removeConnectedDarkEdgeBackground(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  darkMaxChannel: number = DARK_BG_MAX_CHANNEL,
  horizontalEdgesOnly = false,
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

    if (isDarkEdgeBackgroundPixel(pixels, pixelIndex, darkMaxChannel)) {
      queue.push(pixelIndex);
    }
  };

  if (!horizontalEdgesOnly) {
    for (let x = 0; x < width; x += 1) {
      enqueue(x, 0);
      enqueue(x, height - 1);
    }
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

function removeConnectedCheckerBackground(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  horizontalEdgesOnly = false,
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

    if (isCheckerBackgroundPixel(pixels, pixelIndex)) {
      queue.push(pixelIndex);
    }
  };

  if (!horizontalEdgesOnly) {
    for (let x = 0; x < width; x += 1) {
      enqueue(x, 0);
      enqueue(x, height - 1);
    }
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

function applyLogoEdgeKeying(
  image: HTMLImageElement,
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
): void {
  context.drawImage(image, 0, 0);
  const imageData = context.getImageData(0, 0, width, height);
  removeConnectedDarkEdgeBackground(imageData.data, width, height);
  removeConnectedCheckerBackground(imageData.data, width, height);
  context.putImageData(imageData, 0, 0);
}

/** Flood-fill key black / checkerboard from image edges (in-place alpha). */
export function keyImageDataFromEdges(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  darkMaxChannel: number = DARK_BG_MAX_CHANNEL,
  horizontalEdgesOnly = false,
): void {
  removeConnectedDarkEdgeBackground(pixels, width, height, darkMaxChannel, horizontalEdgesOnly);
  removeConnectedCheckerBackground(pixels, width, height, horizontalEdgesOnly);
}

/**
 * Key export black only inside a vertical center band (top-seeded flood-fill).
 * Side wall columns stay fully opaque — avoids punching holes through tier seams on left/right edges.
 */
export function keyImageDataCenterBandFromTop(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  sideMarginRatio: number,
  darkMaxChannel: number = DARK_BG_MAX_CHANNEL,
): void {
  const margin = Math.max(0, Math.min(0.45, sideMarginRatio));
  const x0 = Math.floor(width * margin);
  const x1 = Math.ceil(width * (1 - margin));
  if (x1 <= x0 + 8) {
    return;
  }

  const visited = new Uint8Array(width * height);
  const queue: number[] = [];
  const inBand = (x: number): boolean => x >= x0 && x < x1;

  const enqueue = (x: number, y: number): void => {
    if (x < 0 || y < 0 || x >= width || y >= height || !inBand(x)) {
      return;
    }
    const pixelIndex = y * width + x;
    if (visited[pixelIndex]) {
      return;
    }
    visited[pixelIndex] = 1;
    if (isDarkEdgeBackgroundPixel(pixels, pixelIndex, darkMaxChannel)) {
      queue.push(pixelIndex);
    }
  };

  for (let x = x0; x < x1; x += 1) {
    enqueue(x, 0);
  }

  while (queue.length > 0) {
    const pixelIndex = queue.pop() ?? 0;
    const x = pixelIndex % width;
    if (!inBand(x)) {
      continue;
    }
    pixels[pixelIndex * 4 + 3] = 0;

    const y = Math.floor(pixelIndex / width);
    enqueue(x + 1, y);
    enqueue(x - 1, y);
    enqueue(x, y + 1);
    enqueue(x, y - 1);
  }
}

/**
 * Same edge keying as {@link loadLogoTextureTransparent}, for a DOM `<img src="…">`.
 * Returns a `blob:` URL when keying succeeds; caller must {@link URL.revokeObjectURL} when done.
 * On failure, returns the original `sourceUrl` unchanged.
 */
export async function createKeyedLogoObjectUrl(sourceUrl: string): Promise<string> {
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.src = sourceUrl;
  try {
    await image.decode();
  } catch {
    return sourceUrl;
  }

  const w = image.naturalWidth;
  const h = image.naturalHeight;
  if (w === 0 || h === 0) {
    return sourceUrl;
  }

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;

  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    return sourceUrl;
  }

  applyLogoEdgeKeying(image, context, w, h);

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((b) => resolve(b), 'image/png');
  });
  if (!blob) {
    return sourceUrl;
  }
  return URL.createObjectURL(blob);
}

/** Black / checkerboard backgrounds keyed from edges (Photoroom-style exports). */
export async function loadLogoTextureTransparent(url: string): Promise<Texture> {
  const fallback = await Assets.load<Texture>(url);
  const image = new Image();
  image.src = url;
  try {
    await image.decode();
  } catch {
    return fallback;
  }

  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;

  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    return fallback;
  }

  applyLogoEdgeKeying(image, context, canvas.width, canvas.height);

  return Texture.from(canvas);
}

function opaquePixelBounds(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): { x: number; y: number; w: number; h: number } | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (pixels[(y * width + x) * 4 + 3] > 12) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }
  if (maxX < minX || maxY < minY) {
    return null;
  }
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/** Edge-keyed load + tight crop to visible pixels (in-memory only — PNG file untouched). */
export async function loadKeyedTrimmedTexture(url: string): Promise<Texture> {
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.src = url;
  try {
    await image.decode();
  } catch {
    return Assets.load<Texture>(url);
  }

  const w = image.naturalWidth;
  const h = image.naturalHeight;
  if (w === 0 || h === 0) {
    return Assets.load<Texture>(url);
  }

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;

  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    return Assets.load<Texture>(url);
  }

  applyLogoEdgeKeying(image, context, w, h);
  const bounds = opaquePixelBounds(context.getImageData(0, 0, w, h).data, w, h);
  if (!bounds) {
    const texture = Texture.from(canvas);
    texture.source.scaleMode = 'linear';
    return texture;
  }

  const trimmed = document.createElement('canvas');
  trimmed.width = bounds.w;
  trimmed.height = bounds.h;
  const trimmedCtx = trimmed.getContext('2d');
  if (!trimmedCtx) {
    const texture = Texture.from(canvas);
    texture.source.scaleMode = 'linear';
    return texture;
  }

  trimmedCtx.imageSmoothingEnabled = true;
  trimmedCtx.imageSmoothingQuality = 'high';
  trimmedCtx.drawImage(canvas, bounds.x, bounds.y, bounds.w, bounds.h, 0, 0, bounds.w, bounds.h);
  const texture = Texture.from(trimmed);
  texture.source.scaleMode = 'linear';
  return texture;
}
