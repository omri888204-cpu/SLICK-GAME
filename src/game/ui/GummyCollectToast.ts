import { Container, Graphics, Text } from 'pixi.js';
import { GlowFilter } from 'pixi-filters';
import { tunedBloom, tunedBlur, tunedUiAlpha, tunedUiStroke } from '../../config/game.config';
import { gummyBearAccentColor, type GummyBearName } from '../constants/gummyBears';

const TOAST_DURATION_SEC = 1.1;
const FADE_OUT_SEC = 0.32;
const TOAST_PAD_X = 14;
const TOAST_MIN_W = 148;
const TOAST_H = 32;
const TOP_UI_MARGIN_X = 14;
/** Just below combo / collectible HUD row. */
const TOP_UI_Y = 118;

function easeOutBack(t: number): number {
  const c1 = 1.2;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}

/** Repeat gummy pickup — tiny toast near top-left HUD. */
export class GummyCollectToast extends Container {
  private readonly glow = new Graphics();
  private readonly panelGlowFilter: GlowFilter;
  private readonly panel = new Graphics();
  private readonly messageText: Text;

  private viewportW = 360;
  private viewportH = 640;
  private panelW = TOAST_MIN_W;
  private baseY = TOP_UI_Y;
  private elapsedSec = 0;
  private active = false;
  private accentColor = 0xffcc66;

  constructor() {
    super();
    this.eventMode = 'none';
    this.pivot.set(0, TOAST_H * 0.5);

    this.panelGlowFilter = new GlowFilter({
      distance: tunedBloom(6),
      outerStrength: tunedBloom(0.85),
      innerStrength: tunedBloom(0.35),
      color: 0xffaacc,
      alpha: tunedBloom(0.32),
      quality: tunedBloom(0.12),
    });
    this.panel.filters = [this.panelGlowFilter];

    this.messageText = new Text({
      text: '',
      style: {
        fill: '#fff6e8',
        fontFamily: 'Urbanist, Heebo, Orbitron, Arial Black, sans-serif',
        fontSize: 12,
        fontWeight: '800',
        align: 'left',
        letterSpacing: 0.2,
        stroke: { color: '#2a1038', width: tunedUiStroke(2) },
        dropShadow: {
          color: '#ffb8dd',
          alpha: 0.3,
          blur: tunedBlur(3),
          angle: 0,
          distance: 0,
        },
      },
    });
    this.messageText.anchor.set(0, 0.5);
    this.messageText.position.set(TOAST_PAD_X, 0);
    this.messageText.eventMode = 'none';

    this.addChild(this.glow, this.panel, this.messageText);
    this.visible = false;
    this.alpha = 0;
  }

  layout(viewportW: number, viewportH: number): void {
    this.viewportW = Math.max(280, viewportW);
    this.viewportH = Math.max(480, viewportH);
    this.baseY = TOP_UI_Y;
    this.position.set(TOP_UI_MARGIN_X, this.baseY);
  }

  show(gummyName: GummyBearName): void {
    this.accentColor = gummyBearAccentColor(gummyName);
    this.panelGlowFilter.color = this.accentColor;
    this.messageText.text = `+1 ${gummyName} collected`;
    this.messageText.style.fill = gummyName === 'Mint Pop' ? '#e8fff4' : '#fff6e8';

    const textW = Math.ceil(this.messageText.width);
    this.panelW = Math.max(TOAST_MIN_W, textW + TOAST_PAD_X * 2);
    this.pivot.set(0, TOAST_H * 0.5);
    this.redrawPanel(0.5);

    this.elapsedSec = 0;
    this.active = true;
    this.visible = true;
    this.alpha = 0;
    this.scale.set(0.9);
    this.position.set(TOP_UI_MARGIN_X, this.baseY);
  }

  tick(dt: number): void {
    if (!this.active) {
      return;
    }

    this.elapsedSec += dt;
    const t = this.elapsedSec;

    if (t < 0.12) {
      const u = t / 0.12;
      this.alpha = Math.min(1, u * 1.15);
      this.scale.set(0.9 + 0.12 * easeOutBack(u));
      this.position.y = this.baseY - 4 * easeOutBack(u);
    } else if (t < TOAST_DURATION_SEC - FADE_OUT_SEC) {
      this.alpha = 1;
      this.scale.set(1 + Math.sin((t - 0.12) * 10) * 0.012);
      this.position.y = this.baseY - 4;
    } else {
      const fadeT = (t - (TOAST_DURATION_SEC - FADE_OUT_SEC)) / FADE_OUT_SEC;
      this.alpha = Math.max(0, 1 - fadeT);
      this.scale.set(1 - fadeT * 0.05);
      this.position.y = this.baseY - 4 + fadeT * 8;
      if (fadeT >= 1) {
        this.hide();
      }
    }

    const pulse = 0.5 + 0.5 * Math.sin(t * 9);
    this.panelGlowFilter.outerStrength = tunedBloom(0.7 + 0.25 * pulse);
    this.panelGlowFilter.alpha = tunedBloom(0.26 + 0.12 * pulse);
    this.redrawPanel(pulse);
  }

  private hide(): void {
    this.active = false;
    this.visible = false;
  }

  private redrawPanel(pulse: number): void {
    const w = this.panelW;
    const h = TOAST_H;
    const r = h * 0.5;

    this.panel.clear();
    this.panel.roundRect(0, -h * 0.5, w, h, r);
    this.panel.fill({ color: 0x180828, alpha: tunedUiAlpha(0.74) });
    this.panel.roundRect(0, -h * 0.5, w, h, r);
    this.panel.stroke({ width: 1.5, color: this.accentColor, alpha: 0.62 });

    this.glow.clear();
    this.glow
      .roundRect(-2, -h * 0.5 - 2, w + 4, h + 4, r + 2)
      .fill({ color: this.accentColor, alpha: 0.04 + 0.05 * pulse });
  }

  override destroy(options?: Parameters<Container['destroy']>[0]): void {
    this.panelGlowFilter.destroy();
    super.destroy(options);
  }
}
