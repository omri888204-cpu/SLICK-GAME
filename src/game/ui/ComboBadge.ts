import { Container, Graphics, Text, type DestroyOptions } from 'pixi.js';
import { COMBO, tunedBloom, tunedBlur, tunedUiAlpha, tunedUiStroke } from '../../config/game.config';

/** Outer box geometry in local coordinates — `position` is set externally to the badge center. */
export const COMBO_BADGE_W = 184;
export const COMBO_BADGE_H = 82;

/**
 * Words played top → bottom of the tier ladder. First chain jump (`comboCount` === 2) starts at `QUICK!`;
 * each word spans {@link COMBO.jumpsPerWord} consecutive counted jumps before the next.
 */
export const COMBO_TIER_WORDS: readonly string[] = [
  'QUICK!',
  'SLICK!',
  'BLAZE!',
  'RUSH!',
  'WILD!',
  'FIRE!',
  'STORM!',
  'CHAOS!',
  'INSANE!',
  'FRENZY!',
  'INFERNO!',
  'VORTEX!',
  'COSMIC!',
  'LEGENDARY!',
  'GODLIKE!',
];

/** Matching color per tier index. `-1` means "render as a live rainbow cycle". */
const COMBO_TIER_COLORS: readonly number[] = [
  0xffffff, // QUICK
  0xffe066, // SLICK
  0xffa040, // BLAZE
  0xff5040, // RUSH
  0xff3080, // WILD
  0xff44dd, // FIRE
  0xa040ff, // STORM
  0x6080ff, // CHAOS
  0x40ffe0, // INSANE
  0x60ff40, // FRENZY
  0xffd700, // INFERNO
  -1, // VORTEX – rainbow
  0xffffff, // COSMIC
  0xffaa00, // LEGENDARY
  -1, // GODLIKE – rainbow
];

/** 0-based word tier from raw streak counter (`comboCount`), capped to `COMBO_TIER_WORDS`. */
export function comboStreakToWordTier(comboCount: number): number {
  if (comboCount < 2) {
    return -1;
  }
  return Math.min(
    Math.floor((comboCount - 2) / COMBO.jumpsPerWord),
    COMBO_TIER_WORDS.length - 1,
  );
}

const SPAWN_DURATION_SEC = 0.22;
const PUNCH_DURATION_SEC = 0.15;
const EXPIRE_DURATION_SEC = 0.28;
const SPAWN_OVERSHOOT = 1.6;
const PUNCH_OVERSHOOT = 1.4;

type BadgeParticle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  isStar: boolean;
  /** -1 = render in current tier color; otherwise a hue for rainbow confetti. */
  hue: number;
};

/**
 * Animated "Icy Tower style" combo badge — pops in from the left, punches on each tier-up,
 * pulses gently between hits, and fades out when the chain expires.
 *
 * External wiring contract:
 *   - `bumpTo(combo)` — call whenever the streak counter updates (≥ 2). Word tier advances every
 *     {@link COMBO.jumpsPerWord} jumps; same-tier bumps still punch the badge + refresh `xN`.
 *   - `expire()` — call when the chain window times out or the run resets.
 *   - `tick(dt)` — call every frame to advance animations.
 *   - `position.set(centerX, centerY)` — pivot is the badge's geometric center.
 */
export class ComboBadge extends Container {
  private readonly bg = new Graphics();
  private readonly glow = new Graphics();
  private readonly particleLayer = new Graphics();
  private readonly wordText: Text;
  private readonly comboText: Text;

  private animTime = 0;
  private spawnTime = 0;
  private punchTime = 0;
  private expireTimeLeft = 0;
  private currentTier = -1;
  private currentCombo = 0;
  private particles: BadgeParticle[] = [];
  private alive = false;
  private expiring = false;

  constructor() {
    super();
    /** Anchor transforms (scale/rotation from animations) on the badge center. */
    this.pivot.set(COMBO_BADGE_W * 0.5, COMBO_BADGE_H * 0.5);
    this.eventMode = 'none';
    this.glow.eventMode = 'none';
    this.bg.eventMode = 'none';
    this.particleLayer.eventMode = 'none';
    this.sortableChildren = true;

    this.wordText = new Text({
      text: '',
      style: {
        fill: '#ffffff',
        fontFamily: 'Orbitron, "Press Start 2P", Arial Black, Impact, sans-serif',
        fontWeight: '900',
        fontSize: 30,
        letterSpacing: 2,
        stroke: { color: '#1a0028', width: tunedUiStroke(5) },
        dropShadow: {
          alpha: tunedBloom(0.65),
          angle: Math.PI / 4,
          blur: tunedBlur(5),
          color: '#ff2288',
          distance: 3,
        },
      },
    });
    this.wordText.anchor.set(0.5);

    this.comboText = new Text({
      text: '',
      style: {
        fill: '#ffe066',
        fontFamily: 'Orbitron, Arial Black, Impact, sans-serif',
        fontWeight: '800',
        fontSize: 18,
        letterSpacing: 1,
        stroke: { color: '#1a0028', width: 3 },
      },
    });
    this.comboText.anchor.set(0.5);

    this.addChild(this.glow, this.bg, this.particleLayer, this.wordText, this.comboText);
    this.glow.zIndex = 0;
    this.bg.zIndex = 1;
    this.particleLayer.zIndex = 3;
    this.wordText.zIndex = 2;
    this.comboText.zIndex = 2;

    this.visible = false;
  }

  isAlive(): boolean {
    return this.alive;
  }

  /**
   * Update for a new combo count (≥ 2). Triggers spawn-in on a cold badge,
   * punch + burst on every tier-up, and a softer punch on same-tier same-side bumps.
   */
  bumpTo(combo: number): void {
    if (combo < 2) {
      return;
    }
    const tier = comboStreakToWordTier(combo);
    const wasAlive = this.alive && !this.expiring;
    const tierChanged = tier !== this.currentTier;

    this.alive = true;
    this.expiring = false;
    this.expireTimeLeft = 0;
    this.currentCombo = combo;
    this.visible = true;

    if (tierChanged) {
      this.currentTier = tier;
      this.wordText.text = COMBO_TIER_WORDS[tier];
      this.adjustWordFontSize();
      this.spawnParticles(20);
    } else {
      this.spawnParticles(8);
    }
    this.comboText.text = `x${combo}`;

    if (!wasAlive) {
      this.spawnTime = SPAWN_DURATION_SEC;
      this.punchTime = 0;
    } else {
      this.punchTime = PUNCH_DURATION_SEC;
    }

    this.draw();
  }

  /** Trigger the fade-out animation. After it completes, the badge hides itself. */
  expire(): void {
    if (!this.alive || this.expiring) {
      return;
    }
    this.expiring = true;
    this.expireTimeLeft = EXPIRE_DURATION_SEC;
  }

  /** Hard reset (used by `resetRun`) — clears all state instantly with no animation. */
  resetState(): void {
    this.alive = false;
    this.expiring = false;
    this.spawnTime = 0;
    this.punchTime = 0;
    this.expireTimeLeft = 0;
    this.currentTier = -1;
    this.currentCombo = 0;
    this.particles = [];
    this.visible = false;
  }

  /** Advance animation phase by `dt` seconds. Safe to call when not alive. */
  tick(dt: number): void {
    this.animTime += dt;

    if (this.spawnTime > 0) {
      this.spawnTime = Math.max(0, this.spawnTime - dt);
    }
    if (this.punchTime > 0) {
      this.punchTime = Math.max(0, this.punchTime - dt);
    }
    if (this.expiring) {
      this.expireTimeLeft -= dt;
      if (this.expireTimeLeft <= 0) {
        this.alive = false;
        this.expiring = false;
        this.visible = false;
        this.particles = [];
        return;
      }
    }

    this.updateParticles(dt);
    if (this.alive) {
      this.draw();
    }
  }

  private adjustWordFontSize(): void {
    const word = this.wordText.text;
    /** Wider words ("LEGENDARY!") shrink to fit; short ones get the headline size. */
    const size = word.length > 9 ? 22 : word.length > 6 ? 26 : 30;
    this.wordText.style.fontSize = size;
  }

  private spawnParticles(count: number): void {
    const tierColor = this.currentTierBaseColor();
    for (let i = 0; i < count; i += 1) {
      const ang = Math.random() * Math.PI * 2;
      const speed = 80 + Math.random() * 200;
      this.particles.push({
        x: COMBO_BADGE_W * 0.5,
        y: COMBO_BADGE_H * 0.5,
        vx: Math.cos(ang) * speed,
        vy: Math.sin(ang) * speed - 60,
        age: 0,
        life: 0.45 + Math.random() * 0.45,
        isStar: Math.random() < 0.55,
        hue: tierColor === -1 ? Math.random() * 360 : -1,
      });
    }
  }

  private updateParticles(dt: number): void {
    if (this.particles.length === 0) {
      return;
    }
    this.particles = this.particles
      .map((p) => ({
        ...p,
        age: p.age + dt,
        x: p.x + p.vx * dt,
        y: p.y + p.vy * dt,
        vy: p.vy + 520 * dt,
        vx: p.vx * (1 - 1.6 * dt),
      }))
      .filter((p) => p.age < p.life);
  }

  private currentTierBaseColor(): number {
    if (this.currentTier < 0 || this.currentTier >= COMBO_TIER_COLORS.length) {
      return 0xffffff;
    }
    return COMBO_TIER_COLORS[this.currentTier];
  }

  /** Resolves the current tier color, expanding "-1" sentinels into a live rainbow cycle. */
  private resolveTierColor(): number {
    const base = this.currentTierBaseColor();
    if (base !== -1) {
      return base;
    }
    const hue = (this.animTime * 240) % 360;
    return hslToFill(hue, 95, 60);
  }

  private draw(): void {
    /** Combine spawn-overshoot, mid-life pulse, punch overshoot, and expire shrink into one scale. */
    let scale = 1;
    let rotation = 0;
    let alpha = 1;

    if (this.spawnTime > 0) {
      const t = 1 - this.spawnTime / SPAWN_DURATION_SEC;
      scale =
        t < 0.5
          ? 1 + (SPAWN_OVERSHOOT - 1) * (t * 2)
          : SPAWN_OVERSHOOT - (t - 0.5) * 2 * (SPAWN_OVERSHOOT - 1);
      rotation = (1 - t) * 0.18 * (this.currentTier % 2 === 0 ? 1 : -1);
      alpha = Math.min(1, t * 3);
    } else if (this.punchTime > 0) {
      const t = 1 - this.punchTime / PUNCH_DURATION_SEC;
      scale =
        t < 0.5
          ? 1 + (PUNCH_OVERSHOOT - 1) * (t * 2)
          : PUNCH_OVERSHOOT - (t - 0.5) * 2 * (PUNCH_OVERSHOOT - 1);
    }

    if (this.expiring) {
      const t = 1 - this.expireTimeLeft / EXPIRE_DURATION_SEC;
      scale *= 1 - t;
      alpha *= 1 - t;
    }

    /** Tiny idle pulse so the badge feels "alive" between hits. */
    const pulse = 1 + 0.06 * Math.sin(this.animTime * 7.5);
    scale *= pulse;

    this.scale.set(scale);
    this.rotation = rotation;
    this.alpha = alpha;

    const color = this.resolveTierColor();

    this.bg.clear();
    this.bg
      .roundRect(0, 0, COMBO_BADGE_W, COMBO_BADGE_H, 14)
      .fill({ color: 0x0a0014, alpha: tunedUiAlpha(0.92) });
    this.bg
      .roundRect(0, 0, COMBO_BADGE_W, COMBO_BADGE_H, 14)
      .stroke({ width: tunedUiStroke(3), color, alpha: 0.95 });
    this.bg
      .roundRect(4, 4, COMBO_BADGE_W - 8, COMBO_BADGE_H - 8, 11)
      .stroke({ width: 1.4, color, alpha: 0.32 });

    const glowAlpha = 0.42 + 0.32 * Math.sin(this.animTime * 6);
    this.glow.clear();
    this.glow
      .roundRect(-8, -8, COMBO_BADGE_W + 16, COMBO_BADGE_H + 16, 20)
      .stroke({ width: 6, color, alpha: glowAlpha * tunedBloom(0.4) });
    this.glow
      .roundRect(-4, -4, COMBO_BADGE_W + 8, COMBO_BADGE_H + 8, 17)
      .stroke({ width: 4, color, alpha: glowAlpha * tunedBloom(0.55) });

    this.wordText.position.set(COMBO_BADGE_W * 0.5, COMBO_BADGE_H * 0.39);
    this.wordText.style.fill = color;
    this.comboText.position.set(COMBO_BADGE_W * 0.5, COMBO_BADGE_H * 0.76);
    this.comboText.style.fill = color;

    this.particleLayer.clear();
    for (const p of this.particles) {
      const u = p.age / p.life;
      const pAlpha = (1 - u) * 0.95;
      const radius = (5 + Math.sin(p.age * 18) * 1.2) * (1 - u * 0.35);
      const pColor = p.hue >= 0 ? hslToFill(p.hue, 92, 56) : color;
      if (p.isStar) {
        this.drawStar(p.x, p.y, radius * 1.2, pColor, pAlpha, p.age * 8);
      } else {
        this.particleLayer.circle(p.x, p.y, radius).fill({ color: pColor, alpha: pAlpha });
        this.particleLayer
          .circle(p.x - radius * 0.35, p.y - radius * 0.25, radius * 0.3)
          .fill({ color: 0xffffff, alpha: pAlpha * 0.55 });
      }
    }
  }

  private drawStar(x: number, y: number, r: number, color: number, alpha: number, rot: number): void {
    const spikes = 4;
    const inner = r * 0.42;
    for (let i = 0; i < spikes; i += 1) {
      const t1 = rot + (i * Math.PI * 2) / spikes;
      const t2 = rot + ((i + 0.5) * Math.PI * 2) / spikes;
      const x1 = x + Math.cos(t1) * r;
      const y1 = y + Math.sin(t1) * r;
      const x2 = x + Math.cos(t2) * inner;
      const y2 = y + Math.sin(t2) * inner;
      this.particleLayer
        .moveTo(x, y)
        .lineTo(x1, y1)
        .lineTo(x2, y2)
        .lineTo(x, y)
        .fill({ color, alpha });
    }
    this.particleLayer.circle(x, y, r * 0.22).fill({ color: 0xffffff, alpha: alpha * 0.7 });
  }

  override destroy(options?: DestroyOptions): void {
    this.particles = [];
    super.destroy(options);
  }
}

function hslToFill(h: number, s: number, l: number): number {
  let hue = h % 360;
  if (hue < 0) {
    hue += 360;
  }
  s = Math.max(0, Math.min(100, s)) / 100;
  l = Math.max(0, Math.min(100, l)) / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  let rp = 0;
  let gp = 0;
  let bp = 0;

  if (hue < 60) {
    rp = c;
    gp = x;
  } else if (hue < 120) {
    rp = x;
    gp = c;
  } else if (hue < 180) {
    gp = c;
    bp = x;
  } else if (hue < 240) {
    gp = x;
    bp = c;
  } else if (hue < 300) {
    rp = x;
    bp = c;
  } else {
    rp = c;
    bp = x;
  }

  const r = Math.round((rp + m) * 255);
  const g = Math.round((gp + m) * 255);
  const b = Math.round((bp + m) * 255);
  return (r << 16) | (g << 8) | b;
}
