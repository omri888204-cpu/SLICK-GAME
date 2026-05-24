import { Container, Sprite, type Texture } from 'pixi.js';
import { MENU_PLAY_TRANSITION } from './MenuPlayTransition';

/** Static idle avatar for the main menu — on the pink deck above PLAY. */
export class MenuPlayerAvatar extends Container {
  private readonly body = new Sprite();

  private idleFrame?: Texture;
  private jumpFrame?: Texture;
  private baseScale = 1;
  private feetAnchorY = 1;
  private baseFeetX = 0;
  private baseFeetY = 0;
  private viewportW = 360;

  constructor() {
    super();
    this.eventMode = 'none';
    this.body.eventMode = 'none';
    this.addChild(this.body);
  }

  setIdleFrame(frame: Texture | undefined, feetAnchorY = 1): void {
    this.idleFrame = frame;
    this.feetAnchorY = feetAnchorY;
    if (!frame || frame.height <= 0) {
      this.visible = false;
      return;
    }
    this.visible = true;
    this.body.texture = frame;
    this.body.anchor.set(0.5, feetAnchorY);
  }

  setJumpFrame(frame: Texture | undefined): void {
    this.jumpFrame = frame;
  }

  layout(viewportH: number, feetX: number, feetY: number, viewportW?: number): void {
    const frame = this.idleFrame ?? this.body.texture;
    if (!frame || frame.height <= 0) {
      return;
    }

    if (viewportW != null) {
      this.viewportW = viewportW;
    }

    const targetHeight = viewportH * 0.14;
    const visibleHeight = frame.height * this.feetAnchorY;
    this.baseScale = targetHeight / Math.max(1, visibleHeight);
    this.baseFeetX = feetX;
    this.baseFeetY = feetY;

    this.position.set(feetX, feetY);
    this.alpha = 1;
    this.body.scale.set(this.baseScale);
    this.body.y = 0;
    this.body.rotation = 0;
    if (this.idleFrame) {
      this.body.texture = this.idleFrame;
    }
  }

  /** Jump toward the clouds — handoff fires at arc peak from {@link MenuPlayTransition}. */
  tickTransitionJump(transitionElapsedSec: number, viewportH: number, viewportW?: number): void {
    if (viewportW != null) {
      this.viewportW = viewportW;
    }

    const cfg = MENU_PLAY_TRANSITION;
    const jumpLeadSec = cfg.playerJumpLeadSec;
    const jumpStartSec = cfg.totalSec - jumpLeadSec;

    if (transitionElapsedSec < jumpStartSec) {
      this.position.set(this.baseFeetX, this.baseFeetY);
      this.alpha = 1;
      this.body.y = 0;
      this.body.rotation = 0;
      if (this.idleFrame) {
        this.body.texture = this.idleFrame;
      }
      return;
    }

    const jumpT = Math.min(1, (transitionElapsedSec - jumpStartSec) / jumpLeadSec);
    const hop = Math.sin(jumpT * Math.PI);
    const climb = jumpT ** 0.72;
    const jumpHeight = viewportH * cfg.playerJumpHeightNorm;
    const yOffset = -(hop * jumpHeight * 0.22 + climb * jumpHeight * 1.55);
    const towardCloudsX = (this.viewportW * cfg.focusNormX - this.baseFeetX) * climb * 0.22;

    this.position.set(this.baseFeetX + towardCloudsX, this.baseFeetY + yOffset);
    this.body.rotation = -0.14 * hop;
    this.body.texture = this.jumpFrame ?? this.idleFrame ?? this.body.texture;
    this.alpha = 1;
  }
}
