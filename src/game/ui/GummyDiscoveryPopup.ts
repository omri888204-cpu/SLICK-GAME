import { Container, Graphics, Text } from 'pixi.js';
import { GlowFilter } from 'pixi-filters';
import { tunedBloom, tunedBlur, tunedUiAlpha, tunedUiStroke } from '../../config/game.config';
import { gummyBearAccentColor, type GummyBearName } from '../constants/gummyBears';

const POPUP_DURATION_SEC = 2;
const FADE_OUT_SEC = 0.35;
const POPUP_W = 240;
const POPUP_H = 94;
const CORNER_MARGIN_X = 10;
/** Upper-right corner, below pause coin — keeps playfield clear. */
const CORNER_MARGIN_Y = 94;

type CandyParticle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  radius: number;
  color: number;
};

function easeOutBack(t: number): number {
  const c1 = 1.28;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}

/** First-time gummy discovery — small corner card (not center-screen). */
export class GummyDiscoveryPopup extends Container {
  private readonly glow = new Graphics();
  private readonly panelGlowFilter: GlowFilter;
  private readonly panel = new Graphics();
  private readonly particleLayer = new Graphics();
  private readonly titleText: Text;
  private readonly nameText: Text;
  private readonly subtitleText: Text;

  private viewportW = 360;
  private viewportH = 640;
  private elapsedSec = 0;
  private active = false;
  private accentColor = 0xffcc66;
  private particles: CandyParticle[] = [];

  constructor() {
    super();
    this.eventMode = 'none';
    this.sortableChildren = true;
    this.pivot.set(POPUP_W * 0.5, POPUP_H * 0.5);

    this.panelGlowFilter = new GlowFilter({
      distance: tunedBloom(8),
      outerStrength: tunedBloom(1.05),
      innerStrength: tunedBloom(0.45),
      color: 0xffaacc,
      alpha: tunedBloom(0.34),
      quality: tunedBloom(0.14),
    });
    this.panel.filters = [this.panelGlowFilter];

    this.titleText = new Text({
      text: '✨ NEW GUMMY DISCOVERED ✨',
      style: {
        fill: '#fff8ff',
        fontFamily: 'Orbitron, Urbanist, Heebo, Arial Black, sans-serif',
        fontSize: 9.5,
        fontWeight: '800',
        align: 'center',
        letterSpacing: 0.3,
        dropShadow: {
          color: '#ff88cc',
          alpha: 0.38,
          blur: tunedBlur(4),
          angle: 0,
          distance: 0,
        },
      },
    });
    this.nameText = new Text({
      text: '',
      style: {
        fill: '#ffe566',
        fontFamily: 'Urbanist, Heebo, Orbitron, Arial Black, sans-serif',
        fontSize: 16,
        fontWeight: '900',
        align: 'center',
        stroke: { color: '#4a2040', width: tunedUiStroke(2.8) },
        dropShadow: {
          color: '#ffd700',
          alpha: 0.38,
          blur: tunedBlur(4),
          angle: 0,
          distance: 0,
        },
      },
    });
    this.subtitleText = new Text({
      text: 'added to your collection',
      style: {
        fill: '#efe0ff',
        fontFamily: 'Urbanist, Heebo, Orbitron, Arial, sans-serif',
        fontSize: 9.5,
        fontWeight: '700',
        align: 'center',
        wordWrap: true,
        wordWrapWidth: POPUP_W - 20,
        stroke: { color: '#2a1038', width: tunedUiStroke(1.8) },
      },
    });

    for (const t of [this.titleText, this.nameText, this.subtitleText]) {
      t.anchor.set(0.5);
      t.eventMode = 'none';
    }

    this.titleText.position.set(0, -POPUP_H * 0.5 + 15);
    this.nameText.position.set(0, -3);
    this.subtitleText.position.set(0, POPUP_H * 0.5 - 16);

    this.addChild(this.glow, this.panel, this.particleLayer, this.titleText, this.nameText, this.subtitleText);
    this.visible = false;
    this.alpha = 0;
  }

  layout(viewportW: number, viewportH: number): void {
    this.viewportW = Math.max(280, viewportW);
    this.viewportH = Math.max(480, viewportH);
    this.position.set(
      this.viewportW - CORNER_MARGIN_X - POPUP_W * 0.5,
      CORNER_MARGIN_Y + POPUP_H * 0.5,
    );
    if (this.active) {
      this.redrawPanel();
    }
  }

  show(gummyName: GummyBearName): void {
    this.accentColor = gummyBearAccentColor(gummyName);
    this.panelGlowFilter.color = this.accentColor;
    this.nameText.text = gummyName;
    this.subtitleText.text = 'added to your collection';

    this.elapsedSec = 0;
    this.active = true;
    this.visible = true;
    this.alpha = 0;
    this.scale.set(0.86);
    this.particles = [];
    this.spawnParticles(4);
    this.redrawPanel();
    this.layout(this.viewportW, this.viewportH);
  }

  tick(dt: number): void {
    if (!this.active) {
      return;
    }

    this.elapsedSec += dt;
    const t = this.elapsedSec;

    if (t < 0.15) {
      const u = t / 0.15;
      this.alpha = Math.min(1, u * 1.1);
      this.scale.set(0.86 + 0.16 * easeOutBack(u));
    } else if (t < POPUP_DURATION_SEC - FADE_OUT_SEC) {
      this.alpha = 1;
      this.scale.set(1 + 0.012 * Math.sin(t * 5.5));
    } else {
      const fadeT = (t - (POPUP_DURATION_SEC - FADE_OUT_SEC)) / FADE_OUT_SEC;
      this.alpha = Math.max(0, 1 - fadeT);
      this.scale.set(1 - fadeT * 0.03);
      if (fadeT >= 1) {
        this.hide();
      }
    }

    const pulse = 0.5 + 0.5 * Math.sin(t * 6);
    this.panelGlowFilter.outerStrength = tunedBloom(0.85 + 0.22 * pulse);
    this.panelGlowFilter.alpha = tunedBloom(0.28 + 0.12 * pulse);
    this.redrawGlow(pulse);
    this.updateParticles(dt);
  }

  private hide(): void {
    this.active = false;
    this.visible = false;
    this.particles = [];
    this.particleLayer.clear();
  }

  private redrawPanel(): void {
    const w = POPUP_W;
    const h = POPUP_H;
    const r = 13;
    const ox = -w * 0.5;
    const oy = -h * 0.5;

    this.panel.clear();
    this.panel.roundRect(ox, oy, w, h, r);
    this.panel.fill({ color: 0x180828, alpha: tunedUiAlpha(0.86) });
    this.panel.roundRect(ox, oy, w, h, r);
    this.panel.stroke({ width: 2, color: this.accentColor, alpha: 0.68 });
    this.panel.roundRect(ox + 3, oy + 3, w - 6, h - 6, r - 2);
    this.panel.stroke({ width: 1, color: 0xffffff, alpha: 0.12 });
  }

  private redrawGlow(pulse: number): void {
    this.glow.clear();
    const w = POPUP_W;
    const h = POPUP_H;
    const ox = -w * 0.5;
    const oy = -h * 0.5;
    this.glow
      .roundRect(ox - 2, oy - 2, w + 4, h + 4, 14)
      .fill({ color: this.accentColor, alpha: 0.03 + 0.04 * pulse });
  }

  private spawnParticles(count: number): void {
    for (let i = 0; i < count; i += 1) {
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.15;
      const speed = 14 + Math.random() * 22;
      this.particles.push({
        x: (Math.random() - 0.5) * 10,
        y: (Math.random() - 0.5) * 4,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 8,
        age: 0,
        life: 0.28 + Math.random() * 0.22,
        radius: 1.2 + Math.random() * 1.4,
        color: this.accentColor,
      });
    }
  }

  private updateParticles(dt: number): void {
    this.particleLayer.clear();
    const next: CandyParticle[] = [];

    for (const p of this.particles) {
      p.age += dt;
      if (p.age >= p.life) {
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 24 * dt;
      const fade = 1 - p.age / p.life;
      this.particleLayer.circle(p.x, p.y, p.radius * fade);
      this.particleLayer.fill({ color: p.color, alpha: fade * 0.5 });
      next.push(p);
    }

    this.particles = next;
  }

  override destroy(options?: Parameters<Container['destroy']>[0]): void {
    this.panelGlowFilter.destroy();
    super.destroy(options);
  }
}
