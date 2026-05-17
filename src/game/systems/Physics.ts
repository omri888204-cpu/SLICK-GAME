import {
  GRAPPLE,
  PHYSICS,
  WALK,
} from '../../config/game.config';
import type { Platform } from '../types';

export type PlayerBody = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  width: number;
  height: number;
  grounded: boolean;
};

export type PhysicsResult = {
  landedPlatform?: Platform;
  impactVy: number;
  /** Max-duration fascia slide ended this step — scene may disable fascia “collider” + bypass re-latch. */
  fasciaSlideHardBreak?: boolean;
  /** First frame of a new fascia wall latch (elevator grab). */
  fasciaWallSlideLatched?: boolean;
};

export class Physics {
  /** Left/right fascia slab overlap vs player AABB; epsilon keeps contact when flush with inner playfield edge. */
  private static viewportFasciaSlabOverlapPair(
    bx1: number,
    bx2: number,
    leftX: number,
    rightX: number,
    slabW: number,
  ): { overlapLeft: boolean; overlapRight: boolean } {
    const e = PHYSICS.viewportFasciaOverlapEpsPx;
    const t = slabW;
    const overlapLeft = bx2 > leftX && bx1 < leftX + t + e;
    const overlapRight = bx2 > rightX - e && bx1 < rightX + t;
    return { overlapLeft, overlapRight };
  }

  /**
   * True while the player rides the viewport fascia **elevator** (after latch, before cutoff / clear).
   */
  private isSliding = false;
  /** Ms spent overlapping the fascia this grab; reset on each new latch. */
  private slideTimer = 0;
  /** Which fascia slab is driving the current slide (`fasciaLeft` / `fasciaRight` / `fasciaBoth`). */
  private activeSlidingWall: string | null = null;
  /** Wall id → cooldown expiration time (ms, same clock as {@link update} `gameTimeMs`). */
  private wallCooldowns = new Map<string, number>();

  /** Fascia slab key for cooldown / active slide (viewport edges — not world objects). */
  static fasciaWallCooldownKey(
    side: 'none' | 'left' | 'right' | 'both',
  ): string | null {
    if (side === 'none') {
      return null;
    }
    if (side === 'left') {
      return 'fasciaLeft';
    }
    if (side === 'right') {
      return 'fasciaRight';
    }
    return 'fasciaBoth';
  }

  private pruneExpiredWallCooldowns(nowMs: number): void {
    for (const [id, until] of this.wallCooldowns) {
      if (until <= nowMs) {
        this.wallCooldowns.delete(id);
      }
    }
  }

  /** Clear wall-slide metering (new run / scene reset / manual detach). Cooldown map is kept. */
  resetWallSlideSession(): void {
    this.isSliding = false;
    this.slideTimer = 0;
    this.activeSlidingWall = null;
  }

  /** New run / scene restart: allow all fascia walls again. */
  clearFasciaWallCooldowns(): void {
    this.wallCooldowns.clear();
  }
  /**
   * Which fascia slab region(s) the body overlaps — used for detach kick direction.
   */
  static viewportFasciaBodyOverlapSide(
    body: PlayerBody,
    spec: { slabW: number; leftSlabLeftX: number; rightSlabLeftX: number },
  ): 'none' | 'left' | 'right' | 'both' {
    const bx1 = body.x;
    const bx2 = body.x + body.width;
    const t = spec.slabW;
    const { overlapLeft, overlapRight } = Physics.viewportFasciaSlabOverlapPair(
      bx1,
      bx2,
      spec.leftSlabLeftX,
      spec.rightSlabLeftX,
      t,
    );
    if (overlapLeft && overlapRight) {
      return 'both';
    }
    if (overlapLeft) {
      return 'left';
    }
    if (overlapRight) {
      return 'right';
    }
    return 'none';
  }

  /** True if the body AABB overlaps either fascia slab strip (ignores stick — overlap only). */
  static viewportFasciaHasSlabOverlap(
    body: PlayerBody,
    spec: { slabW: number; leftSlabLeftX: number; rightSlabLeftX: number },
  ): boolean {
    if (!spec || spec.slabW < 8 || body.grounded) {
      return false;
    }
    const t = spec.slabW;
    const bx1 = body.x;
    const bx2 = body.x + body.width;
    const { overlapLeft, overlapRight } = Physics.viewportFasciaSlabOverlapPair(
      bx1,
      bx2,
      spec.leftSlabLeftX,
      spec.rightSlabLeftX,
      t,
    );
    return overlapLeft || overlapRight;
  }

  /**
   * First platform underside directly above within [min..max] ray distance (world coords, y down).
   */
  static castGrappleTarget(
    platforms: Platform[],
    mouthX: number,
    mouthY: number,
    minRangePx: number,
    maxRangePx: number,
    rayHalfWidth: number,
    preferFarthest = false,
  ): { x: number; y: number; platform: Platform } | undefined {
    let bestBottom = preferFarthest ? Infinity : -Infinity;
    let hit: { x: number; y: number; platform: Platform } | undefined;

    for (const platform of platforms) {
      const bottom = platform.y + platform.height;
      const half = rayHalfWidth;
      const overlapsX =
        mouthX + half > platform.x && mouthX - half < platform.x + platform.width;
      if (!overlapsX) {
        continue;
      }

      if (bottom >= mouthY) {
        continue;
      }

      const distanceToBottom = mouthY - bottom;
      if (distanceToBottom > maxRangePx || distanceToBottom < minRangePx) {
        continue;
      }

      const betterCandidate = preferFarthest ? bottom < bestBottom : bottom > bestBottom;
      if (betterCandidate) {
        bestBottom = bottom;
        hit = {
          x: mouthX,
          y: bottom - 3,
          platform,
        };
      }
    }

    return hit;
  }

  applyGrappleAcceleration(
    body: PlayerBody,
    _anchorX: number,
    anchorY: number,
    _mouthX: number,
    mouthY: number,
    dt: number,
  ): void {
    if (anchorY >= mouthY - 2) {
      return;
    }

    body.vy -= GRAPPLE.pullAcceleration * dt;
    body.vy = Math.max(-GRAPPLE.maxPullSpeed, body.vy);
    body.vx = this.moveToward(body.vx, 0, WALK.stopDeceleration * dt);

    const pullDamp = Math.max(0, 1 - GRAPPLE.pullVelocityDampingPerSec * dt);
    body.vx *= pullDamp;
    body.vy *= pullDamp;
  }

  /**
   * Platforms are kinematic (no `setFriction` — not a physics engine). Horizontal drift is applied in
   * `PlayScene` via `Platform.driftVx`; when grounded, the scene carries the player with the stair.
   */
  update(
    body: PlayerBody,
    platforms: Platform[],
    width: number,
    dt: number,
    gravityScale = 1,
    opts?: {
      viewportFasciaAssist?: {
        slabW: number;
        leftSlabLeftX: number;
        rightSlabLeftX: number;
        /** Player horizontal input (−1..1): steering away from a contacted slab skips assist instantly. */
        horizontalAxis: number;
      };
      /**
       * True when the body does not overlap either viewport fascia slab — ends the slide session
       * (same as leaving the “wall latch” zone).
       */
      fasciaOverlapClear?: boolean;
      /** Monotonic ms time (e.g. `runTime * 1000`) for wall cooldowns and max slide cutoff. */
      gameTimeMs?: number;
    },
  ): PhysicsResult {
    const spec = opts?.viewportFasciaAssist;
    const fasciaClear = opts?.fasciaOverlapClear === true;
    const nowMs =
      opts?.gameTimeMs ??
      (typeof performance !== 'undefined' ? performance.now() : 0);

    this.pruneExpiredWallCooldowns(nowMs);

    const wantsAssistBeforeReset =
      spec != null && Physics.viewportFasciaAssistWantsAssist(body, spec);

    if (body.grounded || fasciaClear) {
      this.resetWallSlideSession();
    } else if (
      this.isSliding &&
      spec &&
      Physics.viewportFasciaHasSlabOverlap(body, spec) &&
      !wantsAssistBeforeReset
    ) {
      // Condition A: manual detach — stick steers off the wall while still overlapping fascia.
      this.resetWallSlideSession();
    }

    const previousBottom = this.getBottom(body);
    const previousY = body.y;

    const wantsAssist = spec != null && Physics.viewportFasciaAssistWantsAssist(body, spec);

    const overlapSide = spec ? Physics.viewportFasciaBodyOverlapSide(body, spec) : 'none';
    const wallKey = Physics.fasciaWallCooldownKey(overlapSide);
    const cooldownUntil = wallKey ? this.wallCooldowns.get(wallKey) : undefined;
    const wallOnCooldown = cooldownUntil != null && cooldownUntil > nowMs;

    let wallSlideHardBreak = false;
    let fasciaWallSlideLatched = false;

    // Latch: new grab — blocked while this fascia wall is on cooldown.
    if (
      wantsAssist &&
      spec &&
      wallKey &&
      !wallOnCooldown
    ) {
      if (!this.isSliding) {
        fasciaWallSlideLatched = true;
        this.isSliding = true;
        this.activeSlidingWall = wallKey;
        this.slideTimer = 0;
      }
    }

    // Max slide duration → per-wall cooldown + hard downward break (no re-latch this frame).
    if (
      this.isSliding &&
      this.activeSlidingWall &&
      spec &&
      Physics.viewportFasciaHasSlabOverlap(body, spec)
    ) {
      this.slideTimer += dt * 1000;
      if (this.slideTimer >= PHYSICS.wallSlideMaxDurationMs) {
        this.wallCooldowns.set(
          this.activeSlidingWall,
          nowMs + PHYSICS.wallSlideCooldownMs,
        );
        this.isSliding = false;
        this.slideTimer = 0;
        this.activeSlidingWall = null;
        body.vy = PHYSICS.wallSlideCutoffDropVy;
        wallSlideHardBreak = true;
      }
    }

    const wallElevatorActive =
      !wallSlideHardBreak &&
      this.isSliding &&
      spec &&
      Physics.viewportFasciaHasSlabOverlap(body, spec);
    if (wallElevatorActive) {
      body.vy = -PHYSICS.wallSlideElevatorSpeedPxPerSec;
    } else {
      body.vy += PHYSICS.gravity * gravityScale * dt;
    }
    body.x += body.vx * dt;
    body.y += body.vy * dt;
    body.grounded = false;

    const allowFasciaAssist =
      !wallSlideHardBreak &&
      spec != null &&
      Physics.viewportFasciaAssistWantsAssist(body, spec);

    if (allowFasciaAssist) {
      this.applyViewportFasciaAssist(body, spec, dt);
    }

    this.resolveWorldBounds(body, width);
    const impactVy = body.vy;
    const landedPlatform = this.resolvePlatformLanding(body, platforms, previousBottom, previousY);

    return {
      landedPlatform,
      impactVy: landedPlatform ? impactVy : 0,
      fasciaSlideHardBreak: wallSlideHardBreak,
      fasciaWallSlideLatched,
    };
  }

  /**
   * True when {@link applyViewportFasciaAssist} would apply slide cap / slab damping (overlap + axis rules).
   */
  static viewportFasciaAssistWantsAssist(
    body: PlayerBody,
    spec:
      | {
          slabW: number;
          leftSlabLeftX: number;
          rightSlabLeftX: number;
          horizontalAxis: number;
        }
      | undefined,
  ): boolean {
    if (!spec || spec.slabW < 8 || body.grounded) {
      return false;
    }

    const dz = PHYSICS.viewportFasciaAxisDeadzone;
    const axis = Math.max(-1, Math.min(1, spec.horizontalAxis));
    const t = spec.slabW;
    const leftX = spec.leftSlabLeftX;
    const rightX = spec.rightSlabLeftX;

    const bx1 = body.x;
    const bx2 = body.x + body.width;
    const { overlapLeft, overlapRight } = Physics.viewportFasciaSlabOverlapPair(
      bx1,
      bx2,
      leftX,
      rightX,
      t,
    );
    if (!overlapLeft && !overlapRight) {
      return false;
    }

    const tunnel = overlapLeft && overlapRight;
    if (tunnel) {
      if (Math.abs(axis) > dz) {
        return false;
      }
    } else if (overlapLeft) {
      if (axis > dz) {
        return false;
      }
    } else if (overlapRight) {
      if (axis < -dz) {
        return false;
      }
    }
    return true;
  }

  /**
   * Decorative viewport fascia: no X latch. Normal gravity stays; brushing a slab clamps downward speed and
   * optionally dampens inward vx until the stick steers away.
   */
  private applyViewportFasciaAssist(
    body: PlayerBody,
    spec:
      | {
          slabW: number;
          leftSlabLeftX: number;
          rightSlabLeftX: number;
          horizontalAxis: number;
        }
      | undefined,
    dt: number,
  ): void {
    if (dt <= 0) {
      return;
    }
    if (!Physics.viewportFasciaAssistWantsAssist(body, spec)) {
      return;
    }
    if (!spec) {
      return;
    }

    const cap = PHYSICS.viewportFasciaFallVyCap;
    if (body.vy > cap) {
      body.vy = cap;
    }

    const k = PHYSICS.viewportFasciaIntoWallVxDampPerSec;
    if (k <= 1e-6) {
      return;
    }
    const damp = Math.exp(-k * dt);

    const t = spec.slabW;
    const leftX = spec.leftSlabLeftX;
    const rightX = spec.rightSlabLeftX;
    const bx1 = body.x;
    const bx2 = body.x + body.width;
    const { overlapLeft, overlapRight } = Physics.viewportFasciaSlabOverlapPair(
      bx1,
      bx2,
      leftX,
      rightX,
      t,
    );
    const tunnel = overlapLeft && overlapRight;

    if (tunnel) {
      body.vx *= damp;
      return;
    }
    if (overlapLeft && body.vx < 0) {
      body.vx *= damp;
    } else if (overlapRight && body.vx > 0) {
      body.vx *= damp;
    }
  }

  applyHorizontalInput(
    body: PlayerBody,
    axis: number,
    dt: number,
    airControlScale = 1,
    groundAccelScale = 1,
  ): void {
    const targetVx = axis * WALK.speedPxPerSecond;
    let rate: number;
    const airMul = body.grounded ? 1 : airControlScale;
    const groundMul = body.grounded ? groundAccelScale : 1;
    if (axis === 0) {
      rate = body.grounded ? WALK.stopDeceleration : WALK.airStopDeceleration;
    } else {
      rate = body.grounded ? WALK.acceleration * groundMul : WALK.airAcceleration * airMul;
    }

    body.vx = this.moveToward(body.vx, targetVx, rate * dt);
    body.vx = Math.max(-PHYSICS.maxSpeed, Math.min(PHYSICS.maxSpeed, body.vx));
  }

  jump(body: PlayerBody): void {
    body.vy = -(PHYSICS.baseJump + Math.abs(body.vx) * PHYSICS.speedJumpBonus);
    body.grounded = false;
  }

  snapToPlatform(body: PlayerBody, platform: Platform): void {
    body.y = platform.y - body.height;
    body.vy = 0;
    body.grounded = true;
  }

  /**
   * Same role as Phaser `setCollideWorldBounds(true)`: keep the AABB inside the canvas width.
   * Call after any code path that moves the player without `update()` (e.g. 360 skill).
   */
  applyWorldBounds(body: PlayerBody, width: number): void {
    this.resolveWorldBounds(body, width);
  }

  private resolveWorldBounds(body: PlayerBody, width: number): void {
    const maxX = Math.max(0, width - body.width);
    const rest = PHYSICS.worldWallRestitution;

    if (body.x < 0) {
      body.x = 0;
      if (body.vx < 0) {
        body.vx = -body.vx * rest;
      }
    } else if (body.x > maxX) {
      body.x = maxX;
      if (body.vx > 0) {
        body.vx = -body.vx * rest;
      }
    }
  }

  private resolvePlatformLanding(
    body: PlayerBody,
    platforms: Platform[],
    previousBottom: number,
    previousY: number,
  ): Platform | undefined {
    if (body.vy < 0) {
      return undefined;
    }

    for (const platform of platforms) {
      const wasAbove = previousBottom <= platform.y;
      const overlapsX =
        body.x + body.width * 0.42 > platform.x && body.x < platform.x + platform.width;
      const crossedTop = this.getBottom(body) >= platform.y;
      const isMovingDown = body.y >= previousY;

      if (wasAbove && isMovingDown && overlapsX && crossedTop) {
        this.snapToPlatform(body, platform);
        return platform;
      }
    }

    return undefined;
  }

  private getBottom(body: PlayerBody): number {
    return body.y + body.height;
  }

  private moveToward(current: number, target: number, maxDelta: number): number {
    if (Math.abs(target - current) <= maxDelta) {
      return target;
    }

    return current + Math.sign(target - current) * maxDelta;
  }
}
