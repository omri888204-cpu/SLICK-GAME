import { Assets, Rectangle, Texture, type Graphics, type Sprite } from 'pixi.js';

/** Intrinsic size of `new menu space.png`. */
export const MENU_CANDY_LOOP_TEX_W = 1023;
export const MENU_CANDY_LOOP_TEX_H = 1537;

/** Bust browser/Pixi cache when the menu PNG is replaced. */
const MENU_ASSET_REVISION = '20260527-new-menu-space-v4';

/**
 * Painted PLAY control bounds in texture space (`new menu space.png`).
 * Normalized 0–1 relative to {@link MENU_CANDY_LOOP_TEX_W} × {@link MENU_CANDY_LOOP_TEX_H}.
 */
export const MENU_PLAY_BUTTON_RECT_NORM = {
  x: 295 / MENU_CANDY_LOOP_TEX_W,
  y: 1205 / MENU_CANDY_LOOP_TEX_H,
  w: 435 / MENU_CANDY_LOOP_TEX_W,
  h: 98 / MENU_CANDY_LOOP_TEX_H,
} as const;

/** Portal stairs — lowered so the avatar does not cover the portal. */
export const MENU_PLAYER_DECK_Y_TEX = 1130;
/** Horizontal feet anchor (portal stairs center). */
export const MENU_PLAYER_FEET_X_TEX = 475;
/** Soles sink into the painted deck (screen px). */
export const MENU_PLAYER_FEET_SINK_PX = 12;

/** Center of top-left currency pill text on `new menu space.png`. */
export const MENU_LOOT_GOLD_TEXT_NORM = { x: 0.215, y: 0.062 } as const;
export const MENU_LOOT_DIAMOND_TEXT_NORM = { x: 0.215, y: 0.114 } as const;

/** Extra tap slop around the painted PLAY control (texture pixels). */
export const MENU_PLAY_HIT_PAD_TEX_PX = {
  x: 48,
  y: 44,
} as const;

/** Portal vortex center on `new menu space.png` (procedural ambience overlay). */
export const MENU_PORTAL_AMBIENCE_CENTER_X_NORM = 512 / MENU_CANDY_LOOP_TEX_W;
export const MENU_PORTAL_AMBIENCE_CENTER_Y_NORM = 888 / MENU_CANDY_LOOP_TEX_H;
export const MENU_PORTAL_AMBIENCE_WIDTH_NORM = 230 / MENU_CANDY_LOOP_TEX_W;
export const MENU_PORTAL_AMBIENCE_HEIGHT_NORM = 260 / MENU_CANDY_LOOP_TEX_H;

export type MenuCoverLayout = {
  scale: number;
  displayW: number;
  displayH: number;
  left: number;
  top: number;
};

const GAME_ASSETS = `${import.meta.env.BASE_URL}assets`;
const BG_TESET_DIR = `${GAME_ASSETS}/${encodeURIComponent('backgroud teset')}`;

/** Pixi asset alias — `public/assets/backgroud teset/menu back space.png`. */
export const MENU_BACK_ASSET_KEY = 'menuBack';

export const MENU_BACK_URL = `${BG_TESET_DIR}/${encodeURIComponent('menu back space.png')}?v=${MENU_ASSET_REVISION}`;

/** Pixi asset alias — `public/assets/backgroud teset/new menu space.png`. */
export const MENU_CANDY_LOOP_ASSET_KEY = 'menuCandyLoop';

export const MENU_CANDY_LOOP_URL = `${BG_TESET_DIR}/${encodeURIComponent('new menu space.png')}?v=${MENU_ASSET_REVISION}`;

/** Letterbox fill behind the menu cover sprite (space void). */
export const MENU_BACKDROP_COLOR = 0x090612;

/** Dreamy drift — slow position loop. */
const MENU_BACK_DRIFT_PERIOD_SEC = 9;
/** Soft scale breathe — slow pulse loop. */
const MENU_BACK_PULSE_PERIOD_SEC = 11;
/** Keep drift tiny so the art stays anchored. */
const MENU_BACK_DRIFT_X_PX = 3;
const MENU_BACK_DRIFT_Y_PX = 5;
/** 1.00 → ~1.008 subtle breathe (never shrinks below bleed). */
const MENU_BACK_SCALE_PULSE = 0.008;
/** Overscan above cover scale — prevents edge gaps while drifting. */
const MENU_BACK_COVER_BLEED = 1.045;

let menuAssetsRegisteredRevision: string | null = null;

export function registerMenuAssets(): void {
  if (menuAssetsRegisteredRevision === MENU_ASSET_REVISION) {
    return;
  }
  if (menuAssetsRegisteredRevision != null) {
    void Assets.unload(MENU_BACK_ASSET_KEY).catch(() => {});
    void Assets.unload(MENU_CANDY_LOOP_ASSET_KEY).catch(() => {});
  }
  Assets.add({ alias: MENU_BACK_ASSET_KEY, src: MENU_BACK_URL });
  Assets.add({ alias: MENU_CANDY_LOOP_ASSET_KEY, src: MENU_CANDY_LOOP_URL });
  menuAssetsRegisteredRevision = MENU_ASSET_REVISION;
}

/** @deprecated Use {@link registerMenuAssets}. */
export function registerMenuCandyLoopAsset(): void {
  registerMenuAssets();
}

export function computeMenuCoverLayout(
  viewportW: number,
  viewportH: number,
  texW: number,
  texH: number,
): MenuCoverLayout {
  const safeW = Math.max(1, texW);
  const safeH = Math.max(1, texH);
  const scale = Math.max(viewportW / safeW, viewportH / safeH);
  const displayW = safeW * scale;
  const displayH = safeH * scale;
  return {
    scale,
    displayW,
    displayH,
    left: viewportW * 0.5 - displayW * 0.5,
    top: viewportH * 0.5 - displayH * 0.5,
  };
}

/** Screen-space rect for the painted PLAY control under cover scaling (with tap slop). */
export function computeMenuPlayButtonScreenRect(
  layout: MenuCoverLayout,
  texW: number,
  texH: number,
  viewportW?: number,
  viewportH?: number,
): Rectangle {
  const r = MENU_PLAY_BUTTON_RECT_NORM;
  const padX = MENU_PLAY_HIT_PAD_TEX_PX.x * layout.scale;
  const padY = MENU_PLAY_HIT_PAD_TEX_PX.y * layout.scale;
  let x = layout.left + r.x * texW * layout.scale - padX;
  let y = layout.top + r.y * texH * layout.scale - padY;
  let w = r.w * texW * layout.scale + padX * 2;
  let h = r.h * texH * layout.scale + padY * 2;

  if (viewportW != null && viewportH != null) {
    x = Math.max(0, x);
    y = Math.max(0, y);
    w = Math.min(viewportW - x, w);
    h = Math.min(viewportH - y, h);
  }

  return new Rectangle(x, y, w, h);
}

/** Painted PLAY bounds without tap slop — used to anchor the menu avatar. */
export function computeMenuPlayButtonPaintedRect(
  layout: MenuCoverLayout,
  texW: number,
  texH: number,
): Rectangle {
  const r = MENU_PLAY_BUTTON_RECT_NORM;
  return new Rectangle(
    layout.left + r.x * texW * layout.scale,
    layout.top + r.y * texH * layout.scale,
    r.w * texW * layout.scale,
    r.h * texH * layout.scale,
  );
}

/** Cropped PLAY art from the menu foreground sheet. */
export function createMenuPlayButtonTexture(
  menuTexture: Texture,
  texW: number,
  texH: number,
): Texture {
  const r = MENU_PLAY_BUTTON_RECT_NORM;
  return new Texture({
    source: menuTexture.source,
    frame: new Rectangle(r.x * texW, r.y * texH, r.w * texW, r.h * texH),
  });
}

/** Positions the PLAY sprite on its painted bounds — returns screen rect for hit zones. */
export function layoutMenuPlayButton(
  playButton: Sprite,
  layout: MenuCoverLayout,
  texW: number,
  texH: number,
): Rectangle {
  const painted = computeMenuPlayButtonPaintedRect(layout, texW, texH);
  playButton.anchor.set(0.5, 0.5);
  playButton.position.set(painted.x + painted.width * 0.5, painted.y + painted.height * 0.5);
  playButton.width = painted.width;
  playButton.height = painted.height;
  return painted;
}

export function computeMenuPortalAmbienceBounds(
  layout: MenuCoverLayout,
  texW: number,
  texH: number,
): { cx: number; cy: number; w: number; h: number } {
  return {
    cx: layout.left + MENU_PORTAL_AMBIENCE_CENTER_X_NORM * texW * layout.scale,
    cy: layout.top + MENU_PORTAL_AMBIENCE_CENTER_Y_NORM * texH * layout.scale,
    w: MENU_PORTAL_AMBIENCE_WIDTH_NORM * texW * layout.scale,
    h: MENU_PORTAL_AMBIENCE_HEIGHT_NORM * texH * layout.scale,
  };
}

/** Fixed menu avatar feet — does not move when PLAY glow/hit rects are tuned. */
export function computeMenuPlayerFeetPoint(
  layout: MenuCoverLayout,
  texW: number,
  texH: number,
): { x: number; y: number } {
  return {
    x: layout.left + (MENU_PLAYER_FEET_X_TEX / MENU_CANDY_LOOP_TEX_W) * texW * layout.scale,
    y:
      layout.top +
      (MENU_PLAYER_DECK_Y_TEX / MENU_CANDY_LOOP_TEX_H) * texH * layout.scale +
      MENU_PLAYER_FEET_SINK_PX,
  };
}

/** Map normalized menu-art coordinates to screen space under cover scaling. */
export function menuArtPointToScreen(
  layout: MenuCoverLayout,
  texW: number,
  texH: number,
  normX: number,
  normY: number,
): { x: number; y: number } {
  return {
    x: layout.left + normX * texW * layout.scale,
    y: layout.top + normY * texH * layout.scale,
  };
}

/** Screen positions for menu loot number anchors (cover-scaled menu art). */
export function computeMenuLootTextScreenPoints(layout: MenuCoverLayout): {
  gold: { x: number; y: number };
  diamond: { x: number; y: number };
} {
  return {
    gold: menuArtPointToScreen(
      layout,
      MENU_CANDY_LOOP_TEX_W,
      MENU_CANDY_LOOP_TEX_H,
      MENU_LOOT_GOLD_TEXT_NORM.x,
      MENU_LOOT_GOLD_TEXT_NORM.y,
    ),
    diamond: menuArtPointToScreen(
      layout,
      MENU_CANDY_LOOP_TEX_W,
      MENU_CANDY_LOOP_TEX_H,
      MENU_LOOT_DIAMOND_TEXT_NORM.x,
      MENU_LOOT_DIAMOND_TEXT_NORM.y,
    ),
  };
}

/** Uniform cover — fills viewport, preserves aspect, crops edges, keeps center focus. */
export function layoutMenuCoverSprite(sprite: Sprite, viewportW: number, viewportH: number): number {
  const texW = Math.max(1, sprite.texture.width);
  const texH = Math.max(1, sprite.texture.height);
  const layout = computeMenuCoverLayout(viewportW, viewportH, texW, texH);
  sprite.scale.set(layout.scale);
  sprite.anchor.set(0.5, 0.5);
  sprite.position.set(viewportW * 0.5, viewportH * 0.5);
  return layout.scale;
}

/** Cover scale for the animated back layer — includes overscan for drift/pulse. */
export function computeMenuBackBaseScale(
  viewportW: number,
  viewportH: number,
  texW: number,
  texH: number,
): number {
  return computeMenuCoverLayout(viewportW, viewportH, texW, texH).scale * MENU_BACK_COVER_BLEED;
}

/** Slow floating parallax for the menu back layer (static UI stays above). */
export function applyMenuBackDriftAnimation(
  sprite: Sprite,
  viewportW: number,
  viewportH: number,
  baseCoverScale: number,
  animTimeSec: number,
): void {
  const posOmega = (Math.PI * 2) / MENU_BACK_DRIFT_PERIOD_SEC;
  const pulseOmega = (Math.PI * 2) / MENU_BACK_PULSE_PERIOD_SEC;
  const driftX = Math.sin(animTimeSec * posOmega) * MENU_BACK_DRIFT_X_PX;
  const driftY = Math.sin(animTimeSec * posOmega * 0.92 + 1.1) * MENU_BACK_DRIFT_Y_PX;
  const pulse = 1 + MENU_BACK_SCALE_PULSE * (0.5 + 0.5 * Math.sin(animTimeSec * pulseOmega));

  sprite.anchor.set(0.5, 0.5);
  sprite.position.set(viewportW * 0.5 + driftX, viewportH * 0.5 + driftY);
  sprite.scale.set(baseCoverScale * pulse);
  sprite.alpha = 1;
}

/** Invisible tap target aligned to the painted PLAY button in the menu art. */
export function layoutMenuPlayHitZone(
  hitZone: Graphics,
  viewportW: number,
  viewportH: number,
  texW: number,
  texH: number,
): Rectangle {
  const layout = computeMenuCoverLayout(viewportW, viewportH, texW, texH);
  const rect = computeMenuPlayButtonScreenRect(layout, texW, texH, viewportW, viewportH);
  hitZone.clear();
  hitZone
    .rect(rect.x, rect.y, rect.width, rect.height)
    .fill({ color: 0xffffff, alpha: 0.001 });
  hitZone.hitArea = rect;
  return rect;
}
