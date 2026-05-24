import { Container, Sprite, Texture } from 'pixi.js';
import {
  containScaleForTexture,
  heightFitScaleForTexture,
  PARALLAX_SKY_COPY_COUNT,
  PARALLAX_SKY_LOOP_OVERLAP_PX,
  PARALLAX_SKY_SCROLL_FACTOR,
  type ParallaxLayerMode,
  type ParallaxViewportLayout,
} from './candyCanyonParallax';

export type ParallaxLayerOptions = {
  texture: Texture;
  zIndex: number;
  mode: ParallaxLayerMode;
  alpha?: number;
};

/**
 * Candy background layer.
 * - `skyScroll`: three recycled copies, Y parallax + vertical loop.
 * - `staticOverlay`: single sprite locked to the camera (no scroll, no loop).
 */
export class ParallaxLayer {
  readonly root = new Container();

  private readonly mode: ParallaxLayerMode;
  private readonly sprites: Sprite[] = [];

  private readonly texture: Texture;
  private readonly textureSource: Texture['source'];

  private centerX = 0;
  private centerY = 0;
  private fillH = 1;
  private segmentScreenH = 1;
  private stridePx = 1;
  private lastParallaxScroll = 0;

  constructor(options: ParallaxLayerOptions) {
    this.texture = options.texture;
    this.textureSource = options.texture.source;
    this.mode = options.mode;
    this.root.zIndex = options.zIndex;
    this.root.eventMode = 'none';

    const spriteCount = this.mode === 'skyScroll' ? PARALLAX_SKY_COPY_COUNT : 1;
    for (let i = 0; i < spriteCount; i += 1) {
      const sprite = new Sprite(new Texture({ source: this.textureSource }));
      sprite.eventMode = 'none';
      sprite.roundPixels = false;
      sprite.anchor.set(0.5, 0.5);
      if (options.alpha !== undefined) {
        sprite.alpha = options.alpha;
      }
      this.sprites.push(sprite);
      this.root.addChild(sprite);
    }
  }

  resize(layout: ParallaxViewportLayout, cameraY = 0): void {
    const texW = Math.max(1, this.texture.width);
    const texH = Math.max(1, this.texture.height);

    this.centerX = layout.centerX;
    this.centerY = layout.centerY;
    this.fillH = layout.fillH;

    const scale =
      this.mode === 'skyScroll'
        ? heightFitScaleForTexture(layout.fillH, texH)
        : containScaleForTexture(layout.viewportW, layout.fillH, texW, texH);

    this.segmentScreenH = texH * scale;
    this.stridePx = Math.max(1, this.segmentScreenH - PARALLAX_SKY_LOOP_OVERLAP_PX);

    for (const sprite of this.sprites) {
      sprite.texture = new Texture({ source: this.textureSource });
      sprite.scale.set(scale);
    }

    if (this.mode === 'skyScroll') {
      this.lastParallaxScroll = -cameraY * PARALLAX_SKY_SCROLL_FACTOR;
      this.layoutSkyCopies(this.lastParallaxScroll);
      return;
    }

    const sprite = this.sprites[0];
    sprite.position.set(this.centerX, this.centerY);
  }

  update(params: { cameraY: number }): void {
    if (this.mode !== 'skyScroll') {
      return;
    }

    const parallaxScroll = -params.cameraY * PARALLAX_SKY_SCROLL_FACTOR;
    const delta = parallaxScroll - this.lastParallaxScroll;
    this.lastParallaxScroll = parallaxScroll;

    if (Math.abs(delta) > this.stridePx * PARALLAX_SKY_COPY_COUNT) {
      this.layoutSkyCopies(parallaxScroll);
      return;
    }

    for (const sprite of this.sprites) {
      sprite.y += delta;
    }

    this.recycleSkyCopies();
  }

  destroy(): void {
    for (const sprite of this.sprites) {
      sprite.destroy({ texture: false });
    }
    this.sprites.length = 0;
    this.root.destroy({ children: true });
  }

  private layoutSkyCopies(parallaxScroll: number): void {
    if (this.sprites.length === 0 || this.stridePx <= 0) {
      return;
    }

    const middleIndex = Math.floor(PARALLAX_SKY_COPY_COUNT / 2);
    for (let i = 0; i < this.sprites.length; i += 1) {
      this.sprites[i].position.set(
        this.centerX,
        this.centerY + parallaxScroll + (i - middleIndex) * this.stridePx,
      );
    }
  }

  private recycleSkyCopies(): void {
    const halfH = this.segmentScreenH * 0.5;

    for (let pass = 0; pass < PARALLAX_SKY_COPY_COUNT; pass += 1) {
      let moved = false;

      for (const sprite of this.sprites) {
        const top = sprite.y - halfH;
        const bottom = sprite.y + halfH;

        if (top > this.fillH) {
          sprite.y = this.topmostCenterYExcept(sprite) - this.stridePx;
          moved = true;
        } else if (bottom < 0) {
          sprite.y = this.bottommostCenterYExcept(sprite) + this.stridePx;
          moved = true;
        }
      }

      if (!moved) {
        break;
      }
    }
  }

  private topmostCenterYExcept(exclude: Sprite): number {
    let minY = Number.POSITIVE_INFINITY;
    for (const sprite of this.sprites) {
      if (sprite !== exclude) {
        minY = Math.min(minY, sprite.y);
      }
    }
    return Number.isFinite(minY) ? minY : exclude.y;
  }

  private bottommostCenterYExcept(exclude: Sprite): number {
    let maxY = Number.NEGATIVE_INFINITY;
    for (const sprite of this.sprites) {
      if (sprite !== exclude) {
        maxY = Math.max(maxY, sprite.y);
      }
    }
    return Number.isFinite(maxY) ? maxY : exclude.y;
  }
}
