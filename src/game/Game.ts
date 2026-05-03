import { Application } from 'pixi.js';
import { BootScene } from './scenes/BootScene';
import { MenuScene } from './scenes/MenuScene';
import { PlayScene } from './scenes/PlayScene';
import type { Scene } from './scenes/Scene';

export class Game {
  private readonly app = new Application();
  private activeScene?: Scene;

  async start(root: HTMLElement): Promise<void> {
    await this.app.init({
      resizeTo: root,
      backgroundAlpha: 1,
      backgroundColor: 0x05050a,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
    });

    root.appendChild(this.app.canvas);
    this.app.ticker.add((ticker) => this.activeScene?.update(ticker));
    window.addEventListener('resize', this.handleResize);

    await this.changeScene(
      new BootScene(() => this.changeScene(new MenuScene(() => this.changeScene(new PlayScene())))),
    );
  }

  async changeScene(scene: Scene): Promise<void> {
    this.activeScene?.destroy();
    this.app.stage.removeChildren();

    this.activeScene = scene;
    await scene.init(this.app);
    scene.resize(this.app.screen.width, this.app.screen.height);
  }

  destroy(): void {
    window.removeEventListener('resize', this.handleResize);
    this.activeScene?.destroy();
    this.app.destroy(true);
  }

  private readonly handleResize = (): void => {
    this.activeScene?.resize(this.app.screen.width, this.app.screen.height);
  };
}
