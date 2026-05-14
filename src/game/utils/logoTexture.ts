import { Assets, Texture } from 'pixi.js';

const DARK_BG_MAX_CHANNEL = 42;
const CHECKER_BACKGROUND_COLOR_SPREAD = 10;

function isDarkEdgeBackgroundPixel(pixels: Uint8ClampedArray, pixelIndex: number): boolean {
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

    if (isDarkEdgeBackgroundPixel(pixels, pixelIndex)) {
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

function removeConnectedCheckerBackground(
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

    if (isCheckerBackgroundPixel(pixels, pixelIndex)) {
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
