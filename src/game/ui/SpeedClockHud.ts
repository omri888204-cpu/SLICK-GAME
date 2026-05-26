import { Container, Graphics, Text } from 'pixi.js';
import { GlowFilter } from 'pixi-filters';
import { tunedBloom, tunedBlur, tunedUiStroke } from '../../config/game.config';
import type { RunSpeedClock } from '../systems/RunSpeedClock';

const CLOCK_RADIUS = 44;
const HAND_LENGTH = 30;

/** Analog run-speed clock — tier label + rotating hand (screen-fixed on `uiLayer`). */
export class SpeedClockHud extends Container {
  private readonly glow = new Graphics();
  private readonly maxTierGlow: GlowFilter;
  private readonly face = new Graphics();
  private readonly ring = new Graphics();
  private readonly hand = new Graphics();
  private readonly tierText: Text;

  private viewportW = 360;
  private viewportH = 640;
  private displayedTier = 1;
  private pulseScale = 1;

  constructor(private readonly clock: RunSpeedClock) {
    super();
    this.eventMode = 'none';
    this.sortableChildren = true;

    this.maxTierGlow = new GlowFilter({
      distance: tunedBloom(10),
      outerStrength: tunedBloom(1.4),
      innerStrength: tunedBloom(0.55),
      color: 0xffd866,
      alpha: tunedBloom(0.5),
      quality: tunedBloom(0.16),
    });

    this.tierText = new Text({
      text: '×1',
      style: {
        fill: '#fff8e8',
        fontFamily: 'Orbitron, Urbanist, Heebo, Arial Black, sans-serif',
        fontSize: 15,
        fontWeight: '900',
        align: 'center',
        stroke: { color: '#4a2800', width: tunedUiStroke(2.6) },
        dropShadow: {
          color: '#ffd866',
          alpha: 0.45,
          blur: tunedBlur(4),
          angle: 0,
          distance: 0,
        },
      },
    });
    this.tierText.anchor.set(0.5);
    this.tierText.eventMode = 'none';

    this.glow.zIndex = 0;
    this.face.zIndex = 1;
    this.ring.zIndex = 2;
    this.hand.zIndex = 3;
    this.tierText.zIndex = 4;

    this.addChild(this.glow, this.face, this.ring, this.hand, this.tierText);
    this.redrawStaticFace();
    this.redrawHand(0);
  }

  private maxGlowActive = false;

  layout(viewportW: number, viewportH: number, x = 14, y = 118): void {
    this.viewportW = Math.max(280, viewportW);
    this.viewportH = Math.max(480, viewportH);
    this.position.set(x, y);
  }

  syncFromClock(): void {
    const tier = this.clock.currentTier;
    if (tier !== this.displayedTier) {
      this.displayedTier = tier;
      this.tierText.text = `×${tier}`;
    }

    const pulseT = this.clock.tierPulseRemainingSec;
    if (pulseT > 0) {
      const u = 1 - pulseT / 0.22;
      this.pulseScale = 1 + 0.14 * Math.sin(u * Math.PI);
      this.ring.alpha = 1;
    } else {
      this.pulseScale = 1;
      this.ring.alpha = 0.92;
    }

    this.scale.set(this.pulseScale);
    this.redrawHand(this.clock.handAngleRad);

    if (this.clock.isAtMaxTier) {
      if (!this.maxGlowActive) {
        this.filters = [this.maxTierGlow];
        this.maxGlowActive = true;
      }
      const pulse = 0.5 + 0.5 * Math.sin(this.clock.elapsed * 4.2);
      this.maxTierGlow.alpha = tunedBloom(0.42 + 0.18 * pulse);
      this.glow.visible = true;
      this.glow.clear();
      this.glow.circle(0, 0, CLOCK_RADIUS + 10);
      this.glow.fill({ color: 0xffe066, alpha: 0.06 + 0.05 * pulse });
    } else {
      if (this.maxGlowActive) {
        this.filters = [];
        this.maxGlowActive = false;
      }
      this.glow.visible = false;
      this.glow.clear();
    }
  }

  private redrawStaticFace(): void {
    this.face.clear();
    this.face.circle(0, 0, CLOCK_RADIUS);
    this.face.fill({ color: 0xf8e8ff, alpha: 0.92 });
    this.face.circle(0, 0, CLOCK_RADIUS - 8);
    this.face.fill({ color: 0xfff4fb, alpha: 0.55 });

    this.ring.clear();
    this.ring.circle(0, 0, CLOCK_RADIUS + 2);
    this.ring.stroke({ width: 3, color: 0xffe08a, alpha: 0.9 });
    this.ring.circle(0, 0, CLOCK_RADIUS + 2);
    this.ring.stroke({ width: 1.2, color: 0xffffff, alpha: 0.55 });

    for (let i = 0; i < 12; i += 1) {
      const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
      const inner = CLOCK_RADIUS - (i % 3 === 0 ? 10 : 6);
      const outer = CLOCK_RADIUS - 3;
      this.ring.moveTo(Math.cos(a) * inner, Math.sin(a) * inner);
      this.ring.lineTo(Math.cos(a) * outer, Math.sin(a) * outer);
      this.ring.stroke({ width: i % 3 === 0 ? 2 : 1, color: 0xc8a8e8, alpha: 0.55 });
    }
  }

  private redrawHand(angleRad: number): void {
    this.hand.clear();
    this.hand.circle(0, 0, 4.5);
    this.hand.fill({ color: 0xff5588, alpha: 0.95 });
    this.hand.moveTo(0, 0);
    this.hand.lineTo(Math.cos(angleRad) * HAND_LENGTH, Math.sin(angleRad) * HAND_LENGTH);
    this.hand.stroke({ width: 3.2, color: 0xff3366, alpha: 0.95, cap: 'round' });
    this.hand.circle(Math.cos(angleRad) * HAND_LENGTH, Math.sin(angleRad) * HAND_LENGTH, 2.2);
    this.hand.fill({ color: 0xffffff, alpha: 0.9 });
  }

  override destroy(options?: Parameters<Container['destroy']>[0]): void {
    this.maxTierGlow.destroy();
    super.destroy(options);
  }
}
