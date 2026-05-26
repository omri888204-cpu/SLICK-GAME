import { Assets, Container, FederatedPointerEvent, Rectangle, Sprite, Texture } from 'pixi.js';
import { GlowFilter } from 'pixi-filters';
import { tunedBloom } from '../../config/game.config';

const GUMMY_SHEET_URL = `${import.meta.env.BASE_URL}assets/${encodeURIComponent('Player staff')}/gummy.png`;
const GUMMY_BEAR_COUNT = 3;

/** One left + one right per altitude band. */
const GUMMY_BAND_METERS = 5000;
const GUMMY_BEARS_PER_BAND = 2;
/** HUD climb meters ↔ world Y (matches PlayScene). */
const GUMMY_METERS_PER_PX = 12;
/** Slow vertical drift along the fascia (world px). */
const GUMMY_BAND_DRIFT_SPEED = 0.38;
const GUMMY_BAND_DRIFT_AMPLITUDE_PX = 52;
const GUMMY_BAND_METER_PAD = 240;
/** Viewport padding for visibility culling. */
const VIEW_CULL_PAD_PX = 280;
/** Target sprite width on the fascia strip (world px) — +30% vs original 72. */
const SIDE_DISPLAY_WIDTH_PX = Math.round(72 * 1.3);
const GUMMY_SIDE_JITTER_X_FRAC = 0.18;
/** Pull speed while tongue reels a bear toward the mouth (world px/s). */
export const GUMMY_PULL_SPEED_PX_PER_SEC = 1040;
/** Mouth proximity — bear vanishes inside this radius (world px). */
export const GUMMY_COLLECT_RADIUS_PX = 50;
/** Screen/world pick radius — generous so taps work while moving. */
const GUMMY_PICK_RADIUS_PX = SIDE_DISPLAY_WIDTH_PX * 0.78;
const VIEW_CULL_PAD_PICK = VIEW_CULL_PAD_PX;

type Side = 'left' | 'right';

type GummyPlacement = {
  id: number;
  /** Stable slot within a 5000 m band (left = 0, right = 1). */
  bandKey: number;
  side: Side;
  bearIndex: number;
  baseWorldY: number;
  driftPhase: number;
  displayScale: number;
  flipX: boolean;
  xJitter: number;
  collected: boolean;
  collecting: boolean;
  collectX: number;
  collectY: number;
};

export type GummyPickResult = {
  id: number;
  worldX: number;
  worldY: number;
};

export type GummySideDecorPickLayout = {
  leftCenterX: number;
  rightCenterX: number;
  cameraY: number;
  viewportH: number;
  cullBelowY: number;
  /** Floor-0 feet baseline — maps HUD meters to world Y. */
  climbBaselineY: number;
};

export type GummySideDecorSync = GummySideDecorPickLayout & {
  /** Scene run clock — drives glow pulse from the bear silhouette. */
  runTimeSec?: number;
  /** Side bears tappable when true. */
  interactive?: boolean;
  onBearTap?: (placementId: number, worldX: number, worldY: number) => void;
};

type GummyBearSlot = {
  wrap: Container;
  bloom: Sprite;
  bodyLayer: Container;
  sprite: Sprite;
  glowFilter: GlowFilter;
};

function createBearGlowFilter(): GlowFilter {
  return new GlowFilter({
    distance: tunedBloom(14),
    outerStrength: tunedBloom(3.4),
    innerStrength: tunedBloom(1.05),
    color: 0xffcc44,
    alpha: tunedBloom(0.78),
    quality: tunedBloom(0.24),
  });
}

function applyGummyGlowPulse(filter: GlowFilter, bloom: Sprite, pulse: number, flipX: boolean, baseScale: number): void {
  const bloomScale = baseScale * (1.08 + 0.05 * pulse);
  bloom.scale.set(bloomScale * (flipX ? -1 : 1), bloomScale);
  bloom.alpha = 0.26 + 0.2 * pulse;

  filter.outerStrength = tunedBloom(2.6 + 1.8 * pulse);
  filter.innerStrength = tunedBloom(0.85 + 0.45 * pulse);
  filter.alpha = tunedBloom(0.62 + 0.34 * pulse);
  filter.color = pulse > 0.55 ? 0xffe878 : 0xffc840;
}

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function keySheetBlackBackground(pixels: Uint8ClampedArray, width: number, height: number): void {
  const visited = new Uint8Array(width * height);
  const queue: number[] = [];

  const isBg = (idx: number): boolean => {
    const r = pixels[idx];
    const g = pixels[idx + 1];
    const b = pixels[idx + 2];
    return r <= 24 && g <= 24 && b <= 24;
  };

  const enqueue = (x: number, y: number): void => {
    if (x < 0 || y < 0 || x >= width || y >= height) {
      return;
    }
    const i = (y * width + x) * 4;
    const pi = y * width + x;
    if (visited[pi] || !isBg(i)) {
      return;
    }
    visited[pi] = 1;
    queue.push(pi);
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
    const pi = queue.pop()!;
    const i = pi * 4;
    pixels[i + 3] = 0;
    const x = pi % width;
    const y = (pi / width) | 0;
    enqueue(x - 1, y);
    enqueue(x + 1, y);
    enqueue(x, y - 1);
    enqueue(x, y + 1);
  }
}

/** Lift contrast/saturation so bears read clearly on pastel fascia art. */
function sharpenGummyPixels(pixels: Uint8ClampedArray): void {
  for (let i = 0; i < pixels.length; i += 4) {
    const a = pixels[i + 3];
    if (a < 12) {
      continue;
    }
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    const lum = (r + g + b) / 3;
    const sat = 1.14;
    pixels[i] = Math.min(255, Math.round(lum + (r - lum) * sat + 10));
    pixels[i + 1] = Math.min(255, Math.round(lum + (g - lum) * sat + 10));
    pixels[i + 2] = Math.min(255, Math.round(lum + (b - lum) * sat + 8));
    pixels[i + 3] = Math.min(255, a + 8);
  }
}

async function loadKeyedGummySheet(): Promise<Texture | null> {
  try {
    await Assets.load(GUMMY_SHEET_URL);
    const image = new Image();
    image.src = GUMMY_SHEET_URL;
    await image.decode();

    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      return (await Assets.load<Texture>(GUMMY_SHEET_URL)) as Texture;
    }

    ctx.drawImage(image, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    keySheetBlackBackground(imageData.data, canvas.width, canvas.height);
    sharpenGummyPixels(imageData.data);
    ctx.putImageData(imageData, 0, 0);
    return Texture.from(canvas);
  } catch {
    return null;
  }
}

function sliceBearTextures(sheet: Texture): Texture[] {
  const cols = GUMMY_BEAR_COUNT;
  const fw = Math.floor(sheet.width / cols);
  const fh = sheet.height;
  const out: Texture[] = [];
  for (let i = 0; i < cols; i += 1) {
    out.push(
      new Texture({
        source: sheet.source,
        frame: new Rectangle(i * fw, 0, fw, fh),
      }),
    );
  }
  return out;
}

/** Side fascia gummy bears — each color from `gummy.png` placed separately with spaced random Y. */
export class GummySideDecor {
  readonly root = new Container();

  private bearTextures: Texture[] = [];
  private placements: GummyPlacement[] = [];
  private slots: GummyBearSlot[] = [];
  private slotPlacementId: WeakMap<Sprite, number> = new WeakMap();
  private loaded = false;
  private rng = mulberry32(0x67aa15);
  private nextPlacementId = 1;
  private lastRunTimeSec = 0;
  private tapHandler: ((id: number, x: number, y: number) => void) | null = null;

  constructor() {
    this.root.eventMode = 'passive';
    this.root.sortableChildren = false;
  }

  get isReady(): boolean {
    return this.loaded && this.bearTextures.length > 0;
  }

  async load(): Promise<boolean> {
    this.unload();
    const sheet = await loadKeyedGummySheet();
    if (!sheet) {
      return false;
    }
    this.bearTextures = sliceBearTextures(sheet);
    this.loaded = true;
    return true;
  }

  unload(): void {
    this.clearSprites();
    this.placements = [];
    this.nextPlacementId = 1;
    this.lastRunTimeSec = 0;
    this.tapHandler = null;
    for (const tex of this.bearTextures) {
      tex.destroy();
    }
    this.bearTextures = [];
    this.loaded = false;
  }

  /** Call at run start — band placements are created lazily in {@link sync}. */
  reset(_floorTopY: number, seed = Date.now() & 0xffffffff): void {
    this.clearSprites();
    this.placements = [];
    this.nextPlacementId = 1;
    this.lastRunTimeSec = 0;
    this.rng = mulberry32(seed ^ 0x9e3779b9);
  }

  shiftWorldY(deltaY: number): void {
    if (deltaY === 0 || this.placements.length === 0) {
      return;
    }
    for (const p of this.placements) {
      p.baseWorldY += deltaY;
      if (p.collecting) {
        p.collectY += deltaY;
      }
    }
  }

  /** Start tongue pull — returns false if already collected / missing. */
  markCollecting(placementId: number, worldX: number, worldY: number): boolean {
    const p = this.placements.find((pl) => pl.id === placementId);
    if (!p || p.collected || p.collecting) {
      return false;
    }
    p.collecting = true;
    p.collectX = worldX;
    p.collectY = worldY;
    return true;
  }

  /** Reel bear toward mouth; `'collected'` when eaten, `'lost'` if placement invalid. */
  pullToward(
    placementId: number,
    mouthX: number,
    mouthY: number,
    dt: number,
  ): { x: number; y: number } | 'collected' | 'lost' {
    const p = this.placements.find((pl) => pl.id === placementId);
    if (!p || p.collected || !p.collecting) {
      return 'lost';
    }

    const dx = mouthX - p.collectX;
    const dy = mouthY - p.collectY;
    const dist = Math.hypot(dx, dy);
    if (dist <= GUMMY_COLLECT_RADIUS_PX) {
      p.collected = true;
      p.collecting = false;
      return 'collected';
    }

    const step = Math.min(dist, GUMMY_PULL_SPEED_PX_PER_SEC * dt);
    p.collectX += (dx / dist) * step;
    p.collectY += (dy / dist) * step;
    return { x: p.collectX, y: p.collectY };
  }

  getPlacementWorldPos(placementId: number): { x: number; y: number } | null {
    const p = this.placements.find((pl) => pl.id === placementId);
    if (!p || p.collected) {
      return null;
    }
    if (p.collecting) {
      return { x: p.collectX, y: p.collectY };
    }
    return null;
  }

  /** Bear column index (0 = Red Berry … 2 = Blue Burst) for a placement id. */
  getBearIndexForPlacement(placementId: number): number | null {
    const p = this.placements.find((pl) => pl.id === placementId);
    return p ? p.bearIndex : null;
  }

  /** Nearest visible side bear under a world-space point (works while the avatar moves). */
  pickAtWorld(
    worldX: number,
    worldY: number,
    layout: GummySideDecorPickLayout,
  ): GummyPickResult | null {
    const viewTop = layout.cameraY - VIEW_CULL_PAD_PICK;
    const viewBottom = layout.cameraY + layout.viewportH + VIEW_CULL_PAD_PICK;
    const slabSpan = Math.abs(layout.rightCenterX - layout.leftCenterX);
    const jitterSpan = Math.max(12, slabSpan * GUMMY_SIDE_JITTER_X_FRAC);

    let best: (GummyPickResult & { dist: number }) | null = null;

    for (const placement of this.placements) {
      if (placement.collected || placement.collecting) {
        continue;
      }
      const cy = this.getIdleWorldY(placement, this.lastRunTimeSec);
      if (cy > layout.cullBelowY) {
        continue;
      }
      if (cy < viewTop || cy > viewBottom) {
        continue;
      }

      const baseX =
        placement.side === 'left' ? layout.leftCenterX : layout.rightCenterX;
      const cx = baseX + placement.xJitter * jitterSpan;
      const dist = Math.hypot(worldX - cx, worldY - cy);
      if (dist > GUMMY_PICK_RADIUS_PX) {
        continue;
      }
      if (!best || dist < best.dist) {
        best = { id: placement.id, worldX: cx, worldY: cy, dist };
      }
    }

    if (!best) {
      return null;
    }
    return { id: best.id, worldX: best.worldX, worldY: best.worldY };
  }

  sync(layout: GummySideDecorSync): void {
    if (!this.isReady) {
      return;
    }

    this.tapHandler = layout.interactive && layout.onBearTap ? layout.onBearTap : null;
    const interactive = this.tapHandler != null;

    const viewTop = layout.cameraY - VIEW_CULL_PAD_PX;
    const viewBottom = layout.cameraY + layout.viewportH + VIEW_CULL_PAD_PX;
    const runTimeSec = layout.runTimeSec ?? 0;
    this.lastRunTimeSec = runTimeSec;

    this.ensureBandPlacements(layout.climbBaselineY, viewTop, viewBottom);
    this.pruneFarPlacements(layout.cullBelowY);

    let slotIdx = 0;

    for (const placement of this.placements) {
      if (placement.collected) {
        continue;
      }
      const idleY = this.getIdleWorldY(placement, runTimeSec);
      if (idleY > layout.cullBelowY && !placement.collecting) {
        continue;
      }
      if (!placement.collecting && (idleY < viewTop || idleY > viewBottom)) {
        continue;
      }

      const tex = this.bearTextures[placement.bearIndex];
      if (!tex) {
        continue;
      }

      const slot = this.ensureSlot(slotIdx, tex);
      this.slotPlacementId.set(slot.sprite, placement.id);

      const baseX =
        placement.side === 'left' ? layout.leftCenterX : layout.rightCenterX;
      const slabSpan = Math.abs(layout.rightCenterX - layout.leftCenterX);
      const jitterSpan = Math.max(12, slabSpan * GUMMY_SIDE_JITTER_X_FRAC);
      const idleX = baseX + placement.xJitter * jitterSpan;
      const cx = placement.collecting ? placement.collectX : idleX;
      const cy = placement.collecting ? placement.collectY : idleY;

      slot.wrap.position.set(cx, cy);
      slot.wrap.visible = true;

      const breathe =
        1 +
        0.035 *
          Math.sin(runTimeSec * 1.35 + placement.id * 0.37 + placement.bearIndex * 0.9);
      slot.wrap.scale.set(breathe);

      const baseScale = placement.displayScale;
      const flipMul = placement.flipX ? -1 : 1;
      slot.sprite.scale.set(baseScale * flipMul, baseScale);
      slot.sprite.alpha = 1;
      slot.sprite.tint = 0xffffff;

      const pulse = 0.5 + 0.5 * Math.sin(runTimeSec * 2.1 + placement.id * 0.71 + placement.bearIndex);
      applyGummyGlowPulse(slot.glowFilter, slot.bloom, pulse, placement.flipX, baseScale);

      const canTap = interactive && !placement.collecting;
      slot.wrap.eventMode = canTap ? 'static' : 'none';
      slot.wrap.cursor = canTap ? 'pointer' : 'default';
      const hitR = SIDE_DISPLAY_WIDTH_PX * 0.55;
      slot.wrap.hitArea = new Rectangle(-hitR, -hitR, hitR * 2, hitR * 2);
      slotIdx += 1;
    }

    for (let i = slotIdx; i < this.slots.length; i += 1) {
      this.slots[i].wrap.visible = false;
      this.slots[i].wrap.eventMode = 'none';
    }
  }

  destroy(): void {
    this.unload();
    this.root.destroy({ children: true });
  }

  private ensureSlot(index: number, tex: Texture): GummyBearSlot {
    let slot = this.slots[index];
    if (!slot) {
      const wrap = new Container();

      const bloom = new Sprite(tex);
      bloom.anchor.set(0.5, 0.5);
      bloom.tint = 0xffe070;
      bloom.alpha = 0.34;
      bloom.blendMode = 'add';
      bloom.eventMode = 'none';

      const glowFilter = createBearGlowFilter();
      const bodyLayer = new Container();
      bodyLayer.filters = [glowFilter];
      bodyLayer.eventMode = 'none';

      const sprite = new Sprite(tex);
      sprite.anchor.set(0.5, 0.5);
      bodyLayer.addChild(sprite);

      wrap.addChild(bloom, bodyLayer);
      this.root.addChild(wrap);
      this.wireSlotTap(wrap, sprite);
      slot = { wrap, bloom, bodyLayer, sprite, glowFilter };
      this.slots[index] = slot;
    } else if (slot.sprite.texture !== tex) {
      slot.sprite.texture = tex;
      slot.bloom.texture = tex;
    }
    return slot;
  }

  private wireSlotTap(wrap: Container, sprite: Sprite): void {
    wrap.on('pointerdown', (event: FederatedPointerEvent) => {
      if (this.tapHandler) {
        event.stopPropagation();
      }
    });
    wrap.on('pointertap', (event: FederatedPointerEvent) => {
      event.stopPropagation();
      const id = this.slotPlacementId.get(sprite);
      if (id === undefined || !this.tapHandler) {
        return;
      }
      const p = this.placements.find((pl) => pl.id === id);
      if (!p || p.collected || p.collecting) {
        return;
      }
      this.tapHandler(id, wrap.x, wrap.y);
    });
  }

  private clearSprites(): void {
    for (const slot of this.slots) {
      slot.glowFilter.destroy();
      slot.wrap.destroy({ children: true });
    }
    this.slots = [];
    this.root.removeChildren();
  }

  private getIdleWorldY(placement: GummyPlacement, runTimeSec: number): number {
    const drift =
      Math.sin(runTimeSec * GUMMY_BAND_DRIFT_SPEED + placement.driftPhase) *
      GUMMY_BAND_DRIFT_AMPLITUDE_PX;
    return placement.baseWorldY + drift;
  }

  private metersToWorldY(climbBaselineY: number, meters: number): number {
    return climbBaselineY - meters * GUMMY_METERS_PER_PX;
  }

  private worldYToMeters(climbBaselineY: number, worldY: number): number {
    return (climbBaselineY - worldY) / GUMMY_METERS_PER_PX;
  }

  /** Lazily spawn one left + one right bear per visible 5000 m band. */
  private ensureBandPlacements(climbBaselineY: number, viewTop: number, viewBottom: number): void {
    const metersAtTop = this.worldYToMeters(climbBaselineY, viewTop);
    const metersAtBottom = this.worldYToMeters(climbBaselineY, viewBottom);
    const minM = Math.max(0, Math.min(metersAtTop, metersAtBottom) - GUMMY_BAND_METER_PAD);
    const maxM = Math.max(metersAtTop, metersAtBottom) + GUMMY_BAND_METER_PAD;
    const firstBand = Math.floor(minM / GUMMY_BAND_METERS);
    const lastBand = Math.floor(maxM / GUMMY_BAND_METERS);

    for (let band = firstBand; band <= lastBand; band += 1) {
      for (let slot = 0; slot < GUMMY_BEARS_PER_BAND; slot += 1) {
        this.ensureBandSlot(band, slot, climbBaselineY);
      }
    }
  }

  private ensureBandSlot(bandIndex: number, slotIndex: number, climbBaselineY: number): void {
    const bandKey = bandIndex * GUMMY_BEARS_PER_BAND + slotIndex;
    if (this.placements.some((p) => p.bandKey === bandKey)) {
      return;
    }

    const side: Side = slotIndex === 0 ? 'left' : 'right';
    const bandSeed = bandIndex * 9973 + slotIndex * 131;
    const frac = this.seededUnit(bandSeed);
    const meterSpan = GUMMY_BAND_METERS - GUMMY_BAND_METER_PAD * 2;
    const meters = bandIndex * GUMMY_BAND_METERS + GUMMY_BAND_METER_PAD + frac * meterSpan;
    const bearIndex = this.placementBearIndex(side, bandIndex * GUMMY_BAND_METERS + slotIndex * 1100);
    const tex = this.bearTextures[bearIndex];
    if (!tex) {
      return;
    }

    const displayScale = SIDE_DISPLAY_WIDTH_PX / Math.max(1, tex.width);
    const id = this.nextPlacementId;
    this.nextPlacementId += 1;
    this.placements.push({
      id,
      bandKey,
      side,
      bearIndex,
      baseWorldY: this.metersToWorldY(climbBaselineY, meters),
      driftPhase: this.seededUnit(bandSeed + 17) * Math.PI * 2,
      displayScale,
      flipX: side === 'right' && this.seededUnit(bandSeed + 29) < 0.42,
      xJitter: (this.seededUnit(bandSeed + 41) - 0.5) * 2,
      collected: false,
      collecting: false,
      collectX: 0,
      collectY: 0,
    });
  }

  private seededUnit(seed: number): number {
    return mulberry32(seed ^ 0x5bd1e995)();
  }

  /** Drop collected slots far below the camera; keep active band pairs. */
  private pruneFarPlacements(cullBelowY: number): void {
    const keepPad = 3200;
    this.placements = this.placements.filter(
      (p) => !p.collected || p.baseWorldY <= cullBelowY + keepPad,
    );
  }

  /** Stable bear pick per side/band — avoids clumping the same color. */
  private placementBearIndex(side: Side, meterAnchor: number): number {
    const bucket = Math.floor(meterAnchor / 97);
    const mix = side === 'left' ? 1 : 2;
    return Math.abs((bucket * 17 + mix * 31) % GUMMY_BEAR_COUNT);
  }
}
