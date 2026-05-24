import { Container, Graphics } from 'pixi.js';
import type { LayerBackgroundLayout } from './candyStaticBackground';

import { VISUAL_TUNING } from '../../../config/game.config';

const STAR_COUNT = 28;
const PARTICLE_COUNT = 22;
const FOG_LAYER_COUNT = 3;
const GLOW_SPOT_COUNT = 7;
const CLOUD_COUNT = 4;

type Star = {
  g: Graphics;
  xRatio: number;
  yRatio: number;
  phase: number;
  speed: number;
  baseAlpha: number;
  baseScale: number;
};

type Particle = {
  g: Graphics;
  x: number;
  y: number;
  vy: number;
  alpha: number;
  alphaSpeed: number;
  alphaPhase: number;
  color: number;
  radius: number;
};

type FogLayer = {
  g: Graphics;
  yRatio: number;
  heightRatio: number;
  phase: number;
  speed: number;
  alpha: number;
};

type GlowSpot = {
  g: Graphics;
  xRatio: number;
  yRatio: number;
  radius: number;
  phase: number;
  speed: number;
  baseAlpha: number;
};

type Cloud = {
  g: Graphics;
  xRatio: number;
  yRatio: number;
  widthRatio: number;
  heightRatio: number;
  vx: number;
  phase: number;
};

/** Lightweight viewport-locked candy atmosphere FX (no background movement). */
export class CandyAtmosphereFx {
  readonly root = new Container();

  private readonly stars: Star[] = [];
  private readonly particles: Particle[] = [];
  private readonly fogLayers: FogLayer[] = [];
  private readonly glowSpots: GlowSpot[] = [];
  private readonly clouds: Cloud[] = [];

  private layoutW = 1;
  private layoutH = 1;
  private timeSec = 0;

  constructor() {
    this.root.eventMode = 'none';
    this.buildStars();
    this.buildParticles();
    this.buildFog();
    this.buildGlowSpots();
    this.buildClouds();
  }

  resize(layout: LayerBackgroundLayout): void {
    this.layoutW = layout.viewportW;
    this.layoutH = layout.fillH;
    this.layoutFog();
    this.layoutClouds();
    this.resetParticles(layout);
  }

  update(dt: number): void {
    this.timeSec += dt;
    this.updateStars();
    this.updateParticles(dt);
    this.updateFog();
    this.updateGlowSpots();
    this.updateClouds(dt);
  }

  destroy(): void {
    for (const star of this.stars) {
      star.g.destroy();
    }
    this.stars.length = 0;
    for (const particle of this.particles) {
      particle.g.destroy();
    }
    this.particles.length = 0;
    for (const fog of this.fogLayers) {
      fog.g.destroy();
    }
    this.fogLayers.length = 0;
    for (const glow of this.glowSpots) {
      glow.g.destroy();
    }
    this.glowSpots.length = 0;
    for (const cloud of this.clouds) {
      cloud.g.destroy();
    }
    this.clouds.length = 0;
    this.root.destroy({ children: true });
  }

  private buildStars(): void {
    for (let i = 0; i < STAR_COUNT; i += 1) {
      const g = new Graphics();
      g.eventMode = 'none';
      this.root.addChild(g);
      this.stars.push({
        g,
        xRatio: Math.random() * 0.92 + 0.04,
        yRatio: Math.random() * 0.55 + 0.02,
        phase: Math.random() * Math.PI * 2,
        speed: 0.6 + Math.random() * 1.4,
        baseAlpha: 0.25 + Math.random() * 0.55,
        baseScale: 0.6 + Math.random() * 0.9,
      });
    }
  }

  private buildParticles(): void {
    const colors = [0xffb8e8, 0xe8a8ff, 0xffd4f5, 0xc8a0ff];
    for (let i = 0; i < PARTICLE_COUNT; i += 1) {
      const g = new Graphics();
      g.eventMode = 'none';
      this.root.addChild(g);
      this.particles.push({
        g,
        x: 0,
        y: 0,
        vy: -(8 + Math.random() * 18),
        alpha: VISUAL_TUNING.bloomBlurScale * (0.2 + Math.random() * 0.35),
        alphaSpeed: 0.5 + Math.random() * 0.8,
        alphaPhase: Math.random() * Math.PI * 2,
        color: colors[i % colors.length] ?? 0xffb8e8,
        radius: 1.2 + Math.random() * 2.2,
      });
    }
  }

  private buildFog(): void {
    for (let i = 0; i < FOG_LAYER_COUNT; i += 1) {
      const g = new Graphics();
      g.eventMode = 'none';
      this.root.addChild(g);
      this.fogLayers.push({
        g,
        yRatio: 0.15 + i * 0.22,
        heightRatio: 0.18 + i * 0.04,
        phase: Math.random() * Math.PI * 2,
        speed: 0.08 + i * 0.04,
        alpha: VISUAL_TUNING.bloomBlurScale * (0.018 + i * 0.008),
      });
    }
  }

  private buildGlowSpots(): void {
    const spots: Array<[number, number, number]> = [
      [0.14, 0.2, 22],
      [0.22, 0.34, 18],
      [0.1, 0.42, 16],
      [0.86, 0.22, 22],
      [0.78, 0.36, 18],
      [0.9, 0.44, 16],
      [0.5, 0.14, 26],
    ];
    for (let i = 0; i < GLOW_SPOT_COUNT; i += 1) {
      const [xRatio, yRatio, radius] = spots[i] ?? [0.5, 0.2, 20];
      const g = new Graphics();
      g.eventMode = 'none';
      g.blendMode = 'add';
      this.root.addChild(g);
      this.glowSpots.push({
        g,
        xRatio,
        yRatio,
        radius,
        phase: Math.random() * Math.PI * 2,
        speed: 0.25 + Math.random() * 0.35,
        baseAlpha: VISUAL_TUNING.bloomBlurScale * (0.06 + Math.random() * 0.05),
      });
    }
  }

  private buildClouds(): void {
    for (let i = 0; i < CLOUD_COUNT; i += 1) {
      const g = new Graphics();
      g.eventMode = 'none';
      this.root.addChild(g);
      this.clouds.push({
        g,
        xRatio: Math.random(),
        yRatio: 0.06 + Math.random() * 0.28,
        widthRatio: 0.35 + Math.random() * 0.25,
        heightRatio: 0.05 + Math.random() * 0.04,
        vx: 3 + Math.random() * 6,
        phase: Math.random() * Math.PI * 2,
      });
    }
  }

  private layoutFog(): void {
    for (const fog of this.fogLayers) {
      const g = fog.g;
      g.clear();
      const w = this.layoutW * 1.15;
      const h = this.layoutH * fog.heightRatio;
      const y = this.layoutH * fog.yRatio;
      g.ellipse(this.layoutW * 0.5, y + h * 0.5, w * 0.5, h * 0.5);
      g.fill({ color: 0xffc8f0, alpha: fog.alpha });
    }
  }

  private layoutClouds(): void {
    for (const cloud of this.clouds) {
      const g = cloud.g;
      g.clear();
      const cx = this.layoutW * cloud.xRatio;
      const cy = this.layoutH * cloud.yRatio;
      const rw = this.layoutW * cloud.widthRatio * 0.5;
      const rh = this.layoutH * cloud.heightRatio * 0.5;
      g.ellipse(cx, cy, rw, rh);
      g.fill({ color: 0xffffff, alpha: VISUAL_TUNING.bloomBlurScale * 0.07 });
      g.ellipse(cx - rw * 0.35, cy + rh * 0.15, rw * 0.55, rh * 0.7);
      g.fill({ color: 0xffffff, alpha: VISUAL_TUNING.bloomBlurScale * 0.05 });
      g.ellipse(cx + rw * 0.3, cy + rh * 0.1, rw * 0.5, rh * 0.65);
      g.fill({ color: 0xffffff, alpha: VISUAL_TUNING.bloomBlurScale * 0.05 });
    }
  }

  private resetParticles(layout: LayerBackgroundLayout): void {
    for (const particle of this.particles) {
      particle.x = Math.random() * layout.viewportW;
      particle.y = Math.random() * layout.fillH;
    }
  }

  private updateStars(): void {
    for (const star of this.stars) {
      const pulse = 0.45 + 0.55 * Math.sin(this.timeSec * star.speed + star.phase);
      const scalePulse = star.baseScale * (0.85 + 0.15 * Math.sin(this.timeSec * star.speed * 0.7 + star.phase));
      const alpha = star.baseAlpha * pulse;
      const radius = 1.1 * scalePulse;
      star.g.clear();
      star.g.circle(this.layoutW * star.xRatio, this.layoutH * star.yRatio, radius);
      star.g.fill({ color: 0xffffff, alpha });
    }
  }

  private updateParticles(dt: number): void {
    for (const particle of this.particles) {
      particle.y += particle.vy * dt;
      if (particle.y < -8) {
        particle.y = this.layoutH + 8;
        particle.x = Math.random() * this.layoutW;
      }
      const alphaMul =
        0.55 + 0.45 * Math.sin(this.timeSec * particle.alphaSpeed + particle.alphaPhase);
      const alpha = particle.alpha * alphaMul;
      particle.g.clear();
      particle.g.circle(particle.x, particle.y, particle.radius);
      particle.g.fill({ color: particle.color, alpha });
    }
  }

  private updateFog(): void {
    for (const fog of this.fogLayers) {
      const drift = Math.sin(this.timeSec * fog.speed + fog.phase) * this.layoutW * 0.04;
      fog.g.position.x = drift;
    }
  }

  private updateGlowSpots(): void {
    for (const glow of this.glowSpots) {
      const pulse = 0.65 + 0.35 * Math.sin(this.timeSec * glow.speed + glow.phase);
      const alpha = glow.baseAlpha * pulse;
      const r = glow.radius * (0.92 + 0.08 * pulse);
      glow.g.clear();
      glow.g.circle(this.layoutW * glow.xRatio, this.layoutH * glow.yRatio, r);
      glow.g.fill({ color: 0xffe8a8, alpha });
    }
  }

  private updateClouds(dt: number): void {
    for (const cloud of this.clouds) {
      cloud.xRatio += (cloud.vx * dt) / Math.max(1, this.layoutW);
      if (cloud.xRatio > 1.25) {
        cloud.xRatio = -0.25;
      }
      const bob = Math.sin(this.timeSec * 0.15 + cloud.phase) * this.layoutH * 0.008;
      const g = cloud.g;
      g.clear();
      const cx = this.layoutW * cloud.xRatio;
      const cy = this.layoutH * cloud.yRatio + bob;
      const rw = this.layoutW * cloud.widthRatio * 0.5;
      const rh = this.layoutH * cloud.heightRatio * 0.5;
      g.ellipse(cx, cy, rw, rh);
      g.fill({ color: 0xffffff, alpha: VISUAL_TUNING.bloomBlurScale * 0.07 });
      g.ellipse(cx - rw * 0.35, cy + rh * 0.15, rw * 0.55, rh * 0.7);
      g.fill({ color: 0xffffff, alpha: VISUAL_TUNING.bloomBlurScale * 0.05 });
      g.ellipse(cx + rw * 0.3, cy + rh * 0.1, rw * 0.5, rh * 0.65);
      g.fill({ color: 0xffffff, alpha: VISUAL_TUNING.bloomBlurScale * 0.05 });
    }
  }
}
