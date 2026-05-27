import { Container, Graphics, type Sprite } from 'pixi.js';
import { PortalWarpOverlay } from './PortalWarpOverlay';

export const MENU_PLAY_TRANSITION = {
  totalSec: 4.2,
  zoomSec: 2.5,
  zoomScale: 1.24,
  cloudRiseMaxPx: 148,
  fadeStartSec: 2.05,
  fadeMaxAlpha: 0.5,
  suctionStartSec: 0.5,
  suctionSec: 1.75,
  warpStartSec: 1.9,
  handoffAtSec: 2.7,
  whiteFadeInSec: 0.55,
  fadeOutSec: 2,
} as const;

export function computeMenuHandoffSec(): number {
  return MENU_PLAY_TRANSITION.handoffAtSec;
}

export type MenuPlayHandoff = {
  fadeOverlay: Container;
};

export type MenuPortalTransitionState = {
  elapsedSec: number;
  zoomT: number;
  portalGlow: number;
  suctionT: number;
  warpIntensity: number;
  phase: 'approach' | 'warp' | 'whiteIn';
};

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function easeInOutSine(t: number): number {
  return 0.5 - Math.cos(t * Math.PI) * 0.5;
}

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

function smoothstep(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

/** Soft pink cloud veil before the cosmic warp takes over. */
export function createMenuDreamyFadeOverlay(viewportW: number, viewportH: number): Container {
  const overlay = new Container();
  overlay.eventMode = 'none';
  overlay.alpha = 0;

  const baseMist = new Graphics();
  baseMist.rect(0, 0, viewportW, viewportH).fill({ color: 0xffedf8, alpha: 0.52 });

  const pinkMist = new Graphics();
  pinkMist.rect(0, 0, viewportW, viewportH).fill({ color: 0xffc8e4, alpha: 0.28 });

  overlay.addChild(baseMist, pinkMist);
  return overlay;
}

export function sampleMenuPortalTransition(elapsedSec: number): MenuPortalTransitionState {
  const cfg = MENU_PLAY_TRANSITION;
  const t = elapsedSec;
  const zoomT = easeInOutSine(Math.min(1, t / cfg.zoomSec));
  const portalGlow = smoothstep(Math.min(1, t / (cfg.zoomSec * 0.95)));

  let suctionT = 0;
  if (t >= cfg.suctionStartSec) {
    suctionT = smoothstep(Math.min(1, (t - cfg.suctionStartSec) / cfg.suctionSec));
  }

  let warpIntensity = 0;
  if (t >= cfg.warpStartSec) {
    warpIntensity = smoothstep(Math.min(1, (t - cfg.warpStartSec) / (cfg.handoffAtSec - cfg.warpStartSec)));
  }

  const phase: MenuPortalTransitionState['phase'] =
    t >= cfg.handoffAtSec ? 'whiteIn' : warpIntensity > 0.02 ? 'warp' : 'approach';

  return {
    elapsedSec: t,
    zoomT,
    portalGlow,
    suctionT,
    warpIntensity,
    phase,
  };
}

/** Zoom toward the painted menu portal, warp tunnel, then hand off to gameplay. */
export class MenuPlayTransition {
  private elapsedSec = 0;
  private readyEmitted = false;
  private whiteInElapsedSec = 0;
  private whiteFlash?: Graphics;
  private readonly warpOverlay: PortalWarpOverlay;
  private readonly viewportW: number;
  private readonly viewportH: number;
  private readonly baseMenuBackX: number;
  private readonly baseMenuBackY: number;
  private readonly baseMenuBackScale: number;
  private readonly baseContentX: number;
  private readonly baseContentY: number;
  private readonly portalFocusX: number;
  private readonly portalFocusY: number;

  constructor(
    private readonly menuContent: Container,
    private readonly menuBack: Sprite,
    private readonly fadeOverlay: Container,
    viewportW: number,
    viewportH: number,
    portalFocusX: number,
    portalFocusY: number,
    private readonly onReady: (handoff: MenuPlayHandoff) => void,
  ) {
    this.viewportW = viewportW;
    this.viewportH = viewportH;
    this.portalFocusX = portalFocusX;
    this.portalFocusY = portalFocusY;
    this.baseMenuBackX = menuBack.x;
    this.baseMenuBackY = menuBack.y;
    this.baseMenuBackScale = menuBack.scale.x;
    this.baseContentX = menuContent.x;
    this.baseContentY = menuContent.y;

    this.warpOverlay = new PortalWarpOverlay();
    this.warpOverlay.resize(viewportW, viewportH);
    this.warpOverlay.zIndex = 20;
    fadeOverlay.addChild(this.warpOverlay);
  }

  getState(): MenuPortalTransitionState {
    return sampleMenuPortalTransition(this.elapsedSec);
  }

  tick(dtSec: number): void {
    this.elapsedSec += dtSec;
    const state = this.getState();
    const cfg = MENU_PLAY_TRANSITION;

    if (state.phase === 'whiteIn') {
      this.tickWhiteFadeIn(dtSec, cfg);
      return;
    }

    const zoomScale = lerp(1, cfg.zoomScale, state.zoomT);
    this.menuContent.scale.set(zoomScale);
    this.menuContent.position.set(
      this.baseContentX - (this.portalFocusX - this.baseContentX) * (zoomScale - 1),
      this.baseContentY - (this.portalFocusY - this.baseContentY) * (zoomScale - 1),
    );

    const life = Math.min(1, state.elapsedSec / cfg.totalSec);
    const lifeCurve = life ** 1.55;
    const cloudRise = cfg.cloudRiseMaxPx * lifeCurve;
    const breathe = 0.28 + life * 0.72;
    const dreamyLift =
      Math.sin(state.elapsedSec * 2.15) * 8 * breathe +
      Math.sin(state.elapsedSec * 3.45 + 1.1) * 3.5 * breathe;
    const dreamyDrift =
      Math.sin(state.elapsedSec * 1.55 + 0.5) * 6 * breathe +
      Math.sin(state.elapsedSec * 2.85 + 2.2) * 2.5 * life;
    const cloudParallax = 1 + lifeCurve * 0.035;

    this.menuBack.y = this.baseMenuBackY - cloudRise + dreamyLift;
    this.menuBack.x = this.baseMenuBackX + dreamyDrift;
    this.menuBack.scale.set(this.baseMenuBackScale * cloudParallax);

    if (state.elapsedSec < cfg.fadeStartSec) {
      this.fadeOverlay.alpha = 0;
    } else {
      const handoffSec = computeMenuHandoffSec();
      const rampEnd = Math.max(cfg.fadeStartSec + 0.001, handoffSec);
      const fadeT = smoothstep(
        (Math.min(state.elapsedSec, handoffSec) - cfg.fadeStartSec) / (rampEnd - cfg.fadeStartSec),
      );
      this.fadeOverlay.alpha = fadeT * fadeT * cfg.fadeMaxAlpha;
    }

    this.warpOverlay.setIntensity(state.warpIntensity);
    this.warpOverlay.tick(dtSec);

    if (state.elapsedSec >= cfg.handoffAtSec) {
      this.tickWhiteFadeIn(0, cfg);
    }
  }

  private tickWhiteFadeIn(dtSec: number, cfg: typeof MENU_PLAY_TRANSITION): void {
    this.whiteInElapsedSec += dtSec;
    const white = this.ensureWhiteFlash();
    const wt = Math.min(1, this.whiteInElapsedSec / cfg.whiteFadeInSec);
    const eased = easeOutCubic(wt);
    white.alpha = eased;
    this.fadeOverlay.alpha = Math.max(this.fadeOverlay.alpha, eased);
    this.warpOverlay.setIntensity(Math.max(0, 1 - wt));

    if (wt >= 1 && !this.readyEmitted) {
      this.fadeOverlay.alpha = 1;
      white.alpha = 1;
      this.readyEmitted = true;
      this.onReady({ fadeOverlay: this.fadeOverlay });
    }
  }

  private ensureWhiteFlash(): Graphics {
    if (this.whiteFlash) {
      return this.whiteFlash;
    }
    const white = new Graphics();
    white.rect(0, 0, this.viewportW, this.viewportH).fill({ color: 0xffffff, alpha: 1 });
    this.fadeOverlay.addChild(white);
    this.whiteFlash = white;
    return white;
  }

  hasHandedOff(): boolean {
    return this.readyEmitted;
  }

  getElapsedSec(): number {
    return this.elapsedSec;
  }
}

export function fadeOutMenuHandoffOverlay(
  overlay: Container,
  tick: (fn: (ticker: { deltaMS: number }) => void) => void,
  removeTick: (fn: (ticker: { deltaMS: number }) => void) => void,
  durationSec = MENU_PLAY_TRANSITION.fadeOutSec,
): Promise<void> {
  return new Promise((resolve) => {
    const startAlpha = overlay.alpha;
    let elapsedSec = 0;
    const step = (ticker: { deltaMS: number }): void => {
      elapsedSec += ticker.deltaMS / 1000;
      const p = easeInOutSine(Math.min(1, elapsedSec / durationSec));
      overlay.alpha = startAlpha * (1 - p);
      if (p >= 1) {
        removeTick(step);
        overlay.destroy({ children: true });
        resolve();
      }
    };
    tick(step);
  });
}
