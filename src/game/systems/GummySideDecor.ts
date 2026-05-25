import { Assets, Container, FederatedPointerEvent, Graphics, Rectangle, Sprite, Texture } from 'pixi.js';

const GUMMY_SHEET_URL = `${import.meta.env.BASE_URL}assets/${encodeURIComponent('Player staff')}/gummy.png`;
const GUMMY_BEAR_COUNT = 3;

/** Keep 30% of prior density (70% fewer side bears). */
const GUMMY_SPAWN_DENSITY = 0.3;
const GAP_DENSITY_SCALE = 1 / GUMMY_SPAWN_DENSITY;
/** Min vertical gap between gummies on the same side (world px). */
const MIN_VERTICAL_GAP_PX = Math.round(220 * GAP_DENSITY_SCALE);
const MAX_VERTICAL_GAP_PX = Math.round(460 * GAP_DENSITY_SCALE);
/** How far above the camera top to pre-generate placements. */
const GENERATE_AHEAD_PX = 5200;
/** Viewport padding for visibility culling. */
const VIEW_CULL_PAD_PX = 280;
/** Target sprite width on the fascia strip (world px) — +30% vs original 72. */
const SIDE_DISPLAY_WIDTH_PX = Math.round(72 * 1.3);
const GUMMY_GLOW_COLORS = [0xff6688, 0x66ff99, 0x6688ff] as const;
const GUMMY_SIDE_JITTER_X_FRAC = 0.18;
/** Pull speed while tongue reels a bear toward the mouth (world px/s). */
export const GUMMY_PULL_SPEED_PX_PER_SEC = 520;
/** Mouth proximity — bear vanishes inside this radius (world px). */
export const GUMMY_COLLECT_RADIUS_PX = 50;
/** Screen/world pick radius — generous so taps work while moving. */
const GUMMY_PICK_RADIUS_PX = SIDE_DISPLAY_WIDTH_PX * 0.78;
const VIEW_CULL_PAD_PICK = VIEW_CULL_PAD_PX;

type Side = 'left' | 'right';

type GummyPlacement = {
  id: number;
  side: Side;
  bearIndex: number;
  worldY: number;
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
};

export type GummySideDecorSync = GummySideDecorPickLayout & {
  /** Scene run clock — drives idle glow pulse. */
  runTimeSec?: number;
  /** Pull-up skill unlocked — side bears become tappable. */
  interactive?: boolean;
  onBearTap?: (placementId: number, worldX: number, worldY: number) => void;
};

type GummyBearSlot = {
  wrap: Container;
  glow: Graphics;
  sprite: Sprite;
};

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
  /** Highest world Y (most skyward / smallest Y) that has placements. */
  private generatedTopY = Number.POSITIVE_INFINITY;
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
    this.generatedTopY = Number.POSITIVE_INFINITY;
    this.nextPlacementId = 1;
    this.tapHandler = null;
    for (const tex of this.bearTextures) {
      tex.destroy();
    }
    this.bearTextures = [];
    this.loaded = false;
  }

  /** Call at run start — seeds placements upward from the floor deck. */
  reset(floorTopY: number, seed = Date.now() & 0xffffffff): void {
    this.clearSprites();
    this.placements = [];
    this.nextPlacementId = 1;
    this.rng = mulberry32(seed ^ 0x9e3779b9);
    this.generatedTopY = floorTopY + 240;
    this.extendPlacementsUpTo(floorTopY - GENERATE_AHEAD_PX);
  }

  shiftWorldY(deltaY: number): void {
    if (deltaY === 0 || this.placements.length === 0) {
      return;
    }
    for (const p of this.placements) {
      p.worldY += deltaY;
      if (p.collecting) {
        p.collectY += deltaY;
      }
    }
    if (Number.isFinite(this.generatedTopY)) {
      this.generatedTopY += deltaY;
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

  /** Reel bear toward mouth; returns current tip position or `null` when collected. */
  pullToward(
    placementId: number,
    mouthX: number,
    mouthY: number,
    dt: number,
  ): { x: number; y: number } | null {
    const p = this.placements.find((pl) => pl.id === placementId);
    if (!p || p.collected || !p.collecting) {
      return null;
    }

    const dx = mouthX - p.collectX;
    const dy = mouthY - p.collectY;
    const dist = Math.hypot(dx, dy);
    if (dist <= GUMMY_COLLECT_RADIUS_PX) {
      p.collected = true;
      p.collecting = false;
      return null;
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
      if (placement.worldY > layout.cullBelowY) {
        continue;
      }
      if (placement.worldY < viewTop || placement.worldY > viewBottom) {
        continue;
      }

      const baseX =
        placement.side === 'left' ? layout.leftCenterX : layout.rightCenterX;
      const cx = baseX + placement.xJitter * jitterSpan;
      const cy = placement.worldY;
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
    this.extendPlacementsUpTo(viewTop - GENERATE_AHEAD_PX);

    const viewBottom = layout.cameraY + layout.viewportH + VIEW_CULL_PAD_PX;
    const runTimeSec = layout.runTimeSec ?? 0;
    let slotIdx = 0;

    for (const placement of this.placements) {
      if (placement.collected) {
        continue;
      }
      if (placement.worldY > layout.cullBelowY && !placement.collecting) {
        continue;
      }
      if (!placement.collecting && (placement.worldY < viewTop || placement.worldY > viewBottom)) {
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
      const idleY = placement.worldY;
      const cx = placement.collecting ? placement.collectX : idleX;
      const cy = placement.collecting ? placement.collectY : idleY;

      slot.wrap.position.set(cx, cy);
      slot.wrap.visible = true;
      const breathe =
        1 +
        0.045 *
          Math.sin(runTimeSec * 2.5 + placement.id * 0.37 + placement.bearIndex * 0.9);
      slot.wrap.scale.set(breathe);
      slot.sprite.scale.set(
        placement.displayScale * (placement.flipX ? -1 : 1),
        placement.displayScale,
      );

      const phase = runTimeSec * 9.5 + placement.id * 0.83 + placement.bearIndex * 1.7;
      const blink = 0.5 + 0.5 * Math.sin(phase);
      /** Sharpen peaks so the halo visibly flashes on/off. */
      const flash = blink * blink;
      const displayW = SIDE_DISPLAY_WIDTH_PX * placement.displayScale;
      const glowR = displayW * (0.46 + 0.32 * flash);
      const glowColor = GUMMY_GLOW_COLORS[placement.bearIndex % GUMMY_GLOW_COLORS.length];
      slot.glow.clear();
      slot.glow
        .circle(0, 0, glowR * 1.42)
        .fill({ color: glowColor, alpha: 0.1 + 0.28 * flash });
      slot.glow
        .circle(0, 0, glowR)
        .fill({ color: glowColor, alpha: 0.24 + 0.56 * flash });
      slot.glow
        .circle(0, 0, glowR * 0.48)
        .fill({ color: 0xffffff, alpha: 0.14 + 0.42 * flash });
      slot.sprite.alpha = 0.72 + 0.28 * flash;

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
      const glow = new Graphics();
      glow.blendMode = 'add';
      const sprite = new Sprite(tex);
      sprite.anchor.set(0.5, 0.5);
      wrap.addChild(glow, sprite);
      this.root.addChild(wrap);
      this.wireSlotTap(wrap, sprite);
      slot = { wrap, glow, sprite };
      this.slots[index] = slot;
    } else if (slot.sprite.texture !== tex) {
      slot.sprite.texture = tex;
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
      slot.wrap.destroy({ children: true });
    }
    this.slots = [];
    this.root.removeChildren();
  }

  private extendPlacementsUpTo(targetTopY: number): void {
    if (!this.isReady) {
      return;
    }
    if (targetTopY >= this.generatedTopY) {
      return;
    }

    for (const side of ['left', 'right'] as const) {
      const sidePlacements = this.placements.filter((p) => p.side === side && !p.collected);
      let lastY =
        sidePlacements.length > 0
          ? Math.min(...sidePlacements.map((p) => p.worldY))
          : this.generatedTopY;
      let y = lastY;

      while (y > targetTopY) {
        const gap =
          MIN_VERTICAL_GAP_PX +
          this.rng() * (MAX_VERTICAL_GAP_PX - MIN_VERTICAL_GAP_PX);
        y -= gap;
        if (y <= targetTopY) {
          break;
        }
        if (Math.abs(y - lastY) < MIN_VERTICAL_GAP_PX * 0.85) {
          continue;
        }
        lastY = y;
        const bearIndex = this.placementBearIndex(side, y);
        const tex = this.bearTextures[bearIndex];
        if (!tex) {
          continue;
        }
        const displayScale = SIDE_DISPLAY_WIDTH_PX / Math.max(1, tex.width);
        const id = this.nextPlacementId;
        this.nextPlacementId += 1;
        this.placements.push({
          id,
          side,
          bearIndex,
          worldY: y,
          displayScale,
          flipX: side === 'right' && this.rng() < 0.42,
          xJitter: (this.rng() - 0.5) * 2,
          collected: false,
          collecting: false,
          collectX: 0,
          collectY: 0,
        });
      }
    }

    this.generatedTopY = targetTopY;
  }

  /** Stable bear pick per side/Y — avoids clumping the same color. */
  private placementBearIndex(side: Side, worldY: number): number {
    const bucket = Math.floor(worldY / 97);
    const mix = side === 'left' ? 1 : 2;
    return Math.abs((bucket * 17 + mix * 31) % GUMMY_BEAR_COUNT);
  }
}
