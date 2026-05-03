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

/** Black / checkerboard backgrounds keyed from edges (Photoroom-style exports). */
export async function loadLogoTextureTransparent(url: string): Promise<Texture> {
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
  removeConnectedDarkEdgeBackground(imageData.data, canvas.width, canvas.height);
  removeConnectedCheckerBackground(imageData.data, canvas.width, canvas.height);
  context.putImageData(imageData, 0, 0);

  return Texture.from(canvas);
}
