import { Container, Graphics, type Sprite } from 'pixi.js';

export const MENU_PLAY_TRANSITION = {
  totalSec: 4,
  zoomScale: 1.18,
  zoomSec: 3.5,
  /** Bright cloud opening — normalized viewport focus (top center). */
  focusNormX: 0.5,
  focusNormY: 0.21,
  fadeStartSec: 2.35,
  fadeMaxAlpha: 0.55,
  cloudRiseMaxPx: 148,
  whiteFadeInSec: 0.65,
  fadeOutSec: 2,
  /** Avatar launch window before transition ends. */
  playerJumpLeadSec: 1.5,
  playerJumpHeightNorm: 0.36,
  /** Hand off once jump arc reaches its peak (jumpT ≈ 0.5). */
  playerJumpPeakNorm: 0.5,
  playerJumpPeakWindow: 0.06,
} as const;

/** Elapsed transition time when the menu avatar hits jump apex. */
export function computeMenuJumpPeakSec(): number {
  const cfg = MENU_PLAY_TRANSITION;
  return cfg.totalSec - cfg.playerJumpLeadSec + cfg.playerJumpLeadSec * cfg.playerJumpPeakNorm;
}

export type MenuPlayHandoff = {
  fadeOverlay: Container;
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

/** Soft pink cloud veil — avoids a harsh white flash before gameplay. */
export function createMenuDreamyFadeOverlay(viewportW: number, viewportH: number): Container {
  const overlay = new Container();
  overlay.eventMode = 'none';
  overlay.alpha = 0;

  const baseMist = new Graphics();
  baseMist.rect(0, 0, viewportW, viewportH).fill({ color: 0xffedf8, alpha: 0.52 });

  const pinkMist = new Graphics();
  pinkMist.rect(0, 0, viewportW, viewportH).fill({ color: 0xffc8e4, alpha: 0.28 });

  const topCloudGlow = new Graphics();
  topCloudGlow
    .roundRect(
      viewportW * 0.06,
      -viewportH * 0.06,
      viewportW * 0.88,
      viewportH * 0.52,
      viewportH * 0.2,
    )
    .fill({ color: 0xfff5fc, alpha: 0.24 });

  const upperBloom = new Graphics();
  upperBloom
    .roundRect(
      viewportW * 0.18,
      viewportH * 0.04,
      viewportW * 0.64,
      viewportH * 0.28,
      viewportH * 0.14,
    )
    .fill({ color: 0xffe8f4, alpha: 0.32 });

  overlay.addChild(baseMist, pinkMist, topCloudGlow, upperBloom);
  return overlay;
}

/** Cinematic climb into clouds, white fade-in at jump peak, then hand off to gameplay. */
export class MenuPlayTransition {
  private elapsedSec = 0;
  private readyEmitted = false;
  private phase: 'cinematic' | 'whiteIn' = 'cinematic';
  private whiteInElapsedSec = 0;
  private whiteFlash?: Graphics;
  private readonly viewportW: number;
  private readonly viewportH: number;
  private readonly baseMenuBackX: number;
  private readonly baseMenuBackY: number;
  private readonly baseMenuBackScale: number;
  private readonly baseContentX: number;
  private readonly baseContentY: number;
  private readonly focusX: number;
  private readonly focusY: number;

  constructor(
    private readonly menuContent: Container,
    private readonly menuBack: Sprite,
    private readonly fadeOverlay: Container,
    viewportW: number,
    viewportH: number,
    private readonly onReady: (handoff: MenuPlayHandoff) => void,
  ) {
    this.viewportW = viewportW;
    this.viewportH = viewportH;
    this.baseMenuBackX = menuBack.x;
    this.baseMenuBackY = menuBack.y;
    this.baseMenuBackScale = menuBack.scale.x;
    this.baseContentX = menuContent.x;
    this.baseContentY = menuContent.y;
    this.focusX = viewportW * MENU_PLAY_TRANSITION.focusNormX;
    this.focusY = viewportH * MENU_PLAY_TRANSITION.focusNormY;
  }

  tick(dtSec: number): void {
    this.elapsedSec += dtSec;
    const t = this.elapsedSec;
    const cfg = MENU_PLAY_TRANSITION;

    if (this.phase === 'whiteIn') {
      this.tickWhiteFadeIn(dtSec, cfg);
      return;
    }

    const zoomT = easeInOutSine(Math.min(1, t / cfg.zoomSec));
    const zoomScale = lerp(1, cfg.zoomScale, zoomT);
    this.menuContent.scale.set(zoomScale);
    this.menuContent.position.set(
      this.baseContentX - (this.focusX - this.baseContentX) * (zoomScale - 1),
      this.baseContentY - (this.focusY - this.baseContentY) * (zoomScale - 1),
    );

    const life = Math.min(1, t / cfg.totalSec);
    const lifeCurve = life ** 1.55;
    const cloudRise = cfg.cloudRiseMaxPx * lifeCurve;
    const breathe = 0.28 + life * 0.72;
    const dreamyLift =
      Math.sin(t * 2.15) * 8 * breathe + Math.sin(t * 3.45 + 1.1) * 3.5 * breathe;
    const dreamyDrift =
      Math.sin(t * 1.55 + 0.5) * 6 * breathe + Math.sin(t * 2.85 + 2.2) * 2.5 * life;
    const cloudParallax = 1 + lifeCurve * 0.035;

    this.menuBack.y = this.baseMenuBackY - cloudRise + dreamyLift;
    this.menuBack.x = this.baseMenuBackX + dreamyDrift;
    this.menuBack.scale.set(this.baseMenuBackScale * cloudParallax);

    if (t < cfg.fadeStartSec) {
      this.fadeOverlay.alpha = 0;
    } else {
      const jumpStartSec = cfg.totalSec - cfg.playerJumpLeadSec;
      const peakSec = computeMenuJumpPeakSec();
      const rampEnd = Math.max(cfg.fadeStartSec + 0.001, peakSec);
      const fadeT = smoothstep((Math.min(t, peakSec) - cfg.fadeStartSec) / (rampEnd - cfg.fadeStartSec));
      this.fadeOverlay.alpha = fadeT * fadeT * cfg.fadeMaxAlpha;
    }

    const jumpStartSec = cfg.totalSec - cfg.playerJumpLeadSec;
    if (t >= jumpStartSec) {
      const jumpT = (t - jumpStartSec) / cfg.playerJumpLeadSec;
      const peak = cfg.playerJumpPeakNorm;
      if (jumpT >= peak - cfg.playerJumpPeakWindow && jumpT <= peak + cfg.playerJumpPeakWindow) {
        this.phase = 'whiteIn';
        this.whiteInElapsedSec = 0;
      }
    }
  }

  private tickWhiteFadeIn(dtSec: number, cfg: typeof MENU_PLAY_TRANSITION): void {
    this.whiteInElapsedSec += dtSec;
    const white = this.ensureWhiteFlash();
    const wt = Math.min(1, this.whiteInElapsedSec / cfg.whiteFadeInSec);
    const eased = easeOutCubic(wt);
    white.alpha = eased;
    this.fadeOverlay.alpha = Math.max(this.fadeOverlay.alpha, eased);

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
