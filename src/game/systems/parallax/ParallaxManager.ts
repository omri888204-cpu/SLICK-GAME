import { Container, Graphics, Texture } from 'pixi.js';
import {
  buildParallaxViewportLayout,
  CANDY_CANYON_PARALLAX_LAYERS,
  PARALLAX_FOG_ALPHA,
  PARALLAX_FOG_COLOR,
  PARALLAX_SKY_SEAM_FADE_PX,
  PARALLAX_Z_FOG,
  PORTRAIT_MIN_ASPECT,
  type CandyParallaxLayerDef,
} from './candyCanyonParallax';
import { ParallaxLayer, type ParallaxLayerOptions } from './ParallaxLayer';
import { prepareParallaxLayerTexture } from './prepareParallaxLayerTexture';

export type ParallaxManagerLayout = {
  viewportW: number;
  viewportH: number;
  /** Screen Y of the top edge of the orange death strip. */
  bottomAnchorY: number;
  cameraY?: number;
};

export type ParallaxManagerUpdate = {
  cameraY: number;
};

function prepareParallaxTexture(tex: Texture): void {
  tex.source.style.addressModeU = 'clamp-to-edge';
  tex.source.style.addressModeV = 'clamp-to-edge';
  tex.source.scaleMode = 'linear';
}

function texturePrepForLayer(def: CandyParallaxLayerDef) {
  if (def.mode === 'skyScroll') {
    return { loopSeamFadePx: PARALLAX_SKY_SEAM_FADE_PX };
  }
  return {};
}

/**
 * Candy background — scrolling sky behind two camera-locked side overlays.
 */
export class ParallaxManager {
  readonly root = new Container();

  private readonly layers: ParallaxLayer[] = [];
  private readonly loadedTextures: Texture[] = [];
  private readonly fog = new Graphics();
  private loaded = false;
  private lastLayout: ParallaxManagerLayout | null = null;

  constructor(parent: Container) {
    this.root.sortableChildren = true;
    this.root.eventMode = 'none';
    this.fog.eventMode = 'none';
    this.fog.zIndex = PARALLAX_Z_FOG;
    parent.addChild(this.root);
  }

  get isReady(): boolean {
    return this.loaded && this.layers.length > 0;
  }

  async load(layerDefs: readonly CandyParallaxLayerDef[] = CANDY_CANYON_PARALLAX_LAYERS): Promise<boolean> {
    this.clearLayers();

    const loadedLayers: ParallaxLayer[] = [];
    try {
      for (const def of layerDefs) {
        const texture = await prepareParallaxLayerTexture(def.url, texturePrepForLayer(def));
        prepareParallaxTexture(texture);
        this.loadedTextures.push(texture);
        const options: ParallaxLayerOptions = {
          texture,
          zIndex: def.zIndex,
          mode: def.mode,
          alpha: def.alpha,
        };
        const layer = new ParallaxLayer(options);
        loadedLayers.push(layer);
        this.root.addChild(layer.root);
      }
    } catch (error) {
      console.error('[ParallaxManager] Failed to load candy parallax layers:', error);
      this.clearLayers();
      return false;
    }

    this.layers.push(...loadedLayers);
    this.root.addChild(this.fog);
    this.loaded = true;

    if (this.lastLayout) {
      this.layout(this.lastLayout);
    }
    return true;
  }

  /** Reload all parallax textures (e.g. after replacing PNG assets). */
  async reload(layerDefs: readonly CandyParallaxLayerDef[] = CANDY_CANYON_PARALLAX_LAYERS): Promise<boolean> {
    return this.load(layerDefs);
  }

  layout(layout: ParallaxManagerLayout): void {
    this.lastLayout = layout;
    if (!this.loaded) {
      return;
    }

    const { viewportW, viewportH, bottomAnchorY } = layout;
    const portrait = viewportH / Math.max(1, viewportW) >= PORTRAIT_MIN_ASPECT;
    this.root.visible = portrait;

    const viewport = buildParallaxViewportLayout(viewportW, viewportH, bottomAnchorY);
    for (const layer of this.layers) {
      layer.resize(viewport, layout.cameraY ?? 0);
    }

    this.fog.clear();
    this.fog.rect(0, 0, viewportW, viewportH).fill({
      color: PARALLAX_FOG_COLOR,
      alpha: PARALLAX_FOG_ALPHA,
    });
  }

  update(params: ParallaxManagerUpdate): void {
    if (!this.loaded || !this.root.visible) {
      return;
    }

    for (const layer of this.layers) {
      layer.update({ cameraY: params.cameraY });
    }
  }

  destroy(): void {
    this.clearLayers();
    this.root.destroy({ children: true });
    this.loaded = false;
    this.lastLayout = null;
  }

  private clearLayers(): void {
    for (const layer of this.layers) {
      this.root.removeChild(layer.root);
      layer.destroy();
    }
    this.layers.length = 0;
    for (const texture of this.loadedTextures) {
      texture.destroy(true);
    }
    this.loadedTextures.length = 0;
    if (this.fog.parent === this.root) {
      this.root.removeChild(this.fog);
    }
    this.fog.clear();
    this.loaded = false;
  }
}
