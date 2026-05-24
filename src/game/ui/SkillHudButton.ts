import { Container, Graphics, Rectangle, Sprite, type FederatedPointerEvent, type Texture } from 'pixi.js';

/** Extra transparent tap slop around skill button art (local px, before parent scale). */
export const SKILL_BTN_HIT_PAD_PX = 14;
const SKILL_BTN_PRESS_SCALE = 0.95;

/** Image skill button with padded invisible hit area and press scale feedback. */
export class SkillHudButton {
  readonly root = new Container();

  private readonly sprite = new Sprite();
  private readonly hitPad = new Graphics();

  private displayW = 1;
  private displayH = 1;
  private interactive = false;

  constructor(private readonly onTap: () => void) {
    this.root.sortableChildren = true;
    this.sprite.eventMode = 'none';
    this.sprite.zIndex = 0;
    this.hitPad.eventMode = 'none';
    this.hitPad.cursor = 'pointer';
    this.hitPad.zIndex = 1;
    this.root.addChild(this.sprite, this.hitPad);
    this.bindPointerEvents();
  }

  setTexture(texture: Texture, displayW: number): void {
    if (!texture || texture.width <= 0 || texture.height <= 0) {
      return;
    }
    texture.source.scaleMode = 'linear';
    this.sprite.texture = texture;
    this.sprite.visible = true;
    this.sprite.roundPixels = false;
    const nativeW = Math.max(1, texture.width);
    const nativeH = Math.max(1, texture.height);
    const scale = displayW / nativeW;
    this.sprite.width = nativeW;
    this.sprite.height = nativeH;
    this.sprite.scale.set(scale);
    this.displayW = displayW;
    this.displayH = nativeH * scale;
    this.redrawHitPad();
  }

  get width(): number {
    return this.displayW;
  }

  get height(): number {
    return this.displayH;
  }

  setInteractive(enabled: boolean): void {
    this.interactive = enabled;
    this.hitPad.eventMode = enabled ? 'static' : 'none';
    if (!enabled) {
      this.root.scale.set(1);
    }
  }

  private bindPointerEvents(): void {
    const stop = (event: FederatedPointerEvent): void => {
      event.stopPropagation();
    };
    this.hitPad.on('pointerdown', (event) => {
      stop(event);
      if (!this.interactive) {
        return;
      }
      this.root.scale.set(SKILL_BTN_PRESS_SCALE);
    });
    this.hitPad.on('pointerup', (event) => {
      stop(event);
      this.root.scale.set(1);
    });
    this.hitPad.on('pointerupoutside', (event) => {
      stop(event);
      this.root.scale.set(1);
    });
    this.hitPad.on('pointercancel', (event) => {
      stop(event);
      this.root.scale.set(1);
    });
    this.hitPad.on('pointertap', (event) => {
      stop(event);
      this.root.scale.set(1);
      if (!this.interactive) {
        return;
      }
      this.onTap();
    });
  }

  private redrawHitPad(): void {
    const pad = SKILL_BTN_HIT_PAD_PX;
    const w = this.displayW + pad * 2;
    const h = this.displayH + pad * 2;
    this.hitPad.clear();
    this.hitPad
      .rect(-pad, -pad, w, h)
      .fill({ color: 0xffffff, alpha: 0.001 });
    this.hitPad.hitArea = new Rectangle(-pad, -pad, w, h);
  }
}
