import type { Application } from 'pixi.js';
import { WALK } from '../../config/game.config';

export class InputManager {
  private keys = new Set<string>();
  private jumpQueued = false;
  private grappleQueued = false;
  private readonly touchControlsEnabled = InputManager.detectTouchControls();
  private touchHoldLeft = false;
  private touchHoldRight = false;
  private touchAnalogAxisTarget = 0;
  private touchAnalogAxisSmoothed = 0;

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
    this.touchHoldLeft = false;
    this.touchHoldRight = false;
    this.touchAnalogAxisTarget = 0;
    this.touchAnalogAxisSmoothed = 0;
  }

  getHorizontalAxis(): number {
    if (this.touchControlsEnabled) {
      if (Math.abs(this.touchAnalogAxisSmoothed) > 0.001) {
        return Math.max(-1, Math.min(1, this.touchAnalogAxisSmoothed));
      }
      if (this.touchHoldLeft && !this.touchHoldRight) {
        return -1;
      }
      if (this.touchHoldRight && !this.touchHoldLeft) {
        return 1;
      }
    }

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

  isTouchControlsActive(): boolean {
    return this.touchControlsEnabled;
  }

  onResize(): void {
    this.app.stage.hitArea = this.app.screen;
  }

  setTouchHoldLeft(active: boolean): void {
    this.touchHoldLeft = active;
  }

  setTouchHoldRight(active: boolean): void {
    this.touchHoldRight = active;
  }

  clearTouchHolds(): void {
    this.touchHoldLeft = false;
    this.touchHoldRight = false;
    this.touchAnalogAxisTarget = 0;
    this.touchAnalogAxisSmoothed = 0;
  }

  setTouchFollowAxis(axis: number): void {
    this.touchAnalogAxisTarget = Math.max(-1, Math.min(1, axis));
  }

  // Deprecated joystick entry-point; now routes to analog touch-follow axis.
  setTouchHorizontalAxis(axis: number): void {
    this.setTouchFollowAxis(axis);
  }

  /** Ease touch-follow toward the finger (reduces jitter; feels more like analog swing). */
  smoothTouchJoystickAxis(dt: number): void {
    if (!this.touchControlsEnabled) {
      return;
    }
    const k = 1 - Math.exp(-WALK.touchAxisLerpPerSec * dt);
    this.touchAnalogAxisSmoothed += (this.touchAnalogAxisTarget - this.touchAnalogAxisSmoothed) * k;
    if (Math.abs(this.touchAnalogAxisSmoothed) < 0.008 && Math.abs(this.touchAnalogAxisTarget) < 0.008) {
      this.touchAnalogAxisSmoothed = 0;
    }
  }

  queueJump(): void {
    this.jumpQueued = true;
  }

  queueGrapple(): void {
    this.grappleQueued = true;
  }

  private static detectTouchControls(): boolean {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') {
      return false;
    }

    const coarsePointer = window.matchMedia?.('(pointer: coarse)').matches ?? false;
    const hasTouchPoints = navigator.maxTouchPoints > 0;
    const hasTouchEvents = 'ontouchstart' in window;
    const uaDataMobile =
      'userAgentData' in navigator &&
      typeof (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData?.mobile ===
        'boolean'
        ? !!(navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData?.mobile
        : false;
    const mobileUa = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
    const compactViewport =
      Math.min(window.innerWidth || 0, window.innerHeight || 0) > 0 &&
      Math.min(window.innerWidth || 0, window.innerHeight || 0) <= 900;

    return (
      coarsePointer ||
      hasTouchPoints ||
      hasTouchEvents ||
      uaDataMobile ||
      mobileUa ||
      compactViewport
    );
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
