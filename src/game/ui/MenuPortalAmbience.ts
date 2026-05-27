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
  inwardSpeed: number;
  size: number;
  alpha: number;
  phase: number;
};

const PARTICLE_COUNT = 26;
const BREATHE_PERIOD_SEC = 4.6;
const SWIRL_PERIOD_OUTER_SEC = 11;
const SWIRL_PERIOD_MID_SEC = -8.5;
const SWIRL_PERIOD_INNER_SEC = 13;
const VORTEX_SPIRAL_ARMS = 5;
const EDGE_WOBBLE_SEGMENTS = 48;

const INNER_PORTAL_FRAC = 0.44;
const INNER_CORE_FRAC = 0.34;
const INNER_RING_OUTER_FRAC = 0.4;
const INNER_RING_MID_FRAC = 0.3;
const INNER_RING_INNER_FRAC = 0.22;
const PARTICLE_RADIUS_MAX = 0.42;
const PARTICLE_RADIUS_MIN = 0.06;

const COLORS = {
  core: 0xb06cff,
  ring: 0xd8a8ff,
  particle: 0xf2e6ff,
  edge: 0x9f6bff,
  vortex: 0xe8d4ff,
} as const;

/**
 * Procedural portal ambience — inward vortex, spirals, particles (over painted portal art).
 */
export class MenuPortalAmbience extends Container {
  private readonly coreGlow = new Graphics();
  private readonly vortexSpiral = new Graphics();
  private readonly depthRing = new Graphics();
  private readonly swirlMid = new Graphics();
  private readonly swirlOuter = new Graphics();
  private readonly swirlInner = new Graphics();
  private readonly edgeShimmer = new Graphics();
  private readonly particleGfx = new Graphics();

  private bounds: MenuPortalAmbienceBounds | null = null;
  private particles: AmbientParticle[] = [];
  private elapsedSec = 0;
  private transitionBoost = 0;

  constructor() {
    super();
    this.eventMode = 'none';
    for (const layer of [
      this.coreGlow,
      this.vortexSpiral,
      this.depthRing,
      this.swirlOuter,
      this.swirlMid,
      this.swirlInner,
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
  }

  setTransitionBoost(boost: number): void {
    this.transitionBoost = Math.max(0, Math.min(1, boost));
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
        angle: (i / PARTICLE_COUNT) * Math.PI * 2 + Math.random() * 0.8,
        radius: 0.12 + Math.random() * 0.28,
        orbitSpeed: 0.22 + Math.random() * 0.28,
        inwardSpeed: 0.045 + Math.random() * 0.055,
        size: 0.5 + Math.random() * 1.4,
        alpha: 0.2 + Math.random() * 0.35,
        phase: Math.random() * Math.PI * 2,
      });
    }
  }

  private redrawDynamic(timeSec: number): void {
    if (!this.bounds) {
      return;
    }
    const rx = this.bounds.w * 0.5;
    const ry = this.bounds.h * 0.48;
    const breathe = breatheEnvelope(timeSec);
    const boost = this.transitionBoost;
    const pulse = breathe * (1 + boost * 1.35);
    const motion = 1 + boost * 1.8;

    this.drawCoreGlow(rx, ry, pulse, boost, timeSec, motion);
    this.drawVortexSpirals(rx, ry, timeSec, pulse, motion);
    this.drawDepthRing(rx, ry, pulse, timeSec, boost, motion);
    this.drawEdgeShimmer(rx, ry, timeSec, pulse, boost, motion);

    const spinMul = motion;
    const outerPhase = timeSec * 0.55 * motion;
    const midPhase = -timeSec * 0.72 * motion + 1.2;
    const innerPhase = timeSec * 0.95 * motion + 0.4;

    this.drawLayerSwirls(this.swirlOuter, [
      { rx: rx * INNER_RING_OUTER_FRAC, ry: ry * INNER_RING_OUTER_FRAC, arcSpan: 0.5, strokeWidth: 0.15, phase: outerPhase },
      {
        rx: rx * INNER_RING_OUTER_FRAC * 0.88,
        ry: ry * INNER_RING_OUTER_FRAC * 0.88,
        arcSpan: 0.38,
        strokeWidth: 0.1,
        phase: outerPhase + 1.4,
      },
    ]);
    this.drawLayerSwirls(this.swirlMid, [
      { rx: rx * INNER_RING_MID_FRAC, ry: ry * INNER_RING_MID_FRAC, arcSpan: 0.42, strokeWidth: 0.12, phase: midPhase },
      {
        rx: rx * INNER_RING_MID_FRAC * 0.82,
        ry: ry * INNER_RING_MID_FRAC * 0.82,
        arcSpan: 0.3,
        strokeWidth: 0.08,
        phase: midPhase - 0.9,
      },
    ]);
    this.drawLayerSwirls(this.swirlInner, [
      {
        rx: rx * INNER_RING_INNER_FRAC,
        ry: ry * INNER_RING_INNER_FRAC,
        arcSpan: 0.55,
        strokeWidth: 0.1,
        phase: innerPhase,
      },
      {
        rx: rx * INNER_RING_INNER_FRAC * 0.7,
        ry: ry * INNER_RING_INNER_FRAC * 0.7,
        arcSpan: 0.4,
        strokeWidth: 0.07,
        phase: innerPhase + 2.1,
      },
    ]);

    this.swirlOuter.rotation = ((timeSec * Math.PI * 2) / SWIRL_PERIOD_OUTER_SEC) * spinMul;
    this.swirlMid.rotation = ((timeSec * Math.PI * 2) / SWIRL_PERIOD_MID_SEC) * spinMul;
    this.swirlInner.rotation = ((timeSec * Math.PI * 2) / SWIRL_PERIOD_INNER_SEC) * spinMul;
    this.depthRing.rotation = ((timeSec * Math.PI * 2) / (SWIRL_PERIOD_INNER_SEC * 0.85)) * spinMul;
    this.vortexSpiral.rotation = timeSec * 0.35 * motion;
  }

  private drawCoreGlow(
    rx: number,
    ry: number,
    breathe: number,
    boost: number,
    timeSec: number,
    motion: number,
  ): void {
    const wobble = 1 + 0.08 * Math.sin(timeSec * 2.8 * motion);
    const scale = (0.86 + breathe * 0.12 + boost * 0.14) * wobble;
    const alpha = tunedBloom(0.1 + breathe * 0.12 + boost * 0.24);
    const coreRx = rx * INNER_CORE_FRAC * scale;
    const coreRy = ry * INNER_CORE_FRAC * scale;
    const ox = Math.cos(timeSec * 1.9 * motion) * rx * 0.03;
    const oy = Math.sin(timeSec * 2.3 * motion) * ry * 0.03;

    this.coreGlow.clear();
    this.coreGlow.ellipse(ox, oy, coreRx, coreRy).fill({ color: COLORS.core, alpha });
    this.coreGlow
      .ellipse(ox * 0.6, oy * 0.6, coreRx * 0.5, coreRy * 0.5)
      .fill({ color: 0xf0e0ff, alpha: alpha * 0.55 });
    this.coreGlow
      .ellipse(-ox * 0.4, -oy * 0.4, coreRx * 0.28, coreRy * 0.28)
      .fill({ color: 0xffffff, alpha: alpha * (0.35 + 0.2 * Math.sin(timeSec * 4.2 * motion)) });
  }

  /** Logarithmic spiral arms — inward flow inside the painted disc. */
  private drawVortexSpirals(
    rx: number,
    ry: number,
    timeSec: number,
    breathe: number,
    motion: number,
  ): void {
    this.vortexSpiral.clear();
    const turns = 1.35;
    const steps = 22;
    const baseAlpha = tunedBloom(0.06 + breathe * 0.08);

    for (let arm = 0; arm < VORTEX_SPIRAL_ARMS; arm += 1) {
      const armPhase = (arm / VORTEX_SPIRAL_ARMS) * Math.PI * 2 + timeSec * 1.15 * motion;
      const points: number[] = [];

      for (let i = 0; i <= steps; i += 1) {
        const t = i / steps;
        const radiusFrac = 0.92 - t * 0.86;
        const angle = armPhase + t * turns * Math.PI * 2;
        points.push(
          Math.cos(angle) * rx * INNER_PORTAL_FRAC * radiusFrac,
          Math.sin(angle) * ry * INNER_PORTAL_FRAC * radiusFrac,
        );
      }

      this.vortexSpiral.poly(points).stroke({
        width: tunedBloom(1.1),
        color: arm % 2 === 0 ? COLORS.vortex : COLORS.ring,
        alpha: baseAlpha * (0.7 + 0.3 * Math.sin(timeSec * 3 + arm)),
        cap: 'round',
        join: 'round',
      });
    }

    for (let ring = 0; ring < 4; ring += 1) {
      const ringT = (timeSec * 0.45 * motion + ring * 0.25) % 1;
      const ringR = 0.78 - ringT * 0.72;
      this.vortexSpiral
        .ellipse(0, 0, rx * INNER_PORTAL_FRAC * ringR, ry * INNER_PORTAL_FRAC * ringR * 0.92)
        .stroke({
          width: tunedBloom(0.5),
          color: 0xc49cff,
          alpha: tunedBloom(0.04 * (1 - ringT)),
        });
    }
  }

  private drawDepthRing(
    rx: number,
    ry: number,
    breathe: number,
    timeSec: number,
    boost: number,
    motion: number,
  ): void {
    const inner = 0.5 + breathe * 0.06 + boost * 0.08;
    const outer = 0.9 - breathe * 0.05 - boost * 0.1;
    const ripple = 0.04 * Math.sin(timeSec * 2.2 * motion);
    this.depthRing.clear();
    this.strokeEllipseRing(
      this.depthRing,
      rx * INNER_PORTAL_FRAC * (inner + ripple),
      ry * INNER_PORTAL_FRAC * (inner - ripple * 0.8),
      0.9,
      COLORS.ring,
      0.16 + breathe * 0.1 + boost * 0.14,
    );
    this.strokeEllipseRing(
      this.depthRing,
      rx * INNER_PORTAL_FRAC * outer,
      ry * INNER_PORTAL_FRAC * outer,
      0.7,
      COLORS.ring,
      0.1 + breathe * 0.06 + boost * 0.16,
    );
    this.depthRing.alpha = 0.82 + 0.18 * Math.sin(timeSec * (1.4 + boost * 2.4));
  }

  private drawEdgeShimmer(
    rx: number,
    ry: number,
    timeSec: number,
    breathe: number,
    boost: number,
    motion: number,
  ): void {
    this.edgeShimmer.clear();
    const points: number[] = [];
    for (let i = 0; i <= EDGE_WOBBLE_SEGMENTS; i += 1) {
      const t = (i / EDGE_WOBBLE_SEGMENTS) * Math.PI * 2;
      const wobble =
        1 +
        0.028 * Math.sin(t * 5 + timeSec * 1.35 * motion) +
        0.018 * Math.sin(t * 8 - timeSec * 1.05 * motion) +
        0.012 * Math.sin(t * 11 + timeSec * 0.75 * motion);
      points.push(
        Math.cos(t) * rx * INNER_PORTAL_FRAC * wobble,
        Math.sin(t) * ry * INNER_PORTAL_FRAC * wobble,
      );
    }
    this.edgeShimmer.poly(points).stroke({
      width: tunedBloom(1.05),
      color: COLORS.edge,
      alpha: tunedBloom(0.12 + breathe * 0.08 + boost * 0.18),
    });
  }

  private drawLayerSwirls(
    target: Graphics,
    arcs: readonly {
      rx: number;
      ry: number;
      arcSpan: number;
      strokeWidth: number;
      phase: number;
    }[],
  ): void {
    target.clear();
    for (const arc of arcs) {
      this.appendSwirlArc(target, arc.rx, arc.ry, arc.arcSpan, arc.strokeWidth, arc.phase);
    }
  }

  private appendSwirlArc(
    target: Graphics,
    rx: number,
    ry: number,
    arcSpan: number,
    strokeWidth: number,
    phase: number,
  ): void {
    const radius = (rx + ry) * 0.5;
    const start = phase;
    const end = phase + Math.PI * arcSpan;
    target.arc(0, 0, radius, start, end).stroke({
      width: tunedBloom(strokeWidth),
      color: COLORS.ring,
      alpha: tunedBloom(0.16),
      cap: 'round',
    });
    target
      .arc(0, 0, radius * 0.72, start + 0.35, end - 0.2)
      .stroke({
        width: tunedBloom(strokeWidth * 0.7),
        color: 0xf5ecff,
        alpha: tunedBloom(0.1),
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
    const boost = this.transitionBoost;
    const motion = 1 + boost * 2.2;

    this.particleGfx.clear();
    for (const particle of this.particles) {
      particle.angle += particle.orbitSpeed * dtSec * motion;
      particle.radius -= particle.inwardSpeed * dtSec * motion;

      if (particle.radius < PARTICLE_RADIUS_MIN) {
        particle.radius = PARTICLE_RADIUS_MAX * (0.75 + Math.random() * 0.25);
        particle.angle += Math.random() * Math.PI * 2;
      }

      const twinkle = 0.5 + 0.5 * Math.sin(timeSec * 2.4 * motion + particle.phase);
      const spiralPull = 1 - particle.radius / PARTICLE_RADIUS_MAX;
      const x = Math.cos(particle.angle) * rx * particle.radius;
      const y = Math.sin(particle.angle) * ry * particle.radius;
      const alpha = tunedBloom(
        particle.alpha * twinkle * (0.6 + breathe * 0.4 + boost * 0.5) * (0.65 + spiralPull * 0.55),
      );

      this.particleGfx.circle(x, y, particle.size * (0.75 + spiralPull * 0.5)).fill({
        color: COLORS.particle,
        alpha,
      });

      const trailLen = 4 + spiralPull * 10;
      this.particleGfx
        .moveTo(x, y)
        .lineTo(
          x - Math.cos(particle.angle) * trailLen,
          y - Math.sin(particle.angle) * trailLen,
        )
        .stroke({
          width: tunedBloom(0.6 + spiralPull),
          color: 0x9f7cff,
          alpha: alpha * 0.45,
          cap: 'round',
        });
    }
  }
}

function breatheEnvelope(timeSec: number): number {
  const wave = 0.5 - 0.5 * Math.cos((timeSec * Math.PI * 2) / BREATHE_PERIOD_SEC);
  return wave * wave;
}
