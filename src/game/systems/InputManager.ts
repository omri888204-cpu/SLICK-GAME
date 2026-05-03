import type { Application } from 'pixi.js';

export class InputManager {
  private keys = new Set<string>();
  private jumpQueued = false;
  private grappleQueued = false;

  constructor(private readonly app: Application) {}

  attach(): void {
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);

    this.app.stage.eventMode = 'static';
    this.app.stage.hitArea = this.app.screen;
  }

  destroy(): void {
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    this.keys.clear();
  }

  getHorizontalAxis(): number {
    const left = this.keys.has('ArrowLeft') || this.keys.has('KeyA');
    const right = this.keys.has('ArrowRight') || this.keys.has('KeyD');

    if (left && !right) {
      return -1;
    }

    if (right && !left) {
      return 1;
    }

    return 0;
  }

  consumeJump(): boolean {
    const queued = this.jumpQueued;
    this.jumpQueued = false;
    return queued;
  }

  consumeGrapple(): boolean {
    const queued = this.grappleQueued;
    this.grappleQueued = false;
    return queued;
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (event.code === 'Space' && !event.repeat) {
      this.jumpQueued = true;
    }

    if (event.code === 'KeyE' && !event.repeat) {
      this.grappleQueued = true;
    }

    this.keys.add(event.code);
  };

  private readonly handleKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
  };
}
