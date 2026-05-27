import { Application, TextureStyle } from 'pixi.js';
import { RENDER } from '../config/game.config';
import { MenuScene } from './scenes/MenuScene';
import { PlayScene } from './scenes/PlayScene';
import {
  clearLeaderboardDatabase,
  LEADERBOARD_PURGE_CONFIRM_LOG,
  tryOneTimeScheduledLeaderboardPurge,
} from './services/leaderboard';
import {
  runMandatoryLandingGate,
} from './landing/runLandingGate';
import { fadeOutMenuHandoffOverlay, type MenuPlayHandoff } from './ui/MenuPlayTransition';
import type { Scene } from './scenes/Scene';

export class Game {
  private readonly app = new Application();
  private activeScene?: Scene;
  private pendingMenuHandoff: MenuPlayHandoff | null = null;
  private baseWidth = 0;
  private baseHeight = 0;
  private root?: HTMLElement;
  private readonly handleCanvasContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
  };
  private readonly handleCanvasTouchStart = (event: TouchEvent): void => {
    event.preventDefault();
  };

  async start(root: HTMLElement): Promise<void> {
    this.root = root;
    this.baseWidth = Math.max(360, root.clientWidth || window.innerWidth);
    this.baseHeight = Math.max(640, root.clientHeight || window.innerHeight);
    await this.app.init({
      width: this.baseWidth,
      height: this.baseHeight,
      backgroundAlpha: 1,
      backgroundColor: 0x05050a,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      powerPreference: 'high-performance',
    });

    TextureStyle.defaultOptions.scaleMode = RENDER.pixelArt ? 'nearest' : 'linear';
    if (RENDER.forceSingleUpdate) {
      this.app.ticker.maxFPS = RENDER.maxTickerFps;
      this.app.ticker.minFPS = RENDER.minTickerFps;
    }

    root.appendChild(this.app.canvas);
    this.app.canvas.style.touchAction = 'none';
    this.app.canvas.addEventListener('contextmenu', this.handleCanvasContextMenu);
    this.app.canvas.addEventListener('touchstart', this.handleCanvasTouchStart, { passive: false });
    this.applyFitScale();
    this.app.ticker.add((ticker) => this.activeScene?.update(ticker));
    window.addEventListener('resize', this.handleResize);

    void (async () => {
      try {
        const didScheduledPurge = await tryOneTimeScheduledLeaderboardPurge();
        if (import.meta.env.VITE_CLEAR_LEADERBOARD_ON_BOOT === 'true') {
          await clearLeaderboardDatabase();
          if (!didScheduledPurge) {
            console.info(LEADERBOARD_PURGE_CONFIRM_LOG);
          }
        }
      } catch (err) {
        console.error('[Game] leaderboard bootstrap purge failed', err);
      }
    })();

    if (import.meta.env.DEV) {
      (
        window as unknown as {
          skyClimberClearLeaderboard?: () => Promise<number>;
        }
      ).skyClimberClearLeaderboard = async () => {
        const deleted = await clearLeaderboardDatabase();
        console.info(LEADERBOARD_PURGE_CONFIRM_LOG);
        return deleted;
      };
    }

    await runMandatoryLandingGate(root);

    await this.changeScene(this.createMenuScene());
  }

  private createMenuScene(): MenuScene {
    return new MenuScene((handoff) => {
      this.pendingMenuHandoff = handoff;
      return this.changeScene(this.createPlayScene());
    });
  }

  private createPlayScene(): PlayScene {
    return new PlayScene({
      menuHandoff: true,
      onBackToMenu: () => this.returnToMainMenu(),
    });
  }

  private async returnToMainMenu(): Promise<void> {
    this.pendingMenuHandoff = null;
    await this.changeScene(this.createMenuScene());
  }

  async changeScene(scene: Scene): Promise<void> {
    this.activeScene?.destroy();
    const handoffOverlay = this.pendingMenuHandoff?.fadeOverlay ?? null;
    this.app.stage.removeChildren();

    if (handoffOverlay) {
      this.pendingMenuHandoff = null;
      this.app.stage.addChild(handoffOverlay);
    }

    this.activeScene = scene;
    try {
      await scene.init(this.app);
      scene.resize(this.app.screen.width, this.app.screen.height);

      if (handoffOverlay) {
        this.app.stage.addChild(handoffOverlay);
        if (this.activeScene instanceof PlayScene) {
          this.activeScene.beginMenuSkyDropIntro();
        }
      }
    } catch (err) {
      console.error('[Game] scene init failed', err);
      throw err;
    } finally {
      if (handoffOverlay) {
        try {
          await fadeOutMenuHandoffOverlay(
            handoffOverlay,
            (fn) => this.app.ticker.add(fn),
            (fn) => this.app.ticker.remove(fn),
          );
        } catch (fadeErr) {
          console.error('[Game] menu handoff fade failed', fadeErr);
          handoffOverlay.destroy({ children: true });
        }
        if (this.activeScene instanceof PlayScene) {
          this.activeScene.finishMenuSkyDropIntro();
        }
      }
    }
  }

  destroy(): void {
    window.removeEventListener('resize', this.handleResize);
    this.app.canvas.removeEventListener('contextmenu', this.handleCanvasContextMenu);
    this.app.canvas.removeEventListener('touchstart', this.handleCanvasTouchStart);
    this.activeScene?.destroy();
    this.app.destroy(true);
  }

  private readonly handleResize = (): void => {
    this.applyFitScale();
    this.activeScene?.resize(this.app.screen.width, this.app.screen.height);
  };

  private applyFitScale(): void {
    if (!this.root) {
      return;
    }
    const availableWidth = Math.max(1, this.root.clientWidth || window.innerWidth);
    const availableHeight = Math.max(1, this.root.clientHeight || window.innerHeight);
    const scale = Math.min(availableWidth / this.baseWidth, availableHeight / this.baseHeight);
    const scaledWidth = Math.round(this.baseWidth * scale);
    const scaledHeight = Math.round(this.baseHeight * scale);
    const canvasStyle = this.app.canvas.style;
    canvasStyle.width = `${scaledWidth}px`;
    canvasStyle.height = `${scaledHeight}px`;
    canvasStyle.marginLeft = `${Math.floor((availableWidth - scaledWidth) / 2)}px`;
    canvasStyle.marginTop = `${Math.floor((availableHeight - scaledHeight) / 2)}px`;
  }
}
