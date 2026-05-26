import { Container } from 'pixi.js';
import { gummyBearNameFromIndex } from '../constants/gummyBears';
import { discoverGummy } from '../services/gummyCollection';
import { GummyCollectToast } from './GummyCollectToast';
import { GummyDiscoveryPopup } from './GummyDiscoveryPopup';

/**
 * Screen-fixed gummy feedback — first-time discovery card + repeat collect toast.
 * Parent on `PlayScene.uiLayer`; does not affect gameplay logic.
 */
export class GummyPopupSystem extends Container {
  private readonly discoveryPopup = new GummyDiscoveryPopup();
  private readonly collectToast = new GummyCollectToast();

  constructor() {
    super();
    this.eventMode = 'none';
    this.sortableChildren = true;
    this.collectToast.zIndex = 1;
    this.discoveryPopup.zIndex = 2;
    this.addChild(this.collectToast, this.discoveryPopup);
  }

  layout(viewportW: number, viewportH: number): void {
    this.discoveryPopup.layout(viewportW, viewportH);
    this.collectToast.layout(viewportW, viewportH);
  }

  tick(dt: number): void {
    this.discoveryPopup.tick(dt);
    this.collectToast.tick(dt);
  }

  /**
   * Show discovery or repeat-collect UI after a gummy is eaten.
   * @returns `true` when this was the player's first time discovering that gummy.
   */
  handleCollected(bearIndex: number, onFirstDiscovery?: () => void): boolean {
    const gummyName = gummyBearNameFromIndex(bearIndex);
    const isFirstDiscovery = discoverGummy(gummyName);
    if (isFirstDiscovery) {
      this.discoveryPopup.show(gummyName);
      onFirstDiscovery?.();
    } else {
      this.collectToast.show(gummyName);
    }
    return isFirstDiscovery;
  }

  override destroy(options?: Parameters<Container['destroy']>[0]): void {
    this.discoveryPopup.destroy(options);
    this.collectToast.destroy(options);
    super.destroy(options);
  }
}
