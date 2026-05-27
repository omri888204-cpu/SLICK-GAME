import { Container, Graphics, Sprite, type Texture } from 'pixi.js';
import { GlowFilter } from 'pixi-filters';
import { tunedBloom } from '../../config/game.config';
import {
  computeMenuPlayButtonPaintedRect,
  type MenuCoverLayout,
} from '../constants/menuBackground';

/** Blink cycle on the PLAY glow line (idle menu). */
const PLAY_PULSE_PERIOD_SEC = 2.4;
const PLAY_SQUASH_SCALE_X = 1.04;
const PLAY_SQUASH_SCALE_Y = 0.92;
const PLAY_SQUASH_SEC = 0.08;
const PLAY_BOUNCE_SEC = 0.17;
const PLAY_POST_GLOW_SEC = 4;
const PLAY_POST_GLOW_PULSE_SEC = 0.55;
const PLAY_POST_GLOW_FADE_START = 0.82;
const PLAY_GLOW_BOOST_OUTER = 10.5;
const PLAY_GLOW_BOOST_INNER = 4;
const PLAY_GLOW_BOOST_DISTANCE = 25;
const PLAY_GLOW_PRESS_COLOR = 0xfff0a8;
/** Glow pill narrower than PLAY art — width only (symmetric base). */
const PLAY_GLOW_WIDTH_SCALE = 0.91;
/** Extra reach on the right edge only (fraction of full PLAY width). */
const PLAY_GLOW_RIGHT_EXTEND_RATIO = 0.035;
/** Extra reach on the top edge only (fraction of full PLAY height). */
const PLAY_GLOW_TOP_EXTEND_RATIO = 0.03;

type PlayClickPhase = 'squash' | 'bounce';

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** PLAY button art + pill-shaped golden glow stroke. */
export class MenuPlayButton extends Container {
  private readonly art = new Sprite();
  private readonly glowLayer = new Container();
  private readonly glowHalo = new Graphics();
  private readonly glowCore = new Graphics();
  private readonly glowFilter = new GlowFilter({
    distance: tunedBloom(17),
    outerStrength: tunedBloom(3.4),
    innerStrength: tunedBloom(1.45),
    color: 0xffe566,
    alpha: tunedBloom(0.6),
    quality: tunedBloom(0.28),
  });
  private glowW = 0;
  private glowH = 0;
  private pressAnimElapsedSec = 0;
  private pressAnimPhaseElapsedSec = 0;
  private pressScaleAnimRunning = false;
  private pressGlowAnimRunning = false;
  private pressAnimPhase: PlayClickPhase = 'squash';
  private pressAnimDone?: () => void;
  /** Cinematic handoff — filter off, flat strokes, no per-frame glow updates. */
  private cinematicGlowMode = false;

  constructor() {
    super();
    this.eventMode = 'none';
    this.art.eventMode = 'none';
    this.glowLayer.eventMode = 'none';
    this.glowHalo.eventMode = 'none';
    this.glowCore.eventMode = 'none';
    this.glowLayer.filters = [this.glowFilter];
    this.glowLayer.addChild(this.glowHalo, this.glowCore);
    this.addChild(this.art, this.glowLayer);
  }

  setTexture(texture: Texture): void {
    this.art.texture = texture;
  }

  layout(layout: MenuCoverLayout, texW: number, texH: number): void {
    const painted = computeMenuPlayButtonPaintedRect(layout, texW, texH);
    this.position.set(painted.x + painted.width * 0.5, painted.y + painted.height * 0.5);
    this.glowW = painted.width;
    this.glowH = painted.height;
    this.art.anchor.set(0.5, 0.5);
    this.art.position.set(0, 0);
    this.art.width = painted.width;
    this.art.height = painted.height;
    this.redrawGlowLine();
  }

  pulse(timeSec: number): void {
    if (this.pressScaleAnimRunning || this.pressGlowAnimRunning) {
      return;
    }
    const wave = 0.5 + 0.5 * Math.sin((timeSec * Math.PI * 2) / PLAY_PULSE_PERIOD_SEC);
    const blink = wave * wave;
    this.glowFilter.alpha = tunedBloom(0.12) + blink * tunedBloom(0.72);
    this.glowHalo.alpha = tunedBloom(0.14) + blink * tunedBloom(0.42);
    this.glowCore.alpha = tunedBloom(0.18) + blink * tunedBloom(0.75);
  }

  /** Squash + bounce; switches to flat glow for cinematic zoom (no filter shimmer). */
  startPressAnimation(onComplete?: () => void): void {
    this.pressAnimElapsedSec = 0;
    this.pressAnimPhaseElapsedSec = 0;
    this.pressScaleAnimRunning = true;
    this.pressGlowAnimRunning = true;
    this.pressAnimPhase = 'squash';
    this.pressAnimDone = onComplete;
    this.cinematicGlowMode = false;
    this.scale.set(1);
    this.beginCinematicTransitionGlow();
  }

  /** Drop bloom filter during menu fly-in — parent scale otherwise flickers the stroke. */
  beginCinematicTransitionGlow(): void {
    this.cinematicGlowMode = true;
    this.glowLayer.filters = null;
    this.redrawGlowLine(true);
    this.glowHalo.alpha = 1;
    this.glowCore.alpha = 1;
  }

  tickPressAnimation(dtSec: number): void {
    if (!this.pressScaleAnimRunning && !this.pressGlowAnimRunning) {
      return;
    }

    if (this.pressGlowAnimRunning) {
      this.pressAnimElapsedSec += dtSec;
      this.applyClickGlow(this.pressAnimElapsedSec);
      if (this.pressAnimElapsedSec >= PLAY_POST_GLOW_SEC) {
        this.pressGlowAnimRunning = false;
        this.finishPressAnimation();
      }
    }

    if (this.pressScaleAnimRunning) {
      this.pressAnimPhaseElapsedSec += dtSec;

      if (this.pressAnimPhase === 'squash') {
        const t = Math.min(1, this.pressAnimPhaseElapsedSec / PLAY_SQUASH_SEC);
        this.scale.set(
          lerp(1, PLAY_SQUASH_SCALE_X, t),
          lerp(1, PLAY_SQUASH_SCALE_Y, t),
        );
        if (t >= 1) {
          this.pressAnimPhase = 'bounce';
          this.pressAnimPhaseElapsedSec = 0;
        }
      } else {
        const t = Math.min(1, this.pressAnimPhaseElapsedSec / PLAY_BOUNCE_SEC);
        const eased = easeOutCubic(t);
        this.scale.set(
          lerp(PLAY_SQUASH_SCALE_X, 1, eased),
          lerp(PLAY_SQUASH_SCALE_Y, 1, eased),
        );
        if (t >= 1) {
          this.scale.set(1);
          this.finishPressScaleAnimation();
        }
      }
    }
  }

  /** Press flash only — cinematic mode uses flat strokes instead. */
  private applyClickGlow(elapsedSec: number): void {
    if (this.cinematicGlowMode) {
      const fadeOutAt = PLAY_POST_GLOW_SEC * PLAY_POST_GLOW_FADE_START;
      if (elapsedSec <= fadeOutAt) {
        return;
      }
      const envelope = Math.max(
        0,
        1 - (elapsedSec - fadeOutAt) / (PLAY_POST_GLOW_SEC - fadeOutAt),
      );
      this.glowHalo.alpha = envelope;
      this.glowCore.alpha = envelope;
      return;
    }

    const fadeOutAt = PLAY_POST_GLOW_SEC * PLAY_POST_GLOW_FADE_START;
    const envelope =
      elapsedSec <= fadeOutAt
        ? 1
        : Math.max(0, 1 - (elapsedSec - fadeOutAt) / (PLAY_POST_GLOW_SEC - fadeOutAt));
    const pulse = 0.5 + 0.5 * Math.sin((elapsedSec * Math.PI * 2) / PLAY_POST_GLOW_PULSE_SEC);
    const shine = envelope * (0.62 + pulse * 0.38);
    this.glowFilter.distance = tunedBloom(lerp(17, PLAY_GLOW_BOOST_DISTANCE, shine));
    this.glowFilter.outerStrength = tunedBloom(lerp(3.4, PLAY_GLOW_BOOST_OUTER, shine));
    this.glowFilter.innerStrength = tunedBloom(lerp(1.45, PLAY_GLOW_BOOST_INNER, shine));
    this.glowFilter.color = shine > 0.04 ? PLAY_GLOW_PRESS_COLOR : 0xffe566;
    this.glowFilter.alpha = tunedBloom(lerp(0.6, 0.95, shine));
    this.glowHalo.alpha = tunedBloom(lerp(0.14, 0.92, shine));
    this.glowCore.alpha = tunedBloom(lerp(0.18, 0.95, shine));
  }

  private finishPressScaleAnimation(): void {
    this.scale.set(1);
    this.pressScaleAnimRunning = false;
  }

  private finishPressAnimation(): void {
    this.scale.set(1);
    this.pressScaleAnimRunning = false;
    this.pressGlowAnimRunning = false;
    const done = this.pressAnimDone;
    this.pressAnimDone = undefined;
    done?.();
  }

  isPressAnimating(): boolean {
    return this.pressScaleAnimRunning || this.pressGlowAnimRunning;
  }

  override destroy(options?: Parameters<Container['destroy']>[0]): void {
    this.glowLayer.filters = null;
    super.destroy(options);
  }

  /** Perfect pill outline with soft outer halo + bright core for bloom. */
  private redrawGlowLine(transitionBright = false): void {
    const fullW = this.glowW;
    const h = this.glowH;
    if (fullW <= 0 || h <= 0) {
      this.glowHalo.clear();
      this.glowCore.clear();
      return;
    }

    const halfScaled = (fullW * PLAY_GLOW_WIDTH_SCALE) * 0.5;
    const glowLeft = -halfScaled;
    const glowRight = halfScaled + fullW * PLAY_GLOW_RIGHT_EXTEND_RATIO;

    const halfH = h * 0.5;
    const glowTop = -halfH - h * PLAY_GLOW_TOP_EXTEND_RATIO;
    const glowBottom = halfH;

    const drawH = glowBottom - glowTop;
    const drawW = glowRight - glowLeft;
    const radius = Math.min(drawH * 0.5, drawW * 0.5);
    const coreWidth = Math.max(1.6, h * (transitionBright ? 0.05 : 0.04));
    const haloWidth = coreWidth * (transitionBright ? 1.62 : 1.48);
    const haloColor = transitionBright ? PLAY_GLOW_PRESS_COLOR : 0xffe566;
    this.strokePill(
      this.glowHalo,
      glowLeft,
      glowRight,
      glowTop,
      glowBottom,
      radius,
      haloWidth,
      haloColor,
      transitionBright ? 0.68 : 0.42,
    );
    this.strokePill(
      this.glowCore,
      glowLeft,
      glowRight,
      glowTop,
      glowBottom,
      radius,
      coreWidth,
      0xfff8b8,
      transitionBright ? 0.95 : 0.8,
    );
  }

  private strokePill(
    target: Graphics,
    left: number,
    right: number,
    top: number,
    bottom: number,
    radius: number,
    strokeWidth: number,
    color: number,
    alpha: number,
  ): void {
    const w = right - left;
    const h = bottom - top;
    if (w <= 0 || h <= 0) {
      target.clear();
      return;
    }
    const halfStroke = strokeWidth * 0.5;
    target.clear();
    target
      .roundRect(
        left + halfStroke,
        top + halfStroke,
        w - strokeWidth,
        h - strokeWidth,
        Math.max(0, radius - halfStroke),
      )
      .stroke({
        width: strokeWidth,
        color,
        alpha,
        join: 'round',
        cap: 'round',
      });
  }
}
