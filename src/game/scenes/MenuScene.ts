import { signOut } from 'firebase/auth';
import { Application, Assets, Container, Graphics, Text, type Ticker } from 'pixi.js';
import slickLogoUrl from '../../assets/ui/slick-logo.png';
import { auth } from '../../firebase.js';
import { getSavedNickname } from '../services/playerProfile';
import { getGameUserSession, clearGameUserSession } from '../services/userSession';
import { SlickLogoImage } from '../ui/SlickLogoImage';
import { loadLogoTextureTransparent } from '../utils/logoTexture';
import { isQuickStartMobileDevice } from '../utils/quickStartDevice';
import type { Scene } from './Scene';

/**
 * Main menu after auth: logo, session summary (nickname + personal best), PLAY, log out.
 */
export class MenuScene implements Scene {
  readonly name = 'menu';

  private readonly container = new Container();
  private readonly background = new Graphics();
  private logo?: SlickLogoImage;
  private readonly hint: Text;
  private lobbyOverlay?: HTMLDivElement;

  private readonly keyHandler = (ev: KeyboardEvent): void => {
    if (ev.code === 'Space') {
      ev.preventDefault();
      void this.handlePlay();
    }
  };

  constructor(private readonly onPlay: () => void | Promise<void>) {
    this.hint = new Text({
      text: 'Press Space to play',
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
      this.logo.fitWidth(Math.min(width * 0.44, 240));
      this.logo.position.set(width * 0.5, height * 0.12);
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

    const session = getGameUserSession();
    const nickname = (session?.nickname ?? getSavedNickname()) || 'Player';
    const bestH = session?.personalBest.maxHeightMeters ?? 0;
    const bestC = session?.personalBest.bestCombo ?? 0;

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
    card.style.width = 'min(440px, 88vw)';
    card.style.padding = '20px';
    card.style.borderRadius = '18px';
    card.style.background = 'rgba(46, 0, 75, 0.55)';
    card.style.backdropFilter = isQuickStartMobileDevice() ? 'none' : 'blur(12px)';
    card.style.border = '1px solid rgba(57, 255, 20, 0.65)';
    card.style.boxShadow = '0 0 18px rgba(57,255,20,0.25)';
    card.style.display = 'grid';
    card.style.gap = '12px';

    const welcome = document.createElement('div');
    welcome.textContent = nickname.toUpperCase();
    welcome.style.color = '#FFD700';
    welcome.style.fontFamily = 'Orbitron, "Press Start 2P", Arial Black, sans-serif';
    welcome.style.fontSize = '22px';
    welcome.style.fontWeight = '800';
    welcome.style.textAlign = 'center';
    welcome.style.textShadow = '0 0 8px rgba(255,215,0,0.75)';

    const stats = document.createElement('div');
    stats.textContent = `Personal best · ${bestH.toLocaleString()} m height · ${bestC.toLocaleString()} combo`;
    stats.style.color = '#9ab8a8';
    stats.style.fontFamily = 'system-ui, Segoe UI, sans-serif';
    stats.style.fontSize = '15px';
    stats.style.textAlign = 'center';
    stats.style.lineHeight = '1.35';

    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'PLAY';
    button.style.height = '52px';
    button.style.borderRadius = '12px';
    button.style.border = '1px solid rgba(57,255,20,0.85)';
    button.style.background = 'rgba(46,0,75,0.8)';
    button.style.color = '#FFD700';
    button.style.fontFamily = 'Orbitron, "Press Start 2P", Arial Black, sans-serif';
    button.style.fontWeight = '800';
    button.style.letterSpacing = '0.1em';
    button.style.cursor = 'pointer';
    button.style.textShadow = '0 0 8px rgba(255,215,0,0.85)';

    const logout = document.createElement('button');
    logout.type = 'button';
    logout.textContent = 'Log out';
    logout.style.height = '40px';
    logout.style.borderRadius = '10px';
    logout.style.border = '1px solid rgba(255,255,255,0.2)';
    logout.style.background = 'rgba(0,0,0,0.35)';
    logout.style.color = '#b8c4c0';
    logout.style.fontFamily = 'system-ui, Segoe UI, sans-serif';
    logout.style.fontSize = '14px';
    logout.style.cursor = 'pointer';

    button.addEventListener('click', () => {
      void this.handlePlay();
    });
    logout.addEventListener('click', () => {
      void (async (): Promise<void> => {
        try {
          await signOut(auth);
        } catch {
          /* still clear local session */
        }
        clearGameUserSession();
        location.reload();
      })();
    });

    card.append(welcome, stats, button, logout);
    overlay.appendChild(card);
    host.appendChild(overlay);

    this.lobbyOverlay = overlay;
  }

  private unmountLobbyOverlay(): void {
    this.lobbyOverlay?.remove();
    this.lobbyOverlay = undefined;
  }

  private async handlePlay(): Promise<void> {
    await Promise.resolve(this.onPlay());
  }
}
