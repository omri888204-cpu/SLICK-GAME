import { Container, Graphics } from 'pixi.js';
import { tunedBloom } from '../../config/game.config';

export type MenuPortalAmbienceBounds = {
  cx: number;
  cy: number;
  w: number;
  h: number;
};

type AmbientParticle = {
  angle: number;
  radius: number;
  orbitSpeed: number;
  drift: number;
  size: number;
  alpha: number;
  phase: number;
};

const PARTICLE_COUNT = 12;
const BREATHE_PERIOD_SEC = 4.6;
const SWIRL_PERIOD_OUTER_SEC = 32;
const SWIRL_PERIOD_MID_SEC = -26;
const SWIRL_PERIOD_INNER_SEC = 38;
const EDGE_WOBBLE_SEGMENTS = 40;

/** Keep all glow inside the painted inner portal disc (fraction of layout rx/ry). */
const INNER_PORTAL_FRAC = 0.44;
const INNER_CORE_FRAC = 0.34;
const INNER_RING_OUTER_FRAC = 0.4;
const INNER_RING_MID_FRAC = 0.3;
const PARTICLE_RADIUS_MAX = 0.38;
const PARTICLE_RADIUS_RESET = 0.34;

const COLORS = {
  core: 0xb06cff,
  ring: 0xd8a8ff,
  particle: 0xf2e6ff,
  edge: 0x9f6bff,
} as const;

/**
 * Procedural portal ambience — additive particles, soft rings, breathe pulse.
 * Sits over the painted portal without duplicating menu art.
 */
export class MenuPortalAmbience extends Container {
  private readonly coreGlow = new Graphics();
  private readonly depthRing = new Graphics();
  private readonly swirlMid = new Graphics();
  private readonly swirlOuter = new Graphics();
  private readonly edgeShimmer = new Graphics();
  private readonly particleGfx = new Graphics();

  private bounds: MenuPortalAmbienceBounds | null = null;
  private particles: AmbientParticle[] = [];
  private elapsedSec = 0;

  constructor() {
    super();
    this.eventMode = 'none';
    for (const layer of [
      this.coreGlow,
      this.depthRing,
      this.swirlOuter,
      this.swirlMid,
      this.edgeShimmer,
      this.particleGfx,
    ]) {
      layer.eventMode = 'none';
      layer.blendMode = 'add';
      this.addChild(layer);
    }
    this.seedParticles();
  }

  layout(bounds: MenuPortalAmbienceBounds): void {
    this.bounds = bounds;
    this.position.set(bounds.cx, bounds.cy);
    this.seedParticles();
    this.redrawStatic(0);
  }

  tick(dtSec: number): void {
    if (!this.bounds) {
      return;
    }
    this.elapsedSec += dtSec;
    this.redrawDynamic(this.elapsedSec);
    this.updateParticles(dtSec, this.elapsedSec);
  }

  private seedParticles(): void {
    this.particles = [];
    for (let i = 0; i < PARTICLE_COUNT; i += 1) {
      this.particles.push({
        angle: (i / PARTICLE_COUNT) * Math.PI * 2 + Math.random() * 0.6,
        radius: 0.14 + Math.random() * 0.22,
        orbitSpeed: 0.08 + Math.random() * 0.14,
        drift: 0.015 + Math.random() * 0.02,
        size: 0.6 + Math.random() * 1.1,
        alpha: 0.18 + Math.random() * 0.32,
        phase: Math.random() * Math.PI * 2,
      });
    }
  }

  private redrawStatic(timeSec: number): void {
    if (!this.bounds) {
      return;
    }
    const rx = this.bounds.w * 0.5;
    const ry = this.bounds.h * 0.48;
    this.drawSwirlArc(
      this.swirlOuter,
      rx * INNER_RING_OUTER_FRAC,
      ry * INNER_RING_OUTER_FRAC,
      0.42,
      0.14,
      timeSec * 0.15,
    );
    this.drawSwirlArc(
      this.swirlMid,
      rx * INNER_RING_MID_FRAC,
      ry * INNER_RING_MID_FRAC,
      0.32,
      0.11,
      -timeSec * 0.12 + 1.2,
    );
  }

  private redrawDynamic(timeSec: number): void {
    if (!this.bounds) {
      return;
    }
    const rx = this.bounds.w * 0.5;
    const ry = this.bounds.h * 0.48;
    const breathe = breatheEnvelope(timeSec);

    this.drawCoreGlow(rx, ry, breathe);
    this.drawDepthRing(rx, ry, breathe, timeSec);
    this.drawEdgeShimmer(rx, ry, timeSec, breathe);

    this.swirlOuter.rotation = (timeSec * Math.PI * 2) / SWIRL_PERIOD_OUTER_SEC;
    this.swirlMid.rotation = (timeSec * Math.PI * 2) / SWIRL_PERIOD_MID_SEC;
    this.depthRing.rotation = (timeSec * Math.PI * 2) / SWIRL_PERIOD_INNER_SEC;
  }

  private drawCoreGlow(rx: number, ry: number, breathe: number): void {
    const scale = 0.88 + breathe * 0.1;
    const alpha = tunedBloom(0.08 + breathe * 0.1);
    const coreRx = rx * INNER_CORE_FRAC * scale;
    const coreRy = ry * INNER_CORE_FRAC * scale;
    this.coreGlow.clear();
    this.coreGlow.ellipse(0, 0, coreRx, coreRy).fill({ color: COLORS.core, alpha });
    this.coreGlow
      .ellipse(0, 0, coreRx * 0.55, coreRy * 0.55)
      .fill({ color: 0xf0e0ff, alpha: alpha * 0.5 });
  }

  private drawDepthRing(
    rx: number,
    ry: number,
    breathe: number,
    timeSec: number,
  ): void {
    const inner = 0.52 + breathe * 0.05;
    const outer = 0.88 - breathe * 0.04;
    this.depthRing.clear();
    this.strokeEllipseRing(
      this.depthRing,
      rx * INNER_PORTAL_FRAC * inner,
      ry * INNER_PORTAL_FRAC * inner,
      0.85,
      COLORS.ring,
      0.14 + breathe * 0.08,
    );
    this.strokeEllipseRing(
      this.depthRing,
      rx * INNER_PORTAL_FRAC * outer,
      ry * INNER_PORTAL_FRAC * outer,
      0.65,
      COLORS.ring,
      0.08 + breathe * 0.05,
    );
    this.depthRing.alpha = 0.85 + 0.15 * Math.sin(timeSec * 0.9);
  }

  private drawEdgeShimmer(rx: number, ry: number, timeSec: number, breathe: number): void {
    this.edgeShimmer.clear();
    const points: number[] = [];
    for (let i = 0; i <= EDGE_WOBBLE_SEGMENTS; i += 1) {
      const t = (i / EDGE_WOBBLE_SEGMENTS) * Math.PI * 2;
      const wobble =
        1 +
        0.012 * Math.sin(t * 4 + timeSec * 0.65) +
        0.008 * Math.sin(t * 7 - timeSec * 0.45);
      points.push(
        Math.cos(t) * rx * INNER_PORTAL_FRAC * wobble,
        Math.sin(t) * ry * INNER_PORTAL_FRAC * wobble,
      );
    }
    this.edgeShimmer.poly(points).stroke({
      width: tunedBloom(0.9),
      color: COLORS.edge,
      alpha: tunedBloom(0.1 + breathe * 0.06),
    });
  }

  private drawSwirlArc(
    target: Graphics,
    rx: number,
    ry: number,
    arcSpan: number,
    strokeWidth: number,
    phase: number,
  ): void {
    target.clear();
    const start = phase;
    const end = phase + Math.PI * arcSpan;
    target.arc(0, 0, (rx + ry) * 0.5, start, end).stroke({
      width: tunedBloom(strokeWidth),
      color: COLORS.ring,
      alpha: tunedBloom(0.14),
      cap: 'round',
    });
    target
      .arc(0, 0, (rx + ry) * 0.38, start + 0.4, end - 0.25)
      .stroke({
        width: tunedBloom(strokeWidth * 0.65),
        color: 0xf5ecff,
        alpha: tunedBloom(0.08),
        cap: 'round',
      });
  }

  private strokeEllipseRing(
    target: Graphics,
    rx: number,
    ry: number,
    width: number,
    color: number,
    alpha: number,
  ): void {
    target.ellipse(0, 0, rx, ry).stroke({
      width: tunedBloom(width),
      color,
      alpha: tunedBloom(alpha),
    });
  }

  private updateParticles(dtSec: number, timeSec: number): void {
    if (!this.bounds) {
      return;
    }
    const rx = this.bounds.w * 0.5;
    const ry = this.bounds.h * 0.48;
    const breathe = breatheEnvelope(timeSec);

    this.particleGfx.clear();
    for (const particle of this.particles) {
      particle.angle += particle.orbitSpeed * dtSec;
      particle.radius = Math.min(
        PARTICLE_RADIUS_MAX,
        particle.radius + particle.drift * dtSec,
      );
      if (particle.radius > PARTICLE_RADIUS_RESET) {
        particle.radius = 0.1 + Math.random() * 0.1;
        particle.angle += Math.random() * 0.5;
      }

      const twinkle = 0.55 + 0.45 * Math.sin(timeSec * 1.6 + particle.phase);
      const x = Math.cos(particle.angle) * rx * particle.radius;
      const y = Math.sin(particle.angle) * ry * particle.radius;
      const alpha = tunedBloom(particle.alpha * twinkle * (0.65 + breathe * 0.35));
      this.particleGfx.circle(x, y, particle.size).fill({ color: COLORS.particle, alpha });
    }
  }
}

function breatheEnvelope(timeSec: number): number {
  const wave = 0.5 - 0.5 * Math.cos((timeSec * Math.PI * 2) / BREATHE_PERIOD_SEC);
  return wave * wave;
}
