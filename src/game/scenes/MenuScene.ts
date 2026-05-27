import {
  Application,
  Assets,
  Container,
  Graphics,
  Sprite,
  type FederatedPointerEvent,
  type Rectangle,
  type Ticker,
  type Texture,
} from 'pixi.js';
import {
  bindBackgroundMusicUnlock,
  playBackgroundMusic,
  preloadBackgroundMusic,
  stopBackgroundMusic,
  tryResumeBackgroundMusic,
} from '../audio/BackgroundMusic';
import { warmupCandyAtmosphereEssentials } from '../systems/atmosphere/CandyAtmosphereManager';
import { MENU_BGM_URL } from '../constants/gameMusic';
import {
  applyMenuBackDriftAnimation,
  computeMenuBackBaseScale,
  computeMenuCoverLayout,
  computeMenuPlayerFeetPoint,
  createMenuPlayButtonTexture,
  layoutMenuCoverSprite,
  layoutMenuPlayHitZone,
  MENU_BACK_ASSET_KEY,
  MENU_BACKDROP_COLOR,
  MENU_CANDY_LOOP_ASSET_KEY,
  registerMenuAssets,
} from '../constants/menuBackground';
import { loadMenuPlayerIdleFrame, loadMenuPlayerJumpFrame } from '../entities/Player';
import { MenuLootTotalsOverlay } from '../ui/MenuLootTotalsOverlay';
import { MenuPlayButton } from '../ui/MenuPlayButton';
import {
  createMenuDreamyFadeOverlay,
  MenuPlayTransition,
  type MenuPlayHandoff,
} from '../ui/MenuPlayTransition';
import { MenuPlayerAvatar } from '../ui/MenuPlayerAvatar';
import {
  debugLogFirebaseAuthUser,
  debugLogLocalStorageCurrency,
  logMenuCurrencyLoad,
  logMenuCurrencySourceMessage,
  persistMenuCurrencySnapshot,
  readMenuCurrencyFromFirebase,
  readMenuCurrencyFromLocalStorage,
  resolveMenuCurrencyDisplay,
  snapshotFromFirebaseLive,
  type MenuCurrencySnapshot,
} from '../services/menuCurrencyDisplay';
import { debugLogMenuBagStorageRead } from '../services/menuBagCache';
import { subscribeUserBagBalances } from '../services/rtdbUsers';
import { auth } from '../../firebase.js';
import { onAuthStateChanged, type User } from 'firebase/auth';
import type { Scene } from './Scene';



/**

 * Main menu: animated `menu back` layer + static candy UI art + invisible PLAY hit zone.

 */

export class MenuScene implements Scene {

  readonly name = 'menu';



  private readonly container = new Container();

  private readonly backdrop = new Graphics();

  private readonly menuContent = new Container();

  private readonly menuBack = new Sprite();

  private readonly menuForeground = new Sprite();

  private readonly playButton = new MenuPlayButton();
  private readonly menuPlayer = new MenuPlayerAvatar();
  private readonly lootTotals = new MenuLootTotalsOverlay();
  private readonly playHitZone = new Graphics();

  private dreamyFadeOverlay?: Container;

  private playHitButton?: HTMLButtonElement;
  private menuHost?: HTMLElement;

  private app?: Application;

  private playStarted = false;

  private playTransition: MenuPlayTransition | null = null;

  private playHandoffStarted = false;

  private menuBackCoverScale = 1;

  private menuAnimTimeSec = 0;

  private viewportW = 360;

  private viewportH = 640;

  private bagUnsubscribe: (() => void) | null = null;
  private authUnsubscribe: (() => void) | null = null;
  private bagTotalsUid: string | null = null;
  private currencyLoadSettled = false;
  private firebaseLiveReceived = false;



  private readonly keyHandler = (ev: KeyboardEvent): void => {

    tryResumeBackgroundMusic();

    if (ev.code === 'Space') {

      ev.preventDefault();

      void this.handlePlay();

    }

  };



  private readonly playPointerHandler = (ev: FederatedPointerEvent): void => {

    tryResumeBackgroundMusic();

    ev.stopPropagation();

    void this.handlePlay();

  };



  private readonly playPressHandler = (ev: Event): void => {

    tryResumeBackgroundMusic();

    ev.preventDefault();

    ev.stopPropagation();

    void this.handlePlay();

  };



  private readonly bgmUnlockHandler = (): void => {

    tryResumeBackgroundMusic();

  };



  constructor(private readonly onPlay: (handoff: MenuPlayHandoff) => void | Promise<void>) {

    this.menuContent.eventMode = 'none';

    this.menuBack.eventMode = 'none';

    this.menuForeground.eventMode = 'none';

    this.playButton.eventMode = 'none';
    this.playHitZone.eventMode = 'static';

    this.playHitZone.cursor = 'pointer';

    this.container.sortableChildren = true;

    this.menuBack.zIndex = 0;

    this.menuForeground.zIndex = 2;

    this.playButton.zIndex = 3;

    this.menuPlayer.zIndex = 4;

    this.playHitZone.zIndex = 20;

  }



  async init(app: Application): Promise<void> {

    this.app = app;

    registerMenuAssets();
    preloadBackgroundMusic(MENU_BGM_URL);
    warmupCandyAtmosphereEssentials();

    const [menuBackTexture, menuForegroundTexture, idleFrame, jumpFrame] = await Promise.all([

      Assets.load<Texture>(MENU_BACK_ASSET_KEY),

      Assets.load<Texture>(MENU_CANDY_LOOP_ASSET_KEY),

      loadMenuPlayerIdleFrame(),

      loadMenuPlayerJumpFrame(),

    ]);



    this.menuBack.texture = menuBackTexture;

    this.menuForeground.texture = menuForegroundTexture;

    this.playButton.setTexture(
      createMenuPlayButtonTexture(
        menuForegroundTexture,
        menuForegroundTexture.width,
        menuForegroundTexture.height,
      ),
    );

    this.menuPlayer.setIdleFrame(idleFrame);
    this.menuPlayer.setJumpFrame(jumpFrame);



    this.menuContent.addChild(
      this.menuBack,
      this.menuForeground,
      this.playButton,
      this.menuPlayer,
    );

    this.container.addChild(this.backdrop, this.menuContent, this.playHitZone);

    app.stage.addChild(this.container);

    app.stage.eventMode = 'static';

    app.canvas.addEventListener('pointerdown', this.bgmUnlockHandler, { passive: true });



    this.backdrop.eventMode = 'none';

    this.playHitZone.on('pointerdown', this.playPointerHandler);



    window.addEventListener('keydown', this.keyHandler);

    this.mountPlayHitButton();
    this.mountMenuLootOverlay();

    this.layoutMenuContent(this.viewportW, this.viewportH);

    await this.loadAndDisplayMenuCurrency();
    this.startBagTotalsSubscription();

    bindBackgroundMusicUnlock();

    playBackgroundMusic(MENU_BGM_URL);

  }



  update(ticker: Ticker): void {
    const dtSec = ticker.deltaMS / 1000;
    this.menuAnimTimeSec += dtSec;

    if (this.playTransition) {
      this.playTransition.tick(dtSec);
      this.playButton.tickPressAnimation(dtSec);
      this.menuPlayer.tickTransitionJump(
        this.playTransition.getElapsedSec(),
        this.viewportH,
        this.viewportW,
      );
      return;
    }

    applyMenuBackDriftAnimation(
      this.menuBack,
      this.viewportW,
      this.viewportH,
      this.menuBackCoverScale,
      this.menuAnimTimeSec,
    );

    this.playButton.pulse(this.menuAnimTimeSec);
    this.playButton.tickPressAnimation(dtSec);
  }



  resize(width: number, height: number): void {

    this.viewportW = width;

    this.viewportH = height;

    this.layoutMenuContent(width, height);

  }



  private layoutMenuContent(width: number, height: number): void {

    this.backdrop.clear();

    this.backdrop.rect(0, 0, width, height).fill({ color: MENU_BACKDROP_COLOR, alpha: 1 });

    this.menuContent.position.set(width * 0.5, height * 0.5);
    this.menuContent.pivot.set(width * 0.5, height * 0.5);
    if (!this.playTransition) {
      this.menuContent.scale.set(1);
    }

    const backTexW = Math.max(1, this.menuBack.texture.width);

    const backTexH = Math.max(1, this.menuBack.texture.height);

    this.menuBackCoverScale = computeMenuBackBaseScale(width, height, backTexW, backTexH);

    layoutMenuCoverSprite(this.menuForeground, width, height);

    if (!this.playTransition) {
      applyMenuBackDriftAnimation(
        this.menuBack,
        width,
        height,
        this.menuBackCoverScale,
        this.menuAnimTimeSec,
      );
    }



    const fgTexW = Math.max(1, this.menuForeground.texture.width);

    const fgTexH = Math.max(1, this.menuForeground.texture.height);

    const fgLayout = computeMenuCoverLayout(width, height, fgTexW, fgTexH);

    this.playButton.layout(fgLayout, fgTexW, fgTexH);

    this.playButton.pulse(this.menuAnimTimeSec);

    const feetPoint = computeMenuPlayerFeetPoint(fgLayout, fgTexW, fgTexH);

    const hitRect = layoutMenuPlayHitZone(this.playHitZone, width, height, fgTexW, fgTexH);

    if (!this.playTransition) {
      this.menuPlayer.layout(height, feetPoint.x, feetPoint.y, width);
    }

    this.container.sortChildren();

    this.layoutHtmlPlayHit(hitRect, width, height);
    this.layoutMenuLootOverlay(width, height);
  }



  destroy(): void {
    stopBackgroundMusic();
    this.stopAuthSubscription();
    this.app?.canvas.removeEventListener('pointerdown', this.bgmUnlockHandler);

    window.removeEventListener('keydown', this.keyHandler);

    this.playHitZone.off('pointerdown', this.playPointerHandler);

    this.playHitButton?.removeEventListener('pointerdown', this.playPressHandler);

    this.unmountPlayHitButton();
    this.unmountMenuLootOverlay();

    this.container.removeAllListeners();

    this.container.destroy({ children: true });

  }



  private mountPlayHitButton(): void {

    const host = document.querySelector<HTMLElement>('#app');

    if (!host) {

      return;

    }

    host.style.position = 'relative';



    const button = document.createElement('button');

    button.type = 'button';

    button.setAttribute('aria-label', 'Play');

    button.style.cssText =

      'position:absolute;opacity:0.001;border:0;padding:0;margin:0;background:transparent;cursor:pointer;z-index:25;touch-action:manipulation;-webkit-tap-highlight-color:transparent;';

    button.addEventListener('pointerdown', this.playPressHandler, { passive: false });



    host.appendChild(button);

    this.playHitButton = button;

  }



  private layoutHtmlPlayHit(rect: Rectangle, logicalW: number, logicalH: number): void {

    const button = this.playHitButton;

    const canvas = this.app?.canvas;

    if (!button || !canvas) {

      return;

    }



    const marginLeft = Number.parseFloat(canvas.style.marginLeft) || 0;

    const marginTop = Number.parseFloat(canvas.style.marginTop) || 0;

    const displayW = Number.parseFloat(canvas.style.width) || logicalW;

    const displayH = Number.parseFloat(canvas.style.height) || logicalH;

    const scaleX = displayW / Math.max(1, logicalW);

    const scaleY = displayH / Math.max(1, logicalH);



    button.style.left = `${marginLeft + rect.x * scaleX}px`;

    button.style.top = `${marginTop + rect.y * scaleY}px`;

    button.style.width = `${rect.width * scaleX}px`;

    button.style.height = `${rect.height * scaleY}px`;

  }



  private mountMenuLootOverlay(): void {
    const host = document.querySelector<HTMLElement>('#app');
    if (!host) {
      return;
    }
    host.style.position = 'relative';
    this.menuHost = host;
    this.lootTotals.mount(host);
    this.lootTotals.setVisible(true);
  }

  private unmountMenuLootOverlay(): void {
    this.lootTotals.unmount();
    this.menuHost = undefined;
  }

  private layoutMenuLootOverlay(logicalW: number, logicalH: number): void {
    const canvas = this.app?.canvas;
    if (!canvas) {
      return;
    }
    this.lootTotals.layout(canvas, logicalW, logicalH);
  }

  private unmountPlayHitButton(): void {

    this.playHitButton?.remove();

    this.playHitButton = undefined;

  }

  private async loadAndDisplayMenuCurrency(): Promise<void> {
    debugLogMenuBagStorageRead();
    debugLogLocalStorageCurrency();
    debugLogFirebaseAuthUser();

    const local = readMenuCurrencyFromLocalStorage();
    if (local) {
      this.applyMenuCurrencySnapshot(local, 'immediate localStorage (before firebase)', {
        skipSourceMessage: true,
      });
      logMenuCurrencySourceMessage(local);
    }

    let firebase: MenuCurrencySnapshot | null = null;
    const uid = auth.currentUser?.uid;
    if (uid) {
      firebase = await readMenuCurrencyFromFirebase(uid);
    } else {
      console.info('[MenuCurrency] auth unavailable on this origin — trying localStorage only', {
        origin: typeof window !== 'undefined' ? window.location.origin : 'unknown',
      });
    }

    const resolved = resolveMenuCurrencyDisplay(local, firebase);
    if (resolved) {
      logMenuCurrencyLoad(`menu currency resolved (pre-live): ${resolved.source}`, resolved);
      this.applyMenuCurrencySnapshot(resolved, 'menu init resolved (pre-live)');
    } else {
      console.info('[MenuCurrency] waiting for firebase live save before showing defaults', {
        hasLocal: !!local,
        hasFirebase: !!firebase,
      });
    }
  }

  private finalizeMenuCurrencyLoad(
    local: MenuCurrencySnapshot | null,
    firebase: MenuCurrencySnapshot | null,
    reason: string,
  ): void {
    const resolved = resolveMenuCurrencyDisplay(local, firebase, {
      allowFirebaseEmpty: true,
      allowDefault: true,
    });
    if (!resolved) {
      return;
    }
    this.currencyLoadSettled = true;
    logMenuCurrencyLoad(`${reason}: ${resolved.source}`, resolved);
    this.applyMenuCurrencySnapshot(resolved, reason, { allowDefault: true });
  }

  private applyMenuCurrencySnapshot(
    snap: MenuCurrencySnapshot,
    reason: string,
    options?: { skipSourceMessage?: boolean; allowDefault?: boolean },
  ): void {
    if (snap.source === 'default' && !this.currencyLoadSettled && !options?.allowDefault) {
      return;
    }

    logMenuCurrencyLoad(reason, snap);
    if (!options?.skipSourceMessage) {
      logMenuCurrencySourceMessage(snap);
    }
    this.lootTotals.setTotals(snap.gold, snap.diamonds);
    if (snap.source !== 'default') {
      persistMenuCurrencySnapshot(snap);
    }
  }

  private applyCachedMenuBagTotals(): void {
    const local = readMenuCurrencyFromLocalStorage();
    if (!local) {
      return;
    }
    this.applyMenuCurrencySnapshot(local, 'localStorage fallback');
  }

  private startBagTotalsSubscription(): void {
    this.stopAuthSubscription();
    this.authUnsubscribe = onAuthStateChanged(auth, (user) => {
      void this.bindBagTotalsForUser(user);
    });
    if (auth.currentUser) {
      void this.bindBagTotalsForUser(auth.currentUser);
    }
  }

  private async bindBagTotalsForUser(user: User | null): Promise<void> {
    this.bagUnsubscribe?.();
    this.bagUnsubscribe = null;
    this.bagTotalsUid = user?.uid ?? null;

    debugLogFirebaseAuthUser();
    debugLogLocalStorageCurrency();

    if (!user?.uid) {
      console.info('[MenuCurrency] bag subscription waiting — no auth user yet');
      const local = readMenuCurrencyFromLocalStorage();
      if (local) {
        this.applyMenuCurrencySnapshot(local, 'no auth — localStorage only');
      }
      if (!this.currencyLoadSettled) {
        this.finalizeMenuCurrencyLoad(local, null, 'no auth — finalize');
      }
      return;
    }

    const uid = user.uid;

    this.bagUnsubscribe = subscribeUserBagBalances(
      uid,
      (b) => {
        if (this.bagTotalsUid !== uid) {
          return;
        }
        this.firebaseLiveReceived = true;
        console.info('[MenuCurrency] firebase live bag update', {
          uid,
          saveData: b,
          gold: b.bagGold,
          diamonds: b.bagDiamonds,
        });
        const local = readMenuCurrencyFromLocalStorage();
        const remote = snapshotFromFirebaseLive(uid, b.bagGold, b.bagDiamonds);
        const snap = resolveMenuCurrencyDisplay(local, remote, {
          allowFirebaseEmpty: true,
          allowDefault: true,
        });
        if (!snap) {
          return;
        }
        this.currencyLoadSettled = true;
        this.applyMenuCurrencySnapshot(snap, `firebase live → ${snap.source}`, { allowDefault: true });
      },
      (err) => {
        console.warn('[MenuScene] bag totals subscribe failed', err);
        const local = readMenuCurrencyFromLocalStorage();
        if (local) {
          this.applyMenuCurrencySnapshot(local, 'localStorage fallback');
        }
        if (!this.currencyLoadSettled) {
          this.finalizeMenuCurrencyLoad(local, null, 'firebase subscribe failed — finalize');
        }
      },
    );

    if (!this.currencyLoadSettled) {
      const local = readMenuCurrencyFromLocalStorage();
      const firebase = await readMenuCurrencyFromFirebase(uid);
      const snap = resolveMenuCurrencyDisplay(local, firebase);
      if (snap) {
        this.applyMenuCurrencySnapshot(snap, 'auth ready — profile merge (pre-live)');
      }
      await Promise.resolve();
      if (!this.firebaseLiveReceived) {
        this.finalizeMenuCurrencyLoad(local, firebase, 'auth ready — finalize without live');
      }
    }
  }

  private stopBagTotalsSubscription(): void {
    this.bagUnsubscribe?.();
    this.bagUnsubscribe = null;
    this.bagTotalsUid = null;
  }

  private stopAuthSubscription(): void {
    this.stopBagTotalsSubscription();
    this.authUnsubscribe?.();
    this.authUnsubscribe = null;
  }



  private async handlePlay(): Promise<void> {
    if (this.playStarted) {
      return;
    }
    this.playStarted = true;

    if (this.playHitButton) {
      this.playHitButton.style.display = 'none';
    }
    this.lootTotals.setVisible(false);
    this.playHitZone.eventMode = 'none';

    this.playButton.startPressAnimation();

    applyMenuBackDriftAnimation(
      this.menuBack,
      this.viewportW,
      this.viewportH,
      this.menuBackCoverScale,
      this.menuAnimTimeSec,
    );

    this.dreamyFadeOverlay = createMenuDreamyFadeOverlay(this.viewportW, this.viewportH);
    this.dreamyFadeOverlay.zIndex = 30;
    this.container.addChild(this.dreamyFadeOverlay);
    this.container.sortChildren();

    await new Promise<void>((resolve, reject) => {
      this.playTransition = new MenuPlayTransition(
        this.menuContent,
        this.menuBack,
        this.dreamyFadeOverlay!,
        this.viewportW,
        this.viewportH,
        (handoff) => {
          void this.beginPlayHandoff(handoff).then(resolve).catch(reject);
        },
      );
    });
  }

  private async beginPlayHandoff(handoff: MenuPlayHandoff): Promise<void> {
    if (this.playHandoffStarted) {
      return;
    }
    this.playHandoffStarted = true;

    const app = this.app;
    if (!app) {
      return;
    }

    handoff.fadeOverlay.parent?.removeChild(handoff.fadeOverlay);
    app.stage.addChild(handoff.fadeOverlay);

    await Promise.resolve(this.onPlay(handoff));
  }

}


