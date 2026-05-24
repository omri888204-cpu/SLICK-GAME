import { Container, Sprite, Texture, TilingSprite } from 'pixi.js';
import { CandyAtmosphereFx } from './CandyAtmosphereFx';
import {
  buildLayerBackgroundLayout,
  BACKGROUND_TIER_SWITCH_METERS,
  CANDY_LAYER1_SKY_HIGH_URL,
  CANDY_LAYER1_SKY_URL,
  CANDY_LAYER2_MIDDLE_HIGH_URL,
  CANDY_LAYER2_MIDDLE_URL,
  CANDY_LAYER3_FRONT_HIGH_URL,
  CANDY_LAYER3_FRONT_URL,
  coverScaleForTexture,
  FRONT_WALL_CAMERA_PARALLAX,
  PORTRAIT_MIN_ASPECT,
  SKY_TILE_SCROLL_PX_PER_SEC,
  widthFitTileScale,
  Z_FRONT,
  Z_FX,
  Z_MIDDLE,
  Z_SKY,
  type LayerBackgroundLayout,
} from './candyStaticBackground';
import { prepareStaticBackgroundTexture } from './prepareStaticBackgroundTexture';

export type CandyAtmosphereLayout = {
  viewportW: number;
  viewportH: number;
  bottomAnchorY: number;
  cameraY?: number;
  climbMeters?: number;
};

export type CandyAtmosphereUpdate = {
  dt: number;
  cameraY: number;
  climbMeters: number;
};

/**
 * - layer 11 / back 5000: slow ambient tile scroll (switches at 5k m)
 * - layer2 / 5000 factory: static midground (switches at 5k m)
 * - loop wall 2 / 5000 wall: climbs with camera — walls rise slowly as the player goes up
 */
export class CandyAtmosphereManager {
  readonly root = new Container();

  private readonly fx = new CandyAtmosphereFx();
  private skyTile: TilingSprite | null = null;
  private middleSprite: Sprite | null = null;
  private frontTile: TilingSprite | null = null;
  private textures: Texture[] = [];
  private loaded = false;
  private lastLayout: CandyAtmosphereLayout | null = null;

  private skyAmbientScrollY = 0;
  private skyTexLow: Texture | null = null;
  private skyTexHigh: Texture | null = null;
  private activeSkyTier: 'low' | 'high' = 'low';
  private frontWallTileScale = 1;
  private frontTexLow: Texture | null = null;
  private frontTexHigh: Texture | null = null;
  private activeFrontWallTier: 'low' | 'high' = 'low';
  private middleTexLow: Texture | null = null;
  private middleTexHigh: Texture | null = null;
  private activeMiddleTier: 'low' | 'high' = 'low';

  constructor(parent: Container) {
    this.root.sortableChildren = true;
    this.root.eventMode = 'none';
    parent.addChild(this.root);
  }

  get isReady(): boolean {
    return this.loaded && this.skyTile != null && this.middleSprite != null && this.frontTile != null;
  }

  async load(): Promise<boolean> {
    this.unload();

    try {
      const [skyTexLow, skyTexHigh, middleTexLow, middleTexHigh, frontTexLow, frontTexHigh] =
        await Promise.all([
          prepareStaticBackgroundTexture(CANDY_LAYER1_SKY_URL, {
            verticalRepeat: true,
            nearestScale: true,
          }),
          prepareStaticBackgroundTexture(CANDY_LAYER1_SKY_HIGH_URL, {
            skipEdgeKeying: true,
          }),
          prepareStaticBackgroundTexture(CANDY_LAYER2_MIDDLE_URL),
          prepareStaticBackgroundTexture(CANDY_LAYER2_MIDDLE_HIGH_URL),
          prepareStaticBackgroundTexture(CANDY_LAYER3_FRONT_URL, { verticalRepeat: true }),
          prepareStaticBackgroundTexture(CANDY_LAYER3_FRONT_HIGH_URL, { verticalRepeat: true }),
        ]);
      this.textures.push(skyTexLow, skyTexHigh, middleTexLow, middleTexHigh, frontTexLow, frontTexHigh);
      this.skyTexLow = skyTexLow;
      this.skyTexHigh = skyTexHigh;
      this.activeSkyTier = 'low';
      this.middleTexLow = middleTexLow;
      this.middleTexHigh = middleTexHigh;
      this.activeMiddleTier = 'low';
      this.frontTexLow = frontTexLow;
      this.frontTexHigh = frontTexHigh;
      this.activeFrontWallTier = 'low';

      const sky = new TilingSprite({ texture: skyTexLow, width: 1, height: 1 });
      sky.eventMode = 'none';
      sky.roundPixels = true;
      sky.zIndex = Z_SKY;
      this.skyTile = sky;

      const middle = new Sprite(middleTexLow);
      middle.eventMode = 'none';
      middle.roundPixels = false;
      middle.anchor.set(0.5, 0.5);
      middle.zIndex = Z_MIDDLE;
      this.middleSprite = middle;

      const front = new TilingSprite({ texture: frontTexLow, width: 1, height: 1 });
      front.eventMode = 'none';
      front.roundPixels = false;
      front.zIndex = Z_FRONT;
      this.frontTile = front;

      this.fx.root.zIndex = Z_FX;
      this.fx.root.visible = false;
      this.root.addChild(sky, middle, front, this.fx.root);

      this.skyAmbientScrollY = 0;
      this.loaded = true;

      if (this.lastLayout) {
        this.layout(this.lastLayout);
      }
      return true;
    } catch (error) {
      console.error('[CandyAtmosphereManager] Failed to load layer backgrounds:', error);
      this.unload();
      return false;
    }
  }

  layout(layout: CandyAtmosphereLayout): void {
    this.lastLayout = layout;
    if (!this.loaded) {
      return;
    }

    const { viewportW, viewportH, bottomAnchorY } = layout;
    const portrait = viewportH / Math.max(1, viewportW) >= PORTRAIT_MIN_ASPECT;
    this.root.visible = portrait;

    const viewport = buildLayerBackgroundLayout(viewportW, viewportH, bottomAnchorY);
    this.syncSkyTier(layout.climbMeters ?? 0, viewport);
    this.applySkyLayout(viewport);
    this.syncMiddleTier(layout.climbMeters ?? 0, viewport);
    this.applyMiddleLayout(viewport);
    this.syncFrontWallTier(layout.climbMeters ?? 0, viewport);
    this.applyFrontWallLayout(viewport);
    this.syncWallScroll(layout.cameraY ?? 0);
  }

  update(params: CandyAtmosphereUpdate): void {
    if (!this.loaded || !this.root.visible) {
      return;
    }

    this.skyAmbientScrollY -= SKY_TILE_SCROLL_PX_PER_SEC * params.dt;
    if (this.skyTile) {
      if (this.activeSkyTier === 'high') {
        this.skyTile.tilePosition.y = Math.round(this.skyAmbientScrollY * 0.2);
      } else {
        const texH = Math.max(1, this.skyTile.texture.height);
        const tileScreenH = texH * this.skyTile.tileScale.y;
        if (tileScreenH > 0) {
          const scroll = Math.round(this.skyAmbientScrollY);
          this.skyTile.tilePosition.y = ((scroll % tileScreenH) + tileScreenH) % tileScreenH;
        } else {
          this.skyTile.tilePosition.y = Math.round(this.skyAmbientScrollY);
        }
      }
    }

    this.syncSkyTier(params.climbMeters);
    this.syncMiddleTier(params.climbMeters);
    this.syncFrontWallTier(params.climbMeters);
    this.syncWallScroll(params.cameraY);
  }

  destroy(): void {
    this.unload();
    this.fx.destroy();
    this.root.destroy({ children: true });
  }

  /** layer 11 below 5k m; back 5000 at and above. */
  private syncSkyTier(climbMeters: number, layout?: LayerBackgroundLayout): void {
    const sky = this.skyTile;
    if (!sky) {
      return;
    }

    const wantHigh = climbMeters >= BACKGROUND_TIER_SWITCH_METERS;
    const wantTier = wantHigh ? 'high' : 'low';
    if (wantTier === this.activeSkyTier) {
      return;
    }

    const tex = wantHigh ? this.skyTexHigh : this.skyTexLow;
    if (!tex) {
      return;
    }

    sky.texture = tex;
    this.activeSkyTier = wantTier;

    const viewport =
      layout ??
      (this.lastLayout
        ? buildLayerBackgroundLayout(
            this.lastLayout.viewportW,
            this.lastLayout.viewportH,
            this.lastLayout.bottomAnchorY,
          )
        : null);
    if (viewport) {
      this.applySkyLayout(viewport);
    }
  }

  /** layer2 below 5k m; 5000 factory at and above. */
  private syncMiddleTier(climbMeters: number, layout?: LayerBackgroundLayout): void {
    const middle = this.middleSprite;
    if (!middle) {
      return;
    }

    const wantHigh = climbMeters >= BACKGROUND_TIER_SWITCH_METERS;
    const wantTier = wantHigh ? 'high' : 'low';
    if (wantTier === this.activeMiddleTier) {
      return;
    }

    const tex = wantHigh ? this.middleTexHigh : this.middleTexLow;
    if (!tex) {
      return;
    }

    middle.texture = tex;
    this.activeMiddleTier = wantTier;

    const viewport =
      layout ??
      (this.lastLayout
        ? buildLayerBackgroundLayout(
            this.lastLayout.viewportW,
            this.lastLayout.viewportH,
            this.lastLayout.bottomAnchorY,
          )
        : null);
    if (viewport) {
      this.applyMiddleLayout(viewport);
    }
  }

  /** loop wall 2 below 5k m; 5000 wall at and above — same parallax scroll as before. */
  private syncFrontWallTier(climbMeters: number, layout?: LayerBackgroundLayout): void {
    const front = this.frontTile;
    if (!front) {
      return;
    }

    const wantHigh = climbMeters >= BACKGROUND_TIER_SWITCH_METERS;
    const wantTier = wantHigh ? 'high' : 'low';
    if (wantTier === this.activeFrontWallTier) {
      return;
    }

    const tex = wantHigh ? this.frontTexHigh : this.frontTexLow;
    if (!tex) {
      return;
    }

    front.texture = tex;
    this.activeFrontWallTier = wantTier;

    const viewport =
      layout ??
      (this.lastLayout
        ? buildLayerBackgroundLayout(
            this.lastLayout.viewportW,
            this.lastLayout.viewportH,
            this.lastLayout.bottomAnchorY,
          )
        : null);
    if (viewport) {
      this.applyFrontWallLayout(viewport);
    }
  }

  private syncWallScroll(cameraY: number): void {
    if (!this.frontTile) {
      return;
    }
    this.frontTile.tilePosition.y = (-cameraY * FRONT_WALL_CAMERA_PARALLAX) / this.frontWallTileScale;
  }

  private applyFrontWallLayout(layout: LayerBackgroundLayout): void {
    const front = this.frontTile;
    if (!front) {
      return;
    }

    const texW = Math.max(1, front.texture.width);
    const scale = widthFitTileScale(layout.viewportW, texW);
    this.frontWallTileScale = scale;

    front.tileScale.set(scale, scale);
    front.width = layout.viewportW;
    front.height = layout.fillH;
    front.position.set(0, 0);
  }

  private applySkyLayout(layout: LayerBackgroundLayout): void {
    const sky = this.skyTile;
    if (!sky) {
      return;
    }

    const texW = Math.max(1, sky.texture.width);
    const texH = Math.max(1, sky.texture.height);

    if (this.activeSkyTier === 'high') {
      const scale = coverScaleForTexture(layout.viewportW, layout.fillH, texW, texH);
      sky.tileScale.set(scale, scale);
      sky.width = layout.viewportW;
      sky.height = layout.fillH;
      sky.position.set(0, 0);
      sky.tilePosition.y = Math.round(this.skyAmbientScrollY * 0.2);
      return;
    }

    const scale = widthFitTileScale(layout.viewportW, texW);
    sky.tileScale.set(scale, scale);
    sky.width = layout.viewportW;
    sky.height = layout.fillH;
    sky.position.set(0, 0);

    const tileScreenH = texH * scale;
    if (tileScreenH > 0) {
      const scroll = Math.round(this.skyAmbientScrollY);
      sky.tilePosition.y = ((scroll % tileScreenH) + tileScreenH) % tileScreenH;
    }
  }

  private applyMiddleLayout(layout: LayerBackgroundLayout): void {
    const middle = this.middleSprite;
    if (!middle) {
      return;
    }

    const texW = Math.max(1, middle.texture.width);
    const texH = Math.max(1, middle.texture.height);
    const scale = coverScaleForTexture(layout.viewportW, layout.fillH, texW, texH);
    middle.scale.set(scale);
    middle.position.set(layout.centerX, layout.centerY);
  }

  private unload(): void {
    if (this.skyTile) {
      this.root.removeChild(this.skyTile);
      this.skyTile.destroy({ texture: false });
      this.skyTile = null;
    }
    if (this.middleSprite) {
      this.root.removeChild(this.middleSprite);
      this.middleSprite.destroy({ texture: false });
      this.middleSprite = null;
    }
    if (this.frontTile) {
      this.root.removeChild(this.frontTile);
      this.frontTile.destroy({ texture: false });
      this.frontTile = null;
    }
    if (this.fx.root.parent === this.root) {
      this.root.removeChild(this.fx.root);
    }
    for (const texture of this.textures) {
      texture.destroy(true);
    }
    this.textures.length = 0;
    this.skyTexLow = null;
    this.skyTexHigh = null;
    this.activeSkyTier = 'low';
    this.frontTexLow = null;
    this.frontTexHigh = null;
    this.activeFrontWallTier = 'low';
    this.middleTexLow = null;
    this.middleTexHigh = null;
    this.activeMiddleTier = 'low';
    this.loaded = false;
  }
}
