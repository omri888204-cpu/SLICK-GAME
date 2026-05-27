import { Container, Graphics } from 'pixi.js';
import { tunedBloom } from '../../config/game.config';

type WarpParticle = {
  angle: number;
  radius: number;
  speed: number;
  size: number;
  hue: number;
  phase: number;
};

const PARTICLE_COUNT = 48;
const RING_COUNT = 6;

function smoothstep(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

/** Full-screen cosmic warp — tunnel, neon streaks, distortion (no new portal art). */
export class PortalWarpOverlay extends Container {
  private readonly tunnel = new Graphics();
  private readonly rings = new Graphics();
  private readonly streaks = new Graphics();
  private readonly flash = new Graphics();

  private particles: WarpParticle[] = [];
  private viewportW = 360;
  private viewportH = 640;
  private elapsedSec = 0;
  private intensity = 0;

  constructor() {
    super();
    this.eventMode = 'none';
    for (const layer of [this.tunnel, this.rings, this.streaks, this.flash]) {
      layer.eventMode = 'none';
      layer.blendMode = 'add';
      this.addChild(layer);
    }
    this.flash.blendMode = 'normal';
    this.seedParticles();
  }

  resize(viewportW: number, viewportH: number): void {
    this.viewportW = viewportW;
    this.viewportH = viewportH;
    this.seedParticles();
  }

  setIntensity(intensity: number): void {
    this.intensity = Math.max(0, Math.min(1, intensity));
    this.alpha = this.intensity;
    this.visible = this.intensity > 0.004;
  }

  tick(dtSec: number): void {
    if (this.intensity <= 0.004) {
      return;
    }
    this.elapsedSec += dtSec;
    this.redraw();
  }

  private seedParticles(): void {
    this.particles = [];
    for (let i = 0; i < PARTICLE_COUNT; i += 1) {
      this.particles.push({
        angle: Math.random() * Math.PI * 2,
        radius: 0.15 + Math.random() * 0.85,
        speed: 0.35 + Math.random() * 1.1,
        size: 1.2 + Math.random() * 3.2,
        hue: Math.random(),
        phase: Math.random() * Math.PI * 2,
      });
    }
  }

  private redraw(): void {
    const w = this.viewportW;
    const h = this.viewportH;
    const cx = w * 0.5;
    const cy = h * 0.5;
    const t = this.elapsedSec;
    const pull = smoothstep(this.intensity);
    const spin = t * (1.6 + pull * 2.4);
    const tunnelDepth = 0.22 + pull * 0.55;

    this.tunnel.clear();
    for (let i = 0; i < 14; i += 1) {
      const p = i / 13;
      const ringT = (p + t * 0.12) % 1;
      const radius = (1 - ringT) * Math.min(w, h) * (0.52 + tunnelDepth * 0.35);
      const alpha = tunedBloom((1 - ringT) * 0.09 * pull);
      const color = lerpColor(0x6b2cff, 0x9ff7ff, p);
      this.tunnel.circle(cx, cy, radius).stroke({ width: 2 + pull * 3, color, alpha });
    }

    this.rings.clear();
    for (let i = 0; i < RING_COUNT; i += 1) {
      const phase = spin + i * 0.9;
      const rx = w * (0.12 + i * 0.04) * (0.85 + pull * 0.25);
      const ry = h * (0.08 + i * 0.03) * (0.85 + pull * 0.25);
      const points: number[] = [];
      for (let s = 0; s <= 32; s += 1) {
        const a = (s / 32) * Math.PI * 2;
        const wobble = 1 + 0.06 * Math.sin(a * 5 + phase);
        points.push(Math.cos(a) * rx * wobble, Math.sin(a) * ry * wobble);
      }
      this.rings.poly(points).stroke({
        width: tunedBloom(1.2 + pull * 1.4),
        color: i % 2 === 0 ? 0xc8a0ff : 0x66f0ff,
        alpha: tunedBloom(0.06 + pull * 0.12),
      });
    }

    this.streaks.clear();
    for (const particle of this.particles) {
      particle.radius -= particle.speed * 0.018 * (0.4 + pull);
      if (particle.radius < 0.04) {
        particle.radius = 0.95 + Math.random() * 0.2;
        particle.angle += Math.random() * 0.4;
      }
      const tw = 0.45 + 0.55 * Math.sin(t * 3.2 + particle.phase);
      const px = cx + Math.cos(particle.angle + spin * 0.35) * w * particle.radius * 0.48;
      const py = cy + Math.sin(particle.angle + spin * 0.35) * h * particle.radius * 0.42;
      const color = particle.hue > 0.5 ? 0xff8cf8 : 0x7af0ff;
      this.streaks.circle(px, py, particle.size * tw).fill({
        color,
        alpha: tunedBloom(0.12 + pull * 0.35),
      });
      this.streaks
        .moveTo(px, py)
        .lineTo(
          cx + (px - cx) * 0.35,
          cy + (py - cy) * 0.35,
        )
        .stroke({
          width: tunedBloom(0.8 + pull),
          color,
          alpha: tunedBloom(0.08 + pull * 0.2),
          cap: 'round',
        });
    }

    this.flash.clear();
    const bloom = pull * (0.35 + 0.25 * Math.sin(t * 9));
    this.flash.circle(cx, cy, Math.min(w, h) * (0.18 + pull * 0.28)).fill({
      color: 0xf8f0ff,
      alpha: tunedBloom(bloom),
    });
  }
}

function lerpColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bch = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bch;
}
