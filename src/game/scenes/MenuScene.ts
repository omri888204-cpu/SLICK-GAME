import { Application, Assets, Container, Graphics, Text, type Ticker } from 'pixi.js';
import slickLogoUrl from '../../assets/ui/slick-logo.png';
import { SlickLogoImage } from '../ui/SlickLogoImage';
import { loadLogoTextureTransparent } from '../utils/logoTexture';
import type { Scene } from './Scene';

/**
 * Main menu: dark field, SLICK raster logo top-center (compact), tap/click to play.
 */
export class MenuScene implements Scene {
  readonly name = 'menu';

  private readonly container = new Container();
  private readonly background = new Graphics();
  private logo?: SlickLogoImage;
  private readonly hint: Text;

  private readonly keyHandler = (ev: KeyboardEvent): void => {
    if (ev.code === 'Space') {
      ev.preventDefault();
      void Promise.resolve(this.onPlay()).catch(() => {});
    }
  };

  constructor(private readonly onPlay: () => void | Promise<void>) {
    this.hint = new Text({
      text: 'Tap · click · or press Space to climb',
      style: {
        fill: '#7eb89a',
        fontFamily: 'system-ui, Segoe UI, sans-serif',
        fontSize: 16,
        letterSpacing: 0.5,
      },
    });
    this.hint.anchor.set(0.5);
  }

  async init(app: Application): Promise<void> {
    let texture;
    try {
      texture = await loadLogoTextureTransparent(slickLogoUrl);
    } catch {
      texture = await Assets.load(slickLogoUrl);
    }

    this.logo = new SlickLogoImage(texture);

    this.container.addChild(this.background, this.logo, this.hint);
    app.stage.addChild(this.container);

    this.background.eventMode = 'static';
    this.container.eventMode = 'static';
    this.container.on('pointerdown', () => {
      void Promise.resolve(this.onPlay()).catch(() => {});
    });

    window.addEventListener('keydown', this.keyHandler);
  }

  update(ticker: Ticker): void {
    this.logo?.update(ticker.deltaMS / 1000);
  }

  resize(width: number, height: number): void {
    this.background.clear();
    this.background.rect(0, 0, width, height).fill({ color: 0x030308, alpha: 1 });
    this.background.rect(0, 0, width, height).fill({ color: 0x050510, alpha: 0.35 });

    if (this.logo) {
      /** Compact header — max ~240px wide on menu. */
      this.logo.fitWidth(Math.min(width * 0.44, 240));
      this.logo.position.set(width * 0.5, height * 0.14);
    }

    this.hint.position.set(width * 0.5, height * 0.36);
  }

  destroy(): void {
    window.removeEventListener('keydown', this.keyHandler);
    this.container.removeAllListeners();
    this.container.destroy({ children: true });
  }
}
