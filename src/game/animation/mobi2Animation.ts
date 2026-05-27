import { Rectangle, Texture } from 'pixi.js';
import { PLAYER_AVATAR_SCALE, PLAYABLE_STAFF } from '../constants/playerSkin';
import { CHARACTER_SHEET_DARK_BG_MAX_CHANNEL } from '../utils/logoTexture';
import { loadKeyedSheetCanvas } from '../utils/spriteSheetExtract';

/** Source: `public/assets/Player staff/mobi 2 movement.png` (1402×1122). */
export const MOBI2_SHEET_URL = `${PLAYABLE_STAFF}${encodeURIComponent('mobi 2 movement.png')}`;
const MOBI2_SHEET_REVISION = '20260528-mobi2-idle-uniform-v4';
export const MOBI2_SHEET_SRC = `${MOBI2_SHEET_URL}?v=${MOBI2_SHEET_REVISION}`;

export const MOBI2_SHEET_W = 1402;
export const MOBI2_SHEET_H = 1122;


type FrameRect = { x0: number; x1: number; y0: number; y1: number };

/** Column X ranges (measured from sheet). */
const IDLE_COLUMNS = [
  [219, 402],
  [465, 629],
  [702, 875],
  [973, 1144],
] as const;

const RUN_COLUMNS = [
  [57, 265],
  [300, 503],
  [541, 745],
  [807, 1016],
  [1078, 1289],
] as const;

const JUMP_COLUMNS = [
  [40, 213],
  [242, 419],
  [441, 614],
  [643, 813],
  [856, 1034],
  [1060, 1238],
] as const;

/** Idle antenna tip is ~y=34–38; do not start search at y≥70 or the tip is cropped. */
const ROW_IDLE = { y0: 0, y1: 374 };
const ROW_RUN = { y0: 385, y1: 748 };
const ROW_JUMP = { y0: 760, y1: 1122 };

const FRAME_PAD = { top: 22, right: 12, bottom: 8, left: 10 };
const ALPHA_MEASURE = 12;

export const MOBI2_ANIM = {
  fps: {
    idle: 1,
    run: 12,
    menuIdle: 1,
    menuJump: 10,
  },
  jumpLoopFrameStart: 3,
  feetAnchorY: 1,
  displayWidth: 178 * PLAYER_AVATAR_SCALE,
  runFrameDistance: 28,
} as const;

export type Mobi2ClipSet = {
  idle: Texture[];
  run: Texture[];
  jump: Texture[];
};

export type Mobi2AnimationBundle = {
  clips: Mobi2ClipSet;
  sheet: Texture;
};

let loadPromise: Promise<Mobi2AnimationBundle | null> | null = null;

function measureFrameRect(
  data: Uint8ClampedArray,
  sheetW: number,
  x0: number,
  x1: number,
  searchY0: number,
  searchY1: number,
): FrameRect | null {
  let minX = x1;
  let minY = searchY1;
  let maxX = x0;
  let maxY = searchY0;

  for (let y = searchY0; y < searchY1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      if (data[(sheetW * y + x) * 4 + 3] <= ALPHA_MEASURE) {
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

  if (maxX < minX || maxY < minY) {
    return null;
  }

  return {
    x0: Math.max(0, minX - FRAME_PAD.left),
    x1: Math.min(sheetW, maxX + 1 + FRAME_PAD.right),
    y0: Math.max(0, minY - FRAME_PAD.top),
    y1: Math.min(MOBI2_SHEET_H, maxY + 1 + FRAME_PAD.bottom),
  };
}

function buildRowFrames(
  data: Uint8ClampedArray,
  sheetW: number,
  columns: readonly (readonly [number, number])[],
  row: { y0: number; y1: number },
): FrameRect[] {
  const rects: FrameRect[] = [];
  for (const [x0, x1] of columns) {
    const rect = measureFrameRect(data, sheetW, x0, x1, row.y0, row.y1);
    if (rect) {
      rects.push(rect);
    }
  }
  return rects;
}

function sliceFrames(sheet: Texture, rects: readonly FrameRect[]): Texture[] {
  return rects.map(
    (rect) =>
      new Texture({
        source: sheet.source,
        frame: new Rectangle(rect.x0, rect.y0, rect.x1 - rect.x0, rect.y1 - rect.y0),
      }),
  );
}

/** Feet center X within a frame rect (local coords), from bottom opaque pixels. */
function measureFeetCenterXLocal(
  data: Uint8ClampedArray,
  sheetW: number,
  rect: FrameRect,
): number {
  const w = rect.x1 - rect.x0;
  const h = rect.y1 - rect.y0;
  const scanRows = Math.max(4, Math.floor(h * 0.1));
  let minX = w;
  let maxX = 0;

  for (let y = rect.y1 - scanRows; y < rect.y1; y += 1) {
    for (let x = rect.x0; x < rect.x1; x += 1) {
      if (data[(sheetW * y + x) * 4 + 3] <= ALPHA_MEASURE) {
        continue;
      }
      const localX = x - rect.x0;
      if (localX < minX) {
        minX = localX;
      }
      if (localX > maxX) {
        maxX = localX;
      }
    }
  }

  if (maxX < minX) {
    return w * 0.5;
  }
  return (minX + maxX + 1) * 0.5;
}

/**
 * Packs idle frames onto one shared canvas size — feet on bottom, feet X centered
 * so frames stack without size or position jitter.
 */
function normalizeIdleFramesUniform(
  sheetCanvas: HTMLCanvasElement,
  data: Uint8ClampedArray,
  rects: readonly FrameRect[],
): Texture[] {
  if (rects.length === 0) {
    return [];
  }

  let outW = 1;
  let outH = 1;
  for (const rect of rects) {
    outW = Math.max(outW, rect.x1 - rect.x0);
    outH = Math.max(outH, rect.y1 - rect.y0);
  }

  return rects.map((rect) => {
    const srcW = rect.x1 - rect.x0;
    const srcH = rect.y1 - rect.y0;
    const footCenterX = measureFeetCenterXLocal(data, sheetCanvas.width, rect);
    const dx = Math.floor(outW * 0.5 - footCenterX);
    const dy = outH - srcH;

    const outCanvas = document.createElement('canvas');
    outCanvas.width = outW;
    outCanvas.height = outH;
    const outCtx = outCanvas.getContext('2d');
    if (!outCtx) {
      return Texture.EMPTY;
    }

    outCtx.drawImage(
      sheetCanvas,
      rect.x0,
      rect.y0,
      srcW,
      srcH,
      dx,
      dy,
      srcW,
      srcH,
    );
    return Texture.from(outCanvas);
  });
}

export function loadMobi2Animation(): Promise<Mobi2AnimationBundle | null> {
  loadPromise ??= (async () => {
    const canvas = await loadKeyedSheetCanvas(MOBI2_SHEET_SRC, {
      darkMaxChannel: CHARACTER_SHEET_DARK_BG_MAX_CHANNEL,
    });
    if (!canvas) {
      console.warn('[Mobi2Animation] Failed to load sheet');
      return null;
    }

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      return null;
    }
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    const idleRects = buildRowFrames(data, canvas.width, IDLE_COLUMNS, ROW_IDLE);
    const runRects = buildRowFrames(data, canvas.width, RUN_COLUMNS, ROW_RUN);
    const jumpRects = buildRowFrames(data, canvas.width, JUMP_COLUMNS, ROW_JUMP);

    const sheet = Texture.from(canvas);
    const clips: Mobi2ClipSet = {
      idle: normalizeIdleFramesUniform(canvas, data, idleRects),
      run: sliceFrames(sheet, runRects),
      jump: sliceFrames(sheet, jumpRects),
    };

    if (clips.idle.length === 0) {
      console.warn('[Mobi2Animation] No idle frames');
      return null;
    }

    return { clips, sheet };
  })();
  return loadPromise;
}

export function resetMobi2AnimationCache(): void {
  loadPromise = null;
}

export function mobi2ClipsToCharacterTextures(clips: Mobi2ClipSet): {
  idle: Texture[];
  walk: Texture[];
  run: Texture[];
  jump: Texture[];
  slide: Texture[];
  attack: Texture[];
  landing: Texture[];
} {
  const run = clips.run.length > 0 ? clips.run : clips.idle;
  const jump = clips.jump.length > 0 ? clips.jump : clips.idle;
  const landing = jump.length >= 2 ? jump.slice(-2) : jump;

  return {
    idle: clips.idle,
    walk: run,
    run,
    jump,
    slide: landing.length >= 2 ? [landing[0]!, landing[1]!] : landing.length > 0 ? [landing[0]!] : clips.idle,
    attack: run.length >= 4 ? [run[0]!, run[2]!, run[4]!] : run,
    landing,
  };
}
