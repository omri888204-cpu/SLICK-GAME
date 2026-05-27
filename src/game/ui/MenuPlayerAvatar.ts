import { Container, Sprite, type Texture } from 'pixi.js';
import {
  MENU_MOOD_CYCLE_SEC,
  MENU_PLAYER_SCALE_MULT,
  PLAYER_AVATAR_SCALE,
} from '../constants/playerSkin';

function smoothstep(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

function easeInCubic(t: number): number {
  return t * t * t;
}

/** Menu avatar — mood cycle, idle breath, portal suction on PLAY. */
export class MenuPlayerAvatar extends Container {
  private readonly body = new Sprite();

  private moodFrames: Texture[] = [];
  private moodFrameIndex = 0;
  private moodAnimAccumSec = 0;
  private breathTimeSec = 0;
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

  setMoodFrames(frames: Texture[], feetAnchorY = 1): void {
    this.moodFrames = frames;
    this.feetAnchorY = feetAnchorY;
    this.moodFrameIndex = 0;
    this.moodAnimAccumSec = 0;
    this.breathTimeSec = 0;
    const frame = frames[0];
    if (!frame || frame.height <= 0) {
      this.visible = false;
      return;
    }
    this.visible = true;
    this.body.texture = frame;
    this.body.anchor.set(0.5, feetAnchorY);
    this.applyBodyPose(1, 0);
  }

  setIdleFrames(frames: Texture[], feetAnchorY = 1): void {
    this.setMoodFrames(frames, feetAnchorY);
  }

  setIdleFrame(frame: Texture | undefined, feetAnchorY = 1): void {
    this.setMoodFrames(frame ? [frame] : [], feetAnchorY);
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

  tickIdle(dtSec: number): void {
    this.tickMoods(dtSec);
    this.tickBreath(dtSec);
  }

  tickBreath(dtSec: number): void {
    this.breathTimeSec += dtSec;
    this.applyBodyPose(1, 0);
  }

  /**
   * Suction into the painted menu portal — slide, stretch, shrink, fade.
   * @param suctionT 0..1 from {@link MenuPlayTransition}
   */
  tickPortalSuction(suctionT: number, portalX: number, portalY: number): void {
    const t = smoothstep(Math.max(0, Math.min(1, suctionT)));
    if (t <= 0.001) {
      this.position.set(this.baseFeetX, this.baseFeetY);
      this.alpha = 1;
      this.applyBodyPose(1, 0);
      return;
    }

    const pull = easeInCubic(t);
    const hop = Math.sin(t * Math.PI) * 0.08;
    this.position.set(
      this.baseFeetX + (portalX - this.baseFeetX) * pull,
      this.baseFeetY + (portalY - this.baseFeetY) * pull - hop * 28,
    );

    const toward = Math.atan2(portalY - this.baseFeetY, portalX - this.baseFeetX);
    this.body.rotation = toward * 0.06 * pull + Math.sin(t * 14) * 0.04 * (1 - t);

    const stretch = 1 + 0.22 * pull;
    const squash = 1 - 0.12 * pull;
    const shrink = 1 - 0.82 * t;
    this.applyBodyPose(shrink, pull, stretch, squash);

    this.alpha = 1 - t * 0.95;
    this.visible = this.alpha > 0.02;
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
    this.body.y = 0;
    this.body.rotation = 0;
    if (this.moodFrames.length > 0) {
      this.body.texture = this.moodFrames[this.moodFrameIndex] ?? this.moodFrames[0]!;
    }
    this.applyBodyPose(1, 0);
  }

  private applyBodyPose(
    scaleMul: number,
    suctionPull: number,
    stretchX = 1,
    stretchY = 1,
  ): void {
    const breath = 1 + 0.028 * Math.sin(this.breathTimeSec * 2.1);
    const sx = this.baseScale * scaleMul * stretchX * breath;
    const sy = this.baseScale * scaleMul * stretchY * (breath - suctionPull * 0.04);
    this.body.scale.set(sx, sy);
  }
}
