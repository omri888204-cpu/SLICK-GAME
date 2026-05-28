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
 * - back space / teset 5002: far sky (film-roll tile)
 * - space mid: static mid layer below 5k m only
 * - new main ship 1 / teset 5001 / castle 10000: foreground (switches at 5k / 10k m)
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
  /** 5k+ m — `teset 5002.png` vertical film-roll tile while climbing. */
  private skyTileHigh: TilingSprite | null = null;
  private highSkyTileScale = 1;
  /** Below 5k m — `space mid.png`, viewport-locked between sky and foreground. */
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
  private highSkyFilmScrollPx = 0;
  private lastHighSkyCameraY = 0;
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

  /** Core layers for sub-5k m — rocks / 5k+ tiers may still be loading. */
  get isReady(): boolean {
    return (
      this.loaded &&
      this.skyBackSpaceTile != null &&
      this.skyTileHigh != null &&
      this.spaceMidSprite != null &&
      this.middleSprite != null
    );
  }

  async load(): Promise<boolean> {
    const ok = await this.loadEssential();
    if (ok) {
      void this.loadDeferredAssets();
    }
    return ok;
  }

  /** Fast path: back space + space mid + space 1 only (play-entry white screen). */
  async loadEssential(): Promise<boolean> {
    this.unload();

    try {
      const [skyTexBackSpace, skyTexSpaceMid, middleTexLow] = await Promise.all([
        prepareStaticBackgroundTexture(CANDY_BACK_SPACE_SKY_URL, {
          verticalRepeat: true,
          nearestScale: true,
        }),
        prepareStaticBackgroundTexture(CANDY_SPACE_MID_URL, {
          skipEdgeKeying: true,
        }),
        prepareStaticBackgroundTexture(CANDY_LAYER2_MIDDLE_URL),
      ]);

      this.textures.push(skyTexBackSpace, skyTexSpaceMid, middleTexLow);
      this.skyTexBackSpace = skyTexBackSpace;
      this.skyTexSpaceMid = skyTexSpaceMid;
      this.skyTexHigh = null;
      this.activeSkyTier = 'low';
      this.middleTexLow = middleTexLow;
      this.middleTexHigh = null;
      this.middleTexUltra = null;
      this.activeMiddleTier = 'low';
      this.frontTexHigh = null;
      this.frontTexUltra = null;
      this.activeFrontWallTier = 'low';

      const skyBackSpace = new TilingSprite({ texture: skyTexBackSpace, width: 1, height: 1 });
      skyBackSpace.eventMode = 'none';
      skyBackSpace.roundPixels = true;
      skyBackSpace.zIndex = Z_SKY;
      this.skyBackSpaceTile = skyBackSpace;

      const skyHigh = new TilingSprite({ texture: skyTexBackSpace, width: 1, height: 1 });
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

      this.frontTile = null;
      this.root.addChild(skyBackSpace, skyHigh, spaceMid, middle, this.fx.root);
      this.fx.root.zIndex = Z_FX;
      this.fx.root.visible = false;

      this.backSpaceFilmScrollPx = 0;
      this.lastBackSpaceCameraY = 0;
      this.backSpaceTileScale = 1;
      this.highSkyFilmScrollPx = 0;
      this.lastHighSkyCameraY = 0;
      this.highSkyTileScale = 1;
      this.skyAmbientScrollY = 0;
      this.loaded = true;

      if (this.lastLayout) {
        this.layout(this.lastLayout);
      }
      return true;
    } catch (error) {
      console.error('[CandyAtmosphereManager] Failed to load essential layers:', error);
      this.unload();
      return false;
    }
  }

  private deferredAssetsPromise: Promise<void> | null = null;

  /** 5k+ tiers, optional walls, floating rocks — after first gameplay frame. */
  loadDeferredAssets(): Promise<void> {
    if (!this.loaded) {
      return Promise.resolve();
    }
    this.deferredAssetsPromise ??= this.runDeferredAssetsLoad();
    return this.deferredAssetsPromise;
  }

  private async runDeferredAssetsLoad(): Promise<void> {
    if (!this.loaded || !this.skyBackSpaceTile || !this.middleSprite) {
      return;
    }

    try {
      const deferredPromises: Promise<Texture>[] = [
        prepareStaticBackgroundTexture(CANDY_LAYER1_SKY_HIGH_URL, {
          verticalRepeat: true,
          nearestScale: true,
        }),
        prepareStaticBackgroundTexture(CANDY_LAYER2_MIDDLE_HIGH_URL),
        prepareStaticBackgroundTexture(CANDY_LAYER2_MIDDLE_ULTRA_URL),
      ];
      if (ENABLE_CANDY_FRONT_WALLS) {
        deferredPromises.push(
          prepareStaticBackgroundTexture(CANDY_LAYER3_FRONT_HIGH_URL, { verticalRepeat: true }),
          prepareStaticBackgroundTexture(CANDY_LAYER3_FRONT_ULTRA_URL, {
            verticalRepeat: true,
            centerBandEdgeKeyMarginRatio: 0.2,
          }),
        );
      }

      const loaded = await Promise.all(deferredPromises);
      const skyTexHigh = loaded[0]!;
      const middleTexHigh = loaded[1]!;
      const middleTexUltra = loaded[2]!;
      const frontTexHigh = ENABLE_CANDY_FRONT_WALLS ? loaded[3]! : null;
      const frontTexUltra = ENABLE_CANDY_FRONT_WALLS ? loaded[4]! : null;

      this.textures.push(skyTexHigh, middleTexHigh, middleTexUltra);
      if (frontTexHigh) {
        this.textures.push(frontTexHigh);
      }
      if (frontTexUltra) {
        this.textures.push(frontTexUltra);
      }
      this.skyTexHigh = skyTexHigh;
      this.middleTexHigh = middleTexHigh;
      this.middleTexUltra = middleTexUltra;
      this.frontTexHigh = frontTexHigh;
      this.frontTexUltra = frontTexUltra;
      if (this.skyTileHigh) {
        this.skyTileHigh.texture = skyTexHigh;
      }

      if (ENABLE_CANDY_FRONT_WALLS && frontTexHigh && !this.frontTile) {
        const front = new TilingSprite({ texture: frontTexHigh, width: 1, height: 1 });
        front.eventMode = 'none';
        front.roundPixels = false;
        front.zIndex = Z_FRONT;
        front.visible = false;
        this.frontTile = front;
        this.root.addChild(front);
      }

      this.spaceRocks.root.zIndex = Z_SPACE_ROCKS;
      await this.spaceRocks.load();
      this.spaceRocks.setVisible(this.activeSkyTier === 'low');
      if (this.spaceRocks.root.parent !== this.root) {
        const insertBefore = this.fx.root.parent === this.root ? this.fx.root : null;
        if (insertBefore) {
          this.root.addChildAt(this.spaceRocks.root, this.root.getChildIndex(insertBefore));
        } else {
          this.root.addChild(this.spaceRocks.root);
        }
      }

      if (this.lastLayout) {
        this.layout(this.lastLayout);
      }
      this.syncSpaceMidVisibility();
    } catch (error) {
      console.error('[CandyAtmosphereManager] Deferred layer load failed:', error);
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
    this.syncSpaceMidVisibility();
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

    this.syncSkyTier(params.climbMeters);
    this.syncSpaceMidVisibility();
    if (this.activeSkyTier === 'low' && this.lastLayout) {
      this.syncBackSpaceFilmRoll(params.cameraY);
    } else if (this.activeSkyTier === 'high') {
      this.syncHighSkyFilmRoll(params.cameraY);
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

  /** back space below 5k m; teset 5002 at and above. */
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
    } else {
      this.highSkyFilmScrollPx = 0;
      this.lastHighSkyCameraY = this.lastLayout?.cameraY ?? 0;
    }
    this.syncSpaceMidVisibility();

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

  /** Hide space mid at 5k+ m (no high-tier mid layer for now). */
  private syncSpaceMidVisibility(): void {
    const showHigh = this.activeSkyTier === 'high';
    if (this.spaceMidSprite) {
      this.spaceMidSprite.visible = !showHigh;
    }
  }

  /** new main ship 1 below 5k m; teset 5001 [5k, 10k); castle 10000 at 10k+. */
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
      this.applyHighSkyLayout(layout, cameraY);
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

  /**
   * Vertical film-roll for teset 5002 — same parallax as {@link syncBackSpaceFilmRoll}.
   */
  private syncHighSkyFilmRoll(cameraY: number): void {
    const sky = this.skyTileHigh;
    if (!sky || this.activeSkyTier !== 'high') {
      return;
    }

    const climbedPx = this.lastHighSkyCameraY - cameraY;
    if (climbedPx > 0) {
      this.highSkyFilmScrollPx += climbedPx * BACK_SPACE_SKY_CAMERA_PARALLAX;
    }
    this.lastHighSkyCameraY = cameraY;

    const texH = Math.max(1, sky.texture.height);
    const tileScreenH = texH * this.highSkyTileScale;
    if (tileScreenH > 0) {
      const scroll = Math.round(this.highSkyFilmScrollPx);
      sky.tilePosition.y = ((scroll % tileScreenH) + tileScreenH) % tileScreenH;
    }
  }

  private applyHighSkyLayout(layout: LayerBackgroundLayout, cameraY: number): void {
    const sky = this.skyTileHigh;
    if (!sky) {
      return;
    }

    const texW = Math.max(1, sky.texture.width);
    const texH = Math.max(1, sky.texture.height);
    const scale = coverScaleForTexture(layout.viewportW, layout.fillH, texW, texH);
    this.highSkyTileScale = scale;

    sky.tileScale.set(scale, scale);
    sky.width = layout.viewportW;
    sky.height = layout.fillH;
    sky.position.set(0, 0);
    this.syncHighSkyFilmRoll(cameraY);
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

  /** Bob on new main ship 1 only (below 5k). teset 5001 front stays locked at center. */
  private syncSpace1MiddleBob(layout?: LayerBackgroundLayout): void {
    const middle = this.middleSprite;
    if (!middle) {
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

    if (this.activeMiddleTier === 'low') {
      const bobY = Math.sin(this.space1MiddleBobPhaseSec) * SPACE_1_MIDDLE_BOB_RANGE_PX;
      middle.position.set(viewport.centerX, viewport.centerY + bobY);
      return;
    }

    middle.position.set(viewport.centerX, viewport.centerY);
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
    this.highSkyFilmScrollPx = 0;
    this.lastHighSkyCameraY = 0;
    this.highSkyTileScale = 1;
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
    this.deferredAssetsPromise = null;
    this.loaded = false;
  }
}

const ATMOSPHERE_WARMUP_URLS = [
  CANDY_BACK_SPACE_SKY_URL,
  CANDY_SPACE_MID_URL,
  CANDY_LAYER2_MIDDLE_URL,
] as const;

/** Warm HTTP cache while the menu is visible so play entry stays fast. */
export function warmupCandyAtmosphereEssentials(): void {
  if (typeof window === 'undefined') {
    return;
  }
  for (const url of ATMOSPHERE_WARMUP_URLS) {
    void fetch(url, { mode: 'cors', cache: 'force-cache' }).catch(() => {});
  }
}
