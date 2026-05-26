import { Container, Graphics, Sprite, type DestroyOptions } from 'pixi.js';
import type { RunSpeedClock } from '../systems/RunSpeedClock';
import { loadLogoTextureTransparent } from '../utils/logoTexture';

const WATCH_FRAME_URL = `${import.meta.env.BASE_URL}assets/objects/${encodeURIComponent('watch 1.png')}`;
/** Target painted height on a ~640px-tall portrait viewport (downscale only — never upscaled). */
const WATCH_DISPLAY_HEIGHT_PX = 96;
/** Dial hub — below sprite midpoint (top stopwatch buttons). */
const DIAL_CENTER_Y_PX = 10;

/** Run-speed clock HUD — `watch 1.png` frame + procedural candy hand. */
export class SpeedClockHud extends Container {
  private readonly dialRoot = new Container();
  private readonly frame = new Sprite();
  private readonly handPivot = new Container();
  private readonly handShadow = new Graphics();
  private readonly hand = new Graphics();
  private layoutScale = 1;
  private frameReady = false;

  constructor(private readonly clock: RunSpeedClock) {
    super();
    this.eventMode = 'none';
    this.frame.anchor.set(0.5);
    this.frame.eventMode = 'none';
    this.handPivot.eventMode = 'none';
    this.handShadow.eventMode = 'none';
    this.hand.eventMode = 'none';

    this.handPivot.position.set(0, DIAL_CENTER_Y_PX);
    this.handPivot.addChild(this.handShadow, this.hand);

    this.frame.zIndex = 0;
    this.handPivot.zIndex = 1;
    this.dialRoot.sortableChildren = true;
    this.dialRoot.addChild(this.frame, this.handPivot);
    this.addChild(this.dialRoot);

    this.drawHand();

    void loadLogoTextureTransparent(WATCH_FRAME_URL).then((frameTex) => {
      frameTex.source.scaleMode = 'linear';
      this.frame.texture = frameTex;
      const frameScale = Math.min(WATCH_DISPLAY_HEIGHT_PX / Math.max(1, frameTex.height), 1);
      this.frame.scale.set(frameScale);
      this.frameReady = true;
      this.syncHandRotation();
      this.applyLayoutScale();
    });
  }

  layout(viewportW: number, viewportH: number, x = 14, y = 108): void {
    const ref = Math.min(Math.max(280, viewportW), Math.max(480, viewportH));
    this.layoutScale = ref < 380 ? 0.92 : ref > 760 ? 1 : 0.96;
    this.position.set(x, y);
    this.applyLayoutScale();
  }

  tick(_dt: number): void {
    if (!this.frameReady) {
      return;
    }
    this.syncHandRotation();
  }

  /** Candy arrow hand — drawn up (−Y); pivot = dial center. */
  private drawHand(): void {
    const handLen = WATCH_DISPLAY_HEIGHT_PX * 0.252;
    const hubR = WATCH_DISPLAY_HEIGHT_PX * 0.046;
    const shaftW = hubR * 1.08;
    const tipY = -handLen;

    this.handShadow.clear();
    this.hand.clear();

    this.handShadow.moveTo(0.8, 1.2);
    this.handShadow.lineTo(0.8, tipY + 2);
    this.handShadow.stroke({ width: shaftW + 1.4, color: 0x660033, alpha: 0.28, cap: 'round' });

    this.hand.moveTo(0, -hubR * 0.25);
    this.hand.lineTo(0, tipY + hubR * 0.55);
    this.hand.stroke({ width: shaftW, color: 0xff2277, alpha: 0.98, cap: 'round', join: 'round' });

    this.hand.moveTo(-shaftW * 0.18, -hubR * 0.5);
    this.hand.lineTo(-shaftW * 0.14, tipY + hubR * 0.75);
    this.hand.stroke({ width: shaftW * 0.28, color: 0xffaad8, alpha: 0.8, cap: 'round' });

    this.hand.moveTo(-hubR * 0.72, tipY + hubR * 0.62);
    this.hand.lineTo(0, tipY - hubR * 0.28);
    this.hand.lineTo(hubR * 0.72, tipY + hubR * 0.62);
    this.hand.closePath();
    this.hand.fill({ color: 0xff3388, alpha: 0.97 });
    this.hand.stroke({ width: 1, color: 0xffffff, alpha: 0.45 });

    this.hand.circle(-hubR * 0.18, tipY + hubR * 0.08, hubR * 0.26);
    this.hand.fill({ color: 0xffffff, alpha: 0.88 });

    this.hand.circle(0, 0, hubR);
    this.hand.fill({ color: 0xff1155, alpha: 0.98 });
    this.hand.circle(0, 0, hubR);
    this.hand.stroke({ width: 1.3, color: 0xffffff, alpha: 0.62 });
    this.hand.circle(0, 0, hubR * 0.42);
    this.hand.fill({ color: 0xffffff, alpha: 0.84 });
  }

  private syncHandRotation(): void {
    /** Hand art points up; {@link RunSpeedClock.handAngleRad} is 12 o'clock at cycle start. */
    this.handPivot.rotation = this.clock.handAngleRad + Math.PI / 2;
  }

  private applyLayoutScale(): void {
    this.scale.set(this.layoutScale);
  }

  override destroy(options?: DestroyOptions): void {
    super.destroy(options);
  }
}
