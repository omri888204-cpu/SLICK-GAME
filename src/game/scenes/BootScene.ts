import {
  Application,
  Assets,
  Container,
  Graphics,
  Text,
  TextStyle,
  type Ticker,
} from 'pixi.js';
import { GlowFilter } from 'pixi-filters';
import slickLogoUrl from '../../assets/ui/slick-logo.png';
import { SlickLogoImage } from '../ui/SlickLogoImage';
import { loadLogoTextureTransparent } from '../utils/logoTexture';
import type { Scene } from './Scene';

/** Preloaded for PlayScene death-zone `TilingSprite` — safe if missing (game falls back to vector strip). */
const ICE_DEATH_PRELOAD_URL = `${import.meta.env.BASE_URL}assets/ice-death.png`;

export class BootScene implements Scene {
  readonly name = 'boot';

  private readonly container = new Container();
  private readonly logoWrap = new Container();
  private logo?: SlickLogoImage;
  private glow?: GlowFilter;
  private subtitle?: Text;
  private loaderBar?: Graphics;
  private elapsed = 0;
  private completed = false;
  private width = 0;
  private height = 0;

  constructor(private readonly onComplete: () => void | Promise<void>) {}

  async init(app: Application): Promise<void> {
    app.stage.addChild(this.container);

    await Assets.load(ICE_DEATH_PRELOAD_URL).catch(() => {
      /* PlayScene will retry or use vector fallback */
    });
    let texture;
    try {
      texture = await loadLogoTextureTransparent(slickLogoUrl);
    } catch {
      texture = await Assets.load(slickLogoUrl);
    }
    this.logo = new SlickLogoImage(texture);
    this.logoWrap.addChild(this.logo);

    this.glow = new GlowFilter({
      distance: 22,
      outerStrength: 2.65,
      innerStrength: 0,
      color: 0x39ff5a,
      alpha: 0.62,
      quality: 0.28,
    });
    this.logoWrap.filters = [this.glow];

    const subStyle = new TextStyle({
      fill: '#66c495',
      fontFamily: 'system-ui, Segoe UI, sans-serif',
      fontSize: 17,
      letterSpacing: 0.8,
    });
    this.subtitle = new Text({
      text: 'Crystal climb — the tower is waking up…',
      style: subStyle,
    });
    this.subtitle.anchor.set(0.5);

    this.loaderBar = new Graphics();
    this.container.addChild(this.logoWrap, this.subtitle, this.loaderBar);
  }

  update(ticker: Ticker): void {
    this.elapsed += ticker.deltaMS;
    const progress = Math.min(this.elapsed / 1400, 1);
    const t = this.elapsed / 1000;

    this.logo?.update(ticker.deltaMS / 1000);

    if (this.glow) {
      const pulse = Math.sin(this.elapsed / 280) * 0.42 + 1;
      this.glow.outerStrength = 2 + pulse * 1.35;
      this.glow.distance = 16 + Math.sin(t * 2.8) * 8;
      this.glow.alpha = 0.52 + Math.sin(t * 3.1) * 0.18;
    }

    this.drawLoader(progress);

    if (progress >= 1 && !this.completed) {
      this.completed = true;
      void Promise.resolve(this.onComplete()).catch(() => {});
    }
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;

    if (this.logo) {
      this.logo.fitWidth(Math.min(width * 0.72, 420));
      this.logo.position.set(0, 0);
      this.logoWrap.position.set(width / 2, height * 0.4);
    }

    if (this.subtitle) {
      this.subtitle.position.set(width / 2, height * 0.52);
    }

    this.drawLoader(Math.min(this.elapsed / 1400, 1));
  }

  destroy(): void {
    this.logoWrap.filters = null;
    this.container.destroy({ children: true });
  }

  private drawLoader(progress: number): void {
    if (!this.loaderBar) {
      return;
    }

    const screenWidth = this.width || window.innerWidth;
    const screenHeight = this.height || window.innerHeight;
    const barW = Math.min(screenWidth * 0.62, 360);
    const x = (screenWidth - barW) / 2;
    const y = screenHeight * 0.62;

    this.loaderBar.clear();
    this.loaderBar.roundRect(x, y, barW, 8, 8).fill({ color: 0x171726 });
    this.loaderBar.roundRect(x, y, barW * progress, 8, 8).fill({ color: 0x39ff5a });
  }
}
