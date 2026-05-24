import { Texture } from 'pixi.js';
import {
  DARK_BG_MAX_CHANNEL,
  keyImageDataFromEdges,
} from './logoTexture';

const ALPHA_OPAQUE = 40;
const COLUMN_GAP_PX = 14;
const MIN_FRAME_WIDTH_PX = 72;

type ColumnRange = { x0: number; x1: number };

type TightBounds = { x: number; y: number; w: number; h: number };

export type NormalizedSheetFrames = {
  textures: Texture[];
  /** Feet sit on the bottom edge of each normalized canvas (Pixi anchor Y). */
  feetAnchorY: number;
};

function findColumnRanges(bandW: number, bandH: number, pixels: Uint8ClampedArray): ColumnRange[] {
  const colActive = new Uint8Array(bandW);
  for (let y = 0; y < bandH; y += 1) {
    for (let x = 0; x < bandW; x += 1) {
      if (pixels[(y * bandW + x) * 4 + 3] > ALPHA_OPAQUE) {
        colActive[x] = 1;
      }
    }
  }

  const activeX: number[] = [];
  for (let x = 0; x < bandW; x += 1) {
    if (colActive[x]) {
      activeX.push(x);
    }
  }
  if (activeX.length === 0) {
    return [];
  }

  const ranges: ColumnRange[] = [];
  let start = activeX[0];
  let prev = activeX[0];
  for (let i = 1; i < activeX.length; i += 1) {
    const x = activeX[i];
    if (x <= prev + COLUMN_GAP_PX) {
      prev = x;
      continue;
    }
    if (prev - start + 1 >= MIN_FRAME_WIDTH_PX) {
      ranges.push({ x0: start, x1: prev + 1 });
    }
    start = x;
    prev = x;
  }
  if (prev - start + 1 >= MIN_FRAME_WIDTH_PX) {
    ranges.push({ x0: start, x1: prev + 1 });
  }
  return ranges;
}

type OpaqueComponent = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  size: number;
};

function findOpaqueComponents(
  pixels: Uint8ClampedArray,
  sliceW: number,
  sliceH: number,
): OpaqueComponent[] {
  const visited = new Uint8Array(sliceW * sliceH);
  const components: OpaqueComponent[] = [];

  for (let sy = 0; sy < sliceH; sy += 1) {
    for (let sx = 0; sx < sliceW; sx += 1) {
      const start = sy * sliceW + sx;
      if (visited[start] || pixels[start * 4 + 3] <= ALPHA_OPAQUE) {
        continue;
      }

      let x0 = sx;
      let y0 = sy;
      let x1 = sx;
      let y1 = sy;
      let size = 0;
      const queue: number[] = [start];
      visited[start] = 1;

      while (queue.length > 0) {
        const pixel = queue.pop() ?? 0;
        size += 1;
        const x = pixel % sliceW;
        const y = Math.floor(pixel / sliceW);
        if (x < x0) {
          x0 = x;
        }
        if (y < y0) {
          y0 = y;
        }
        if (x > x1) {
          x1 = x;
        }
        if (y > y1) {
          y1 = y;
        }

        if (x > 0) {
          const left = pixel - 1;
          if (!visited[left] && pixels[left * 4 + 3] > ALPHA_OPAQUE) {
            visited[left] = 1;
            queue.push(left);
          }
        }
        if (x + 1 < sliceW) {
          const right = pixel + 1;
          if (!visited[right] && pixels[right * 4 + 3] > ALPHA_OPAQUE) {
            visited[right] = 1;
            queue.push(right);
          }
        }
        if (y > 0) {
          const up = pixel - sliceW;
          if (!visited[up] && pixels[up * 4 + 3] > ALPHA_OPAQUE) {
            visited[up] = 1;
            queue.push(up);
          }
        }
        if (y + 1 < sliceH) {
          const down = pixel + sliceW;
          if (!visited[down] && pixels[down * 4 + 3] > ALPHA_OPAQUE) {
            visited[down] = 1;
            queue.push(down);
          }
        }
      }

      components.push({ x0, y0, x1, y1, size });
    }
  }

  components.sort((a, b) => b.size - a.size);
  return components;
}

/** Full opaque bbox — keeps crumbs/drips for platform food sheets. */
function foodOpaqueBounds(
  pixels: Uint8ClampedArray,
  sliceW: number,
  sliceH: number,
): TightBounds | null {
  let minX = sliceW;
  let minY = sliceH;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < sliceH; y += 1) {
    for (let x = 0; x < sliceW; x += 1) {
      if (pixels[(y * sliceW + x) * 4 + 3] <= ALPHA_OPAQUE) {
        continue;
      }
      if (x < minX) {
        minX = x;
      }
      if (y < minY) {
        minY = y;
      }
      if (x > maxX) {
        maxX = x;
      }
      if (y > maxY) {
        maxY = y;
      }
    }
  }
  if (maxX < 0) {
    return null;
  }
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/** Drops sheet labels (digit clusters / Hebrew tags) while keeping detached feet blobs. */
function characterOpaqueBounds(
  pixels: Uint8ClampedArray,
  sliceW: number,
  sliceH: number,
): TightBounds | null {
  const components = findOpaqueComponents(pixels, sliceW, sliceH);
  if (components.length === 0) {
    return null;
  }

  const main = components[0];
  const kept: OpaqueComponent[] = [main];

  for (const component of components.slice(1)) {
    if (component.x1 < 22 && component.size < 900) {
      continue;
    }
    // Sheet frame digits — small isolated blobs fully below the body.
    if (component.y0 > main.y1 + 5 && component.size < 900) {
      continue;
    }
    if (component.y0 <= main.y1 + 5) {
      kept.push(component);
    }
  }

  const x0 = Math.min(...kept.map((component) => component.x0));
  const y0 = Math.min(...kept.map((component) => component.y0));
  const x1 = Math.max(...kept.map((component) => component.x1));
  const y1 = Math.max(...kept.map((component) => component.y1));
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

function trimSliceCanvas(sliceCanvas: HTMLCanvasElement): TightBounds | null {
  const ctx = sliceCanvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    return null;
  }
  const w = sliceCanvas.width;
  const h = sliceCanvas.height;
  const imageData = ctx.getImageData(0, 0, w, h);
  return characterOpaqueBounds(imageData.data, w, h);
}

function inflateBounds(
  bounds: TightBounds,
  pad: number,
  maxW: number,
  maxH: number,
): TightBounds {
  const x0 = Math.max(0, bounds.x - pad);
  const y0 = Math.max(0, bounds.y - pad);
  const x1 = Math.min(maxW, bounds.x + bounds.w + pad);
  const y1 = Math.min(maxH, bounds.y + bounds.h + pad);
  return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
}

function trimFoodSliceCanvas(sliceCanvas: HTMLCanvasElement, boundsPadPx = 0): TightBounds | null {
  const ctx = sliceCanvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    return null;
  }
  const w = sliceCanvas.width;
  const h = sliceCanvas.height;
  const imageData = ctx.getImageData(0, 0, w, h);
  const bounds = foodOpaqueBounds(imageData.data, w, h);
  if (!bounds) {
    return null;
  }
  if (boundsPadPx <= 0) {
    return bounds;
  }
  return inflateBounds(bounds, boundsPadPx, w, h);
}

function packFrameTexture(
  sliceCanvas: HTMLCanvasElement,
  bounds: TightBounds,
  outW: number,
  outH: number,
): Texture {
  const outCanvas = document.createElement('canvas');
  outCanvas.width = outW;
  outCanvas.height = outH;
  const outCtx = outCanvas.getContext('2d');
  if (!outCtx) {
    return Texture.EMPTY;
  }
  const dx = Math.floor((outW - bounds.w) * 0.5);
  const dy = outH - bounds.h;
  outCtx.drawImage(
    sliceCanvas,
    bounds.x,
    bounds.y,
    bounds.w,
    bounds.h,
    dx,
    dy,
    bounds.w,
    bounds.h,
  );
  return Texture.from(outCanvas);
}

type TrimmedSlice = { sliceCanvas: HTMLCanvasElement; bounds: TightBounds };

function collectTrimmedSlices(
  sheetCanvas: HTMLCanvasElement,
  rowY0: number,
  rowY1: number,
  ranges: ColumnRange[],
  trimSlice: (sliceCanvas: HTMLCanvasElement) => TightBounds | null,
): TrimmedSlice[] {
  const sheetW = sheetCanvas.width;
  const bandH = rowY1 - rowY0;

  const bandCanvas = document.createElement('canvas');
  bandCanvas.width = sheetW;
  bandCanvas.height = bandH;
  const bandCtx = bandCanvas.getContext('2d', { willReadFrequently: true });
  if (!bandCtx) {
    return [];
  }
  bandCtx.drawImage(sheetCanvas, 0, rowY0, sheetW, bandH, 0, 0, sheetW, bandH);

  const trimmed: TrimmedSlice[] = [];
  for (const range of ranges) {
    const sliceW = range.x1 - range.x0;
    const sliceCanvas = document.createElement('canvas');
    sliceCanvas.width = sliceW;
    sliceCanvas.height = bandH;
    const sliceCtx = sliceCanvas.getContext('2d');
    if (!sliceCtx) {
      continue;
    }
    sliceCtx.drawImage(bandCanvas, range.x0, 0, sliceW, bandH, 0, 0, sliceW, bandH);
    const bounds = trimSlice(sliceCanvas);
    if (bounds) {
      trimmed.push({ sliceCanvas, bounds });
    }
  }
  return trimmed;
}

export type SheetRowBand = {
  y0: number;
  y1: number;
  columns: readonly ColumnRange[];
};

/**
 * Packs every row onto one shared canvas at native pixel size (no per-frame upscale).
 * Smaller jump poses stay smaller instead of blowing up to the run strip height.
 */
export function extractUniformSheetFrameRows(
  sheetCanvas: HTMLCanvasElement,
  bands: readonly SheetRowBand[],
): NormalizedSheetFrames[] {
  const rowSlices = bands.map((band) =>
    collectTrimmedSlices(sheetCanvas, band.y0, band.y1, [...band.columns], trimSliceCanvas),
  );

  let globalOutW = 1;
  let globalOutH = 1;
  for (const row of rowSlices) {
    for (const { bounds } of row) {
      globalOutW = Math.max(globalOutW, bounds.w);
      globalOutH = Math.max(globalOutH, bounds.h);
    }
  }

  return rowSlices.map((row) => ({
    textures: row.map(({ sliceCanvas, bounds }) =>
      packFrameTexture(sliceCanvas, bounds, globalOutW, globalOutH),
    ),
    feetAnchorY: 1,
  }));
}

function extractRowFramesFromColumns(
  sheetCanvas: HTMLCanvasElement,
  rowY0: number,
  rowY1: number,
  ranges: ColumnRange[],
): NormalizedSheetFrames {
  const trimmed = collectTrimmedSlices(sheetCanvas, rowY0, rowY1, ranges, trimSliceCanvas);
  if (trimmed.length === 0) {
    return { textures: [], feetAnchorY: 1 };
  }

  const outW = Math.max(...trimmed.map((t) => t.bounds.w));
  const outH = Math.max(...trimmed.map((t) => t.bounds.h));
  const textures = trimmed.map(({ sliceCanvas, bounds }) =>
    packFrameTexture(sliceCanvas, bounds, outW, outH),
  );

  return { textures, feetAnchorY: 1 };
}

/**
 * Detects each animation strip in a row band, keys the background, trims to opaque
 * bounds, and packs frames onto a shared canvas with feet on the bottom edge.
 */
export function extractNormalizedRowFrames(
  sheetCanvas: HTMLCanvasElement,
  rowY0: number,
  rowY1: number,
  maxFrames: number,
): NormalizedSheetFrames {
  const sheetW = sheetCanvas.width;
  const bandH = rowY1 - rowY0;
  const bandCtx = sheetCanvas.getContext('2d', { willReadFrequently: true });
  if (!bandCtx) {
    return { textures: [], feetAnchorY: 1 };
  }
  const bandData = bandCtx.getImageData(0, rowY0, sheetW, bandH);
  const ranges = findColumnRanges(sheetW, bandH, bandData.data).slice(0, maxFrames);
  return extractRowFramesFromColumns(sheetCanvas, rowY0, rowY1, ranges);
}

/** Uses pre-measured row bounds and column rects (avoids label bleed and row overlap). */
export function extractExplicitRowFrames(
  sheetCanvas: HTMLCanvasElement,
  rowY0: number,
  rowY1: number,
  columns: readonly ColumnRange[],
): NormalizedSheetFrames {
  return extractRowFramesFromColumns(sheetCanvas, rowY0, rowY1, [...columns]);
}

/** Platform food sheets — full opaque trim (crumbs/drips), feet on canvas bottom. */
export type PlatformFoodSheetExtractOptions = {
  /** Expand each grid cell before slicing (px). */
  cellPadPx?: number;
  /** Expand trimmed opaque bounds inside the cell (px). */
  boundsPadPx?: number;
};

export function extractPlatformFoodSheetFrameRows(
  sheetCanvas: HTMLCanvasElement,
  bands: readonly SheetRowBand[],
  options: PlatformFoodSheetExtractOptions = {},
): NormalizedSheetFrames[] {
  const cellPadPx = Math.max(0, options.cellPadPx ?? 0);
  const boundsPadPx = Math.max(0, options.boundsPadPx ?? 0);
  const sheetH = sheetCanvas.height;
  const paddedBands: SheetRowBand[] = bands.map((band) => ({
    y0: Math.max(0, band.y0 - cellPadPx),
    y1: Math.min(sheetH, band.y1 + cellPadPx),
    columns: [...band.columns],
  }));
  const trimSlice = (sliceCanvas: HTMLCanvasElement): TightBounds | null =>
    trimFoodSliceCanvas(sliceCanvas, boundsPadPx);

  const rowSlices = paddedBands.map((band) =>
    collectTrimmedSlices(sheetCanvas, band.y0, band.y1, [...band.columns], trimSlice),
  );

  let globalOutW = 1;
  let globalOutH = 1;
  for (const row of rowSlices) {
    for (const { bounds } of row) {
      globalOutW = Math.max(globalOutW, bounds.w);
      globalOutH = Math.max(globalOutH, bounds.h);
    }
  }

  return rowSlices.map((row) => ({
    textures: row.map(({ sliceCanvas, bounds }) =>
      packFrameTexture(sliceCanvas, bounds, globalOutW, globalOutH),
    ),
    feetAnchorY: 1,
  }));
}

export type KeyedSheetLoadOptions = {
  /** Lower = keeps more dark line art; default {@link DARK_BG_MAX_CHANNEL}. */
  darkMaxChannel?: number;
};

export async function loadKeyedSheetCanvas(
  url: string,
  options: KeyedSheetLoadOptions = {},
): Promise<HTMLCanvasElement | null> {
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.src = url;
  try {
    await image.decode();
  } catch {
    return null;
  }

  const width = image.naturalWidth;
  const height = image.naturalHeight;
  if (width <= 0 || height <= 0) {
    return null;
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    return null;
  }

  ctx.drawImage(image, 0, 0);
  const imageData = ctx.getImageData(0, 0, width, height);
  keyImageDataFromEdges(
    imageData.data,
    width,
    height,
    options.darkMaxChannel ?? DARK_BG_MAX_CHANNEL,
  );
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}
