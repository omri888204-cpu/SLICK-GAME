import { Container, Graphics, Text, type DestroyOptions } from 'pixi.js';
import { GlowFilter } from 'pixi-filters';
import { COMBO, SCORE_UI } from '../../config/game.config';

type HudBurstParticle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  hue: number;
  size: number;
  isStar: boolean;
};

function hslToFill(h: number, s: number, l: number): number {
  let hue = h % 360;
  if (hue < 0) {
    hue += 360;
  }

  s = Math.max(0, Math.min(100, s)) / 100;
  l = Math.max(0, Math.min(100, l)) / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  let rp = 0;
  let gp = 0;
  let bp = 0;

  if (hue < 60) {
    rp = c;
    gp = x;
  } else if (hue < 120) {
    rp = x;
    gp = c;
  } else if (hue < 180) {
    gp = c;
    bp = x;
  } else if (hue < 240) {
    gp = x;
    bp = c;
  } else if (hue < 300) {
    rp = x;
    bp = c;
  } else {
    rp = c;
    bp = x;
  }

  const r = Math.round((rp + m) * 255);
  const g = Math.round((gp + m) * 255);
  const b = Math.round((bp + m) * 255);
  return (r << 16) | (g << 8) | b;
}

/**
 * Hyper-juicy scoreboard: neon vector frame, punch, rainbow ramp, glow, star/confetti bursts.
 */
export class HyperScoreboard extends Container {
  private readonly panel = new Graphics();
  private readonly particleLayer = new Graphics();
  private readonly readoutRoot = new Container();
  private readonly scoreShadow: Text;
  private readonly scoreValue: Text;
  private readonly multLabel: Text;
  private readonly heightLabel: Text;
  private readonly titleLabel: Text;
  private readonly hintLabel: Text;
  private readonly glowFilter: GlowFilter;

  private punchAge = 0;
  private punchTwist = 0;
  private depthKick = 0;
  private burstParticles: HudBurstParticle[] = [];
  private screenW = 800;
  private panelW = 600;
  /** Horizontal bar height (compact vector HUD). */
  private panelH = 56;

  constructor() {
    super();

    const strokeHeavy = { color: '#0a0012', width: 7 };
    const titleStyle = {
      fill: '#d4ff33',
      fontFamily: 'Arial Black, Impact, sans-serif',
      fontSize: 11,
      letterSpacing: 1,
      stroke: { color: '#1a0028', width: 4 },
    };
    const hintStyle = {
      fill: '#ff4dc4',
      fontFamily: 'Impact, Arial Black, sans-serif',
      fontSize: 10,
      letterSpacing: 0.5,
      stroke: { color: '#200018', width: 3 },
    };

    this.titleLabel = new Text({ text: 'SLICK', style: titleStyle });
    this.titleLabel.position.set(12, 11);

    this.scoreShadow = new Text({
      text: '0',
      style: {
        fill: '#080410',
        fontFamily: 'Arial Black, Impact, sans-serif',
        fontSize: 34,
        stroke: strokeHeavy,
        dropShadow: {
          alpha: 1,
          angle: Math.PI / 4,
          blur: 0,
          color: '#000000',
          distance: 0,
        },
      },
    });
    this.scoreShadow.anchor.set(0.5, 0.5);
    this.scoreShadow.position.set(6, 6);

    this.scoreValue = new Text({
      text: '0',
      style: {
        fill: '#d6ff4a',
        fontFamily: 'Arial Black, Impact, sans-serif',
        fontSize: 34,
        stroke: strokeHeavy,
        dropShadow: {
          alpha: 0.65,
          angle: Math.PI / 4,
          blur: 3,
          color: '#39ffb5',
          distance: 4,
        },
      },
    });
    this.scoreValue.anchor.set(0.5, 0.5);
    this.scoreValue.position.set(0, 0);

    this.multLabel = new Text({
      text: 'x1',
      style: {
        fill: '#ff3cac',
        fontFamily: 'Arial Black, Impact, sans-serif',
        fontSize: 22,
        stroke: { color: '#120018', width: 5 },
        dropShadow: {
          alpha: 0.75,
          angle: Math.PI / 4,
          blur: 2,
          color: '#b026ff',
          distance: 3,
        },
      },
    });
    this.multLabel.anchor.set(0, 0.5);

    const altStyle = {
      fill: '#8cffee',
      fontFamily: 'Impact, Arial Black, sans-serif',
      fontSize: 13,
      letterSpacing: 0.5,
      stroke: { color: '#0a0818', width: 3 },
    };
    this.heightLabel = new Text({ text: '0 m', style: altStyle });
    this.heightLabel.anchor.set(0, 0.5);

    this.hintLabel = new Text({
      text: 'A/D  ·  SPACE  ·  E',
      style: hintStyle,
    });
    this.hintLabel.anchor.set(1, 0.5);

    this.readoutRoot.addChild(this.scoreShadow, this.scoreValue);
    this.glowFilter = new GlowFilter({
      distance: 14,
      outerStrength: 2.4,
      innerStrength: 0,
      color: 0xd946ef,
      alpha: 0.72,
      quality: 0.22,
    });
    this.readoutRoot.filters = [this.glowFilter];

    this.addChild(
      this.panel,
      this.particleLayer,
      this.titleLabel,
      this.readoutRoot,
      this.multLabel,
      this.heightLabel,
      this.hintLabel,
    );
    this.particleLayer.zIndex = 8;
    this.titleLabel.zIndex = 5;
    this.readoutRoot.zIndex = 6;
    this.multLabel.zIndex = 5;
    this.heightLabel.zIndex = 5;
    this.hintLabel.zIndex = 5;
    this.panel.zIndex = 2;
    this.sortableChildren = true;
    this.layoutPanel();
    this.readoutRoot.position.set(this.panelW * 0.5, this.panelH * 0.5);
  }

  onResize(screenWidth: number): void {
    this.screenW = screenWidth;
    const compact = screenWidth < 520;
    this.titleLabel.visible = !compact;
    this.hintLabel.text = compact ? 'A/D · SPC · E' : 'A/D  ·  SPACE  ·  E';
    this.layoutPanel();
    this.readoutRoot.position.set(this.panelW * 0.5, this.panelH * 0.5);
  }

  reset(): void {
    this.punchAge = 0;
    this.punchTwist = 0;
    this.depthKick = 0;
    this.burstParticles = [];
    this.readoutRoot.scale.set(1);
    this.readoutRoot.rotation = 0;
    this.readoutRoot.position.set(this.panelW * 0.5, this.panelH * 0.5);
    this.scoreShadow.position.set(6, 6);
    this.scoreValue.position.set(0, 0);
  }

  onPointsGained(delta: number): void {
    if (delta <= 0) {
      return;
    }

    this.punchAge = SCORE_UI.punchDurationSec;
    this.punchTwist = (Math.random() * 2 - 1) * SCORE_UI.punchMaxRotationRad;
    this.depthKick = 1;
  }

  triggerApexBurst(): void {
    this.spawnBurst(38, 1, false);
  }

  /** Beast Mode: heavier star/confetti mix (electric lime / hot pink bias). */
  triggerBeastBurst(): void {
    this.spawnBurst(52, 1.25, true);
  }

  private spawnBurst(count: number, speedMul: number, beastBias: boolean): void {
    const ox = this.readoutRoot.position.x;
    const oy = this.readoutRoot.position.y;

    for (let i = 0; i < count; i += 1) {
      const ang = Math.random() * Math.PI * 2;
      const sp = (90 + Math.random() * 175) * speedMul;
      let hue = Math.random() * 360;
      if (beastBias) {
        hue = Math.random() < 0.5 ? 95 + Math.random() * 35 : 320 + Math.random() * 40;
      }

      this.burstParticles.push({
        x: ox,
        y: oy,
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp - 55,
        life: 0,
        maxLife: 0.45 + Math.random() * 0.45,
        hue,
        size: 5 + Math.random() * 8,
        isStar: Math.random() < 0.55,
      });
    }
  }

  update(dt: number, score: number, mult: number, heightMeters: number, runTime: number): void {
    const midY = this.panelH * 0.5;

    if (this.punchAge > 0) {
      this.punchAge = Math.max(0, this.punchAge - dt);
      const u = 1 - this.punchAge / SCORE_UI.punchDurationSec;
      const sc =
        u < 0.42
          ? 1 + (SCORE_UI.punchPeakScale - 1) * (u / 0.42)
          : SCORE_UI.punchPeakScale -
            (SCORE_UI.punchPeakScale - 1) * ((u - 0.42) / 0.58);

      const tw = this.punchTwist * (1 - u) * (1 - u);
      this.readoutRoot.scale.set(sc);
      this.readoutRoot.rotation = tw;
    } else {
      this.readoutRoot.scale.set(1);
      this.readoutRoot.rotation *= Math.pow(0.82, dt * 60);
      if (Math.abs(this.readoutRoot.rotation) < 0.0004) {
        this.readoutRoot.rotation = 0;
      }
    }

    this.depthKick = Math.max(0, this.depthKick - dt * 3.2);
    const dk = this.depthKick * 8;
    this.scoreShadow.position.set(6 + dk, 6 + dk);
    this.scoreValue.position.set(-dk * 0.38, -dk * 0.48);

    const climbNorm = Math.min(1, heightMeters / SCORE_UI.climbBloomSaturationMeters);
    const pulse = Math.sin(runTime * SCORE_UI.rainbowPulseHz * Math.PI * 2);
    const multPulse = 1 + Math.min(mult / COMBO.maxMultiplier, 1) * 0.85;
    const hueBase =
      (runTime * 58 + mult * 62 * multPulse + pulse * 36 * mult) % 360;
    const sat = 90 + 12 * pulse * Math.min(mult / 3, 1);
    const light = 52 + 24 * climbNorm + 8 * Math.sin(runTime * 4.5 + mult);

    const scoreFill = hslToFill(hueBase, sat, light);
    const multHue = (hueBase + 140 + pulse * 22) % 360;
    const multFill = hslToFill(multHue, 94, 56);

    this.scoreValue.text = String(score);
    this.scoreShadow.text = String(score);
    this.scoreValue.style.fill = scoreFill;
    this.multLabel.text = `x${mult}`;
    this.multLabel.style.fill = multFill;
    this.heightLabel.text = `${heightMeters} m`;

    this.readoutRoot.position.set(this.panelW * 0.5, midY);

    const halfScore = this.scoreValue.width * 0.5;
    const midRight = this.panelW * 0.5 + halfScore + 14;
    this.multLabel.position.set(midRight, midY);

    this.heightLabel.position.set(midRight + this.multLabel.width + 12, midY);

    const padR = 12;
    this.hintLabel.position.set(this.panelW - padR, midY);

    this.glowFilter.outerStrength = 1.5 + climbNorm * 7.2 + mult * 0.5;
    this.glowFilter.distance = 10 + climbNorm * 18 + mult * 0.7;
    this.glowFilter.color = hslToFill((hueBase + 275) % 360, 72, 52);

    this.updateBurstParticles(dt);
    this.drawBurstParticles();
  }

  private layoutPanel(): void {
    const w = Math.min(600, Math.max(320, this.screenW - 24));
    this.panelW = w;
    this.panelH = 56;

    this.panel.clear();
    this.panel
      .roundRect(0, 0, w, this.panelH, 10)
      .fill({ color: 0x14002a, alpha: 0.82 });
    this.panel
      .roundRect(0, 0, w, this.panelH, 10)
      .stroke({ width: 2, color: 0x39ff5a, alpha: 0.95 });
    this.panel
      .roundRect(3, 3, w - 6, this.panelH - 6, 7)
      .stroke({ width: 1.5, color: 0xd946ef, alpha: 0.5 });
  }

  private updateBurstParticles(dt: number): void {
    this.burstParticles = this.burstParticles.filter((p) => {
      p.life += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 440 * dt;
      p.vx *= 1 - 1.65 * dt;
      return p.life < p.maxLife;
    });
  }

  private drawBurstParticles(): void {
    this.particleLayer.clear();
    for (const p of this.burstParticles) {
      const u = p.life / p.maxLife;
      const a = (1 - u) * 0.95;
      const c = hslToFill(p.hue % 360, 92, 56);
      const r = p.size * (1 - u * 0.32);

      if (p.isStar) {
        this.drawStarParticle(p.x, p.y, r, c, a, p.life * 8);
      } else {
        this.particleLayer.circle(p.x, p.y, r).fill({ color: c, alpha: a });
        this.particleLayer
          .circle(p.x - r * 0.35, p.y - r * 0.2, r * 0.28)
          .fill({ color: 0xffffff, alpha: a * 0.5 });
      }
    }
  }

  private drawStarParticle(x: number, y: number, r: number, color: number, alpha: number, rot: number): void {
    const spikes = 4;
    const inner = r * 0.38;
    for (let i = 0; i < spikes; i += 1) {
      const t1 = rot + (i * Math.PI * 2) / spikes;
      const t2 = rot + ((i + 0.5) * Math.PI * 2) / spikes;
      const x1 = x + Math.cos(t1) * r;
      const y1 = y + Math.sin(t1) * r;
      const x2 = x + Math.cos(t2) * inner;
      const y2 = y + Math.sin(t2) * inner;
      this.particleLayer
        .moveTo(x, y)
        .lineTo(x1, y1)
        .lineTo(x2, y2)
        .lineTo(x, y)
        .fill({ color, alpha });
    }
    this.particleLayer.circle(x, y, r * 0.22).fill({ color: 0xffffff, alpha: alpha * 0.65 });
  }

  destroy(options?: DestroyOptions): void {
    this.readoutRoot.filters = null;
    super.destroy(options);
  }
}
