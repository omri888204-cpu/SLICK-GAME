import { Application, Assets, Container, Graphics, Text, type Ticker } from 'pixi.js';
import slickLogoUrl from '../../assets/ui/slick-logo.png';
import { getSavedNickname, saveNickname } from '../services/playerProfile';
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
  private lobbyOverlay?: HTMLDivElement;
  private nicknameInput?: HTMLInputElement;
  private playButton?: HTMLButtonElement;
  private errorText?: HTMLDivElement;

  private readonly keyHandler = (ev: KeyboardEvent): void => {
    if (ev.code === 'Space') {
      ev.preventDefault();
      void this.handlePlayFromLobby();
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
      this.nicknameInput?.focus();
    });

    window.addEventListener('keydown', this.keyHandler);
    this.mountLobbyOverlay();
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
    this.unmountLobbyOverlay();
    this.container.removeAllListeners();
    this.container.destroy({ children: true });
  }

  private mountLobbyOverlay(): void {
    const host = document.querySelector<HTMLElement>('#app');
    if (!host) {
      return;
    }
    host.style.position = 'relative';

    const overlay = document.createElement('div');
    overlay.style.position = 'absolute';
    overlay.style.inset = '0';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.pointerEvents = 'none';
    overlay.style.zIndex = '20';

    const card = document.createElement('div');
    card.style.pointerEvents = 'auto';
    card.style.width = 'min(420px, 86vw)';
    card.style.padding = '20px';
    card.style.borderRadius = '18px';
    card.style.background = 'rgba(46, 0, 75, 0.55)';
    card.style.backdropFilter = 'blur(12px)';
    card.style.border = '1px solid rgba(57, 255, 20, 0.65)';
    card.style.boxShadow = '0 0 18px rgba(57,255,20,0.25)';
    card.style.display = 'grid';
    card.style.gap = '12px';

    const title = document.createElement('div');
    title.textContent = 'ENTER NICKNAME';
    title.style.color = '#FFD700';
    title.style.fontFamily = 'Orbitron, "Press Start 2P", Arial Black, sans-serif';
    title.style.fontSize = '20px';
    title.style.fontWeight = '800';
    title.style.textAlign = 'center';
    title.style.textShadow = '0 0 8px rgba(255,215,0,0.75)';

    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 20;
    input.placeholder = 'Your nickname';
    input.value = getSavedNickname();
    input.style.height = '46px';
    input.style.borderRadius = '12px';
    input.style.padding = '0 14px';
    input.style.border = '1px solid rgba(57,255,20,0.75)';
    input.style.background = 'rgba(0,0,0,0.55)';
    input.style.color = '#FFD700';
    input.style.fontFamily = 'Orbitron, "Press Start 2P", Arial Black, sans-serif';
    input.style.fontSize = '18px';
    input.style.outline = 'none';

    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'START CLIMB';
    button.style.height = '48px';
    button.style.borderRadius = '12px';
    button.style.border = '1px solid rgba(57,255,20,0.85)';
    button.style.background = 'rgba(46,0,75,0.8)';
    button.style.color = '#FFD700';
    button.style.fontFamily = 'Orbitron, "Press Start 2P", Arial Black, sans-serif';
    button.style.fontWeight = '800';
    button.style.letterSpacing = '0.7px';
    button.style.cursor = 'pointer';
    button.style.textShadow = '0 0 8px rgba(255,215,0,0.85)';

    const error = document.createElement('div');
    error.style.minHeight = '18px';
    error.style.textAlign = 'center';
    error.style.color = '#ff8ea7';
    error.style.fontFamily = 'system-ui, Segoe UI, sans-serif';
    error.style.fontSize = '13px';

    button.addEventListener('click', () => {
      void this.handlePlayFromLobby();
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        void this.handlePlayFromLobby();
      }
    });

    card.append(title, input, button, error);
    overlay.appendChild(card);
    host.appendChild(overlay);

    this.lobbyOverlay = overlay;
    this.nicknameInput = input;
    this.playButton = button;
    this.errorText = error;
  }

  private unmountLobbyOverlay(): void {
    this.lobbyOverlay?.remove();
    this.lobbyOverlay = undefined;
    this.nicknameInput = undefined;
    this.playButton = undefined;
    this.errorText = undefined;
  }

  private async handlePlayFromLobby(): Promise<void> {
    const nickname = this.nicknameInput?.value.trim() ?? '';
    if (!nickname) {
      if (this.errorText) {
        this.errorText.textContent = 'Please enter a nickname';
      }
      this.nicknameInput?.focus();
      return;
    }
    saveNickname(nickname);
    await Promise.resolve(this.onPlay());
  }
}
