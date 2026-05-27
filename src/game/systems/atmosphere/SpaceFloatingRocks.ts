import { Container, Sprite, Texture } from 'pixi.js';
import { keyImageDataFromEdges } from '../../utils/logoTexture';
import {
  CANDY_ROCKS_1_URL,
  SPACE_ROCKS_TRI_LEFT_X_RATIO,
  SPACE_ROCKS_TRI_TOP_Y_RATIO,
  type LayerBackgroundLayout,
} from './candyStaticBackground';

const FLOATING_ROCK_COUNT = 3;
const ALPHA_OPAQUE = 40;
const MIN_ROCK_COMPONENT_PX = 12_000;
const MIN_ROCK_BOUNDS_PX = 72;
const ROCK_CROP_PAD_PX = 2;
/** Edge flood-fill — true black sheet only; avoids eating dark rock paint. */
const ROCK_SHEET_KEY_DARK_MAX = 22;
/** Outer halo peel: dark fringe, gray/purple veil, weak alpha (sheet + crop). */
const ROCK_OUTER_FRINGE_MAX = 52;
const ROCK_OUTER_HALO_ALPHA_WEAK = 100;
const ROCK_OUTER_HALO_ALPHA_SOFT = 185;
const ROCK_OUTER_HALO_SOFT_BRIGHTNESS = 82;
const ROCK_OUTER_HALO_PASS_COUNT = 14;
const ROCK_OUTER_HALO_CROP_EXTRA_PASSES = 6;
const ROCK_FRINGE_ALPHA_CLEAR = 12;
/** Drop ghost fringe after crop clean (not applied to full sheet). */
const ROCK_ALPHA_GHOST_MAX = 48;
/** Stray islands on the sheet before picking the three rocks. */
const ROCK_SHEET_SPECK_MAX_PX = 800;
/** Min distance between rock centers on the source sheet (px). */
const MIN_SHEET_ROCK_SEPARATION_PX = 180;
/** Min distance between floaters inside the triangle (× combined radius). */
const MIN_FLOAT_SEPARATION_RADIUS_MULT = 2.8;
/** Constant slow drift (screen px/s) — always maintained. */
const ROCK_SPEED_PX_PER_SEC = 35;
const ROCK_WIDTH_VIEWPORT_RATIO = 0.158 * 1.1;

type Vec2 = { x: number; y: number };

type TriangleBounds = {
  bl: Vec2;
  br: Vec2;
  tr: Vec2;
};

type OpaqueComponent = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  size: number;
};

type FloatingRock = {
  sprite: Sprite;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
};

function pointInTriangle(p: Vec2, a: Vec2, b: Vec2, c: Vec2): boolean {
  const cross = (p1: Vec2, p2: Vec2, p3: Vec2) =>
    (p1.x - p3.x) * (p2.y - p3.y) - (p2.x - p3.x) * (p1.y - p3.y);
  const d1 = cross(p, a, b);
  const d2 = cross(p, b, c);
  const d3 = cross(p, c, a);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

function buildTriangle(layout: LayerBackgroundLayout): TriangleBounds {
  const bottomY = layout.fillH;
  const rightX = layout.viewportW;
  const topY = layout.fillH * SPACE_ROCKS_TRI_TOP_Y_RATIO;
  const leftX = layout.viewportW * SPACE_ROCKS_TRI_LEFT_X_RATIO;
  return {
    bl: { x: leftX, y: bottomY },
    br: { x: rightX, y: bottomY },
    tr: { x: rightX, y: topY },
  };
}

function componentCenter(component: OpaqueComponent): Vec2 {
  return {
    x: (component.x0 + component.x1) * 0.5,
    y: (component.y0 + component.y1) * 0.5,
  };
}

function hypotenuseNormal(tri: TriangleBounds): Vec2 {
  const dx = tri.bl.x - tri.tr.x;
  const dy = tri.bl.y - tri.tr.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: dy / len, y: -dx / len };
}

function randomDirectionVelocity(): { vx: number; vy: number } {
  const angle = Math.random() * Math.PI * 2;
  return {
    vx: Math.cos(angle) * ROCK_SPEED_PX_PER_SEC,
    vy: Math.sin(angle) * ROCK_SPEED_PX_PER_SEC,
  };
}

/** Preserves heading, fixes magnitude to {@link ROCK_SPEED_PX_PER_SEC}. */
function withConstantSpeed(vx: number, vy: number): { vx: number; vy: number } {
  const len = Math.hypot(vx, vy);
  if (len < 1e-5) {
    return randomDirectionVelocity();
  }
  const scale = ROCK_SPEED_PX_PER_SEC / len;
  return { vx: vx * scale, vy: vy * scale };
}

function applyConstantSpeed(rock: FloatingRock): void {
  const v = withConstantSpeed(rock.vx, rock.vy);
  rock.vx = v.vx;
  rock.vy = v.vy;
}

/** Reflect across wall normal, then restore constant slow speed along the new direction. */
function bounceVelocity(vx: number, vy: number, nx: number, ny: number): { vx: number; vy: number } {
  const dot = vx * nx + vy * ny;
  return withConstantSpeed(vx - 2 * dot * nx, vy - 2 * dot * ny);
}

function findOpaqueComponents(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): OpaqueComponent[] {
  const visited = new Uint8Array(width * height);
  const components: OpaqueComponent[] = [];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const start = y * width + x;
      if (visited[start] || pixels[start * 4 + 3] <= ALPHA_OPAQUE) {
        continue;
      }

      let x0 = x;
      let y0 = y;
      let x1 = x;
      let y1 = y;
      let size = 0;
      const queue: number[] = [start];
      visited[start] = 1;

      while (queue.length > 0) {
        const pixel = queue.pop() ?? 0;
        size += 1;
        const px = pixel % width;
        const py = Math.floor(pixel / width);
        x0 = Math.min(x0, px);
        y0 = Math.min(y0, py);
        x1 = Math.max(x1, px);
        y1 = Math.max(y1, py);

        if (px > 0) {
          const left = pixel - 1;
          if (!visited[left] && pixels[left * 4 + 3] > ALPHA_OPAQUE) {
            visited[left] = 1;
            queue.push(left);
          }
        }
        if (px + 1 < width) {
          const right = pixel + 1;
          if (!visited[right] && pixels[right * 4 + 3] > ALPHA_OPAQUE) {
            visited[right] = 1;
            queue.push(right);
          }
        }
        if (py > 0) {
          const up = pixel - width;
          if (!visited[up] && pixels[up * 4 + 3] > ALPHA_OPAQUE) {
            visited[up] = 1;
            queue.push(up);
          }
        }
        if (py + 1 < height) {
          const down = pixel + width;
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

type TightBounds = { x: number; y: number; w: number; h: number };

function trimOpaqueBounds(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  alphaThreshold: number,
): TightBounds | null {
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (pixels[(y * width + x) * 4 + 3] > alphaThreshold) {
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

function isRockOuterHaloPixel(pixels: Uint8ClampedArray, pixel: number): boolean {
  const base = pixel * 4;
  const alpha = pixels[base + 3];
  if (alpha <= ROCK_FRINGE_ALPHA_CLEAR) {
    return false;
  }
  const red = pixels[base];
  const green = pixels[base + 1];
  const blue = pixels[base + 2];
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const spread = max - min;

  if (max <= ROCK_OUTER_FRINGE_MAX) {
    return true;
  }
  if (alpha < ROCK_OUTER_HALO_ALPHA_WEAK) {
    return true;
  }
  if (alpha < ROCK_OUTER_HALO_ALPHA_SOFT && max <= ROCK_OUTER_HALO_SOFT_BRIGHTNESS) {
    return true;
  }
  if (max <= 118 && blue > red + 7 && blue > green + 3 && spread < 94) {
    return true;
  }
  return alpha < 215 && spread <= 34 && max <= 132;
}

/** Peels halo layers from the silhouette inward — stops at solid rock color. */
function stripOuterRockHalo(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  passCount: number,
): void {
  const isClear = (pixel: number) => pixels[pixel * 4 + 3] <= ROCK_FRINGE_ALPHA_CLEAR;
  const touchesClear = (pixel: number) => {
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    const neighbors: number[] = [];
    if (x > 0) {
      neighbors.push(pixel - 1);
    }
    if (x + 1 < width) {
      neighbors.push(pixel + 1);
    }
    if (y > 0) {
      neighbors.push(pixel - width);
    }
    if (y + 1 < height) {
      neighbors.push(pixel + width);
    }
    if (x > 0 && y > 0) {
      neighbors.push(pixel - width - 1);
    }
    if (x + 1 < width && y > 0) {
      neighbors.push(pixel - width + 1);
    }
    if (x > 0 && y + 1 < height) {
      neighbors.push(pixel + width - 1);
    }
    if (x + 1 < width && y + 1 < height) {
      neighbors.push(pixel + width + 1);
    }
    return neighbors.some((neighbor) => isClear(neighbor));
  };

  for (let pass = 0; pass < passCount; pass += 1) {
    const toClear: number[] = [];
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const pixel = y * width + x;
        if (isClear(pixel) || !touchesClear(pixel) || !isRockOuterHaloPixel(pixels, pixel)) {
          continue;
        }
        toClear.push(pixel);
      }
    }
    if (toClear.length === 0) {
      break;
    }
    for (const pixel of toClear) {
      pixels[pixel * 4 + 3] = 0;
    }
  }
}

function clearOpaqueCluster(pixels: Uint8ClampedArray, cluster: number[]): void {
  for (const pixel of cluster) {
    pixels[pixel * 4 + 3] = 0;
  }
}

function forEachOpaqueCluster(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  visitor: (cluster: number[], size: number) => void,
): void {
  const visited = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const start = y * width + x;
      if (visited[start] || pixels[start * 4 + 3] <= ALPHA_OPAQUE) {
        continue;
      }

      const cluster: number[] = [];
      const queue: number[] = [start];
      visited[start] = 1;
      while (queue.length > 0) {
        const pixel = queue.pop() ?? 0;
        cluster.push(pixel);
        const px = pixel % width;
        const py = Math.floor(pixel / width);
        if (px > 0) {
          const left = pixel - 1;
          if (!visited[left] && pixels[left * 4 + 3] > ALPHA_OPAQUE) {
            visited[left] = 1;
            queue.push(left);
          }
        }
        if (px + 1 < width) {
          const right = pixel + 1;
          if (!visited[right] && pixels[right * 4 + 3] > ALPHA_OPAQUE) {
            visited[right] = 1;
            queue.push(right);
          }
        }
        if (py > 0) {
          const up = pixel - width;
          if (!visited[up] && pixels[up * 4 + 3] > ALPHA_OPAQUE) {
            visited[up] = 1;
            queue.push(up);
          }
        }
        if (py + 1 < height) {
          const down = pixel + width;
          if (!visited[down] && pixels[down * 4 + 3] > ALPHA_OPAQUE) {
            visited[down] = 1;
            queue.push(down);
          }
        }
      }
      visitor(cluster, cluster.length);
    }
  }
}

/** Each crop is one rock — delete detached dirt islands (e.g. triangular specks). */
function keepLargestOpaqueIslandOnly(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): void {
  const clusters: number[][] = [];
  forEachOpaqueCluster(pixels, width, height, (cluster) => {
    clusters.push(cluster);
  });
  if (clusters.length <= 1) {
    return;
  }
  clusters.sort((a, b) => b.length - a.length);
  for (let i = 1; i < clusters.length; i += 1) {
    clearOpaqueCluster(pixels, clusters[i]!);
  }
}

function removeOpaqueIslandsSmallerThan(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  minPx: number,
): void {
  forEachOpaqueCluster(pixels, width, height, (cluster, size) => {
    if (size < minPx) {
      clearOpaqueCluster(pixels, cluster);
    }
  });
}

/** Breaks 1px dark export bridges that link stray specks to the rock silhouette. */
function severDarkNeckPixels(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  passCount: number,
): void {
  const isOpaque = (pixel: number) => pixels[pixel * 4 + 3] > ALPHA_OPAQUE;
  const isDarkNeck = (pixel: number) => {
    const base = pixel * 4;
    return Math.max(pixels[base], pixels[base + 1], pixels[base + 2]) <= 42;
  };

  for (let pass = 0; pass < passCount; pass += 1) {
    const toClear: number[] = [];
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const pixel = y * width + x;
        if (!isOpaque(pixel) || !isDarkNeck(pixel)) {
          continue;
        }
        let neighbors = 0;
        if (x > 0 && isOpaque(pixel - 1)) {
          neighbors += 1;
        }
        if (x + 1 < width && isOpaque(pixel + 1)) {
          neighbors += 1;
        }
        if (y > 0 && isOpaque(pixel - width)) {
          neighbors += 1;
        }
        if (y + 1 < height && isOpaque(pixel + width)) {
          neighbors += 1;
        }
        if (neighbors <= 2) {
          toClear.push(pixel);
        }
      }
    }
    if (toClear.length === 0) {
      break;
    }
    for (const pixel of toClear) {
      pixels[pixel * 4 + 3] = 0;
    }
  }
}

function purgeNearTransparentPixels(pixels: Uint8ClampedArray): void {
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] > 0 && pixels[i + 3] < ROCK_ALPHA_GHOST_MAX) {
      pixels[i + 3] = 0;
    }
  }
}

function prepareRockSheetAlpha(pixels: Uint8ClampedArray, width: number, height: number): void {
  keyImageDataFromEdges(pixels, width, height, ROCK_SHEET_KEY_DARK_MAX, false);
  stripOuterRockHalo(pixels, width, height, ROCK_OUTER_HALO_PASS_COUNT);
  removeOpaqueIslandsSmallerThan(pixels, width, height, ROCK_SHEET_SPECK_MAX_PX);
  stripOuterRockHalo(pixels, width, height, ROCK_OUTER_HALO_CROP_EXTRA_PASSES);
}

function finalizeRockCropAlpha(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): void {
  stripOuterRockHalo(pixels, width, height, ROCK_OUTER_HALO_PASS_COUNT);
  severDarkNeckPixels(pixels, width, height, 3);
  keepLargestOpaqueIslandOnly(pixels, width, height);
  stripOuterRockHalo(pixels, width, height, ROCK_OUTER_HALO_CROP_EXTRA_PASSES);
  purgeNearTransparentPixels(pixels);
}

function textureFromComponentBounds(
  source: HTMLCanvasElement,
  component: OpaqueComponent,
): Texture {
  const x0 = Math.max(0, component.x0 - ROCK_CROP_PAD_PX);
  const y0 = Math.max(0, component.y0 - ROCK_CROP_PAD_PX);
  const x1 = Math.min(source.width - 1, component.x1 + ROCK_CROP_PAD_PX);
  const y1 = Math.min(source.height - 1, component.y1 + ROCK_CROP_PAD_PX);
  const cropW = Math.max(1, x1 - x0 + 1);
  const cropH = Math.max(1, y1 - y0 + 1);

  const crop = document.createElement('canvas');
  crop.width = cropW;
  crop.height = cropH;
  const cropCtx = crop.getContext('2d', { willReadFrequently: true });
  if (!cropCtx) {
    return Texture.from(source);
  }
  cropCtx.drawImage(source, x0, y0, cropW, cropH, 0, 0, cropW, cropH);

  const imageData = cropCtx.getImageData(0, 0, cropW, cropH);
  finalizeRockCropAlpha(imageData.data, cropW, cropH);
  cropCtx.putImageData(imageData, 0, 0);

  const bounds = trimOpaqueBounds(imageData.data, cropW, cropH, ALPHA_OPAQUE);
  if (!bounds) {
    return Texture.from(crop);
  }

  const out = document.createElement('canvas');
  out.width = bounds.w;
  out.height = bounds.h;
  const outCtx = out.getContext('2d');
  if (!outCtx) {
    return Texture.from(crop);
  }
  outCtx.drawImage(crop, bounds.x, bounds.y, bounds.w, bounds.h, 0, 0, bounds.w, bounds.h);
  const tex = Texture.from(out);
  tex.source.style.addressModeU = 'clamp-to-edge';
  tex.source.style.addressModeV = 'clamp-to-edge';
  return tex;
}

function pickSeparatedSheetRocks(components: OpaqueComponent[]): OpaqueComponent[] {
  const candidates = components.filter((component) => {
    const w = component.x1 - component.x0 + 1;
    const h = component.y1 - component.y0 + 1;
    return component.size >= MIN_ROCK_COMPONENT_PX && w >= MIN_ROCK_BOUNDS_PX && h >= MIN_ROCK_BOUNDS_PX;
  });

  if (candidates.length < FLOATING_ROCK_COUNT) {
    throw new Error(
      `rocks 1.png: found ${candidates.length} rock islands, need ${FLOATING_ROCK_COUNT}`,
    );
  }

  const picked: OpaqueComponent[] = [candidates[0]!];
  for (let i = 1; i < candidates.length && picked.length < FLOATING_ROCK_COUNT; i += 1) {
    const candidate = candidates[i]!;
    const center = componentCenter(candidate);
    const farEnough = picked.every((existing) => {
      const existingCenter = componentCenter(existing);
      return (
        Math.hypot(center.x - existingCenter.x, center.y - existingCenter.y) >=
        MIN_SHEET_ROCK_SEPARATION_PX
      );
    });
    if (farEnough) {
      picked.push(candidate);
    }
  }

  if (picked.length < FLOATING_ROCK_COUNT) {
    return candidates.slice(0, FLOATING_ROCK_COUNT);
  }
  return picked;
}

async function extractSeparatedRockTextures(image: HTMLImageElement): Promise<Texture[]> {
  const width = image.naturalWidth;
  const height = image.naturalHeight;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    throw new Error('SpaceFloatingRocks: canvas unavailable');
  }
  ctx.drawImage(image, 0, 0);
  const imageData = ctx.getImageData(0, 0, width, height);
  prepareRockSheetAlpha(imageData.data, width, height);
  ctx.putImageData(imageData, 0, 0);

  const picked = pickSeparatedSheetRocks(findOpaqueComponents(imageData.data, width, height));
  return picked.map((component) => textureFromComponentBounds(canvas, component));
}

function randomPointInTriangle(tri: TriangleBounds, margin: number): Vec2 {
  for (let attempt = 0; attempt < 64; attempt += 1) {
    const r1 = Math.random();
    const r2 = Math.random();
    const sqrtR1 = Math.sqrt(r1);
    const x =
      (1 - sqrtR1) * tri.bl.x + sqrtR1 * (1 - r2) * tri.br.x + sqrtR1 * r2 * tri.tr.x;
    const y =
      (1 - sqrtR1) * tri.bl.y + sqrtR1 * (1 - r2) * tri.br.y + sqrtR1 * r2 * tri.tr.y;
    if (pointInTriangle({ x, y }, tri.bl, tri.br, tri.tr)) {
      return { x, y };
    }
  }
  return {
    x: (tri.bl.x + tri.br.x + tri.tr.x) / 3,
    y: (tri.bl.y + tri.br.y + tri.tr.y) / 3 - margin,
  };
}

function pickSeparatedTriangleSpawns(tri: TriangleBounds, radii: readonly number[]): Vec2[] {
  const spawns: Vec2[] = [];
  const midX = (tri.bl.x + tri.br.x + tri.tr.x) / 3;
  const midY = (tri.bl.y + tri.br.y + tri.tr.y) / 3;

  for (let i = 0; i < radii.length; i += 1) {
    const radius = radii[i] ?? 24;
    let placed = randomPointInTriangle(tri, radius);

    for (let attempt = 0; attempt < 80; attempt += 1) {
      const candidate = randomPointInTriangle(tri, radius);
      placed = candidate;
      const separated = spawns.every((existing, j) => {
        const otherRadius = radii[j] ?? 24;
        const minDist = (radius + otherRadius) * MIN_FLOAT_SEPARATION_RADIUS_MULT;
        return Math.hypot(candidate.x - existing.x, candidate.y - existing.y) >= minDist;
      });
      if (separated) {
        spawns.push(candidate);
        break;
      }
    }

    if (spawns.length <= i) {
      const angle = (i / Math.max(1, radii.length)) * Math.PI * 2 - Math.PI * 0.35;
      const spread = radius * 3.2;
      spawns.push({
        x: midX + Math.cos(angle) * spread,
        y: midY + Math.sin(angle) * spread * 0.45,
      });
    }
  }

  return spawns;
}

function resolveWallBounces(rock: FloatingRock, tri: TriangleBounds, hypotNormal: Vec2): void {
  const r = rock.radius;

  if (rock.y + r > tri.br.y) {
    rock.y = tri.br.y - r;
    const bounced = bounceVelocity(rock.vx, rock.vy, 0, -1);
    rock.vx = bounced.vx;
    rock.vy = bounced.vy;
  }

  if (rock.x + r > tri.br.x) {
    rock.x = tri.br.x - r;
    const bounced = bounceVelocity(rock.vx, rock.vy, -1, 0);
    rock.vx = bounced.vx;
    rock.vy = bounced.vy;
  }

  const relX = rock.x - tri.tr.x;
  const relY = rock.y - tri.tr.y;
  const pen = r - (relX * hypotNormal.x + relY * hypotNormal.y);
  if (pen > 0) {
    rock.x += hypotNormal.x * pen;
    rock.y += hypotNormal.y * pen;
    const bounced = bounceVelocity(rock.vx, rock.vy, hypotNormal.x, hypotNormal.y);
    rock.vx = bounced.vx;
    rock.vy = bounced.vy;
  }
}

function separateAllRocks(rocks: readonly FloatingRock[]): void {
  for (let i = 0; i < rocks.length; i += 1) {
    for (let j = i + 1; j < rocks.length; j += 1) {
      separateRocksPair(rocks[i]!, rocks[j]!);
    }
  }
}

function separateRocksPair(a: FloatingRock, b: FloatingRock): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.hypot(dx, dy);
  const minDist = a.radius + b.radius + 10;
  if (dist >= minDist || dist < 1e-4) {
    return;
  }

  const overlap = minDist - dist;
  const nx = dx / dist;
  const ny = dy / dist;
  a.x -= nx * overlap * 0.5;
  a.y -= ny * overlap * 0.5;
  b.x += nx * overlap * 0.5;
  b.y += ny * overlap * 0.5;

  const relVx = b.vx - a.vx;
  const relVy = b.vy - a.vy;
  const closing = relVx * nx + relVy * ny;
  if (closing < 0) {
    const impulse = closing * 0.5;
    a.vx += nx * impulse;
    a.vy += ny * impulse;
    b.vx -= nx * impulse;
    b.vy -= ny * impulse;
    applyConstantSpeed(a);
    applyConstantSpeed(b);
  }
}

/**
 * Three separated rocks from `rocks 1.png` — constant slow drift inside the marked triangle.
 */
export class SpaceFloatingRocks {
  readonly root = new Container();

  private rocks: FloatingRock[] = [];
  private textures: Texture[] = [];
  private tri: TriangleBounds | null = null;
  private lastViewport: LayerBackgroundLayout | null = null;
  private hypotNormal: Vec2 = { x: 0, y: 0 };
  private loaded = false;
  private spawnLayoutW = 0;
  private spawnLayoutH = 0;

  constructor() {
    this.root.eventMode = 'none';
  }

  get isReady(): boolean {
    return this.loaded && this.rocks.length === FLOATING_ROCK_COUNT;
  }

  async load(): Promise<boolean> {
    this.unload();
    try {
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.src = CANDY_ROCKS_1_URL;
      await image.decode();

      const texList = await extractSeparatedRockTextures(image);
      this.textures.push(...texList);

      for (const tex of texList) {
        const sprite = new Sprite(tex);
        sprite.eventMode = 'none';
        sprite.anchor.set(0.5, 0.5);
        this.root.addChild(sprite);
        const { vx, vy } = randomDirectionVelocity();
        this.rocks.push({
          sprite,
          x: 0,
          y: 0,
          vx,
          vy,
          radius: 24,
        });
      }

      this.loaded = true;
      if (this.lastViewport) {
        this.applySpawnLayout(this.lastViewport);
      }
      return true;
    } catch (error) {
      console.error('[SpaceFloatingRocks] Failed to load rocks 1:', error);
      this.unload();
      return false;
    }
  }

  layout(viewport: LayerBackgroundLayout): void {
    this.lastViewport = viewport;
    if (!this.loaded) {
      return;
    }

    this.tri = buildTriangle(viewport);
    this.hypotNormal = hypotenuseNormal(this.tri);

    const sizeChanged =
      Math.abs(viewport.viewportW - this.spawnLayoutW) > 1 ||
      Math.abs(viewport.fillH - this.spawnLayoutH) > 1;
    if (sizeChanged || this.rocks.every((rock) => rock.x === 0 && rock.y === 0)) {
      this.applySpawnLayout(viewport);
    }
  }

  update(dt: number): void {
    if (!this.loaded || !this.root.visible || dt <= 0) {
      return;
    }
    if (!this.tri && this.lastViewport) {
      this.tri = buildTriangle(this.lastViewport);
      this.hypotNormal = hypotenuseNormal(this.tri);
    }
    if (!this.tri || this.rocks.length !== FLOATING_ROCK_COUNT) {
      return;
    }

    const tri = this.tri;
    const hypotN = this.hypotNormal;
    const step = Math.min(dt, 1 / 20);

    for (const rock of this.rocks) {
      applyConstantSpeed(rock);
      rock.x += rock.vx * step;
      rock.y += rock.vy * step;
      resolveWallBounces(rock, tri, hypotN);
    }

    separateAllRocks(this.rocks);

    for (const rock of this.rocks) {
      resolveWallBounces(rock, tri, hypotN);
      if (!pointInTriangle({ x: rock.x, y: rock.y }, tri.bl, tri.br, tri.tr)) {
        const spawn = randomPointInTriangle(tri, rock.radius);
        rock.x = spawn.x;
        rock.y = spawn.y;
        const { vx, vy } = randomDirectionVelocity();
        rock.vx = vx;
        rock.vy = vy;
      }
      applyConstantSpeed(rock);
      rock.sprite.position.set(rock.x, rock.y);
    }
  }

  setVisible(visible: boolean): void {
    this.root.visible = visible;
  }

  destroy(): void {
    this.unload();
    this.root.destroy({ children: true });
  }

  private applySpawnLayout(viewport: LayerBackgroundLayout): void {
    this.tri = buildTriangle(viewport);
    this.hypotNormal = hypotenuseNormal(this.tri);
    this.spawnLayoutW = viewport.viewportW;
    this.spawnLayoutH = viewport.fillH;

    const displayW = viewport.viewportW * ROCK_WIDTH_VIEWPORT_RATIO;
    for (const rock of this.rocks) {
      const texW = Math.max(1, rock.sprite.texture.width);
      const scale = displayW / texW;
      rock.sprite.scale.set(scale);
      rock.radius = Math.max(rock.sprite.texture.width, rock.sprite.texture.height) * scale * 0.38;
    }

    const spawns = pickSeparatedTriangleSpawns(
      this.tri,
      this.rocks.map((rock) => rock.radius),
    );
    for (let i = 0; i < this.rocks.length; i += 1) {
      const rock = this.rocks[i]!;
      const spawn = spawns[i] ?? randomPointInTriangle(this.tri, rock.radius);
      rock.x = spawn.x;
      rock.y = spawn.y;
      const { vx, vy } = randomDirectionVelocity();
      rock.vx = vx;
      rock.vy = vy;
      rock.sprite.position.set(rock.x, rock.y);
    }
  }

  unload(): void {
    for (const rock of this.rocks) {
      this.root.removeChild(rock.sprite);
      rock.sprite.destroy({ texture: false });
    }
    this.rocks = [];
    for (const tex of this.textures) {
      tex.destroy(true);
    }
    this.textures = [];
    this.tri = null;
    this.loaded = false;
    this.spawnLayoutW = 0;
    this.spawnLayoutH = 0;
  }
}
