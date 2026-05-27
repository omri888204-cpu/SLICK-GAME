import { Container, Sprite, type Texture } from 'pixi.js';
import {
  MENU_MOOD_CYCLE_SEC,
  MENU_PLAYER_SCALE_MULT,
  PLAYER_AVATAR_SCALE,
} from '../constants/playerSkin';
import { MENU_PLAY_TRANSITION } from './MenuPlayTransition';

/** Menu avatar — mood cycle on home screen, jump strip on PLAY. */
export class MenuPlayerAvatar extends Container {
  private readonly body = new Sprite();

  private moodFrames: Texture[] = [];
  private jumpFrames: Texture[] = [];
  private moodFrameIndex = 0;
  private jumpFrameIndex = 0;
  private moodAnimAccumSec = 0;
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

  /** Cycles joke / happy / think / mad on the main menu. */
  setMoodFrames(frames: Texture[], feetAnchorY = 1): void {
    this.moodFrames = frames;
    this.feetAnchorY = feetAnchorY;
    this.moodFrameIndex = 0;
    this.moodAnimAccumSec = 0;
    const frame = frames[0];
    if (!frame || frame.height <= 0) {
      this.visible = false;
      return;
    }
    this.visible = true;
    this.body.texture = frame;
    this.body.anchor.set(0.5, feetAnchorY);
  }

  setIdleFrames(frames: Texture[], feetAnchorY = 1): void {
    this.setMoodFrames(frames, feetAnchorY);
  }

  setIdleFrame(frame: Texture | undefined, feetAnchorY = 1): void {
    this.setMoodFrames(frame ? [frame] : [], feetAnchorY);
  }

  setJumpFrames(frames: Texture[]): void {
    this.jumpFrames = frames.length > 0 ? frames : this.moodFrames;
    this.jumpFrameIndex = 0;
  }

  setJumpFrame(frame: Texture | undefined): void {
    this.setJumpFrames(frame ? [frame] : []);
  }

  tickMoods(dtSec: number): void {
    if (this.moodFrames.length <= 1) {
      return;
    }
    this.moodAnimAccumSec += dtSec;
    while (this.moodAnimAccumSec >= MENU_MOOD_CYCLE_SEC) {
      this.moodAnimAccumSec -= MENU_MOOD_CYCLE_SEC;
      this.moodFrameIndex = (this.moodFrameIndex + 1) % this.moodFrames.length;
      this.body.texture = this.moodFrames[this.moodFrameIndex]!;
    }
  }

  /** @deprecated Use {@link tickMoods}. */
  tickIdle(dtSec: number): void {
    this.tickMoods(dtSec);
  }

  layout(viewportH: number, feetX: number, feetY: number, viewportW?: number): void {
    const frame = this.moodFrames[0] ?? this.body.texture;
    if (!frame || frame.height <= 0) {
      return;
    }

    if (viewportW != null) {
      this.viewportW = viewportW;
    }

    const targetHeight = viewportH * 0.14 * PLAYER_AVATAR_SCALE * MENU_PLAYER_SCALE_MULT;
    const visibleHeight = frame.height * this.feetAnchorY;
    this.baseScale = targetHeight / Math.max(1, visibleHeight);
    this.baseFeetX = feetX;
    this.baseFeetY = feetY;

    this.position.set(feetX, feetY);
    this.alpha = 1;
    this.body.scale.set(this.baseScale);
    this.body.y = 0;
    this.body.rotation = 0;
    if (this.moodFrames.length > 0) {
      this.body.texture = this.moodFrames[this.moodFrameIndex] ?? this.moodFrames[0]!;
    }
  }

  tickTransitionJump(transitionElapsedSec: number, viewportH: number, viewportW?: number): void {
    if (viewportW != null) {
      this.viewportW = viewportW;
    }

    const cfg = MENU_PLAY_TRANSITION;
    const jumpLeadSec = cfg.playerJumpLeadSec;
    const jumpT = Math.min(1, Math.max(0, transitionElapsedSec) / jumpLeadSec);
    const hop = Math.sin(jumpT * Math.PI);
    const climb = jumpT ** 0.72;
    const jumpHeight = viewportH * cfg.playerJumpHeightNorm;
    const yOffset = -(hop * jumpHeight * 0.28 + climb * jumpHeight * 1.5);
    const towardCloudsX = (this.viewportW * cfg.focusNormX - this.baseFeetX) * climb * 0.22;

    this.position.set(this.baseFeetX + towardCloudsX, this.baseFeetY + yOffset);
    this.body.rotation = -0.16 * hop;
    this.body.y = 0;

    if (this.moodFrames.length > 0) {
      this.body.texture = this.moodFrames[this.moodFrameIndex] ?? this.moodFrames[0]!;
    }

    this.alpha = 1;
  }
}
