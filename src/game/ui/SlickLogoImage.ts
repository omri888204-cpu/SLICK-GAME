import { Container, Sprite, Texture } from 'pixi.js';

/** Raster SLICK logo with subtle liquid wobble (scale + skew on sprite). */
export class SlickLogoImage extends Container {
  private readonly sprite: Sprite;
  private runTime = 0;
  private baseScale = 1;

  constructor(texture: Texture) {
    super();
    this.sprite = new Sprite(texture);
    this.sprite.anchor.set(0.5);
    this.addChild(this.sprite);
  }

  /** Target display width in px (aspect preserved). */
  fitWidth(maxWidth: number): void {
    const w = this.sprite.texture.width || 1;
    this.baseScale = Math.min(1, maxWidth / w);
    this.applyMotion(0);
  }

  update(dtSec: number): void {
    this.runTime += dtSec;
    this.applyMotion(this.runTime);
  }

  private applyMotion(t: number): void {
    if (t <= 0) {
      this.sprite.scale.set(this.baseScale);
      this.sprite.skew.x = 0;
      return;
    }

    const wx = this.baseScale * (1 + Math.sin(t * 2.35) * 0.014 + Math.sin(t * 3.5 + 1) * 0.007);
    const wy = this.baseScale * (1 + Math.cos(t * 2.05) * 0.012 + Math.sin(t * 2.8) * 0.006);
    this.sprite.scale.set(wx, wy);
    this.sprite.skew.x = Math.sin(t * 1.12) * 0.024;
  }
}
