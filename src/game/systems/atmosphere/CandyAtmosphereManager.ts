import { Container, Sprite, Texture, TilingSprite } from 'pixi.js';
import { CandyAtmosphereFx } from './CandyAtmosphereFx';
import { SpaceFloatingRocks } from './SpaceFloatingRocks';
import {
  buildLayerBackgroundLayout,
  BACKGROUND_TIER_2_SWITCH_METERS,
  BACKGROUND_TIER_SWITCH_METERS,
  CANDY_LAYER1_SKY_HIGH_URL,
  BACK_SPACE_SKY_CAMERA_PARALLAX,
  CANDY_BACK_SPACE_SKY_URL,
  CANDY_SPACE_MID_URL,
  CANDY_LAYER2_MIDDLE_HIGH_URL,
  CANDY_LAYER2_MIDDLE_ULTRA_URL,
  CANDY_LAYER2_MIDDLE_URL,
  SPACE_1_MIDDLE_BOB_RANGE_PX,
  SPACE_1_MIDDLE_BOB_SPEED_RAD_PER_SEC,
  CANDY_LAYER3_FRONT_HIGH_URL,
  CANDY_LAYER3_FRONT_ULTRA_URL,
  coverScaleForTexture,
  ENABLE_CANDY_FRONT_WALLS,
  FRONT_WALL_CAMERA_PARALLAX,
  PORTRAIT_MIN_ASPECT,
  SKY_TILE_SCROLL_PX_PER_SEC,
  widthFitTileScale,
  Z_FRONT,
  Z_FX,
  Z_MIDDLE,
  Z_SKY,
  Z_SPACE_MID,
  Z_SPACE_ROCKS,
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
 * - back space / back 5000: far sky (back space film-roll tile while climbing; back 5000 at 5k+ m)
 * - space mid: static layer between space 2 and space 1 (below 5k m)
 * - space 1 / 5000 factory / castle 10000: foreground midground (switches at 5k / 10k m)
 * - optional: 5000 wall / 10000 walls foreground tiles ({@link ENABLE_CANDY_FRONT_WALLS})
 * - {@link SpaceFloatingRocks}: three rocks from `rocks 1.png` in the bottom-right triangle
 */
export class CandyAtmosphereManager {
  readonly root = new Container();

  private readonly fx = new CandyAtmosphereFx();
  private readonly spaceRocks = new SpaceFloatingRocks();
  /** Below 5k m — `back space.png`; vertical seamless tile unrolls while climbing (film reel). */
  private skyBackSpaceTile: TilingSprite | null = null;
  private backSpaceTileScale = 1;
  /** 5k+ m — `back 5000.png` cover tile + slow ambient drift. */
  private skyTileHigh: TilingSprite | null = null;
  /** Below 5k m — `space mid.png`, viewport-locked between space 2 and space 1. */
  private spaceMidSprite: Sprite | null = null;
  private middleSprite: Sprite | null = null;
  private frontTile: TilingSprite | null = null;
  private textures: Texture[] = [];
  private loaded = false;
  private lastLayout: CandyAtmosphereLayout | null = null;

  private skyAmbientScrollY = 0;
  private skyTexBackSpace: Texture | null = null;
  private backSpaceFilmScrollPx = 0;
  private lastBackSpaceCameraY = 0;
  private skyTexSpaceMid: Texture | null = null;
  private skyTexHigh: Texture | null = null;
  private activeSkyTier: 'low' | 'high' = 'low';
  private frontWallTileScale = 1;
  private frontTexHigh: Texture | null = null;
  private frontTexUltra: Texture | null = null;
  private activeFrontWallTier: 'low' | 'high' | 'ultra' = 'low';
  private middleTexLow: Texture | null = null;
  private middleTexHigh: Texture | null = null;
  private middleTexUltra: Texture | null = null;
  private activeMiddleTier: 'low' | 'high' | 'ultra' = 'low';
  /** Accumulated phase for {@link SPACE_1_MIDDLE_BOB_RANGE_PX} bob while space 1 is active. */
  private space1MiddleBobPhaseSec = 0;

  constructor(parent: Container) {
    this.root.sortableChildren = true;
    this.root.eventMode = 'none';
    parent.addChild(this.root);
  }

  get isReady(): boolean {
    return (
      this.loaded &&
      this.skyBackSpaceTile != null &&
      this.skyTileHigh != null &&
      this.spaceMidSprite != null &&
      this.middleSprite != null &&
      this.spaceRocks.isReady &&
      (!ENABLE_CANDY_FRONT_WALLS || this.frontTile != null)
    );
  }

  async load(): Promise<boolean> {
    this.unload();

    try {
      const loadPromises: Promise<Texture>[] = [
        prepareStaticBackgroundTexture(CANDY_BACK_SPACE_SKY_URL, {
          verticalRepeat: true,
          nearestScale: true,
        }),
        prepareStaticBackgroundTexture(CANDY_LAYER1_SKY_HIGH_URL, {
          skipEdgeKeying: true,
        }),
        prepareStaticBackgroundTexture(CANDY_SPACE_MID_URL, {
          skipEdgeKeying: true,
        }),
        prepareStaticBackgroundTexture(CANDY_LAYER2_MIDDLE_URL),
        prepareStaticBackgroundTexture(CANDY_LAYER2_MIDDLE_HIGH_URL),
        prepareStaticBackgroundTexture(CANDY_LAYER2_MIDDLE_ULTRA_URL),
      ];
      if (ENABLE_CANDY_FRONT_WALLS) {
        loadPromises.push(
          prepareStaticBackgroundTexture(CANDY_LAYER3_FRONT_HIGH_URL, { verticalRepeat: true }),
          prepareStaticBackgroundTexture(CANDY_LAYER3_FRONT_ULTRA_URL, {
            verticalRepeat: true,
            centerBandEdgeKeyMarginRatio: 0.2,
          }),
        );
      }

      const loaded = await Promise.all(loadPromises);
      const skyTexBackSpace = loaded[0]!;
      const skyTexHigh = loaded[1]!;
      const skyTexSpaceMid = loaded[2]!;
      const middleTexLow = loaded[3]!;
      const middleTexHigh = loaded[4]!;
      const middleTexUltra = loaded[5]!;
      const frontTexHigh = ENABLE_CANDY_FRONT_WALLS ? loaded[6]! : null;
      const frontTexUltra = ENABLE_CANDY_FRONT_WALLS ? loaded[7]! : null;

      this.textures.push(
        skyTexBackSpace,
        skyTexHigh,
        skyTexSpaceMid,
        middleTexLow,
        middleTexHigh,
        middleTexUltra,
      );
      if (frontTexHigh) {
        this.textures.push(frontTexHigh);
      }
      if (frontTexUltra) {
        this.textures.push(frontTexUltra);
      }
      this.skyTexBackSpace = skyTexBackSpace;
      this.skyTexSpaceMid = skyTexSpaceMid;
      this.skyTexHigh = skyTexHigh;
      this.activeSkyTier = 'low';
      this.middleTexLow = middleTexLow;
      this.middleTexHigh = middleTexHigh;
      this.middleTexUltra = middleTexUltra;
      this.activeMiddleTier = 'low';
      this.frontTexHigh = frontTexHigh;
      this.frontTexUltra = frontTexUltra;
      this.activeFrontWallTier = 'low';

      const skyBackSpace = new TilingSprite({ texture: skyTexBackSpace, width: 1, height: 1 });
      skyBackSpace.eventMode = 'none';
      skyBackSpace.roundPixels = true;
      skyBackSpace.zIndex = Z_SKY;
      this.skyBackSpaceTile = skyBackSpace;

      const skyHigh = new TilingSprite({ texture: skyTexHigh, width: 1, height: 1 });
      skyHigh.eventMode = 'none';
      skyHigh.roundPixels = true;
      skyHigh.zIndex = Z_SKY;
      skyHigh.visible = false;
      this.skyTileHigh = skyHigh;

      const spaceMid = new Sprite(skyTexSpaceMid);
      spaceMid.eventMode = 'none';
      spaceMid.roundPixels = false;
      spaceMid.anchor.set(0.5, 0.5);
      spaceMid.zIndex = Z_SPACE_MID;
      this.spaceMidSprite = spaceMid;

      const middle = new Sprite(middleTexLow);
      middle.eventMode = 'none';
      middle.roundPixels = false;
      middle.anchor.set(0.5, 0.5);
      middle.zIndex = Z_MIDDLE;
      this.middleSprite = middle;

      if (ENABLE_CANDY_FRONT_WALLS && frontTexHigh) {
        const front = new TilingSprite({ texture: frontTexHigh, width: 1, height: 1 });
        front.eventMode = 'none';
        front.roundPixels = false;
        front.zIndex = Z_FRONT;
        front.visible = false;
        this.frontTile = front;
        this.root.addChild(skyBackSpace, skyHigh, spaceMid, middle, front, this.fx.root);
      } else {
        this.frontTile = null;
        this.root.addChild(skyBackSpace, skyHigh, spaceMid, middle, this.fx.root);
      }

      this.fx.root.zIndex = Z_FX;
      this.fx.root.visible = false;

      this.spaceRocks.root.zIndex = Z_SPACE_ROCKS;
      await this.spaceRocks.load();
      this.spaceRocks.setVisible(this.activeSkyTier === 'low');
      this.root.addChild(this.spaceRocks.root);

      this.backSpaceFilmScrollPx = 0;
      this.lastBackSpaceCameraY = 0;
      this.backSpaceTileScale = 1;
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
    this.applySkyLayout(viewport, layout.cameraY ?? 0);
    this.applySpaceMidLayout(viewport);
    if (this.spaceRocks.isReady) {
      this.spaceRocks.layout(viewport);
      this.spaceRocks.setVisible(this.activeSkyTier === 'low');
    }
    this.syncMiddleTier(layout.climbMeters ?? 0, viewport);
    this.applyMiddleLayout(viewport);
    if (ENABLE_CANDY_FRONT_WALLS) {
      this.syncFrontWallTier(layout.climbMeters ?? 0, viewport);
      this.applyFrontWallLayout(viewport);
      this.syncWallScroll(layout.cameraY ?? 0);
    }
  }

  update(params: CandyAtmosphereUpdate): void {
    if (!this.loaded || !this.root.visible) {
      return;
    }

    this.skyAmbientScrollY -= SKY_TILE_SCROLL_PX_PER_SEC * params.dt;
    if (this.activeSkyTier === 'high' && this.skyTileHigh) {
      this.skyTileHigh.tilePosition.y = Math.round(this.skyAmbientScrollY * 0.2);
    }

    this.syncSkyTier(params.climbMeters);
    if (this.activeSkyTier === 'low' && this.lastLayout) {
      const viewport = buildLayerBackgroundLayout(
        this.lastLayout.viewportW,
        this.lastLayout.viewportH,
        this.lastLayout.bottomAnchorY,
      );
      this.syncBackSpaceFilmRoll(params.cameraY);
    }
    this.syncMiddleTier(params.climbMeters);
    this.space1MiddleBobPhaseSec += params.dt * SPACE_1_MIDDLE_BOB_SPEED_RAD_PER_SEC;
    this.syncSpace1MiddleBob();
    if (this.activeSkyTier === 'low' && this.spaceRocks.isReady) {
      this.spaceRocks.update(params.dt);
    }
    if (ENABLE_CANDY_FRONT_WALLS) {
      this.syncFrontWallTier(params.climbMeters);
      this.syncWallScroll(params.cameraY);
    }
  }

  destroy(): void {
    this.unload();
    this.spaceRocks.destroy();
    this.fx.destroy();
    this.root.destroy({ children: true });
  }

  /** back space below 5k m; back 5000 at and above. */
  private syncSkyTier(climbMeters: number, layout?: LayerBackgroundLayout): void {
    const skyBackSpace = this.skyBackSpaceTile;
    const skyHigh = this.skyTileHigh;
    if (!skyBackSpace || !skyHigh) {
      return;
    }

    const wantHigh = climbMeters >= BACKGROUND_TIER_SWITCH_METERS;
    const wantTier = wantHigh ? 'high' : 'low';
    if (wantTier === this.activeSkyTier) {
      return;
    }

    this.activeSkyTier = wantTier;
    skyBackSpace.visible = !wantHigh;
    skyHigh.visible = wantHigh;
    this.spaceRocks.setVisible(!wantHigh);
    if (!wantHigh) {
      this.backSpaceFilmScrollPx = 0;
      this.lastBackSpaceCameraY = this.lastLayout?.cameraY ?? 0;
    }
    if (this.spaceMidSprite) {
      this.spaceMidSprite.visible = !wantHigh;
    }

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
      this.applySkyLayout(viewport, this.lastLayout?.cameraY ?? 0);
      this.applySpaceMidLayout(viewport);
    }
  }

  /** space 1 below 5k m; 5000 factory [5k, 10k); castle 10000 at 10k+. */
  private resolveThreeTier(climbMeters: number): 'low' | 'high' | 'ultra' {
    if (climbMeters >= BACKGROUND_TIER_2_SWITCH_METERS) {
      return 'ultra';
    }
    if (climbMeters >= BACKGROUND_TIER_SWITCH_METERS) {
      return 'high';
    }
    return 'low';
  }

  private syncMiddleTier(climbMeters: number, layout?: LayerBackgroundLayout): void {
    const middle = this.middleSprite;
    if (!middle) {
      return;
    }

    const wantTier = this.resolveThreeTier(climbMeters);
    if (wantTier === this.activeMiddleTier) {
      return;
    }

    const tex =
      wantTier === 'ultra'
        ? this.middleTexUltra
        : wantTier === 'high'
          ? this.middleTexHigh
          : this.middleTexLow;
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

  /** No foreground walls below 5k; 5000 wall [5k, 10k); 10000 walls at 10k+. */
  private syncFrontWallTier(climbMeters: number, layout?: LayerBackgroundLayout): void {
    if (!ENABLE_CANDY_FRONT_WALLS) {
      return;
    }
    const front = this.frontTile;
    if (!front) {
      return;
    }

    const wantTier = this.resolveThreeTier(climbMeters);
    if (wantTier === this.activeFrontWallTier) {
      front.visible = wantTier !== 'low';
      return;
    }

    if (wantTier !== 'low') {
      const tex = wantTier === 'ultra' ? this.frontTexUltra : this.frontTexHigh;
      if (tex) {
        front.texture = tex;
      }
    }

    front.visible = wantTier !== 'low';
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
    if (!this.frontTile?.visible) {
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

  private applySkyLayout(layout: LayerBackgroundLayout, cameraY: number): void {
    if (this.activeSkyTier === 'high') {
      this.applyHighSkyLayout(layout);
      return;
    }
    this.applyBackSpaceSkyLayout(layout, cameraY);
  }

  private applyBackSpaceSkyLayout(layout: LayerBackgroundLayout, cameraY: number): void {
    const sky = this.skyBackSpaceTile;
    if (!sky) {
      return;
    }

    const texW = Math.max(1, sky.texture.width);
    const texH = Math.max(1, sky.texture.height);
    const scale = coverScaleForTexture(layout.viewportW, layout.fillH, texW, texH);
    this.backSpaceTileScale = scale;

    sky.tileScale.set(scale, scale);
    sky.width = layout.viewportW;
    sky.height = layout.fillH;
    sky.position.set(0, 0);
    this.syncBackSpaceFilmRoll(cameraY);
  }

  /**
   * Vertical film-roll: seamless tile scroll along the art length while climbing (no flat spin / gaps).
   */
  private syncBackSpaceFilmRoll(cameraY: number): void {
    const sky = this.skyBackSpaceTile;
    if (!sky || this.activeSkyTier !== 'low') {
      return;
    }

    const climbedPx = this.lastBackSpaceCameraY - cameraY;
    if (climbedPx > 0) {
      this.backSpaceFilmScrollPx += climbedPx * BACK_SPACE_SKY_CAMERA_PARALLAX;
    }
    this.lastBackSpaceCameraY = cameraY;

    const texH = Math.max(1, sky.texture.height);
    const tileScreenH = texH * this.backSpaceTileScale;
    if (tileScreenH > 0) {
      const scroll = Math.round(this.backSpaceFilmScrollPx);
      sky.tilePosition.y = ((scroll % tileScreenH) + tileScreenH) % tileScreenH;
    }
  }

  private applyHighSkyLayout(layout: LayerBackgroundLayout): void {
    const sky = this.skyTileHigh;
    if (!sky) {
      return;
    }

    const texW = Math.max(1, sky.texture.width);
    const texH = Math.max(1, sky.texture.height);
    const scale = coverScaleForTexture(layout.viewportW, layout.fillH, texW, texH);
    sky.tileScale.set(scale, scale);
    sky.width = layout.viewportW;
    sky.height = layout.fillH;
    sky.position.set(0, 0);
    sky.tilePosition.y = Math.round(this.skyAmbientScrollY * 0.2);
  }

  private applySpaceMidLayout(layout: LayerBackgroundLayout): void {
    const spaceMid = this.spaceMidSprite;
    if (!spaceMid || this.activeSkyTier !== 'low') {
      return;
    }

    const texW = Math.max(1, spaceMid.texture.width);
    const texH = Math.max(1, spaceMid.texture.height);
    const scale = coverScaleForTexture(layout.viewportW, layout.fillH, texW, texH);
    spaceMid.scale.set(scale);
    spaceMid.anchor.set(0.5, 0.5);
    spaceMid.position.set(layout.centerX, layout.centerY);
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
    middle.anchor.set(0.5, 0.5);
    this.syncSpace1MiddleBob(layout);
  }

  /** Subtle float on space 1 only — runs after layout/camera so Y is not reset the same frame. */
  private syncSpace1MiddleBob(layout?: LayerBackgroundLayout): void {
    const middle = this.middleSprite;
    if (!middle || this.activeMiddleTier !== 'low') {
      return;
    }

    const viewport =
      layout ??
      (this.lastLayout
        ? buildLayerBackgroundLayout(
            this.lastLayout.viewportW,
            this.lastLayout.viewportH,
            this.lastLayout.bottomAnchorY,
          )
        : null);
    if (!viewport) {
      return;
    }

    const bobY = Math.sin(this.space1MiddleBobPhaseSec) * SPACE_1_MIDDLE_BOB_RANGE_PX;
    middle.position.set(viewport.centerX, viewport.centerY + bobY);
  }

  private unload(): void {
    if (this.skyBackSpaceTile) {
      this.root.removeChild(this.skyBackSpaceTile);
      this.skyBackSpaceTile.destroy({ texture: false });
      this.skyBackSpaceTile = null;
    }
    if (this.skyTileHigh) {
      this.root.removeChild(this.skyTileHigh);
      this.skyTileHigh.destroy({ texture: false });
      this.skyTileHigh = null;
    }
    if (this.spaceMidSprite) {
      this.root.removeChild(this.spaceMidSprite);
      this.spaceMidSprite.destroy({ texture: false });
      this.spaceMidSprite = null;
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
    if (this.spaceRocks.root.parent === this.root) {
      this.root.removeChild(this.spaceRocks.root);
    }
    this.spaceRocks.unload();
    if (this.fx.root.parent === this.root) {
      this.root.removeChild(this.fx.root);
    }
    for (const texture of this.textures) {
      texture.destroy(true);
    }
    this.textures.length = 0;
    this.skyTexBackSpace = null;
    this.backSpaceFilmScrollPx = 0;
    this.lastBackSpaceCameraY = 0;
    this.backSpaceTileScale = 1;
    this.skyTexSpaceMid = null;
    this.skyTexHigh = null;
    this.activeSkyTier = 'low';
    this.frontTexHigh = null;
    this.frontTexUltra = null;
    this.activeFrontWallTier = 'low';
    this.middleTexLow = null;
    this.middleTexHigh = null;
    this.middleTexUltra = null;
    this.activeMiddleTier = 'low';
    this.space1MiddleBobPhaseSec = 0;
    this.loaded = false;
  }
}
