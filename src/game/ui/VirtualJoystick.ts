import {
  Assets,
  Circle,
  Container,
  FederatedPointerEvent,
  Graphics,
  PointData,
  Sprite,
  type Texture,
} from 'pixi.js';

type VirtualJoystickColors = {
  baseFill: number;
  baseStroke: number;
  knobFill: number;
  knobStroke: number;
};

const DEFAULT_COLORS: VirtualJoystickColors = {
  baseFill: 0x1f2f4f,
  baseStroke: 0x82c8ff,
  knobFill: 0xb7e8ff,
  knobStroke: 0xe7f7ff,
};

/** Resolved against the current page URL so `./` bases (vite `base: "./"`) still load reliably. */
const JOYSTICK_CAP_TEXTURE_URL =
  typeof window !== 'undefined'
    ? new URL(
        `${import.meta.env.BASE_URL.replace(/\/?$/, '/')}assets/ui/joystick-s-cap.png`,
        window.location.href,
      ).href
    : `${import.meta.env.BASE_URL}assets/ui/joystick-s-cap.png`;

/** Extra radius (px) — cap PNG scales to diameter 2×(knobRadius + this) to sit flush with gold halo (~knobRadius + 18). */
const JOYSTICK_CAP_EXTRA_RADIUS = 15;

/** Extra scale on the cap sprite only (does not shrink hit radius). */
const JOYSTICK_CAP_UI_MULTIPLIER = 1.25;

/**
 * Clamp max horizontal knob travel vs layout radius (~20% of rim = small tactile nudge).
 * Was almost full-disk roam (radius − knob); this keeps controls feeling “planted”.
 */
function computeMaxHorizontalThrow(radiusPx: number, knobRadiusPx: number): number {
  const fromRim = Math.round(radiusPx * 0.2);
  const fromKnob = Math.round(knobRadiusPx * 0.72);
  return Math.max(11, Math.min(18, Math.min(fromRim, fromKnob)));
}

/** Soft response near center: exponent >1 = less jumpy at small deflections (~10% gentler vs 1.42 baseline). */
const JOYSTICK_AXIS_CURVE = 1.562;

/**
 * Invisible rim + capped sprite. The knob follows the finger inside a disk (full-circle “stick” feel);
 * only the horizontal component is reported as an analog axis (see `JOYSTICK_AXIS_CURVE`).
 */
export class VirtualJoystick {
  readonly root = new Container();

  /** Invisible hit area for drag capture. */
  private readonly base = new Graphics();
  /** Subtle gold glow behind cap (matches TONGUE/JUMP vibe). */
  private readonly knobGlow = new Graphics();
  /** Artistic cap from game asset PNG. */
  private readonly knobCap = new Sprite();

  private pointerId: number | null = null;
  private centerX = 0;
  private centerY = 0;
  private radius = 56;
  private knobRadius = 24;
  /** Pocket radius: cap can move 360° within this disk; axis uses X only. */
  private maxStickThrow = 14;
  private textureReady = false;

  private readonly onAxisChanged: (axis: number) => void;
  private colors: VirtualJoystickColors = { ...DEFAULT_COLORS };

  constructor(onAxisChanged: (axis: number) => void) {
    this.onAxisChanged = onAxisChanged;

    this.base.eventMode = 'static';
    this.base.cursor = 'pointer';
    this.base.on('pointerdown', this.handlePointerDown);

    this.knobCap.anchor.set(0.5);
    this.knobGlow.eventMode = 'none';
    this.knobCap.eventMode = 'none';
    this.ensureCapTexture();

    this.root.addChild(this.base, this.knobGlow, this.knobCap);
    this.redraw();
  }

  private ensureCapTexture(): void {
    void Assets.load<Texture>(JOYSTICK_CAP_TEXTURE_URL)
      .then((texture) => {
        if (!texture?.width || !texture?.height) {
          return;
        }
        this.knobCap.texture = texture;
        this.textureReady = true;
        this.fitCapSprite();
        this.refreshGlow(0);
      })
      .catch(() => {});
  }

  setLayout(
    centerX: number,
    centerY: number,
    radius: number,
    knobRadius: number,
    colors: Partial<VirtualJoystickColors> = {},
  ): void {
    this.centerX = centerX;
    this.centerY = centerY;
    this.root.position.set(this.centerX, this.centerY);
    this.radius = Math.max(28, radius);
    this.knobRadius = Math.max(14, knobRadius);
    const tight = computeMaxHorizontalThrow(this.radius, this.knobRadius);
    const physics = Math.max(8, this.radius - this.knobRadius - 6);
    this.maxStickThrow = Math.max(11, Math.min(physics, tight));
    this.colors = { ...DEFAULT_COLORS, ...colors };
    this.base.hitArea = new Circle(0, 0, this.radius);
    this.redraw();
    this.fitCapSprite();
    this.refreshGlow(this.pointerId !== null ? 0.3 : 0);
    if (this.pointerId === null) {
      this.resetVisualOnly();
    }
  }

  onGlobalPointerMove(event: FederatedPointerEvent): void {
    if (event.pointerId !== this.pointerId) {
      return;
    }
    this.updateFromPoint(event.global);
  }

  onGlobalPointerUpOrCancel(event: FederatedPointerEvent): void {
    if (event.pointerId !== this.pointerId) {
      return;
    }
    this.pointerId = null;
    this.resetVisualOnly();
    this.onAxisChanged(0);
    this.base.scale.set(1);
    this.refreshGlow(0);
  }

  release(): void {
    this.pointerId = null;
    this.resetVisualOnly();
    this.onAxisChanged(0);
    this.base.scale.set(1);
    this.refreshGlow(0);
  }

  destroy(): void {
    this.base.off('pointerdown', this.handlePointerDown);
    this.root.destroy({ children: true });
  }

  private readonly handlePointerDown = (event: FederatedPointerEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    this.pointerId = event.pointerId;
    this.base.scale.set(0.985);
    this.updateFromPoint(event.global);
  };

  private updateFromPoint(point: PointData): void {
    const dx = point.x - this.centerX;
    const dy = point.y - this.centerY;
    const dist = Math.hypot(dx, dy);
    const cap = this.maxStickThrow;

    let offsetX = 0;
    let offsetY = 0;
    if (dist > 1e-5) {
      const r = Math.min(cap, dist);
      const s = r / dist;
      offsetX = dx * s;
      offsetY = dy * s;
    }

    const press = cap > 0 ? Math.min(1, Math.hypot(offsetX, offsetY) / cap) : 0;
    const capScale = this.getBaseCapScale() * (1 - press * 0.0198);

    this.knobCap.position.set(offsetX, offsetY);
    this.knobCap.scale.set(capScale);
    this.knobGlow.position.set(0, 0);

    this.refreshGlow(press);

    const linearX = cap > 0 ? offsetX / cap : 0;
    const ax = Math.min(1, Math.abs(linearX));
    const curved =
      ax < 1e-6 ? 0 : Math.sign(linearX) * Math.pow(ax, JOYSTICK_AXIS_CURVE);
    this.onAxisChanged(Math.max(-1, Math.min(1, curved)));
  }

  private resetVisualOnly(): void {
    this.knobCap.position.set(0, 0);
    this.knobCap.scale.set(this.getBaseCapScale());
    this.knobGlow.position.set(0, 0);
    this.refreshGlow(0);
  }

  private redraw(): void {
    this.base.clear();
    this.base.circle(0, 0, this.radius).fill({ color: 0x000000, alpha: 0.001 });
    this.fitCapSprite();
    this.refreshGlow(0);
  }

  private getBaseCapScale(): number {
    const tex = this.knobCap.texture;
    if (!tex.width || !tex.height) {
      return 1;
    }
    const target = 2 * (this.knobRadius + JOYSTICK_CAP_EXTRA_RADIUS) * JOYSTICK_CAP_UI_MULTIPLIER;
    return target / Math.max(tex.width, tex.height);
  }

  private fitCapSprite(): void {
    if (!this.textureReady && this.knobCap.texture?.width) {
      this.textureReady = true;
    }
    const scale = this.getBaseCapScale();
    this.knobCap.scale.set(scale);
  }

  /** Gold glow rings (same language as TONGUE/JUMP action buttons). */
  private refreshGlow(press: number): void {
    this.knobGlow.clear();
    const gold = 0xffea80;
    const boost = 1 + press * 0.405;
    const r = this.knobRadius + 2;
    this.knobGlow.circle(0, 0, r + 16).fill({ color: gold, alpha: 0.08 * boost });
    this.knobGlow.circle(0, 0, r + 10).fill({ color: gold, alpha: 0.14 * boost });
    this.knobGlow.circle(0, 0, r + 4).stroke({ color: gold, alpha: 0.22 + press * 0.18, width: 1.2 });
  }
}
